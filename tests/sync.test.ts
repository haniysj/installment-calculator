import { describe, expect, it } from 'vitest';
import { afterSync, applyRemote, buildChanges, EMPTY_SYNC_META, type SyncMeta } from '../src/lib/sync';
import { createPlan } from '../src/lib/engine';
import type { Plan } from '../src/lib/types';

function plan(name: string, updatedAt: string): Plan {
  const r = createPlan({ name, principal: 1_000_000, firstDate: '2026-11-01', mode: 'fixed', method: 'months', fixedAmount: 150_000 });
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, updatedAt };
}
const meta = (m: Partial<SyncMeta>): SyncMeta => ({ ...EMPTY_SYNC_META, token: 't', ...m });

describe('cloud sync rules', () => {
  it('sends changed plans and deletions', () => {
    const a = plan('أ', '2026-11-12T10:00:00.000Z');
    const ch = buildChanges([a], meta({ dirty: [a.id, 'gone'], tombstones: [{ id: 'old', at: '2026-11-12T11:00:00.000Z' }] }));
    expect(ch).toEqual([{ id: a.id, data: a, updatedAt: a.updatedAt }, { id: 'old', deleted: true, updatedAt: '2026-11-12T11:00:00.000Z' }]);
  });
  it('takes newer server copies, keeps newer local ones, adds new ones', () => {
    const a = plan('أ', '2026-11-12T10:00:00.000Z');
    const b = plan('ب', '2026-11-12T10:00:00.000Z');
    const c = plan('ج', '2026-11-12T09:00:00.000Z');
    const r = applyRemote([a, b], [
      { id: a.id, data: { ...a, name: 'أ من السحابة', updatedAt: '2026-11-12T12:00:00.000Z' }, deleted: false, updatedAt: '2026-11-12T12:00:00.000Z' },
      { id: b.id, data: { ...b, name: 'ب قديمة' }, deleted: false, updatedAt: '2026-11-12T08:00:00.000Z' },
      { id: c.id, data: c, deleted: false, updatedAt: c.updatedAt },
    ]);
    const names = Object.fromEntries(r.plans.map((p) => [p.id, p.name]));
    expect(names[a.id]).toBe('أ من السحابة');
    expect(names[b.id]).toBe('ب');
    expect(names[c.id]).toBe('ج');
    expect(r.saved.map((p) => p.name).sort()).toEqual(['أ من السحابة', 'ج'].sort());
  });
  it('applies remote deletions unless the local copy is newer; ignores malformed data', () => {
    const a = plan('أ', '2026-11-12T10:00:00.000Z');
    const b = plan('ب', '2026-11-12T13:00:00.000Z');
    const r = applyRemote([a, b], [
      { id: a.id, data: null, deleted: true, updatedAt: '2026-11-12T11:00:00.000Z' },
      { id: b.id, data: null, deleted: true, updatedAt: '2026-11-12T11:00:00.000Z' },
      { id: 'bad', data: { nonsense: true } as any, deleted: false, updatedAt: '2026-11-12T11:00:00.000Z' },
    ]);
    expect(r.plans.map((p) => p.name)).toEqual(['ب']);
    expect(r.removed).toEqual([a.id]);
  });
  it('forgets only what the server confirmed', () => {
    const a = plan('أ', '2026-11-12T10:00:00.000Z');
    const edited = { ...a, updatedAt: '2026-11-12T10:05:00.000Z' }; // edited again while the request was running
    const sent = [{ id: a.id, data: a, updatedAt: a.updatedAt }, { id: 'old', deleted: true, updatedAt: 'x' }];
    const m = afterSync(meta({ dirty: [a.id], tombstones: [{ id: 'old', at: 'x' }, { id: 'new', at: 'y' }] }), sent, [edited], 42, 'now');
    expect(m.dirty).toEqual([a.id]);
    expect(m.tombstones).toEqual([{ id: 'new', at: 'y' }]);
    expect(m.cursor).toBe(42);
    expect(afterSync(meta({ dirty: [a.id] }), sent, [a], 43, 'now').dirty).toEqual([]);
  });
});
