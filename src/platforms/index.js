/**
 * REGISTRO DE PLATAFORMAS (multi-plataforma, 2026-10-16).
 *
 * Hasta hoy el repo asumía UNA plataforma de juego (1girox). Desde acá se pueden
 * ofrecer varias: cuando entra una transferencia, al cliente se le pregunta DÓNDE
 * quiere jugar y la carga va a esa plataforma (server.js, `_hgcashCreditToPlatform`).
 *
 * Cada plataforma es un ADAPTADOR con el MISMO contrato (ver docs/PLATFORMS.md):
 *   - `src/platforms/girox.js`   → envoltura de giroxService (la que opera hoy).
 *   - `src/platforms/ganamos.js` → esqueleto prediseñado; sin API configurada
 *                                  (`isConnected()` false) el cliente que la elige se
 *                                  manda al `externalUrl` (www.ganamosvip.me).
 *
 * La configuración EDITABLE vive en Config['platforms'] (panel → Configuración →
 * "🎮 Plataformas de juego"):
 *   {
 *     askMode: 'always' | 'first_time' | 'never',
 *       always     = pregunta en CADA carga (default, pedido del owner)
 *       first_time = pregunta sólo si el cliente nunca eligió; después usa la última
 *       never      = nunca pregunta: carga en la última elegida o la default
 *     askTimeoutMin: 10,          // sin respuesta → se carga en la última/default
 *     defaultPlatform: 'girox',
 *     items: { <id>: { enabled, name, emoji, order, externalUrl } }
 *   }
 * `connected` NO se configura: lo dice el adaptador (env de la API presente).
 *
 * Para AGREGAR una plataforma: crear `src/platforms/<id>.js` con el contrato, sumarla a
 * `ADAPTERS` y a `DEFAULT_ITEMS`. Nada más: server.js, el panel y la PWA listan desde acá.
 */
const Config = require('../models/Config');

const ADAPTERS = {
  girox: require('./girox'),
  ganamos: require('./ganamos'),
  jugaygana: require('./jugaygana') // #378: esqueleto, "Próximamente" hasta tener API
};

const DEFAULT_ID = 'girox';
const CONFIG_KEY = 'platforms';

// logoUrl (#232): imagen de la plataforma (landing y app). Ruta del repo ("/images/…") o https.
// Ganamos arranca sin logo → se muestra un badge con el nombre hasta que el panel cargue uno.
const DEFAULT_ITEMS = {
  girox:   { enabled: true, name: 'Girox',   emoji: '🎰', order: 1, externalUrl: '', logoUrl: '/images/soporte-1girox.png' },
  // #298 (owner): Ganamos HABILITADA y visible, pero sin API se muestra "Próximamente" y no se puede elegir (connected=false).
  ganamos: { enabled: true, name: 'Ganamos', emoji: '🎲', order: 2, externalUrl: 'https://www.ganamosvip.me', logoUrl: '/images/ganamos-net.png' }, // #350: logo real (pica violeta)
  // #378 (owner 2026-10-18): JUGAYGANA visible como "Próximamente" (sin API ni web pública todavía; la URL se carga en el panel).
  jugaygana: { enabled: true, name: 'JUGAYGANA', emoji: '🃏', order: 3, externalUrl: '', logoUrl: '/images/jugaygana.png' }
};

const DEFAULT_SETTINGS = {
  askMode: 'always',
  askTimeoutMin: 10,
  defaultPlatform: DEFAULT_ID
};

const ASK_MODES = ['always', 'first_time', 'never'];

// Cache corto por proceso (los crons y el webhook leen esto seguido; el panel lo
// cambia poco). Con 2 instancias de EB un cambio tarda hasta 30 s en verse en la otra.
const CACHE_TTL_MS = 30000;
let _cache = null;
let _cacheAt = 0;

function ids() { return Object.keys(ADAPTERS); }

/** Devuelve el id válido o null. Acepta mayúsculas y espacios. */
function normalizeId(x) {
  const s = String(x || '').trim().toLowerCase();
  return ADAPTERS[s] ? s : null;
}

function getAdapter(id) {
  return ADAPTERS[normalizeId(id) || ''] || null;
}

