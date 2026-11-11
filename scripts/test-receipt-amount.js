'use strict';
// #1109: lectura del MONTO de los comprobantes (formato argentino, centavos arriba, fotos giradas). axios simulado.
const assert = require('assert'); const Module = require('module'); const path = require('path');
let reply = null; let lastBody = null;
const orig = Module._load; Module._load = function (req, ...a) { if (req === 'winston' || /utils\/logger$/.test(req)) return /logger/.test(req) ? { info() {}, warn() {}, error() {} } : undefined; if (req === 'axios') return { post: async (url, body) => { lastBody = body; return { data: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(reply) }] } }; } }; return orig.call(this, req, ...a); };
process.env.ANTHROPIC_API_KEY = 'x';
const A = require(path.join(__dirname, '..', 'src/services/comprobanteAiService.js'));
let ok = 0; const caso = async (n, f) => { try { await f(); ok++; console.log('✅ ' + n); } catch (e) { console.log('❌ ' + n + '\n   ' + e.message); process.exitCode = 1; } };
const img = 'data:image/jpeg;base64,AAAA';
(async () => {
  await caso('formatos argentinos', () => {
    const P = A.parseArAmount; assert.strictEqual(P('447.116,99'), 447116.99); assert.strictEqual(P('$ 447.116⁹⁹'), 447116.99); assert.strictEqual(P('$ 281.142 99'), 281142.99);
    assert.strictEqual(P('1,234.56'), 1234.56); assert.strictEqual(P('447116.99'), 447116.99); assert.strictEqual(P('50.000'), 50000); assert.strictEqual(P('12.500.000,43'), 12500000.43); assert.strictEqual(P('$25.000,5'), 25000.5);
  });
  await caso('$447.116⁹⁹: la IA da 447.116 como número ⇒ igual sale 447.116,99 (pesos + centavos y el texto mandan)', async () => {
    reply = { es_comprobante: true, confianza: 0.9, monto: 447.116, monto_texto: '$447.116⁹⁹', monto_pesos: '447116', monto_centavos: '99' };
    const r = await A.analyzeComprobante(img); assert.strictEqual(r.amount, 447116.99); assert.strictEqual(r.amountConflict, false);
  });
  await caso('$281.142,99 con un dígito perdido en los pesos ⇒ NO coincide con el texto ⇒ conflicto (el bot no adivina)', async () => {
    reply = { es_comprobante: true, monto: 28142.99, monto_texto: '$ 281.142,99', monto_pesos: '28142', monto_centavos: '99' };
    const r = await A.analyzeComprobante(img); assert.strictEqual(r.amountConflict, true); assert.ok(r.amountCandidates.includes(281142.99) && r.amountCandidates.includes(28142.99), JSON.stringify(r.amountCandidates));
  });
  await caso('todo coincide ⇒ sin conflicto', async () => {
    reply = { es_comprobante: true, monto: 281142.99, monto_texto: '$ 281.142,99', monto_pesos: '281142', monto_centavos: '99' };
    const r = await A.analyzeComprobante(img); assert.strictEqual(r.amount, 281142.99); assert.strictEqual(r.amountConflict, false);
  });
  await caso('respuesta vieja (sólo monto) sigue andando; 3 decimales solos = sin monto confiable', async () => {
    reply = { es_comprobante: true, monto: 25000.5 }; let r = await A.analyzeComprobante(img); assert.strictEqual(r.amount, 25000.5);
    reply = { es_comprobante: true, monto: 447.116 }; r = await A.analyzeComprobante(img); assert.strictEqual(r.amount, null, 'no inventa 447,12');
  });
  await caso('opts.model: otro modelo y más tokens para que piense; el bloque de texto se encuentra aunque venga thinking antes', async () => {
    reply = { es_comprobante: true, monto: 100, monto_texto: '$100', monto_pesos: '100', monto_centavos: '00' };
    const r = await A.analyzeComprobante(img, { model: 'claude-opus-5-5' }); assert.strictEqual(lastBody.model, 'claude-opus-5-5'); assert.ok(lastBody.max_tokens >= 4000); assert.strictEqual(r.amount, 100);
    await A.analyzeComprobante(img); assert.strictEqual(lastBody.model, 'claude-haiku-4-5'); assert.strictEqual(lastBody.max_tokens, 600);
  });
  console.log(`\n${ok}/6 casos OK`);
})();
