// #1046 GRUPO PRIVADO DE REPORTES de Telegram: textos, botones y seguridad. Correr: node scripts/test-telegram-admin.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ta = require('../src/services/telegramAdmin');
let ok = 0, fail = 0;
function caso(n, fn) { try { fn(); ok++; console.log('✅ ' + n); } catch (e) { fail++; console.log('❌ ' + n + '\n   ' + e.message); } }

const M = { deposits: 1500000, depositCount: 300, depositors: 180, withdrawals: 900000, withdrawalCount: 60, gifts: 150000, result: 600000, giftRatio: 0.1, ticket: 5000, registered: 40,
  giftsByType: [{ label: 'Reembolsos', total: 80000, users: 50 }] };
const SNAP = { at: new Date('2026-11-09T21:00:00Z'), today: M, todayPrev: Object.assign({}, M, { deposits: 1000000 }), yesterday: M, yesterdayPrev: M, week: M, weekPrev: M, month: M, monthPrev: M, monthDays: 9, monthLen: 30,
  lastMonth: M, lastMonthPrev: M, close: { resultado: 550000, check: '✅ cierre OK' },
  board: { retention: [{ k: 1, rate: 0.4, returned: 40, prevDepositors: 100, depositors: 90 }, { k: 0, rate: 0.5, returned: 45, prevDepositors: 90, depositors: 95 }],
    funnel: { steps: [{ label: 'Se registraron', n: 200 }, { label: 'Hicieron la 1ª carga', n: 80, ofPrev: 0.4 }], worst: { label: 'Volvieron a cargar (2ª)', lost: 50 } },
    gifts: [{ label: 'Ruleta', cost: 90000, verdict: 'bad' }], campaigns: [{ campaign: 'PICAROJAOK', users: 100, depositors: 30, conv: 0.3, net: 400000, spend: 200000, verdict: 'good' }],
    alerts: [{ level: 'bad', text: 'Algo <malo>', fix: 'Arreglalo' }], headline: 'Entraron $600.000 más' }, boardAt: new Date(),
  payouts: { reviewN: 2, reviewSum: 70000, payingN: 0, payingSum: 0, failedN: 1, oldest: [{ username: 'juan', amount: 50000, ago: '2 h', reason: 'retiro grande' }] },
  sorteo: { title: 'Sorteo mensual', prizes: [{ pos: 1, name: 'iPhone' }], ranking: [{ username: 'juanperez22', points: 1234 }] },
  ai: [{ day: '11-09', replies: 40, aiCalls: 30, handoffs: 3, usd: 0.42 }],
  menus: { at: new Date(), byMenu: { girox: { users: 100, back7: 60, depositors: 40, repeat: 20 } }, weeks: [{ regs: 50, firstDep: 20, depositors: 90, chatNewPct: 80 }] },
  weeklyText: 'ANÁLISIS SEMANAL\n• todo bien' };

caso('Menú: 14 botones, todos responden con texto < 4096 y botones Actualizar / Menú', () => {
  const k = ta.menuMarkup().inline_keyboard.flat(); assert.strictEqual(k.length, 14);
  for (const b of k) { assert.ok(/^ad:[a-z]+$/.test(b.callback_data) && b.callback_data.length <= 64); const r = ta.render(b.callback_data.slice(3), SNAP); assert.ok(r && r.text.length < 4096, b.callback_data); assert.ok(r.markup.inline_keyboard[0].some((x) => x.callback_data === 'ad:menu')); }
  assert.ok(ta.render('menu', SNAP).markup.inline_keyboard.flat().length === 14);
  assert.strictEqual(ta.render('nada', SNAP), null);
});
caso('Sin datos (snap vacío) no rompe', () => { for (const [k] of ta.MENU) assert.ok(ta.render(k, {}).text.length > 10, k); assert.ok(ta.dailyReport(null).length > 10 && ta.monthlyReport({}).length > 10); });
caso('Números: venta del día con comparación, proyección del mes, HTML escapado', () => {
  const t = ta.render('today', SNAP).text; assert.ok(/\$1\.500\.000/.test(t) && /▲ 50%/.test(t) && /\$600\.000/.test(t));
  assert.ok(/Proyección/.test(ta.render('month', SNAP).text));
  assert.ok(/Algo &lt;malo&gt;/.test(ta.render('alerts', SNAP).text));
  assert.ok(/50%/.test(ta.render('retention', SNAP).text) && /PICAROJAOK/.test(ta.render('campaigns', SNAP).text) && /Girox directo/.test(ta.render('menus', SNAP).text));
  assert.ok(/−\$/.test(ta.money(-5)));
});
caso('Código para vincular: 8 caracteres sin confundibles', () => { const c = ta.newPairCode(); assert.ok(/^[A-HJKMNP-Z2-9]{8}$/.test(c)); });
caso('Server: sólo grupos vinculados, código de un solo uso con hash y vencimiento, crons con lock, rutas sólo admin', () => {
  const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/if \(!chatId \|\| !_tgAdminLinked\(c, chatId\)\)/.test(S), 'botones sólo en chats vinculados');
  assert.ok(/if \(!_tgAdminLinked\(c, chat\.id\)\) return true; \/\/ grupo no vinculado/.test(S));
  assert.ok(/adminPairHash: null, adminPairUntil: null \}\); \/\/ el código se usa UNA vez/.test(S) && /crypto\.timingSafeEqual\(Buffer\.from\(crypto\.createHash\('sha256'\)/.test(S));
  assert.ok(/_cronClaim\('tgadminsnap'/.test(S) && /_cronClaim\('tgadminrep'/.test(S));
  for (const r of ['admin-pair', 'admin-unlink']) assert.ok(new RegExp("app\\.post\\('/api/admin/telegram/" + r + "', authMiddleware, adminMiddleware, async \\(req, res\\) => \\{\\n  if \\(req\\.user\\.role !== 'admin'\\)").test(S), r);
});
caso('Revisión: Config.collection SIEMPRE con la key en minúsculas (getConfig la baja; si no, escribe un doc que nadie lee)', () => {
  const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const bad = [...S.matchAll(/Config\.collection\.\w+\(\{ key: '([^']+)'/g)].map((m) => m[1]).filter((k) => k !== k.toLowerCase());
  assert.deepStrictEqual(bad, []);
});
console.log(`\n${ok}/${ok + fail} casos OK`);
process.exit(fail ? 1 : 0);
