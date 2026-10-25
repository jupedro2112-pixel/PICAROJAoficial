// #989: prueba de humo de la plataforma "Pica Roja APP" (public/js/lobby.js) y de las piezas de home.js / sorteos.js que la acompañan,
// con un DOM mínimo simulado (no hay node_modules ni navegador). Falla ante undefined/NaN, tags desbalanceados o piezas que falten.
// Correr: node scripts/test-picaroja-front.js
'use strict';
const fs = require('fs'); const vm = require('vm');
const home = fs.readFileSync('public/js/home.js', 'utf8');
const grab = (name) => { let i = home.indexOf('    function ' + name + '('); if (i < 0) i = home.indexOf('    async function ' + name + '('); if (i < 0) throw new Error('no está ' + name); let j = i, depth = 0, started = false; for (; j < home.length; j++) { const c = home[j]; if (c === '{') { depth++; started = true; } else if (c === '}') { depth--; if (started && depth === 0) { j++; break; } } } return home.slice(i, j) + '\n'; };
const line = (prefix) => { const i = home.indexOf(prefix); if (i < 0) throw new Error('no está ' + prefix.trim()); return home.slice(i, home.indexOf('\n', i)) + '\n'; };
const must = (h, ...needles) => needles.forEach((n) => { if (!String(h).includes(n)) throw new Error('falta "' + n + '"'); });
const clean = (h) => { const bad = String(h).match(/undefined|NaN|\[object/); if (bad) throw new Error('HTML con ' + bad[0] + ': ' + String(h).slice(Math.max(0, String(h).indexOf(bad[0]) - 80), String(h).indexOf(bad[0]) + 40)); };
const balanced = (h) => { const o = (String(h).match(/<(div|button|span|b|small|i|em|section|main|nav|aside|label|p|header)\b/g) || []).length, c = (String(h).match(/<\/(div|button|span|b|small|i|em|section|main|nav|aside|label|p|header)>/g) || []).length; if (o !== c) throw new Error('tags: ' + o + ' abren / ' + c + ' cierran'); };

// ---- DOM mínimo: elementos por id; innerHTML se guarda como texto; insertAdjacentHTML registra los ids que aparecen.
const els = {};
function El(id) { this.id = id; this._html = ''; this.textContent = ''; this.hidden = false; this.style = {}; this.attrs = {}; this.children = []; this.parentNode = null; this.dataset = {}; this.isConnected = true; this.scrollTop = 0; this.clientHeight = 600; this.scrollHeight = 2000;
  const set = new Set(); this.classList = { add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)), toggle: (c, f) => { if (f === undefined) f = !set.has(c); f ? set.add(c) : set.delete(c); return f; }, contains: (c) => set.has(c) }; }
