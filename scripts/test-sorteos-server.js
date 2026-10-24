// #915 → #981: ejecuta el bloque de SORTEOS de server.js con modelos y 1girox simulados: motor (tick con tickets), GET /api/sorteos, join (teléfono),
// sorteo del 1° premio por semilla (commit/reveal), quincenal, admin GET, tickets, estadística de PRINCIPAL, SORTEO EXTRA y batch caído.
const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const R = require('../src/services/sorteos');
const src = fs.readFileSync('server.js', 'utf8');
const a = src.indexOf('// ===== #915 (owner 2026-10-24): SORTEOS CON RANKING EN VIVO'); const b0 = src.indexOf("app.post('/api/admin/sorteos/:key/draw-extra'", a); const b = src.indexOf('\n});\n', b0) + 5;
if (a < 0 || b0 < 0) throw new Error('bloque no encontrado'); const block = src.slice(a, b);
// --- mocks
function q(data) { const o = { select: () => o, sort: () => o, limit: () => o, skip: () => o, lean: () => o, catch: () => o, then: (res, rej) => Promise.resolve(typeof data === 'function' ? data() : data).then(res, rej) }; return o; }
const store = { entries: [], scores: [], tickets: [], counters: {}, config: {}, pushes: [], notes: [] };
const users = [{ id: 'u1', username: 'lalodj', phone: '', fcmToken: 't', fcmTokenContext: 'standalone', fcmTokens: [] }, { id: 'u2', username: 'juanperez22', phone: '+5491155551234', fcmToken: null, fcmTokens: [] }];
const DEPS = [{ _id: 'u1', n: 4, total: 150000, first: new Date('2026-12-10T15:00:00Z'), username: 'lalodj' }, { _id: 'u2', n: 1, total: 20000, first: new Date('2026-12-12T15:00:00Z'), username: 'juanperez22' }];
const DAYS = [{ _id: { u: 'u1', d: '2026-12-10' }, total: 50000 }, { _id: { u: 'u1', d: '2026-12-11' }, total: 50000 }, { _id: { u: 'u1', d: '2026-12-12' }, total: 50000 }, { _id: { u: 'u2', d: '2026-12-12' }, total: 20000 }];
const Transaction = { aggregate: async (pipe) => JSON.stringify(pipe).includes('$dateToString') ? DAYS : DEPS, findOne: (f) => q(DEPS.some((d) => d._id === f.userId) ? { _id: 1 } : null) };
const User = { findOne: (f) => q(users.find((u) => u.id === f.id) || null) };
const MissionClaim = { aggregate: async () => [{ _id: 'u1', w: ['2026-12-07', '2026-12-14'] }] };
const match = (s, f) => Object.keys(f).every((k) => { const v = f[k]; if (k === '$or') return v.some((o) => match(s, o)); if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof RegExp)) { if ('$gt' in v && !(s[k] > v.$gt)) return false; if ('$gte' in v && !(s[k] >= v.$gte)) return false; if ('$lt' in v && !(s[k] < v.$lt)) return false; if ('$ne' in v && s[k] === v.$ne) return false; if ('$in' in v && !v.$in.includes(s[k])) return false; return true; } if (v instanceof RegExp) return v.test(String(s[k] || '')); return s[k] === v; });
const SorteoEntry = { find: (f) => q(store.entries.filter((e) => match(e, f))), countDocuments: async (f) => store.entries.filter((e) => match(e, f)).length,
  findOneAndUpdate: (f, u) => q(() => { let e = store.entries.find((x) => x.userId === f.userId && x.key === f.key); if (!e) { e = Object.assign({}, f, u.$setOnInsert); store.entries.push(e); } Object.assign(e, u.$set); return e; }) };
const SorteoScore = { find: (f) => q(() => store.scores.filter((s) => match(s, f)).sort((x, y) => y.points - x.points)), findOne: (f) => q(() => store.scores.find((s) => match(s, f)) || null), countDocuments: async (f) => store.scores.filter((s) => match(s, f)).length,
  updateMany: (f, u) => q(() => { for (const s of store.scores) if (match(s, f)) { s.joined = true; s.eligible = s.deposits >= 1; } return {}; }),
  aggregate: async (pipe) => { const m = pipe[0].$match; const rows = store.scores.filter((s) => match(s, m)); const g = {}; for (const s of rows) { const k = String(!!s.joined); g[k] = g[k] || { _id: !!s.joined, n: 0, days: 0, deps: 0, total: 0, weeks: 0, tickets: 0 }; const o = g[k]; o.n++; o.days += s.depositDays || 0; o.deps += s.deposits || 0; o.total += s.depositTotal || 0; o.weeks += s.activeWeeks || 0; o.tickets += s.tickets || 0; } return Object.values(g).map((o) => Object.assign(o, { days: o.days / o.n, deps: o.deps / o.n, total: o.total / o.n, weeks: o.weeks / o.n, tickets: o.tickets / o.n })); },
  bulkWrite: async (ops) => { for (const op of ops) { const u = op.updateOne; let s = store.scores.find((x) => match(x, u.filter)); if (!s) { s = Object.assign({}, u.filter); store.scores.push(s); } Object.assign(s, u.update.$set); } } };
