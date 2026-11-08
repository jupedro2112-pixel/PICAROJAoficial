'use strict';
// #971 (owner 2026-10-24): RECORRIDO DE RETENCIÓN — reglas puras del "Centro de avisos".
// "Quiero que todos instalen la app (por eso el 50%); después, estrategias sobre una persona con app para que no se olvide de jugar, a
//  corto y a largo plazo; y la gente inactiva que dejó de elegirnos que reciba hasta un regalo si hace falta, después de tantos días, un
//  bono fuerte: no tengo problema de regalar si es para recuperar, un cliente vale ~$15.000."
//
// Cada cliente está en UN segmento según su estado y, por día, le toca a lo sumo UN paso. El motor (server.js `_journeyTick`) arma un
// lote (NotifBatch) por paso con el regalo del paso, así todo sale por la misma cola que el autopiloto y los lotes manuales, con el
// mismo tope mensual y 1 aviso por día por cliente. Este archivo no toca la base: recibe el estado y devuelve qué paso corresponde.
//
// Segmentos (por días desde la ÚLTIMA carga real, o desde el registro si nunca cargó):
//   nuevo      nunca cargó                      → avisos de servicio (sin fichas: evitamos multicuentas), días 1, 3, 10, 21.
//   (sin app: NO hay pasos — #972: instalar la app se resuelve en el momento, al entrar: avisos + 50 % EXTRA en la 1ª carga.)
//   activo     cargó hace 0–6 días              → nada acá (lo cubren el autopiloto masivo y el aviso del reembolso diario).
//   enfriando  7–13 días sin cargar             → "te extrañamos" con bono % en la próxima carga.
//   inactivo   14–29 días                       → bono fuerte y después FICHAS de regalo según el valor del cliente.
//   perdido    30–89 días                       → 100% y fichas, alternados cada ~15 días.
//   lejano     90–180 días                      → un intento por mes, fuerte. Después de 180 días se deja de insistir.
// Valor del cliente (promedio de carga de los últimos 90 días, o de la vida): chico / medio / grande ⇒ fichas de $2.000 / $5.000 / $10.000.
// Las fichas van SIEMPRE con el rollover global de regalos (ctx.rolloverX). Los textos son de SERVICIO (nunca sueldos ni "ya cobraste").

const VALUE_TIERS = [
  { key: 'chico', max: 15000, chips: 2000 },
  { key: 'medio', max: 60000, chips: 5000 },
  { key: 'grande', max: Infinity, chips: 10000 }
];
const MAX_DAYS = 180;      // después de esto no se insiste más
const TRUST_DEPOSITS = 5;  // #976/#977 (owner): el registro abierto entra a TODA la estrategia (fichas de regalo incluidas) después de 5 cargas reales, sin regalo especial
// #1039 (owner 2026-11-08): "sin bonos de bienvenida hasta que no sea un cliente FIEL después de una SEMANA" ⇒ fiel = al menos TRUST_RULE.deposits
// cargas reales Y la primera carga hace ≥ TRUST_RULE.days días (las 5 cargas solas ya no alcanzan: hace falta la semana). Mismo criterio que
// `_isTrustedClient` en server.js (ahí los números salen de Config['trustRule']; acá quedan los default para el generador aislado).
const TRUST_RULE = { days: 7, deposits: 3 };
function isTrusted(state, now) {
  if (!state || !state.noWelcome) return true;
  const n = Number(state.deposits) || 0; if (n < TRUST_RULE.deposits) return false;
  const f = state.firstDepositAt ? new Date(state.firstDepositAt).getTime() : null;
  return !!f && ((now || new Date()).getTime() - f) >= TRUST_RULE.days * 86400000;
}
const UNTRUSTED_PCT = 50;  // antes de eso, los pasos de FICHAS se convierten en +50 % en la próxima carga (tiene que poner plata para cobrarlo)
const TOLERANCE = 2;       // si el motor no corrió justo ese día, el paso sale hasta 2 días después