Object.defineProperty(El.prototype, 'innerHTML', { get() { return this._html; }, set(v) { this._html = String(v); clean(this._html); register(this._html); } });
Object.defineProperty(El.prototype, 'outerHTML', { get() { return '<div id="' + this.id + '">' + this._html + '</div>'; }, set(v) { this._html = String(v); clean(v); register(v); } });
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); }; El.prototype.getAttribute = function (k) { return this.attrs[k] == null ? null : this.attrs[k]; };
El.prototype.insertAdjacentHTML = function (w, h) { clean(h); register(h); this._html += h; };
El.prototype.appendChild = function (c) { if (c.parentNode && c.parentNode !== this) c.parentNode.children = c.parentNode.children.filter((x) => x !== c); c.parentNode = this; this.children.push(c); return c; };
El.prototype.contains = function (c) { return this.children.includes(c); };
El.prototype.querySelector = function () { return null; }; El.prototype.querySelectorAll = function () { return []; };
El.prototype.addEventListener = function () {}; El.prototype.remove = function () { this.removed = true; }; El.prototype.scrollTo = function () {}; El.prototype.closest = function () { return null; };
const mk = (id) => (els[id] = els[id] || new El(id));
function register(h) { for (const m of String(h).matchAll(/ id="([^"]+)"/g)) { const e = mk(m[1]); if (/<[^>]+ id="/.test(h)) { const tag = new RegExp('<([a-z]+)[^>]* id="' + m[1] + '"[^>]*?( hidden)?[^>]*>').exec(h); if (tag && tag[2]) e.hidden = true; } } }
const body = mk('body'); const bottomNav = mk('bottomNav'); mk('navMenu').innerHTML = '<span>Menú</span>'; mk('navPerfil').innerHTML = '<span>Perfil</span>'; mk('navInicio').setAttribute('onclick', 'VIP.home.goHome()');
const fetchLog = [];
const LOBBY = { total: 8137, popular: [{ key: '2/vs20olympx', name: 'Gates of Olympus', img: 'https://admin.1girox.com/game-img/a.webp', gid: 11, lk: 'pragmatic', isNew: false }, { key: '7/10521_ifg', name: 'Evolution Top', img: '', gid: 12, lk: 'evo' }],
  nuevos: [{ key: '2/vs20new', name: 'Nuevo Slot', img: 'https://admin.1girox.com/game-img/n.webp', gid: 13, lk: 'pragmatic', isNew: true }],
  providers: [{ id: 3, name: 'KA Gaming', count: 1001, logo: 'https://1girox.com/img/providers/ka.webp', live: false }, { id: 2, name: 'Pragmatic Play', count: 609, logo: '', live: false }],
  sections: [{ title: 'KA Gaming', providerId: 3, games: [{ key: '3/x1', name: 'KA Uno', img: '', gid: 1, lk: 'ka' }] }], live: [{ title: 'Evolution', providerId: 9, games: [{ key: '7/1', name: 'Ruleta', img: '', gid: 2, lk: 'evo' }] }],
  lobbies: [{ key: '3/101', name: 'Live Casino Lobby', img: 'https://admin.1girox.com/game-img/l.webp', gid: 3, lk: 'pp' }],
  sports: [{ key: 'sport/onyx', path: '/sports-new', title: 'Digitain', sub: 'Fútbol y más' }, { key: 'sport/gr8', path: '/sports', title: 'Ultim8', sub: 'Apuestas' }] };
const BOARD = { live: [{ id: '1', league: 'LaLiga', live: true, clock: "67'", home: 'Barcelona', away: 'Real Madrid', homeLogo: 'https://a.espncdn.com/b.png', awayLogo: 'https://a.espncdn.com/r.png', hs: '1', as: '0', odds: { home: 1.63, draw: 5.4, away: 4.0 } }],
  top: [{ id: '2', league: 'Serie A', live: false, hour: '16:00', today: true, home: 'Inter', away: 'Fiorentina', homeLogo: '', awayLogo: '', odds: { home: 1.34, draw: 5.8, away: 7.6 } }, { id: '3', league: 'Premier', live: false, hour: '12:00', today: false, home: 'Liverpool', away: 'Brighton', odds: null }] };
