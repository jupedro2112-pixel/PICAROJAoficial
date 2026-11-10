#!/usr/bin/env node
// #1090 — correcciones por pérdidas (owner aprobó). Usa las funciones REALES de server.js (extraídas del código, sin base ni node_modules)
// con modelos de mentira: topes de la Bonificación para agentes, regalos semanales sólo para clientes fieles, rollover mínimo de los lotes,
// gastos por API "en proceso" (sin re-enviar el pago). El cruce de caja está en test-caja-movimientos.js. Datos INVENTADOS.
'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const fnIn = (src, name) => { const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(src); if (!m) throw new Error('no está ' + name); let d = 0; const i = src.indexOf('{', m.index); for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) return src.slice(m.index, j + 1); } return ''; };
const lineIn = (src, start) => { const i = src.indexOf(start); if (i < 0) throw new Error('no está ' + start); return src.slice(i, src.indexOf('\n', i)); };

let ok = 0; const fails = [];
const caso = async (n, f) => { try { await f(); ok++; console.log('✔ ' + n); } catch (e) { fails.push(n); console.log('✘ ' + n + '\n   ' + e.message); } };

// ---- 1. Bonificación manual: _staffBonusCheck
const txs = []; let giftMax = 15000;
const Transaction = { aggregate: async (pipe) => { const m = pipe[0].$match; const s = txs.filter((t) => t.type === m.type && t.adminId === m.adminId && t.description === m.description && t.timestamp >= m.timestamp.$gte).reduce((a, t) => a + t.amount, 0); return s ? [{ s }] : []; } };
const B = new Function('Transaction', 'datosIa', '_isFlagged', '_refreshGiftMax', 'getGM',
  lineIn(S, 'const STAFF_BONUS_PER_DEFAULT') + '\nlet _giftMaxCache = 0;\n' + fnIn(S, '_staffBonusCheck').replace('await _refreshGiftMax();', 'await _refreshGiftMax(); _giftMaxCache = getGM();') + '\nreturn { _staffBonusCheck, STAFF_BONUS_DAY_MAX };')(
  Transaction, { dateKeyART: (d) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10) }, (u) => Array.isArray(u && u.fraudFlags) && u.fraudFlags.length > 0, async () => giftMax, () => giftMax);
const agent = { userId: 'ag-1', role: 'depositor' }; const cli = { id: 'c1', username: 'cli1', fraudFlags: [] };

// ---- 2. regalos semanales: historias
const ST = new Function(fnIn(S, '_storyNeedsTrust') + '\n' + fnIn(S, '_storyHiddenForUntrusted') + '\nreturn { _storyNeedsTrust, _storyHiddenForUntrusted };')();

// ---- 3. lotes: _batchRolloverX
let globalRx = 5;
const L = new Function('_giftRolloverX', fnIn(S, '_batchRolloverX') + '\nreturn _batchRolloverX;')(async () => globalRx);

// ---- 5. gastos en proceso
const exps = [], movs = []; let statusAns = null, listAns = { ok: true, items: [] }, closes = [];
const getp = (o, k) => k.split('.').reduce((x, p) => (x == null ? undefined : x[p]), o);
const mt = (d, f) => Object.keys(f).every((k) => { const v = f[k], dv = getp(d, k); if (v && typeof v === 'object' && !(v instanceof Date)) { if ('$lte' in v && !(dv <= v.$lte)) return false; if ('$gte' in v && !(dv >= v.$gte)) return false; return true; } return dv === v; });
const q = (data) => { const o = { select: () => o, sort: () => o, limit: () => o, lean: () => Promise.resolve(typeof data === 'function' ? data() : data) }; return o; };
const Expense = { find: (f) => q(() => exps.filter((d) => mt(d, f))), findOne: (f) => q(() => exps.find((d) => mt(d, f)) || null),
  updateOne: async (f, u) => { const d = exps.find((x) => mt(x, f)); if (!d) return { modifiedCount: 0 }; for (const [k, v] of Object.entries(u.$set || {})) { const ps = k.split('.'); let x = d; for (let i = 0; i < ps.length - 1; i++) { x[ps[i]] = x[ps[i]] || {}; x = x[ps[i]]; } x[ps[ps.length - 1]] = v; } return { modifiedCount: 1 }; } };
