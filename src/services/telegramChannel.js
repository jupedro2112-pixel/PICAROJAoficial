/**
 * telegramChannel.js — #1044 CANAL DE TELEGRAM de PICA ROJA (owner 2026-11-09: "contenido rotativo automático, siempre lo que se publica en
 * historias va al canal, para cada uno un botón directo a la aplicación o página; el canal armado con botones y premium: ver beneficios del mes,
 * cuánto se regaló, cuánto hubo en premios en el mes, el premio más grande, información de sorteos y del servicio completo").
 *
 * Este archivo sólo ARMA textos/botones y habla con la Bot API (axios). Qué se publica y cuándo lo decide server.js (`_tg*`):
 *  - cada historia pública de la app ⇒ un posteo en el canal con su foto y el botón "Entrar a PICA ROJA";
 *  - un mensaje FIJADO (panel del mes) que se edita solo cada hora, con botones que abren ventanitas (callback ⇒ answerCallbackQuery).
 * El token NUNCA va en el código: se carga en el panel (cifrado) o por env TELEGRAM_BOT_TOKEN.
 */
// axios / form-data se cargan al usarlos (los tests que leen este archivo corren sin node_modules).

const API = 'https://api.telegram.org/bot';
const POPUP_MAX = 200; // límite de Telegram para el texto de answerCallbackQuery
const CAPTION_MAX = 1024;

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
// Nunca el usuario completo en un canal público: "pi***26".
function maskUser(u) {
  const s = String(u || '').trim(); if (!s) return '';
  if (s.length <= 4) return s[0] + '***';
  return s.slice(0, 2) + '***' + s.slice(-2);
}
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

async function call(token, method, payload, opts = {}) {
  if (!token) return { ok: false, error: 'sin token del bot' };
  try {
    const r = await require('axios').post(API + token + '/' + method, payload, Object.assign({ timeout: 30000, maxBodyLength: 60 * 1024 * 1024 }, opts));
    const d = r.data || {};
    return d.ok ? { ok: true, result: d.result } : { ok: false, error: d.description || 'error de Telegram' };
  } catch (e) {
    const d = e.response && e.response.data;
    return { ok: false, error: (d && d.description) || e.message, retryAfter: d && d.parameters && d.parameters.retry_after };
  }
}
// Foto / video por archivo (Buffer) o por URL pública.
async function sendMedia(token, kind, chatId, media, extra) {
  const method = kind === 'video' ? 'sendVideo' : 'sendPhoto';
  const field = kind === 'video' ? 'video' : 'photo';
  if (typeof media === 'string') return call(token, method, Object.assign({ chat_id: chatId, [field]: media }, extra));
  const FormData = require('form-data'); const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append(field, media.buffer, { filename: media.filename || (kind === 'video' ? 'historia.mp4' : 'historia.png'), contentType: media.mime || (kind === 'video' ? 'video/mp4' : 'image/png') });
  for (const [k, v] of Object.entries(extra || {})) if (v != null) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  return call(token, method, fd, { headers: fd.getHeaders() });
}

