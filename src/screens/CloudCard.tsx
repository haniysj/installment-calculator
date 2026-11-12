import { useEffect, useState } from 'react';
import { cloud } from '../lib/cloud';
import { formatDateShort } from '../lib/dates';
import { useApp, type SyncStatus } from '../store';
import { Button, Card, CardTitle, Field, Notice } from '../components/ui';
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

/** Cloud saving with a secret code only: set it once, then enter it on any device. */
export function CloudCard() {
  const { cloudState, connectCloud, disconnectCloud, syncNow, confirm, toast, plans, online } = useApp();
  // null = checking, undefined = could not check (offline)
  const [exists, setExists] = useState<boolean | null | undefined>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = cloudState.status !== 'off';
  const st = STATUS[cloudState.status];

  const check = () => {
    setExists(null);
    cloud.status().then((r) => setExists(!!r?.exists)).catch(() => setExists(undefined));
  };
  useEffect(() => { if (!on) check(); }, [on, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const digits = (v: string) => v.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, '').slice(0, 8);
  const setup = exists === false;
  const pinErr = pin.length > 0 && pin.length < 6 ? 'الرمز من 6 إلى 8 أرقام.' : null;
  const matchErr = setup && pin2.length > 0 && pin2 !== pin ? 'الرمزان غير متطابقين.' : null;
  const ready = pin.length >= 6 && (!setup || pin2 === pin);

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const err = await connectCloud(setup ? 'setup' : 'unlock', pin);
    setBusy(false);
    if (err) {
      setError(err);
      if (err.includes('من قبل')) check(); // someone set a code meanwhile → switch to "enter code"
      return;
    }
    setPin(''); setPin2('');
    toast(setup ? 'تم تعيين الرمز السري وتفعيل الحفظ السحابي.' : 'تم الدخول واسترجاع خططك.');
  }

  async function signOut() {
    if (!(await confirm({
      title: 'إيقاف الحفظ السحابي على هذا الجهاز؟',
      body: 'تبقى الخطط على هذا الجهاز وفي الحفظ السحابي، لكن التغييرات الجديدة هنا لن تُرفع حتى تُدخل الرمز مرة أخرى.',
      confirmText: 'إيقاف', danger: true,
    }))) return;
    await disconnectCloud();
    toast('تم إيقاف الحفظ السحابي على هذا الجهاز.');
  }

  const pinInput = (id: string, value: string, set: (v: string) => void, auto: string) => (
    <input id={id} className="field num text-center text-[22px] tracking-[0.5em]" type="password" inputMode="numeric" autoComplete={auto}
      maxLength={8} value={value} onChange={(e) => set(digits(e.target.value))} />
  );

  return (
    <Card className="p-4 sm:p-5 lg:col-span-2">
      <CardTitle icon="cloud" actions={
        <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-bold ${st.tone}`}><span className={`size-2 rounded-full ${st.dot}`} />{st.text}</span>
      }>الحفظ السحابي</CardTitle>

      {on ? (
        <div className="grid gap-3">
          <dl className="grid grid-cols-2 gap-2 text-[13px]">
            <div className="rounded-xl bg-card-2 border border-line px-3 py-2"><dt className="text-muted font-bold text-[12px]">الخطط</dt><dd className="font-extrabold num">{plans.length}</dd></div>
            <div className="rounded-xl bg-card-2 border border-line px-3 py-2"><dt className="text-muted font-bold text-[12px]">آخر حفظ</dt><dd className="font-extrabold num">{timeOf(cloudState.lastSyncAt)}</dd></div>
          </dl>
          {cloudState.error && <Notice tone={cloudState.status === 'offline' ? 'saffron' : 'rose'}>{cloudState.error}</Notice>}
          <p className="text-[13px] text-muted leading-relaxed">كل تعديل يُحفظ على الجهاز فوراً ويُرفع تلقائياً. على جهاز آخر افتح «الحفظ» وأدخل نفس الرمز السري فتظهر خططك.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Icon name="refresh" size={17} />} disabled={cloudState.status === 'syncing'} onClick={() => syncNow()}>حفظ الآن</Button>
            <Button variant="danger" className="ms-auto" icon={<Icon name="x" size={16} />} onClick={signOut}>إيقاف على هذا الجهاز</Button>
          </div>
        </div>
      ) : exists === null ? (
        <p className="text-muted text-[14px] py-3" role="status">جارٍ التحقق…</p>
      ) : exists === undefined ? (
        <div className="grid gap-3">
          <Notice tone="saffron">لا يمكن الوصول للحفظ السحابي الآن. تأكد من الاتصال بالإنترنت.</Notice>
          <div><Button icon={<Icon name="refresh" size={16} />} onClick={check}>إعادة المحاولة</Button></div>
        </div>
      ) : (
        <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {cloudState.error && <Notice tone="rose">{cloudState.error}</Notice>}
          {setup
            ? <Notice tone="saffron" icon="info">خططك الآن محفوظة على هذا الجهاز فقط. عيّن رمزاً سرياً لتفعيل الحفظ السحابي، وبه تسترجع خططك على أي جهاز.</Notice>
            : <p className="text-[13.5px] text-ink-2 leading-relaxed">أدخل الرمز السري لتفعيل الحفظ السحابي على هذا الجهاز واسترجاع خططك.</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={setup ? 'رمز سري جديد (6–8 أرقام)' : 'الرمز السري'} htmlFor="cl-pin" error={pinErr}>
              {pinInput('cl-pin', pin, setPin, setup ? 'new-password' : 'current-password')}
            </Field>
            {setup && (
              <Field label="تأكيد الرمز السري" htmlFor="cl-pin2" error={matchErr}>
                {pinInput('cl-pin2', pin2, setPin2, 'new-password')}
              </Field>
            )}
          </div>
          {error && <Notice tone="rose">{error}</Notice>}
          {!setup && plans.length > 0 && <p className="text-[12.5px] text-muted">الخطط الموجودة على هذا الجهاز ({plans.length}) ستُضاف للحفظ السحابي ولن تُحذف.</p>}
          {setup && <p className="text-[12.5px] text-muted">احفظ الرمز في مكان آمن؛ لا يمكن استرجاعه إذا نُسي. 5 محاولات خاطئة توقف الدخول مؤقتاً (15 دقيقة، وتتضاعف مع التكرار).</p>}
          <div className="flex">
            <Button type="submit" variant="primary" disabled={!ready || busy} icon={<Icon name="cloud" size={17} />}>
              {busy ? 'جارٍ الاتصال…' : setup ? 'تعيين الرمز وتفعيل الحفظ' : 'دخول'}
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
