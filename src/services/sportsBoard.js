/**
 * sportsBoard — PARTIDOS para la sección "Eventos deportivos" de JUGAYGANA (#940, owner 2026-10-23).
 *
 * "Como jugaygana44": arriba "Top en vivo" y "Los más jugados". jugaygana44 usa un iframe de otra casa de apuestas (billetera de otra
 * plataforma), así que acá se arma con datos propios: scoreboard PÚBLICO de ESPN (las mismas ligas y equipos que las historias, #827) y al
 * tocar un partido se abre la casa de deportes de Girox (Digitain) logueada. Las cuotas son de REFERENCIA (las de Girox pueden variar).
 *  - live: partidos EN JUEGO de esas ligas (resultado y minuto), los más importantes primero.
 *  - top: los próximos (hasta 36 h) más importantes.
 * Cache 60 s (12 ligas ⇒ 12 pedidos por minuto como máximo, compartidos por todos los clientes).
 */
'use strict';
const sa = require('./storyAutopilot');

let _cache = null; // { at, data }
let _inflight = null;

async function _json(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
  try { const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
  catch (_) { return null; } finally { clearTimeout(t); }
}
const _artHM = (d) => new Date(new Date(d).getTime() - 3 * 3600000).toISOString().slice(11, 16);
const _artDay = (d) => new Date(new Date(d).getTime() - 3 * 3600000).toISOString().slice(0, 10);

async function _build() {
  const now = Date.now();
  const res = await Promise.all(sa.LEAGUES.map(([lg]) => _json(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard`)));
  const live = [], next = []; const seen = new Set();
  sa.LEAGUES.forEach(([lg, lgName], k) => {
    for (const e of ((res[k] && res[k].events) || [])) {
      if (!e || seen.has(e.id)) continue;
      const st = e.status && e.status.type ? e.status.type : {}; const state = st.state;
      if (state === 'post') continue;
      const c = (e.competitions || [])[0] || {};
      const home = (c.competitors || []).find((x) => x.homeAway === 'home'), away = (c.competitors || []).find((x) => x.homeAway === 'away');
      if (!home || !away || !home.team || !away.team) continue;
      const w = (sa.TEAM_W[home.team.displayName] || 0) + (sa.TEAM_W[away.team.displayName] || 0) + (/^(arg\.|fifa\.worldq\.conmebol)/.test(lg) ? 3 : 0);
      const t = new Date(e.date).getTime();
      if (state === 'pre' && (t < now - 3600000 || t > now + 36 * 3600000)) continue;
      seen.add(e.id);
      const m = {
        id: String(e.id), league: lgName, w, live: state === 'in', date: e.date, hour: _artHM(e.date), today: _artDay(e.date) === _artDay(now),
        clock: state === 'in' ? String(st.shortDetail || (e.status && e.status.displayClock) || '').slice(0, 12) : '',
        home: sa.short(home.team.displayName), away: sa.short(away.team.displayName),
        homeLogo: home.team.logo || '', awayLogo: away.team.logo || '',
        hs: state === 'in' ? String(home.score == null ? '0' : home.score) : '', as: state === 'in' ? String(away.score == null ? '0' : away.score) : '',
        odds: sa.decOdds(c.odds)
      };
      (m.live ? live : next).push(m);
    }
  });
  live.sort((a, b) => b.w - a.w || new Date(a.date) - new Date(b.date));
  next.sort((a, b) => b.w - a.w || new Date(a.date) - new Date(b.date));
  const strip = (m) => { const o = Object.assign({}, m); delete o.w; return o; };
  return { live: live.slice(0, 10).map(strip), top: next.slice(0, 10).map(strip), at: new Date().toISOString() };
}

async function board() {
  if (_cache && Date.now() - _cache.at < 60000) return _cache.data;
  if (_inflight) return _inflight;
  _inflight = _build().then((data) => { _cache = { at: Date.now(), data }; return data; }).catch(() => (_cache ? _cache.data : { live: [], top: [] })).finally(() => { _inflight = null; });
  return _inflight;
}

module.exports = { board };
