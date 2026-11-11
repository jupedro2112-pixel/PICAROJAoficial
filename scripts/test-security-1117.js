#!/usr/bin/env node
// #1117 (intrusión 2026-11-11): authMiddleware real de server.js con base simulada.
//  - el ROL sale de la BASE (un token con rol viejo no sirve), jugadores igual que siempre
//  - staff con clave temporal ⇒ sólo puede cambiarla; jugadores no se ven afectados
//  - dueño del panel (PANEL_OWNER) único que toca cuentas de staff
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const cut = (from, endRe) => { const i = S.indexOf(from); assert.ok(i >= 0, from); const rest = S.slice(i); const m = rest.match(endRe); return rest.slice(0, m.index + m[0].length); };
const src = [
  cut('const ADMIN_ROLES = ', /\];/), 'const isAdminRole = (role) => ADMIN_ROLES.includes(role);',
  cut('const PUBLISHER_ADMIN_ALLOWED_PATHS = [', /\n\];/), cut('const MUST_CHANGE_PASSWORD_ALLOWED_PATHS = [', /\n\];/),
  cut('const authMiddleware = async (req, res, next) => {', /\n};\n/),
  cut('function _panelOwner()', /\n/), cut('function _isPanelOwner(req)', /\n/),
].join('\n');
let users = {};
const User = { findOne: (q) => ({ select: async () => (users[q.id] ? Object.assign({ save: async () => {} }, users[q.id]) : null) }), findById: () => ({ select: async () => null }), updateOne: async () => ({}) };
const jwt = { verify: (t) => JSON.parse(t) };
const ctx = { User, jwt, JWT_SECRET: 'x', logger: { info() {}, warn() {}, error() {}, debug() {} }, console, process: { env: {} }, String, Object, Array, JSON, Error, Date };
vm.createContext(ctx); vm.runInContext(src + '\nthis.authMiddleware = authMiddleware; this._isPanelOwner = _isPanelOwner;', ctx);
const run = async (u, tok, url) => { users = { [u.id]: u }; let out = { next: false, code: 200, body: null }; const req = { headers: { authorization: 'Bearer ' + JSON.stringify(tok) }, header: () => null, get: () => null, cookies: {}, path: url, originalUrl: url, url };
  const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
  await ctx.authMiddleware(req, res, () => { out.next = true; out.req = req; }); return out; };
let ok = 0; const caso = async (n, fn) => { try { await fn(); ok++; console.log('✅ ' + n); } catch (e) { console.log('❌ ' + n + '\n   ' + e.message); process.exitCode = 1; } };
(async () => {
  const base = { isActive: true, isBlocked: false, tokenVersion: 0, mustChangePassword: false };
  await caso('jugador normal entra igual que siempre', async () => {
    const r = await run(Object.assign({ id: 'p1', username: 'jugador', role: 'user' }, base), { userId: 'p1', username: 'jugador', role: 'user', tokenVersion: 0 }, '/api/balance');
    assert.ok(r.next && r.req.user.role === 'user', JSON.stringify(r));
  });
  await caso('token con rol "admin" de un usuario que en la base es jugador ⇒ queda como jugador', async () => {
    const r = await run(Object.assign({ id: 'p2', username: 'x', role: 'user' }, base), { userId: 'p2', username: 'x', role: 'admin', tokenVersion: 0 }, '/api/admin/stats');
    assert.ok(r.next && r.req.user.role === 'user', 'el rol sale de la base');
  });
  await caso('agente con rol bajado: el token viejo ya no da permisos de admin', async () => {
    const r = await run(Object.assign({ id: 'a1', username: 'agente', role: 'depositor' }, base), { userId: 'a1', username: 'agente', role: 'admin', tokenVersion: 0 }, '/api/admin/x');
    assert.strictEqual(r.req.user.role, 'depositor');
  });
  await caso('sesión cerrada (tokenVersion) ⇒ 401', async () => {
    const r = await run(Object.assign({ id: 'a2', username: 'agente', role: 'depositor' }, base, { tokenVersion: 3 }), { userId: 'a2', role: 'depositor', tokenVersion: 2 }, '/api/admin/x');
    assert.ok(!r.next && r.code === 401);
  });
  await caso('desactivado ⇒ 401', async () => {
    const r = await run(Object.assign({ id: 'a3', username: 'agente', role: 'depositor' }, base, { isActive: false }), { userId: 'a3', role: 'depositor', tokenVersion: 0 }, '/api/admin/x');
    assert.ok(!r.next && r.code === 401);
  });
  await caso('staff con clave temporal: sólo puede cambiarla', async () => {
    const u = Object.assign({ id: 'a4', username: 'agente', role: 'depositor', staffMustChangePw: true }, base); const t = { userId: 'a4', role: 'depositor', tokenVersion: 0 };
    let r = await run(u, t, '/api/admin/conversations'); assert.ok(!r.next && r.code === 403 && r.body.code === 'STAFF_MUST_CHANGE_PW', JSON.stringify(r.body));
    r = await run(u, t, '/api/admin/deposit'); assert.ok(!r.next && r.code === 403);
    r = await run(u, t, '/api/admin/change-own-password'); assert.ok(r.next, 'cambiar la clave sí');
    r = await run(u, t, '/api/auth/admin-logout'); assert.ok(r.next, 'salir sí');
  });
  await caso('un jugador con el campo (no debería) NO queda trabado', async () => {
    const r = await run(Object.assign({ id: 'p3', username: 'j', role: 'user', staffMustChangePw: true }, base), { userId: 'p3', role: 'user', tokenVersion: 0 }, '/api/balance');
    assert.ok(r.next);
  });
  await caso('dueño del panel: sin PANEL_OWNER cualquier admin; con PANEL_OWNER sólo ése', async () => {
    assert.strictEqual(ctx._isPanelOwner({ user: { role: 'admin', username: 'otro' } }), true);
    ctx.process.env.PANEL_OWNER = 'Dueno1';
    assert.strictEqual(ctx._isPanelOwner({ user: { role: 'admin', username: 'dueno1' } }), true);
    assert.strictEqual(ctx._isPanelOwner({ user: { role: 'admin', username: 'otro' } }), false);
    assert.strictEqual(ctx._isPanelOwner({ user: { role: 'depositor', username: 'dueno1' } }), false, 'tiene que ser admin');
    delete ctx.process.env.PANEL_OWNER; ctx.process.env.STAFF_LOCKDOWN_KEEP = 'dueno1';
    assert.strictEqual(ctx._isPanelOwner({ user: { role: 'admin', username: 'otro' } }), false, 'KEEP también sirve');
  });
  console.log(`\n${ok}/8 casos OK`);
})();