/** Botón (o botones) de cada posteo: siempre "Entrar a PICA ROJA"; si la historia tiene un link externo, también ése. */
// #1044-c (owner: "que se puedan configurar los botones en el admin"): `b` = Config['telegramBot'].buttons normalizado (normalizeButtons).
const BTN_KEYS = ['benef', 'paid', 'top', 'sorteo', 'serv'];
const BTN_DEFAULT = {
  appLabel: '🎰 Entrar a PICA ROJA', storyLabel: '🎰 Entrar a PICA ROJA',
  items: { benef: { on: true, label: '🎁 Beneficios del mes' }, paid: { on: true, label: '💸 Premios del mes' }, top: { on: true, label: '🏆 Premio más grande' }, sorteo: { on: true, label: '🎟️ Sorteo' }, serv: { on: true, label: '⭐ Servicio completo' } },
  servText: '', links: [] // links: [{label, url}] botones extra (Telegram de soporte, Instagram…), hasta 3
};
function normalizeButtons(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const lbl = (v, d) => { const t = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); return t ? cut(t, 40) : d; };
  const out = { appLabel: lbl(r.appLabel, BTN_DEFAULT.appLabel), storyLabel: lbl(r.storyLabel, BTN_DEFAULT.storyLabel), items: {}, servText: cut(String(r.servText || '').trim(), POPUP_MAX), links: [] };
  for (const k of BTN_KEYS) { const it = (r.items || {})[k] || {}; out.items[k] = { on: it.on !== false && k !== 'paid' && k !== 'top', label: lbl(it.label, BTN_DEFAULT.items[k].label) }; } // #1055: sin montos de premios
  for (const l of (Array.isArray(r.links) ? r.links : []).slice(0, 3)) { const u = String((l && l.url) || '').trim(); if (/^https:\/\/\S+$/i.test(u) && l.label) out.links.push({ label: lbl(l.label, 'Ver'), url: u.slice(0, 300) }); }
  return out;
}
function storyButtons() {
  // #1055 (owner: "sacá el link, que la gente entre siempre desde su app"): los posteos del canal no llevan botones con link.
  return undefined;
}
/** Texto del posteo de una historia (HTML de Telegram). */
function storyCaption(story, now = new Date()) {
  // #1055 (owner): informativo, mismo formato que el posteo del sorteo (titular, secciones con separadores) y sin links: se entra desde la app.
  const L = ['🔴 <b>PICA ROJA' + (story.title ? ' · ' + esc(String(story.title).toUpperCase()) : '') + '</b>', '━━━━━━━━━━━━━━'];
  if (story.text) L.push(esc(story.text));
  if (Number(story.bonusPct) > 0 && story.bonusUntil && new Date(story.bonusUntil) > now) {
    const h = new Date(story.bonusUntil).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
    L.push('━━━━━━━━━━━━━━', '🎁 <b>BONO +' + Math.round(story.bonusPct) + '% EN TU PRÓXIMA CARGA</b>', '⏳ Vale hasta las ' + h + ' h', '━━━━━━━━━━━━━━', '📝 <b>CÓMO USARLO</b>',
      '1. Abrí tu app PICA ROJA', '2. Tocá la historia del bono y después "Reclamar"', '3. Cargá antes de las ' + h + ' h y el bono entra solo');
  }
  L.push('━━━━━━━━━━━━━━', '📲 <b>Entrá desde tu app PICA ROJA</b>');
  return cut(L.join('\n'), CAPTION_MAX);
}