const SorteoTicket = { countDocuments: async (f) => store.tickets.filter((t) => match(t, f)).length, find: (f) => q(() => store.tickets.filter((t) => match(t, f)).sort((x, y) => x.n - y.n)), findOne: (f) => q(() => store.tickets.find((t) => match(t, f)) || null),
  insertMany: async (docs) => { for (const d of docs) { if (store.tickets.some((t) => t.key === d.key && t.periodKey === d.periodKey && t.n === d.n)) throw new Error('dup ticket'); store.tickets.push(Object.assign({}, d)); } },
  aggregate: async (pipe) => { const m = pipe[0].$match; const g = {}; for (const t of store.tickets.filter((t) => match(t, m))) g[t.reason] = (g[t.reason] || 0) + 1; return Object.keys(g).map((k) => ({ _id: k, n: g[k] })); } };
const SorteoCounter = { findOneAndUpdate: (f, u) => q(() => { const k = f.key + ':' + f.periodKey; store.counters[k] = (store.counters[k] || 0) + u.$inc.next; return { key: f.key, periodKey: f.periodKey, next: store.counters[k] }; }) };
const girox = { getPlayersStatsBatch: async (names) => ({ success: true, players: Object.fromEntries(names.map((n) => [n, { wagered: n === 'lalodj' ? 1200000 : 50000, bonusGranted: n === 'lalodj' ? 50000 : 0 }])) }) };
const routes = {}; const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, post: (p, ...h) => { routes['POST ' + p] = h[h.length - 1]; }, put: (p, ...h) => { routes['PUT ' + p] = h[h.length - 1]; } };
const ctx = { require: (p) => { if (p.endsWith('SorteoEntry')) return SorteoEntry; if (p.endsWith('SorteoScore')) return SorteoScore; if (p.endsWith('SorteoTicket')) return SorteoTicket; if (p.endsWith('SorteoCounter')) return SorteoCounter; if (p.endsWith('SorteoImage')) return { findOne: () => q(null), create: async () => ({}) }; if (p.endsWith('/sorteos')) return R; return require(p.startsWith('.') ? require('path').resolve(p) : p); },
  app, authMiddleware: 1, adminMiddleware: 1, getConfig: async (k, d) => (k in store.config ? store.config[k] : d), Config: { set: async (k, v) => { store.config[k] = v; } }, logger: { info() {}, warn(m) { store.warn = m; }, error(m) { store.err = m; } },
  Transaction, User, MissionClaim, girox, uuidv4: () => 'id-' + Math.random().toString(16).slice(2), crypto: require('crypto'), setTimeout: () => 0, setInterval: () => 0, console, Date, Math, Object, Array, JSON, Number, String, Boolean, Promise, Map, Set, RegExp, BigInt, Error, isNaN, parseInt, parseFloat, process: { env: {} },
  sendNotificationToUsernames: async (U, names, title, body, data) => { store.pushes.push({ names, title, data }); return { success: true }; }, _emitAdminOnlyChatNote: async (id, u, t) => { store.notes.push(t); } };
