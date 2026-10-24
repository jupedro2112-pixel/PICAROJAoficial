// #973: pruebas de la revisión semanal (reglas puras). Correr: node scripts/test-weekly-review.js
const w = require('../src/services/weeklyReview');
const assert = require('assert');
const base = () => ({ week: { from: '2026-10-19', to: '2026-10-25' }, deposits: { users: 300, count: 900, amount: 9e6, prevUsers: 280 }, repeatRate: 0.42, prevRepeatRate: 0.41, giftRatio: 0.12, gifts: { regalos: 1e6, depositos: 9e6, days: 7 },
  journey: { targets: 200, converted: 24, steps: { 'Te extrañamos · 7 días': { targets: 100, converted: 14 } } }, campaigns: { targets: 1000, converted: 60 }, refunds: { daily: { n: 120, amount: 3e5 } },
  prefs: { mine: 5, none: 2, fatigued: 3, optOutPct: 0.01 }, app: { depositors30: 500, withApp: 350, appPct: 0.7 }, newRegs: 100, firstDeposits: 45, totalUsers: 5000, cohortM1: 0.4, cohorts: [], segments: null });
let d = w.decide(base(), { level: 0 }); assert.strictEqual(d.verdict, 'mantener'); assert.strictEqual(d.level, 0);
d = w.decide(Object.assign(base(), { giftRatio: 0.24 }), { level: 0 }); assert.strictEqual(d.verdict, 'frenar'); assert.strictEqual(d.level, -1); assert.strictEqual(d.tuning.pctMult, 0.9);
d = w.decide(Object.assign(base(), { repeatRate: 0.30, prevRepeatRate: 0.41 }), { level: 0 }); assert.strictEqual(d.verdict, 'impulsar'); assert.strictEqual(d.level, 1); assert.strictEqual(d.tuning.chipsMult, 1.25); assert.strictEqual(d.tuning.apPctPlus, 10);
d = w.decide(Object.assign(base(), { repeatRate: 0.30, prevRepeatRate: 0.41, giftRatio: 0.18 }), { level: 0 }); assert.strictEqual(d.verdict, 'mantener', 'zona amarilla: no sube');
d = w.decide(Object.assign(base(), { journey: { targets: 200, converted: 4, steps: {} } }), { level: 0 }); assert.strictEqual(d.verdict, 'impulsar', 'recorrido convierte <5 %');
d = w.decide(Object.assign(base(), { journey: { targets: 10, converted: 0, steps: {} } }), { level: 0 }); assert.strictEqual(d.verdict, 'mantener', 'pocos contactados: no se juzga');
d = w.decide(Object.assign(base(), { repeatRate: 0.30, prevRepeatRate: 0.41 }), { level: 3 }); assert.strictEqual(d.level, 3, 'tope +3');
d = w.decide(Object.assign(base(), { giftRatio: 0.3 }), { level: -2 }); assert.strictEqual(d.level, -2, 'piso −2');
d = w.decide(base(), { level: 2 }); assert.strictEqual(d.level, 1, 'ya se recuperó: vuelve un escalón');
d = w.decide(Object.assign(base(), { cohortM1: 0.1, app: { depositors30: 500, withApp: 100, appPct: 0.2 }, prefs: { mine: 500, none: 200, fatigued: 0, optOutPct: 0.14 }, campaigns: { targets: 1000, converted: 10 } }), { level: 0 });
assert.ok(d.recommendations.length >= 4, 'recomendaciones: ' + d.recommendations.length);
assert.strictEqual(w.tuningFor(-5).level, -2); assert.strictEqual(w.tuningFor(9).level, 3); assert.strictEqual(w.tuningFor(-2).chipsMult, 0.5);
const txt = w.reportText({ at: 'x', metrics: base(), decision: d, tuning: d.tuning }); assert.ok(/REVISIÓN SEMANAL/.test(txt) && /Volvieron/.test(txt) && /RECOMENDACIONES/.test(txt));
assert.strictEqual(w.reportText(null), 'Todavía no hay revisión semanal.');
console.log('✅ revisión semanal: todas las pruebas pasaron');
