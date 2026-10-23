// =====================================================================
// BONIFICACIÓN VIGENTE
// Cartel en la home cuando el usuario tiene un bono de carga activo
// (lo activó una notificación de la automatización). Muestra el % y una
// cuenta regresiva; desaparece solo al vencer.
// =====================================================================
(function () {
    'use strict';
    window.VIP = window.VIP || {};

    let _bonus = null;
    let _tickId = null;

    async function load() {
        if (!VIP.state || !VIP.state.currentToken) return;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/promo-bonus/mine', {
                headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken }
            });
            if (!r.ok) return;
            const d = await r.json();
            _bonus = (d && d.bonus) ? d.bonus : null;
            _render();
        } catch (e) { /* best-effort */ }
    }

    function _fmtLeft(ms) {
        if (ms <= 0) return '0:00';
        const totalMin = Math.floor(ms / 60000);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        const s = Math.floor((ms % 60000) / 1000);
        if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
        return m + ':' + String(s).padStart(2, '0');
    }

    // #813: el bono vigente también se ve ADENTRO de los botones de carga (CARGAR AHORA del menú fácil y la tarjeta de
    // carga automática): elementos .promo-live. Con applyMode 'auto' se suma solo al acreditar la carga.
    function _paintLive(percent, left, auto) {
        const els = document.querySelectorAll('.promo-live');
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            if (!(percent > 0) || left <= 0) { el.hidden = true; el.textContent = ''; continue; }
            el.textContent = '🎁 +' + percent + '% EXTRA ' + (auto ? 'activo' : 'pedíselo al agente') + ' · vence en ' + _fmtLeft(left);
            el.hidden = false;
        }
    }

    function _render() {
        const card = document.getElementById('promoBonusCard');
        if (_tickId) { clearInterval(_tickId); _tickId = null; }
        if (!_bonus) { _paintLive(0, 0); if (card) { card.style.display = 'none'; card.innerHTML = ''; } return; }
        if (!card) return;
        const exp = new Date(_bonus.expiresAt).getTime();
        const percent = Number(_bonus.percent) || 0;
        const auto = _bonus.applyMode !== 'agent';
        const paint = function () {
            const left = exp - Date.now();
            _paintLive(percent, left, auto);
            if (left <= 0) {
                _bonus = null;
                card.style.display = 'none';
                card.innerHTML = '';
                if (_tickId) { clearInterval(_tickId); _tickId = null; }
                return;
            }
            card.innerHTML = '<div style="max-width:560px;margin:8px auto;background:linear-gradient(135deg,#0f4c00,#1a8200);border:2px solid #ffd700;border-radius:12px;padding:11px 14px;box-shadow:0 0 16px rgba(255,215,0,0.35);">'
                + '<div style="display:flex;align-items:center;gap:10px;">'
                + '<span style="font-size:26px;">🎁</span>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="color:#ffd700;font-weight:900;font-size:14px;">¡Bonificación vigente: ' + percent + '% en tu carga!</div>'
                + '<div style="color:#fff;font-size:11.5px;margin-top:2px;">' + (auto ? 'Se suma SOLO en tu próxima carga (con el tope de bonos).' : 'Cargá ahora y pedí tu bono al agente.') + ' Vence en <strong>' + _fmtLeft(left) + '</strong>.</div>'
                + '</div>'
                + '</div>'
                + '</div>';
            card.style.display = '';
        };
        paint();
        _tickId = setInterval(paint, 1000);
    }

    VIP.promoBonus = { load: load };

    document.addEventListener('DOMContentLoaded', function () {
        let tries = 0;
        const tick = function () {
            if (VIP.state && VIP.state.currentToken) {
                load();
            } else if (tries++ < 20) {
                setTimeout(tick, 1500);
            }
        };
        setTimeout(tick, 1000);
    });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') load();
    });
    // Refresco cada 2 min por si entra un bono nuevo con la app abierta.
    setInterval(function () {
        if (document.visibilityState === 'visible' && VIP.state && VIP.state.currentToken) load();
    }, 120000);
})();
