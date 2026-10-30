#!/usr/bin/env node
/**
 * test-fraud-auto.js — #993 ANTIFRAUDE AUTOMÁTICO. Corre las funciones REALES de server.js (getFraudAutoConfig, _kickUserSessions,
 * _blockUserAccount, _fraudAutoApply, _fraudCheckUser) contra una base en memoria (User + PendingPayout), un socket falso y un radar falso
 * que devuelve las alertas que arma cada caso.
 *   node scripts/test-fraud-auto.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------- mini-mongo (sólo lo que usan las funciones) ----------
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function matchVal(v, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, x]) => {
      if (op === '$ne') return v !== x && !(x === true && v === true);
      if (op === '$in') return x.includes(v);
      if (op === '$nin') return !x.includes(v == null ? null : v);
      throw new Error('op ' + op);
    });
  }
  return v === cond;
}
const match = (doc, q) => Object.entries(q).every(([k, c]) => matchVal(get(doc, k), c));
function apply(r, u) {
  Object.assign(r, u.$set || {});
  for (const [k, v] of Object.entries(u.$inc || {})) r[k] = (r[k] || 0) + v;
  for (const [k, v] of Object.entries(u.$push || {})) { r[k] = r[k] || []; r[k].push(v); }
}
const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
function coll(rows) {
  const one = (fn) => { const o = { select: () => o, lean: () => Promise.resolve(clone(fn())) }; return o; };
  return {
    rows,
    findOne: (q) => one(() => rows.find((r) => match(r, q))),
    findOneAndUpdate: (q, u) => one(() => { const r = rows.find((x) => match(x, q)); if (r) apply(r, u); return r; }),
    updateOne: async (q, u) => { const r = rows.find((x) => match(x, q)); if (!r) return { modifiedCount: 0 }; apply(r, u); return { modifiedCount: 1 }; },
    updateMany: async (q, u) => { const rs = rows.filter((x) => match(x, q)); rs.forEach((r) => apply(r, u)); return { modifiedCount: rs.length }; }
  };
}
let User, PendingPayout, CONFIG, NOTES, EMITS, KICKS, ALERTS, SCAN_HANGS;
function reset(users, payouts = [], cfg = {}) {
  User = coll(users.map((u) => Object.assign({ role: 'user', isBlocked: false, tokenVersion: 0, fraudNotes: [], fraudReview: { status: null }, fraudAutoSkip: false }, u)));
  PendingPayout = coll(payouts.map((p) => Object.assign({ status: 'pending_review', reviewRequired: false, autoPay: true }, p)));
  CONFIG = Object.assign({}, cfg); NOTES = []; EMITS = []; KICKS = []; ALERTS = []; SCAN_HANGS = false;
}

// ---------- funciones reales extraídas de server.js ----------
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function extract(re) { const m = re.exec(SERVER); if (!m) throw new Error('no está ' + re); let i = SERVER.indexOf(') {', m.index) + 2, d = 0, j = i, q = null, esc = false; for (; j < SERVER.length; j++) { const c = SERVER[j]; if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) q = null; continue; } if (c === '"' || c === "'" || c === '`') { q = c; continue; } if (c === '/' && SERVER[j + 1] === '/') { j = SERVER.indexOf('\n', j); continue; } if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } } return SERVER.slice(m.index, j + 1); }
const line = (re) => { const m = re.exec(SERVER); if (!m) throw new Error('no está ' + re); return m[0]; };
const src = [
  line(/^const ACCOUNT_BLOCKED_DEFAULT = .*;$/m), line(/^const MAX_BLOCK_REASON_LENGTH = .*;$/m),
  line(/^const FRAUD_AUTO_DEFAULT = .*;$/m), line(/^const FRAUD_AUTO_ACTOR = .*;$/m), line(/^const FRAUD_BEHAVIOR_RULES = .*;$/m),
  'let _fraudCache = { at: 0, days: 0, data: null }; const _fraudStats = null;',
  extract(/^async function getFraudAutoConfig\(/m), extract(/^async function _kickUserSessions\(/m), extract(/^async function _blockUserAccount\(/m),
  extract(/^async function _fraudAutoApply\(/m), extract(/^async function _fraudCheckUser\(/m),
  'return { getFraudAutoConfig, _blockUserAccount, _fraudAutoApply, _fraudCheckUser };'
].join('\n');
const fakeIo = { to: (room) => ({ emit: (ev, d) => EMITS.push({ room, ev, d }) }), in: (room) => ({ disconnectSockets: () => KICKS.push(room) }) };
const fakeRadar = { scan: (deps, opts) => (SCAN_HANGS ? new Promise(() => {}) : Promise.resolve({ alerts: ALERTS.filter((a) => !opts.userIds || opts.userIds.includes(a.userId)) })) };
const env = () => new Function('User', 'PendingPayout', 'Transaction', 'logger', 'require', 'io', 'fraudRadar', 'getConfig', 'renderSystemCommand', '_emitAdminOnlyChatNote', 'setTimeout', src)(
  User, PendingPayout, {}, { info() {}, warn() {}, error() {} }, () => ({}), fakeIo, fakeRadar,
  async (k, d) => (k in CONFIG ? CONFIG[k] : d), async (n, d) => d, async (id, un, t) => { NOTES.push({ un, t }); },
  (fn, ms) => (ms >= 6000 ? setTimeout(fn, 50) : fn())); // los 6 s del chequeo del retiro se acortan; el corte de sockets corre al toque

const R = (key, pts) => ({ key, pts, label: key });
const alert = (userId, username, reasons, extra = {}) => Object.assign({ userId, username, score: reasons.reduce((a, r) => a + r.pts, 0), reasons, isBlocked: false, autoSkip: false, review: null }, extra);
const u = (id) => User.rows.find((x) => x.id === id);

const casos = []; const caso = (n, fn) => casos.push({ n, fn });

caso('≥ 90 con conducta ⇒ BLOQUEO: sesión revocada, aviso por socket y corte, retiros frenados, nota interna', async () => {
  reset([{ id: 'u1', username: 'estafa1' }], [{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: 'u1', status: 'paid' }]);
  const r = await env()._fraudAutoApply([alert('u1', 'estafa1', [R('cbu_wd_shared', 35), R('no_play_withdraw', 35), R('fast_cycle', 15), R('no_phone', 5)])], 'escaneo');
  assert.deepStrictEqual(r, { blocked: ['estafa1'], review: [] });
  const x = u('u1'); assert.strictEqual(x.isBlocked, true); assert.strictEqual(x.blockedBy, 'antifraude'); assert.strictEqual(x.tokenVersion, 1);
  assert.ok(/Antifraude automático \(escaneo\): 90 pts/.test(x.blockReason));
  assert.ok(EMITS.some((e) => e.room === 'user_u1' && e.ev === 'account_blocked' && /bloqueada/.test(e.d.message)));
  assert.deepStrictEqual(KICKS, ['user_u1']);
  const p1 = PendingPayout.rows.find((p) => p.id === 'p1'), p2 = PendingPayout.rows.find((p) => p.id === 'p2');
  assert.strictEqual(p1.reviewRequired, true); assert.strictEqual(p1.autoPay, false); assert.strictEqual(p2.reviewRequired, false, 'un retiro ya pagado no se toca');
  assert.ok(NOTES.some((n) => /BLOQUEO AUTOMÁTICO/.test(n.t)));
});

caso('≥ 90 sólo por compartir celular/teléfono (cuenta secundaria #992) ⇒ NO bloquea, queda en observación', async () => {
  reset([{ id: 'u2', username: 'secundaria' }]);
  const r = await env()._fraudAutoApply([alert('u2', 'secundaria', [R('device_shared', 40), R('phone_shared', 35), R('flagged', 20)])], 'escaneo');
  assert.deepStrictEqual(r, { blocked: [], review: ['secundaria'] });
  assert.strictEqual(u('u2').isBlocked, false); assert.strictEqual(u('u2').fraudReview.status, 'watch'); assert.strictEqual(u('u2').tokenVersion, 0);
});

caso('60–89 ⇒ EN OBSERVACIÓN: retiros pendientes sin pago automático, sin cerrar la sesión', async () => {
  reset([{ id: 'u3', username: 'raro' }], [{ id: 'p3', userId: 'u3' }]);
  const r = await env()._fraudAutoApply([alert('u3', 'raro', [R('bonus_abuse', 25), R('cbu_dep_shared', 30), R('new_big_wd', 10)])], 'retiro');
  assert.deepStrictEqual(r.review, ['raro']); assert.strictEqual(u('u3').isBlocked, false); assert.strictEqual(u('u3').fraudReview.by, 'antifraude');
  assert.strictEqual(PendingPayout.rows[0].reviewRequired, true); assert.strictEqual(KICKS.length, 0);
});

caso('< 60 ⇒ no hace nada', async () => {
  reset([{ id: 'u4', username: 'normal' }], [{ id: 'p4', userId: 'u4' }]);
  const r = await env()._fraudAutoApply([alert('u4', 'normal', [R('cbu_dep_shared', 30), R('third_party_payers', 20)])], 'escaneo');
  assert.deepStrictEqual(r, { blocked: [], review: [] }); assert.strictEqual(u('u4').fraudReview.status, null); assert.strictEqual(PendingPayout.rows[0].reviewRequired, false);
});

caso('desbloqueado / revisado por una persona (fraudAutoSkip) o legítimo ⇒ el motor no lo vuelve a tocar', async () => {
  reset([{ id: 'u5', username: 'perdonado', fraudAutoSkip: true }, { id: 'u6', username: 'legit', fraudReview: { status: 'legit' } }]);
  const big = [R('no_play_withdraw', 35), R('cbu_wd_shared', 35), R('wd_other_person', 30)];
  const r = await env()._fraudAutoApply([alert('u5', 'perdonado', big, { autoSkip: true }), alert('u6', 'legit', big, { review: { status: 'legit' } })], 'escaneo');
  assert.deepStrictEqual(r, { blocked: [], review: [] }); assert.strictEqual(u('u5').isBlocked, false); assert.strictEqual(u('u6').isBlocked, false);
});

caso('ya bloqueado ⇒ no se bloquea dos veces (tokenVersion no sube de nuevo)', async () => {
  reset([{ id: 'u7', username: 'yabloq', isBlocked: true, tokenVersion: 3 }]);
  const e = env(); const big = [R('no_play_withdraw', 35), R('cbu_wd_shared', 35), R('wd_other_person', 30)];
  await e._fraudAutoApply([alert('u7', 'yabloq', big)], 'escaneo');
  assert.strictEqual(await e._blockUserAccount('u7', 'otra vez', 'x'), null);
  assert.strictEqual(u('u7').tokenVersion, 3); assert.strictEqual(KICKS.length, 0);
});

caso('en observación puesta por una persona ⇒ el motor no la pisa', async () => {
  reset([{ id: 'u8', username: 'mirado', fraudReview: { status: 'watch', by: 'agente1', note: 'lo miro yo' } }]);
  await env()._fraudAutoApply([alert('u8', 'mirado', [R('bonus_abuse', 25), R('cbu_dep_shared', 30), R('new_big_wd', 10)], { review: { status: 'watch' } })], 'escaneo');
  assert.strictEqual(u('u8').fraudReview.by, 'agente1');
});

caso('apagado desde el panel o con umbrales propios', async () => {
  reset([{ id: 'u9', username: 'a' }], [], { fraudAuto: { enabled: false } });
  const big = [R('no_play_withdraw', 35), R('cbu_wd_shared', 35), R('wd_other_person', 30)];
  assert.deepStrictEqual(await env()._fraudAutoApply([alert('u9', 'a', big)], 'escaneo'), { blocked: [], review: [] });
  reset([{ id: 'u9', username: 'a' }], [], { fraudAuto: { enabled: true, blockScore: 120, reviewScore: 70 } });
  const e = env(); assert.deepStrictEqual(await e.getFraudAutoConfig(), { enabled: true, blockScore: 120, reviewScore: 70 });
  assert.deepStrictEqual(await e._fraudAutoApply([alert('u9', 'a', big)], 'escaneo'), { blocked: [], review: ['a'] }, '100 pts con bloqueo en 120 = observación');
  reset([], [], { fraudAuto: { blockScore: 'x', reviewScore: 999 } });
  assert.deepStrictEqual(await env().getFraudAutoConfig(), { enabled: true, blockScore: 90, reviewScore: 90 }, 'basura ⇒ defaults; observación nunca arriba del bloqueo');
});

caso('al pedir un retiro: bloquea / observa / deja pasar según el cliente', async () => {
  reset([{ id: 'b', username: 'malo' }, { id: 'w', username: 'mirado', fraudReview: { status: 'watch', by: 'agente1' } }, { id: 'c', username: 'limpio' }]);
  const e = env();
  ALERTS = [alert('b', 'malo', [R('no_play_withdraw', 35), R('cbu_wd_shared', 35), R('wd_other_person', 30)]), alert('w', 'mirado', [R('no_phone', 5)], { review: { status: 'watch' } }), alert('c', 'limpio', [])];
  const rb = await e._fraudCheckUser('b', 'retiro'); assert.strictEqual(rb.level, 'block'); assert.strictEqual(u('b').isBlocked, true);
  const rw = await e._fraudCheckUser('w', 'retiro'); assert.strictEqual(rw.level, 'review');
  const rc = await e._fraudCheckUser('c', 'retiro'); assert.strictEqual(rc.level, null);
});

caso('al pedir un retiro: si el radar no contesta, no traba el retiro (sigue las reglas de siempre)', async () => {
  reset([{ id: 'c', username: 'limpio' }]); SCAN_HANGS = true;
  const r = await env()._fraudCheckUser('c', 'retiro'); assert.strictEqual(r.level, null);
});

(async () => {
  let ok = 0;
  for (const c of casos) {
    try { await c.fn(); ok++; console.log('✅ ' + c.n); } catch (e) { console.log('❌ ' + c.n + '\n   ' + (e && e.stack || e)); }
  }
  console.log(`\n${ok}/${casos.length} casos OK`);
  process.exit(ok === casos.length ? 0 : 1);
})();
