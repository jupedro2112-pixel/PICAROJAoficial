// #915 → #981 (owner 2026-10-24): SORTEOS "premium y para todos" — reglas puras (sin DB ni red) que comparten el motor, las rutas, el panel y las Bases.
// Pedido: "que no incentive sólo al que tiene más plata; el premio mayor por TICKETS (una rifa con números que el cliente ve antes), 2° y 3° por
// ranking; puntos con techo diario y constancia; el auto con hitos y sorteos quincenales; sorteo por semilla publicada, verificable".
//
// PUNTOS (ranking · 2° y 3° premio): 1 punto por cada $1.000 apostados con plata real (pts/ptsPer), contando como máximo `dayCapArs` por día
//   (los bonos no suman: se toma la parte proporcional a las cargas reales del período) + `dayDepositPts` por cada día con una carga desde
//   `dayDepositMin` + `weekPts` por cada semana (lun–dom) con `weekActiveDays` días con carga + (Gran Sorteo) % por semanas con misiones.
// TICKETS (premio mayor · rifa): 1 ticket por cada `tickets.per` puntos de juego del día (máx. `tickets.dayCap` por día) + `tickets.activeDay`
//   por cada día con carga + hitos iguales para todos (`milestones`). Los tickets son números correlativos que emite el motor y el cliente ve.
// SORTEO: semilla al azar cuya HUELLA (sha256) se publica al cerrar; al revelar, ganador = 1 + (sha256(semilla|sorteo) mod tickets). Si el ticket
//   es de alguien no anotado o bloqueado, se pasa al siguiente número. Cualquiera puede repetir la cuenta.
'use strict';

const crypto = require('crypto');
const DAY = 86400000;
const ART = '-03:00';

function defaults() {
  const base = {
    pts: 100, ptsPer: 100000,            // 1 punto cada $1.000 apostados con plata real
    dayCapArs: 300000,                   // por día cuentan hasta $300.000 apostados (300 puntos)
    dayDepositMin: 2000, dayDepositPts: 10, // +10 puntos por cada día con una carga desde $2.000
    weekActiveDays: 3, weekPts: 50,      // +50 puntos por cada semana (lun–dom) con 3 días con carga
    tickets: { per: 50, dayCap: 6, activeDay: 1 }, // 1 ticket cada 50 pts de juego del día (máx. 6/día) + 1 por día con carga
    publishHour: 12
  };
  return {
    enabled: true,
    requirements: { app: true, notif: true, telegram: true, phone: true, deposit: true }, // #981: + número de celular cargado
    mensual: Object.assign({}, base, {
      enabled: true, key: 'mensual', title: 'Sorteo mensual', emoji: '🏆', startMonth: '2026-11',
      milestones: { tenDeposits: 3 },     // 10 cargas en el mes = +3 tickets
      prizes: [
        { pos: 1, img: '📱', name: 'iPhone 18 Pro Max', value: '', mode: 'tickets' },
        { pos: 2, img: '🛍️', name: 'Orden de compra', value: '$1.000.000', mode: 'ranking' },
        { pos: 3, img: '🎰', name: '$500.000 para jugar', value: '', mode: 'ranking' }
      ],
      extra: { enabled: true, title: 'SORTEO EXTRA $1.000.000', per: 0, winners: 10, amount: 100000, minDeposits: 10, requireJoin: false },
      midDraws: { enabled: false, amount: 0, dates: [] }
    }),
    gran: Object.assign({}, base, {
      enabled: true, key: 'gran', title: 'Gran Sorteo', emoji: '🚗', start: '2026-12-01', end: '2027-01-31',
      missionWeekPct: 10,
      milestones: { firstDeposit: 1, fourWeeks: 5, tenDeposits: 5 }, // 1ª carga del período +1 · 4 semanas seguidas activas +5 · 10 cargas +5
      prizes: [
        { pos: 1, img: '🚗', name: 'Peugeot 208 0 km', value: 'Valorado en $30.000.000', mode: 'tickets' },
        { pos: 2, img: '🏝️', name: 'Viaje al Caribe para 2', value: 'Todo incluido · 5 días', mode: 'ranking' },
        { pos: 3, img: '💵', name: 'USD 2.000', value: 'En efectivo', mode: 'ranking' }
      ],
      extra: { enabled: true, title: 'SORTEO EXTRA $1.000.000', per: 0, winners: 10, amount: 100000, minDeposits: 10, requireJoin: false },
      midDraws: { enabled: true, amount: 200000, dates: ['2026-12-15', '2026-12-31', '2027-01-15'] } // sorteos quincenales entre los tickets emitidos hasta ese día
    })
  };
}

