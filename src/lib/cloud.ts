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
  if (data && typeof data === 'object' && typeof data.error === 'string') throw new CloudError(data.error);
  return data as T;
}

export interface Session { token: string; username: string }

export const cloud = {
  register: (username: string, pin: string) => call<Session>('register', { username, pin }),
  login: (username: string, pin: string) => call<Session>('login', { username, pin }),
  sync: (token: string, changes: Change[], since: number) => call<{ cursor: number; plans: RemoteRow[] }>('sync', { token, changes, since }),
  logout: (token: string) => call<null>('logout', { token }),
};

export function cloudMessage(code: string): string {
  if (code.startsWith('IC_LOCKED')) {
    const n = Number(code.split(':')[1] || 15);
    return `تم إيقاف الدخول مؤقتاً بعد 5 محاولات خاطئة. حاول بعد ${n} دقيقة.`;
  }
  switch (code) {
    case 'IC_TAKEN': return 'اسم المستخدم مستخدم من قبل. اختر اسماً آخر، أو اختر «لدي حساب» إذا كان حسابك.';
    case 'IC_USERNAME': return 'اسم المستخدم من 3 إلى 40 حرفاً.';
    case 'IC_PIN_FORMAT': return 'الرمز السري من 4 إلى 8 أرقام.';
    case 'IC_INVALID': return 'اسم المستخدم أو الرمز السري غير صحيح.';
    case 'IC_SESSION': return 'انتهت جلسة الحفظ السحابي على هذا الجهاز. سجّل الدخول من جديد.';
    case 'NETWORK': return 'لا يوجد اتصال بالإنترنت. خططك محفوظة على الجهاز وستُرفع تلقائياً عند عودة الاتصال.';
    case 'IC_TOO_BIG': return 'إحدى الخطط كبيرة جداً للحفظ السحابي.';
    default: return 'تعذّر الاتصال بالحفظ السحابي. حاول مرة أخرى بعد قليل.';
  }
}
