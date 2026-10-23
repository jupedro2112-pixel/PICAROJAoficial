/**
 * giroxSimulator — CASINO SIMULADO para el ENTORNO DE PRUEBA (#616, owner 2026-10-20).
 *
 * Problema: en Render no hay Partner API de 1girox, así que nada que mueva plata se podía
 * probar ("quiero que en el test funcione todo como el real"). Este módulo responde a las
 * MISMAS rutas de la Partner API que usa `giroxService._request` (POST /players, GET
 * /players/{u}, /deposit, /withdraw, /bonus, /bonus/claim, /session, /stats, /config…) con
 * JSON de la misma forma, guardando los jugadores y sus saldos en `Config['giroxSimState']`.
 * Todo el resto de giroxService (parsers, idempotencia por reference, reintentos, cache de
 * jugador) corre SIN cambios: lo único que se reemplaza es el viaje por HTTP.
 *
 * ⚠️ SOLO se activa en el entorno de prueba (Render pone RENDER=true, o TESTER_ADMIN_PROMOTE=1)
 * y SIN credenciales reales (ni env ni panel). Con una API real cargada, el simulador se apaga
 * solo. `GIROX_SIMULATE=0` lo apaga a mano; `GIROX_SIMULATE=1` lo fuerza (nunca en producción).
 *
 * Idempotencia: cada operación recuerda su `reference` → repetirla devuelve `duplicate:true`
 * con la operación original, igual que la plataforma real.
 *
 * Stats (netwin) por jugador: `netwin` arranca en 0 y se puede fijar desde el panel con
 * `POST /api/admin/girox-sim` (server.js) para probar reembolsos / referidos.
 */
const Config = require('../models/Config');

const STATE_KEY = 'giroxSimState';
let _state = null;        // { players: { [usernameLower]: player }, seq }
let _loading = null;
let _saveTimer = null;

function isTestEnv() {
  return !!(process.env.RENDER || process.env.TESTER_ADMIN_PROMOTE === '1');
}

/** Activo = entorno de prueba, sin credenciales reales (o forzado por env). */
function active({ hasRealCredentials }) {
  if (process.env.GIROX_SIMULATE === '0') return false;
  if (process.env.GIROX_SIMULATE === '1') return !hasRealCredentials;
  return isTestEnv() && !hasRealCredentials;
}

async function _load() {
  if (_state) return _state;
  if (!_loading) {
    _loading = (async () => {
      let v = null;
      try { v = await Config.get(STATE_KEY, null); } catch (_) {}
      _state = (v && typeof v === 'object' && v.players) ? v : { players: {}, seq: 1000 };
      return _state;
    })();
  }
  return _loading;
}

function _scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try { await Config.set(STATE_KEY, _state, 'girox-sim'); } catch (_) {}
  }, 400);
}

function _now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function _num(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }

function _publicPlayer(p) {
  const bal = _num(p.balance);
  return {
    id: p.id, username: p.username, email: null, active: true, created_at: p.created_at, balance: bal,
    wagering: { available: bal, locked: 0, bonus_locked: 0, claimable_total: 0, claimable: [] }
  };
}

function _err(httpStatus, code, message, extra) {
  return { ok: false, error: message, code, httpStatus, retryable: false, detail: `sim: HTTP ${httpStatus} ${code}`, body: Object.assign({ error: { code, message } }, extra || {}) };
}
function _ok(data, httpStatus = 200) { return { ok: true, data, httpStatus }; }

function _getPlayer(st, username) {
  return st.players[String(username || '').toLowerCase()] || null;
}

function _createPlayer(st, username, password) {
  const key = String(username).toLowerCase();
  if (st.players[key]) return null;
  st.seq = (Number(st.seq) || 1000) + 1;
  const p = { id: st.seq, username: String(username), password: String(password || ''), balance: 0, netwin: 0, wagered: 0, bonusGranted: 0, created_at: _now(), ops: {} };
  st.players[key] = p;
  return p;
}

