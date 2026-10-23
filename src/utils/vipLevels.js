/**
 * vipLevels.js — Niveles VIP por APOSTADO ACUMULADO (rollover de por vida).
 *
 * REGLA DE NEGOCIO (owner, 2026-08-03):
 *   Se progresa por el TOTAL APOSTADO DE POR VIDA en el casino (wagered de la Partner API),
 *   NO por pérdidas ni por depósitos. Cada apuesta suma, gane o pierda. El nivel NUNCA baja.
 *
 * ESCALERA (#292, owner 2026-10-17): réplica del programa de lealtad oficial de 1win
 * (1win.com/loyalty-program), que sube por turnover acumulado: Bronze 2 US$5.000 · Bronze 3
 * US$10.000 · Silver 1-3 US$25k/50k/100k · Gold 1-3 US$250k/500k/1M · Platinum 1-3 US$2,5M/5M/10M ·
 * Diamond 1-3 US$25M/50M/100M · Black 1-5 US$250M/500M/1.000M/2.500M/5.000M. (Bronze 1 = sin nivel.)
 * Los umbrales se convierten a PESOS a la tasa `usdArsRate` (default 1500; env VIP_USD_ARS_RATE).
 * Antes (2026-08-03 → 2026-10-17) la escalera era la de Stake, 14 niveles.
 *
 * TODO ES EDITABLE desde el panel (Configuración → Niveles VIP → escalera): nombre, umbral en pesos,
 * bono al subir y rakeback % por nivel + la tasa. Vive en Config['vipLevelsConfig'] y cada instancia la
 * recarga con `refreshFromConfig(Config)` (boot + cada 60 s + al guardar). Sin config ⇒ defaults de acá.
 *
 * ⚠️ NO CONFUNDIR con los rangos de reembolso (src/utils/refundTiers.js): esos son POR PERÍODO
 * sobre la pérdida y se resetean en cada reclamo. Estos niveles son PERMANENTES y por apostado.
 *
 * Qué destraba cada nivel:
 *   - Bono one-time al alcanzarlo (levelUpBonusArs): queda PENDIENTE y el cliente lo reclama desde la app
 *     eligiendo plataforma (reference idempotente `vip-lvl-{userId}-{idx}` ⇒ imposible pagarlo dos veces).
 *   - Rakeback semanal (rakebackPct % del apostado de casino de la semana pasada, gane o pierda).
 *
 * Sostenibilidad (guía para el panel): el bono de nivel default es el 0,1% del apostado del umbral
 * (US$5.000 × 1500 = $7,5M apostados ⇒ $7.500) y el rakeback 0,10–0,80% del apostado semanal; la ventaja
 * de la casa en slots ronda el 3–5% del apostado, así que lo regalado queda muy por debajo de lo que el
 * volumen ya dejó. Subir el bono a 0,2–0,3% sigue siendo seguro; más de 1% ya come margen.
 *
 * ⚠️ idx es 1-based; 0 = sin nivel. NO reordenar ni insertar niveles en el medio (sólo AGREGAR al final):
 * el idx se persiste en User.vipLevel / vipPendingLevelBonuses y en las references de los bonos.
 */

const DEFAULT_USD_ARS_RATE = 1500;
const CONFIG_KEY = 'vipLevelsConfig';

