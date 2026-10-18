import type { ScheduleEntry } from '../lib/engine';
import { STATUS_LABEL } from '../lib/csv';
import { Pill, type Tone } from './ui';
import { Icon } from './Icon';

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
