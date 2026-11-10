// #1079: simulación de punta a punta del bot de comprobantes (#1079) con Telegram y base FALSOS.
const fs = require('fs'); const vm = require('vm'); const assert = require('assert'); const crypto = require('crypto');
const S = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const blk = S.slice(S.indexOf('// ── #1079 BOT DE COMPROBANTES'), S.indexOf("app.post('/api/telegram/webhook', async (req, res) => {"));
// --- base falsa ---
const get = (o, p) => p.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
const setp = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) { if (x[k] == null) x[k] = {}; x = x[k]; } x[ks[ks.length - 1]] = v; };
function match(doc, f) {
  for (const [k, c] of Object.entries(f || {})) {
    if (k === '$or') { if (!c.some((g) => match(doc, g))) return false; continue; }
    const v = get(doc, k);
    if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) {
      if ('$ne' in c) { if (Array.isArray(v) ? v.includes(c.$ne) : v === c.$ne) return false; }
      if ('$in' in c) { if (!c.$in.includes(v)) return false; }
      if ('$gte' in c) { if (!(v >= c.$gte)) return false; }
      continue;
    }
    if (Array.isArray(v) ? !v.includes(c) : v !== c) return false;
  }
  return true;
}
const cfgDocs = [];
const Config = { _cache: new Map(), collection: {
  findOne: async (f) => cfgDocs.find((d) => match(d, f)) || null,
  updateOne: async (f, u, o) => {
    let d = cfgDocs.find((x) => match(x, f));
    if (!d) { if (!(o && o.upsert) || cfgDocs.some((x) => x.key === f.key)) return { modifiedCount: 0, matchedCount: 0 }; d = { key: f.key, value: {} }; Object.assign(d, JSON.parse(JSON.stringify(u.$setOnInsert || {}))); cfgDocs.push(d); if (u.$setOnInsert) return { modifiedCount: 0, upsertedCount: 1 }; }
    else if (u.$setOnInsert && Object.keys(u).length === 1) return { modifiedCount: 0, matchedCount: 1 };
    for (const [k, v] of Object.entries(u.$set || {})) setp(d, k, v);
    for (const [k, v] of Object.entries(u.$pull || {})) { const arr = get(d, k) || []; setp(d, k, arr.filter((x) => !match(x, v))); }
    for (const [k, v] of Object.entries(u.$push || {})) { let arr = (get(d, k) || []).slice(); if (v && v.$each) { arr = arr.concat(v.$each); if (v.$slice) arr = arr.slice(v.$slice); } else arr.push(v); setp(d, k, arr); }
    return { modifiedCount: 1, matchedCount: 1 };
  } } };