/** Operación con idempotencia por reference (deposit / withdraw / bonus). */
function _money(st, p, type, body) {
  const amt = _num(body.amount);
  const ref = String(body.reference || ('sim-' + Date.now()));
  if (p.ops[ref]) {
    const op = p.ops[ref];
    return _ok({ duplicate: true, operation: op, balance: _num(p.balance), wagering: _publicPlayer(p).wagering });
  }
  if (!(amt > 0)) return _err(422, 'invalid_amount', 'Monto inválido');
  if (type === 'withdraw') {
    if (amt > _num(p.balance)) return _err(422, 'insufficient_funds', 'Saldo insuficiente', { wagering: _publicPlayer(p).wagering });
    p.balance = _num(p.balance) - amt;
  } else {
    const bonusAmt = type === 'deposit' && body.bonus_amount != null ? _num(body.bonus_amount) : 0;
    p.balance = _num(p.balance) + amt + bonusAmt;
    if (type === 'bonus') p.bonusGranted = _num(p.bonusGranted) + amt;
    if (bonusAmt > 0) p.bonusGranted = _num(p.bonusGranted) + bonusAmt;
  }
  st.seq = (Number(st.seq) || 1000) + 1;
  const op = { ledger_id: st.seq, reference: ref, type, amount: amt, created_at: _now(), description: body.description || null };
  p.ops[ref] = op;
  // no acumular infinito: quedan las últimas 300 operaciones
  const keys = Object.keys(p.ops); if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete p.ops[k];
  _scheduleSave();
  const out = { duplicate: false, operation: op, balance: _num(p.balance), wagering: _publicPlayer(p).wagering };
  if (type === 'deposit' && (body.bonus_amount != null || body.bonus_percent != null)) out.wagering.bonus = { status: 'granted', amount: _num(body.bonus_amount) };
  return _ok(out, 201);
}

function _stats(p, from, to) {
  const totals = { bets_count: p.wagered > 0 ? 10 : 0, wagered: _num(p.wagered), payout: _num(p.wagered) - _num(p.netwin), netwin: _num(p.netwin) };
  return { player: { id: p.id, username: p.username }, from, to, totals, categories: { casino: totals, sports: { bets_count: 0, wagered: 0, payout: 0, netwin: 0 } }, bonus: { granted: _num(p.bonusGranted), still_locked: 0 } };
}

const SIM_CONFIG = {
  simulated: true,
  features: { rollover: false, bonus: true },
  bonus: { enabled: true, standalone_enabled: true, multipliers: [0, 1, 2, 3, 5, 10, 20, 30], fixed_min: 1, fixed_max: 10000000 },
  currency: 'ARS'
};

/**
 * Despacha una request de la Partner API. Devuelve la misma forma que `_request`:
 * { ok:true, data, httpStatus } | { ok:false, error, code, httpStatus, body }.
 */
