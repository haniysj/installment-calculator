import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deletePlanFromDB, loadPlans, loadSettings, loadSyncMeta, replaceAllPlans, requestPersistence, savePlan, saveSettings, saveSyncMeta } from './lib/db';
import { EMPTY_SYNC_META, afterSync, applyRemote, buildChanges, type SyncMeta } from './lib/sync';
import { CloudError, cloud, cloudMessage } from './lib/cloud';
import { roundingUnit } from './lib/money';
import { attachMonthPayments } from './lib/engine';
import { DEFAULT_SETTINGS, type Plan, type Result, type Settings } from './lib/types';

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; text: string }
interface ConfirmReq { title: string; body?: string; confirmText?: string; danger?: boolean; resolve: (v: boolean) => void }

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'pending' | 'offline' | 'error';
export interface CloudState { status: SyncStatus; username: string | null; lastSyncAt: string | null; error: string | null; pending: number }

interface AppState {
  cloudState: CloudState;
  connectCloud: (mode: 'setup' | 'unlock', pin: string) => Promise<string | null>;
  disconnectCloud: () => Promise<void>;
  syncNow: () => Promise<void>;
  loaded: boolean;
  dbError: string | null;
  plans: Plan[];
  settings: Settings;
  unit: number;
  online: boolean;
  installPrompt: any;
  toasts: Toast[];
  confirmReq: ConfirmReq | null;
  getPlan: (id: string | null | undefined) => Plan | undefined;
  activePlan: Plan | undefined;
  upsertPlan: (p: Plan) => Promise<boolean>;
  removePlan: (id: string) => Promise<void>;
  replacePlans: (ps: Plan[]) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  /** apply an engine result: save + toast */
  apply: (r: Result<Plan>) => Promise<boolean>;
  toast: (text: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
  confirm: (req: Omit<ConfirmReq, 'resolve'>) => Promise<boolean>;
  closeConfirm: (v: boolean) => void;
  clearInstallPrompt: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const toastId = useRef(0);
  const [cloudState, setCloudState] = useState<CloudState>({ status: 'off', username: null, lastSyncAt: null, error: null, pending: 0 });
  const metaRef = useRef<SyncMeta>({ ...EMPTY_SYNC_META });
  const plansRef = useRef<Plan[]>([]);
  const syncing = useRef(false);
  const again = useRef(false);
  const timer = useRef<number>();
  useEffect(() => { plansRef.current = plans; }, [plans]);

  const setMeta = useCallback(async (m: SyncMeta) => {
    metaRef.current = m;
    setCloudState((c) => ({ ...c, username: m.username, lastSyncAt: m.lastSyncAt, pending: m.dirty.length + m.tombstones.length,
      status: !m.token ? 'off' : c.status === 'off' ? 'pending' : c.status }));
    try { await saveSyncMeta(m); } catch (e) { console.error(e); }
  }, []);

  /** Two-way sync with the cloud. Safe to call any time; overlapping calls are merged. */
  const syncNow = useCallback(async () => {
    const meta = metaRef.current;
    if (!meta.token) return;
    if (syncing.current) { again.current = true; return; }
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setCloudState((c) => ({ ...c, status: 'offline' })); return; }
    syncing.current = true;
    setCloudState((c) => ({ ...c, status: 'syncing', error: null }));
    try {
      const changes = buildChanges(plansRef.current, meta);
      const res = await cloud.sync(meta.token, changes, meta.cursor);
      const merged = applyRemote(plansRef.current, res.plans);
      if (merged.saved.length || merged.removed.length) {
        await Promise.all([...merged.saved.map((p) => savePlan(p)), ...merged.removed.map((id) => deletePlanFromDB(id))]);
        plansRef.current = merged.plans;
        setPlans(merged.plans);
      }
      await setMeta(afterSync(metaRef.current, changes, plansRef.current, res.cursor, new Date().toISOString()));
      setCloudState((c) => ({ ...c, status: metaRef.current.dirty.length + metaRef.current.tombstones.length ? 'pending' : 'synced', error: null }));
    } catch (e) {
      const code = e instanceof CloudError ? e.code : 'UNKNOWN';
      if (code === 'IC_SESSION') {
        await setMeta({ ...metaRef.current, token: null });
        setCloudState((c) => ({ ...c, status: 'off', error: cloudMessage(code) }));
      } else {
        setCloudState((c) => ({ ...c, status: code === 'NETWORK' ? 'offline' : 'error', error: cloudMessage(code) }));
      }
    } finally {
      syncing.current = false;
      if (again.current) { again.current = false; window.setTimeout(() => { void syncNowRef.current(); }, 300); }
    }
  }, [setMeta]);
  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;

