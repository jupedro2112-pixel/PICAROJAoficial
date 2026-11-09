'use strict';
/**
 * #1046 GRUPO PRIVADO DE REPORTES (owner 2026-11-09): "un grupo privado para ver cómo va todo en PICA ROJA, con botones: reporte semanal,
 * venta diaria, venta mensual, retención… algo completo para ir analizando".
 * Funciones PURAS (sin base ni red): reciben los números ya calculados por server.js (snapshot `Config['tgAdminSnap']`, armado por cron) y
 * devuelven el texto (HTML de Telegram) y los botones. El grupo se VINCULA con un código de un solo uso que genera el admin en el panel;
 * cualquier otro chat que toque estos botones no recibe nada. Test: node scripts/test-telegram-admin.js
 */
const money = (n) => (Number(n) < 0 ? '−$' : '$') + Math.round(Math.abs(Number(n) || 0)).toLocaleString('es-AR');
const num = (n) => Math.round(Number(n) || 0).toLocaleString('es-AR');
const pc = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : Math.round(Number(v) * 100) + '%');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LINE = '━━━━━━━━━━━━━━';
const MAX = 4000;
const cut = (s) => (s.length > MAX ? s.slice(0, MAX - 1) + '…' : s);
function chg(cur, prev) {
  if (!(Number(prev) > 0)) return '';
  const v = (Number(cur) - Number(prev)) / Number(prev);
  return v >= 0 ? ` <i>(▲ ${Math.round(v * 100)}%)</i>` : ` <i>(▼ ${Math.round(-v * 100)}%)</i>`;
}

