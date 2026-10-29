/** Optional Render/Node host for the Tutu Tumble Community Ledger.
 * A private, local-first evidence notebook. Never exposes Apify credentials or evidence.
 * Configure TT_SITE_USER + TT_SITE_PASSWORD to require HTTP Basic Auth.
 * Misconfiguration fails closed in production.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { handler as pullPublic } from './netlify/functions/pull-public.mjs';

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 10000);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const headers = {
  'Cache-Control': 'no-store, private',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const equal = (a, b) => {
  const x = Buffer.from(String(a ?? '')); const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};
function authorized(req) {
  const user = process.env.TT_SITE_USER, password = process.env.TT_SITE_PASSWORD;
  if (!user || !password || password.length < 16) return null;
  const value = req.headers.authorization || '';
  if (!value.startsWith('Basic ')) return false;
  let auth;
  try { auth = Buffer.from(value.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const delimiter = auth.indexOf(':');
  return delimiter > -1 && equal(auth.slice(0, delimiter), user) && equal(auth.slice(delimiter + 1), password);
}
const send = (res, code, data, extra = {}) => {
  res.writeHead(code, { ...headers, ...extra });
  res.end(data);
};
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
    const isAuth = authorized(req);
    if (isAuth === null) return send(res, 503, 'Private access not configured', {'Content-Type':'text/plain; charset=utf-8'});
    if (!isAuth) return send(res, 401, 'Authentication required', {
      'WWW-Authenticate':'Basic realm="Community Ledger", charset="UTF-8"',
      'Content-Type':'text/plain; charset=utf-8',
    });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', {'Allow':'GET, HEAD'});
    const route = new URL(req.url || '/', 'http://localhost').pathname;
    if (route === '/.netlify/functions/pull-public' || route === '/api/pull-public') {
      const result = await pullPublic({httpMethod:'GET',headers:req.headers});
      return send(res, result.statusCode, req.method === 'HEAD' ? '' : result.body, result.headers);
    }
    const decoded = decodeURIComponent(route);
    if (decoded.includes('\\') || decoded.includes('\0')) return send(res, 400, 'Invalid path');
    const path = normalize(join(publicRoot, decoded === '/' ? '' : decoded));
    if (path !== publicRoot && !path.startsWith(publicRoot + sep)) return send(res, 403, 'Forbidden');
    const file = path === publicRoot ? join(publicRoot, 'index.html') : path;
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) return send(res, 404, 'Not found');
    const body = await readFile(file);
    return send(res, 200, req.method === 'HEAD' ? '' : body, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Content-Length': String(body.length),
    });
  } catch {
    return send(res, 500, 'Server error');
  }
});
server.listen(port, '0.0.0.0', () => console.log(`Community Ledger listening on port ${port}`));
