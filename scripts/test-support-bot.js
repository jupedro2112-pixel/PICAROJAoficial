#!/usr/bin/env node
/**
 * test-support-bot.js — #1042: el bot de soporte (src/services/supportBot.js) contra una API de Anthropic FALSA (no gasta nada).
 * Verifica el pedido (modelo, esfuerzo, esquema JSON, fallbacks + header beta, conversación que arranca con el cliente, datos del
 * cliente según la etapa) y la lectura de la respuesta (handoff, refusal, errores). También mira que server.js tenga los frenos
 * (pausa por agente, una respuesta por mensaje, imágenes afuera) y que nunca responda 502.
 *
 * Corre con `node` pelado (sin node_modules):  node scripts/test-support-bot.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
let lastReq = null; let nextResp = null; let nextErr = null;
const fakeAxios = { post: async (url, body, opts) => { lastReq = { url, body, opts }; if (nextErr) throw nextErr; return { data: nextResp }; } };
const _orig = Module._load;
Module._load = function (req) {
  if (req === 'axios') return fakeAxios;
  if (/utils\/logger$/.test(req)) return { info() {}, warn() {}, error() {}, debug() {} };
  return _orig.apply(this, arguments);
};
process.env.ANTHROPIC_API_KEY = 'test-key';
const bot = require(path.join(ROOT, 'src/services/supportBot.js'));

const casos = []; const caso = (n, fn) => casos.push({ n, fn });
const okResp = (o, extra) => Object.assign({ stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(o) }], usage: { input_tokens: 900, output_tokens: 40 } }, extra || {});
const FACTS = { minDeposit: 2000, withdrawMin: 5000, depositRolloverX: 1, giftRolloverX: 5, firstDepositPct: 100, firstDepositCap: 15000, installGiftOn: true, installGiftFixed: 5000, refunds: { daily: 'sobre todo lo perdido 10%' }, referralsOn: false, platforms: 'Girox', officialTexts: ['Carga mínima $2.000'] };
const USER_NEW = { username: 'ana', accountDays: 0, realDeposits: 0, welcomeEligible: true, firstDepositPct: 100, appInstalled: false, pendingReceipts: 0, payout: '' };

caso('Pedido: modelo Opus 5.5 por defecto, esfuerzo low, JSON con esquema, fallbacks default + header beta', async () => {
  nextErr = null; nextResp = okResp({ reply: '¡Hola! Para cargar tocá DEPOSITAR.', handoff: false, handoff_reason: '' });
  const r = await bot.generateReply({ facts: FACTS, user: USER_NEW, agentName: 'Sofía', history: [{ role: 'user', text: 'hola' }] });
  assert.ok(r.ok); assert.strictEqual(r.reply, '¡Hola! Para cargar tocá DEPOSITAR.'); assert.strictEqual(r.handoff, false);
  const b = lastReq.body;
  assert.strictEqual(b.model, 'claude-haiku-5-5'); assert.strictEqual(b.output_config.effort, 'low');
  assert.strictEqual(b.output_config.format.type, 'json_schema'); assert.deepStrictEqual(b.output_config.format.schema.required, ['reply', 'handoff', 'handoff_reason', 'ignore', 'learn_question', 'learn_answer', 'info_topic', 'fix']);
  assert.strictEqual(b.output_config.format.schema.additionalProperties, false);
  assert.strictEqual(b.fallbacks, 'default'); assert.strictEqual(lastReq.opts.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.ok(!('thinking' in b) && !('temperature' in b), 'no manda thinking/temperature (Opus 5.5)');
  assert.strictEqual(lastReq.opts.headers['x-api-key'], 'test-key');
});
caso('Prompt: fijo cacheado primero; datos del servicio y del cliente (etapa sin carga, bono, $5.000 app, nombre del turno)', async () => {
  const b = lastReq.body;
  assert.ok(b.system[0].cache_control); assert.ok(!b.system[1].cache_control);
  const dyn = b.system[1].text;
  assert.ok(/ETAPA: sin carga/.test(dyn)); assert.ok(/Califica para el bono de primera carga \(100%\)/.test(dyn)); assert.ok(/\$5\.000 en fichas/.test(dyn));
  assert.ok(/TU NOMBRE EN ESTE TURNO: Sofía/.test(dyn)); assert.ok(/referidos está pausado/.test(dyn));
  const fixed = b.system[0].text;
  assert.ok(/NO tienen nada que ver con el servicio/.test(fixed) && /la gente viene a JUGAR/.test(fixed) && /MAPA DE LA APP/.test(fixed)); assert.ok(/MUY RESUMIDO/.test(fixed) && /info_topic/.test(fixed) && /sin carga.*directo a la carga/i.test(fixed) && /captura ENTERA/.test(fixed) && /sin negarlo ni hacerte pasar/.test(fixed) && /Soy Tati, la asistente virtual/.test(fixed) && /Juego responsable/.test(fixed));
});
caso('Cliente sin bono de bienvenida: el prompt dice que NO se lo ofrezca', async () => {
  nextResp = okResp({ reply: 'ok', handoff: false, handoff_reason: '' });
  await bot.generateReply({ facts: FACTS, user: Object.assign({}, USER_NEW, { welcomeEligible: false, welcomeWhy: 'cuenta secundaria' }), history: [{ role: 'user', text: 'hay bono?' }] });
  assert.ok(/NO tiene bono de bienvenida por ahora \(cuenta secundaria\)/.test(lastReq.body.system[1].text));
});
caso('Conversación: arranca con el cliente, junta turnos seguidos del mismo rol y termina en el cliente', async () => {
  nextResp = okResp({ reply: 'dale', handoff: false, handoff_reason: '' });
  await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'assistant', text: '[aviso automático] Bienvenido' }, { role: 'user', text: 'hola' }, { role: 'user', text: 'quiero cargar' }, { role: 'assistant', text: 'Tocá DEPOSITAR' }, { role: 'user', text: 'listo' }] });
  const m = lastReq.body.messages;
  assert.deepStrictEqual(m.map((x) => x.role), ['user', 'assistant', 'user']); assert.strictEqual(m[0].content, 'hola\nquiero cargar');
});
caso('Si el último mensaje no es del cliente: no llama a la IA', async () => {
  lastReq = null;
  const r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'hola' }, { role: 'assistant', text: 'hola!' }] });
  assert.ok(!r.ok); assert.strictEqual(lastReq, null);
});
caso('Handoff: la IA marca que lo tome una persona (carga trabada) ⇒ reply + handoff + motivo', async () => {
  nextResp = okResp({ reply: 'Ya lo paso al equipo que lo revisa.', handoff: true, handoff_reason: 'carga de $5.000 no acreditada' });
  const r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'cargue 5000 y no me llego' }] });
  assert.ok(r.ok && r.handoff); assert.strictEqual(r.handoffReason, 'carga de $5.000 no acreditada');
});
caso('#1043 Corrección: la IA pide fix sólo con un código conocido; el prompt muestra la corrección disponible y el rollover x10 del extra', async () => {
  nextResp = okResp({ reply: 'Ya lo reviso.', handoff: true, handoff_reason: 'x', fix: 'install_gift_topup' });
  let r = await bot.generateReply({ facts: Object.assign({}, FACTS, { installGiftRolloverX: 10, giftRolloverX: 5 }), user: Object.assign({}, USER_NEW, { installGift: 'COBRADO $2.000', fixInstall: 'le faltan $3.000' }), history: [{ role: 'user', text: 'no era 5mil?' }] });
  assert.ok(r.ok && r.fix === 'install_gift_topup' && !r.handoff, 'con fix el server decide (no handoff)');
  const sys = lastReq.body.system.map((x) => x.text).join('\n');
  assert.ok(/CORRECCIÓN DISPONIBLE "install_gift_topup"/.test(sys) && /COBRADO \$2\.000/.test(sys) && /se juega x10/.test(sys));
  nextResp = okResp({ reply: 'hola', handoff: false, handoff_reason: '', fix: 'pagar_todo' });
  r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'hola' }] });
  assert.ok(r.ok && r.fix === null, 'código desconocido ⇒ sin corrección');
});
caso('Molesta o fuera de tema ⇒ ignore (a lo sumo una frase de cierre); si además hay que pasarlo a una persona, gana el handoff', async () => {
  nextResp = okResp({ reply: 'chau', handoff: false, handoff_reason: '', ignore: true });
  let r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'jajaja tonto' }] });
  assert.ok(r.ok && r.ignore); assert.strictEqual(r.reply, 'chau');
  nextResp = okResp({ reply: '', handoff: false, handoff_reason: '', ignore: true });
  r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'jajaja' }] }); assert.ok(r.ok && r.ignore && r.reply === '');
  nextResp = okResp({ reply: 'Lo paso al equipo.', handoff: true, handoff_reason: 'reclamo de retiro', ignore: true });
  r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'devolveme la plata' }] });
  assert.ok(r.ok && r.handoff && !r.ignore && r.reply);
});
caso('Refusal ⇒ no ok y handoff (lo toma una persona); max_tokens ⇒ no ok; JSON roto ⇒ no ok', async () => {
  nextResp = { stop_reason: 'refusal', content: [] }; let r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'x' }] });
  assert.ok(!r.ok && r.handoff);
  nextResp = { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"reply":"a' }] }; r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'x' }] });
  assert.ok(!r.ok && !r.handoff);
  nextResp = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no json' }] }; r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'x' }] });
  assert.ok(!r.ok);
});
caso('Error de la API (429 / red) ⇒ no ok y reintentable (el server cae a la respuesta automática)', async () => {
  nextErr = Object.assign(new Error('rate'), { response: { status: 429, data: { error: { message: 'rate limited' } } } });
  let r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'x' }] }); assert.ok(!r.ok && r.retryable);
  nextErr = new Error('ECONNRESET'); r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'x' }] }); assert.ok(!r.ok && r.retryable);
  nextErr = null;
});
caso('IA sin saldo (400 credit balance / 402 / 401) ⇒ unavailable (el server pausa la IA y contesta el bot simple)', async () => {
  nextErr = Object.assign(new Error('x'), { response: { status: 400, data: { error: { message: 'Your credit balance is too low to access the Anthropic API.' } } } });
  let r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'x' }] }); assert.ok(!r.ok && r.unavailable);
  nextErr = Object.assign(new Error('x'), { response: { status: 401, data: {} } }); r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'x' }] }); assert.ok(r.unavailable);
  nextErr = Object.assign(new Error('x'), { response: { status: 529, data: {} } }); r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'x' }] }); assert.ok(!r.unavailable && r.retryable);
  nextErr = null;
  const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/if \(!r\.ok && r\.unavailable\) \{ _sbAiDownUntil = Date\.now\(\) \+ 30 \* 60000;/.test(S), 'pausa de 30 min');
  // primer mensaje de la charla ⇒ respuesta básica (tema o /sys_support_first) antes que la IA
  const qr = S.slice(S.indexOf('async function _supportQuickReply'), S.indexOf('async function _supportCannedReply'));
  assert.ok(qr.indexOf("renderSystemCommand('/sys_support_first'") > -1 && qr.indexOf("renderSystemCommand('/sys_support_first'") < qr.lastIndexOf('_supportBotSchedule(userId, username)'), 'básica primero');
  assert.ok(/Espero tu comprobante para realizar la carga/.test(S) && /name: '\/sys_support_first'/.test(S));
});
caso('Aprende: la IA devuelve pregunta/respuesta genéricas; con handoff o ignore no se aprende nada', async () => {
  nextResp = okResp({ reply: 'Tocá DEPOSITAR…', handoff: false, handoff_reason: '', ignore: false, learn_question: '¿Cómo cargo?', learn_answer: 'Tocá DEPOSITAR y mandá el comprobante entero.' });
  let r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'como cargo' }] });
  assert.strictEqual(r.learnQuestion, '¿Cómo cargo?'); assert.ok(r.learnAnswer);
  nextResp = okResp({ reply: 'Lo paso', handoff: true, handoff_reason: 'x', ignore: false, learn_question: 'q', learn_answer: 'a' });
  r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'no me llego' }] }); assert.strictEqual(r.learnQuestion, '');
});
caso('Lo aprendido: parecidas sí, distintas no, reclamos de plata NUNCA', async () => {
  const E = [{ _id: 1, question: '¿Cómo hago para cargar?', answer: 'A' }, { _id: 2, question: '¿Cuál es el retiro mínimo?', answer: 'B', variants: [{ t: 'cuanto es lo minimo que puedo sacar' }] }, { _id: 3, question: '¿Cómo funciona el reembolso diario?', answer: 'C' }];
  const m = (t) => { const x = bot.bestLearned(t, E); return x ? x.entry._id : null; };
  assert.strictEqual(m('como cargo'), 1); assert.strictEqual(m('cual es el minimo para retirar'), 2); assert.strictEqual(m('cuanto es lo minimo que puedo sacar?'), 2); assert.strictEqual(m('que es el reembolso diario'), 3);
  assert.strictEqual(m('no me llego la carga'), null); assert.strictEqual(m('cargué y no me acreditaron'), null); assert.strictEqual(m('quiero retirar'), null); assert.strictEqual(m('hola'), null);
  assert.strictEqual(m('como cargo? me estafaron'), null);
  const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/const hit = supportBot\.bestLearned\(String\(lastUser\.content \|\| ''\), await _supportLearnedApproved\(\)\);/.test(S), 'lo aprendido antes que la IA');
  assert.ok(/else if \(cfg\.learnedOnly \|\| !supportBot\.isAvailable\(\) \|\| _supportBotAiDown\(\) \|\| !_sbAiBudgetOk\(\)\) r = \{ ok: false/.test(S), 'sin IA ⇒ respuestas fijas');
  assert.ok(/status: 'pending', createdAt: now/.test(S), 'lo nuevo entra para aprobar (no se usa solo)');
});
caso('Seguridad de lo aprendido: sin links / CBU / teléfonos / contactos; auto-aprobación sólo por 3+ clientes distintos; rutas sólo admin; tope por hora', async () => {
  assert.ok(bot.learnIsSafe('¿Cómo cargo?', 'Tocá DEPOSITAR y mandá el comprobante entero.'));
  for (const bad of ['Transferí al CBU 0000003100012345678901', 'Escribinos a soporte@x.com', 'Entrá a https://pagina-falsa.com', 'Mandá al 11 2345-6789', 'Hablanos por WhatsApp', 'mirá www.algo.net']) assert.ok(!bot.learnIsSafe('q', bad), bad);
  nextResp = okResp({ reply: 'ok', handoff: false, handoff_reason: '', ignore: false, learn_question: '¿Dónde transfiero?', learn_answer: 'Al CBU 0000003100012345678901' });
  const r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'donde transfiero' }] }); assert.strictEqual(r.learnAnswer, '');
  const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/users\.size >= Math\.max\(3, cfg\.autoApproveAt\)/.test(S), 'auto-aprobación por clientes distintos');
  assert.ok(/if \(!supportBot\.learnIsSafe\(q, a\)\) return;/.test(S));
  assert.ok(/\/\^\\\/api\\\/admin\\\/support-bot\(\\\/\|\$\)\/i/.test(S), 'STAFF_DENY_MUTATIONS cubre /api/admin/support-bot');
  assert.ok(/!_sbAiBudgetOk\(\)/.test(S), 'tope de IA por hora');
});
caso('Sin ANTHROPIC_API_KEY: isAvailable false y no llama', async () => {
  const k = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY; lastReq = null;
  assert.strictEqual(bot.isAvailable(), false);
  const r = await bot.generateReply({ facts: FACTS, user: USER_NEW, history: [{ role: 'user', text: 'x' }] }); assert.ok(!r.ok); assert.strictEqual(lastReq, null);
  process.env.ANTHROPIC_API_KEY = k;
});
caso('server.js: frenos del bot (pausa por agente, handoff, una respuesta por mensaje, sólo texto, chips con respuesta fija, sin 502) + adjuntar siempre por la guía', async () => {
  const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/'metadata\.bot': \{ \$ne: true \}/.test(S), 'la pausa cuenta sólo personas, no al bot');
  assert.ok(/support_bot_claims'\)\.insertOne\(\{ _id: lastUser\.id/.test(S), 'una respuesta por mensaje (multi-instancia)');
  assert.ok(/lastUser\.type !== 'text'/.test(S), 'imágenes (comprobantes) no las contesta el bot');
  // #1042-d: tres escalones — tema detectado y no contestado ⇒ respuesta simple; si no ⇒ IA; tope de respuestas de la IA ⇒ agente
  const qr = S.slice(S.indexOf('async function _supportQuickReply'), S.indexOf('async function _supportCannedReply'));
  assert.ok(qr.indexOf('const topic = _supportTopicFromText(text)') > -1 && qr.indexOf("return _supportCannedReply(userId, username, quick, text, false); // escalón 1") < qr.indexOf('_supportBotSchedule(userId, username); return; // escalón 2'), 'escalón 1 antes que la IA');
  assert.ok(/if \(aiReplies >= cfg\.aiMaxReplies\) \{\s*r = \{ ok: true, reply: [^}]*handoff: true/.test(S), 'escalón 3: tope ⇒ agente');
  // #1042-e: todo adentro de Girox — Soporte se muda al casino, Volver vuelve al juego, DEPOSITAR usa la Carga rápida, el casino al cerrarse lo devuelve
  const H = fs.readFileSync(path.join(ROOT, 'public/js/home.js'), 'utf8');
  assert.ok(/VIP\.ui\.toggleCasinoChat = function \(\) \{ casinoChatToggle\(\); \}/.test(H) && /async function casinoChatToggle\(\) \{[\s\S]{0,800}if \(classic\) \{ toggleCasinoLoad\(\); return; \}[\s\S]{0,120}_supportIntoCasino\(\)/.test(H), 'la BURBUJA de Girox abre el chat nuevo (clásico ⇒ Carga rápida)');
  assert.ok(/function casinoSupport\(\) \{[\s\S]{0,400}try \{ VIP\.ui\.closeCasinoFrame\(\); \} catch \(_\) \{\} setTimeout\(\(\) => \{ try \{ setHomeMode\('mini'\)/.test(H), 'el botón Soporte del casino, como antes (salvo sólo Girox)');
  assert.ok(/function closeSupport\(\) \{\s*if \(_supportOutOfCasino\(\)\) return;/.test(H) && /_supportOutOfCasino\(\); \} catch \(_\) \{\} \/\/ #1042-e: el chat vuelve/.test(H), 'vuelve a su lugar');
  assert.ok(/if \(_casinoIsOpen\(\)\) \{ _supportOutOfCasino\(\); try \{ toggleCasinoLoad\(true\)/.test(H), 'DEPOSITAR adentro del casino');
  { const C2 = fs.readFileSync(path.join(ROOT, 'public/css/pin.css'), 'utf8'); assert.ok(/#supportPanel:not\(\.sp-in-casino\) \.sp-actbar \{ display: none !important; \}/.test(C2) && !/^body:not\(\.sp-classic\) #supportPanel /m.test(C2), 'lo nuevo sólo en la burbuja; Soporte como antes'); }
  { const C3 = fs.readFileSync(path.join(ROOT, 'public/css/pin.css'), 'utf8'), I3 = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.ok(/body\.menus-one\.no-menu-full\.no-menu-basic\.no-menu-easy \.casino-topbar \.ct-multi \{ display: none !important; \}/.test(C3) && /class="casino-back ct-multi"/.test(H) && /id="ctTelegram"/.test(H), 'sólo Girox: sin Volver ni Menú, con Telegram');
    assert.ok(/function _onlyGirox\(\)/.test(H) && /if \(_onlyGirox\(\)\) \{/.test(H), 'sólo Girox: Soporte abre el chat adentro del juego');
    ['refund', 'sorteo', 'misiones', 'ruleta', 'fueguito', 'referidos', 'sms'].forEach((t) => assert.ok(I3.includes("VIP.home.spInfo('" + t + "')"), 'fila de servicio: ' + t));
    assert.ok(/mig1042rGiroxOnly/.test(S), 'migración: sólo Girox una vez');
    { const A4 = fs.readFileSync(path.join(ROOT, 'public/adminprivado2026/admin.js'), 'utf8'), AC = fs.readFileSync(path.join(ROOT, 'public/js/activity.js'), 'utf8'), M = fs.readFileSync(path.join(ROOT, 'src/models/AppSession.js'), 'utf8');
      assert.ok(/menu: _menuNow\(\), chat: _chatNow\(\)/.test(AC) && /menu: \{ type: String/.test(M) && /chat: \{ type: String/.test(M), 'la app informa menú y chat en cada ping');
      assert.ok(/async function _menuRetTick\(/.test(S) && /cron_locks/.test(S) && /Config\.set\('menuRetention'/.test(S) && /app\.get\('\/api\/admin\/inicio\/menus'/.test(S) && /loadInicioMenus\(\); \/\/ #1042-y/.test(A4), 'INICIO: panorama de menús por cron con lock (la ruta sólo lee)'); }
    { const U3 = fs.readFileSync(path.join(ROOT, 'public/js/ui.js'), 'utf8'), C3 = fs.readFileSync(path.join(ROOT, 'public/js/chat.js'), 'utf8');
      assert.ok(/VIP\.home\.casinoChatToggle\) return VIP\.home\.casinoChatToggle\(\)/.test(U3), 'burbuja: el primer toque abre el chat nuevo');
      assert.ok(/if \(r\.handoff\) \{\n    const why = /.test(S) && /target: 'problema', label: '🆘 Tengo otro problema'/.test(S) && C3.includes("'problema']"), 'a Soporte sólo por el botón (la IA manda al botón)');
      assert.ok(/SUPPORT_GREET_DEFAULT/.test(S) && /spGreetMsg/.test(C3) && /24 \* 3600 \* 1000\);\n          const cur = matchStage/.test(S), 'saludo al entrar + chat de 24 h para el cliente'); }
    { const A3 = fs.readFileSync(path.join(ROOT, 'public/adminprivado2026/admin.js'), 'utf8');
      assert.ok((S.match(/_supportBotCost\(r\);/g) || []).length === 2 && /const ai = await _inicioAiUsage\(day\)/.test(S) && /_inicioAiHtml\(d\.ai, n\)/.test(A3), 'INICIO: consumo de la IA día a día (bot + Probar)');
      // precio: 1M de entrada + 1M de salida en Opus 5.5 = US$ 24
      const m = S.match(/function _sbCostUsd\(model, u\) \{[\s\S]*?\n\}/)[0]; const P = S.match(/const SB_PRICES = \{[\s\S]*?\n\};/)[0];
      const f = new Function(P + '\n' + m + '\nreturn _sbCostUsd;')();
      assert.strictEqual(f('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 24);
      assert.strictEqual(f('claude-haiku-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 0.6);
      assert.strictEqual(f('otro', { input_tokens: 1e6 }), 4, 'modelo desconocido ⇒ precio de Opus'); }
    assert.ok(/Ya te paso con una persona del equipo, un segundo/.test(S), 'Tengo otro problema ⇒ "Ya te paso con una persona del equipo, un segundo"');
    assert.ok(/async function _supportSentSince\(/.test(S) && (S.match(/if \(await _supportSentSince\(userId, _t0\)\) return;/g) || []).length === 2, 'palabra clave sin respuesta fija ⇒ contesta la IA (nunca un visto)');
    assert.ok(!/senderId: \{ \$nin: \['support-bot', 'system', 'admin'\] \},[^\n]*senderId:/.test(S) && (S.match(/senderId: \{ \$nin: \['support-bot', 'system', 'admin'\] \}/g) || []).length >= 5, 'agente reciente = sólo personas (sin claves repetidas)');
    assert.ok(/if \(quick === 'problema'\) \{[\s\S]{0,400}await _supportHandoffNow\(/.test(S) && I3.includes("VIP.home.supportQuick('problema')"), 'Tengo otro problema ⇒ directo a un agente');
    assert.ok((S.match(/_supportLearnFromAgent\(/g) || []).length >= 3 && /'metadata\.learned': \{ \$ne: true \}/.test(S) && /aiMaxReplies: 20, classic:/.test(S) && /mig1042vAiFree/.test(S), 'aprende del agente; la IA una sola vez (lo aprendido no cuenta)');
    assert.ok((S.match(/await _depositLuck\(/g) || []).length === 2 && /'\/sys_withdraw_chat'/.test(S) && /'\/sys_payout_done_chat'/.test(S), 'chat nuevo: carga con buena suerte, retiro pedido y pagado escritos');
    assert.ok(/if \(spNewCasino\(\)\) \{ try \{ toggleCasinoLoad\(false\); \} catch \(_\) \{\} spShowChat\(\); return; \}/.test(H) && /if \(spNewCasino\(\)\) \{ spShowChat\(\); return; \}/.test(H), 'chat nuevo: sin carteles de carga ni de retiro');
    assert.ok(/function spNewCasino\(\) \{ return _casinoIsOpen\(\) && !document\.body\.classList\.contains\('sp-classic'\); \}/.test(H), 'con Modo normal, los carteles de siempre');
    assert.ok(/if \(classic\) return _menusEnabledNorm\(await getConfig\('menusEnabledBefore1042r', null\)\)/.test(S) && /const menus = await _menusEnabledEffective\(\)/.test(S), 'modo normal / clásico: también el menú de antes');
    const ab = I3.indexOf('id="spActBar"'), ib = I3.indexOf('id="spInfoBar"'), cc = I3.indexOf('class="chat-container"');
    assert.ok(ab > 0 && ib > ab && ib < cc, 'fila de servicio ARRIBA (adentro de la barra), no abajo'); }
  assert.ok(/const sentAny = await Message\.findOne[\s\S]{0,200}if \(sentAny\) return;\s*r = \{ ok: true, reply: [^}]*handoff: true/.test(S), 'IA falla y no salió respuesta fija ⇒ aviso + agente (nunca un visto)');
  assert.ok(/if \(!r\.reply\) r\.reply = /.test(S), 'silencio sólo después de una frase de cierre');
  assert.ok(/VIP\.ui\.showModal = function \(id\) \{ try \{ _modalIntoCasino\(id\); \}/.test(H) && /_modalsBackAll\(\); \} catch/.test(H), 'ventanas adentro de Girox');
  assert.ok(/#1042-n[\s\S]{0,2500}if \(H\.has\(r\.userId\) \|\| A\.has\(r\.userId\)\) return true;[\s\S]{0,600}if \(!needsAgent\(r\)\) \{ r\.closed = true; r\.botHandled = true; return r; \}/.test(S), 'Soporte: todo se ve, abierto sólo si necesita un agente');
  assert.ok(/if \(mode !== 'play'\) \{ try \{ if \(document\.body\.classList\.contains\('ev-expanded'\)\)/.test(H), 'al cambiar de menú se suelta el bloqueo de scroll');
  assert.ok(/return c\.enabled && !c\.classic && \(supportBot\.isAvailable\(\) \|\| c\.learnedOnly\);/.test(S) && /cfg\.classic \|\| \(!supportBot\.isAvailable\(\) && !cfg\.learnedOnly\)/.test(S), 'chat clásico = sin bot');
  const CSS = fs.readFileSync(path.join(ROOT, 'public/css/pin.css'), 'utf8'); const blk = CSS.slice(CSS.indexOf('/* #1042 (owner, captura de referencia)'));
  assert.ok(!/^\.sp-acts|^\.sp-actbar|^#supportPanel \.(message|chat)/m.test(blk) && /body\.sp-classic \.sp-actbar \{ display: none/.test(blk), 'chat clásico: nada del diseño nuevo aplica');
  assert.ok(/support_bot_mutes'\)\.findOne\(\{ _id: userId \}\)/.test(S) && /if \(r\.ok && r\.ignore\)/.test(S), 'silencio a quien molesta');
  assert.ok(/status: 'open', closedAt: null/.test(S) && /kind: 'bot_handoff'/.test(S), 'handoff abre el chat con nota');
  assert.ok(/await _supportCannedReply\(userId, username, null, String\(lastUser\.content \|\| ''\), false\)/.test(S), 'si la IA falla, respuesta automática de siempre');
  // #1030: el botón del bot para adjuntar va por la GUÍA del comprobante (target receipt ⇒ VIP.autoload.sendReceipt ⇒ pickReceipt), nunca al selector directo
  assert.ok(/kind: 'go_section', target: 'receipt', label: '📸 Adjuntar comprobante'/.test(S), 'el bot ofrece el botón de adjuntar');
  const C = fs.readFileSync(path.join(ROOT, 'public/js/chat.js'), 'utf8'), A = fs.readFileSync(path.join(ROOT, 'public/js/autoload.js'), 'utf8'), P = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  assert.ok(/t === 'receipt' \? "VIP\.autoload\.sendReceipt\(\)"/.test(C), 'chat: receipt ⇒ sendReceipt');
  assert.ok(/function sendReceipt\(\) \{[\s\S]{0,300}pickReceipt\('button'\)/.test(A), 'sendReceipt ⇒ guía');
  assert.ok(/VIP\.autoload\.pickReceipt\('clip'\)/.test(P), 'la cámara del chat ⇒ guía');
  const routes = S.slice(S.indexOf("app.post('/api/admin/support-bot/test'"), S.indexOf("app.get('/api/admin/meta-pixels'"));
  assert.ok(!/status\(502\)/.test(routes), 'nunca 502 (Cloudflare lo tapa)');
});

caso('#1045 Pase a un agente: va a SOPORTE (no reabre en Chats), queda abierto con 🆘 hasta que conteste una persona y el cierre de 30 min no lo cierra', () => {
  const S = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  const ho = S.slice(S.indexOf('async function _supportHandoffNow('), S.indexOf('async function _supportHandoffNow(') + 1200);
  assert.ok(!/ChatStatus\.updateOne/.test(ho) && /support_handoff/.test(ho), 'el pase manual no abre en Chats');
  const bh = S.slice(S.indexOf('// TRABADO ⇒ a una persona'), S.indexOf('// TRABADO ⇒ a una persona') + 1500);
  assert.ok(!/ChatStatus\.updateOne/.test(bh) && /support_handoff/.test(bh), 'el pase del bot no abre en Chats');
  assert.ok(/if \(h && \(!a \|\| new Date\(a\) < new Date\(h\)\)\) \{ r\.closed = false; r\.waitingAgent = true; \}/.test(S));
  assert.ok(/if \(_waiting\.has\(r\._id\)\) continue;/.test(S), 'el cierre automático respeta a los que esperan agente');
  const A = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'adminprivado2026', 'admin.js'), 'utf8');
  assert.ok(/socket\.on\('support_handoff'/.test(A) && /ESPERA AGENTE/.test(A));
});

(async () => {
  let ok = 0;
  for (const c of casos) { try { await c.fn(); ok++; console.log('✅ ' + c.n); } catch (e) { console.log('❌ ' + c.n + '\n   ' + (e && e.message)); } }
  console.log(`\n${ok}/${casos.length} casos OK`); process.exit(ok === casos.length ? 0 : 1);
})();
