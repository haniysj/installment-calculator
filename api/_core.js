// Shared logic of the cloud endpoint. `query(text, params)` returns rows (Neon on Vercel, pg locally in tests).
const CALLS = {
  status: { sql: 'select installments.ic_status() as r', args: () => [] },
  setup: { sql: 'select installments.ic_setup($1) as r', args: (a) => [str(a.pin, 12)] },
  unlock: { sql: 'select installments.ic_unlock($1) as r', args: (a) => [str(a.pin, 12)] },
  sync: { sql: 'select installments.ic_sync($1, $2::jsonb, $3) as r', args: (a) => [str(a.token, 200), JSON.stringify(Array.isArray(a.changes) ? a.changes : []), Number.isFinite(a.since) ? Math.max(0, Math.floor(a.since)) : 0] },
  logout: { sql: 'select installments.ic_logout($1) as r', args: (a) => [str(a.token, 200)] },
};

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** @returns {Promise<{status:number, body:any}>} */
export async function handle(query, method, body) {
  if (method === 'GET') {
    try { await query('select 1', []); return { status: 200, body: { ok: true } }; }
    catch { return { status: 503, body: { ok: false } }; }
  }
  if (method !== 'POST') return { status: 405, body: { message: 'METHOD' } };
  const call = body && CALLS[body.fn];
  if (!call) return { status: 400, body: { message: 'IC_BAD_INPUT' } };
  try {
    const rows = await query(call.sql, call.args(body.args || {}));
    return { status: 200, body: rows[0] ? rows[0].r : null };
  } catch (e) {
    const m = /IC_[A-Z_]+(?::\d+)?/.exec(String(e && e.message));
    if (m) return { status: 400, body: { message: m[0] } };
    console.error('ic error', e);
    return { status: 500, body: { message: 'SERVER' } };
  }
}
