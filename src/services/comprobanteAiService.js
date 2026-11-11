/**
 * comprobanteAiService.js
 *
 * Lee una imagen de comprobante con Claude (vision) y devuelve los datos
 * estructurados: si es un comprobante, monto, N° de operación, CBU/alias origen,
 * banco y fecha. Lo usa el flujo de chat para detectar comprobantes reutilizados.
 *
 * - Modelo por defecto: claude-haiku-4-5 (barato y suficiente para OCR de
 *   comprobantes). Configurable con la env COMPROBANTE_AI_MODEL.
 * - Usa axios directo contra la API de Anthropic (mismo patrón que los clientes
 *   de JUGAYGANA) para no sumar dependencias nuevas.
 * - Si NO está la ANTHROPIC_API_KEY (en process.env, cargada desde SSM en el
 *   bootstrap), isEnabled() devuelve false y el flujo de chat no hace nada
 *   (queda "dormido" sin romper).
 *
 * La key se lee en cada llamada (lazy), NO al require, porque los secrets se
 * cargan desde AWS SSM DESPUÉS del require (igual que JWT_SECRET).
 */
const axios = require('axios');
const logger = require('../utils/logger');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function getApiKey() {
  return process.env.ANTHROPIC_API_KEY || null;
}

function getModel() {
  return process.env.COMPROBANTE_AI_MODEL || 'claude-haiku-4-5';
}

/** true si hay API key configurada (la detección está activa). */
function isEnabled() {
  return !!getApiKey();
}

// Construye el bloque de imagen para la API a partir del content del mensaje,
// que puede ser un data: URL (base64 inline) o un https:// URL (S3).
function buildImageBlock(content) {
  if (typeof content !== 'string' || !content) return null;
  if (content.startsWith('data:')) {
    const m = content.match(/^data:([\w\/+.-]+);base64,(.*)$/s);
    if (!m) return null;
    const mediaType = m[1];
    const data = m[2];
    // Sólo imágenes (no videos) — la API de visión no procesa video.
    if (!/^image\//.test(mediaType)) return null;
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  }
  if (/^https:\/\//i.test(content)) {
    return { type: 'image', source: { type: 'url', url: content } };
  }
  return null;
}

const PROMPT = [
  'Sos un verificador de comprobantes de pago/transferencia bancaria de Argentina.',
  'Mirá la imagen y decidí si es un COMPROBANTE de pago o transferencia (de un banco,',
  'billetera virtual como Mercado Pago/Ualá/Brubank, o app bancaria). Las capturas de',
  'error de la página, fotos de personas, memes, fotos de pantallas de juego, etc. NO son',
  'comprobantes.',
  '',
  'Si ES un comprobante, extraé estos datos (lo que puedas leer; si algo no está, poné null):',
  '- numero_operacion: el número de operación / comprobante / referencia de la transacción',
  '  (string). MUY IMPORTANTE: NO uses el CBU, CVU, alias, número de cuenta NI el CUIT/CUIL',
  '  (formato XX-XXXXXXXX-X, ej: 30-71876498-6) como número de operación — el CUIT identifica a',
  '  una persona/empresa y se REPITE entre transferencias distintas. Si el comprobante NO muestra',
  '  un número de operación/referencia claro y distinto del CUIT/CBU, poné null.',
  '- coelsa_id: el ID de COELSA de la transferencia (string). Aparece como "COELSA ID", "ID COELSA", "Código COELSA",',
  '  "Identificación de la transferencia" o similar: un código alfanumérico de ~22 caracteres en MAYÚSCULAS y números',
  '  (ej: 3QK7M2XWZ8H4N6P1R9T5VB). Copialo EXACTO, carácter por carácter (ojo con 0/O, 1/I, 5/S, 8/B). Si no está, null.',
  '  No lo confundas con el "Código de transacción" / id interno de la billetera (ej. un UUID como 1a2b3c4d-…): ese va en numero_operacion.',
  '- monto: el importe transferido, sólo el número sin símbolos ni puntos de miles (number).',
  '- monto_texto: el importe EXACTO como está impreso, con sus puntos y comas (string, ej. "$ 447.116,99").',
  '- monto_pesos: TODOS los dígitos de la parte entera del importe, sin puntos ni espacios (string, ej. "447116").',
  '- monto_centavos: los 2 dígitos de los centavos (string, ej. "99"); "00" si no tiene.',
  '  FORMATO ARGENTINO: el PUNTO separa los MILES ("447.116" son cuatrocientos cuarenta y siete MIL ciento dieciséis) y los',
  '  centavos van después de la COMA o en números CHIQUITOS ARRIBA (superíndice): "$447.116⁹⁹" = 447116 pesos con 99 centavos.',
  '  Si la imagen está GIRADA o de costado, girala mentalmente y leé el número grande dígito por dígito, sin saltear ninguno.',
  '- titular_origen: nombre del que envió el dinero (string).',
  '- cbu_origen: CBU/CVU o alias de la cuenta de ORIGEN (string).',
  '- cuit_origen: CUIT/CUIL de quien ENVÍA el dinero (string, ej. 20-12345678-9), o null.',
  '- titular_destino: nombre del que RECIBE el dinero (string).',
  '- cbu_destino: CBU/CVU o alias de la cuenta de DESTINO (a quién se le transfirió) (string).',
  '- banco: banco o billetera (string).',
  '- fecha: fecha y hora que figura en el comprobante, tal cual (string).',
  '',
  'Respondé ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown, con',
  'exactamente estas claves:',
  '{"es_comprobante": true|false, "confianza": 0..1, "numero_operacion": string|null, "coelsa_id": string|null,',
  ' "monto": number|null, "monto_texto": string|null, "monto_pesos": string|null, "monto_centavos": string|null, "titular_origen": string|null, "cbu_origen": string|null, "cuit_origen": string|null,',
  ' "titular_destino": string|null, "cbu_destino": string|null,',
  ' "banco": string|null, "fecha": string|null}'
].join('\n');

// Extrae el primer objeto JSON de un texto (tolera fences ```json ... ``` o texto suelto).
function parseJsonLoose(text) {
  if (!text || typeof text !== 'string') return null;
  let t = text.trim();
  // Quitar fences de markdown si vinieran
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(t); } catch (_) { /* seguir */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { /* nada */ }
  }
  return null;
}