function _normalizeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const url = new URL(s); return url.href.replace(/\/+$/, ''); } catch (_) { return ''; }
}

function _normalizeLogo(u) {
  let s = String(u || '').trim().slice(0, 300);
  if (s === '/images/ganamos.svg' || s === '/images/ganamos-net.png') s = '/images/ganamos-net.png'; // #350/#513: logo original de Ganamos (archivo nuevo = sin caché vieja)
  if (!s) return '';
  if (/^\/[A-Za-z0-9_\-./]+$/.test(s)) return s;           // ruta del repo (/images/x.png)
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;             // https externo
  return '';
}
function _normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    askMode: ASK_MODES.includes(r.askMode) ? r.askMode : DEFAULT_SETTINGS.askMode,
    askTimeoutMin: Math.min(180, Math.max(1, Math.round(Number(r.askTimeoutMin) || DEFAULT_SETTINGS.askTimeoutMin))),
    defaultPlatform: normalizeId(r.defaultPlatform) || DEFAULT_ID,
    items: {}
  };
  const items = r.items && typeof r.items === 'object' ? r.items : {};
  for (const id of ids()) {
    const d = DEFAULT_ITEMS[id] || { enabled: false, name: id, emoji: '🎮', order: 99, externalUrl: '' };
    const it = items[id] && typeof items[id] === 'object' ? items[id] : {};
    out.items[id] = {
      enabled: it.enabled == null ? d.enabled : it.enabled === true,
      name: String(it.name || d.name).trim().slice(0, 40) || d.name,
      emoji: String(it.emoji || d.emoji).trim().slice(0, 8) || d.emoji,
      order: Number.isFinite(Number(it.order)) ? Number(it.order) : d.order,
      externalUrl: it.externalUrl != null ? _normalizeUrl(it.externalUrl) : d.externalUrl,
      logoUrl: it.logoUrl != null ? _normalizeLogo(it.logoUrl) : (d.logoUrl || '')
    };
  }
  // La default tiene que estar habilitada; si no, cae a la primera habilitada (o girox).
  if (!out.items[out.defaultPlatform] || !out.items[out.defaultPlatform].enabled) {
    const firstOn = ids().filter((id) => out.items[id].enabled).sort((a, b) => out.items[a].order - out.items[b].order)[0];
    out.defaultPlatform = firstOn || DEFAULT_ID;
  }
  return out;
}

/** Settings normalizados (cache 30 s). Nunca tira: ante error devuelve los defaults. */
async function getSettings({ fresh = false } = {}) {
  if (!fresh && _cache && (Date.now() - _cacheAt) < CACHE_TTL_MS) return _cache;
  let raw = null;
  try { raw = await Config.get(CONFIG_KEY, null); } catch (_) { raw = null; }
  _cache = _normalizeSettings(raw);
  _cacheAt = Date.now();
  return _cache;
}

function invalidateCache() { _cache = null; _cacheAt = 0; }

/** Guarda (merge sobre lo actual) y devuelve los settings normalizados. */
async function saveSettings(patch, updatedBy = null) {
  const cur = await getSettings({ fresh: true });
  const p = patch && typeof patch === 'object' ? patch : {};
  const merged = {
    askMode: p.askMode != null ? p.askMode : cur.askMode,
    askTimeoutMin: p.askTimeoutMin != null ? p.askTimeoutMin : cur.askTimeoutMin,
    defaultPlatform: p.defaultPlatform != null ? p.defaultPlatform : cur.defaultPlatform,
    items: Object.assign({}, cur.items)
  };
  if (p.items && typeof p.items === 'object') {
    for (const id of ids()) {
      if (p.items[id] && typeof p.items[id] === 'object') merged.items[id] = Object.assign({}, cur.items[id], p.items[id]);
    }
  }
  const out = _normalizeSettings(merged);
  await Config.set(CONFIG_KEY, out, updatedBy);
  invalidateCache();
  return out;
}

