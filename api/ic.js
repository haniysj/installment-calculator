// Vercel serverless function: the only door to the Neon database. DATABASE_URL is set by the Vercel ↔ Neon integration.
import { neon } from '@neondatabase/serverless';
import { handle } from './_core.js';

let sql;
const query = (text, params) => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  sql ??= neon(url);
  return sql.query(text, params);
};

export default async function handler(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const out = await handle(query, req.method, body);
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
