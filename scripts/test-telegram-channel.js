// #1044 CANAL DE TELEGRAM: textos, botones y reglas de qué se publica. Correr: node scripts/test-telegram-channel.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const orig = Module._load;
Module._load = function (req, ...a) { if (req === 'axios' || req === 'form-data') return function () {}; return orig.call(this, req, ...a); };
const tg = require('../src/services/telegramChannel');
let ok = 0, fail = 0;
function caso(n, fn) { try { fn(); ok++; console.log('✅ ' + n); } catch (e) { fail++; console.log('❌ ' + n + '\n   ' + e.message); } }

const S = { monthIdx: 10, year: 2026, updatedAt: new Date('2026-11-09T21:00:00Z'), benefits: { firstPct: 100, firstCap: 15000, dailyRefundPct: 10, installFixed: 5000 },
  paid: { sum: 12345678, count: 812 }, gifted: { sum: 2345000, count: 400 }, top: { amount: 850000, username: 'juanperez22' },
  sorteo: { title: 'Sorteo mensual (cierra el 30/11)', prizes: [{ pos: 1, name: 'iPhone 18 Pro Max', value: '' }, { pos: 2, name: 'Orden de compra', value: '$1.000.000' }, { pos: 3, name: '$500.000 para jugar', value: '' }], requirements: ['app instalada', 'notificaciones', 'unirte a Telegram', 'celular cargado', 'una carga', 'cuenta con 7 días'] } };