vm.createContext(ctx); vm.runInContext(block, ctx);
const call = async (key, req) => { const h = routes[key]; if (!h) throw new Error('ruta ' + key); let out = null, status = 200; const res = { json: (j) => { out = j; return res; }, status: (s) => { status = s; return res; }, set: () => res }; await h(Object.assign({ params: {}, body: {}, query: {}, user: { userId: 'u1', username: 'lalodj', role: 'admin' } }, req || {}), res); return { status, out }; };
(async () => {
  const RealDate = Date; const fixed = new RealDate('2026-12-15T15:00:00Z'); /* 12:00 ART: los dos sorteos en curso, día del 1er quincenal */ ctx.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed.getTime(); } };
  const cfg = R.normalize(null); const m = cfg.mensual;
  // --- motor
  await call('POST /api/admin/sorteos/recalc'); const diag = store.config.sorteoDiag; if (!diag || diag.lastError) throw new Error('tick: ' + JSON.stringify(diag));
  const lalo = store.scores.find((s) => s.userId === 'u1' && s.key === 'mensual'); const juan = store.scores.find((s) => s.userId === 'u2' && s.key === 'mensual');
  const exp = R.computePoints(m, { days: { '2026-12-10': { wag: 0, dep: 50000 }, '2026-12-11': { wag: 0, dep: 50000 }, '2026-12-12': { wag: 0, dep: 50000 }, '2026-12-15': { wag: 1200000, dep: 0 } }, depositTotal: 150000, bonusGranted: 50000, deposits: 4 });
  assert.strictEqual(lalo.points, exp.points, 'puntos mensual'); assert.strictEqual(lalo.basePts, 225, 'techo diario: 300.000 × 0,75'); assert.strictEqual(lalo.weekPts, 50, '3 días con carga en la semana');
  assert.strictEqual(lalo.tickets, exp.tickets.total); assert.strictEqual(lalo.ticketsPlay, 4); assert.strictEqual(lalo.ticketsDays, 3);
  const tm = store.tickets.filter((t) => t.key === 'mensual'); assert.strictEqual(tm.length, lalo.tickets + juan.tickets, 'tickets emitidos = suma'); assert.deepStrictEqual(tm.map((t) => t.n).sort((x, y) => x - y), tm.map((_, i) => i + 1), 'numeración correlativa');
  const gran = store.scores.find((s) => s.userId === 'u1' && s.key === 'gran'); assert.ok(gran.missionPts > 0 && gran.ticketsMilestones === 1, 'gran: misiones + hito 1ª carga: ' + JSON.stringify(gran));
  console.log('✔ tick:', 'lalodj mensual', lalo.points, 'pts /', lalo.tickets, 'tickets · juan', juan.points, 'pts /', juan.tickets, 'tickets · gran', gran.points, 'pts /', gran.tickets, 'tickets · total mensual', tm.length);
  // segunda pasada: nada se duplica
  const before = store.tickets.length; await call('POST /api/admin/sorteos/recalc'); assert.strictEqual(store.tickets.length, before, 'segunda pasada no emite de más');
  // quincenal del día (gran, 15/12): huella publicada sola, todavía sin revelar (son las 12 h)
  const draws = store.config.sorteoDraws; const midKey = Object.keys(draws).find((k) => k.includes('mid:2026-12-15')); assert.ok(midKey && draws[midKey].seedHash && !draws[midKey].revealedAt, 'quincenal: ' + JSON.stringify(Object.keys(draws)));
  // --- GET app
  let r = await call('GET /api/sorteos'); assert.strictEqual(r.status, 200); const ms = r.out.sorteos.find((s) => s.key === 'mensual'); const gs = r.out.sorteos.find((s) => s.key === 'gran');
  assert.strictEqual(ms.me.rank, 1); assert.strictEqual(ms.tickets.mine, lalo.tickets); assert.strictEqual(ms.tickets.total, tm.length); assert.ok(ms.tickets.list.length === lalo.tickets && ms.tickets.chance > 0.5);
  assert.ok(ms.rules.text.pts.includes('$300.000') && ms.rules.tickets.per === 50 && ms.prizes[0].mode === 'tickets', 'reglas'); assert.ok(ms.me.missing.includes('phone'), 'falta teléfono: ' + ms.me.missing);
  assert.ok(gs.draws.mid.length === 3 && gs.draws.mid[0].draw && gs.draws.mid[0].draw.seedHash && !gs.draws.mid[0].draw.seed, 'huella visible, semilla no');
  assert.ok(ms.top[1].name !== 'juanperez22' && ms.top[1].name.includes('•'), 'nombre tapado'); assert.ok(ms.terms.some((t) => /Tickets \(1° premio\)/.test(t.t)));
  console.log('✔ GET /api/sorteos: rank', ms.me.rank, '· tickets', ms.tickets.mine + '/' + ms.tickets.total, '· chance', ms.tickets.chance.toFixed(2), '· quincenales', gs.draws.mid.map((x) => x.date + ':' + (x.draw ? 'huella' : '-')).join(' '));
  // --- join: sin teléfono → 400; con teléfono y telegram → ok
  r = await call('POST /api/sorteos/:key/join', { params: { key: 'mensual' }, body: { telegram: true } }); assert.strictEqual(r.status, 400); assert.ok(/celular/.test(r.out.error), r.out.error);
  users[0].phone = '+54 9 11 5555-0000'; r = await call('POST /api/sorteos/:key/join', { params: { key: 'mensual' }, body: { telegram: false } }); assert.strictEqual(r.status, 400, 'telegram'); r = await call('POST /api/sorteos/:key/join', { params: { key: 'mensual' }, body: { telegram: true } }); assert.ok(r.out.success, JSON.stringify(r.out));
  r = await call('POST /api/sorteos/:key/join', { params: { key: 'gran' }, body: { telegram: true } }); assert.ok(r.out.success);
  console.log('✔ join: 400 sin celular · 400 sin Telegram · ok');
  // --- sorteo del 1° premio: no se puede revelar en curso sin early; con early: huella + semilla + ganador anotado (u2 no está anotado ⇒ salto si sale)
  r = await call('POST /api/admin/sorteos/:key/draw/:step', { params: { key: 'mensual', step: 'reveal' }, body: {} }); assert.strictEqual(r.status, 400); assert.ok(/todavía no cerró/.test(r.out.error));
  r = await call('POST /api/admin/sorteos/:key/draw/:step', { params: { key: 'mensual', step: 'commit' }, body: { early: true } }); assert.ok(r.out.success && r.out.draw.seedHash && r.out.draw.total === tm.length);
  r = await call('POST /api/admin/sorteos/:key/draw/:step', { params: { key: 'mensual', step: 'reveal' }, body: { early: true } }); const d = r.out.draw; assert.ok(d.revealedAt && d.winner && d.winner.username === 'lalodj', 'ganador: ' + JSON.stringify(d.winner) + ' saltos ' + JSON.stringify(d.skipped));
  const expectedN = R.drawNumber(d.seed, 'mensual:2026-12:main', d.total, d.skipped.length); assert.strictEqual(d.winner.n, expectedN, 'verificable: el número sale de la semilla');
  assert.ok(store.pushes.some((p) => p.names[0] === 'lalodj' && /1° PREMIO/.test(p.title)) && store.notes.some((t) => /GANÓ/.test(t)), 'push + nota al ganador');
  r = await call('GET /api/sorteos'); const ms2 = r.out.sorteos.find((s) => s.key === 'mensual'); assert.ok(ms2.draws.main.seed && ms2.draws.main.winner.me === true, 'la app ve semilla y ganador');
  // quincenal revelado a mano
  r = await call('POST /api/admin/sorteos/:key/draw/:step', { params: { key: 'gran', step: 'reveal' }, body: { kind: 'mid', date: '2026-12-15' } }); assert.ok(r.out.success && r.out.draw.revealedAt && r.out.draw.amount === 200000, JSON.stringify(r.out));
  console.log('✔ sorteo: huella → semilla → ticket #' + d.winner.n + ' de ' + d.total + ' (' + d.skipped.length + ' saltos) · quincenal revelado');
  // --- admin
  r = await call('GET /api/admin/sorteos'); const am = r.out.sorteos.mensual; assert.strictEqual(am.tickets.total, tm.length); assert.ok(am.mainDraw && am.mainDraw.revealedAt && am.ranking[0].tickets === lalo.tickets, 'admin tickets/draw');
  r = await call('GET /api/admin/sorteos/:key/tickets', { params: { key: 'mensual' }, query: { u: 'lalo' } }); assert.strictEqual(r.out.list.length, lalo.tickets);
  r = await call('GET /api/admin/inicio/sorteos-stats'); const st = r.out.sorteos.find((x) => x.key === 'mensual'); assert.ok(['bien', 'regular', 'mal'].includes(st.verdict) && st.counts.anotados === 1 && st.tickets.total === tm.length && st.reasons.length, JSON.stringify(st));
  console.log('✔ admin: tickets', am.tickets.total, '· buscador', lalo.tickets, '· estadística:', st.verdict, '-', st.reasons[0]);
  // --- PUT valida / mezcla
  r = await call('PUT /api/admin/sorteos', { body: { config: { mensual: { startMonth: 'mal' } } } }); assert.strictEqual(r.status, 400);
  r = await call('PUT /api/admin/sorteos', { body: { config: { mensual: { prizes: [{ name: 'Moto 0 km', img: '🏍️' }], tickets: { dayCap: 4 } }, requirements: { telegram: false } } } }); assert.ok(r.out.success && r.out.config.mensual.prizes[0].name === 'Moto 0 km' && r.out.config.mensual.prizes[0].mode === 'tickets' && r.out.config.mensual.tickets.dayCap === 4 && r.out.config.mensual.tickets.per === 50 && r.out.config.requirements.phone === true);
  // --- SORTEO EXTRA sigue
  store.config.sorteos.mensual.extra.minDeposits = 1; store.config.sorteos.mensual.extra.winners = 1; r = await call('POST /api/admin/sorteos/:key/draw-extra', { params: { key: 'mensual' }, body: { early: true } }); assert.ok(r.out.success && r.out.draw.winners.length === 1, JSON.stringify(r.out));
  // --- batch caído ⇒ puntajes intactos
  const snap = JSON.stringify(store.scores); girox.getPlayersStatsBatch = async () => ({ success: false, error: 'rate limit' }); await call('POST /api/admin/sorteos/recalc'); assert.strictEqual(JSON.stringify(store.scores), snap); assert.ok(store.config.sorteoDiag.lastError);
  console.log('✔ PUT mezcla · SORTEO EXTRA · batch caído: puntajes intactos');
  console.log('SERVER OK');
})().catch((e) => { console.error('❌', e.stack || e.message); process.exit(1); });