// Mezcla lo guardado con los defaults (campo a campo, sin perder claves nuevas del código).
function normalize(saved) {
  const d = defaults(); const s = saved && typeof saved === 'object' ? saved : {};
  const out = Object.assign({}, d, s);
  out.requirements = Object.assign({}, d.requirements, s.requirements || {});
  for (const k of ['mensual', 'gran']) {
    out[k] = Object.assign({}, d[k], s[k] || {}); out[k].key = k;
    if (!Array.isArray(out[k].prizes) || !out[k].prizes.length) out[k].prizes = d[k].prizes;
    out[k].prizes = [0, 1, 2].map((i) => Object.assign({}, d[k].prizes[i] || { pos: i + 1, img: '🎁', name: '', value: '' }, out[k].prizes[i] || {}, { pos: i + 1, mode: i === 0 ? 'tickets' : 'ranking' }));
    out[k].extra = Object.assign({}, d[k].extra, (s[k] && s[k].extra) || {});
    out[k].tickets = Object.assign({}, d[k].tickets, (s[k] && s[k].tickets) || {});
    out[k].milestones = Object.assign({}, d[k].milestones, (s[k] && s[k].milestones) || {});
    out[k].midDraws = Object.assign({}, d[k].midDraws, (s[k] && s[k].midDraws) || {});
    if (!Array.isArray(out[k].midDraws.dates)) out[k].midDraws.dates = [];
    out[k].midDraws.dates = out[k].midDraws.dates.map((x) => String(x || '').slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
    out[k].pts = Math.max(1, Number(out[k].pts) || d[k].pts); out[k].ptsPer = Math.max(1000, Number(out[k].ptsPer) || d[k].ptsPer);
    out[k].dayCapArs = Math.max(0, Number(out[k].dayCapArs) || 0); out[k].dayDepositMin = Math.max(0, Number(out[k].dayDepositMin) || 0);
    out[k].dayDepositPts = Math.max(0, Number(out[k].dayDepositPts) || 0); out[k].weekActiveDays = Math.max(1, Math.round(Number(out[k].weekActiveDays) || d[k].weekActiveDays));
    out[k].weekPts = Math.max(0, Number(out[k].weekPts) || 0);
    out[k].tickets.per = Math.max(1, Number(out[k].tickets.per) || d[k].tickets.per); out[k].tickets.dayCap = Math.max(0, Number(out[k].tickets.dayCap) || 0); out[k].tickets.activeDay = Math.max(0, Number(out[k].tickets.activeDay) || 0);
    for (const m of Object.keys(out[k].milestones)) out[k].milestones[m] = Math.max(0, Math.round(Number(out[k].milestones[m]) || 0));
  }
  return out;
}

const artDay = (d) => new Date(new Date(d).getTime() - 3 * 3600000).toISOString().slice(0, 10);
const monthOf = (d) => artDay(d).slice(0, 7);
function monthStart(ym) { return new Date(ym + '-01T00:00:00' + ART); }
function monthEnd(ym) { const [y, m] = ym.split('-').map(Number); return new Date(new Date(Date.UTC(y, m, 1) + 3 * 3600000).getTime() - 1); }
function addMonths(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); }

