// #981: reglas puras de los sorteos (puntos con techo diario, constancia, tickets, hitos, sorteo por semilla). node scripts/test-sorteos-rules.js
const R = require('../src/services/sorteos'); const assert = require('assert');
const cfg = R.normalize(null); const m = cfg.mensual, g = cfg.gran;
assert.strictEqual(cfg.requirements.phone, true); assert.strictEqual(m.prizes[0].mode, 'tickets'); assert.strictEqual(m.prizes[1].mode, 'ranking');
// constante: 30 días × $5.000 cargados y $20.000 apostados por día
const days = {}; for (let i = 1; i <= 30; i++) days['2026-11-' + String(i).padStart(2, '0')] = { wag: 20000, dep: 5000 };
const c = R.computePoints(m, { days, depositTotal: 150000, bonusGranted: 0, deposits: 30 });
assert.strictEqual(c.basePts, 600, '20 pts × 30 días'); assert.strictEqual(c.dayPts, 300); assert.ok(c.weekPts >= 200, 'semanas activas: ' + c.weekPts); assert.strictEqual(c.tickets.play, 0, '20 pts/día < 50 ⇒ sin tickets de juego');
assert.strictEqual(c.tickets.days, 30); assert.strictEqual(c.tickets.milestones, 3, '10 cargas ⇒ +3'); assert.strictEqual(c.tickets.total, 33);
// ballena: 1 noche de $3.000.000 apostados, 1 carga
const w = R.computePoints(m, { days: { '2026-11-10': { wag: 3000000, dep: 500000 } }, depositTotal: 500000, bonusGranted: 0, deposits: 1 });
assert.strictEqual(w.basePts, 300, 'techo diario $300.000'); assert.strictEqual(w.tickets.play, 6, 'máx 6 tickets/día'); assert.strictEqual(w.tickets.total, 7);
assert.ok(c.points > w.points, 'la constancia gana al pico: ' + c.points + ' vs ' + w.points);
// bonos no suman (realShare)
const b = R.computePoints(m, { days: { '2026-11-10': { wag: 100000, dep: 100000 } }, depositTotal: 100000, bonusGranted: 50000, deposits: 1 });
assert.strictEqual(b.realShare, 0.667); assert.strictEqual(b.basePts, 66);
// gran: hitos y racha de 4 semanas
const gd = {}; for (let i = 1; i <= 28; i++) gd['2026-12-' + String(i).padStart(2, '0')] = { wag: 60000, dep: i % 2 ? 10000 : 0 };
const gg = R.computePoints(g, { days: gd, depositTotal: 140000, bonusGranted: 0, deposits: 14, missionWeeks: 2, weeksElapsed: 4 });
assert.strictEqual(gg.streakWeeks, 4, 'racha: ' + JSON.stringify(gg)); assert.deepStrictEqual(gg.tickets.got, { firstDeposit: 1, tenDeposits: 5, fourWeeks: 5 }); assert.strictEqual(gg.tickets.play, 28, '60 pts/día ⇒ 1 ticket/día'); assert.ok(gg.missionPts > 0);
// sorteo por semilla: determinista, en rango, salto al siguiente
const seed = R.newSeed(); assert.strictEqual(R.commitHash(seed).length, 64);
const n1 = R.drawNumber(seed, 'mensual:2026-11:main', 20000); assert.ok(n1 >= 1 && n1 <= 20000); assert.strictEqual(R.drawNumber(seed, 'mensual:2026-11:main', 20000), n1);
assert.strictEqual(R.drawNumber(seed, 'mensual:2026-11:main', 20000, 1), (n1 % 20000) + 1); assert.notStrictEqual(R.drawNumber(seed, 'otro', 20000), n1 === 1 ? 2 : 1, 'distinto sorteo');
assert.strictEqual(R.drawNumber(seed, 'x', 0), 0); assert.strictEqual(R.drawNumber('a', 'b', 1), 1);
// quincenales dentro del período
const p = R.periodOf(g, new Date('2026-12-20T15:00:00Z')); const mids = R.midDrawDates(g, p, new Date('2026-12-20T15:00:00Z'));
assert.strictEqual(mids.length, 3); assert.strictEqual(mids[0].status, 'due'); assert.strictEqual(mids[1].status, 'soon');
// bases
const t = R.terms(cfg, 'gran', new Date('2026-12-20T15:00:00Z')); const all = t.map((x) => x.t + ' ' + x.d).join('\n');
for (const s of ['Tickets (1° premio)', 'se SORTEA entre todos los tickets', 'Sorteos quincenales', 'sha256', 'celular cargado', '$300.000 por día', '+5 por 4 semanas seguidas']) assert.ok(all.includes(s), 'bases: ' + s);
assert.ok(!/undefined|NaN/.test(all));
const rt = R.rulesText(m); assert.ok(rt.pts.includes('1 punto por cada $1.000') && rt.tickets.includes('+3 por 10 cargas'));
console.log('✅ reglas de sorteos v2: OK · constante', c.points, 'pts /', c.tickets.total, 'tickets · pico', w.points, 'pts /', w.tickets.total, 'tickets');