const MENU_LBL = { full: '🏠 Completo', basic: '🧩 Básico', easy: '👆 Fácil', girox: '🎰 Girox directo', soporte: '💬 Soporte' };
const MENU = [
  ['today', '📊 Hoy'], ['yesterday', '📆 Ayer'],
  ['week', '🗓️ Últimos 7 días'], ['month', '📅 Mes'],
  ['retention', '🔁 Retención'], ['funnel', '🪜 Embudo'],
  ['gifts', '🎁 Regalos'], ['campaigns', '📣 Campañas'],
  ['alerts', '🚨 Alertas'], ['weekly', '📋 Análisis semanal'],
  ['payouts', '🛡️ Retiros frenados'], ['sorteo', '🎟️ Sorteo'],
  ['ai', '🤖 IA de soporte'], ['menus', '📱 Uso de la app'],
  ['spend', '💸 Pauta y ganancia'], ['info', 'ℹ️ Info: qué es cada cosa']
];
const KEYS = MENU.map(([k]) => k);
function menuMarkup() {
  const rows = []; for (let i = 0; i < MENU.length; i += 2) rows.push(MENU.slice(i, i + 2).map(([k, t]) => ({ text: t, callback_data: 'ad:' + k })));
  return { inline_keyboard: rows };
}
function backMarkup(key) {
  return { inline_keyboard: [[{ text: '🔄 Actualizar', callback_data: 'ad:' + key }, { text: '⬅️ Menú', callback_data: 'ad:menu' }]] };
}
function header(title, at) {
  const t = at ? new Date(at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }) : '';
  return `🔴 <b>PICA ROJA · ${esc(title)}</b>${t ? `\n<i>Datos de las ${t}</i>` : ''}\n${LINE}`;
}
// Bloque de plata de un período ({ deposits, depositCount, depositors, withdrawals, withdrawalCount, gifts, result, giftRatio, ticket, registered }).
function moneyBlock(m, prev, label) {
  if (!m) return '<i>Sin datos todavía (se calculan cada 15 minutos).</i>';
  const p = prev || {};
  const L = [];
  if (label) L.push(`<i>${esc(label)}</i>`);
  L.push(`💰 Cargas: <b>${money(m.deposits)}</b>${chg(m.deposits, p.deposits)}`);
  L.push(`   ${num(m.depositCount)} cargas · ${num(m.depositors)} clientes · ticket ${money(m.ticket)}`);
  L.push(`💸 Retiros pagados: <b>${money(m.withdrawals)}</b> (${num(m.withdrawalCount)})`);
  L.push(`📈 Resultado (cargas − retiros): <b>${money(m.result)}</b>${chg(m.result, p.result)}`);
  L.push(`🎁 Regalado: ${money(m.gifts)} · ${pc(m.giftRatio)} de lo cargado`);
  L.push(`🆕 Registros nuevos: ${num(m.registered)}${chg(m.registered, p.registered)}`);
  return L.join('\n');
}
// #1056 (owner: "gasto aprox. 1.000-1.500 USD por día; que pregunte cuánto gastaste ayer y de ahí un análisis de cómo venís"). sp = { usd, ars, rate, days, daysWith }.
const usd = (n) => (Number(n) < 0 ? '−US$' : 'US$') + Math.round(Math.abs(Number(n) || 0)).toLocaleString('es-AR');
function spendBlock(m, sp, label) {
  if (!m) return '<i>Sin datos todavía.</i>';
  const L = []; if (label) L.push(`<b>${esc(label)}</b>`);
  if (!sp || !(sp.ars > 0)) { L.push('💸 Pauta: <i>sin cargar</i> (respondé la pregunta de las 10 h o escribí /gasto 1200)'); }
  else {
    L.push(`💸 Pauta: <b>${usd(sp.usd)}</b> (${money(sp.ars)})` + (sp.days > 1 ? ` · ${usd(sp.usd / sp.days)}/día` : '') + (sp.days > 1 && sp.daysWith < sp.days ? ` <i>(cargado ${sp.daysWith} de ${sp.days} días)</i>` : ''));
  }
  L.push(`🆕 Registros: ${num(m.registered)} · 1ª carga: ${num(m.firstDeposits)}` + (m.registered ? ` (${pc(m.firstDeposits / m.registered)})` : ''));
  if (sp && sp.ars > 0) {
    if (m.registered) L.push(`🎯 Costo por registro: ${usd(sp.usd / m.registered)}`);
    L.push(`🎯 Costo por cliente que cargó: <b>${m.firstDeposits ? usd(sp.usd / m.firstDeposits) : '—'}</b>`);
  }
  L.push(`💰 Cargas: ${money(m.deposits)} · retiros: ${money(m.withdrawals)}`);
  L.push(`📈 Resultado (cargas − retiros): <b>${money(m.result)}</b>`);
  if (sp && sp.ars > 0) {
    const net = (Number(m.result) || 0) - sp.ars;
    L.push(`🧮 Resultado − pauta: <b>${money(net)}</b>` + (sp.rate ? ` (${usd(net / sp.rate)})` : ''));
    L.push(`↩️ Por cada US$1 de pauta volvieron ${sp.rate ? 'US$' + ((Number(m.result) || 0) / sp.rate / Math.max(1e-9, sp.usd)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} de resultado`);
    L.push(net >= 0 ? '🟢 La pauta se está pagando sola.' : '🔴 Todavía no recupera lo gastado en pauta.');
  }
  return L.join('\n');
}
function spendVerdict(s) {
  const sp = s.spend || {}; const w = s.week || {}, wp = s.weekPrev || {}; const L = [];
  const cpa = (m, x) => (x && x.usd > 0 && m && m.firstDeposits ? x.usd / m.firstDeposits : null);
  const c1 = cpa(w, sp.week), c0 = cpa(wp, sp.weekPrev);
  if (c1 != null && c0 != null) L.push(c1 <= c0 ? `🟢 El costo por cliente nuevo bajó: ${usd(c1)} (antes ${usd(c0)}).` : `🟠 El costo por cliente nuevo subió: ${usd(c1)} (antes ${usd(c0)}).`);
  if (w.registered && w.firstDeposits != null) { const conv = w.firstDeposits / w.registered; L.push(conv < 0.25 ? `🟠 Sólo ${pc(conv)} de los registros carga: el problema está después del registro (bienvenida, soporte, carga).` : `🟢 ${pc(conv)} de los registros carga.`); }
  if (sp.week && sp.week.ars > 0) { const net = (Number(w.result) || 0) - sp.week.ars; L.push(net >= 0 ? '🟢 La semana deja ganancia después de la pauta.' : '🔴 La semana todavía no cubre la pauta: mirá regalos y conversión.'); }
  return L.length ? L.join('\n') : '<i>Cargá el gasto de algunos días para ver cómo venís.</i>';
}
function spendReport(s, dayLabel, dayTitle) {
  s = s || {}; const sp = s.spend || {};
  return cut([header('PAUTA Y GANANCIA', s.at), spendBlock(s.yesterday, sp.yesterday, (dayTitle || 'AYER') + (dayLabel ? ' (' + dayLabel + ')' : '')), LINE,
    spendBlock(s.week, sp.week, 'ÚLTIMOS 7 DÍAS'), LINE, spendBlock(s.month, sp.month, 'MES EN CURSO'), LINE, '🧭 <b>CÓMO VENÍS</b>', spendVerdict(s)].join('\n'));
}
function askSpendText(dayLabel) {
  return `💸 <b>¿Cuánto gastaste en publicidad el ${esc(dayLabel)}?</b>\nRespondé a ESTE mensaje con el número en dólares (ej: <code>1200</code>).\n<i>También podés escribir /gasto 1200 cuando quieras (o /gasto 1200 08/11 para otro día).</i>`;
}
function render(key, snap) {
  const s = snap || {}; const at = s.at;
  if (key === 'menu') return { text: `${header('PANEL DE CONTROL', at)}\nElegí qué querés ver 👇\n<i>Los números se recalculan cada 15 min (retención, embudo, regalos y campañas cada hora).</i>`, markup: menuMarkup() };
  let text;
  if (key === 'spend') text = spendReport(s).replace(/^.*\n.*\n━+\n/, header('PAUTA Y GANANCIA', at) + '\n');
  else if (key === 'info') text = [header('CÓMO USAR ESTE GRUPO', at), // #1055 (owner): botonera, info y reportes del negocio en el grupo privado
    '📊 <b>Hoy / 📆 Ayer / 🗓️ 7 días / 📅 Mes</b>: depósitos, retiros, regalos, resultado (plata que queda), clientes que cargaron y registros, comparado con el período anterior.',
    '🔁 <b>Retención</b>: cuántos de los que cargaron vuelven a cargar.', '🪜 <b>Embudo</b>: registro → 1ª carga → 2ª carga, y dónde se pierde más gente.',
    '🎁 <b>Regalos</b>: cuánto cuesta cada regalo y si conviene.', '📣 <b>Campañas</b>: clientes y plata que trae cada publicista.',
    '🚨 <b>Alertas</b>: lo que hay que mirar ya.', '📋 <b>Análisis semanal</b>: el resumen de la semana con lo que conviene cambiar.',
    '🛡️ <b>Retiros frenados</b>: los que esperan revisión.', '💸 <b>Pauta y ganancia</b>: lo gastado en publicidad contra lo que entró (costo por cliente, resultado − pauta). Todos los días a las 10 h te pregunto cuánto gastaste ayer.', '🎟️ <b>Sorteo</b> · 🤖 <b>IA de soporte</b> · 📱 <b>Uso de la app</b>.', LINE,
    '📬 <b>REPORTES AUTOMÁTICOS</b>', '▸ Todos los días a las 9 h: cómo cerró ayer', '▸ Los lunes: la semana completa', '▸ El día 1: el mes completo', LINE,
    '<i>Escribí /menu para volver a ver la botonera. Este grupo es PRIVADO: no agregues a nadie que no deba ver los números.</i>'].join('\n');
  else if (key === 'today') text = `${header('HOY', at)}\n${moneyBlock(s.today, s.todayPrev, 'Comparado con ayer a la misma hora')}`;
  else if (key === 'yesterday') text = `${header('AYER', at)}\n${moneyBlock(s.yesterday, s.yesterdayPrev, 'Comparado con el día anterior')}` + (s.close ? `\n${LINE}\n🧾 Cierre del día: resultado ${money(s.close.resultado)}${s.close.check ? ' · ' + esc(s.close.check) : ''}` : '');
  else if (key === 'week') text = `${header('ÚLTIMOS 7 DÍAS', at)}\n${moneyBlock(s.week, s.weekPrev, 'Comparado con los 7 días anteriores')}`;
  else if (key === 'month') {
    text = `${header('MES EN CURSO', at)}\n${moneyBlock(s.month, s.monthPrev, 'Comparado con el mes pasado a la misma altura')}`;
    if (s.month && s.monthDays && s.monthLen) text += `\n${LINE}\n🔮 Proyección del mes (a este ritmo): cargas ${money(s.month.deposits / s.monthDays * s.monthLen)} · resultado ${money(s.month.result / s.monthDays * s.monthLen)}`;
  } else if (key === 'retention') {
    const r = (s.board && s.board.retention) || [];
    if (!r.length) text = `${header('RETENCIÓN', s.boardAt)}\n<i>Sin datos todavía.</i>`;
    else {
      const L = ['De los que cargaron en una semana, cuántos volvieron a cargar la siguiente:', ''];
      for (const x of r) L.push(`${x.k === 0 ? '▶️ Esta semana' : 'Hace ' + x.k + ' sem.'}: <b>${pc(x.rate)}</b> (${num(x.returned)} de ${num(x.prevDepositors)}) · ${num(x.depositors)} cargaron`);
      text = `${header('RETENCIÓN', s.boardAt)}\n${L.join('\n')}`;
    }
  } else if (key === 'funnel') {
    const f = s.board && s.board.funnel;
    if (!f || !f.steps) text = `${header('EMBUDO', s.boardAt)}\n<i>Sin datos todavía.</i>`;
    else {
      const L = ['<i>Registrados en el período (mes)</i>'];
      for (const st of f.steps) L.push(`${esc(st.label)}: <b>${num(st.n)}</b>${st.ofPrev != null ? ` (${pc(st.ofPrev)} del paso anterior)` : ''}`);
      if (f.worst) L.push(LINE, `⚠️ Donde más gente se pierde: <b>${esc(f.worst.label)}</b> (se quedan ${num(f.worst.lost)} personas)`);
      text = `${header('EMBUDO', s.boardAt)}\n${L.join('\n')}`;
    }
  } else if (key === 'gifts') {
    const g = (s.month && s.month.giftsByType) || [];
    const L = [`Regalado en el mes: <b>${money(s.month && s.month.gifts)}</b> (${pc(s.month && s.month.giftRatio)} de lo cargado; sano ≤ 20%)`, ''];
    for (const x of g.slice(0, 12)) L.push(`• ${esc(x.label)}: ${money(x.total)} · ${num(x.users)} clientes`);
    const lift = (s.board && s.board.gifts) || [];
    const bad = lift.filter((x) => x.verdict === 'bad').slice(0, 3);
    if (bad.length) { L.push('', '🔴 <b>No rinden</b> (cargaron menos de lo que costó):'); for (const x of bad) L.push(`• ${esc(x.label)}: costó ${money(x.cost)}`); }
    text = `${header('REGALOS', at)}\n${L.join('\n')}`;
  } else if (key === 'campaigns') {
    const c = (s.board && s.board.campaigns) || [];
    const L = ['<i>Registrados en los últimos 90 días, por publicidad</i>', ''];
    if (!c.length) L.push('<i>Sin datos.</i>');
    for (const x of c.slice(0, 10)) L.push(`${x.verdict === 'good' ? '🟢' : x.verdict === 'ok' ? '🟡' : x.verdict === 'bad' ? '🔴' : '⚪'} <b>${esc(x.campaign)}</b>${x.publisher ? ' (' + esc(x.publisher) + ')' : ''}: ${num(x.users)} reg. · ${num(x.depositors)} cargaron (${pc(x.conv)}) · dejaron ${money(x.net)}${x.spend > 0 ? ' · pauta ' + money(x.spend) : ''}`);
    text = `${header('CAMPAÑAS', s.boardAt)}\n${L.join('\n')}`;
  } else if (key === 'alerts') {
    const b = s.board || {}; const a = b.alerts || [];
    const L = [b.headline ? esc(b.headline) : '<i>Sin datos todavía.</i>'];
    if (a.length) { L.push(''); a.slice(0, 8).forEach((x, i) => L.push(`${i + 1}. ${x.level === 'bad' ? '🔴' : '🟡'} ${esc(x.text)}${x.fix ? '\n   👉 ' + esc(x.fix) : ''}`)); }
    else if (b.headline) L.push('', '✅ Nada urgente para corregir.');
    text = `${header('ALERTAS DEL MES', s.boardAt)}\n${L.join('\n')}`;
  } else if (key === 'weekly') {
    text = s.weeklyText ? `${header('ANÁLISIS SEMANAL', s.weeklyAt)}\n${esc(s.weeklyText)}` : `${header('ANÁLISIS SEMANAL', null)}\n<i>Todavía no hay análisis: sale solo los lunes (o tocá 🔄 para armarlo ahora).</i>`;
  } else if (key === 'payouts') {
    const p = s.payouts || {};
    const L = [`🕒 Esperando revisión: <b>${num(p.reviewN)}</b> · ${money(p.reviewSum)}`, `⏳ Pagándose hace +10 min: <b>${num(p.payingN)}</b> · ${money(p.payingSum)}`, `❌ Fallidos (últimas 24 h): <b>${num(p.failedN)}</b>`];
    if ((p.oldest || []).length) { L.push('', '<b>Los más viejos esperando:</b>'); for (const o of p.oldest) L.push(`• ${esc(o.username)} · ${money(o.amount)} · hace ${esc(o.ago)}${o.reason ? ' · ' + esc(o.reason) : ''}`); }
    L.push('', '<i>Se resuelven en el panel → Pagos a confirmar / Antifraude.</i>');
    text = `${header('RETIROS FRENADOS', at)}\n${L.join('\n')}`;
  } else if (key === 'sorteo') {
    const so = s.sorteo;
    if (!so) text = `${header('SORTEO', at)}\n<i>No hay un sorteo en curso.</i>`;
    else {
      const L = [`<b>${esc(so.title)}</b>`];
      if ((so.prizes || []).length) L.push(so.prizes.map((p) => `${p.pos}° ${esc(p.name)}${p.value ? ' ' + esc(p.value) : ''}`).join(' · '));
      L.push('', '<b>Ranking (anotados):</b>');
      const r = so.ranking || []; if (!r.length) L.push('<i>Todavía sin puntos.</i>');
      r.forEach((x, i) => L.push(`${i + 1}. ${esc(x.username)} · ${num(x.points)} pts`));
      text = `${header('SORTEO', at)}\n${L.join('\n')}`;
    }
  } else if (key === 'ai') {
    const d = s.ai || [];
    const L = d.length ? d.map((x) => `${esc(x.day)}: ${num(x.replies)} respuestas · ${num(x.aiCalls)} con IA · ${num(x.handoffs)} a un agente · US$ ${(Number(x.usd) || 0).toFixed(2)}`) : ['<i>Sin datos.</i>'];
    text = `${header('IA DE SOPORTE (7 días)', at)}\n${L.join('\n')}`;
  } else if (key === 'menus') {
    const m = s.menus; const by = m && m.byMenu ? Object.entries(m.byMenu) : [];
    if (!by.length) text = `${header('USO DE LA APP', at)}\n<i>Sin datos todavía.</i>`;
    else {
      const L = ['<i>Últimos 30 días, por menú que usa cada cliente</i>', ''];
      for (const [k, x] of by.sort((a, b) => (b[1].users || 0) - (a[1].users || 0)).slice(0, 8)) L.push(`• <b>${esc(MENU_LBL[k] || k)}</b>: ${num(x.users)} clientes · volvieron en 7 días ${pc(x.users ? x.back7 / x.users : null)} · cargaron ${pc(x.users ? x.depositors / x.users : null)} · repiten ${pc(x.depositors ? x.repeat / x.depositors : null)}`);
      const w = (m.weeks || [])[0]; if (w) L.push('', `Esta semana: ${num(w.regs)} registros · ${num(w.firstDep)} 1ª carga · ${num(w.depositors)} cargaron · chat nuevo ${w.chatNewPct == null ? '—' : w.chatNewPct + '%'}`);
      text = `${header('USO DE LA APP', m.at || at)}\n${L.join('\n')}`;
    }
  } else return null;
  return { text: cut(text), markup: backMarkup(key) };
}
// Reportes automáticos: el del día (ayer + mes), el semanal (lunes) y el del mes (día 1).
function dailyReport(s) {
  return cut(`${header('RESUMEN DE AYER', s && s.at)}\n${moneyBlock(s && s.yesterday, s && s.yesterdayPrev, 'Ayer, comparado con el día anterior')}\n${LINE}\n<b>📅 Mes en curso</b>\n${moneyBlock(s && s.month, s && s.monthPrev)}`);
}
function monthlyReport(s) {
  return cut(`${header('CIERRE DEL MES ANTERIOR', s && s.at)}\n${moneyBlock(s && s.lastMonth, s && s.lastMonthPrev, 'Comparado con el mes anterior a ese')}`);
}
function newPairCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = require('crypto').randomBytes(8); let s = '';
  for (let i = 0; i < 8; i++) s += A[b[i] % A.length];
  return s;
}
module.exports = { spendBlock, spendReport, askSpendText, MENU, KEYS, menuMarkup, backMarkup, render, dailyReport, monthlyReport, moneyBlock, newPairCode, money, pc };
