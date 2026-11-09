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
function storyButtons(story, appUrl) {
  const rows = [[{ text: '🎰 Entrar a PICA ROJA', url: appUrl }]];
  const l = String((story && story.linkUrl) || '');
  if (/^https:\/\//i.test(l) && !l.startsWith(appUrl)) rows.push([{ text: cut((story.linkLabel || 'Ver más').replace(/[\r\n]/g, ' '), 40), url: l }]);
  return { inline_keyboard: rows };
}
/** Texto del posteo de una historia (HTML de Telegram). */
function storyCaption(story, now = new Date()) {
  // #1044-b (owner: "foto y texto, bien premium estilo Stake"): titular fuerte, texto corto, separadores finos y la llamada al botón.
  const L = [];
  L.push('🔴 <b>PICA ROJA</b>');
  if (story.title) L.push('<b>' + esc(String(story.title).toUpperCase()) + '</b>');
  if (story.text) L.push(esc(story.text));
  if (Number(story.bonusPct) > 0 && story.bonusUntil && new Date(story.bonusUntil) > now) {
    const h = new Date(story.bonusUntil).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
    L.push('━━━━━━━━━━━━━━\n🎁 <b>BONO +' + Math.round(story.bonusPct) + '%</b> en tu próxima carga\n⏳ Hasta las ' + h + ' h · reclamalo en la app');
  }
  L.push('━━━━━━━━━━━━━━\n👇 <b>Entrá y jugá ahora</b>');
  return cut(L.join('\n\n'), CAPTION_MAX);
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
function brand(x, y) { return `<rect x="${x}" y="${y - 30}" width="14" height="40" rx="4" fill="url(#rd)"/><text x="${x + 28}" y="${y}" ${FONT} font-size="34" font-weight="bold" fill="#ffffff" letter-spacing="3">PICA ROJA</text>`; }
/** Foto cuadrada de una historia SIN foto propia (sólo texto): titular grande, texto y "ENTRÁ AHORA". */
function storyCardSvg(story) {
  const W = 1080; const t = wrap(String(story.title || '').toUpperCase(), 18, 3); const b = wrap(story.text || '', 34, 4);
  let y = 330; let body = '';
  for (const l of t) { body += `<text x="90" y="${y}" ${FONT} font-size="84" font-weight="bold" fill="#ffffff">${xesc(l)}</text>`; y += 96; }
  y += 30; body += `<rect x="90" y="${y - 20}" width="120" height="8" rx="4" fill="url(#rd)"/>`; y += 50;
  for (const l of b) { body += `<text x="90" y="${y}" ${FONT} font-size="44" fill="#b1bad3">${xesc(l)}</text>`; y += 60; }
  const bonus = Number(story.bonusPct) > 0 ? `<rect x="90" y="830" width="420" height="96" rx="48" fill="url(#rd)"/><text x="300" y="893" text-anchor="middle" ${FONT} font-size="46" font-weight="bold" fill="#fff">BONO +${Math.round(story.bonusPct)}%</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${bgDefs()}<rect width="${W}" height="${W}" fill="url(#bg)"/>` +
    `<circle cx="980" cy="120" r="260" fill="#e60023" opacity="0.10"/><circle cx="1020" cy="980" r="200" fill="#e60023" opacity="0.07"/>` +
    brand(90, 150) + body + bonus +
    `<rect x="${bonus ? 540 : 90}" y="830" width="450" height="96" rx="48" fill="none" stroke="#ffffff" stroke-width="3"/><text x="${bonus ? 765 : 315}" y="893" text-anchor="middle" ${FONT} font-size="40" font-weight="bold" fill="#fff" letter-spacing="2">ENTRÁ AHORA</text>` +
    `<text x="90" y="1010" ${FONT} font-size="28" fill="#55657e" letter-spacing="2">picaroja.com</text></svg>`;
}
/** Foto del PANEL DEL MES: tres números grandes (pagado, regalado, premio más grande) + sorteo. */
function panelSvg(s) {
  const W = 1280, H = 720; const mes = (MONTHS[s.monthIdx] || '').toUpperCase();
  const tile = (x, label, value, sub) => `<rect x="${x}" y="250" width="360" height="250" rx="24" fill="#213743"/><rect x="${x}" y="250" width="360" height="8" rx="4" fill="url(#rd)"/>` +
    `<text x="${x + 30}" y="320" ${FONT} font-size="26" fill="#b1bad3" letter-spacing="2">${xesc(label)}</text>` +
    `<text x="${x + 30}" y="410" ${FONT} font-size="${value.length > 10 ? 46 : value.length > 8 ? 54 : 60}" font-weight="bold" fill="#ffffff">${xesc(value)}</text>` +
    `<text x="${x + 30}" y="460" ${FONT} font-size="24" fill="#55657e">${xesc(sub || '')}</text>`;
  const so = s.sorteo && (s.sorteo.prizes || [])[0] ? noEmoji(`SORTEO: ${s.sorteo.prizes[0].name}${s.sorteo.prizes[1] ? ' + ' + s.sorteo.prizes[1].name : ''}`) : 'CARGAS Y RETIROS AUTOMÁTICOS LAS 24 H';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bgDefs()}<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
    `<circle cx="1180" cy="80" r="240" fill="#e60023" opacity="0.10"/>` + brand(80, 110) +
    `<text x="80" y="195" ${FONT} font-size="56" font-weight="bold" fill="#ffffff">${xesc(mes)} ${s.year}</text>` +
    tile(80, 'PREMIOS PAGADOS', money(s.paid && s.paid.sum), s.paid && s.paid.count ? s.paid.count.toLocaleString('es-AR') + ' retiros' : '') +
    tile(460, 'REGALADO EN BONOS', money(s.gifted && s.gifted.sum), 'este mes') +
    tile(840, 'PREMIO MÁS GRANDE', s.top && s.top.amount > 0 ? money(s.top.amount) : '—', s.top && s.top.username ? maskUser(s.top.username) : '') +
    `<rect x="80" y="550" width="1120" height="100" rx="50" fill="url(#rd)"/><text x="640" y="614" text-anchor="middle" ${FONT} font-size="34" font-weight="bold" fill="#fff" letter-spacing="1">${xesc(cut(so.toUpperCase(), 58))}</text></svg>`;
}
/** Texto que acompaña la foto del panel (≤1024). */
function panelCaption(s) {
  const mes = MONTHS[s.monthIdx] || '';
  const L = [`🔴 <b>PICA ROJA · ${esc(mes.toUpperCase())} ${s.year}</b>`, '━━━━━━━━━━━━━━', '🎁 <b>BENEFICIOS DEL MES</b>'];
  for (const x of benefitLines(s.benefits || {})) L.push('▸ ' + esc(x));
  L.push('━━━━━━━━━━━━━━');
  L.push(`💸 Premios pagados: <b>${money(s.paid && s.paid.sum)}</b>`);
  L.push(`🎁 Regalado en bonos: <b>${money(s.gifted && s.gifted.sum)}</b>`);
  if (s.top && s.top.amount > 0) L.push(`🏆 Premio más grande: <b>${money(s.top.amount)}</b> (${esc(maskUser(s.top.username))})`);
  if (s.sorteo) L.push(`🎟️ ${esc(s.sorteo.title)}`);
  L.push('━━━━━━━━━━━━━━', '👇 Tocá los botones para ver el detalle');
  return cut(L.join('\n'), CAPTION_MAX);
}
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
  if (b.firstPct > 0) L.push(`1ª carga: +${b.firstPct}%${b.firstCap > 0 ? ` (hasta ${money(b.firstCap)})` : ''}`);
  if (b.dailyRefundPct > 0) L.push(`Reembolso diario: ${b.dailyRefundPct}% de lo que perdés`);
  if (b.installFixed > 0) L.push(`Instalando la app: ${money(b.installFixed)} extra`);
  L.push('Ruleta diaria, fueguito, misiones y niveles VIP');
  return L;
}
function sorteoLine(so) {
  if (!so || !(so.prizes || []).length) return '';
  return so.prizes.slice(0, 3).map((p) => `${p.pos}° ${p.name}${p.value ? ' ' + p.value : ''}`).join(' · ');
}
function panelText(s) {
  const mes = MONTHS[s.monthIdx] || '';
  const L = [];
  L.push(`🔴 <b>PICA ROJA · ${esc(mes.charAt(0).toUpperCase() + mes.slice(1))} ${s.year}</b>`);
  L.push('Lo más importante del mes, actualizado solo cada hora.');
  L.push('');
  L.push('🎁 <b>Beneficios del mes</b>');
  for (const x of benefitLines(s.benefits || {})) L.push('• ' + esc(x));
  L.push('');
  L.push(`💸 <b>Premios pagados:</b> ${money(s.paid && s.paid.sum)}${s.paid && s.paid.count ? ` en ${s.paid.count.toLocaleString('es-AR')} retiros` : ''}`);
  L.push(`🎁 <b>Regalado en bonos:</b> ${money(s.gifted && s.gifted.sum)}`);
  if (s.top && s.top.amount > 0) L.push(`🏆 <b>Premio más grande:</b> ${money(s.top.amount)} (${esc(maskUser(s.top.username))})`);
  if (s.sorteo) { L.push(''); L.push(`🎟️ <b>${esc(s.sorteo.title)}</b>: ${esc(sorteoLine(s.sorteo))}`); }
  L.push('');
  L.push('⭐ Cargas y retiros automáticos las 24 h, reembolsos y soporte dentro de la app.');
  if (s.updatedAt) L.push(`<i>Actualizado ${esc(new Date(s.updatedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }))} h</i>`);
  return L.join('\n');
}
function panelButtons(appUrl) {
  return {
    inline_keyboard: [
      [{ text: '🎰 Entrar a PICA ROJA', url: appUrl }],
      [{ text: '🎁 Beneficios del mes', callback_data: 'tg:benef' }, { text: '💸 Premios del mes', callback_data: 'tg:paid' }],
      [{ text: '🏆 Premio más grande', callback_data: 'tg:top' }, { text: '🎟️ Sorteo', callback_data: 'tg:sorteo' }],
      [{ text: '⭐ Servicio completo', callback_data: 'tg:serv' }]
    ]
  };
}
/** Ventanita de cada botón del panel (máx. 200 caracteres, texto plano). */
function popupText(key, s) {
  s = s || {}; const mes = MONTHS[s.monthIdx] || 'este mes';
  let t;
  if (key === 'benef') t = '🎁 Beneficios de ' + mes + ':\n' + benefitLines(s.benefits || {}).map((x) => '• ' + x).join('\n');
  else if (key === 'paid') t = `💸 En ${mes} pagamos ${money(s.paid && s.paid.sum)} en premios${s.paid && s.paid.count ? ` (${s.paid.count.toLocaleString('es-AR')} retiros)` : ''} y regalamos ${money(s.gifted && s.gifted.sum)} en bonos. Todo automático, directo a tu CBU.`;
  else if (key === 'top') t = s.top && s.top.amount > 0 ? `🏆 El premio más grande de ${mes}: ${money(s.top.amount)}, cobrado por ${maskUser(s.top.username)}. ¡El próximo puede ser el tuyo!` : `🏆 Todavía no hay un premio grande en ${mes}. ¡Puede ser el tuyo!`;
  else if (key === 'sorteo') t = s.sorteo ? `🎟️ ${s.sorteo.title}: ${sorteoLine(s.sorteo)}. Para anotarte: ${(s.sorteo.requirements || []).join(', ')}. Todo desde la app.` : '🎟️ Pronto un sorteo nuevo. Atento al canal.';
  else t = '⭐ Servicio completo: cargás y retirás solo las 24 h, reembolsos todos los días, ruleta, misiones, sorteos y soporte en la app.';
  return cut(t, POPUP_MAX);
}

module.exports = { call, sendMedia, editPhoto, storyButtons, storyCaption, storyCardSvg, panelSvg, panelCaption, panelText, panelButtons, popupText, maskUser, esc, cut, POPUP_MAX };
