/**
 * Adaptador de plataforma: JUGAYGANA — ESQUELETO PREDISEÑADO (2026-10-16).
 *
 * Estado: la API de JUGAYGANA TODAVÍA NO ESTÁ CONECTADA. Mientras `isConnected()` sea
 * false, TODOS los métodos devuelven `{ success:false, code:'not_configured' }` y
 * server.js resuelve "el cliente eligió JUGAYGANA" mandándolo al link externo de la
 * plataforma (`externalUrl` en Config['platforms'], ej. www.jugaygana.com). Nada acá
 * mueve plata hasta que se configure.
 *
 * CÓMO CONECTARLA (cuando el owner tenga la doc de la API de JUGAYGANA):
 *   1. Cargar en SSM / env: JUGAYGANA_API_URL (base, sin barra final), JUGAYGANA_API_KEY
 *      (o el esquema de auth que use — ajustar `_headers`), JUGAYGANA_PLAY_URL (opcional).
 *   2. Ajustar la tabla `ENDPOINTS` (paths + método) y los mapeadores `_mapPlayer`,
 *      `_mapMoney`, `_mapStats` a la forma REAL de las respuestas. Son los ÚNICOS
 *      lugares con supuestos sobre la API: el resto del archivo (rate limit, reintentos,
 *      idempotencia por reference, forma de salida) es igual al de girox y server.js ya
 *      lo consume sin cambios.
 *   3. Si JUGAYGANA no soporta algo (bono adjunto a la carga, stats, SSO), poner esa
 *      `capabilities.*` en false: server.js la lee para abrir o cerrar el flujo.
 *   4. Probar con GET /api/admin/platforms (muestra conectada/no) y una carga manual
 *      chica desde el panel con plataforma = JUGAYGANA.
 *   Checklist completo en `docs/PLATFORMS.md`.
 *
 * CONTRATO (mismos nombres y mismas formas de respuesta que giroxService, para que
 * server.js trate a las dos plataformas con el mismo código):
 *   - plata → { success, duplicate, data:{ transfer_id, transferId, user_balance_after, reference } }
 *   - saldo → { success, balance, available, locked, bonusLocked }
 *   - error → { success:false, error:'<texto para el usuario>', code, httpStatus }
 *   - montos en PESOS (sin ×100). `reference` = llave de idempotencia (ARCHITECTURE §4.4):
 *     el caller la pasa estable y persistida; si JUGAYGANA no la soporta nativamente,
 *     `_request` igual la manda en el body y el caller sigue siendo responsable del
 *     candado local (HgcashCharge / Transaction.id).
 *
 * Todo lazy (process.env se lee en runtime, nunca al require): los secrets vienen de
 * SSM en el bootstrap async, después de los require() de server.js.
 */
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const _fileLogger = require('../utils/logger');

const logger = {
  info: (m) => _fileLogger.info(m),
  warn: (m) => { _fileLogger.warn(m); try { console.warn(new Date().toISOString().slice(0, 19).replace('T', ' ') + ' [WARN] ' + m); } catch (_) {} },
  error: (m) => { _fileLogger.error(m); try { console.error(new Date().toISOString().slice(0, 19).replace('T', ' ') + ' [ERROR] ' + m); } catch (_) {} }
};

const ID = 'jugaygana';

// ============================================================
// CONFIG (lazy)
// ============================================================
function getBaseUrl() { return String(process.env.JUGAYGANA_API_URL || '').trim().replace(/\/+$/, ''); }
function getApiKey() { return process.env.JUGAYGANA_API_KEY || null; }
function getPlayUrl() { return process.env.JUGAYGANA_PLAY_URL || ''; } // sin web pública definida todavía (se carga en el panel → Plataformas)
function isEnabled() { return !!(getBaseUrl() && getApiKey()); }

const TIMEOUT_MS = Number(process.env.JUGAYGANA_TIMEOUT_MS || 20000);
const RETRY_DELAYS_MS = [2000, 5000, 15000];
const MAX_RPM = Number(process.env.JUGAYGANA_MAX_RPM || 55);
const WINDOW_MS = 60000;
const MAX_QUEUE_WAIT_MS = 30000;

