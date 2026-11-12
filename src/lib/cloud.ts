// Calls to the cloud endpoint (/api/ic on Vercel → Neon). The database itself is never reachable from the phone.
import type { Change, RemoteRow } from './sync';

const ENDPOINT = '/api/ic';

export class CloudError extends Error {
  constructor(public code: string) { super(code); }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fn, args }),
      cache: 'no-store',
    });
  } catch {
    throw new CloudError('NETWORK');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    const code = typeof data?.message === 'string' && data.message.startsWith('IC_') ? data.message : res.status >= 500 ? 'SERVER' : 'UNKNOWN';
    throw new CloudError(code);
  }
  if (data && typeof data === 'object' && typeof data.error === 'string') {
    throw new CloudError(data.error === 'IC_INVALID' && Number.isFinite(data.left) ? `IC_INVALID:${data.left}` : data.error);
  }
  return data as T;
}

export interface Session { token: string }

export const cloud = {
  /** has a secret code been set for this app yet? */
  status: () => call<{ exists: boolean }>('status', {}),
  setup: (pin: string) => call<Session>('setup', { pin }),
  unlock: (pin: string) => call<Session>('unlock', { pin }),
  sync: (token: string, changes: Change[], since: number) => call<{ cursor: number; plans: RemoteRow[] }>('sync', { token, changes, since }),
  logout: (token: string) => call<null>('logout', { token }),
};

export function cloudMessage(code: string): string {
  if (code.startsWith('IC_LOCKED')) {
    const n = Number(code.split(':')[1] || 15);
    const t = n >= 60 ? `${Math.round(n / 60)} ساعة` : `${n} دقيقة`;
    return `تم إيقاف الدخول مؤقتاً بعد 5 محاولات خاطئة. حاول بعد ${t}.`;
  }
  if (code.startsWith('IC_INVALID')) {
    const left = Number(code.split(':')[1]);
    return Number.isFinite(left) && left > 0
      ? `الرمز السري غير صحيح. بقيت ${left} ${left === 1 ? 'محاولة' : 'محاولات'} قبل الإيقاف المؤقت.`
      : 'الرمز السري غير صحيح.';
  }
  switch (code) {
    case 'IC_EXISTS': return 'تم تعيين رمز سري لهذا التطبيق من قبل. أدخل الرمز للدخول.';
    case 'IC_NO_ACCOUNT': return 'لم يُعيَّن رمز سري بعد. عيّن رمزاً جديداً.';
    case 'IC_PIN_FORMAT': return 'الرمز السري من 6 إلى 8 أرقام.';
    case 'IC_SESSION': return 'انتهت جلسة الحفظ السحابي على هذا الجهاز. سجّل الدخول من جديد.';
    case 'NETWORK': return 'لا يوجد اتصال بالإنترنت. خططك محفوظة على الجهاز وستُرفع تلقائياً عند عودة الاتصال.';
    case 'IC_TOO_BIG': return 'إحدى الخطط كبيرة جداً للحفظ السحابي.';
    default: return 'تعذّر الاتصال بالحفظ السحابي. حاول مرة أخرى بعد قليل.';
  }
}
