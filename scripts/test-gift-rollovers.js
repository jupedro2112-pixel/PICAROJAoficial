#!/usr/bin/env node
/**
 * test-gift-rollovers.js — #991: verifica CÓMO entra cada cosa en 1girox (carga vs bono y con qué rollover)
 * usando el código REAL: `src/services/giroxService.js` entero y las funciones de carga de `server.js`
 * (`_depositWithBonus`, `_bonusMultiplierFor`, `getDepositRolloverX`, `_depositRolloverXFor`, `getGiroxBonusMultiplier`,
 * `_giftRolloverX`) extraídas del archivo tal cual. Lo único falso es la Partner API: un 1girox en memoria que
 * valida como el real (multiplicadores permitidos de carga y de bono, idempotencia por reference, 422 sin mover plata,
 * bono activo del jugador). También mira `referralPayoutService.getReferralRolloverX` y que el pago use `creditGift`.
 *
 * Corre con `node` pelado (sin node_modules, sin Mongo):  node scripts/test-gift-rollovers.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- 1girox falso
const api = {
  cfg: null, players: {}, refs: new Map(), ops: [], fail: null,
  reset(cfg) {
    this.cfg = cfg; this.players = {}; this.refs = new Map(); this.ops = []; this.fail = null;
  },
  player(u) { return this.players[u] || (this.players[u] = { username: u, balance: 0, bonusLocked: 0, claimable: 0 }); },
};
function httpErr(status, data) { const e = new Error('HTTP ' + status); e.response = { status, data }; return e; }
function v422(field, msg) { return httpErr(422, { message: msg, errors: { [field]: [msg] } }); }
async function fakeAxios({ method, url, data }) {
  const p = url.replace(process.env.GIROX_API_URL, '');
  if (api.fail && (!api.fail.path || p.endsWith(api.fail.path)) && api.fail.n > 0) { api.fail.n--; throw api.fail.err; }
  if (method === 'get' && p === '/config') return { status: 200, data: api.cfg };
  let m = p.match(/^\/players\/([^/]+)$/);
  if (method === 'get' && m) {
    const pl = api.player(decodeURIComponent(m[1]));
    return { status: 200, data: { player: { id: 1, username: pl.username, balance: pl.balance, wagering: { available: pl.balance - pl.bonusLocked, locked: pl.bonusLocked, bonus_locked: pl.bonusLocked, claimable_total: pl.claimable, claimable: [] } } } };
  }
  m = p.match(/^\/players\/([^/]+)\/(deposit|bonus)$/);
  if (method === 'post' && m) {
    const u = decodeURIComponent(m[1]); const kind = m[2]; const pl = api.player(u);
    if (!data.reference) throw v422('reference', 'reference requerida');
    if (api.refs.has(data.reference)) {
      const prev = api.refs.get(data.reference);
      if (prev.kind !== kind) throw httpErr(409, { error: { code: 'reference_conflict', message: 'reference usada por otra operación' } });
      return { status: 200, data: { duplicate: true, balance: pl.balance, operation: { reference: data.reference, ledger_id: prev.id, type: kind } } };
    }
    const amt = Number(data.amount);
    if (kind === 'deposit') {
      const rm = api.cfg.rollover.multipliers.map(Number);
      if (data.multiplier != null && !rm.includes(Number(data.multiplier))) throw v422('multiplier', 'The selected multiplier is invalid.');
      if (data.bonus_amount != null) {
        if (data.bonus_multiplier == null) throw v422('bonus_multiplier', 'bonus_multiplier requerido');
        if (!api.cfg.bonus.multipliers.map(Number).includes(Number(data.bonus_multiplier))) throw v422('bonus_multiplier', 'The selected bonus multiplier is invalid.');
        const mx = Number(api.cfg.bonus.fixed_max) || 0;
        if (mx > 0 && Number(data.bonus_amount) > mx) throw httpErr(422, { error: { code: 'bonus_out_of_range', message: 'bonus out of range' } });
      }
    } else {
      const b = api.cfg.bonus;
      if (b.enabled === false || b.standalone_enabled === false) throw httpErr(422, { error: { code: 'feature_disabled', message: 'bonus disabled' } });
      if (!b.multipliers.map(Number).includes(Number(data.multiplier))) throw v422('multiplier', 'The selected multiplier is invalid.');
    }
    const id = api.ops.length + 1;
    const op = { id, kind, user: u, amount: amt, ref: data.reference, multiplier: data.multiplier != null ? Number(data.multiplier) : null,
      bonusAmount: data.bonus_amount != null ? Number(data.bonus_amount) : null, bonusMultiplier: data.bonus_multiplier != null ? Number(data.bonus_multiplier) : null, noBonus: !!data.no_bonus };
    api.ops.push(op); api.refs.set(data.reference, op);
    pl.balance += amt + (op.bonusAmount || 0);
    if (kind === 'bonus' && op.multiplier > 0) pl.bonusLocked += amt;
    if (kind === 'deposit' && op.bonusAmount && op.bonusMultiplier > 0) pl.bonusLocked += op.bonusAmount;
    return { status: 200, data: { duplicate: false, balance: pl.balance, operation: { reference: data.reference, ledger_id: id, type: kind } } };
  }
  throw httpErr(404, { error: { code: 'not_found', message: p } });
}

// ---------------------------------------------------------------- stubs de módulos
const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };
const LOG = [];
const capLogger = { info: (m) => LOG.push(['info', m]), warn: (m) => LOG.push(['warn', m]), error: (m) => LOG.push(['error', m]), debug() {} };
const configStore = {};
const fakeConfigModel = { get: async (k, d) => (k in configStore ? configStore[k] : d) };
const _origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'axios') return fakeAxios;
  if (req === 'uuid') return { v4: () => crypto.randomUUID() };
  if (req === 'winston') throw new Error('winston no debería cargarse');
  if (/utils\/logger$/.test(req)) return silent;
  if (/models\/Config$/.test(req)) return fakeConfigModel;
  if (req === '../models') return {};
  if (/giroxSimulator$/.test(req)) return { active: () => false, handle: async () => ({ ok: false }) };
  return _origLoad.apply(this, arguments);
};
process.env.GIROX_API_URL = 'https://fake.1girox.test/api';
process.env.GIROX_API_KEY = 'test-key';

function freshGirox() {
  delete require.cache[require.resolve(path.join(ROOT, 'src/services/giroxService.js'))];
  return require(path.join(ROOT, 'src/services/giroxService.js'));
}

// ---------------------------------------------------------------- funciones reales de server.js
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
function extractFn(name) {
  const re = new RegExp(`^(async )?function ${name}\\(`, 'm');
  const m = re.exec(SERVER); if (!m) throw new Error('no encontré ' + name + ' en server.js');
  let i = SERVER.indexOf('{', m.index); let depth = 0; let j = i; let inStr = null; let esc = false;
  for (; j < SERVER.length; j++) {
    const c = SERVER[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && SERVER[j + 1] === '/') { j = SERVER.indexOf('\n', j); continue; }
    if (c === '/' && SERVER[j + 1] === '*') { j = SERVER.indexOf('*/', j) + 1; continue; }
    if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return SERVER.slice(m.index, j + 1);
}
const FNS = ['_depositWithBonus', '_bonusMultiplierFor', 'getDepositRolloverX', '_depositRolloverXFor', 'getGiroxBonusMultiplier', '_giftRolloverX'];
function serverFns(girox, cfg) {
  const src = FNS.map(extractFn).join('\n') + `\nreturn { ${FNS.join(', ')} };`;
  const getConfig = async (k, d) => (k in cfg ? cfg[k] : d);
  const mongoose = { connection: { collection: () => ({ updateOne: () => Promise.resolve() }) } };
  // eslint-disable-next-line no-new-func
  return new Function('girox', 'getConfig', 'logger', 'mongoose', '_schedArtKey', src)(girox, getConfig, capLogger, mongoose, () => 'k');
}