// gift: { type:'none' } | { type:'percent', pct, hours } | { type:'fixed', mult, hours }  (mult × fichas del tramo de valor)
const STEPS = [
  // (#977, owner: a las 5 cargas NO hay regalo especial: el cliente del registro abierto simplemente pasa a recibir lo mismo que cualquier otro.)
  // nuevo (desde el registro)
  { id: 'new-1', segment: 'nuevo', day: 1, capped: true, name: 'Bienvenida día 1', gift: { type: 'none', hours: 24 },
    title: '👋 ¡Bienvenido a Pica Roja!', text: 'Cargás por transferencia y las fichas entran solas en segundos. ¿Dudas? Soporte en la app.' },
  { id: 'new-3', segment: 'nuevo', day: 3, capped: true, needsWelcome: true, name: 'Primera carga con bono', gift: { type: 'none', hours: 24 },
    title: '🎁 BONO +{first}% en tu primera carga', text: 'Se suma solo cuando cargás. Desde ${min} ya jugás 🚀' },
  { id: 'new-10', segment: 'nuevo', day: 10, capped: true, name: 'Recordatorio día 10', gift: { type: 'none', hours: 24 },
    title: '🔴 Tu cuenta te espera', text: 'Cargá y tenés reembolso diario del {daily}% sobre lo que pierdas.' },
  { id: 'new-21', segment: 'nuevo', day: 21, capped: true, needsWelcome: true, name: 'Último aviso de bienvenida', gift: { type: 'none', hours: 24 },
    title: '🎁 Tu BONO +{first}% sigue guardado', text: '¿Algo no te cerró? Escribinos por Soporte y lo resolvemos.' },
  // (#972, owner: "lo de instalar a los 2 o 9 días no sirve: muchos ya pierden el contacto si no tienen la app; tiene que ser EN EL
  //  MOMENTO" ⇒ no hay pasos de instalar la app acá: eso lo hace la propia app al entrar — activar avisos + 50 % EXTRA por instalar en la
  //  primera carga (installGift). Si en el futuro se quiere un recordatorio, va como paso 'sinapp' y pickStep ya lo soporta.)
  // enfriando (desde la última carga)
  { id: 'cool-7', segment: 'enfriando', day: 7, capped: true, name: 'Te extrañamos · 7 días', gift: { type: 'percent', pct: 30, hours: 24 },
    title: '🎁 BONO +{pct}% hoy', text: 'Cargá en las próximas {h} h y se suma solo ⚡' },
  { id: 'cool-11', segment: 'enfriando', day: 11, capped: true, name: 'Vuelta · 11 días', gift: { type: 'percent', pct: 50, hours: 24 },
    title: '🎁 BONO +{pct}% para que vuelvas', text: 'Válido {h} h. Cargá y se aplica solo 💸' },
  // inactivo
  { id: 'inact-14', segment: 'inactivo', day: 14, capped: false, name: 'Bono fuerte · 14 días', gift: { type: 'percent', pct: 60, hours: 48 },
    title: '🎁 BONO +{pct}% por {h} h', text: 'Volvé hoy: se suma solo en tu próxima carga 🔥' },
  { id: 'inact-21', segment: 'inactivo', day: 21, capped: false, name: 'Fichas de regalo · 21 días', gift: { type: 'fixed', mult: 1, hours: 48 },
    title: '🎁 ${monto} en fichas GRATIS', text: 'Ya están en tu cuenta. Entrá y jugalas 🔴' },
  // perdido
  { id: 'lost-30', segment: 'perdido', day: 30, capped: false, name: 'Duplicamos · 30 días', gift: { type: 'percent', pct: 100, hours: 48 },
    title: '🎁 Te DUPLICAMOS la carga (+{pct}%)', text: 'Cargá en las próximas {h} h y se suma solo 💥' },
  { id: 'lost-45', segment: 'perdido', day: 45, capped: false, name: 'Fichas · 45 días', gift: { type: 'fixed', mult: 1.5, hours: 48 },
    title: '🎁 ${monto} en fichas GRATIS', text: 'Ya están en tu cuenta para jugar hoy 🏆' },
  { id: 'lost-60', segment: 'perdido', day: 60, capped: false, name: 'Duplicamos · 60 días', gift: { type: 'percent', pct: 100, hours: 72 },
    title: '🎁 BONO +{pct}% por {h} h', text: 'Volvé hoy: se suma solo en tu próxima carga 💥' },
  { id: 'lost-75', segment: 'perdido', day: 75, capped: false, name: 'Fichas fuertes · 75 días', gift: { type: 'fixed', mult: 2, hours: 48 },
    title: '🎁 ${monto} en fichas GRATIS', text: 'Ya están en tu cuenta. Jugalas cuando quieras 🎰' },
  // lejano
  { id: 'far-90', segment: 'lejano', day: 90, capped: false, name: 'Duplicamos · 90 días', gift: { type: 'percent', pct: 100, hours: 72 },
    title: '🎁 Te DUPLICAMOS la carga (+{pct}%)', text: 'Válido {h} h. Tu cuenta sigue activa 💥' },
  { id: 'far-120', segment: 'lejano', day: 120, capped: false, name: 'Fichas · 120 días', gift: { type: 'fixed', mult: 2, hours: 72 },
    title: '🎁 ${monto} en fichas GRATIS', text: 'Ya están en tu cuenta, sin cargar nada 🔴' },
  { id: 'far-150', segment: 'lejano', day: 150, capped: false, name: 'Duplicamos · 150 días', gift: { type: 'percent', pct: 100, hours: 72 },
    title: '🎁 BONO +{pct}% por {h} h', text: 'Volvé hoy: se suma solo en tu próxima carga 🔴' },
  { id: 'far-180', segment: 'lejano', day: 180, capped: false, name: 'Último intento · 180 días', gift: { type: 'fixed', mult: 2, hours: 72 },
    title: '🎁 Último regalo: ${monto} en fichas', text: 'Ya están en tu cuenta. ¡Gracias por elegirnos! 🔴' }
];

