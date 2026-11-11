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
      if ('$nin' in c) { if (c.$nin.includes(v)) return false; }
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
    updateMany: async (f, u) => { const r = rows.filter((y) => match(y, f)); for (const x of r) Object.assign(x, u.$set); return { modifiedCount: r.length, matchedCount: r.length }; },
    countDocuments: async (f) => rows.filter((x) => match(x, f)).length,
    aggregate: async (pipe) => { const m = rows.filter((x) => match(x, pipe[0].$match)); const g = pipe[1].$group; const by = {};
      for (const x of m) { const k = g._id === null ? 'null' : x[g._id.slice(1)]; const o = by[k] = by[k] || { _id: g._id === null ? null : k, total: 0, count: 0, first: null, toTitle: null };
        o.total += x.amount || 0; o.count++; if (!o.first || x.createdAt < o.first) o.first = x.createdAt; if (!o.toTitle) o.toTitle = x.toTitle;
        for (const [k2, e] of Object.entries(g)) { if (k2 === '_id' || k2 === 'count' || !e || !e.$sum) continue; if (k2 === 'total' && e.$sum && e.$sum.$ifNull && e.$sum.$ifNull[0] === '$amount') continue; if (!o['_' + k2]) { o['_' + k2] = 1; o[k2] = 0; } o[k2] += e.$sum === 1 ? 1 : (x[String((e.$sum.$ifNull || [e.$sum])[0]).slice(1)] || 0); } }
      return Object.values(by); },
  };
  // colección cruda: update con PIPELINE ([{ $set }]) como lo usa _rbGroupMigrate (sólo $cond/$gt/$subtract y '$campo', lo que hace falta acá)
  const ev = (x, e) => {
    if (typeof e === 'string' && e[0] === '$') return x[e.slice(1)];
    if (e && typeof e === 'object' && !Array.isArray(e)) {
      if (e.$cond) return ev(x, e.$cond[0]) ? ev(x, e.$cond[1]) : ev(x, e.$cond[2]);
      if (e.$gt) return ev(x, e.$gt[0]) > ev(x, e.$gt[1]);
      if (e.$subtract) return ev(x, e.$subtract[0]) - ev(x, e.$subtract[1]);
    }
    return e;
  };
  M.collection = { updateMany: async (f, u) => { for (const x of rows.filter((y) => match(y, f))) { if (Array.isArray(u)) for (const st of u) { const vals = {}; for (const [k, e] of Object.entries(st.$set || {})) vals[k] = ev(x, e); Object.assign(x, vals); } else Object.assign(x, u.$set); } return {}; } };
  return M;
}
const RcptFwd = model(), RcptClose = model();
// --- Telegram falso ---
const sent = []; let msgId = 1000;
const tgChannel = {
  call: async (token, method, p) => { sent.push({ token, method, p }); if (global.TG_EXTRA) { const x = global.TG_EXTRA(token, method, p); if (x) return x; } if (method === 'getFile') return { ok: true, result: { file_path: 'x.jpg', file_size: 10 } }; if (method === 'getMe') return { ok: true, result: { id: Number(token.split(':')[0]), username: 'bot' + token.split(':')[0] } }; if (method === 'getChatMember') { const st = (global.TG_MEMBER || {})[String(p.chat_id)] || 'administrator'; return { ok: true, result: { status: st } }; } return { ok: true, result: { message_id: ++msgId } }; },
  sendMedia: async (token, kind, chat, media, extra) => { sent.push({ token, method: 'sendMedia:' + kind, p: Object.assign({ chat_id: chat }, extra) }); return { ok: true, result: { message_id: ++msgId } }; },
};
let aiAmount = 25000.99;
let aiByModel = null; // #1109: { modelo: monto } para simular lecturas distintas
const comprobanteAi = { isEnabled: () => true, analyzeComprobante: async (d, o) => ({ ok: true, amount: aiByModel && o && o.model in aiByModel ? aiByModel[o.model] : aiAmount }) };
let NOW = new Date('2026-11-10T15:00:00Z'); // martes 12:00 ART
const RealDate = Date; class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW.getTime()); } static now() { return NOW.getTime(); } }
const routes = {}; const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, post: (p, ...h) => { routes['POST ' + p] = h[h.length - 1]; } };
const SCHED_ART_OFFSET_MS = 3 * 3600000;
const ctx = { require: (p) => (p.endsWith('RcptFwd') ? { RcptFwd, RcptClose } : p === 'axios' ? { get: async () => ({ data: Buffer.from('img') }) } : p.startsWith('./') ? require(require('path').join(__dirname, '..', p)) : require(p)),
  Config, app, _cronClaim: async () => true, authMiddleware: 1, adminMiddleware: 1, tgChannel, comprobanteAi, crypto, uuidv4: () => crypto.randomUUID(), logger: { info() {}, warn: (m) => console.log('WARN', m) },
  _credDecrypt: (x) => x, _credEncrypt: (x) => x, _tgCfg: async () => ({ token: 'CANAL' }), _tgWebhookBase: () => 'https://picaroja.com', getConfig: async () => null,
  _schedArtKey: (d) => new RealDate(new RealDate(d).getTime() - SCHED_ART_OFFSET_MS).toISOString().slice(0, 10),
  _tgArtHour: (d = new FakeDate()) => Number(new RealDate(d).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })) % 24,
  _sha: (v) => crypto.createHash('sha256').update(String(v)).digest('hex'), _pinLocked: () => false, _pinCheck: () => {},
  process: { env: {} }, setTimeout: (f, ms) => { if (ms <= 2000) setImmediate(f); return 0; }, setInterval: () => 0, Date: FakeDate, Math, JSON, Object, Array, String, Number, Buffer, Set, Map, Promise, RegExp, Error, console };
vm.createContext(ctx); vm.runInContext(blk + '; this._RB_SRC_KB = _RB_SRC_KB; this._RB_DST_KB = _RB_DST_KB; this._rbCloseTick = _rbCloseTick; this._rbCbuTick = _rbCbuTick; this._rbCfg = _rbCfg; this._rbMonthCloseTick = _rbMonthCloseTick; this._rbWelcomeStruct = _rbWelcomeStruct; this._rbPlanGroup = _rbPlanGroup; this._rbPlanRun = _rbPlanRun; this.RB_PLAN = RB_PLAN; this._rbWelcomeIfReady = _rbWelcomeIfReady;', ctx);
// --- armado: 1 estructura, bot 111, grupo 1 (-1) manda; ,99 → -2 ; todo lo demás → -3 ---
cfgDocs.push({ key: 'rcptbot', value: { bots: [{ id: '111', username: 'b111', tokenEnc: '111:TOKEN', secret: 'S' }], groups: [{ id: '-1', title: 'buffalobot', bots: ['111'] }, { id: '-2', title: 'asuncionbot', bots: ['111'] }, { id: '-3', title: 'fichasnuevobot', bots: ['111'] }],
  autoClose13: true, // #1089: el cierre de las 13 h sólo con este tilde (default apagado)
  structs: [{ id: 'E1', name: 'Buffalo', on: true, botId: '111', routes: [{ from: '-1', rules: [{ cents: '99', to: '-2' }], otherTo: '-3' }] }] } });
