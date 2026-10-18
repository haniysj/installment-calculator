import { useEffect, useMemo, useState } from 'react';
import { deletePayment, dueOf, installmentNumbers, outstanding, recordPayment, regularAmount, summarize } from '../lib/engine';
import { formatDateShort, todayISO } from '../lib/dates';
import { formatAmount } from '../lib/money';
import type { PaymentKind } from '../lib/types';
import { useApp } from '../store';
import { go } from '../router';
import { Button, Card, CardTitle, EmptyState, Field, MoneyInput, Notice, Pill, ProgressBar, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';

export function Payments({ id, installmentId }: { id: string; installmentId?: string }) {
  const { getPlan, apply, unit, confirm, settings } = useApp();
  const plan = getPlan(id);
  const openRows = useMemo(() => plan?.installments.map((r, i) => ({ r, i })).filter(({ r }) => !r.closed && !r.skipped && !r.cancelled) ?? [], [plan]);
  const [kind, setKind] = useState<PaymentKind>('installment');
  const [rowId, setRowId] = useState<string>(installmentId && openRows.some(({ r }) => r.id === installmentId) ? installmentId : openRows[0]?.r.id ?? '');
  const selRow = plan?.installments.find((r) => r.id === rowId);
  const [amount, setAmount] = useState<number | null>(plan && selRow ? dueOf(plan, selRow) : null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [closeRow, setCloseRow] = useState(false);
  const [extraStrategy, setExtraStrategy] = useState<'shorten' | 'reduce'>('shorten');

  // after each saved payment: stay on the row if still open (amount = what is left), else move to the next open row
  useEffect(() => {
    if (!plan) return;
    const cur = openRows.find(({ r }) => r.id === rowId)?.r ?? openRows[0]?.r;
    setRowId(cur?.id ?? '');
    if (kind === 'installment') setAmount(cur ? dueOf(plan, cur) : null);
  }, [plan, openRows]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan) return <Card className="p-4"><EmptyState icon="info" title="الخطة غير موجودة" action={<Button onClick={() => go('/plans')}>الخطط</Button>} /></Card>;
  const s = summarize(plan);
  const out = outstanding(plan);
  const due = selRow ? dueOf(plan, selRow) : 0;
  const err = amount == null ? null : amount <= 0 ? 'المبلغ يجب أن يكون أكبر من صفر.' : amount > out ? 'المبلغ يتجاوز الرصيد المتبقي.' : null;
  const history = [...plan.payments].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
  const nums = installmentNumbers(plan);
  const rowNo = (iid: string | null) => (iid ? nums.get(iid) ?? 0 : 0);

  async function submit() {
    if (amount == null || err) return;
    const ok = await apply(recordPayment(plan!, { date, amount, kind, installmentId: kind === 'installment' ? rowId : null, closeRow, extraStrategy, note }, unit));
    if (ok) {
      setNote(''); setCloseRow(false);
      if (kind !== 'installment') setAmount(null);
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_1fr] gap-4 items-start">
      <Card className="p-4 sm:p-5">
        <CardTitle icon="wallet" actions={<Button size="sm" onClick={() => go(`/plan/${plan.id}`)}>الجدول<Icon name="chevron" size={16} /></Button>}>تسجيل دفعة — {plan.name}</CardTitle>
        <div className="flex items-center gap-3 mb-1"><div className="flex-1"><ProgressBar value={s.progress} /></div><span className="num font-bold">{Math.round(s.progress)}%</span></div>
        <p className="text-[13px] text-muted mb-4">الرصيد المتبقي: <Money value={out} className="font-extrabold text-ink" /></p>
        {out <= 0 ? <Notice tone="teal" icon="check">تم سداد هذه الخطة بالكامل.</Notice> : (
          <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Field label="نوع الدفعة">
              <Segmented ariaLabel="نوع الدفعة" value={kind} onChange={(k) => { setKind(k); if (k !== 'installment') setAmount(null); }} options={[
                { value: 'installment', label: 'سداد قسط' },
                { value: 'extra', label: 'دفعة إضافية' },
                { value: 'down', label: 'دفعة أولى' },
              ]} />
            </Field>
            {kind === 'installment' ? (
              openRows.length === 0 ? <Notice tone="saffron">لا توجد أقساط مفتوحة. استخدم «دفعة إضافية».</Notice> : (
                <Field label="القسط" htmlFor="pay-row">
                  <select id="pay-row" className="field font-bold" value={rowId} onChange={(e) => {
                    setRowId(e.target.value);
                    const r = plan.installments.find((x) => x.id === e.target.value);
                    setAmount(r ? dueOf(plan, r) : null);
                  }}>
                    {openRows.map(({ r }) => (
                      <option key={r.id} value={r.id}>القسط {nums.get(r.id)} — {formatDateShort(r.dueDate)} — مستحق {formatAmount(dueOf(plan, r), settings.decimals)} ر.ع.</option>
                    ))}
                  </select>
                </Field>
              )
            ) : (
              <Field label={kind === 'down' ? 'بعد الدفعة الأولى' : 'بعد الدفعة الإضافية'}>
                <div className="grid gap-1.5">
                  <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer text-[14px] font-semibold ${extraStrategy === 'shorten' ? 'border-ink-2 bg-card-2' : 'border-line'}`}>
                    <input type="radio" name="es" className="size-4 mt-1 accent-[var(--ink)]" checked={extraStrategy === 'shorten'} onChange={() => setExtraStrategy('shorten')} />
                    <span>تثبيت القسط الشهري (<Money value={regularAmount(plan)} />) وتقصير المدة</span>
                  </label>
                  <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer text-[14px] font-semibold ${extraStrategy === 'reduce' ? 'border-ink-2 bg-card-2' : 'border-line'}`}>
                    <input type="radio" name="es" className="size-4 mt-1 accent-[var(--ink)]" checked={extraStrategy === 'reduce'} onChange={() => setExtraStrategy('reduce')} />
                    <span>تثبيت تاريخ الانتهاء وتخفيض الأقساط القادمة</span>
                  </label>
                </div>
              </Field>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="المبلغ المدفوع فعلياً" htmlFor="pay-amt" error={err}>
                <MoneyInput id="pay-amt" value={amount} onChange={setAmount} invalid={!!err} />
              </Field>
              <Field label="تاريخ الدفع" htmlFor="pay-date">
                <input id="pay-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            {kind === 'installment' && amount != null && amount > 0 && amount < due && (
              <label className="flex items-start gap-2.5 text-[13.5px] font-semibold cursor-pointer">
                <input type="checkbox" className="size-5 mt-0.5 accent-[var(--teal)]" checked={closeRow} onChange={(e) => setCloseRow(e.target.checked)} />
                <span>دفعة جزئية: إغلاق القسط وترحيل الفرق (<Money value={due - amount} />) للأقساط اللاحقة</span>
              </label>
            )}
            <Field label="ملاحظة (اختياري)" htmlFor="pay-note">
              <input id="pay-note" className="field" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="مثال: تحويل بنكي" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="success" disabled={amount == null || !!err || (kind === 'installment' && !rowId)} icon={<Icon name="check" size={18} />}>حفظ الدفعة</Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle icon="receipt" actions={<Pill tone="teal">المدفوع <Money value={s.totalPaid} /></Pill>}>سجل الدفعات الفعلية</CardTitle>
        {history.length === 0 ? <EmptyState icon="receipt" title="لا توجد دفعات مسجّلة" body="الأقساط المخططة لا تُعتبر مدفوعة حتى تُسجّل دفعتها هنا." /> : (
          <ul className="grid gap-2">
            {history.map((x) => (
              <li key={x.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <div className={`size-10 rounded-xl grid place-items-center shrink-0 ${x.kind === 'installment' ? 'bg-teal-bg text-teal' : 'bg-blue-bg text-blue'}`}>
                  <Icon name={x.kind === 'installment' ? 'check' : 'coins'} size={19} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold">{x.kind === 'installment' ? <>سداد القسط <span className="num">{rowNo(x.installmentId)}</span></> : x.kind === 'down' ? 'دفعة أولى' : 'دفعة إضافية'}</div>
                  <div className="text-[12.5px] text-muted"><span className="num">{formatDateShort(x.date)}</span>{x.note && <> — {x.note}</>}</div>
                </div>
                <div className="font-extrabold text-teal"><Money value={x.amount} /></div>
                <button aria-label="حذف الدفعة" className="size-9 grid place-items-center rounded-lg text-rose hover:bg-rose-bg"
                  onClick={async () => {
                    if (await confirm({ title: 'حذف هذه الدفعة؟', body: 'سيرتفع الرصيد المتبقي بقيمتها ويُعاد فتح القسط المرتبط بها إن لزم.', confirmText: 'حذف', danger: true }))
                      apply(deletePayment(plan, x.id, unit));
                  }}><Icon name="trash" size={18} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
