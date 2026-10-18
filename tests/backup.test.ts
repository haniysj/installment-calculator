import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildBackup, mergePlans, parseBackup } from '../src/lib/backup';
import { createPlan, recordPayment } from '../src/lib/engine';
import { loadPlans, replaceAllPlans, savePlan, useDatabase } from '../src/lib/db';
import { scheduleToCSV } from '../src/lib/csv';
import { DEFAULT_SETTINGS, type Plan } from '../src/lib/types';

function samplePlan(name = 'سيارة'): Plan {
  const r = createPlan({ name, principal: 1_000_000, firstDate: '2026-11-01', mode: 'fixed', method: 'months', fixedAmount: 150_000 });
  if (!r.ok) throw new Error(r.error);
  const p = recordPayment(r.value, { date: '2026-11-01', amount: 150_000, kind: 'installment', installmentId: r.value.installments[0].id });
  if (!p.ok) throw new Error(p.error);
  return p.value;
}

describe('backup and restore', () => {
  it('round-trips plans through JSON', () => {
    const plans = [samplePlan(), samplePlan('بيت')];
    const text = JSON.stringify(buildBackup(plans, DEFAULT_SETTINGS));
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.plans).toEqual(plans);
      expect(parsed.settings?.decimals).toBe(0);
    }
  });
  it('rejects invalid files with a clear message', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{"app":"other","version":1,"plans":[]}').ok).toBe(false);
    const bad = buildBackup([samplePlan()]);
    (bad.plans[0] as any).payments[0].amount = -5;
    const r = parseBackup(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    const tooMuch = buildBackup([samplePlan()]);
    tooMuch.plans[0].payments[0].amount = 9_999_999;
    expect(parseBackup(JSON.stringify(tooMuch)).ok).toBe(false);
  });
  it('merge replaces same-id plans, replace drops others', () => {
    const a = samplePlan('أ');
    const b = samplePlan('ب');
    const a2 = { ...a, name: 'أ المعدلة' };
    expect(mergePlans([a, b], [a2], 'merge').map((p) => p.name).sort()).toEqual(['أ المعدلة', 'ب'].sort());
    expect(mergePlans([a, b], [a2], 'replace').map((p) => p.name)).toEqual(['أ المعدلة']);
  });
  it('restores into IndexedDB', async () => {
    useDatabase('test-db-' + Math.random());
    const a = samplePlan('أ');
    await savePlan(a);
    const backup = parseBackup(JSON.stringify(buildBackup([samplePlan('ب')])));
    if (!backup.ok) throw new Error();
    await replaceAllPlans(mergePlans(await loadPlans(), backup.plans, 'merge'));
    const names = (await loadPlans()).map((p) => p.name).sort();
    expect(names).toEqual(['أ', 'ب'].sort());
  });
});

describe('CSV export', () => {
  it('includes BOM, details, every row and totals', () => {
    const csv = scheduleToCSV(samplePlan(), 3, '2026-10-18');
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('سيارة');
    expect(csv).toContain('1000.000');
    expect(csv).toContain('القسط الأخير');
    expect(lines.filter((l) => /^\d+,/.test(l)).length).toBe(7);
    expect(lines[lines.length - 1]).toContain('850.000');
  });
});
