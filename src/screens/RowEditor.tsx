import { useState } from 'react';
import {
  changeInstallmentDate, deleteInstallment, dueOf, editInstallment, maxPlannedFor, paidFor, postponeInstallment,
  recordPayment, rowStatus, setInstallmentNote, skipInstallment, unskipInstallment, type FollowMode,
} from '../lib/engine';
import { formatDateLong, todayISO } from '../lib/dates';
import type { Installment, Plan } from '../lib/types';
import { useApp } from '../store';
import { go } from '../router';
import { Button, Field, Modal, MoneyInput, Notice, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';
import { StatusPill } from '../components/Status';

type Tab = 'pay' | 'edit' | 'more';

export function RowEditor({ plan, row, onClose, onRun }: { plan: Plan; row: Installment; onClose: () => void; onRun: (r: any) => Promise<boolean> }) {
  const { unit, confirm, upsertPlan, toast } = useApp();
  const index = plan.installments.findIndex((r) => r.id === row.id);
  const paid = paidFor(plan, row.id);
  const due = dueOf(plan, row);
  const open = !row.closed && !row.skipped;
  const status = rowStatus(plan, row, todayISO());
  const [tab, setTab] = useState<Tab>(open ? (row.cancelled ? 'edit' : 'pay') : 'more');

  const [amount, setAmount] = useState<number | null>(due || null);
  const [date, setDate] = useState(todayISO());
  const [closeRow, setCloseRow] = useState(false);
  const [planned, setPlanned] = useState<number | null>(row.planned);
  const defaultFollow: FollowMode = plan.mode === 'flexible' ? 'equal' : 'keep';
  const [follow, setFollow] = useState<FollowMode>(defaultFollow);
  const [dueDate, setDueDate] = useState(row.dueDate);
  const [note, setNote] = useState(row.note);
  const max = maxPlannedFor(plan, index);

  const payErr = amount == null ? 'أدخل المبلغ.' : amount <= 0 ? 'المبلغ يجب أن يكون أكبر من صفر.' : null;
  const editErr = planned == null ? 'أدخل المبلغ.' : planned < 0 ? 'لا يمكن أن يكون القسط سالباً.'
    : planned > max ? 'القسط يتجاوز الرصيد المتبقي.' : planned < paid ? 'أقل مما دُفع من هذا القسط.' : null;

  async function done(r: any) { if (await onRun(r)) onClose(); }

  const isPartial = amount != null && amount > 0 && amount < due;
  const isOver = amount != null && amount > due;

  return (
    <Modal open onClose={onClose} wide title={<span>القسط <span className="num">{index + 1}</span> — {formatDateLong(row.dueDate)}</span>}>
      <div className="grid gap-4">
        <div className="grid grid-cols-3 gap-2 text-center text-[12.5px]">
          <div className="rounded-xl bg-card-2 border border-line p-2"><div className="text-muted font-bold">المخطط</div><div className="font-extrabold text-[15px]"><Money value={row.planned} /></div></div>
          <div className="rounded-xl bg-teal-bg/60 border border-line p-2"><div className="text-muted font-bold">المدفوع</div><div className="font-extrabold text-[15px] text-teal"><Money value={paid} /></div></div>
          <div className="rounded-xl bg-saffron-bg/60 border border-line p-2"><div className="text-muted font-bold">المستحق</div><div className="font-extrabold text-[15px] text-saffron"><Money value={due} /></div></div>
        </div>
        <div className="flex items-center gap-2"><span className="text-[13px] font-bold text-muted">الحالة:</span><StatusPill entry={{ status, overdue: open && row.dueDate < todayISO() }} /></div>

        {open && (
          <Segmented ariaLabel="نوع الإجراء" value={tab} onChange={setTab} options={[
            { value: 'pay', label: 'تسجيل دفعة', icon: 'wallet' },
            { value: 'edit', label: 'تعديل المبلغ', icon: 'edit' },
            { value: 'more', label: 'المزيد', icon: 'more' },
          ]} />
        )}

        {open && tab === 'pay' && (
          <div className="grid gap-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="المبلغ المدفوع فعلياً" htmlFor="re-amt" error={payErr}>
                <MoneyInput id="re-amt" value={amount} onChange={setAmount} invalid={!!payErr} autoFocus />
              </Field>
              <Field label="تاريخ الدفع" htmlFor="re-date">
                <input id="re-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            {isPartial && (
              <label className="flex items-start gap-2.5 text-[13.5px] font-semibold cursor-pointer">
                <input type="checkbox" className="size-5 mt-0.5 accent-[var(--teal)]" checked={closeRow} onChange={(e) => setCloseRow(e.target.checked)} />
                <span>إغلاق القسط وترحيل الفرق (<Money value={due - (amount ?? 0)} />) إلى الأقساط اللاحقة<br />
                  <span className="text-muted text-[12.5px]">بدون ذلك يبقى القسط مفتوحاً بالمبلغ المتبقي.</span></span>
              </label>
            )}
            {isOver && <Notice tone="blue">المبلغ أكبر من المستحق؛ الزيادة (<Money value={(amount ?? 0) - due} />) تُخصم من الأقساط اللاحقة.</Notice>}
            <div className="flex flex-wrap gap-2 justify-end">
              <Button onClick={() => go(`/plan/${plan.id}/payments?row=${row.id}`)} icon={<Icon name="receipt" size={16} />}>شاشة الدفعات</Button>
              <Button variant="success" icon={<Icon name="check" size={18} />} disabled={!!payErr}
                onClick={() => done(recordPayment(plan, { date, amount: amount!, kind: 'installment', installmentId: row.id, closeRow }, unit))}>
                {amount === due ? 'تسجيل كمدفوع' : 'تسجيل الدفعة'}
              </Button>
            </div>
          </div>
        )}

        {open && tab === 'edit' && (
          <div className="grid gap-3">
            <Field label="مبلغ هذا القسط" htmlFor="re-plan" error={editErr} hint={<>الحد الأقصى: <Money value={max} /> (الرصيد قبل هذا القسط)</>}>
              <MoneyInput id="re-plan" value={planned} onChange={setPlanned} invalid={!!editErr} autoFocus />
            </Field>
            <Field label="الأقساط اللاحقة">
              <div className="grid gap-1.5">
                {([
                  ['equal', 'توزيع المتبقي بالتساوي على الأشهر اللاحقة'],
                  ['fixed', 'تثبيت هذا المبلغ لجميع الأشهر اللاحقة'],
                  ['keep', plan.strategy === 'fixed' ? 'حسب الخطة: إبقاء القسط الثابت وتعديل المدة' : plan.strategy === 'last' ? 'حسب الخطة: تسوية الفرق في القسط الأخير' : 'حسب الخطة: توزيع بالتساوي'],
                ] as [FollowMode, string][]).filter(([v]) => !(v === 'keep' && plan.strategy === 'equal')).map(([v, label]) => (
                  <label key={v} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer text-[14px] font-semibold ${follow === v ? 'border-ink-2 bg-card-2' : 'border-line'}`}>
                    <input type="radio" name="follow" className="size-4 accent-[var(--ink)]" checked={follow === v} onChange={() => setFollow(v)} />{label}
                  </label>
                ))}
              </div>
            </Field>
            <p className="text-[12.5px] text-muted">الأقساط السابقة لهذا القسط لا تتغير. أي فرق تقريب يُسوّى في القسط الأخير.</p>
            <div className="flex justify-end">
              <Button variant="primary" disabled={!!editErr} icon={<Icon name="check" size={18} />}
                onClick={() => done(editInstallment(plan, row.id, planned!, follow, unit))}>حفظ وإعادة الحساب</Button>
            </div>
          </div>
        )}

        {tab === 'more' && (
          <div className="grid gap-3">
            {open && (
              <Field label="تاريخ الدفع المخطط" htmlFor="re-due">
                <div className="flex gap-2">
                  <input id="re-due" type="date" className="field" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  <Button disabled={dueDate === row.dueDate || !dueDate} onClick={() => done(changeInstallmentDate(plan, row.id, dueDate))}>حفظ</Button>
                </div>
              </Field>
            )}
            <Field label="ملاحظة" htmlFor="re-note">
              <div className="flex gap-2">
                <input id="re-note" className="field" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                <Button disabled={note === row.note} onClick={async () => { if (await upsertPlan(setInstallmentNote(plan, row.id, note))) { toast('تم حفظ الملاحظة.'); onClose(); } }}>حفظ</Button>
              </div>
            </Field>
            <div className="grid sm:grid-cols-3 gap-2">
              {open && <Button icon={<Icon name="clock" size={17} />} onClick={() => done(postponeInstallment(plan, row.id))}>تأجيل شهراً</Button>}
              {open && paid === 0 && !row.cancelled && <Button icon={<Icon name="skip" size={17} />} onClick={async () => {
                if (await confirm({ title: 'تخطي هذا القسط؟', body: 'قيمة القسط تُضاف إلى الأقساط اللاحقة حسب طريقة الخطة.', confirmText: 'تخطي' })) done(skipInstallment(plan, row.id, unit));
              }}>تخطي القسط</Button>}
              {row.skipped && <Button icon={<Icon name="refresh" size={17} />} onClick={() => done(unskipInstallment(plan, row.id, unit))}>إلغاء التخطي</Button>}
              {open && paid === 0 && <Button variant="danger" icon={<Icon name="trash" size={17} />} onClick={async () => {
                if (await confirm({ title: 'حذف هذا القسط؟', body: 'يُحذف القسط غير المدفوع وتُعاد توزيع قيمته.', confirmText: 'حذف', danger: true })) done(deleteInstallment(plan, row.id, unit));
              }}>حذف القسط</Button>}
            </div>
            {row.closed && (
              <Notice tone="teal" icon="check">هذا القسط مدفوع. لتعديله احذف دفعته من <button className="underline font-bold" onClick={() => go(`/plan/${plan.id}/payments`)}>سجل الدفعات</button>.</Notice>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
