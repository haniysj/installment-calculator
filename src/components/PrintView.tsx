import { buildSchedule, summarize } from '../lib/engine';
import { STATUS_LABEL, MODE_LABEL, scheduleToCSV } from '../lib/csv';
import { formatDateLong, formatDateShort, todayISO } from '../lib/dates';
import type { Plan } from '../lib/types';
import { Money } from './Money';
import { useApp } from '../store';

export function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 50) || 'plan';

export function exportCSV(plan: Plan, decimals: 2 | 3) {
  downloadFile(`جدول-${safeName(plan.name)}-${todayISO()}.csv`, scheduleToCSV(plan, decimals), 'text/csv;charset=utf-8');
}

/** Print-only report of one plan (details block + full table). Hidden on screen. */
export function PrintView({ plan }: { plan: Plan }) {
  const { settings } = useApp();
  const s = summarize(plan);
  const rows = buildSchedule(plan);
  return (
    <div className="print-only text-[12px]" dir="rtl">
      <div className="flex justify-between items-end border-b-2 border-[#102a43] pb-2 mb-3">
        <div>
          <div className="text-[18px] font-extrabold">{settings.appTitle}</div>
          <div className="text-[15px] font-bold">{plan.name}</div>
        </div>
        <div className="text-left text-[11px]">تاريخ الطباعة: <span className="num">{formatDateShort(todayISO())}</span></div>
      </div>
      <table className="print-table mb-3">
        <tbody>
          <tr><th>نوع التقسيط</th><td>{MODE_LABEL[plan.mode]}</td><th>المبلغ الإجمالي</th><td><Money value={plan.principal} /></td></tr>
          <tr><th>إجمالي المدفوع</th><td><Money value={s.totalPaid} /></td><th>الرصيد المتبقي</th><td><Money value={s.outstanding} /></td></tr>
          <tr><th>تاريخ أول قسط</th><td>{formatDateLong(plan.firstDate)}</td><th>تاريخ السداد المتوقع</th><td>{s.expectedEnd ? formatDateLong(s.expectedEnd) : '—'}</td></tr>
          <tr><th>الأقساط المدفوعة</th><td className="num">{s.paidCount}</td><th>الأقساط المتبقية</th><td className="num">{s.remainingCount}</td></tr>
        </tbody>
      </table>
      <table className="print-table">
        <thead>
          <tr><th>الرقم</th><th>تاريخ الدفع</th><th>القسط المخطط</th><th>المدفوع فعلياً</th><th>الرصيد المتبقي</th><th>الحالة</th><th>ملاحظات</th></tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.key}>
              <td className="num">{e.no ?? '—'}</td>
              <td className="num">{formatDateShort(e.date)}</td>
              <td>{e.planned == null ? '—' : <Money value={e.planned} />}</td>
              <td>{e.actual ? <Money value={e.actual} /> : '—'}</td>
              <td><Money value={e.balanceAfter} /></td>
              <td>{STATUS_LABEL[e.status]}{e.isFinal ? ' • القسط الأخير' : ''}</td>
              <td>{e.note}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td colSpan={2}>الإجمالي</td>
            <td><Money value={s.totalPlanned} /></td>
            <td><Money value={s.totalPaid} /></td>
            <td><Money value={s.outstanding} /></td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
      {plan.notes && <p className="mt-3">ملاحظات: {plan.notes}</p>}
      <p className="mt-4 text-[10px] text-[#627d98]">Prepared by: Hani Al Ghatrifi</p>
    </div>
  );
}
