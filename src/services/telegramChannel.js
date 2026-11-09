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
  const L = [];
  if (story.title) L.push('<b>' + esc(story.title) + '</b>');
  if (story.text) L.push(esc(story.text));
  if (Number(story.bonusPct) > 0 && story.bonusUntil && new Date(story.bonusUntil) > now) {
    const h = new Date(story.bonusUntil).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
    L.push('🎁 <b>Bono +' + Math.round(story.bonusPct) + '%</b> en tu próxima carga hasta las ' + h + ' h: reclamalo en la historia de la app.');
  }
  L.push('👇 Entrá desde el botón de abajo.');
  return cut(L.join('\n\n'), CAPTION_MAX);
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

module.exports = { call, sendMedia, storyButtons, storyCaption, panelText, panelButtons, popupText, maskUser, esc, cut, POPUP_MAX };
