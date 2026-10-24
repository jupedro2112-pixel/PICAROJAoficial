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
        { pos: 1, img: '📱', name: 'iPhone 18 Pro Max', value: '' }, // #966 (owner): los dibujos de antes (las fotos no gustaron)
        { pos: 2, img: '🛍️', name: 'Orden de compra', value: '$1.000.000' },
        { pos: 3, img: '🎰', name: '$500.000 para jugar', value: '' }
      ],
      // #939 (owner): "el sorteo de $100.000: para TODOS los que cargan, requisito mínimo 10 cargas en el mes; se sortea el día 1 en el admin de forma
      // transparente; en la app se llama SORTEO". per = 0 ⇒ cantidad FIJA de ganadores (10 × $10.000); per > 0 ⇒ N ganadores por cada `per` que cumplen.
      // #969 (owner): "el sorteo extra es en el del iPhone Y en el del auto: 10 personas de $100.000 = $1.000.000 extra en cada sorteo".
      extra: { enabled: true, title: 'SORTEO EXTRA $1.000.000', per: 0, winners: 10, amount: 100000, minDeposits: 10, requireJoin: false },
      publishHour: 12
    },
    gran: {
      enabled: true, key: 'gran', title: 'Gran Sorteo', emoji: '🚗', start: '2026-12-01', end: '2027-01-31', // #942 (owner): el del auto empieza el 1 de diciembre
      pts: 100, ptsPer: 100000, dayDepositMin: 10000, dayDepositPts: 10, missionWeekPct: 10,
      extra: { enabled: true, title: 'SORTEO EXTRA $1.000.000', per: 0, winners: 10, amount: 100000, minDeposits: 10, requireJoin: false }, // #969: también en el del auto
      prizes: [
        { pos: 1, img: '🚗', name: 'Peugeot 208 0 km', value: 'Valorado en $30.000.000' }, // #966 (owner): dibujo
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
    // siempre 3 premios: lo que falte se completa con el default de esa posición (un PUT parcial no borra premios)
    out[k].prizes = [0, 1, 2].map((i) => Object.assign({}, d[k].prizes[i] || { pos: i + 1, img: '🎁', name: '', value: '' }, out[k].prizes[i] || {}, { pos: i + 1 }));
    out[k].extra = Object.assign({}, d[k].extra, (s[k] && s[k].extra) || {}); // #969: los dos sorteos tienen SORTEO EXTRA
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
function extraWinners(extra, n) { if (!extra || !extra.enabled) return 0; const per = Number(extra.per) || 0; const w = Number(extra.winners) || 0; if (per <= 0) return n > 0 ? w : 0; return Math.floor(n / per) * w; }
// Texto corto de quiénes entran al SORTEO (app, panel y bases comparten la frase).
function extraWho(extra, span) { return 'todos los clientes con al menos ' + (Number(extra.minDeposits) || 1) + ' cargas reales ' + (span || 'en el mes') + (extra.requireJoin ? ', anotados en este sorteo' : ', estén o no anotados y sin importar el ranking'); }
const extraSpan = (key) => (key === 'gran' ? 'durante el sorteo' : 'en el mes');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Mes siguiente al cierre (nombre + año): el premio se cobra del 1 al 10 de ese mes (#918, owner: "dentro del mes de diciembre se paga el
// premio dentro de los primeros 10 días").
function payWindow(end) { const x = new Date(new Date(end).getTime() + sorteoDAY - 3 * 3600000); const y = x.getUTCFullYear(), m = x.getUTCMonth(); return { mes: MESES[m], anio: y, texto: 'del 1 al 10 de ' + MESES[m] + ' de ' + y }; }
const sorteoDAY = 86400000;
const fmtDay = (d) => { const x = new Date(new Date(d).getTime() - 3 * 3600000); return x.getUTCDate() + ' de ' + ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][x.getUTCMonth()] + ' de ' + x.getUTCFullYear(); };
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

// BASES Y CONDICIONES (texto completo por sorteo, armado con los números de la config): cómo funciona paso a paso, fechas, puntos, premios,
// cómo y cuándo se cobra (del 1 al 10 del mes siguiente al cierre), requisitos y reglas generales. Devuelve [{ t: título, d: detalle }].
function terms(cfg, which, now) {
  const r = cfg.requirements || {}; const m = cfg.mensual, g = cfg.gran;
  const s = which === 'gran' ? g : m; const p = periodOf(s, now); const pay = payWindow(p.end);
  const reqs = [r.app && 'la app de PICA ROJA instalada', r.notif && 'las notificaciones activadas', r.telegram && 'estar unido a nuestro Telegram (ahí anunciamos los ganadores)', r.deposit && 'al menos una carga real'].filter(Boolean).join(', ');
  const pub = fmtDay(p.publishAt) + ' a las ' + (s.publishHour || 12) + ':00 h';
  const premios = s.prizes.map((x) => x.pos + '° puesto: ' + x.name + (x.value ? ' (' + x.value + ')' : '')).join(' · ') + '.';
  const out = [];
  out.push({ t: 'Cómo funciona, paso a paso', d: '1) Te anotás en esta pantalla (una sola vez). 2) Cargás y jugás como siempre: cada apuesta con plata real suma puntos sola. 3) Mirás tu puesto y tus puntos acá, en vivo. 4) El ' + fmtDay(p.end) + ' a las 23:59 h (hora argentina) cierra el período y se congela el ranking. 5) El ' + pub + ' publicamos los ganadores en la app (con los nombres tapados) y en Telegram. 6) Nuestro Soporte contacta a cada ganador y el premio se cobra ' + pay.texto + '.' });
  out.push({ t: 'Fechas de este período', d: 'Del ' + fmtDay(p.start) + ' al ' + fmtDay(p.end) + ' (hora argentina). Lo jugado antes del inicio no suma. Ganadores publicados el ' + pub + '.' });
  if (which === 'gran') out.push({ t: 'Puntos del Gran Sorteo', d: g.pts + ' puntos cada ' + money(g.ptsPer) + ' apostados con plata real (los bonos no suman: se toma la parte de lo apostado proporcional a tus cargas reales del período) + ' + g.dayDepositPts + ' puntos por cada día con cargas reales que sumen ' + money(g.dayDepositMin) + ' o más + ' + g.missionWeekPct + '% de tus puntos por cada semana (lunes a domingo) en la que completás una misión semanal (se calcula sobre el promedio semanal de tus puntos).' });
  else out.push({ t: 'Puntos', d: 'Cada ' + money(m.ptsPer) + ' apostados con plata real = ' + m.pts + ' puntos (' + (m.pts / (m.ptsPer / 1000)).toLocaleString('es-AR') + ' punto por cada $1.000). Los bonos no suman: se toma la parte de lo apostado proporcional a tus cargas reales del mes (ej.: cargaste $100.000 y recibiste $50.000 de bono ⇒ cuenta 2/3 de lo apostado). Se mide con las estadísticas de la plataforma (casino y deportes).' });
  out.push({ t: 'Premios', d: premios + ' Ganan los 3 anotados con más puntos al cierre. Cada premio puede cobrarse en efectivo por el valor publicado.' });
  if (s.extra && s.extra.enabled) { const e = s.extra; /* #969: en los dos sorteos, cada uno con su propio SORTEO EXTRA */ const cuantos = (Number(e.per) || 0) > 0 ? e.winners + ' premios de ' + money(e.amount) + ' por cada ' + e.per + ' clientes que cumplan' : e.winners + ' premios de ' + money(e.amount) + ' (' + money(e.amount * e.winners) + ' en total)';
    out.push({ t: e.title || 'SORTEO EXTRA', d: 'Es un EXTRA de ' + money(e.amount * e.winners) + ', aparte de los premios del ranking de este sorteo (' + s.title + '): ' + extraWho(e, extraSpan(which)) + ' participan del sorteo AL AZAR de ' + cuantos + '. Cada cliente que cumple entra una sola vez. Se sortea el día 1 del mes siguiente, a las 12 h, desde nuestro panel y de forma verificable: se publica la semilla y los ganadores salen de un sorteo determinista (SHA-256 sobre la lista de participantes ordenada); los ganadores se publican con el nombre tapado y cobran ' + pay.texto + ', igual que los premios del ranking.' }); }
  out.push({ t: 'Cómo y cuándo se cobra', d: 'Los premios se pagan ' + pay.texto + ' (dentro de los primeros 10 días del mes siguiente al cierre). Nuestro Soporte de entrega de premios te escribe por el chat de la app y por Telegram para coordinar. Para cobrar tenés que ser el titular de la cuenta y acreditarlo con tu DNI; la plata se transfiere a un CBU/alias a tu nombre (nunca a terceros) y los premios físicos se coordinan con vos (entrega o su valor en efectivo). Si un ganador no responde en 10 días hábiles o no acredita la identidad, el premio pasa al siguiente del ranking.' });
  out.push({ t: 'Requisitos para anotarse', d: 'Tenés que tener ' + reqs + '. Te anotás una sola vez y quedás anotado para todo el sorteo. El ranking muestra a todos los clientes que cargaron y jugaron en el período (con el nombre tapado), pero los premios son sólo para los anotados: si el primero del ranking no está anotado, el premio pasa al siguiente anotado.' });
  out.push({ t: 'Quiénes participan', d: 'Clientes registrados en la app de PICA ROJA con al menos una carga real en el período. Una persona = una cuenta; las cuentas duplicadas, con jugadas irregulares o marcadas por el radar de estafas quedan afuera.' });
  out.push({ t: 'Actualización y transparencia', d: 'El ranking se actualiza cada 20 minutos con lo apostado hasta ese momento. Cada jugador ve su puesto y sus puntos en todo momento; los demás aparecen con el nombre tapado. Al cierre se congela y se publica tal cual.' });
  out.push({ t: 'Empate', d: 'Gana quien apostó más con plata real; si sigue igual, quien hizo antes su primera carga del período.' });
  out.push({ t: 'Reglas generales', d: 'Premios, extras y reglas de cada período se publican acá antes de que empiece; lo que vale es lo publicado para ese período. PICA ROJA puede anular la participación de cuentas con fraude, multicuentas o apuestas irregulares. Sólo mayores de 18 años. Jugá con responsabilidad.' });
  return out;
}

module.exports = { defaults, normalize, periodOf, mask, computePoints, extraWinners, extraWho, extraSpan, terms, payWindow, artDay, monthOf, fmtDay, money, DAY };
