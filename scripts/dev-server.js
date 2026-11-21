// Local development server: serves the front end from /src, runs the API handlers
// in-process, and fakes Static Web Apps sign-in so you can try different users.
//   node scripts/dev-server.js        -> http://localhost:4280
// Data goes to api/data/local-db.json unless COSMOS_CONNECTION_STRING is set.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const routes = require('../api/src/lib/routes');
const { run } = require('../api/src/lib/handlers');

const PORT = Number(process.env.PORT) || 4280;
// Apply the same security headers as production (minus HSTS, which needs HTTPS).
const { globalHeaders = {} } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'staticwebapp.config.json'), 'utf8'));
delete globalHeaders['Strict-Transport-Security'];
const ROOT = path.join(__dirname, '..', 'src');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp' };

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0]));
}
function principalFor(req) {
  const email = cookies(req).devuser;
  if (!email) return null;
  return { identityProvider: 'dev', userId: Buffer.from(email).toString('hex').slice(0, 32), userDetails: email, userRoles: ['anonymous', 'authenticated'] };
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function match(pattern, pathname) {
  const a = pattern.split('/');
  const b = pathname.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^\{(\w+)\??\}$/);
    if (m) params[m[1]] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

http
  .createServer(async (req, res) => {
    for (const [k, v] of Object.entries(globalHeaders)) res.setHeader(k, v);
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    if (p.startsWith('/.auth/login')) {
      const email = url.searchParams.get('email');
      if (email) {
        res.writeHead(302, { 'Set-Cookie': `devuser=${encodeURIComponent(email)}; Path=/`, Location: url.searchParams.get('post_login_redirect_uri') || '/' });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<form style="font:16px sans-serif;margin:40px"><h3>Dev sign-in (local only)</h3><input name="email" value="admin@go-green.local" size="32"> <button>Sign in</button></form>`);
    }
    if (p === '/.auth/logout') {
      res.writeHead(302, { 'Set-Cookie': 'devuser=; Path=/; Max-Age=0', Location: '/' });
      return res.end();
    }
    if (p === '/.auth/me') return send(res, 200, { clientPrincipal: principalFor(req) });

    if (p.startsWith('/api/')) {
      const sub = p.slice(5);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const params = match(r.route, sub);
        if (!params) continue;
        let raw = '';
        for await (const chunk of req) raw += chunk;
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {}
        const principal = principalFor(req);
        if (!principal && !r.anonymous) return send(res, 401, { error: 'Please sign in' });
        const out = await run(r.fn, { method: req.method, params, query: Object.fromEntries(url.searchParams), body, principal });
        return send(res, out.status, out.body);
      }
      return send(res, 404, { error: 'Not found' });
    }

    let file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`ITMS dev server on http://localhost:${PORT}`));