// ============================================================
// ENDPOINTS — ⚠️ AJUSTAR A LA DOC DE JUGAYGANA. Único lugar con paths.
// `{u}` se reemplaza por el username (URL-encoded).
// ============================================================
const ENDPOINTS = {
  config:        { method: 'get',  path: '/config' },
  createPlayer:  { method: 'post', path: '/players' },
  getPlayer:     { method: 'get',  path: '/players/{u}' },
  validate:      { method: 'post', path: '/players/validate' },
  password:      { method: 'put',  path: '/players/{u}/password' },
  session:       { method: 'post', path: '/players/{u}/session' },
  deposit:       { method: 'post', path: '/players/{u}/deposit' },
  withdraw:      { method: 'post', path: '/players/{u}/withdraw' },
  bonus:         { method: 'post', path: '/players/{u}/bonus' },
  bonusClaim:    { method: 'post', path: '/players/{u}/bonus/claim' },
  stats:         { method: 'get',  path: '/players/{u}/stats' },
  statsBatch:    { method: 'post', path: '/players/stats/batch' }
};

const ERROR_MESSAGES = {
  player_not_found: 'El usuario no existe en JUGAYGANA.',
  insufficient_funds: 'Saldo insuficiente en JUGAYGANA.',
  rollover_locked: 'Tenés saldo bloqueado por rollover en JUGAYGANA.',
  not_configured: 'JUGAYGANA todavía no está conectado por API.'
};

const NOT_CONFIGURED = Object.freeze({
  success: false,
  code: 'not_configured',
  error: ERROR_MESSAGES.not_configured,
  httpStatus: null
});

// ============================================================
// RATE LIMIT LOCAL (por proceso) + REQUEST con reintentos
// ============================================================
const _timestamps = [];
function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function _acquireSlot() {
  const start = Date.now();
  for (;;) {
    const now = Date.now();
    while (_timestamps.length && now - _timestamps[0] >= WINDOW_MS) _timestamps.shift();
    if (_timestamps.length < MAX_RPM) { _timestamps.push(now); return true; }
    if (now - start > MAX_QUEUE_WAIT_MS) return false;
    await _sleep(Math.max(50, WINDOW_MS - (now - _timestamps[0]) + 5));
  }
}

function _headers() {
  // ⚠️ AJUSTAR al esquema de auth real de JUGAYGANA (X-Api-Key / Bearer / etc.).
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Api-Key': getApiKey()
  };
}

function _normalizeError(e, label) {
  if (!e.response) {
    const isTimeout = e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '');
    return {
      error: isTimeout ? 'JUGAYGANA está demorado. Reintentá en un momento.' : 'No se pudo conectar con JUGAYGANA. Reintentá en un momento.',
      code: e.code || 'network_error', httpStatus: null, retryable: true,
      detail: `${label}: ${e.code || ''} ${e.message || ''}`.trim()
    };
  }
  const httpStatus = e.response.status;
  const body = e.response.data || {};
  const apiCode = (body.error && body.error.code) || body.code || null;
  const apiMessage = (body.error && body.error.message) || body.message || null;
  const ra = e.response.headers && (e.response.headers['retry-after'] || e.response.headers['Retry-After']);
  const raMs = Number.isFinite(Number(ra)) ? Math.min(Number(ra) * 1000, 60000) : null;
  return {
    error: ERROR_MESSAGES[apiCode] || apiMessage || `Error de JUGAYGANA (HTTP ${httpStatus}).`,
    code: apiCode || `http_${httpStatus}`, httpStatus,
    retryable: httpStatus === 429 || httpStatus >= 500, retryAfterMs: raMs,
    detail: `${label}: HTTP ${httpStatus} ${JSON.stringify(body).slice(0, 300)}`, body
  };
}

function _path(ep, username, query) {
  let p = ENDPOINTS[ep].path.replace('{u}', encodeURIComponent(String(username || '')));
  if (query) {
    const qs = Object.entries(query).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    if (qs) p += (p.includes('?') ? '&' : '?') + qs;
  }
  return p;
}