function valueTier(avgDeposit) { const a = Number(avgDeposit) || 0; return VALUE_TIERS.find((t) => a < t.max) || VALUE_TIERS[VALUE_TIERS.length - 1]; }

function dayKey(d) { return d ? new Date(new Date(d).getTime() - 3 * 3600000).toISOString().slice(0, 10) : null; }
function daysBetween(from, now) { return Math.floor((dayKeyMs(now) - dayKeyMs(from)) / 86400000); }
function dayKeyMs(d) { return Date.parse(dayKey(d) + 'T00:00:00Z'); }

// state: { createdAt, deposits, lastDepositAt, avgDeposit, hasApp, flagged, sent:[{k}] }
function classify(state, now) {
  if (!state || !state.createdAt) return { segment: 'ninguno', days: 0 };
  const regDays = daysBetween(state.createdAt, now);
  if (!(state.deposits > 0) || !state.lastDepositAt) return { segment: 'nuevo', days: regDays, regDays };
  const d = daysBetween(state.lastDepositAt, now);
  const seg = d <= 6 ? 'activo' : d <= 13 ? 'enfriando' : d <= 29 ? 'inactivo' : d <= 89 ? 'perdido' : d <= MAX_DAYS ? 'lejano' : 'olvidado';
  return { segment: seg, days: d, regDays };
}

// Paso de HOY para un cliente (o null). Orden de prioridad: recuperación > nuevo > instalar la app.
// tuning (#973, revisión semanal): { pctMult, chipsMult } multiplica el % de bono y las fichas de cada paso.
function pickStep(state, now, tuning) {
  if (!state || state.flagged) return null;
  const c = classify(state, now);
  const sent = new Set((state.sent || []).map((s) => (s && s.k) || s));
  const ep = c.segment === 'nuevo' ? 'reg' : dayKey(state.lastDepositAt);
  const fits = (st, days) => days >= st.day && days <= st.day + TOLERANCE;
  const cands = [];
  const trusted = isTrusted(state, now); // #976 → #1039: cargas + una semana
  for (const st of STEPS) {
    if (st.needsWelcome && state.noWelcome) continue; // #975: registro abierto sin regalos ⇒ no prometer bono de bienvenida
    if (st.segment === 'nuevo' && c.segment === 'nuevo' && fits(st, c.days)) cands.push({ st, key: st.id + '@reg', prio: 2 });
    else if (st.segment === 'sinapp' && !state.hasApp && fits(st, c.regDays)) cands.push({ st, key: st.id + '@reg', prio: 1 });
    else if (st.segment === c.segment && ['enfriando', 'inactivo', 'perdido', 'lejano'].includes(st.segment) && fits(st, c.days)) cands.push({ st, key: st.id + '@' + ep, prio: 3 });
  }
  const ok = cands.filter((x) => !sent.has(x.key)).sort((a, b) => b.prio - a.prio || b.st.day - a.st.day);
  if (!ok.length) return null;
  const tier = valueTier(state.avgDeposit);
  let g = ok[0].st.gift;
  if (!trusted && g.type === 'fixed') g = { type: 'percent', pct: UNTRUSTED_PCT, hours: g.hours }; // #976/#1039: sin fichas gratis hasta ser fiel
  const tn = tuning || {}; const pm = Number(tn.pctMult) > 0 ? Number(tn.pctMult) : 1, cm = Number(tn.chipsMult) > 0 ? Number(tn.chipsMult) : 1;
  const amount = g.type === 'percent' ? Math.max(5, Math.min(200, Math.round(g.pct * pm / 5) * 5)) : g.type === 'fixed' ? Math.max(500, Math.round(tier.chips * (g.mult || 1) * cm / 500) * 500) : 0;
  return { step: ok[0].st, key: ok[0].key, segment: c.segment, days: c.days, tier: tier.key, giftType: g.type, amount, hours: g.hours || 24 };
}

