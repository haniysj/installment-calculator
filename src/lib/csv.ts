import { buildSchedule, summarize, type ScheduleEntry } from './engine';
import { formatDateShort, type ISODate } from './dates';
import { formatAmount, type Decimals } from './money';
import type { Plan } from './types';

export const STATUS_LABEL: Record<ScheduleEntry['status'], string> = {
  paid: 'مدفوع',
  'paid-short': 'مغلق بدفعة جزئية',
  partial: 'مدفوع جزئياً',
  overdue: 'متأخر',
  current: 'الشهر الحالي',
  upcoming: 'قادم',
  skipped: 'مُتخطّى',
  cancelled: 'ملغى (تمت التسوية)',
  extra: 'دفعة إضافية',
  down: 'دفعة أولى',
};

export const MODE_LABEL = { fixed: 'تثبيت القسط الشهري', flexible: 'قسط مرن', custom: 'أقساط مخصّصة' } as const;

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a details block, then the full schedule. UTF-8 BOM so Excel shows Arabic correctly. */
export function scheduleToCSV(plan: Plan, decimals: Decimals = 3, today?: ISODate): string {
  const s = summarize(plan, today);
  const amt = (b: number | null) => (b == null ? '' : formatAmount(b, decimals, false));
  const lines: (string | number)[][] = [
    ['اسم الخطة', plan.name],
    ['نوع التقسيط', MODE_LABEL[plan.mode]],
    ['المبلغ الإجمالي (ر.ع.)', amt(plan.principal)],
    ['إجمالي المدفوع (ر.ع.)', amt(s.totalPaid)],
    ['الرصيد المتبقي (ر.ع.)', amt(s.outstanding)],
    ['تاريخ أول قسط', formatDateShort(plan.firstDate)],
    ['تاريخ السداد المتوقع', s.expectedEnd ? formatDateShort(s.expectedEnd) : ''],
    [],
    ['الرقم', 'تاريخ الدفع', 'القسط المخطط (ر.ع.)', 'المدفوع فعلياً (ر.ع.)', 'الرصيد المتبقي (ر.ع.)', 'الحالة', 'ملاحظات'],
  ];
  for (const e of buildSchedule(plan, today)) {
    lines.push([
      e.no ?? '—',
      formatDateShort(e.date),
      amt(e.planned),
      e.actual ? amt(e.actual) : '',
      amt(e.balanceAfter),
      STATUS_LABEL[e.status] + (e.isFinal && e.type === 'installment' ? ' - القسط الأخير' : ''),
      e.note,
    ]);
  }
  lines.push(['الإجمالي', '', amt(s.totalPlanned), amt(s.totalPaid), amt(s.outstanding), '', '']);
  return '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n');
}
