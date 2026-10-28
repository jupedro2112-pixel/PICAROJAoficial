#!/usr/bin/env node
/**
 * test-dup-account.js — #992 CUENTA SECUNDARIA. Corre el `_dupAccountCheck` y `_dupPairReason` REALES (extraídos de server.js) contra una
 * base en memoria (User + BankMovement con los operadores que usa la función) y el guard de regalos REAL de giroxService.
 *   node scripts/test-dup-account.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

// ---------- mini-mongo (sólo lo que usa la función) ----------
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : Array.isArray(a) ? a.map((x) => x && x[k]) : a[k]), o);
function matchVal(v, cond) {
  const vals = Array.isArray(v) ? v.flat() : [v];
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, x]) => {
      if (op === '$ne') return !vals.some((y) => (y == null ? x == null : y === x)) && !(x === null && v == null);
      if (op === '$in') return vals.some((y) => x.includes(y));
      if (op === '$nin') return !vals.some((y) => x.includes(y == null ? null : y));
      if (op === '$regex') return vals.some((y) => y != null && new RegExp(x).test(String(y)));
      if (op === '$exists') return (v !== undefined) === x;
      throw new Error('op ' + op);
    });
  }
  if (cond === null) return v == null;
  return vals.some((y) => y === cond);
}
function match(doc, q) {
  return Object.entries(q).every(([k, c]) => (k === '$or' ? c.some((s) => match(doc, s)) : matchVal(get(doc, k), c)));
}
function coll(rows) {
  const chain = (arr) => { const o = { select: () => o, sort: () => o, limit: (n) => { arr = arr.slice(0, n); return o; }, lean: () => Promise.resolve(JSON.parse(JSON.stringify(arr))) }; return o; };
  return {
    rows,
    find: (q) => chain(rows.filter((r) => match(r, q))),
    findOne: (q) => { const o = { select: () => o, lean: () => Promise.resolve(rows.find((r) => match(r, q)) ? JSON.parse(JSON.stringify(rows.find((r) => match(r, q)))) : null) }; return o; },
    distinct: async (f, q) => [...new Set(rows.filter((r) => match(r, q)).map((r) => r[f]))],
    updateOne: async (q, u) => {
      const r = rows.find((x) => match(x, q)); if (!r) return { modifiedCount: 0 };
      Object.assign(r, u.$set || {});
      for (const [k, v] of Object.entries(u.$addToSet || {})) { r[k] = r[k] || []; if (!r[k].includes(v)) r[k].push(v); }
      for (const [k, v] of Object.entries(u.$push || {})) { r[k] = r[k] || []; r[k].push(v); }
      for (const [k, v] of Object.entries(u.$pull || {})) { r[k] = (r[k] || []).filter((x) => x !== v); }
      return { modifiedCount: 1 };
    }
  };
}
const day = (n) => new Date(Date.UTC(2026, 9, n));
let User, BankMovement;
const SENT = []; const NOTES = [];
function reset(users, moves = []) {
  User = coll(users.map((u) => Object.assign({ role: 'user', duplicateOf: null, dupCleared: null, fraudFlags: [], fraudNotes: [], deviceIds: [], fcmTokens: [], fcmToken: null, phone: null }, u)));
  BankMovement = coll(moves); SENT.length = 0; NOTES.length = 0;
}

// ---------- módulos falsos ----------
const _orig = Module._load;
Module._load = function (req) {
  if (/src\/models\/BankMovement$/.test(req)) return BankMovement;
  if (req === 'axios') return async () => { throw new Error('sin red'); };
  if (req === 'uuid') return { v4: () => crypto.randomUUID() };
  if (/utils\/logger$/.test(req)) return { info() {}, warn() {}, error() {}, debug() {} };
  if (/giroxSimulator$/.test(req)) return { active: () => false, handle: async () => ({ ok: false }) };
  return _orig.apply(this, arguments);
};
process.env.GIROX_API_URL = 'https://fake.test'; process.env.GIROX_API_KEY = 'k';
const girox = require(path.join(ROOT, 'src/services/giroxService.js'));

const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function extract(re) { const m = re.exec(SERVER); if (!m) throw new Error('no está ' + re); let i = SERVER.indexOf(') {', m.index) + 2, d = 0, j = i, q = null, esc = false; for (; j < SERVER.length; j++) { const c = SERVER[j]; if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) q = null; continue; } if (c === '"' || c === "'" || c === '`') { q = c; continue; } if (c === '/' && SERVER[j + 1] === '/') { j = SERVER.indexOf('\n', j); continue; } if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } } return SERVER.slice(m.index, j + 1); }
const msgDefault = /const DUP_ACCOUNT_MSG_DEFAULT = ('.*');/.exec(SERVER)[1];
const src = `const DUP_ACCOUNT_MSG_DEFAULT = ${msgDefault};\nconst _dupGuardCache = new Map();\n` + extract(/^function _telTailRegex\(/m) + '\n' + extract(/^function _dupPairReason\(/m) + '\n' + extract(/^async function _dupAccountCheck\(/m) + '\nreturn { _dupAccountCheck, _dupPairReason, DUP_ACCOUNT_MSG_DEFAULT };';
const env = () => new Function('User', 'logger', 'require', '_emitAdminOnlyChatNote', 'renderSystemCommand', '_sendUserSystemMessage', src)(
  User, { info() {}, warn() {}, error() {} }, (p) => (/BankMovement$/.test(p) ? BankMovement : require(p)),
  async (id, un, t) => { NOTES.push({ un, t }); }, async (n, d, v) => d.replace(/\{(\w+)\}/g, (_, k) => v[k]), async (u, t, o) => { SENT.push({ un: u.username, t, o }); });

const casos = []; const caso = (n, fn) => casos.push({ n, fn });
caso('Mismo TELÉFONO: la más nueva queda secundaria de la más vieja, con aviso al cliente y nota interna', async () => {
  reset([{ id: 'a', username: 'picanico51', phone: '+54 9 11 5555-1234', createdAt: day(1) }, { id: 'b', username: 'nico2', phone: '1155551234', createdAt: day(20) }]);
  const r = await env()._dupAccountCheck({ id: 'b' }, 'test');
  assert.deepStrictEqual(r, { main: 'picanico51', marked: ['nico2'] });
  const b = User.rows.find((u) => u.id === 'b');
  assert.strictEqual(b.duplicateOf.username, 'picanico51'); assert.strictEqual(b.duplicateOf.reason, 'mismo teléfono'); assert.ok(b.fraudFlags.includes('dup_account'));
  assert.strictEqual(User.rows.find((u) => u.id === 'a').duplicateOf, null, 'la principal no se marca');
  assert.strictEqual(SENT.length, 1); assert.ok(/picanico51/.test(SENT[0].t) && /NO tiene bonos/.test(SENT[0].t) && /volver a tu cuenta principal/.test(SENT[0].t));
  assert.strictEqual(SENT[0].o.push.data.kind, 'personal'); assert.strictEqual(NOTES.length, 1);
});
caso('Chequeo desde la cuenta VIEJA también marca a la nueva (no a la vieja)', async () => {
  reset([{ id: 'a', username: 'vieja', deviceIds: ['dev-1'], createdAt: day(1) }, { id: 'b', username: 'nueva', deviceIds: ['dev-9', 'dev-1'], createdAt: day(5) }]);
  const r = await env()._dupAccountCheck({ id: 'a' }, 'test');
  assert.deepStrictEqual(r.marked, ['nueva']); assert.strictEqual(User.rows[1].duplicateOf.reason, 'mismo celular'); assert.strictEqual(User.rows[0].duplicateOf, null);
});
caso('Mismo CBU que ENVÍA la transferencia (el de esta carga, todavía sin asignar)', async () => {
  reset([{ id: 'a', username: 'principal', createdAt: day(1) }, { id: 'b', username: 'otra', createdAt: day(9) }],
    [{ matchedUserId: 'a', direction: 'Inbound', fromCBU: '0000003100012345678901' }]);
  const r = await env()._dupAccountCheck({ id: 'b' }, 'cbu', { cbu: '0000003100012345678901' });
  assert.deepStrictEqual(r.marked, ['otra']); assert.strictEqual(User.rows[1].duplicateOf.reason, 'mismo CBU de transferencia');
});
caso('Mismo CBU de cargas ANTERIORES de esta cuenta', async () => {
  reset([{ id: 'a', username: 'principal', createdAt: day(1) }, { id: 'b', username: 'otra', createdAt: day(9) }],
    [{ matchedUserId: 'a', direction: 'Inbound', fromCBU: '0000003100099999999999' }, { matchedUserId: 'b', direction: 'Inbound', fromCBU: '0000003100099999999999' }]);
  const r = await env()._dupAccountCheck({ id: 'b' }, 'deposit');
  assert.deepStrictEqual(r.marked, ['otra']);
});
caso('Un retiro (Outbound) al mismo CBU NO cuenta como "mismo CBU que envía"', async () => {
  reset([{ id: 'a', username: 'principal', createdAt: day(1) }, { id: 'b', username: 'otra', createdAt: day(9) }],
    [{ matchedUserId: 'a', direction: 'Outbound', fromCBU: '0000003100077777777777' }]);
  assert.strictEqual(await env()._dupAccountCheck({ id: 'b' }, 'cbu', { cbu: '0000003100077777777777' }), null);
  assert.strictEqual(User.rows[1].duplicateOf, null);
});
caso('Sin coincidencias reales (teléfono parecido, otro número; IP no cuenta) ⇒ no marca nada', async () => {
  reset([{ id: 'a', username: 'x', phone: '1155551234', registrationIp: '1.2.3.4', createdAt: day(1) }, { id: 'b', username: 'y', phone: '1255551234', registrationIp: '1.2.3.4', createdAt: day(9) }]);
  assert.strictEqual(await env()._dupAccountCheck({ id: 'b' }, 'test'), null); assert.strictEqual(SENT.length, 0);
});
caso('Desmarcada por el admin (dupCleared) ⇒ no se vuelve a marcar; y el aviso sale UNA sola vez', async () => {
  reset([{ id: 'a', username: 'p', phone: '1155551234', createdAt: day(1) }, { id: 'b', username: 's', phone: '1155551234', createdAt: day(9), dupCleared: { by: 'admin', at: day(10) } }, { id: 'c', username: 't', phone: '1155551234', createdAt: day(12) }]);
  const e = env(); await e._dupAccountCheck({ id: 'c' }, 'test'); await e._dupAccountCheck({ id: 'c' }, 'test');
  assert.strictEqual(User.rows[1].duplicateOf, null); assert.strictEqual(User.rows[2].duplicateOf.username, 'p'); assert.strictEqual(SENT.length, 1);
});
caso('Staff (no role user) nunca se marca', async () => {
  reset([{ id: 'a', username: 'p', phone: '1155551234', createdAt: day(1) }, { id: 'b', username: 'agente', role: 'depositor', phone: '1155551234', createdAt: day(9) }]);
  assert.strictEqual(await env()._dupAccountCheck({ id: 'b' }, 'test'), null);
});
caso('Guard de regalos: creditGift / creditUserBalance frenados para la secundaria; Bonificación manual y devoluciones (noGiftGuard) pasan', async () => {
  girox.setGiftGuard(async (u) => (u === 'nico2' ? 'cuenta secundaria de picanico51' : null));
  const g1 = await girox.creditGift('nico2', 1000, { reference: 'r1', rolloverX: 5 });
  assert.strictEqual(g1.success, false); assert.strictEqual(g1.code, 'gifts_blocked');
  const g2 = await girox.creditUserBalance('nico2', 1000, 'r2', { multiplier: 5 }); assert.strictEqual(g2.code, 'gifts_blocked');
  const g3 = await girox.creditUserBalance('nico2', 1000, 'r3'); assert.strictEqual(g3.code, 'gifts_blocked');
  // con noGiftGuard sigue de largo (acá falla por red, que es lo esperado: llegó a la API)
  const g4 = await girox.creditUserBalance('nico2', 1000, 'r4', { multiplier: 5, noGiftGuard: true }); assert.notStrictEqual(g4.code, 'gifts_blocked');
  // otra cuenta: no frena
  const g5 = await girox.creditGift('otro', 1000, { reference: 'r5', rolloverX: 0 }); assert.notStrictEqual(g5.code, 'gifts_blocked');
  assert.strictEqual(await girox.isGiftBlocked('nico2'), 'cuenta secundaria de picanico51');
  girox.setGiftGuard(null);
});
caso('server.js: cargas siguen (resolveAutoBonus devuelve sin bono), hgcash chequea el CBU antes del bono, excepciones marcadas', async () => {
  assert.ok(/await _dupAccountCheck\(user, 'cbu', \{ cbu: movement && movement\.fromCBU \}\);[^\n]*\n\s*const _auto = await resolveAutoBonus\(/.test(SERVER));
  const rab = extract(/^async function resolveAutoBonus\(/m);
  assert.ok(/await _dupAccountCheck\(user, 'deposit'\);[\s\S]{0,200}if \(_dup && _dup\.username\)[^\n]*return none;/.test(rab));
  assert.ok(/vip-payoutref-bonus-\$\{payout\.id\}`, \{ noGiftGuard: true \}\)/.test(SERVER));
  assert.ok(/noGiftGuard: true, \/\/ #992: la Bonificación MANUAL/.test(SERVER));
  assert.ok(/res\.json\(\{ \.\.\.user, metaMatching, dupMain \}\)/.test(SERVER));
});

(async () => {
  let ok = 0;
  for (const c of casos) { try { await c.fn(); ok++; console.log('✅ ' + c.n); } catch (e) { console.log('❌ ' + c.n + '\n   ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join('\n   ')); } }
  console.log(`\n${ok}/${casos.length} casos OK`); process.exit(ok === casos.length ? 0 : 1);
})();
