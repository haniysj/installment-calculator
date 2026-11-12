// Pure two-way sync logic (no network, no storage) — per-plan "newest change wins".
import { validatePlan } from './backup';
import type { Plan } from './types';

export interface Tombstone { id: string; at: string }

export interface SyncMeta {
  /** session token from the server (null = cloud saving is off on this device) */
  token: string | null;
  username: string | null;
  /** last server change number this device has seen */
  cursor: number;
  lastSyncAt: string | null;
  /** plans changed on this device and not yet confirmed by the server */
  dirty: string[];
  /** plans deleted on this device and not yet confirmed by the server */
  tombstones: Tombstone[];
}

export const EMPTY_SYNC_META: SyncMeta = { token: null, username: null, cursor: 0, lastSyncAt: null, dirty: [], tombstones: [] };

export interface Change { id: string; data?: Plan; deleted?: boolean; updatedAt: string }
export interface RemoteRow { id: string; data: Plan | null; deleted: boolean; updatedAt: string }

export function buildChanges(plans: Plan[], meta: SyncMeta): Change[] {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const out: Change[] = [];
  for (const id of new Set(meta.dirty)) {
    const p = byId.get(id);
    if (p) out.push({ id, data: p, updatedAt: p.updatedAt });
  }
  for (const t of meta.tombstones) if (!byId.has(t.id)) out.push({ id: t.id, deleted: true, updatedAt: t.at });
  return out;
}

/**
 * Merge rows that came from the server into the local plans.
 * A server copy replaces the local one only when it is newer; a local change not yet sent is kept when it is newer.
 */
export function applyRemote(plans: Plan[], rows: RemoteRow[]): { plans: Plan[]; saved: Plan[]; removed: string[] } {
  const map = new Map(plans.map((p) => [p.id, p]));
  const saved: Plan[] = [];
  const removed: string[] = [];
  for (const r of rows) {
    const local = map.get(r.id);
    if (r.deleted) {
      if (local && local.updatedAt <= r.updatedAt) { map.delete(r.id); removed.push(r.id); }
      continue;
    }
    if (!r.data || validatePlan(r.data, 1) !== null) continue; // ignore anything malformed
    if (!local || r.updatedAt > local.updatedAt) { map.set(r.id, r.data); saved.push(r.data); }
  }
  const merged = [...map.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { plans: merged, saved, removed };
}

/** After a successful sync: forget the changes the server has confirmed. */
export function afterSync(meta: SyncMeta, sent: Change[], plans: Plan[], cursor: number, now: string): SyncMeta {
  const sentAt = new Map(sent.map((c) => [c.id, c.updatedAt]));
  const byId = new Map(plans.map((p) => [p.id, p]));
  const dirty = [...new Set(meta.dirty)].filter((id) => {
    const p = byId.get(id);
    if (!p) return false;
    const at = sentAt.get(id);
    return !(at && p.updatedAt <= at);
  });
  const tombstones = meta.tombstones.filter((t) => sentAt.get(t.id) !== t.at);
  return { ...meta, cursor, lastSyncAt: now, dirty, tombstones };
}