async function _request({ ep, username = null, query = null, body = null, label, retryable = true }) {
  if (!isEnabled()) return { ok: false, ...NOT_CONFIGURED };
  const method = ENDPOINTS[ep].method;
  const url = `${getBaseUrl()}${_path(ep, username, query)}`;
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const wait = lastErr && lastErr.retryAfterMs ? lastErr.retryAfterMs : RETRY_DELAYS_MS[attempt - 1];
      logger.warn(`[jugaygana] ${label} — reintento ${attempt}/${RETRY_DELAYS_MS.length} en ${wait}ms (${lastErr && lastErr.code})`);
      await _sleep(wait);
    }
    if (!(await _acquireSlot())) {
      logger.warn(`[jugaygana] ${label} — rate limit local saturado (${MAX_RPM}/min), abortando`);
      return { ok: false, error: 'JUGAYGANA está saturado. Reintentá en un minuto.', code: 'rate_limited_local', httpStatus: null };
    }
    try {
      const resp = await axios({ method, url, data: body || undefined, headers: _headers(), timeout: TIMEOUT_MS, proxy: false });
      return { ok: true, data: resp.data || {}, httpStatus: resp.status };
    } catch (e) {
      lastErr = _normalizeError(e, label);
      logger.warn(`[jugaygana] ${lastErr.detail}`);
      if (!retryable || !lastErr.retryable || attempt === RETRY_DELAYS_MS.length) return { ok: false, ...lastErr };
    }
  }
  return { ok: false, ...(lastErr || { error: 'Error desconocido', code: 'unknown', httpStatus: null }) };
}

// ============================================================
// MAPEADORES — ⚠️ AJUSTAR a la forma real de las respuestas de JUGAYGANA.
// ============================================================
function _normalizeAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Jugador → forma común (la misma que devuelve girox.getUserInfoByName). */
function _mapPlayer(p) {
  if (!p) return null;
  const balance = p.balance != null ? Number(p.balance) : 0;
  const w = p.wagering || null;
  return {
    id: p.id != null ? p.id : null,
    username: p.username || null,
    balance,
    available: w && w.available != null ? Number(w.available) : balance,
    locked: w && w.locked != null ? Number(w.locked) : 0,
    bonusLocked: w && w.bonus_locked != null ? Number(w.bonus_locked) : 0,
    claimableTotal: 0,
    wagering: w,
    raw: p
  };
}

/** Operación de plata → forma común (transfer_id / user_balance_after / duplicate). */
function _mapMoney(d) {
  const op = (d && d.operation) || {};
  const idStr = op.ledger_id != null ? String(op.ledger_id) : (op.id != null ? String(op.id) : (op.reference || null));
  return {
    success: true,
    duplicate: !!(d && d.duplicate),
    data: {
      transfer_id: idStr, transferId: idStr,
      user_balance_after: d && d.balance != null ? Number(d.balance) : undefined,
      reference: op.reference || null,
      duplicate: !!(d && d.duplicate),
      wagering: (d && d.wagering) || null
    }
  };
}

function _n(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function _totals(t) { return { betsCount: _n(t && t.bets_count), wagered: _n(t && t.wagered), payout: _n(t && t.payout), netwin: _n(t && t.netwin) }; }
/** Stats → forma común de girox.getPlayerStats (netwin POSITIVO = el jugador perdió). */
function _mapStats(d, username, from, to) {
  const totals = _totals(d && d.totals);
  const cats = (d && d.categories) || {};
  const casino = _totals(cats.casino);
  const sports = _totals(cats.sports);
  return {
    success: true,
    playerId: d && d.player && d.player.id != null ? d.player.id : null,
    username: (d && d.player && d.player.username) || String(username),
    from, to,
    netwin: totals.netwin, casinoNetwin: casino.netwin, sportsNetwin: sports.netwin,
    wagered: totals.wagered, payout: totals.payout, betsCount: totals.betsCount,
    bonusGranted: _n(d && d.bonus && d.bonus.granted),
    bonusStillLocked: _n(d && d.bonus && d.bonus.still_locked),
    categories: { casino, sports }
  };
}

function formatStatsDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const opts = { timeZone: 'America/Argentina/Buenos_Aires' };
  return `${d.toLocaleDateString('en-CA', opts)} ${d.toLocaleTimeString('en-GB', { ...opts, hour12: false })}`;
}

