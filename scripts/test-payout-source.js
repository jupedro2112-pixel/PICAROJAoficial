#!/usr/bin/env node
/**
 * Test en frío de "DE QUÉ CUENTA SALEN LOS RETIROS" (#1168, réplica #223 de AUTOREEMBOLSOSjygactivo) — sin red ni Mongo.
 * Recorta el bloque real de server.js (`const _hgLastApiPick` … `async function _payoutSourcesPayload`):
 * si se renombran esos marcadores, actualizar acá.
 * Uso: node scripts/test-payout-source.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('const _hgLastApiPick = new Map();');
const b = src.indexOf('async function _payoutSourcesPayload(', a);
if (a < 0 || b < 0) throw new Error('no encuentro el bloque de la cuenta que paga en server.js');
const block = src.slice(a, b);

let cfg = {};
let apiByToken = {};   // token → { ok, data } de GET /accounts
let fpBalances = {};   // account → { ok, available }
const S = {
  getConfig: async (k, d) => (k in cfg ? cfg[k] : d),
  getHgcashConfig: async () => ({ currency: 'ARS' }),
  getBankProvider: async () => cfg.bankProvider || 'hgcash',
  BANK_PROVIDERS: ['hgcash', 'finpro'],
  _hgAccounts: [], _hgActiveKey: null,
  _hgAccountLabel: (x) => x.label, _fpAccountLabel: (x) => x.label,
  _fpList: () => S.__fp, __fp: [],
  _fpReadyPayouts: (x) => !!x.ready, _fpCtx: (x) => x,
  _bankLabel: (p) => (p === 'finpro' ? 'Finpro' : 'hgcash'),
  _digits: (x) => String(x || '').replace(/\D/g, ''),
  hgcashPay: { isEnabled: () => true, getAccounts: async (t) => apiByToken[t] || { ok: false, error: 'sin respuesta' } },
  finpro: { getBalance: async ({ account }) => fpBalances[account] || { ok: false, error: 'sin respuesta' } },
  logger: { info() {}, warn() {}, error() {} },
  __out: null
};
new Function('S', 'with (S) {\n' + block + '\n__out = { _hgNameContains, _hgPickApiAccount, _hgApiAccountOf, _hgTokenAccountId, _paySlots, _paySlotInfo, _payoutPickSource, getPayoutSource, _paySlotInfoCache }; }')(S);
const X = S.__out;

let n = 0;
const ok = (name) => { n++; console.log('  ✅ ' + name); };
const CBU_A = '0000000000000000000111', CBU_B = '0000000000000000000222';
// Datos neutros: tres cuentas que ve UN mismo token.
const LIST = [
  { id: 'id-1', name: 'EMPRESA UNO SA', currency: 'ARS', status: 'ACTIVE', netBalance: 1000 },
  { id: 'id-2', name: 'Distribuidora Dos S.A.', currency: 'ARS', status: 'ACTIVE', netBalance: 50000 },
  { id: 'id-3', name: 'TERCERA SRL', currency: 'ARS', status: 'ACTIVE', netBalance: 7000, cvu: CBU_B }
];

(async () => {
  console.log('1) Qué cuenta de hgcash debita un perfil');
  let r = X._hgPickApiAccount({ key: 'a1', titular: 'X' }, [LIST[0]], 'ARS');
  assert.strictEqual(r.how, 'only'); assert.strictEqual(r.pick.id, 'id-1'); ok('una sola cuenta → esa');
  r = X._hgPickApiAccount({ key: 'a2', titular: 'DISTRIBUIDORA DOS S.A.', accountId: 'id-1' }, LIST, 'ARS');
  assert.strictEqual(r.pick.id, 'id-2'); assert.strictEqual(r.how, 'name'); ok('varias cuentas: gana el TITULAR aunque el id guardado sea el de otra (el caso del reporte)');
  r = X._hgPickApiAccount({ key: 'a3', cbu: CBU_B, titular: 'EMPRESA UNO SA' }, LIST, 'ARS');
  assert.strictEqual(r.pick.id, 'id-3'); assert.strictEqual(r.how, 'cbu'); ok('el CBU manda sobre el titular');
  r = X._hgPickApiAccount({ key: 'a2', titular: 'DISTRIBUIDORA DOS S.A.', payAccountId: 'id-1' }, LIST, 'ARS');
  assert.strictEqual(r.pick.id, 'id-1'); assert.strictEqual(r.how, 'pinned'); ok('la fijada a mano manda sobre todo');
  r = X._hgPickApiAccount({ key: 'a2', titular: 'OTRO NOMBRE', payAccountId: 'id-99', accountId: 'id-3' }, LIST, 'ARS');
  assert.strictEqual(r.pick.id, 'id-3'); assert.strictEqual(r.how, 'id'); ok('fijada que ya no existe → sigue con las otras pistas');
  r = X._hgPickApiAccount({ key: 'a9', titular: 'NADA QUE VER' }, LIST, 'ARS');
  assert.strictEqual(r.how, 'guess'); assert.strictEqual(r.pick.id, 'id-1'); ok('sin pistas → adivina y lo MARCA (how: guess)');
  r = X._hgPickApiAccount({ key: 'a9', titular: 'SA' }, LIST, 'ARS');
  assert.strictEqual(r.how, 'guess'); ok('un titular de 2 letras no matchea nada');

  assert.strictEqual(X._hgApiAccountOf(LIST, { titular: 'NADA QUE VER' }), null); assert.strictEqual(X._hgApiAccountOf(LIST, { cbu: CBU_B }).id, 'id-3'); ok('lecturas (saldo / movimientos): la cuenta del perfil, o null si habría que adivinar');
  assert.strictEqual(X._hgTokenAccountId({ titular: 'TERCERA SRL' }, { apiList: LIST, apiAccountId: 'id-1' }), 'id-3');
  assert.strictEqual(X._hgTokenAccountId({ titular: 'NADA QUE VER' }, { apiList: LIST, apiAccountId: 'id-1' }), null);
  assert.strictEqual(X._hgTokenAccountId({ titular: 'X' }, { apiList: [LIST[0]], apiAccountId: 'id-1' }), 'id-1'); ok('token nuevo que ve varias cuentas: nunca se guarda "la primera"');

  // Casos de la auditoría (#1168c, réplica #223c)
  const L2 = [{ id: 'x1', name: 'JOSE MARIA GOMEZ', currency: 'ARS' }, { id: 'x2', name: 'MARIA GOMEZ', currency: 'ARS' }];
  r = X._hgPickApiAccount({ key: 'b1', titular: 'MARIA GOMEZ' }, L2, 'ARS');
  assert.strictEqual(r.pick.id, 'x2'); assert.strictEqual(r.how, 'name'); ok('titular EXACTO gana aunque otra cuenta lo contenga');
  r = X._hgPickApiAccount({ key: 'b2', titular: 'JUANA' }, [{ id: 'y1', name: 'JUAN ALVAREZ' }, { id: 'y2', name: 'OTRA SA' }], 'ARS');
  assert.strictEqual(r.how, 'guess'); ok('no matchea por pedazos de palabra ("JUANA" no es "JUAN ALVAREZ")');
  r = X._hgPickApiAccount({ key: 'b3', label: 'Cuenta SRL', accountId: 'z2' }, [{ id: 'z1', name: 'OTRA CUENTA SRL' }, { id: 'z2', name: 'LA BUENA SA' }], 'ARS');
  assert.strictEqual(r.pick.id, 'z2'); assert.strictEqual(r.how, 'id'); ok('la ETIQUETA del perfil no pisa un id guardado por parecerse a otra cuenta');
  assert.strictEqual(X._hgNameContains('Distribuidora Dos', 'DISTRIBUIDORA DOS S.A.'), true); assert.strictEqual(X._hgNameContains('JUANA', 'JUAN ALVAREZ'), false); ok('"contiene" va por palabras enteras');
  assert.strictEqual(X._hgTokenAccountId({ titular: 'NADA QUE VER', cbu: CBU_B }, { apiList: LIST, apiAccountId: 'id-1' }), 'id-3'); ok('alta de perfil con token que ve varias: identifica por CBU (lista cruda `apiList`)');
  assert.strictEqual(X._hgTokenAccountId({ label: 'Tercera', titular: 'NADA QUE VER' }, { apiList: LIST, apiAccountId: 'id-1' }), null); ok('… y una etiqueta parecida no alcanza: queda sin cuenta, con aviso');

  console.log('2) De dónde sale un retiro');
  S._hgAccounts.push({ key: 'a1', label: 'CUENTA-A', token: 'tA', secret: 's', titular: 'EMPRESA UNO SA' }, { key: 'a2', label: 'CUENTA-B', token: 'tB', secret: 's', titular: 'Distribuidora Dos' }, { key: 'a3', label: 'SIN-TOKEN' });
  S.__fp = [{ key: 'f1', label: 'CUENTA-F', ready: true, account: 'acc-f1' }, { key: 'f2', label: 'F-NO-LISTA', ready: false }];
  apiByToken = { tA: { ok: true, data: LIST }, tB: { ok: true, data: LIST } };
  fpBalances = { 'acc-f1': { ok: true, available: 20000 } };
  assert.deepStrictEqual(X._paySlots().map((s) => s.id), ['hgcash:a1', 'hgcash:a2', 'finpro:f1']); ok('solo las cuentas que pueden pagar (con token / listas)');

  r = await X._payoutPickSource({}, 5000);
  assert.strictEqual(r.provider, 'hgcash'); assert.strictEqual(r.key, null); assert.strictEqual(r.why, 'active'); ok('por defecto: la cuenta EN USO del banco de retiros (sin cambios)');
  cfg.bankProvider = 'finpro';
  r = await X._payoutPickSource({}, 5000); assert.strictEqual(r.provider, 'finpro'); assert.strictEqual(r.key, null); ok('… y respeta el banco de retiros');
  r = await X._payoutPickSource({ provider: 'hgcash' }, 5000); assert.strictEqual(r.provider, 'hgcash'); assert.strictEqual(r.key, null); ok('"pagar por el otro banco" del panel viejo sigue andando');
  r = await X._payoutPickSource({ source: 'hgcash:a2' }, 5000); assert.strictEqual(r.key, 'a2'); assert.strictEqual(r.why, 'chosen'); ok('cuenta elegida a mano para ESE retiro');
  r = await X._payoutPickSource({ source: 'hgcash:a3' }, 5000); assert.ok(r.error); ok('una cuenta que no puede pagar se rechaza (no cae a otra en silencio)');
  r = await X._payoutPickSource({ source: 'finpro:zz' }, 5000); assert.ok(r.error); ok('una cuenta inexistente se rechaza');

  cfg.payoutSource = { mode: 'fixed', fixed: 'hgcash:a2' };
  r = await X._payoutPickSource({}, 5000); assert.strictEqual(r.provider, 'hgcash'); assert.strictEqual(r.key, 'a2'); assert.strictEqual(r.why, 'fixed'); ok('cuenta FIJA: sale de esa aunque el banco de retiros sea otro');
  r = await X._payoutPickSource({ source: 'finpro:f1' }, 5000); assert.strictEqual(r.key, 'f1'); ok('… y la elegida a mano le gana a la fija');
  cfg.payoutSource = { mode: 'fixed', fixed: 'hgcash:borrada' };
  r = await X._payoutPickSource({}, 5000); assert.strictEqual(r.key, null); assert.strictEqual(r.why, 'fixed-missing'); ok('cuenta fija borrada → vuelve a la cuenta en uso');

  cfg.payoutSource = { mode: 'richest' };
  r = await X._payoutPickSource({}, 5000);
  assert.strictEqual(r.provider, 'hgcash'); assert.strictEqual(r.key, 'a2'); assert.strictEqual(r.balance, 50000); ok('AUTOMÁTICO: la de más saldo (a2 = $50.000, por su titular)');
  X._paySlotInfoCache.clear(); fpBalances['acc-f1'] = { ok: true, available: 90000 };
  r = await X._payoutPickSource({}, 5000); assert.strictEqual(r.provider, 'finpro'); assert.strictEqual(r.key, 'f1'); ok('… compara los dos bancos');
  r = await X._payoutPickSource({}, 500000); assert.ok(r.error && /saldo/i.test(r.error)); ok('ninguna alcanza → error claro ANTES de tocar nada');
  X._paySlotInfoCache.clear(); apiByToken = {}; fpBalances = {};
  r = await X._payoutPickSource({}, 5000); assert.strictEqual(r.key, null); assert.strictEqual(r.why, 'richest-unknown'); ok('no se pudo leer ningún saldo → la cuenta en uso (no frena los pagos)');
  X._paySlotInfoCache.clear(); apiByToken = { tA: { ok: true, data: LIST } };
  r = await X._payoutPickSource({}, 500); assert.strictEqual(r.key, 'a1'); ok('una cuenta que no responde no participa');

  // #1168c (réplica #223c) un REINTENTO en modo automático vuelve por la misma cuenta; y una cuenta sin webhook no se elige sola
  X._paySlotInfoCache.clear(); apiByToken = { tA: { ok: true, data: LIST }, tB: { ok: true, data: LIST } }; fpBalances = {};
  r = await X._payoutPickSource({}, 500, { lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: 'unknown' });
  assert.strictEqual(r.key, 'a1'); assert.strictEqual(r.why, 'retry-same'); ok('reintento con envío dudoso → MISMA cuenta (aunque otra tenga más saldo)');
  r = await X._payoutPickSource({}, 500, { lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: 'rejected' });
  assert.strictEqual(r.key, 'a2'); assert.strictEqual(r.why, 'richest'); ok('reintento tras un RECHAZO claro → puede ir a la de más saldo');
  r = await X._payoutPickSource({}, 500, { lastSendBank: 'hgcash', lastSendAccount: 'a9', lastSendResult: 'unknown' });
  assert.strictEqual(r.key, 'a2'); assert.strictEqual(r.why, 'richest'); ok('… y si aquella cuenta ya no está, la de más saldo (al automático lo frena _payoutAutoJump; a una persona, el candado)');
  r = await X._payoutPickSource({ source: 'hgcash:a2' }, 500, { lastSendBank: 'hgcash', lastSendAccount: 'a1', lastSendResult: 'unknown' });
  assert.strictEqual(r.key, 'a2'); ok('… y la elegida a mano sigue mandando (el candado pide esperar y confirmar)');
  S._hgAccounts[1].secret = null; X._paySlotInfoCache.clear();
  r = await X._payoutPickSource({}, 500); assert.strictEqual(r.key, 'a1'); ok('una cuenta SIN secreto de webhook no entra en la elección automática');
  S._hgAccounts[0].secret = null; S._hgAccounts[1].secret = null; X._paySlotInfoCache.clear();
  r = await X._payoutPickSource({}, 500); assert.strictEqual(r.key, 'a2'); assert.strictEqual(r.why, 'richest'); ok('… pero si NINGÚN perfil tiene secreto (avisos por el de AWS), todas participan');
  S._hgAccounts[0].secret = 's'; S._hgAccounts[1].secret = 's';

  console.log('3) Cableado en server.js');
  assert.ok(/const _hgKeyPay = \(req\._paySrc && req\._paySrc\.key\) \|\| _hgActiveKey;/.test(src)); ok('el pago por hgcash usa la cuenta elegida');
  assert.ok(/const _hgAcctPay = _hgAccountByKey\(_hgKeyPay\) \|\| _hgActiveAccount\(\);/.test(src)); ok('… con SU token y SU perfil');
  assert.ok(/const _srcAcct = _srcKey \? \(_srcKey === 'env' \? _fpEnvAccount\(\) : _fpAccountByKey\(_srcKey\)\) : null;/.test(src)); ok('el pago por Finpro usa la cuenta elegida');
  assert.ok(/if \(_srcKey && !_srcAcct\) return res\.status\(400\)/.test(src) && /if \(req\._paySrc && req\._paySrc\.key && !\(_hgAcctPay && _hgAcctPay\.key === req\._paySrc\.key && _hgAcctPay\.token\)\) return res\.status\(400\)/.test(src)); ok('una cuenta elegida que ya no está NO cae en silencio a otra');
  assert.ok(/_payoutResendGuard\(payout, 'hgcash', _hgKeyPay \|\| 'env'/.test(src)); ok('el candado anti pago doble recibe la cuenta REAL que paga');
  assert.ok(/hgAccountKey: _hgKeyPay \|\| null, hgDebitAccountId: String\(accountId\)/.test(src)); ok('el pago recuerda la cuenta que lo mandó (perfil + cuenta real de hgcash)');
  assert.ok(/!\(_pk\.how === 'guess' && acc\.data\.length > 1\)/.test(src)); ok('una cuenta adivinada no se guarda como propia del perfil');
  assert.ok(/const _src = await _payoutPickSource\(opts \|\| \{\}, payout\.amount, payout\);/.test(src)); ok('el pago manual Y el automático (_payPendingPayout) resuelven la cuenta en el mismo lugar, con el retiro (reintento → misma cuenta)');
  // El pago automático nunca cambia solo de cuenta (se recorta la función real).
  const ja = src.indexOf('function _payoutAutoJump('), jb = src.indexOf('function _payoutAcctLabel(', ja);
  const J = { PAYOUT_AUTO_ACTOR: { username: 'auto-retiros' }, _payoutAcctLabel: (b, k) => b + ':' + k, __f: null };
  new Function('J', 'with (J) {\n' + src.slice(ja, jb) + '\n__f = _payoutAutoJump; }')(J);
  const AUTO = { username: 'auto-retiros' }, prev = { lastSendBank: 'hgcash', lastSendAccount: 'a1' };
  assert.ok(J.__f(prev, AUTO, { why: 'richest' }, 'hgcash', 'a2').body.needsConfirm);
  assert.ok(J.__f(prev, AUTO, { why: 'fixed' }, 'finpro', 'f1').body.needsConfirm);
  assert.strictEqual(J.__f(prev, AUTO, { why: 'richest' }, 'hgcash', 'a1'), null);
  assert.strictEqual(J.__f({}, AUTO, { why: 'richest' }, 'hgcash', 'a2'), null);
  assert.strictEqual(J.__f(prev, AUTO, { why: 'active' }, 'hgcash', 'a2'), null);
  assert.strictEqual(J.__f(prev, AUTO, { why: 'retry-same' }, 'hgcash', 'a1'), null); // #1168c un reintento que vuelve por la misma cuenta no se frena
  assert.strictEqual(J.__f(prev, { username: 'una-persona' }, { why: 'richest' }, 'hgcash', 'a2'), null); ok('el pago AUTOMÁTICO no cambia solo de cuenta (fija / más saldo): queda para una persona; modo por defecto y personas, igual que antes');
  assert.ok(/_payoutAutoJump\(payout, actor, req\._paySrc, 'hgcash', _hgKeyPay \|\| 'env'\)/.test(src) && /_payoutAutoJump\(payout, req\.user, req\._paySrc, 'finpro', acctKey\)/.test(src)); ok('… y está cableado en los dos caminos, antes del candado');
  // #1168c: la cuenta REAL del envío anterior (`hgDebitAccountId`) la compara el candado (espera de 2 min + confirmación), no un chequeo aparte.
  assert.ok(/_payoutResendGuard\(payout, 'hgcash', _hgKeyPay \|\| 'env', resolvedCbu, [^;]+, accountId\);/.test(src) && /_payoutNoteSend\(id, 'hgcash', _hgKeyPay \|\| 'env', req\.user\.username, accountId\)/.test(src)); ok('el candado y el registro del envío reciben la cuenta REAL');
  assert.ok(/payout\.hgDebitAccountId && realAccountId && String\(payout\.hgDebitAccountId\) !== String\(realAccountId\)/.test(src)); ok('mismo perfil pero otra cuenta real de hgcash que el envío anterior → NO es la misma ruta');
  assert.strictEqual((src.match(/hgDebitAccountId: String\(accountId\)/g) || []).length, 2); assert.ok(!/lastSendAccountId/.test(src)); ok('UN solo campo para la cuenta real del envío (hgDebitAccountId)');
  assert.ok(/if \(acct\) return null;\s*\n\s*const _movKey = /.test(src)); ok('un pago nunca usa "la cuenta del último movimiento" como respaldo');
  assert.ok(/accountId = fresh;\s*\n\s*await PendingPayout\.updateOne\(\{ id \}, \{ \$set: \{ hgDebitAccountId: String\(accountId\) \} \}\)/.test(src)); ok('el reintento por 403 actualiza la cuenta REAL anotada');
  assert.ok(/!\(_src\.key \? !!_hgTokenFor\(_src\.key\) : hgcashPay\.isEnabled\(\)\)/.test(src)); ok('alcanza con que la cuenta elegida tenga token');
  assert.ok(/paidFrom: _payoutAcctLabel\('hgcash', _hgKeyPay\) \+ _hgDebitNote\(_hgKeyPay\)/.test(src) && /paidFrom: _payoutAcctLabel\('finpro', acctKey\)/.test(src)); ok('la respuesta del pago dice por dónde SALIÓ (los dos bancos)');
  const adm = fs.readFileSync(path.join(__dirname, '..', 'public', 'adminprivado2026', 'admin.js'), 'utf8');
  assert.strictEqual((adm.match(/SALIÓ POR ' \+ escapeHtml\(j\.paidFrom\)/g) || []).length, 2); assert.ok(/s\.noWebhook \?/.test(adm)); ok('el panel lo muestra escapado (chat y Confirmación de pagos) y marca las cuentas sin webhook');
  for (const [f, code] of [['server.js', src], ['admin.js', adm]]) {
    const dupFns = (code.match(/^(?:async )?function [A-Za-z0-9_$]+/gm) || []).map((x) => x.split(' ').pop()).filter((x, i, arr) => arr.indexOf(x) !== i);
    assert.deepStrictEqual(dupFns, [], f);
  }
  ok('no hay NINGUNA función declarada dos veces en server.js ni en admin.js');
  const own = src.slice(src.indexOf('const OWNER_ONLY_MUTATIONS'), src.indexOf('const adminMiddleware'));
  assert.ok(/payout-sources/.test(own) && /pay-account/.test(own)); ok('cambiar de dónde salen los retiros es sólo del dueño');
  const iAuth = src.indexOf('const withdrawerMiddleware'), iRoute = src.indexOf("app.get('/api/admin/payout-sources'");
  assert.ok(iAuth > 0 && iRoute > iAuth); ok('las rutas nuevas están después de los middlewares (TDZ)');

  console.log(`\n✅ ${n} pruebas OK`);
})().catch((e) => { console.error('❌', e); process.exit(1); });
