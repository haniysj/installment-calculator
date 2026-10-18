import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, type Plan, type Settings } from './types';

interface SettingsRow extends Settings { key: 'app' }

class InstallmentDB extends Dexie {
  plans!: Table<Plan, string>;
  settings!: Table<SettingsRow, string>;
  constructor(name = 'installment-calculator') {
    super(name);
    this.version(1).stores({ plans: 'id, name, updatedAt', settings: 'key' });
  }
}

export let db = new InstallmentDB();

/** for tests */
export function useDatabase(name: string) {
  db = new InstallmentDB(name);
  return db;
}

export async function loadPlans(): Promise<Plan[]> {
  const plans = await db.plans.toArray();
  return plans.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function savePlan(plan: Plan): Promise<void> {
  await db.plans.put(plan);
}

export async function deletePlanFromDB(id: string): Promise<void> {
  await db.plans.delete(id);
}

export async function replaceAllPlans(plans: Plan[]): Promise<void> {
  await db.transaction('rw', db.plans, async () => {
    await db.plans.clear();
    await db.plans.bulkPut(plans);
  });
}

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get('app');
  if (!row) return { ...DEFAULT_SETTINGS };
  const { key: _k, ...rest } = row;
  const s = { ...DEFAULT_SETTINGS, ...rest };
  // v2: amounts are shown without decimals by default
  if ((rest.settingsVersion ?? 1) < 2) { s.decimals = 0; s.settingsVersion = 2; }
  return s;
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.settings.put({ ...s, key: 'app' });
}

/** Ask the browser not to evict our data (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