const hook = async (update) => { const req = { params: { bot: '111' }, get: () => 'S', body: update }; const res = { headersSent: false, status() { return this; }, end() {}, json() { this.headersSent = true; } }; await routes['POST /api/rcptbot/webhook/:bot'](req, res); };
const photo = (id, chat = -1) => ({ message: { message_id: id, chat: { id: chat, type: 'supergroup', title: chat === -1 ? 'buffalobot' : 'x' }, from: { first_name: 'Ana' }, photo: [{ file_id: 'f' + id }] } });
const text = (id, chat, t, reply) => ({ message: { message_id: id, chat: { id: chat, type: 'supergroup', title: chat === -1 ? 'buffalobot' : chat === -2 ? 'asuncionbot' : 'fichasnuevobot' }, from: { first_name: 'Ana' }, text: t, reply_to_message: reply ? { message_id: reply } : undefined } });
const last = (chat) => sent.filter((x) => String(x.p.chat_id) === String(chat) && x.method !== 'pinChatMessage' && x.method !== 'editMessageReplyMarkup' && x.method !== 'answerCallbackQuery').slice(-1)[0];
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
    aiAmount = null; await hook(photo(3)); const t0 = last(-1).p.text; assert.ok(/NO SE PUDO LEER/.test(t0) && /no se sumó/.test(t0) && /foto bien legible/.test(t0), t0); // #1105
    await hook(text(4, -1, '5000,99', 3)); assert.ok(/REENVIADO<\/b> a asuncionbot · <b>\$5\.000,99<\/b> \(monto escrito\)/.test(last(-1).p.text) && /\$30\.002<\/b> \(2 comprobantes\)/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('/total muestra cada destino y el mes', async () => { await hook(text(5, -1, '/total')); const t = last(-1).p.text; assert.ok(/asuncionbot: <b>\$30\.002<\/b> \(2\)/.test(t) && /fichasnuevobot: <b>\$10\.000<\/b> \(1\)/.test(t) && /Total de noviembre/.test(t), t); });
  await caso('cierre 13 h (martes): pendiente a cotizar detallado, suma nueva $0', async () => {
    NOW = new Date('2026-11-10T16:05:00Z'); // 13:05 ART
    const rc = cfgDocs.find((d) => d.key === 'rcptbot').value; rc.autoClose13 = false; await ctx._rbCfg(true);
    await ctx._rbCloseTick(); assert.strictEqual(RcptClose.rows.length, 0, '#1089: sin autoClose13 NO cierra solo a las 13 h');
    rc.autoClose13 = true; await ctx._rbCfg(true);
    await ctx._rbCloseTick(); assert.strictEqual(RcptClose.rows.length, 2);
    const d2 = last(-2).p.text; assert.ok(/CIERRE/.test(d2) && /Cerrado: <b>\$30\.001,98<\/b>/.test(d2) && /PENDIENTE A COTIZAR: \$30\.002/.test(d2) && /Suma nueva: <b>\$0<\/b>/.test(d2) && !/buffalobot|De:/.test(d2), d2); // #1101: el grupo 2 ve UNA cuenta
    const s1 = last(-1).p.text; assert.ok(/asuncionbot: cerrado <b>\$30\.001,98<\/b> \(2 comp\.\)/.test(s1) && !/PENDIENTE/.test(s1) && /Suma nueva/.test(s1) && /Total de noviembre \(sin corte\): <b>\$40\.002/.test(s1), s1);
    await ctx._rbCloseTick(); assert.strictEqual(RcptClose.rows.length, 2, 'no cierra dos veces el mismo día');
  });
  await caso('comprobante nuevo después del cierre: suma desde $0 y muestra el pendiente anterior', async () => {
    aiAmount = 1000.99; await hook(photo(6)); const t = last(-1).p.text;
    assert.ok(/Acumulado: <b>\$1\.001<\/b> \(1 comprobante\)/.test(t) && !/PENDIENTE/.test(t) && /Total de noviembre \(sin corte\): <b>\$41\.003/.test(t), t); // #1089: el grupo 1 ve sólo la suma
    const d = last(-2).p; const dc = d.caption || d.text || ''; assert.ok(/PENDIENTE A COTIZAR<\/b>: <b>\$30\.002<\/b>/.test(dc) && !/De:|buffalobot/.test(dc), dc); // #1101: el pendiente va al grupo 2, sin nombres de equipos
  });
  await caso('/cotizado en el destino ⇒ cotizado, pendiente a enviar', async () => {
    await hook(text(7, -2, '/cotizado 1150')); assert.ok(/COTIZADO/.test(last(-2).p.text) && /PENDIENTE A ENVIAR/.test(last(-2).p.text));
    assert.strictEqual(RcptClose.rows.find((x) => x.toChat === '-2').status, 'quoted');
    aiAmount = 2000.99; await hook(photo(8)); assert.ok(!/PENDIENTE/.test(last(-1).p.text), last(-1).p.text); const d8 = last(-2).p; const dc8 = d8.caption || d8.text || ''; assert.ok(/PENDIENTE A ENVIAR<\/b>: <b>\$30\.002/.test(dc8), dc8);
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
    aiAmount = 900.99; await hook(photo(22)); const r = last(-1); const btn = r.p.reply_markup.inline_keyboard[0][0]; assert.ok(/Cambiar grupo/.test(btn.text), btn.text);
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
    assert.ok(/SUMADO LO ANTERIOR<\/b>: \+\$13\.686\.199/.test(last(-3).p.text) && !/SUMADO LO ANTERIOR/.test(last(-1).p.text), 'queda sólo en el grupo 2 (#1084)');
    const n2 = RcptFwd.rows.filter((x) => x.status === 'open').length; const mon = (t) => Number(((t.match(/Total de \w+ \(sin corte\): <b>\$([\d.]+)/) || [])[1] || '0').replace(/\./g, ''));
    await hook(text(41, -1, '/suma 5000')); const t41 = last(-1).p.text; assert.ok(/SUMADO LO ANTERIOR/.test(t41) && /Sólo en la cuenta de este grupo/.test(t41) && /Anterior de este grupo: <b>\$5\.000/.test(t41), t41); // #1108
    assert.strictEqual(RcptFwd.rows.filter((x) => x.status === 'open').length, n2, 'no llega a ningún grupo 2'); assert.ok(!/SUMADO LO ANTERIOR<\/b>: \+\$5\.000/.test(last(-3).p.text + last(-2).p.text), 'el grupo 2 no se entera');
    await hook(text(42, -3, '/anterior')); assert.ok(/Escribí el monto/.test(last(-3).p.text));
  });
  await caso('menú: /ayuda en el DESTINO explica los comandos con botones; /total del destino con pendientes', async () => {
    await hook(text(50, -2, '/ayuda')); const h = last(-2); assert.ok(/GRUPO DE DESTINO/.test(h.p.text) && /\/cotizado/.test(h.p.text) && /\/enviado/.test(h.p.text) && /CÓMO SIGUE/.test(h.p.text), h.p.text);
    assert.strictEqual(JSON.stringify(h.p.reply_markup.inline_keyboard.map((r) => r[0].callback_data)), JSON.stringify(['rbm:total', 'rbm:quote', 'rbm:sent', 'rbm:help', 'rbm:cbu', 'rbm:stop']));
    await hook(text(51, -2, '/total')); assert.ok(/SUMA ACTUALIZADA/.test(last(-2).p.text) && /Desde el último cierre: <b>/.test(last(-2).p.text) && !/De buffalobot/.test(last(-2).p.text), last(-2).p.text); // #1101
    await hook(text(52, -1, '/ayuda')); const g = last(-1); assert.ok(/\/cierre 500\.000/.test(g.p.text) && /\/suma/.test(g.p.text) && g.p.reply_markup.inline_keyboard.length === 4, g.p.text);
  });
  const cbIn = (chat, data, mid = 6000) => hook({ callback_query: { id: 'q' + Math.random(), data, from: { first_name: 'Ana' }, message: { message_id: mid, chat: { id: chat, type: 'supergroup', title: 'x' } } } });
  await caso('/cierre 500.000 con 2 destinos: elige la suma, cierra ESE monto y el resto sigue sumando', async () => {
    const tot = (to) => RcptFwd.rows.filter((x) => x.toChat === to && x.fromChat === '-1' && x.status === 'open').reduce((a, x) => a + x.amount, 0); // #1108: sólo lo del grupo 1 (lo anterior del grupo 2 no lo cierra el 1)
    aiAmount = 1000.99; await hook(photo(56)); aiAmount = 600000.50; await hook(photo(57)); // las dos sumas con plata ⇒ pregunta de cuál
    const before = tot('-3'); const monthBefore = (last(-1).p.text.match(/Total de \w+ \(sin corte\): <b>([^<]+)/) || [])[1];
    await hook(text(53, -1, '/cierre 500.000')); const q = last(-1); assert.ok(/De qué suma se cierran <b>\$500\.000<\/b>/.test(q.p.text), q.p.text);
    const btn = q.p.reply_markup.inline_keyboard.find((r) => /fichasnuevobot/.test(r[0].text))[0];
    await cbIn(-1, btn.callback_data);
    const cl = RcptClose.rows[RcptClose.rows.length - 1]; assert.ok(cl.toChat === '-3' && cl.total === 500000 && Math.abs(cl.partialOf - before) < 0.01, JSON.stringify(cl));
    assert.ok(Math.abs(tot('-3') - (before - 500000)) < 0.01, 'resto ' + tot('-3'));
    assert.ok(/Cerrado: <b>\$500\.000<\/b>/.test(last(-3).p.text) && /PENDIENTE A COTIZAR/.test(last(-3).p.text) && /Queda sumando el resto/.test(last(-3).p.text), last(-3).p.text); // #1101
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
  const cbMenu = (chat, data, kb, mid = 6100) => hook({ callback_query: { id: 'q' + Math.random(), data, from: { first_name: 'Ana' }, message: { message_id: mid, chat: { id: chat, type: 'supergroup', title: 'x' }, reply_markup: kb } } });
  const alertOf = () => sent.filter((x) => x.method === 'answerCallbackQuery').slice(-1)[0].p;
  await caso('#1085 Cotizar: pide precio USDT + comisión, hace la cuenta; Enviado: foto ⇒ VERIFICADO ENVIADO; nada va al grupo 1', async () => {
    const n1 = sent.filter((x) => String(x.p.chat_id) === '-1').length; const pend = RcptClose.rows.filter((x) => x.toChat === '-3' && x.status === 'pending'); assert.ok(pend.length, 'hay pendiente');
    const pesos = pend.reduce((a, x) => a + x.total, 0);
    await cbMenu(-3, 'rbm:quote', ctx._RB_DST_KB); const pq = last(-3); assert.ok(/^💱 COTIZAR/.test(pq.p.text) && pq.p.reply_markup.force_reply, pq.p.text);
    await hook({ message: { message_id: 900, chat: { id: -3, type: 'supergroup', title: 'fichasnuevobot' }, from: { first_name: 'Ana' }, text: 'hola', reply_to_message: { message_id: 1, from: { is_bot: true }, text: pq.p.text.replace(/<[^>]+>/g, '') } } });
    assert.ok(/No entendí/.test(last(-3).p.text)); assert.ok(RcptClose.rows.filter((x) => x.toChat === '-3').some((x) => x.status === 'pending'));
    await hook({ message: { message_id: 901, chat: { id: -3, type: 'supergroup', title: 'fichasnuevobot' }, from: { first_name: 'Ana' }, text: '1.150 2%', reply_to_message: { message_id: 1, from: { is_bot: true }, text: pq.p.text.replace(/<[^>]+>/g, '') } } });
    const q = last(-3).p.text; const neto = pesos / 1150 * 0.98; const fmt = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.ok(/COTIZADO/.test(q) && q.includes('A ENVIAR: ' + fmt(neto) + ' USDT') && /comisión 2%/.test(q) && /SUMA ACTUALIZADA/.test(q), q);
    assert.ok(RcptClose.rows.filter((x) => x.toChat === '-3').every((x) => x.status !== 'pending'));
    await cbMenu(-3, 'rbm:quote', ctx._RB_DST_KB); assert.ok(alertOf().show_alert && /No hay nada PENDIENTE A COTIZAR/.test(alertOf().text), JSON.stringify(alertOf()));
    await cbMenu(-3, 'rbm:sent', ctx._RB_DST_KB); const ps = last(-3); assert.ok(/^📸 ENVIADO/.test(ps.p.text) && ps.p.text.includes(fmt(neto) + ' USDT'), ps.p.text);
    const rt = { message_id: 2, from: { is_bot: true }, text: ps.p.text.replace(/<[^>]+>/g, '') };
    await hook({ message: { message_id: 902, chat: { id: -3, type: 'supergroup', title: 'fichasnuevobot' }, from: { first_name: 'Ana' }, text: 'listo', reply_to_message: rt } }); assert.ok(/Mandá la <b>FOTO/.test(last(-3).p.text));
    await hook({ message: { message_id: 903, chat: { id: -3, type: 'supergroup', title: 'fichasnuevobot' }, from: { first_name: 'Ana' }, photo: [{ file_id: 'usdt1' }], reply_to_message: rt } });
    const v = last(-3).p.text; assert.ok(/VERIFICADO ENVIADO/.test(v) && /Sin cierres pendientes/.test(v), v);
    assert.ok(RcptClose.rows.filter((x) => x.toChat === '-3').every((x) => x.status === 'sent' || x.status === 'pending') && RcptClose.rows.some((x) => x.sentPhoto === 'usdt1'));
    assert.strictEqual(RcptFwd.rows.filter((x) => x.toChat === '-3' && x.status === 'open').length, 0, 'el foto no se tomó como comprobante');
    assert.strictEqual(sent.filter((x) => String(x.p.chat_id) === '-1').length, n1, 'nada al grupo 1');
  });
  await caso('#1084 botones del menú ⇒ cartel (sin mensaje); confirmar cambia los botones del mismo menú', async () => {
    const n = sent.filter((x) => x.method === 'sendMessage').length;
    await cbMenu(-3, 'rbm:total', ctx._RB_DST_KB); assert.ok(alertOf().show_alert && /SUMA ACTUALIZADA/.test(alertOf().text) && alertOf().text.length <= 200, alertOf().text);
    await cbMenu(-3, 'rbm:cbu', ctx._RB_DST_KB); assert.ok(/CBU DE BAJADA/.test(alertOf().text));
    await cbMenu(-3, 'rbm:help', ctx._RB_DST_KB); assert.ok(/\/cotizado/.test(alertOf().text));
    await cbMenu(-1, 'rbm:total', ctx._RB_SRC_KB); assert.ok(/SUMA ACTUALIZADA/.test(alertOf().text) && /Mes:/.test(alertOf().text), alertOf().text);
    assert.strictEqual(sent.filter((x) => x.method === 'sendMessage').length, n, 'ningún mensaje');
    await cbMenu(-1, 'rbm:close', ctx._RB_SRC_KB); const ed = sent.filter((x) => x.method === 'editMessageReplyMarkup').slice(-1)[0];
    assert.ok(/Sí, confirmar/.test(ed.p.reply_markup.inline_keyboard[0][0].text) && /CIERRE del TOTAL/.test(alertOf().text));
    await cbMenu(-1, 'rbm:no', ed.p.reply_markup); const ed2 = sent.filter((x) => x.method === 'editMessageReplyMarkup').slice(-1)[0]; assert.strictEqual(ed2.p.reply_markup, ctx._RB_SRC_KB, 'vuelve el menú');
    await cbIn(-1, 'rbm:help', 6200); const ed3 = sent.filter((x) => x.method === 'editMessageReplyMarkup').slice(-1)[0]; assert.ok(ed3.p.message_id === 6200 && ed3.p.reply_markup === ctx._RB_SRC_KB, 'Ver comandos abre los botones');
    assert.strictEqual(sent.filter((x) => x.method === 'sendMessage').length, n, 'ningún mensaje');
  });
  await caso('cada suma trae el botón 📋 Ver comandos y abre el menú; terminación mal avisa con TERMINACIÓN MAL', async () => {
    cfgDocs[0].value.structs[0].routes[0].rules = [{ cents: '99', to: '-2' }]; cfgDocs[0].value.structs[0].routes[0].otherTo = null; await ctx._rbCfg(true);
    aiAmount = 300.99; await hook(photo(60)); const r = last(-1); const kb = r.p.reply_markup.inline_keyboard; assert.ok(kb[kb.length - 1][0].callback_data === 'rbm:help', JSON.stringify(kb));
    const cp = sent.filter((x) => x.method === 'copyMessage').slice(-1)[0]; assert.ok(cp.p.reply_markup && cp.p.reply_markup.inline_keyboard.some((x) => x[0].callback_data === 'rbm:help'));
    await cbIn(-1, 'rbm:help', 6300); assert.ok(sent.filter((x) => x.method === 'editMessageReplyMarkup').slice(-1)[0].p.reply_markup === ctx._RB_SRC_KB);
    await cbIn(-2, 'rbm:help', 6301); assert.ok(sent.filter((x) => x.method === 'editMessageReplyMarkup').slice(-1)[0].p.reply_markup === ctx._RB_DST_KB);
    aiAmount = 300.43; await hook(photo(61)); assert.ok(/TERMINACIÓN MAL<\/b>: \$300,43 termina en <b>,43/.test(last(-1).p.text) && /elegí a qué grupo va/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('cada grupo con su decimal: ,43 en el grupo del ,99 avisa que es del otro grupo', async () => {
    cfgDocs[0].value.groups.push({ id: '-4', title: 'grupo43', bots: ['111'] });
    cfgDocs[0].value.structs[0].routes.push({ from: '-4', rules: [{ cents: '43', to: '-3' }], otherTo: null }); await ctx._rbCfg(true);
    aiAmount = 800.43; await hook(photo(70)); const t = last(-1).p.text; assert.ok(/TERMINACIÓN MAL/.test(t) && /,43<\/b> es de <b>grupo43/.test(t), t);
    const kb = last(-1).p.reply_markup.inline_keyboard; assert.ok(kb.length === 1 && /,99 → asuncionbot/.test(kb[0][0].text), JSON.stringify(kb));
    await hook({ message: { message_id: 71, chat: { id: -4, type: 'supergroup', title: 'grupo43' }, from: { first_name: 'Ana' }, photo: [{ file_id: 'f71' }] } });
    assert.ok(sent.filter((x) => x.method === 'copyMessage').slice(-1)[0].p.chat_id === '-3' && /REENVIADO<\/b> a fichasnuevobot/.test(last(-4).p.text), last(-4).p.text);
  });
  await caso('#1105 corregir el monto de uno YA reenviado con otro decimal ⇒ se mueve; los dos grupos ven qué pasó', async () => {
    const st = cfgDocs[0].value.structs[0]; const keep = JSON.stringify(st.routes);
    st.routes[0] = { from: '-1', rules: [{ cents: '99', to: '-2' }, { cents: '43', to: '-3' }], otherTo: null }; await ctx._rbCfg(true);
    aiAmount = 1500.99; await hook(photo(72)); const rec = RcptFwd.rows.find((x) => x.srcMsgId === 72); assert.strictEqual(rec.toChat, '-2');
    await hook(text(73, -1, '1500,43', 72)); assert.strictEqual(rec.toChat, '-3'); assert.strictEqual(rec.amount, 1500.43);
    const an = sent.filter((x) => String(x.p.chat_id) === '-2').slice(-1)[0].p.text; assert.ok(/ANULADO · MONTO CORREGIDO/.test(an) && /no era de este grupo/.test(an), an);
    const cp = sent.filter((x) => x.method === 'copyMessage' && String(x.p.chat_id) === '-3').slice(-1)[0].p.caption; assert.ok(/MONTO CORREGIDO<\/b> por Ana: la foto decía \$1\.500,99 \(decimal mal\)/.test(cp) && /se sacó de asuncionbot/.test(cp), cp);
    await hook(text(74, -1, '1600,43', 72)); assert.strictEqual(rec.amount, 1600.43); assert.ok(/MONTO CORREGIDO<\/b> por Ana: era \$1\.500,43 ⇒ <b>\$1\.600,43/.test(last(-3).p.text), last(-3).p.text);
    rec.status = 'closed'; st.routes = JSON.parse(keep); await ctx._rbCfg(true);
  });
  const photoU = (id, uid, chat = -1) => ({ message: { message_id: id, chat: { id: chat, type: 'supergroup', title: 'buffalobot' }, from: { first_name: 'Ana' }, photo: [{ file_id: 'f' + id, file_unique_id: uid }] } });
  const openSum = (to) => RcptFwd.rows.filter((x) => x.toChat === to && x.status === 'open').reduce((a, x) => a + x.amount, 0);
  await caso('DUPLICADO sin cotizar: avisa, NO suma; "es otro" lo suma', async () => {
    aiAmount = 4000.99; await hook(photoU(80, 'U1')); const s0 = openSum('-2');
    await hook(photoU(81, 'U1')); assert.ok(/COMPROBANTE DUPLICADO · NO SE SUMA/.test(last(-1).p.text), last(-1).p.text); assert.strictEqual(openSum('-2'), s0);
    const btn = last(-1).p.reply_markup.inline_keyboard[0][0]; assert.ok(/Es otro/.test(btn.text));
    await cbIn(-1, btn.callback_data); assert.ok(Math.abs(openSum('-2') - s0 - 4000.99) < 0.01);
  });
  await caso('duplicado de algo ya COTIZADO ⇒ no se detecta (se suma normal)', async () => {
    aiAmount = 7000.99; await hook(photoU(82, 'U2')); await hook(text(83, -1, '/cierre')); await hook(text(84, -2, '/cotizado'));
    const s0 = openSum('-2'); await hook(photoU(85, 'U2')); assert.ok(/REENVIADO/.test(last(-1).p.text), last(-1).p.text); assert.ok(Math.abs(openSum('-2') - s0 - 7000.99) < 0.01);
  });
  await caso('duplicado de algo CERRADO pero sin cotizar ⇒ sí se detecta', async () => {
    aiAmount = 9000.99; await hook(photoU(86, 'U3')); await hook(text(87, -1, '/cierre'));
    await hook(photoU(88, 'U3')); assert.ok(/DUPLICADO/.test(last(-1).p.text) && /ya entró en un cierre/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('/restar en los dos grupos y /anular respondiendo un comprobante', async () => {
    aiAmount = 2000.99; await hook(photoU(90, 'U4')); const s0 = openSum('-2');
    await hook(text(91, -2, '/restar 500'));  assert.ok(/RESTADO<\/b>: −\$500/.test(last(-2).p.text) && !/RESTADO/.test(last(-1).p.text), 'desde el grupo 2 no avisa al 1 (#1084)'); assert.ok(Math.abs(openSum('-2') - (s0 - 500)) < 0.01);
    const rec = RcptFwd.rows.find((x) => x.srcMsgId === 90);
    await hook(text(92, -2, '/anular', rec.fwdMsgId)); assert.strictEqual(rec.status, 'anulado'); assert.ok(/ANULADO<\/b>: −\$2\.000,99/.test(last(-2).p.text) && !/ANULADO/.test(last(-1).p.text), 'desde el grupo 2 queda en el 2 (#1084)');
    assert.ok(Math.abs(openSum('-2') - (s0 - 500 - 2000.99)) < 0.01);
    aiAmount = 100.99; await hook(photoU(93, 'U5')); await hook(text(94, -1, '/anular', 93)); assert.strictEqual(RcptFwd.rows.find((x) => x.srcMsgId === 93).status, 'anulado');
    await hook(text(95, -1, '/anular')); assert.ok(/respondé ese comprobante/.test(last(-1).p.text));
  });
  await caso('CBU: /nuevocbu muestra cómo completar; con datos pide confirmar; confirmado cambia la terminación y avisa al grupo 1', async () => {
    cfgDocs[0].value.structs[0].routes = [{ from: '-1', rules: [{ cents: '99', to: '-2' }], otherTo: null }]; await ctx._rbCfg(true);
    await hook(text(100, -2, '/nuevocbu')); assert.ok(/Titular:/.test(last(-2).p.text) && /Terminación: ,/.test(last(-2).p.text));
    await hook(text(101, -2, '/nuevocbu\nTitular: Juan Perez\nCBU: 123')); assert.ok(/Falta o está mal: <b>CBU \(22 números\), Terminación/.test(last(-2).p.text), last(-2).p.text);
    await hook(text(102, -2, '/nuevocbu\nTitular: Juan Perez\nCBU: 0000003100012345678901\nAlias: juan.perez.mp\nTerminación: ,82'));
    const pv = last(-2); assert.ok(/REVISÁ EL CBU NUEVO/.test(pv.p.text) && /,82/.test(pv.p.text) && /Cambia YA/.test(pv.p.text), pv.p.text);
    await cbIn(-2, pv.p.reply_markup.inline_keyboard[0][0].callback_data);
    assert.strictEqual(cfgDocs[0].value.structs[0].routes[0].rules[0].cents, '82');
    const n1 = sent.filter((x) => String(x.p.chat_id) === '-1' && /CAMBIO DE CBU/.test(x.p.text || '')).slice(-1)[0]; assert.ok(n1 && /juan\.perez\.mp/.test(n1.p.text) && /anterior <b>,99/.test(n1.p.text), n1 && n1.p.text);
    assert.ok(sent.some((x) => x.method === 'pinChatMessage' && String(x.p.chat_id) === '-1'));
    assert.ok(/CBU NUEVO ACTIVO/.test(last(-2).p.text) && /se dio aviso/.test(last(-2).p.text));
    await ctx._rbCfg(true); aiAmount = 100.82; await hook(photo(103)); assert.ok(/REENVIADO<\/b> a asuncionbot/.test(last(-1).p.text), last(-1).p.text);
    aiAmount = 100.99; await hook(photo(104)); assert.ok(/REENVIADO<\/b> a asuncionbot/.test(last(-1).p.text), 'la anterior ,99 se acepta 24 h: ' + last(-1).p.text);
    await hook(text(105, -1, '/cbu')); assert.ok(/VIGENTE/.test(last(-1).p.text) && /Juan Perez/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('CBU: /parar avisa al grupo 1 y le dice al que lo puso que use /nuevocbu; los reenvíos avisan', async () => {
    await hook(text(110, -2, '/parar')); assert.ok(/SIN CBU DE BAJADA/.test(last(-1).p.text) && /PARADO<\/b> por Ana/.test(last(-2).p.text) && /\/nuevocbu/.test(last(-2).p.text), last(-2).p.text);
    await ctx._rbCfg(true); aiAmount = 50.82; await hook(photo(111)); assert.ok(/SIN CBU de bajada/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('CBU programado: avisa ya y cambia SOLO en la fecha; al vencer sin otro avisa sin CBU', async () => {
    NOW = new Date('2026-12-02T15:00:00Z');
    await hook(text(120, -2, '/nuevocbu\nTitular: Ana Gomez\nCBU: 0000003100099999999999\nAlias: ana.g\nTerminación: ,43\nDesde: 03/12 13:00\nHasta: 05/12 13:00'));
    const pv = last(-2); assert.ok(/PROGRAMADO/.test(pv.p.text), pv.p.text); await cbIn(-2, pv.p.reply_markup.inline_keyboard[0][0].callback_data);
    assert.ok(/CBU PROGRAMADO/.test(last(-1).p.text) && /Cambia SOLO el 3\/12/.test(last(-1).p.text), last(-1).p.text);
    assert.strictEqual(cfgDocs[0].value.structs[0].routes[0].rules[0].cents, '82');
    await ctx._rbCbuTick(); assert.strictEqual(cfgDocs[0].value.structs[0].routes[0].rules[0].cents, '82', 'todavía no');
    NOW = new Date('2026-12-03T16:01:00Z'); await ctx._rbCbuTick(); assert.strictEqual(cfgDocs[0].value.structs[0].routes[0].rules[0].cents, '43');
    assert.ok(/CAMBIO DE CBU/.test(last(-1).p.text) && /Ana Gomez/.test(last(-1).p.text), last(-1).p.text);
    NOW = new Date('2026-12-05T16:01:00Z'); await ctx._rbCbuTick(); assert.ok(/SIN CBU DE BAJADA/.test(last(-1).p.text), last(-1).p.text);
  });
  await caso('/guia manda el archivo de cada lado', async () => {
    await hook(text(130, -1, '/guia')); const g1 = sent.filter((x) => x.method === 'sendMedia:document').slice(-1)[0]; assert.ok(g1 && g1.p.chat_id === '-1' && /ENVÍAN/.test(g1.p.caption), JSON.stringify(g1 && g1.p));
    await hook(text(131, -2, '/guia')); const g2 = sent.filter((x) => x.method === 'sendMedia:document').slice(-1)[0]; assert.ok(g2 && g2.p.chat_id === '-2' && /RECIBEN/.test(g2.p.caption));
    const G = require(require('path').join(__dirname, '..', 'src/utils/rcptbotGuides'));
    const a = G.src({ group: 'G1', rules: [{ cents: '82', to: 'G2' }] }); const b = G.dst({ group: 'G2', sources: ['G1'] });
    assert.ok(!/→  G2/.test(a) && /CORREGIR UN MONTO/.test(a) && /\/cierre 500\.000/.test(a) && /\/nuevocbu/.test(b) && /\/parar/.test(b) && /\/cotizado/.test(b));
  });
  await caso('#1087 grupo que pasa a SUPERGRUPO (cambia de ID): estructura, lista y sumas abiertas pasan al ID nuevo', async () => {
    const refs = (id) => JSON.stringify(cfgDocs[0].value.structs).split('"' + id + '"').length - 1;
    const had = refs('-2'); assert.ok(had > 0, 'la estructura usa -2'); const open2 = RcptFwd.rows.filter((x) => x.toChat === '-2' && x.status === 'open').length;
    await hook({ message: { message_id: 1, chat: { id: -1009, type: 'supergroup', title: 'asuncionbot' }, from: { first_name: 'Ana' }, migrate_from_chat_id: -2 } });
    assert.strictEqual(refs('-2'), 0, 'no queda el ID viejo'); assert.strictEqual(refs('-1009'), had, 'el ID nuevo en su lugar');
    const gs = cfgDocs[0].value.groups; assert.ok(gs.some((g) => g.id === '-1009' && g.title === 'asuncionbot') && !gs.some((g) => g.id === '-2'), JSON.stringify(gs));
    assert.strictEqual(RcptFwd.rows.filter((x) => x.toChat === '-1009' && x.status === 'open').length, open2);
    await hook({ message: { message_id: 2, chat: { id: -2, type: 'group', title: 'asuncionbot' }, from: { first_name: 'Ana' }, migrate_to_chat_id: -1009 } }); // el aviso del grupo viejo no lo hace dos veces
    assert.strictEqual(cfgDocs[0].value.groups.filter((g) => g.id === '-1009').length, 1);
  });
  await caso('#1104 grupo de FICHAS: sin cierres en el mes; día 1 cierra, /fichas resta y la diferencia arranca la cuenta nueva', async () => {
    const st = cfgDocs[0].value.structs[0]; st.routes = [{ from: '-1', rules: [{ cents: '43', to: '-1009' }], otherTo: null }]; st.fichasDests = ['-1009']; st.monthlyClose = true; await ctx._rbCfg(true);
    for (const x of RcptFwd.rows) if (x.toChat === '-1009' && x.status === 'open') x.status = 'closed';
    NOW = new Date('2026-12-15T15:00:00Z'); aiAmount = 100000.43; await hook(photo(400)); aiAmount = 50000.43; await hook(photo(401));
    const cap = (last(-1009).p.caption || last(-1009).p.text || ''); assert.ok(/Suma del mes: <b>\$150\.001<\/b>/.test(cap) && !/COTIZAR/.test(cap), cap);
    const n0 = RcptClose.rows.length; NOW = new Date('2026-12-16T16:05:00Z'); await ctx._rbCloseTick(); assert.strictEqual(RcptClose.rows.length, n0, 'sin cierre de 13 h ' + JSON.stringify(RcptClose.rows.slice(n0)));
    await hook(text(402, -1, '/cierre')); assert.strictEqual(RcptClose.rows.length, n0, 'sin cierre a mano');
    NOW = new Date('2027-01-01T03:05:00Z'); await ctx._rbMonthCloseTick(); const cl = RcptClose.rows.slice(n0).filter((x) => x.toChat === '-1009');
    assert.ok(cl.length === 1 && cl[0].status === 'fichas' && cl[0].fichasMonth === 'diciembre 2026', JSON.stringify(cl));
    assert.ok(sent.some((x) => String(x.p.chat_id) === '-1009' && /CIERRE DE DICIEMBRE 2026/.test(x.p.text || '')), 'mensaje de cierre');
    await hook(text(403, -1009, '/fichas 160.000')); const t = last(-1009).p.text; assert.ok(/FICHAS DICIEMBRE 2026 · COMPLETADO/.test(t) && /Diferencia: <b>−\$9\.999/.test(t) && /arranca en/.test(t), t);
    assert.strictEqual(cl[0].status, 'fichasdone');
    aiAmount = 4000.43; await hook(photo(404)); let c2 = last(-1009).p.caption || last(-1009).p.text; assert.ok(/falta \$5\.99/.test(c2), c2);
    aiAmount = 6000.43; await hook(photo(405)); c2 = last(-1009).p.caption || last(-1009).p.text; assert.ok(/pendiente cubierto/.test(c2), c2);
  });
  await caso('#1101 Cotizaciones: el grupo 1 cotiza y manda su foto APARTE; no toca el estado del grupo 2', async () => {
    const st = cfgDocs[0].value.structs[0]; st.routes = [{ from: '-1', rules: [{ cents: '79', to: '-3' }], otherTo: null }]; st.fichasDests = []; st.srcQuote = true; st.monthlyClose = false; await ctx._rbCfg(true);
    for (const x of RcptFwd.rows) if (x.status === 'open') x.status = 'closed';
    NOW = new Date('2027-01-05T15:00:00Z'); aiAmount = 115000.79; await hook(photo(900)); aiAmount = 230000.79; await hook(photo(901));
    await hook(text(902, -1, '/cierre')); const btn = last(-1).p.reply_markup && JSON.stringify(last(-1).p.reply_markup); if (/rbc/.test(btn || '')) { const d = last(-1).p.reply_markup.inline_keyboard[0][0].callback_data; await cbIn(-1, d); }
    const cl = RcptClose.rows[RcptClose.rows.length - 1]; assert.ok(cl.srcStatus === 'pending' && cl.status === 'pending' && Math.abs(cl.total - 345001.58) < 0.01, JSON.stringify(cl));
    await cbIn(-1, 'rbm:squote'); const ask = last(-1).p.text; assert.ok(/EQUIPO · COTIZAR/.test(ask) && /\$345\.002/.test(ask), ask);
    const rq = (id, t, extra) => hook({ message: Object.assign({ message_id: id, chat: { id: -1, type: 'supergroup', title: 'buffalobot' }, from: { first_name: 'Ana' }, text: t, reply_to_message: { message_id: 5, from: { is_bot: true }, text: extra } }) });
    await rq(903, '1150 0', ask); const q = last(-1).p.text; assert.ok(/COTIZADO/.test(q) && /A ENVIAR: 300,00 USDT/.test(q), q);
    assert.ok(cl.srcStatus === 'quoted' && cl.status === 'pending', 'el grupo 2 sigue pendiente a cotizar');
    await cbIn(-1, 'rbm:ssent'); const ask2 = last(-1).p.text; assert.ok(/EQUIPO · ENVIADO/.test(ask2), ask2);
    const nFwd = RcptFwd.rows.length; await hook({ message: { message_id: 904, chat: { id: -1, type: 'supergroup', title: 'buffalobot' }, from: { first_name: 'Ana' }, photo: [{ file_id: 'usdt' }], reply_to_message: { message_id: 6, from: { is_bot: true }, text: ask2 } } });
    assert.strictEqual(RcptFwd.rows.length, nFwd, 'la foto de USDT NO se toma como comprobante'); assert.ok(cl.srcStatus === 'sent' && cl.status === 'pending', JSON.stringify(cl));
    assert.ok(/VERIFICADO ENVIADO/.test(last(-1).p.text), last(-1).p.text); st.srcQuote = false; await ctx._rbCfg(true);
  });
  await caso('#1106 bienvenida: en cada grupo presentación FIJADA → archivo → aviso de /anterior; una sola vez sin forzar', async () => {
    const c = await ctx._rbCfg(true); const st = c.structs[0]; const n0 = sent.length;
    const out = await ctx._rbWelcomeStruct(c, st, false); const chats = [...new Set(out.map((x) => x.group))]; assert.ok(out.length >= 2 && out.every((x) => x.ok), JSON.stringify(out));
    for (const r of c.routes.filter((x) => x.structId === st.id)) {
      const seq = sent.slice(n0).filter((x) => String(x.p.chat_id) === String(r.from)).map((x) => x.method + ':' + String(x.p.text || x.p.caption || '').slice(0, 25));
      assert.ok(/^sendMessage:👋 <b>BIENVENIDOS/.test(seq[0]) && /^pinChatMessage/.test(seq[1]) && /^sendMedia:document/.test(seq[2]) && /^sendMessage:📥 <b>La suma arranca/.test(seq[3]), JSON.stringify(seq));
      const w = sent.slice(n0).find((x) => String(x.p.chat_id) === String(r.from) && /BIENVENIDOS/.test(x.p.text || '')).p.text; assert.ok(!/asuncionbot|fichasnuevobot|→/.test(w), 'el grupo 1 no dice adónde va: ' + w);
    }
    const n1 = sent.length; await ctx._rbWelcomeStruct(c, st, false); assert.strictEqual(sent.length, n1, 'sin forzar no se repite');
    await ctx._rbWelcomeStruct(c, st, true); assert.ok(sent.length > n1, 'forzado (botón del panel) sí');
  });
  await caso('#1106 diagnóstico del plan: no existe / bot que no está / parecidos / ID fijado', async () => {
    const c = { bots: [{ id: '1', username: 'b1' }, { id: '2', username: 'b2' }], groups: [{ id: '-10', title: 'BAJADAS JOKER', bots: ['2'] }, { id: '-11', title: 'BAJADAS S1', bots: ['1'] }, { id: '-12', title: 'BAJADAS S1 viejo', bots: ['1'] }, { id: '-13', title: 'x BAJADAS S1', bots: ['1'] }] };
    let d = ctx._rbPlanGroup(c, 'BAJADAS PORTO', '1', 'b1', {}, 'src'); assert.ok(!d.g && /Ningún bot vio/.test(d.why) && /ADMINISTRADOR/.test(d.fix) && /ID/.test(d.fix), JSON.stringify(d));
    d = ctx._rbPlanGroup(c, 'BAJADAS JOKER', '1', 'b1', {}, 'src'); assert.ok(!d.g && /@b1 no está/.test(d.why) && d.cands[0].id === '-10', JSON.stringify(d));
    d = ctx._rbPlanGroup(c, 'BAJADAS S1', '1', 'b1', {}, 'src'); assert.strictEqual(d.g && d.g.id, '-11', 'el nombre exacto gana');
    d = ctx._rbPlanGroup(c, 'S1', '1', 'b1', {}, 'dst'); assert.ok(!d.g && /3 grupos con nombre parecido/.test(d.why) && d.cands.length === 3, JSON.stringify(d));
    d = ctx._rbPlanGroup(c, 'S1', '1', 'b1', { s1: '-13' }, 'dst'); assert.strictEqual(d.g && d.g.id, '-13', 'ID fijado a mano');
  });
  await caso('#1106 plan: con los nombres reales arma Sector 1 encendida (BAJADAS S1 → ,33) y explica qué falta en las demás', async () => {
    const rc = cfgDocs[0].value; const keepG = JSON.stringify(rc.groups), keepS = JSON.stringify(rc.structs), keepB = JSON.stringify(rc.bots);
    rc.bots.push({ id: '777', username: 'Sectorunobot', tokenEnc: '777:TOKEN', secret: 'S7' });
    rc.groups.push({ id: '-700', title: 'BAJADAS S1', bots: ['777'] }, { id: '-701', title: 'S1 Racafu ,33', bots: ['777'] });
    await ctx._rbCfg(true); const n0 = sent.length; await ctx._rbPlanRun();
    const st = rc.structs.find((x) => x.name === 'Sector 1'); assert.ok(st && st.on && st.botId === '777' && st.dailyClose === 'weekdays', JSON.stringify(st));
    assert.strictEqual(JSON.stringify(st.routes.map((r) => [r.from, r.rules])), JSON.stringify([['-700', [{ cents: '33', to: '-701' }]]]));
    const rep = cfgDocs.find((d) => d.key === 'rcptbotplan').value; assert.ok(rep.applied['Sector 1'] === ctx.RB_PLAN.v && rep.report['Sector 1'].ok, JSON.stringify(rep.report['Sector 1']));
    const f = rep.report.Fichas; assert.ok(f && !f.ok && f.detail.some((d) => d.kind === 'bot' && /fichasnuevobot/.test(d.why)), JSON.stringify(f));
    assert.ok(!rc.structs.find((x) => x.name === 'Fichas' && x.on), 'lo incompleto queda apagado');
    assert.ok(sent.slice(n0).some((x) => String(x.p.chat_id) === '-700' && /BIENVENIDOS/.test(x.p.text || '')) && sent.slice(n0).some((x) => String(x.p.chat_id) === '-701' && /BIENVENIDOS/.test(x.p.text || '')), 'bienvenida en los 2 grupos');
    aiAmount = 20000.33; await hook(Object.assign(photo(800, -700), {})); // un comprobante real llega a S1 Racafu
    rc.groups = JSON.parse(keepG); rc.structs = JSON.parse(keepS); rc.bots = JSON.parse(keepB); await ctx._rbCfg(true);
  });
  await caso('bienvenida SÓLO si todo está bien: bot no admin en un grupo que manda ⇒ nada en espera; al arreglarlo sale', async () => {
    const rc = cfgDocs[0].value; const keepG = JSON.stringify(rc.groups), keepS = JSON.stringify(rc.structs);
    rc.groups.push({ id: '-800', title: 'G800', bots: ['111'] }, { id: '-801', title: 'G801', bots: ['111'] });
    rc.structs = [{ id: 'W1', name: 'Wtest', on: true, botId: '111', routes: [{ from: '-800', rules: [{ cents: '99', to: '-801' }], otherTo: null }] }]; const c = await ctx._rbCfg(true);
    global.TG_MEMBER = { '-800': 'member' }; const n0 = sent.length; let r = await ctx._rbWelcomeIfReady(c, c.structs[0]);
    assert.ok(r.wait && /G800.*ADMINISTRADOR/.test(r.wait.join()), JSON.stringify(r)); assert.ok(!sent.slice(n0).some((x) => /BIENVENIDOS/.test(x.p.text || '')), 'no manda nada');
    assert.ok(cfgDocs.find((d) => d.key === 'rcptbotplan').value.welcome.Wtest.wait.length === 1);
    global.TG_MEMBER = { '-800': 'left' }; r = await ctx._rbWelcomeIfReady(c, c.structs[0]); assert.ok(/NO está en el grupo/.test(r.wait.join()), JSON.stringify(r));
    global.TG_MEMBER = {}; r = await ctx._rbWelcomeIfReady(c, c.structs[0]); assert.ok(r.sent && r.sent.length === 2 && r.sent.every((x) => x.ok), JSON.stringify(r));
    assert.ok(cfgDocs.find((d) => d.key === 'rcptbotplan').value.welcome.Wtest.sent);
    const n1 = sent.length; r = await ctx._rbWelcomeIfReady(c, c.structs[0]); assert.ok(r.done && sent.length === n1, 'ya la tienen: ni revisa');
    rc.groups = JSON.parse(keepG); rc.structs = JSON.parse(keepS); await ctx._rbCfg(true);
  });
  await caso('#1112 dos bots nuestros en el grupo 2: /suma lo contesta el de la estructura aunque el otro lo reciba primero', async () => {
    const rc = cfgDocs.find((d) => d.key === 'rcptbot').value; rc.bots.push({ id: '222', username: 'b222', tokenEnc: '222:TOKEN', secret: 'S2' }); rc.groups.find((g) => g.id === '-3').bots.push('222'); await ctx._rbCfg(true);
    const hook2 = async (update) => { const req = { params: { bot: '222' }, get: () => 'S2', body: update }; const res = { headersSent: false, status() { return this; }, end() {}, json() { this.headersSent = true; } }; await routes['POST /api/rcptbot/webhook/:bot'](req, res); };
    const n = sent.length; await hook2(text(990, -3, '/suma 12.613.986')); assert.strictEqual(sent.slice(n).filter((x) => String(x.p.chat_id) === '-3').length, 0, 'el otro bot no contesta ni reserva');
    await hook(text(990, -3, '/suma 12.613.986')); assert.ok(/SUMADO LO ANTERIOR<\/b>: \+\$12\.613\.986/.test(last(-3).p.text), last(-3).p.text);
    rc.bots.pop(); rc.groups.find((g) => g.id === '-3').bots.pop(); await ctx._rbCfg(true);
  });
  await caso('#1112-b el MISMO bot en 2 estructuras que mandan al mismo grupo 2 (Ganamos + Publicidad ⇒ 3P 2G): /suma contesta una sola vez', async () => {
    const rc = cfgDocs.find((d) => d.key === 'rcptbot').value; rc.groups.push({ id: '-7', title: 'publicidad', bots: ['111'] });
    rc.structs.push({ id: 'E7', name: 'Publicidad', on: true, botId: '111', routes: [{ from: '-7', rules: [{ cents: '99', to: '-3' }], otherTo: null }] }); await ctx._rbCfg(true);
    const n = sent.length; await hook(text(995, -3, '/suma 1.000')); await hook(text(995, -3, '/suma 1.000'));
    const out = sent.slice(n).filter((x) => String(x.p.chat_id) === '-3' && /SUMADO LO ANTERIOR/.test(x.p.text || '')); assert.strictEqual(out.length, 1, 'una sola respuesta');
    rc.structs.pop(); rc.groups.pop(); await ctx._rbCfg(true);
  });
  await caso('#1113 /restar SÓLO en el grupo donde se escribe (grupo 1 y grupo 2), puede quedar a favor (negativo)', async () => {
    const snap = () => JSON.stringify(RcptFwd.rows.filter((x) => x.status === 'open' && x.fromChat === '-1').map((x) => x.amount));
    const s0 = snap(); const n = sent.length;
    await hook(text(996, -1, '/restar 50.000')); assert.ok(/RESTADO<\/b>: −\$50\.000/.test(last(-1).p.text) && /Sólo en la cuenta de este grupo/.test(last(-1).p.text), last(-1).p.text);
    assert.strictEqual(snap(), s0, 'no toca lo reenviado al grupo 2'); assert.ok(!sent.slice(n).some((x) => ['-2', '-3'].includes(String(x.p.chat_id))), 'el grupo 2 no se entera');
    const n2 = sent.length; await hook(text(997, -3, '/restar 99.999.999')); const t = last(-3).p.text; assert.ok(/RESTADO<\/b>: −\$99\.999\.999/.test(t) && /−\$/.test(t.split('\n').slice(2).join('\n')), t);
    assert.ok(!sent.slice(n2).some((x) => String(x.p.chat_id) === '-1'), 'el grupo 1 no se entera');
  });
  await caso('#1110 empezar de cero: borra SÓLO lo del bot desde la hora, desfija lo del bot, cuentas a $0, presentación de nuevo', async () => {
    const since = NOW.getTime() - 3600000; const chat = '-3'; const msgs = {}; // id ⇒ { mine, date }
    for (let i = 1; i <= 30; i++) msgs[i] = { mine: i % 3 !== 0, date: (i <= 10 ? since - 60000 : since + i * 1000) / 1000 };
    let pinned = [25, 7]; const del = [];
    global.TG_EXTRA = (tok, m, p) => { if (String(p.chat_id) !== chat) return null;
      if (m === 'sendMessage' && /Ordenando/.test(p.text)) { msgs[31] = { mine: true, date: NOW.getTime() / 1000 }; return { ok: true, result: { message_id: 31 } }; }
      if (m === 'editMessageReplyMarkup') { const x = msgs[p.message_id]; return x && x.mine ? { ok: true, result: { message_id: p.message_id, date: x.date } } : { ok: false, error: "message can't be edited" }; }
      if (m === 'deleteMessage') { del.push(p.message_id); delete msgs[p.message_id]; pinned = pinned.filter((x) => x !== p.message_id); return { ok: true }; }
      if (m === 'getChat') { const id = pinned[0]; return { ok: true, result: id ? { pinned_message: { message_id: id, from: { id: msgs[id] && msgs[id].mine ? Number(tok.split(':')[0]) : 1 } } } : {} }; }
      if (m === 'unpinChatMessage') { pinned = pinned.filter((x) => x !== p.message_id); return { ok: true }; }
      return null; };
    const call = async (body) => { let out = null, code = 200; await routes['POST /api/admin/rcptbot/clean']({ body, user: { username: 'admin', role: 'admin' } }, { status(c) { code = c; return this; }, json(j) { out = j; } }); return { code, out }; };
    assert.strictEqual((await call({ since: new Date(since).toISOString(), msgs: true })).code, 400, 'sin BORRAR no arranca');
    assert.ok(RcptFwd.rows.some((x) => ['open', 'closed', 'srconly'].includes(x.status)));
    const r = await call({ since: new Date(since).toISOString(), msgs: true, reset: true, welcome: true, confirm: 'BORRAR' }); assert.ok(r.out && r.out.success, JSON.stringify(r));
    for (let i = 0; i < 150; i++) { const st = (cfgDocs.find((d) => d.key === 'rcptbotclean') || {}).value; if (st && !st.running) break; await new Promise((q) => setTimeout(q, 50)); }
    const st = cfgDocs.find((d) => d.key === 'rcptbotclean').value; assert.ok(!st.running && !st.error, JSON.stringify(st));
    assert.ok(del.every((id) => id > 10 && id % 3 !== 0) && del.includes(31) && del.includes(11), 'sólo lo del bot desde la hora: ' + del);
    for (let i = 1; i <= 30; i++) if (i % 3 === 0 || i <= 10) assert.ok(msgs[i], 'quedó ' + i + ' (de la gente o de antes)');
    assert.deepStrictEqual(pinned, [], 'desfijados los del bot'); // el 7 era del bot (fijado viejo) también se desfija
    assert.ok(!RcptFwd.rows.some((x) => ['open', 'closed', 'hold', 'srconly', 'srcclosed'].includes(x.status)), 'cuentas a $0');
    assert.ok(st.reset && st.reset.comprobantes > 0 && Array.isArray(st.welcome), JSON.stringify(st.reset));
    global.TG_EXTRA = null;
  });
  await caso('#1109 las dos lecturas no coinciden ⇒ NO se suma; botón "✅ Es $X" lo reenvía aclarado', async () => {
    const st = cfgDocs[0].value.structs[0]; st.on = true; st.routes = [{ from: '-1', rules: [{ cents: '99', to: '-3' }], otherTo: null }]; st.srcQuote = false; await ctx._rbCfg(true);
    aiByModel = { 'claude-opus-5-5': 28142.99, 'claude-sonnet-5-5': 281142.99 }; const nOpen = RcptFwd.rows.filter((x) => x.status === 'open').length;
    await hook(photo(950)); const q = last(-1).p; assert.ok(/NO ESTOY SEGURO DEL MONTO/.test(q.text) && /No se sumó/.test(q.text) && /\$281\.142,99/.test(q.text) && /\$28\.142,99/.test(q.text), q.text);
    assert.strictEqual(RcptFwd.rows.filter((x) => x.status === 'open').length, nOpen, 'no se sumó');
    const btn = q.reply_markup.inline_keyboard.find((r) => /281\.142,99/.test(r[0].text))[0]; assert.ok(/^rba:/.test(btn.callback_data));
    await cbIn(-1, btn.callback_data); const rec = RcptFwd.rows.find((x) => x.srcMsgId === 950); assert.ok(rec.status === 'open' && rec.amount === 281142.99 && rec.toChat === '-3', JSON.stringify(rec));
    const cap = sent.filter((x) => x.method === 'copyMessage' && String(x.p.chat_id) === '-3').slice(-1)[0].p.caption; assert.ok(/MONTO CONFIRMADO A MANO<\/b> por Ana/.test(cap), cap);
    await cbIn(-1, btn.callback_data); assert.ok(/Ya está resuelto/.test(sent.filter((x) => x.method === 'answerCallbackQuery').slice(-1)[0].p.text), 'no se suma dos veces');
    aiByModel = { 'claude-opus-5-5': 50000.99, 'claude-sonnet-5-5': 50000.99 }; await hook(photo(951)); assert.ok(/REENVIADO/.test(last(-1).p.text), 'si coinciden, normal');
    aiByModel = null;
  });
  await caso('#1108 /suma: el anterior del grupo 2 entra en SU cierre (como cierre aparte); el del grupo 1 se cierra sin pasar al 2', async () => {
    for (const x of RcptFwd.rows) if (x.status === 'open' || x.status === 'srconly') x.status = 'closed';
    await hook(text(960, -3, '/suma 1.000.000')); assert.ok(/Sólo en la cuenta de este grupo/.test(last(-3).p.text), last(-3).p.text);
    await hook(text(961, -1, '/suma 2.000.000')); assert.ok(!/2\.000\.000/.test(last(-3).p.text), 'el grupo 2 no ve lo del 1');
    aiAmount = 10000.99; await hook(photo(962)); const n0 = RcptClose.rows.length;
    await hook(text(963, -1, '/cierre')); const btn = last(-1).p.reply_markup && last(-1).p.reply_markup.inline_keyboard; if (btn && /rbc|close/.test(JSON.stringify(btn))) await cbIn(-1, btn[0][0].callback_data);
    const news = RcptClose.rows.slice(n0); assert.ok(news.some((x) => x.fromChat === '-1' && Math.abs(x.total - 10000.99) < 0.01) && news.some((x) => x.fromChat === '' && x.total === 1000000) && !news.some((x) => x.total === 2000000), JSON.stringify(news));
    const g1 = sent.filter((x) => String(x.p.chat_id) === '-1' && /CIERRE/.test(x.p.text || '')).slice(-1)[0].p.text; assert.ok(/Anterior de este grupo: cerrado <b>\$2\.000\.000/.test(g1) && !/1\.000\.000/.test(g1), g1);
    const g2 = sent.filter((x) => String(x.p.chat_id) === '-3' && /CIERRE/.test(x.p.text || '')).slice(-1)[0].p.text; assert.ok(/\$1\.010\.000,99/.test(g2) && !/2\.000\.000/.test(g2), g2);
  });
  await caso('estructura APAGADA no reenvía nada', async () => { cfgDocs[0].value.structs[0].on = false; await ctx._rbCfg(true); const n = sent.length; await hook(photo(13)); assert.strictEqual(sent.length, n); });
  await caso('secreto incorrecto ⇒ 401', async () => { let code = 0; await routes['POST /api/rcptbot/webhook/:bot']({ params: { bot: '111' }, get: () => 'MAL', body: {} }, { status(c) { code = c; return this; }, end() {}, json() {} }); assert.strictEqual(code, 401); });
  console.log(`\n${ok} casos OK`);
})();