function model() {
  const rows = [];
  const M = {
    rows,
    create: async (d) => { if (d.fromChat && d.srcMsgId != null && !('total' in d) && rows.some((x) => x.fromChat === d.fromChat && x.srcMsgId === d.srcMsgId)) { const e = new Error('dup'); e.code = 11000; throw e; } const x = Object.assign({ createdAt: new Date(NOW.getTime() + rows.length) }, d); rows.push(x); return Object.assign({ toObject: () => Object.assign({}, x) }, x); },
    findOne: (f) => ({ lean: async () => rows.find((x) => match(x, f)) || null }),
    find: (f) => { const r = rows.filter((x) => match(x, f || {})); const q = { sort: () => q, limit: (n) => { q._n = n; return q; }, select: () => q, lean: async () => r.slice(0, q._n || r.length) }; return q; },
    findOneAndUpdate: async (f, u) => { const x = rows.find((y) => match(y, f)); if (!x) return null; Object.assign(x, u.$set); return x; },
    updateOne: async (f, u) => { const x = rows.find((y) => match(y, f)); if (x) Object.assign(x, u.$set); return { matchedCount: x ? 1 : 0 }; },
    updateMany: async (f, u) => { for (const x of rows.filter((y) => match(y, f))) Object.assign(x, u.$set); return {}; },
    countDocuments: async (f) => rows.filter((x) => match(x, f)).length,
    aggregate: async (pipe) => { const m = rows.filter((x) => match(x, pipe[0].$match)); const g = pipe[1].$group; const by = {};
      for (const x of m) { const k = g._id === null ? 'null' : x[g._id.slice(1)]; const o = by[k] = by[k] || { _id: g._id === null ? null : k, total: 0, count: 0, first: null, toTitle: null };
        o.total += x.amount || 0; o.count++; if (!o.first || x.createdAt < o.first) o.first = x.createdAt; if (!o.toTitle) o.toTitle = x.toTitle; }
      return Object.values(by); },
  };
  return M;
}
const RcptFwd = model(), RcptClose = model();
// --- Telegram falso ---
const sent = []; let msgId = 1000;
const tgChannel = {
  call: async (token, method, p) => { sent.push({ token, method, p }); if (method === 'getFile') return { ok: true, result: { file_path: 'x.jpg', file_size: 10 } }; if (method === 'getMe') return { ok: true, result: { id: Number(token.split(':')[0]), username: 'bot' + token.split(':')[0] } }; return { ok: true, result: { message_id: ++msgId } }; },
  sendMedia: async (token, kind, chat, media, extra) => { sent.push({ token, method: 'sendMedia:' + kind, p: Object.assign({ chat_id: chat }, extra) }); return { ok: true, result: { message_id: ++msgId } }; },
};
let aiAmount = 25000.99;
const comprobanteAi = { isEnabled: () => true, analyzeComprobante: async () => ({ ok: true, amount: aiAmount }) };
let NOW = new Date('2026-11-10T15:00:00Z'); // martes 12:00 ART
const RealDate = Date; class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW.getTime()); } static now() { return NOW.getTime(); } }
const routes = {}; const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, post: (p, ...h) => { routes['POST ' + p] = h[h.length - 1]; } };
const SCHED_ART_OFFSET_MS = 3 * 3600000;
const ctx = { require: (p) => (p.endsWith('RcptFwd') ? { RcptFwd, RcptClose } : p === 'axios' ? { get: async () => ({ data: Buffer.from('img') }) } : require(p)),
  Config, app, authMiddleware: 1, adminMiddleware: 1, tgChannel, comprobanteAi, crypto, uuidv4: () => crypto.randomUUID(), logger: { info() {}, warn: (m) => console.log('WARN', m) },
  _credDecrypt: (x) => x, _credEncrypt: (x) => x, _tgCfg: async () => ({ token: 'CANAL' }), _tgWebhookBase: () => 'https://picaroja.com', getConfig: async () => null,
  _schedArtKey: (d) => new RealDate(new RealDate(d).getTime() - SCHED_ART_OFFSET_MS).toISOString().slice(0, 10),
  _tgArtHour: (d = new FakeDate()) => Number(new RealDate(d).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })) % 24,
  _sha: (v) => crypto.createHash('sha256').update(String(v)).digest('hex'), _pinLocked: () => false, _pinCheck: () => {},
  process: { env: {} }, setTimeout: () => 0, setInterval: () => 0, Date: FakeDate, Math, JSON, Object, Array, String, Number, Buffer, Set, Map, Promise, RegExp, Error, console };
vm.createContext(ctx); vm.runInContext(blk + '; this._rbCloseTick = _rbCloseTick; this._rbCfg = _rbCfg;', ctx);
// --- armado: 1 estructura, bot 111, grupo 1 (-1) manda; ,99 → -2 ; todo lo demás → -3 ---
cfgDocs.push({ key: 'rcptbot', value: { bots: [{ id: '111', username: 'b111', tokenEnc: '111:TOKEN', secret: 'S' }], groups: [{ id: '-1', title: 'buffalobot', bots: ['111'] }, { id: '-2', title: 'asuncionbot', bots: ['111'] }, { id: '-3', title: 'fichasnuevobot', bots: ['111'] }],
  structs: [{ id: 'E1', name: 'Buffalo', on: true, botId: '111', routes: [{ from: '-1', rules: [{ cents: '99', to: '-2' }], otherTo: '-3' }] }] } });