const BankMovement = { findOne: (f) => q(() => movs.find((d) => mt(d, f)) || null) };
const sent = []; const hgcashPay = { isEnabled: () => true, getTransactionStatus: async () => statusAns || { ok: false }, listMovements: async () => listAns, createCashOut: async (x) => { sent.push(x); return { ok: true }; } };
const G = new Function('Expense', 'BankMovement', 'hgcashPay', 'logger', '_cronClaim', '_cronRelease', 'resolveHgcashAccountId', '_closeEnsure',
  [fnIn(S, '_gastoAmbiguous'), lineIn(S, 'const _GASTO_REJ'), 'let _gastoPayingRunning = false;', fnIn(S, '_gastoPayingSet'), fnIn(S, '_gastoPayingTick'), 'return { _gastoAmbiguous, _gastoPayingTick };'].join('\n'))(
  Expense, BankMovement, hgcashPay, { info() {}, warn() {} }, async () => true, async () => {}, async () => 'acc-1', async (k) => { closes.push(k); });
const old = (min) => new Date(Date.now() - min * 60000);

(async () => {
  await caso('Bonificación agente: hasta $15.000 pasa, $15.001 no (tope por bonificación)', async () => {
    assert.strictEqual(await B._staffBonusCheck(agent, cli, 15000), null);
    const r = await B._staffBonusCheck(agent, cli, 15001); assert.strictEqual(r.code, 'STAFF_BONUS_MAX'); assert.ok(/\$15\.000/.test(r.error));
  });
  await caso('Bonificación agente: giftMaxArs en 0 ("sin tope") igual topea a $15.000 para agentes; giftMaxArs $10.000 ⇒ tope $10.000', async () => {
    giftMax = 0; assert.strictEqual((await B._staffBonusCheck(agent, cli, 16000)).code, 'STAFF_BONUS_MAX');
    giftMax = 10000; assert.strictEqual((await B._staffBonusCheck(agent, cli, 12000)).code, 'STAFF_BONUS_MAX'); giftMax = 15000;
  });
  await caso('Bonificación agente: tope diario $30.000 por agente (suma lo de hoy; otro agente no cuenta)', async () => {
    txs.push({ type: 'bonus', adminId: 'ag-1', description: 'Bonificación otorgada', amount: 15000, timestamp: new Date() }, { type: 'bonus', adminId: 'ag-1', description: 'Bonificación otorgada', amount: 10000, timestamp: new Date() });
    txs.push({ type: 'bonus', adminId: 'ag-2', description: 'Bonificación otorgada', amount: 15000, timestamp: new Date() }, { type: 'bonus', adminId: 'ag-1', description: 'Bonificación otorgada', amount: 15000, timestamp: new Date(Date.now() - 2 * 86400000) });
    assert.strictEqual(await B._staffBonusCheck(agent, cli, 5000), null);
    const r = await B._staffBonusCheck(agent, cli, 5001); assert.strictEqual(r.code, 'STAFF_BONUS_DAY'); assert.ok(/te quedan \$5\.000/.test(r.error), r.error);
    assert.strictEqual(await B._staffBonusCheck({ userId: 'ag-3' }, cli, 15000), null);
  });
  await caso('Bonificación agente: secundaria / bloqueada / con marcas / en observación ⇒ no', async () => {
    for (const u of [{ duplicateOf: { username: 'principal1' } }, { isBlocked: true }, { fraudFlags: ['cbu_reuse'] }, { fraudReview: { status: 'watch' } }]) {
      const r = await B._staffBonusCheck({ userId: 'ag-9' }, Object.assign({ fraudFlags: [] }, u), 100); assert.strictEqual(r && r.code, 'STAFF_BONUS_NOT_ELIGIBLE', JSON.stringify(u));
    }
  });
  await caso('Bonificación: la ruta deja libre al admin general (el chequeo es sólo para role !== admin) y el aviso DUP_BONUS sigue antes', () => {
    const i = S.indexOf("app.post('/api/admin/bonus'"); const body = S.slice(i, i + 3000);
    assert.ok(/if \(req\.user\.role !== 'admin'\) \{\s*const _lim = await _staffBonusCheck/.test(body)); assert.ok(body.indexOf('DUP_BONUS') < body.indexOf('_staffBonusCheck('));
  });
  await caso('Historias: con bono pública (miércoles/admin) y regalo al azar = regalo semanal; bienvenida día 5/15/30 NO', () => {
    assert.ok(ST._storyNeedsTrust({ bonusPct: 100, audienceUserId: null })); assert.ok(ST._storyNeedsTrust({ autoKind: 'regalo_azar', audienceUserId: 'u1', bonusPct: 30 }));
    assert.ok(!ST._storyNeedsTrust({ autoKind: 'bienvenida', audienceUserId: 'u1', bonusPct: 50 })); assert.ok(!ST._storyNeedsTrust({ bonusPct: 0, audienceUserId: null }));
    assert.ok(ST._storyHiddenForUntrusted({ autoKind: 'codigo' })); assert.ok(ST._storyHiddenForUntrusted({ autoKind: 'codigo_teaser' })); assert.ok(!ST._storyHiddenForUntrusted({ autoKind: 'servicio' }));
  });
  await caso('Regalos semanales: reclamo de historia, giro gratis, canje de código y regalo al azar pasan por la regla de cliente fiel', () => {
    const claim = S.slice(S.indexOf("app.post('/api/stories/:id/claim-bonus'"), S.indexOf("app.get('/api/stories/bonus'")); assert.ok(/_storyNeedsTrust\(s\) && !\(await _isTrustedClient/.test(claim));
    assert.ok(/why: 'trust'/.test(fnIn(S, '_rouletteFreeEligible'))); assert.ok(/_isTrustedClient\(user\.id\)/.test(fnIn(S, '_codeDropClaimHandler')));
    assert.ok(/_trustedIdsAmong\(_mine0\)/.test(fnIn(S, '_storyGiftTick'))); assert.ok(/_isTrustedClient/.test(fnIn(S, 'claimStoryBonusPercent')));
    assert.ok(/_trustedIdsAmong\(ids\)/.test(fnIn(S, '_rouletteNudgeTick')));
  });
  await caso('Lotes de fichas: rollover nunca menos que el global (×0 ⇒ ×5; ×10 queda ×10)', async () => {
    assert.strictEqual(await L({ rolloverX: 0 }), 5); assert.strictEqual(await L({}), 5); assert.strictEqual(await L({ rolloverX: 10 }), 10); globalRx = 3; assert.strictEqual(await L({ rolloverX: 1 }), 3); globalRx = 5;
  });
  await caso('Gastos: timeout / red / 5xx / duplicate = ambiguo (en proceso); 400 / 403 / 422 = falló', () => {
    for (const r of [{ error: 'timeout' }, { httpStatus: 502 }, { httpStatus: 408 }, { httpStatus: 409, error: 'Duplicate External ID' }]) assert.ok(G._gastoAmbiguous(r), JSON.stringify(r));
    for (const r of [{ httpStatus: 400 }, { httpStatus: 403 }, { httpStatus: 422 }, { httpStatus: 409, error: 'otra cosa' }]) assert.ok(!G._gastoAmbiguous(r), JSON.stringify(r));
  });
  await caso('Gastos en proceso: la salida aparece en el banco (webhook) ⇒ pagado; sin re-enviar el pago', async () => {
    exps.push({ id: 'g1', dateKey: '2026-11-10', amount: 50000, concept: 'Publicista', paidVia: 'hgcash', status: 'paying', createdAt: old(5) });
    movs.push({ movementId: 'mv-1', direction: 'Outbound', externalId: 'gasto-g1', status: 'DONE' });
    await G._gastoPayingTick(); assert.strictEqual(exps[0].status, 'paid'); assert.strictEqual(exps[0].hgId, 'mv-1'); assert.strictEqual(sent.length, 0); assert.deepStrictEqual(closes, ['2026-11-10']);
  });
  await caso('Gastos en proceso: el banco lo rechazó ⇒ falló; recién creado (<1 min) no se toca', async () => {
    exps.push({ id: 'g2', dateKey: '2026-11-10', amount: 1000, concept: 'x', paidVia: 'hgcash', status: 'paying', createdAt: old(5), hgId: 'req-2' });
    exps.push({ id: 'g3', dateKey: '2026-11-10', amount: 1000, concept: 'y', paidVia: 'hgcash', status: 'paying', createdAt: new Date() });
    statusAns = { ok: true, status: 'ERROR' }; await G._gastoPayingTick(); statusAns = null;
    assert.strictEqual(exps.find((e) => e.id === 'g2').status, 'failed'); assert.strictEqual(exps.find((e) => e.id === 'g3').status, 'paying'); assert.strictEqual(sent.length, 0);
  });
  await caso('Gastos en proceso: no aparece ⇒ sigue en proceso; aparece en la lista del banco ⇒ pagado; 24 h sin aparecer ⇒ falló (no salió)', async () => {
    exps.push({ id: 'g4', dateKey: '2026-11-10', amount: 2000, concept: 'z', paidVia: 'hgcash', status: 'paying', createdAt: old(10) });
    exps.push({ id: 'g5', dateKey: '2026-11-09', amount: 3000, concept: 'w', paidVia: 'hgcash', status: 'paying', createdAt: old(25 * 60) });
    exps.find((e) => e.id === 'g3').createdAt = old(3);
    await G._gastoPayingTick(); assert.strictEqual(exps.find((e) => e.id === 'g4').status, 'paying'); assert.strictEqual(exps.find((e) => e.id === 'g5').status, 'failed');
    listAns = { ok: true, items: [{ id: 'bk-4', status: 'DONE', raw: { externalID: 'gasto-g4' } }] }; await G._gastoPayingTick();
    assert.strictEqual(exps.find((e) => e.id === 'g4').status, 'paid'); assert.strictEqual(exps.find((e) => e.id === 'g3').status, 'paying');
    listAns = { ok: false }; exps.find((e) => e.id === 'g3').createdAt = old(30 * 60); await G._gastoPayingTick(); assert.strictEqual(exps.find((e) => e.id === 'g3').status, 'paying', 'sin respuesta del banco no se marca fallido');
    assert.strictEqual(sent.length, 0);
  });
  await caso('Gastos: la ruta deja EN PROCESO (202) en vez de "falló", no deja pagar otro igual ni borrar uno en proceso', () => {
    const i = S.indexOf("app.post('/api/admin/gastos'"); const body = S.slice(i, S.indexOf("app.delete('/api/admin/gastos/:id'", i) + 900);
    assert.ok(/_gastoAmbiguous\(result\)[\s\S]*status: 'paying'[\s\S]*status\(202\)/.test(body)); assert.ok(/GASTO_IN_PROCESS/.test(body)); assert.ok(/g\.status === 'paying'\) return res\.status\(400\)/.test(body));
  });
  console.log(`\n${ok}/${ok + fails.length} casos OK`); if (fails.length) { console.log('FALLARON: ' + fails.join(' · ')); process.exit(1); }
})();
