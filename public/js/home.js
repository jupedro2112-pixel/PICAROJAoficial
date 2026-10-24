// =====================================================================
// HOME 2.0 — "la carga automática primero, el chat como soporte" (2026-10-16, #220)
//
// Pedido del owner: cuando el cliente entra NO ve el chat; ve la CARGA AUTOMÁTICA
// (CBU/alias/datos de acceso — autoload.js), abajo las PLATAFORMAS para elegir
// dónde jugar después de cargar (reemplaza al botón "PÁGINA CASINO AQUÍ"), y una
// explicación automática de cómo funciona el servicio (reembolsos resumidos + dos
// plataformas). El chat queda como SOPORTE: la barra verde arriba abre un panel
// a pantalla completa con el chat de siempre (mismos ids: chatMessages,
// messageInput, attachBtn… nada del cableado viejo cambia).
//
// Este módulo:
//   • abre/cierra el panel de soporte (#supportPanel) y lleva el contador de
//     mensajes sin leer en la barra;
//   • si llega la pregunta "¿dónde querés jugar?" (metadata platform_choice) con
//     el chat cerrado, lo ABRE solo para que el cliente vea los botones;
//   • dibuja la tarjeta de plataformas (GET /api/platforms) y la de "cómo funciona"
//     (con la escalera de reembolsos real de VIP.state.refundStatus);
//   • engancha todo al login envolviendo VIP.ui.showChatScreen.
// =====================================================================
(function () {
    'use strict';
    window.VIP = window.VIP || {};

    let _unread = 0;
    let _open = false;
    let _platforms = null;
    let _platformsAt = 0;

    function _el(id) { return document.getElementById(id); }
    function _esc(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

    // ---------------- #266: CHAT PRINCIPAL + MENÚ DESLIZANTE ----------------
    // (owner 2026-10-17: "un menú deslizante para arriba ocultando todo y dejar el chat como principal;
    //  si quiere el % o ver más de la app que pueda expandir todo lo que ya tenemos").
    //   mini (default) → body.home-mini: #homeFull plegado (max-height 0), #supportPanel INLINE con la
    //                    cabecera estilo WhatsApp (#waHead) y el botón CBU en la barra de escribir.
    //   full            → el home de siempre; el chat vuelve a ser overlay (burbuja).
    // Se recuerda por dispositivo (localStorage vip_home_mode). El cartel viene de /api/platforms.
    // #267: tercer modo **play** (el de ENTRADA, siempre al abrir la app): la plataforma abierta adentro
    //       (#entryView: tabs Girox/Ganamos + iframe público) y abajo "Carga manual" (→ mini) /
    //       "Carga automática" (→ full). El modo elegido se recuerda sólo en la SESIÓN (sessionStorage):
    //       cada vez que se abre la app, la gente ve de entrada la plataforma.
    // #366 (owner): cuarto modo **easy** = MENÚ FÁCIL ("para la gente que se pierde con tantos botones"): saldo,
    //       CARGAR AHORA, reembolso / ruleta / referidos / ver la plataforma, ayuda por chat. La preferencia
    //       (fácil o completo) vive en localStorage vip_menu_pref; se elige en #menuChooser al entrar la primera
    //       vez y se cambia desde Perfil (o con los links de abajo de cada menú). "Inicio" respeta la preferencia.
    const HOME_MODE_KEY = 'vip_home_mode';
    const HOME_BANNER_KEY = 'vip_home_banner';
    const MENU_PREF_KEY = 'vip_menu_pref';
    // #635 (owner): qué menús puede elegir la gente (panel → Elegir menú → "Menús activos"); llega en /api/public/menu-layout
    // (Config['menusEnabled']) y se recuerda en localStorage para aplicarlo al instante al arrancar (sin "viejo y después nuevo").
    const MENUS_ON_KEY = 'vip_menus_on'; const MENU_ORDER = ['full', 'basic', 'easy', 'girox']; // #636: el completo es el predeterminado · #670: + Girox directo
    let _menusOn = { basic: true, easy: true, full: true, girox: true };
    let _curPref = null; // #670: preferencia vigente (para distinguir 'girox' del completo, que comparten el modo play)
    try { const c = JSON.parse(localStorage.getItem(MENUS_ON_KEY) || 'null'); if (c && typeof c === 'object') _menusOn = { basic: c.basic !== false, easy: c.easy !== false, full: c.full !== false, girox: c.girox !== false }; } catch (_) {}
    function _menuOn(p) { return _menusOn[p] !== false; }
    function _firstMenuOn() { return MENU_ORDER.find(_menuOn) || 'basic'; }
    function _applyMenusEnabled(m) {
        if (m && typeof m === 'object') {
            _menusOn = { basic: m.basic !== false, easy: m.easy !== false, full: m.full !== false, girox: m.girox !== false };
            if (!MENU_ORDER.some(_menuOn)) _menusOn = { basic: true, easy: true, full: true, girox: true };
            try { localStorage.setItem(MENUS_ON_KEY, JSON.stringify(_menusOn)); } catch (_) {}
        }
        MENU_ORDER.forEach((p) => document.body.classList.toggle('no-menu-' + p, !_menuOn(p)));
        const on = MENU_ORDER.filter(_menuOn); document.body.classList.toggle('menus-one', on.length === 1);
        try {
            if (on.length === 1) { const ch = _el('menuChooser'); if (ch && ch.classList.contains('open')) setMenuPref(on[0], { quiet: true, auto: true }); }
            if (_homeMode && (_homeMode === 'basic' || _homeMode === 'easy' || _homeMode === 'play') && !_menuOn(_prefOfMode())) setHomeMode(_modeFor(getMenuPref()), { persist: false });
        } catch (_) {}
    }
    const MENU_FIXED_KEY = 'vip_menu_fixed'; // #559: '1' = el menú guardado es el del ingreso (no se vuelve a preguntar)
    // #836 (owner): "que siempre cuando la gente entra a la app entre al menú de Girox; si lo cambian, que usen el que cambian" ⇒ '1' = la
    // persona ELIGIÓ un menú (desde el selector o los botones de cambiar menú): al volver a entrar arranca en ése, sin preguntar.
    const MENU_USER_KEY = 'vip_menu_user';
    // #937 (owner): "cuando la gente instala la app, dejar Girox predeterminada siempre" ⇒ en la app INSTALADA se arranca en Girox directo
    // aunque haya elegido otro menú en el navegador (durante la sesión puede cambiarlo con "Cambiar menú").
    function _isInstalledApp() { try { return document.documentElement.classList.contains('is-app') || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; } catch (_) { return false; } }
    // #980 (owner): "completo hasta la primera carga, Girox directo después": el flag se guarda al saber que ya cargó (promo de 1ª carga / carga acreditada).
    const HAS_DEP_KEY = 'vip_has_dep';
    function _hasDeposit() { try { return localStorage.getItem(HAS_DEP_KEY) === '1'; } catch (_) { return false; } }
    function _defaultPref() { return (_hasDeposit() || !_menuOn('full')) && _menuOn('girox') ? 'girox' : (_menuOn('full') ? 'full' : 'girox'); }
    function _userPickedMenu() { try { return localStorage.getItem(MENU_USER_KEY) === '1' && !!localStorage.getItem(MENU_PREF_KEY); } catch (_) { return false; } }
    function isMenuFixed() { try { return localStorage.getItem(MENU_FIXED_KEY) === '1'; } catch (_) { return false; } }
    let _homeMode = 'play';
    let _easyTimer = null;
    let _easyRefLoaded = false;
    let _headObs = null;

    function getHomeMode() { return _homeMode; }
    function setHomeMode(mode, opts) {
        _applyMenuLayout(); // #482
        setTimeout(function () { try { loadStrategy(false); } catch (_) {} }, 600); // #504
        // #596 (owner, limpieza): sin el popup de primera carga (queda el cartel chico del Inicio, #564) // #488: la opción de menú (barra abajo) aplica en TODOS los modos (fácil y completo)
        mode = (mode === 'full' || mode === 'mini' || mode === 'easy' || mode === 'basic') ? mode : 'play'; // #512: basic
        _homeMode = mode;
        const p = _el('supportPanel');
        const cta = _el('serviceBannerCta');
        const bn = _el('serviceBanner');
        document.body.classList.toggle('home-mini', mode === 'mini');
        document.body.classList.toggle('home-play', mode === 'play');
        document.body.classList.toggle('home-full', mode === 'full'); // #269: carga automática SENCILLA (CSS esconde lo demás)
        document.body.classList.toggle('home-easy', mode === 'easy' || mode === 'basic'); // #366: MENÚ FÁCIL (#512: básico reusa el ocultado)
        document.body.classList.toggle('home-basic', mode === 'basic'); // #512
        // #569: la etiqueta "· Completo" de Cambiar menú se sacó (no entraba con Racha)
        // #637 (owner): nivel VIP + fueguito en la LÍNEA DE ESTADO (#statusRow) arriba de todo del Inicio (play); en el básico el nivel
        // va al lado de "Cambiar menú" (#627) y la racha ya está en la línea del saldo; en los demás modos no se muestran.
        try {
            const sr = _el('statusRow'), tr = _el('topRow'), vm = _el('vipMiniBtn'), fm = _el('fireMiniBtn');
            // #765 (owner): en el BÁSICO la misma línea de estado del completo (🏆 Nivel · 🔥 Racha), arriba de todo, sin nombre ni saldo.
            if (sr && !sr._srHome) { sr._srHome = sr.parentNode; sr._srNext = sr.nextSibling; }
            if (mode === 'play' || mode === 'basic') {
                if (sr) { if (vm) sr.appendChild(vm); if (fm) sr.appendChild(fm); }
                if (vm) vm.hidden = false; if (fm) fm.hidden = false;
                const bv = _el('basicView');
                if (sr && mode === 'basic' && bv && sr.parentNode !== bv) bv.prepend(sr);
                if (sr && mode === 'play' && sr._srHome && sr.parentNode !== sr._srHome) { try { sr._srHome.insertBefore(sr, sr._srNext); } catch (_) { sr._srHome.appendChild(sr); } }
            }
            else { if (vm) vm.hidden = true; if (fm) fm.hidden = true; }
            if (sr) sr.hidden = !(mode === 'play' || mode === 'basic');
            _fireMiniSync();
        } catch (_) {}
        try { _paintMenuPin(); } catch (_) {} // #559
        clearInterval(_easyTimer); _easyTimer = null;
        document.body.classList.remove('support-open');
        _paintNav();
        if (mode === 'play') {
            if (p) p.classList.add('hidden');
            _open = false;
            try { const bb = _el('supportBubble'); if (bb) bb.style.visibility = ''; } catch (_) {}
            try { const i = _el('messageInput'); if (i) i.blur(); } catch (_) {}
            renderEntryTabs();
            _entryLoad();
            try { if (_el('evFavs')) _favLoad(); } catch (_) {} // #840
        } else if (mode === 'easy' || mode === 'basic') {
            _entryUnload();
            if (p) p.classList.add('hidden');
            _open = false;
            try { const i = _el('messageInput'); if (i) i.blur(); } catch (_) {}
            _easyPaint(); if (mode === 'basic') _basicPaint();
            _easyTimer = setInterval(() => { if (!document.hidden && (_homeMode === 'easy' || _homeMode === 'basic')) { _easyPaint(); if (_homeMode === 'basic') _basicPaint(); } }, 15000);
        } else {
            _entryUnload();
        }
        if (mode === 'mini') {
            if (p) p.classList.remove('hidden');
            _open = true; _unread = 0; _paintBadge();
            if (cta) cta.textContent = 'Ir a carga automática ›';
            if (bn) { bn.setAttribute('aria-expanded', 'false'); bn.title = 'Ver la app completa'; }
            try { VIP.chat.markReceivedAsRead(); } catch (_) {}
            setTimeout(() => { try { VIP.chat.scrollToBottom(); } catch (_) {} }, 80);
            // #373 (owner): el chat ya no es "Carga manual" sino SOPORTE: no se manda el CBU solo (#365 se sacó);
            // Martín se presenta en la tarjeta de arriba (#supportIntro) y el cliente cuenta su caso.
            try { _paintSupportIntro(_platforms && _platforms.supportIntro); } catch (_) {}
        } else {
            if (p) p.classList.add('hidden');
            _open = false;
            try { const bb = _el('supportBubble'); if (bb) bb.style.visibility = ''; } catch (_) {}
            if (cta) cta.textContent = '▴ Ocultar · ir al chat';
            if (bn) { bn.setAttribute('aria-expanded', 'true'); bn.title = 'Volver al chat'; }
            try { const i = _el('messageInput'); if (i) i.blur(); } catch (_) {}
        }
        if (!opts || opts.persist !== false) { try { sessionStorage.setItem(HOME_MODE_KEY, mode); } catch (_) {} }
    }
    function toggleHomeMode() { setHomeMode(_homeMode === 'mini' ? 'full' : 'mini'); }
    // #268: barra de arriba — resalta la sección activa.
    function _paintNav() {
        const map = { navInicio: 'play', navAuto: 'full', navManual: 'mini' };
        Object.keys(map).forEach((id) => { const b = _el(id); if (b) b.classList.toggle('active', map[id] === _homeMode || (id === 'navInicio' && _homeMode === 'easy')); });
    }
    // ---------------- #366: MENÚ FÁCIL / COMPLETO ----------------
    function getMenuPref() { try { const v = localStorage.getItem(MENU_PREF_KEY); const p = (v === 'easy' || v === 'full' || v === 'basic' || v === 'girox') ? v : null; return (p && !_menuOn(p)) ? _firstMenuOn() : p; } catch (_) { return null; } } // #512: + basic · #635: si está deshabilitado, el primero activo
    const _modeFor = (pref) => (pref === 'easy' ? 'easy' : (pref === 'basic' ? 'basic' : (pref === 'girox' ? 'play' : (_menuOn('full') ? 'play' : (_firstMenuOn() === 'easy' ? 'easy' : 'basic'))))); // #670: girox = Inicio + casino abierto
    // #670 (owner): MENÚ "GIROX DIRECTO": abre la plataforma ADENTRO de la app (con sesión) y el panel de Carga rápida (datos +
    // adjuntar + Retirar). Se usa al elegir el menú, al entrar con ese menú fijo y al tocar Inicio.
    function _giroxDirect() {
        try { if (VIP.ui && VIP.ui._casinoOpen) return; } catch (_) {}
        // #672 (owner): abre Girox porque es la plataforma seleccionada; cuando haya otras con API, abre la preferida del cliente.
        setTimeout(() => { try { const list = (_platforms && _platforms.platforms) || []; const pref = _platforms && _platforms.preferredPlatform; const pp = list.find((x) => x.id === pref && x.connected); openPlatform(pp ? pp.id : 'girox', { embed: true }); } catch (_) {} }, 350);
    }
    function _afterPref(pref) { _curPref = pref; if (pref === 'girox') _giroxDirect(); }
    // "Inicio" de la barra: menú fácil o completo según lo que eligió la persona.
    // #519 (owner): el botón INICIO es donde cada uno elige su tipo de menú. Si ya estás en el Inicio, abre el selector
    // (Básico · Fácil · Completo); si venías del chat u otra pantalla, primero te lleva al Inicio.
    function goHome() {
        // #539 (owner): INICIO va SIEMPRE al inicio del menú ya elegido (sin abrir el selector; para cambiar está "Cambiar menú").
        // #588 (owner): en el básico, INICIO cierra los paneles desplegados (CARGAR / RETIRAR).
        try {
            const lp = _el('bvLoadPanel'), wp = _el('bvWdPanel'); const lb = document.querySelector('#basicView .bv-load'), wb = document.querySelector('#basicView .bv-wd');
            if (lp) lp.hidden = true; if (wp) wp.hidden = true; if (lb) lb.setAttribute('aria-expanded', 'false'); if (wb) wb.setAttribute('aria-expanded', 'false');
        } catch (_) {}
        setHomeMode(_modeFor(getMenuPref()));
        _afterPref(getMenuPref()); // #670: con Girox directo, Inicio vuelve a abrir la plataforma
        // #606 (owner): INICIO vuelve ARRIBA de la pantalla inicial (los que scrollean son los contenedores internos, no la ventana)
        try { ['basicView', 'easyView', 'entryView', 'homePanel', 'homeFull', 'chatScreen'].forEach((id) => { const el = _el(id); if (el) el.scrollTop = 0; }); window.scrollTo({ top: 0 }); } catch (_) {}
    }
    function setMenuPref(pref, opts) {
        pref = (pref === 'easy' || pref === 'basic' || pref === 'girox') ? pref : 'full'; // #670: + girox
        if (!_menuOn(pref)) pref = _firstMenuOn(); // #635
        // #836: lo que elige la PERSONA se recuerda (también Girox) y es donde arranca la próxima vez; lo automático (entrada por defecto
        // a Girox, un solo menú activo) no pisa una elección suya. 🪦 #678: antes Girox directo no se guardaba.
        if (!opts || !opts.auto) { try { localStorage.setItem(MENU_PREF_KEY, pref); localStorage.setItem(MENU_USER_KEY, '1'); } catch (_) {} }
        closeMenuChooser();
        setHomeMode(_modeFor(pref));
        _afterPref(pref); // #670
        setTimeout(installManifestSync, 300); // #673: el manifest lleva el menú elegido
        // #596: sin popup de primera carga // #488
        if (!opts || !opts.quiet) {
            try { VIP.ui.showToast(pref === 'easy' ? '☰ Menú intermedio activado. Lo cambiás cuando quieras con "Cambiar menú".' : (pref === 'basic' ? '▭ Menú básico activado: cargar, retirar y elegir dónde jugás.' : (pref === 'girox' ? '🎰 Girox directo: entrás a jugar al toque; cargás y retirás desde el panel de adentro.' : '🧭 Menú completo activado. Lo cambiás cuando quieras con "Cambiar menú".')), 'success'); } catch (_) {}
        }
    }
    function chooseMenu(pref) { setMenuPref(pref); }
    // #528: el fueguito resumido copia lo que dice la tarjeta grande (la pinta fire.js) — sin duplicar lógica
    function _fireMiniSync() {
        // #578/#627: el básico copia lo que pintan refunds.js / fire.js en el inicio completo: nivel VIP → píldora #vipMiniBtn (al lado de
        // "Cambiar menú"), racha → #bvFireN (en la línea del nombre y el saldo).
        try {
            const lv = _el('vipHeadLvl'), pc = _el('vipHeadPct'), bar = _el('vipBarFill');
            const bl = _el('vipMiniLvl'), bp = _el('vipMiniPct'), bb = _el('vipMiniBar');
            if (lv && bl) bl.textContent = (lv.textContent || '').trim() || 'Nivel';
            if (pc && bp) bp.textContent = (pc.textContent || '').trim();
            if (bar && bb) bb.style.width = bar.style.width || '0%';
            const st = _el('fireHomeStreak'), fn = _el('bvFireN');
            if (st && fn) fn.textContent = (st.textContent || '0').trim();
        } catch (_) {}
        try { const s = _el('fireHomeSub'), st = _el('fireHomeStreak'); const ms = _el('fireMiniSub'), mst = _el('fireMiniStreak'); if (s && ms) ms.textContent = (s.textContent || '').trim() || 'Reclamá tu premio de hoy'; if (st && mst) mst.textContent = (st.textContent || '0').trim() + ' d'; } catch (_) {}
    }
    setInterval(_fireMiniSync, 5000);
    // #512: MENÚ BÁSICO — saludo + saldo, CARGAR, RETIRAR, chips de plataforma (fija la preferida) y "Entrar a jugar".
    // #636: usuario con logo en la franja del saldo del completo
    function _paintBsUser() { try { const u = VIP.state && VIP.state.currentUser && VIP.state.currentUser.username; const b = _el('bsUserName'); if (b) b.textContent = u || '—'; } catch (_) {} }
    function _basicPaint() {
        _paintBsUser();
        try { const u = VIP.state && VIP.state.currentUser && VIP.state.currentUser.username; const h = _el('basicHello'); if (h) h.textContent = u || 'Hola'; } catch (_) {} // #627: sólo el nombre, con el ícono 👤
        try { const b = _el('userBalance'), bb = _el('basicBalance'); if (b && bb && b.textContent) bb.textContent = b.textContent; } catch (_) {}
        const box = _el('basicPlats'); if (!box) return;
        const defId = (_platforms && _platforms.defaultPlatform) || 'girox'; const pref = (_platforms && _platforms.preferredPlatform) || null;
        const soon = (p) => p.connected === false && p.id !== defId && p.id !== 'girox';
        box.innerHTML = _withPicaroja(_entryList()).map((p) => { const on = pref ? pref === p.id : p.id === defId; return '<button type="button" class="bv-chip plat-' + _esc(p.id) + (on ? ' on' : '') + (soon(p) ? ' soon' : '') + '" onclick="VIP.home.basicPick(\'' + _esc(p.id) + '\',' + (soon(p) ? 'true' : 'false') + ')">' + (p.logoUrl ? '<img src="' + _esc(p.logoUrl) + '" alt="">' : '') + '<b>' + _esc(/^jugaygana$/i.test(p.name || '') ? 'Jugaygana' : (p.name || p.id)) + '</b>' + (soon(p) ? '<small>Pronto</small>' : (on ? '<small>✓</small>' : '')) + '</button>'; }).join('');
    }
    async function basicPick(id, isSoon) {
        if (isSoon) { try { VIP.ui.showToast('Pronto: esta plataforma se habilita en breve', 'info'); } catch (_) {} return; }
        try { await setPreferred(id); } catch (_) {}
        _basicPaint();
    }
    // #516: paneles desplegables del básico (uno abierto a la vez); al abrir CARGAR se cargan CBU/alias y mínimos
    let _bvCbu = null;
    // #583 (owner): en el menú BÁSICO, "Carga auto" expande el panel de CARGAR (alias, CBU, pasos) en la MISMA pantalla; en los
    // otros menús va al inicio completo (carga automática), como siempre.
    function autoTap() {
        if (_homeMode === 'basic') {
            const lp = _el('bvLoadPanel');
            if (lp && lp.hidden) basicToggle('load');
            try { setTimeout(() => { const el = _el('bvLoadPanel'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 150); } catch (_) {}
            return;
        }
        setHomeMode('full');
    }
    async function basicToggle(which) {
        const lp = _el('bvLoadPanel'), wp = _el('bvWdPanel'); const lb = document.querySelector('#basicView .bv-load'), wb = document.querySelector('#basicView .bv-wd');
        const openLoad = which === 'load' ? lp.hidden : false, openWd = which === 'wd' ? wp.hidden : false;
        if (lp) lp.hidden = !openLoad; if (wp) wp.hidden = !openWd; if (lb) lb.setAttribute('aria-expanded', openLoad ? 'true' : 'false'); if (wb) wb.setAttribute('aria-expanded', openWd ? 'true' : 'false');
        try { const md = _platforms && _platforms.minDepositArs; if (md > 0) { const e = _el('bvMinDep'); if (e) e.textContent = _m$(md); } const mw = _platforms && _platforms.withdrawMinArs; if (mw > 0) { const e2 = _el('bvMinWd'); if (e2) e2.textContent = _m$(mw); document.querySelectorAll('.wd-amt').forEach((x) => { x.textContent = _m$(mw); }); } } catch (_) {} // #757: + retiro mínimo en el botón RETIRAR
        if (openLoad && !_bvCbu) {
            try { const r = await fetch(VIP.config.API_URL + '/api/config/cbu', { headers: { Authorization: 'Bearer ' + VIP.state.currentToken } }); if (r.ok) _bvCbu = await r.json(); } catch (_) {}
            const c = _bvCbu || {}; const set = (id, v) => { const e = _el(id); if (e) e.textContent = v || 'no disponible'; };
            set('bvAlias', c.alias); set('bvCbu', c.number || c.cbu); set('bvTitular', c.titular); set('bvBank', c.bank);
        }
        if (openLoad) setTimeout(() => { try { lp.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {} }, 50);
    }
    function basicCopy(k) { const c = _bvCbu || {}; const v = k === 'alias' ? c.alias : (c.number || c.cbu); if (!v) return; try { navigator.clipboard.writeText(String(v)); VIP.ui.showToast((k === 'alias' ? 'Alias' : 'CBU') + ' copiado ✓', 'success'); } catch (_) { try { VIP.ui.copyText(String(v)); } catch (__) {} } }
    function basicPlay() { const pref = (_platforms && _platforms.preferredPlatform) || (_platforms && _platforms.defaultPlatform) || 'girox'; openPlatform(pref); }
    // #620 (owner): botón PLATAFORMA de la barra: abre la plataforma elegida para jugar con el saldo (sin cargar). Si hay varias
    // conectadas y todavía no eligió, abre el selector. Con Girox elegida muestra el logo de Girox y su nombre.
    function _platChosen() {
        const list = (_platforms && _platforms.platforms) || [];
        const pid = (_platforms && (_platforms.preferredPlatform || _platforms.lastPlatform)) || null;
        if (pid) return list.find((p) => p.id === pid) || null;
        const conn = list.filter((p) => p.connected !== false);
        if (conn.length === 1) return conn[0];
        const def = (_platforms && _platforms.defaultPlatform) || 'girox';
        return list.find((p) => p.id === def) || null;
    }
    function _paintPlatNav() {
        const b = _el('navPlat'); if (!b) return;
        const p = _platChosen();
        const img = _el('navPlatLogo'), ico = _el('navPlatIco'), lbl = _el('navPlatLbl');
        const logo = p && (p.logoUrl || (p.id === 'girox' ? '/images/soporte-1girox.png' : (p.id === 'ganamos' ? '/images/ganamos.png' : (p.id === 'jugaygana' ? '/images/jugaygana.png' : ''))));
        if (img && logo) { img.src = logo; img.hidden = false; if (ico) ico.hidden = true; } else { if (img) img.hidden = true; if (ico) ico.hidden = false; }
        if (lbl) lbl.textContent = 'JUGÁ AQUÍ'; // #623 (owner): dice JUGÁ AQUÍ; el logo muestra la elegida
        b.title = 'Elegí dónde jugar con tu saldo';
    }
    // #623 (owner): al tocar JUGÁ AQUÍ siempre abre el selector de plataformas (Girox · Ganamos · Jugaygana) para que elija.
    function platTap() { easyPlay(); }
    // #504: ESTRATEGIA — bono de segunda carga vigente + misiones de la semana (progreso real). Se consulta al pintar el Inicio (cache 90 s).
    let _stAt = 0, _stData = null;
    const _m$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
    function _msBar(m) { const pct = Math.min(100, Math.round((m.value / m.target) * 100)); const val = m.type === 'deposit_total' ? _m$(m.value) + ' / ' + _m$(m.target) : m.value + ' / ' + m.target; return '<div class="ms-item' + (m.done ? ' done' : '') + '"><div class="ms-row"><b>' + _esc(m.title) + '</b><span class="ms-prize">' + (m.credited ? '✓ ' + _m$(m.rewardArs) + ' acreditado' : (m.done ? '✓ cumplida' : '+' + _m$(m.rewardArs))) + '</span></div><div class="ms-track"><i style="width:' + pct + '%"></i></div><small>' + val + (m.minAmount ? ' · cargas de ' + _m$(m.minAmount) + ' o más' : '') + '</small></div>'; }
    function _stPaint() {
        const d = _stData || {}; const sd = d.secondDeposit, ms = d.missions || [];
        _fdNotesPaint(); // #626: aviso de primera carga junto a cada 'Adjuntar comprobante'
        const btn = _el('ezMissions'), card = _el('missionsCard'); const nv = d.nivel || null;
        if (!ms.length) { if (btn) btn.hidden = true; if (card) card.hidden = true; return; }
        const done = ms.filter((m) => m.done).length;
        const nivelTxt = nv ? (nv.emoji + ' ' + nv.name) : '';
        const subeTxt = nv ? (nv.next ? (nv.todasCumplidas ? '¡Completaste todas! La semana que viene jugás en ' + nv.next.emoji + ' ' + nv.next.name + '.' : 'Completá las ' + ms.length + ' y la semana que viene pasás a ' + nv.next.emoji + ' ' + nv.next.name + (nv.vipNextName ? ' (también al llegar a VIP ' + nv.vipNextName + ').' : '.')) : 'Estás en el nivel más alto.') + (nv.vipName ? ' Tu nivel VIP: ' + nv.vipName + '.' : '') : '';
        if (btn) { btn.hidden = false; const bd = _el('ezMissionsBadge'); if (bd) { bd.textContent = done + '/' + ms.length; bd.style.display = ''; } const sub = _el('ezMissionsSub'); if (sub) sub.textContent = (nivelTxt ? 'Nivel ' + nivelTxt + ' · ' : '') + (done === ms.length ? '¡Todas cumplidas!' : done + ' de ' + ms.length + ' cumplidas'); const bars = _el('ezMissionsBars'); if (bars) bars.innerHTML = ms.map((m) => '<i class="' + (m.done ? 'ok' : '') + '" style="--w:' + Math.min(100, Math.round((m.value / m.target) * 100)) + '%"></i>').join(''); }
        try { const ev = _el('evSvcMissions'); if (ev) ev.textContent = done + ' de ' + ms.length + ' cumplidas'; } catch (_) {} // #524
        if (card) { card.hidden = false; const cs = _el('missionsCardSub'); if (cs) cs.textContent = (nivelTxt ? nivelTxt + ' · ' : '') + done + ' de ' + ms.length + ' cumplidas'; const cl = _el('missionsCardList'); if (cl) cl.innerHTML = ms.map(_msBar).join(''); const nt = _el('missionsCardNote'); if (nt) nt.textContent = (d.rolloverX > 0 ? 'El premio se juega x' + d.rolloverX + ' antes de poder retirarlo. ' : '') + (d.maxRewardPct > 0 ? 'Premio hasta el ' + d.maxRewardPct + '% de lo cargado en la semana.' : ''); let op = '0'; try { op = localStorage.getItem('vip_ms_open') || '0'; } catch (_) {} toggleMissionsCard(op === '1'); }
        const list = _el('missionsList'); if (list) list.innerHTML = (nv ? '<div class="ms-level"><b>' + _esc(nivelTxt) + '</b><small>' + _esc(subeTxt) + '</small></div>' : '') + ms.map(_msBar).join('');
        // #518: la sección de misiones del modal Info toma los números reales
        try { const r1 = _el('infoMsRoll'); if (r1 && d.rolloverX != null) r1.textContent = d.rolloverX; const c1 = _el('infoMsCap'); if (c1 && d.maxRewardPct != null) c1.textContent = d.maxRewardPct; const mine = _el('infoMsMine'); if (mine) { if (nv) { mine.style.display = ''; mine.innerHTML = '<b>Vos hoy:</b> nivel ' + _esc(nivelTxt) + ' · ' + done + ' de ' + ms.length + ' cumplidas esta semana' + (nv.next ? ' · si completás todas pasás a ' + _esc(nv.next.emoji + ' ' + nv.next.name) : '') + '. Premios de tu nivel: ' + ms.map((m) => _m$(m.rewardArs)).join(' · ') + '.'; } else mine.style.display = 'none'; } } catch (_) {}
        const msub = _el('missionsSub'); if (msub && d.weekEndsAt) msub.textContent = 'Lunes a domingo · termina el ' + new Date(d.weekEndsAt).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' }) + ' · el premio se acredita solo' + (d.rolloverX > 0 ? ' y se juega x' + d.rolloverX + ' antes de retirarlo' : '');
    }
    async function loadStrategy(force) {
        const tok = VIP.state && VIP.state.currentToken; if (!tok) return;
        if (!force && Date.now() - _stAt < 90000) { _stPaint(); return; } _stAt = Date.now();
        try { const r = await fetch(VIP.config.API_URL + '/api/strategy/me', { headers: { Authorization: 'Bearer ' + tok } }); if (r.ok) _stData = await r.json(); } catch (_) {}
        _stPaint();
    }
    // #508: en el home completo la tarjeta de misiones arranca PLEGADA (no tapa la carga); se recuerda si la abrió.
    function toggleMissionsCard(force) {
        const body = _el('missionsCardBody'), head = document.querySelector('#missionsCard .ms-card-h'); if (!body) return;
        const open = typeof force === 'boolean' ? force : body.hidden; body.hidden = !open; body.style.display = ''; if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false'); // #629
        try { localStorage.setItem('vip_ms_open', open ? '1' : '0'); } catch (_) {}
    }
    function openMissions() { loadStrategy(true); try { VIP.ui.showModal('missionsModal'); } catch (_) { const m = _el('missionsModal'); if (m) m.classList.remove('hidden'); } }
    // #488: cartel BONO DE PRIMERA CARGA al entrar (quien no cargó nunca), una vez por sesión, después de elegir el menú.
    let _fdShown = false, _fdPromoP = null;
    // #490: la promo de primera carga se consulta una vez por sesión y la usan el cartel y la etiqueta "+X% en tu primera carga" del botón CARGAR AHORA
    function _fdPromoLoad() { const p = _fdPromoLoad0(); try { p.then((j) => { try { if (j && j.noDeposits === false) localStorage.setItem(HAS_DEP_KEY, '1'); else if (j && j.noDeposits === true) localStorage.removeItem(HAS_DEP_KEY); } catch (_) {} }); } catch (_) {} return p; } // #980
    function _fdPromoLoad0() { if (_fdPromoP) return _fdPromoP; const tok = VIP.state && VIP.state.currentToken; if (!tok) return Promise.resolve(null); _fdPromoP = fetch(VIP.config.API_URL + '/api/first-deposit-promo', { headers: { Authorization: 'Bearer ' + tok } }).then((r) => r.json()).catch(() => null); return _fdPromoP; }
    // #626 (owner): el aviso de PRIMERA CARGA (+pct% · +pctApp% con la app) va RESUMIDO adentro de cada lugar donde se adjunta el
    // comprobante (básico, inicio completo, carga rápida del casino), sólo mientras no hizo la primera carga. Antes era una franja arriba (#608).
    let _fdJ = null;
    // #974: el extra por instalar puede ser un monto fijo ($5.000) o un % → un solo texto para las dos formas.
    const _fdExtraTxt = (j) => { if (!j) return ''; const m = Number(j.extraMonto) || 0; if (m > 0) return '$' + m.toLocaleString('es-AR'); const e = Number(j.extra) || 0; return e > 0 ? e + '%' : ''; };
    const _fdCapTxt = (j) => { const c = Number(j && j.capArs) || 0; return c > 0 ? ' · hasta $' + c.toLocaleString('es-AR') : ''; }; // #983: el tope, siempre a la vista
    const _FD_NOTE_INNER = (pct, extra, capTxt) => '<span class="fd-l1">🎁 <b>Primera carga: +<span class="fd-pct">' + pct + '%</span> automático</b><small class="fd-cap">' + (capTxt || '') + '</small></span>' +
        '<span class="fd-app"' + (extra ? '' : ' hidden') + '>📲 Después, <b>+<span class="fd-pct-app">' + extra + '</span> EXTRA</b> instalando la app y activando las notificaciones</span>';
    function _fdNotesPaint() {
        _fdPromoLoad().then((j) => {
            _fdJ = j || null;
            const show = !!(j && j.show && Number(j.pct) > 0); const extra = show ? _fdExtraTxt(j) : ''; // #974: "$5.000" o "50%"
            try { firstGuidePaint(j); } catch (_) {} // #675
            document.querySelectorAll('.fd-note').forEach((el) => {
                el.hidden = !show; if (!show) return;
                el.querySelectorAll('.fd-pct').forEach((x) => { x.textContent = j.pct + '%'; });
                el.querySelectorAll('.fd-pct-app').forEach((x) => { x.textContent = extra; }); // #839: el EXTRA, no la suma · #974 monto o %
                el.querySelectorAll('.fd-cap').forEach((x) => { x.textContent = _fdCapTxt(j); }); // #983
                el.querySelectorAll('.fd-app').forEach((x) => { x.hidden = !extra; });
            });
        }).catch(() => {});
    }
    // #675 (owner): guía de PRIMERA CARGA en el Inicio del completo ("la gente se pierde"): cartel con flecha a CARGÁ AHORA + pulso.
    function firstGuidePaint(j) {
        const g = _el('firstGuide'), gb = _el('firstGuideBasic'), cta = _el('evCtaTop'), bl = _el('bvLoadBtn');
        let off = false; try { off = localStorage.getItem('vip_fguide_off') === '1'; } catch (_) {}
        const show = !!(j && (j.noDeposits === true || j.show)) && !off;
        if (g) g.hidden = !show; if (gb) gb.hidden = !show; // el básico tiene su versión corta (CSS muestra cada una en su modo)
        // #690 (owner): la franja grande de CARGA MÍNIMA se ve hasta la 3ª carga; después desaparece (la nota de adentro de las cargas queda)
        try { const n = j && j.depositsCount != null ? Number(j.depositsCount) : null; if (n != null) { const off = n >= 3; document.body.classList.toggle('ms-off', off); localStorage.setItem('vip_ms_off', off ? '1' : '0'); const few = n < 5; document.body.classList.toggle('fewdep', few); localStorage.setItem('vip_fewdep', few ? '1' : '0');
            // #731 (owner): sin cargas, la barra "Instalar" de la base queda FIJA (sin ✕ y aunque la haya cerrado antes)
            const nodep = n === 0; document.body.classList.toggle('nodep', nodep); localStorage.setItem('vip_nodep', nodep ? '1' : '0');
            try { _paintFirstLoad(nodep); } catch (_) {} // #766
            if (nodep && !_isStandalone()) { try { if (typeof showInstallButton === 'function') showInstallButton(); } catch (_) {} } } } catch (_) {} // #706: fewdep = hasta la 5ª carga (botón Adjuntar llamativo con la carga mínima)
        if (cta) cta.classList.toggle('fg-hi', show); if (bl) bl.classList.toggle('fg-hi', show);
    }
    function firstGuideClose() { try { localStorage.setItem('vip_fguide_off', '1'); } catch (_) {} ['firstGuide', 'firstGuideBasic'].forEach((id) => { const g = _el(id); if (g) g.hidden = true; }); ['evCtaTop', 'bvLoadBtn'].forEach((id) => { const b = _el(id); if (b) b.classList.remove('fg-hi'); }); }
    function _fdNoteHtml() {
        const j = _fdJ; if (!(j && j.show && Number(j.pct) > 0)) return '<p class="fd-note" hidden></p>';
        const extra = _fdExtraTxt(j); // #974
        // #839 (owner): "no es 150% si instalás: es 100% por la primera carga y el 50% EXTRA después de la carga, instalando la app y activando
        // las notificaciones (que exija esos 2 pasos)". Dos líneas claras; nunca la suma.
        return '<p class="fd-note">' + _FD_NOTE_INNER(j.pct, extra, _fdCapTxt(j)) + '</p>';
    }
    async function maybeFirstDepositPopup() {
        if (_fdShown) return; try { if (sessionStorage.getItem('vip_fd_seen')) return; } catch (_) {}
        const tok = VIP.state && VIP.state.currentToken; if (!tok) return;
        _fdShown = true;
        try {
            const j = await _fdPromoLoad();
            if (!j || !j.show) return;
            const p = _el('fdPct'), pa = _el('fdPctApp'), ap = _el('fdApp'), tx = _el('fdTxt');
            if (p) p.textContent = j.pct + '%'; if (pa) pa.textContent = '+' + (_fdExtraTxt(j) || '0%') + ' EXTRA'; // #839 · #974
            try { document.querySelectorAll('#fdModal .fd-cap').forEach((x) => { x.textContent = _fdCapTxt(j); }); } catch (_) {} // #983 if (ap) ap.style.display = j.installGiftEnabled ? '' : 'none'; if (tx) tx.textContent = j.text || '';
            try { sessionStorage.setItem('vip_fd_seen', '1'); } catch (_) {}
            VIP.ui.showModal('fdModal');
        } catch (_) {}
    }
    function fdClose() { try { VIP.ui.hideModal('fdModal'); } catch (_) { const m = _el('fdModal'); if (m) m.classList.add('hidden'); } }
    function fdGo() { fdClose(); try { easyLoad(); } catch (_) { setHomeMode('full'); } }
    function openMenuChooser() {
        const m = _el('menuChooser'); if (!m) return;
        // #795 (owner): el recuadro marcado es el menú ACTUAL (antes el CSS marcaba siempre "Menú completo").
        try {
            let cur = null; try { cur = localStorage.getItem('vip_menu_pref'); } catch (_) {}
            const b = document.body.classList;
            if (!cur || !['full', 'girox', 'basic', 'easy'].includes(cur)) cur = b.contains('home-basic') ? 'basic' : (b.contains('home-easy') ? 'easy' : (b.contains('home-play') ? 'girox' : 'full'));
            if (b.contains('home-basic')) cur = 'basic'; else if (b.contains('home-easy')) cur = 'easy'; else if (b.contains('home-full')) cur = 'full';
            m.querySelectorAll('.mc-opt').forEach((o) => o.classList.toggle('is-cur', o.classList.contains('mc-' + cur)));
        } catch (_) {}
        m.classList.add('open'); document.body.classList.add('mc-open');
    }
    function closeMenuChooser() {
        const m = _el('menuChooser'); if (!m) return;
        m.classList.remove('open'); document.body.classList.remove('mc-open');
    }
    // #367 (owner): se pregunta SIEMPRE al entrar (cada arranque de la app) y de nuevo si la persona se fue y
    // volvió después de 10 minutos en segundo plano. La preferencia guardada sólo define dónde arranca mientras tanto.
    const MENU_REASK_MS = 10 * 60 * 1000;
    let _hiddenAt = 0;
    function maybeShowMenuChooser() {
        // #704 (owner): entrada desde la landing (`ir=girox`) → directo a la pantalla de Girox; el menú lo elige después desde "Menú".
        if (VIP.state && VIP.state._openGiroxAfterLogin) { VIP.state._openGiroxAfterLogin = false; setMenuPref('girox', { quiet: true, auto: true }); return; }
        const only = MENU_ORDER.filter(_menuOn); if (only.length === 1) { setMenuPref(only[0], { quiet: true, auto: true }); return; } // #635: un solo menú activo → directo
        const pref = getMenuPref();
        if (pref === 'easy' && _homeMode !== 'easy') setHomeMode('easy', { persist: false });
        if (_isInstalledApp() && _menuOn('girox') && _hasDeposit()) { setMenuPref('girox', { quiet: true, auto: true }); return; } // #937: app instalada ⇒ Girox directo siempre · #980: desde la 1ª carga
        if (isMenuFixed() && pref) { setHomeMode(_modeFor(pref)); _afterPref(pref); return; } // #559: preseleccionado → entra directo · #670
        if (pref && _userPickedMenu()) { setHomeMode(_modeFor(pref)); _afterPref(pref); return; } // #836: el menú que eligió la persona
        // #733 (owner): "el menú seleccionado para todos (landing o común) cuando abran la app sea el de Girox, y después lo pueden cambiar
        // desde Menú; la idea es que todos entren directo a cargar". Sin menú fijo → Girox directo, sin selector (si ese menú está activo).
        if (_menuOn(_defaultPref())) { setMenuPref(_defaultPref(), { quiet: true, auto: true }); return; } // #980: completo hasta la 1ª carga, Girox después
        setTimeout(openMenuChooser, 350);
    }
    // #559 (owner): "Dejar preseleccionado para el ingreso" al lado de Cambiar menú. Guarda el menú actual como preferencia
    // y marca que NO se pregunte más al entrar (ni al volver tras 10 min). Tocar de nuevo lo deshace.
    function _prefOfMode() { return _homeMode === 'basic' ? 'basic' : (_homeMode === 'easy' ? 'easy' : (_curPref === 'girox' ? 'girox' : 'full')); } // #670
    function _paintMenuPin() {
        const b = _el('menuPinBtn'), t = _el('menuPinTxt'); if (!b || !t) return;
        const on = isMenuFixed() && getMenuPref() === _prefOfMode();
        b.classList.toggle('on', on);
        const nm = _homeMode === 'basic' ? 'básico' : (_homeMode === 'easy' ? 'intermedio' : (_curPref === 'girox' ? 'Girox directo' : 'completo')); // #670
        t.textContent = on ? ('✓ Menú ' + nm + ' fijo para el ingreso · tocá para deshacer') : ('Dejar fijo el menú ' + nm + ' para el ingreso');
    }
    function toggleMenuPin() {
        const on = isMenuFixed() && getMenuPref() === _prefOfMode();
        try {
            if (on) { localStorage.removeItem(MENU_FIXED_KEY); VIP.ui.showToast('Listo: al entrar te volvemos a preguntar qué menú querés.', 'info'); }
            else { localStorage.setItem(MENU_PREF_KEY, _prefOfMode()); localStorage.setItem(MENU_FIXED_KEY, '1'); VIP.ui.showToast('Listo: este menú queda preseleccionado para cuando entrás.', 'success'); }
        } catch (_) {}
        _paintMenuPin();
        setTimeout(installManifestSync, 300); // #673
    }
    function _menuReaskInit() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { _hiddenAt = Date.now(); return; }
            const away = _hiddenAt ? Date.now() - _hiddenAt : 0;
            _hiddenAt = 0;
            const logged = VIP.state && VIP.state.currentToken && !(_el('chatScreen') || {}).classList?.contains('hidden');
            // #836: ya no se vuelve a preguntar el menú al volver de segundo plano (sigue donde estaba; se cambia desde "Menú").
            void away; void logged;
        });
    }
    function easyLoad() { setHomeMode('full'); }
    // #470 (owner): "Ver la plataforma" abre un selector: Girox · Ganamos (Pronto) · Jugaygana (Pronto).
    function easyPlay() {
        const box = _el('easyPlatList'); if (!box) { openPlatform(_entryPlat || 'girox'); return; }
        const defId = (_platforms && _platforms.defaultPlatform) || 'girox';
        const list = _entryList();
        const soon = (p) => p.connected === false && p.id !== defId && p.id !== 'girox';
        const nm = (n) => (/^jugaygana$/i.test(String(n || '')) ? 'Jugaygana' : String(n || ''));
        box.innerHTML = list.map((p) => '<button type="button" class="ep-item ep-' + _esc(p.id) + (soon(p) ? ' soon' : '') + '" onclick="VIP.home.easyPlayPick(\'' + _esc(p.id) + '\',' + (soon(p) ? 'true' : 'false') + ')">' + (p.logoUrl ? '<img src="' + _esc(p.logoUrl) + '" alt="">' : '<i>' + _esc(p.emoji || '🎰') + '</i>') + '<span><b>' + _esc(nm(p.name)) + '</b><small>' + (soon(p) ? 'Pronto' : 'Entrás con tu usuario') + '</small></span><em>' + (soon(p) ? 'Pronto' : '›') + '</em></button>').join('');
        try { VIP.ui.showModal('easyPlatModal'); } catch (_) { const m = _el('easyPlatModal'); if (m) m.classList.remove('hidden'); }
    }
    function easyPlayPick(id, isSoon) {
        if (isSoon) { try { VIP.ui.showToast('Pronto: esta plataforma se habilita en breve', 'info'); } catch (_) {} return; }
        try { VIP.ui.hideModal('easyPlatModal'); } catch (_) { const m = _el('easyPlatModal'); if (m) m.classList.add('hidden'); }
        openPlatform(id || 'girox');
    }
    // Pinta el menú fácil con datos reales: usuario, saldo (espejo de #userBalance), % de reembolso por período
    // (escalera real del server, nada hardcodeado), plata reclamable y % de referidos.
    // #480: opción de menú elegida en el panel (1 = actual, 2 = barra inferior). Se lee una vez por sesión (y al volver al Inicio).
    let _menuLayoutAt = 0, _navPh = null;
    // #481: opción 2 = los botones Carga auto · Inicio · Soporte (con sus separadores) pasan de la barra de arriba a #bottomNav,
    // un <header> con las mismas clases al final de #chatScreen (columna flex: queda abajo de todo, debajo del chat también).
    // Se dejan comentarios-marcador para devolverlos a su lugar exacto si se vuelve a la opción 1.
    function _setMenuLayout(layout) {
        const on = Number(layout) === 2; document.body.classList.toggle('menu2', on);
        try { localStorage.setItem('vip_menu_layout', on ? '2' : '1'); document.documentElement.classList.remove('menu2-pre'); } catch (_) {} // #638: se recuerda para aplicarlo al instante la próxima vez
        const top = document.querySelector('.header.header-toolbar.tb-circles.topnav'); const screen = _el('chatScreen'); if (!top || !screen) return;
        // #558 (owner): abajo van Carga auto · Inicio · PERFIL; Soporte queda arriba, en el lugar que tenía Perfil (antes de Historias).
        const auto = _el('navAuto'), ini = _el('navInicio'), man = _el('navManual'), perf = _el('navPerfil'), hist = _el('navHistorias'), plat = _el('navPlat'); // #620
        let bar = _el('bottomNav');
        if (on) {
            if (bar) return;
            const seps = Array.from(top.querySelectorAll('.tn-sep')).slice(0, 2);
            const menuB = _el('navMenu'); // #644 (owner): abajo van CAMBIAR MENÚ · Inicio · Perfil (Carga auto ya no va abajo: queda oculta con menú 2)
            const nodes = [menuB, seps[0], ini, seps[1], perf].filter(Boolean);
            _navPh = nodes.concat(man ? [man] : []).map((n) => { const ph = document.createComment('nav-ph'); n.parentNode.insertBefore(ph, n); return { n, ph }; });
            bar = document.createElement('header'); bar.id = 'bottomNav'; bar.className = top.className + ' bottom-nav'; bar.setAttribute('aria-label', 'Menú inferior');
            nodes.forEach((n) => bar.appendChild(n)); screen.appendChild(bar);
            if (man && hist && hist.parentNode === top) top.insertBefore(man, hist);
            if (plat && man && man.parentNode === top) top.insertBefore(plat, man); // #621 (owner): PLATAFORMA en el centro de la barra superior
        } else if (bar) {
            (_navPh || []).forEach(({ n, ph }) => { if (ph.parentNode) ph.parentNode.replaceChild(n, ph); }); _navPh = null; bar.remove();
        }
    }
    async function _applyMenuLayout() {
        if (Date.now() - _menuLayoutAt < 120000) return; _menuLayoutAt = Date.now();
        try { const r = await fetch(VIP.config.API_URL + '/api/public/menu-layout'); const j = await r.json(); _setMenuLayout(j && j.layout); if (j && j.menus) _applyMenusEnabled(j.menus); } catch (_) {} // #635
    }
    function _easyPaint() {
        const v = _el('easyView'); if (!v) return;
        _applyMenuLayout();
        try { const u = VIP.state && VIP.state.currentUser && VIP.state.currentUser.username; const h = _el('easyHello'); if (h) h.textContent = u ? ('Hola, ' + u) : 'Hola'; } catch (_) {}
        try { const b = _el('userBalance'), eb = _el('easyBalance'); if (b && eb && b.textContent) eb.textContent = b.textContent; } catch (_) {}
        try {
            const s = VIP.state && VIP.state.refundStatus;
            const mx = (ts) => (ts || []).reduce((m, t) => (t && t.pct > m ? t.pct : m), 0);
            if (s && (s.tiersByPeriod || s.tiers)) {
                const tbp = s.tiersByPeriod || { weekly: s.tiers, monthly: s.tiers };
                const parts = [];
                // #447 (owner): sólo el % del DIARIO; semanal y mensual se nombran sin número.
                if (mx(tbp.daily)) parts.push('Diario ' + mx(tbp.daily) + '%');
                if (mx(tbp.weekly)) parts.push('semanal');
                if (mx(tbp.monthly)) parts.push('mensual');
                const el = _el('easyRefundSub'); if (el && parts.length) el.textContent = parts.join(' · ') + ' de tu NETWIN'; // #458
                let claim = 0;
                ['daily', 'weekly', 'monthly'].forEach((k) => { const d = s[k]; if (d && d.canClaim && Number(d.potentialAmount) > 0) claim += Number(d.potentialAmount); });
                const bd = _el('easyRefundBadge');
                if (bd) { if (claim > 0) { bd.textContent = '¡Tenés $' + Math.round(claim).toLocaleString('es-AR') + ' para cobrar!'; bd.style.display = ''; } else bd.style.display = 'none'; }
            }
        } catch (_) {}
        if (!_easyRefLoaded && VIP.state && VIP.state.currentToken) {
            _easyRefLoaded = true;
            try {
                fetch(VIP.config.API_URL + '/api/referrals/me', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((me) => { if (me && me.referralPct != null) document.querySelectorAll('.ref-pct').forEach((el) => { el.textContent = me.referralPct; }); })
                    .catch(() => {});
            } catch (_) {}
        }
    }
    // ---------------- #268: PERFIL ----------------
    let _pfShown = true; // #393 (owner): la clave se muestra siempre (el botón "Ocultar" sigue)
    let _pfRefCode = null;
    function _pfPaintCode() { // #393: código de referido debajo del nombre
        const box = _el('pfUserCode'), v = _el('pfUserCodeV');
        if (!box || !v) return;
        if (_pfRefCode) { v.textContent = _pfRefCode; box.style.display = ''; return; }
        if (!VIP.state || !VIP.state.currentToken) return;
        fetch(VIP.config.API_URL + '/api/referrals/me', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } })
            .then((r) => (r.ok ? r.json() : null))
            .then((me) => { if (me && me.referralCode) { _pfRefCode = String(me.referralCode); v.textContent = _pfRefCode; box.style.display = ''; } })
            .catch(() => {});
    }
    function _pfPaint() {
        _pfPaintCode();
        const u = (VIP.state && VIP.state.currentUser && VIP.state.currentUser.username) || '—';
        const pw = (VIP.autoload && VIP.autoload.getPassword && VIP.autoload.getPassword()) || '';
        const eu = _el('pfUser'), ep = _el('pfPass'), eye = _el('pfEye'), hint = _el('pfHint');
        if (eu) eu.textContent = u;
        try { const el = _el('pfLink'); if (el) el.textContent = (VIP.autoload && VIP.autoload.appLink && VIP.autoload.appLink()) || (location.origin + '/'); } catch (_) {}
        if (ep) ep.textContent = pw ? (_pfShown ? pw : '•'.repeat(Math.min(12, Math.max(6, pw.length)))) : 'no guardada';
        if (eye) { eye.textContent = _pfShown ? 'Ocultar' : 'Ver'; eye.style.display = pw ? '' : 'none'; }
        if (hint) {
            hint.textContent = !pw ? 'Tu clave no está guardada en este dispositivo. Si la cambiás desde acá, queda guardada.'
                : (pw === 'asd123' ? 'Es la clave inicial: te recomendamos cambiarla desde "Cambiar clave".' : 'Es la misma clave para entrar a la app y a las plataformas.');
        }
    }
    // #645 (owner): Perfil — estado de la verificación de teléfono y de las notificaciones
    function paintPfPhone() {
        try {
            const u = (VIP.state && VIP.state.currentUser) || {}; const ok = u.phoneVerified === true;
            const h = _el('pfPhoneHint'), b = _el('pfPhoneBtn'); if (!h || !b) return;
            h.textContent = ok ? ('Verificado ✓ · ' + (u.phone || '')) : 'Sin verificar · necesaria para retirar';
            // #767: franja arriba de todo del Perfil
            // #783 (owner): saldo al lado del nombre en el recuadro de usuario (la franja de arriba y el cartel de SMS de #767 se sacaron)
            try { const bal = _el('pfUserBal'), ub = _el('userBalance'); if (bal && ub) bal.textContent = ub.textContent || '$0'; } catch (_) {}
            try { const bm = _el('pfBuildMini'), bt = _el('appBuildTag'); if (bm && bt) bm.textContent = bt.textContent; } catch (_) {} // #790
            b.textContent = ok ? '✓ Verificado' : 'Verificar'; b.classList.toggle('ok', ok);
            const row = _el('pfPhoneRow'), imp = _el('pfPhoneImp'); if (row) row.classList.toggle('pf-important', !ok); if (imp) imp.hidden = ok; // #646 b.title = ok ? 'Tu número ya está verificado. Tocá para cambiarlo.' : 'Verificar mi número';
        } catch (_) {}
    }
    function paintPfNotif() {
        try {
            const h = _el('pfNotifHint'); if (!h) return;
            const perm = ('Notification' in window) ? Notification.permission : 'default';
            h.textContent = perm === 'granted' ? 'Activadas ✓ · si no te llegan, tocá Activar de nuevo' : (perm === 'denied' ? 'Bloqueadas en el teléfono · tocá Activar para ver cómo' : 'Tocá Activar y aceptá el permiso');
        } catch (_) {}
    }
    // #648 (owner): ayudante de la verificación — provincia/ciudad → código de área y cómo completar el número (+54 9 + área sin 0 + número)
    const VP_AREAS = [['Buenos Aires (CABA y GBA)', '11'], ['La Plata', '221'], ['Mar del Plata', '223'], ['Bahía Blanca', '291'], ['Tandil', '249'], ['Junín', '236'], ['Pergamino', '2477'], ['Olavarría', '2284'],
        ['Córdoba capital', '351'], ['Río Cuarto', '358'], ['Villa María', '353'], ['Rosario', '341'], ['Santa Fe capital', '342'], ['Mendoza', '261'], ['San Rafael', '260'], ['Tucumán', '381'], ['Salta', '387'], ['Jujuy', '388'],
        ['Neuquén', '299'], ['Bariloche', '294'], ['Comodoro Rivadavia', '297'], ['Trelew / Rawson', '280'], ['Corrientes', '379'], ['Resistencia (Chaco)', '362'], ['Posadas (Misiones)', '376'], ['Paraná', '343'], ['Concordia', '345'],
        ['San Juan', '264'], ['San Luis', '266'], ['Santiago del Estero', '385'], ['Catamarca', '383'], ['La Rioja', '380'], ['Formosa', '370'], ['Santa Rosa (La Pampa)', '2954'], ['Viedma', '2920'], ['Río Gallegos', '2966'], ['Ushuaia', '2901']];
    function _vpFill() { const sel = _el('vpArea'); if (!sel || sel.options.length > 1) return; VP_AREAS.forEach(([n, c]) => { const o = document.createElement('option'); o.value = c; o.textContent = n + ' · ' + c; sel.appendChild(o); }); }
    function vpHelpToggle(force) { _vpFill(); const b = _el('vpHelpBody'); if (!b) return; b.hidden = typeof force === 'boolean' ? !force : !b.hidden; }
    function vpHelpOpen() { vpHelpToggle(true); }
    function vpAreaPick(code) {
        const h = _el('vpHelpHint'), inp = _el('verifyPhoneInput'); if (!code) { if (h) h.textContent = ''; return; }
        const rest = 10 - code.length; const ej = code === '11' ? '1155551234' : (code.length === 3 ? code + '5551234' : code + '551234');
        if (h) h.innerHTML = 'Tu número: <b>+54 9 ' + code + '</b> + tus <b>' + rest + ' dígitos</b> seguidos, sin espacios (sin el 0 ni el 15). Ej.: <b>' + ej + '</b>';
        if (inp) { inp.value = code; try { inp.focus(); inp.setSelectionRange(code.length, code.length); } catch (_) {} } // #652: de corrido, sin espacio
    }
    function openVerifyPhone() {
        try { const b = _el('vpHelpBody'); if (b) b.hidden = true; const h = _el('vpHelpHint'); if (h) h.textContent = ''; } catch (_) {}
        try { VIP.ui.hideModal('profileModal'); } catch (_) {}
        try {
            const s1 = _el('verifyPhoneStep1'), s2 = _el('verifyPhoneStep2'), inp = _el('verifyPhoneInput'), err = _el('verifyPhoneError');
            if (s1) s1.style.display = ''; if (s2) s2.style.display = 'none'; if (inp) inp.value = ''; if (err) err.classList.remove('show');
        } catch (_) {}
        try { VIP.ui.showModal('verifyPhoneModal'); } catch (_) { const m = _el('verifyPhoneModal'); if (m) m.classList.remove('hidden'); }
    }
    // #971 (owner): "activar el desactivar notificaciones para la gente que no quiere recibir pero sí tener la app" ⇒ en vez de apagar
    // las del teléfono (y perder el canal), elige cuánto le escribimos: todos / sólo lo mío / ninguno (Soporte y sus cargas siempre).
    function _pfAvisosHint(v) { const h = _el('pfAvisosHint'); if (h) h.textContent = v === 'none' ? 'Sólo Soporte y tus cargas y retiros' : v === 'mine' ? 'Tu reembolso, regalos para vos y sorteos; nada masivo' : 'Bonos del día, novedades y todo lo tuyo'; }
    function paintPfAvisos() {
        const sel = _el('pfAvisosSel'); if (!sel) return;
        if (VIP.state && VIP.state.notifLevel) { sel.value = VIP.state.notifLevel; _pfAvisosHint(sel.value); return; }
        if (!(VIP.state && VIP.state.currentToken)) return;
        fetch(VIP.config.API_URL + '/api/notifications/prefs', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } }).then((r) => r.json()).then((j) => { if (j && j.level) { VIP.state.notifLevel = j.level; sel.value = j.level; _pfAvisosHint(j.level); } }).catch(() => {});
    }
    async function setNotifLevel(v) {
        try {
            const r = await fetch(VIP.config.API_URL + '/api/notifications/prefs', { method: 'POST', headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ level: v }) });
            const j = await r.json(); if (!(j && j.success)) throw new Error(j && j.error || 'error');
            VIP.state.notifLevel = j.level; _pfAvisosHint(j.level); try { VIP.ui.showToast('Listo, guardado ✓'); } catch (_) {}
        } catch (_) { try { VIP.ui.showToast('No se pudo guardar, probá de nuevo', 'error'); } catch (__) {} paintPfAvisos(); }
    }
    function openProfile() {
        paintPfPhone(); paintPfNotif(); paintPfAvisos(); // #645 · #971
        _pfShown = true; // #393
        try { if (VIP.autoload && VIP.autoload.hidePreview) VIP.autoload.hidePreview(); } catch (_) {}
        _pfPaint();
        try { _paintAvatar(); } catch (_) {} // #304
        try { VIP.ui.showModal('profileModal'); } catch (_) { const m = _el('profileModal'); if (m) m.classList.remove('hidden'); }
    }
    function profileTogglePw() { _pfShown = !_pfShown; _pfPaint(); }
    function profileCopy(which) {
        const v = which === 'pass' ? ((VIP.autoload && VIP.autoload.getPassword && VIP.autoload.getPassword()) || '')
            : which === 'code' ? (_pfRefCode || '')
            : which === 'link' ? ((VIP.autoload && VIP.autoload.appLink && VIP.autoload.appLink()) || (location.origin + '/'))
            : ((VIP.state && VIP.state.currentUser && VIP.state.currentUser.username) || '');
        if (!v) { try { VIP.ui.showToast('No hay nada para copiar', 'info'); } catch (_) {} return; }
        try { VIP.ui.copyText(v); } catch (_) { try { navigator.clipboard.writeText(v); } catch (__) {} }
    }
    function _initHomeMode() {
        // #307 (owner): al entrar SIEMPRE arranca en Inicio; desde ahí van a Carga auto / manual. (Antes se
        // recordaba el último modo dentro de la sesión: ya no.)
        // #366: salvo que haya elegido el MENÚ FÁCIL (localStorage vip_menu_pref): entonces arranca ahí.
        _paintBsUser(); // #636
        try { if (localStorage.getItem('vip_ms_off') === '1') document.body.classList.add('ms-off'); } catch (_) {} // #690: sin parpadeo
        try { if (localStorage.getItem('vip_fewdep') !== '0') document.body.classList.add('fewdep'); } catch (_) {} // #706: por defecto llamativo hasta saber las cargas
        try { if (localStorage.getItem('vip_nodep') === '1') document.body.classList.add('nodep'); } catch (_) {} // #731
        try { const cl = localStorage.getItem('vip_menu_layout'); if (cl) _setMenuLayout(Number(cl)); } catch (_) {} // #638: menú 1/2 del caché, sin esperar al server
        _applyMenusEnabled(); _applyMenuLayout(); // #635: menús activos (cacheados al instante, refrescados del server)
        const m = _modeFor(((_userPickedMenu() || isMenuFixed()) && !(_isInstalledApp() && _menuOn('girox') && _hasDeposit())) || !_menuOn('girox') ? getMenuPref() : _defaultPref()); // #512 · #836 · #937 · #980: completo hasta la 1ª carga
        try { sessionStorage.removeItem(HOME_MODE_KEY); } catch (_) {}
        _bindEntryFrame();
        setHomeMode(m, { persist: false });
        _curPref = getMenuPref(); // #670 (si el menú está fijo, maybeShowMenuChooser abre Girox directo)
        try { const c = localStorage.getItem(HOME_BANNER_KEY); if (c) _paintHomeBanner(JSON.parse(c)); } catch (_) {}
        _mirrorHeadBits();
        _watchHeadBits();
        setTimeout(installManifestSync, 1500); // #673
    }
    // Cartel: el texto ya viene renderizado del server ({pct} resuelto). text === null ⇒ vaciado en
    // COMANDOS → sólo el título. El "N%" se resalta en verde.
    // #349: cartel NOVEDAD del Inicio (texto /sys_entry_news; sin texto o sin % diario → se oculta).
    // #376: franja "⏳ Carga pendiente" (carga automática y Menú fácil) mientras un comprobante espera acreditación.
    let _pendTimer = null;
    async function refreshPendingDeposits() {
        if (!VIP.state || !VIP.state.currentToken) return;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/deposits/pending', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } });
            if (!r.ok) return;
            const j = await r.json(); const items = Array.isArray(j.items) ? j.items : [];
            document.querySelectorAll('.dep-pending-strip').forEach((el) => {
                if (!items.length) { el.hidden = true; return; }
                const it = items[0]; const amt = Number(it.amount) > 0 ? '$' + Number(it.amount).toLocaleString('es-AR') : '';
                el.innerHTML = '<span class="dps-ico">⏳</span><span class="dps-t"><b>Carga pendiente' + (amt ? ' · ' + amt : '') + (items.length > 1 ? ' (+' + (items.length - 1) + ')' : '') + '</b><small>' +
                    (it.escalated ? 'Un agente la está verificando · te avisamos en Soporte' : 'En verificación · se acredita sola en minutos') + '</small></span>';
                el.hidden = false;
            });
        } catch (_) {}
        clearInterval(_pendTimer);
        _pendTimer = setInterval(() => { if (!document.hidden) refreshPendingDeposits(); }, 60 * 1000);
    }
    // #373: SOPORTE — presentación de la persona (nombre / texto / plazo), textos de COMANDOS vía /api/platforms.
    function _paintSupportIntro(si) {
        if (!si) return;
        try {
            const nm = (si.name || '').trim(), tx = (si.text || '').trim(), sla = (si.sla || '').trim();
            const n = _el('spName'); if (n && nm) n.textContent = nm;
            const m = _el('spMsg'); if (m && tx) m.textContent = tx;
            const s = _el('spSla'); if (s) { s.textContent = sla ? ('⏱ ' + sla) : ''; s.style.display = sla ? '' : 'none'; }
            const st = _el('waHeadStatus'); if (st) st.textContent = nm ? (nm + ' · en línea' + (sla ? ' · ' + sla.toLowerCase() : '')) : 'en línea';
        } catch (_) {}
    }
    // #384 (owner): los chips MANDAN el mensaje solos. 'cargar' / 'retirar' reciben respuesta automática con botón al sector.
    const SUPPORT_QUICK_TEXT = { carga: '💳 Tengo un problema con una carga', retiro: '💸 Tengo un problema con un retiro', reembolso: '🎁 Tengo un problema con un reembolso', bono: '🎰 Tengo un problema con el bono', otro: '❓ Tengo un problema con otra cosa', cargar: '💳 Quiero hacer una carga', retirar: '💸 Quiero retirar mi premio' }; // #602 soporte de problemas
    function supportQuick(kind) {
        try {
            const k = SUPPORT_QUICK_TEXT[kind] ? kind : 'otro';
            const i = _el('messageInput'); if (!i) return;
            i.value = SUPPORT_QUICK_TEXT[k];
            if (VIP.chat && VIP.chat.sendMessage) VIP.chat.sendMessage(null, k);
            if (k === 'otro') { setTimeout(() => { try { i.focus(); } catch (_) {} }, 300); }
        } catch (_) {}
    }
    // #603: aviso "Chat cerrado" en el selector cuando Soporte cierra la charla; se borra al abrir un tema nuevo
    function supportClosedNotice() { try { VIP.ui.showToast('🔒 Chat cerrado por Soporte', 'info'); } catch (_) {} } // #613: el aviso fijado lo pinta chat.js con la fecha
    // #907 → #910: el resumen "Cómo funciona todo" abre un recuadro encima de todo (#spFaqModal), con scroll y cerrar (✕, botón, fondo, Esc).
    function supportFaqOpen(ev) {
        try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (_) {}
        const m = _el('spFaqModal'); if (!m) return;
        m.hidden = false;
        try { const sc = m.querySelector('.sp-faq-scroll'); if (sc) sc.scrollTop = 0; } catch (_) {}
        try { document.addEventListener('keydown', _spFaqEsc); } catch (_) {}
    }
    function supportFaqClose(ev) {
        try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (_) {}
        const m = _el('spFaqModal'); if (m) m.hidden = true;
        try { document.removeEventListener('keydown', _spFaqEsc); } catch (_) {}
    }
    function _spFaqEsc(e) { if (e && e.key === 'Escape') supportFaqClose(e); }
    function supportIntroToggle(ev) {
        try { if (ev && ev.target && ev.target.closest && ev.target.closest('button, details')) return; } catch (_) {} // #900: el resumen se abre sin plegar la presentación
        const el = _el('supportIntro'); if (!el) return;
        if (document.body.classList.contains('sp-sent')) el.classList.toggle('sp-open');
    }
    // #372: aviso "promoción hasta diciembre" de los reembolsos → todos los .refund-promo (Info, modales, Menú fácil, home).
    function _paintRefundPromo(text) {
        const t = (text == null) ? '' : String(text).trim();
        document.querySelectorAll('.refund-promo').forEach((el) => { el.textContent = t; el.hidden = !t; });
    }
    function _paintEntryNews(en) {
        const el = document.getElementById('evHeroNew');
        if (!el) return;
        if (!en || !en.text) { el.hidden = true; return; }
        const pct = Number(en.pct) || 0;
        const safe = String(en.text).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
        el.innerHTML = pct > 0 ? safe.replace(pct + '%', '<b>' + pct + '%</b>') : safe;
        el.hidden = false;
    }

    function _paintHomeBanner(hb) {
        const msg = _el('serviceBannerMsg');
        if (!msg || !hb || typeof hb !== 'object') return;
        // #267: el % también va en el botón "Carga automática" de la pantalla de entrada.
        try { const ap = _el('evAutoSub'); if (ap && hb.pct != null && hb.pct !== '') ap.textContent = hb.pct + '% en todas tus cargas'; } catch (_) {}
        if (hb.text === null || hb.text === '') { msg.style.display = 'none'; return; }
        msg.innerHTML = _esc(hb.text).replace(/(\d+(?:[.,]\d+)?\s?%)/g, '<em>$1</em>');
        msg.style.display = '';
    }
    // La cabecera WhatsApp copia lo que ya pintan otros módulos: ícono ☀️/🌙 (app.js en #themeToggleBtn),
    // racha del fueguito (#fireStreak) y logo del chat (#chatTopbarAvatar, lo cambia chat.js por config).
    function _mirrorHeadBits() {
        try { const t = _el('themeToggleBtn'), w = _el('waThemeBtn'); if (t && w && t.textContent) w.textContent = t.textContent; } catch (_) {}
        try { const src = _el('fireStreak'), dst = _el('waFireStreak'); if (src && dst) { dst.textContent = src.textContent; dst.style.display = src.style.display; } } catch (_) {}
        // #271: recuadro "Fueguito diario" de la carga automática (racha + si hay premio para reclamar).
        try {
            const src = _el('fireStreak'), fh = _el('fireHomeStreak'), card = _el('fireHomeCard'), sub = _el('fireHomeSub');
            const st = VIP.state && VIP.state.fireStatus;
            if (src && fh) fh.textContent = src.textContent || '0';
            if (card) card.classList.toggle('can-claim', !!(st && st.canClaim));
            if (sub && st) sub.textContent = st.canClaim ? '¡Tenés premio para reclamar!' : 'Ya reclamaste hoy · volvé mañana';
            _paintFireLevels(st); // #291
        } catch (_) {}
        // #305: el avatar de la cabecera es el asistente fijo (ya no se espeja el logo de #chatTopbarAvatar).
    }
    // #291: barra con los niveles de fueguito (hitos) + regla de cargas mínimas en el plazo.
    function _paintFireLevels(st) {
        const fill = _el('fireHomeFill'), dots = _el('fireHomeDots'), rule = _el('fireHomeRule');
        // #340: la regla de cargas mínimas se pinta aunque no haya barra (tarjeta simple del home).
        // #405: regla por MONTO (requisito del próximo premio); el mínimo por cantidad sólo si el panel lo tiene > 0.
        const _fmtA = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
        const _reqA = Number(st && st.nextReqAmount) || 0, _reqD = Number(st && st.nextReqDays) || 0, _reqH = Number(st && st.nextReqHave) || 0, _reqDay = Number(st && st.nextReqDay) || 0;
        if (rule && st) {
            const min = Number(st.minDeposits) || 0;
            const _rN = Number(st.rolloverNeed) || 0, _rH = Number(st.rolloverHave) || 0, _rD = Number(st.rolloverForDay) || 0; // #654
            if (_rN > 0) { rule.innerHTML = '🎯 Premio del día ' + _rD + ': rollover <b>' + _fmtA(_rN) + '</b> (apostado en la plataforma, no cargas) · llevás <b>' + _fmtA(_rH) + '</b> · vuelve a 0 con cada premio'; rule.style.display = ''; }
            else if (min > 0) { rule.innerHTML = '⚠️ Mínimo <b>' + min + ' cargas</b> entre racha y racha · si no, vuelve a 0'; rule.style.display = ''; } // #354: una sola línea
            else if (_reqA > 0) { rule.innerHTML = '⚠️ Premio del día ' + _reqDay + ': cargá <b>' + _fmtA(_reqA) + '</b> en ' + _reqD + ' días · llevás <b>' + _fmtA(_reqH) + '</b> · si no, vuelve a 0'; rule.style.display = ''; }
            else rule.style.display = 'none';
        }
        if (!fill || !dots) return;
        const ms = (st && Array.isArray(st.milestones)) ? st.milestones.filter((m) => m && m.day > 0) : [];
        const streak = Number(st && st.streak) || 0;
        const max = ms.length ? ms[ms.length - 1].day : 30;
        fill.style.width = Math.max(0, Math.min(100, streak / max * 100)) + '%';
        dots.innerHTML = ms.map((m) => {
            const left = Math.max(0, Math.min(100, m.day / max * 100));
            const cls = m.status === 'completed' ? ' on' : (m.status === 'next' ? ' next' : '');
            const prize = m.reward ? ('$' + Math.round(Number(m.reward) / 1000) + 'k') : '';
            return '<span class="fh-dot' + cls + '" style="left:' + left + '%"><i></i><b>' + m.day + 'd</b><small>' + prize + '</small></span>';
        }).join('');
        if (rule) {
            const min = Number(st && st.minDeposits) || 0;
            if (min > 0) {
                const have = st && st.depositsCount != null ? Number(st.depositsCount) : null;
                const days = Number(st && st.depositsWindowDays) || 0;
                rule.textContent = 'Para desbloquear cada premio: mínimo ' + min + ' cargas dentro del plazo' + (days ? ' (' + days + ' días)' : '') + (have != null ? ' · llevás ' + have + '/' + min : '') + '. Si no, la racha se reinicia.';
                rule.style.display = '';
            } else if (_reqA > 0) {
                rule.innerHTML = 'Premio del día ' + _reqDay + ': cargá <b>' + _fmtA(_reqA) + '</b> en los últimos ' + _reqD + ' días · llevás <b>' + _fmtA(_reqH) + '</b>. Si no, la racha se reinicia.';
                rule.style.display = '';
            } else rule.style.display = 'none';
        }
    }
    function _watchHeadBits() {
        if (_headObs) return;
        try {
            _headObs = new MutationObserver(() => _mirrorHeadBits());
            ['fireStreak', 'themeToggleBtn', 'chatTopbarAvatar'].forEach((id) => { const n = _el(id); if (n) _headObs.observe(n, { childList: true, characterData: true, subtree: true, attributes: true }); });
        } catch (_) { _headObs = true; setInterval(_mirrorHeadBits, 2000); }
    }
    // ---------------- #267: PANTALLA DE ENTRADA (plataforma abierta adentro) ----------------
    // Antes de que responda /api/platforms (Tor es lento) se muestran Girox y Ganamos fijos con sus
    // webs públicas; después se re-renderiza con la lista real (misma URL ⇒ no se recarga el iframe).
    const ENTRY_FALLBACK = [
        { id: 'girox', name: 'Girox', playUrl: 'https://1girox.com', connected: true, logoUrl: '/images/soporte-1girox.png' },
        { id: 'ganamos', name: 'Ganamos', playUrl: 'https://www.ganamosvip.me', connected: false, logoUrl: '/images/ganamos-net.png' },
        { id: 'jugaygana', name: 'JUGAYGANA', playUrl: '', connected: false, logoUrl: '/images/jugaygana.png' } // #378
    ];
    let _entryPlat = null, _entryUrl = '', _entryTimer = null, _entryBound = false;
    function _entryList() { const l = (_platforms && _platforms.platforms) || []; return l.length ? l : ENTRY_FALLBACK; }
    // #949 (owner): "agregá un recuadro al final con el logo de Pica Roja y PICA ROJA como plataforma, Pronto" (sólo visual: no es una
    // plataforma del server; tocarla dice Pronto como Ganamos/Jugaygana).
    const PICAROJA_SOON = { id: 'picaroja', name: 'PICA ROJA', logoUrl: '/icons/icon-192x192.png', connected: false };
    function _withPicaroja(list) { return (list || []).some((p) => p && p.id === 'picaroja') ? list : (list || []).concat([PICAROJA_SOON]); }
    // ---------------- #304: AVATAR DEL PERFIL ----------------
    // (owner: "una personita tipo avatar en el nombre, que se pueda abrir y ajustar con diferentes íconos; según el
    //  nivel: nivel 1 avatar común, al avanzar el ícono del nivel que le corresponda"). La clave se guarda en el
    //  server (POST /api/me/avatar) y en localStorage; los íconos de nivel salen de la escalera VIP real.
    const AVATARS_BASE = [['persona', '👤'], ['hombre', '🧔'], ['mujer', '👩'], ['joven', '🧑'], ['incognito', '🕶️'], ['dado', '🎲'], ['carta', '🃏'], ['slot', '🎰'], ['trebol', '🍀'], ['fuego', '🔥'], ['corona', '👑'], ['rayo', '⚡']];
    let _avatar = null;
    function _avatarKey() { return 'vip_avatar_' + String((VIP.state && VIP.state.currentUser && VIP.state.currentUser.username) || '').toLowerCase(); }
    function _curLevelIdx() { const v = VIP.state && VIP.state.vipStatus; return v ? (Number(v.levelIndex) || (v.level && v.level.idx) || 0) : 0; }
    // Un ícono por tier (bronce/plata/oro/platino/diamante/black): se desbloquea al llegar al PRIMER nivel del tier.
    function _vipTiers() {
        const v = VIP.state && VIP.state.vipStatus;
        const levels = (v && Array.isArray(v.levels) && v.levels.length) ? v.levels : (_vipLevelsCache || []);
        const seen = new Map();
        for (const l of levels) { if (!seen.has(l.emoji)) seen.set(l.emoji, { key: 'lvl' + l.idx, emoji: l.emoji, name: String(l.name || '').replace(/\s+[IVX]+$/, ''), idx: l.idx, color: l.color }); }
        return Array.from(seen.values());
    }
    function _avatarOptions() {
        const cur = _curLevelIdx();
        return AVATARS_BASE.map(([key, emoji]) => ({ key, emoji, locked: false }))
            .concat(_vipTiers().map((t) => ({ key: t.key, emoji: t.emoji, name: t.name, locked: cur < t.idx, idx: t.idx, color: t.color })));
    }
    function _avatarEmoji(key) { const o = _avatarOptions().find((x) => x.key === key); return o && !o.locked ? o.emoji : null; }
    function _defaultAvatar() { const v = VIP.state && VIP.state.vipStatus; return (v && v.level && v.level.emoji) || '👤'; }
    // #448: cabecera del Menú fácil — "ver más" con usuario, nivel y código
    function easyToggleMore() {
        const box = _el('ezMore'), btn = _el('ezHelloBtn'); if (!box) return;
        const open = box.hidden; box.hidden = !open;
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (!open) return;
        const u = (VIP.state && VIP.state.currentUser && VIP.state.currentUser.username) || '—';
        const eu = _el('ezMoreUser'); if (eu) eu.textContent = u;
        const v = VIP.state && VIP.state.vipStatus; const el = _el('ezMoreLvl'); if (el) el.textContent = v && v.level ? (v.level.emoji + ' ' + v.level.name) : 'Sin nivel todavía';
        const ec = _el('ezMoreCode');
        if (ec) {
            if (_pfRefCode) ec.textContent = _pfRefCode;
            else if (VIP.state && VIP.state.currentToken) {
                ec.textContent = '…';
                fetch(VIP.config.API_URL + '/api/referrals/me', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } }).then((r) => (r.ok ? r.json() : null))
                    .then((me) => { if (me && me.referralCode) { _pfRefCode = String(me.referralCode); ec.textContent = _pfRefCode; } else ec.textContent = '—'; }).catch(() => { ec.textContent = '—'; });
            }
        }
    }
    function _paintAvatar() {
        const em = (_avatar && _avatarEmoji(_avatar)) || _defaultAvatar();
        const a = _el('pfAvatar'); if (a) a.textContent = em;
        const ea = _el('easyAvatar'); if (ea) ea.textContent = em; // #448
        const n = _el('pfUserName'); if (n) n.textContent = (VIP.state && VIP.state.currentUser && VIP.state.currentUser.username) || '—';
        const v = VIP.state && VIP.state.vipStatus;
        const lv = _el('pfUserLvl'); if (lv) { lv.textContent = v && v.level ? ('Nivel ' + v.level.emoji + ' ' + v.level.name) : 'Jugador · sin nivel todavía'; lv.style.color = (v && v.level && v.level.color) || ''; }
        const box = _el('pfUserBox'); if (box) box.style.setProperty('--pf-ring', (v && v.level && v.level.color) || '#00e5ff');
    }
    async function _avatarInit() {
        try { _avatar = localStorage.getItem(_avatarKey()) || null; } catch (_) {}
        _paintAvatar();
        if (!VIP.state || !VIP.state.currentToken) return;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/me/avatar', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j && j.avatar) { _avatar = j.avatar; try { localStorage.setItem(_avatarKey(), _avatar); } catch (_) {} _paintAvatar(); }
        } catch (_) {}
    }
    function openAvatarPicker() {
        const grid = _el('avatarGrid'); if (!grid) return;
        const cur = (_avatar && _avatarEmoji(_avatar)) ? _avatar : null;
        grid.innerHTML = _avatarOptions().map((o) =>
            '<button type="button" class="av-opt' + (o.key === cur ? ' sel' : '') + (o.locked ? ' locked' : '') + '"' +
            (o.locked ? ' title="Se desbloquea en ' + _esc(o.name || 'ese nivel') + '"' : ' onclick="VIP.home.pickAvatar(\'' + _esc(o.key) + '\')"') +
            (o.color ? ' style="--av-c:' + _esc(o.color) + '"' : '') + '>' +
            '<span class="av-e">' + o.emoji + '</span>' + (o.name ? '<small>' + _esc(o.name) + (o.locked ? ' 🔒' : '') + '</small>' : '') + '</button>').join('');
        try { VIP.ui.showModal('avatarModal'); } catch (_) { const m = _el('avatarModal'); if (m) m.classList.remove('hidden'); }
    }
    async function pickAvatar(key) {
        if (!_avatarEmoji(key)) { try { VIP.ui.showToast('🔒 Ese ícono se desbloquea subiendo de nivel', 'info'); } catch (_) {} return; }
        _avatar = key; try { localStorage.setItem(_avatarKey(), key); } catch (_) {}
        _paintAvatar();
        try { VIP.ui.hideModal('avatarModal'); } catch (_) { const m = _el('avatarModal'); if (m) m.classList.add('hidden'); }
        try { await fetch(VIP.config.API_URL + '/api/me/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (VIP.state && VIP.state.currentToken) }, body: JSON.stringify({ avatar: key }) }); } catch (_) {}
    }
    // #296: los botoncitos "test" sólo los ve el usuario de prueba (owner: "que la página quede original; el test sólo en lalodj").
    const TESTER_USERNAMES = ['lalodj', 'lalodj499910', 'diego576413', 'prueba100', 'diego651917']; // #476 · #506 · #614 · #616
    // #437 (owner): cuentas que ven "Cerrar sesión" al pie de Perfil (body.can-logout). Los testers también lo ven.
    const LOGOUT_USERNAMES = ['lalodj', 'lalodj499910', 'diego294290', 'diego576413', 'prueba100', 'diego651917']; // #505 · #614 · #616
    function _applyTesterClass() {
        const u = String((VIP.state && VIP.state.currentUser && VIP.state.currentUser.username) || '').toLowerCase();
        try { document.body.classList.toggle('can-logout', LOGOUT_USERNAMES.includes(u)); } catch (_) {}
        // #313 (owner): el usuario de prueba ve los tests también con la app INSTALADA (para probar carga, nivel, etc.
        // desde la app). El resto de los usuarios nunca los ve.
        const tester = TESTER_USERNAMES.includes(u);
        if (!tester) _installedTest = false;
        document.body.classList.toggle('is-tester', tester);
        // #708 (owner): botón flotante "🧪 Carga de prueba" para los testers, visible desde cualquier lado (también sobre el casino).
        try { let tb = _el('testDepositBtn'); if (tester && !tb) { document.body.insertAdjacentHTML('beforeend', '<div id="testDepositBtn" class="test-btns"><button type="button" class="test-dep-btn" onclick="VIP.home.testDeposit()" title="Simula una carga acreditada (sólo usuario de prueba)">🧪 Carga de prueba</button><button type="button" class="test-dep-btn test-wd-btn" onclick="VIP.home.testWithdraw()" title="Simula un pedido de retiro (sólo usuario de prueba)">🧪 Retiro de prueba</button></div>'); } else if (!tester && tb) tb.remove(); } catch (_) {} // #714: + retiro
    }
    // #885 (owner): "avisá en Info y todo que las cargas van con rollover ×3 por antifraude": `.rx-dep` / `.rx-bon` con el valor de Config.
    // Rollover de la carga en 0 ⇒ los avisos `.rx-note` se esconden (no se promete algo que no aplica).
    function _paintRollovers() {
        const d = _platforms || {}; const dx = Number(d.depositRolloverX), bx = Number(d.bonusRolloverX);
        if (Number.isFinite(dx)) { document.querySelectorAll('.rx-dep').forEach((x) => { x.textContent = '×' + dx; }); document.querySelectorAll('.rx-note').forEach((x) => { x.style.display = dx > 0 ? '' : 'none'; }); }
        if (Number.isFinite(bx)) document.querySelectorAll('.rx-bon').forEach((x) => { x.textContent = '×' + bx; });
    }
    // #299: carga mínima (Config['minDepositArs'], viene en GET /api/platforms). 0 = no se muestra.
    function _paintMinDeposit(n) {
        // #302: si el server (todavía) no manda el valor, queda el default del HTML ($2.000, #897). Sólo 0 explícito lo oculta.
        if (n == null || n === '' || !Number.isFinite(Number(n))) return;
        const v = Math.round(Number(n));
        const txt = v > 0 ? '$' + v.toLocaleString('es-AR') : '';
        const a = _el('loadHereMin'); if (a) a.textContent = txt ? ('carga mínima ' + txt + ' · se acredita solo') : 'se acredita solo';
        const b = _el('alMinDep'); if (b) { b.textContent = txt ? ('· mínimo ' + txt) : ''; b.style.display = txt ? '' : 'none'; }
        const c = _el('alMinLine'); if (c) { const bb = c.querySelector('b'); if (bb) bb.textContent = txt; c.style.display = txt ? '' : 'none'; }
        const d = _el('serviceBannerMin'); if (d) { const bb = d.querySelector('b'); if (bb) bb.textContent = txt; d.style.display = txt ? '' : 'none'; }
        document.querySelectorAll('.md-amt').forEach((x) => { x.textContent = txt || '$2.000'; }); // #684: notas "con $X o más se acredita sola"
        document.querySelectorAll('.min-note').forEach((x) => { x.style.display = txt ? '' : 'none'; });
    }
    // #385: textos de los botones "Adjuntar comprobante aquí" y "Retirar premio" desde COMANDOS (/sys_load_btn*, /sys_withdraw_btn*).
    function _paintActionBtns(ab) {
        if (!ab) return;
        const set = (id, v) => { if (v == null || !String(v).trim()) return; const el = _el(id); if (el) el.textContent = String(v).trim(); };
        try {
            const lb = document.querySelector('#loadHereBtn .lr-text b'); if (lb && ab.load) lb.textContent = String(ab.load).trim();
            set('loadHereMin', ab.loadSub);
            set('withdrawBtnText', ab.withdraw);
            set('withdrawBtnSub', ab.withdrawSub);
        } catch (_) {}
    }
    // #296: con UNA sola plataforma habilitada (Ganamos apagada hasta tener la API) los textos no la nombran.
    function _paintPlatformTexts() {
        const list = (_platforms && _platforms.platforms) || [];
        if (!list.length) return;
        const one = list.length === 1 ? list[0] : null;
        const names = list.map((p) => p.name);
        const why = _el('infoCardWhyTitle');
        if (why) why.textContent = one ? ('¿Por qué elegir ' + one.name + '?') : ('¿Por qué elegir ' + names.concat(['PICA ROJA']).join(' o ') + '?'); // #949: + PICA ROJA
        // #710 (owner): la tarjeta "La plataforma que quieras" (Girox, Ganamos y Jugaygana, todas originales) se ve SIEMPRE en Info; texto fijo en el HTML.
        // #407 (owner): título "La plataforma que quieras"; jugaygana en minúscula ACÁ (sólo en Info); lista "A, B y C".
        const _infoName = (n) => (/^jugaygana$/i.test(String(n || '')) ? 'Jugaygana' : String(n || '')); // #431: J mayúscula
        // #439 (owner): sólo los nombres de las plataformas en negrita; el resto del texto normal.
        const _list = names.map((n) => '<b>' + _esc(_infoName(n)) + '</b>'); const _joined = _list.length > 1 ? (_list.slice(0, -1).join(', ') + ' y ' + _list[_list.length - 1]) : (_list[0] || '');
        // (#710: el texto de infoCardTwoPlatsDesc ya no se pisa desde acá) // #622 texto corto
        const sub = _el('platformsSub');
        if (sub && one) sub.textContent = 'Tus cargas van a ' + one.name + '. Para verla, andá a Inicio.';
        const pt = _el('platformsCardTitleTxt') || document.querySelector('#platformsCard .home-card-title'); if (pt) pt.textContent = one ? 'Tu plataforma' : '¿Dónde querés jugar?';
    }
    function renderEntryTabs() {
        const box = _el('entryTabs'); if (!box) return;
        const list = _entryList();
        // #298/#300: la plataforma default (Girox) SIEMPRE se puede elegir; una sin API se ve con "Próximamente" pero la
        // pestaña sigue abriendo su página como antes (owner: "agregá Ganamos como estaba y ponele próximamente").
        const defId = (_platforms && _platforms.defaultPlatform) || 'girox';
        const isSoon = (p) => p.connected === false && p.id !== defId && p.id !== 'girox'; // #301: Girox NUNCA
        const avail = list.filter((p) => !isSoon(p));
        if (!_entryPlat || !avail.some((p) => p.id === _entryPlat)) {
            const def = (_platforms && _platforms.defaultPlatform) || 'girox';
            _entryPlat = ((avail.find((p) => p.id === def) || avail[0] || list[0]) || {}).id;
        }
        box.innerHTML = list.map((p) => {
            const soon = isSoon(p);
            return '<button type="button" class="ev-tab plat-' + _esc(p.id) + (p.id === _entryPlat ? ' active' : '') + (soon ? ' soon' : '') + '" onclick="VIP.home.entrySwitch(\'' + _esc(p.id) + '\')"' + (soon ? ' title="Próximamente"' : '') + '>' +
            (p.logoUrl ? '<img src="' + _esc(p.logoUrl) + '" alt="">' : '') + '<span class="ev-name">' + _esc(/^jugaygana$/i.test(p.name || '') ? 'Jugaygana' : p.name) + '</span>' + // #523: logo y nombre en línea
            (p.id === 'girox' ? '<span class="ev-reco">Recomendado</span>' : '') +
            (soon ? '<span class="ev-soon">Pronto</span>' : '') + // #511: sutil
            '</button>';
        }).join('');
    }
    function entrySwitch(id) { _entryPlat = id; renderEntryTabs(); _entryLoad(); } // #300: la pestaña siempre abre la página (Ganamos se ve con 'Próximamente')
    // #278: el modo logo de #277 se descartó (owner: "quedó mal") → la web se carga al entrar, como en #267.
    // ---------------- #312: carrusel de fotos ilustrativas de Girox en el Inicio ----------------
    // #327 (owner): fotos nuevas (grillas de juegos: Sugar Rush, Jokers, Fire Joker, Starburst, Crazy Time…); las anteriores se borraron.
    // #331: nombres nuevos (g1..g5) para que ningún caché viejo muestre fotos anteriores. Orden del owner: Jokers, Fire Joker, Starburst, Sugar Rush, Money Time.
    const ENTRY_SLIDES = ['/images/girox-slides/g1.jpg', '/images/girox-slides/g2.jpg', '/images/girox-slides/g3.jpg', '/images/girox-slides/g4.jpg', '/images/girox-slides/g5.jpg', '/images/girox-slides/g6.jpg']; // #473: slots 3×2 (#482: la de lobbies 2×2 se sacó, quedaba mal)
    let _slTimer = null, _slIdx = 0, _slBuilt = false, _slPausedUntil = 0;
    // #332: las fotos se piden con la versión de la app pegada (?b=NNN) → el navegador nunca muestra una foto vieja guardada.
    function _slideUrl(u) { const t = (_el('appBuildTag') || {}).textContent || ''; const m = /v(\d+)/.exec(t); return u + (m ? '?b=' + m[1] : ''); }
    // #489 (owner): el deslizante del Inicio son JUEGOS individuales, grandes, con "N jugando" (número inventado entre 50 y 200,
    // estable por sesión y con pequeños cambios cada 20 s para que se vea vivo). Las tarjetas salen de capturas de la plataforma.
    // #786 (owner): los 10 MÁS JUGADOS de 1girox (por play_count de su catálogo público, 2026-10-21), con el Joker primero; fotos
    // reales de la plataforma en /images/games/<id>.jpg (300 px) y TODOS con enlace directo al juego (GAME_PLAY).
    const ENTRY_GAMES = [['jokers-jewels', "Joker's Jewels"], ['gates-of-olympus-1000', 'Gates of Olympus 1000'], ['sugar-rush-1000', 'Sugar Rush 1000'], ['sweet-bonanza-2500', 'Sweet Bonanza 2500'], ['jokers-jewels-hold-spin', "Joker's Jewels Hold & Spin"], ['mines', 'Mines'], ['zeus-rush-fever', 'Zeus Rush Fever Deluxe'], ['buffalo-king-untamed', 'Buffalo King Untamed'], ['big-bass-bonanza', 'Big Bass Bonanza'], ['starlight-princess-1000', 'Starlight Princess 1000']];
    // #782 (owner): "que cada foto lo lleve directo a ese juego". Ruta de juego en 1girox = /play/<aggregator_id>/<game_id>
    // (sacado de su catálogo público admin.1girox.com/api/games?search=…). Los que no están en el catálogo (Garuda, Gems) abren el
    // casino normal. Un juego nuevo: agregar acá el par. Se navega DESPUÉS del SSO (ui.js, `_casinoGamePath`).
    const GAME_PLAY = { 'jokers-jewels': '/play/2/vs5joker', 'gates-of-olympus-1000': '/play/2/vs20olympx', 'sugar-rush-1000': '/play/2/vs20sugarrushx', 'sweet-bonanza-2500': '/play/2/vs20swbon2500', 'jokers-jewels-hold-spin': '/play/2/vs5jokjewhs', 'mines': '/play/4/mines_prod2_100hp', 'zeus-rush-fever': '/play/4/zeusrushfeverdeluxe96_rubyplay', 'buffalo-king-untamed': '/play/2/vswaysbkingasc', 'big-bass-bonanza': '/play/2/vs10bbbonanza', 'starlight-princess-1000': '/play/2/vs20starlightx' };
    function playGame(id) {
        try { VIP.ui._casinoGamePath = GAME_PLAY[id] || null; VIP.ui._casinoGameName = ((ENTRY_GAMES.find((g) => g[0] === id) || [])[1]) || ''; } catch (_) {}
        try { VIP.ui.showToast(GAME_PLAY[id] ? '🎰 Abriendo ' + ((ENTRY_GAMES.find((g) => g[0] === id) || [])[1] || 'el juego') + '…' : '🎰 Abriendo el casino…', 'info'); } catch (_) {}
        openPlatform('girox', { embed: true });
    }
    const _gamePlayers = {}; let _gameTick = null;
    function _gameN(id) { if (!_gamePlayers[id]) _gamePlayers[id] = 50 + Math.floor(Math.random() * 151); return _gamePlayers[id]; }
    // #495 (owner): los "jugando" van variando rato a rato: cada juego cambia solo, en momentos distintos (cada 6–20 s), de a 1 a 9
    // personas, siempre entre 50 y 200, con un parpadeo chiquito del número.
    function _gamesTick() {
        if (document.hidden) return;
        const picks = ENTRY_GAMES.filter(() => Math.random() < 0.45); // en cada pasada cambian algunos, no todos
        picks.forEach(([id]) => {
            const delta = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 9));
            const n = Math.max(50, Math.min(200, _gameN(id) + delta)); if (n === _gamePlayers[id]) return; _gamePlayers[id] = n;
            const el = document.querySelector('.ev-game[data-g="' + id + '"] b'); if (!el) return;
            el.textContent = n; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
        });
    }
    function _slidesBuild() {
        const tr = _el('entrySlidesTrack'), dots = _el('entrySlidesDots');
        if (!tr || _slBuilt) return;
        if (ENTRY_GAMES.length) {
            tr.classList.add('games'); const fw = tr.closest('.ev-frame-wrap'); if (fw) fw.classList.add('games');
            if (!_el('evGamesH')) { const hd = document.createElement('div'); hd.id = 'evGamesH'; hd.className = 'ev-games-h'; hd.innerHTML = '<span>🔥 Top juegos · jugá desde acá</span><small><i></i>jugando ahora</small>'; /* #786 · #787 */ tr.parentNode.insertBefore(hd, tr); }
            if (!_el('evFavs')) { const fv = document.createElement('div'); fv.id = 'evFavs'; fv.className = 'ev-favs'; _el('evGamesH').parentNode.insertBefore(fv, _el('evGamesH')); } // #840
            tr.innerHTML = ENTRY_GAMES.map(([id, name], i) => '<div class="ev-game" data-g="' + id + '" role="button" onclick="VIP.home.playGame(\'' + id + '\')"><img src="' + _slideUrl('/images/games/' + id + '.jpg') + '" alt="' + _esc(name) + '" loading="' + (i < 2 ? 'eager' : 'lazy') + '" decoding="async" draggable="false"><span class="gp"><i></i><b>' + _gameN(id) + '</b> jugando</span><span class="ev-play">👆 Jugar ahora</span>' + (GAME_PLAY[id] ? '<button type="button" class="fav-star" data-k="' + _esc(GAME_PLAY[id].slice(6)) + '" onclick="event.stopPropagation();VIP.home.favToggleTop(\'' + id + '\')" aria-label="Favorito">☆</button>' : '') + '</div>').join(''); // #785: manito + "Jugar ahora" · #840: ⭐
            tr.hidden = true; try { _el('evGamesH').hidden = true; } catch (_) {} _favPaint(); _favLoad(); // #842: sin parpadeo de Top juegos
            if (dots) dots.innerHTML = '';
            const pause = () => { _slPausedUntil = Date.now() + 5000; };
            ['touchstart', 'pointerdown', 'wheel'].forEach((ev) => tr.addEventListener(ev, pause, { passive: true }));
            clearInterval(_gameTick); _gameTick = setInterval(_gamesTick, 7000);
            _slBuilt = true; return;
        }
        // #314: la foto va a TODO el ancho dentro de un recuadro; el fondo es la misma foto desenfocada (nada queda "incompleto").
        // #319: cada foto lleva la etiqueta "FOTO ILUSTRATIVA · acá no se juega" para que nadie intente tocarla.
        tr.innerHTML = ENTRY_SLIDES.map((u0, i) => { const u = _slideUrl(u0); return '<div class="ev-slide" style="background-image:url(' + u + ')"><img src="' + u + '" alt="Foto ilustrativa de Girox ' + (i + 1) + '" decoding="async" loading="' + (i ? 'lazy' : 'eager') + '" decoding="async" draggable="false"></div>'; }).join('');
        if (dots) dots.innerHTML = ''; // #352 (owner): sin puntitos — el botón de cargar va en su lugar; el pase sigue automático
        const pause = () => { _slPausedUntil = Date.now() + 5000; };
        ['touchstart', 'pointerdown', 'wheel'].forEach((ev) => tr.addEventListener(ev, pause, { passive: true }));
        tr.addEventListener('scroll', () => { const w = tr.clientWidth || 1; const i = Math.round(tr.scrollLeft / w); if (i !== _slIdx) { _slIdx = i; _slidesDots(); } }, { passive: true });
        _slBuilt = true;
    }
    // ---------------- #865 AJUSTAR LA PANTALLA AL TELÉFONO ----------------
    // Owner: "en iPhone se corta la parte de arriba: que se pueda elegir el modelo con un buscador cuando abrís la app, para que la pantalla
    // se ajuste al teléfono". El margen superior (--sat, #823) se puede FIJAR por modelo (localStorage vip_sat_override; index.html lo aplica
    // antes de pintar) y afinar con ▲▼. "Automático" vuelve al cálculo de siempre. En iPhone con la app instalada se ofrece 1 vez al abrir.
    const FIT_MODELS = [
        ['iPhone 17 Pro Max / 17 Pro / 17 / Air', 62], ['iPhone 16 Pro Max / 16 Pro', 62], ['iPhone 16 Plus / 16', 59], ['iPhone 15 Pro Max / 15 Pro / 15 Plus / 15', 59],
        ['iPhone 14 Pro Max / 14 Pro', 59], ['iPhone 14 Plus / 14', 47], ['iPhone 13 Pro Max / 13 Pro / 13', 47], ['iPhone 13 mini / 12 mini', 50],
        ['iPhone 12 Pro Max / 12 Pro / 12', 47], ['iPhone 11', 48], ['iPhone XR', 48], ['iPhone 11 Pro Max / 11 Pro', 44], ['iPhone XS Max / XS / X', 44],
        ['iPhone SE (2ª y 3ª) / 8 / 8 Plus / 7 / 6s', 20],
        ['Samsung Galaxy (S, A, Z) — pantalla completa', 32], ['Motorola (Moto G, Edge)', 28], ['Xiaomi / Redmi / Poco', 32], ['Otro Android — pantalla completa', 28],
        ['Android con la barra de arriba aparte', 0]
    ];
    function _fitCur() { try { const v = localStorage.getItem('vip_sat_override'); return v === null || v === '' ? null : Number(v); } catch (_) { return null; } }
    function _fitApply(v, label) {
        try { if (v == null) localStorage.removeItem('vip_sat_override'); else localStorage.setItem('vip_sat_override', String(v)); localStorage.setItem('vip_fit_asked', '1'); if (label) localStorage.setItem('vip_fit_model', label); else localStorage.removeItem('vip_fit_model'); } catch (_) {}
        let sat = v;
        if (sat == null) { try { sat = (window.VIP_DEVICE && window.VIP_DEVICE.sat) || 0; } catch (_) { sat = 0; } }
        document.documentElement.style.setProperty('--sat', Math.max(0, Math.min(80, Math.round(sat))) + 'px');
        document.documentElement.classList.toggle('sat-fixed', v != null); // #867: el elegido reemplaza los mínimos fijos (ios-notch 44 px)
        _fitPaintCur();
    }
    function _fitPaintCur() {
        const el = _el('fitCur'); const v = _fitCur(); let lb = ''; try { lb = localStorage.getItem('vip_fit_model') || ''; } catch (_) {}
        if (el) el.textContent = v == null ? 'Modelo: automático' : ('Modelo: ' + (lb || 'a mano'));
        const cs = getComputedStyle(document.documentElement);
        const tv = _el('fitTopV'), bv = _el('fitBotV');
        if (tv) tv.textContent = (parseInt(cs.getPropertyValue('--sat'), 10) || 0) + ' px';
        if (bv) { const ob = _fitBotCur(); bv.textContent = ob == null ? 'auto' : ob + ' px'; }
    }
    // #867 (owner: "deja un espacio en blanco abajo y no se ajusta bien"): margen de ABAJO (--sab) ajustable aparte; "auto" = el del teléfono.
    function _fitBotCur() { try { const v = localStorage.getItem('vip_sab_override'); return v === null || v === '' ? null : Number(v); } catch (_) { return null; } }
    function _fitBotApply(v) {
        const d = document.documentElement;
        try { if (v == null) { localStorage.removeItem('vip_sab_override'); d.style.removeProperty('--sab'); d.classList.remove('sab-fixed'); } else { localStorage.setItem('vip_sab_override', String(v)); d.style.setProperty('--sab', v + 'px'); d.classList.add('sab-fixed'); } } catch (_) {}
        _fitPaintCur();
    }
    function fitNudgeBottom(delta) {
        let v = _fitBotCur();
        if (v == null) { const p = document.createElement('div'); p.style.cssText = 'position:fixed;left:-9999px;padding-bottom:var(--sab,0px)'; document.body.appendChild(p); v = Math.round(parseFloat(getComputedStyle(p).paddingBottom) || 0); p.remove(); }
        _fitBotApply(Math.max(0, Math.min(60, v + delta)));
    }
    function fitBottomAuto() { _fitBotApply(null); }
    // #868 (owner: "que se pueda estirar también"): sin espacio abajo y arriba lo mínimo que deja ver la hora del teléfono.
    function fitStretch() {
        _fitBotApply(0);
        const ios = document.documentElement.classList.contains('dev-ios');
        let lb = ''; try { lb = localStorage.getItem('vip_fit_model') || 'estirado'; } catch (_) {}
        if (!ios) _fitApply(0, lb);
        try { VIP.ui.showToast('⤢ Pantalla estirada. Si algo queda tapado, usá + arriba o abajo.', 'success'); } catch (_) {}
    }
    function openFitPhone() {
        let m = _el('fitModal');
        if (!m) {
            document.body.insertAdjacentHTML('beforeend', '<div id="fitModal" class="modal hidden fav-modal" onclick="if(event.target===this)VIP.home.closeFitPhone()"><div class="modal-content fav-pick fit-pick" onclick="event.stopPropagation()">' +
                '<div class="fav-pick-h"><b>📱 Ajustar pantalla</b><button type="button" class="fav-x" onclick="VIP.home.closeFitPhone()" aria-label="Cerrar">✕</button></div>' +
                '<p class="fav-pick-sub">Sólo si algo se corta: elegí tu teléfono o movelo con − +.</p>' +
                '<input type="search" id="fitSearch" class="fav-search" placeholder="Buscá tu modelo (ej. iPhone 13, Galaxy, Moto)" autocomplete="off" oninput="VIP.home.fitFilter(this.value)">' +
                '<div class="fit-tune"><span>⬆️ Arriba <b id="fitTopV"></b></span><button type="button" onclick="VIP.home.fitNudge(-4)" aria-label="Menos espacio arriba">−</button><button type="button" onclick="VIP.home.fitNudge(4)" aria-label="Más espacio arriba">+</button></div>' +
                '<div class="fit-tune"><span>⬇️ Abajo <b id="fitBotV"></b></span><button type="button" onclick="VIP.home.fitNudgeBottom(-4)" aria-label="Menos espacio abajo">−</button><button type="button" onclick="VIP.home.fitNudgeBottom(4)" aria-label="Más espacio abajo">+</button><button type="button" onclick="VIP.home.fitBottomAuto()">auto</button></div>' +
                '<button type="button" class="fit-stretch" onclick="VIP.home.fitStretch()">⤢ Estirar a toda la pantalla</button>' +
                '<p class="fit-cur" id="fitCur"></p>' +
                '<div id="fitList" class="fit-list"></div>' +
                '<button type="button" class="btn btn-primary fav-done" onclick="VIP.home.closeFitPhone()">Listo</button></div></div>');
            m = _el('fitModal');
        }
        fitFilter(''); _fitPaintCur(); m.classList.remove('hidden');
    }
    function closeFitPhone() { const m = _el('fitModal'); if (m) m.classList.add('hidden'); try { localStorage.setItem('vip_fit_asked', '1'); } catch (_) {} }
    function fitFilter(q) {
        const box = _el('fitList'); if (!box) return; const t = String(q || '').toLowerCase().trim();
        const ios = document.documentElement.classList.contains('dev-ios');
        const list = FIT_MODELS.filter((x) => !t || x[0].toLowerCase().includes(t)).sort((a, b) => (ios ? (/iPhone/.test(b[0]) - /iPhone/.test(a[0])) : (/iPhone/.test(a[0]) - /iPhone/.test(b[0]))));
        const cur = _fitCur(); let lb = ''; try { lb = localStorage.getItem('vip_fit_model') || ''; } catch (_) {}
        box.innerHTML = '<button type="button" class="fit-item' + (cur == null ? ' on' : '') + '" onclick="VIP.home.fitPick(-1)"><b>✨ Automático</b><small>La app lo calcula sola (recomendado si ya se ve bien)</small></button>' +
            list.map((x) => '<button type="button" class="fit-item' + (lb === x[0] ? ' on' : '') + '" onclick="VIP.home.fitPick(' + FIT_MODELS.indexOf(x) + ')"><b>' + _esc(x[0]) + '</b></button>').join('') +
            (list.length ? '' : '<div class="fav-msg">No está en la lista: elegí "Otro Android" o el iPhone más parecido y ajustá con ▲ ▼.</div>');
    }
    function fitPick(i) { if (i < 0) _fitApply(null, null); else { const x = FIT_MODELS[i]; if (x) _fitApply(x[1], x[0]); } fitFilter((_el('fitSearch') || {}).value || ''); try { VIP.ui.showToast('📱 Listo: pantalla ajustada', 'success'); } catch (_) {} }
    function fitNudge(d) {
        let v = _fitCur(); if (v == null) { try { v = (window.VIP_DEVICE && window.VIP_DEVICE.sat) || 0; } catch (_) { v = 0; } }
        let lb = ''; try { lb = localStorage.getItem('vip_fit_model') || 'a mano'; } catch (_) {}
        _fitApply(Math.max(0, Math.min(80, v + d)), lb);
    }
    // 1 vez: iPhone con la app instalada que nunca eligió.
    function _fitMaybeAsk() { try { if (!document.documentElement.classList.contains('dev-ios') || !document.documentElement.classList.contains('is-app')) return; if (localStorage.getItem('vip_fit_asked') === '1') return; setTimeout(openFitPhone, 2500); } catch (_) {} }
    // #870 (owner: "cuando instalan, que aparezca completa; si quiere ajustar a mano que vaya a la app… no le cargues tanto"): ya NO se abre solo
    // al entrar (la app arranca en Automático, a pantalla completa); el ajuste queda en el link de abajo del saldo.
    void _fitMaybeAsk;
    // ---------------- #840 JUEGOS FAVORITOS ----------------
    // El cliente marca ⭐ en los Top juegos o en el catálogo de Girox (buscador) y sus favoritos aparecen arriba del Inicio con link directo
    // al juego. Se guardan en su cuenta (GET/POST /api/games/favorites). Sin favoritos: aviso + botón para agregarlos (quedan los Top juegos).
    let _favs = null, _favLoading = null, _favUser = null;
    function _favHas(key) { return !!(_favs && _favs.some((f) => f.key === key)); }
    function _favLoad(force) {
        const tok = VIP.state && VIP.state.currentToken; if (!tok) return Promise.resolve([]);
        const uid = (VIP.state.currentUser && (VIP.state.currentUser.id || VIP.state.currentUser.username)) || tok.slice(-12);
        if (_favUser !== uid) { _favUser = uid; _favs = null; } // otra cuenta en el mismo teléfono ⇒ sus favoritos
        if (_favs && !force) { _favPaint(); return Promise.resolve(_favs); }
        if (!_favLoading) _favLoading = fetch(VIP.config.API_URL + '/api/games/favorites', { headers: { Authorization: 'Bearer ' + tok } })
            .then((r) => r.ok ? r.json() : null).then((j) => { if (j && Array.isArray(j.favorites)) _favs = j.favorites; else if (!_favs) _favs = []; _favPaint(); return _favs; })
            .catch(() => { if (!_favs) _favs = []; _favPaint(); return _favs; }).finally(() => { _favLoading = null; });
        return _favLoading;
    }
    // #869: las fotos de 1girox pasan por nuestro server (/api/games/img) ⇒ se ven en todos los teléfonos; si alguna falla, el logo.
    function _favImg(f) { return f.img ? (/^\/images\//.test(f.img) ? _slideUrl(f.img) : (/^https:\/\//.test(f.img) ? '/api/games/img?u=' + encodeURIComponent(f.img) : f.img)) : '/icons/icon-192x192.png'; }
    const _IMG_FALLBACK = ' onerror="this.onerror=null;this.src=\'/icons/icon-192x192.png\'"';
    function _favPaint() {
        const box = _el('evFavs');
        if (box) {
            const list = _favs || [];
            // #842 (owner): arriba "elegí tus favoritos" + botón Agregar; de entrada vienen 10 (los elige el server) y se editan desde acá.
            box.innerHTML = '<div class="ev-games-h fav-h"><span>⭐ Mis juegos favoritos<small class="fav-sub">Elegí tus favoritos · tocá ★ para sacar uno</small></span><button type="button" class="fav-add" onclick="VIP.home.favOpenPicker()">＋ Agregar</button></div>' +
                (_favs === null ? '<div class="fav-loading">Cargando tus juegos…</div>' : list.length
                    ? '<div class="fav-row">' + list.map((f) => '<div class="fav-card" role="button" onclick="VIP.home.favPlay(\'' + _esc(f.key) + '\')"><img src="' + _esc(_favImg(f)) + '" alt="' + _esc(f.name) + '" loading="lazy" decoding="async" draggable="false"' + _IMG_FALLBACK + '><b>' + _esc(f.name) + '</b><button type="button" class="fav-star on" onclick="event.stopPropagation();VIP.home.favToggle(\'' + _esc(f.key) + '\')" aria-label="Sacar de favoritos">★</button></div>').join('') + '</div>'
                    : '<button type="button" class="fav-empty" onclick="VIP.home.favOpenPicker()"><b>⭐ Agregá tus juegos favoritos para que aparezcan acá</b><small>Tocá la ☆ de cualquier juego o buscalos en Girox · entrás directo con un toque</small><span>⭐ Agregar mis juegos favoritos ›</span></button>');
        }
        document.querySelectorAll('.fav-star[data-k]').forEach((b) => { const on = _favHas(b.dataset.k); b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; });
        // #842 (owner): "eliminá la lista de abajo" ⇒ los Top juegos ya no se muestran: quedan sólo los favoritos (10 de entrada).
        const tr = _el('entrySlidesTrack'), hd = _el('evGamesH');
        if (tr && tr.classList.contains('games')) tr.hidden = true;
        if (hd) hd.hidden = true;
    }
    async function _favSet(g, on) {
        const tok = VIP.state && VIP.state.currentToken; if (!tok) return;
        const prev = _favs ? _favs.slice() : [];
        // Se pinta al toque (optimista) y se corrige con lo que diga el server.
        if (on) { if (!_favHas(g.key)) _favs = (_favs || []).concat([{ key: g.key, name: g.name, img: g.img, provider: g.provider || '' }]); } else _favs = (_favs || []).filter((f) => f.key !== g.key);
        _favPaint(); _favPickerPaintStars();
        try {
            const r = await fetch(VIP.config.API_URL + '/api/games/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ key: g.key, name: g.name, img: g.img || '', provider: g.provider || '', on }) });
            const j = await r.json().catch(() => ({}));
            if (r.ok && Array.isArray(j.favorites)) _favs = j.favorites; else { _favs = prev; try { VIP.ui.showToast(j.error || 'No se pudo guardar el favorito. Probá de nuevo.', 'error'); } catch (_) {} }
        } catch (_) { _favs = prev; try { VIP.ui.showToast('Sin conexión: no se guardó el favorito.', 'error'); } catch (_) {} }
        _favPaint(); _favPickerPaintStars();
        if (on && _favHas(g.key)) { try { VIP.ui.showToast('⭐ ' + g.name + ' quedó en tus favoritos del Inicio', 'success'); } catch (_) {} }
        if (_favQ.length < 2 && _el('favPicker') && !_el('favPicker').classList.contains('hidden')) _favPickerPaint(); // lista de favoritos al día
    }
    function favToggle(key) { const f = (_favs || []).find((x) => x.key === key) || (_favCat || []).find((x) => x.key === key); if (!f) return; _favSet(f, !_favHas(key)); }
    function favToggleTop(id) {
        const path = GAME_PLAY[id]; if (!path) return; const name = ((ENTRY_GAMES.find((g) => g[0] === id) || [])[1]) || 'Juego';
        const key = path.slice(6); _favSet({ key, name, img: '/images/games/' + id + '.jpg', provider: '' }, !_favHas(key));
    }
    // #866 (owner: "que entre logueado al juego que se seleccionó" + "está lenta cuando entrás de favoritos"): el proveedor del juego no se deja
    // mostrar dentro del recuadro (pantalla negra) ⇒ el juego se abre en PANTALLA COMPLETA (ventana propia), logueado y directo al slot:
    // la ventana se abre YA en el toque (si no, el navegador la bloquea) y se le pone la dirección del juego cuando llega del server.
    // Si 1girox no da el juego, se cierra esa ventana y se abre Girox logueado en el recuadro, como siempre.
    async function favPlay(key) {
        const f = (_favs || []).find((x) => x.key === key) || (_favCat || []).find((x) => x.key === key);
        const name = (f && f.name) || 'el juego';
        favClosePicker();
        let win = null; try { win = window.open('about:blank', '_blank'); } catch (_) { win = null; }
        try { if (win && win.document) { win.document.title = name; win.document.body.style.cssText = 'margin:0;background:#0b0b10;color:#fff;font:700 16px system-ui;display:flex;align-items:center;justify-content:center;height:100vh'; win.document.body.textContent = '🎰 Abriendo ' + name + '…'; } } catch (_) {}
        try { VIP.ui.showToast('🎰 Abriendo ' + name + '…', 'info'); } catch (_) {}
        let url = null;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/platform/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + VIP.state.currentToken }, body: JSON.stringify({ platform: 'girox', game: '/play/' + key, gameName: name, direct: true }) });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success && d.directGame && d.redirectUrl) url = d.redirectUrl;
        } catch (_) {}
        if (url && win && !win.closed) { try { win.location.href = url; return; } catch (_) {} }
        if (url && !win) { try { location.href = url; return; } catch (_) {} } // sin ventanas (algunas apps instaladas): en la misma pantalla
        try { if (win && !win.closed) win.close(); } catch (_) {}
        // Sin juego directo: Girox logueado en el recuadro (un ingreso nuevo, el último ⇒ válido) + aviso para buscarlo.
        let wait = 0; try { if (VIP.ui && VIP.ui._casinoOpen) { VIP.ui.closeCasinoFrame(); wait = 300; } } catch (_) {}
        setTimeout(() => { try { VIP.ui._casinoGamePath = '/play/' + key; VIP.ui._casinoGameName = name; } catch (_) {} openPlatform('girox', { embed: true }); }, wait);
    }
    // Selector: catálogo de Girox con buscador (los más jugados primero) y ⭐ para marcar.
    let _favCat = [], _favQ = '', _favPage = 1, _favMore = false, _favQT = null, _favReq = 0;
    function favOpenPicker() {
        let m = _el('favPicker');
        if (!m) {
            document.body.insertAdjacentHTML('beforeend', '<div id="favPicker" class="modal hidden fav-modal" onclick="if(event.target===this)VIP.home.favClosePicker()"><div class="modal-content fav-pick" onclick="event.stopPropagation()">' +
                '<div class="fav-pick-h"><b>⭐ Elegí tus juegos favoritos</b><button type="button" class="fav-x" onclick="VIP.home.favClosePicker()" aria-label="Cerrar">✕</button></div>' +
                '<p class="fav-pick-sub">Buscá tus juegos y tocá la ☆: aparecen en tu Inicio y entrás directo.</p>' +
                '<input type="search" id="favSearch" class="fav-search" placeholder="Buscar juego (ej. Olympus, Sweet Bonanza)" autocomplete="off" oninput="VIP.home.favSearch(this.value)">' +
                '<div id="favGrid" class="fav-grid"></div><button type="button" id="favMoreBtn" class="fav-more" onclick="VIP.home.favMore()" hidden>Ver más juegos</button>' +
                '<button type="button" class="btn btn-primary fav-done" onclick="VIP.home.favClosePicker()">Listo</button></div></div>');
            m = _el('favPicker');
        }
        m.classList.remove('hidden'); document.body.classList.add('fav-open');
        // #840 (owner): "con un buscador: que aparezcan los juegos buscando y sólo los favoritos, para no mostrar toda la página" ⇒ sin
        // búsqueda se ven SÓLO tus favoritos; el catálogo aparece recién al escribir (2+ letras).
        const inp = _el('favSearch'); if (inp) { inp.value = _favQ; setTimeout(() => { try { inp.focus(); } catch (_) {} }, 120); }
        _favLoad().then(() => { if (_favQ.length < 2) _favPickerPaint(); });
        if (_favQ.length >= 2) _favFetch(true); else _favPickerPaint();
    }
    function favClosePicker() { const m = _el('favPicker'); if (m) m.classList.add('hidden'); document.body.classList.remove('fav-open'); }
    function favSearch(v) { clearTimeout(_favQT); _favQT = setTimeout(() => { _favQ = String(v || '').trim(); if (_favQ.length >= 2) _favFetch(true); else { _favReq++; _favCat = []; _favMore = false; _favPickerPaint(); } }, 350); }
    function favMore() { _favPage++; _favFetch(false); }
    async function _favFetch(reset) {
        const tok = VIP.state && VIP.state.currentToken; const grid = _el('favGrid'); if (!tok || !grid) return;
        if (reset) { _favPage = 1; _favCat = []; grid.innerHTML = '<div class="fav-msg">Buscando juegos…</div>'; }
        const my = ++_favReq;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/games/catalog?q=' + encodeURIComponent(_favQ) + '&page=' + _favPage, { headers: { Authorization: 'Bearer ' + tok } });
            const j = await r.json().catch(() => ({})); if (my !== _favReq) return;
            if (!r.ok) { grid.innerHTML = '<div class="fav-msg">' + _esc(j.error || 'No pudimos traer los juegos. Probá de nuevo.') + '</div>'; return; }
            const seen = new Set(_favCat.map((g) => g.key)); _favCat = _favCat.concat((j.games || []).filter((g) => !seen.has(g.key))); _favMore = !!j.hasMore;
        } catch (_) { if (my === _favReq) grid.innerHTML = '<div class="fav-msg">Sin conexión. Probá de nuevo.</div>'; return; }
        _favPickerPaint();
    }
    function _favPickerPaint() {
        const grid = _el('favGrid'), more = _el('favMoreBtn'); if (!grid) return;
        if (_favQ.length < 2) { // sin búsqueda: sólo los favoritos
            const list = _favs || [];
            grid.innerHTML = '<div class="fav-msg fav-msg-h">' + (list.length ? '⭐ Tus favoritos (' + list.length + ') · tocá la ★ para sacarlo' : '🔎 Escribí el nombre de un juego arriba para buscarlo y agregarlo') + '</div>' +
                list.map((g) => '<div class="fav-item" role="button" onclick="VIP.home.favToggle(\'' + _esc(g.key) + '\')"><img src="' + _esc(_favImg(g)) + '" alt="" loading="lazy" decoding="async"' + _IMG_FALLBACK + '><b>' + _esc(g.name) + '</b><small>' + _esc(g.provider || '') + '</small><span class="fav-star" data-k="' + _esc(g.key) + '">★</span></div>').join('');
            if (more) more.hidden = true; _favPickerPaintStars(); return;
        }
        grid.innerHTML = _favCat.length ? _favCat.map((g) => '<div class="fav-item" role="button" onclick="VIP.home.favToggle(\'' + _esc(g.key) + '\')"><img src="' + _esc(_favImg(g)) + '" alt="" loading="lazy" decoding="async"' + _IMG_FALLBACK + '><b>' + _esc(g.name) + '</b><small>' + _esc(g.provider || '') + '</small><span class="fav-star" data-k="' + _esc(g.key) + '">☆</span></div>').join('') : '<div class="fav-msg">No encontramos juegos con ese nombre.</div>';
        if (more) more.hidden = !_favMore;
        _favPickerPaintStars();
    }
    function _favPickerPaintStars() { document.querySelectorAll('#favGrid .fav-star[data-k], .ev-game .fav-star[data-k]').forEach((b) => { const on = _favHas(b.dataset.k); b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; }); }
    function _slidesDots() { const dots = _el('entrySlidesDots'); if (!dots) return; Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === _slIdx)); }
    function _slidesGo(i) {
        const tr = _el('entrySlidesTrack'); if (!tr) return;
        if (tr.classList.contains('games')) { // #489: avanza de a una tarjeta y vuelve al principio al llegar al final
            const cards = tr.querySelectorAll('.ev-game'); if (!cards.length) return;
            const step = cards[0].offsetWidth + 10; const max = tr.scrollWidth - tr.clientWidth;
            const next = tr.scrollLeft + step > max + 4 ? 0 : tr.scrollLeft + step; tr.scrollTo({ left: next, behavior: 'smooth' }); return;
        }
        _slIdx = (i + ENTRY_SLIDES.length) % ENTRY_SLIDES.length; tr.scrollTo({ left: _slIdx * tr.clientWidth, behavior: 'smooth' }); _slidesDots();
    }
    function _slidesStart() {
        _slidesBuild();
        const box = _el('entrySlides'); if (box) box.style.display = '';
        clearInterval(_slTimer);
        _slTimer = setInterval(() => {
            if (document.hidden || _homeMode !== 'play' || Date.now() < _slPausedUntil) return;
            _slidesGo(_slIdx + 1);
        }, 3000);
    }
    // #324 (owner): "Link plataforma: www.1girox.com (mirala)" → la web pública de Girox aparte, adentro de la app
    // (ventana /jugar.html con la línea "‹ Volver a cargas"), sin login: es para VERLA antes de jugar.
    function entryViewSite() { openPlatformTab('girox', { test: true }); }
    // #362: Telegram desde la barra de arriba (mismo link que el botón "Soporte Telegram" del login: /api/soporte).
    // #749 (owner): tarjeta del canal de Telegram en el Inicio (+ invitación a la comunidad si el panel la cargó)
    let _tg = null;
    async function paintTelegramCard() {
        try { const r = await fetch(VIP.config.API_URL + '/api/config/community', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } }); if (r.ok) _tg = await r.json(); } catch (_) {}
        const has = !!(_tg && (_tg.channelUrl || _tg.inviteUrl)); const inv = !!(_tg && _tg.inviteUrl);
        document.querySelectorAll('.tg-card').forEach((card) => { card.hidden = !has; card.querySelectorAll('.tg-inv').forEach((b) => { b.hidden = !inv; }); }); // #751: completo y básico
    }
    function openTelegramInvite() { const u = _tg && _tg.inviteUrl; if (u) window.open(u, '_blank', 'noopener'); else openTelegram(); }
    async function openTelegram() {
        let url = '';
        try { const r = await fetch(VIP.config.API_URL + '/api/config/soporte-vip'); const d = r.ok ? await r.json() : null; url = (d && d.telegram && d.telegram.url) || ''; } catch (_) {}
        if (!url) url = (VIP.state && VIP.state.communityLink) || '';
        if (url) window.open(url, '_blank', 'noopener'); else if (VIP.ui && VIP.ui.showToast) VIP.ui.showToast('Telegram no disponible por ahora', 'info');
    }
    // #323 (owner): expandir el recuadro de fotos a pantalla completa (se ven enteras) y achicar.
    function toggleEntryExpand(force) {
        const w = document.querySelector('.ev-frame-wrap'); const b = _el('entryExpandBtn');
        if (!w) return;
        const on = typeof force === 'boolean' ? force : !w.classList.contains('is-expanded');
        w.classList.toggle('is-expanded', on);
        document.body.classList.toggle('ev-expanded', on);
        if (b) b.textContent = on ? '✕ Achicar' : '⛶ Ver completas';
        try { const tr = _el('entrySlidesTrack'); if (tr) setTimeout(() => tr.scrollTo({ left: _slIdx * tr.clientWidth }), 60); } catch (_) {}
    }
    function _slidesStop() { clearInterval(_slTimer); _slTimer = null; const box = _el('entrySlides'); if (box) box.style.display = 'none'; }
    function entryShowSite() {
        const f = _el('entryFrame'); if (!f) return;
        const p = _entryList().find((x) => x.id === _entryPlat) || {};
        // #312: Girox = carrusel de fotos (no se carga su web); las demás siguen embebidas.
        if ((p.id || _entryPlat) === 'girox') {
            clearTimeout(_entryTimer); _entryStatus(null);
            if (f.getAttribute('src') && f.getAttribute('src') !== 'about:blank') f.src = 'about:blank';
            f.style.display = 'none'; _entryUrl = null;
            _slidesStart();
            return;
        }
        _slidesStop();
        const url = p.playUrl || p.externalUrl || '';
        if (!url) { _entryStatus((p.name || 'Esa plataforma') + (p.connected === false ? ' · Pronto' : ' todavía no está disponible.'), false); return; } // #378: sin web pública aún
        f.style.display = '';
        if (url === _entryUrl && f.getAttribute('src') === url) return;
        _entryUrl = url;
        _entryStatus('🎰 Abriendo ' + (p.name || 'la plataforma') + '…', false);
        f.src = url;
        clearTimeout(_entryTimer);
        _entryTimer = setTimeout(() => { const st = _el('entryStatus'); if (st && !st.hidden) _entryStatus((p.name || 'La plataforma') + ' no terminó de cargar acá adentro.', true); }, 15000);
    }
    function _entryStatus(text, showOpen) {
        const st = _el('entryStatus'); if (!st) return;
        if (text == null) { st.hidden = true; return; }
        st.hidden = false;
        const t = st.querySelector('.ev-st-t'); if (t) t.textContent = text;
        const b = st.querySelector('.ev-st-open'); if (b) b.style.display = showOpen ? '' : 'none';
    }
    function _entryLoad() {
        if (_homeMode !== 'play') return;
        entryShowSite();
    }
    function _entryUnload() {
        clearTimeout(_entryTimer);
        try { toggleEntryExpand(false); } catch (_) {} // #323
        _slidesStop(); // #312
        const f = _el('entryFrame');
        if (f && f.getAttribute('src') && f.getAttribute('src') !== 'about:blank') f.src = 'about:blank'; // libera la página del casino
        if (f) f.style.display = 'none';
        _entryUrl = '';
        _entryStatus(null);
    }
    function _bindEntryFrame() {
        if (_entryBound) return;
        const f = _el('entryFrame'); if (!f) return;
        _entryBound = true;
        f.addEventListener('load', () => { if (_entryUrl && f.getAttribute('src') === _entryUrl) { clearTimeout(_entryTimer); _entryStatus(null); } });
    }
    function entryOpen() { openPlatform(_entryPlat || 'girox', { test: true }); }

    // #269: servicios del Inicio → mismos flujos de siempre.
    function svcRefund() {
        try { if (VIP.refunds && typeof VIP.refunds.showUnifiedRefundModal === 'function') return VIP.refunds.showUnifiedRefundModal(); } catch (_) {}
        const b = _el('weeklyRefundBtn'); if (b) b.click();
    }
    function svcRoulette() {
        try { if (VIP.roulette && typeof VIP.roulette.open === 'function') return VIP.roulette.open(); } catch (_) {}
        try { VIP.ui.showToast('La ruleta diaria se activa para clientes activos con la app instalada.', 'info'); } catch (_) {}
    }

    function _paintWaHeadName() {
        // #305 (owner): la cabecera dice "Carga manual" (antes "Cargas <plataforma>") y el avatar es un asistente fijo.
        try { const n = _el('waHeadName'); if (n) n.textContent = 'Soporte'; } catch (_) {} // #373: era "Carga manual"
    }

    // ---------------- SOPORTE (chat) ----------------
    function openSupport() {
        // #267: desde la pantalla de entrada, el chat se abre como pantalla principal (modo mini).
        if (_homeMode === 'play') { setHomeMode('mini'); return; }
        const p = _el('supportPanel');
        if (!p) return;
        p.classList.remove('hidden');
        document.body.classList.add('support-open');
        try { const bb = _el('supportBubble'); if (bb) bb.style.visibility = 'hidden'; } catch (_) {}
        _open = true;
        _unread = 0;
        _paintBadge();
        try { VIP.chat.scrollToBottom(); } catch (_) {}
        try { VIP.chat.markReceivedAsRead(); } catch (_) {}
        setTimeout(() => { try { VIP.chat.scrollToBottom(); } catch (_) {} }, 120);
    }
    function closeSupport() {
        // #266: con el home plegado el chat ES la pantalla → "cerrar" = desplegar la app completa.
        if (_homeMode === 'mini') { setHomeMode('full'); return; }
        const p = _el('supportPanel');
        if (!p) return;
        p.classList.add('hidden');
        document.body.classList.remove('support-open');
        try { const bb = _el('supportBubble'); if (bb) bb.style.visibility = ''; } catch (_) {}
        _open = false;
        try { const i = _el('messageInput'); if (i) i.blur(); } catch (_) {}
    }
    function toggleSupport() { _open ? closeSupport() : openSupport(); }
    function isSupportOpen() { return _open; }

    function _paintBadge() {
        ['supportUnread', 'headerSupportUnread', 'navManualUnread'].forEach((id) => {
            const b = _el(id);
            if (!b) return;
            if (_unread > 0) { b.textContent = _unread > 99 ? '99+' : String(_unread); b.style.display = ''; }
            else b.style.display = 'none';
        });
    }
    // #243: sacar la burbuja → queda el círculo de soporte arriba, al lado del fueguito (sólo en la sesión).
    // #248: tocar el círculo de arriba vuelve a mostrar la burbuja movible (y la deja abierta al chat).
    // #268: ya no hay círculo "Soporte aquí" en la cabecera (el chat es "Carga manual" arriba);
    // #headerSupportBtn vive como fila del modal Perfil y no se toca.
    function restoreBubble() {
        const b = _el('supportBubble'); if (b) b.style.display = '';
        _paintBadge();
    }
    function dismissBubble(ev) {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        const b = _el('supportBubble'); if (b) b.style.display = 'none';
    }

    // Mensajes que llegan con el chat CERRADO → contador. La pregunta de
    // plataforma abre el chat sola (tiene botones que hay que tocar).
    function _onIncoming(message) {
        if (!message || message.senderRole === 'user') return;
        const md = message.metadata;
        if (md && md.kind === 'platform_choice' && !md.chosen) {
            if (!_open) openSupport();
            try { VIP.ui.showToast('💰 ¡Llegó tu transferencia! Elegí dónde querés jugar 👇', 'success'); } catch (_) {}
            return;
        }
        // #275: carga acreditada (automática o manual) → cartel "Jugar ahora" si el mensaje es reciente
        // (el historial también pasa por acá: no mostrarlo por cargas viejas).
        if (md && md.kind === 'deposit_credited') {
            try {
                const ts = new Date(message.timestamp || 0).getTime();
                const fresh = !ts || (Date.now() - ts) < 3 * 60000;
                if (fresh && !_playNowShown.has(message.id)) { _playNowShown.add(message.id); _lastDeposit = { platform: md.platform, amount: md.amount, bonus: md.bonus }; showPlayNow(Object.assign({}, _lastDeposit, (_ig && _ig.status === 'offered' && Number(_ig.amount) > 0) ? { gift: _ig } : { plain: true })); } // #735: sin regalo → sin botones, 3 s
            } catch (_) {}
        }
        // #283: oferta de carga GRATIS por instalar la app (primera carga) → hoja al instante si es reciente.
        if (md && md.kind === 'install_gift_offer') {
            try {
                const ts = new Date(message.timestamp || 0).getTime();
                const fresh = !ts || (Date.now() - ts) < 3 * 60000;
                if (fresh && !_igSeen.has(message.id)) {
                    _igSeen.add(message.id);
                    _ig = Object.assign({}, _ig || {}, { status: 'offered', amount: md.amount, pct: md.pct, baseAmount: md.baseAmount, expiresAt: md.expiresAt || null });
                    _igPaintBar();
                    try { sessionStorage.setItem('vip_ig_shown', '1'); } catch (_) {}
                    showInstallGift({ amount: md.amount, pct: md.pct });
                }
            } catch (_) {}
        }
        if (!_open) { _unread++; _paintBadge(); }
    }

    // ---------------- #275: CARTEL "JUGAR AHORA" ----------------
    // (owner: "cuando detecte la carga que aparezca un cartel que diga jugar ahora y apretándolo se abra
    //  tipo link aparte dentro de la app, entrando a la página original adentro"). Hoja inferior fija;
    // el botón abre la plataforma EMBEBIDA (login automático si tiene API; si no, su web) — siempre adentro.
    const _playNowShown = new Set();
    let _lastDeposit = null; // #294: última carga acreditada en esta sesión (para pegarle la oferta del extra)
    function _platName(pid) {
        const list = (_platforms && _platforms.platforms) || [];
        const p = list.find((x) => x.id === pid);
        return p ? p.name : (pid === 'ganamos' ? 'Ganamos' : (pid === 'jugaygana' ? 'JUGAYGANA' : 'Girox'));
    }
    function showPlayNow(opts) {
        const o = opts || {};
        const pid = o.platform || (_platforms && (_platforms.preferredPlatform || _platforms.lastPlatform || _platforms.defaultPlatform)) || 'girox';
        let card = _el('playNowCard');
        if (!card) return;
        // #730 (owner): "aparece en el menú completo pero no en Girox". El cartel vivía adentro de #homeFull, que en modo Girox/play está
        // colapsado (max-height:0, opacity:0): se mostraba invisible. Es position:fixed, así que se cuelga del <body> y se ve en todos lados.
        try { if (card.parentNode !== document.body) document.body.appendChild(card); } catch (_) {}
        const amt = Number(o.amount) > 0 ? '$' + Math.round(Number(o.amount)).toLocaleString('es-AR') : '';
        const bon = Number(o.bonus) > 0 ? ' + $' + Math.round(Number(o.bonus)).toLocaleString('es-AR') + ' de bono' : '';
        const t = _el('playNowTitle'), s = _el('playNowSub'), b = _el('playNowBtn'), tag = _el('playNowTest');
        if (t) t.textContent = amt ? ('¡Entró tu carga de ' + amt + '!') : '¡Entró tu carga!';
        if (s) s.textContent = 'Ya tenés las fichas en ' + _platName(pid) + bon + '. Entrás con tu sesión, sin salir de la app.';
        if (b) { b.onclick = function () { playNow(pid); }; b.textContent = '🎰 Jugar ahora en ' + _platName(pid); }
        if (tag) tag.style.display = o.test ? '' : 'none';
        // #294: la oferta del % EXTRA por instalar la app va ADENTRO de este cartel (un solo cartel).
        const g = o.gift, gb = _el('pnGift'), later = _el('playNowLater');
        card.dataset.test = o.test ? '1' : '';
        if (gb) {
            if (g && Number(g.amount) > 0) {
                const pct = _igPct(g), inApp = _isStandalone();
                const gt = _el('pnGiftTitle'), ga = _el('pnGiftAmt'), gs = _el('pnGiftSub'), gbtn = _el('pnGiftBtn');
                if (gt) gt.textContent = '🎁 ' + (pct ? '+' + pct + ' EXTRA' : 'EXTRA') + ' por instalar la app';
                if (ga) ga.textContent = '+' + _igFmt(g.amount) + ' extra';
                if (gs) gs.textContent = inApp ? 'Ya estás en la app: tocá y te lo cargamos ahora.' : 'Instalala ahora y te lo cargamos al instante, o seguí jugando y cargalo después: te queda un botón abajo.';
                if (gbtn) { gbtn.disabled = false; gbtn.textContent = inApp ? ('🎁 Cargar mi ' + (pct || 'extra') + (pct ? ' extra' : '') + ' ahora') : ('📲 Instalar ahora y cargar el ' + (pct || 'extra') + (pct ? ' extra' : '')); }
                gb.style.display = ''; card.dataset.gift = '1'; _igSheet = g;
                if (later) later.textContent = inApp ? 'Después' : '🎰 Seguir jugando · lo cargo después';
                if (o.giftOnly) {
                    if (t) t.textContent = '🎁 Tu extra por instalar la app';
                    if (s) s.textContent = 'Te lo cargamos sobre tu última carga apenas instales la app.';
                }
            } else { gb.style.display = 'none'; card.dataset.gift = ''; if (later) later.textContent = 'Después'; }
        }
        if (b) b.style.display = (o.giftOnly || o.plain) ? 'none' : '';
        // #735 (owner): en las cargas siguientes (sin extra por instalar) el MISMO cartel, sin ningún botón, y se va a los 3 s.
        if (later) later.style.display = o.plain ? 'none' : '';
        card.classList.toggle('pn-plain', !!o.plain);
        card.classList.add('show');
        card.setAttribute('aria-hidden', 'false');
        // #563 (owner): es una BURBUJA temporal (no tapa el inicio): se va sola a los 15 s. Si traía la oferta del extra por instalar,
        // queda el botón negro grande arriba de "Cambiar menú" ("lo instalo después").
        clearTimeout(_pnTimer);
        // #727 (owner): con el extra por instalar, el cartel se QUEDA hasta que elija (instalar / jugar ahora / lo cargo después); sin regalo, 15 s.
        if (card.dataset.gift !== '1') _pnTimer = setTimeout(() => { try { hidePlayNow(); } catch (_) {} }, o.plain ? 3000 : 15000);
    }
    let _pnTimer = null;
    // #294: "Después" / "Seguir jugando": si el cartel trae la oferta del extra, queda PENDIENTE (barra de abajo).
    function playNowLater() {
        const card = _el('playNowCard');
        if (card && card.dataset.gift === '1') return installGiftLater();
        hidePlayNow();
    }
    function hidePlayNow() { clearTimeout(_pnTimer); const c = _el('playNowCard'); if (c) { c.classList.remove('show'); c.setAttribute('aria-hidden', 'true'); c.dataset.gift = ''; c.dataset.test = ''; } }
    // #296 (owner): "Jugar ahora" abre la plataforma AFUERA de la página (ventana aparte /jugar.html con el login
    // automático ya hecho y una línea finita arriba "‹ Volver a cargas") — así no ven el delay de la app. Vale con y
    // sin la app instalada.
    // #632 (owner): "también cuando la gente carga adjuntando comprobante y le aparece el botón para jugar": con la app instalada
    // "Jugar ahora" abre el casino ADENTRO (y el panel Carga rápida se abre solo, #631); en navegador sigue aparte (#296).
    function playNow(pid) {
        hidePlayNow();
        try { VIP.ui.hideModal('profileModal'); } catch (_) {}
        try { if (VIP.ui && VIP.ui._casinoOpen) return; } catch (_) {} // #727: ya está adentro del casino → sólo se cierra el cartel
        openPlatform(pid || 'girox'); // #695: siempre adentro (con Carga rápida)
    }
    // Botón chiquito "test" (manual y automática): muestra el cartel como quedaría con una carga de ejemplo.
    function playNowTest() {
        const pid = (_platforms && (_platforms.preferredPlatform || _platforms.lastPlatform || _platforms.defaultPlatform)) || 'girox';
        // #294: el test muestra el cartel COMPLETO: carga de ejemplo + el % extra por instalar la app (50% de $10.000).
        showPlayNow({ platform: pid, amount: 10000, bonus: 0, gift: { amount: 5000, pct: 50, baseAmount: 10000 }, test: true });
    }

    // ---------------- #283/#290: % EXTRA POR INSTALAR LA APP (primera carga) ----------------
    // (owner: "en la primera carga ofrecer una carga gratis si no instaló la app, para retención: 'quiero
    //  jugar y después vengo a instalar' → botón grande abajo PENDIENTE; o instalar en el momento y
    //  reclamar al instante"). El server ofrece (metadata.kind='install_gift_offer') y acredita SOLO desde
    //  la app instalada con notificaciones (token FCM standalone). Estados: offered → deferred → claimed.
    let _ig = null;              // último estado conocido ({status, amount, expiresAt, …})
    const _igSeen = new Set();   // ids de mensajes de oferta ya mostrados
    function _igFmt(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }
    function _igPct(o) { const p = (o && o.pct != null ? o.pct : (_ig && _ig.pct)); return p != null && p !== '' ? Math.round(Number(p)) + '%' : ''; }
    async function _igFetch(path, method) {
        const r = await fetch(VIP.config.API_URL + path, {
            method: method || 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (VIP.state && VIP.state.currentToken) },
            body: method === 'POST' ? '{}' : undefined
        });
        const j = await r.json().catch(() => ({}));
        return { ok: r.ok, j };
    }
    async function _igInit() {
        if (!VIP.state || !VIP.state.currentToken) return;
        try {
            const { ok, j } = await _igFetch('/api/install-gift/status');
            if (!ok || !j) return;
            _ig = j;
            _igPaintBar();
            // #740 (owner): "de donde sea que instale la app, si tiene pendiente un 50% que sea AUTOMÁTICO siempre". En la app instalada,
            // con extra pendiente (ofrecido o 'lo cargo después'), se reclama solo al abrir; si el server todavía no registró la
            // instalación (token de notificaciones), se reintenta varias veces.
            if (_isStandalone() && _igPending() && !j.test) { _igAutoClaim(); return; }
            // Oferta sin responder → la hoja se muestra una vez por apertura de la app.
            if (j.status === 'offered' && Number(j.amount) > 0) {
                let shown = false;
                try { shown = !!sessionStorage.getItem('vip_ig_shown'); sessionStorage.setItem('vip_ig_shown', '1'); } catch (_) {}
                if (!shown) showInstallGift(j);
            }
        } catch (_) {}
    }
    function _igPending() { return !!(_ig && (_ig.status === 'deferred' || _ig.status === 'offered') && Number(_ig.amount) > 0); }
    // #740: reclamo AUTOMÁTICO del extra pendiente en la app instalada (reintenta si el server aún no ve la instalación).
    let _igAutoTries = 0, _igAutoT = null;
    async function _igAutoClaim() {
        if (!_isStandalone() || !_igPending() || (_ig && _ig.test)) return;
        if (_igAutoTries >= 6) return;
        _igAutoTries++;
        try {
            const { ok, j } = await _igFetch('/api/install-gift/claim', 'POST');
            if (ok && j && j.success) {
                _ig = Object.assign({}, _ig || {}, { status: 'claimed' });
                hideInstallGift(); _igPaintBar();
                try { VIP.ui.showToast(j.message || ('🎁 ¡Listo! Te cargamos ' + _igFmt(j.amount) + ' extra por instalar la app.'), 'success'); } catch (_) {}
                setTimeout(() => { try { VIP.ui.syncBalance(); } catch (_) {} }, 1000);
                try { showPlayNow({ platform: j.platform || 'girox', amount: j.amount, bonus: 0, plain: true }); } catch (_) {}
                return;
            }
            const code = j && j.code;
            if (code === 'NOT_STANDALONE') { try { VIP.notifications.requestNotificationPermission(); } catch (_) {} }
            else if (code === 'ALREADY_CLAIMED' || code === 'EXPIRED' || code === 'NOT_OFFERED') { _ig = Object.assign({}, _ig || {}, { status: code === 'ALREADY_CLAIMED' ? 'claimed' : (code === 'EXPIRED' ? 'expired' : 'none') }); _igPaintBar(); return; }
        } catch (_) {}
        clearTimeout(_igAutoT); _igAutoT = setTimeout(_igAutoClaim, [4000, 10000, 20000, 45000, 90000, 180000][_igAutoTries - 1] || 180000);
    }
    try { document.addEventListener('visibilitychange', () => { if (!document.hidden && _isStandalone() && _igPending()) { _igAutoTries = Math.min(_igAutoTries, 3); _igAutoClaim(); } }); } catch (_) {}
    // #719 (owner): INSTALAR LA APP dentro del casino, sin fricción: barra fija abajo mientras NO esté instalada (con el extra pendiente
    // si lo hay, o el % extra de la primera carga), y una línea en el cartel de carga acreditada. Tocarla abre la oferta / instala.
    function _igExtraPct() { const e = _fdJ && Number(_fdJ.extra); return e > 0 ? Math.round(e) + '%' : (_igPct(_ig) || ''); }
    // #722 (owner): la barra fija de #719 se ELIMINÓ ("está mal"): el aviso de instalar funciona como en el menú completo (la oferta se
    // queda hasta que elijan instalar o después) y "después" vive como botón en la Carga rápida, abajo de Soporte.
    // #731 (owner): sin barra al pie del casino; el pendiente va DENTRO de la Carga rápida (`_igQuickBtnHtml`). Sólo limpia restos.
    function _igPaintCasinoBar() { try { const b = _el('casinoIgBar'); if (b) b.remove(); const ov = _el('casinoOverlay'); if (ov) ov.classList.remove('has-ig'); const p = _el('casinoLoadPanel'); if (p && _quickOpen) toggleCasinoLoad(true); } catch (_) {} }
    function casinoInstall() { if (_igPending()) installGiftOpen(); else { try { VIP.appTest.doInstall(); } catch (_) {} } }
    // #722: botón de instalar dentro de la Carga rápida (abajo de "Ir a Soporte"), sólo sin app instalada: con extra pendiente muestra el
    // monto; si todavía no cargó, el % extra de la primera carga. Si ya cargó y no hay extra pendiente, no se muestra.
    function _igQuickBtnHtml() {
        // #726/#731 (owner): instalar vive en la barra de la base; acá SÓLO el recordatorio del extra PENDIENTE (eligió "lo cargo después").
        // #839 (owner): "que le quede pendiente el instalar la app y la plata pendiente para reclamar": se ve SIEMPRE mientras esté pendiente;
        // en el navegador = instalar + activar notificaciones; ya en la app instalada = botón para cobrarlo.
        if (!_igPending()) return '';
        const pct = _igPct(_ig);
        if (_isStandalone()) return '<button type="button" class="cl-btn cl-ig cl-ig-claim" onclick="VIP.home.installGiftClaim()">🎁 Cobrar mi extra pendiente: <b>+' + _igFmt(_ig.amount) + '</b>' + (pct ? ' (' + pct + ')' : '') + '</button>';
        return '<button type="button" class="cl-btn cl-ig" onclick="VIP.home.installGiftOpen()">🎁 Pendiente: <b>+' + _igFmt(_ig.amount) + '</b>' + (pct ? ' (' + pct + ' de tu carga)' : '') + ' · instalá la app y activá las notificaciones · <u>Instalar</u></button>';
    }
    function _igPaintBar() {
        try { _igPaintCasinoBar(); } catch (_) {} // #719
        try { if (_quickOpen) toggleCasinoLoad(true); } catch (_) {} // #839: la Carga rápida abierta muestra al toque el extra pendiente
        const bar = _el('installGiftBar'); if (!bar) return;
        const pending = _igPending();
        // #731 (owner): "en el completo y básico en la parte superior": en el básico el botón se mueve al tope de #basicView; en el resto
        // queda arriba del Inicio (antes de #entryView).
        try { const bv = _el('basicView'), ev = _el('entryView'); if (_homeMode === 'basic' && bv && bar.parentNode !== bv) bv.prepend(bar); else if (_homeMode !== 'basic' && ev && bar.nextElementSibling !== ev) ev.parentNode.insertBefore(bar, ev); } catch (_) {}
        bar.style.display = pending ? '' : 'none';
        document.body.classList.toggle('ig-pending', pending);
        if (!pending) return;
        const amt = _el('igBarAmt'), t = _el('igBarText');
        if (amt) amt.textContent = '+' + _igFmt(_ig.amount);
        const pb = _igPct(_ig);
        if (t) t.textContent = _isStandalone() ? ('Cargá tu ' + (pb || 'extra') + (pb ? ' extra' : '') + ' ahora') : ('Instalá la app y cargá tu ' + (pb || 'extra') + (pb ? ' extra' : ''));
    }
    let _igSheet = null; // oferta que muestra el cartel ahora ({amount, pct})
    // #294: la oferta se muestra ADENTRO del cartel "Jugar ahora" (con la última carga si la hubo en esta sesión).
    function showInstallGift(o) {
        o = o || {};
        showPlayNow(Object.assign({}, _lastDeposit || {}, { gift: o, test: !!o.test, giftOnly: !_lastDeposit }));
    }
    function hideInstallGift() { hidePlayNow(); }
    function _igIsTest() { const c = _el('playNowCard'); return !!(c && c.dataset.test === '1' && c.dataset.gift === '1'); }
    function installGiftOpen() { showInstallGift(_ig || {}); }
    function _igClearTest() { if (_ig && _ig.test) { _ig = null; _igPaintBar(); } }
    // "Ahora quiero jugar": la oferta queda PENDIENTE (botón grande abajo) hasta que instale y reclame.
    async function installGiftLater() {
        const test = _igIsTest();
        const amount = (_ig && Number(_ig.amount) > 0) ? _ig.amount : (_igSheet && _igSheet.amount) || 0;
        hideInstallGift();
        // Primero se pinta el botón grande (local): no depende de que el server conteste.
        _ig = Object.assign({}, _ig || {}, { status: 'deferred', amount, test: !!test });
        _igPaintBar();
        if (test) { try { VIP.ui.showToast('TEST: abajo quedó el botón grande. Tocalo para volver a ver la oferta; al apretar "Instalar/Cargar" se borra el test.', 'info'); } catch (_) {} return; }
        try { const { ok, j } = await _igFetch('/api/install-gift/defer', 'POST'); if (ok && j && j.status && j.status !== 'none') _ig = Object.assign({}, _ig, j); } catch (_) {}
        _igPaintBar();
        try { VIP.ui.showToast('👌 Seguí jugando tranquilo. Cuando quieras, tocá el botón de abajo para cargar tu extra.', 'info'); } catch (_) {}
    }
    // Botón principal: en la app instalada RECLAMA; en el navegador INSTALA (y la oferta queda pendiente).
    async function installGiftMain() {
        if (_igIsTest()) { hideInstallGift(); _igClearTest(); try { VIP.ui.showToast('TEST: acá se instala la app y se carga el extra (fin del test).', 'info'); } catch (_) {} return; }
        if (_isStandalone()) return installGiftClaim();
        hideInstallGift();
        try { await _igFetch('/api/install-gift/defer', 'POST'); } catch (_) {}
        if (_ig && _ig.status === 'offered') _ig.status = 'deferred';
        _igPaintBar();
        try { await VIP.ui.installApp(); } catch (_) {}
        try { VIP.ui.showToast('📲 Cuando termine, abrí la app desde tu pantalla de inicio y tocá el botón de abajo para cargar tu extra.', 'info'); } catch (_) {}
    }
    async function installGiftClaim() {
        if (_ig && _ig.test) { hideInstallGift(); _igClearTest(); return; }
        const btn = _el('pnGiftBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Cargando tu extra…'; }
        try {
            const { ok, j } = await _igFetch('/api/install-gift/claim', 'POST');
            if (ok && j && j.success) {
                _ig = Object.assign({}, _ig || {}, { status: 'claimed' });
                hideInstallGift(); _igPaintBar();
                try { VIP.ui.showToast(j.message || ('🎁 ¡Listo! Te cargamos ' + _igFmt(j.amount) + ' extra.'), 'success'); } catch (_) {}
                setTimeout(() => { try { VIP.ui.syncBalance(); } catch (_) {} }, 1000);
                showPlayNow({ platform: j.platform, amount: j.amount, bonus: 0 });
                return;
            }
            const code = j && j.code;
            if (code === 'NOT_STANDALONE') {
                if (_isStandalone()) {
                    // Instalada, pero el server todavía no tiene su token de notificaciones → pedir permiso y reintentar.
                    try { VIP.ui.showToast('🔔 Activá las notificaciones para cargarte el extra y volvé a tocar el botón.', 'info'); } catch (_) {}
                    try { VIP.notifications.requestNotificationPermission(); } catch (_) {}
                } else {
                    hideInstallGift();
                    try { VIP.ui.showToast('📲 El extra se carga desde la app instalada.', 'info'); } catch (_) {}
                    try { VIP.ui.installApp(); } catch (_) {}
                }
            } else if (code === 'EXPIRED' || code === 'ALREADY_CLAIMED' || code === 'NOT_OFFERED' || code === 'DEVICE_ALREADY_CLAIMED') {
                _ig = Object.assign({}, _ig || {}, { status: code === 'EXPIRED' ? 'expired' : 'claimed' });
                hideInstallGift(); _igPaintBar();
                try { VIP.ui.showToast((j && j.error) || 'Esta oferta ya no está disponible.', 'info'); } catch (_) {}
            } else {
                try { VIP.ui.showToast((j && j.error) || 'No se pudo acreditar. Probá de nuevo en un rato.', 'error'); } catch (_) {}
            }
        } catch (_) {
            try { VIP.ui.showToast('Sin conexión. Probá de nuevo.', 'error'); } catch (__) {}
        } finally {
            if (btn) { const pct = _igPct(_ig); btn.disabled = false; btn.textContent = _isStandalone() ? ('🎁 Cargar mi ' + (pct || 'extra') + (pct ? ' extra' : '') + ' ahora') : ('📲 Instalar ahora y cargar el ' + (pct || 'extra') + (pct ? ' extra' : '')); }
        }
    }
    // Botón chiquito "test" (carga automática): muestra la oferta como la vería el cliente ($10.000 de ejemplo).
    function installGiftTest() { playNowTest(); } // #294: un solo test (el cartel "Jugar ahora" con el extra adentro)
    // Instaló desde el navegador con la oferta pendiente → recordatorio de cómo reclamar.
    try {
        window.addEventListener('appinstalled', () => {
            if (_igPending()) setTimeout(() => { try { VIP.ui.showToast('✅ App instalada. Abrila desde tu pantalla de inicio y tocá el botón de abajo para cargar tu extra.', 'success'); } catch (_) {} }, 1500);
        });
    } catch (_) {}

    // ---------------- PRUEBAS DE PLATAFORMA (#235/#236): SIEMPRE dentro de la app ----------------
    // (owner: "esas páginas de prueba para jugar siempre adentro de la app, sin salir").
    // Plataforma con API → casino embebido con SSO (enterCasino). Sin API (Ganamos hoy) → su web
    // en el MISMO recuadro embebido (sin login automático hasta conectar la API).
    function _embedExternal(p) {
        const url = p && (p.playUrl || p.externalUrl);
        if (!url) { VIP.ui.showToast((p && p.name || 'Esa plataforma') + ' todavía no está disponible.', 'info'); return; }
        try {
            VIP.ui._casinoPlatform = p.id;
            VIP.ui._showCasinoFrame();
            VIP.ui._casinoOpen = true;
            const f = _el('casinoFrame');
            if (f) f.src = url; // el 'load' del iframe esconde "Entrando…" y muestra el recuadro
            clearTimeout(VIP.ui._casinoWatchdog);
            VIP.ui._casinoWatchdog = setTimeout(() => { if (VIP.ui._casinoOpen && VIP.ui._casinoFrameStuck) VIP.ui._casinoFrameStuck(); }, 15000);
            try { renderCasinoTabs(); } catch (_) {}
        } catch (e) { VIP.ui.showToast('No se pudo abrir ' + (p.name || ''), 'error'); }
    }
    // #245: modo PRUEBA (desde "Probá las plataformas" del soporte) = sólo la página de la plataforma,
    // SIN la burbuja/chat "Carga rápida" de adentro del casino (el owner: la página puede ponerse lenta).
    function _setCasinoTestMode(on) {
        try {
            const ov = _el('casinoOverlay');
            if (ov) ov.classList.toggle('casino-test', !!on);
            if (on) { try { if (VIP.ui._casinoChatUnmount) VIP.ui._casinoChatUnmount(); } catch (_) {} }
        } catch (_) {}
    }
    function openInApp(platformId, opts) {
        const test = !!(opts && opts.test);
        const list = (_platforms && _platforms.platforms) || [];
        const p = list.find(x => x.id === platformId) || { id: platformId, connected: platformId === 'girox', name: platformId };
        // #261: con la app instalada → adentro (sin carga rápida si es prueba); en navegador → aparte.
        openPlatform(p.id, { test });
    }
    function renderSupportTests() {
        const box = _el('supportTests');
        if (!box) return;
        const list = (_platforms && _platforms.platforms) || [];
        const items = list.filter(p => p.connected || p.playUrl || p.externalUrl);
        if (!items.length) { box.innerHTML = ''; return; }
        box.innerHTML = '<div class="st-head"><span class="st-label">Probá las plataformas</span><span class="st-note">Solo para mirar · sin salir de la app</span></div>' +
            '<div class="st-row">' + items.map(p =>
                '<button type="button" class="st-btn st-' + _esc(p.id) + '" onclick="VIP.home.openInApp(\'' + _esc(p.id) + '\', {test:true})">' +
                (p.logoUrl ? '<img class="st-logo" src="' + _esc(p.logoUrl) + '" alt="">' : '') +
                '<span>' + _esc(p.name) + '</span></button>').join('') + '</div>';
    }

    // ---------------- INFO DEL SERVICIO (#237): reseñas plegadas + niveles VIP ----------------
    // ---------------- REFERIDOS: cobro desde la app (#240) ----------------
    async function loadReferralClaimable() {
        const amt = _el('refClaimAmount'), btn = _el('refClaimBtn'), note = _el('refClaimNote');
        if (!amt || !btn) return;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/referrals/claimable', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } });
            const j = await r.json().catch(() => ({}));
            const d = (j && j.data) || {};
            const av = Number(d.availableAmount) || 0, locked = Number(d.lockedEstimate) || 0;
            amt.textContent = '$' + Math.round(av).toLocaleString('es-AR');
            btn.disabled = av <= 0;
            if (note) note.textContent = av > 0
                ? 'Tocá "Cobrar" y entra a tu cuenta al instante.'
                : (locked > 0 ? ('Llevás $' + Math.round(locked).toLocaleString('es-AR') + ' este mes (' + (d.currentPeriodLabel || '') + '). Se desbloquea el ' + (d.unlocksAt || '1 del mes que viene') + '.')
                             : ('Lo que generen tus referidos este mes se desbloquea el ' + (d.unlocksAt || '1 del mes que viene') + '.'));
        } catch (_) { if (note) note.textContent = 'No pudimos leer tu comisión. Reintentá.'; }
    }
    async function claimReferral() {
        const btn = _el('refClaimBtn'); if (!btn || btn.disabled) return;
        btn.disabled = true; const t = btn.textContent; btn.textContent = 'Acreditando…';
        try {
            const r = await fetch(VIP.config.API_URL + '/api/referrals/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VIP.state.currentToken } });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { VIP.ui.showToast(j.error || (j.message) || 'No se pudo cobrar', 'error'); btn.disabled = false; btn.textContent = t; return; }
            const c = (j.data && j.data.creditedAmount) || 0;
            VIP.ui.showToast('¡Listo! Te acreditamos $' + Math.round(c).toLocaleString('es-AR') + ' de comisiones 🤝', 'success');
            try { if (VIP.ui.syncBalance) VIP.ui.syncBalance(); } catch (_) {}
            btn.textContent = t;
            loadReferralClaimable();
            try { if (VIP.ui.openReferralModal && VIP.ui._loadReferralData) VIP.ui._loadReferralData(); } catch (_) {}
        } catch (_) { VIP.ui.showToast('Error de conexión', 'error'); btn.disabled = false; btn.textContent = t; }
    }
    try {
        const _origRef = VIP.ui && VIP.ui.openReferralModal;
        if (typeof _origRef === 'function') {
            VIP.ui.openReferralModal = async function () { const r = await _origRef.apply(this, arguments); try { loadReferralClaimable(); } catch (_) {} return r; };
        }
    } catch (_) {}

    function toggleRefHow() {
        const body = _el('refHowBody'), ch = _el('refHowChevron');
        if (!body) return;
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        if (ch) ch.textContent = open ? '▲' : '▼';
    }
    function toggleInfoRoulette() {
        const body = _el('infoRouletteBody'), ch = _el('infoRouletteChevron');
        if (!body) return;
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        if (ch) ch.textContent = open ? '▲' : '▼';
    }
    function toggleInfoVip() {
        const body = _el('infoVipBody'), ch = _el('infoVipChevron');
        if (!body) return;
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        if (ch) ch.textContent = open ? '▲' : '▼';
        if (open) { try { renderVipDetail(); } catch (_) {} }
    }
    // #641 (owner): Info RESUMIDO — cada tarjeta muestra la primera línea; "Ver más ›" la despliega y "Minimizar ▴" la vuelve a plegar.
    function infoMore(btn) {
        const p = btn && btn.previousElementSibling; if (!p) return;
        const open = p.classList.toggle('open'); btn.textContent = open ? 'Minimizar ▴' : 'Ver más ›';
        // #852: la tarjeta abierta ocupa todo el ancho de la grilla (estilo Pinterest)
        try { const card = btn.closest('.im-card'); if (card) { card.classList.toggle('open', open); if (open) setTimeout(() => { try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {} }, 60); } } catch (_) {}
    }
    // #852 (owner): "todo lo que es Info, estilo Pinterest: ver más y todo minimizado con sus títulos y recuadros, premium (si no queda muy
    // cargado)". Cada tema (p.im-sec + su botón Ver más) se agrupa en una TARJETA (.im-card) de una grilla de 2 columnas; mismos ids adentro.
    function _infoCardsWrap() {
        const box = _el('infoMsg'); if (!box || box.dataset.cards === '1') return;
        Array.from(box.querySelectorAll(':scope > .im-sec')).forEach((p) => {
            const btn = p.nextElementSibling && p.nextElementSibling.classList.contains('im-more') ? p.nextElementSibling : null;
            const card = document.createElement('div'); card.className = 'im-card' + (p.classList.contains('im-missions') ? ' im-card-missions' : '');
            if (p.id) card.dataset.for = p.id;
            box.insertBefore(card, p); card.appendChild(p); if (btn) card.appendChild(btn);
        });
        box.dataset.cards = '1'; box.classList.add('im-grid');
    }
    function infoFoldInit() {
        try { _infoCardsWrap(); } catch (_) {}
        try { document.querySelectorAll('#infoMsg .im-card').forEach((c) => { c.classList.remove('open'); const p = c.querySelector('.im-sec'); c.hidden = !!(p && (p.style.display === 'none' || p.hidden)); }); } catch (_) {}
        try {
            document.querySelectorAll('#infoMsg .im-sec').forEach((p) => {
                p.classList.remove('open'); const btn = p.nextElementSibling;
                if (!btn || !btn.classList.contains('im-more')) return;
                btn.textContent = 'Ver más ›';
                btn.style.display = (p.style.display === 'none' || p.hidden) ? 'none' : (p.scrollHeight > p.clientHeight + 4 ? '' : 'none');
            });
        } catch (_) {}
    }
    function toggleInfoReviews() {
        const body = _el('infoReviewsBody'), ch = _el('infoReviewsChevron');
        if (!body) return;
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        if (ch) ch.textContent = open ? '▲' : '▼';
    }
    function _ars(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }
    function renderVipDetail() {
        const box = _el('infoVipDetail');
        if (!box) return;
        const v = VIP.state && VIP.state.vipStatus;
        if (!v || v.enabled === false || !Array.isArray(v.levels) || !v.levels.length) { box.innerHTML = ''; return; }
        const cur = v.level && v.level.idx;
        const rows = v.levels.map(l =>
            '<div class="vip-row vip-row-2' + (cur === l.idx ? ' is-cur' : '') + '">' +
            '<span class="vip-name" style="color:' + _esc(l.color || '#fff') + '">' + _esc(l.emoji || '') + ' ' + _esc(l.name) + '</span>' +
            '<span class="vip-rake">' + Number(l.rakebackPct).toLocaleString('es-AR') + '% rakeback</span>' +
            '</div>').join('');
        const pct = Math.round(Math.max(0, Math.min(100, Number(v.progressPct) || 0)));
        const mine = v.level
            ? ('Tu nivel: <b style="color:' + _esc(v.level.color || '#fff') + '">' + _esc(v.level.emoji + ' ' + v.level.name) + '</b>' + (v.next ? ' · <b>' + pct + '%</b> hacia ' + _esc(v.next.name) : ''))
            : (v.next ? 'Todavía sin nivel · <b>' + pct + '%</b> hacia ' + _esc(v.next.emoji + ' ' + v.next.name) : '');
        box.innerHTML =
            '<p class="info-vip-p">Todo lo que apostás suma <b>para siempre</b> (nunca bajás). Al llegar a cada nivel cobrás un <b>bono en el momento</b> y desde ahí un <b>rakeback semanal</b>: un % de todo lo que apostaste en la semana, <b>ganes o pierdas</b>, que reclamás desde tu perfil.</p>' +
            (mine ? '<p class="info-vip-mine">' + mine + '</p>' : '') +
            '<div class="vip-row vip-row-2 vip-row-h"><span>Nivel</span><span>Rakeback</span></div>' + rows;
    }
    // Cuando se abre "Información del servicio", refrescar el detalle VIP con lo último cargado.
    try { document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('#infoBtn')) setTimeout(renderVipDetail, 60); }, true); } catch (_) {}

    // ---------------- INSTALAR APP (#249): el botón dice qué va a pasar ----------------
    // Android con prompt nativo → "se instala con un toque"; iPhone / sin prompt → "te mostramos cómo";
    // ya instalada → "App instalada ✓" (y el botón se apaga).
    function paintInstallButtons() {
        const b = _el('homeInstallAppBtn');
        const ua = navigator.userAgent || '';
        const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
        const isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
        const inApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|TikTok|Line\/|Snapchat/i.test(ua);
        let small = 'Acceso directo y avisos';
        if (standalone) small = 'App instalada ✓';
        else if (window.deferredPrompt) small = 'Se instala con un toque';
        else if (isIOS) small = 'Te mostramos cómo (Safari)';
        else if (inApp) small = 'Te abrimos en Chrome para instalar';
        else small = 'Te mostramos cómo';
        if (b) {
            const sm = b.querySelector('small'); if (sm) sm.textContent = small;
            b.disabled = !!standalone; b.style.opacity = standalone ? '.55' : '';
        }
        const hl = document.querySelector('#headerInstallBtn .tb-circle-lbl'); if (hl) hl.textContent = standalone ? 'Instalada' : 'Instalar';
        try { _paintInstallStrip(); } catch (_) {}
    }
    // #291 (owner): con la app instalada, al lado del saldo va el NIVEL VIP con su progreso en vez de
    // "Instalar app". El botoncito "test" simula la app instalada para verlo desde el navegador.
    let _installedTest = false;
    function _installedView() { return _installedTest || _isStandalone(); }
    function _paintInstallStrip() {
        const ib = _el('homeInstallAppBtn'), vs = _el('homeVipStrip');
        if (!ib || !vs) return;
        const on = _installedView();
        ib.style.display = on ? 'none' : '';
        vs.style.display = on ? '' : 'none';
        if (!on) return;
        const v = VIP.state && VIP.state.vipStatus;
        const lvl = _el('hvLevel'), sub = _el('hvSub'), fill = _el('hvFill'), pc = _el('hvPct');
        if (!v || v.enabled === false || !Array.isArray(v.levels) || !v.levels.length) {
            if (_installedTest) { // #294: en el test se ve como si fuera real (ejemplo), y se puede abrir la escalera
                if (lvl) { lvl.textContent = '🥈 Plata I'; lvl.style.color = '#c0c0c0'; }
                if (sub) sub.textContent = '40% hacia Plata II';
                if (fill) { fill.style.width = '40%'; fill.style.background = 'linear-gradient(90deg, #c0c0c0, #ffd700)'; }
                if (pc) pc.textContent = '40%';
                return;
            }
            if (lvl) { lvl.textContent = 'Nivel VIP'; lvl.style.color = ''; }
            if (sub) sub.textContent = 'cargando…';
            if (fill) fill.style.width = '0%';
            if (pc) pc.textContent = '';
            return;
        }
        const pct = Math.round(Math.max(0, Math.min(100, Number(v.progressPct) || 0)));
        if (lvl) { lvl.textContent = v.level ? (v.level.emoji + ' ' + v.level.name) : 'Sin nivel aún'; lvl.style.color = (v.level && v.level.color) || ''; }
        if (sub) sub.textContent = v.next ? (pct + '% hacia ' + v.next.name) : 'nivel máximo';
        if (fill) { fill.style.width = (v.next ? pct : 100) + '%'; fill.style.background = 'linear-gradient(90deg, ' + ((v.level && v.level.color) || '#00e5ff') + ', ' + ((v.next && v.next.color) || '#7c4dff') + ')'; }
        if (pc) pc.textContent = (v.next ? pct : 100) + '%';
    }
    function installedTestToggle() {
        _installedTest = !_installedTest;
        _paintInstallStrip();
        try { VIP.ui.showToast(_installedTest ? 'TEST: así se ve con la app instalada (nivel VIP al lado del saldo)' : 'TEST: vista normal (Instalar app)', 'info'); } catch (_) {}
    }
    // #294 (owner): tocar el nivel abre la ESCALERA completa (modal), también en el test (datos de ejemplo si
    // el server todavía no mandó el estado VIP). Niveles: VIP.state.vipStatus.levels o GET /api/vip/levels.
    let _vipLevelsCache = null;
    async function openVipLevels() {
        const v = VIP.state && VIP.state.vipStatus;
        let levels = (v && Array.isArray(v.levels) && v.levels.length) ? v.levels : _vipLevelsCache;
        if (!levels) {
            try { const r = await fetch(VIP.config.API_URL + '/api/vip/levels'); const j = await r.json(); levels = _vipLevelsCache = (j && j.levels) || []; } catch (_) { levels = []; }
        }
        const sample = !v && _installedTest;
        const curIdx = v ? (Number(v.levelIndex) || (v.level && v.level.idx) || 0) : (sample ? 3 : 0);
        const nextIdx = curIdx + 1;
        const pct = v ? Math.round(Math.max(0, Math.min(100, Number(v.progressPct) || 0))) : (sample ? 40 : 0);
        const cur = levels.find((l) => l.idx === curIdx), nx = levels.find((l) => l.idx === nextIdx);
        const mine = _el('vipLevelsMine'), list = _el('vipLevelsList');
        if (mine) mine.innerHTML = (cur ? 'Tu nivel: <b style="color:' + _esc(cur.color || '#fff') + '">' + _esc(cur.emoji + ' ' + cur.name) + '</b>' : 'Todavía sin nivel') + (nx ? ' · <b>' + pct + '%</b> hacia ' + _esc(nx.emoji + ' ' + nx.name) : ' · nivel máximo') + (sample ? ' <small>(ejemplo del test)</small>' : '');
        // #663 (owner): tarjetas como las de Reembolsos; abre PLEGADO mostrando sólo el nivel actual ("Nivel actual") — o el
        // próximo si todavía no tiene — y "Ver más ›" despliega la escalera completa.
        const _money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
        const keepIdx = cur ? curIdx : (nx ? nextIdx : null);
        if (list) list.innerHTML = levels.length ? levels.map((l) => {
            const isCur = !!cur && l.idx === curIdx, reached = !!cur && l.idx <= curIdx, isNext = l.idx === nextIdx, keep = l.idx === keepIdx;
            const badge = isCur ? '<span class="vl-badge cur">Nivel actual</span>' : reached ? '<span class="vl-badge ok">✓ Alcanzado</span>' : isNext ? '<span class="vl-badge nx">' + (cur ? 'Próximo' : 'Próximo nivel') + '</span>' : '';
            const black = /black/i.test(String(l.key || l.name));
            return '<div class="ur-card vl-card' + (isCur ? ' cur' : '') + (reached ? ' on' : '') + (isNext ? ' next' : '') + (keep ? ' keep' : '') + '">' +
                '<div class="ur-head"><i class="li vl-li" style="background:' + _esc(l.color || '#e60023') + '">' + _esc(l.emoji || '👑') + '</i><div><b>' + _esc(l.name) + ' ' + badge + '</b>' +
                '<small>Apostado acumulado <em>' + (Number(l.thresholdArs) > 0 ? _money(l.thresholdArs) : '—') + '</em></small></div></div>' +
                '<div class="ur-state">' + (Number(l.levelUpBonusArs) > 0 ? '🎁 Bono al subir <b>' + _money(l.levelUpBonusArs) + '</b> · ' : '') + '<b>' + Number(l.rakebackPct).toLocaleString('es-AR') + '%</b> rakeback semanal' + (black ? ' · 🖤 soporte personalizado por Telegram' : '') + '</div></div>';
        }).join('') : '<p class="vl-empty">No pudimos cargar los niveles. Probá de nuevo.</p>';
        if (list) { list.classList.add('vl-less'); const b = _el('vlLessBtn'); if (b) b.textContent = 'Ver más ›'; }
        try { VIP.ui.showModal('vipLevelsModal'); } catch (_) { const m = _el('vipLevelsModal'); if (m) m.classList.remove('hidden'); }
    }
    function vipStripOpen() { openVipLevels(); }
    // #659 (owner): "Ver menos" en los niveles VIP — deja sólo los alcanzados y el próximo; "Ver todos" vuelve a la lista completa.
    function vipLevelsLess(btn) { const l = _el('vipLevelsList'); if (!l) return; const less = l.classList.toggle('vl-less'); if (btn) btn.textContent = less ? 'Ver más ›' : 'Ver menos'; } // #663: plegado = sólo el nivel actual
    try {
        window.addEventListener('beforeinstallprompt', () => setTimeout(paintInstallButtons, 0));
        window.addEventListener('appinstalled', () => setTimeout(paintInstallButtons, 0));
    } catch (_) {}

    // ---------------- NIVEL VIP en el home (#253): barra + escalera desbloqueable ----------------
    function toggleVipCard() {
        const body = _el('vipCardBody'), ch = _el('vipChevron');
        if (!body) return;
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        if (ch) ch.textContent = open ? '▲' : '▼';
    }
    // #257: cartel "¡Felicidades por tu nuevo nivel!" con reclamo del bono eligiendo plataforma.
    let _vipClaimPlat = null;
    function renderVipClaim(v) {
        const box = _el('vipClaimCard');
        if (!box) return;
        const pend = (v && Array.isArray(v.pendingLevelBonuses)) ? v.pendingLevelBonuses : [];
        if (!pend.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
        const plats = ((_platforms && _platforms.platforms) || []).filter(p => p.connected);
        if (!_vipClaimPlat || !plats.some(p => p.id === _vipClaimPlat)) _vipClaimPlat = (plats.find(p => p.id === ((_platforms && _platforms.preferredPlatform) || 'girox')) || plats[0] || { id: 'girox' }).id;
        box.style.display = '';
        box.innerHTML = pend.map(l =>
            '<div class="vc-item">' +
            '<div class="vc-title">🎉 ¡Felicidades! Llegaste a <b style="color:' + _esc(l.color || '#fff') + '">' + _esc(l.emoji + ' ' + l.name) + '</b></div>' +
            '<div class="vc-amt">Tenés un bono de <b>$' + Math.round(l.bonusArs).toLocaleString('es-AR') + '</b> para reclamar</div>' +
            (plats.length > 1 ? '<div class="vc-plats">' + plats.map(p => '<button type="button" class="vc-plat' + (p.id === _vipClaimPlat ? ' on' : '') + '" onclick="VIP.home.pickVipClaimPlat(\'' + _esc(p.id) + '\')">' + _esc(p.name) + '</button>').join('') + '</div>' : '') +
            '<button type="button" class="vc-btn" onclick="VIP.home.claimLevelBonus(' + Number(l.idx) + ', this)">Reclamar en ' + _esc((plats.find(p => p.id === _vipClaimPlat) || { name: 'Girox' }).name) + '</button>' +
            '</div>').join('');
    }
    function pickVipClaimPlat(id) { _vipClaimPlat = id; renderVipClaim(VIP.state && VIP.state.vipStatus); }
    async function claimLevelBonus(idx, btn) {
        if (btn) { btn.disabled = true; btn.textContent = 'Acreditando…'; }
        try {
            const r = await fetch(VIP.config.API_URL + '/api/vip/level-bonus/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VIP.state.currentToken }, body: JSON.stringify({ idx, platform: _vipClaimPlat }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { VIP.ui.showToast(d.error || 'No se pudo reclamar', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Reclamar'; } return; }
            VIP.ui.showToast('🎉 ¡Listo! $' + Math.round(d.amount).toLocaleString('es-AR') + ' acreditados en ' + (d.label || ''), 'success');
            try { if (VIP.ui.syncBalance) VIP.ui.syncBalance(); } catch (_) {}
            try { if (VIP.refunds && VIP.refunds.loadVipStatus) await VIP.refunds.loadVipStatus(); } catch (_) {}
            renderVipClaim(VIP.state && VIP.state.vipStatus);
        } catch (_) { VIP.ui.showToast('Error de conexión', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Reclamar'; } }
    }
    function renderVipCard() {
        const card = _el('vipCard');
        if (!card) return;
        const v = VIP.state && VIP.state.vipStatus;
        try { renderVipClaim(v); } catch (_) {}
        if (!v || v.enabled === false || !Array.isArray(v.levels) || !v.levels.length) { card.style.display = 'none'; return; }
        card.style.display = '';
        const curIdx = Number(v.levelIndex) || (v.level && v.level.idx) || 0;
        const pct = Math.max(0, Math.min(100, Number(v.progressPct) || 0));
        const lvl = _el('vipHeadLvl'), nx = _el('vipHeadNext'), pc = _el('vipHeadPct'), fill = _el('vipBarFill');
        if (lvl) lvl.innerHTML = v.level ? ('<b style="color:' + _esc(v.level.color || '#fff') + '">' + _esc(v.level.emoji + ' ' + v.level.name) + '</b>') : 'Nivel VIP <b>— sin nivel aún</b>';
        if (nx) nx.textContent = v.next ? ('próximo nivel: ' + v.next.name) : 'nivel máximo alcanzado';
        if (pc) pc.textContent = v.next ? (Math.round(pct) + '%') : '100%';
        if (fill) { fill.style.width = (v.next ? pct : 100) + '%'; if (v.next && v.next.color) fill.style.background = 'linear-gradient(90deg, ' + (v.level && v.level.color || '#ff2d55') + ', ' + v.next.color + ')'; }
        const body = _el('vipCardBody');
        if (body) {
            // #256 (owner): sin plata a la vista — sólo niveles y porcentajes (los montos son internos).
            body.innerHTML = '<p class="vip-body-p">Cuanto más jugás, más subís. Cada nivel que alcanzás te <b>desbloquea plata</b> (el 🎁 de cada fila, se reclama acá) y un <b>rakeback semanal</b> (% de lo que apostás, ganes o pierdas).</p>' +
                v.levels.map(l => {
                    const reached = l.idx <= curIdx;
                    const isNext = v.next && l.idx === v.next.idx;
                    return '<div class="vip-lvl vip-lvl-3' + (reached ? ' on' : '') + (isNext ? ' next' : '') + '">' +
                        '<span class="vip-lvl-st">' + (reached ? '✓' : '🔒') + '</span>' +
                        '<span class="vip-lvl-name" style="color:' + _esc(l.color || '#fff') + '">' + _esc(l.emoji + ' ' + l.name) + (isNext ? ' <small>próximo</small>' : '') + '</span>' +
                        // #292 (owner): mostrar la plata que DESBLOQUEA cada nivel (bono al llegar) + rakeback; sin el apostado que falta.
                        '<span class="vip-lvl-win">' + (Number(l.levelUpBonusArs) > 0 ? '🎁 $' + Math.round(Number(l.levelUpBonusArs)).toLocaleString('es-AR') + ' · ' : '') + Number(l.rakebackPct).toLocaleString('es-AR') + '% rakeback</span>' +
                        '</div>';
                }).join('');
        }
        try { _paintInstallStrip(); } catch (_) {} // #291: nivel al lado del saldo (app instalada)
        try { _paintAvatar(); } catch (_) {} // #304: avatar/nivel en el perfil
    }
    try {
        const _origVip = VIP.refunds && VIP.refunds.loadVipStatus;
        if (typeof _origVip === 'function') {
            VIP.refunds.loadVipStatus = async function () { const r = await _origVip.apply(this, arguments); try { renderVipCard(); renderVipDetail(); } catch (_) {} return r; };
        }
    } catch (_) {}

    // ---------------- GUARDÁ TU ACCESO (#233): plegable ----------------
    function toggleAccess() {
        const body = _el('accessBody'), ch = _el('accessChevron');
        if (!body) return;
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        if (ch) ch.textContent = open ? '▲' : '▼';
        if (open) { try { VIP.autoload.init(); } catch (_) {} }
    }

    // ---------------- BURBUJA DE SOPORTE (#229) ----------------
    // Arranca ABIERTA (expandida) en cada entrada; el cliente la puede minimizar a un círculo
    // (sólo durante la sesión) y arrastrarla por la pantalla. Tocarla abre el chat.
    let _bubbleMin = false;
    function toggleBubble(ev) {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        const b = _el('supportBubble');
        if (!b) return;
        _bubbleMin = !_bubbleMin;
        b.classList.toggle('expanded', !_bubbleMin);
        b.classList.toggle('minimized', _bubbleMin);
        const m = b.querySelector('.sb-min');
        if (m) m.textContent = _bubbleMin ? '+' : '–';
    }
    function _initBubbleDrag() {
        const b = _el('supportBubble');
        if (!b || b.dataset.dragReady) return;
        b.dataset.dragReady = '1';
        let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;
        const onDown = (e) => {
            const p = e.touches ? e.touches[0] : e;
            dragging = true; moved = false; sx = p.clientX; sy = p.clientY;
            const r = b.getBoundingClientRect(); ox = r.left; oy = r.top;
        };
        const onMove = (e) => {
            if (!dragging) return;
            const p = e.touches ? e.touches[0] : e;
            const dx = p.clientX - sx, dy = p.clientY - sy;
            if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
            moved = true;
            const w = b.offsetWidth, hgt = b.offsetHeight;
            const nx = Math.min(window.innerWidth - w - 4, Math.max(4, ox + dx));
            const ny = Math.min(window.innerHeight - hgt - 4, Math.max(4, oy + dy));
            b.style.left = nx + 'px'; b.style.top = ny + 'px'; b.style.right = 'auto'; b.style.bottom = 'auto';
            if (e.cancelable) e.preventDefault();
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            if (moved) { b.dataset.justDragged = '1'; setTimeout(() => { delete b.dataset.justDragged; }, 250); }
        };
        b.addEventListener('touchstart', onDown, { passive: true });
        b.addEventListener('touchmove', onMove, { passive: false });
        b.addEventListener('touchend', onUp);
        b.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        // Un arrastre no debe abrir el chat.
        b.addEventListener('click', (e) => { if (b.dataset.justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
    }

    // ---------------- PLATAFORMAS ----------------
    async function loadPlatforms(force) {
        if (!force && _platforms && (Date.now() - _platformsAt) < 60000) return _platforms;
        if (!VIP.state || !VIP.state.currentToken) return null;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/platforms', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } });
            if (!r.ok) return _platforms;
            _platforms = await r.json();
            try { _paintPlatNav(); } catch (_) {} // #620
            _platformsAt = Date.now();
        } catch (_) {}
        return _platforms;
    }

    // #230 (owner): "¿dónde querés jugar? Ganamos o Girox, que la gente elija y después vea el CBU".
    // Tocar la tarjeta = ELEGIR (queda fija: las cargas van ahí). "Entrar ›" abre la plataforma
    // dentro de la app con la sesión iniciada.
    function _platBtn(p, preferred) {
        const label = _esc(p.name);
        const isPref = preferred === p.id;
        const soon = p.connected === false && p.id !== 'girox' && p.id !== ((_platforms && _platforms.defaultPlatform) || 'girox'); // #298/#300/#301: sin API → "Próximamente" (Girox y la default NUNCA)
        const onSelect = soon ? "VIP.ui.showToast('🔜 " + _esc(p.name) + ": próximamente', 'info')" : "VIP.home.choosePlatform('" + _esc(p.id) + "')";
        const logo = p.logoUrl ? '<img class="plat-logo" src="' + _esc(p.logoUrl) + '" alt="">' : '';
        return '<div class="plat-play-wrap' + (isPref ? ' is-pref' : '') + (soon ? ' soon' : '') + '">' +
            '<button type="button" class="plat-play-btn plat-' + _esc(p.id) + (isPref ? ' is-pref' : '') + (soon ? ' soon' : '') + '" onclick="' + onSelect + '">' +
            '<span class="plat-check">' + (isPref ? '✓' : '') + '</span>' +
            logo +
            '<span class="plat-play-name">' + label + '</span>' +
            // #255 (owner): Girox lleva un "Recomendado" chiquito en rojo; #286: DEBAJO del nombre (antes flotaba arriba).
            (p.id === 'girox' ? '<span class="plat-reco">Recomendado</span>' : '') +
            (soon ? '<span class="plat-soon-badge">Pronto</span>' : '') + // #353 (owner): se entiende sin tocar · #511: sutil
            // #271: sin "Entrar" acá (verlas = Inicio). Tocar la fija la suelta (vuelve el cartel al cargar).
            '<span class="plat-play-sub">' + (soon ? 'Pronto' : (isPref ? 'Fija · tus cargas van acá' : 'Tocá para dejarla fija')) + '</span>' +
            '</button></div>';
    }
    function choosePlatform(platformId) {
        const cur = (_platforms && _platforms.preferredPlatform) || null;
        if (cur === platformId) { setPreferred(null); return; } // #271: ya fija → soltarla (se pregunta en cada carga)
        setPreferred(platformId);
    }

    async function setPreferred(platformId) {
        try {
            const r = await fetch(VIP.config.API_URL + '/api/platforms/preferred', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VIP.state.currentToken },
                body: JSON.stringify({ platform: platformId })
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { VIP.ui.showToast(d.error || 'No se pudo guardar', 'error'); return; }
            if (_platforms) _platforms.preferredPlatform = d.preferredPlatform || null;
            renderPlatforms();
            VIP.ui.showToast(d.preferredPlatform ? ('Listo: tus cargas van directo a ' + (d.label || '')) : 'Listo: te preguntamos dónde jugar en cada carga', 'success');
        } catch (_) { VIP.ui.showToast('Error de conexión', 'error'); }
    }

    function renderPlatforms() {
        const box = _el('platformsButtons');
        if (!box) return;
        const list = (_platforms && _platforms.platforms) || [];
        const pref = (_platforms && _platforms.preferredPlatform) || null;
        if (!list.length) {
            // Sin respuesta del server (o backend viejo): girox como siempre.
            box.innerHTML = _platBtn({ id: 'girox', name: 'Girox', emoji: '🎰', connected: true, isDefault: true }, null);
        } else {
            box.innerHTML = _withPicaroja(list).map(p => _platBtn(p, list.length >= 2 ? pref : null)).join(''); // #949
        }
        try { renderSupportTests(); } catch (_) {}
        const sub = _el('platformsSub');
        if (sub) {
            const prefP = list.find(p => p.id === pref);
            sub.textContent = list.length >= 2
                ? (prefP ? ('Elegiste ' + prefP.name + ' · ahora transferí al CBU de abajo 👇')
                         : ('Tocá una para elegir · después transferí al CBU de abajo'))
                : 'Tocá para entrar con tu sesión iniciada.';
        }
    }

    // #260 (owner): el casino se abre APARTE, en una pestaña propia con nuestra barra "‹ Volver a la
    // app" arriba (/jugar.html) y el casino ocupando el resto. La pestaña se abre PRIMERO (dentro del
    // gesto del usuario, si no el bloqueador de pop-ups la mata) y recién después se pide el link de
    // login único por API (un solo uso, 60 s). Sin API (Ganamos) → su web. test:true → la home pública.
    async function openPlatformTab(platformId, opts) {
        const test = !!(opts && opts.test);
        const list = (_platforms && _platforms.platforms) || [];
        const p = list.find(x => x.id === platformId) || { id: platformId, name: platformId, connected: platformId === 'girox', playUrl: null, externalUrl: null };
        let win = null;
        try {
            win = window.open('', '_blank');
            if (win && win.document) win.document.write('<!doctype html><meta charset="utf-8"><title>Entrando…</title><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#06070d;color:#ff6b6b;font-family:system-ui,sans-serif;font-size:18px;font-weight:800">🎰 Entrando a ' + _esc(p.name) + '…</body>');
        } catch (_) { win = null; }
        let url = null, err = null;
        try {
            if (test || !p.connected) {
                url = p.playUrl || p.externalUrl || null;
                if (!url) err = (p.name || 'Esa plataforma') + ' todavía no está disponible.';
            } else {
                VIP.ui._casinoPlatform = p.id;
                let r = await VIP.ui._fetchCasinoSession(20000);
                if (!r.ok && r.retryable) { await new Promise(res => setTimeout(res, 1500)); r = await VIP.ui._fetchCasinoSession(20000); }
                if (r.ok) url = r.url; else err = r.error || 'No pudimos abrirte el casino. Intentá de nuevo.';
            }
        } catch (_) { err = 'Sin conexión. Intentá de nuevo.'; }
        if (!url) { try { if (win && !win.closed) win.close(); } catch (_) {} VIP.ui.showToast(err || 'No se pudo abrir', 'error'); return; }
        const wrapper = '/jugar.html?p=' + encodeURIComponent(p.id) + '&n=' + encodeURIComponent(p.name || 'Casino') + '&app=' + encodeURIComponent(location.origin + '/') + '#u=' + encodeURIComponent(url);
        if (win && !win.closed) win.location.href = wrapper;
        else location.href = wrapper; // pop-up bloqueado → misma pestaña ("Volver" trae de vuelta)
    }

    // #261 (owner): APARTE sólo para quien NO tiene la app (navegador, así no pierde el acceso);
    // con la app instalada (standalone) el casino va ADENTRO (más rápido, al cerrar vuelve al home).
    function _isStandalone() {
        try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; } catch (_) { return false; }
    }
    function openPlatform(platformId, opts) {
        const test = !!(opts && opts.test);
        // #695 (owner): "en Entrar a la página no figura el chat de carga rápida" → el casino con sesión se abre SIEMPRE ADENTRO
        // (overlay con Carga rápida, Retirar e Ir a Soporte), también en navegador. La pestaña aparte (/jugar.html) queda sólo
        // para el modo prueba (sitio público, sin sesión) fuera de la app instalada. Antes (#261) en navegador iba aparte.
        if (test && !_isStandalone()) return openPlatformTab(platformId, { test });
        const list = (_platforms && _platforms.platforms) || [];
        const p = list.find(x => x.id === platformId) || { id: platformId, name: platformId, connected: platformId === 'girox' };
        if (test) _embedExternal({ id: p.id, name: p.name, playUrl: p.playUrl || p.externalUrl, externalUrl: p.externalUrl });
        else if (p.connected) { try { VIP.ui.enterCasino(p.id); } catch (_) {} }
        else _embedExternal(p);
        _setCasinoTestMode(test);
        // #631 (owner): al entrar a jugar (JUGÁ AQUÍ, Entrar a jugar, pestañas) el panel de Carga rápida (datos + adjuntar) se abre solo
        // apenas carga el casino; la ✕ lo cierra. En modo prueba no.
        // #713 (owner): entrando por GIROX DIRECTO (menú girox o desde la landing; opts.embed) la burbuja va SIEMPRE abierta y el panel se
        // abre solo; entrando a jugar desde OTRO menú (completo/básico/intermedio) la burbuja arranca MINIMIZADA (sólo el logo) y el
        // panel cerrado, para no molestar.
        const direct = !!(opts && opts.embed);
        // #729 (owner): "cada vez que la gente entra a Girox, siempre con la burbuja minimizada para que pueda ver la página": el panel
        // arranca CERRADO en todos los casos (queda la burbuja logo + CARGA RÁPIDA) y un aviso de 5 s debajo dice que se puede mover.
        // #798 (owner): "cuando abren la app después del registro, que aparezca Girox para jugar y ABIERTA la carga rápida" ⇒ hasta la
        // primera carga (body.nodep) el panel entra desplegado; después de la primera carga entra cerrado como antes (#723).
        // #843 (owner): "que no tape toda la pantalla: cuando la gente entra por pauta, que aparezca abierto; después, ya cerrado, que lo abran
        // ellos" ⇒ abierto solo UNA vez (primera entrada desde la landing, `vip_from_pauta`), después arranca cerrado (queda la burbuja).
        setTimeout(() => { _setCasinoTestMode(test); _setupCasinoQuick(); if (!test) { _quickDismissed = false;
            let first = false; try { first = sessionStorage.getItem('vip_from_pauta') === '1' && localStorage.getItem('vip_cq_auto_done') !== '1'; if (first) { localStorage.setItem('vip_cq_auto_done', '1'); sessionStorage.removeItem('vip_from_pauta'); } } catch (_) {}
            try { toggleCasinoLoad(first); } catch (_) {} try { if (!first) _cqTipShow(); } catch (_) {} } }, 60);
    }
    function playOn(platformId) { openPlatform(platformId); }
    // #673 (owner): INSTALAR EN iPHONE CON LA SESIÓN. iOS no comparte el localStorage de Safari con la app instalada: el manifest
    // (que iOS captura al instalar) lleva un token de acceso de un solo uso del propio cliente + el menú elegido, y la app instalada
    // arranca logueada (auth.js tryAccessLink) con el mismo menú; Girox abre con SSO. Token cacheado 7 días por usuario.
    function _isIOS() { try { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; } catch (_) { return false; } }
    async function installManifestSync() {
        try {
            if (!_isIOS() || _isStandalone()) return;
            const u = VIP.state && VIP.state.currentUser && VIP.state.currentUser.username, tk = VIP.state && VIP.state.currentToken;
            if (!u || !tk) return;
            // #826: token FRESCO por carga de página (antes se reusaba 7 días desde localStorage: si ya se había canjeado — reinstalación —
            // o si otro link lo había pisado, la app instalada abría sin sesión). Se reusa sólo dentro de la misma pestaña por 30 min.
            try { localStorage.removeItem('vip_install_tok'); } catch (_) {}
            let c = null; try { c = JSON.parse(sessionStorage.getItem('vip_install_tok2') || 'null'); } catch (_) {}
            if (!c || c.u !== u || !c.t || Date.now() - (c.at || 0) > 30 * 60000) {
                const r = await fetch(VIP.config.API_URL + '/api/auth/install-link', { method: 'POST', headers: { 'Authorization': 'Bearer ' + tk }, credentials: 'same-origin' });
                const j = await r.json(); if (!r.ok || !j.token) return;
                c = { u, t: j.token, at: Date.now() }; try { sessionStorage.setItem('vip_install_tok2', JSON.stringify(c)); } catch (_) {}
            }
            const pref = _menuOn('girox') ? 'girox' : getMenuPref(), fixed = isMenuFixed(); // #937: la app instalada arranca en Girox
            const href = '/manifest.json?a=' + encodeURIComponent(c.t) + '&u=' + encodeURIComponent(u) + (pref ? '&menu=' + pref + (fixed ? '&fixed=1' : '') + (_userPickedMenu() ? '&picked=1' : '') : ''); // #980
            const l = document.querySelector('link[rel="manifest"]'); if (l && l.getAttribute('href') !== href) l.setAttribute('href', href);
        } catch (_) {}
    }
    // #670: Retirar desde la Carga rápida del casino. El modal de retiro vive en la página; CSS lo pone por encima del casino.
    // #687: salir del casino y abrir el chat de Soporte (modo mini)
    function casinoSupport() { try { VIP.ui.closeCasinoFrame(); } catch (_) {} setTimeout(() => { try { setHomeMode('mini'); } catch (_) {} }, 80); }
    function casinoWithdraw() { try { if (VIP.withdraw && VIP.withdraw.openWithdrawModal) VIP.withdraw.openWithdrawModal(); else VIP.ui.showToast('Retiros no disponibles ahora', 'error'); } catch (_) {} }

    // ---- Carga rápida DENTRO del casino (#261): formato CARGA (no chat), descartable como el soporte ----
    let _quickDismissed = false, _quickOpen = false;
    function _setupCasinoQuick() {
        const ov = _el('casinoOverlay');
        if (!ov) return;
        // El botón flotante de siempre ahora abre nuestro panel de carga (no el chat).
        try { VIP.ui.toggleCasinoChat = function () { toggleCasinoLoad(); }; } catch (_) {}
        const bubble = _el('casinoSupportBubble');
        if (bubble && !bubble.dataset.quickReady) {
            bubble.dataset.quickReady = '1';
            const x = document.createElement('button');
            x.type = 'button'; x.className = 'cq-x'; x.textContent = '✕'; x.title = 'Sacar (queda arriba)';
            x.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); dismissCasinoQuick(); });
            bubble.appendChild(x);
        }
        // Botón en la barra de arriba para traerlo de vuelta
        const bar = _el('casinoTopBar');
        if (bar && !_el('casinoQuickBtn')) {
            const row = bar.querySelector('.casino-topbar-row');
            if (row) row.insertAdjacentHTML('beforeend', '<button type="button" id="casinoQuickBtn" class="casino-quick-btn" style="display:none" onclick="VIP.home.restoreCasinoQuick()" title="Carga rápida">💳<span class="cqb-txt"> Carga rápida</span></button>');
        }
        if (bubble) bubble.style.display = _quickDismissed ? 'none' : '';
        // #723: limpieza única de los estados viejos (posición arriba, mini) para que la burbuja vuelva a su lugar de siempre
        // #724: la burbuja vuelve a su lugar de siempre (abajo a la derecha). Un `top` guardado junto con un `bottom` fijo la estiraba como columna.
        try {
            if (!localStorage.getItem('vip_cq_reset724')) { ['vip_cq_pos', 'vip_cq_mini', 'vip_cq_top', 'vip_cq_reset723'].forEach((k) => localStorage.removeItem(k)); localStorage.setItem('vip_cq_reset724', '1'); }
            if (bubble) {
                bubble.classList.remove('cq-mini', 'cq-top');
                let pos = null; try { pos = JSON.parse(localStorage.getItem('vip_cq_pos') || 'null'); } catch (_) {}
                if (!(pos && pos.left >= 0 && pos.top >= 0)) { bubble.style.left = 'auto'; bubble.style.top = 'auto'; bubble.style.right = '16px'; bubble.style.bottom = 'calc(18px + env(safe-area-inset-bottom,0px))'; }
                bubble.style.height = ''; bubble.style.width = '';
            }
        } catch (_) {}
        const qb = _el('casinoQuickBtn'); if (qb) qb.style.display = _quickDismissed ? '' : 'none';
    }
    // #712 (owner): "cuando la gente carga dentro de la app rápida de Girox que le salte un cartel: ¡Buena suerte! Recordá que tenemos
    // muchos beneficios para vos dentro de nuestro menú completo, ¡no te lo pierdas! — 5 segundos o se puede sacar, en las primeras 5 cargas".
    // #892 (owner): "a la gente que no tiene la app, a la segunda carga un cartel de activá notificaciones para recibir beneficios exclusivos".
    // Desde la 2ª carga acreditada, sin la app instalada y sin notificaciones activas; si dice "ahora no", vuelve en otra carga cada 3 días.
    // iPhone sin la app: Safari no tiene notificaciones ⇒ el botón lleva a instalar la app.
    const NOTIF_CTA_KEY = 'vip_notif_cta_at';
    async function _notifCtaAfterDeposit() {
        try {
            if (_isStandalone()) return;
            const hasNotif = typeof Notification !== 'undefined' && Notification.permission === 'granted';
            if (hasNotif) return;
            try { const at = Number(localStorage.getItem(NOTIF_CTA_KEY) || 0); if (at && Date.now() - at < 3 * 86400000) return; } catch (_) {}
            const r = await fetch(VIP.config.API_URL + '/api/first-deposit-promo', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } });
            const j = await r.json().catch(() => ({}));
            if (!(Number(j && j.depositsCount) >= 2)) return;
            if (document.getElementById('notifCtaOverlay')) return;
            try { localStorage.setItem(NOTIF_CTA_KEY, String(Date.now())); } catch (_) {}
            const ios = _isIOS(); const noApi = typeof Notification === 'undefined';
            const ov = document.createElement('div'); ov.id = 'notifCtaOverlay'; ov.className = 'ncta-ov';
            ov.innerHTML = '<div class="ncta-card" role="dialog" aria-label="Activá las notificaciones"><div class="ncta-ico">🔔</div><h3>Activá las notificaciones</h3>'
                + '<p>Recibí <b>beneficios exclusivos</b>: bonos que sólo llegan por notificación y avisos al instante de tus cargas y retiros.</p>'
                + ((ios || noApi) ? '<p class="ncta-s">En tu celular las notificaciones llegan con la app instalada.</p>' : '')
                + '<button type="button" class="ncta-go" onclick="VIP.home.notifCtaGo()">' + ((ios || noApi) ? '📲 Instalar la app' : '🔔 Activar ahora') + '</button>'
                + '<button type="button" class="ncta-no" onclick="VIP.home.notifCtaClose()">Ahora no</button></div>';
            ov.addEventListener('click', (e) => { if (e.target === ov) notifCtaClose(); });
            document.body.appendChild(ov);
        } catch (_) {}
    }
    function notifCtaClose() { const o = document.getElementById('notifCtaOverlay'); if (o) o.remove(); }
    async function notifCtaGo() {
        notifCtaClose();
        try {
            if (_isIOS() || typeof Notification === 'undefined') { if (VIP.ui && VIP.ui.installApp) VIP.ui.installApp(); return; }
            if (Notification.permission === 'denied') { VIP.ui && VIP.ui.showToast && VIP.ui.showToast('Las notificaciones están bloqueadas: habilitalas en la configuración del navegador (candado al lado de la dirección).', 'info'); return; }
            if (typeof window.enableNotifications === 'function') await window.enableNotifications(); else await Notification.requestPermission();
            if (Notification.permission === 'granted' && VIP.ui && VIP.ui.showToast) VIP.ui.showToast('✅ Listo: te vamos a avisar de los beneficios exclusivos', 'success');
        } catch (_) {}
    }
    async function onDepositCredited(d) {
        try { localStorage.setItem(HAS_DEP_KEY, '1'); } catch (_) {} // #980: desde ahora entra a Girox directo
        try { setTimeout(_notifCtaAfterDeposit, 4500); } catch (_) {} // #892        try { setTimeout(function () { if (VIP.reviews && VIP.reviews.maybeOffer) VIP.reviews.maybeOffer('deposit'); }, 7000); } catch (_) {} // #875: después de la carga, si ya es la 5ª+
        try { _fdPromoP = null; _fdNotesPaint(); } catch (_) {} // refresca contador de cargas / guía
        try { setTimeout(storyBonusRefresh, 1500); } catch (_) {} // #742: el bono de la historia se consumió con esta carga
        try { if (!(VIP.ui && VIP.ui._casinoOpen)) return; } catch (_) { return; }
        // #722 (owner): con la carga acreditada, si el server ofreció el extra por instalar (primera carga sin la app), se muestra LA
        // MISMA hoja del menú completo (Instalar ahora / Ahora quiero jugar) y se queda hasta que elijan. Si elige "después", el botón
        // queda en la Carga rápida (bajo Soporte). Si no hay oferta, va el cartel "¡Buena suerte!" de 5 s.
        try {
            const { ok, j } = await _igFetch('/api/install-gift/status');
            if (ok && j) {
                _ig = j; _igPaintBar();
                if (!_isStandalone() && j.status === 'offered' && Number(j.amount) > 0) {
                    try { toggleCasinoLoad(false); } catch (_) {}
                    // #727 (owner): el mismo cartel del menú completo ("¡Entró tu carga de $X!" + "+50% extra por instalar la app" + Jugar ahora /
                    // Seguir jugando · lo cargo después), con el monto de ESTA carga; se queda hasta que elija.
                    _lastDeposit = { platform: 'girox', amount: Number(d && d.amount) || 0, bonus: 0 };
                    showPlayNow(Object.assign({}, _lastDeposit, { gift: j }));
                    return;
                }
            }
        } catch (_) {}
        try { toggleCasinoLoad(false); } catch (_) {} // #723 (owner): tras la carga se cierra el panel y listo
        // #735 (owner): sin extra por instalar (ya tiene la app o no es la primera carga) → el mismo cartel "¡Entró tu carga de $X!",
        // sin botones, 3 segundos. (Reemplaza al cartel "¡Buena suerte!" de #712.)
        try { _lastDeposit = { platform: 'girox', amount: Number(d && d.amount) || 0, bonus: 0 }; showPlayNow(Object.assign({}, _lastDeposit, { plain: true })); } catch (_) {}
    }
    // #714 (owner): "quiero darle unas felicitaciones a la gente: en breve ya sale su pago, recordá que tenemos muchos beneficios para vos
    // en el menú completo" — al pedir un retiro (desde donde sea), 5 s o ✕, mismo estilo.
    function onWithdrawRequested(amount) {
        try { if (VIP.ui && VIP.ui._casinoOpen) toggleCasinoLoad(false); } catch (_) {} // #723: tras el retiro se cierra el panel
        const old = _el('luckCard'); if (old) old.remove();
        const amt = Number(amount) || 0;
        document.body.insertAdjacentHTML('beforeend',
            '<div id="luckCard" class="luck-card luck-wd" role="status">' +
              '<button type="button" class="luck-x" onclick="VIP.home.luckClose()" aria-label="Cerrar">✕</button>' +
              '<div class="luck-t">🎉 ¡Felicitaciones!' + (amt ? ' <small>Retiro de $' + amt.toLocaleString('es-AR') + ' solicitado</small>' : '') + '</div>' +
              '<div class="luck-p"><b>En breve ya sale tu pago.</b> Recordá que tenemos <b>muchos beneficios para vos</b> en el <b>menú completo</b>.</div>' +
              '<button type="button" class="luck-btn" onclick="VIP.home.luckClose(); VIP.home.casinoFullMenu()">☰ Ver el menú completo ›</button>' +
            '</div>');
        clearTimeout(_luckT); _luckT = setTimeout(luckClose, 5000);
    }
    let _luckT = null;
    function luckClose() { clearTimeout(_luckT); const c = _el('luckCard'); if (c) { c.classList.add('out'); setTimeout(() => { try { c.remove(); } catch (_) {} }, 250); } }
    // #723 (owner): "la burbuja que diga Carga rápida nomás y si se carga que se cierre la ventana y listo, sencillo". Se fueron los modos
    // mini (#711/#716), "arriba sobre la marca" (#720/#721) y el aviso de mover (#717). Quedan: burbuja logo + CARGA RÁPIDA, arrastrable,
    // y el panel con ✕. Estas funciones quedan como no-op por compatibilidad.
    function _applyQuickMini() {}
    function _applyQuickTop() {}
    function _bubbleToBrand() {}
    function casinoQuickMini() { toggleCasinoLoad(false); }
    // #729 (owner): aviso "si te tapa, la podés mover" DEBAJO de la burbuja, 5 segundos, y se va solo.
    let _cqTipT = null;
    function _cqTipShow() {
        const ov = _el('casinoOverlay'), b = _el('casinoSupportBubble'); if (!ov || !b || b.style.display === 'none') return;
        let tip = _el('cqTip'); if (!tip) { ov.insertAdjacentHTML('beforeend', '<div id="cqTip" class="cq-tip">↔ Si te tapa el juego, movela donde quieras</div>'); tip = _el('cqTip'); }
        // #737: la burbuja vive al pie de la pantalla, así que el aviso va ARRIBA de ella (abajo quedaba fuera de pantalla y no se veía).
        const place = () => { try { const r = b.getBoundingClientRect(), o = ov.getBoundingClientRect(); const h = tip.offsetHeight || 26; tip.style.top = Math.max(4, r.top - o.top - h - 6) + 'px'; tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - tip.offsetWidth / 2 - o.left, o.width - tip.offsetWidth - 8)) + 'px'; } catch (_) {} };
        tip.classList.remove('out'); tip.style.display = ''; requestAnimationFrame(place); setTimeout(place, 250);
        clearTimeout(_cqTipT); _cqTipT = setTimeout(() => { try { tip.classList.add('out'); setTimeout(() => { try { tip.remove(); } catch (_) {} }, 300); } catch (_) {} }, 5000);
    }
    function casinoQuickClose() { toggleCasinoLoad(false); }
    function dismissCasinoQuick() {
        _quickDismissed = true; _quickOpen = false;
        const b = _el('casinoSupportBubble'); if (b) b.style.display = 'none';
        const p = _el('casinoLoadPanel'); if (p) p.style.display = 'none';
        const qb = _el('casinoQuickBtn'); if (qb) qb.style.display = '';
    }
    function restoreCasinoQuick() {
        _quickDismissed = false;
        const b = _el('casinoSupportBubble'); if (b) b.style.display = '';
        const qb = _el('casinoQuickBtn'); if (qb) qb.style.display = 'none';
        toggleCasinoLoad(true);
    }
    let _cqCbuTries = 0;
    function toggleCasinoLoad(force) {
        const ov = _el('casinoOverlay'); if (!ov) return;
        let p = _el('casinoLoadPanel');
        if (!p) {
            ov.insertAdjacentHTML('beforeend', '<div id="casinoLoadPanel" class="casino-load" style="display:none"></div>');
            p = _el('casinoLoadPanel');
        }
        _quickOpen = typeof force === 'boolean' ? force : !_quickOpen;
        // #737 (owner): la burbuja CARGA RÁPIDA sigue visible abajo aunque el panel esté abierto (sólo se esconde si la sacó con la ✕ chica).
        try { const bb = _el('casinoSupportBubble'); if (bb) bb.style.display = _quickDismissed ? 'none' : ''; } catch (_) {}
        if (!_quickOpen) { p.style.display = 'none'; return; }
        const cbu = (VIP.autoload && VIP.autoload.getCbu && VIP.autoload.getCbu()) || null;
        const list = (_platforms && _platforms.platforms) || [];
        const pref = (_platforms && _platforms.preferredPlatform) || null;
        // #598 (owner): panel CHICO y simple: los datos para copiar (alias · CBU · titular) y UN botón para adjuntar el comprobante.
        const row = (k, v) => v ? '<div class="cl-row"><small>' + k + '</small><b>' + _esc(v) + '</b><button type="button" class="cl-copy" onclick="VIP.ui.copyText(\'' + _esc(v) + '\')">Copiar</button></div>' : '';
        p.innerHTML =
            // #711 (owner): "–" minimiza (queda sólo el logo de PICA ROJA como burbuja movible); "✕" cierra y la burbuja vuelve a logo + texto.
            '<div class="cl-head"><span>💳 Carga rápida</span><button type="button" class="cl-close" onclick="VIP.home.casinoQuickClose()" title="Cerrar">✕</button></div>' + // #723: sólo ✕
            (cbu ? row('Alias', cbu.alias) + row('CBU', cbu.number) + row('Titular', cbu.titular) : (_cqCbuTries >= 3 ? '<div class="cl-meta">No pudimos traer los datos de la cuenta. Tocá "Ir a Soporte" y te los pasamos.</div>' : '<div class="cl-meta">cargando datos…</div>')) +
            // (#631: si los datos todavía no llegaron, se vuelve a pintar en 1,5 s)
            _fdNoteHtml() + // #626
            // #684 (owner): carga mínima clara también acá
            // #706 (owner): nota RESUMIDA con "Carga mínima $X" más grande; el botón Adjuntar lleva la etiqueta hasta la 5ª carga (body.fewdep)
            // #751 (owner): la carga mínima va ADENTRO del botón (siempre), sin la nota verde que ocupaba lugar
            (function () { const md = '$' + (Number(_platforms && _platforms.minDepositArs) || 2000).toLocaleString('es-AR'); const first = document.body.classList.contains('nodep'); return '<button type="button" class="cl-btn cl-attach' + (first ? ' cl-first' : '') + '" onclick="VIP.autoload.sendReceipt()">' + (first ? '⚡ PRIMERA CARGA · adjuntá tu comprobante' : '📎 Adjuntar comprobante') + _sbTagHtml() + '<small class="min-tag min-always">' + (first ? '⚠️ Aviso importante: carga mínima ' + md : 'Carga mínima ' + md + ' · con menos no se acredita') + '</small></button><div class="rcpt-note cl-rcpt">📸 Con todos los datos visibles: si no se ven, se rechaza</div>' + ((Number(_platforms && _platforms.depositRolloverX) || 0) > 0 ? '<div class="rcpt-note cl-rcpt cl-rx">🛡️ Antifraude: cada carga se juega ×' + Number(_platforms.depositRolloverX) + ' antes de retirarla</div>' : ''); })() + // #885 // #742: + bono de historia · #766: PRIMERA CARGA · #808
            // #670 (owner): Retirar desde adentro del casino (mismo flujo que el botón de afuera: datos + SMS + pago automático)
            '<button type="button" class="cl-btn cl-wd" onclick="VIP.home.casinoWithdraw()">💸 Retirar premio</button>' +
            // #687 (owner): botón para ir DIRECTO a Soporte desde adentro del casino
            '<button type="button" class="cl-btn cl-sup" onclick="VIP.home.casinoSupport()">💬 Ir a Soporte</button>' +
            _igQuickBtnHtml(); // #722 (owner): "instalar después" vive acá, abajo de Soporte
        p.style.display = '';
        _fdNotesPaint();
        // #839: sin datos ⇒ se PIDEN (antes sólo se re-pintaba esperando que otra pantalla los cargara); hasta 3 intentos.
        if (!cbu && _cqCbuTries < 3) { _cqCbuTries++; Promise.resolve(VIP.autoload && VIP.autoload.ensureCbu ? VIP.autoload.ensureCbu() : null).then((c) => setTimeout(() => { if (_quickOpen) toggleCasinoLoad(true); }, c ? 0 : 1500)).catch(() => {}); }
        if (cbu) _cqCbuTries = 0;
    }
    // ---------------- CASINO: barra superior con las plataformas (#222) ----------------
    // El owner: "cuando entra, en una barra superior que diga 'elegí cuál plataforma jugar',
    // y una vez que cargan y entran con saldo, que aparezca ahí 'volver al menú de cargas'".
    // Se inyecta en el overlay del casino (VIP.ui._showCasinoFrame) sin tocar su HTML.
    // #633 (owner 2026-10-20): ADENTRO del casino NO se cambia de plataforma ("si elige Girox, que aparezca Girox; para cambiar, saliendo").
    // La barra de arriba queda con "‹ Volver" y el nombre de la plataforma en la que está; las pestañas (#222) se eliminaron.
    function renderCasinoTabs() {
        const overlay = _el('casinoOverlay');
        if (!overlay) return;
        let bar = _el('casinoTopBar');
        if (!bar) {
            overlay.insertAdjacentHTML('afterbegin',
                '<div id="casinoTopBar" class="casino-topbar">' +
                  '<div class="casino-topbar-row">' +
                    '<button type="button" class="casino-back" onclick="VIP.ui.closeCasinoFrame()">‹ Volver</button>' +
                    // #700/#701 (owner): accesos en UNA sola línea con el mismo formato de la barra principal (ícono + etiqueta chica):
                    // Historias · Menú · Info · Perfil. Sin el texto "Estás en Girox · para cambiar, salí" (#701: le sacaba lugar al juego).
                    // #703/#707 (owner): orden Volver · Menú · [PICA ROJA OFICIAL con el logo, bien centrado] · Historias · Info · Perfil
                    '<button type="button" class="tn-btn" onclick="VIP.home.casinoFullMenu()" title="Elegir menú"><span class="tn-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></span><span class="tn-lbl">Menú</span></button>' +
                    // #917 (owner 2026-10-24): "acá adentro de Girox poné Sorteo mensual (NOVEDAD) con ese tamaño, sacá PICA ROJA y que se pueda
                    // expandir desde ahí adentro": el pill del medio abre la pantalla del sorteo (js/sorteos.js pinta el subtítulo).
                    // #935 (owner, captura de la gemela): con el sorteo ABIERTO va un banner DEBAJO de la barra y en el medio queda PICA ROJA; si lo
                    // cierran (–), queda la píldora "Sorteo mensual" en el medio, que lo vuelve a abrir. sorteos.js (paintCasino) maneja los dos.
                    '<span class="casino-brand" id="casinoBrand" aria-label="PICA ROJA oficial"><span class="cb-box"><img src="/icons/icon-192x192.png" alt=""><span class="cb-txt"><b>PICA ROJA</b><small>OFICIAL</small></span></span></span>' +
                    '<button type="button" class="casino-brand casino-srt" id="casinoSrtBtn" hidden onclick="VIP.sorteos.casinoBar(true)" aria-label="Sorteo mensual"><span class="cb-box"><span class="cb-ico" data-srt-brand-ico>🏆</span><span class="cb-txt"><b data-srt-brand-title>Sorteo mensual</b><small data-srt-brand-sub>NOVEDAD</small></span></span></button>' +
                    '<button type="button" class="tn-btn tn-stories" id="ctStories" onclick="VIP.stories.open()" title="Historias"><span class="tn-ico st-ring"><span class="st-core">▶</span><span class="st-badge" id="ctStoriesBadge" style="display:none">1</span></span><span class="tn-lbl">Historias</span></button>' +
                    '<button type="button" class="tn-btn" onclick="VIP.home.casinoInfo()" title="Información del servicio"><span class="tn-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M12 11v5.5M12 7.6v.2"/></svg></span><span class="tn-lbl">Info</span></button>' +
                    '<button type="button" class="tn-btn" onclick="VIP.home.openProfile()" title="Tu perfil"><span class="tn-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c.8-4 3.9-6 7.5-6s6.7 2 7.5 6"/></svg></span><span class="tn-lbl">Perfil</span></button>' +
                  '</div>' +
                  '<div id="casinoSrtBar" class="casino-srt-bar" hidden></div>' + // #935: banner del sorteo debajo de la barra
                '</div>');
            bar = _el('casinoTopBar');
        }
        try { if (VIP.sorteos && VIP.sorteos.paintCasino) VIP.sorteos.paintCasino(); } catch (_) {} // #935
        // #937 (owner): "en Girox directo, al iniciar, la Carga rápida abierta para cargar, siempre"
        if (_curPref === 'girox') setTimeout(() => { try { toggleCasinoLoad(true); } catch (_) {} }, 450);
        // #700: el contador de historias nuevas copia el de la barra principal; sin historias cargadas el botón igual abre el visor.
        try { const src = _el('storiesBadge'), dst = _el('ctStoriesBadge'); if (src && dst) { dst.textContent = src.textContent; dst.style.display = src.style.display; } const nh = _el('navHistorias'), cs = _el('ctStories'); if (nh && cs) cs.classList.toggle('has-active', nh.classList.contains('has-active') || nh.classList.contains('has-new')); } catch (_) {}
        document.body.classList.add('casino-open'); // #700: los modales (Info, Perfil, historias…) van por encima del casino
        try { _igPaintCasinoBar(); } catch (_) {} // #719: barra "Instalá la app" abajo del casino (si no está instalada)
        // (#701: ya no se pinta el título "Estás en <plataforma> · para cambiar, salí")
    }
    function switchPlatform(platformId) {
        openPlatform(platformId);
    }
    try {
        const _origShowFrame = VIP.ui && VIP.ui._showCasinoFrame;
        if (typeof _origShowFrame === 'function') {
            VIP.ui._showCasinoFrame = function () {
                const r = _origShowFrame.apply(this, arguments);
                try { renderCasinoTabs(); } catch (_) {}
                return r;
            };
        }
        // #700: al cerrar el casino se saca la clase que sube los modales
        const _origCloseFrame = VIP.ui && VIP.ui.closeCasinoFrame;
        if (typeof _origCloseFrame === 'function') {
            VIP.ui.closeCasinoFrame = function () {
                try { document.body.classList.remove('casino-open'); } catch (_) {}
                return _origCloseFrame.apply(this, arguments);
            };
        }
    } catch (_) {}
    // #700 (owner): accesos desde la barra del casino. "Menú completo" cierra el casino y pasa al menú completo (sin quedar fijo
    // si la persona entró por Girox directo: #678 sigue valiendo, se guarda 'full' como cualquier otra elección del selector).
    // #704 (owner): "que de ahí pueda elegir desde Menú el menú correspondiente" → cierra el casino y abre el SELECTOR de menús.
    function casinoFullMenu() { try { VIP.ui.closeCasinoFrame(); } catch (_) {} setTimeout(() => { try { openMenuChooser(); } catch (_) {} }, 120); }
    // #708 (owner): carga de PRUEBA (sólo testers, sólo entorno de prueba): POST /api/test/deposit → mismo camino que una carga manual.
    async function testDeposit() {
        let amt = prompt('Monto de la carga de prueba (pesos):', '5000'); if (amt == null) return;
        amt = Math.round(Number(String(amt).replace(/[^0-9]/g, '')) || 0); if (!amt) return;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/test/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VIP.state.currentToken }, body: JSON.stringify({ amount: amt }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { VIP.ui.showToast('❌ ' + (j.error || 'No se pudo'), 'error'); return; }
            VIP.ui.showToast('🧪 Carga de prueba de $' + amt.toLocaleString('es-AR') + ' acreditada', 'success');
            setTimeout(() => { try { if (VIP.ui.syncBalance) VIP.ui.syncBalance(); } catch (_) {} try { loadFirstGuide(true); } catch (_) {} try { loadStrategy(true); } catch (_) {} }, 1200);
        } catch (_) { VIP.ui.showToast('Error de conexión', 'error'); }
    }
    // #766 (owner): "en todos los Cargá ahora de las 3 secciones, un botón PRIMERA CARGA bien llamativo, que se agrande y achique, y que
    // diga cuánto es el mínimo de carga como aviso importante" — sólo hasta que haga la primera carga (body.nodep).
    // #958 (owner): "poné CARGÁ AQUÍ en grande; si tiene bono vigente (por publicidad o lo que sea) que diga 100% VIGENTE · APRETÁ AQUÍ, llamativo;
    // si no, CARGÁ AQUÍ". El % sale de lo que ya pinta la app: primera carga (.fd-pct) para quien nunca cargó, o la promo activa (.promo-live).
    function _bonusLivePct(on) {
        try {
            if (on) { const f = document.querySelector('.fd-pct'); const n = f && parseInt(String(f.textContent || '').replace(/\D/g, ''), 10); if (n > 0) return n; }
            const els = Array.from(document.querySelectorAll('.promo-live')).filter((e) => !e.hidden && e.offsetParent !== null && /\d+\s*%/.test(e.textContent || ''));
            if (els.length) { const m = String(els[0].textContent).match(/(\d+)\s*%/); if (m) return parseInt(m[1], 10); }
        } catch (_) {}
        return 0;
    }
    function _paintFirstLoad(on) {
        const md = '$' + (Number(_platforms && _platforms.minDepositArs) || 2000).toLocaleString('es-AR');
        const pct = _bonusLivePct(on); const label = pct > 0 ? '🎁 ' + pct + '% VIGENTE · APRETÁ AQUÍ' : '⚡ CARGÁ AQUÍ';
        const sub = (on ? '⚠️ Aviso importante: carga mínima ' : 'Carga mínima ') + '<b class="md-amt">' + md + '</b> · se acredita sola';
        try { const b = document.querySelector('#evCtaTop .ev-cta-b'), t = document.querySelector('#evCtaTop .ev-cta-t'), cta = _el('evCtaTop'); if (b && t) { b.textContent = label; t.innerHTML = sub; if (cta) cta.classList.toggle('ev-cta-live', pct > 0); } } catch (_) {}
        try { const bb = document.querySelector('#bvLoadBtn > span > b'), bt = document.querySelector('#bvLoadBtn .bv-min'), bl = _el('bvLoadBtn'); if (bb && bt) { bb.textContent = pct > 0 ? pct + '% VIGENTE · APRETÁ AQUÍ' : 'CARGÁ AQUÍ'; bt.innerHTML = 'Carga mínima <b class="md-amt">' + md + '</b>'; if (bl) bl.classList.toggle('ev-cta-live', pct > 0); } } catch (_) {} // #960: en el básico, subtítulo corto (se iba de cuadro)
        // #776 (BUG GRAVE, usuario real "al presionar Carga rápida se cuelga absolutamente todo"): acá se llamaba toggleCasinoLoad(true)
        // SIEMPRE; ese panel llama _fdNotesPaint → firstGuidePaint → _paintFirstLoad → toggleCasinoLoad… en bucle infinito por microtareas
        // (la promesa de la promo ya estaba resuelta) y la pestaña quedaba congelada. Ahora el panel abierto se repinta SÓLO si el estado
        // (con/sin primera carga) realmente cambió.
        if (_pflLast !== on) { _pflLast = on; try { if (_quickOpen) toggleCasinoLoad(true); } catch (_) {} }
    }
    let _pflLast = null; // #776
    // #742 (owner): bono reclamado desde una HISTORIA → "Adjuntar comprobante · Bono +X%" en el casino, el completo y el básico hasta
    // que lo use o venza. Sólo lo ve quien tocó "Reclamar ahora" en la historia.
    let _sb = { pct: 0, expiresAt: null };
    function _sbActive() { return !!(_sb && Number(_sb.pct) > 0 && _sb.expiresAt && new Date(_sb.expiresAt).getTime() > Date.now()); }
    function _sbTagHtml() { if (!_sbActive()) return ''; return '<small class="sb-tag">🎁 Bono +' + Math.round(_sb.pct) + '% en esta carga · vence ' + new Date(_sb.expiresAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + '</small>'; }
    function _sbPaint() {
        const on = _sbActive();
        document.body.classList.toggle('story-bonus', on);
        document.querySelectorAll('.sb-tag-slot').forEach((el) => { el.innerHTML = _sbTagHtml(); });
        try { const m = _el('loadHereMin'); if (m) { if (on) { if (!m.dataset.orig) m.dataset.orig = m.textContent; m.textContent = '🎁 Bono +' + Math.round(_sb.pct) + '% en esta carga · vence ' + new Date(_sb.expiresAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); } else if (m.dataset.orig) { m.textContent = m.dataset.orig; delete m.dataset.orig; } } } catch (_) {}
        try { if (_quickOpen) toggleCasinoLoad(true); } catch (_) {}
    }
    async function storyBonusRefresh() {
        try { const r = await fetch(VIP.config.API_URL + '/api/stories/bonus', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } }); const j = await r.json(); _sb = j || { pct: 0 }; } catch (_) {}
        _sbPaint();
    }
    setInterval(() => { try { if (_sbActive() || document.body.classList.contains('story-bonus')) _sbPaint(); } catch (_) {} }, 60000);
    function goGiroxDirect() { try { setMenuPref('girox', { quiet: true }); } catch (_) {} }
    // #714: retiro de PRUEBA (sólo testers, sólo entorno de prueba): POST /api/test/withdraw → mismo handler que el retiro real.
    async function testWithdraw() {
        let amt = prompt('Monto del retiro de prueba (pesos):', '10000'); if (amt == null) return;
        amt = Math.round(Number(String(amt).replace(/[^0-9]/g, '')) || 0); if (!amt) return;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/test/withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VIP.state.currentToken }, body: JSON.stringify({ amount: amt }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { VIP.ui.showToast('❌ ' + (j.error || 'No se pudo'), 'error'); return; }
            VIP.ui.showToast('🧪 Retiro de prueba de $' + amt.toLocaleString('es-AR') + ' solicitado', 'success');
            onWithdrawRequested(amt);
            setTimeout(() => { try { if (VIP.ui.syncBalance) VIP.ui.syncBalance(); } catch (_) {} try { VIP.chat.loadMessages(); } catch (_) {} }, 1200);
        } catch (_) { VIP.ui.showToast('Error de conexión', 'error'); }
    }
    // #702 (owner): Bases y condiciones DENTRO de la app (modal con /terminos.html embebido; en una pestaña aparte la PWA instalada
    // se iba a Safari). Lo usan el botón de los mensajes de Soporte y los links de Info y Perfil.
    function openTerms(ev) {
        try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (_) {}
        const f = _el('termsFrame'); if (f && !f.getAttribute('src')) f.setAttribute('src', '/terminos.html?v=' + Date.now());
        try { VIP.ui.showModal('termsModal'); } catch (_) { const m = _el('termsModal'); if (m) m.classList.remove('hidden'); }
    }
    // Info del servicio: mismo handler que el botón de la cabecera (app.js lo cuelga en #infoBtn).
    function casinoInfo() { try { const b = _el('infoBtn'); if (b) { b.click(); return; } } catch (_) {} try { VIP.ui.showModal('infoModal'); } catch (_) {} }

    // Botón "llave" de la cabecera (#222): cambiar la contraseña.
    // #806 (owner): "el cambio de clave apenas entren, que se lo pida como RECOMENDACIÓN y quede guardado en Perfil, formato Pinterest".
    // Si la clave guardada en el dispositivo es la inicial (asd123), a los pocos segundos de entrar aparece un cartel con "Cambiar ahora"
    // (abre el cambio de clave de siempre, que ya la guarda en el dispositivo y la muestra en Perfil) o "Más tarde" (vuelve a los 24 h).
    // Espera a que no haya otro cartel o el selector de menú abierto.
    function _pwRecoKey() { const u = (VIP.state && VIP.state.currentUser && VIP.state.currentUser.username) || 'x'; return 'vip_pwreco_' + u; }
    function _pwIsInitial() { try { const pw = VIP.autoload && VIP.autoload.getPassword && VIP.autoload.getPassword(); return pw === 'asd123'; } catch (_) { return false; } }
    function _pwRecoSchedule(tries) {
        tries = tries || 0; if (tries > 12) return;
        setTimeout(() => {
            try {
                if (!_pwIsInitial()) return;
                let last = 0; try { last = Number(localStorage.getItem(_pwRecoKey())) || 0; } catch (_) {}
                if (Date.now() - last < 24 * 3600 * 1000) return;
                const busy = document.body.classList.contains('mc-open') || document.querySelector('.modal:not(.hidden)') || document.querySelector('.play-now-card') || _el('pwRecoCard');
                if (busy) return _pwRecoSchedule(tries + 1);
                _pwRecoShow();
            } catch (_) {}
        }, tries ? 10000 : 6000);
    }
    function _pwRecoShow() {
        const d = document.createElement('div'); d.id = 'pwRecoCard'; d.className = 'pwreco-ov';
        d.innerHTML = '<div class="pwreco" role="dialog" aria-labelledby="pwRecoT">' +
            '<div class="pwreco-ico"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.4"/></svg></div>' +
            '<b id="pwRecoT">Te recomendamos cambiar tu clave</b>' +
            '<p>Estás usando la clave inicial. Poné una tuya: queda guardada en tu Perfil y es la misma para entrar a la app y a la plataforma.</p>' +
            '<button type="button" class="pwreco-go" onclick="VIP.home.pwRecoGo()">Cambiar ahora</button>' +
            '<button type="button" class="pwreco-later" onclick="VIP.home.pwRecoLater()">Más tarde</button></div>';
        d.addEventListener('click', (e) => { if (e.target === d) pwRecoLater(); });
        document.body.appendChild(d);
    }
    function _pwRecoClose() { try { localStorage.setItem(_pwRecoKey(), String(Date.now())); } catch (_) {} const c = _el('pwRecoCard'); if (c) c.remove(); }
    function pwRecoLater() { _pwRecoClose(); }
    function pwRecoGo() { _pwRecoClose(); openChangePassword(); }
    function openChangePassword() {
        try { VIP.ui.hideModal('settingsModal'); } catch (_) {}
        VIP.state.passwordChangePending = false;
        try { if (VIP.auth && typeof VIP.auth.prepareChangePasswordModal === 'function') VIP.auth.prepareChangePasswordModal(); } catch (_) {}
        VIP.ui.showModal('changePasswordModal');
    }

    // ---------------- CÓMO FUNCIONA ----------------
    function _money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }
    function _ladderText(tiers) {
        return (tiers || []).map((t) => {
            const rango = t.max == null
                ? 'más de ' + _money(t.min)
                : (t.min === 0 ? 'hasta ' + _money(t.max) : _money(t.min) + ' a ' + _money(t.max));
            return rango + ' → <b>' + t.pct + '%</b>';
        }).join(' · ');
    }

    function renderHowItWorks() {
        const ref = _el('hiwRefunds');
        const s = VIP.state && VIP.state.refundStatus;
        // Modal "Información del servicio" (#228): % máximos reales de semanal y mensual.
        try {
            if (s && (s.tiersByPeriod || s.tiers)) {
                const tbp = s.tiersByPeriod || { weekly: s.tiers, monthly: s.tiers };
                const mx = (ts) => (ts || []).reduce((m, t) => (t && t.pct > m ? t.pct : m), 0);
                const w = _el('infoWeeklyMax'), m = _el('infoMonthlyMax');
                if (w && mx(tbp.weekly)) w.textContent = mx(tbp.weekly);
                if (m && mx(tbp.monthly)) m.textContent = mx(tbp.monthly);
                // #269/#359: tarjeta "Reembolso" del Inicio — % máximo real entre DIARIO (#349), semanal y mensual.
                const top = Math.max(mx(tbp.daily), mx(tbp.weekly), mx(tbp.monthly));
                const sv = _el('evSvcRefund'); if (sv) sv.textContent = mx(tbp.daily) ? ('Diario ' + mx(tbp.daily) + '%') : ('hasta ' + top + '%'); // #447/#458 · #524 (owner): sólo "Diario 25%"
                const d = _el('infoDailyMax'); if (d && mx(tbp.daily)) d.textContent = mx(tbp.daily);
            }
        } catch (_) {}
        try { _easyPaint(); } catch (_) {} // #366: menú fácil con los % reales
        if (ref) {
            if (s && (s.tiersByPeriod || s.tiers)) {
                const tbp = s.tiersByPeriod || { weekly: s.tiers, monthly: s.tiers };
                const same = JSON.stringify(tbp.weekly) === JSON.stringify(tbp.monthly);
                let maxPct = 0;
                [tbp.weekly, tbp.monthly].forEach(ts => (ts || []).forEach(t => { if (t && t.pct > maxPct) maxPct = t.pct; }));
                ref.innerHTML =
                    '<b>🎁 Reembolsos de hasta ' + maxPct + '%</b> sobre lo que perdés con tu plata (los bonos no cuentan): ' +
                    '<b>semanal</b> se reclama lunes y martes, <b>mensual</b> desde el día 7. ' +
                    (same
                        ? '<span class="hiw-ladder">' + _ladderText(tbp.weekly) + '</span>'
                        : '<span class="hiw-ladder">🗓️ Semanal: ' + _ladderText(tbp.weekly) + '<br>📆 Mensual: ' + _ladderText(tbp.monthly) + '</span>') +
                    ' Se cobran solos desde el recuadro de arriba.';
            } else {
                ref.innerHTML = '<b>🎁 Reembolsos</b> semanales (lunes y martes) y mensuales (desde el día 7) según lo que perdiste con tu plata. Se reclaman solos desde el recuadro de arriba.';
            }
        }
        const pl = _el('hiwPlatforms');
        if (pl) {
            const list = (_platforms && _platforms.platforms) || [];
            if (list.length >= 2) {
                pl.innerHTML = '<b>🎮 Tenés ' + list.length + ' plataformas para jugar:</b> ' +
                    list.map(p => '<b>' + _esc((p.emoji || '') + ' ' + p.name) + '</b>').join(' y ') +
                    '. Cuando llega tu transferencia te preguntamos en cuál querés el saldo. Si no elegís, va a la última que usaste.';
            } else {
                pl.innerHTML = '<b>🎮 Jugás en</b> ' + _esc(list[0] ? (list[0].emoji + ' ' + list[0].name) : '🎰 Girox') + ': la carga entra sola en tu cuenta.';
            }
        }
    }

    function toggleHow() {
        const body = _el('hiwBody');
        const btn = _el('hiwToggle');
        if (!body) return;
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        if (btn) btn.textContent = hidden ? 'Ocultar ▲' : 'Ver ▼';
    }

    // ---------------- INIT ----------------
    let _inited = false;
    async function init() {
        // #266: primero el modo (chat principal / app completa) para que el primer paint ya sea el correcto.
        try { _initHomeMode(); } catch (_) {}
        // El panel viejo colapsable ("Ocultar menú") ya no aplica: el home es la carga.
        try {
            const hp = _el('homePanel'); if (hp) { hp.classList.remove('collapsed'); hp.style.maxHeight = 'none'; }
            const tg = _el('homePanelToggle'); if (tg) tg.style.display = 'none';
        } catch (_) {}
        // "Cómo funciona" vive arriba PLEGADO (#221): quien quiere leerlo lo abre; la
        // explicación completa además le llega por el chat (/sys_como_funciona).
        _inited = true;
        try { if (VIP.autoload) VIP.autoload.init(); } catch (_) {}
        try { _initBubbleDrag(); } catch (_) {}
        try { paintInstallButtons(); setTimeout(paintInstallButtons, 2500); } catch (_) {}
        await loadPlatforms(true);
        renderPlatforms();
        // #266: cartel "servicio completo" + nombre de la cabecera WhatsApp ("Cargas <plataforma default>").
        try { if (_platforms && _platforms.homeBanner) { _paintHomeBanner(_platforms.homeBanner); localStorage.setItem(HOME_BANNER_KEY, JSON.stringify(_platforms.homeBanner)); } } catch (_) {}
        try { _paintMinDeposit(_platforms && _platforms.minDeposit); } catch (_) {} // #299
        try { _paintRollovers(); } catch (_) {} // #885
        try { _paintActionBtns(_platforms && _platforms.actionBtns); } catch (_) {} // #385
        try { _paintEntryNews(_platforms && _platforms.entryNews); } catch (_) {} // #349
        try { _paintRefundPromo(_platforms && _platforms.refundPromo); } catch (_) {} // #372
        try { _paintSupportIntro(_platforms && _platforms.supportIntro); } catch (_) {} // #373
        try { refreshPendingDeposits(); } catch (_) {} // #376
        _paintWaHeadName();
        try { _igInit(); } catch (_) {} // #283: oferta / botón pendiente de la carga gratis por instalar la app
        try { storyBonusRefresh(); } catch (_) {} // #742
        // (#752: la tarjeta de Telegram del Inicio se sacó; paintTelegramCard queda sin tarjetas que pintar)
        try { renderEntryTabs(); _entryLoad(); } catch (_) {} // #267: lista real de plataformas en la entrada
        try { if (VIP.reviews && VIP.reviews.renderEntrySlider) VIP.reviews.renderEntrySlider(); } catch (_) {} // #270: reseñas al pie del Inicio
        renderHowItWorks();
        try { _applyTesterClass(); } catch (_) {} // #296: botones de test sólo para el usuario de prueba
        try { _avatarInit(); } catch (_) {} // #304
        try { _pwRecoSchedule(); } catch (_) {} // #806: recomendación de cambiar la clave inicial
        try { _menuReaskInit(); } catch (_) {} // #367: volver a preguntar fácil / completo tras 10 min afuera
        try { _paintPlatformTexts(); } catch (_) {} // #296: textos según cuántas plataformas hay
        try { renderVipDetail(); renderVipCard(); setTimeout(() => { renderVipDetail(); renderVipCard(); }, 4000); } catch (_) {}
    }

    // Enganches (una sola vez, al cargar el script):
    // 1) al mostrar la pantalla principal (login / sesión restaurada) → init.
    try {
        const _origShow = VIP.ui && VIP.ui.showChatScreen;
        if (typeof _origShow === 'function') {
            VIP.ui.showChatScreen = function () {
                const r = _origShow.apply(this, arguments);
                try { init(); } catch (_) {}
                return r;
            };
            window.showChatScreen = VIP.ui.showChatScreen;
        }
    } catch (_) {}
    // 2) escalera de reembolsos cargada → refrescar el resumen.
    try {
        const _origUpd = VIP.refunds && VIP.refunds.updateRefundButtons;
        if (typeof _origUpd === 'function') {
            VIP.refunds.updateRefundButtons = function () {
                const r = _origUpd.apply(this, arguments);
                try { renderHowItWorks(); } catch (_) {}
                return r;
            };
        }
    } catch (_) {}
    // 3) mensajes nuevos → contador / abrir el chat si hay que elegir plataforma.
    try {
        const _origAdd = VIP.chat && VIP.chat.addMessageToChat;
        if (typeof _origAdd === 'function') {
            VIP.chat.addMessageToChat = function (message) {
                const r = _origAdd.apply(this, arguments);
                try { _onIncoming(message); } catch (_) {}
                return r;
            };
        }
    } catch (_) {}

    VIP.home = { supportFaqOpen, supportFaqClose, openTelegramInvite, paintTelegramCard, storyBonusRefresh, goGiroxDirect, casinoInstall, onWithdrawRequested, testWithdraw, onDepositCredited, luckClose, casinoQuickMini, casinoQuickClose, testDeposit, openTerms, casinoFullMenu, casinoInfo, casinoSupport, firstGuideClose, installManifestSync, casinoWithdraw, vipLevelsLess, vpHelpToggle, vpHelpOpen, vpAreaPick, paintPfPhone, paintPfNotif, paintPfAvisos, setNotifLevel, openVerifyPhone, infoMore, infoFoldInit, platTap, supportClosedNotice, autoTap, toggleMenuPin, openTelegram, goHome, supportQuick, supportIntroToggle, refreshPendingDeposits, getMenuPref, setMenuPref, chooseMenu, openMenuChooser, closeMenuChooser, maybeShowMenuChooser, easyLoad, easyPlay, easyPlayPick, easyToggleMore, maybeFirstDepositPopup, fdGo, fdClose, loadStrategy, openMissions, toggleMissionsCard, basicPick, basicPlay, basicToggle, basicCopy, init, openSupport, closeSupport, toggleSupport, isSupportOpen, loadPlatforms, getHomeMode, setHomeMode, toggleHomeMode, syncWaHead: _mirrorHeadBits, renderEntryTabs, entrySwitch, entryOpen, openProfile, profileTogglePw, profileCopy, svcRefund, svcRoulette, showPlayNow, hidePlayNow, playNow, playNowTest, playNowLater, toggleEntryExpand, entryViewSite, installedTestToggle, vipStripOpen, openVipLevels, openAvatarPicker, pickAvatar, applyTesterClass: _applyTesterClass, showInstallGift, hideInstallGift, installGiftOpen, installGiftMain, installGiftLater, installGiftClaim, installGiftTest, entryShowSite, renderPlatforms, playOn, renderHowItWorks, toggleHow,
        playGame, // #782
        pwRecoGo, pwRecoLater, // #806
        renderCasinoTabs, switchPlatform, openChangePassword, setPreferred, toggleBubble, dismissBubble, restoreBubble, choosePlatform, paintInstallButtons, openPlatformTab, openPlatform, toggleCasinoLoad, dismissCasinoQuick, restoreCasinoQuick, toggleAccess, openInApp, renderSupportTests, toggleInfoReviews, toggleInfoVip, toggleInfoRoulette, renderVipDetail, toggleRefHow, toggleVipCard, renderVipCard, renderVipClaim, pickVipClaimPlat, claimLevelBonus, loadReferralClaimable, claimReferral,
        notifCtaGo: notifCtaGo, notifCtaClose: notifCtaClose, // #892
        get platformsData() { return _platforms; } };
    VIP.home.installManifestSync = installManifestSync; // #826
    Object.assign(VIP.home, { favOpenPicker, favClosePicker, favSearch, favMore, favToggle, favToggleTop, favPlay }); // #840
    Object.assign(VIP.home, { openFitPhone, closeFitPhone, fitFilter, fitPick, fitNudge, fitNudgeBottom, fitBottomAuto, fitStretch }); // #865/#867/#868
    // ---------------- #868 DESLIZAR DESDE EL COSTADO PARA VOLVER ----------------
    // Owner: "en los menús, cuando entrás, que puedas volver deslizando del lado izquierdo o derecho, como para volver al menú anterior".
    // Gesto desde el borde (≤ 22 px) izquierdo o derecho, horizontal ≥ 70 px y más horizontal que vertical ⇒ "volver": cierra lo de arriba de
    // todo (cartel → historia → casino) o vuelve al Inicio del menú elegido. Sobre el casino hay dos franjas finas en los bordes (el recuadro de
    // Girox se come los toques).
    function swipeBack() {
        try {
            const mods = Array.from(document.querySelectorAll('.modal:not(.hidden)')).filter((m) => m.offsetParent !== null || getComputedStyle(m).display !== 'none');
            if (mods.length) { const m = mods[mods.length - 1]; if (m.id && VIP.ui && VIP.ui.hideModal) VIP.ui.hideModal(m.id); else m.classList.add('hidden'); return true; }
            const sv = document.getElementById('storyViewer'); if (sv && (sv.classList.contains('open') || sv.getAttribute('aria-hidden') === 'false') && VIP.stories && VIP.stories.close) { VIP.stories.close(); return true; }
            const ios = document.querySelector('.ios-install-modal'); if (ios) { ios.remove(); return true; }
            if (VIP.ui && VIP.ui._casinoOpen && VIP.ui.closeCasinoFrame) { VIP.ui.closeCasinoFrame(); return true; }
            if (_homeMode === 'full' || _homeMode === 'mini') { goHome(); return true; }
        } catch (_) {}
        return false;
    }
    (function _swipeInit() {
        let sx = 0, sy = 0, edge = false, t0 = 0;
        const EDGE = 22;
        document.addEventListener('touchstart', (e) => { const t = e.touches && e.touches[0]; if (!t) return; sx = t.clientX; sy = t.clientY; t0 = Date.now(); edge = sx <= EDGE || sx >= (window.innerWidth - EDGE) || !!(e.target && e.target.classList && e.target.classList.contains('swipe-edge')); }, { passive: true });
        document.addEventListener('touchend', (e) => {
            if (!edge) return; edge = false; const t = e.changedTouches && e.changedTouches[0]; if (!t) return;
            const dx = t.clientX - sx, dy = t.clientY - sy;
            if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0 < 900) swipeBack();
        }, { passive: true });
    })();
    VIP.home.swipeBack = swipeBack;
})();
