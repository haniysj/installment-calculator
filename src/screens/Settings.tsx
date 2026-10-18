import { useState } from 'react';
import { DEFAULT_SETTINGS } from '../lib/types';
import { formatAmount } from '../lib/money';
import { useApp } from '../store';
import { Button, Card, CardTitle, Field, Notice, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { RialSymbol } from '../components/Money';

export function SettingsScreen() {
  const { settings, updateSettings, installPrompt, clearInstallPrompt, plans, replacePlans, confirm, toast } = useApp();
  const [title, setTitle] = useState(settings.appTitle);
  const standalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;

  async function install() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const r = await installPrompt.userChoice;
    if (r?.outcome === 'accepted') toast('تم تثبيت التطبيق.');
    clearInstallPrompt();
  }
  async function wipe() {
    if (!(await confirm({ title: 'حذف جميع البيانات؟', body: `ستُحذف ${plans.length} خطة من هذا الجهاز.`, confirmText: 'متابعة', danger: true }))) return;
    if (!(await confirm({ title: 'تأكيد نهائي', body: 'لا يمكن التراجع. هل صدّرت نسخة احتياطية؟', confirmText: 'حذف الكل', danger: true }))) return;
    await replacePlans([]);
    await updateSettings({ activePlanId: null });
    toast('تم حذف جميع الخطط.');
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <Card className="p-4 sm:p-5">
        <CardTitle icon="settings">إعدادات التطبيق</CardTitle>
        <div className="grid gap-4">
          <Field label="المظهر">
            <Segmented ariaLabel="المظهر" value={settings.theme} onChange={(v) => updateSettings({ theme: v })} options={[
              { value: 'system', label: 'تلقائي' }, { value: 'light', label: 'فاتح', icon: 'sun' }, { value: 'dark', label: 'داكن', icon: 'moon' },
            ]} />
          </Field>
          <Field label="عرض العملة">
            <Segmented ariaLabel="عرض العملة" value={settings.currencyDisplay} onChange={(v) => updateSettings({ currencyDisplay: v })} options={[
              { value: 'symbol', label: <span className="text-[17px]"><RialSymbol bold /></span> },
              { value: 'text', label: 'ر.ع.' },
            ]} />
          </Field>
          <Field label="المنازل العشرية" hint={`الريال العُماني = 1000 بيسة. الحساب الداخلي دائماً بالبيسة. مثال: ${formatAmount(1250505, settings.decimals)}`}>
            <Segmented ariaLabel="المنازل العشرية" value={String(settings.decimals) as '0' | '2' | '3'} onChange={(v) => updateSettings({ decimals: Number(v) as 0 | 2 | 3 })} options={[
              { value: '0', label: 'بدون كسور' }, { value: '2', label: 'منزلتان' }, { value: '3', label: '3 (بيسة)' },
            ]} />
          </Field>
          <Field label="عنوان التطبيق" htmlFor="title">
            <div className="flex gap-2">
              <input id="title" className="field" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
              <Button disabled={!title.trim() || title === settings.appTitle} onClick={() => { updateSettings({ appTitle: title.trim() }); toast('تم حفظ العنوان.'); }}>حفظ</Button>
            </div>
          </Field>
          {settings.appTitle !== DEFAULT_SETTINGS.appTitle && (
            <button className="text-[13px] underline text-muted text-right" onClick={() => { setTitle(DEFAULT_SETTINGS.appTitle); updateSettings({ appTitle: DEFAULT_SETTINGS.appTitle }); }}>استعادة العنوان الافتراضي</button>
          )}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle icon="phone">تثبيت التطبيق</CardTitle>
        {standalone ? <Notice tone="teal" icon="check">التطبيق مثبّت ويعمل الآن كتطبيق مستقل.</Notice> : installPrompt ? (
          <Button variant="primary" icon={<Icon name="download" size={18} />} onClick={install}>تثبيت الآن</Button>
        ) : null}
        <div className="grid gap-3 mt-3 text-[14px] leading-relaxed text-ink-2">
          <div>
            <h3 className="font-bold text-ink flex items-center gap-1.5"><Icon name="phone" size={17} />أندرويد (Chrome)</h3>
            <ol className="list-decimal pr-5 mt-1">
              <li>افتح رابط التطبيق في Chrome.</li>
              <li>اضغط قائمة النقاط الثلاث ⋮ أعلى الشاشة.</li>
              <li>اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li>
            </ol>
          </div>
          <div>
            <h3 className="font-bold text-ink flex items-center gap-1.5"><Icon name="monitor" size={17} />ويندوز (Chrome أو Edge)</h3>
            <ol className="list-decimal pr-5 mt-1">
              <li>اضغط أيقونة التثبيت في شريط العنوان، أو القائمة ⋮ ← «تثبيت حاسبة التقسيط».</li>
              <li>يظهر التطبيق في قائمة ابدأ ويعمل في نافذة مستقلة.</li>
            </ol>
          </div>
          <Notice tone="blue">بعد أول فتح ناجح يعمل التطبيق بالكامل بدون إنترنت: الحساب والتعديل والحفظ وعرض الخطط.</Notice>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle icon="lock">الخصوصية والبيانات</CardTitle>
        <p className="text-[14px] text-ink-2 leading-relaxed mb-3">لا تسجيل دخول ولا خوادم: كل الخطط محفوظة في متصفح هذا الجهاز (IndexedDB). حذف بيانات المتصفح يحذفها، لذا احتفظ بنسخة احتياطية.</p>
        <Button variant="danger" icon={<Icon name="trash" size={17} />} onClick={wipe} disabled={plans.length === 0}>حذف جميع البيانات</Button>
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle icon="info">حول التطبيق</CardTitle>
        <p className="text-[14px] text-ink-2 leading-relaxed">{settings.appTitle} — الإصدار <span className="num">1.0.0</span>. بدون فوائد أو رسوم: كل المبالغ أصل الدين فقط.</p>
        <p className="text-[12.5px] text-muted mt-2">Prepared by: Hani Al Ghatrifi</p>
      </Card>
    </div>
  );
}
