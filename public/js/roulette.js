// =====================================================================
// RULETA DIARIA — 1 giro/día por user con PWA + notifs activadas
// =====================================================================
// Flujo:
//   1) Al cargar el home, fetch /api/roulette/status
//      - si NO elegible (sin FCM token) → no muestra nada
//      - si elegible y ya giró HOY → card mostrando resultado de hoy
//      - si elegible y NO giró → card "GIRAR LA RULETA"
//   2) Click "GIRAR" → abre modal con animación de ruleta, llama
//      POST /api/roulette/spin, muestra premio. Si gana, JUGAYGANA ya
//      acreditó server-side automático.
//   3) Transparencia: tabla de probabilidades visible en el modal
//      ("el premio más grande es el menos probable").
// =====================================================================
(function () {
    'use strict';
    window.VIP = window.VIP || {};

    let _state = null; // { eligible, alreadySpun, spin, prizes }
    let _spinning = false;

    function _esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s == null ? '' : s);
        return d.innerHTML;
    }
    function _fmt(n) { return Number(n || 0).toLocaleString('es-AR'); }

    async function loadStatus() {
        if (!VIP.state || !VIP.state.currentToken) return;
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/roulette/status`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (!r.ok) return;
            const d = await r.json();
            if (!d || !d.success) return;
            _state = d;
            renderHomeCard();
            _paintUnlock(); // #374: "$5.000" real en los textos de la app
        } catch (e) { /* best-effort */ }
    }

    // #374: pinta la carga mínima que desbloquea la ruleta en todos los .rl-min (Inicio, Menú fácil, Info).
    function _paintUnlock() {
        try {
            const min = _state && Number(_state.minDepositArs) > 0 ? Number(_state.minDepositArs) : 0;
            if (!min) return;
            document.querySelectorAll('.rl-min').forEach((el) => { el.textContent = '$' + _fmt(min); });
        } catch (_) {}
    }
    function renderHomeCard() {
        const c = document.getElementById('rouletteHomeCard');
        if (!c) return;
        if (!_state || !_state.eligible) {
            c.style.display = 'none';
            c.innerHTML = '';
            // Ocultar tambien el card separado por si quedo de antes.
            const sep = document.getElementById('rouletteRecentWinnersCard');
            if (sep) sep.style.display = 'none';
            return;
        }

        const spin = _state.spin;
        // Celda compacta con el mismo formato que el recuadro de usuario
        // (avatar dorado + etiqueta + estado). Tap → modal de spin.
        let subText;
        if (_state.alreadySpun && spin) {
            const won = Number(spin.prizeARS || 0) > 0;
            if (spin.prizeType === 'percent' || spin.status === 'percent_pending') {
                subText = '+' + _fmt(spin.prizePct) + '% próx. carga';
            } else if (won && spin.status === 'credited') {
                subText = 'Ganaste $' + _fmt(spin.prizeARS);
            } else if (won && spin.status === 'credit_failed') {
                subText = 'Escribinos';
            } else {
                subText = 'Volvé mañana';
            }
        } else if (Number(_state.pendingPct || 0) > 0) {
            subText = '+' + _fmt(_state.pendingPct) + '% pendiente';
        } else {
            subText = '¡GIRÁ HOY!';
        }

        c.innerHTML = '<div class="dash-roulette" onclick="VIP.roulette && VIP.roulette.open()">'
            + '<span class="dash-roulette-avatar">🎰</span>'
            + '<span class="dash-roulette-label">RULETA</span>'
            + '<span class="dash-roulette-sub">' + _esc(subText) + '</span>'
            + '</div>';
        c.style.display = '';

        // Ocultamos el card SEPARADO (el viejo).
        const sep = document.getElementById('rouletteRecentWinnersCard');
        if (sep) sep.style.display = 'none';
    }


    // Modal que se abre cuando el server rebota el giro porque al user
    // le faltan los pasos (app instalada o notifs). Detecta plataforma y
    // muestra el siguiente paso concreto + CTA.
    function _showNeedsAppModal() {
        const inApp = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                       window.navigator.standalone === true;
        const notifPerm = (typeof Notification !== 'undefined') ? Notification.permission : 'default';

        document.getElementById('rouletteNeedsAppModal')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'rouletteNeedsAppModal';
        overlay.className = 'rl-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        let b1, b2, b3, ctaTxt, ctaAction;
        if (!inApp) {
            b1 = '1'; b2 = '2'; b3 = '3';
            ctaTxt = '📲 Instalar la app ahora';
            ctaAction = 'window.VIP&&VIP.ui&&VIP.ui.installApp&&VIP.ui.installApp();document.getElementById(\'rouletteNeedsAppModal\').remove();';
        } else if (notifPerm !== 'granted') {
            b1 = '✓'; b2 = '✓'; b3 = '3';
            ctaTxt = '🔔 Activar notificaciones';
            ctaAction = '(async()=>{try{const p=await Notification.requestPermission();if(p===\'granted\')VIP.ui.showToast(\'✅ Listo, tocá Girar de nuevo\',\'success\');}catch(_){}document.getElementById(\'rouletteNeedsAppModal\').remove();})();';
        } else {
            b1 = '✓'; b2 = '✓'; b3 = '!';
            ctaTxt = '🔄 Refrescar';
            ctaAction = 'location.reload();';
        }
        const step = (n, t, s, done) => '<div class="rl-step' + (done ? ' done' : '') + '"><span class="rl-step-n">' + n + '</span><span class="rl-step-t"><b>' + t + '</b><small>' + s + '</small></span></div>';
        overlay.innerHTML =
            '<div class="rl-card rl-needs">' +
                '<div class="rl-emoji">🎰</div>' +
                '<h2 class="rl-title">Para girar la ruleta</h2>' +
                '<p class="rl-sub">Necesitamos asegurarnos de que sos vos: tenés que tener <b>la app instalada con notificaciones activas</b>.</p>' +
                '<div class="rl-steps">' +
                    step(b1, 'Instalá la app', 'desde Perfil → Instalar la app', b1 === '✓') +
                    step(b2, 'Abrila desde el ícono', 'en tu pantalla de inicio', b2 === '✓') +
                    step(b3, 'Activá las notificaciones', 'cuando la app te lo pida', false) +
                '</div>' +
                '<button type="button" class="rl-spin rl-cta" onclick="' + ctaAction + '">' + ctaTxt + '</button>' +
                '<button type="button" class="rl-close" onclick="document.getElementById(\'rouletteNeedsAppModal\').remove();">Cerrar</button>' +
            '</div>';
        document.body.appendChild(overlay);
    }

    // Card que aparece cuando el user ganó: lo invita a la comunidad para
    // recibir novedades (problemas de página, juegos de la semana,
    // problemas con el banco) y le aclara qué hacer si su WhatsApp
    // principal no funciona — revisar el número vigente en el home.
    function _communityRecommendCard() {
        const link = (window.VIP && VIP.state && VIP.state.communityLink) || '';
        const link2 = (window.VIP && VIP.state && VIP.state.communityLink2) || '';
        const label1 = (window.VIP && VIP.state && VIP.state.communityLabel) || 'COMUNIDAD 1';
        const label2 = (window.VIP && VIP.state && VIP.state.communityLabel2) || 'COMUNIDAD 2';
        let buttons = '';
        if (link) buttons += '<a class="rl-link" href="' + _esc(link) + '" target="_blank" rel="noopener" onclick="window.VIP&&VIP.communityClick&&VIP.communityClick(\'home_button\',\'' + _esc(link) + '\')">💬 <span>Entrar a ' + _esc(label1) + '</span><i>›</i></a>';
        if (link2) buttons += '<a class="rl-link rl-link-2" href="' + _esc(link2) + '" target="_blank" rel="noopener" onclick="window.VIP&&VIP.communityClick&&VIP.communityClick(\'home_button_2\',\'' + _esc(link2) + '\')">💬 <span>Entrar a ' + _esc(label2) + '</span><i>›</i></a>';
        if (!buttons) return '';
        return '<div class="rl-community"><div class="rl-sec-t">📢 Sumate a la comunidad</div>' +
            '<p>Códigos, novedades y los juegos de la semana: todo sale primero en <b>Telegram</b>.</p>' + buttons + '</div>';
    }

    function open() {
        const modal = document.getElementById('rouletteModal');
        if (!modal) return;
        if (!_state) { loadStatus(); }
        _renderModal();
        modal.style.display = 'flex';
    }

    function close() {
        const modal = document.getElementById('rouletteModal');
        if (modal) modal.style.display = 'none';
    }

    // #372 (owner): la ruleta con el estilo nuevo (blanco / gris / rojo, clases rl-* en css/pin.css), sin colores inline.
    function _renderModal(spinResult) {
        const modal = document.getElementById('rouletteModal');
        if (!modal) return;
        if (!_state) {
            modal.innerHTML = '<div class="rl-card rl-loading">⏳ Cargando…</div>';
            return;
        }
        const spin = spinResult || _state.spin;
        const alreadySpun = !!(spin && (spin.prizeARS != null));
        // #390 (owner): lista de premios SIN probabilidades ("eso es interno"); el server ya no las manda.
        const _prizeRows = (_state.prizes || []).map(function (p) {
            const val = p.type === 'percent' ? ('+' + _fmt(p.value) + '% en tu próxima carga')
                : (p.type === 'cash' ? ('$' + _fmt(p.value) + (p.rolloverX > 0 ? ' (rollover x' + p.rolloverX + ')' : '')) : 'Sin premio');
            return '<div class="rl-prize"><span class="rl-prize-n">' + _esc(p.emoji || '🎁') + ' ' + _esc(p.label) + '</span>' +
                '<span class="rl-prize-v">' + _esc(val) + '</span></div>';
        }).join('');
        // #666 (owner): premios RESUMIDOS en una línea (minimizado) + "Ver premios ›" despliega la lista completa.
        // #668 (owner): SOLO la línea resumida (sin lista desplegable), con "Sin premio" incluido — "ya es suficiente".
        const _prizeSum = (_state.prizes || []).map((p) => _esc(p.emoji || '🎁') + ' ' + _esc(p.type === 'percent' ? ('+' + _fmt(p.value) + '%') : (p.type === 'cash' ? ('$' + _fmt(p.value)) : 'Sin premio'))).join(' · ');
        const prizesHtml = _prizeRows
            ? '<div class="rl-prizes"><div class="rl-sec-t">Premios</div><div class="rl-prize-sum">' + (_prizeSum || 'Plata al instante') + '</div></div>'
            : '';
        const pendingHtml = (!alreadySpun && Number(_state.pendingPct || 0) > 0)
            ? '<div class="rl-pending">🎁 Tenés <b>+' + _fmt(_state.pendingPct) + '% extra</b> pendiente: se aplica solo en tu próxima carga.</div>'
            : '';
        const minDep = Number(_state.minDepositArs) > 0 ? Number(_state.minDepositArs) : 20000; // #669
        // #374: premio mayor destacado. #390: sin la chance ("1 cada N giros") — es interno.
        const topCash = (_state.prizes || []).filter((p) => p.type === 'cash' && Number(p.value) > 0).sort((a, b) => b.value - a.value)[0];
        const topHtml = topCash ? '<div class="rl-top"><span class="rl-top-k">🏆 Premio mayor</span><b>$' + _fmt(topCash.value) + '</b></div>' : '';
        let html = '<div class="rl-card">';
        html += '<button type="button" class="rl-x" onclick="VIP.roulette.close()" aria-label="Cerrar">✕</button>';
        html += '<div class="rl-head"><div class="rl-kicker">Todos los días</div><h2 class="rl-title">Ruleta diaria</h2><p class="rl-sub">Se desbloquea con <b>$' + _fmt(minDep) + '</b> cargados en el día (podés sumar cargas) · 1 giro gratis por día · si ganás, se acredita solo</p></div>';
        html += topHtml;

        if (alreadySpun) {
            const won = Number(spin.prizeARS || 0) > 0;
            if (spin.prizeType === 'percent' || spin.status === 'percent_pending') {
                html += '<div id="rouletteResultBox" class="rl-result win"><div class="rl-emoji">🎉</div><div class="rl-res-k">¡Ganaste!</div>' +
                    '<div class="rl-res-big">+' + _fmt(spin.prizePct) + '% extra</div>' +
                    '<div class="rl-res-note">✅ Se aplica solo en tu próxima carga. No tenés que avisar nada.</div></div>';
            } else if (won && spin.status === 'credited') {
                html += '<div id="rouletteResultBox" class="rl-result win"><div class="rl-emoji">🎉</div><div class="rl-res-k">¡Ganaste!</div>' +
                    '<div class="rl-res-big">$' + _fmt(spin.prizeARS) + '</div>' +
                    '<div class="rl-res-note">✅ Acreditado a tu saldo automáticamente' + (spin.rolloverX > 0 ? ' · para retirarlo apostalo x' + _fmt(spin.rolloverX) : '') + '</div>' +
                    (spin.creditTxId ? '<div class="rl-tx">tx: ' + _esc(spin.creditTxId) + '</div>' : '') + '</div>';
                html += _communityRecommendCard();
            } else if (won && spin.status === 'credit_failed') {
                html += '<div class="rl-result warn"><div class="rl-emoji">⚠️</div><div class="rl-res-k">Premio pendiente</div>' +
                    '<div class="rl-res-big">$' + _fmt(spin.prizeARS) + '</div>' +
                    '<div class="rl-res-note">Ganaste pero la acreditación automática falló. Escribinos por Soporte y te lo cargamos.</div></div>';
            } else {
                html += '<div class="rl-result lose"><div class="rl-emoji">😔</div><div class="rl-res-k">Hoy no fue tu día</div>' +
                    '<div class="rl-res-note">Volvé mañana a partir de las 00:00 para girar otra vez.</div></div>';
            }
            html += prizesHtml;
            html += '<button type="button" class="rl-close" onclick="VIP.roulette.close()">Cerrar</button>';
        } else if (!_state.eligible) {
            // #374: bloqueada → se explica cómo se desbloquea (app instalada / carga mínima de la semana).
            if (_state.needsAppNotifs) {
                html += '<div class="rl-hero rl-locked"><div class="rl-emoji">📲</div><div class="rl-hero-t">Instalá la app para girar</div>' +
                    '<div class="rl-hero-s">La ruleta se juega desde la app instalada con las notificaciones activas.</div>' +
                    '<button type="button" class="rl-spin" onclick="VIP.roulette.needsApp()">Ver cómo</button></div>';
            } else {
                const _tl = Number(_state.todayLoaded); const _half = Math.ceil(minDep / 2); // #677
                html += '<div class="rl-hero rl-locked"><div class="rl-emoji">🔒</div><div class="rl-hero-t">Cargá $' + _fmt(minDep) + ' hoy y girás gratis</div>' +
                    '<div class="rl-hero-s">Vale sumar cargas: por ejemplo <b>2 de $' + _fmt(_half) + '</b>. Cada día que llegás a <b>$' + _fmt(minDep) + '</b> tenés un giro: % extra en tu próxima carga o plata al instante.' + (_tl > 0 ? ' Hoy llevás <b>$' + _fmt(_tl) + '</b>.' : '') + '</div>' +
                    '<button type="button" class="rl-spin" onclick="VIP.roulette.close(); if (window.VIP && VIP.home) VIP.home.setHomeMode(\'full\');">Cargar ahora</button></div>';
            }
            html += prizesHtml;
        } else {
            html += pendingHtml;
            html += '<div id="rouletteResultBox" class="rl-hero"><div class="rl-emoji rl-emoji-swing">🎰</div>' +
                '<div class="rl-hero-t">Tu giro de hoy te espera</div>' +
                '<div class="rl-hero-s">Tocá <b>Girar</b> y la suerte decide. Si ganás, se acredita solo.</div>' +
                '<button type="button" id="rouletteSpinBtn" class="rl-spin" onclick="VIP.roulette.spin()">Girar</button></div>';
            html += prizesHtml;
        }

        // Transparencia: ganadores del día (en vivo), dentro del modal.
        html += '<div class="rl-winners">';
        html += '  <div class="rl-win-head"><span class="rl-sec-t">🏆 Ganadores de hoy</span><span class="rl-live"><i></i>EN VIVO</span></div>';
        html += '  <div id="rouletteModalWinnersList" class="rl-win-list rl-fold"></div>';
        html += '  <div id="rouletteModalWinnersEmpty" class="rl-win-empty">Todavía no hay ganadores hoy. Sé el primero: girá la ruleta.</div>';
        html += '  <button type="button" class="rl-more rl-win-more" onclick="VIP.roulette.toggleFold(this)">Ver más ›</button>'; // #666
        html += '  <div class="rl-win-foot">🔒 Nombres parcialmente ocultos · los premios se acreditan solos.</div>';
        html += '</div>';

        html += '</div>';
        modal.innerHTML = html;

        _renderWinnersListInto(
            document.getElementById('rouletteModalWinnersList'),
            document.getElementById('rouletteModalWinnersEmpty'),
            _recentWinnersCache
        );
        loadRecentWinners();
    }

    async function spin() {
        if (_spinning) return;
        _spinning = true;
        // Animación: el icono 🎰 gira rápido + "GIRANDO...".
        const box = document.getElementById('rouletteResultBox');
        if (box) {
            box.innerHTML = '<div class="rl-emoji rl-emoji-spin">🎰</div><div class="rl-hero-t">Girando…</div>';
        }
        try {
            // Mínimo 1.5s de animación para que se "sienta" la ruleta.
            const [resp] = await Promise.all([
                fetch(`${VIP.config.API_URL}/api/roulette/spin`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}`, 'Content-Type': 'application/json' }
                }),
                new Promise(r => setTimeout(r, 1500))
            ]);
            const d = await resp.json();
            if (!resp.ok) {
                if (d && d.alreadySpun) {
                    _state.alreadySpun = true;
                    _state.spin = d.spin;
                    _renderModal();
                } else if (d && d.needsAppNotifs) {
                    // No tiene app instalada y/o notifs aceptadas — mostrar
                    // el modal con los pasos clarito para que pueda participar.
                    _showNeedsAppModal();
                } else {
                    if (box) box.innerHTML = '<div class="rl-err">❌ ' + _esc((d && d.error) || 'Error') + '</div>';
                }
                _spinning = false;
                return;
            }
            // Construimos un "spin" del shape que espera _renderModal y refrescamos.
            _state.alreadySpun = true;
            _state.spin = {
                prizeARS: d.prize.prizeARS,
                prizeLabel: d.prize.prizeLabel,
                prizeType: d.prize.type || (d.prize.prizeARS > 0 ? 'cash' : 'none'),
                prizePct: d.prize.prizePct || 0,
                rolloverX: d.prize.rolloverX || 0,
                status: d.prize.status,
                spunAt: new Date().toISOString(),
                creditTxId: d.prize.transactionId || null
            };
            if (d.prize.type === 'percent') _state.pendingPct = d.prize.prizePct || 0;
            _renderModal();
            renderHomeCard();
            // Refrescar saldo del header (mismo patrón que installbonus/withdraw).
            // FIX 2026-07-09: antes llamaba a VIP.auth.refreshBalance, que nunca
            // existió → el saldo no se refrescaba tras ganar. Lo real es ui.syncBalance.
            try { if (window.VIP && VIP.ui && typeof VIP.ui.syncBalance === 'function') VIP.ui.syncBalance(); } catch (_) {}
        } catch (e) {
            if (box) box.innerHTML = '<div class="rl-err">Error de conexión</div>';
        } finally {
            _spinning = false;
        }
    }

    // Cache para reusar la lista en el modal sin re-fetch.
    let _recentWinnersCache = [];

    function _renderWinnersListInto(listEl, emptyEl, winners) {
        if (!listEl) return;
        if (!winners || winners.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';
        let html = '';
        for (const w of winners) {
            // Horario hh:mm en hora local del browser (ART para la mayoría).
            let hhmm = '';
            try {
                const d = new Date(w.spunAt);
                hhmm = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
            } catch (_) { hhmm = ''; }
            html += '<div class="winner-row' + (w.isMe ? ' is-me' : '') + '">';
            html += '<span class="winner-user">👤 ' + _esc(w.username) + '</span>';
            html += '<span class="winner-prize">' + (w.prizeType === 'percent' ? ('+' + _fmt(w.prizePct) + '% extra') : ('+$' + _fmt(w.prizeARS))) + '</span>'; // #667: también los % extra
            html += '<span class="winner-time">' + hhmm + '</span>';
            html += '</div>';
        }
        listEl.innerHTML = html;
    }

    // Lista de ganadores del día (transparencia). 🪦 El recuadro del HOME
    // (rouletteWinnersList) fue ELIMINADO 2026-08-05 (owner: confundía en el
    // inicio) — ahora los ganadores se pintan SOLO dentro del modal de la
    // ruleta. 80% del nombre tapado server-side.
    async function loadRecentWinners() {
        if (!VIP.state || !VIP.state.currentToken) return;
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/roulette/recent-winners?limit=50`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (!r.ok) return;
            const d = await r.json();
            const winners = Array.isArray(d.winners) ? d.winners : [];
            _recentWinnersCache = winners;
            // Solo dentro del modal (si está abierto).
            _renderWinnersListInto(
                document.getElementById('rouletteModalWinnersList'),
                document.getElementById('rouletteModalWinnersEmpty'),
                winners
            );
        } catch (e) { /* best-effort */ }
    }

    // #666: pliega/despliega premios o ganadores (el botón es hermano del bloque plegado o está adentro de él).
    function toggleFold(btn) {
        const box = btn && (btn.classList.contains('rl-win-more') ? btn.previousElementSibling.previousElementSibling : btn.parentElement);
        if (!box) return; const open = box.classList.toggle('open');
        const isP = box.classList.contains('rl-prizes');
        btn.textContent = open ? 'Ver menos ▴' : (isP ? 'Ver premios ›' : 'Ver más ›');
    }
    VIP.roulette = { loadStatus, open, close, spin, loadRecentWinners, toggleFold, needsApp: _showNeedsAppModal };

    // Boot: cargar status apenas el usuario esté autenticado.
    document.addEventListener('DOMContentLoaded', () => {
        const tryLoad = () => {
            if (VIP.state && VIP.state.currentToken) {
                loadStatus();
                loadRecentWinners();
            } else {
                setTimeout(tryLoad, 1500);
            }
        };
        setTimeout(tryLoad, 800);
    });

    // Refresh al volver visible.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            loadStatus();
            loadRecentWinners();
        }
    });

    // Auto-refresh cada 30s para mostrar nuevos ganadores en vivo. Solo
    // mientras la página es visible, para no quemar batería en background.
    setInterval(() => {
        if (document.visibilityState === 'visible' && VIP.state && VIP.state.currentToken) {
            loadRecentWinners();
        }
    }, 30000);
})();