// #997 (owner): "que la notificación sea resumida y concisa; si es bono, remarcar esa parte" ⇒ título con el bono adelante (≤ 40) y
// cuerpo de una idea (≤ 90). Paso de FICHAS convertido a % (registro abierto, #976): usa este texto, no el de las fichas.
const PCT_INSTEAD_OF_CHIPS = { title: '🎁 BONO +{pct}% en tu próxima carga', text: 'Válido {h} h. Se suma solo al cargar 🔴' };
// Texto con variables. vars: { first, daily, min } (porcentajes y mínimo globales); monto/pct/h salen del paso.
function render(pick, vars) {
  const v = Object.assign({ first: 50, daily: 10, min: '5.000' }, vars || {});
  const money = (n) => Math.round(Number(n) || 0).toLocaleString('es-AR');
  const fill = (t) => String(t || '')
    .replace(/\{h\}/g, String(pick.hours)).replace(/\{pct\}/g, String(pick.giftType === 'percent' ? pick.amount : v.first))
    .replace(/\{monto\}/g, money(pick.amount)).replace(/\{first\}/g, String(v.first)).replace(/\{daily\}/g, String(v.daily)).replace(/\{min\}/g, String(v.min));
  const src = pick.step.gift && pick.step.gift.type === 'fixed' && pick.giftType === 'percent' ? PCT_INSTEAD_OF_CHIPS : pick.step;
  return { title: fill(src.title).slice(0, 100), message: fill(src.text).slice(0, 500) };
}

// Cuerpo del lote para `_createNotifBatchFromBody` (modo ventana: el regalo se activa solo para todos los del lote).
function batchBody(pick, usernames, ctx) {
  const t = render(pick, ctx && ctx.vars);
  const b = { audienceType: 'list', usernames, name: ('Recorrido · ' + pick.step.name).slice(0, 60), title: t.title, message: t.message,
    mode: 'window', validHours: pick.hours, dailyCap: 1, monthlyCap: pick.step.capped && ctx && ctx.monthlyCap ? ctx.monthlyCap : null, appOnly: false };
  if (pick.giftType === 'percent') Object.assign(b, { giftType: 'percent', amount: pick.amount, applyMode: 'auto', applyScope: 'first' });
  else if (pick.giftType === 'fixed') Object.assign(b, { giftType: 'fixed', amount: pick.amount, rolloverX: ctx && ctx.rolloverX != null ? ctx.rolloverX : 5 });
  else Object.assign(b, { giftType: 'none', amount: 0 });
  return b;
}

const SEGMENT_LABELS = { nuevo: '🆕 Nuevos sin carga', activo: '🟢 Activos (0–6 d)', enfriando: '🟡 Enfriando (7–13 d)', inactivo: '🟠 Inactivos (14–29 d)', perdido: '🔴 Perdidos (30–89 d)', lejano: '⚫ Lejanos (90–180 d)', olvidado: '⚪ Más de 180 d (sin avisos)' };

module.exports = { STEPS, VALUE_TIERS, MAX_DAYS, TOLERANCE, TRUST_DEPOSITS, TRUST_RULE, isTrusted, UNTRUSTED_PCT, SEGMENT_LABELS, valueTier, classify, pickStep, render, batchBody, dayKey };
