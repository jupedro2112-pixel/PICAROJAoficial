// #971: pruebas del recorrido de retención (reglas puras). Correr: node scripts/test-retention-journey.js
const j = require('../src/services/retentionJourney');
const assert = require('assert');
const now = new Date('2026-10-24T15:00:00Z'); // 12:00 ART
const ago = (d) => new Date(now.getTime() - d * 86400000);
const base = { createdAt: ago(40), deposits: 5, lastDepositAt: ago(1), avgDeposit: 8000, hasApp: true, flagged: false, sent: [] };
assert.strictEqual(j.pickStep(base, now), null, 'activo no recibe nada');
assert.strictEqual(j.classify(base, now).segment, 'activo');
let p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(7) }), now); assert.strictEqual(p.step.id, 'cool-7'); assert.strictEqual(p.giftType, 'percent'); assert.strictEqual(p.amount, 30);
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(8) }), now); assert.strictEqual(p.step.id, 'cool-7', 'tolerancia de 2 días');
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(10) }), now); assert.strictEqual(p, null, 'fuera de tolerancia');
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(21) }), now); assert.strictEqual(p.step.id, 'inact-21'); assert.strictEqual(p.giftType, 'fixed'); assert.strictEqual(p.amount, 2000, 'chico');
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(21), avgDeposit: 30000 }), now); assert.strictEqual(p.amount, 5000, 'medio');
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(45), avgDeposit: 90000 }), now); assert.strictEqual(p.step.id, 'lost-45'); assert.strictEqual(p.amount, 15000, 'grande ×1.5');
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(180) }), now); assert.strictEqual(p.step.id, 'far-180');
assert.strictEqual(j.pickStep(Object.assign({}, base, { lastDepositAt: ago(200) }), now), null, 'más de 180 días: nada');
// ya enviado en este episodio ⇒ no se repite; nueva carga ⇒ episodio nuevo
const k = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(7) }), now).key;
assert.strictEqual(j.pickStep(Object.assign({}, base, { lastDepositAt: ago(7), sent: [{ k }] }), now), null);
assert.ok(j.pickStep(Object.assign({}, base, { lastDepositAt: ago(7), sent: [{ k: 'cool-7@2026-01-01' }] }), now));
// nuevo sin carga
p = j.pickStep({ createdAt: ago(1), deposits: 0, hasApp: true, sent: [] }, now); assert.strictEqual(p.step.id, 'new-1');
p = j.pickStep({ createdAt: ago(3), deposits: 0, hasApp: true, sent: [] }, now); assert.strictEqual(p.step.id, 'new-3');
// sin app: ya no hay pasos (#972)
p = j.pickStep({ createdAt: ago(2), deposits: 0, hasApp: false, sent: [] }, now); assert.strictEqual(p.step.id, 'new-1', 'nuevo (tolerancia día 1→2)');
assert.strictEqual(j.pickStep({ createdAt: ago(2), deposits: 0, hasApp: false, sent: [{ k: 'new-1@reg' }] }, now), null, '#972: sin pasos de instalar la app');
assert.strictEqual(j.pickStep(Object.assign({}, base, { createdAt: ago(9), hasApp: false }), now), null, '#972: con cargas y sin app, nada');
assert.strictEqual(j.pickStep(Object.assign({}, base, { lastDepositAt: ago(7), flagged: true }), now), null, 'marcado por el radar: nada');
// #975: registro abierto sin regalos ⇒ no salen los pasos que prometen bono (new-3 / new-21), sí los demás
assert.strictEqual(j.pickStep({ createdAt: ago(3), deposits: 0, hasApp: true, sent: [{ k: 'new-1@reg' }], noWelcome: true }, now), null, 'new-3 promete bono: no sale');
assert.strictEqual(j.pickStep({ createdAt: ago(10), deposits: 0, hasApp: true, sent: [], noWelcome: true }, now).step.id, 'new-10');
assert.strictEqual(j.pickStep(Object.assign({}, base, { lastDepositAt: ago(7), deposits: 3, noWelcome: true }), now).step.id, 'cool-7', 'la recuperación sí');
// #976: registro abierto: sin fichas hasta 5 cargas (se convierten en +50 %); a las 5 cargas, "ya sos de la casa" una sola vez
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(21), deposits: 3, noWelcome: true }), now); assert.strictEqual(p.step.id, 'inact-21'); assert.strictEqual(p.giftType, 'percent'); assert.strictEqual(p.amount, 50, 'fichas → +50 % sin confianza');
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(21), deposits: 5, noWelcome: true }), now); assert.strictEqual(p.giftType, 'fixed', 'con 5 cargas ya recibe fichas');
assert.strictEqual(j.pickStep(Object.assign({}, base, { lastDepositAt: ago(1), deposits: 5, noWelcome: true }), now), null, '#977: a las 5 cargas no hay regalo especial, sólo entra a la estrategia');
// #973: ajuste de la revisión semanal
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(7) }), now, { pctMult: 1.2, chipsMult: 1.5 }); assert.strictEqual(p.amount, 35, '30 % ×1,2 = 36 → 35 (múltiplo de 5)');
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(21), avgDeposit: 30000 }), now, { pctMult: 1, chipsMult: 1.5 }); assert.strictEqual(p.amount, 7500, '5.000 ×1,5');
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(30) }), now, { pctMult: 1.3 }); assert.strictEqual(p.amount, 130, '100 % ×1,3');
// textos y cuerpo del lote
p = j.pickStep(Object.assign({}, base, { lastDepositAt: ago(21), avgDeposit: 30000 }), now);
const b = j.batchBody(p, ['juan', 'ana'], { monthlyCap: 12, rolloverX: 5, vars: { first: 100, daily: 10, min: '5.000' } });
assert.strictEqual(b.giftType, 'fixed'); assert.strictEqual(b.amount, 5000); assert.strictEqual(b.rolloverX, 5); assert.strictEqual(b.monthlyCap, null, 'recuperación sin tope mensual'); assert.strictEqual(b.dailyCap, 1);
assert.ok(b.message.includes('$5.000') && !/\{/.test(b.message) && !/\{/.test(b.title), b.message);
const b2 = j.batchBody(j.pickStep({ createdAt: ago(3), deposits: 0, hasApp: true, sent: [] }, now), ['x'], { monthlyCap: 12, vars: { first: 100, daily: 10, min: '5.000' } });
assert.strictEqual(b2.giftType, 'none'); assert.strictEqual(b2.monthlyCap, 12); assert.ok(b2.title.includes('+100%'));
for (const s of j.STEPS) { assert.ok(!/ruleta|sueldo|aguinaldo|cobraste/i.test(s.title + s.text), s.id); assert.ok(s.text.length <= 400, s.id); }
console.log('✅ recorrido de retención: ' + j.STEPS.length + ' pasos, todas las pruebas pasaron');