// ── #1044-b FOTOS PREMIUM (SVG ⇒ PNG en el server). Sin emojis adentro de la imagen (el render no los tiene): sólo letras y formas. ──
const xesc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const noEmoji = (t) => String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();
function wrap(text, max, lines) {
  const out = []; let cur = '';
  for (const w of noEmoji(text).split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + w).trim().length > max) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    if (out.length >= lines) break;
  }
  if (cur && out.length < lines) out.push(cur);
  if (out.length === lines && noEmoji(text).length > out.join(' ').length) out[lines - 1] = cut(out[lines - 1], max);
  return out;
}
const FONT = "font-family=\"Helvetica, Arial, sans-serif\"";
function bgDefs() {
  return '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1923"/><stop offset="1" stop-color="#1a2c38"/></linearGradient>' +
    '<linearGradient id="rd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e60023"/><stop offset="1" stop-color="#ff4d5e"/></linearGradient></defs>';
}
function brand(x, y) { return `<rect x="${x}" y="${y - 30}" width="14" height="40" rx="4" fill="#e60023"/><text x="${x + 28}" y="${y}" ${FONT} font-size="34" font-weight="bold" fill="#ffffff" letter-spacing="3">PICA ROJA</text>`; }
// #1044-c (owner: "arriba la foto de PICA ROJA con el logo en el medio, centrado"): logo (la pica dorada, `logo` = PNG en base64) centrado arriba con el
// nombre debajo y una línea roja fina. Sin logo (no se pudo leer el archivo) queda sólo el nombre centrado.
function header(W, y, size, logo, sub) {
  const x = (W - size) / 2;
  const cx = W / 2, cy = y + size / 2, r = size / 2;
  const img = logo ? `<defs><clipPath id="lc"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs><circle cx="${cx}" cy="${cy}" r="${r + 18}" fill="#e60023" opacity="0.16"/>` +
    `<image x="${x}" y="${y}" width="${size}" height="${size}" clip-path="url(#lc)" href="data:image/png;base64,${logo}" xlink:href="data:image/png;base64,${logo}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#d4a64a" stroke-width="3"/>` : '';
  const ty = y + (logo ? size + 52 : 40);
  return img + `<text x="${W / 2}" y="${ty}" text-anchor="middle" ${FONT} font-size="${Math.round(size * 0.3)}" font-weight="bold" fill="#ffffff" letter-spacing="6">PICA ROJA</text>` +
    (sub ? `<text x="${W / 2}" y="${ty + Math.round(size * 0.26)}" text-anchor="middle" ${FONT} font-size="${Math.round(size * 0.17)}" fill="#b1bad3" letter-spacing="4">${xesc(sub)}</text>` : '') +
    `<rect x="${W / 2 - 60}" y="${ty + (sub ? Math.round(size * 0.26) + 24 : 22)}" width="120" height="6" rx="3" fill="#e60023"/>`;
}
const SVG_OPEN = (W, H) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
/** Foto cuadrada de una historia SIN foto propia (sólo texto): titular grande, texto y "ENTRÁ AHORA". */
function storyCardSvg(story, logo) {
  const W = 1080; const t = wrap(String(story.title || '').toUpperCase(), 20, 3); const b = wrap(story.text || '', 38, 3);
  let y = 470; let body = '';
  for (const l of t) { body += `<text x="${W / 2}" y="${y}" text-anchor="middle" ${FONT} font-size="74" font-weight="bold" fill="#ffffff">${xesc(l)}</text>`; y += 86; }
  y += 24;
  for (const l of b) { body += `<text x="${W / 2}" y="${y}" text-anchor="middle" ${FONT} font-size="40" fill="#b1bad3">${xesc(l)}</text>`; y += 54; }
  const hasBonus = Number(story.bonusPct) > 0;
  const pills = hasBonus
    ? `<rect x="110" y="880" width="410" height="96" rx="48" fill="#e60023"/><text x="315" y="943" text-anchor="middle" ${FONT} font-size="44" font-weight="bold" fill="#fff">BONO +${Math.round(story.bonusPct)}%</text>` +
      `<rect x="560" y="880" width="410" height="96" rx="48" fill="none" stroke="#ffffff" stroke-width="3"/><text x="765" y="943" text-anchor="middle" ${FONT} font-size="38" font-weight="bold" fill="#fff" letter-spacing="2">ENTRÁ AHORA</text>`
    : `<rect x="315" y="880" width="450" height="96" rx="48" fill="#e60023"/><text x="540" y="943" text-anchor="middle" ${FONT} font-size="40" font-weight="bold" fill="#fff" letter-spacing="2">ENTRÁ AHORA</text>`;
  return SVG_OPEN(W, W) + bgDefs() + `<rect width="${W}" height="${W}" fill="#14232e"/>` +
    `<circle cx="1000" cy="80" r="260" fill="#e60023" opacity="0.08"/><circle cx="60" cy="1040" r="220" fill="#e60023" opacity="0.06"/>` +
    header(W, 50, 170, logo) + body + pills +
    `<text x="${W / 2}" y="1040" text-anchor="middle" ${FONT} font-size="26" fill="#55657e" letter-spacing="3">PICAROJA.COM</text></svg>`;
}
/** Foto del PANEL DEL MES: tres números grandes (pagado, regalado, premio más grande) + sorteo. */
function panelSvg(s, logo) {
  const W = 1280, H = 720; const mes = (MONTHS[s.monthIdx] || '').toUpperCase();
  const tile = (x, label, value, sub) => `<rect x="${x}" y="300" width="360" height="230" rx="24" fill="#213743"/><rect x="${x}" y="300" width="360" height="8" rx="4" fill="#e60023"/>` +
    `<text x="${x + 180}" y="362" text-anchor="middle" ${FONT} font-size="24" fill="#b1bad3" letter-spacing="2">${xesc(label)}</text>` +
    `<text x="${x + 180}" y="442" text-anchor="middle" ${FONT} font-size="${value.length > 10 ? 46 : value.length > 8 ? 54 : 60}" font-weight="bold" fill="#ffffff">${xesc(value)}</text>` +
    `<text x="${x + 180}" y="490" text-anchor="middle" ${FONT} font-size="22" fill="#55657e">${xesc(sub || '')}</text>`;
  const so = s.sorteo && (s.sorteo.prizes || [])[0] ? noEmoji(`SORTEO: ${s.sorteo.prizes[0].name}${s.sorteo.prizes[1] ? ' + ' + s.sorteo.prizes[1].name : ''}`) : 'CARGAS Y RETIROS AUTOMÁTICOS LAS 24 H';
  return SVG_OPEN(W, H) + bgDefs() + `<rect width="${W}" height="${H}" fill="#14232e"/>` +
    `<circle cx="1200" cy="60" r="240" fill="#e60023" opacity="0.08"/><circle cx="80" cy="700" r="200" fill="#e60023" opacity="0.06"/>` +
    header(W, 24, 120, logo, `${mes} ${s.year}`) +
    tile(80, 'PREMIOS PAGADOS', money(s.paid && s.paid.sum), s.paid && s.paid.count ? s.paid.count.toLocaleString('es-AR') + ' retiros' : '') +
    tile(460, 'REGALADO EN BONOS', money(s.gifted && s.gifted.sum), 'este mes') +
    tile(840, 'PREMIO MÁS GRANDE', s.top && s.top.amount > 0 ? money(s.top.amount) : '—', s.top && s.top.username ? maskUser(s.top.username) : '') +
    `<rect x="80" y="580" width="1120" height="96" rx="48" fill="#e60023"/><text x="640" y="641" text-anchor="middle" ${FONT} font-size="32" font-weight="bold" fill="#fff" letter-spacing="1">${xesc(cut(so.toUpperCase(), 60))}</text></svg>`;
}
// ── #1044-d CÓDIGO EXCLUSIVO DE TELEGRAM (owner: "un bono en Telegram: $5.000 a 10 personas cada 15 días, que entren a la app a reclamarlo, un código
// al azar que se agote y cuando se agote avisar que se terminó") y POSTEO DEL SORTEO con los pasos para anotarse. ──
function dropSvg(o, logo) {
  const W = 1080;
  return SVG_OPEN(W, W) + bgDefs() + `<rect width="${W}" height="${W}" fill="#14232e"/><circle cx="1000" cy="80" r="260" fill="#e60023" opacity="0.08"/><circle cx="60" cy="1040" r="220" fill="#e60023" opacity="0.06"/>` +
    header(W, 50, 160, logo, 'CÓDIGO EXCLUSIVO TELEGRAM') +
    `<text x="${W / 2}" y="470" text-anchor="middle" ${FONT} font-size="120" font-weight="bold" fill="#ffffff">${xesc(money(o.amount))}</text>` +
    `<text x="${W / 2}" y="540" text-anchor="middle" ${FONT} font-size="40" fill="#b1bad3">PARA LOS PRIMEROS ${Number(o.maxClaims) || 0}</text>` +
    `<rect x="190" y="600" width="700" height="150" rx="28" fill="#213743" stroke="#d4a64a" stroke-width="3" stroke-dasharray="14 10"/>` +
    `<text x="${W / 2}" y="700" text-anchor="middle" ${FONT} font-size="78" font-weight="bold" fill="#ffffff" letter-spacing="8">${xesc(o.code)}</text>` +
    `<rect x="240" y="820" width="600" height="100" rx="50" fill="#e60023"/><text x="${W / 2}" y="885" text-anchor="middle" ${FONT} font-size="42" font-weight="bold" fill="#fff" letter-spacing="2">RECLAMALO EN LA APP</text>` +
    `<text x="${W / 2}" y="1010" text-anchor="middle" ${FONT} font-size="26" fill="#55657e" letter-spacing="3">PICAROJA.COM</text></svg>`;
}
function dropCaption(o) {
  return cut([
    '🔴 <b>PICA ROJA · CÓDIGO EXCLUSIVO TELEGRAM</b>', '━━━━━━━━━━━━━━',
    `🎁 <b>${money(o.amount)}</b> para los primeros <b>${o.maxClaims}</b>`,
    `🔑 Código: <code>${esc(o.code)}</code>`, '━━━━━━━━━━━━━━', '📝 <b>CÓMO CANJEARLO</b>',
    '1. Abrí tu app PICA ROJA', '2. Entrá a <b>Perfil → Canjear código</b>', '3. Escribí el código: se acredita solo en tu saldo',
    '━━━━━━━━━━━━━━', `<i>Para clientes que ya cargaron alguna vez · se juega x${o.rolloverX || 5} · cuando se llenan los ${o.maxClaims} lugares, se agota.</i>`
  ].join('\n'), CAPTION_MAX);
}
function dropDoneCaption(o) {
  // #1055/#1056 (owner: "una vez que se llenó, poner bono completado"): sin lista de ganadores.
  return cut(['🔴 <b>PICA ROJA</b>', '━━━━━━━━━━━━━━', o.full ? `✅ <b>BONO COMPLETADO</b>\nYa se llenaron los ${Number(o.maxClaims) || 10} lugares del código <code>${esc(o.code)}</code>.` : `⏱ <b>TERMINÓ EL CÓDIGO ${esc(o.code)}</b>`,
    '━━━━━━━━━━━━━━', '🔔 El próximo sale la semana que viene: activá las notificaciones del canal para no perderlo.', '📲 <b>Entrá desde tu app PICA ROJA</b>'].join('\n'), CAPTION_MAX);
}
// #1056 (owner): "mandar mensajes de no te olvides de tu autoreembolso; publicar el semanal cuando está disponible; del mensual lo mismo".
function refundCaption(kind, pct, last) {
  const P = Math.round(Number(pct) || 0);
  const T = kind === 'monthly' ? (last ? '🗓️ ÚLTIMO DÍA DEL REEMBOLSO MENSUAL' : '🗓️ YA ESTÁ TU REEMBOLSO MENSUAL')
    : kind === 'weekly' ? (last ? '⏰ ÚLTIMO DÍA DEL REEMBOLSO SEMANAL' : '📅 YA ESTÁ TU REEMBOLSO SEMANAL') : '💸 NO TE OLVIDES DE TU REEMBOLSO';
  const sub = kind === 'monthly' ? `Te devolvemos el <b>${P}%</b> de lo que perdiste el mes pasado.` : kind === 'weekly' ? `Te devolvemos el <b>${P}%</b> de lo que perdiste la semana pasada.` : `Todos los días te devolvemos el <b>${P}%</b> de lo que perdiste ayer.`;
  return cut(['🔴 <b>PICA ROJA · ' + T + '</b>', '━━━━━━━━━━━━━━', sub, '━━━━━━━━━━━━━━', '📝 <b>CÓMO COBRARLO</b>', '1. Abrí tu app PICA ROJA', '2. Tocá <b>Reembolsos</b>', '3. Reclamalo: entra solo a tu saldo',
    '━━━━━━━━━━━━━━', last ? '⏳ <b>Hoy es el último día</b> para reclamarlo.' : (kind === 'daily' ? '⏳ El de ayer se reclama hoy.' : '⏳ Tenés unos días para reclamarlo: no lo dejes pasar.'), '📲 <b>Entrá desde tu app PICA ROJA</b>'].join('\n'), CAPTION_MAX);
}
// #1056 (owner): "cuando pagamos un premio de más de $1.000.000, publicamos y felicitamos tapando el nombre".
function bigWinCaption(username, amount) {
  return cut(['🔴 <b>PICA ROJA · ¡FELICITACIONES! 🏆</b>', '━━━━━━━━━━━━━━', `🎉 <b>${esc(maskUser(username))}</b> cobró <b>${money(amount)}</b>`, '💸 Directo a su CBU, en minutos.',
    '━━━━━━━━━━━━━━', '¡El próximo puede ser el tuyo!', '📲 <b>Entrá desde tu app PICA ROJA</b>'].join('\n'), CAPTION_MAX);
}
const SORTEO_STEPS = [['app', 'Instalá la app de PICA ROJA'], ['notif', 'Activá las notificaciones'], ['telegram', 'Unite a este canal de Telegram'], ['phone', 'Cargá tu celular en Perfil'], ['deposit', 'Hacé una carga'], ['week', 'Tu cuenta tiene que tener 7 días']];
function sorteoSteps(req) { return SORTEO_STEPS.filter(([k]) => !req || req[k]).map(([, t]) => t).concat(['Entrá a Sorteos en la app y tocá Anotarme']); }
function sorteoSvg(so, logo) {
  const W = 1080; const pr = (so.prizes || []).slice(0, 3);
  let y = 420; let body = '';
  pr.forEach((p, i) => {
    body += `<rect x="110" y="${y - 62}" width="860" height="104" rx="22" fill="#213743"/>` + (i === 0 ? `<rect x="110" y="${y - 62}" width="10" height="104" rx="5" fill="#e60023"/>` : '') +
      `<text x="160" y="${y + 6}" ${FONT} font-size="44" font-weight="bold" fill="${i === 0 ? '#d4a64a' : '#b1bad3'}">${i + 1}°</text>` +
      `<text x="250" y="${y + 6}" ${FONT} font-size="${i === 0 ? 44 : 38}" font-weight="bold" fill="#ffffff">${xesc(cut(noEmoji(p.name + (p.value ? ' ' + p.value : '')), 30))}</text>`;
    y += 130;
  });
  return SVG_OPEN(W, W) + bgDefs() + `<rect width="${W}" height="${W}" fill="#14232e"/><circle cx="1000" cy="80" r="260" fill="#e60023" opacity="0.08"/>` +
    header(W, 40, 150, logo, noEmoji(String(so.title || 'SORTEO').toUpperCase())) + body +
    `<rect x="240" y="${Math.max(y + 10, 820)}" width="600" height="100" rx="50" fill="#e60023"/><text x="${W / 2}" y="${Math.max(y + 10, 820) + 65}" text-anchor="middle" ${FONT} font-size="42" font-weight="bold" fill="#fff" letter-spacing="2">ANOTATE GRATIS</text>` +
    `<text x="${W / 2}" y="1030" text-anchor="middle" ${FONT} font-size="26" fill="#55657e" letter-spacing="3">PICAROJA.COM</text></svg>`;
}
function sorteoCaption(so) {
  const L = ['🔴 <b>PICA ROJA · ' + esc(String(so.title || 'SORTEO').toUpperCase()) + '</b>', '━━━━━━━━━━━━━━', '🏆 <b>PREMIOS</b>'];
  for (const p of (so.prizes || []).slice(0, 3)) L.push(`${p.pos}° ${esc(p.name)}${p.value ? ' ' + esc(p.value) : ''}`);
  L.push('━━━━━━━━━━━━━━', '📝 <b>CÓMO ANOTARTE (es gratis)</b>');
  sorteoSteps(so.req).forEach((t, i) => L.push(`${i + 1}. ${esc(t)}`));
  L.push('━━━━━━━━━━━━━━', '🎟️ Cuanto más jugás y cargás, más chances tenés. ¡Suerte!', '📲 <b>Entrá desde tu app PICA ROJA</b>');
  return cut(L.join('\n'), CAPTION_MAX);
}