function _buildReference(prefix, explicit) {
  if (explicit) return String(explicit).slice(0, 100);
  const generated = `${prefix}-${uuidv4()}`;
  logger.warn(`[jugaygana] operación SIN reference estable — se generó ${generated}.`);
  return generated;
}

function _fail(r) { return { success: false, error: r.error, code: r.code, httpStatus: r.httpStatus }; }

// ============================================================
// CONTRATO — mismos métodos que giroxService
// ============================================================

/** Reglas de username: se asumen las mismas que girox hasta tener la doc. */
function validateUsername(username) {
  const u = String(username || '');
  if (u.length < 3) return { valid: false, reason: 'menos de 3 caracteres' };
  if (u.length > 18) return { valid: false, reason: `${u.length} caracteres (máximo 18)` };
  if (!/^[A-Za-z0-9_]+$/.test(u)) return { valid: false, reason: 'tiene caracteres no permitidos (sólo letras, números y _)' };
  return { valid: true };
}

async function ping() {
  if (!isEnabled()) return { ...NOT_CONFIGURED, configured: false };
  const r = await _request({ ep: 'config', label: 'ping' });
  return r.ok ? { success: true, configured: true } : { ...r, success: false, configured: true };
}

async function getPlatformConfig() {
  const r = await _request({ ep: 'config', label: 'config' });
  return r.ok ? { success: true, config: r.data || {} } : _fail(r);
}

async function createPlatformUser({ username, password }) {
  if (!isEnabled()) return { ...NOT_CONFIGURED };
  const check = validateUsername(username);
  if (!check.valid) return { success: false, error: `Usuario inválido para JUGAYGANA: ${check.reason}`, code: 'invalid_username' };
  const r = await _request({ ep: 'createPlayer', body: { username: String(username), password: String(password) }, label: `createPlayer(${username})` });
  if (r.ok) return { success: true, player: _mapPlayer((r.data && r.data.player) || r.data) };
  if (r.httpStatus === 422 && /username|exist/i.test(JSON.stringify(r.body || {}))) {
    return { success: false, error: r.error, code: 'username_taken', alreadyExists: true };
  }
  return _fail(r);
}

async function getUserInfoByName(username) {
  if (!isEnabled()) return null;
  const r = await _request({ ep: 'getPlayer', username, label: `getPlayer(${username})`, retryable: true });
  if (!r.ok) return null;
  return _mapPlayer((r.data && r.data.player) || r.data);
}

async function checkUserExists(username) { return !!(await getUserInfoByName(username)); }

async function syncUserToPlatform({ username, password }) {
  if (!isEnabled()) return { ...NOT_CONFIGURED };
  const existing = await getUserInfoByName(username);
  if (existing) return { success: true, alreadyExists: true, platformUsername: existing.username, player: existing };
  const created = await createPlatformUser({ username, password });
  if (created.success) return { success: true, alreadyExists: false, platformUsername: username, player: created.player };
  if (created.alreadyExists) {
    return { success: false, foreignUsername: true, code: 'username_taken_foreign', error: 'Ese nombre de usuario ya está en uso en JUGAYGANA. Elegí otro nombre.' };
  }
  return { success: false, error: created.error, code: created.code };
}

async function validateCredentials(username, password) {
  const r = await _request({ ep: 'validate', body: { username: String(username), password: String(password) }, label: `validate(${username})` });
  if (!r.ok) return { success: false, valid: false, error: r.error, code: r.code };
  return { success: true, valid: !!(r.data && r.data.valid), player: _mapPlayer(r.data && r.data.player) };
}