const SORT = { enabled: true, now: new Date().toISOString(), requirements: { app: true, notif: true, telegram: true, phone: true, deposit: true }, telegramUrl: 'https://t.me/x', sorteos: [
  { key: 'mensual', title: 'Sorteo mensual', emoji: '🏆', status: 'live', periodKey: '2026-11', start: '2026-11-01T03:00:00Z', end: '2026-12-01T02:59:59Z', publishAt: '2026-12-01T15:00:00Z', startsInMs: 0, endsInMs: 86400000 * 5, prizes: [{ pos: 1, img: '📱', name: 'iPhone 18 Pro Max', value: '', mode: 'tickets' }, { pos: 2, img: '🛍️', name: 'Orden de compra', value: '$1.000.000' }, { pos: 3, img: '🎰', name: '$500.000 para jugar', value: '' }], extra: { enabled: true, per: 100, winners: 10, amount: 10000, minDeposits: 2 }, rules: { pts: 100, ptsPer: 100000, dayCapArs: 300000, dayDepositMin: 2000, dayDepositPts: 10, weekActiveDays: 3, weekPts: 50, missionWeekPct: 0, tickets: { per: 50, dayCap: 6, activeDay: 1 }, milestones: { tenDeposits: 3 }, text: { pts: 'x', tickets: 'y' } }, tickets: { total: 420, mine: 9, list: [{ n: 12, reason: 'dia' }, { n: 88, reason: 'juego' }, { n: 301, reason: 'hito' }], chance: 9 / 420 }, draws: { main: null, mid: [] }, near: [{ rank: 5, name: 'pe••••01', points: 400, me: false, joined: true }, { rank: 6, name: 'ma••••77', points: 380, me: false, joined: true }, { rank: 7, name: 'lalodj', points: 350, me: true, joined: false }], counts: { anotados: 12, participantes: 40, extraWinners: 0 }, me: { joined: false, joinedAt: null, checks: { app: true, notif: false, telegram: false, phone: false, deposit: true }, missing: ['notif', 'telegram', 'phone'], canJoin: false, points: 350, rank: 7, wagered: 350000, eligible: false, gapTo3: 1200, weekPts: 50, breakdown: { basePts: 270, dayPts: 30, missionPts: 0 } }, top: [{ rank: 1, name: 'ju••••22', points: 9000, me: false, joined: true }, { rank: 7, name: 'lalodj', points: 350, me: true, joined: false }], winners: null, draw: null, terms: [{ t: 'Cómo funciona', d: 'texto' }] },
  { key: 'gran', title: 'Gran Sorteo', emoji: '🚗', status: 'soon', periodKey: '2026-11-01_2027-01-31', start: '2026-11-01T03:00:00Z', end: '2027-02-01T02:59:59Z', publishAt: '2027-02-01T15:00:00Z', startsInMs: 86400000 * 7 + 3600000 * 22, endsInMs: 0, prizes: [{ pos: 1, img: '/images/sorteos/peugeot-208.jpg', name: 'Peugeot 208 0 km', value: 'Valorado en $30.000.000' }, { pos: 2, img: '🏝️', name: 'Viaje al Caribe para 2', value: 'Todo incluido · 5 días' }, { pos: 3, img: '💵', name: 'USD 2.000', value: 'En efectivo' }], extra: { enabled: true, title: 'SORTEO EXTRA $1.000.000', per: 0, winners: 10, amount: 100000, minDeposits: 10 }, rules: { pts: 100, ptsPer: 100000, dayCapArs: 300000, dayDepositMin: 2000, dayDepositPts: 10, weekActiveDays: 3, weekPts: 50, missionWeekPct: 10, tickets: { per: 50, dayCap: 6, activeDay: 1 }, milestones: { firstDeposit: 1, fourWeeks: 5, tenDeposits: 5 }, text: { pts: 'x', tickets: 'y' } }, tickets: { total: 0, mine: 0, list: [], chance: 0 }, draws: { main: null, mid: [{ date: '2026-12-15', amount: 200000, status: 'soon', draw: null }, { date: '2026-12-31', amount: 200000, status: 'soon', draw: { kind: 'mid', total: 1500, seedHash: 'abcdef0123456789abcdef', revealedAt: '2026-12-31T23:00:00Z', seed: 'semilla', winner: { n: 77, name: 'ro••••11', me: false }, skipped: 1, amount: 200000 } }] }, near: [], counts: { anotados: 3, participantes: 0, extraWinners: 0 }, me: { joined: true, joinedAt: '2026-10-24T10:00:00Z', checks: { app: true, notif: true, telegram: true, deposit: true }, missing: [], canJoin: false, points: 0, rank: null, wagered: 0, eligible: false, breakdown: null }, top: [], winners: null, draw: null, terms: [{ t: 'Fechas', d: 'texto' }] }
] }; // (la misma muestra que scripts/test-sorteos-front.js)
let sess = {};
const ctx = { console, Date, Math, Number, String, JSON, Object, Array, RegExp, Promise, Error, Set, Map, encodeURIComponent, decodeURIComponent, setTimeout: (f) => { try { f(); } catch (e) { throw e; } return 1; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  location: { search: '', pathname: '/', origin: 'https://picaroja.com', hostname: 'picaroja.com' }, history: { replaceState() {} },
  localStorage: { _: {}, getItem(k) { return this._[k] == null ? null : this._[k]; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } },
  sessionStorage: { getItem: (k) => (sess[k] == null ? null : sess[k]), setItem: (k, v) => { sess[k] = String(v); }, removeItem: (k) => { delete sess[k]; } },
  document: { body, getElementById: (id) => els[id] || null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
  fetch: async (url, opts) => { fetchLog.push(url); const j = url.includes('/api/games/lobby') ? LOBBY : url.includes('/api/sports/board') ? BOARD : url.includes('picaroja-extra') ? { games: [['2/vs20new', 'Nuevo Slot', 'https://admin.1girox.com/game-img/n.webp', 13, 'pragmatic']] }
      : url.includes('girox-live') ? { providers: [{ name: 'Evolution', games: [['7/1', 'Ruleta', '', 2, 'evo']] }, { name: 'Ezugi', games: [['7/2', 'Ezugi Lobby', '', 4, 'ez']] }] } : url.includes('/api/games/catalog') ? { games: LOBBY.popular, hasMore: false }
      : url.includes('/api/sorteos') ? SORT : url.includes('/api/platforms') ? { platforms: [{ id: 'girox', name: '1girox', connected: true, logoUrl: '/images/soporte-1girox.png' }, { id: 'ganamos', name: 'Ganamos', connected: false }, { id: 'jugaygana', name: 'JUGAYGANA', connected: false }], defaultPlatform: 'girox', preferredPlatform: null, minDepositArs: 2000 }
      : url.includes('/api/me/brand') ? { brand: 'picaroja' } : {}; return { ok: true, status: 200, json: async () => j }; } };
ctx.window = ctx; ctx.self = ctx; ctx.gamePlayed = []; const gamePlayed = ctx.gamePlayed;
ctx.VIP = { state: { currentToken: 'tok', currentUser: { username: 'alex' } }, config: { API_URL: 'https://picaroja.com' }, ui: { showToast() {} }, stories: { paint() { ctx.storiesPainted = true; } }, withdraw: { openWithdrawModal() {} }, autoload: { getCbu: () => ({ alias: 'pica.roja', number: '000', titular: 'PICA' }) } };
vm.createContext(ctx);
// piezas de home.js que usa la página (y las que cambian con #989)
const homeBits = 'const _el = (id) => document.getElementById(id); const _esc = (s) => String(s == null ? "" : s).replace(/[&<>"\']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\'": "&#39;" }[c]));\n' +
  'let _platforms = null, _platformsAt = 0, _quickOpen = false, _quickDismissed = false, _chOpen = false, _cqCbuTries = 0; const MENU_ORDER = ["full", "basic", "easy", "girox"]; let _menusOn = { basic: true, easy: true, full: true, girox: true }; const HAS_DEP_KEY = "vip_has_dep";\n' +
  'function _fdNoteHtml() { return ""; } function _sbTagHtml() { return ""; } function _fdNotesPaint() {} function _igQuickBtnHtml() { return ""; } function _paintPlatNav() {} function _menuOn(p) { return _menusOn[p] !== false; } function _firstMenuOn() { return MENU_ORDER.find(_menuOn) || "basic"; } function _hasDeposit() { return false; }\n' +
  ['    const PR_OFF_KEY', '    const DOORS', '    const BRANDS', '    const _isDoor', '    let _brand = null', '    const _BRAND_NAMES'].map(line).join('') +
  ['casinoBarHtml', 'toggleCasinoLoad', '_localBrand', '_setLocalBrand', '_syncBrand', '_brandGuard', '_brandName', '_paintBrandLabels', '_injectPR', 'loadPlatforms', '_defaultPref'].map(grab).join('') +
  'VIP.home = Object.assign(VIP.home || {}, { casinoBarHtml, toggleCasinoLoad, loadPlatforms, casinoFullMenu() {}, casinoInfo() {}, openProfile() {}, openPlatform(id) { ctx.opened = id; }, setHomeMode() {}, goHome() {}, casinoWithdraw() {}, casinoSupport() {}, gamePlay(k, n) { gamePlayed.push(k + "|" + n); }, _test: { injectPR: () => _injectPR(), platforms: () => _platforms, localBrand: _localBrand, defaultPref: _defaultPref } });';
vm.runInContext(homeBits, ctx);
vm.runInContext(fs.readFileSync('public/js/sorteos.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('public/js/lobby.js', 'utf8'), ctx);
(async () => {
  const L = ctx.VIP.lobby, H = ctx.VIP.home, S = ctx.VIP.sorteos;
  // 1) plataformas: Pica Roja APP primera y predeterminada; 1girox; sin "Pronto" (Ganamos/JUGAYGANA sin API)
  await H.loadPlatforms(true); const P = H._test.platforms();
  if (P.platforms.map((p) => p.id).join(',') !== 'picaroja,girox') throw new Error('lista de plataformas: ' + P.platforms.map((p) => p.id).join(','));
  if (P.platforms[0].name !== 'Pica Roja APP' || P.platforms[1].name !== '1girox') throw new Error('nombres: ' + P.platforms.map((p) => p.name).join(' / '));
  if (P.preferredPlatform !== 'picaroja' || P.defaultPlatform !== 'picaroja') throw new Error('predeterminada: ' + P.preferredPlatform + '/' + P.defaultPlatform);
  if (H._test.localBrand() !== 'picaroja') throw new Error('marca local: ' + H._test.localBrand());
  if (H._test.defaultPref() !== 'girox') throw new Error('menú predeterminado (directo a la plataforma): ' + H._test.defaultPref());
  console.log('✔ plataformas: Pica Roja APP (predeterminada) · 1girox · menú directo');
  // 2) la página: barra con píldora del sorteo + cartel, hueco de la Carga rápida, saldo, main, nav propia
  L.open('inicio');
  const shell = body.innerHTML; clean(shell); balanced(shell);
  must(shell, 'id="prLobby"', 'casino-topbar prl-cbar', 'class="casino-brand casino-srt"', 'class="casino-srt-bar"', 'VIP.sorteos.casinoBar(true)', 'id="prlQlDock"', 'id="prlQlChip"', 'id="prlPrBal"', 'id="prlMain"', 'class="prl-nav"', 'PICA ROJA', 'VIP.lobby.close()');
  if (shell.includes('prl-hero2') || shell.includes('jugaygana') || shell.includes('ganamos') || shell.includes('buffalo')) throw new Error('quedó algo de otras marcas o de las fotos');
  if (!body.classList.contains('prl-open') || !body.classList.contains('casino-open')) throw new Error('clases del body');
  if (!body.classList.contains('prl-appnav') || !mk('navMenu').innerHTML.includes('Slots') || !mk('navPerfil').innerHTML.includes('Deportes')) throw new Error('la barra de la app no cambió a Slots · Inicio · Deportes');
  if (!ctx.storiesPainted) throw new Error('no repintó el aro de historias');
  console.log('✔ página: barra + sorteo en la barra + hueco de Carga rápida + nav de la app (' + shell.length + ' chars)');
  // 3) inicio: Top partidos (sin fotos), proveedores rojo/blanco, Casino lobby, buscador, Populares, Nuevos, En vivo, secciones, Ver los N juegos
  const tick = () => new Promise((r) => setImmediate(r)); for (let i = 0; i < 6; i++) await tick(); // llegan /api/games/lobby, /api/sports/board y los json
  const main = mk('prlMain').innerHTML; balanced(main);
  must(main, 'Top partidos', 'Barcelona', 'Real Madrid', '1.63', '5.40', "VIP.lobby.sport('/sports-new')", 'prl-mlive', 'Inter', 'Hoy 16:00', 'Mañana 12:00', 'Apostar ›', 'Cuotas de referencia',
    'Proveedores', 'prl-pvb', 'KA Gaming', '1.001 juegos', 'Casino lobby', '/images/picaroja/lobby/3_101.webp', 'id="prlQ"', 'Populares', 'Gates of Olympus', 'Nuevos', 'NUEVO', 'En vivo · Evolution', 'Ver los 8.137 juegos', 'VIP.lobby.extraAll()');
  if (main.includes('prl-hero2') || main.includes('prl-hc')) throw new Error('siguen las fotos de arriba');
  if (main.indexOf('Top partidos') > main.indexOf('Proveedores')) throw new Error('Top partidos tiene que ir arriba de Proveedores');
  console.log('✔ inicio: Top partidos arriba · Proveedores · lobby · populares · nuevos (' + main.length + ' chars)');
  // 4) cuotas / partido ⇒ Digitain directo (sport/onyx) logueado; deportes desde el menú
  L.sport('/sports-new'); L.sport('/sports'); if (gamePlayed.join(' ') !== 'sport/onyx|Digitain sport/gr8|Ultim8') throw new Error('deportes: ' + gamePlayed.join(' '));
  console.log('✔ deportes: Digitain / Ultim8 con link directo');
  // 5) En vivo, Slots, lista de nuevos, volver
  L.go('vivo'); must(mk('prlMain').innerHTML, 'Casino en vivo', 'Evolution', 'Ezugi', 'VIP.lobby.liveProv(0)');
  L.go('slots'); must(mk('prlMain').innerHTML, 'Slots · todos los juegos', 'id="prlAll"'); await new Promise((r) => setImmediate(r)); must(mk('prlAll').innerHTML, 'Gates of Olympus');
  L.extraAll(); await new Promise((r) => setImmediate(r)); must(mk('prlMain').innerHTML, 'Juegos nuevos', 'Nuevo Slot');
  L.back(); must(mk('prlMain').innerHTML, 'Top partidos');
  L.play('2/vs20olympx', { dataset: { name: 'Gates of Olympus', gid: '11', lk: 'pragmatic' } }); if (!gamePlayed.pop().startsWith('2/vs20olympx|Gates')) throw new Error('play');
  console.log('✔ vistas: En vivo · Slots (carga al bajar) · Juegos nuevos · Volver · abrir juego');
  // 6) Carga rápida: abierta al entrar en el hueco de arriba (el botón centrado se esconde); ✕ ⇒ se cierra, vuelve el botón y no se reabre sola
  H.toggleCasinoLoad(true); // (lo mismo que hace open() a los 600 ms; acá sin try/catch para ver el error)
  const dock = mk('prlQlDock'), chip = mk('prlQlChip'), panel = mk('casinoLoadPanel');
  if (panel.parentNode !== dock && !dock.innerHTML.includes('id="casinoLoadPanel"')) throw new Error('el panel no está en el hueco de arriba');
  if (panel.style.display === 'none' || chip.hidden !== true) throw new Error('la Carga rápida tenía que estar abierta al entrar (chip oculto)');
  must(panel.innerHTML, 'Carga rápida', 'pica.roja', 'VIP.home.casinoQuickClose()');
  H.toggleCasinoLoad(false); if (panel.style.display !== 'none' || chip.hidden !== false || sess.vip_prl_ql_closed !== '1') throw new Error('al cerrar: panel ' + panel.style.display + ' chip ' + chip.hidden + ' sess ' + sess.vip_prl_ql_closed);
  L.close(); L.open('inicio'); if (panel.style.display !== 'none') throw new Error('se volvió a abrir sola después de cerrarla');
  H.toggleCasinoLoad(); if (panel.style.display === 'none' || chip.hidden !== true) throw new Error('el botón de arriba no la volvió a abrir');
  console.log('✔ Carga rápida: abierta al entrar · ✕ ⇒ botón centrado arriba · no se reabre sola · el botón la abre');
  // 7) sorteo en la barra: cerrado = píldora (marca oculta); abierto = cartel debajo con ✕; el MISMO estado en la barra de Girox y en la de la página
  const tb = (brandId) => { const t = new El('tb-' + brandId); const brand = new El(brandId + '-brand'), btn = new El(brandId + '-btn'), bar = new El(brandId + '-bar'); btn.querySelector = () => null;
    t.querySelector = (sel) => sel.includes(':not') ? brand : sel.includes('casino-srt-bar') ? bar : btn; return { t, brand, btn, bar }; };
  const g = tb('girox'), p = tb('pr'); ctx.document.querySelectorAll = (sel) => sel === '.casino-topbar' ? [g.t, p.t] : [];
  await S.load(); S.paintCasino();
  [g, p].forEach((x) => { if (x.brand.hidden !== true || x.btn.hidden !== false || x.bar.hidden !== true) throw new Error('cerrado: marca oculta + píldora visible + sin cartel (' + x.t.id + ')'); });
  S.casinoBar(true);
  [g, p].forEach((x) => { if (x.brand.hidden !== false || x.btn.hidden !== true || x.bar.hidden !== false) throw new Error('abierto: marca visible + cartel debajo (' + x.t.id + ')'); must(x.bar.innerHTML, 'Sorteo mensual', 'Anotate, es gratis', 'VIP.sorteos.casinoBar(false)'); });
  S.casinoBar(false); if (p.btn.hidden !== false || p.bar.hidden !== true) throw new Error('✕ del cartel: vuelve la píldora');
  console.log('✔ sorteo: píldora en el medio de la barra ⇄ cartel debajo con ✕ (Girox y Pica Roja APP a la vez)');
  console.log('✔ TODO OK · pedidos a: ' + [...new Set(fetchLog.map((u) => u.replace(/^https:\/\/picaroja\.com/, '').replace(/\?.*$/, '')))].join(' '));
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