/** Texto que acompaña la foto del panel (≤1024). */
function panelCaption(s) { return cut(panelText(s), CAPTION_MAX); }
// Cambia la foto + texto + botones de un mensaje ya publicado (panel del mes).
async function editPhoto(token, chatId, msgId, buffer, caption, replyMarkup) {
  const FormData = require('form-data'); const fd = new FormData();
  fd.append('chat_id', String(chatId)); fd.append('message_id', String(msgId));
  fd.append('media', JSON.stringify({ type: 'photo', media: 'attach://p', caption, parse_mode: 'HTML' }));
  fd.append('p', buffer, { filename: 'panel.png', contentType: 'image/png' });
  if (replyMarkup) fd.append('reply_markup', JSON.stringify(replyMarkup));
  return call(token, 'editMessageMedia', fd, { headers: fd.getHeaders() });
}

/**
 * Datos del panel del mes. `s` lo arma server.js:
 * { monthIdx, year, benefits:{firstPct, firstCap, dailyRefundPct, installFixed, giftRolloverX}, paid:{sum,count}, gifted:{sum,count},
 *   top:{amount, username}, sorteo:{title, prizes:[{pos,name,value}], requirements:[...] } | null, updatedAt }
 */
function benefitLines(b) {
  const L = [];
  if (b.dailyRefundPct > 0) L.push(`Reembolso diario: ${b.dailyRefundPct}% de lo que perdiste ayer`);
  if (b.installFixed > 0) L.push(`Extra por usar la app instalada: ${money(b.installFixed)}`);
  L.push('Ruleta diaria, fueguito, misiones y niveles VIP');
  L.push('Bonos por tiempo limitado: los avisamos en este canal');
  return L;
}
function sorteoLine(so) {
  if (!so || !(so.prizes || []).length) return '';
  return so.prizes.slice(0, 3).map((p) => `${p.pos}° ${p.name}${p.value ? ' ' + p.value : ''}`).join(' · ');
}
function panelText(s) {
  // #1055 (owner: "más informativo, sin tantos datos de premios regalados"; "los mensajes de la comunidad son para gente ya registrada"):
  // un panel FIJO de información, mismo formato que el posteo del sorteo, sin montos pagados/regalados y sin links (se entra desde la app).
  s = s || {}; const L = ['🔴 <b>PICA ROJA · CANAL OFICIAL</b>', '━━━━━━━━━━━━━━', '⭐ <b>TU SERVICIO</b>',
    '▸ Cargas y retiros automáticos las 24 h', '▸ Retiros directo a tu CBU, en minutos', '▸ Soporte dentro de la app (burbuja del chat)',
    '━━━━━━━━━━━━━━', '🎁 <b>BENEFICIOS</b>'];
  for (const x of benefitLines(s.benefits || {})) L.push('▸ ' + esc(x));
  if (s.sorteo && (s.sorteo.prizes || []).length) {
    L.push('━━━━━━━━━━━━━━', '🎟️ <b>' + esc(String(s.sorteo.title || 'SORTEO').toUpperCase()) + '</b>');
    for (const p of s.sorteo.prizes.slice(0, 3)) L.push(`${p.pos}° ${esc(p.name)}${p.value ? ' ' + esc(p.value) : ''}`);
    L.push('Te anotás gratis desde Sorteos, en la app.');
  }
  L.push('━━━━━━━━━━━━━━', '📢 <b>EN ESTE CANAL</b>', '▸ Bonos del momento y códigos exclusivos', '▸ Partidos del día y novedades del servicio');
  L.push('━━━━━━━━━━━━━━', '📲 <b>Entrá desde tu app PICA ROJA</b>');
  return cut(L.join('\n'), 4000);
}
function panelButtons(appUrl, b) {
  // #1055: sin links (ni a la app ni al bot): sólo las ventanitas de información.
  b = b || normalizeButtons(null);
  const info = BTN_KEYS.filter((k) => b.items[k].on).map((k) => ({ text: b.items[k].label, callback_data: 'tg:' + k }));
  const rows = []; for (let i = 0; i < info.length; i += 2) rows.push(info.slice(i, i + 2));
  return rows.length ? { inline_keyboard: rows } : undefined;
}
/** Ventanita de cada botón del panel (máx. 200 caracteres, texto plano). */
function popupText(key, s, b) {
  s = s || {}; if (key === 'serv' && b && b.servText) return cut(b.servText, POPUP_MAX);
  let t;
  if (key === 'benef') t = '🎁 Beneficios:\n' + benefitLines(s.benefits || {}).map((x) => '• ' + x).join('\n');
  else if (key === 'sorteo') t = s.sorteo ? `🎟️ ${s.sorteo.title}: ${sorteoLine(s.sorteo)}. Te anotás gratis desde Sorteos, en tu app.` : '🎟️ Pronto un sorteo nuevo. Atento al canal.';
  else t = '⭐ Cargás y retirás solo las 24 h, reembolsos todos los días, ruleta, misiones, sorteos y soporte: todo desde tu app PICA ROJA.'; // #1055: 'paid' / 'top' ya no muestran montos
  return cut(t, POPUP_MAX);
}


