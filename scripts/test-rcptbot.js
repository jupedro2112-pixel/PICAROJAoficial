// #1079 Bot de comprobantes: lectura del monto escrito, centavos y elección del grupo por centavos (se extrae de server.js).
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const grab = (re) => { const m = S.match(re); assert.ok(m, 'falta ' + re); return m[0]; };
const src = grab(/function _rbParseAmount\(txt, max = 100000000\) \{[\s\S]*?\n\}\n/) + grab(/function _rbCents\(amount\) \{.*\n/) + grab(/function _rbPickTo\(route, amount\) \{[\s\S]*?\n\}\n/);
const f = new Function(src + '; return { _rbParseAmount, _rbCents, _rbPickTo };')();
let ok = 0, fail = 0; const caso = (n, fn) => { try { fn(); ok++; console.log('✅ ' + n); } catch (e) { fail++; console.log('❌ ' + n + '\n   ' + e.message); } };
caso('montos escritos', () => {
  const P = f._rbParseAmount;
  assert.strictEqual(P('25000,99'), 25000.99); assert.strictEqual(P('$25.000,99'), 25000.99); assert.strictEqual(P('25.000'), 25000);
  assert.strictEqual(P('25000.43'), 25000.43); assert.strictEqual(P('1.250.000'), 1250000); assert.strictEqual(P('hola'), null);
  assert.strictEqual(P('carga 15000,05 de juan'), 15000.05);
});
caso('centavos', () => { assert.strictEqual(f._rbCents(25000.99), '99'); assert.strictEqual(f._rbCents(1000), '00'); assert.strictEqual(f._rbCents(300.05), '05'); assert.strictEqual(f._rbCents(0.1 + 0.2), '30'); });
caso('grupo por centavos', () => {
  const r = { from: '-1', rules: [{ cents: '99', to: '-2' }, { cents: '43', to: '-3' }], otherTo: null };
  assert.strictEqual(f._rbPickTo(r, 25000.99), '-2'); assert.strictEqual(f._rbPickTo(r, 100.43), '-3'); assert.strictEqual(f._rbPickTo(r, 100.5), null); assert.strictEqual(f._rbPickTo(r, null), null);
  assert.strictEqual(f._rbPickTo(Object.assign({}, r, { otherTo: '-4' }), 100), '-4');
});
caso('cierre 13 h lunes a viernes, /cotizado y /enviado en el destino, pendiente anterior en cada suma', () => {
  assert.ok(/if \(dow === 0 \|\| dow === 6 \|\| _tgArtHour\(now\) < 13\) return;/.test(S) && /'value\.lastAutoClose': \{ \$ne: dk \}/.test(S));
  assert.ok(/\(cotizado\|enviado\)/.test(S) && /async function _rbPendTxt/.test(S) && /\$\{_rbSumTxt\(s\)\}\$\{pend\}/.test(S));
  assert.ok(/req\.originalUrl\.startsWith\('\/api\/rcptbot\/webhook\/'\)/.test(S), 'el webhook no pasa el limitador');
});
caso('#1079-b/c varios bots, estructuras y clave propia', () => {
  assert.ok(/app\.post\('\/api\/rcptbot\/webhook\/:bot'/.test(S) && /async function _rbPinGate\(req, res, next\)/.test(S) && /getConfig\('rcptBotPinHash'/.test(S));
  const rr = S.match(/app\.(get|post)\('\/api\/admin\/rcptbot(\/[a-z-]+)?',[^\n]*/g) || []; assert.ok(rr.length >= 10, 'rutas: ' + rr.length);
  for (const x of rr) assert.ok(/authMiddleware, adminMiddleware, _rbPinGate, async/.test(x), 'ruta sin clave: ' + x.slice(0, 80));
  assert.ok(/v\.routes = v\.structs\.filter\(\(st\) => st && st\.on && st\.botId\)/.test(S), 'sólo las estructuras encendidas reenvían');
  assert.ok(/PENDIENTE A ENVIAR/.test(S) && /Suma nueva: <b>\$0<\/b>/.test(S));
  assert.ok(!/2222/.test(S.slice(S.indexOf('#1079 BOT DE COMPROBANTES'), S.indexOf("app.post('/api/telegram/webhook'"))), 'nunca una clave en el código');
});
console.log(`\n${ok}/${ok + fail} casos OK`); if (fail) process.exit(1);