// ---------------------------------------------------------------- casos
const CFG_AGOSTO = { bonus: { enabled: true, standalone_enabled: true, multipliers: [0, 2, 5, 10, 20, 40], fixed_min: 0, fixed_max: 0 }, rollover: { multipliers: [0, 1, 2, 3, 5, 10] } };
const CFG_CON_1 = { bonus: { enabled: true, standalone_enabled: true, multipliers: [0, 1, 2, 5, 10, 20, 40], fixed_min: 0, fixed_max: 0 }, rollover: { multipliers: [0, 1, 2, 3, 5, 10] } };
const SRV_CFG = { bonusRolloverX: 5, depositRolloverX: 1 };
const casos = [];
const caso = (n, fn) => casos.push({ n, fn });
const clone = (o) => JSON.parse(JSON.stringify(o));

caso('1ª carga por comprobante: CARGA ×1 sin bono adentro + 100% como BONO ×5 pegado (misma operación, tipo bono)', async () => {
  api.reset(clone(CFG_AGOSTO)); const g = freshGirox(); const s = serverFns(g, SRV_CFG);
  const r = await s._depositWithBonus(g, 'ana', 10000, 'Carga', 'vip-dep-1', 10000);
  assert.ok(r.success); assert.strictEqual(r.bonusVia, 'attached'); assert.strictEqual(r.depositRolloverX, 1);
  assert.strictEqual(api.ops.length, 1); const op = api.ops[0];
  assert.strictEqual(op.kind, 'deposit'); assert.strictEqual(op.amount, 10000); assert.strictEqual(op.multiplier, 1);
  assert.strictEqual(op.bonusAmount, 10000); assert.strictEqual(op.bonusMultiplier, 5);
});
caso('Carga sin bono (comprobante común): CARGA ×1 con no_bonus (no hereda bonos del panel de 1girox)', async () => {
  api.reset(clone(CFG_AGOSTO)); const g = freshGirox(); const s = serverFns(g, SRV_CFG);
  const r = await s._depositWithBonus(g, 'ana', 5000, 'Carga', 'vip-dep-2', 0);
  assert.ok(r.success); assert.strictEqual(api.ops.length, 1);
  assert.deepStrictEqual([api.ops[0].kind, api.ops[0].multiplier, api.ops[0].bonusAmount, api.ops[0].noBonus], ['deposit', 1, null, true]);
});
caso('Bono de la 1ª carga fuera de rango (bonus_out_of_range): la carga entra igual y el bono va APARTE como BONO ×5', async () => {
  const c = clone(CFG_AGOSTO); c.bonus.fixed_max = 20000; api.reset(c); const g = freshGirox(); const s = serverFns(g, SRV_CFG);
  const r = await s._depositWithBonus(g, 'ana', 50000, 'Carga', 'vip-dep-3', 50000);
  assert.ok(r.success); assert.strictEqual(r.bonusVia, 'separate'); assert.ok(!r.bonusFailed);
  assert.strictEqual(api.ops.length, 2);
  assert.deepStrictEqual([api.ops[0].kind, api.ops[0].multiplier, api.ops[0].bonusAmount], ['deposit', 1, null]);
  // bono aparte con 50.000 > fixed_max de bono suelto? el /bonus del falso no mira fixed_max, pero creditGift sí (precheck) ⇒ carga ×5
  assert.strictEqual(api.ops[1].ref, 'vip-dep-3-bono'); assert.strictEqual(api.ops[1].multiplier, 5);
});
caso('Reintento de la MISMA carga (timeout del cliente): no se acredita dos veces', async () => {
  api.reset(clone(CFG_AGOSTO)); const g = freshGirox(); const s = serverFns(g, SRV_CFG);
  await s._depositWithBonus(g, 'ana', 10000, 'Carga', 'vip-dep-4', 10000);
  const r2 = await s._depositWithBonus(g, 'ana', 10000, 'Carga', 'vip-dep-4', 10000);
  assert.ok(r2.success); assert.ok(r2.duplicate); assert.strictEqual(api.ops.length, 1); assert.strictEqual(api.player('ana').balance, 20000);
});
caso('1girox no acepta el ×1 en la CARGA (sólo 0/3/5): usa el menor permitido (×3), una sola operación', async () => {
  const c = clone(CFG_AGOSTO); c.rollover.multipliers = [0, 3, 5]; api.reset(c); const g = freshGirox(); const s = serverFns(g, SRV_CFG);
  // _depositRolloverXFor elige el permitido ≤ configurado (≥1); si no hay, el menor ≥1 (3)
  const r = await s._depositWithBonus(g, 'ana', 5000, 'Carga', 'vip-dep-5', 0);
  assert.ok(r.success); assert.strictEqual(api.ops.length, 1);
  assert.ok([3].includes(api.ops[0].multiplier), 'eligió ' + api.ops[0].multiplier);
});
caso('Misión / reembolso / extra por instalar ($5.000) ⇒ creditGift ×5 = BONO ×5', async () => {
  api.reset(clone(CFG_AGOSTO)); const g = freshGirox(); const s = serverFns(g, SRV_CFG);
  const x = await s._giftRolloverX(); assert.strictEqual(x, 5);
  const r = await g.creditGift('ana', 5000, { description: 'Extra por instalar', reference: 'vip-igift-u1', rolloverX: x });
  assert.ok(r.success); assert.strictEqual(r.creditedAs, 'bonus');
  assert.deepStrictEqual([api.ops[0].kind, api.ops[0].multiplier, api.ops[0].amount], ['bonus', 5, 5000]);
});
caso('Reembolso diario/semanal/mensual: /bonus estricto ×5 (creditUserBalance con multiplier)', async () => {
  api.reset(clone(CFG_AGOSTO)); const g = freshGirox();
  const r = await g.creditUserBalance('ana', 3000, 'vip-refund-x', { multiplier: 5, description: 'Reembolso' });
  assert.ok(r.success); assert.deepStrictEqual([api.ops[0].kind, api.ops[0].multiplier], ['bonus', 5]);
});
caso('Regalo ×5 con un bono ACTIVO del cliente: no se lo pisa, entra como CARGA ×5 (mismo rollover)', async () => {
  api.reset(clone(CFG_AGOSTO)); const g = freshGirox(); api.player('ana').bonusLocked = 8000; api.player('ana').balance = 8000;
  const r = await g.creditGift('ana', 2000, { description: 'Misión', reference: 'vip-mis-1', rolloverX: 5 });
  assert.ok(r.success); assert.strictEqual(r.creditedAs, 'deposit');
  assert.deepStrictEqual([api.ops[0].kind, api.ops[0].multiplier], ['deposit', 5]);
});
caso('Referidos ×1 con la config de agosto (bono sin ×1): entra como CARGA ×1, reference del pago', async () => {
  api.reset(clone(CFG_AGOSTO)); const g = freshGirox();
  const r = await g.creditGift('juan', 7000, { description: 'Comisión', reference: 'vip-refpay-p1', rolloverX: 1 });
  assert.ok(r.success); assert.strictEqual(r.creditedAs, 'deposit');
  assert.deepStrictEqual([api.ops[0].kind, api.ops[0].multiplier, api.ops[0].ref], ['deposit', 1, 'vip-refpay-p1']);
});
caso('Referidos ×1 si 1girox habilita el ×1 en bonos: entra como BONO ×1', async () => {
  api.reset(clone(CFG_CON_1)); const g = freshGirox();
  const r = await g.creditGift('juan', 7000, { description: 'Comisión', reference: 'vip-refpay-p2', rolloverX: 1 });
  assert.ok(r.success); assert.strictEqual(r.creditedAs, 'bonus'); assert.deepStrictEqual([api.ops[0].kind, api.ops[0].multiplier], ['bonus', 1]);
});
caso('Referidos: reintento del MISMO pago (crash antes de guardar) ⇒ duplicate, no paga dos veces', async () => {
  api.reset(clone(CFG_CON_1)); const g = freshGirox();
  await g.creditGift('juan', 7000, { reference: 'vip-refpay-p3', rolloverX: 1 });
  // ahora el jugador tiene ese bono bloqueado ⇒ el guard manda a CARGA con la MISMA reference: 1girox no la acredita de nuevo
  const r2 = await g.creditGift('juan', 7000, { reference: 'vip-refpay-p3', rolloverX: 1 });
  assert.strictEqual(api.ops.length, 1, 'se acreditó dos veces');
  assert.ok(!r2.success || r2.duplicate, 'el reintento tenía que ser duplicate o rebotar');
});
caso('Error pasajero (503) en el /bonus: se reintenta con la MISMA reference y entra como BONO (nunca cambia a carga por un error pasajero)', async () => {
  api.reset(clone(CFG_CON_1)); const g = freshGirox();
  const origSetTimeout = global.setTimeout; global.setTimeout = (fn) => origSetTimeout(fn, 0);
  api.fail = { path: '/bonus', n: 1, err: httpErr(503, { error: { code: 'server_error' } }) };
  const r = await g.creditGift('juan', 100, { reference: 'vip-refpay-p4', rolloverX: 1 });
  global.setTimeout = origSetTimeout;
  assert.ok(r.success); assert.strictEqual(r.creditedAs, 'bonus'); assert.strictEqual(api.ops.length, 1); assert.strictEqual(api.ops[0].ref, 'vip-refpay-p4');
});
caso('Error pasajero que no se recupera (503 ×4): devuelve error SIN acreditar como carga (el pago queda para reintentar)', async () => {
  api.reset(clone(CFG_CON_1)); const g = freshGirox();
  const origSetTimeout = global.setTimeout; global.setTimeout = (fn) => origSetTimeout(fn, 0);
  api.fail = { path: '/bonus', n: 4, err: httpErr(503, { error: { code: 'server_error' } }) };
  const r = await g.creditGift('juan', 100, { reference: 'vip-refpay-p5', rolloverX: 1 });
  global.setTimeout = origSetTimeout;
  assert.ok(!r.success); assert.strictEqual(api.ops.length, 0);
});
caso('referralPayoutService: rollover de referidos = Config referralRolloverX (default 1) y el pago usa creditGift', async () => {
  const svc = require(path.join(ROOT, 'src/services/referralPayoutService.js'));
  assert.strictEqual(await svc.getReferralRolloverX(), 1);
  configStore.referralRolloverX = 2; assert.strictEqual(await svc.getReferralRolloverX(), 2); delete configStore.referralRolloverX;
  const src = fs.readFileSync(path.join(ROOT, 'src/services/referralPayoutService.js'), 'utf8');
  assert.ok(/giroxService\.creditGift\(\s*referrer\.username,\s*totalAmount,\s*\{ description, reference: payoutReference, rolloverX: referralRolloverX \}/.test(src));
  assert.ok(!/giroxService\.creditUserBalance\(/.test(src), 'quedó un creditUserBalance en el pago de referidos');
});
caso('Misiones y reembolso acumulativo usan el rollover GLOBAL (_giftRolloverX) en server.js', async () => {
  assert.ok(/af = Object\.assign\(\{\}, af, \{ rolloverX: await _giftRolloverX\(\) \}\);/.test(SERVER), 'misiones');
  const ic = extractFn('getInstantCashbackConfig'); assert.ok((ic.match(/rolloverX: await _giftRolloverX\(\)/g) || []).length === 2, 'acumulativo');
});

(async () => {
  let ok = 0;
  for (const c of casos) {
    try { await c.fn(); ok++; console.log('✅ ' + c.n); }
    catch (e) { console.log('❌ ' + c.n + '\n   ' + (e && e.message)); }
  }
  console.log(`\n${ok}/${casos.length} casos OK`);
  process.exit(ok === casos.length ? 0 : 1);
})();
