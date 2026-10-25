// ========================================
// #989 (owner 2026-10-25): PLATAFORMA "Pica Roja APP" — la página propia de PICA ROJA con TODOS los juegos de Girox (misma cuenta y mismo
// saldo: es otra PUERTA a 1girox, no otra plataforma del server). Viene de la gemela FABRIOCTUBRE (sus #907–#988, sólo la parte de PICA ROJA;
// JUGAYGANA, Ganamos y BuffaloPlay no se trajeron). Arriba la MISMA barra que el casino de Girox (Volver · Menú · PICA ROJA · Historias · Info ·
// Perfil) con el sorteo como en Girox (píldora en el medio de la barra; al tocarla baja como cartel debajo; ✕ vuelve a la píldora), la tira del
// saldo con CARGÁ AQUÍ (sin burbuja flotante: nada tapa los juegos), 2 tarjetas fijas (Slots · Casino en vivo), Proveedores (rojo PICA ROJA,
// logo y nombre en blanco), Casino lobby, buscador, Populares, Nuevos, En vivo y los proveedores principales; Slots (todo el catálogo, carga al
// bajar), En vivo (girox-live.json) y Deportes (las casas de 1girox con link directo). Cada juego = VIP.home.gamePlay (directo al proveedor,
// logueado). Barra de abajo: la de la app (#bottomNav) con Slots · Inicio · Deportes (#prNav); sin ella, la propia.
// Se abre desde la plataforma "Pica Roja APP" (predeterminada) o con picaroja.com/paginaoficial (⇒ /?pr=1).
// ========================================
window.VIP = window.VIP || {};
VIP.lobby = (function () {
    let _data = null, _view = 'inicio', _q = '', _qTimer = null, _allPage = 0, _allMore = true, _allProv = null, _loadingAll = false, _balTimer = null;
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // #923 seguridad: texto que va DENTRO de un onclick='…' (nombres de proveedores que vienen de 1girox): se sacan comillas, barras y < > & ANTES
    // de escapar (si no, &#39; vuelve a ser comilla al ejecutarse y un nombre armado podría inyectar código).
    const jsq = (x) => esc(String(x == null ? '' : x).replace(/[\\'"`<>&\r\n]/g, ''));
    const img = (u) => (u ? (/^\/images\//.test(u) ? u : '/api/games/img?u=' + encodeURIComponent(u)) : '');
    const auth = () => ({ Authorization: 'Bearer ' + ((VIP.state && VIP.state.currentToken) || '') });

    // #909: íconos de línea (estilo Stake), sin color.
    const IC = {
        home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
        slots: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14M15 5v14"/>',
        live: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
        sport: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 5h-5L8 10z"/>',
        chat: '<path d="M4 5h16v11H9l-5 4z"/>',
        fire: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 2 3-3z"/>',
        star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
        tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
        menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
        up: '<path d="M6 5h12M12 20V9M7 13l5-5 5 5"/>',
        wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7z"/><path d="M4 7l11-3v3"/><path d="M15 13.5h2.5"/>'
    };
    const ico = (k) => '<svg class="prl-ic" viewBox="0 0 24 24" aria-hidden="true">' + (IC[k] || '') + '</svg>';
    const SK = { name: 'PICA ROJA', home: '/images/picaroja/logo-mono.svg', bar: '/icons/icon-192x192.png' };
    function _shell() {
        const old = $('prLobby'); if (old) return old;
        const nb = (v, k, t) => '<button type="button" data-v="' + v + '" onclick="VIP.lobby.go(\'' + v + '\')">' + ico(k) + '<span>' + t + '</span></button>';
        // #914 (owner): arriba la MISMA barra que al entrar a Girox (Volver · Menú · marca · Historias · Info · Perfil).
        // #989 (owner): el sorteo IGUAL que en el casino de Girox: cerrado = píldora en el medio de la barra (donde está PICA ROJA); abierto = cartel
        // debajo de la barra con ✕. sorteos.js (paintCasino) pinta todas las barras `.casino-topbar` por igual; el estado es el mismo que en Girox.
        const pill = '<button type="button" class="casino-brand casino-srt" hidden onclick="VIP.sorteos.casinoBar(true)" aria-label="Sorteo"><span class="cb-box"><span class="cb-ico" data-srt-brand-ico>🏆</span><span class="cb-txt"><b data-srt-brand-title>Sorteo mensual</b><small data-srt-brand-sub>NOVEDAD</small></span></span></button>';
        // #989 (owner, captura final: "así quiero que inicie; el Volver es ir al menú completo; lo demás igual que antes"): la barra completa con Menú;
        // "‹ Volver" cierra la página y deja la app en el menú COMPLETO (backHome).
        // #989 (owner: "bajá Slots, Menú a la izquierda, después Casino en vivo y Deportes del otro lado"): arriba sin Menú ni Slots (van abajo).
        let bar = (VIP.home && VIP.home.casinoBarHtml) ? VIP.home.casinoBarHtml({ back: 'VIP.lobby.backHome()', noMenu: true, logo: SK.bar, name: SK.name, idSuffix: 1 }) : '<div class="casino-topbar-row"><button type="button" class="casino-back" onclick="VIP.lobby.close()">‹ Volver</button><span class="casino-brand"><span class="cb-box"><b>PICA ROJA</b></span></span></div>';
        void pill; // #989 (owner): el sorteo ya no va en la barra: son DOS recuadros debajo del usuario, al tope del Inicio (más lugar, se ve el premio)
        document.body.insertAdjacentHTML('beforeend',
            '<div id="prLobby" class="prl" data-skin="picaroja" hidden role="dialog" aria-label="' + SK.name + '">' +
            '<div class="casino-topbar prl-cbar">' + bar + '</div>' +
            // #920: la misma tira de saldo del Inicio de la app · #989: con CARGÁ AQUÍ al lado (como #988 en Girox: sin 1ª carga, el cartel rojo grande en
            // el lugar del saldo). Los dos abren la Carga rápida (el mismo panel que adentro del casino). Sin burbuja flotante: no tapa los juegos.
            // #989 (owner): "a la Carga rápida ponele una ✕; si la cierran que vaya y quede arriba, debajo del perfil, centrada". El panel (el mismo
            // de adentro del casino, toggleCasinoLoad) vive en este hueco: abierto se ve entero; cerrado queda el botón centrado que lo vuelve a abrir.
            '<div class="prl-pr-bal" id="prlPrBal"></div>' + // #989: el usuario/saldo debajo del menú superior
            // #989 (owner): "un CÍRCULO de Carga rápida cuando la gente entra a jugar; abierto, que se vea y se diferencie de la página (si no se pierde todo del
            // mismo color)": cerrado = círculo verde con el logo + "CARGA RÁPIDA" debajo, centrado; abierto = el panel verde (picaroja.css .prl-qldock .casino-load).
            // #989 (owner): "que sea movible y esté abajo a la derecha": el círculo flota abajo a la derecha (se arrastra, _dragQl) y el panel abre ahí mismo.
            '<button type="button" class="prl-qlchip" id="prlQlChip" onclick="VIP.lobby.ql()" aria-label="Carga rápida" title="Carga rápida · arrastrame si te tapa algo"><span class="prl-qlc"><img src="' + SK.bar + '" alt=""><i>⚡</i></span><small>CARGA RÁPIDA</small></button>' +
            '<main class="prl-main" id="prlMain"></main>' +
            '<button type="button" class="prl-top-btn" id="prlUp" hidden onclick="VIP.lobby.top()" aria-label="Volver arriba">' + ico('up') + '</button>' +
            // barra propia (sin #bottomNav): Menú · Slots · Inicio · En vivo · Deportes (#989, igual que la barra de la app con la página abierta)
            '<nav class="prl-nav" aria-label="Menú"><button type="button" data-v="menu" onclick="VIP.home.casinoFullMenu()">' + ico('menu') + '<span>Menú</span></button>' + nb('slots', 'slots', 'Slots') +
              '<button type="button" data-v="inicio" class="prl-home" onclick="VIP.lobby.go(\'inicio\')"><img src="' + SK.home + '" alt=""><span>Inicio</span></button>' +
              nb('vivo', 'live', 'En vivo') + '<button type="button" data-v="deportes" onclick="VIP.lobby.sportsMenu(event)">' + ico('sport') + '<span>Deportes</span></button>' +
            '</nav>' +
            '<div class="prl-drawer" id="prlDrawer" hidden onclick="if(event.target===this)VIP.lobby.menu(false)"><aside class="prl-dr" role="dialog" aria-label="Mi cuenta"><div id="prlDrBody"></div></aside></div>' +
            '</div>');
        return $('prLobby');
    }
    function _balText() { try { const src = $('userBalance'); return src && src.textContent ? src.textContent.replace(/^\s*Saldo:?\s*/i, '') : '—'; } catch (_) { return '—'; } }
    function _paintBal() {
        try { // #920: PICA ROJA copia la tira de saldo del Inicio de la app (mismo diseño), sin el botón de instalar
            const box = $('prlPrBal'); const src = document.querySelector('#homeFull .balance-strip');
            if (box && src) { const c = src.cloneNode(true); c.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id')); c.querySelectorAll('.bs-install, button').forEach((e) => e.remove()); box.innerHTML = ''; box.appendChild(c); }
        } catch (_) {}
    }
    // F985: portadas propias de los lobbies (scripts/girox/lobby-covers.py en la gemela). Ezugi y Vivo siguen con la de Girox.
    const LOBBY_OWN = ['3/101', '3/103', '3/104', '7/10517_ifg', '7/10511_ifg', '7/10521_ifg', '7/10513_ifg', '7/10519_ifg', '7/10509_ifg'];
    function _wl(g) { return (g && g.key && LOBBY_OWN.indexOf(g.key) >= 0) ? Object.assign({}, g, { img: '/images/picaroja/lobby/' + g.key.replace('/', '_') + '.webp' }) : g; }
    function _card(g) {
        g = _wl(g);
        return '<button type="button" class="prl-g" onclick="VIP.lobby.play(\'' + esc(g.key) + '\', this)" data-name="' + esc(g.name) + '"' + (g.gid ? ' data-gid="' + Number(g.gid) + '" data-lk="' + esc(g.lk || '') + '"' : '') + ' title="' + esc(g.name) + '" aria-label="' + esc(g.name) + '">' +
            '<span class="prl-gi">' + (g.img ? '<img loading="lazy" decoding="async" src="' + esc(img(g.img)) + '" alt="" onerror="this.remove()">' : '') + (g.isNew ? '<em class="prl-new">NUEVO</em>' : '') + '<i>' + esc(g.name) + '</i></span></button>';
    }
    function _title(icon, title, onclick) {
        return '<div class="prl-sh">' + (onclick ? '<button type="button" class="prl-st" onclick="' + onclick + '">' : '<span class="prl-st">') + ico(icon) + '<h3>' + esc(title) + '</h3>' + (onclick ? '<b class="prl-chev">›</b></button>' : '</span>') + '</div>';
    }
    // #909: secciones como Stake: de a 4 por fila (#911); "Ver más" despliega de a 8 (el orden de los juegos es el de Girox: más jugados primero).
    let _secN = 0;
    function _row(icon, title, games, providerId, onTitle) {
        if (!games || !games.length) return '';
        const id = 'prlS' + (++_secN);
        return '<section class="prl-sec">' + _title(icon, title, onTitle || (providerId ? 'VIP.lobby.all(' + Number(providerId) + ', \'' + jsq(title) + '\')' : null)) +
            '<div class="prl-grid prl-g3" id="' + id + '" data-show="8">' + games.map((g, i) => _card(g).replace('class="prl-g"', 'class="prl-g' + (i >= 8 ? ' prl-hid' : '') + '"')).join('') + '</div>' +
            (games.length > 8 ? '<div class="prl-more"><button type="button" onclick="VIP.lobby.more(\'' + id + '\', this)">Ver más</button></div>' : '') + '</section>';
    }
    function more(id, btn) {
        const box = $(id); if (!box) return;
        const hid = box.querySelectorAll('.prl-hid'); for (let i = 0; i < Math.min(8, hid.length); i++) hid[i].classList.remove('prl-hid');
        if (box.querySelectorAll('.prl-hid').length === 0 && btn) btn.closest('.prl-more').remove();
    }
    // #989 (owner, captura estilo Stake: "dentro de PICA ROJA este formato de apuestas; sacamos las fotos de arriba y dejamos Top partidos"):
    // TOP PARTIDOS = tarjetas con hora/en vivo, escudos, equipos y cuotas 1 · X · 2. Datos: GET /api/sports/board (src/services/sportsBoard.js,
    // scoreboard público de ESPN, cache 60 s). 1girox NO expone una API de apuestas ⇒ la apuesta no se cierra acá: tocar el partido o una cuota
    // abre Digitain (la casa de deportes de Girox) LOGUEADO con su saldo y apuesta ahí; las cuotas son de REFERENCIA (en la casa pueden variar).
    let _board = null, _boardAt = 0, _boardBusy = false;
    function _boardLoad() {
        if (_boardBusy) return; _boardBusy = true;
        fetch(VIP.config.API_URL + '/api/sports/board').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
            _boardBusy = false; if (!d) return; _board = d; _boardAt = Date.now();
            const b = $('prlBoard'); if (b && b.isConnected) b.outerHTML = _hero();
        });
    }
    // #989 (owner: "si aprietan Apostar que vaya a la deportiva a ese partido, si se puede"): HOY no se puede saltar al partido puntual — el Digitain de
    // 1girox es un widget (SportFrame) fijo en su portada y Digitain no publica links por evento para nuestro dominio (gemela #940). Lo más cerca:
    // abrir Digitain logueado (el mismo ingreso directo que un slot) y, mientras carga, avisar qué partido buscar. Si 1girox/Digitain dan un link por
    // evento, se arma acá (`sportMatch`) sin tocar el resto.
    function sportMatch(home, away) {
        sport('/sports-new');
        try { setTimeout(() => { try { VIP.ui.showToast('⚽ En Deportes buscá ' + home + ' – ' + away + ' y apostá con tu saldo', 'info'); } catch (_) {} }, 2200); } catch (_) {}
    }
    function _match(m) {
        const o = m.odds; const go = "VIP.lobby.sportMatch('" + jsq(m.home) + "', '" + jsq(m.away) + "')";
        const team = (n, l) => '<span class="prl-mt">' + (l ? '<img src="' + esc(l) + '" alt="" loading="lazy" onerror="this.remove()">' : '<i></i>') + '<b>' + esc(n) + '</b></span>';
        const odd = (k, v) => '<button type="button" class="prl-mo" onclick="' + go + '"><small>' + k + '</small><b>' + (v ? Number(v).toFixed(2) : '—') + '</b></button>';
        return '<div class="prl-m">' +
            '<div class="prl-mh">' + (m.live ? '<em class="prl-mlive">● ' + esc(m.clock || 'En vivo') + '</em>' : '<em>' + (m.today ? 'Hoy' : 'Mañana') + ' ' + esc(m.hour) + '</em>') + '<span>' + esc(m.league) + '</span></div>' +
            '<button type="button" class="prl-mteams" onclick="' + go + '">' + team(m.home, m.homeLogo) + (m.live ? '<span class="prl-msc">' + esc(m.hs) + ' - ' + esc(m.as) + '</span>' : '<span class="prl-mvs">vs</span>') + team(m.away, m.awayLogo) + '</button>' +
            '<div class="prl-modds">' + (o ? odd('1', o.home) + (o.draw ? odd('X', o.draw) : '') + odd('2', o.away) : '<button type="button" class="prl-mo prl-mo-go" onclick="' + go + '"><b>Apostar ›</b></button>') + '</div></div>';
    }
    function _hero() {
        if (!_board || Date.now() - _boardAt > 60000) _boardLoad();
        const L = _board ? (_board.live || []).concat(_board.top || []).slice(0, 10) : [];
        return '<section class="prl-sec prl-board" id="prlBoard">' + _title('sport', 'Top partidos', "VIP.lobby.sport('/sports-new')") +
            (L.length ? '<div class="prl-mrow">' + L.map(_match).join('') + '</div><p class="prl-mnote">Cuotas de referencia · tocá y apostás en Deportes con tu saldo</p>'
                : (_board ? '' : '<div class="prl-mrow"><div class="prl-m prl-msk"></div><div class="prl-m prl-msk"></div></div>')) + '</section>';
    }
    // #909: proveedores como Stake · #989 (owner): "dejalos como estaban antes (logo + nombre) pero con fondo NEGRO en vez de blanco, queda más profesional".
    function _provTile(p) {
        return '<button type="button" class="prl-pv" onclick="' + (p.on || 'VIP.lobby.all(' + Number(p.id) + ', \'' + jsq(p.name) + '\')') + '" aria-label="' + esc(p.name) + '">' +
            '<span class="prl-pvb">' + (p.logo ? '<img loading="lazy" src="/api/games/img?u=' + encodeURIComponent(p.logo) + '" alt="" onerror="this.remove()">' : '') + '<b>' + esc(p.name) + '</b></span>' +
            '<small><i class="prl-dot"></i>' + Number(p.count || 0).toLocaleString('es-AR') + ' juegos</small></button>';
    }
    function _providers(list) {
        const ps = (list || []).filter((p) => p.count > 0); if (!ps.length) return '';
        return '<section class="prl-sec">' + _title('tag', 'Proveedores', null) + '<div class="prl-pvs">' + ps.map(_provTile).join('') + '</div></section>'; // #925: fila deslizable, todos
    }
    // #920 (owner): "una sección Casino lobby con los mismos lobbies que tiene Girox". Salen del catálogo de 1girox (búsqueda "lobby").
    function _lobbies() { return ((_data && _data.lobbies) || []); }
    // #989 (owner: "de entrada en el Inicio poné Casino en vivo con los 4 lobbies de Girox"): los 4 lobbies que muestra Girox (Vivo Gaming · Pragmatic
    // Live · Game Shows de Evolution · Ezugi), grandes, 2×2; si alguno no está en el catálogo se completa con los siguientes lobbies.
    function _live4() {
        const L = _lobbies(); if (!L.length) return '';
        const want = [/vivo/i, /pragmatic/i, /game ?show/i, /ezugi/i]; const pick = []; const used = new Set();
        want.forEach((re) => { const g = L.find((x) => !used.has(x.key) && (re.test(x.provider || '') || re.test(x.name || ''))); if (g) { used.add(g.key); pick.push(g); } });
        L.forEach((g) => { if (pick.length < 4 && !used.has(g.key)) { used.add(g.key); pick.push(g); } });
        return '<section class="prl-sec prl-live4-sec">' + _title('live', 'Casino en vivo', "VIP.lobby.go('vivo')") + '<div class="prl-live4">' + pick.slice(0, 4).map(_card).join('') + '</div></section>';
    }
    function _backBar() { return '<div class="prl-backbar"><button type="button" class="prl-backbtn" onclick="VIP.lobby.back()">‹ Volver</button></div>'; }
    // #922 (owner): "Deportes: que aparezcan las casas de Girox chiquito para elegir y abra directo".
    function sportsMenu(ev) {
        try { if (ev) { ev.stopPropagation(); ev.preventDefault(); } } catch (_) {}
        const old = $('prlSportPop'); if (old) { old.remove(); return; }
        const sp = _sportsList();
        const html = '<div id="prlSportPop" class="prl-sportpop" role="menu"><div class="prl-sportpop-l">' +
            sp.map((x) => '<button type="button" class="prl-sportpop-i" role="menuitem" onclick="event.stopPropagation();VIP.lobby.sportPick(\'' + esc(x.path) + '\')">' + ico('sport') + '<span>' + esc(x.title) + '</span></button>').join('') + '</div></div>';
        const btn = ev && ev.currentTarget && ev.currentTarget.closest ? ev.currentTarget : null;
        const host = (btn && btn.closest('button')) || null;
        if (host && (host.closest('.prl-nav') || host.closest('#bottomNav'))) { host.style.position = 'relative'; host.insertAdjacentHTML('beforeend', html); } // F988: también desde la barra de la app
        else { const m = $('prLobby'); if (m) m.insertAdjacentHTML('beforeend', html.replace('class="', 'class="prl-sportpop-center ')); }
        setTimeout(() => { document.addEventListener('click', function off(e) { const p = $('prlSportPop'); if (p && !p.contains(e.target)) p.remove(); document.removeEventListener('click', off, true); }, true); }, 0);
    }
    // #966: las casas de deportes aunque la lista del server todavía no haya llegado (cada una abre con su link directo, #962)
    function _sportsList() { const l = (_data && _data.sports) || []; return l.length ? l : [{ path: '/sports-new', title: 'Digitain' }, { path: '/sports', title: 'Ultim8' }]; }
    function sportPick(path) { const p = $('prlSportPop'); if (p) p.remove(); sport(path); }
    function back() { if (_view === 'all' && _allProv) { go('slots'); return; } go('inicio'); }
    function _search() {
        return '<label class="prl-search">' + ico('search') + '<input type="search" id="prlQ" placeholder="Buscar juegos" autocomplete="off" value="' + esc(_q) + '" oninput="VIP.lobby.search(this.value)"></label><div id="prlRes"></div>';
    }
    // #948: "Juegos nuevos" = /data/picaroja-extra.json ([key, nombre, portada, gid, lk, proveedor], del más nuevo al más viejo).
    let _xtra = null, _xtraP = null;
    function _extraLoad() {
        if (!_xtraP) _xtraP = fetch('/data/picaroja-extra.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
            .then((d) => { _xtra = ((d && d.games) || []).map((a) => ({ key: a[0], name: a[1], img: a[2], gid: a[3], lk: a[4] })); return _xtra; });
        return _xtraP;
    }
    // F971 (owner: "en proveedores de casino en vivo meté todos los que haya"): la lista pública de 1girox sólo trae a Evolution; las mesas de Ezugi,
    // Pragmatic Live, SA Gaming, Iconic21, Vivo Gaming, LiveVegas, TVBet y ElCasino están en el catálogo pero sin proveedor listado ⇒ /data/girox-live.json.
    let _live = null, _liveP = null;
    function _liveLoad() {
        if (!_liveP) _liveP = fetch('/data/girox-live.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
            .then((d) => { _live = ((d && d.providers) || []).map((p) => ({ name: String(p.name), games: (p.games || []).map((a) => ({ key: a[0], name: a[1], img: a[2], gid: a[3], lk: a[4] })) })); return _live; });
        return _liveP;
    }
    function _liveOr() { if (_live) return true; _liveLoad().then(() => { if (_view === 'vivo' || _view === 'inicio') _render(); }); return false; }
    function liveProv(i) { _liveLoad().then((L) => { const p = (L || [])[i]; if (p) list(p.name + ' · en vivo', p.games); }); }
    function _liveTiles() { return (_live || []).map((p, i) => ({ id: 0, name: p.name, count: p.games.length, live: true, on: 'VIP.lobby.liveProv(' + i + ')' })); }
    function _liveSecs() { return (_live || []).map((p, i) => _row('live', p.name, p.games.slice(0, 24), null, 'VIP.lobby.liveProv(' + i + ')')).join(''); }
    function extraAll() { _extraLoad().then((L) => list('Juegos nuevos', L || [])); }
    // vista de UNA lista de juegos (proveedor en vivo, juegos nuevos); de a 120 para no trabar el teléfono.
    let _list = null;
    function list(title, games) { _list = { title: String(title || ''), games: games || [], _n: 0 }; _allProv = null; _view = 'list'; _render(); const m = $('prlMain'); if (m) m.scrollTop = 0; }
    function _listMoreBtn(L) { L._n = 120; return L.games.length > 120 ? '<div class="prl-more"><button type="button" id="prlListMore" onclick="VIP.lobby.listMore()">Ver más (' + (L.games.length - 120) + ')</button></div>' : ''; }
    function listMore() {
        const L = _list; const box = $('prlListGrid'); if (!L || !box) return;
        const next = L.games.slice(L._n, L._n + 120); L._n += next.length;
        box.insertAdjacentHTML('beforeend', next.map(_card).join(''));
        const b = $('prlListMore'); if (b) { if (L._n >= L.games.length) b.parentNode.remove(); else b.textContent = 'Ver más (' + (L.games.length - L._n) + ')'; }
    }
    function _listHtml() {
        const L = _list || { title: '', games: [] };
        return _backBar() + '<div class="prl-sh"><span class="prl-st">' + ico('slots') + '<h3>' + esc(L.title) + '</h3></span></div>' +
            (L.games.length ? '<div class="prl-grid" id="prlListGrid">' + L.games.slice(0, 120).map(_card).join('') + '</div>' + _listMoreBtn(L) : '<div class="prl-note">Pronto vas a ver los juegos acá.</div>');
    }
    function _render() {
        const m = $('prlMain'); if (!m) return; _secN = 0;
        document.querySelectorAll('.prl-nav [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === _view || (_view === 'all' && b.dataset.v === 'slots')));
        if (!_data) { m.innerHTML = _hero() + '<div class="prl-note">Cargando los juegos…</div>'; return; }
        if (_view === 'list') { m.innerHTML = _listHtml(); return; }
        if (_view === 'lobbies') { m.innerHTML = _backBar() + (_lobbies().length ? _row('grid', 'Casino lobby', _lobbies()) : '<div class="prl-note">No hay lobbies para mostrar ahora.</div>'); return; }
        if (_view === 'ruleta') { // #989 (owner): todas las ruletas (en vivo y lobbies) en una sola vista
            if (!_liveOr()) { m.innerHTML = _backBar() + _title('live', 'Ruleta', null) + '<div class="prl-note">Cargando…</div>'; return; }
            const R = /rulet|roulette/i; const seen = new Set(); const games = [];
            (_live || []).forEach((p) => (p.games || []).forEach((g) => { if (R.test(g.name) && !seen.has(g.key)) { seen.add(g.key); games.push(g); } }));
            _lobbies().concat(...(_data.live || []).map((s) => s.games || [])).forEach((g) => { if (R.test(g.name) && !seen.has(g.key)) { seen.add(g.key); games.push(g); } });
            m.innerHTML = _backBar() + _title('live', 'Ruleta', null) + (games.length ? '<div class="prl-grid">' + games.map(_card).join('') + '</div>' : '<div class="prl-note">No hay ruletas para mostrar ahora.</div>') +
                '<div class="prl-more"><button type="button" onclick="VIP.lobby.go(\'vivo\')">Ver todo el casino en vivo</button></div>';
            return;
        }
        if (_view === 'vivo') {
            if (!_liveOr()) { m.innerHTML = _backBar() + _title('live', 'Casino en vivo', null) + '<div class="prl-note">Cargando…</div>'; return; }
            m.innerHTML = _backBar() + _title('live', 'Casino en vivo', null) + _providers(_liveTiles()) + // F971: todos los proveedores en vivo
                (_liveSecs() || (_data.live || []).map((s) => _row('live', s.title, s.games, s.providerId)).join('') || '<div class="prl-note">No hay mesas en vivo para mostrar ahora.</div>');
            return;
        }
        if (_view === 'slots' || _view === 'all') {
            const t = _allProv ? _allProv.name : 'Slots · todos los juegos';
            m.innerHTML = _backBar() + '<div class="prl-sh"><span class="prl-st">' + ico('slots') + '<h3>' + esc(t) + '</h3></span>' + (_allProv ? '<button type="button" class="prl-back" onclick="VIP.lobby.all(null)">Ver todos</button>' : '') + '</div>' +
                (_allProv ? '' : _search()) + '<div class="prl-grid" id="prlAll"></div><div class="prl-note" id="prlAllMore">Cargando…</div>';
            _allPage = 0; _allMore = true; _moreAll(); if (_q && !_allProv) search(_q); return;
        }
        _liveOr();
        const _pvAll = (_data.providers || []).concat(_liveTiles().filter((t) => !(_data.providers || []).some((p) => String(p.name).toLowerCase() === t.name.toLowerCase()))); // F971
        // #989 (owner): "el sorteo ponelo abajo del usuario y dale más lugar apenas entra la gente: sorteo 1 un recuadro y sorteo 2 otro, que se vea
        // qué tipo de sorteo es antes de expandir": las dos tarjetas de sorteos.js (Gran Sorteo | Sorteo mensual, con el premio) al tope del Inicio.
        m.innerHTML = '<div class="srt-cards prl-srt" data-srt-cards hidden></div>' + _live4() + _hero() + _providers(_pvAll) + _row('grid', 'Casino lobby', _lobbies()) + _search() + // #925: Proveedores arriba
            '';
        m.innerHTML += _row('fire', 'Populares', _data.popular) + _row('star', 'Nuevos', _data.nuevos, null, 'VIP.lobby.extraAll()') +
            (_data.live && _data.live[0] ? _row('live', 'En vivo · ' + _data.live[0].title, _data.live[0].games, _data.live[0].providerId) : '') +
            (_data.sections || []).map((s) => _row('slots', s.title, s.games, s.providerId)).join('') +
            '<div class="prl-more"><button type="button" onclick="VIP.lobby.go(\'slots\')">Ver los ' + Number(_data.total || 0).toLocaleString('es-AR') + ' juegos</button></div>';
        try { if (VIP.sorteos && VIP.sorteos.paint) VIP.sorteos.paint(); } catch (_) {} // #989: pinta los dos recuadros del sorteo
        if (_q) search(_q);
    }
    async function _moreAll() {
        if (_loadingAll || !_allMore) return; _loadingAll = true;
        try {
            _allPage++;
            const r = await fetch(VIP.config.API_URL + '/api/games/catalog?page=' + _allPage + (_allProv ? '&provider=' + _allProv.id : ''), { headers: auth() });
            const d = await r.json().catch(() => ({}));
            const box = $('prlAll'); if (!box) return;
            if (r.ok) { box.insertAdjacentHTML('beforeend', (d.games || []).map(_card).join('')); _allMore = !!d.hasMore; }
            else _allMore = false;
            const more = $('prlAllMore'); if (more) more.textContent = _allMore ? 'Cargando más…' : 'Llegaste al final ✔';
        } catch (_) { _allMore = false; } finally { _loadingAll = false; }
    }
    function _onScroll() {
        const m = $('prlMain'); if (!m) return;
        const up = $('prlUp'); if (up) up.hidden = m.scrollTop < 700;
        if (_view !== 'all' && _view !== 'slots') return;
        if (m.scrollTop + m.clientHeight > m.scrollHeight - 600) _moreAll();
    }
    async function _load() {
        try {
            const r = await fetch(VIP.config.API_URL + '/api/games/lobby', { headers: auth() });
            const d = await r.json().catch(() => ({}));
            if (r.ok) { _data = d; _render(); }
            else { const m = $('prlMain'); if (m) m.innerHTML = _hero() + '<div class="prl-note">' + esc(d.error || 'No pudimos traer los juegos. Probá de nuevo.') + '</div>'; }
        } catch (_) { const m = $('prlMain'); if (m) m.innerHTML = _hero() + '<div class="prl-note">Sin conexión. Probá de nuevo.</div>'; }
    }
    let _qlDragged = false;
    function ql() { if (_qlDragged) return; load(); }
    function _dragQl() { // #920 (gemela): el círculo se mueve como la burbuja de Girox; queda donde lo dejás (posición recordada)
        const b = $('prlQlChip'); if (!b || b._drag || !window.PointerEvent) return; b._drag = true; b.style.touchAction = 'none';
        try { const pos = JSON.parse(localStorage.getItem('vip_prl_ql_pos') || 'null'); if (pos && pos.left >= 0 && pos.top >= 0 && pos.left < window.innerWidth - 60 && pos.top < window.innerHeight - 40) { b.style.left = pos.left + 'px'; b.style.top = pos.top + 'px'; b.style.right = 'auto'; b.style.bottom = 'auto'; } } catch (_) {}
        let sx = 0, sy = 0, r0 = null, dr = false;
        b.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; r0 = b.getBoundingClientRect(); dr = false; try { b.setPointerCapture(e.pointerId); } catch (_) {} });
        b.addEventListener('pointermove', (e) => {
            if (!r0) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (!dr && Math.abs(dx) + Math.abs(dy) < 8) return; dr = true;
            const host = b.offsetParent ? b.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
            b.style.left = Math.min(Math.max(4, r0.left + dx), window.innerWidth - r0.width - 4) - host.left + 'px'; b.style.top = Math.min(Math.max(10, r0.top + dy), window.innerHeight - r0.height - 10) - host.top + 'px'; b.style.right = 'auto'; b.style.bottom = 'auto';
        });
        const end = () => { if (r0 && dr) { try { localStorage.setItem('vip_prl_ql_pos', JSON.stringify({ left: parseInt(b.style.left, 10), top: parseInt(b.style.top, 10) })); } catch (_) {} _qlDragged = true; setTimeout(() => { _qlDragged = false; }, 400); } r0 = null; dr = false; };
        b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
    }
    function open(view) {
        const el = _shell(); el.hidden = false; try { _dragQl(); } catch (_) {} document.body.classList.add('prl-open', 'casino-open'); // #914: modales (Perfil, Info, Retiro…) arriba de la página
        try { _prNav(true); } catch (_) {} // F988
        _view = view || 'inicio'; _render(); _paintBal();
        try { VIP.stories.paint(); } catch (_) {} // #931: aro y contador de historias en la barra
        try { if (VIP.sorteos && VIP.sorteos.paintCasino) VIP.sorteos.paintCasino(); } catch (_) {} // #989: píldora / cartel del sorteo en la barra
        try { if (VIP.sorteos && VIP.sorteos.load) VIP.sorteos.load(); } catch (_) {}
        clearInterval(_balTimer); _balTimer = setInterval(_paintBal, 5000);
        const m = $('prlMain'); if (m && !m._prlScroll) { m._prlScroll = true; m.addEventListener('scroll', _onScroll, { passive: true }); }
        if (!_data) _load();
        // #989 (owner): al entrar a jugar se ve el CÍRCULO de Carga rápida (cerrada); tocarlo abre el panel ahí mismo, con ✕ para volver al círculo.
    }
    // F988 (owner: "el menú inferior de PICA ROJA va a ser el de la app: a la izquierda Slots, Inicio que vaya a Inicio y en vez de Perfil, Deportes con
    // los proveedores"): con la página abierta, la barra de abajo de la APP (#bottomNav, menú opción 2) pasa por encima y sus botones cambian; al
    // cerrar vuelven a ser los de siempre. Sin #bottomNav queda la barra propia de la página.
    // #989 (owner: "bajá Slots, Menú a la izquierda, después Casino en vivo y Deportes del otro lado"): abajo Menú · Slots · Inicio · En vivo · Deportes.
    const _NAV_SWAP = { navMenu: { lbl: 'Menú', ico: 'menu', on: 'VIP.home.casinoFullMenu()' }, navPerfil: { lbl: 'Deportes', ico: 'sport', on: 'VIP.lobby.sportsMenu(event)' } };
    const _navExtra = (id, cls, on, k, lbl, title) => '<button type="button" class="' + esc(cls || 'tn-btn') + '" id="' + id + '" onclick="' + on + '" title="' + title + '"><span class="tn-ico">' + ico(k) + '</span><span class="tn-lbl">' + lbl + '</span></button>';
    let _navSaved = null;
    function _prNav(on) {
        if (on && !_navSaved && $('bottomNav')) {
            _navSaved = {};
            Object.keys(_NAV_SWAP).forEach((id) => { const b = $(id); if (!b) return; const x = _NAV_SWAP[id]; _navSaved[id] = { html: b.innerHTML, on: b.getAttribute('onclick') };
                b.innerHTML = '<span class="tn-ico">' + ico(x.ico) + '</span><span class="tn-lbl">' + x.lbl + '</span>'; b.setAttribute('onclick', x.on); });
            const ini = $('navInicio'); if (ini) { _navSaved.navInicio = { on: ini.getAttribute('onclick') }; ini.setAttribute('onclick', 'VIP.lobby.close(true);VIP.home.goHome()'); }
            const mn = $('navMenu'); if (mn && !$('navPrSlots')) mn.insertAdjacentHTML('afterend', _navExtra('navPrSlots', mn.className, "VIP.lobby.go('slots')", 'slots', 'Slots', 'Todos los slots')); // Slots al lado de Menú
            const pf = $('navPerfil'); if (pf && !$('navPrLive')) pf.insertAdjacentHTML('beforebegin', _navExtra('navPrLive', pf.className, "VIP.lobby.go('vivo')", 'live', 'En vivo', 'Casino en vivo')); // Casino en vivo al lado de Deportes
            document.body.classList.add('prl-appnav');
        } else if (!on && _navSaved) {
            Object.keys(_navSaved).forEach((id) => { const b = $(id); if (!b) return; if (_navSaved[id].html != null) b.innerHTML = _navSaved[id].html; b.setAttribute('onclick', _navSaved[id].on); });
            ['navPrSlots', 'navPrLive'].forEach((id) => { const x = $(id); if (x) x.remove(); });
            _navSaved = null; document.body.classList.remove('prl-appnav');
        }
    }
    // #989 (owner): "‹ Volver" = cerrar la página e ir al MENÚ COMPLETO (no a la pantalla de entrada del menú directo).
    function backHome() { close(); try { VIP.home.setHomeMode('full'); } catch (_) {} try { window.scrollTo({ top: 0 }); } catch (_) {} }
    function close() {
        try { _prNav(false); } catch (_) {} // F988
        const el = $('prLobby'); if (el) el.hidden = true; document.body.classList.remove('prl-open'); clearInterval(_balTimer);
        try { if (!(VIP.ui && VIP.ui._casinoOpen)) document.body.classList.remove('casino-open'); const p = $('casinoLoadPanel'); if (p && el && el.contains(p)) p.style.display = 'none'; if (VIP.home.casinoQuickClose && el && el.contains(p)) VIP.home.casinoQuickClose(); } catch (_) {}
    }
    function go(view) { if (view === 'deportes') { sportsMenu(null); return; } if (view === 'slots') _allProv = null; _view = view; _render(); const m = $('prlMain'); if (m) m.scrollTop = 0; }
    function all(providerId, name) { _allProv = providerId ? { id: providerId, name: name || 'Proveedor' } : null; go(providerId ? 'all' : 'slots'); }
    function search(v) {
        _q = String(v || '').trim();
        clearTimeout(_qTimer);
        const box = $('prlRes'); if (!box) return;
        if (_q.length < 2) { box.innerHTML = ''; return; }
        _qTimer = setTimeout(async () => {
            box.innerHTML = '<div class="prl-note">Buscando…</div>';
            try {
                const r = await fetch(VIP.config.API_URL + '/api/games/catalog?q=' + encodeURIComponent(_q), { headers: auth() });
                const d = await r.json().catch(() => ({}));
                const g = (r.ok && d.games) || [];
                box.innerHTML = g.length ? '<div class="prl-grid">' + g.map(_card).join('') + '</div>' : '<div class="prl-note">No encontramos "' + esc(_q) + '".</div>';
            } catch (_) { box.innerHTML = '<div class="prl-note">Sin conexión.</div>'; }
        }, 350);
    }
    function play(key, btn) {
        const name = (btn && btn.dataset && btn.dataset.name) || 'el juego';
        const ds = (btn && btn.dataset) || {}; // #944: id interno + launcher (si la tarjeta los tiene)
        if (VIP.home && VIP.home.gamePlay) VIP.home.gamePlay(key, name, ds.gid ? { gid: Number(ds.gid), lk: ds.lk || '' } : null);
    }
    // #962 (owner: "deportes que entre directo al link, sin pasar por Girox"): cada casa se abre con SU link directo (el mismo ingreso que los
    // favoritos: /api/platform/session ⇒ URL del proveedor). Si 1girox no da el link, favPlay avisa y se reintenta: nunca se cae en la web de Girox.
    const SPORT_KEYS = { '/sports-new': ['sport/onyx', 'Digitain'], '/sports': ['sport/gr8', 'Ultim8'], '/horses': ['sport/horses', 'Caballos'], '/horses-new': ['sport/turf', 'TurfWin'], '/poker': ['sport/poker', 'Póker'] };
    function sport(path) {
        const sp = ((_data && _data.sports) || []).find((x) => x.path === path || x.key === path);
        const k = (sp && sp.key) ? [sp.key, sp.title] : (SPORT_KEYS[path] || (/^sport\//.test(path) ? [path, 'Deportes'] : SPORT_KEYS['/sports-new']));
        try { VIP.home.gamePlay(k[0], k[1]); } catch (_) {}
    }
    // #909 (owner): MENÚ con el perfil: saldo, nivel y rango (VIP), y Soporte adentro.
    async function menu(show) {
        const dr = $('prlDrawer'); if (!dr) return;
        if (show === false || (show == null && !dr.hidden)) { dr.hidden = true; return; }
        dr.hidden = false; _paintBal(); _paintMenu();
        if (!(VIP.state && VIP.state.vipStatus)) {
            try { const r = await fetch(VIP.config.API_URL + '/api/vip/status', { headers: auth() }); if (r.ok) { VIP.state.vipStatus = await r.json(); _paintMenu(); } } catch (_) {}
        }
    }
    function _paintMenu() {
        const b = $('prlDrBody'); if (!b) return;
        const u = (VIP.state && VIP.state.currentUser) || {}; const v = (VIP.state && VIP.state.vipStatus) || {};
        const lv = v.enabled !== false && v.level ? v.level : null; const nx = v.enabled !== false ? v.next : null;
        const pct = Math.max(0, Math.min(100, Math.round(Number(v.progressPct) || 0)));
        const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
        const item = (k, t, fn) => '<button type="button" class="prl-mi" onclick="' + fn + '">' + ico(k) + '<span>' + t + '</span><b class="prl-chev">›</b></button>';
        b.innerHTML =
            '<div class="prl-dr-head"><img src="' + SK.home + '" alt="" class="prl-logo"><div><b>' + esc(u.username || 'Mi cuenta') + '</b><small>Pica Roja APP</small></div><button type="button" class="prl-x" onclick="VIP.lobby.menu(false)" aria-label="Cerrar">✕</button></div>' +
            '<div class="prl-dr-card"><small>Saldo</small><b class="prl-dr-bal">' + esc(_balText()) + '</b>' +
            '<div class="prl-dr-btns"><button type="button" class="prl-load" onclick="VIP.lobby.load()">Cargar</button><button type="button" class="prl-ghost" onclick="VIP.lobby.withdraw()">Retirar</button></div></div>' +
            '<div class="prl-dr-card"><small>Nivel y rango</small>' +
            (lv ? '<b class="prl-dr-lvl">' + esc(lv.emoji || '') + ' ' + esc(lv.name) + '</b>' : '<b class="prl-dr-lvl">Jugador</b><span class="prl-dr-sub">Todavía sin nivel</span>') +
            (nx ? '<div class="prl-bar"><i style="width:' + pct + '%"></i></div><span class="prl-dr-sub">' + pct + '% · te faltan ' + money(v.faltaParaSubir) + ' apostados para ' + esc((nx.emoji || '') + ' ' + nx.name) + '</span>' : (lv ? '<span class="prl-dr-sub">Nivel máximo</span>' : '')) + '</div>' +
            '<div class="prl-dr-list"><small class="prl-dr-cap">Deportes</small>' + _sportsList().map((sp) => item('sport', esc(sp.title), "VIP.lobby.menu(false);VIP.lobby.sport('" + esc(sp.path) + "')")).join('') + '</div>' +
            '<div class="prl-dr-list">' + item('chat', 'Soporte', 'VIP.lobby.support()') + item('home', 'Mi perfil', 'VIP.lobby.profile()') +
            item('fire', 'Sorteos', "VIP.lobby.menu(false);VIP.sorteos.open('mensual')") + item('star', 'Historias', 'VIP.lobby.menu(false);VIP.stories.open()') + item('grid', 'Información', 'VIP.lobby.menu(false);VIP.home.casinoInfo()') +
            item('slots', 'Jugar en 1girox', "VIP.lobby.menu(false);VIP.home.openPlatform('girox')") + // #989: cambiar de plataforma (misma cuenta y saldo)
            item('up', 'Volver a la app', 'VIP.lobby.close(true)') + '</div>';
    }
    function withdraw() { menu(false); try { VIP.withdraw.openWithdrawModal(); } catch (_) {} } // #914: el modal va arriba de la página (body.casino-open)
    function profile() { menu(false); try { VIP.home.openProfile(); } catch (_) {} }
    function top() { const m = $('prlMain'); if (m) m.scrollTo ? m.scrollTo({ top: 0, behavior: 'smooth' }) : (m.scrollTop = 0); }
    function load() { menu(false); try { VIP.home.toggleCasinoLoad(); return; } catch (_) {} close(); try { VIP.home.setHomeMode('full'); } catch (_) {} } // #914: Carga rápida sobre la página
    function support() { menu(false); close(true); try { VIP.home.setHomeMode('mini'); } catch (_) {} }
    // picaroja.com/paginaoficial ⇒ /?pr=1: se abre apenas la app tiene sesión.
    try {
        if (/[?&]pr=1\b/.test(location.search)) {
            let n = 0; const t = setInterval(() => { n++; if (VIP.state && VIP.state.currentToken && VIP.config) { clearInterval(t); try { VIP.home.openPlatform('picaroja'); } catch (_) { open('inicio'); } try { history.replaceState(null, '', location.pathname); } catch (_) {} } else if (n > 60) clearInterval(t); }, 500);
        }
    } catch (_) {}
    return { liveProv, sportOf: (p) => SPORT_KEYS[p] || null, open, close, backHome, go, all, more, menu, withdraw, profile, top, search, play, sport, sportMatch, load, ql, support, extraAll, listMore, back, sportsMenu, sportPick, skin: () => 'picaroja' };
})();
