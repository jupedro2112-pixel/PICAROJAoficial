#!/usr/bin/env node
// #999 — comprobantes de billeteras (Fiwind, Naranja X…) que no se cruzaban con el banco: COELSA ID, CBU/CVU y CUIT de origen.
// Usa las funciones REALES de server.js. Datos INVENTADOS (el repo es público): node scripts/test-receipt-match.js
'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const fn = (name) => { const m = new RegExp('^function ' + name + '\\(', 'm').exec(S); if (!m) throw new Error('no está ' + name); let d = 0; const i = S.indexOf('{', m.index); for (let j = i; j < S.length; j++) { if (S[j] === '{') d++; else if (S[j] === '}' && !--d) return S.slice(m.index, j + 1); } return ''; };
const line = (re) => { const m = re.exec(S); if (!m) throw new Error('no está ' + re); return m[0]; };
const src = [line(/^function _digits\(.*$/m), line(/^const _COELSA_LOOK = .*;$/m), ...['_normComprobanteKey', '_normName', '_nameMatch', '_amountsEqual', '_comprobanteToOurBank', '_destConsistentOk', '_coelsaNear', '_comprobanteMatchesMovement'].map(fn), 'return { _comprobanteMatchesMovement, _coelsaNear };'].join('\n');
// #1160: `_comprobanteToOurBank` ahora también mira las cuentas hgcash / Finpro cargadas en el panel (acá: ninguna, como antes).
const _banksNone = 'const _hgAccounts = []; const _hgAccountReceives = () => true; const _fpList = () => []; const _fpAccountReceives = () => true; const _fpAccountCvus = () => []; const _fpHolderOf = () => null; const _cbuSameAccount = () => null; const _hgIncomingMode = "all"; const _hgActiveKey = null;\n';
const { _comprobanteMatchesMovement: match, _coelsaNear } = new Function(_banksNone + src)();
const OUR = '0000999900000000000011';
const cfg = { cbu: OUR, accountName: 'Empresa Receptora' };
let ok = 0; const fails = [];
const caso = (n, f) => { try { f(); ok++; console.log('✔ ' + n); } catch (e) { fails.push(n); console.log('✘ ' + n + '\n   ' + e.message); } };

// Con la forma de los dos casos reales: billetera con COELSA aparte y un "código de transacción" UUID.
const wallet1 = { amount: 148000, originHolder: 'Ana Gomez', originCbu: '0000111100000000000001', originCuit: '27111111112', destHolder: 'Empresa Receptora', destCbu: OUR, coelsaId: '3QK7M2XWZ8H4N6P1R9T5VB', operationNumber: null };
const wallet2 = { amount: 6000, originHolder: 'Laura Beatriz Diaz', originCbu: '4530000800000000000002', originCuit: '27222222223', destHolder: 'Empresa Receptora', destCbu: OUR, coelsaId: '9ZX1LM0OPQ8B5S2KT6G7RW', operationNumber: '1a2b3c4d-0000-4000-8000-000000000000' };
const mov = (o) => Object.assign({ direction: 'Inbound', status: 'done', toCBU: OUR, toName: 'EMPRESA RECEPTORA SAS', fromName: 'BILLETERA SA', fromCBU: null, fromCUIT: null, coelsaCode: null, externalId: null }, o);

caso('billetera 1: cruza por COELSA aunque el banco muestre otro nombre de origen', () => assert.ok(match(wallet1, mov({ amount: 148000, coelsaCode: '3QK7M2XWZ8H4N6P1R9T5VB' }), cfg)));
caso('billetera 2: el "Código de transacción" (UUID) no sirve, pero el COELSA sí', () => assert.ok(match(wallet2, mov({ amount: 6000, coelsaCode: '9ZX1LM0OPQ8B5S2KT6G7RW' }), cfg)));
caso('COELSA dentro del externalID del banco', () => assert.ok(match(wallet2, mov({ amount: 6000, externalId: 'TRF-9ZX1LM0OPQ8B5S2KT6G7RW-01' }), cfg)));
caso('COELSA mal leído (O por 0, I por 1) ⇒ igual cruza con el mismo monto', () => assert.ok(match(Object.assign({}, wallet2, { coelsaId: '9ZXILMOOPQ8B5S2KT6G7RW' }), mov({ amount: 6000, coelsaCode: '9ZX1LM0OPQ8B5S2KT6G7RW' }), cfg)));
caso('mismo CVU de origen (sin COELSA) ⇒ cruza', () => assert.ok(match(Object.assign({}, wallet1, { coelsaId: null }), mov({ amount: 148000, fromCBU: '0000111100000000000001' }), cfg)));
caso('mismo CUIT de origen ⇒ cruza', () => assert.ok(match(Object.assign({}, wallet2, { coelsaId: null }), mov({ amount: 6000, fromCUIT: '27-22222222-3' }), cfg)));
caso('monto distinto ⇒ NUNCA cruza (aunque coincida el COELSA)', () => assert.ok(!match(wallet1, mov({ amount: 14800, coelsaCode: '3QK7M2XWZ8H4N6P1R9T5VB' }), cfg)));
caso('COELSA de OTRA transferencia y otro nombre ⇒ no cruza', () => assert.ok(!match(wallet1, mov({ amount: 148000, coelsaCode: 'AAAAAAAAAAAAAAAAAAAAAA', fromName: 'JUAN PEREZ' }), cfg)));
caso('CUIT igual pero el comprobante fue a OTRA cuenta ⇒ no cruza', () => assert.ok(!match(Object.assign({}, wallet2, { coelsaId: null, destHolder: 'Otra Empresa SRL', destCbu: '0000003100000000000001' }), mov({ amount: 6000, fromCUIT: '27222222223', toName: 'OTRA COSA' }), cfg)));
caso('casi-igual: más de 2 diferencias o letras que no se confunden ⇒ no', () => { assert.ok(!_coelsaNear('9ZX1LM0OPQ8B5S2KT6G7RW', '9ZX1LM0OPQ8B5S2KT6G7XW')); assert.ok(!_coelsaNear('9ZX1LM0OPQ8B5S2KT6G7RW', '9ZXILMOOPQ8BSS2KT6G7RW')); });
caso('el nombre sigue funcionando como antes', () => assert.ok(match(Object.assign({}, wallet2, { coelsaId: null, originCuit: null }), mov({ amount: 6000, fromName: 'DIAZ LAURA BEATRIZ' }), cfg)));

console.log(`\n${ok}/${ok + fails.length} casos OK`); process.exit(fails.length ? 1 : 0);