async function changeUserPassword(username, newPassword) {
  if (!newPassword || String(newPassword).length < 6) return { success: false, error: 'La contraseña debe tener al menos 6 caracteres', code: 'invalid_password' };
  const r = await _request({ ep: 'password', username, body: { password: String(newPassword) }, label: `changePassword(${username})` });
  return r.ok ? { success: true } : _fail(r);
}

/** Login único. Devuelve { success, redirectUrl }. */
async function createSession(username) {
  const r = await _request({ ep: 'session', username, body: {}, label: `session(${username})` });
  if (!r.ok) return _fail(r);
  const redirectUrl = r.data && (r.data.redirect_url || r.data.redirectUrl || r.data.url);
  if (!redirectUrl) return { success: false, error: 'JUGAYGANA no devolvió el link de acceso.', code: 'no_redirect_url' };
  return { success: true, redirectUrl, token: (r.data && r.data.token) || null };
}

async function depositToUser(username, amount, description = '', reference = null, wagering = null) {
  if (!isEnabled()) return { ...NOT_CONFIGURED };
  const amt = _normalizeAmount(amount);
  if (amt === null) return { success: false, error: 'Monto inválido', code: 'invalid_amount' };
  const body = { amount: amt, reference: _buildReference('dep', reference) };
  if (description) body.description = String(description).slice(0, 500);
  if (wagering && module.exports.capabilities.depositBonus) {
    if (wagering.bonusAmount != null) body.bonus_amount = Number(wagering.bonusAmount);
    if (wagering.bonusMultiplier != null) body.bonus_multiplier = Number(wagering.bonusMultiplier);
    if (wagering.multiplier != null) body.multiplier = Number(wagering.multiplier);
  }
  let r = await _request({ ep: 'deposit', username, body, label: `deposit(${username}, $${amt}, ref=${body.reference})` });
  if (!r.ok && r.code === 'player_not_found') {
    // Misma red de seguridad que girox: crear al vuelo y reintentar con la MISMA reference.
    const provisional = require('crypto').randomBytes(12).toString('base64url');
    const created = await createPlatformUser({ username, password: provisional });
    if (created.success || created.alreadyExists) {
      r = await _request({ ep: 'deposit', username, body, label: `deposit-retry(${username}, $${amt})` });
    }
  }
  if (!r.ok) return _fail(r);
  const out = _mapMoney(r.data);
  if (r.data && r.data.wagering && r.data.wagering.bonus && r.data.wagering.bonus.status === 'failed') out.bonusFailed = true;
  return out;
}

async function withdrawFromUser(username, amount, description = '', reference = null) {
  if (!isEnabled()) return { ...NOT_CONFIGURED };
  const amt = _normalizeAmount(amount);
  if (amt === null) return { success: false, error: 'Monto inválido', code: 'invalid_amount' };
  const body = { amount: amt, reference: _buildReference('wd', reference) };
  if (description) body.description = String(description).slice(0, 500);
  const r = await _request({ ep: 'withdraw', username, body, label: `withdraw(${username}, $${amt}, ref=${body.reference})` });
  if (!r.ok) return { ..._fail(r), wagering: (r.body && r.body.wagering) || null };
  return _mapMoney(r.data);
}

/** Regalo (bono 0 = retirable al instante). `opts.multiplier` explícito = bono con rollover. */
async function creditUserBalance(username, amount, reference = null, opts = {}) {
  if (!isEnabled()) return { ...NOT_CONFIGURED };
  const amt = _normalizeAmount(amount);
  if (amt === null) return { success: false, error: 'Monto inválido', code: 'invalid_amount' };
  const body = { amount: amt, multiplier: opts && opts.multiplier != null ? Number(opts.multiplier) : 0, reference: _buildReference('bonus', reference) };
  if (opts && opts.description) body.description = String(opts.description).slice(0, 500);
  const r = await _request({ ep: 'bonus', username, body, label: `bonus(${username}, $${amt}, x${body.multiplier}, ref=${body.reference})` });
  if (!r.ok) return _fail(r);
  return Object.assign(_mapMoney(r.data), { creditedAs: 'bonus' });
}

async function creditGift(username, amount, opts = {}) {
  return creditUserBalance(username, amount, opts && opts.reference, { multiplier: Number(opts && opts.rolloverX) || 0, description: opts && opts.description });
}

