// =====================================================================
// RESEÑAS / OPINIONES
// - Widget público en la pantalla de registro/login (prueba social).
// - Card + modal de envío dentro de la app (1 reseña por usuario).
// Las reseñas nacen pendientes; recién aparecen en el registro cuando
// un admin las aprueba desde el panel.
// =====================================================================
(function () {
    'use strict';
    window.VIP = window.VIP || {};

    function _esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }
    function _starsHtml(n, size) {
        const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
        let h = '';
        for (let i = 1; i <= 5; i++) {
            h += '<span style="color:' + (i <= v ? '#ffd700' : '#555') + ';font-size:' + (size || 14) + 'px;">★</span>';
        }
        return h;
    }

    // ---------- Widget público en la pantalla de registro ----------
    async function initLogin() {
        const box = document.getElementById('loginReviewsWidget');
        if (!box) return;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/reviews/public?limit=12');
            if (!r.ok) return;
            const d = await r.json();
            if (!d || !d.total) { box.style.display = 'none'; return; }
            _renderLoginWidget(box, d);
        } catch (e) { /* best-effort */ }
    }

    function _renderLoginWidget(box, d) {
        const avg = Number(d.avgStars || 0);
        const total = Number(d.total || 0);
        const withText = (d.items || []).filter(function (it) {
            const c = (it.comment || '').trim();
            return c && !/^[1-5] estrellas$/.test(c);
        }).slice(0, 6);
        let html = '';
        html += '<div style="background:linear-gradient(135deg,rgba(212,175,55,0.10),rgba(106,13,173,0.10));border:1px solid rgba(212,175,55,0.35);border-radius:12px;padding:13px;margin-top:14px;text-align:left;">';
        html += '  <div style="text-align:center;margin-bottom:8px;">';
        html += '    <div style="letter-spacing:2px;">' + _starsHtml(avg, 18) + '</div>';
        html += '    <div style="color:#ffd700;font-weight:900;font-size:15px;margin-top:2px;">' + avg.toFixed(1) + ' / 5</div>';
        html += '    <div style="color:#b0b0b0;font-size:11px;">' + total + ' opinión' + (total === 1 ? '' : 'es') + ' de nuestros jugadores</div>';
        html += '  </div>';
        if (withText.length > 0) {
            html += '  <div style="display:flex;flex-direction:column;gap:6px;max-height:210px;overflow-y:auto;-webkit-overflow-scrolling:touch;">';
            for (const it of withText) {
                html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:7px 9px;">';
                html += '<div style="font-size:11px;">' + _starsHtml(it.stars, 11) + ' <span style="color:#888;font-size:10px;margin-left:4px;">' + _esc(it.maskedUsername || '***') + '</span></div>';
                html += '<div style="color:#ddd;font-size:11.5px;line-height:1.4;margin-top:2px;">"' + _esc(it.comment) + '"</div>';
                html += '</div>';
            }
            html += '  </div>';
        }
        html += '</div>';
        box.innerHTML = html;
        box.style.display = '';
    }

    // ---------- Card + modal de envío (in-app, logueado) ----------
    let _myReview = null;
    let _selectedStars = 5;

    async function initApp() {
        const card = document.getElementById('reviewHomeCard');
        if (!card || !VIP.state || !VIP.state.currentToken) return;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/reviews/mine', {
                headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken }
            });
            if (!r.ok) return;
            const d = await r.json();
            _myReview = d && d.review ? d.review : null;
            _renderHomeCard();
        } catch (e) { /* best-effort */ }
    }

    function _renderHomeCard() {
        const card = document.getElementById('reviewHomeCard');
        if (!card) return;
        if (_myReview) {
            card.innerHTML = '<div style="max-width:560px;margin:8px auto;background:rgba(0,0,0,0.35);border:1px solid rgba(212,175,55,0.25);border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:12px;">'
                + '<span>' + _starsHtml(_myReview.stars, 13) + '</span>'
                + '<span style="color:#ccc;flex:1;">Gracias por tu opinión 💛</span>'
                + '</div>';
            card.style.display = '';
            return;
        }
        card.innerHTML = '<div onclick="VIP.reviews.openModal()" style="cursor:pointer;max-width:560px;margin:8px auto;background:linear-gradient(135deg,#4a0080,#7c00cc);border:1px solid #d4af37;border-radius:10px;padding:9px 12px;display:flex;align-items:center;gap:8px;font-size:12.5px;">'
            + '<span style="font-size:17px;">⭐</span>'
            + '<span style="color:#fff;font-weight:700;flex:1;">¿Cómo la estás pasando? <span style="color:#ffd700;">Dejanos tu opinión</span></span>'
            + '<span style="background:#ffd700;color:#000;font-weight:900;padding:3px 9px;border-radius:6px;font-size:11px;">OPINAR</span>'
            + '</div>';
        card.style.display = '';
    }

    // ---------- Sección de reseñas dentro del modal de Información ----------
    async function renderInfoSection() {
        const box = document.getElementById('infoReviewsSection');
        if (!box) return;
        box.innerHTML = '<div style="text-align:center;color:#888;font-size:12px;padding:12px;">Cargando opiniones…</div>';

        let pub = null;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/reviews/public?limit=12');
            if (r.ok) pub = await r.json();
        } catch (e) { /* best-effort */ }

        if (_myReview === null && VIP.state && VIP.state.currentToken) {
            try {
                const r2 = await fetch(VIP.config.API_URL + '/api/reviews/mine', {
                    headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken }
                });
                if (r2.ok) { const d2 = await r2.json(); _myReview = d2 && d2.review ? d2.review : null; }
            } catch (e) { /* best-effort */ }
        }

        const avg = Number((pub && pub.avgStars) || 0);
        const total = Number((pub && pub.total) || 0);
        const withText = ((pub && pub.items) || []).filter(function (it) {
            const c = (it.comment || '').trim();
            return c && !/^[1-5] estrellas$/.test(c);
        }).slice(0, 6);

        let html = '<div style="margin-top:8px;border-top:1px solid rgba(212,175,55,0.3);padding-top:14px;">';
        html += '<h3 style="color:#ffd700;text-align:center;font-size:14px;font-weight:900;margin:0 0 8px;">⭐ Opiniones de nuestros jugadores</h3>';
        if (total > 0) {
            html += '<div style="text-align:center;margin-bottom:8px;">';
            html += '<div style="letter-spacing:2px;">' + _starsHtml(avg, 18) + '</div>';
            html += '<div style="color:#ffd700;font-weight:900;font-size:15px;">' + avg.toFixed(1) + ' / 5</div>';
            html += '<div style="color:#b0b0b0;font-size:11px;">' + total + ' opinión' + (total === 1 ? '' : 'es') + '</div>';
            html += '</div>';
        }
        if (withText.length > 0) {
            html += '<div style="display:flex;flex-direction:column;gap:6px;max-height:170px;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-bottom:10px;">';
            for (const it of withText) {
                html += '<div style="background:rgba(0,0,0,0.30);border-radius:8px;padding:7px 9px;">';
                html += '<div style="font-size:11px;">' + _starsHtml(it.stars, 11) + ' <span style="color:#888;font-size:10px;margin-left:4px;">' + _esc(it.maskedUsername || '***') + '</span></div>';
                html += '<div style="color:#ddd;font-size:11.5px;line-height:1.4;margin-top:2px;">"' + _esc(it.comment) + '"</div>';
                html += '</div>';
            }
            html += '</div>';
        } else {
            html += '<div style="text-align:center;color:#999;font-size:11.5px;margin-bottom:10px;">Todavía no hay opiniones. ¡Sé el primero!</div>';
        }
        if (_myReview) {
            html += '<div style="text-align:center;background:rgba(0,0,0,0.35);border:1px solid rgba(212,175,55,0.25);border-radius:10px;padding:9px;font-size:12px;color:#ccc;">'
                + _starsHtml(_myReview.stars, 14) + '<div style="margin-top:3px;">Gracias por tu opinión 💛</div></div>';
        } else {
            html += '<button onclick="VIP.reviews.openModal()" style="width:100%;background:linear-gradient(135deg,#ffd700,#f7931e);color:#000;border:none;padding:11px;border-radius:11px;font-weight:900;font-size:13px;cursor:pointer;">⭐ Dejá tu opinión</button>';
        }
        html += '</div>';
        box.innerHTML = html;
    }

    // ---------- #270: reseñas deslizantes al pie del Inicio (tipo Google) ----------
    // #279 (owner): "siempre 30 reseñas, al azar, que cambien con cada inicio" → random=1 y cache por
    // apertura de la app (vive mientras la página esté abierta; al reabrir, otro sorteo).
    let _pubCache = null;
    async function _loadPublic() {
        if (_pubCache) return _pubCache;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/reviews/public?limit=30&random=1');
            if (r.ok) _pubCache = await r.json();
        } catch (e) { /* best-effort */ }
        return _pubCache;
    }
    const _AV_COLORS = ['#1a73e8', '#d93025', '#188038', '#f9ab00', '#9334e6', '#e8710a', '#007b83'];
    function _avatar(name) {
        const n = String(name || '*');
        let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
        return '<span class="rv-avatar" style="background:' + _AV_COLORS[h % _AV_COLORS.length] + '">' + _esc(n.charAt(0).toUpperCase()) + '</span>';
    }
    function _gStars(n) {
        const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
        let h = '';
        for (let i = 1; i <= 5; i++) h += '<span class="' + (i <= v ? 'on' : '') + '">★</span>';
        return '<span class="rv-stars">' + h + '</span>';
    }
    // #350: estrellas con FRACCIÓN para el promedio (4,8 → cuatro llenas y la quinta al 80 %).
    function _gStarsFrac(n) {
        const v = Math.max(0, Math.min(5, Number(n) || 0));
        let h = '';
        for (let i = 1; i <= 5; i++) {
            const fill = Math.max(0, Math.min(1, v - (i - 1)));
            h += fill >= 1 ? '<span class="on">★</span>'
                : fill <= 0 ? '<span>★</span>'
                : '<span class="part" style="background:linear-gradient(90deg,#fbbc04 ' + Math.round(fill * 100) + '%,#dadce0 ' + Math.round(fill * 100) + '%);-webkit-background-clip:text;background-clip:text;color:transparent;">★</span>';
        }
        return '<span class="rv-stars">' + h + '</span>';
    }

    async function renderEntrySlider(boxId, opts) {
        const box = document.getElementById(boxId || 'entryReviews'); // #381: también en la pantalla de ingreso (#loginReviews)
        if (!box) return;
        const noAdd = !!(opts && opts.noAdd);
        const pub = await _loadPublic();
        const avg = Number((pub && pub.avgStars) || 0);
        const total = Number((pub && pub.total) || 0);
        const items = ((pub && pub.items) || []).filter(function (it) {
            const c = (it.comment || '').trim();
            return c && !/^[1-5] estrellas$/.test(c);
        }).slice(0, 30);
        if (!total && !items.length) { box.style.display = 'none'; return; }
        let html = '<div class="rv-head"><span class="rv-g">Opiniones de jugadores</span>' +
            (total ? '<span class="rv-avg">' + avg.toFixed(1) + ' ' + _gStarsFrac(avg) + ' <small>(' + total + ')</small></span>' : '') + '</div>';
        // #360 (owner): "Dejá tu opinión" FIJA a la izquierda (chica) y las reseñas deslizando al lado — nunca se pierde.
        html += '<div class="rv-row">';
        if (!noAdd) html += '<button type="button" class="rv-card rv-add rv-add-fixed" onclick="VIP.reviews.openModal()"><span class="rv-add-star">★</span><b>Dejá tu opinión</b></button>';
        html += '<div class="rv-track">';
        for (const it of items) {
            const name = it.maskedUsername || '***';
            html += '<div class="rv-card">' +
                '<div class="rv-top">' + _avatar(name) + '<div class="rv-who"><b>' + _esc(name) + '</b>' + _gStars(it.stars) + '</div></div>' +
                '<div class="rv-text">' + _esc(it.comment) + '</div>' +
                '</div>';
        }
        html += '</div></div>';
        box.innerHTML = html;
        box.style.display = '';
        _startAutoSlide(box.querySelector('.rv-track'));
    }
    // #280 (owner): "que se vayan deslizando automático y que el que entra también pueda deslizar".
    // Cada 3,5 s avanza una tarjeta (vuelve al principio al final). Si la persona toca/arrastra, se pausa
    // y retoma 6 s después de soltar. Sin movimiento si el sistema pide reducir animaciones.
    let _autoTimer = null, _resumeTimer = null;
    function _startAutoSlide(track) {
        clearInterval(_autoTimer); clearTimeout(_resumeTimer);
        if (!track) return;
        try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
        let paused = false;
        const step = function () {
            if (paused || document.hidden || !track.isConnected || track.offsetParent === null) return;
            const first = track.querySelector('.rv-card');
            if (!first) return;
            const gap = 6;
            const w = first.getBoundingClientRect().width + gap;
            const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
            if (atEnd) track.scrollTo({ left: 0, behavior: 'smooth' });
            else track.scrollBy({ left: w, behavior: 'smooth' });
        };
        const pause = function () { paused = true; clearTimeout(_resumeTimer); };
        const resumeLater = function () { clearTimeout(_resumeTimer); _resumeTimer = setTimeout(function () { paused = false; }, 6000); };
        ['touchstart', 'pointerdown', 'mousedown', 'wheel'].forEach(function (ev) { track.addEventListener(ev, pause, { passive: true }); });
        ['touchend', 'pointerup', 'mouseup', 'touchcancel'].forEach(function (ev) { track.addEventListener(ev, resumeLater, { passive: true }); });
        _autoTimer = setInterval(step, 3500);
    }

    // ---------- Reseñas dentro del pantallazo de pauta (adServiceModal) ----------

    // #875 (owner): después de la 5ª carga se invita a opinar con +20% de regalo sobre su carga (no antes). La oferta la decide el server
    // (/api/reviews/offer). `offer` = { amount, pct } ⇒ el cartel lo muestra; el premio se acredita al enviar, con cualquier puntaje.
    let _offer = null;
    async function maybeOffer(reason) {
        try {
            if (!VIP.state || !VIP.state.currentToken || _myReview) return;
            if (reason === 'open') { try { const k = 'vip_rv_offer_' + new Date().toISOString().slice(0, 10); if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch (_) {} }
            const r = await fetch(VIP.config.API_URL + '/api/reviews/offer', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } });
            const d = await r.json().catch(() => ({}));
            if (!d || !d.eligible) return;
            _offer = { amount: d.amount, pct: d.pct };
            if (document.querySelector('.modal:not(.hidden), #reviewModalOverlay, #notifCtaOverlay')) return; // no tapar otro cartel
            openModal();
        } catch (_) {}
    }
    function openModal() {
        closeModal();
        _selectedStars = 5;
        const ov = document.createElement('div');
        ov.id = 'reviewModalOverlay';
        // #450 (owner): modal con el estilo de la app (tarjeta blanca, estrellas rojas, botón rojo) — clases .rvm-* en pin.css
        ov.className = 'rvm-overlay';
        ov.onclick = function (e) { if (e.target === ov) closeModal(); };
        ov.innerHTML = '<div class="rvm-card">'
            + '<h2 class="rvm-t">' + (_offer ? '⭐ Tu opinión vale +' + _offer.pct + '%' : 'Tu opinión') + '</h2>'
            + '<p class="rvm-s">' + (_offer ? 'Ya hiciste varias cargas: contanos cómo la estás pasando y te regalamos <b>$' + Number(_offer.amount).toLocaleString('es-AR') + '</b> (' + _offer.pct + '% de tu última carga). Sea cual sea tu opinión.' : 'Contanos cómo la estás pasando. Se envía una sola vez.') + '</p>'
            + '<div id="reviewModalStars" class="rvm-stars"></div>'
            + '<textarea id="reviewModalComment" class="rvm-ta" maxlength="100" placeholder="Escribí tu comentario (opcional)"></textarea>'
            + '<div id="reviewModalMsg" class="rvm-msg"></div>'
            + '<button id="reviewModalSubmit" class="rvm-send" onclick="VIP.reviews.submit()">Enviar opinión</button>'
            + '<button class="rvm-close" onclick="VIP.reviews.closeModal()">Cerrar</button>'
            + '</div>';
        document.body.appendChild(ov);
        _paintModalStars();
    }

    function closeModal() {
        const ov = document.getElementById('reviewModalOverlay');
        if (ov) ov.remove();
    }

    function _paintModalStars() {
        const el = document.getElementById('reviewModalStars');
        if (!el) return;
        let h = '';
        for (let i = 1; i <= 5; i++) {
            h += '<span class="rvm-star' + (i <= _selectedStars ? ' on' : '') + '" onclick="VIP.reviews.setStars(' + i + ')">★</span>'; // #450
        }
        el.innerHTML = h;
    }

    function setStars(n) {
        _selectedStars = Math.max(1, Math.min(5, Number(n) || 5));
        _paintModalStars();
    }

    async function submit() {
        const btn = document.getElementById('reviewModalSubmit');
        const msg = document.getElementById('reviewModalMsg');
        const ta = document.getElementById('reviewModalComment');
        if (!_selectedStars) { if (msg) { msg.style.color = '#ff6b6b'; msg.textContent = 'Elegí las estrellas'; } return; }
        let comment = ((ta && ta.value) || '').trim().slice(0, 100);
        if (!comment) comment = _selectedStars + ' estrellas';
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }
        try {
            const r = await fetch(VIP.config.API_URL + '/api/reviews', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({ stars: _selectedStars, comment: comment })
            });
            const d = await r.json();
            if (!r.ok) {
                if (d && d.alreadyReviewed) {
                    _myReview = { stars: _selectedStars, comment: comment };
                    if (msg) { msg.style.color = '#ffd700'; msg.textContent = 'Ya habías opinado. ¡Gracias!'; }
                    setTimeout(function () { closeModal(); _renderHomeCard(); renderInfoSection(); _pubCache = null; renderEntrySlider(); }, 1400);
                    return;
                }
                if (msg) { msg.style.color = '#ff8080'; msg.textContent = (d && d.error) || 'Error'; }
                if (btn) { btn.disabled = false; btn.textContent = 'Enviar opinión'; }
                return;
            }
            _myReview = { stars: _selectedStars, comment: comment };
            const _g = d && d.gift; _offer = null;
            if (msg) { msg.style.color = '#66ff66'; msg.textContent = _g ? '✅ ¡Gracias! Te cargamos $' + Number(_g.amount).toLocaleString('es-AR') + ' de regalo.' : '✅ ¡Gracias! Tu opinión quedó enviada.'; }
            if (VIP.ui && VIP.ui.showToast) VIP.ui.showToast(_g ? '🎁 ¡Gracias! Te cargamos $' + Number(_g.amount).toLocaleString('es-AR') + ' (' + _g.pct + '%) por tu opinión' : '✅ ¡Gracias por tu opinión!', 'success');
            try { if (_g && VIP.ui && VIP.ui.syncBalance) setTimeout(VIP.ui.syncBalance, 2500); } catch (_) {}
            setTimeout(function () { closeModal(); _renderHomeCard(); renderInfoSection(); _pubCache = null; renderEntrySlider(); }, 1600);
        } catch (e) {
            if (msg) { msg.style.color = '#ff8080'; msg.textContent = 'Error de conexión'; }
            if (btn) { btn.disabled = false; btn.textContent = 'Enviar opinión'; }
        }
    }

    VIP.reviews = { initLogin: initLogin, initApp: initApp, openModal: openModal, closeModal: closeModal, setStars: setStars, submit: submit, renderInfoSection: renderInfoSection, renderEntrySlider: renderEntrySlider, maybeOffer: maybeOffer }; // #875
    try { setTimeout(function () { maybeOffer('open'); }, 9000); } catch (_) {}

    document.addEventListener('DOMContentLoaded', function () {
        initLogin();
        let tries = 0;
        const tick = function () {
            if (VIP.state && VIP.state.currentToken) {
                initApp();
            } else if (tries++ < 20) {
                setTimeout(tick, 1500);
            }
        };
        setTimeout(tick, 1000);
    });
})();