/**
 * Analiza el content de un mensaje de imagen.
 * @returns {Promise<object>} { ok, isComprobante, confidence, operationNumber,
 *   amount, originHolder, originCbu, bank, paymentDate, rawText, model } o
 *   { ok:false, error } si no se pudo analizar.
 */
async function analyzeComprobante(content, opts = {}) { // opts.model: otro modelo (el bot de comprobantes usa uno más preciso)
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY no configurada' };

  const imageBlock = buildImageBlock(content);
  if (!imageBlock) return { ok: false, error: 'Contenido no es una imagen analizable' };

  const model = opts.model || getModel();
  const body = {
    model,
    max_tokens: /^claude-(opus|sonnet|fable)-5|^claude-haiku-5/.test(model) ? 4000 : 600, // los modelos 5.x piensan antes de contestar
    messages: [{
      role: 'user',
      content: [imageBlock, { type: 'text', text: PROMPT }]
    }]
  };

  try {
    const resp = await axios.post(ANTHROPIC_URL, body, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json'
      },
      timeout: 30000
    });

    // La respuesta trae content: [{type:'text', text:'...'}]
    const blocks = resp.data && resp.data.content;
    const textBlock = Array.isArray(blocks) ? blocks.find(b => b && b.type === 'text') : null;
    const raw = textBlock ? textBlock.text : '';
    const parsed = parseJsonLoose(raw);
    if (!parsed) {
      logger.warn(`[comprobante-ai] respuesta sin JSON parseable: ${String(raw).slice(0, 200)}`);
      return { ok: false, error: 'Respuesta de IA sin JSON válido', rawText: raw };
    }

    const amountNum0 = (parsed.monto === null || parsed.monto === undefined)
      ? null
      : (Number(String(parsed.monto).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || null);
    // #1109 (owner: "detectó mal el número": $447.116⁹⁹ leído como 447,12 y $281.142,99 como 28.142,99). El monto sale de pesos + centavos por separado
    // y se cruza con el texto impreso y con el número; si no coinciden, amountConflict (el que llama decide: el bot de comprobantes NO adivina).
    const amt = resolveAmount(parsed, amountNum0);
    const amountNum = amt.amount;

    return {
      ok: true,
      isComprobante: !!parsed.es_comprobante,
      confidence: typeof parsed.confianza === 'number' ? parsed.confianza : 0,
      operationNumber: parsed.numero_operacion ? String(parsed.numero_operacion).trim() : null,
      // #999: COELSA ID (lo trae el banco en cada transferencia: cruce exacto) y CUIT de origen (cruce con fromCUIT del movimiento).
      coelsaId: /^[A-Za-z0-9]{12,40}$/.test(String(parsed.coelsa_id || '').replace(/[\s-]/g, '')) ? String(parsed.coelsa_id).replace(/[\s-]/g, '').toUpperCase() : null,
      originCuit: String(parsed.cuit_origen || '').replace(/\D/g, '').length === 11 ? String(parsed.cuit_origen).replace(/\D/g, '') : null,
      amount: amountNum, amountConflict: amt.conflict, amountCandidates: amt.candidates,
      amountRaw: parsed.monto == null ? null : String(parsed.monto).slice(0, 40), // #1099: el texto tal cual (USDT viene como 1,234.56)
      originHolder: parsed.titular_origen ? String(parsed.titular_origen).trim() : null,
      originCbu: parsed.cbu_origen ? String(parsed.cbu_origen).trim() : null,
      destHolder: parsed.titular_destino ? String(parsed.titular_destino).trim() : null,
      destCbu: parsed.cbu_destino ? String(parsed.cbu_destino).trim() : null,
      bank: parsed.banco ? String(parsed.banco).trim() : null,
      paymentDate: parsed.fecha ? String(parsed.fecha).trim() : null,
      rawText: raw,
      model
    };
  } catch (err) {
    const detail = err.response
      ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data).slice(0, 200)}`
      : err.message;
    logger.error(`[comprobante-ai] error analizando comprobante: ${detail}`);
    return { ok: false, error: detail };
  }
}

// Monto en formato argentino a número: "447.116,99" / "$ 447.116⁹⁹" / "447116.99" / "281.142 99". Devuelve null si es ambiguo.
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
function parseArAmount(txt) {
  if (txt == null) return null; let t = String(txt).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => ',' + m.split('').map((ch) => SUP[ch]).join('')).replace(/[^\d.,\s]/g, ' ').trim();
  t = t.replace(/\s+/g, ' ');
  let m = t.match(/^(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:\s*,\s*(\d{1,2}))?$/); // 447.116,99 · 447 116,99 · 447116,99 · 447.116
  if (m) return Number(m[1].replace(/[.\s]/g, '')) + (m[2] ? Number(m[2].padEnd(2, '0')) / 100 : 0);
  m = t.match(/^(\d{1,3}(?:\.\d{3})+) (\d{2})$/); if (m) return Number(m[1].replace(/\./g, '')) + Number(m[2]) / 100; // 281.142 99 (centavos arriba)
  m = t.match(/^(\d{1,3}(?:,\d{3})+)\.(\d{2})$/); if (m) return Number(m[1].replace(/,/g, '') + '.' + m[2]); // 1,234.56 (formato inglés)
  m = t.match(/^(\d+)\.(\d{2})$/); if (m) return Number(m[1] + '.' + m[2]); // 447116.99
  return null;
}
function resolveAmount(parsed, numeric) {
  const r2 = (n) => Math.round(n * 100) / 100; const cands = [];
  const pesos = String(parsed.monto_pesos == null ? '' : parsed.monto_pesos).replace(/\D/g, ''); const cent = String(parsed.monto_centavos == null ? '' : parsed.monto_centavos).replace(/\D/g, '');
  const parts = pesos ? r2(Number(pesos) + (cent ? Number(cent.slice(0, 2).padEnd(2, '0')) / 100 : 0)) : null; if (parts) cands.push(parts);
  const txt = parseArAmount(parsed.monto_texto); if (txt) cands.push(r2(txt));
  // el número suelto con 3 decimales (447.116) es un punto de miles mal tomado: no sirve para decidir
  const numOk = numeric != null && !/\.\d{3}$/.test(String(parsed.monto)) ? r2(numeric) : null; if (numOk) cands.push(numOk);
  const uniq = [...new Set(cands)];
  if (!uniq.length) return { amount: null, conflict: false, candidates: [] };
  if (uniq.length === 1) return { amount: uniq[0], conflict: false, candidates: uniq };
  // pesos+centavos y el texto impreso mandan; si esos dos coinciden, el número suelto no cuenta
  if (parts && txt && r2(txt) === parts) return { amount: parts, conflict: false, candidates: uniq };
  return { amount: parts || r2(txt || numOk), conflict: true, candidates: uniq };
}

module.exports = { isEnabled, analyzeComprobante, getModel, parseArAmount, resolveAmount };
