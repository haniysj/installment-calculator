import { describe, expect, it } from 'vitest';
import {
  addInstallment, buildSchedule, changeFixedAmount, changePrincipal, checkInvariants, createPlan, deleteInstallment,
  deletePayment, editInstallment, equalSplit, fixedSplit, outstanding, paidFor, postponeInstallment, recordPayment,
  resetPlan, restoreDefault, skipInstallment, summarize,
} from '../src/lib/engine';
import { addMonths, monthsInclusive } from '../src/lib/dates';
import { formatAmount, parseRial } from '../src/lib/money';
import type { Plan, PlanInput } from '../src/lib/types';

const R = (rial: number) => Math.round(rial * 1000); // rial → baisa
const TODAY = '2026-10-18';

function make(input: Partial<PlanInput>): Plan {
  const r = createPlan({ name: 'test', principal: R(1000), firstDate: '2026-11-01', mode: 'flexible', method: 'months', months: 10, ...input });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
const ok = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const amounts = (p: Plan) => p.installments.filter((r) => !r.cancelled).map((r) => r.planned / 1000);
const valid = (p: Plan) => expect(checkInvariants(p)).toEqual([]);

describe('money / baisa precision', () => {
  it('parses rial strings into integer baisa', () => {
    expect(parseRial('150')).toBe(150000);
    expect(parseRial('1,250.5')).toBe(1250500);
    expect(parseRial('١٥٠٫٧٥')).toBe(150750);
    expect(parseRial('0.1')! + parseRial('0.2')!).toBe(300); // no 0.30000000000000004
    expect(parseRial('12.3456')).toBe(12346);
    expect(parseRial('abc')).toBeNull();
  });
  it('formats with 3 or 2 decimals', () => {
    expect(formatAmount(1250500)).toBe('1,250.500');
    expect(formatAmount(1250505, 2)).toBe('1,250.51');
  });
});

describe('equal installments', () => {
  it('splits evenly with the remainder in the final installment', () => {
    expect(equalSplit(R(1000), 3)).toEqual([333333, 333333, 333334]);
    const p = make({ principal: R(1000), months: 3 });
    expect(p.installments.map((r) => r.planned)).toEqual([333333, 333333, 333334]);
    valid(p);
  });
  it('rounding unit of 10 baisa (2 decimals) still sums exactly', () => {
    const p = ok(createPlan({ name: 'x', principal: R(100), firstDate: '2026-01-31', mode: 'flexible', method: 'months', months: 7 }, 10));
    expect(p.installments.slice(0, 6).every((r) => r.planned % 10 === 0)).toBe(true);
    expect(p.installments.reduce((a, r) => a + r.planned, 0)).toBe(R(100));
    valid(p);
  });
});

describe('fixed monthly installment (تثبيت القسط الشهري)', () => {
  it('1,000 at 150/month → 6 × 150 + final 100 = 7 months', () => {
    expect(fixedSplit(R(1000), R(150)).map((x) => x / 1000)).toEqual([150, 150, 150, 150, 150, 150, 100]);
    const p = make({ mode: 'fixed', fixedAmount: R(150) });
    const s = summarize(p, TODAY);
    expect(amounts(p)).toEqual([150, 150, 150, 150, 150, 150, 100]);
    expect(s.durationMonths).toBe(7);
    expect(s.finalAmount).toBe(R(100));
    expect(s.fullInstallments).toBe(6);
    expect(s.totalPlanned).toBe(R(1000));
    expect(s.expectedEnd).toBe('2027-05-01');
    const bal = buildSchedule(p, TODAY).map((e) => e.balanceAfter / 1000);
    expect(bal).toEqual([850, 700, 550, 400, 250, 100, 0]);
    valid(p);
  });
  it('installment ≥ balance → one installment', () => {
    expect(amounts(make({ mode: 'fixed', fixedAmount: R(1000) }))).toEqual([1000]);
    expect(amounts(make({ mode: 'fixed', fixedAmount: R(5000) }))).toEqual([1000]);
  });
  it('zero or negative installment is rejected', () => {
    const r1 = createPlan({ name: 'x', principal: R(1000), firstDate: '2026-11-01', mode: 'fixed', method: 'months', fixedAmount: 0 });
    const r2 = createPlan({ name: 'x', principal: R(1000), firstDate: '2026-11-01', mode: 'fixed', method: 'months', fixedAmount: -5 });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });
  it('down payment and a separate start date for the fixed schedule', () => {
    const p = make({ mode: 'fixed', fixedAmount: R(150), downPayment: R(100), fixedStartDate: '2026-12-15' });
    expect(amounts(p)).toEqual([150, 150, 150, 150, 150, 150]);
    expect(p.installments[0].dueDate).toBe('2026-12-15');
    expect(outstanding(p)).toBe(R(900));
    valid(p);
  });
  it('changing the fixed amount recalculates the whole future schedule and end date', () => {
    let p = make({ mode: 'fixed', fixedAmount: R(150) });
    p = ok(changeFixedAmount(p, R(300)));
    expect(amounts(p)).toEqual([300, 300, 300, 100]);
    expect(summarize(p, TODAY).expectedEnd).toBe('2027-02-01');
    valid(p);
  });
  it('changing the balance recalculates duration', () => {
    let p = make({ mode: 'fixed', fixedAmount: R(150) });
    p = ok(changePrincipal(p, R(1200)));
    expect(amounts(p)).toEqual([150, 150, 150, 150, 150, 150, 150, 150]);
    p = ok(changePrincipal(p, R(400)));
    expect(amounts(p)).toEqual([150, 150, 100]);
    valid(p);
  });
});

describe('date-based duration', () => {
  it('counts months inclusively', () => {
    expect(monthsInclusive('2026-11-01', '2027-10-01')).toBe(12);
    expect(monthsInclusive('2026-11-20', '2026-11-25')).toBe(1);
    const p = make({ method: 'endDate', endDate: '2027-04-30', months: null });
    expect(p.installments.length).toBe(6);
    valid(p);
  });
  it('keeps the anchor day across short months', () => {
    expect(addMonths('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2, 31)).toBe('2026-03-31');
    const p = make({ firstDate: '2027-01-31', months: 3 });
    expect(p.installments.map((r) => r.dueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });
  it('rejects an end date before the first date', () => {
    expect(createPlan({ name: 'x', principal: R(10), firstDate: '2026-11-01', mode: 'flexible', method: 'endDate', endDate: '2026-10-01' }).ok).toBe(false);
  });
});

describe('flexible: editing an installment', () => {
  it('preserves earlier rows and redistributes later rows equally', () => {
    let p = make({ months: 5 }); // 200 × 5
    p = ok(editInstallment(p, p.installments[1].id, R(400)));
    expect(amounts(p)).toEqual([200, 400, 133.333, 133.333, 133.334]);
    valid(p);
  });
  it('can switch later rows to a fixed installment', () => {
    let p = make({ months: 5 });
    p = ok(editInstallment(p, p.installments[0].id, R(300), 'fixed'));
    expect(amounts(p)).toEqual([300, 300, 300, 100]);
    expect(p.installments[4].cancelled).toBe(true);
    valid(p);
  });
  it('rejects negative amounts and amounts above the balance', () => {
    const p = make({ months: 5 });
    expect(editInstallment(p, p.installments[1].id, -1).ok).toBe(false);
    expect(editInstallment(p, p.installments[1].id, R(900)).ok).toBe(false); // only 800 left before row 2
    expect(editInstallment(p, p.installments[1].id, R(800)).ok).toBe(true);
  });
  it('early settlement via edit cancels later rows', () => {
    let p = make({ months: 5 });
    p = ok(editInstallment(p, p.installments[1].id, R(800)));
    expect(amounts(p)).toEqual([200, 800]);
    expect(p.installments.slice(2).every((r) => r.cancelled)).toBe(true);
    expect(summarize(p, TODAY).durationMonths).toBe(2);
    valid(p);
  });
});

describe('payments', () => {
  it('a planned installment is not paid until recorded', () => {
    const p = make({ months: 5, firstDate: '2026-01-01' });
    expect(summarize(p, TODAY).paidCount).toBe(0);
    expect(outstanding(p)).toBe(R(1000));
    expect(buildSchedule(p, TODAY).filter((e) => e.status === 'overdue').length).toBe(5);
  });
  it('full payment closes the row', () => {
    let p = make({ months: 5 });
    p = ok(recordPayment(p, { date: '2026-11-01', amount: R(200), kind: 'installment', installmentId: p.installments[0].id }));
    expect(p.installments[0].closed).toBe(true);
    expect(outstanding(p)).toBe(R(800));
    valid(p);
  });
  it('partial payment reduces the balance only by the amount received', () => {
    let p = make({ months: 5 });
    p = ok(recordPayment(p, { date: '2026-11-01', amount: R(50), kind: 'installment', installmentId: p.installments[0].id }));
    expect(outstanding(p)).toBe(R(950));
    expect(p.installments[0].closed).toBe(false);
    expect(paidFor(p, p.installments[0].id)).toBe(R(50));
    expect(amounts(p)).toEqual([200, 200, 200, 200, 200]);
    valid(p);
    // completing the rest of the row
    p = ok(recordPayment(p, { date: '2026-11-05', amount: R(150), kind: 'installment', installmentId: p.installments[0].id }));
    expect(p.installments[0].closed).toBe(true);
    expect(p.payments.length).toBe(2);
    valid(p);
  });
  it('partial payment can close the row and carry the shortfall forward', () => {
    let p = make({ months: 5 });
    p = ok(recordPayment(p, { date: '2026-11-01', amount: R(120), kind: 'installment', installmentId: p.installments[0].id, closeRow: true }));
    expect(amounts(p)).toEqual([200, 220, 220, 220, 220]);
    valid(p);
  });
  it('overpaying an installment reduces later installments', () => {
    let p = make({ months: 5 });
    p = ok(recordPayment(p, { date: '2026-11-01', amount: R(400), kind: 'installment', installmentId: p.installments[0].id }));
    expect(amounts(p)).toEqual([200, 150, 150, 150, 150]);
    expect(buildSchedule(p, TODAY)[0].balanceAfter).toBe(R(600));
    valid(p);
  });
  it('payment above the outstanding balance is rejected', () => {
    const p = make({ months: 5 });
    expect(recordPayment(p, { date: '2026-11-01', amount: R(1001), kind: 'extra' }).ok).toBe(false);
    expect(recordPayment(p, { date: '2026-11-01', amount: 0, kind: 'extra' }).ok).toBe(false);
  });
});

describe('extra payments', () => {
  it('shorten: keeps the installment and shortens the duration', () => {
    let p = make({ mode: 'fixed', fixedAmount: R(150) });
    p = ok(recordPayment(p, { date: '2026-11-15', amount: R(300), kind: 'extra', extraStrategy: 'shorten' }));
    expect(amounts(p)).toEqual([150, 150, 150, 150, 100]);
    expect(summarize(p, TODAY).expectedEnd).toBe('2027-03-01');
    valid(p);
  });
  it('reduce: keeps the end date and lowers future installments', () => {
    let p = make({ months: 5 });
    p = ok(recordPayment(p, { date: '2026-10-20', amount: R(250), kind: 'extra', extraStrategy: 'reduce' }));
    expect(amounts(p)).toEqual([150, 150, 150, 150, 150]);
    expect(summarize(p, TODAY).expectedEnd).toBe('2027-03-01');
    valid(p);
  });
  it('does not touch closed rows or duplicate payments', () => {
    let p = make({ months: 5 });
    const first = p.installments[0].id;
    p = ok(recordPayment(p, { date: '2026-11-01', amount: R(200), kind: 'installment', installmentId: first }));
    p = ok(recordPayment(p, { date: '2026-11-10', amount: R(200), kind: 'extra', extraStrategy: 'reduce' }));
    expect(p.installments[0].planned).toBe(R(200));
    expect(p.installments[0].closed).toBe(true);
    expect(p.payments.length).toBe(2);
    expect(amounts(p)).toEqual([200, 150, 150, 150, 150]);
    valid(p);
  });
});

describe('early settlement', () => {
  it('paying the full balance cancels remaining rows', () => {
    let p = make({ mode: 'fixed', fixedAmount: R(150) });
    p = ok(recordPayment(p, { date: '2026-11-01', amount: R(150), kind: 'installment', installmentId: p.installments[0].id }));
    p = ok(recordPayment(p, { date: '2026-11-20', amount: R(850), kind: 'extra' }));
    const s = summarize(p, TODAY);
    expect(s.outstanding).toBe(0);
    expect(s.completed).toBe(true);
    expect(s.durationMonths).toBe(1);
    expect(p.installments.slice(1).every((r) => r.cancelled)).toBe(true);
    expect(recordPayment(p, { date: '2026-11-21', amount: 1, kind: 'extra' }).ok).toBe(false);
    valid(p);
  });
  it('settling while a row is partially paid closes that row at what was paid', () => {
    let p = make({ months: 5 });
    p = ok(recordPayment(p, { date: '2026-11-01', amount: R(50), kind: 'installment', installmentId: p.installments[0].id }));
    p = ok(recordPayment(p, { date: '2026-11-02', amount: R(950), kind: 'extra' }));
    expect(p.installments[0].closed).toBe(true);
    expect(p.installments[0].planned).toBe(R(50));
    valid(p);
  });
});

describe('schedule operations', () => {
  it('skip redistributes, postpone shifts dates, delete removes', () => {
    let p = make({ months: 4 }); // 250 × 4
    p = ok(skipInstallment(p, p.installments[1].id));
    expect(p.installments[1].skipped).toBe(true);
    expect(amounts(p)).toEqual([250, 0, 375, 375]);
    valid(p);
    p = ok(postponeInstallment(p, p.installments[2].id));
    expect(p.installments[2].dueDate).toBe('2027-02-01');
    expect(p.installments[3].dueDate).toBe('2027-03-01');
    let q = make({ months: 4 });
    q = ok(deleteInstallment(q, q.installments[3].id));
    expect(amounts(q)).toEqual([333.333, 333.333, 333.334]);
    valid(q);
    q = ok(addInstallment(q));
    expect(amounts(q)).toEqual([250, 250, 250, 250]);
    valid(q);
  });
  it('custom mode: last installment absorbs edits', () => {
    let p = make({ mode: 'custom', months: 4 });
    p = ok(editInstallment(p, p.installments[0].id, R(100)));
    expect(amounts(p)).toEqual([100, 250, 250, 400]);
    p = ok(editInstallment(p, p.installments[1].id, R(600)));
    expect(amounts(p)).toEqual([100, 600, 250, 50]);
    valid(p);
  });
  it('deleting a payment reopens the row and recalculates', () => {
    let p = make({ months: 5 });
    p = ok(recordPayment(p, { date: '2026-11-01', amount: R(400), kind: 'installment', installmentId: p.installments[0].id }));
    p = ok(deletePayment(p, p.payments[0].id));
    expect(p.installments[0].closed).toBe(false);
    expect(outstanding(p)).toBe(R(1000));
    expect(amounts(p)).toEqual([200, 200, 200, 200, 200]);
    valid(p);
  });
  it('restore default keeps recorded payments; reset clears everything', () => {
    let p = make({ months: 5 });
    p = ok(recordPayment(p, { date: '2026-11-01', amount: R(200), kind: 'installment', installmentId: p.installments[0].id }));
    p = ok(editInstallment(p, p.installments[1].id, R(500)));
    p = ok(restoreDefault(p));
    expect(amounts(p)).toEqual([200, 200, 200, 200, 200]);
    expect(p.payments.length).toBe(1);
    valid(p);
    p = ok(resetPlan(p));
    expect(p.payments.length).toBe(0);
    expect(outstanding(p)).toBe(R(1000));
    valid(p);
  });
  it('invariant: principal = paid + outstanding after a long random session', () => {
    let p = make({ principal: R(4321.987), months: 12 });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 60; k++) {
      const open = p.installments.filter((r) => !r.closed && !r.skipped && !r.cancelled);
      if (!open.length) break;
      const row = open[Math.floor(rnd() * open.length)];
      const out = outstanding(p);
      const action = Math.floor(rnd() * 4);
      let r;
      if (action === 0) r = recordPayment(p, { date: row.dueDate, amount: Math.max(1, Math.min(out, Math.floor(rnd() * row.planned * 1.5))), kind: 'installment', installmentId: row.id, closeRow: rnd() > 0.5 });
      else if (action === 1) r = recordPayment(p, { date: row.dueDate, amount: Math.max(1, Math.floor(rnd() * out * 0.2)), kind: 'extra', extraStrategy: rnd() > 0.5 ? 'shorten' : 'reduce' });
      else if (action === 2) r = editInstallment(p, row.id, Math.floor(rnd() * row.planned * 2), rnd() > 0.5 ? 'equal' : 'keep');
      else r = postponeInstallment(p, row.id);
      if (r.ok) p = r.value;
      valid(p);
      expect(p.principal).toBe(p.payments.reduce((a, x) => a + x.amount, 0) + outstanding(p));
    }
  });
});

describe('schedule view follows the plan', () => {
  it('hides months that are no longer part of the plan and renumbers', () => {
    let p = make({ mode: 'fixed', fixedAmount: R(150), firstDate: '2026-09-01' });
    p = ok(recordPayment(p, { date: '2026-09-01', amount: R(150), kind: 'installment', installmentId: p.installments[0].id }));
    p = ok(recordPayment(p, { date: '2026-09-20', amount: R(300), kind: 'extra', extraStrategy: 'shorten' }));
    const s = buildSchedule(p, TODAY);
    expect(s.some((e) => e.status === 'cancelled')).toBe(false);
    const nos = s.filter((e) => e.type === 'installment').map((e) => e.no);
    expect(nos).toEqual([1, 2, 3, 4, 5]);
    expect(s[s.length - 1].balanceAfter).toBe(0);
  });
  it('orders paid months and extra payments by date: past, current, future', () => {
    let p = make({ months: 4, firstDate: '2026-09-05' }); // Sep, Oct, Nov, Dec
    p = ok(recordPayment(p, { date: '2026-09-05', amount: R(250), kind: 'installment', installmentId: p.installments[0].id }));
    p = ok(recordPayment(p, { date: '2026-09-25', amount: R(100), kind: 'extra', extraStrategy: 'reduce' }));
    const s = buildSchedule(p, TODAY);
    expect(s.map((e) => e.date)).toEqual([...s.map((e) => e.date)].sort());
    expect(s.map((e) => e.type)).toEqual(['installment', 'extra', 'installment', 'installment', 'installment']);
    expect(s.map((e) => e.period)).toEqual(['past', 'past', 'current', 'future', 'future']);
  });
});

describe('whole rials (no decimals)', () => {
  it('formats without decimals and splits in whole rials', () => {
    expect(formatAmount(1250500, 0)).toBe('1,251');
    expect(formatAmount(150000, 0)).toBe('150');
    const p = ok(createPlan({ name: 'x', principal: R(1000), firstDate: '2026-11-01', mode: 'flexible', method: 'months', months: 3 }, 1000));
    expect(p.installments.map((r) => r.planned / 1000)).toEqual([333, 333, 334]);
    const q = ok(editInstallment(p, p.installments[0].id, R(400), 'equal', 1000));
    expect(q.installments.map((r) => r.planned / 1000)).toEqual([400, 300, 300]);
    const z = ok(recordPayment(p, { date: '2026-11-01', amount: R(100), kind: 'extra', extraStrategy: 'reduce' }, 1000));
    expect(z.installments.map((r) => r.planned / 1000)).toEqual([300, 300, 300]);
  });
});
