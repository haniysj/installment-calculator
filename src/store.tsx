import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deletePlanFromDB, loadPlans, loadSettings, replaceAllPlans, requestPersistence, savePlan, saveSettings } from './lib/db';
import { roundingUnit } from './lib/money';
import { DEFAULT_SETTINGS, type Plan, type Result, type Settings } from './lib/types';

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; text: string }
interface ConfirmReq { title: string; body?: string; confirmText?: string; danger?: boolean; resolve: (v: boolean) => void }

interface AppState {
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

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 4000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useEffect(() => {
    (async () => {
      try {
        const [ps, s] = await Promise.all([loadPlans(), loadSettings()]);
        setPlans(ps);
        setSettings(s);
        requestPersistence();
      } catch (e) {
        console.error(e);
        setDbError('تعذّر فتح التخزين المحلي في هذا المتصفح (قد يكون في وضع التصفح الخاص). يمكنك الحساب، لكن الحفظ قد لا يعمل.');
      } finally {
        setLoaded(true);
      }
    })();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const bip = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('beforeinstallprompt', bip);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('beforeinstallprompt', bip);
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
      return true;
    } catch (e) {
      console.error(e);
      toast('تعذّر الحفظ في التخزين المحلي. صدّر نسخة احتياطية حتى لا تفقد بياناتك.', 'error');
      return false;
    }
  }, [toast]);

  const removePlan = useCallback(async (id: string) => {
    setPlans((ps) => ps.filter((p) => p.id !== id));
    try { await deletePlanFromDB(id); } catch { toast('تعذّر حذف الخطة من التخزين.', 'error'); }
  }, [toast]);

  const replacePlans = useCallback(async (ps: Plan[]) => {
    await replaceAllPlans(ps);
    setPlans([...ps].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
  }, []);

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
    loaded, dbError, plans, settings, unit: roundingUnit(settings.decimals), online, installPrompt, toasts, confirmReq,
    getPlan, activePlan, upsertPlan, removePlan, replacePlans, updateSettings, apply, toast, dismissToast, confirm, closeConfirm,
    clearInstallPrompt: () => setInstallPrompt(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