async function claimPendingBonus(username, requirementId = null) {
  if (!isEnabled()) return { ...NOT_CONFIGURED };
  const body = {};
  if (requirementId != null) body.requirement_id = Number(requirementId);
  const r = await _request({ ep: 'bonusClaim', username, body, label: `bonusClaim(${username})` });
  if (!r.ok) return _fail(r);
  return { success: true, amount: _n(r.data && r.data.amount), claimed: Array.isArray(r.data && r.data.claimed) ? r.data.claimed : [] };
}

async function getUserBalance(username) {
  if (!isEnabled()) return { ...NOT_CONFIGURED };
  const info = await getUserInfoByName(username);
  if (!info) return { success: false, error: 'No se pudo leer el saldo en JUGAYGANA.', code: 'player_not_found' };
  return { success: true, username: info.username, balance: info.balance, available: info.available, locked: info.locked, bonusLocked: info.bonusLocked, claimableTotal: 0, wagering: info.wagering };
}

async function getUserBalanceWithRetry(username, { maxAttempts = 3, baseDelayMs = 500 } = {}) {
  let last = null;
  for (let i = 1; i <= maxAttempts; i++) {
    last = await getUserBalance(username);
    if (last.success || last.code === 'not_configured') return last;
    if (i < maxAttempts) await _sleep(baseDelayMs * Math.pow(2, i - 1));
  }
  return { ...last, attemptsExhausted: true };
}

async function getPlayerStats(username, fromDate, toDate, label = 'stats') {
  if (!isEnabled()) return { ...NOT_CONFIGURED };
  const from = formatStatsDate(fromDate), to = formatStatsDate(toDate);
  if (!from || !to) return { success: false, error: 'Rango de fechas inválido', code: 'invalid_range' };
  const r = await _request({ ep: 'stats', username, query: { from, to }, label: `${label}(${username})` });
  if (!r.ok) return _fail(r);
  return _mapStats(r.data, username, from, to);
}

async function getPlayersStatsBatch(usernames, fromDate, toDate, label = 'stats-batch') {
  if (!isEnabled()) return { ...NOT_CONFIGURED };
  const from = formatStatsDate(fromDate), to = formatStatsDate(toDate);
  const list = Array.from(new Set((usernames || []).map(String).filter(Boolean))).slice(0, 100);
  if (!list.length) return { success: true, players: {}, notFound: [] };
  const r = await _request({ ep: 'statsBatch', body: { usernames: list, from, to }, label });
  if (!r.ok) return _fail(r);
  const players = {};
  const arr = Array.isArray(r.data && r.data.players) ? r.data.players : [];
  for (const p of arr) {
    const u = p && p.player && p.player.username;
    if (u) players[String(u).toLowerCase()] = _mapStats(p, u, from, to);
  }
  return { success: true, players, notFound: Array.isArray(r.data && r.data.not_found) ? r.data.not_found : [] };
}

async function getUserMovements() {
  return { success: false, error: 'El historial de movimientos no está disponible en JUGAYGANA.', code: 'not_supported' };
}

module.exports = {
  id: ID,
  defaultName: 'JUGAYGANA',
  defaultEmoji: '🎲',
  isEnabled,
  isConnected: isEnabled,
  getPlayUrl,
  getBaseUrl,
  // ⚠️ Poner en false lo que JUGAYGANA NO soporte (server.js lo lee).
  capabilities: { deposit: true, withdraw: true, gift: true, depositBonus: true, stats: true, sso: true },
  validateUsername,
  ping,
  getPlatformConfig,
  createPlatformUser,
  getUserInfoByName,
  checkUserExists,
  syncUserToPlatform,
  validateCredentials,
  changeUserPassword,
  createSession,
  depositToUser,
  withdrawFromUser,
  creditUserBalance,
  creditGift,
  claimPendingBonus,
  getUserBalance,
  getUserBalanceWithRetry,
  getPlayerStats,
  getPlayersStatsBatch,
  getUserMovements,
  formatStatsDate
};
