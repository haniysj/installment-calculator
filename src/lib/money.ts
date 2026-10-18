// All money is stored as integer baisa (1 OMR = 1000 baisa) to avoid floating-point errors.

export const BAISA_PER_RIAL = 1000;

/** Parse user input ("1,250.5", "١٢٥٠٫٥", "150") into integer baisa. Returns null if invalid. */
export function parseRial(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * BAISA_PER_RIAL);
  }
  let s = String(input).trim();
  if (!s) return null;
  // Arabic-Indic and Persian digits → Latin
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
       .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
       .replace(/٫/g, '.') // Arabic decimal separator
       .replace(/[٬,\s]/g, ''); // thousands separators
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 3) {
    // round half up on the 4th decimal
    const base = Number(whole) * BAISA_PER_RIAL + Number(frac.slice(0, 3).padEnd(3, '0'));
    const extra = Number(frac[3]) >= 5 ? 1 : 0;
    return (neg ? -1 : 1) * (base + extra);
  }
  const v = Number(whole) * BAISA_PER_RIAL + Number(frac.padEnd(3, '0'));
  return neg ? -v : v;
}

/** Format baisa as a plain number string (no currency), e.g. 150000 → "150.000". */
export type Decimals = 0 | 2 | 3;

export function formatAmount(baisa: number, decimals: Decimals = 3, grouping = true): string {
  const neg = baisa < 0;
  let b = Math.abs(Math.round(baisa));
  if (decimals === 0) {
    // whole rials only (rounded half up)
    const w = Math.round(b / BAISA_PER_RIAL);
    return `${neg && w ? '-' : ''}${grouping ? w.toLocaleString('en-US') : String(w)}`;
  }
  if (decimals === 2) {
    // display rounding to 10 baisa (half up)
    b = Math.round(b / 10) * 10;
  }
  const whole = Math.floor(b / BAISA_PER_RIAL);
  const frac = String(b % BAISA_PER_RIAL).padStart(3, '0').slice(0, decimals);
  const w = grouping ? whole.toLocaleString('en-US') : String(whole);
  return `${neg ? '-' : ''}${w}.${frac}`;
}

/** Rial value for form inputs (no grouping, trailing zeros trimmed). */
export function toInputValue(baisa: number | undefined | null): string {
  if (baisa == null) return '';
  const s = formatAmount(baisa, 3, false);
  return s.replace(/\.?0+$/, '');
}

/** Rounding unit in baisa for computed installments (0 → whole rial, 2 → 10 baisa, 3 → 1 baisa). */
export function roundingUnit(decimals: Decimals): number {
  return decimals === 0 ? 1000 : decimals === 2 ? 10 : 1;
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