// bono default = usd × 1500 × 0,1% = usd × 1,5
const VIP_LEVELS = [
  { idx: 1,  key: 'bronce2',    name: 'Bronce II',    emoji: '🥉', color: '#cd7f32', usd: 5000,       levelUpBonusArs: 7500,       rakebackPct: 0.10 },
  { idx: 2,  key: 'bronce3',    name: 'Bronce III',   emoji: '🥉', color: '#cd7f32', usd: 10000,      levelUpBonusArs: 15000,      rakebackPct: 0.12 },
  { idx: 3,  key: 'plata1',     name: 'Plata I',      emoji: '🥈', color: '#c0c0c0', usd: 25000,      levelUpBonusArs: 37500,      rakebackPct: 0.15 },
  { idx: 4,  key: 'plata2',     name: 'Plata II',     emoji: '🥈', color: '#c0c0c0', usd: 50000,      levelUpBonusArs: 75000,      rakebackPct: 0.18 },
  { idx: 5,  key: 'plata3',     name: 'Plata III',    emoji: '🥈', color: '#c0c0c0', usd: 100000,     levelUpBonusArs: 150000,     rakebackPct: 0.20 },
  { idx: 6,  key: 'oro1',       name: 'Oro I',        emoji: '🥇', color: '#ffd700', usd: 250000,     levelUpBonusArs: 375000,     rakebackPct: 0.25 },
  { idx: 7,  key: 'oro2',       name: 'Oro II',       emoji: '🥇', color: '#ffd700', usd: 500000,     levelUpBonusArs: 750000,     rakebackPct: 0.28 },
  { idx: 8,  key: 'oro3',       name: 'Oro III',      emoji: '🥇', color: '#ffd700', usd: 1000000,    levelUpBonusArs: 1500000,    rakebackPct: 0.30 },
  { idx: 9,  key: 'platino1',   name: 'Platino I',    emoji: '💠', color: '#7fd4e0', usd: 2500000,    levelUpBonusArs: 3750000,    rakebackPct: 0.35 },
  { idx: 10, key: 'platino2',   name: 'Platino II',   emoji: '💠', color: '#7fd4e0', usd: 5000000,    levelUpBonusArs: 7500000,    rakebackPct: 0.38 },
  { idx: 11, key: 'platino3',   name: 'Platino III',  emoji: '💠', color: '#7fd4e0', usd: 10000000,   levelUpBonusArs: 15000000,   rakebackPct: 0.40 },
  { idx: 12, key: 'diamante1',  name: 'Diamante I',   emoji: '💎', color: '#b9f2ff', usd: 25000000,   levelUpBonusArs: 37500000,   rakebackPct: 0.45 },
  { idx: 13, key: 'diamante2',  name: 'Diamante II',  emoji: '💎', color: '#b9f2ff', usd: 50000000,   levelUpBonusArs: 75000000,   rakebackPct: 0.50 },
  { idx: 14, key: 'diamante3',  name: 'Diamante III', emoji: '💎', color: '#b9f2ff', usd: 100000000,  levelUpBonusArs: 150000000,  rakebackPct: 0.55 },
  { idx: 15, key: 'black1',     name: 'Black I',      emoji: '🖤', color: '#cfd3dc', usd: 250000000,  levelUpBonusArs: 375000000,  rakebackPct: 0.60 },
  { idx: 16, key: 'black2',     name: 'Black II',     emoji: '🖤', color: '#cfd3dc', usd: 500000000,  levelUpBonusArs: 750000000,  rakebackPct: 0.65 },
  { idx: 17, key: 'black3',     name: 'Black III',    emoji: '🖤', color: '#cfd3dc', usd: 1000000000, levelUpBonusArs: 1500000000, rakebackPct: 0.70 },
  { idx: 18, key: 'black4',     name: 'Black IV',     emoji: '🖤', color: '#cfd3dc', usd: 2500000000, levelUpBonusArs: 3750000000, rakebackPct: 0.75 },
  { idx: 19, key: 'black5',     name: 'Black V',      emoji: '🖤', color: '#cfd3dc', usd: 5000000000, levelUpBonusArs: 7500000000, rakebackPct: 0.80 }
];

// Overrides cargados desde Config['vipLevelsConfig'] (normalizados). null = defaults puros.
let _cfg = null;

function _envRate() {
  const r = Number(process.env.VIP_USD_ARS_RATE);
  return Number.isFinite(r) && r > 0 ? r : DEFAULT_USD_ARS_RATE;
}
function _rate() { return (_cfg && _cfg.usdArsRate > 0) ? _cfg.usdArsRate : _envRate(); }

/** Normaliza lo que viene de Config/panel: { usdArsRate, levels: { "<idx>": {...} } }. Nunca tira. */
function normalizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rate = Number(r.usdArsRate);
  const out = { usdArsRate: Number.isFinite(rate) && rate > 0 ? Math.round(rate) : null, levels: {} };
  const lv = r.levels && typeof r.levels === 'object' ? r.levels : {};
  for (const k of Object.keys(lv)) {
    const idx = parseInt(k, 10);
    if (!(idx >= 1 && idx <= VIP_LEVELS.length)) continue;
    const o = lv[k] && typeof lv[k] === 'object' ? lv[k] : {};
    const th = Number(o.thresholdArs), bo = Number(o.levelUpBonusArs), rk = Number(o.rakebackPct);
    const n = {};
    if (o.name != null && String(o.name).trim()) n.name = String(o.name).trim().slice(0, 30);
    if (o.emoji != null && String(o.emoji).trim()) n.emoji = String(o.emoji).trim().slice(0, 4);
    if (o.color && /^#[0-9a-fA-F]{3,8}$/.test(String(o.color))) n.color = String(o.color);
    if (Number.isFinite(th) && th > 0) n.thresholdArs = Math.round(th);
    if (Number.isFinite(bo) && bo >= 0) n.levelUpBonusArs = Math.round(bo);
    if (Number.isFinite(rk) && rk >= 0 && rk <= 20) n.rakebackPct = Math.round(rk * 100) / 100;
    if (Object.keys(n).length) out.levels[idx] = n;
  }
  return out;
}

