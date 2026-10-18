import { useMemo, useState } from 'react';
import { createPlan, markPastInstallmentsPaid, summarize } from '../lib/engine';
import { addMonths, formatDateLong, todayISO } from '../lib/dates';
import type { Mode, PlanInput, SchedulingMethod } from '../lib/types';
import { useApp } from '../store';
import { go } from '../router';
import { Button, Card, CardTitle, Field, MoneyInput, Notice, Pill, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';

export function NewPlan() {
  const { unit, upsertPlan, updateSettings, toast } = useApp();
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState<number | null>(null);
  const [firstDate, setFirstDate] = useState(todayISO());
  const [mode, setMode] = useState<Mode>('fixed');
  const [method, setMethod] = useState<SchedulingMethod>('months');
  const [months, setMonths] = useState('12');
  const [endDate, setEndDate] = useState(addMonths(todayISO(), 11));
  const [fixedAmount, setFixedAmount] = useState<number | null>(null);
  const [down, setDown] = useState<number | null>(null);
  const [useFixedStart, setUseFixedStart] = useState(false);
  const [fixedStart, setFixedStart] = useState(addMonths(todayISO(), 1));
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const [startedBefore, setStartedBefore] = useState(false);
  const [paidBefore, setPaidBefore] = useState<string | null>(null);

  const input: PlanInput = {
    name, principal: principal ?? 0, firstDate, mode, method,
    months: Number(months), endDate, fixedAmount: fixedAmount ?? 0,
    fixedStartDate: mode === 'fixed' && useFixedStart ? fixedStart : null,
    downPayment: down ?? 0, notes,
  };
  const base = useMemo(() => createPlan(input, unit), [JSON.stringify(input), unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = todayISO();
  const isPastStart = firstDate < today;
  const pastCount = base.ok ? base.value.installments.filter((r) => r.dueDate < today).length : 0;
  const paidN = Math.max(0, Math.min(base.ok ? base.value.installments.length : 0, paidBefore == null ? pastCount : Number(paidBefore) || 0));
  const result = useMemo(() => {
    if (!base.ok || !isPastStart || !startedBefore || paidN === 0) return base;
    const r = markPastInstallmentsPaid(base.value, { count: paidN }, unit);
    return r.ok ? r : base;
  }, [base, isPastStart, startedBefore, paidN, unit]);
  const preview = result.ok ? result.value : null;
  const s = preview ? summarize(preview) : null;
  const showError = !result.ok && (touched || (principal != null && (mode !== 'fixed' || fixedAmount != null)));

  async function submit() {
    setTouched(true);
    if (!result.ok) { toast(result.error, 'error'); return; }
    const saved = await upsertPlan(result.value);
    if (saved) {
      await updateSettings({ activePlanId: result.value.id });
      toast('تم إنشاء الخطة وحفظها.');
      go(`/plan/${result.value.id}`);
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_400px] gap-4 items-start">
      <Card className="p-4 sm:p-5">
        <CardTitle icon="plus">إنشاء خطة تقسيط جديدة</CardTitle>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <Field label="اسم الخطة" htmlFor="name" hint="مثال: سيارة، أثاث المنزل، رسوم الدراسة">
            <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="خطة جديدة" maxLength={60} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="المبلغ الإجمالي المطلوب سداده" htmlFor="principal">
              <MoneyInput id="principal" value={principal} onChange={(v) => setPrincipal(v)} invalid={touched && !(principal && principal > 0)} />
            </Field>
            <Field label="تاريخ أول قسط" htmlFor="firstDate">
              <input id="firstDate" type="date" className="field" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} />
            </Field>
          </div>
          {isPastStart && (
            <div className="rounded-2xl border border-line bg-card-2 p-3 grid gap-2.5">
              <label className="flex items-start gap-2.5 font-semibold text-[14px] cursor-pointer">
                <input type="checkbox" className="size-5 mt-0.5 accent-[var(--teal)]" checked={startedBefore} onChange={(e) => setStartedBefore(e.target.checked)} />
                <span>بدأت هذه الخطة سابقاً وسدّدت أقساطاً قبل إدخالها<br /><span className="text-muted text-[12.5px] font-normal">تُسجَّل الأقساط المختارة كمدفوعة بتاريخ استحقاق كل منها، ويمكنك تعديل أي دفعة لاحقاً.</span></span>
              </label>
              {startedBefore && (
                <Field label="عدد الأقساط المسدَّدة سابقاً" htmlFor="paidBefore" hint={`حلّ موعد ${pastCount} ${pastCount === 1 ? 'قسط' : 'أقساط'} حتى اليوم.`}>
                  <input id="paidBefore" className="field num text-left !w-32" inputMode="numeric" value={paidBefore ?? String(pastCount)}
                    onChange={(e) => setPaidBefore(e.target.value.replace(/[^\d٠-٩]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)))} />
                </Field>
              )}
            </div>
          )}

          <Field label="طريقة حساب القسط">
            <Segmented ariaLabel="طريقة حساب القسط" value={mode} onChange={setMode} options={[
              { value: 'fixed', label: 'تثبيت القسط الشهري' },
              { value: 'flexible', label: 'قسط مرن' },
              { value: 'custom', label: 'أقساط مخصّصة' },
            ]} />
          </Field>
          <p className="text-[13px] text-muted -mt-2 leading-relaxed">
            {mode === 'fixed' && 'تحدد مبلغ القسط الشهري، والتطبيق يحسب عدد الأقساط والقسط الأخير وتاريخ الانتهاء.'}
            {mode === 'flexible' && 'يُقسَم المبلغ بالتساوي، ويمكنك تعديل أي شهر فيُعاد توزيع الباقي على الأشهر اللاحقة.'}
            {mode === 'custom' && 'تبدأ بأقساط متساوية ثم تحدد مبلغ كل شهر يدوياً؛ القسط الأخير يسوّي أي فرق.'}
          </p>

          {mode === 'fixed' ? (
            <>
              <Field label="القسط الشهري الثابت" htmlFor="fixed" error={touched && !(fixedAmount && fixedAmount > 0) ? 'يجب أن يكون القسط الشهري أكبر من صفر.' : null}>
                <MoneyInput id="fixed" value={fixedAmount} onChange={(v) => setFixedAmount(v)} invalid={touched && !(fixedAmount && fixedAmount > 0)} />
              </Field>
              <label className="flex items-center gap-2.5 font-semibold text-[14px] cursor-pointer">
                <input type="checkbox" className="size-5 accent-[var(--teal)]" checked={useFixedStart} onChange={(e) => setUseFixedStart(e.target.checked)} />
                تبدأ الأقساط الثابتة بتاريخ مختلف عن تاريخ أول قسط
              </label>
              {useFixedStart && (
                <Field label="تاريخ بدء الأقساط الثابتة" htmlFor="fixedStart" hint="مفيد عند وجود دفعة أولى تُدفع في تاريخ أول قسط.">
                  <input id="fixedStart" type="date" className="field" value={fixedStart} onChange={(e) => setFixedStart(e.target.value)} />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="تحديد المدة">
                <Segmented ariaLabel="تحديد المدة" value={method} onChange={setMethod} options={[
                  { value: 'months', label: 'عدد الأشهر', icon: 'list' },
                  { value: 'endDate', label: 'تاريخ آخر قسط', icon: 'calendar' },
                ]} />
              </Field>
              {method === 'months' ? (
                <Field label="عدد الأشهر" htmlFor="months">
                  <input id="months" className="field num text-left" inputMode="numeric" value={months}
                    onChange={(e) => setMonths(e.target.value.replace(/[^\d٠-٩]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)))} />
                </Field>
              ) : (
                <Field label="تاريخ آخر قسط" htmlFor="endDate" hint="يُحسب عدد الأشهر شاملاً شهر أول قسط وشهر آخر قسط.">
                  <input id="endDate" type="date" className="field" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
              )}
            </>
          )}

          <Field label="دفعة أولى (اختياري)" htmlFor="down" hint="تُسجَّل كدفعة فعلية بتاريخ أول قسط وتُخصم من المبلغ قبل التقسيط.">
            <MoneyInput id="down" value={down} onChange={(v) => setDown(v)} placeholder="0" />
          </Field>
          <Field label="ملاحظات (اختياري)" htmlFor="notes">
            <textarea id="notes" className="field min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>

          {showError && !result.ok && <Notice tone="rose">{result.error}</Notice>}
          <div className="flex gap-2 justify-end">
            <Button onClick={() => history.back()}>إلغاء</Button>
            <Button variant="primary" type="submit" icon={<Icon name="check" size={18} />}>حفظ الخطة</Button>
          </div>
        </form>
      </Card>

      <Card className="p-4 sm:p-5 lg:sticky lg:top-20">
        <CardTitle icon="calendar" actions={preview && <Pill tone="blue">معاينة فورية</Pill>}>نتيجة الحساب</CardTitle>
        {!preview || !s ? (
          <p className="text-muted text-[14px] leading-relaxed">أدخل المبلغ و{mode === 'fixed' ? 'القسط الشهري' : 'المدة'} لترى الجدول وتاريخ الانتهاء فوراً.</p>
        ) : (
          <div className="grid gap-3">
            <dl className="grid grid-cols-2 gap-2.5">
              <Stat label="عدد الأقساط" value={<span className="num">{s.durationMonths}</span>} sub="شهر" />
              <Stat label="تاريخ آخر قسط" value={s.expectedEnd ? formatDateLong(s.expectedEnd) : '—'} />
              <Stat label={mode === 'fixed' ? 'القسط المنتظم' : 'القسط الشهري'} value={<Money value={s.regular} />} />
              <Stat label="القسط الأخير (التسوية)" value={<Money value={s.finalAmount} />} tone={s.finalAmount !== s.regular ? 'violet' : undefined} />
              {mode === 'fixed' && <Stat label="أقساط كاملة" value={<span className="num">{s.fullInstallments}</span>} />}
              <Stat label="إجمالي المبلغ" value={<Money value={preview.principal} />} />
              {(down ?? 0) > 0 && <Stat label="بعد الدفعة الأولى" value={<Money value={s.outstanding} />} />}
              {s.paidCount > 0 && startedBefore && <Stat label="المسدَّد سابقاً" value={<><span className="num">{s.paidCount}</span> <span className="text-[12px] text-muted">قسط</span> · <Money value={s.totalPaid} /></>} />}
            </dl>
            {mode === 'fixed' && s.durationMonths > 1 && (
              <Notice tone="violet" icon="flag">
                {s.fullInstallments === s.durationMonths
                  ? <>جميع الأقساط متساوية: <span className="num">{s.durationMonths}</span> × <Money value={s.regular} /></>
                  : <><span className="num">{s.durationMonths - 1}</span> أقساط × <Money value={s.regular} /> ثم قسط أخير <Money value={s.finalAmount} /></>}
              </Notice>
            )}
            <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
              <table className="w-full text-[13px]">
                <thead className="bg-card-2 sticky top-0"><tr className="text-muted"><th className="p-2 text-right">#</th><th className="p-2 text-right">التاريخ</th><th className="p-2 text-left">القسط</th></tr></thead>
                <tbody>
                  {preview.installments.map((r, i) => (
                    <tr key={r.id} className={`border-t border-line ${r.closed ? 'bg-teal-bg/50' : i === preview.installments.length - 1 ? 'bg-violet-bg/60 font-bold' : ''}`}>
                      <td className="p-2 num">{r.closed ? <span className="text-teal">✓ {i + 1}</span> : i + 1}</td>
                      <td className="p-2 num">{r.dueDate.replace(/-/g, '/')}</td>
                      <td className="p-2 text-left"><Money value={r.planned} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'violet' }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'violet' ? 'bg-violet-bg border-transparent' : 'bg-card-2 border-line'}`}>
      <dt className="text-[12px] font-bold text-muted">{label}</dt>
      <dd className="font-extrabold text-[16px] mt-0.5">{value} {sub && <span className="text-[12px] text-muted font-bold">{sub}</span>}</dd>
    </div>
  );
}