caso('Nunca el usuario completo en el canal', () => {
  assert.strictEqual(tg.maskUser('juanperez22'), 'ju***22'); assert.strictEqual(tg.maskUser('ana'), 'a***');
  assert.ok(!/juanperez22/.test(tg.panelText(S))); for (const k of ['top', 'paid']) assert.ok(!/juanperez22/.test(tg.popupText(k, S)));
});
caso('Server: qué se publica (sin personales ni códigos sorpresa, sólo desde que se prendió), reserva atómica, token cifrado y sólo admin', () => {
  const S2 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/audienceUserId: null, codeDropId: null, autoKey: \{ \$not: \/\^cd\/ \}, tgPostedAt: null/.test(S2));
  assert.ok(/publishedAt: \{ \$gte: new Date\(c\.since \|\| now\)/.test(S2));
  assert.ok(/Story\.findOneAndUpdate\(\{ id: st\.id, tgPostedAt: null \}/.test(S2), 'una sola instancia publica cada historia');
  assert.ok(/tokenEnc: _credEncrypt\(token\)/.test(S2) && /\/\^\\\/api\\\/admin\\\/telegram\(\\\/\|\$\)\/i/.test(S2));
  assert.ok(/if \(!sec \|\| got\.length !== sec\.length \|\| !crypto\.timingSafeEqual\(Buffer\.from\(got\), Buffer\.from\(sec\)\)\) return res\.status\(401\)\.end\(\);\n    const c = await _tgCfg\(\);/.test(S2), 'webhook con secreto ANTES de leer la config');
  assert.ok(/_cronClaim\('tgpanel'/.test(S2) && /_cronClaim\('tgmirror'/.test(S2), 'crons con lock (multi-instancia)');
});
caso('#1044-d Sorteo en el canal: premios + pasos según los requisitos activos', () => {
  const so = Object.assign({}, S.sorteo, { req: { app: true, notif: true, telegram: true, phone: true, deposit: true, week: false } });
  const c = tg.sorteoCaption(so); assert.ok(/iPhone/.test(c) && /Activá las notificaciones/.test(c) && /Anotarme/.test(c) && !/7 días/.test(c) && c.length <= 1024);
  assert.strictEqual(tg.sorteoSteps(null).length, 7, 'sin requisitos guardados ⇒ todos los pasos');
  assert.ok(/ANOTATE GRATIS/.test(tg.sorteoSvg(so, null)));
});
caso('#1055 Canal INFORMATIVO: sin links, sin montos de premios ni regalado, panel de texto con servicio / beneficios / sorteo', () => {
  const t = tg.panelText(S);
  assert.ok(/CANAL OFICIAL/.test(t) && /TU SERVICIO/.test(t) && /BENEFICIOS/.test(t) && /iPhone/.test(t) && /Entrá desde tu app/.test(t) && t.length < 4096);
  assert.ok(!/12\.345\.678|2\.345\.000|850\.000|Regalado|Premios pagados|Premio más grande/.test(t), 'sin montos de premios');
  const all = JSON.stringify([tg.panelButtons('https://picaroja.com'), tg.storyButtons({}, 'https://picaroja.com')]);
  assert.ok(!/"url"/.test(all), 'ningún botón con link');
  const b = tg.panelButtons('https://picaroja.com').inline_keyboard.flat().map((x) => x.callback_data);
  assert.deepStrictEqual(b, ['tg:benef', 'tg:sorteo', 'tg:serv'], 'premios pagados / más grande, apagados');
  for (const k of ['benef', 'paid', 'top', 'sorteo', 'serv']) { const p = tg.popupText(k, S); assert.ok(p.length <= 200 && p.length > 20, k); assert.ok(!/12\.345\.678|850\.000/.test(p), k); }
});
caso('#1055 Historias y bono: formato del sorteo, HTML escapado, cómo usar el bono, sin link', () => {
  const st = { title: 'Hoy <b>gratis</b>', text: 'Cargá & ganá', bonusPct: 50, bonusUntil: new Date(Date.now() + 3600000) };
  const c = tg.storyCaption(st);
  assert.ok(/&lt;B&gt;GRATIS&lt;\/B&gt;/.test(c) && /Cargá &amp; ganá/.test(c) && /BONO \+50%/.test(c) && /CÓMO USARLO/.test(c) && /Entrá desde tu app/.test(c) && c.length <= 1024);
  assert.ok(!/p\. m\./.test(c), 'hora en 24 h');
  assert.ok(!/BONO/.test(tg.storyCaption(Object.assign({}, st, { bonusUntil: new Date(Date.now() - 1000) }))), 'bono vencido no se anuncia');
});
caso('#1055 Código de Telegram: se canjea en Perfil → Canjear código; agotado SIN lista de ganadores', () => {
  const o = { code: 'ROJAK7M2Q', amount: 5000, maxClaims: 10, rolloverX: 5 };
  const c = tg.dropCaption(o); assert.ok(/ROJAK7M2Q/.test(c) && /Canjear código/.test(c) && /ya cargaron/.test(c) && c.length <= 1024);
  const d = tg.dropDoneCaption({ code: 'ROJAK7M2Q', amount: 5000, full: true, winners: ['juanperez22', 'ana'] });
  assert.ok(/SE AGOTÓ/.test(d) && !/ju\*\*\*22|juanperez22/.test(d));
});
caso('#1055 Server: qué historias van (las del admin + partidos / bono / servicio), sin links, canje desde el Perfil', () => {
  const S2 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/const TG_CHANNEL_AUTO_KINDS = \['deporte', 'bono', 'servicio'\]/.test(S2) && /\{ autoKey: \/\^sa-\/, autoKind: \{ \$in: TG_CHANNEL_AUTO_KINDS \} \}/.test(S2));
  assert.ok(/const TG_ALWAYS_KINDS = \['deporte', 'bono'\]/.test(S2) && /autoKey: \{ \$not: \/\^cd\/ \}/.test(S2));
  assert.ok(!/\/\?codigo=' \+ encodeURIComponent\(code\)/.test(S2) && !/url: c\.appUrl \+ '\/\?ir=sorteo'/.test(S2), 'sin links en el canal');
  assert.ok(/if \(cdc && await CodeDrop\.exists\(\{ code: cdc \}\)\) \{ req\.body\.code = cdc; return _codeDropClaimHandler\(req, res\); \}/.test(S2));
  assert.ok(/_cronClaim\('tgdrop'/.test(S2) && /_cronClaim\('tgsorteo'/.test(S2));
});
caso('#1055 Bot por privado: 6 botones, sin links, ranking con usuarios tapados', () => {
  const kb = tg.menuKeyboard(); assert.ok(kb.is_persistent && kb.keyboard.flat().length === 6);
  const S3 = Object.assign({}, S, { sorteo: Object.assign({}, S.sorteo, { ranking: [{ username: 'juanperez22', points: 1234 }] }) });
  for (const [k] of tg.MENU) { const m = tg.menuReply(k, S3, { drop: { code: 'ROJAX', amount: 5000, maxClaims: 10, left: 3 } }); assert.ok(m.text && m.text.length < 4096 && !m.button, k); }
  const r = tg.menuReply('rank', S3, {}).text; assert.ok(/ju\*\*\*22/.test(r) && !/juanperez22/.test(r));
  assert.ok(/Canjear código/.test(tg.menuReply('code', S, { drop: { code: 'ROJAX', amount: 5000, maxClaims: 10, left: 3 } }).text));
});
console.log(`\n${ok}/${ok + fail} casos OK`);
process.exit(fail ? 1 : 0);