// ── #1044-e BOTONERA FIJA DEL BOT (chat privado: en un canal Telegram no muestra teclado). Cada botón responde con datos del momento y, si
// hace falta un link, es SIEMPRE a la app (picaroja.com: entra con su sesión o ve el inicio de sesión). ──
const MENU = [
  ['benef', '🎁 Beneficios'], ['serv', '⭐ El servicio'],
  ['rank', '🏆 Sorteo: quién va ganando'], ['steps', '🎟️ Cómo anotarme'],
  ['code', '🔑 Código activo'], ['app', '📲 Cómo entrar']
];
function menuKeyboard() {
  const rows = []; for (let i = 0; i < MENU.length; i += 2) rows.push(MENU.slice(i, i + 2).map(([, t]) => ({ text: t })));
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Elegí una opción 👇' };
}
function menuKey(text) { const t = String(text || '').trim(); const m = MENU.find(([, l]) => l === t); return m ? m[0] : null; }
// Devuelve { text, button } (button = { text, url } a la app o null).
function menuReply(key, s, o) {
  // #1055 (owner: "sin link, que entren desde su app"): las respuestas del bot por privado no llevan botones con link.
  s = s || {}; o = o || {};
  const APP = '\n\n📲 <b>Entrá desde tu app PICA ROJA</b>';
  if (key === 'benef' || key === 'serv') return { text: '🔴 <b>PICA ROJA</b>\n' + esc(popupText(key, s, o.btn)) + APP, button: null };
  if (key === 'rank') {
    const so = s.sorteo;
    if (!so) return { text: '🎟️ Ahora no hay un sorteo en curso. Te avisamos en el canal cuando arranque el próximo.', button: null };
    const L = ['🏆 <b>' + esc(so.title || 'Sorteo') + '</b>', '━━━━━━━━━━━━━━'];
    const top = (so.ranking || []).slice(0, 5);
    if (top.length) { L.push('<b>Así va el ranking</b> (anotados):'); top.forEach((r, i) => L.push(`${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} ${esc(maskUser(r.username))} · ${Math.round(r.points || 0).toLocaleString('es-AR')} pts`)); }
    else L.push('Todavía no hay puntos: ¡anotate y arrancá primero!');
    if ((so.prizes || [])[0]) L.push('━━━━━━━━━━━━━━', '🎁 1° premio: <b>' + esc(so.prizes[0].name) + '</b>');
    L.push('<i>Se actualiza cada hora. Tus puntos están en Sorteos, dentro de tu app.</i>');
    return { text: cut(L.join('\n'), 4000), button: null };
  }
  if (key === 'steps') {
    if (!s.sorteo) return { text: '🎟️ Ahora no hay un sorteo en curso. Te avisamos en el canal cuando arranque el próximo.', button: null };
    return { text: sorteoCaption(s.sorteo), button: null };
  }
  if (key === 'code') {
    const d = o.drop;
    if (d && d.code && d.left > 0) return { text: `🎁 <b>Código activo: <code>${esc(d.code)}</code></b>\n${money(d.amount)} para los primeros ${d.maxClaims} · quedan <b>${d.left}</b> lugares.\n\n📝 Abrí tu app PICA ROJA → <b>Perfil → Canjear código</b> y escribilo.`, button: null };
    return { text: '🔑 Ahora no hay un código activo.\nSale cada pocos días en el canal, a cualquier hora, y vuela en minutos: activá las notificaciones del canal 🔔', button: null };
  }
  return { text: '🎰 Cargá, jugá y retirá desde tu app PICA ROJA.' + APP, button: null };
}

module.exports = { refundCaption, bigWinCaption, MENU, menuKeyboard, menuKey, menuReply, dropSvg, dropCaption, dropDoneCaption, sorteoSvg, sorteoCaption, sorteoSteps, normalizeButtons, BTN_KEYS, call, sendMedia, editPhoto, storyButtons, storyCaption, storyCardSvg, panelSvg, panelCaption, panelText, panelButtons, popupText, maskUser, esc, cut, POPUP_MAX };
