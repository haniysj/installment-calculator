// Local test server: serves dist/ and /api/ic backed by a local Postgres (same SQL and same endpoint logic as on Vercel).
// Usage: DATABASE_URL=postgres://... node scripts/local-server.mjs 4180
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { handle } from '../api/_core.js';

const port = Number(process.argv[2] || 4180);
const root = path.resolve('dist');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const query = async (text, params) => (await pool.query(text, params)).rows;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ic') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* bad json */ }
    if (process.env.OFFLINE_API) { res.writeHead(503); return res.end(); }
    const out = await handle(query, req.method, body);
    res.writeHead(out.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(out.body));
  }
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('local server on', port));
