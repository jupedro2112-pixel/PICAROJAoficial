#!/usr/bin/env node
/**
 * test-gift-carry-check.js — #1167 (réplica #236–#239 de CARGASGIROXactivo sobre el arrastre de bonos #1040).
 * Usa el código REAL de `src/services/giroxService.js` y `_depositWithBonus` de `server.js`; lo único falso es la Partner API
 * (un 1girox en memoria con "bono sobre bono", que se puede poner en modo "NO debita el bono anterior" para simular la anomalía).
 *
 *  - control de plata: si tras un arrastre el saldo sube bastante más que el regalo ⇒ hook de anomalía (y nunca en `duplicate`);
 *  - arrastre EN PAUSA: el regalo a quien tiene bono activo va por depósito con rollover, misma reference, marcado y con la
 *    descripción "BONO (contar como BONO, NO como carga)…"; sin pausa nada cambia;
 *  - las descripciones hacia 1girox empiezan con el TIPO en mayúsculas (chequeo estático de server.js).
 *
 * Corre con `node` pelado (sin node_modules, sin Mongo):  node scripts/test-gift-carry-check.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- 1girox falso
const api = {
  cfg: null, players: {}, refs: new Map(), ops: [], noCancel: false,
  reset(cfg) { this.cfg = cfg; this.players = {}; this.refs = new Map(); this.ops = []; this.noCancel = false; },
  player(u) { return this.players[u] || (this.players[u] = { username: u, balance: 0, bonusLocked: 0, claimable: 0 }); }
};
function httpErr(status, data) { const e = new Error('HTTP ' + status); e.response = { status, data }; return e; }
function v422(field, msg) { return httpErr(422, { message: msg, errors: { [field]: [msg] } }); }
async function fakeAxios({ method, url, data }) {
  const p = url.replace(process.env.GIROX_API_URL, '');
  if (method === 'get' && p === '/config') return { status: 200, data: api.cfg };
  let m = p.match(/^\/players\/([^/]+)$/);
  if (method === 'get' && m) {
    const pl = api.player(decodeURIComponent(m[1]));
    return { status: 200, data: { player: { id: 1, username: pl.username, balance: pl.balance, wagering: { available: pl.balance - pl.bonusLocked, locked: pl.bonusLocked, bonus_locked: pl.bonusLocked, claimable_total: pl.claimable, claimable: [] } } } };
  }
  m = p.match(/^\/players\/([^/]+)\/bonus\/claim$/);
  if (method === 'post' && m) {
    const pl = api.player(decodeURIComponent(m[1]));
    const a = pl.claimable; pl.claimable = 0; pl.balance += a; api.ops.push({ kind: 'claim', amount: a }); return { status: 200, data: { amount: a, claimed: [] } };
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
      if (data.multiplier != null && !api.cfg.rollover.multipliers.map(Number).includes(Number(data.multiplier))) throw v422('multiplier', 'The selected multiplier is invalid.');
      if (data.bonus_amount != null) {
        const mx = Number(api.cfg.bonus.fixed_max) || 0;
        if (mx > 0 && Number(data.bonus_amount) > mx) throw httpErr(422, { error: { code: 'bonus_out_of_range', message: 'bonus out of range' } });
      }
    } else {
      const b = api.cfg.bonus;
      if (!b.multipliers.map(Number).includes(Number(data.multiplier))) throw v422('multiplier', 'The selected multiplier is invalid.');
      const mn = Number(b.fixed_min) || 0;
      if (mn > 0 && amt < mn) throw httpErr(422, { error: { code: 'bonus_out_of_range', message: 'bonus out of range' } });
    }
    const id = api.ops.length + 1;
    const op = { id, kind, user: u, amount: amt, ref: data.reference, description: data.description || '', multiplier: data.multiplier != null ? Number(data.multiplier) : null,
      bonusAmount: data.bonus_amount != null ? Number(data.bonus_amount) : null, bonusMultiplier: data.bonus_multiplier != null ? Number(data.bonus_multiplier) : null, noBonus: !!data.no_bonus };
    api.ops.push(op); api.refs.set(data.reference, op);
    pl.balance += amt + (op.bonusAmount || 0);
    // "bono sobre bono" (manual 2.8): un bono con rollover PISA al activo y debita lo que le quedaba. `noCancel` = la anomalía: NO lo debita.
    if (kind === 'bonus' && op.multiplier > 0) { if (!api.noCancel) pl.balance -= pl.bonusLocked; pl.bonusLocked = amt; }
    if (kind === 'deposit' && op.bonusAmount && op.bonusMultiplier > 0) { if (!api.noCancel) pl.balance -= pl.bonusLocked; pl.bonusLocked = op.bonusAmount; }
    return { status: 200, data: { duplicate: false, balance: pl.balance, operation: { reference: data.reference, ledger_id: id, type: kind } } };
  }
  throw httpErr(404, { error: { code: 'not_found', message: p } });
}

// ---------------------------------------------------------------- stubs
const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} };
const _origLoad = Module._load;
Module._load = function (req) {
  if (req === 'axios') return fakeAxios;
  if (req === 'uuid') return { v4: () => crypto.randomUUID() };
  if (/utils\/logger$/.test(req)) return silent;
  if (/models\/Config$/.test(req)) return { get: async (k, d) => d };
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
  return new Function('girox', 'getConfig', 'logger', 'mongoose', '_schedArtKey', src)(girox, getConfig, silent, mongoose, () => 'k');
}

const CFG = { bonus: { enabled: true, standalone_enabled: true, multipliers: [0, 2, 5, 10], fixed_min: 0, fixed_max: 0 }, rollover: { multipliers: [0, 1, 2, 3, 5, 10] } };
const SRV_CFG = { bonusRolloverX: 5, depositRolloverX: 1 };
const clone = (o) => JSON.parse(JSON.stringify(o));
const tick = () => new Promise((r) => setTimeout(r, 5));
const casos = [];
const caso = (n, fn) => casos.push({ n, fn });
// jugador con $10.000 de saldo, de los cuales $4.000 son un bono activo
function setup({ noCancel = false, paused = false, cfg = CFG } = {}) {
  api.reset(clone(cfg)); api.noCancel = noCancel;
  const g = freshGirox();
  const anomalies = []; const carries = [];
  g.setBonusCarryAnomalyHook((a) => { anomalies.push(a); });
  g.setBonusCarryHook((c) => { carries.push(c); });
  const st = { paused };
  g.setBonusCarryPausedResolver(async () => st.paused);
  const pl = api.player('ana'); pl.balance = 10000; pl.bonusLocked = 4000;
  return { g, anomalies, carries, st, pl };
}
const last = () => api.ops[api.ops.length - 1];

caso('creditGift con bono activo y 1girox normal: BONO por regalo + resto, sin anomalía (comportamiento del #1040 intacto)', async () => {
  const { g, anomalies, carries, pl } = setup();
  const r = await g.creditGift('ana', 1000, { description: 'REGALO — Premio de la ruleta diaria: $1.000', reference: 'vip-roulette-1', rolloverX: 5 });
  await tick();
  assert.strictEqual(r.success, true); assert.strictEqual(r.creditedAs, 'bonus'); assert.strictEqual(r.carriedBonus, 4000); assert.strictEqual(r.bonusTotal, 5000);
  assert.strictEqual(last().kind, 'bonus'); assert.strictEqual(last().amount, 5000); assert.strictEqual(last().multiplier, 5); assert.strictEqual(last().ref, 'vip-roulette-1');
  assert.ok(last().description.startsWith('REGALO — Premio de la ruleta diaria'), last().description);
  assert.ok(/que quedaban del bono anterior\)$/.test(last().description), 'conserva el sufijo de arrastre');
  assert.strictEqual(pl.balance, 11000, 'el jugador gana sólo el regalo');
  assert.strictEqual(anomalies.length, 0); assert.strictEqual(carries.length, 1);
});

caso('creditGift: 1girox NO debita el bono anterior ⇒ hook de anomalía con los saldos; el reintento (duplicate) NO lo dispara', async () => {
  const { g, anomalies } = setup({ noCancel: true });
  const r = await g.creditGift('ana', 1000, { description: 'REGALO — x', reference: 'vip-x-1', rolloverX: 5 });
  await tick();
  assert.strictEqual(r.success, true);
  assert.strictEqual(anomalies.length, 1);
  const a = anomalies[0];
  assert.strictEqual(a.username, 'ana'); assert.strictEqual(a.gift, 1000); assert.strictEqual(a.carry, 4000); assert.strictEqual(a.balBefore, 10000); assert.strictEqual(a.balAfter, 15000); assert.strictEqual(a.gained, 5000); assert.strictEqual(a.reference, 'vip-x-1');
  const r2 = await g.creditGift('ana', 1000, { description: 'REGALO — x', reference: 'vip-x-1', rolloverX: 5 });
  await tick();
  assert.strictEqual(r2.duplicate, true); assert.strictEqual(anomalies.length, 1, 'duplicate no avisa de nuevo');
});

caso('umbral del origen: regalo + max(100, 50% del resto) — una diferencia chica (el jugador ganó una apuesta en el medio) no avisa', async () => {
  const { g } = setup();
  const res = (after) => ({ success: true, duplicate: false, data: { user_balance_after: after } });
  const base = { username: 'ana', reference: 'r', gift: 1000, carry: 4000, total: 5000, balBefore: 10000 };
  assert.strictEqual(g.checkBonusCarry({ ...base, result: res(13000) }), false, 'subió 3000 = justo el umbral (1000 + 2000): no avisa');
  assert.strictEqual(g.checkBonusCarry({ ...base, result: res(13001) }), true);
  assert.strictEqual(g.checkBonusCarry({ ...base, carry: 60, result: res(11100) }), false, 'resto chico: margen mínimo de $100');
  assert.strictEqual(g.checkBonusCarry({ ...base, carry: 60, result: res(11101) }), true);
  assert.strictEqual(g.checkBonusCarry({ ...base, balBefore: null, result: res(99999) }), false, 'sin saldo anterior no se juzga');
  assert.strictEqual(g.checkBonusCarry({ ...base, result: { success: true, duplicate: true, data: { user_balance_after: 99999 } } }), false, 'nunca en duplicate');
  assert.strictEqual(g.checkBonusCarry({ ...base, result: { success: true, data: {} } }), false, 'sin saldo en la respuesta no se juzga');
});

caso('arrastre EN PAUSA + bono activo: creditGift va por DEPÓSITO ×5, misma reference, sólo el regalo, con la descripción de BONO', async () => {
  const { g, anomalies, carries, pl } = setup({ paused: true });
  const r = await g.creditGift('ana', 1000, { description: 'REGALO — Premio de la ruleta diaria: $1.000', reference: 'vip-roulette-2', rolloverX: 5 });
  await tick();
  assert.strictEqual(r.success, true); assert.strictEqual(r.creditedAs, 'deposit'); assert.ok(/PAUSA/.test(r.fallbackReason)); assert.ok(!r.carriedBonus);
  assert.strictEqual(last().kind, 'deposit'); assert.strictEqual(last().amount, 1000); assert.strictEqual(last().multiplier, 5); assert.strictEqual(last().ref, 'vip-roulette-2');
  assert.strictEqual(last().description, 'BONO (contar como BONO, NO como carga): REGALO — Premio de la ruleta diaria: $1.000 — sale como depósito por una limitación de la API de 1girox');
  assert.strictEqual(pl.balance, 11000); assert.strictEqual(pl.bonusLocked, 4000, 'no pisa el bono en curso');
  assert.strictEqual(anomalies.length, 0); assert.strictEqual(carries.length, 0);
});

caso('arrastre EN PAUSA sin bono activo: sigue saliendo como BONO normal', async () => {
  const { g, pl } = setup({ paused: true }); pl.bonusLocked = 0;
  const r = await g.creditGift('ana', 1000, { description: 'REGALO — x', reference: 'vip-x-3', rolloverX: 5 });
  assert.strictEqual(r.creditedAs, 'bonus'); assert.strictEqual(last().kind, 'bonus'); assert.strictEqual(last().amount, 1000);
  assert.strictEqual(last().description, 'REGALO — x');
});

caso('creditUserBalance con carryOver (reembolsos, VIP, rakeback, manual, lotes): control de anomalía y pausa', async () => {
  let s = setup({ noCancel: true });
  let r = await s.g.creditUserBalance('ana', 2000, 'vip-rf-1', { multiplier: 5, description: 'REEMBOLSO diario del 2026-11-24 — regalo', carryOver: true });
  await tick();
  assert.strictEqual(r.success, true); assert.strictEqual(r.carriedBonus, 4000); assert.strictEqual(s.anomalies.length, 1); assert.strictEqual(s.anomalies[0].gained, 6000);
  s = setup();
  r = await s.g.creditUserBalance('ana', 2000, 'vip-rf-2', { multiplier: 5, description: 'REEMBOLSO diario', carryOver: true });
  await tick();
  assert.strictEqual(r.creditedAs, 'bonus'); assert.strictEqual(last().amount, 6000); assert.strictEqual(s.anomalies.length, 0);
  s = setup({ paused: true });
  r = await s.g.creditUserBalance('ana', 2000, 'vip-rf-3', { multiplier: 5, description: 'REEMBOLSO diario', carryOver: true });
  assert.strictEqual(r.success, true); assert.strictEqual(r.creditedAs, 'deposit'); assert.ok(!r.carriedBonus);
  assert.strictEqual(last().kind, 'deposit'); assert.strictEqual(last().amount, 2000); assert.strictEqual(last().multiplier, 5); assert.strictEqual(last().ref, 'vip-rf-3');
  assert.ok(last().description.startsWith('BONO (contar como BONO, NO como carga): REEMBOLSO diario'));
  // sin carryOver (un /bonus estricto de siempre) la pausa no cambia nada
  s = setup({ paused: true });
  r = await s.g.creditUserBalance('ana', 2000, 'vip-x-4', { multiplier: 5, description: 'x' });
  assert.strictEqual(r.creditedAs, 'bonus'); assert.strictEqual(last().kind, 'bonus'); assert.strictEqual(last().amount, 2000);
});

caso('bono "a reclamar" pendiente: se reclama antes (como siempre) y el control no juzga (el saldo cambió por el reclamo)', async () => {
  const { g, anomalies, pl } = setup({ noCancel: true }); pl.claimable = 700;
  const r = await g.creditGift('ana', 1000, { description: 'REGALO — x', reference: 'vip-x-5', rolloverX: 5 });
  await tick();
  assert.strictEqual(r.success, true); assert.strictEqual(api.ops[0].kind, 'claim'); assert.strictEqual(r.carriedBonus, 4000);
  assert.strictEqual(anomalies.length, 0);
});

caso('regalo que cae a depósito por otro motivo (monto bajo el mínimo de bono; regalo directo ×0): descripción de BONO', async () => {
  const cfg = clone(CFG); cfg.bonus.fixed_min = 50;
  let s = setup({ cfg }); s.pl.bonusLocked = 0;
  let r = await s.g.creditGift('ana', 1, { description: 'REEMBOLSO diario del 2026-11-24', reference: 'vip-rf-9', rolloverX: 5 });
  assert.strictEqual(r.creditedAs, 'deposit'); assert.strictEqual(last().kind, 'deposit');
  assert.ok(last().description.startsWith('BONO (contar como BONO, NO como carga): REEMBOLSO diario del 2026-11-24 — sale como depósito'));
  s = setup({ cfg }); s.pl.bonusLocked = 0;
  r = await s.g.creditUserBalance('ana', 1, 'vip-x-9', { description: 'DEVOLUCIÓN de retiro rechazado — parte del retiro que era bono' });
  assert.strictEqual(r.creditedAs, 'deposit');
  assert.ok(last().description.startsWith('BONO (contar como BONO, NO como carga): DEVOLUCIÓN de retiro rechazado'));
  assert.strictEqual(s.g.giftAsDepositDesc(last().description), last().description, 'no se antepone dos veces');
});

caso('carga con bono pegado: arrastre normal sin anomalía; 1girox sin debitar ⇒ anomalía (esperado = carga + bono)', async () => {
  let s = setup(); let f = serverFns(s.g, SRV_CFG);
  let r = await f._depositWithBonus(s.g, 'ana', 5000, 'Carga automática', 'vip-dep-1', 1000);
  await tick();
  assert.strictEqual(r.success, true); assert.strictEqual(r.bonusVia, 'attached'); assert.strictEqual(r.carriedBonus, 4000);
  assert.strictEqual(last().bonusAmount, 5000); assert.strictEqual(s.pl.balance, 16000); assert.strictEqual(s.anomalies.length, 0);
  s = setup({ noCancel: true }); f = serverFns(s.g, SRV_CFG);
  r = await f._depositWithBonus(s.g, 'ana', 5000, 'Carga automática', 'vip-dep-2', 1000);
  await tick();
  assert.strictEqual(r.success, true); assert.strictEqual(s.anomalies.length, 1);
  assert.strictEqual(s.anomalies[0].expected, 6000); assert.strictEqual(s.anomalies[0].gained, 10000); assert.strictEqual(s.anomalies[0].kind, 'deposit');
});

caso('carga con bono y arrastre EN PAUSA: carga SIN bono pegado + bono aparte por depósito ×5 (ref -bono); un reintento no lo manda de nuevo', async () => {
  const s = setup({ paused: true }); const f = serverFns(s.g, SRV_CFG);
  const r = await f._depositWithBonus(s.g, 'ana', 5000, 'Carga automática', 'vip-dep-3', 1000);
  assert.strictEqual(r.success, true); assert.strictEqual(r.bonusVia, 'separate'); assert.strictEqual(r.bonusCreditedAs, 'deposit'); assert.ok(!r.carriedBonus); assert.ok(!r.bonusFailed);
  const deps = api.ops.filter((o) => o.kind === 'deposit');
  assert.strictEqual(deps.length, 2);
  assert.strictEqual(deps[0].ref, 'vip-dep-3'); assert.strictEqual(deps[0].amount, 5000); assert.strictEqual(deps[0].bonusAmount, null); assert.strictEqual(deps[0].noBonus, true); assert.strictEqual(deps[0].description, 'Carga automática');
  assert.strictEqual(deps[1].ref, 'vip-dep-3-bono'); assert.strictEqual(deps[1].amount, 1000); assert.strictEqual(deps[1].multiplier, 5);
  assert.ok(deps[1].description.startsWith('BONO (contar como BONO, NO como carga): BONO de la carga — '), deps[1].description);
  assert.strictEqual(s.pl.balance, 16000); assert.strictEqual(s.pl.bonusLocked, 4000);
  const n = api.ops.length;
  const r2 = await f._depositWithBonus(s.g, 'ana', 5000, 'Carga automática', 'vip-dep-3', 1000);
  assert.strictEqual(r2.success, true); assert.strictEqual(r2.duplicate, true); assert.strictEqual(r2.bonusVia, 'duplicate');
  assert.strictEqual(api.ops.length, n, 'el reintento no movió nada'); assert.strictEqual(s.pl.balance, 16000);
});

caso('carga con bono, arrastre en pausa pero SIN bono activo: bono pegado como siempre', async () => {
  const s = setup({ paused: true }); s.pl.bonusLocked = 0; const f = serverFns(s.g, SRV_CFG);
  const r = await f._depositWithBonus(s.g, 'ana', 5000, 'Carga automática', 'vip-dep-4', 1000);
  assert.strictEqual(r.bonusVia, 'attached'); assert.strictEqual(last().bonusAmount, 1000); assert.strictEqual(api.ops.length, 1);
});

caso('estático: toda descripción hacia 1girox empieza con el TIPO en mayúsculas; marca, tarjetas, pausa y ruta en su lugar', async () => {
  const lines = SERVER.split('\n');
  const calls = lines.filter((l) => /\.(creditGift|creditUserBalance)\(/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/function /.test(l));
  // cada llamada de regalo que arma su descripción en la misma línea la empieza con un TIPO conocido
  const TIPOS = /description: (ig\.pct != null \? )?[`'](REEMBOLSO|REGALO — |BONO — |BONO manual — |BONO de la carga — |DEVOLUCIÓN |COMISIÓN )/;
  const conDesc = calls.filter((l) => /description: /.test(l) && !/description: (desc|sendDesc|description)\b/.test(l));
  assert.ok(conDesc.length >= 12, 'esperaba al menos 12 llamadas con descripción propia, hay ' + conDesc.length);
  for (const l of conDesc) assert.ok(TIPOS.test(l), 'descripción sin TIPO: ' + l.trim().slice(0, 160));
  for (const t of ['REEMBOLSO diario del ', 'REEMBOLSO semanal del ', 'REEMBOLSO mensual del ', 'REEMBOLSO ACUMULATIVO — ', 'REGALO — Rakeback semanal VIP del ', 'BONO manual — bonificación otorgada por el agente ',
    'BONO — Premio por alcanzar el nivel VIP ', 'BONO — Bono sorpresa por el código de bienvenida', 'REGALO — Fueguito (racha diaria): ', 'REGALO — Premio de la ruleta diaria: ', 'REGALO — Misión semanal cumplida: ',
    'REGALO — Extra por instalar la app', 'REGALO — Código sorpresa ', 'REGALO — Fichas de regalo del lote de notificaciones', 'BONO de la carga — ', 'DEVOLUCIÓN de retiro rechazado — ']) {
    assert.ok(SERVER.includes(t), 'falta la descripción: ' + t);
  }
  const REF = fs.readFileSync(path.join(ROOT, 'src/services/referralPayoutService.js'), 'utf8');
  assert.ok(REF.includes('COMISIÓN de referidos — '));
  assert.ok(!/description: 'Reembolso ' \+ _refundPeriodKey/.test(SERVER));
  // las Transactions locales NO cambiaron de texto
  for (const t of ['description: `Reembolso diario (${dateStr})`', "description: 'Bonificación otorgada',", 'description: `Fueguito - ${rewardDesc}`', "description: 'Bono sorpresa — código de bienvenida de la Comunidad',"]) assert.ok(SERVER.includes(t), 'cambió un texto local: ' + t);
  assert.ok(/function _giftMeta\(r\)/.test(SERVER)); assert.ok((SERVER.match(/_giftMeta\(/g) || []).length >= 15);
  assert.ok(SERVER.includes('giftsAsDeposit, giftsAsDepositCount') && SERVER.includes('carriedBonus, carriedBonusCount, carryPause'));
  assert.ok(SERVER.includes('girox.setBonusCarryAnomalyHook(') && SERVER.includes('girox.setBonusCarryPausedResolver('));
  // TDZ: la ruta nueva va después de la definición de los middlewares, y /strategy está en la lista de sólo-admin
  const iRoute = SERVER.indexOf("app.post('/api/admin/strategy/bonus-carry'"); const iMw = SERVER.indexOf('const adminMiddleware = ');
  assert.ok(iRoute > iMw && iMw > 0);
  assert.ok(/STAFF_DENY_MUTATIONS = \[\s*\n\s*\/\^\\\/api\\\/admin\\\/\([^\n]*\|strategy\|/.test(SERVER), '/api/admin/strategy sigue en STAFF_DENY_MUTATIONS');
  // mensaje del fueguito: objetivo sobre el total cuando hubo arrastre
  assert.ok(SERVER.includes('Math.round((rewardAmount + _fireCarry) * _fireMult)'));
  const ADMIN = fs.readFileSync(path.join(ROOT, 'public/adminprivado2026/admin.js'), 'utf8');
  assert.ok(ADMIN.includes('summary.giftsAsDeposit') && ADMIN.includes('summary.carriedBonus') && ADMIN.includes('window.bonusCarrySet = bonusCarrySet'));
});

(async () => {
  let ok = 0;
  for (const c of casos) {
    try { await c.fn(); ok++; console.log('  ✔ ' + c.n); }
    catch (e) { console.log('  ✘ ' + c.n + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e)); }
  }
  console.log(`\n${ok}/${casos.length} casos OK`);
  process.exit(ok === casos.length ? 0 : 1);
})();
