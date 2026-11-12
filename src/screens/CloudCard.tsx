import { useState } from 'react';
import { formatDateShort } from '../lib/dates';
import { useApp, type SyncStatus } from '../store';
import { Button, Card, CardTitle, Field, Notice, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';

const STATUS: Record<SyncStatus, { text: string; tone: string; dot: string }> = {
  off: { text: 'غير مفعّل', tone: 'text-muted', dot: 'bg-muted' },
  syncing: { text: 'جارٍ الحفظ…', tone: 'text-brand', dot: 'bg-brand animate-pulse' },
  synced: { text: 'محفوظ سحابياً', tone: 'text-teal', dot: 'bg-teal' },
  pending: { text: 'بانتظار الرفع', tone: 'text-saffron', dot: 'bg-saffron-strong' },
  offline: { text: 'بدون إنترنت — سيُرفع لاحقاً', tone: 'text-saffron', dot: 'bg-saffron-strong' },
  error: { text: 'تعذّر الحفظ السحابي', tone: 'text-rose', dot: 'bg-rose' },
};

function timeOf(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${formatDateShort(local)} ${hh}:${mm}`;
}

/** Cloud saving: create an account or sign in, then every change is saved online automatically. */
export function CloudCard() {
  const { cloudState, connectCloud, disconnectCloud, syncNow, confirm, toast, plans } = useApp();
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = cloudState.status !== 'off';
  const st = STATUS[cloudState.status];

  const digits = (v: string) => v.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, '').slice(0, 8);
  const userErr = username.trim().length > 0 && username.trim().length < 3 ? 'اسم المستخدم 3 أحرف على الأقل.' : null;
  const pinErr = pin.length > 0 && pin.length < 4 ? 'الرمز من 4 إلى 8 أرقام.' : null;
  const matchErr = mode === 'register' && pin2.length > 0 && pin2 !== pin ? 'الرمزان غير متطابقين.' : null;
  const ready = username.trim().length >= 3 && pin.length >= 4 && (mode === 'login' || pin2 === pin);

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const err = await connectCloud(mode, username.trim(), pin);
    setBusy(false);
    if (err) { setError(err); return; }
    setPin(''); setPin2('');
    toast(mode === 'register' ? 'تم إنشاء الحساب وتفعيل الحفظ السحابي.' : 'تم تسجيل الدخول واسترجاع خططك.');
  }

  async function signOut() {
    if (!(await confirm({
      title: 'إيقاف الحفظ السحابي على هذا الجهاز؟',
      body: 'تبقى الخطط على هذا الجهاز وفي حسابك السحابي، لكن التغييرات الجديدة هنا لن تُرفع حتى تسجّل الدخول مرة أخرى.',
      confirmText: 'تسجيل الخروج', danger: true,
    }))) return;
    await disconnectCloud();
    toast('تم إيقاف الحفظ السحابي على هذا الجهاز.');
  }

  return (
    <Card className="p-4 sm:p-5 lg:col-span-2">
      <CardTitle icon="cloud" actions={
        <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-bold ${st.tone}`}><span className={`size-2 rounded-full ${st.dot}`} />{st.text}</span>
      }>الحفظ السحابي</CardTitle>

      {on ? (
        <div className="grid gap-3">
          <dl className="grid grid-cols-2 gap-2 text-[13px]">
            <div className="rounded-xl bg-card-2 border border-line px-3 py-2"><dt className="text-muted font-bold text-[12px]">الحساب</dt><dd className="font-extrabold break-words">{cloudState.username}</dd></div>
            <div className="rounded-xl bg-card-2 border border-line px-3 py-2"><dt className="text-muted font-bold text-[12px]">آخر حفظ</dt><dd className="font-extrabold num">{timeOf(cloudState.lastSyncAt)}</dd></div>
          </dl>
          {cloudState.error && <Notice tone={cloudState.status === 'offline' ? 'saffron' : 'rose'}>{cloudState.error}</Notice>}
          <p className="text-[13px] text-muted leading-relaxed">كل تعديل يُحفظ على الجهاز فوراً ويُرفع لحسابك تلقائياً. على جهاز جديد سجّل الدخول بنفس الاسم والرمز فتظهر خططك.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Icon name="refresh" size={17} />} disabled={cloudState.status === 'syncing'} onClick={() => syncNow()}>حفظ الآن</Button>
            <Button variant="danger" className="ms-auto" icon={<Icon name="x" size={16} />} onClick={signOut}>تسجيل الخروج</Button>
          </div>
        </div>
      ) : (
        <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {cloudState.error && <Notice tone="rose">{cloudState.error}</Notice>}
          <Notice tone="saffron" icon="info">خططك الآن محفوظة على هذا الجهاز فقط، وقد تضيع إذا مُسحت بيانات المتصفح. فعّل الحفظ السحابي لتبقى محفوظة دائماً وتظهر على أي جهاز.</Notice>
          <Segmented ariaLabel="نوع الدخول" value={mode} onChange={(v) => { setMode(v); setError(null); }} options={[
            { value: 'register', label: 'حساب جديد' },
            { value: 'login', label: 'لدي حساب' },
          ]} />
          <Field label="اسم المستخدم" htmlFor="cl-user" error={userErr} hint={mode === 'register' ? 'اختر اسماً تتذكره (عربي أو إنجليزي)، مثل: hani' : undefined}>
            <input id="cl-user" className="field" autoComplete="username" value={username} maxLength={40} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="الرمز السري (4–8 أرقام)" htmlFor="cl-pin" error={pinErr}>
              <input id="cl-pin" className="field num text-left tracking-[0.3em]" type="password" inputMode="numeric" autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={pin} onChange={(e) => setPin(digits(e.target.value))} />
            </Field>
            {mode === 'register' && (
              <Field label="تأكيد الرمز السري" htmlFor="cl-pin2" error={matchErr}>
                <input id="cl-pin2" className="field num text-left tracking-[0.3em]" type="password" inputMode="numeric" autoComplete="new-password"
                  value={pin2} onChange={(e) => setPin2(digits(e.target.value))} />
              </Field>
            )}
          </div>
          {error && <Notice tone="rose">{error}</Notice>}
          {mode === 'login' && plans.length > 0 && <p className="text-[12.5px] text-muted">الخطط الموجودة على هذا الجهاز ({plans.length}) ستُضاف إلى حسابك ولن تُحذف.</p>}
          <p className="text-[12.5px] text-muted">احفظ الرمز في مكان آمن؛ لا يمكن استرجاعه إذا نُسي. بعد 5 محاولات خاطئة يُوقف الدخول 15 دقيقة.</p>
          <div className="flex">
            <Button type="submit" variant="primary" disabled={!ready || busy} icon={<Icon name="cloud" size={17} />}>
              {busy ? 'جارٍ الاتصال…' : mode === 'register' ? 'إنشاء الحساب وتفعيل الحفظ' : 'تسجيل الدخول'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Small status icon for the header; opens the save screen. */
export function CloudBadge() {
  const { cloudState } = useApp();
  const st = STATUS[cloudState.status];
  return (
    <a href="#/backup" aria-label={`الحفظ السحابي: ${st.text}`} title={st.text}
      className={`relative size-10 shrink-0 grid place-items-center rounded-full hover:bg-card ${cloudState.status === 'off' ? 'text-muted' : st.tone}`}>
      <Icon name="cloud" size={21} />
      <span className={`absolute bottom-1.5 left-1.5 size-2.5 rounded-full ring-2 ring-paper ${st.dot}`} />
    </a>
  );
}
