'use strict';
// #1162: comprobantes BNA+ (COELSA rotulado "Número de transacción") y Santander (sólo "Cuenta débito"). Datos ficticios.
const assert = require('assert');
const Module = require('module');
const path = require('path');
const orig = Module._load;
Module._load = function (req, ...a) {
  if (/utils\/logger$/.test(req)) return { info() {}, warn() {}, error() {} };
  if (req === 'axios') return {};
  return orig.call(this, req, ...a);
};
const A = require(path.join(__dirname, '..', 'src/services/comprobanteAiService.js'));

// BNA+
assert.strictEqual(A.resolveCoelsa({ numero_operacion: '4A6YGOW9MG5MMJ01Z9EXD8'.toLowerCase() }), '4A6YGOW9MG5MMJ01Z9EXD8');
assert.strictEqual(A.resolveCoelsa({ coelsa_id: '3QK7M2XWZ8H4N6P1R9T5VB', numero_operacion: '61708510' }), '3QK7M2XWZ8H4N6P1R9T5VB');
assert.strictEqual(A.resolveCoelsa({ numero_operacion: '61708510' }), null, 'un número común no es COELSA');
assert.strictEqual(A.resolveCoelsa({ numero_operacion: '1234567890123456789012' }), null, '22 dígitos (CBU) no es COELSA');
assert.strictEqual(A.resolveCoelsa({ numero_operacion: '1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f' }), null, 'UUID no es COELSA');

// Santander
assert.strictEqual(A.parseOriginAccount('CTA $ 123-456789/0'), '123-456789/0');
assert.strictEqual(A.parseOriginAccount('Caja de ahorro'), null);
const ok22 = '0720123188000045678902';
assert.strictEqual(ok22.length, 22);
assert.strictEqual(A.originAccountMatchesCbu('123-456789/0', ok22), true);
assert.strictEqual(A.originAccountMatchesCbu('124-456789/0', ok22), false, 'otra sucursal');
assert.strictEqual(A.originAccountMatchesCbu('123-456780/0', ok22), false, 'otra cuenta');
assert.strictEqual(A.originAccountMatchesCbu('123-456789/0', '0170123188000045678902'), false, 'otro banco');
assert.strictEqual(A.originAccountMatchesCbu('123-456789/0', null), false);

// Fecha
assert.strictEqual(A.receiptDateNear('22/11/2026 16:13:34', '2026-11-22T19:13:34Z'), true);
assert.strictEqual(A.receiptDateNear('04/11/2026', '2026-11-22T19:13:34Z'), false, 'comprobante viejo');
assert.strictEqual(A.receiptDateNear(null, '2026-11-22T19:13:34Z'), false);

console.log('✅ test-receipt-1162 OK');