  const scheduleSync = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void syncNowRef.current(); }, 1200);
  }, []);

  const markDirty = useCallback((ids: string[], removed: string[] = []) => {
    const m = metaRef.current;
    if (!m.token) return;
    const at = new Date().toISOString();
    void setMeta({
      ...m,
      dirty: [...new Set([...m.dirty.filter((id) => !removed.includes(id)), ...ids])],
      tombstones: [...m.tombstones.filter((t) => !removed.includes(t.id) && !ids.includes(t.id)), ...removed.map((id) => ({ id, at }))],
    });
    scheduleSync();
  }, [setMeta, scheduleSync]);

  const connectCloud = useCallback(async (mode: 'setup' | 'unlock', pin: string) => {
    try {
      const s = mode === 'setup' ? await cloud.setup(pin) : await cloud.unlock(pin);
      // everything on this device is sent once; the server keeps the newest copy of each plan
      await setMeta({ ...EMPTY_SYNC_META, token: s.token, username: null, dirty: plansRef.current.map((p) => p.id) });
      setCloudState((c) => ({ ...c, status: 'pending', error: null }));
      await syncNowRef.current();
      return null;
    } catch (e) {
      return cloudMessage(e instanceof CloudError ? e.code : 'UNKNOWN');
    }
  }, [setMeta]);

  const disconnectCloud = useCallback(async () => {
    const t = metaRef.current.token;
    await setMeta({ ...EMPTY_SYNC_META });
    setCloudState({ status: 'off', username: null, lastSyncAt: null, error: null, pending: 0 });
    if (t) { try { await cloud.logout(t); } catch { /* offline: the session simply expires unused */ } }
  }, [setMeta]);

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 4000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    (async () => {
      try {
        const [loadedPlans, s] = await Promise.all([loadPlans(), loadSettings()]);
        // older plans: extra payments made inside an installment month become that month's installment
        const ps = loadedPlans.map((p) => attachMonthPayments(p, roundingUnit(s.decimals)));
        await Promise.all(ps.filter((p, i) => p !== loadedPlans[i]).map((p) => savePlan(p)));
        setPlans(ps);
        plansRef.current = ps;
        setSettings(s);
        requestPersistence();
        const m = await loadSyncMeta();
        metaRef.current = m;
        setCloudState({ status: m.token ? 'pending' : 'off', username: m.username, lastSyncAt: m.lastSyncAt, error: null, pending: m.dirty.length + m.tombstones.length });
        if (m.token) void syncNowRef.current();
      } catch (e) {
        console.error(e);
        setDbError('تعذّر فتح التخزين المحلي في هذا المتصفح (قد يكون في وضع التصفح الخاص). يمكنك الحساب، لكن الحفظ قد لا يعمل.');
      } finally {
        setLoaded(true);
      }
    })();
    const on = () => { setOnline(true); void syncNowRef.current(); };
    const off = () => { setOnline(false); if (metaRef.current.token) setCloudState((c) => ({ ...c, status: 'offline' })); };
    const vis = () => { if (document.visibilityState === 'visible') void syncNowRef.current(); };
    document.addEventListener('visibilitychange', vis);
    const every = window.setInterval(() => { if (document.visibilityState === 'visible') void syncNowRef.current(); }, 60_000);
    const bip = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('beforeinstallprompt', bip);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('beforeinstallprompt', bip);
      document.removeEventListener('visibilitychange', vis);
      window.clearInterval(every);
    };
  }, []);

  // theme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0D0A17' : '#7033FF');
    };
    applyTheme();
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [settings.theme]);

  useEffect(() => { document.title = settings.appTitle; }, [settings.appTitle]);

  const upsertPlan = useCallback(async (p: Plan) => {
    setPlans((ps) => {
      const i = ps.findIndex((x) => x.id === p.id);
      if (i < 0) return [p, ...ps];
      const copy = ps.slice();
      copy[i] = p;
      return copy;
    });
    try {
      await savePlan(p);
      markDirty([p.id]);
      return true;
    } catch (e) {
      console.error(e);
      toast('تعذّر الحفظ في التخزين المحلي. صدّر نسخة احتياطية حتى لا تفقد بياناتك.', 'error');
      return false;
    }
  }, [toast, markDirty]);

  const removePlan = useCallback(async (id: string) => {
    setPlans((ps) => ps.filter((p) => p.id !== id));
    try { await deletePlanFromDB(id); markDirty([], [id]); } catch { toast('تعذّر حذف الخطة من التخزين.', 'error'); }
  }, [toast, markDirty]);

  const replacePlans = useCallback(async (ps: Plan[]) => {
    const before = plansRef.current.map((p) => p.id);
    await replaceAllPlans(ps);
    const sorted = [...ps].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    plansRef.current = sorted;
    setPlans(sorted);
    const keep = new Set(ps.map((p) => p.id));
    markDirty(ps.map((p) => p.id), before.filter((id) => !keep.has(id)));
  }, [markDirty]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { await saveSettings(next); } catch { toast('تعذّر حفظ الإعدادات.', 'error'); }
  }, [settings, toast]);

  const apply = useCallback(async (r: Result<Plan>) => {
    if (!r.ok) { toast(r.error, 'error'); return false; }
    const saved = await upsertPlan(r.value);
    if (saved && r.message) toast(r.message, 'success');
    return saved;
  }, [toast, upsertPlan]);

  const confirm = useCallback((req: Omit<ConfirmReq, 'resolve'>) => new Promise<boolean>((resolve) => setConfirmReq({ ...req, resolve })), []);
  const closeConfirm = useCallback((v: boolean) => {
    setConfirmReq((c) => { c?.resolve(v); return null; });
  }, []);

  const getPlan = useCallback((id: string | null | undefined) => plans.find((p) => p.id === id), [plans]);
  const activePlan = useMemo(() => plans.find((p) => p.id === settings.activePlanId) ?? plans[0], [plans, settings.activePlanId]);

  const value: AppState = {
    cloudState, connectCloud, disconnectCloud, syncNow,
    loaded, dbError, plans, settings, unit: roundingUnit(settings.decimals), online, installPrompt, toasts, confirmReq,
    getPlan, activePlan, upsertPlan, removePlan, replacePlans, updateSettings, apply, toast, dismissToast, confirm, closeConfirm,
    clearInstallPrompt: () => setInstallPrompt(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