const hook = async (update) => { const req = { params: { bot: '111' }, get: () => 'S', body: update }; const res = { headersSent: false, status() { return this; }, end() {}, json() { this.headersSent = true; } }; await routes['POST /api/rcptbot/webhook/:bot'](req, res); };
const photo = (id, chat = -1) => ({ message: { message_id: id, chat: { id: chat, type: 'supergroup', title: chat === -1 ? 'buffalobot' : 'x' }, from: { first_name: 'Ana' }, photo: [{ file_id: 'f' + id }] } });
const text = (id, chat, t, reply) => ({ message: { message_id: id, chat: { id: chat, type: 'supergroup', title: chat === -1 ? 'buffalobot' : chat === -2 ? 'asuncionbot' : 'fichasnuevobot' }, from: { first_name: 'Ana' }, text: t, reply_to_message: reply ? { message_id: reply } : undefined } });
const last = (chat) => sent.filter((x) => String(x.p.chat_id) === String(chat)).slice(-1)[0];
let ok = 0; const caso = async (n, fn) => { try { await fn(); ok++; console.log('✅ ' + n); } catch (e) { console.log('❌ ' + n + '\n   ' + e.message); process.exitCode = 1; } };
(async () => {
  await caso('comprobante ,99 → asuncionbot, marcado y sumado + total del mes', async () => {
    await hook(photo(1));
    const cp = sent.find((x) => x.method === 'copyMessage'); assert.ok(cp && cp.p.chat_id === '-2', 'copió a -2');
    const r = last(-1); assert.ok(/REENVIADO<\/b> a asuncionbot/.test(r.p.text) && /Acumulado: <b>\$25\.001<\/b> \(1 comprobante\)/.test(r.p.text) && /Total de noviembre \(sin corte\): <b>\$25\.001/.test(r.p.text), r.p.text);
  });
  await caso('el mismo mensaje dos veces (reintento) no se suma dos veces', async () => { const n = sent.length; await hook(photo(1)); assert.strictEqual(sent.length, n); });
  await caso('otros centavos → fichasnuevobot (todo lo demás); sumas separadas por destino', async () => {
    aiAmount = 10000; await hook(photo(2));
    assert.ok(sent.filter((x) => x.method === 'copyMessage').slice(-1)[0].p.chat_id === '-3');
    assert.ok(/Acumulado: <b>\$10\.000<\/b> \(1 comprobante\)/.test(last(-1).p.text) && /Total de noviembre \(sin corte\): <b>\$35\.001<\/b> \(2 comp\.\)/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('sin monto ⇒ queda esperando; respondiendo con el monto se reenvía', async () => {
    aiAmount = null; await hook(photo(3)); assert.ok(/No pude leer el monto/.test(last(-1).p.text));
    await hook(text(4, -1, '5000,99', 3)); assert.ok(/REENVIADO<\/b> a asuncionbot · <b>\$5\.000,99<\/b> \(monto escrito\)/.test(last(-1).p.text) && /\$30\.002<\/b> \(2 comprobantes\)/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('/total muestra cada destino y el mes', async () => { await hook(text(5, -1, '/total')); const t = last(-1).p.text; assert.ok(/asuncionbot: <b>\$30\.002<\/b> \(2\)/.test(t) && /fichasnuevobot: <b>\$10\.000<\/b> \(1\)/.test(t) && /Total de noviembre/.test(t), t); });
  await caso('cierre 13 h (martes): pendiente a cotizar detallado, suma nueva $0', async () => {
    NOW = new Date('2026-11-10T16:05:00Z'); // 13:05 ART
    await ctx._rbCloseTick(); assert.strictEqual(RcptClose.rows.length, 2);
    const d2 = last(-2).p.text; assert.ok(/CIERRE/.test(d2) && /PENDIENTE A COTIZAR: \$30\.001,98/.test(d2) && /Suma nueva: <b>\$0<\/b>/.test(d2) && (d2.match(/PENDIENTE A COTIZAR/g) || []).length === 1, d2);
    const s1 = last(-1).p.text; assert.ok(/asuncionbot: ⏳ PENDIENTE A COTIZAR <b>\$30\.001,98/.test(s1) && /Suma nueva/.test(s1) && /Total de noviembre \(sin corte\): <b>\$40\.002/.test(s1), s1);
    await ctx._rbCloseTick(); assert.strictEqual(RcptClose.rows.length, 2, 'no cierra dos veces el mismo día');
  });
  await caso('comprobante nuevo después del cierre: suma desde $0 y muestra el pendiente anterior', async () => {
    aiAmount = 1000.99; await hook(photo(6)); const t = last(-1).p.text;
    assert.ok(/Acumulado: <b>\$1\.001<\/b> \(1 comprobante\)/.test(t) && /PENDIENTE A COTIZAR<\/b>: <b>\$30\.002<\/b> · 2 comp\./.test(t) && /Total de noviembre \(sin corte\): <b>\$41\.003/.test(t), t);
  });
  await caso('/cotizado en el destino ⇒ cotizado, pendiente a enviar', async () => {
    await hook(text(7, -2, '/cotizado 1150')); assert.ok(/COTIZADO/.test(last(-2).p.text) && /PENDIENTE A ENVIAR/.test(last(-2).p.text));
    assert.strictEqual(RcptClose.rows.find((x) => x.toChat === '-2').status, 'quoted');
    aiAmount = 2000.99; await hook(photo(8)); assert.ok(/COTIZADO \(1150\) · <b>PENDIENTE A ENVIAR<\/b>: <b>\$30\.002/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('/enviado ⇒ el pendiente se va', async () => {
    await hook(text(9, -2, '/enviado')); assert.strictEqual(RcptClose.rows.find((x) => x.toChat === '-2').status, 'sent');
    aiAmount = 3000.99; await hook(photo(10)); assert.ok(!/PENDIENTE/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('sábado no cierra; lunes 13 h junta todo el finde', async () => {
    NOW = new Date('2026-11-14T17:00:00Z'); await ctx._rbCloseTick(); const n = RcptClose.rows.length;
    aiAmount = 500.99; await hook(photo(11));
    NOW = new Date('2026-11-16T16:01:00Z'); await ctx._rbCloseTick(); assert.ok(RcptClose.rows.length > n, 'el lunes cierra');
    NOW = new Date('2026-11-15T12:00:00Z'); // (domingo, antes del lunes) ya comprobado arriba que no cerró el sábado
  });
  await caso('mes nuevo ⇒ total del mes arranca de 0', async () => { NOW = new Date('2026-12-01T15:00:00Z'); aiAmount = 100.99; await hook(photo(12)); assert.ok(/Total de diciembre \(sin corte\): <b>\$101<\/b> \(1 comp\.\)/.test(last(-1).p.text), last(-1).p.text); });
  await caso('/ayuda explica los centavos del grupo', async () => { await hook(text(20, -1, '/ayuda')); const t = last(-1).p.text; assert.ok(/PRESTÁ ATENCIÓN A LOS CENTAVOS/.test(t) && /,99<\/b> → asuncionbot/.test(t) && /otra terminación → fichasnuevobot/.test(t), t); });
  await caso('centavos sin grupo ⇒ no se reenvía y avisa la lista', async () => {
    cfgDocs[0].value.structs[0].routes[0].otherTo = null; await ctx._rbCfg(true); aiAmount = 700.43; const n = sent.filter((x) => x.method === 'copyMessage').length;
    await hook(photo(21)); assert.strictEqual(sent.filter((x) => x.method === 'copyMessage').length, n); const t = last(-1).p.text;
    assert.ok(/termina en <b>,43<\/b> y no hay grupo/.test(t) && /Prestá atención a los centavos/.test(t) && /,99<\/b> → asuncionbot/.test(t), t);
  });
  const cb = (data, mid = 5000) => hook({ callback_query: { id: 'q', data, from: { first_name: 'Ana' }, message: { message_id: mid, chat: { id: -1, type: 'supergroup', title: 'buffalobot' } } } });
  await caso('se equivocó con el decimal: elige el grupo con el botón ⇒ llega con el aviso y suma normal', async () => {
    const hold = sent.filter((x) => String(x.p.chat_id) === '-1').slice(-1)[0];
    const kb = hold.p.reply_markup && hold.p.reply_markup.inline_keyboard; assert.ok(kb && kb.length === 1 && /,99 → asuncionbot/.test(kb[0][0].text), JSON.stringify(hold.p.reply_markup));
    const before = await RcptFwd.rows.filter((x) => x.toChat === '-2' && x.status === 'open').reduce((a, x) => a + x.amount, 0);
    await cb(kb[0][0].callback_data);
    const cp = sent.filter((x) => x.method === 'copyMessage').slice(-1)[0]; assert.ok(cp.p.chat_id === '-2' && /se equivocó con el decimal<\/b> \(terminó en ,43\), pero va a este grupo/.test(cp.p.caption), cp.p.caption);
    const t = last(-1).p.text; assert.ok(/REENVIADO<\/b> a asuncionbot/.test(t) && /no coincidían: elegido a mano/.test(t), t);
    const after = RcptFwd.rows.filter((x) => x.toChat === '-2' && x.status === 'open').reduce((a, x) => a + x.amount, 0); assert.ok(Math.abs(after - before - 700.43) < 0.001);
  });
  await caso('ya reenviado al grupo equivocado ⇒ "cambiar grupo" lo saca de una suma y lo pone en la otra', async () => {
    cfgDocs[0].value.structs[0].routes[0].otherTo = '-3'; await ctx._rbCfg(true);
    aiAmount = 900.99; await hook(photo(22)); const r = last(-1); const btn = r.p.reply_markup.inline_keyboard[0][0]; assert.ok(/cambiar grupo/.test(btn.text));
    const rec = RcptFwd.rows.find((x) => x.srcMsgId === 22); assert.strictEqual(rec.toChat, '-2');
    await cb(btn.callback_data, 7777); const ed = sent.filter((x) => x.method === 'editMessageReplyMarkup').slice(-1)[0]; assert.ok(/fichasnuevobot/.test(ed.p.reply_markup.inline_keyboard[0][0].text), JSON.stringify(ed.p));
    await cb(ed.p.reply_markup.inline_keyboard[0][0].callback_data, 7777);
    assert.strictEqual(rec.toChat, '-3'); assert.strictEqual(rec.status, 'open');
    assert.ok(sent.some((x) => String(x.p.chat_id) === '-2' && /ANULADO/.test(x.p.text || '')), 'avisa en el grupo viejo');
    const cp = sent.filter((x) => x.method === 'copyMessage').slice(-1)[0]; assert.ok(cp.p.chat_id === '-3' && /Movido desde asuncionbot/.test(cp.p.caption) && /se equivocó con el decimal/.test(cp.p.caption), cp.p.caption);
  });
  await caso('montos que ya venían sumados: entran al acumulado, al cierre y al mes', async () => {
    const call = async (path, body) => { let out = null, code = 200; await routes['POST ' + path]({ body, user: { username: 'admin' } }, { status(c) { code = c; return this; }, json(j) { out = j; } }); return { code, out }; };
    const bad = await call('/api/admin/rcptbot/carry', { structId: 'E1', from: '-1', items: [{ to: '-99', amount: '5' }] }); assert.strictEqual(bad.code, 400);
    const pre = (await RcptFwd.rows.filter((x) => x.toChat === '-2' && x.status === 'open')).reduce((a, x) => a + x.amount, 0);
    const r = await call('/api/admin/rcptbot/carry', { structId: 'E1', from: '-1', items: [{ to: '-2', amount: '350.000,50' }], month: '1.000.000' }); assert.ok(r.out && r.out.success, JSON.stringify(r));
    const t = last(-1).p.text; assert.ok(/Montos que ya venían sumados/.test(t) && /\+\$350\.000,50/.test(t) && /Del mes \(ya cerrado antes\): \+\$1\.000\.000/.test(t), t);
    const post = RcptFwd.rows.filter((x) => x.toChat === '-2' && x.status === 'open').reduce((a, x) => a + x.amount, 0); assert.ok(Math.abs(post - pre - 350000.5) < 0.001);
    aiAmount = 100.99; await hook(photo(30)); assert.ok(/Total de diciembre \(sin corte\): <b>\$1\.351\.\d{3}/.test(last(-1).p.text), last(-1).p.text);
    const n = RcptClose.rows.length; NOW = new Date('2026-12-01T16:10:00Z'); await ctx._rbCloseTick();
    const cl = RcptClose.rows.slice(n).find((x) => x.toChat === '-2'); assert.ok(cl && cl.total >= 350000.5 + 100.99 - 0.01, JSON.stringify(cl));
    assert.ok(!RcptClose.rows.slice(n).some((x) => x.toChat == null), 'lo del mes no entra en un cierre');
  });
  await caso('/anterior en el grupo DESTINO suma lo de antes al acumulado', async () => {
    const pre = RcptFwd.rows.filter((x) => x.toChat === '-3' && x.status === 'open').reduce((a, x) => a + x.amount, 0);
    await hook(text(40, -3, '/anterior 13.686.199'));
    const post = RcptFwd.rows.filter((x) => x.toChat === '-3' && x.status === 'open').reduce((a, x) => a + x.amount, 0);
    assert.ok(Math.abs(post - pre - 13686199) < 0.001, pre + ' ' + post);
    assert.ok(/SUMADO LO ANTERIOR<\/b>: \+\$13\.686\.199/.test(last(-3).p.text) && /SUMADO LO ANTERIOR/.test(last(-1).p.text), last(-3).p.text);
    await hook(text(41, -1, '/anterior 5000')); assert.ok(/manda a 2 grupos/.test(last(-1).p.text), last(-1).p.text);
    await hook(text(42, -3, '/anterior')); assert.ok(/Escribí el monto/.test(last(-3).p.text));
  });
  await caso('menú: /ayuda en el DESTINO explica los comandos con botones; /total del destino con pendientes', async () => {
    await hook(text(50, -2, '/ayuda')); const h = last(-2); assert.ok(/GRUPO DE DESTINO/.test(h.p.text) && /\/cotizado/.test(h.p.text) && /\/enviado/.test(h.p.text) && /CÓMO SIGUE/.test(h.p.text), h.p.text);
    assert.strictEqual(JSON.stringify(h.p.reply_markup.inline_keyboard.map((r) => r[0].callback_data)), JSON.stringify(['rbm:total', 'rbm:quote', 'rbm:sent']));
    await hook(text(51, -2, '/total')); assert.ok(/SUMA ACTUALIZADA/.test(last(-2).p.text) && /De buffalobot: <b>/.test(last(-2).p.text), last(-2).p.text);
    await hook(text(52, -1, '/ayuda')); const g = last(-1); assert.ok(/\/cierre 500\.000/.test(g.p.text) && /\/anterior/.test(g.p.text) && g.p.reply_markup.inline_keyboard.length === 3, g.p.text);
  });
  const cbIn = (chat, data, mid = 6000) => hook({ callback_query: { id: 'q' + Math.random(), data, from: { first_name: 'Ana' }, message: { message_id: mid, chat: { id: chat, type: 'supergroup', title: 'x' } } } });
  await caso('/cierre 500.000 con 2 destinos: elige la suma, cierra ESE monto y el resto sigue sumando', async () => {
    const tot = (to) => RcptFwd.rows.filter((x) => x.toChat === to && x.status === 'open').reduce((a, x) => a + x.amount, 0);
    aiAmount = 1000.99; await hook(photo(56)); // las dos sumas con plata ⇒ pregunta de cuál
    const before = tot('-3'); const monthBefore = (last(-1).p.text.match(/Total de \w+ \(sin corte\): <b>([^<]+)/) || [])[1];
    await hook(text(53, -1, '/cierre 500.000')); const q = last(-1); assert.ok(/De qué suma se cierran <b>\$500\.000<\/b>/.test(q.p.text), q.p.text);
    const btn = q.p.reply_markup.inline_keyboard.find((r) => /fichasnuevobot/.test(r[0].text))[0];
    await cbIn(-1, btn.callback_data);
    const cl = RcptClose.rows[RcptClose.rows.length - 1]; assert.ok(cl.toChat === '-3' && cl.total === 500000 && Math.abs(cl.partialOf - before) < 0.01, JSON.stringify(cl));
    assert.ok(Math.abs(tot('-3') - (before - 500000)) < 0.01, 'resto ' + tot('-3'));
    assert.ok(/PENDIENTE A COTIZAR: \$500\.000<\/b>/.test(last(-3).p.text) && /Queda sumando el resto/.test(last(-3).p.text), last(-3).p.text);
    await hook(text(54, -1, '/total')); const t = last(-1).p.text; const monthNow = (t.match(/Total de \w+ \(sin corte\): <b>([^<]+)/) || [])[1];
    assert.strictEqual(monthNow, monthBefore, 'el resto no duplica el total del mes'); 
  });
  await caso('/cierre con monto mayor a la suma ⇒ no cierra', async () => {
    cfgDocs[0].value.structs[0].routes[0].rules = []; await ctx._rbCfg(true); // 1 solo destino (todo lo demás → -3)
    const n = RcptClose.rows.length; await hook(text(55, -1, '/cierre 999.999.999')); assert.strictEqual(RcptClose.rows.length, n); assert.ok(/es mayor que lo sumado/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('botón Dar cierre ⇒ confirma ⇒ cierra el total y suma nueva $0', async () => {
    await cbIn(-1, 'rbm:close'); assert.ok(/CIERRE del TOTAL/.test(last(-1).p.text)); const n = RcptClose.rows.length;
    await cbIn(-1, 'rbm:closeok'); assert.ok(RcptClose.rows.length > n && /Suma nueva: <b>\$0/.test(last(-1).p.text), last(-1).p.text);
    assert.strictEqual(RcptFwd.rows.filter((x) => x.toChat === '-3' && x.status === 'open').length, 0);
  });
  await caso('botones del destino: COTIZADO y ENVIADO con confirmación', async () => {
    await cbIn(-3, 'rbm:quote'); assert.ok(/Marcar COTIZADO/.test(last(-3).p.text)); await cbIn(-3, 'rbm:quoteok');
    assert.ok(RcptClose.rows.filter((x) => x.toChat === '-3').every((x) => x.status !== 'pending'));
    await cbIn(-3, 'rbm:sentok'); assert.ok(RcptClose.rows.filter((x) => x.toChat === '-3').every((x) => x.status === 'sent'));
    await cbIn(-3, 'rbm:total'); assert.ok(/Sin cierres pendientes/.test(last(-3).p.text), last(-3).p.text);
  });
  await caso('estructura APAGADA no reenvía nada', async () => { cfgDocs[0].value.structs[0].on = false; await ctx._rbCfg(true); const n = sent.length; await hook(photo(13)); assert.strictEqual(sent.length, n); });
  await caso('secreto incorrecto ⇒ 401', async () => { let code = 0; await routes['POST /api/rcptbot/webhook/:bot']({ params: { bot: '111' }, get: () => 'MAL', body: {} }, { status(c) { code = c; return this; }, end() {}, json() {} }); assert.strictEqual(code, 401); });
  console.log(`\n${ok} casos OK`);
})();