// Período vigente de un sorteo a la fecha `now`: { periodKey, start, end, publishAt, status: 'soon'|'live'|'closed' }
function periodOf(s, now) {
  now = now ? new Date(now) : new Date();
  if (s.key === 'mensual') {
    const startM = /^\d{4}-\d{2}$/.test(String(s.startMonth || '')) ? s.startMonth : monthOf(now);
    const cur = monthOf(now); const ym = cur < startM ? startM : cur;
    const start = monthStart(ym), end = monthEnd(ym);
    const publishAt = new Date(end.getTime() + 1 + (Number(s.publishHour) || 12) * 3600000);
    return { periodKey: ym, start, end, publishAt, status: now < start ? 'soon' : (now > end ? 'closed' : 'live'), prevKey: addMonths(ym, -1) };
  }
  const start = new Date(String(s.start || '2026-12-01') + 'T00:00:00' + ART);
  const end = new Date(new Date(String(s.end || '2027-01-31') + 'T00:00:00' + ART).getTime() + DAY - 1);
  const publishAt = new Date(end.getTime() + 1 + (Number(s.publishHour) || 12) * 3600000);
  return { periodKey: String(s.start) + '_' + String(s.end), start, end, publishAt, status: now < start ? 'soon' : (now > end ? 'closed' : 'live') };
}

// Nombre TAPADO para el ranking público: "juanperez22" → "ju•••••22". El propio jugador ve el suyo completo.
function mask(u) {
  u = String(u || ''); if (u.length <= 3) return (u[0] || '?') + '••';
  const n = Math.min(Math.max(u.length - 4, 2), 6);
  return u.slice(0, 2) + '•'.repeat(n) + u.slice(-2);
}

