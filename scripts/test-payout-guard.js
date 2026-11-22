#!/usr/bin/env node
/**
 * Test en frío del CANDADO ANTI PAGO DOBLE entre cuentas / bancos (#1163–#1165, réplica #219–#221 de
 * AUTOREEMBOLSOSjygactivo) — sin red ni Mongo.
 * Recorta el bloque real de server.js (`const PAYOUT_RESEND_COOLDOWN_MS` … `async function
 * _payPayoutViaFinpro`): si se renombran esos marcadores, actualizar acá.
 * Los casos "PICA ROJA" del final son propios de este repo: reintentos con externalID `-rN` (#820), salidas propias
 * ('own': gasto por API / devolución) y el PAGO AUTOMÁTICO (nunca confirma solo: queda para una persona).
 * Uso: node scripts/test-payout-guard.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('const PAYOUT_RESEND_COOLDOWN_MS = ');
const b = src.indexOf('async function _payPayoutViaFinpro(', a);
if (a < 0 || b < 0) throw new Error('no encuentro el bloque del candado de pagos en server.js');
const block = src.slice(a, b);

let movements = [];
const updates = [];
const match = (m, q) => {
  if (q.direction && m.direction !== q.direction) return false;
  if (q.outKind && m.outKind !== q.outKind) return false;
  if (q.$or && !q.$or.some((c) => Object.keys(c).every((k) => m[k] === c[k]))) return false;
  if (q.createdAt && !(new Date(m.createdAt) >= q.createdAt.$gte)) return false;
  if (q.amount && !(m.amount >= q.amount.$gte && m.amount <= q.amount.$lte)) return false;
  return true;
};
const S = {
  BankMovement: { find: (q) => ({ sort() { return this; }, limit() { return this; }, lean: async () => movements.filter((m) => match(m, q)) }) },
  PendingPayout: { updateOne: async (q, u) => { updates.push({ q, u }); } },
  _hgAccountByKey: (k) => ({ a1: { key: 'a1', label: 'CUENTA-A' }, a2: { key: 'a2', label: 'CUENTA-B' } }[k] || null),
  _fpAccountByKey: (k) => (k === 'f1' ? { key: 'f1', label: 'CUENTA-F' } : null),
  _hgAccountLabel: (x) => x.label, _fpAccountLabel: (x) => x.label,
  _hgAccountLabelFor: (m) => (m.accountKey ? { label: m.accountKey === 'a1' ? 'CUENTA-A' : 'CUENTA-B' } : null),
  _bankLabel: (p) => (p === 'finpro' ? 'Finpro' : 'hgcash'),
  _digits: (x) => String(x || '').replace(/\D/g, ''),
  logger: { info() {}, warn() {}, error() {} },
  __out: null
};
new Function('S', 'with (S) {\n' + block + '\n__out = { _payoutVerifyLeft, _payoutVerifyBlock, PAYOUT_VERIFY_MS, _payoutResendGuard, _payoutNoteSend, _payoutNoteResult, PAYOUT_RESEND_COOLDOWN_MS }; }')(S);
const X = S.__out;

const CBU = '0000003100000000000001';
const ago = (ms) => new Date(Date.now() - ms);
const P = (o) => Object.assign({ id: 'p1', amount: 999000, username: 'cliente1', sendLog: [] }, o || {});
let fails = 0;
const tests = [];
const t = (name, fn) => tests.push([name, async () => { movements = []; updates.length = 0; await fn(); }]);

t('primer envío de un retiro: pasa', async () => {
  assert.strictEqual(await X._payoutResendGuard(P(), 'hgcash', 'a1', CBU, false), null);
});
t('ya hay una SALIDA del banco con el id del retiro: no se paga otra vez (ni confirmando)', async () => {
  movements = [{ direction: 'Outbound', externalId: 'p1', payoutId: 'p1', amount: 999000, toCBU: CBU, status: 'done', accountKey: 'a1', createdAt: ago(40000) }];
  const g = await X._payoutResendGuard(P({ lastSendAt: ago(45000), lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: 'unknown' }), 'hgcash', 'a2', CBU, true);
  assert.ok(g && g.http === 409 && g.body.alreadySent === true); assert.ok(/YA SALIÓ/.test(g.body.error) && /CUENTA-A/.test(g.body.error));
  // aunque sea el primer intento anotado (pedido viejo sin lastSendAt)
  const g2 = await X._payoutResendGuard(P(), 'finpro', 'f1', CBU, true);
  assert.ok(g2 && g2.body.alreadySent === true);
});
t('una salida con estado de error / reversada no cuenta como pagada', async () => {
  movements = [{ direction: 'Outbound', externalId: 'p1', payoutId: 'p1', amount: 999000, toCBU: CBU, status: 'REVERSED', createdAt: ago(600000) }];
  const g = await X._payoutResendGuard(P({ lastSendAt: ago(600000), lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: 'rejected' }), 'hgcash', 'a2', CBU, false);
  assert.strictEqual(g, null);
});
t('incidente CUENTA-A → CUENTA-B a los 46 s: se frena por la espera', async () => {
  const g = await X._payoutResendGuard(P({ lastSendAt: ago(46000), lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: 'rejected' }), 'hgcash', 'a2', CBU, true);
  assert.ok(g && g.http === 409 && g.body.wait === true && g.body.retryInSec > 60 && g.body.retryInSec <= 75);
  assert.ok(/CUENTA-A/.test(g.body.error));
});
t('incidente Finpro → hgcash a los 35 s: se frena por la espera', async () => {
  const g = await X._payoutResendGuard(P({ lastSendAt: ago(35000), lastSendBank: 'finpro', lastSendAccount: 'f1', lastSendResult: 'rejected' }), 'hgcash', 'a1', CBU, false);
  assert.ok(g && g.body.wait === true && /Finpro · CUENTA-F/.test(g.body.error));
});
t('reintento por la MISMA cuenta: no espera (ahí vale la idempotencia del banco)', async () => {
  const g = await X._payoutResendGuard(P({ lastSendAt: ago(5000), lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: 'unknown' }), 'hgcash', 'a1', CBU, false);
  assert.strictEqual(g, null);
});
t('pasada la espera: rechazo CLARO del banco anterior → pasa sin preguntar', async () => {
  const g = await X._payoutResendGuard(P({ lastSendAt: ago(X.PAYOUT_RESEND_COOLDOWN_MS + 1000), lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: 'rejected' }), 'hgcash', 'a2', CBU, false);
  assert.strictEqual(g, null);
});
t('pasada la espera: envío anterior SIN respuesta clara → pide confirmación; confirmado pasa', async () => {
  for (const res of ['unknown', 'sending', 'accepted']) {
    const p = P({ lastSendAt: ago(X.PAYOUT_RESEND_COOLDOWN_MS + 1000), lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: res });
    const g = await X._payoutResendGuard(p, 'finpro', 'f1', CBU, false);
    assert.ok(g && g.http === 409 && g.body.needsConfirm === true, res);
    assert.strictEqual(await X._payoutResendGuard(p, 'finpro', 'f1', CBU, true), null, res);
  }
});
t('después del envío salió el mismo monto al mismo CBU sin ligar (Finpro no trae nuestro id): pide confirmación', async () => {
  movements = [{ provider: 'finpro', direction: 'Outbound', amount: 999000, toCBU: CBU, status: 'done', outKind: 'unknown', createdAt: ago(200000) }];
  const p = P({ lastSendAt: ago(210000), lastSendBank: 'finpro', lastSendAccount: 'f1', lastSendResult: 'rejected', sendLog: [{ at: ago(210000) }] });
  const g = await X._payoutResendGuard(p, 'hgcash', 'a1', CBU, false);
  assert.ok(g && g.body.needsConfirm === true && /SALIÓ del banco/.test(g.body.error));
  // otro destino, otro monto, ligada a OTRO retiro o una bajada → no frena
  for (const m of [{ toCBU: '1'.repeat(22) }, { amount: 5000 }, { payoutId: 'otro' }, { outKind: 'sweep' }, { createdAt: ago(900000) }]) {
    movements = [Object.assign({ provider: 'finpro', direction: 'Outbound', amount: 999000, toCBU: CBU, status: 'done', outKind: 'unknown', createdAt: ago(200000) }, m)];
    assert.strictEqual(await X._payoutResendGuard(p, 'hgcash', 'a1', CBU, false), null, JSON.stringify(m));
  }
});
t('#220 incidente real: salió por FUERA de la app el mismo monto al mismo CBU → el primer pago por la app pide confirmación', async () => {
  const p = P({ createdAt: ago(400000) });
  movements = [{ direction: 'Outbound', outKind: 'unknown', amount: 999000, toCBU: CBU, status: 'done', accountKey: 'a1', createdAt: ago(60000) }];
  const g = await X._payoutResendGuard(p, 'finpro', 'f1', CBU, false);
  assert.ok(g && g.http === 409 && g.body.needsConfirm === true && /FUERA de la app/.test(g.body.error) && /CUENTA-A/.test(g.body.error));
  assert.strictEqual(await X._payoutResendGuard(p, 'finpro', 'f1', CBU, true), null); // confirmando, pasa
  // anterior al pedido, otro destino, ya ligada a un retiro o reversada → no frena
  for (const m of [{ createdAt: ago(900000) }, { toCBU: '1'.repeat(22) }, { payoutId: 'otro' }, { status: 'REVERSED' }, { outKind: 'payout' }]) {
    movements = [Object.assign({ direction: 'Outbound', outKind: 'unknown', amount: 999000, toCBU: CBU, status: 'done', createdAt: ago(60000) }, m)];
    assert.strictEqual(await X._payoutResendGuard(p, 'finpro', 'f1', CBU, false), null, JSON.stringify(m));
  }
});
t('#221 envío a hgcash SIN respuesta: el retiro queda VERIFICANDO y bloqueado durante la ventana', async () => {
  const v = { status: 'failed', hgSendUnknown: true, verifyUntil: new Date(Date.now() + 100000), lastSendBank: 'hgcash', lastSendAccount: 'a1' };
  const left = X._payoutVerifyLeft(v); assert.ok(left > 95 && left <= 100);
  const b = X._payoutVerifyBlock(v);
  assert.ok(b && b.http === 409 && b.body.verifying === true && b.body.wait === true && /PUDO HABER SALIDO/.test(b.body.error) && /CUENTA-A/.test(b.body.error));
  // ventana vencida, rechazo claro, otro estado o pedido viejo → no bloquea
  for (const o of [{ verifyUntil: ago(1000) }, { hgSendUnknown: false }, { status: 'paying' }, { status: 'pending_review' }, { verifyUntil: null }]) {
    assert.strictEqual(X._payoutVerifyBlock(Object.assign({}, v, o)), null, JSON.stringify(o));
  }
  assert.strictEqual(X._payoutVerifyBlock(null), null);
  assert.strictEqual(X.PAYOUT_VERIFY_MS, 3 * 60 * 1000);
});
t('anotar el envío y su resultado deja el rastro en el retiro', async () => {
  await X._payoutNoteSend('p1', 'hgcash', 'a1', 'agente1');
  await X._payoutNoteResult('p1', 'unknown', 'timeout');
  assert.strictEqual(updates.length, 2);
  const s0 = updates[0].u.$set; assert.strictEqual(s0.lastSendBank, 'hgcash'); assert.strictEqual(s0.lastSendAccount, 'a1'); assert.strictEqual(s0.lastSendResult, 'sending');
  assert.strictEqual(updates[0].u.$push.sendLog.$each[0].label, 'hgcash · CUENTA-A');
  assert.strictEqual(updates[1].u.$set.lastSendResult, 'unknown');
});

// ── Propios de PICA ROJA ─────────────────────────────────────────────────────────────────────────
t('PICA ROJA: la salida de un reintento con externalID `<id>-rN` (#820) también cuenta como "ya salió"', async () => {
  // movimiento nuevo: el aviso del banco lo clasifica con payoutId = id sin sufijo
  movements = [{ direction: 'Outbound', externalId: 'p1-r2', payoutId: 'p1', outKind: 'payout', amount: 999000, toCBU: CBU, status: 'done', accountKey: 'a1', createdAt: ago(40000) }];
  let g = await X._payoutResendGuard(P({ extSuffix: '-r2' }), 'hgcash', 'a1', CBU, true);
  assert.ok(g && g.body.alreadySent === true);
  // movimiento anterior a la clasificación (sin payoutId): se reconoce por el externalID vigente del retiro
  movements = [{ direction: 'Outbound', externalId: 'p1-r2', amount: 999000, toCBU: CBU, status: 'done', createdAt: ago(40000) }];
  g = await X._payoutResendGuard(P({ extSuffix: '-r2' }), 'hgcash', 'a1', CBU, true);
  assert.ok(g && g.body.alreadySent === true);
  assert.strictEqual(await X._payoutResendGuard(P({ extSuffix: '-r3' }), 'hgcash', 'a1', CBU, true), null); // es de OTRO externalID: no lo da por salido
});
t('PICA ROJA: una salida PROPIA (gasto por API / devolución, outKind own) no frena el reintento', async () => {
  const p = P({ lastSendAt: ago(210000), lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: 'rejected', sendLog: [{ at: ago(210000) }] });
  movements = [{ direction: 'Outbound', outKind: 'own', externalId: 'gasto-abc', amount: 999000, toCBU: CBU, status: 'done', createdAt: ago(100000) }];
  assert.strictEqual(await X._payoutResendGuard(p, 'hgcash', 'a1', CBU, false), null);
});
t('PICA ROJA: el aviso del banco clasifica las SALIDAS de hgcash (payout sin `-rN` / own / unknown) y engancha la alerta', async () => {
  const i = src.indexOf("app.post('/api/hgcash/webhook'"); const w = src.slice(i, src.indexOf("app.get('/api/payout-receipt/", i));
  assert.ok(i > 0 && w.length > 500);
  const m = w.match(/if \(doc\.direction === 'Outbound'\) \{\n([\s\S]*?)\n    \}\n/); assert.ok(m, 'bloque de clasificación');
  const classify = (ext) => { const doc = { direction: 'Outbound', externalId: ext }; new Function('doc', '_CAJA_OUR_EXT', m[1])(doc, /^(gasto-|refund-|devol|vip-)/i); return doc; };
  assert.deepStrictEqual(classify('abc-123'), { direction: 'Outbound', externalId: 'abc-123', outKind: 'payout', payoutId: 'abc-123' });
  assert.strictEqual(classify('abc-123-r4').payoutId, 'abc-123'); assert.strictEqual(classify('abc-123-r4').outKind, 'payout');
  assert.strictEqual(classify('gasto-9').outKind, 'own'); assert.strictEqual(classify('refund-mov1').outKind, 'own'); assert.strictEqual(classify('gasto-9').payoutId, undefined);
  assert.strictEqual(classify(null).outKind, 'unknown'); assert.strictEqual(classify('').outKind, 'unknown');
  assert.ok(/doc\.outKind === 'unknown'\) _alertUnknownOutbound\(doc\.movementId\)/.test(w));
  assert.ok(/PendingPayout\.exists\(\{ id: doc\.payoutId, status: 'failed', hgSendUnknown: true \}\)/.test(w));
  assert.ok(/const _CAJA_OUR_EXT = \/\^\(gasto-\|refund-\|devol\|vip-\)\/i;/.test(src), 'si cambia _CAJA_OUR_EXT, actualizar este test');
  assert.ok(/led\.movement\.outKind !== 'payout'\) _alertUnknownOutbound\(led\.movement\.movementId\)/.test(src), 'gancho en el aviso de Finpro');
});
t('PICA ROJA: TODO camino que manda plata al banco está cubierto (createCashOut con token explícito; retiros con candado + anotación)', async () => {
  const calls = src.split('hgcashPay.createCashOut({').slice(1).map((x) => x.slice(0, 700));
  assert.strictEqual(calls.length, 3, 'hay un createCashOut nuevo: revisar si necesita el candado y sumarlo acá');
  for (const c of calls) assert.ok(/\btoken: /.test(c.slice(0, c.indexOf('});') + 3)), 'createCashOut sin token explícito: ' + c.slice(0, 120));
  assert.strictEqual(src.split('finpro.createCvuTransfer(').length - 1, 1, 'hay un envío nuevo a Finpro: revisar si necesita el candado');
  const a = src.indexOf('async function _payPayoutViaFinpro('), b = src.indexOf('async function _finproSyncPayout(', a), c = src.indexOf('async function _payPendingPayout('), d = src.indexOf("app.post('/api/admin/payouts/:id/pay'", c);
  const fp = src.slice(a, b), hg = src.slice(c, d);
  for (const [name, body, send] of [['finpro', fp, 'finpro.createCvuTransfer('], ['hgcash', hg, 'await buildCashOut(accountId)']]) {
    const iG = body.indexOf('await _payoutResendGuard('), iC = body.indexOf("{ $set: { status: 'paying', resolvedCbu"), iN = body.indexOf('await _payoutNoteSend('), iS = body.indexOf(send);
    assert.ok(iG > 0 && iC > iG, name + ': el candado va ANTES de reclamar el retiro');
    assert.ok(iN > iC && iS > iN, name + ': el envío se anota ANTES de mandarlo al banco');
    assert.ok(/_payoutVerifyBlock\(payout\)/.test(body), name + ': respeta VERIFICANDO');
    assert.ok(/await _payoutGuardAutoHold\(payout, (req\.user|actor), _g\)/.test(body), name + ': el pago automático frenado por el candado queda para una persona');
    for (const r of ['accepted', 'rejected', 'unknown']) assert.ok(body.includes("_payoutNoteResult(id, '" + r + "'") || body.includes("? 'unknown' : 'rejected'"), name + ': anota el resultado ' + r);
  }
  // el pago por Finpro sólo se llama desde _payPendingPayout (que ya pasó por VERIFICANDO y por el antifraude del automático)
  assert.strictEqual(src.split('_payPayoutViaFinpro(req, res)').length - 1, 2);
  // el reintento automático no gasta intentos mientras se verifica, y nunca manda confirmOtherBank
  const t0 = src.indexOf('async function _payoutAutoRetryTick('); const tick = src.slice(t0, src.indexOf('\n}\n', t0));
  assert.ok(/if \(_payoutVerifyLeft\(r\)\) continue;/.test(tick)); assert.ok(/hgSendUnknown verifyUntil/.test(tick));
  const autos = src.match(/_payPendingPayout\([^)]*PAYOUT_AUTO_ACTOR[^)]*\)/g) || [];
  assert.ok(autos.length >= 3); for (const x of autos) assert.ok(!/confirmOtherBank/.test(x), 'un pago automático no puede confirmar solo: ' + x);
  // rechazar / marcar pagado por fuera / descartar respetan VERIFICANDO
  for (const mark of ['async function _payoutCancelHandler(', "app.post('/api/admin/payouts/:id/pay-other-bank'", "app.post('/api/admin/payouts/:id/dismiss'"]) {
    const k = src.indexOf(mark); assert.ok(k > 0 && /_payoutVerifyBlock\(/.test(src.slice(k, k + 900)), mark + ': respeta VERIFICANDO');
  }
});
t('PICA ROJA: pago AUTOMÁTICO frenado por el candado → queda para una persona (y sólo el automático)', async () => {
  const a = src.indexOf('async function _payoutGuardAutoHold('), b = src.indexOf('async function _payPendingPayout(', a);
  assert.ok(a > 0 && b > a);
  const ups = [], notes = [], holds = [];
  const S2 = { PAYOUT_AUTO_ACTOR: { username: 'auto-retiros' }, PendingPayout: { updateOne: async (q, u) => { ups.push({ q, u }); return { modifiedCount: 1 }; } },
    _emitAdminOnlyChatNote: async (...x) => { notes.push(x); }, _notifyWithdrawHold: async (...x) => { holds.push(x); }, io: { to: () => ({ emit() {} }) }, logger: { info() {}, warn() {} }, __f: null };
  new Function('S', 'with (S) {\n' + src.slice(a, b) + '\n__f = _payoutGuardAutoHold; }')(S2);
  const p = { id: 'p1', userId: 'u1', username: 'cliente1', amount: 5000, debitConfirmed: true };
  await S2.__f(p, { username: 'agente1' }, { body: { needsConfirm: true, error: 'x' } }); assert.strictEqual(ups.length, 0, 'una persona decide ella: no se toca');
  await S2.__f(p, { username: 'auto-retiros' }, { body: { wait: true, error: 'x' } }); assert.strictEqual(ups.length, 0, 'una espera no es para una persona: se reintenta solo');
  await S2.__f(p, { username: 'auto-retiros' }, { body: { needsConfirm: true, error: 'verificá' } });
  assert.strictEqual(ups.length, 1); assert.strictEqual(ups[0].u.$set.reviewRequired, true); assert.strictEqual(ups[0].u.$set.autoPay, false);
  assert.deepStrictEqual(ups[0].q.status, { $in: ['pending_review', 'failed'] });
  assert.strictEqual(notes.length, 1); assert.ok(/PAGO AUTOMÁTICO FRENADO/.test(notes[0][2]));
  assert.strictEqual(holds.length, 1); assert.deepStrictEqual(holds[0][2], { chipsTaken: true });
  await S2.__f(p, { username: 'auto-retiros' }, { body: { alreadySent: true, error: 'ya salió' } }); assert.strictEqual(ups.length, 2);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✅ ' + name); } catch (e) { fails++; console.log('  ❌ ' + name + '\n     ' + (e && e.message)); }
  }
  console.log(fails ? `\n❌ ${fails} fallas` : `\n✅ Todo OK (${tests.length})`);
  process.exit(fails ? 1 : 0);
})();
