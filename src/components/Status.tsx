import type { ScheduleEntry } from '../lib/engine';
import { STATUS_LABEL } from '../lib/csv';
import { Pill, type Tone } from './ui';
import { Icon } from './Icon';
import { Money } from './Money';

export const STATUS_TONE: Record<ScheduleEntry['status'], Tone> = {
  paid: 'teal',
  'paid-short': 'teal',
  partial: 'saffron',
  overdue: 'rose',
  current: 'saffron',
  upcoming: 'gray',
  skipped: 'gray',
  cancelled: 'gray',
  extra: 'blue',
  down: 'blue',
};

export function StatusPill({ entry }: { entry: Pick<ScheduleEntry, 'status' | 'overdue'> }) {
  const st = entry.status;
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Pill tone={STATUS_TONE[st]}>
        {(st === 'paid' || st === 'paid-short') && <Icon name="check" size={13} />}
        {STATUS_LABEL[st]}
      </Pill>
      {st === 'partial' && entry.overdue && <Pill tone="rose">متأخر</Pill>}
    </span>
  );
}

export function FinalPill() {
  return <Pill tone="violet"><Icon name="flag" size={12} />القسط الأخير</Pill>;
}

/** Distinctive mark for a month where the amount paid is more than the installment */
export function OverpaidPill({ amount }: { amount: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-extrabold whitespace-nowrap text-white bg-linear-to-l from-[#f59e0b] to-[#ea580c] shadow-[0_2px_8px_-2px_#f59e0b]">
      <Icon name="star" size={12} />دفع زائد +<Money value={amount} />
    </span>
  );
}
