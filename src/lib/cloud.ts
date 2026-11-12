// Network calls to the cloud database (Supabase RPC). The publishable key is public by design;
// the tables are closed and only the ic_* functions can be called.
import type { Change, RemoteRow } from './sync';

const API = 'https://migrsxbrrjkfneogqwzl.supabase.co/rest/v1/rpc/';
const KEY = 'sb_publishable_tu_2J8GWpFKzO1rHPON9DQ_sllKD0tD';

export class CloudError extends Error {
  constructor(public code: string) { super(code); }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + fn, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new CloudError('NETWORK');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const msg: string = data?.message ?? '';
    const m = /IC_[A-Z_]+(?::\d+)?/.exec(msg);
    throw new CloudError(m ? m[0] : res.status >= 500 ? 'SERVER' : 'UNKNOWN');
  }
  if (data && typeof data === 'object' && typeof data.error === 'string') throw new CloudError(data.error);
  return data as T;
}

export interface Session { token: string; username: string }

export const cloud = {
  register: (username: string, pin: string) => rpc<Session>('ic_register', { p_username: username, p_pin: pin }),
  login: (username: string, pin: string) => rpc<Session>('ic_login', { p_username: username, p_pin: pin }),
  sync: (token: string, changes: Change[], since: number) =>
    rpc<{ cursor: number; plans: RemoteRow[] }>('ic_sync', { p_token: token, p_changes: changes, p_since: since }),
  logout: (token: string) => rpc<null>('ic_logout', { p_token: token }),
};

export function cloudMessage(code: string): string {
  if (code.startsWith('IC_LOCKED')) {
    const n = Number(code.split(':')[1] || 15);
    return `تم إيقاف الدخول مؤقتاً بعد 5 محاولات خاطئة. حاول بعد ${n} دقيقة.`;
  }
  switch (code) {
    case 'IC_TAKEN': return 'اسم المستخدم مستخدم من قبل. اختر اسماً آخر، أو استخدم «لدي حساب» إذا كان حسابك.';
    case 'IC_USERNAME': return 'اسم المستخدم من 3 إلى 40 حرفاً.';
    case 'IC_PIN_FORMAT': return 'الرمز السري من 4 إلى 8 أرقام.';
    case 'IC_INVALID': return 'اسم المستخدم أو الرمز السري غير صحيح.';
    case 'IC_SESSION': return 'انتهت جلسة الحفظ السحابي على هذا الجهاز. سجّل الدخول من جديد.';
    case 'NETWORK': return 'لا يوجد اتصال بالإنترنت. خططك محفوظة على الجهاز وستُرفع تلقائياً عند عودة الاتصال.';
    case 'IC_TOO_BIG': return 'إحدى الخطط كبيرة جداً للحفظ السحابي.';
    default: return 'تعذّر الاتصال بالحفظ السحابي. حاول مرة أخرى بعد قليل.';
  }
}
