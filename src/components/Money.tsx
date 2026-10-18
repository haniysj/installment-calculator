import { RIAL_BOLD, RIAL_MEDIUM } from './rialPaths';
import { formatAmount } from '../lib/money';
import { useApp } from '../store';

/** Official Omani Rial symbol (from the supplied symbol file), drawn in the current text color. */
export function RialSymbol({ bold = false, className = '' }: { bold?: boolean; className?: string }) {
  const g = bold ? RIAL_BOLD : RIAL_MEDIUM;
  return (
    <svg viewBox={g.viewBox} className={`inline-block align-baseline ${className}`}
      style={{ height: '0.72em', width: 'auto', marginInline: '0.18em' }} role="img" aria-label="ريال عُماني">
      <path d={g.d} fill="currentColor" />
    </svg>
  );
}

export function Money({ value, bold = false, className = '', showZero = true }: { value: number | null | undefined; bold?: boolean; className?: string; showZero?: boolean }) {
  const { settings } = useApp();
  if (value == null || (!showZero && value === 0)) return <span className={`text-muted ${className}`}>—</span>;
  return (
    <span className={`nowrap ${className}`}>
      <span className="num">{formatAmount(value, settings.decimals)}</span>
      {settings.currencyDisplay === 'symbol'
        ? <RialSymbol bold={bold} />
        : <span className="text-[0.8em] ms-1 font-semibold opacity-80">ر.ع.</span>}
    </span>
  );
}
