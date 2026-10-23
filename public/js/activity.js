// #459 (owner 2026-10-18): MEDIDOR de uso de la app. Mientras la app está abierta y visible, avisa al server cada 60 s
// (POST /api/activity/ping) con si está instalada y en qué modo del home está. El server arma las sesiones (gap > 3 min =
// sesión nueva). Alimenta "Datos IA" (tiempo por sesión, aperturas por día, usuarios que entraron).
(function () {
    'use strict';
    window.VIP = window.VIP || {};
    let _timer = null, _last = 0;
    function _installed() { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (_) { return false; } }
    function _mode() { try { return (VIP.home && VIP.home.getHomeMode && VIP.home.getHomeMode()) || null; } catch (_) { return null; } }
    async function ping(force) {
        if (!VIP.state || !VIP.state.currentToken) return;
        if (document.hidden) return;
        const now = Date.now(); if (!force && now - _last < 50000) return; _last = now;
        try {
            await fetch(VIP.config.API_URL + '/api/activity/ping', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VIP.state.currentToken }, body: JSON.stringify({ installed: _installed(), mode: _mode(), device: window.VIP_DEVICE || null }) /* #823: qué teléfono usa */, keepalive: true });
        } catch (_) {}
    }
    function start() {
        clearInterval(_timer);
        _timer = setInterval(() => ping(false), 60 * 1000);
        ping(true);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(true); });
    document.addEventListener('DOMContentLoaded', () => { setTimeout(start, 4000); });
    VIP.activity = { ping, start };
})();
