// #915 (owner 2026-10-24): SORTEOS CON RANKING EN VIVO — reglas puras (sin DB ni red) que comparten el motor, las rutas y el panel.
// "Armá un ranking viendo todo lo apostado de los jugadores de Girox del general, tapá los nombres y que cada uno, desde la app, se
//  registre y pueda ver su nombre completo y su puesto. Dos sorteos individuales (mensual y Gran Sorteo), ranking en vivo cuando
//  empieza tomando las apuestas, la gente suma puntos directo; bases y condiciones completas; para inscribirse tienen que cumplir
//  los requisitos."
// Copia el formato de la gemela PICA ROJA: 100 puntos cada $100.000 apostados con plata REAL (los bonos no suman: se toma la parte de lo
// apostado proporcional a las cargas reales del período), premio extra por cantidad de clientes, y el Gran Sorteo con +puntos por día
// con cargas y +% por semanas con misiones.
'use strict';

const DAY = 86400000;
const ART = '-03:00';

function defaults() {
  return {
    enabled: true,
    requirements: { app: true, notif: true, telegram: true, deposit: true },
    mensual: {
      enabled: true, key: 'mensual', title: 'Sorteo mensual', emoji: '🏆', startMonth: '2026-11',
      pts: 100, ptsPer: 100000,
      prizes: [
        { pos: 1, img: '📱', name: 'iPhone 18 Pro Max', value: '' },
        { pos: 2, img: '🛍️', name: 'Orden de compra', value: '$1.000.000' },
        { pos: 3, img: '🎰', name: '$500.000 para jugar', value: '' }
      ],
      extra: { enabled: true, per: 100, winners: 10, amount: 10000, minDeposits: 2 },
      publishHour: 12
    },
    gran: {
      enabled: true, key: 'gran', title: 'Gran Sorteo', emoji: '🚗', start: '2026-11-01', end: '2027-01-31',
      pts: 100, ptsPer: 100000, dayDepositMin: 10000, dayDepositPts: 10, missionWeekPct: 10,
      prizes: [
        { pos: 1, img: '🚗', name: 'Auto 0 km', value: 'Valorado en $30.000.000' },
        { pos: 2, img: '🏝️', name: 'Viaje al Caribe para 2', value: 'Todo incluido · 5 días' },
        { pos: 3, img: '💵', name: 'USD 2.000', value: 'En efectivo' }
      ],
      publishHour: 12
    }
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
    out[k].prizes = out[k].prizes.slice(0, 3).map((p, i) => Object.assign({ pos: i + 1, img: d[k].prizes[i] ? d[k].prizes[i].img : '🎁', name: '', value: '' }, p || {}, { pos: i + 1 }));
    if (k === 'mensual') out[k].extra = Object.assign({}, d.mensual.extra, (s.mensual && s.mensual.extra) || {});
    out[k].pts = Math.max(1, Number(out[k].pts) || d[k].pts); out[k].ptsPer = Math.max(1000, Number(out[k].ptsPer) || d[k].ptsPer);
  }
  return out;
}

const artDay = (d) => new Date(new Date(d).getTime() - 3 * 3600000).toISOString().slice(0, 10);
const monthOf = (d) => artDay(d).slice(0, 7);
function monthStart(ym) { return new Date(ym + '-01T00:00:00' + ART); }
function monthEnd(ym) { const [y, m] = ym.split('-').map(Number); return new Date(new Date(Date.UTC(y, m, 1) + 3 * 3600000).getTime() - 1); } // último ms del mes ART
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
  const start = new Date(String(s.start || '2026-11-01') + 'T00:00:00' + ART);
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

// Puntos de un jugador. `in` = { wagered, bonusGranted, depositTotal, depositDays, missionWeeks, weeksElapsed }.
function computePoints(s, x) {
  const dep = Math.max(0, Number(x.depositTotal) || 0), bon = Math.max(0, Number(x.bonusGranted) || 0);
  const realShare = dep + bon > 0 ? Math.min(1, dep / (dep + bon)) : 1;
  const wag = Math.max(0, Number(x.wagered) || 0);
  const basePts = Math.floor(wag * realShare / s.ptsPer * s.pts);
  let dayPts = 0, missionPts = 0;
  if (s.key === 'gran') {
    dayPts = (Number(x.depositDays) || 0) * (Number(s.dayDepositPts) || 0);
    const weeks = Math.max(1, Number(x.weeksElapsed) || 1), mw = Math.min(weeks, Number(x.missionWeeks) || 0);
    missionPts = Math.round(basePts * ((Number(s.missionWeekPct) || 0) / 100) * (mw / weeks));
  }
  return { points: basePts + dayPts + missionPts, basePts, dayPts, missionPts, realShare: Math.round(realShare * 1000) / 1000 };
}

// Cuántos ganadores del premio extra hay para N clientes que cumplen (10 por cada 100: 250 ⇒ 20).
function extraWinners(extra, n) { if (!extra || !extra.enabled) return 0; const per = Math.max(1, Number(extra.per) || 100); return Math.floor(n / per) * (Number(extra.winners) || 0); }

const fmtDay = (d) => { const x = new Date(new Date(d).getTime() - 3 * 3600000); return x.getUTCDate() + ' de ' + ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][x.getUTCMonth()] + ' de ' + x.getUTCFullYear(); };
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

