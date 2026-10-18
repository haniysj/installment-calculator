import type { ISODate } from './dates';

/** fixed = تثبيت القسط الشهري, flexible = قسط مرن, custom = أقساط مخصّصة */
export type Mode = 'fixed' | 'flexible' | 'custom';
export type SchedulingMethod = 'months' | 'endDate';
/**
 * How future (open) installments are recalculated:
 * equal = redistribute equally (keeps the end date)
 * fixed = keep the regular installment fixed (duration changes)
 * last  = only the last installment absorbs the difference (custom mode)
 */
export type Strategy = 'equal' | 'fixed' | 'last';
export type PaymentKind = 'installment' | 'extra' | 'down';

export interface Installment {
  id: string;
  dueDate: ISODate;
  /** planned amount in baisa */
  planned: number;
  /** settled by the user (marked paid, or closed with a partial payment) */
  closed: boolean;
  /** amount set manually by the user; kept during redistribution */
  locked: boolean;
  skipped: boolean;
  /** not needed anymore (balance settled earlier) */
  cancelled: boolean;
  note: string;
}

export interface Payment {
  id: string;
  date: ISODate;
  /** baisa, always > 0 */
  amount: number;
  kind: PaymentKind;
  installmentId: string | null;
  note: string;
  createdAt: string;
}

export interface PlanInput {
  name: string;
  principal: number;
  firstDate: ISODate;
  mode: Mode;
  method: SchedulingMethod;
  months?: number | null;
  endDate?: ISODate | null;
  fixedAmount?: number | null;
  fixedStartDate?: ISODate | null;
  downPayment?: number | null;
  notes?: string;
}

export interface Plan {
  schemaVersion: 1;
  id: string;
  name: string;
  principal: number;
  firstDate: ISODate;
  mode: Mode;
  strategy: Strategy;
  /** regular installment used by the "fixed" strategy */
  fixedAmount: number | null;
  anchorDay: number;
  installments: Installment[];
  payments: Payment[];
  notes: string;
  /** creation input, used by "reset" and "restore default schedule" */
  input: PlanInput;
  /** last due date of the original schedule (for restore) */
  originalEndDate: ISODate;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  decimals: 2 | 3;
  currencyDisplay: 'symbol' | 'text';
  appTitle: string;
  activePlanId: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  decimals: 3,
  currencyDisplay: 'symbol',
  appTitle: 'حاسبة التقسيط الذكية',
  activePlanId: null,
};

export type Result<T> = { ok: true; value: T; message?: string } | { ok: false; error: string };
