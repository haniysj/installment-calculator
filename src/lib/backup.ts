import { isValidISO } from './dates';
import { DEFAULT_SETTINGS, type Plan, type Settings } from './types';

export const BACKUP_APP = 'installment-calculator';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  plans: Plan[];
  settings?: Partial<Settings>;
}

export function buildBackup(plans: Plan[], settings?: Settings): BackupFile {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), plans, settings };
}

const isInt = (v: unknown) => Number.isInteger(v);
const isStr = (v: unknown) => typeof v === 'string';
const isBool = (v: unknown) => typeof v === 'boolean';

/** Validate one plan; returns an Arabic error message or null. */
export function validatePlan(p: any, n: number): string | null {
  const where = `الخطة رقم ${n}`;
  if (!p || typeof p !== 'object') return `${where}: بيانات غير صالحة.`;
  if (!isStr(p.id) || !p.id) return `${where}: معرّف مفقود.`;
  if (!isStr(p.name)) return `${where}: الاسم مفقود.`;
  if (!isInt(p.principal) || p.principal <= 0) return `${where}: المبلغ الإجمالي غير صالح.`;
  if (!isValidISO(p.firstDate)) return `${where}: تاريخ أول قسط غير صالح.`;
  if (!['fixed', 'flexible', 'custom'].includes(p.mode)) return `${where}: نوع التقسيط غير معروف.`;
  if (!['equal', 'fixed', 'last'].includes(p.strategy)) return `${where}: طريقة إعادة الحساب غير معروفة.`;
  if (!Array.isArray(p.installments) || !Array.isArray(p.payments)) return `${where}: الجدول أو الدفعات مفقودة.`;
  const ids = new Set<string>();
  for (const r of p.installments) {
    if (!isStr(r?.id) || ids.has(r.id)) return `${where}: معرّف قسط مكرر أو مفقود.`;
    ids.add(r.id);
    if (!isValidISO(r.dueDate) || !isInt(r.planned) || r.planned < 0) return `${where}: قسط غير صالح.`;
    if (![r.closed, r.locked, r.skipped, r.cancelled].every(isBool)) return `${where}: حالة قسط غير صالحة.`;
  }
  const payIds = new Set<string>();
  let paid = 0;
  for (const x of p.payments) {
    if (!isStr(x?.id) || payIds.has(x.id)) return `${where}: معرّف دفعة مكرر أو مفقود.`;
    payIds.add(x.id);
    if (!isValidISO(x.date) || !isInt(x.amount) || x.amount <= 0) return `${where}: دفعة غير صالحة.`;
    if (!['installment', 'extra', 'down'].includes(x.kind)) return `${where}: نوع دفعة غير معروف.`;
    if (x.installmentId != null && !ids.has(x.installmentId)) return `${where}: دفعة مرتبطة بقسط غير موجود.`;
    paid += x.amount;
  }
  if (paid > p.principal) return `${where}: مجموع الدفعات أكبر من المبلغ الإجمالي.`;
  if (!p.input || typeof p.input !== 'object') return `${where}: إعدادات الإنشاء مفقودة.`;
  return null;
}

export type ParsedBackup = { ok: true; plans: Plan[]; settings: Partial<Settings> | null } | { ok: false; error: string };

export function parseBackup(text: string): ParsedBackup {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'الملف ليس بصيغة JSON صحيحة.' };
  }
  if (!data || data.app !== BACKUP_APP) return { ok: false, error: 'هذا الملف ليس نسخة احتياطية من حاسبة التقسيط.' };
  if (!isInt(data.version) || data.version > BACKUP_VERSION) return { ok: false, error: 'إصدار النسخة الاحتياطية غير مدعوم.' };
  if (!Array.isArray(data.plans)) return { ok: false, error: 'لا توجد خطط في الملف.' };
  const seen = new Set<string>();
  for (let i = 0; i < data.plans.length; i++) {
    const err = validatePlan(data.plans[i], i + 1);
    if (err) return { ok: false, error: err };
    if (seen.has(data.plans[i].id)) return { ok: false, error: `الخطة رقم ${i + 1}: مكررة في الملف.` };
    seen.add(data.plans[i].id);
  }
  let settings: Partial<Settings> | null = null;
  if (data.settings && typeof data.settings === 'object') {
    const s = data.settings;
    settings = {};
    if (['system', 'light', 'dark'].includes(s.theme)) settings.theme = s.theme;
    if (s.decimals === 0 || s.decimals === 2 || s.decimals === 3) settings.decimals = s.decimals;
    if (['symbol', 'text'].includes(s.currencyDisplay)) settings.currencyDisplay = s.currencyDisplay;
    if (isStr(s.appTitle) && s.appTitle.trim()) settings.appTitle = s.appTitle.slice(0, 60);
  }
  return { ok: true, plans: data.plans as Plan[], settings };
}

/** Merge restored plans into existing ones. mode 'merge' replaces same-id plans; 'replace' drops everything else. */
export function mergePlans(existing: Plan[], incoming: Plan[], mode: 'merge' | 'replace'): Plan[] {
  if (mode === 'replace') return incoming.slice();
  const map = new Map(existing.map((p) => [p.id, p]));
  for (const p of incoming) map.set(p.id, p);
  return [...map.values()];
}

export { DEFAULT_SETTINGS };
