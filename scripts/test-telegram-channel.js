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
  assert.ok(/&lt;b&gt;gratis&lt;\/b&gt;/.test(c) && /Cargá &amp; ganá/.test(c) && /Bono \+50%/.test(c) && c.length <= 1024);
  assert.ok(!/Bono/.test(tg.storyCaption(Object.assign({}, st, { bonusUntil: new Date(Date.now() - 1000) }))), 'bono vencido no se anuncia');
  const k = tg.storyButtons(st, 'https://picaroja.com').inline_keyboard;
  assert.strictEqual(k[0][0].url, 'https://picaroja.com'); assert.strictEqual(k[1][0].url, 'https://youtube.com/x');
  assert.strictEqual(tg.storyButtons({ linkUrl: '#refund' }, 'https://picaroja.com').inline_keyboard.length, 1, 'link interno ⇒ sólo el de la app');
});
caso('Server: qué se publica (sin personales ni códigos sorpresa, sólo desde que se prendió), reserva atómica, token cifrado y sólo admin', () => {
  const S2 = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/audienceUserId: null, codeDropId: null, tgPostedAt: null/.test(S2));
  assert.ok(/publishedAt: \{ \$gte: new Date\(c\.since \|\| now\)/.test(S2));
  assert.ok(/Story\.findOneAndUpdate\(\{ id: st\.id, tgPostedAt: null \}/.test(S2), 'una sola instancia publica cada historia');
  assert.ok(/tokenEnc: _credEncrypt\(token\)/.test(S2) && /\/\^\\\/api\\\/admin\\\/telegram\(\\\/\|\$\)\/i/.test(S2));
  assert.ok(/crypto\.timingSafeEqual\(Buffer\.from\(got\), Buffer\.from\(c\.webhookSecret\)\)/.test(S2), 'webhook con secreto');
  assert.ok(/_cronClaim\('tgpanel'/.test(S2) && /_cronClaim\('tgmirror'/.test(S2), 'crons con lock (multi-instancia)');
});
console.log(`\n${ok}/${ok + fail} casos OK`);
process.exit(fail ? 1 : 0);