// ── el BLOQUEO de emergencia (bloque del arranque) con base simulada ──
(async () => {
  await new Promise((r) => setTimeout(r, 50));
  const blk = (() => { const i = S.indexOf("    const lc = String(process.env.STAFF_LOCKDOWN || '').trim();"); const j = S.indexOf("  } catch (e) { console.error('[lockdown #1117] ' + e.message); }", i); return S.slice(i, j); })();
  const mk = () => [
    { id: 'o', username: 'Dueno1', role: 'admin', tokenVersion: 0, isActive: true },
    { id: 'a', username: 'agente1', role: 'depositor', tokenVersion: 0, isActive: true },
    { id: 'b', username: 'admin2', role: 'admin', tokenVersion: 0, isActive: true },
    { id: 't', username: 'lalodj', role: 'admin', tokenVersion: 0, isActive: true },
    { id: 'p', username: 'jugador', role: 'user', tokenVersion: 0, isActive: true }];
  const runLock = async (env, rows) => {
    const cfg = {}; const U = { find: (q) => ({ select: () => ({ lean: async () => rows.filter((u) => q.$or[0].role.$in.includes(u.role) || q.$or[1].username.$in.includes(u.username)) }), lean: async () => [] }),
      updateOne: async (q, u) => { const x = rows.find((r) => r.id === q.id); if (u.$inc) x.tokenVersion += u.$inc.tokenVersion; Object.assign(x, u.$set || {}); } };
    const c2 = { User: U, Message: { aggregate: async () => [] }, Config: { set: async (k, v) => { cfg[k] = v; } }, getConfig: async (k) => cfg[k] || null,
      bcrypt: { hash: async (p) => 'H(' + p + ')' }, crypto: require('crypto'), _sha: (v) => 'S(' + v + ')', ADMIN_ROLES: ['admin', 'depositor', 'withdrawer', 'publisher_admin', 'comunidad'], process: { env }, console: { warn() {}, log() {}, error: console.error }, JSON, Date, Object, String, Array };
    vm.createContext(c2); await vm.runInContext('(async () => {\n' + blk + '\n})()', c2); return cfg;
  };
  await caso('bloqueo con clave temporal: dueño con clave nueva, agentes con la temporal y obligados a cambiarla, prueba desactivada, jugador intacto', async () => {
    const rows = mk(); const cfg = await runLock({ STAFF_LOCKDOWN: 'b1', STAFF_LOCKDOWN_KEEP: 'dueno1', STAFF_LOCKDOWN_PASS: 'una-clave-larga', STAFF_LOCKDOWN_TEMP: 'tmp1', STAFF_LOCKDOWN_PIN: 'pin123' }, rows);
    const g = (id) => rows.find((r) => r.id === id);
    assert.ok(g('o').password === 'H(una-clave-larga)' && g('o').isActive && !g('o').staffMustChangePw && g('o').tokenVersion === 1, JSON.stringify(g('o')));
    for (const id of ['a', 'b']) assert.ok(g(id).password === 'H(tmp1)' && g(id).staffMustChangePw === true && g(id).isActive === true && g(id).tokenVersion === 1, JSON.stringify(g(id)));
    assert.ok(g('t').role === 'user' && g('t').isActive === false, 'cuenta de prueba fuera');
    assert.ok(g('p').tokenVersion === 0 && !g('p').password, 'jugador intacto');
    assert.ok(cfg.datosIaPinHash === 'S(pin123)' && cfg.rcptBotPinHash === 'S(pin123)', 'claves del panel');
    const again = await runLock({ STAFF_LOCKDOWN: 'b1', STAFF_LOCKDOWN_KEEP: 'dueno1' }, rows); // mismo código no vuelve a correr (cfg nuevo ⇒ sí correría; acá sólo chequeamos que corre una vez por código)
  });
  await caso('bloqueo sin clave temporal: agentes desactivados con clave al azar; KEEP mal escrito ⇒ sólo cierra sesiones', async () => {
    let rows = mk(); await runLock({ STAFF_LOCKDOWN: 'b2', STAFF_LOCKDOWN_KEEP: 'dueno1' }, rows);
    assert.ok(rows.find((r) => r.id === 'a').isActive === false && /^H\(/.test(rows.find((r) => r.id === 'a').password));
    rows = mk(); await runLock({ STAFF_LOCKDOWN: 'b3', STAFF_LOCKDOWN_KEEP: 'noexiste' }, rows);
    assert.ok(rows.every((r) => r.role === 'user' || (r.isActive && r.tokenVersion === 1)), 'nadie desactivado, sesiones cerradas');
    assert.ok(rows.find((r) => r.id === 'p').tokenVersion === 0);
  });
  console.log(`\n${ok}/10 casos OK (con el bloqueo)`);
})();