async function handle({ method, path, body, playUrl }) {
  const st = await _load();
  const m = String(method || 'get').toLowerCase();
  const [pathOnly, qs] = String(path || '').split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const parts = pathOnly.split('/').filter(Boolean); // ['players', 'user', 'deposit']
  body = body || {};

  if (parts[0] === 'config' && m === 'get') return _ok(SIM_CONFIG);
  if (parts[0] !== 'players') return _err(404, 'not_found', 'Ruta no encontrada (simulador)');

  // POST /players (alta)
  if (parts.length === 1 && m === 'post') {
    if (_getPlayer(st, body.username)) return _err(422, 'validation_error', 'The username has already been taken.', { errors: { username: ['The username has already been taken.'] } });
    const p = _createPlayer(st, body.username, body.password);
    _scheduleSave();
    return _ok({ player: _publicPlayer(p) }, 201);
  }
  // POST /players/validate
  if (parts.length === 2 && parts[1] === 'validate' && m === 'post') {
    const p = _getPlayer(st, body.username);
    if (!p) return _err(404, 'player_not_found', 'Jugador no encontrado');
    return _ok({ valid: String(body.password || '') === String(p.password || ''), player: _publicPlayer(p) });
  }
  // POST /players/stats/batch
  if (parts.length === 3 && parts[1] === 'stats' && parts[2] === 'batch' && m === 'post') {
    const players = [], not_found = [];
    for (const u of (Array.isArray(body.usernames) ? body.usernames : [])) {
      const p = _getPlayer(st, u);
      if (!p) { not_found.push(String(u)); continue; }
      const s = _stats(p, body.from, body.to);
      players.push({ id: p.id, username: p.username, totals: s.totals, categories: s.categories, bonus: s.bonus });
    }
    return _ok({ players, not_found, from: body.from, to: body.to });
  }

  const username = decodeURIComponent(parts[1] || '');
  const p = _getPlayer(st, username);
  if (!p) return _err(404, 'player_not_found', 'Jugador no encontrado');
  const action = parts[2] || null;

  if (!action && m === 'get') return _ok({ player: _publicPlayer(p) });
  if (action === 'password' && m === 'put') { p.password = String(body.password || ''); _scheduleSave(); return _ok({ success: true }); }
  if (action === 'session' && m === 'post') {
    // #775: antes mandaba a 1girox.com (la web real, sin sesión) y en el celular el iframe quedaba en "Entrando al casino…".
    // Ahora el casino de prueba es una página NUESTRA (/casino-sim, embebible) con el saldo del simulador y apuesta simulada.
    // #780 (owner: "hace 2 h podía ver Girox"): por defecto vuelve a abrir la web real de 1girox (sin sesión, como siempre fue en
    // Render); la página propia /casino-sim queda disponible sólo con GIROX_SIM_PAGE=1.
    if (process.env.GIROX_SIM_PAGE === '1') return _ok({ redirect_url: '/casino-sim?u=' + encodeURIComponent(p.username), token: 'sim-' + Date.now().toString(36) });
    return _ok({ redirect_url: (playUrl || 'https://1girox.com') + '/?sim_login=' + encodeURIComponent(p.username), token: 'sim-' + Date.now().toString(36) });
  }
  if (action === 'deposit' && m === 'post') return _money(st, p, 'deposit', body);
  if (action === 'withdraw' && m === 'post') return _money(st, p, 'withdraw', body);
  if (action === 'bonus' && m === 'post' && parts[3] === 'claim') return _ok({ amount: 0, claimed: [], wagering: _publicPlayer(p).wagering });
  if (action === 'bonus' && m === 'post') return _money(st, p, 'bonus', body);
  if (action === 'stats' && m === 'get') return _ok(_stats(p, q.from, q.to));
  return _err(404, 'not_found', 'Ruta no encontrada (simulador)');
}

/** Panel/test: fija netwin / apostado / saldo de un jugador simulado (para probar reembolsos y referidos). */
async function adjustPlayer(username, { netwin, wagered, balance } = {}) {
  const st = await _load();
  let p = _getPlayer(st, username);
  if (!p) { p = _createPlayer(st, username, ''); }
  if (netwin != null) p.netwin = _num(netwin);
  if (wagered != null) p.wagered = _num(wagered);
  if (balance != null) p.balance = _num(balance);
  _scheduleSave();
  return _publicPlayer(Object.assign({}, p));
}

// #775: estado y apuesta simulada para la página /casino-sim (sólo entorno de prueba).
async function simState(username) {
  const st = await _load(); const p = _getPlayer(st, username);
  if (!p) return null;
  return { balance: _num(p.balance), rolloverPending: 0, netwin: _num(p.netwin), wagered: _num(p.wagered) };
}
async function simBet(username, amount) {
  const st = await _load(); const p = _getPlayer(st, username);
  if (!p) return { error: 'Jugador no encontrado' };
  const amt = Math.max(1, Math.min(1000000, Math.round(_num(amount) || 1000)));
  if (amt > _num(p.balance)) return { error: 'Saldo insuficiente para apostar' };
  const won = Math.random() < 0.45; const delta = won ? Math.round(amt * 0.9) : -amt;
  p.balance = _num(p.balance) + delta; p.wagered = _num(p.wagered) + amt; p.netwin = _num(p.netwin) - delta; // netwin + = el jugador perdió
  _scheduleSave();
  return { won, delta, balance: _num(p.balance) };
}
async function listPlayers() {
  const st = await _load();
  return Object.values(st.players).map((p) => ({ id: p.id, username: p.username, balance: _num(p.balance), netwin: _num(p.netwin), wagered: _num(p.wagered), ops: Object.keys(p.ops || {}).length, created_at: p.created_at }));
}

async function reset() { _state = { players: {}, seq: 1000 }; _loading = Promise.resolve(_state); _scheduleSave(); }

module.exports = { active, isTestEnv, handle, adjustPlayer, listPlayers, reset, STATE_KEY, simState, simBet };
