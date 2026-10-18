import { useState } from 'react';
import { deletePayment, editPayment, installmentNo, totalPaid } from '../lib/engine';
import type { Plan } from '../lib/types';
import { useApp } from '../store';
import { Button, Field, Modal, MoneyInput, Notice } from '../components/ui';
import { Icon } from '../components/Icon';
import { Money } from '../components/Money';

const KIND_LABEL = { installment: 'سداد قسط', extra: 'دفعة إضافية', down: 'دفعة أولى' } as const;

/** Edit or delete a recorded (previous) payment: amount, date and note. */
export function PaymentEditor({ plan, paymentId, onClose }: { plan: Plan; paymentId: string; onClose: () => void }) {
  const { apply, unit, confirm } = useApp();
  const pay = plan.payments.find((x) => x.id === paymentId);
  const [amount, setAmount] = useState<number | null>(pay?.amount ?? null);
  const [date, setDate] = useState(pay?.date ?? '');
  const [note, setNote] = useState(pay?.note ?? '');
  if (!pay) return null;

  const max = plan.principal - (totalPaid(plan) - pay.amount);
  const err = amount == null ? 'أدخل المبلغ.' : amount <= 0 ? 'المبلغ يجب أن يكون أكبر من صفر.' : amount > max ? 'المبلغ يتجاوز الرصيد المتبقي.' : !date ? 'أدخل التاريخ.' : null;
  const changed = amount !== pay.amount || date !== pay.date || note !== pay.note;
  const no = installmentNo(plan, pay.installmentId ?? pay.id);

  async function save() {
    if (err) return;
    if (await apply(editPayment(plan, pay!.id, { amount: amount!, date, note }, unit))) onClose();
  }
  async function remove() {
    if (await confirm({ title: 'حذف هذه الدفعة؟', body: 'سيرتفع الرصيد المتبقي بقيمتها ويُعاد فتح القسط المرتبط بها إن لزم.', confirmText: 'حذف', danger: true })) {
      if (await apply(deletePayment(plan, pay!.id, unit))) onClose();
    }
  }

  return (
    <Modal open onClose={onClose} title={<span>تعديل دفعة — {KIND_LABEL[pay.kind]} {no ? <span className="num">({no})</span> : null}</span>}
      footer={<>
        <Button variant="danger" className="me-auto" icon={<Icon name="trash" size={16} />} onClick={remove}>حذف</Button>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="primary" icon={<Icon name="check" size={17} />} disabled={!!err || !changed} onClick={save}>حفظ التعديل</Button>
      </>}>
      <div className="grid gap-3.5">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="المبلغ المدفوع" htmlFor="pe-amt" error={amount != null ? err : null} hint={<>الحد الأقصى: <Money value={max} /></>}>
            <MoneyInput id="pe-amt" value={amount} onChange={setAmount} invalid={!!err && amount != null} autoFocus />
          </Field>
          <Field label="تاريخ الدفع" htmlFor="pe-date">
            <input id="pe-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="ملاحظة" htmlFor="pe-note">
          <input id="pe-note" className="field" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Notice tone="blue">بعد الحفظ يُعاد حساب الرصيد والأقساط القادمة حسب الدفعات الفعلية. الأقساط المدفوعة الأخرى لا تتغير.</Notice>
      </div>
    </Modal>
  );
}
