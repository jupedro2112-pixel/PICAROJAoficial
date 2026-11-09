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
caso('Ventanitas de los botones: siempre ≤ 200 caracteres (límite de Telegram) y con los datos', () => {
  for (const k of ['benef', 'paid', 'top', 'sorteo', 'serv']) { const t = tg.popupText(k, S); assert.ok(t.length <= 200, k + ' ' + t.length); assert.ok(t.length > 20); }
  assert.ok(/\$12\.345\.678/.test(tg.popupText('paid', S)) && /\$2\.345\.000/.test(tg.popupText('paid', S)));
  assert.ok(/\$850\.000/.test(tg.popupText('top', S)) && /iPhone/.test(tg.popupText('sorteo', S)));
  assert.ok(/100%/.test(tg.popupText('benef', S)) && /\$5\.000/.test(tg.popupText('benef', S)));
  assert.ok(tg.popupText('sorteo', {}).length > 10 && tg.popupText('top', {}).length > 10, 'sin datos no rompe');
});
caso('Panel del mes: título del mes, beneficios, premios, regalado, premio más grande, sorteo y botones', () => {
  const t = tg.panelText(S);
  assert.ok(/Noviembre 2026/.test(t) && /Beneficios del mes/.test(t) && /Premios pagados/.test(t) && /Regalado/.test(t) && /Premio más grande/.test(t) && /Sorteo mensual/.test(t));
  assert.ok(t.length < 4096);
  const b = tg.panelButtons('https://picaroja.com').inline_keyboard.flat();
  assert.strictEqual(b[0].url, 'https://picaroja.com');
  assert.deepStrictEqual(b.slice(1).map((x) => x.callback_data), ['tg:benef', 'tg:paid', 'tg:top', 'tg:sorteo', 'tg:serv']);
});
caso('Posteo de una historia: HTML escapado, aviso del bono vigente, botón a la app y link externo aparte', () => {
  const st = { title: 'Hoy <b>gratis</b>', text: 'Cargá & ganá', bonusPct: 50, bonusUntil: new Date(Date.now() + 3600000), linkUrl: 'https://youtube.com/x', linkLabel: 'Ver video' };
  const c = tg.storyCaption(st);
  assert.ok(/&lt;B&gt;GRATIS&lt;\/B&gt;/.test(c) && /Cargá &amp; ganá/.test(c) && /BONO \+50%/.test(c) && c.length <= 1024);
  assert.ok(!/BONO/.test(tg.storyCaption(Object.assign({}, st, { bonusUntil: new Date(Date.now() - 1000) }))), 'bono vencido no se anuncia');
  const k = tg.storyButtons(st, 'https://picaroja.com').inline_keyboard;
  assert.strictEqual(k[0][0].url, 'https://picaroja.com'); assert.strictEqual(k[1][0].url, 'https://youtube.com/x');
  assert.strictEqual(tg.storyButtons({ linkUrl: '#refund' }, 'https://picaroja.com').inline_keyboard.length, 1, 'link interno ⇒ sólo el de la app');
});
caso('Server: qué se publica (sin personales ni códigos sorpresa, sólo desde que se prendió), reserva atómica, token cifrado y sólo admin', () => {
  const S2 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/audienceUserId: null, codeDropId: null, autoKey: \{ \$not: \/\^cd\/ \}, tgPostedAt: null/.test(S2));
  assert.ok(/publishedAt: \{ \$gte: new Date\(c\.since \|\| now\)/.test(S2));
  assert.ok(/Story\.findOneAndUpdate\(\{ id: st\.id, tgPostedAt: null \}/.test(S2), 'una sola instancia publica cada historia');
  assert.ok(/tokenEnc: _credEncrypt\(token\)/.test(S2) && /\/\^\\\/api\\\/admin\\\/telegram\(\\\/\|\$\)\/i/.test(S2));
  assert.ok(/crypto\.timingSafeEqual\(Buffer\.from\(got\), Buffer\.from\(c\.webhookSecret\)\)/.test(S2), 'webhook con secreto');
  assert.ok(/_cronClaim\('tgpanel'/.test(S2) && /_cronClaim\('tgmirror'/.test(S2), 'crons con lock (multi-instancia)');
});
caso('#1044-c Botones editables: textos, apagar info, links https (máx. 3), texto propio de Servicio; logo centrado en las fotos', () => {
  const b = tg.normalizeButtons({ appLabel: 'Jugá ya', storyLabel: '', items: { top: { on: false, label: 'x' }, paid: { label: '💰 Pagos' } }, servText: 'Hola', links: [{ label: 'Soporte', url: 'https://t.me/x' }, { label: 'malo', url: 'http://x' }, { label: 'a', url: 'https://a' }, { label: 'b', url: 'https://b' }, { label: 'c', url: 'https://c' }] });
  assert.strictEqual(b.appLabel, 'Jugá ya'); assert.strictEqual(b.storyLabel, '🎰 Entrar a PICA ROJA', 'vacío ⇒ el de siempre');
  assert.strictEqual(b.links.length, 2, 'sólo https y hasta 3 (de los primeros 3)');
  const k = tg.panelButtons('https://picaroja.com', b).inline_keyboard.flat();
  assert.ok(!k.some((x) => x.callback_data === 'tg:top') && k.some((x) => x.text === '💰 Pagos') && k.some((x) => x.url === 'https://t.me/x'));
  assert.strictEqual(tg.popupText('serv', {}, b), 'Hola');
  assert.strictEqual(tg.storyButtons({}, 'https://picaroja.com', b).inline_keyboard[0][0].text, '🎰 Entrar a PICA ROJA');
  const svg = tg.storyCardSvg({ title: 'Hola', text: 'x' }, 'QUJD'); assert.ok(/data:image\/png;base64,QUJD/.test(svg) && /text-anchor="middle"/.test(svg));
  assert.ok(!/<image/.test(tg.panelSvg({ monthIdx: 0, year: 2027 }, null)), 'sin logo no rompe');
});
caso('#1044-d Código exclusivo de Telegram: imagen con el código, texto con los pasos, aviso de AGOTADO con usuarios tapados', () => {
  const o = { code: 'ROJAK7M2Q', amount: 5000, maxClaims: 10, rolloverX: 5 };
  assert.ok(/ROJAK7M2Q/.test(tg.dropSvg(o, 'QUJD')) && /\$5\.000/.test(tg.dropSvg(o, null)));
  const c = tg.dropCaption(o); assert.ok(/ROJAK7M2Q/.test(c) && /primeros <b>10<\/b>/.test(c) && /ya cargaron/.test(c) && c.length <= 1024);
  const d = tg.dropDoneCaption({ code: 'ROJAK7M2Q', amount: 5000, full: true, winners: ['juanperez22', 'ana'] });
  assert.ok(/SE AGOTÓ/.test(d) && /ju\*\*\*22/.test(d) && !/juanperez22/.test(d));
  assert.ok(/TERMINÓ/.test(tg.dropDoneCaption({ code: 'X', amount: 5000, full: false, winners: [] })));
});
caso('#1044-d Sorteo en el canal: premios + pasos según los requisitos activos', () => {
  const so = Object.assign({}, S.sorteo, { req: { app: true, notif: true, telegram: true, phone: true, deposit: true, week: false } });
  const c = tg.sorteoCaption(so); assert.ok(/iPhone/.test(c) && /Activá las notificaciones/.test(c) && /Anotarme/.test(c) && !/7 días/.test(c) && c.length <= 1024);
  assert.strictEqual(tg.sorteoSteps(null).length, 7, 'sin requisitos guardados ⇒ todos los pasos');
  assert.ok(/ANOTATE GRATIS/.test(tg.sorteoSvg(so, null)));
});
caso('#1044-d Server: 1 automática por día (partidos y bono siempre), código cada N días con lock, agotado avisa en el canal, link ?ir=sorteo', () => {
  const S2 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/const TG_ALWAYS_KINDS = \['deporte', 'bono'\]/.test(S2) && /_tgIsDailyAuto\(st\)/.test(S2));
  assert.ok(/autoKey: \{ \$not: \/\^cd\/ \}/.test(S2), 'los avisos del código de la app no van al canal');
  assert.ok(/_cronClaim\('tgdrop'/.test(S2) && /_cronClaim\('tgsorteo'/.test(S2));
  assert.ok(/if \(d\.createdBy === 'telegram'\) \{ await _tgDropDone\(d, winners, full\)/.test(S2));
  assert.ok(/createdBy: 'telegram' \}\); \}/.test(S2) && /\/\?codigo=/.test(S2));
  const A = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'auth.js'), 'utf8');
  assert.ok(/_sp\.get\('ir'\) === 'sorteo'/.test(A) && /VIP\.sorteos\.open\('mensual'\)/.test(A));
});
console.log(`\n${ok}/${ok + fail} casos OK`);
process.exit(fail ? 1 : 0);
