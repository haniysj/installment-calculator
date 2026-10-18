// Pure calculation engine. No UI, no storage. Every function returns a NEW plan object.
import { addMonths, isValidISO, monthsInclusive, parseISO, sameMonth, todayISO, type ISODate } from './dates';
import { formatAmount, sum } from './money';
import type { Installment, Payment, PaymentKind, Plan, PlanInput, Result, Strategy } from './types';

export const MAX_ROWS = 600; // 50 years

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rnd}`;
}

const nowStamp = () => new Date().toISOString();
const fmt = (b: number) => `${formatAmount(b, b % 1000 === 0 ? 0 : 3)} ر.ع.`;

function newRow(dueDate: ISODate, planned: number): Installment {
  return { id: uid('ins'), dueDate, planned, closed: false, locked: false, skipped: false, cancelled: false, note: '' };
}

// ───────────────────────── basic queries ─────────────────────────

export function totalPaid(plan: Plan): number {
  return sum(plan.payments.map((p) => p.amount));
}

export function outstanding(plan: Plan): number {
  return plan.principal - totalPaid(plan);
}

export function paidFor(plan: Plan, installmentId: string): number {
  return sum(plan.payments.filter((p) => p.installmentId === installmentId).map((p) => p.amount));
}

/** amount still due on an open row */
export function dueOf(plan: Plan, row: Installment): number {
  if (row.closed || row.skipped || row.cancelled) return 0;
  return Math.max(0, row.planned - paidFor(plan, row.id));
}

export function firstOpenIndex(plan: Plan): number {
  const i = plan.installments.findIndex((r) => !r.closed && !r.skipped);
  return i === -1 ? plan.installments.length : i;
}

/** The regular installment used by "keep installment fixed" logic. */
export function regularAmount(plan: Plan): number {
  if (plan.fixedAmount && plan.fixedAmount > 0) return plan.fixedAmount;
  const open = plan.installments.filter((r) => !r.closed && !r.skipped && !r.cancelled && r.planned > 0);
  if (open.length) return open[0].planned;
  const any = plan.installments.filter((r) => r.planned > 0);
  return any.length ? any[0].planned : plan.principal;
}

// ───────────────────────── schedule generation ─────────────────────────

/** Split `amount` into `n` equal parts rounded down to `unit`; the last part absorbs the difference. */
export function equalSplit(amount: number, n: number, unit = 1): number[] {
  if (n <= 0) return [];
  const base = Math.floor(amount / n / unit) * unit;
  const parts = Array(n).fill(base);
  parts[n - 1] = amount - base * (n - 1);
  return parts;
}

/** Fill `amount` with fixed parts of `fixed`; final part = remainder (never overcharges). */
export function fixedSplit(amount: number, fixed: number): number[] {
  if (fixed <= 0) throw new Error('fixed must be > 0');
  if (amount <= 0) return [];
  const n = Math.ceil(amount / fixed);
  const parts = Array(n).fill(fixed);
  parts[n - 1] = amount - fixed * (n - 1);
  return parts;
}

export function validateInput(input: PlanInput, unit = 1): string | null {
  if (!Number.isInteger(input.principal) || input.principal <= 0) return 'أدخل مبلغاً إجمالياً أكبر من صفر.';
  if (!isValidISO(input.firstDate)) return 'أدخل تاريخ أول قسط بشكل صحيح.';
  const down = input.downPayment ?? 0;
  if (!Number.isInteger(down) || down < 0) return 'الدفعة الأولى لا يمكن أن تكون سالبة.';
  if (down >= input.principal) return 'الدفعة الأولى يجب أن تكون أقل من المبلغ الإجمالي.';
  const amount = input.principal - down;
  if (input.mode === 'fixed') {
    const f = input.fixedAmount ?? 0;
    if (!Number.isInteger(f) || f <= 0) return 'يجب أن يكون القسط الشهري الثابت أكبر من صفر.';
    if (input.fixedStartDate) {
      if (!isValidISO(input.fixedStartDate)) return 'تاريخ بدء الأقساط الثابتة غير صحيح.';
      if (input.fixedStartDate < input.firstDate) return 'تاريخ بدء الأقساط الثابتة يجب ألا يسبق تاريخ أول قسط.';
    }
    if (Math.ceil(amount / f) > MAX_ROWS) return 'القسط صغير جداً: المدة تتجاوز 50 سنة.';
    return null;
  }
  let n: number;
  if (input.method === 'months') {
    n = Number(input.months);
    if (!Number.isInteger(n) || n < 1) return 'أدخل عدد أشهر صحيحاً (1 أو أكثر).';
    if (n > MAX_ROWS) return 'الحد الأقصى 600 شهر.';
  } else {
    if (!input.endDate || !isValidISO(input.endDate)) return 'أدخل تاريخ آخر قسط بشكل صحيح.';
    if (input.endDate < input.firstDate) return 'تاريخ آخر قسط يجب أن يكون بعد تاريخ أول قسط.';
    n = monthsInclusive(input.firstDate, input.endDate);
    if (n > MAX_ROWS) return 'المدة تتجاوز 50 سنة.';
  }
  if (amount < n * unit) return 'المبلغ صغير جداً بالنسبة لعدد الأشهر.';
  return null;
}

/** Number of monthly installments for the "months" or "endDate" method. */
export function installmentCount(input: PlanInput): number {
  if (input.method === 'endDate' && input.endDate) return monthsInclusive(input.firstDate, input.endDate);
  return Number(input.months);
}

export function createPlan(input: PlanInput, unit = 1, existing?: Pick<Plan, 'id' | 'createdAt'>): Result<Plan> {
  const err = validateInput(input, unit);
  if (err) return { ok: false, error: err };
  const down = input.downPayment ?? 0;
  const amount = input.principal - down;
  const start = input.mode === 'fixed' && input.fixedStartDate ? input.fixedStartDate : input.firstDate;
  const anchorDay = parseISO(start).d;
  const parts = input.mode === 'fixed'
    ? fixedSplit(amount, input.fixedAmount!)
    : equalSplit(amount, installmentCount(input), unit);
  const installments = parts.map((p, i) => {
    const r = newRow(addMonths(start, i, anchorDay), p);
    if (p === 0) r.cancelled = true;
    return r;
  });
  const payments: Payment[] = down > 0
    ? [{ id: uid('pay'), date: input.firstDate, amount: down, kind: 'down', installmentId: null, note: 'دفعة أولى', createdAt: nowStamp() }]
    : [];
  const strategy: Strategy = input.mode === 'fixed' ? 'fixed' : input.mode === 'flexible' ? 'equal' : 'last';
  const stamp = nowStamp();
  const plan: Plan = {
    schemaVersion: 1,
    id: existing?.id ?? uid('plan'),
    name: input.name.trim() || 'خطة جديدة',
    principal: input.principal,
    firstDate: input.firstDate,
    mode: input.mode,
    strategy,
    fixedAmount: input.mode === 'fixed' ? input.fixedAmount! : null,
    anchorDay,
    installments,
    payments,
    notes: input.notes ?? '',
    input: { ...input },
    originalEndDate: installments[installments.length - 1].dueDate,
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  };
  return { ok: true, value: plan };
}

// ───────────────────────── recalculation ─────────────────────────

export interface RecalcOptions {
  strategy?: Strategy;
  fixedAmount?: number;
  unit?: number;
}

/**
 * Recalculate open installments from index `from` onward so that the sum of
 * amounts still due equals the outstanding balance (principal − actual payments).
 * Rows before `from`, closed rows and payments are never modified.
 */
export function recalc(plan: Plan, from: number, opts: RecalcOptions = {}): Plan {
  const strategy = opts.strategy ?? plan.strategy;
  const unit = opts.unit ?? 1;
  const rows = plan.installments.map((r) => ({ ...r }));
  const p: Plan = { ...plan, installments: rows };
  const paid = new Map(rows.map((r) => [r.id, paidFor(plan, r.id)]));
  const out = outstanding(plan);
  const isOpen = (r: Installment) => !r.closed && !r.skipped;
  const due = (r: Installment) => (isOpen(r) && !r.cancelled ? Math.max(0, r.planned - paid.get(r.id)!) : 0);

  from = Math.max(0, Math.min(from, rows.length));
  let pre = sum(rows.slice(0, from).map(due));
  if (out - pre < 0) {
    // earlier open rows already exceed the balance (e.g. a large extra payment) → recalc all open rows
    from = firstOpenIndex(plan);
    pre = sum(rows.slice(0, from).map(due));
  }
  const T = Math.max(0, out - pre);
  const range = rows.map((r, i) => i).filter((i) => i >= from && isOpen(rows[i]));
  const nextDate = () => {
    const last = rows[rows.length - 1];
    return last ? addMonths(last.dueDate, 1, p.anchorDay) : p.firstDate;
  };
  const dues = new Map<number, number>(); // index → new due

  if (strategy === 'fixed') {
    const F = opts.fixedAmount ?? regularAmount(plan);
    let remaining = T;
    for (const i of range) {
      const r = rows[i];
      const want = r.locked && !r.cancelled ? due(r) : F;
      const d = Math.min(want, remaining);
      dues.set(i, d);
      remaining -= d;
    }
    while (remaining > 0 && rows.length < MAX_ROWS) {
      const d = Math.min(F, remaining);
      rows.push(newRow(nextDate(), 0));
      paid.set(rows[rows.length - 1].id, 0);
      dues.set(rows.length - 1, d);
      remaining -= d;
    }
    if (remaining > 0) {
      const last = rows.length - 1;
      dues.set(last, (dues.get(last) ?? 0) + remaining);
    }
  } else if (strategy === 'equal') {
    let active = range.filter((i) => !rows[i].cancelled);
    if (active.length === 0 && T > 0) active = range.slice();
    if (active.length === 0 && T > 0) {
      rows.push(newRow(nextDate(), 0));
      paid.set(rows[rows.length - 1].id, 0);
      active = [rows.length - 1];
    }
    for (const i of range) if (!active.includes(i)) dues.set(i, 0);
    // locked rows keep their amount while it fits
    let lockedIdx = active.filter((i) => rows[i].locked);
    let lockedSum = sum(lockedIdx.map((i) => due(rows[i])));
    while (lockedSum > T && lockedIdx.length) {
      lockedIdx = lockedIdx.slice(0, -1);
      lockedSum = sum(lockedIdx.map((i) => due(rows[i])));
    }
    const free = active.filter((i) => !lockedIdx.includes(i));
    for (const i of lockedIdx) dues.set(i, due(rows[i]));
    if (free.length) {
      equalSplit(T - lockedSum, free.length, unit).forEach((d, k) => dues.set(free[k], d));
    } else if (active.length) {
      const last = active[active.length - 1];
      dues.set(last, due(rows[last]) + (T - lockedSum));
    }
  } else {
    // 'last': keep each row, only the final installment(s) absorb the difference
    const active = range.filter((i) => !rows[i].cancelled);
    for (const i of range) dues.set(i, due(rows[i]));
    let diff = T - sum(active.map((i) => due(rows[i])));
    if (diff > 0) {
      if (active.length) {
        const last = active[active.length - 1];
        dues.set(last, dues.get(last)! + diff);
      } else {
        rows.push(newRow(nextDate(), 0));
        paid.set(rows[rows.length - 1].id, 0);
        dues.set(rows.length - 1, diff);
      }
    } else {
      for (let k = active.length - 1; k >= 0 && diff < 0; k--) {
        const i = active[k];
        const cut = Math.min(dues.get(i)!, -diff);
        dues.set(i, dues.get(i)! - cut);
        diff += cut;
      }
    }
  }

  for (const [i, d] of dues) {
    const r = rows[i];
    const pd = paid.get(r.id) ?? 0;
    if (d > 0) {
      r.planned = pd + d;
      r.cancelled = false;
    } else if (pd > 0) {
      r.planned = pd; // settled by what was already paid
      r.closed = true;
      r.cancelled = false;
    } else {
      r.planned = 0;
      r.cancelled = true;
      r.locked = false;
    }
  }
  return p;
}

// ───────────────────────── user operations ─────────────────────────

function touch(plan: Plan): Plan {
  return { ...plan, updatedAt: nowStamp() };
}

function findIndex(plan: Plan, id: string): number {
  return plan.installments.findIndex((r) => r.id === id);
}

/** Maximum amount that can be planned on row `index` (the balance before it). */
export function maxPlannedFor(plan: Plan, index: number): number {
  const row = plan.installments[index];
  const pre = sum(plan.installments.slice(0, index).map((r) => dueOf(plan, r)));
  return outstanding(plan) - pre + paidFor(plan, row.id);
}

export type FollowMode = 'equal' | 'fixed' | 'keep';

/**
 * Edit one installment's planned amount. Earlier rows are preserved; later open rows are
 * redistributed (equal by default, or fixed at the new amount, or plan strategy when 'keep').
 */
export function editInstallment(plan: Plan, id: string, newPlanned: number, follow: FollowMode = 'keep', unit = 1): Result<Plan> {
  const i = findIndex(plan, id);
  if (i < 0) return { ok: false, error: 'القسط غير موجود.' };
  const row = plan.installments[i];
  if (row.closed) return { ok: false, error: 'لا يمكن تعديل قسط مدفوع. احذف الدفعة أولاً إن أردت التعديل.' };
  if (!Number.isInteger(newPlanned) || newPlanned < 0) return { ok: false, error: 'لا يمكن أن يكون القسط سالباً.' };
  const pd = paidFor(plan, id);
  if (newPlanned < pd) return { ok: false, error: `القسط لا يمكن أن يقل عما دُفع منه (${fmt(pd)}).` };
  const max = maxPlannedFor(plan, i);
  if (newPlanned > max) return { ok: false, error: `القسط يتجاوز الرصيد المتبقي (${fmt(max)}).` };

  // earlier rows are untouched: recalc only runs from i + 1
  const rows = plan.installments.map((r) => ({ ...r }));
  rows[i] = { ...rows[i], planned: newPlanned, locked: true, cancelled: newPlanned === 0 && pd === 0, skipped: false };
  let p: Plan = { ...plan, installments: rows };
  let strategy = plan.strategy;
  let fixedAmount = plan.fixedAmount;
  if (follow === 'equal') strategy = 'equal';
  if (follow === 'fixed' && newPlanned > 0) { strategy = 'fixed'; fixedAmount = newPlanned; }
  p = { ...p, strategy, fixedAmount: strategy === 'fixed' ? fixedAmount : plan.fixedAmount };
  p = recalc(p, i + 1, { strategy, fixedAmount: fixedAmount ?? undefined, unit });
  return { ok: true, value: touch(p), message: 'تم تعديل القسط وإعادة حساب الأقساط اللاحقة.' };
}

/** Change the regular fixed installment (fixed mode) and recalculate the whole future schedule. */
export function changeFixedAmount(plan: Plan, amount: number, unit = 1): Result<Plan> {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'يجب أن يكون القسط الشهري الثابت أكبر من صفر.' };
  const out = outstanding(plan);
  if (out > 0 && Math.ceil(out / amount) > MAX_ROWS) return { ok: false, error: 'القسط صغير جداً: المدة تتجاوز 50 سنة.' };
  const rows = plan.installments.map((r) => (r.closed ? r : { ...r, locked: false }));
  let p: Plan = { ...plan, installments: rows, fixedAmount: amount, strategy: 'fixed' };
  p = recalc(p, firstOpenIndex(p), { strategy: 'fixed', fixedAmount: amount, unit });
  return { ok: true, value: touch(p), message: 'تم تحديث القسط الثابت وإعادة حساب الجدول وتاريخ السداد الأخير.' };
}

/** Change the total amount (principal) and recalculate the duration / future schedule. */
export function changePrincipal(plan: Plan, principal: number, unit = 1): Result<Plan> {
  if (!Number.isInteger(principal) || principal <= 0) return { ok: false, error: 'أدخل مبلغاً إجمالياً أكبر من صفر.' };
  const paid = totalPaid(plan);
  if (principal < paid) return { ok: false, error: `المبلغ لا يمكن أن يقل عن إجمالي المدفوع (${fmt(paid)}).` };
  let p: Plan = { ...plan, principal, input: { ...plan.input, principal } };
  p = recalc(p, firstOpenIndex(p), { unit });
  return { ok: true, value: touch(p), message: 'تم تحديث المبلغ وإعادة حساب الأقساط.' };
}

export interface PaymentInput {
  date: ISODate;
  amount: number;
  kind: PaymentKind;
  installmentId?: string | null;
  /** close the installment even if the amount is less than planned (carry shortfall forward) */
  closeRow?: boolean;
  /** for extra/down payments */
  extraStrategy?: 'shorten' | 'reduce';
  note?: string;
}

export function recordPayment(plan: Plan, input: PaymentInput, unit = 1): Result<Plan> {
  if (!isValidISO(input.date)) return { ok: false, error: 'تاريخ الدفعة غير صحيح.' };
  if (!Number.isInteger(input.amount) || input.amount <= 0) return { ok: false, error: 'أدخل مبلغ دفعة أكبر من صفر.' };
  const out = outstanding(plan);
  if (out <= 0) return { ok: false, error: 'تم سداد الخطة بالكامل، لا يوجد رصيد متبقٍ.' };
  if (input.amount > out) return { ok: false, error: `المبلغ يتجاوز الرصيد المتبقي (${fmt(out)}).` };
  const pay: Payment = {
    id: uid('pay'), date: input.date, amount: input.amount, kind: input.kind,
    installmentId: input.kind === 'installment' ? input.installmentId ?? null : null,
    note: input.note?.trim() ?? '', createdAt: nowStamp(),
  };

  if (input.kind === 'installment') {
    const i = findIndex(plan, input.installmentId ?? '');
    if (i < 0) return { ok: false, error: 'اختر القسط الذي تُسجَّل له الدفعة.' };
    const row = plan.installments[i];
    if (row.closed) return { ok: false, error: 'هذا القسط مدفوع ومغلق.' };
    if (row.skipped) return { ok: false, error: 'هذا القسط مُتخطّى.' };
    const paidBefore = paidFor(plan, row.id);
    const paidAfter = paidBefore + input.amount;
    let p: Plan = { ...plan, payments: [...plan.payments, pay] };
    const rows = p.installments.map((r) => ({ ...r }));
    const r = rows[i];
    r.cancelled = false;
    let msg = 'تم تسجيل الدفعة.';
    if (paidAfter >= r.planned || input.closeRow) {
      r.closed = true;
      p = { ...p, installments: rows };
      if (paidAfter !== r.planned) {
        p = recalc(p, i + 1, { unit });
        msg = paidAfter > r.planned
          ? 'تم تسجيل الدفعة. الزيادة خُصمت من الأقساط اللاحقة وأُعيد حسابها.'
          : 'تم تسجيل دفعة جزئية وإغلاق القسط. الفرق رُحّل إلى الأقساط اللاحقة.';
      } else {
        msg = 'تم تسجيل القسط كمدفوع.';
      }
    } else {
      p = { ...p, installments: rows };
      msg = 'تم تسجيل دفعة جزئية. يبقى على هذا القسط ' + fmt(r.planned - paidAfter);
    }
    return { ok: true, value: touch(p), message: msg };
  }

  // extra or down payment: not linked to an installment
  let p: Plan = { ...plan, payments: [...plan.payments, pay] };
  const shorten = (input.extraStrategy ?? 'shorten') === 'shorten';
  const strategy: Strategy = shorten ? 'fixed' : 'equal';
  const fixedAmount = shorten ? regularAmount(plan) : plan.fixedAmount;
  p = { ...p, strategy, fixedAmount };
  p = recalc(p, firstOpenIndex(p), { strategy, fixedAmount: fixedAmount ?? undefined, unit });
  const msg = shorten
    ? 'تم تسجيل الدفعة الإضافية. القسط الشهري ثابت والمدة أصبحت أقصر.'
    : 'تم تسجيل الدفعة الإضافية. تاريخ الانتهاء ثابت والأقساط القادمة أصبحت أقل.';
  return { ok: true, value: touch(p), message: msg };
}

export function deletePayment(plan: Plan, paymentId: string, unit = 1): Result<Plan> {
  const pay = plan.payments.find((x) => x.id === paymentId);
  if (!pay) return { ok: false, error: 'الدفعة غير موجودة.' };
  let p: Plan = { ...plan, payments: plan.payments.filter((x) => x.id !== paymentId) };
  if (pay.installmentId) {
    const i = findIndex(p, pay.installmentId);
    if (i >= 0) {
      const rows = p.installments.map((r) => ({ ...r }));
      const r = rows[i];
      const pd = paidFor(p, r.id);
      if (r.closed && pd < r.planned) r.closed = false;
      if (r.closed && pd === 0) r.closed = false;
      p = { ...p, installments: rows };
      p = recalc(p, i + 1, { unit });
    }
  } else {
    p = recalc(p, firstOpenIndex(p), { unit });
  }
  return { ok: true, value: touch(p), message: 'تم حذف الدفعة وإعادة حساب الرصيد.' };
}

export function skipInstallment(plan: Plan, id: string, unit = 1): Result<Plan> {
  const i = findIndex(plan, id);
  if (i < 0) return { ok: false, error: 'القسط غير موجود.' };
  const row = plan.installments[i];
  if (row.closed) return { ok: false, error: 'لا يمكن تخطي قسط مدفوع.' };
  if (paidFor(plan, id) > 0) return { ok: false, error: 'لا يمكن تخطي قسط سُجّلت عليه دفعة.' };
  const rows = plan.installments.map((r) => ({ ...r }));
  rows[i] = { ...rows[i], skipped: true, planned: 0, locked: false, cancelled: false };
  let p: Plan = { ...plan, installments: rows };
  p = recalc(p, i + 1, { unit });
  return { ok: true, value: touch(p), message: 'تم تخطي القسط وتوزيع قيمته على الأقساط اللاحقة.' };
}

export function unskipInstallment(plan: Plan, id: string, unit = 1): Result<Plan> {
  const i = findIndex(plan, id);
  if (i < 0) return { ok: false, error: 'القسط غير موجود.' };
  const rows = plan.installments.map((r) => ({ ...r }));
  rows[i] = { ...rows[i], skipped: false, cancelled: true, planned: 0 };
  let p: Plan = { ...plan, installments: rows };
  p = recalc(p, i, { unit });
  return { ok: true, value: touch(p), message: 'تمت إعادة القسط وإعادة الحساب.' };
}

/** Postpone: move this and every later open installment one month forward. */
export function postponeInstallment(plan: Plan, id: string): Result<Plan> {
  const i = findIndex(plan, id);
  if (i < 0) return { ok: false, error: 'القسط غير موجود.' };
  if (plan.installments[i].closed) return { ok: false, error: 'لا يمكن تأجيل قسط مدفوع.' };
  const rows = plan.installments.map((r, k) =>
    k >= i && !r.closed ? { ...r, dueDate: addMonths(r.dueDate, 1, plan.anchorDay) } : { ...r });
  return { ok: true, value: touch({ ...plan, installments: rows }), message: 'تم تأجيل القسط والأقساط التي تليه شهراً واحداً.' };
}

export function changeInstallmentDate(plan: Plan, id: string, date: ISODate): Result<Plan> {
  const i = findIndex(plan, id);
  if (i < 0) return { ok: false, error: 'القسط غير موجود.' };
  if (!isValidISO(date)) return { ok: false, error: 'التاريخ غير صحيح.' };
  const rows = plan.installments.map((r) => ({ ...r }));
  rows[i].dueDate = date;
  return { ok: true, value: touch({ ...plan, installments: rows }), message: 'تم تغيير تاريخ القسط.' };
}

export function setInstallmentNote(plan: Plan, id: string, note: string): Plan {
  return touch({ ...plan, installments: plan.installments.map((r) => (r.id === id ? { ...r, note } : r)) });
}

export function deleteInstallment(plan: Plan, id: string, unit = 1): Result<Plan> {
  const i = findIndex(plan, id);
  if (i < 0) return { ok: false, error: 'القسط غير موجود.' };
  const row = plan.installments[i];
  if (row.closed || paidFor(plan, id) > 0) return { ok: false, error: 'لا يمكن حذف قسط مدفوع أو عليه دفعة.' };
  let p: Plan = { ...plan, installments: plan.installments.filter((r) => r.id !== id) };
  p = recalc(p, firstOpenIndex(p), { unit });
  return { ok: true, value: touch(p), message: 'تم حذف القسط وإعادة توزيع قيمته.' };
}

/** Add one more installment at the end (custom mode); amounts are rebalanced by the plan strategy. */
export function addInstallment(plan: Plan, unit = 1): Result<Plan> {
  if (plan.installments.length >= MAX_ROWS) return { ok: false, error: 'وصلت للحد الأقصى من الأقساط.' };
  const last = plan.installments[plan.installments.length - 1];
  const date = last ? addMonths(last.dueDate, 1, plan.anchorDay) : plan.firstDate;
  const row = newRow(date, 0);
  let p: Plan = { ...plan, installments: [...plan.installments, row] };
  const strategy: Strategy = plan.strategy === 'last' ? 'equal' : plan.strategy;
  p = recalc(p, firstOpenIndex(p), { strategy: strategy === 'fixed' ? 'equal' : strategy, unit });
  return { ok: true, value: touch(p), message: 'تمت إضافة قسط وإعادة التوزيع.' };
}

/** Restore the default schedule: paid rows are kept, open rows are rebuilt from the original settings. */
export function restoreDefault(plan: Plan, unit = 1): Result<Plan> {
  const keep = plan.installments.filter((r) => r.closed || r.skipped || paidFor(plan, r.id) > 0);
  const strategy: Strategy = plan.input.mode === 'fixed' ? 'fixed' : 'equal';
  const fixedAmount = plan.input.mode === 'fixed' ? plan.input.fixedAmount ?? null : null;
  const lastKept = keep[keep.length - 1];
  const start = lastKept ? addMonths(lastKept.dueDate, 1, plan.anchorDay) : plan.installments[0]?.dueDate ?? plan.firstDate;
  const rows = keep.map((r) => ({ ...r, locked: false }));
  if (strategy === 'equal') {
    const n = Math.max(1, monthsInclusive(start, plan.originalEndDate));
    for (let k = 0; k < n; k++) rows.push(newRow(addMonths(start, k, plan.anchorDay), 0));
  }
  let p: Plan = { ...plan, installments: rows, strategy: plan.input.mode === 'custom' ? 'last' : strategy, fixedAmount };
  p = recalc(p, firstOpenIndex(p), { strategy, fixedAmount: fixedAmount ?? undefined, unit });
  return { ok: true, value: touch(p), message: 'تمت استعادة الجدول الافتراضي مع الإبقاء على الدفعات المسجّلة.' };
}

/** Reset: rebuild the plan from its creation input; all recorded payments are removed. */
export function resetPlan(plan: Plan, unit = 1): Result<Plan> {
  const r = createPlan(plan.input, unit, { id: plan.id, createdAt: plan.createdAt });
  if (!r.ok) return r;
  return { ok: true, value: { ...r.value, name: plan.name, notes: plan.notes }, message: 'تمت إعادة تعيين الخطة.' };
}

export interface PaymentPatch { date: ISODate; amount: number; note?: string }

/** Edit a recorded payment (amount, date, note). The schedule is recalculated from actual payments. */
export function editPayment(plan: Plan, paymentId: string, patch: PaymentPatch, unit = 1): Result<Plan> {
  const pay = plan.payments.find((x) => x.id === paymentId);
  if (!pay) return { ok: false, error: 'الدفعة غير موجودة.' };
  if (!isValidISO(patch.date)) return { ok: false, error: 'تاريخ الدفعة غير صحيح.' };
  if (!Number.isInteger(patch.amount) || patch.amount <= 0) return { ok: false, error: 'أدخل مبلغ دفعة أكبر من صفر.' };
  const others = totalPaid(plan) - pay.amount;
  if (others + patch.amount > plan.principal) return { ok: false, error: `المبلغ يتجاوز الرصيد المتبقي (${fmt(plan.principal - others)}).` };
  const note = patch.note?.trim() ?? pay.note;

  if (pay.installmentId) {
    const row = plan.installments.find((r) => r.id === pay.installmentId);
    const wasClosed = !!row?.closed;
    const del = deletePayment(plan, paymentId, unit);
    if (!del.ok) return del;
    const rec = recordPayment(del.value, { date: patch.date, amount: patch.amount, kind: 'installment', installmentId: pay.installmentId, closeRow: wasClosed, note }, unit);
    if (!rec.ok) return rec;
    const fresh = rec.value.payments[rec.value.payments.length - 1];
    const payments = rec.value.payments.map((x) => (x.id === fresh.id ? { ...x, id: pay.id, createdAt: pay.createdAt } : x));
    return { ok: true, value: touch({ ...rec.value, payments }), message: 'تم تعديل الدفعة وإعادة حساب الأقساط.' };
  }
  let p: Plan = { ...plan, payments: plan.payments.map((x) => (x.id === paymentId ? { ...x, date: patch.date, amount: patch.amount, note } : x)) };
  p = recalc(p, firstOpenIndex(p), { unit });
  return { ok: true, value: touch(p), message: 'تم تعديل الدفعة وإعادة حساب الأقساط.' };
}

/** Move the start of the plan: every installment keeps its order and shifts by the same number of months. */
export function changeFirstDate(plan: Plan, date: ISODate): Result<Plan> {
  if (!isValidISO(date)) return { ok: false, error: 'تاريخ أول قسط غير صحيح.' };
  const ref = plan.installments[0]?.dueDate ?? plan.firstDate;
  const a = parseISO(ref), b = parseISO(date);
  const delta = (b.y * 12 + b.m) - (a.y * 12 + a.m);
  const atDay = (d: ISODate) => { const x = parseISO(d); return addMonths(`${x.y}-${String(x.m).padStart(2, '0')}-01`, delta, b.d); };
  const installments = plan.installments.map((r) => ({ ...r, dueDate: atDay(r.dueDate) }));
  if (installments.length) installments[0].dueDate = date;
  const p: Plan = {
    ...plan, installments, firstDate: date, anchorDay: b.d,
    originalEndDate: atDay(plan.originalEndDate),
    input: { ...plan.input, firstDate: date, fixedStartDate: null },
  };
  return { ok: true, value: touch(p), message: 'تم تغيير بداية الخطة ونقل مواعيد الأقساط.' };
}

/**
 * Record earlier installments as paid on their due dates (for a plan that started before it was entered).
 * `count` = number of first open installments; otherwise every open installment due before `today`.
 */
export function markPastInstallmentsPaid(plan: Plan, opts: { count?: number; today?: ISODate } = {}, unit = 1): Result<Plan> {
  const today = opts.today ?? todayISO();
  let p = plan;
  let n = 0;
  for (const r of plan.installments) {
    if (opts.count != null ? n >= opts.count : r.dueDate >= today) break;
    const row = p.installments.find((x) => x.id === r.id)!;
    if (row.closed || row.skipped || row.cancelled) continue;
    const amount = dueOf(p, row);
    if (amount <= 0) continue;
    const res = recordPayment(p, { date: row.dueDate, amount, kind: 'installment', installmentId: row.id, note: 'مدفوع سابقاً' }, unit);
    if (!res.ok) break;
    p = res.value;
    n++;
  }
  if (n === 0) return { ok: false, error: 'لا توجد أقساط سابقة غير مسجّلة.' };
  return { ok: true, value: touch(p), message: `تم تسجيل ${n} ${n === 1 ? 'قسط سابق' : 'أقساط سابقة'} كمدفوعة.` };
}

// ───────────────────────── derived view ─────────────────────────

export type RowStatus = 'paid' | 'paid-short' | 'partial' | 'overdue' | 'current' | 'upcoming' | 'skipped' | 'cancelled';

export interface ScheduleEntry {
  key: string;
  type: 'installment' | 'extra' | 'down';
  no: number | null;
  id: string;
  date: ISODate;
  planned: number | null;
  actual: number;
  balanceAfter: number;
  status: RowStatus | 'extra' | 'down';
  isFinal: boolean;
  isCurrentMonth: boolean;
  period: Period;
  overdue: boolean;
  note: string;
  index: number;
}

export function rowStatus(plan: Plan, r: Installment, today: ISODate): RowStatus {
  if (r.cancelled) return 'cancelled';
  if (r.skipped) return 'skipped';
  const pd = paidFor(plan, r.id);
  if (r.closed) return pd >= r.planned ? 'paid' : 'paid-short';
  if (pd > 0) return 'partial';
  if (r.dueDate < today) return 'overdue';
  if (sameMonth(r.dueDate, today)) return 'current';
  return 'upcoming';
}

export function finalIndex(plan: Plan): number {
  for (let i = plan.installments.length - 1; i >= 0; i--) {
    const r = plan.installments[i];
    if (!r.cancelled && !r.skipped) return i;
  }
  return -1;
}

/** Display number of an installment: counts only months that are part of the plan (cancelled rows are skipped). */
/**
 * Display numbers in one chronological sequence: installments and extra/down payments share it
 * (months no longer part of the plan are skipped). Keys are installment ids and payment ids.
 */
export function installmentNumbers(plan: Plan): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of buildSchedule(plan)) if (e.no != null) m.set(e.id, e.no);
  return m;
}

export function installmentNo(plan: Plan, id: string | null | undefined): number {
  return id ? installmentNumbers(plan).get(id) ?? 0 : 0;
}

export type Period = 'past' | 'current' | 'future';

export function periodOf(date: ISODate, today: ISODate): Period {
  const a = date.slice(0, 7), b = today.slice(0, 7);
  return a < b ? 'past' : a > b ? 'future' : 'current';
}

export function buildSchedule(plan: Plan, today: ISODate = todayISO()): ScheduleEntry[] {
  const fi = finalIndex(plan);
  type Ev = { order: number; date: ISODate; entry: Omit<ScheduleEntry, 'balanceAfter'>; deduct: number };
  const evs: Ev[] = [];
  plan.installments.forEach((r, i) => {
    if (r.cancelled) return; // months no longer part of the plan are not shown
    const pd = paidFor(plan, r.id);
    const st = rowStatus(plan, r, today);
    evs.push({
      order: 1, date: r.dueDate,
      deduct: pd + dueOf(plan, r),
      entry: {
        key: r.id, type: 'installment', no: 0, id: r.id, date: r.dueDate,
        planned: r.planned, actual: pd, status: st, isFinal: i === fi,
        isCurrentMonth: sameMonth(r.dueDate, today), period: periodOf(r.dueDate, today),
        overdue: !r.closed && !r.skipped && !r.cancelled && r.dueDate < today,
        note: r.note, index: i,
      },
    });
  });
  plan.payments.filter((x) => x.kind !== 'installment').forEach((x) => {
    evs.push({
      order: x.kind === 'down' ? 0 : 2, date: x.date, deduct: x.amount,
      entry: {
        key: x.id, type: x.kind as 'extra' | 'down', no: 0, id: x.id, date: x.date, planned: null,
        actual: x.amount, status: x.kind as 'extra' | 'down', isFinal: false,
        isCurrentMonth: sameMonth(x.date, today), period: periodOf(x.date, today), overdue: false, note: x.note, index: -1,
      },
    });
  });
  evs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order || a.entry.index - b.entry.index));
  let bal = plan.principal;
  let n = 0;
  return evs.map((e) => {
    bal -= e.deduct;
    return { ...e.entry, no: ++n, balanceAfter: bal };
  });
}

export interface PlanSummary {
  principal: number;
  totalPaid: number;
  outstanding: number;
  progress: number;
  currentInstallment: number;
  currentInstallmentDate: ISODate | null;
  paidCount: number;
  remainingCount: number;
  overdueCount: number;
  expectedEnd: ISODate | null;
  completed: boolean;
  totalPlanned: number;
  regular: number;
  finalAmount: number;
  fullInstallments: number;
  durationMonths: number;
}

export function summarize(plan: Plan, today: ISODate = todayISO()): PlanSummary {
  const paid = totalPaid(plan);
  const out = plan.principal - paid;
  const active = plan.installments.filter((r) => !r.cancelled && !r.skipped);
  const open = active.filter((r) => !r.closed);
  const next = open.find((r) => r.dueDate >= today.slice(0, 8) + '01') ?? open[0];
  const fi = finalIndex(plan);
  const finalRow = fi >= 0 ? plan.installments[fi] : null;
  const regular = regularAmount(plan);
  const lastPay = [...plan.payments].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return {
    principal: plan.principal,
    totalPaid: paid,
    outstanding: out,
    progress: plan.principal > 0 ? Math.min(100, (paid / plan.principal) * 100) : 0,
    currentInstallment: next ? dueOf(plan, next) : 0,
    currentInstallmentDate: next?.dueDate ?? null,
    // paid installments + extra/down payments (they are part of the same sequence)
    paidCount: active.filter((r) => r.closed).length + plan.payments.filter((x) => x.kind !== 'installment').length,
    remainingCount: open.length,
    overdueCount: open.filter((r) => r.dueDate < today).length,
    expectedEnd: out <= 0 ? lastPay?.date ?? finalRow?.dueDate ?? null : finalRow?.dueDate ?? null,
    completed: out <= 0,
    totalPlanned: sum(active.map((r) => r.planned)),
    regular,
    finalAmount: finalRow?.planned ?? 0,
    fullInstallments: active.filter((r) => r.planned === regular).length,
    durationMonths: active.length,
  };
}

/** Self-check of the financial invariants; returns a list of violations (empty = OK). */
export function checkInvariants(plan: Plan): string[] {
  const errs: string[] = [];
  const out = outstanding(plan);
  if (out < 0) errs.push('outstanding < 0');
  if (plan.installments.some((r) => r.planned < 0)) errs.push('negative installment');
  if (plan.payments.some((p) => p.amount <= 0)) errs.push('non-positive payment');
  const dueSum = sum(plan.installments.map((r) => dueOf(plan, r)));
  if (dueSum !== out) errs.push(`open dues ${dueSum} ≠ outstanding ${out}`);
  const sched = buildSchedule(plan);
  if (sched.length && sched[sched.length - 1].balanceAfter !== 0) errs.push(`final projected balance ${sched[sched.length - 1].balanceAfter}`);
  const ids = new Set(plan.payments.map((p) => p.id));
  if (ids.size !== plan.payments.length) errs.push('duplicate payment ids');
  return errs;
}