/** Aplica overrides en memoria (cada instancia). */
function setOverrides(raw) { _cfg = raw ? normalizeConfig(raw) : null; }

/** Lee Config['vipLevelsConfig'] y aplica. Se llama al boot, cada 60 s y al guardar desde el panel. */
async function refreshFromConfig(Config) {
  try {
    const raw = await Config.get(CONFIG_KEY, null);
    setOverrides(raw);
    return true;
  } catch (_) { return false; }
}

/** Un nivel con overrides y umbral en pesos. */
function _withArs(level) {
  const o = (_cfg && _cfg.levels && _cfg.levels[level.idx]) || {};
  return {
    ...level,
    name: o.name || level.name,
    emoji: o.emoji || level.emoji,
    color: o.color || level.color,
    thresholdArs: o.thresholdArs > 0 ? o.thresholdArs : level.usd * _rate(),
    levelUpBonusArs: o.levelUpBonusArs != null ? o.levelUpBonusArs : level.levelUpBonusArs,
    rakebackPct: o.rakebackPct != null ? o.rakebackPct : level.rakebackPct,
    custom: Object.keys(o).length > 0
  };
}

/** La escalera completa con umbrales en ARS (para la UI y el motor). */
function listLevels() { return VIP_LEVELS.map(_withArs); }

/** La escalera DEFAULT (1win) con la tasa vigente, para "restaurar" en el panel. */
function listDefaults() {
  const saved = _cfg; _cfg = saved && saved.usdArsRate ? { usdArsRate: saved.usdArsRate, levels: {} } : null;
  try { return VIP_LEVELS.map(_withArs); } finally { _cfg = saved; }
}

function currentRate() { return _rate(); }

/** Nivel por idx (1-based). null si no existe (idx 0 = sin nivel). */
function getLevel(idx) {
  const i = Number(idx) || 0;
  if (i < 1 || i > VIP_LEVELS.length) return null;
  return _withArs(VIP_LEVELS[i - 1]);
}

/**
 * Nivel que corresponde a un apostado acumulado.
 * @returns {{levelIndex, level|null, next|null, faltaParaSubir|null, progressPct}}
 */
function getVipLevel(lifetimeWagered) {
  const wagered = Math.max(0, Number(lifetimeWagered) || 0);
  const levels = listLevels();
  let levelIndex = 0;
  for (const l of levels) {
    if (wagered >= l.thresholdArs) levelIndex = l.idx;
    else break;
  }
  const level = levelIndex > 0 ? levels[levelIndex - 1] : null;
  const next = levelIndex < levels.length ? levels[levelIndex] : null;
  let progressPct = 100;
  let faltaParaSubir = null;
  if (next) {
    const base = level ? level.thresholdArs : 0;
    const span = next.thresholdArs - base;
    progressPct = span > 0 ? Math.min(100, Math.max(0, ((wagered - base) / span) * 100)) : 0;
    faltaParaSubir = Math.max(0, next.thresholdArs - wagered);
  }
  return { levelIndex, level, next, faltaParaSubir, progressPct };
}

/** % de rakeback semanal para un nivel (0 si todavía no tiene nivel). */
function getRakebackPct(levelIndex) {
  const l = getLevel(levelIndex);
  return l ? l.rakebackPct : 0;
}

module.exports = {
  VIP_LEVELS,
  CONFIG_KEY,
  DEFAULT_USD_ARS_RATE,
  listLevels,
  listDefaults,
  getLevel,
  getVipLevel,
  getRakebackPct,
  normalizeConfig,
  setOverrides,
  refreshFromConfig,
  currentRate
};