// BASES Y CONDICIONES (texto completo, armado con los números de la config). Devuelve [{ t: título, d: detalle }].
function terms(cfg, which, now) {
  const r = cfg.requirements || {}; const m = cfg.mensual, g = cfg.gran;
  const pm = periodOf(m, now), pg = periodOf(g, now);
  const reqs = [r.app && 'la app de PICA ROJA instalada', r.notif && 'las notificaciones activadas', r.telegram && 'estar unido a nuestro Telegram (ahí anunciamos los ganadores)', r.deposit && 'al menos una carga real'].filter(Boolean).join(', ');
  const base = [
    { t: 'Hay que anotarse', d: 'Para poder ganar tenés que anotarte en esta pantalla con ' + reqs + '. El ranking muestra a todos los clientes que cargaron y jugaron en el período (con el nombre tapado), pero los premios son sólo para los anotados: si el primero del ranking no está anotado, el premio pasa al siguiente anotado.' },
    { t: 'Participan', d: 'Clientes registrados en la app de PICA ROJA con al menos una carga real en el período. Una persona = una cuenta; las cuentas duplicadas, con jugadas irregulares o marcadas por el radar de estafas quedan afuera.' },
    { t: 'Puntos', d: 'Cada ' + money(m.ptsPer) + ' apostados con plata real = ' + m.pts + ' puntos (' + (m.pts / (m.ptsPer / 1000)).toLocaleString('es-AR') + ' punto por cada $1.000). Los bonos no suman: se toma la parte de lo apostado proporcional a tus cargas reales del período (ej.: cargaste $100.000 y recibiste $50.000 de bono ⇒ cuenta 2/3 de lo apostado). Se mide con las estadísticas de la plataforma (casino y deportes).' },
    { t: 'Actualización', d: 'El ranking se actualiza cada 20 minutos con lo apostado hasta ese momento. Cada jugador ve su puesto y sus puntos en todo momento; los demás aparecen con el nombre tapado.' },
    { t: 'Empate', d: 'Gana quien apostó más con plata real; si sigue igual, quien hizo antes su primera carga del período.' },
    { t: 'Entrega', d: 'Dentro de los 10 días hábiles de publicados los ganadores, con nuestro Soporte de entrega de premios, al titular de la cuenta con su DNI. Cada premio puede cobrarse en efectivo (valor publicado).' },
    { t: 'El formato cambia mes a mes', d: 'Premios, extras y reglas de cada período se publican acá antes de que empiece; lo que vale es lo publicado para ese período. PICA ROJA puede anular la participación de cuentas con fraude, multicuentas o apuestas irregulares.' }
  ];
  const mensual = [
    { t: 'Sorteo mensual · fechas', d: 'Del ' + fmtDay(pm.start) + ' al ' + fmtDay(pm.end) + ' (hora argentina, hasta las 23:59). Lo jugado antes del inicio no suma. Ganadores: los 3 primeros del ranking entre los anotados, publicados el ' + fmtDay(pm.publishAt) + ' a las ' + (m.publishHour || 12) + ':00 h en la app (nombres tapados) y en Telegram.' },
    { t: 'Premios del mes', d: m.prizes.map((p) => p.pos + '° puesto: ' + p.name + (p.value ? ' (' + p.value + ')' : '')).join(' · ') + '.' }
  ];
  if (m.extra && m.extra.enabled) mensual.push({ t: 'Premio extra', d: 'Además del ranking, todos los anotados con al menos ' + m.extra.minDeposits + ' cargas reales en el mes participan de ' + money(m.extra.amount) + ' × ' + m.extra.winners + ' ganadores por cada ' + m.extra.per + ' clientes que cumplan (ej.: ' + (m.extra.per * 2.5) + ' clientes ⇒ ' + (m.extra.winners * 2) + ' ganadores), sin importar el puesto. Se sortea el día del cierre con un método verificable (se publica la semilla del sorteo) y los ganadores se publican con el nombre tapado.' });
  const gran = [
    { t: 'Gran Sorteo · fechas', d: 'Del ' + fmtDay(pg.start) + ' al ' + fmtDay(pg.end) + ' (hora argentina). Ganan los 3 anotados con más puntos al cierre; se publican el ' + fmtDay(pg.publishAt) + ' y se entregan igual que el mensual (también en efectivo).' },
    { t: 'Puntos del Gran Sorteo', d: g.pts + ' puntos cada ' + money(g.ptsPer) + ' apostados con plata real (misma regla que el mensual) + ' + g.dayDepositPts + ' puntos por cada día con cargas reales que sumen ' + money(g.dayDepositMin) + ' o más + ' + g.missionWeekPct + '% de tus puntos por cada semana (lunes a domingo) en la que completás una misión semanal (se calcula sobre el promedio semanal de tus puntos).' },
    { t: 'Premios del Gran Sorteo', d: g.prizes.map((p) => p.pos + '° puesto: ' + p.name + (p.value ? ' (' + p.value + ')' : '')).join(' · ') + '.' }
  ];
  if (which === 'mensual') return mensual.concat(base);
  if (which === 'gran') return gran.concat(base);
  return mensual.concat(gran, base);
}

module.exports = { defaults, normalize, periodOf, mask, computePoints, extraWinners, terms, artDay, monthOf, fmtDay, money, DAY };