function _describe(id, settings) {
  const a = ADAPTERS[id];
  const it = settings.items[id];
  return {
    id,
    name: it.name,
    emoji: it.emoji,
    order: it.order,
    enabled: it.enabled,
    externalUrl: it.externalUrl || '',
    logoUrl: it.logoUrl || '',
    connected: !!(a && typeof a.isConnected === 'function' && a.isConnected()),
    capabilities: (a && a.capabilities) || {},
    isDefault: settings.defaultPlatform === id
  };
}

/** TODAS las plataformas (habilitadas o no), ordenadas. Para el panel. */
async function listAll() {
  const s = await getSettings();
  return ids().map((id) => _describe(id, s)).sort((a, b) => a.order - b.order);
}

/** Sólo las HABILITADAS, ordenadas. Es lo que se le ofrece al cliente. */
async function listEnabled() {
  return (await listAll()).filter((p) => p.enabled);
}

/** ¿Hay que preguntarle al cliente dónde cargar? (2+ habilitadas y askMode ≠ never). */
async function isChoiceEnabled() {
  const s = await getSettings();
  if (s.askMode === 'never') return false;
  return ids().filter((id) => s.items[id].enabled).length >= 2;
}

/**
 * Plataforma a usar SIN preguntar (timeout, askMode never/first_time, una sola
 * habilitada): la última que eligió el usuario si sigue habilitada; si no, la default.
 */
async function resolveDefaultFor(user) {
  const s = await getSettings();
  const pref = normalizeId(user && user.preferredPlatform);
  if (pref && s.items[pref] && s.items[pref].enabled) return pref;
  const last = normalizeId(user && user.lastPlatform);
  if (last && s.items[last] && s.items[last].enabled) return last;
  return s.defaultPlatform;
}

/**
 * Decide qué hacer con una carga que entra para `user`:
 *   { ask: true, options:[...] }           → preguntarle (manda las opciones)
 *   { ask: false, platform: '<id>' }       → cargar directo ahí
 */
async function decideForDeposit(user) {
  const s = await getSettings();
  const enabled = await listEnabled();
  // #298: una plataforma habilitada pero SIN API es "Próximamente": se ve en la app pero no se ofrece al cargar.
  const offer = enabled.filter((p) => p.connected || p.id === DEFAULT_ID); // #301: Girox (default) siempre se ofrece
  const isOffered = (id) => offer.some((p) => p.id === id);
  if (offer.length < 2 || s.askMode === 'never') {
    const def = await resolveDefaultFor(user);
    const pid = isOffered(def) ? def : ((offer[0] && offer[0].id) || def);
    return { ask: false, platform: pid, reason: offer.length < 2 ? 'single' : 'never' };
  }
  // Plataforma FIJA del cliente (#225): la eligió en la app → no se pregunta.
  // #781 (owner): quien nunca eligió tiene la DEFAULT (Girox) como fija: no se pregunta; sólo cambia si toca otra tarjeta en la app.
  const pref = normalizeId(user && user.preferredPlatform) || s.defaultPlatform;
  if (pref && isOffered(pref)) return { ask: false, platform: pref, reason: 'preferred' };
  const last = normalizeId(user && user.lastPlatform);
  if (s.askMode === 'first_time' && last && isOffered(last)) {
    return { ask: false, platform: last, reason: 'first_time' };
  }
  return { ask: true, options: offer.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, connected: p.connected, externalUrl: p.externalUrl, logoUrl: p.logoUrl || '' })), timeoutMin: s.askTimeoutMin };
}

/** Nombre visible (con emoji) — sync, usa el cache si lo hay. */
function labelOf(id, { emoji = true } = {}) {
  const nid = normalizeId(id) || id || '?';
  const s = _cache || _normalizeSettings(null);
  const it = s.items[nid] || DEFAULT_ITEMS[nid] || { name: String(nid), emoji: '🎮' };
  return emoji ? `${it.emoji} ${it.name}` : it.name;
}

module.exports = {
  DEFAULT_ID,
  CONFIG_KEY,
  ASK_MODES,
  ids,
  normalizeId,
  getAdapter,
  getSettings,
  saveSettings,
  invalidateCache,
  listAll,
  listEnabled,
  isChoiceEnabled,
  resolveDefaultFor,
  decideForDeposit,
  labelOf
};
