#!/usr/bin/env node
/**
 * test-payout-auto.js — #1042-j: la cadena del RETIRO AUTOMÁTICO no puede dejar retiros colgados en "Pagos a confirmar" sin motivo.
 * Chequeos estáticos sobre server.js (sin base ni banco): clasificación con salida automática, re-chequeo si falla, barrido de huérfanos,
 * un retiro por cliente (al pedir y al pagar), fichas sólo al pagar.  Corre con: node scripts/test-payout-auto.js
 */
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const casos = [
  ['Pedir un retiro NO descuenta fichas (deductAtPay) y valida contra available', () => { assert.ok(/deductAtPay: true,\s+\/\/ ← flujo nuevo: descontar al confirmar/.test(S)); assert.ok(/if \(available < amountNum\)/.test(S)); }],
  ['Pedido nuevo reemplaza al anterior sin fichas descontadas (queda uno solo)', () => { assert.ok(/paidVia: 'replaced', chipsReturned: false, error: 'Reemplazado por el retiro nuevo/.test(S)); }],
  ['Sin freno ⇒ se paga SOLO al toque', () => { assert.ok(/_payPendingPayout\(pp\.id, PAYOUT_AUTO_ACTOR, getPublicBaseUrl\(\)\)/.test(S)); }],
  ['Clasificación que falla ⇒ re-chequeo automático (no queda colgado)', () => { assert.ok(/no se pudo clasificar el retiro: \$\{e\.message\} ⇒ re-chequeo automático/.test(S)); assert.ok(/\$set: \{ fraudRecheck: \{ n: 0, at: new Date\(\) \} \} \}\); \} catch \(_\) \{\}\s+_notifyWithdrawDelayed\(_newPayoutId\)/.test(S)); }],
  ['Barrido de retiros sin clasificar (nunca los que tocó una persona o fueron al banco)', () => { const i = S.indexOf('async function _payoutFraudRecheckTick'); const b = S.slice(i, i + 2500); assert.ok(/updateMany\(\{ status: 'pending_review', deductAtPay: true, reviewRequired: \{ \$ne: true \}, autoPay: \{ \$ne: true \}, fraudRecheck: null, paidBy: null,/.test(b)); assert.ok(/hgTransactionId: null, hgTxId: null, debitConfirmed: \{ \$ne: true \}/.test(b)); }],
  ['Re-chequeo: limpio ⇒ paga solo; con señal ⇒ revisión con aviso; 6 intentos sin respuesta ⇒ revisión', () => { assert.ok(/pago AUTOMÁTICO tras re-chequeo/.test(S)); assert.ok(/if \(n >= 6\) await toReview/.test(S)); }],
  ['Falla pasajera del banco ⇒ reintento solo (6 veces)', () => { assert.ok(/autoPay: true, status: \{ \$in: \['failed', 'pending_review'\] \}, autoRetries:/.test(S)); }],
  ['Al pagar (automático o a mano) se anulan los otros pendientes del cliente', () => { assert.ok(/_closeOtherPayouts\(claimed\.userId, id, req\.user && req\.user\.username\)/.test(S)); assert.ok(/await _closeOtherPayouts\(paid\.userId, paid\.id, req\.user\.username\)/.test(S)); }],
];
let ok = 0; for (const [n, fn] of casos) { try { fn(); ok++; console.log('✅ ' + n); } catch (e) { console.log('❌ ' + n + '\n   ' + e.message); } }
console.log(`\n${ok}/${casos.length} casos OK`); process.exit(ok === casos.length ? 0 : 1);