// Lunes (ART, 'YYYY-MM-DD') de la semana de un día 'YYYY-MM-DD'.
function weekOf(day) { const d = new Date(day + 'T12:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10); }

// Puntos y tickets de un jugador.
// x = { days: { 'YYYY-MM-DD': { wag, dep } }, depositTotal, bonusGranted, deposits, missionWeeks, weeksElapsed }
//   days.wag = apostado bruto de ESE día (lo arma el motor con la diferencia de los acumulados de 1girox) · days.dep = cargado real ese día.
function computePoints(s, x) {
  const days = x.days || {}; const keys = Object.keys(days).sort();
  const dep = Math.max(0, Number(x.depositTotal) || 0), bon = Math.max(0, Number(x.bonusGranted) || 0);
  const realShare = dep + bon > 0 ? Math.min(1, dep / (dep + bon)) : 1;
  const cap = s.dayCapArs > 0 ? s.dayCapArs : Infinity; const tk = s.tickets || { per: 50, dayCap: 6, activeDay: 1 };
  let baseRaw = 0, wagered = 0, wageredCounted = 0, depositDays = 0, ticketsPlay = 0;
  const weekDays = {};
  for (const d of keys) {
    const w = Math.max(0, Number(days[d].wag) || 0), dd = Math.max(0, Number(days[d].dep) || 0);
    wagered += w; const counted = Math.min(w, cap); wageredCounted += counted;
    const dayPts = counted * realShare / s.ptsPer * s.pts; baseRaw += dayPts;
    ticketsPlay += Math.min(Math.floor(dayPts / tk.per), tk.dayCap || 0);
    if (dd >= (s.dayDepositMin || 0) && dd > 0) { depositDays++; const wk = weekOf(d); weekDays[wk] = (weekDays[wk] || 0) + 1; }
  }
  const basePts = Math.floor(baseRaw);
  const dayPts = depositDays * (s.dayDepositPts || 0);
  const activeWeeks = Object.keys(weekDays).filter((wk) => weekDays[wk] >= (s.weekActiveDays || 1)).sort();
  const weekPts = activeWeeks.length * (s.weekPts || 0);
  // racha: máximo de semanas activas CONSECUTIVAS
  let streak = 0, best = 0, prev = null;
  for (const wk of activeWeeks) { streak = prev && (new Date(wk + 'T12:00:00Z') - new Date(prev + 'T12:00:00Z')) === 7 * DAY ? streak + 1 : 1; best = Math.max(best, streak); prev = wk; }
  let missionPts = 0;
  if (s.key === 'gran' && s.missionWeekPct > 0) { const weeks = Math.max(1, Number(x.weeksElapsed) || 1), mw = Math.min(weeks, Number(x.missionWeeks) || 0); missionPts = Math.round(basePts * (s.missionWeekPct / 100) * (mw / weeks)); }
  const points = basePts + dayPts + weekPts + missionPts;
  // tickets
  const ms = s.milestones || {}; const nDep = Math.max(0, Number(x.deposits) || 0); const got = {};
  if (ms.firstDeposit > 0 && nDep >= 1) got.firstDeposit = ms.firstDeposit;
  if (ms.tenDeposits > 0 && nDep >= 10) got.tenDeposits = ms.tenDeposits;
  if (ms.fourWeeks > 0 && best >= 4) got.fourWeeks = ms.fourWeeks;
  const ticketsDays = depositDays * (tk.activeDay || 0);
  const ticketsMilestones = Object.values(got).reduce((a, b) => a + b, 0);
  return { points, basePts, dayPts, weekPts, missionPts, realShare: Math.round(realShare * 1000) / 1000, wagered: Math.round(wagered), wageredCounted: Math.round(wageredCounted), depositDays, activeWeeks: activeWeeks.length, streakWeeks: best,
    tickets: { play: ticketsPlay, days: ticketsDays, milestones: ticketsMilestones, total: ticketsPlay + ticketsDays + ticketsMilestones, got } };
}

// ---- SORTEO por semilla (verificable)
function commitHash(seed) { return crypto.createHash('sha256').update(String(seed)).digest('hex'); }
function newSeed() { return crypto.randomBytes(16).toString('hex'); }
// Número ganador (1..total) para una semilla y un sorteo: 1 + (sha256(semilla|sorteo) mod total). `skip` = cuántos saltos ya se hicieron.
function drawNumber(seed, drawKey, total, skip) {
  total = Math.max(0, Math.floor(Number(total) || 0)); if (!total) return 0;
  const h = crypto.createHash('sha256').update(String(seed) + '|' + String(drawKey)).digest('hex');
  const n = Number(BigInt('0x' + h) % BigInt(total));
  return ((n + (Number(skip) || 0)) % total) + 1;
}
// Fechas de los sorteos quincenales dentro del período, con su estado.
function midDrawDates(s, p, now) {
  const md = s.midDraws || {}; if (!md.enabled || !(md.amount > 0)) return [];
  const ps = artDay(p.start), pe = artDay(p.end); const today = artDay(now || new Date());
  return (md.dates || []).filter((d) => d >= ps && d <= pe).map((d) => ({ date: d, amount: md.amount, status: today < d ? 'soon' : 'due' }));
}

// Cuántos ganadores del premio extra hay para N clientes que cumplen.
function extraWinners(extra, n) { if (!extra || !extra.enabled) return 0; const per = Number(extra.per) || 0; const w = Number(extra.winners) || 0; if (per <= 0) return n > 0 ? w : 0; return Math.floor(n / per) * w; }
function extraWho(extra, span) { return 'todos los clientes con al menos ' + (Number(extra.minDeposits) || 1) + ' cargas reales ' + (span || 'en el mes') + (extra.requireJoin ? ', anotados en este sorteo' : ', estén o no anotados y sin importar el ranking'); }
const extraSpan = (key) => (key === 'gran' ? 'durante el sorteo' : 'en el mes');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function payWindow(end) { const x = new Date(new Date(end).getTime() + DAY - 3 * 3600000); const y = x.getUTCFullYear(), m = x.getUTCMonth(); return { mes: MESES[m], anio: y, texto: 'del 1 al 10 de ' + MESES[m] + ' de ' + y }; }
const fmtDay = (d) => { const x = new Date(new Date(d).getTime() - 3 * 3600000); return x.getUTCDate() + ' de ' + MESES[x.getUTCMonth()] + (x.getUTCFullYear() !== new Date().getUTCFullYear() ? ' de ' + x.getUTCFullYear() : ''); };
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const fmtD = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return d + ' de ' + MESES[m - 1]; };

// Texto corto de la fórmula de puntos y tickets (lo comparten la app, el panel y la respuesta de Soporte).
function rulesText(s) {
  const perK = (s.pts / (s.ptsPer / 1000)); const tk = s.tickets || {};
  const pts = perK.toLocaleString('es-AR') + ' punto por cada $1.000 apostados con plata real (hasta ' + money(s.dayCapArs) + ' por día) · +' + s.dayDepositPts + ' puntos por cada día con una carga desde ' + money(s.dayDepositMin) + ' · +' + s.weekPts + ' puntos por cada semana con ' + s.weekActiveDays + ' días con carga' + (s.key === 'gran' && s.missionWeekPct ? ' · +' + s.missionWeekPct + '% por semanas con misiones' : '');
  const ms = s.milestones || {}; const hitos = [ms.firstDeposit > 0 && '+' + ms.firstDeposit + ' por tu primera carga del período', ms.fourWeeks > 0 && '+' + ms.fourWeeks + ' por 4 semanas seguidas con actividad', ms.tenDeposits > 0 && '+' + ms.tenDeposits + ' por 10 cargas'].filter(Boolean);
  const tickets = '1 ticket por cada ' + tk.per + ' puntos de juego del día (máximo ' + tk.dayCap + ' por día) · +' + tk.activeDay + ' ticket por cada día con carga' + (hitos.length ? ' · hitos iguales para todos: ' + hitos.join(', ') : '');
  return { pts, tickets };
}

// BASES Y CONDICIONES (texto completo por sorteo, armado con los números de la config). Devuelve [{ t: título, d: detalle }].
function terms(cfg, which, now) {
  const r = cfg.requirements || {}; const m = cfg.mensual, g = cfg.gran;
  const s = which === 'gran' ? g : m; const p = periodOf(s, now); const pay = payWindow(p.end); const rt = rulesText(s);
  const reqs = [r.app && 'la app de PICA ROJA instalada', r.notif && 'las notificaciones activadas', r.telegram && 'estar unido a nuestro Telegram (ahí anunciamos los ganadores)', r.phone && 'tu número de celular cargado en el Perfil', r.deposit && 'al menos una carga real'].filter(Boolean).join(', ');
  const pub = fmtDay(p.publishAt) + ' a las ' + (s.publishHour || 12) + ':00 h';
  const P = s.prizes || []; const p1 = P[0] || {}, p2 = P[1] || {}, p3 = P[2] || {};
  const nm = (x) => x.name + (x.value ? ' (' + x.value + ')' : '');
  const mids = midDrawDates(s, p, now);
  const out = [];
  out.push({ t: 'Cómo funciona, paso a paso', d: '1) Te anotás en esta pantalla (una sola vez). 2) Cargás y jugás como siempre: cada apuesta con plata real suma PUNTOS y cada día con carga y cada ' + (s.tickets || {}).per + ' puntos de juego te emiten TICKETS numerados, que ves en la app. 3) El ' + fmtDay(p.end) + ' a las 23:59 h (hora argentina) cierra el período: se congelan el ranking y los tickets, y se publica la HUELLA del sorteo. 4) El ' + pub + ' se revela la semilla y sale el ticket ganador del 1° premio; el 2° y el 3° son para los dos anotados con más puntos.' });
  out.push({ t: 'Fechas de este período', d: 'Del ' + fmtDay(p.start) + ' al ' + fmtDay(p.end) + ' (hora argentina). Lo jugado antes del inicio no suma. Ganadores publicados el ' + pub + '.' });
  out.push({ t: 'Puntos (ranking)', d: rt.pts + '. Los bonos no suman: se toma la parte de lo apostado proporcional a tus cargas reales del período (ej.: cargaste $100.000 y recibiste $50.000 de bono ⇒ cuenta 2/3 de lo apostado). El techo diario hace que la constancia valga más que una sola noche fuerte.' });
  out.push({ t: 'Tickets (1° premio)', d: rt.tickets + '. Cada ticket es un número correlativo que emite el sistema cuando lo ganás y queda a tu nombre: lo ves en "Mis tickets". Los tickets no se gastan ni se pierden hasta el sorteo final del período.' });
  out.push({ t: 'Premios', d: '1° premio: ' + nm(p1) + ' → se SORTEA entre todos los tickets emitidos de los anotados (más tickets, más chances; todos tienen alguna). 2° premio: ' + nm(p2) + ' y 3° premio: ' + nm(p3) + ' → para los dos anotados con más PUNTOS al cierre (el ganador del 1° no ocupa un lugar del ranking: si es el primero en puntos, el 2° y 3° pasan al siguiente). Cada premio puede cobrarse en efectivo por el valor publicado.' });
  if (mids.length) out.push({ t: 'Sorteos quincenales', d: 'Además, el ' + mids.map((x) => fmtD(x.date)).join(', el ') + ' se sortea ' + money(mids[0].amount) + ' entre todos los tickets emitidos hasta ese día (los tickets siguen valiendo para el premio mayor). Mismo método: huella publicada a la mañana y semilla revelada a las 20 h.' });
  if (s.extra && s.extra.enabled) { const e = s.extra; const cuantos = (Number(e.per) || 0) > 0 ? e.winners + ' premios de ' + money(e.amount) + ' por cada ' + e.per + ' clientes que cumplan' : e.winners + ' premios de ' + money(e.amount) + ' (' + money(e.amount * e.winners) + ' en total)';
    out.push({ t: e.title || 'SORTEO EXTRA', d: 'Es un EXTRA de ' + money(e.amount * e.winners) + ', aparte de los premios de este sorteo: ' + extraWho(e, extraSpan(which)) + ' participan del sorteo AL AZAR de ' + cuantos + '. Cada cliente que cumple entra una sola vez. Se sortea el día 1 del mes siguiente, con semilla publicada.' }); }
  out.push({ t: 'Cómo se sortea (verificable)', d: 'Al cierre se publica la cantidad total de tickets y la HUELLA (sha256) de una semilla secreta: eso nos compromete a esa semilla. El día del sorteo se revela la semilla y el ticket ganador se calcula así: 1 + (sha256(semilla + "|" + sorteo) módulo cantidad de tickets). Si ese número es de alguien no anotado o bloqueado, pasa al siguiente número. Con la semilla y el total, cualquiera puede repetir la cuenta y llegar al mismo ganador.' });
  out.push({ t: 'Cómo y cuándo se cobra', d: 'Los premios se pagan ' + pay.texto + ' (dentro de los primeros 10 días del mes siguiente al cierre). Nuestro Soporte de entrega de premios te escribe por el chat de la app y por Telegram para coordinar. Para cobrar tenés que ser el titular de la cuenta, acreditarlo con tu DNI y tener el celular verificado.' });
  out.push({ t: 'Requisitos para anotarse', d: 'Tenés que tener ' + reqs + '. Te anotás una sola vez y quedás anotado para todo el sorteo. El ranking y los tickets se calculan para todos los clientes que cargaron y jugaron en el período (con el nombre tapado), pero los premios son sólo para los anotados.' });
  out.push({ t: 'Quiénes participan', d: 'Clientes registrados en la app de PICA ROJA con al menos una carga real en el período. Una persona = una cuenta; las cuentas duplicadas, con jugadas irregulares o marcadas por el radar de estafas quedan afuera.' });
  out.push({ t: 'Actualización y transparencia', d: 'El ranking y los tickets se actualizan cada 20 minutos con lo apostado hasta ese momento. Cada jugador ve su puesto, sus puntos y sus números en todo momento; los demás aparecen con el nombre tapado. Al cierre se congela y se publica tal cual.' });
  out.push({ t: 'Empate en puntos', d: 'Gana quien apostó más con plata real; si sigue igual, quien hizo antes su primera carga del período.' });
  out.push({ t: 'Reglas generales', d: 'Premios, extras y reglas de cada período se publican acá antes de que empiece; lo que vale es lo publicado para ese período. PICA ROJA puede anular la participación de cuentas con fraude, multicuentas o apuestas irregulares. Sólo mayores de 18 años. Jugá con responsabilidad.' });
  return out;
}

module.exports = { defaults, normalize, periodOf, mask, weekOf, computePoints, commitHash, newSeed, drawNumber, midDrawDates, extraWinners, extraWho, extraSpan, rulesText, terms, payWindow, artDay, monthOf, fmtDay, money, DAY };
