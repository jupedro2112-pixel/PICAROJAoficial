// #459 (owner 2026-10-18): MEDIDOR de uso de la app. Mientras la app está abierta y visible, avisa al server cada 60 s
// (POST /api/activity/ping) con si está instalada y en qué modo del home está. El server arma las sesiones (gap > 3 min =
// sesión nueva). Alimenta "Datos IA" (tiempo por sesión, aperturas por día, usuarios que entraron).
(function () {
    'use strict';
    window.VIP = window.VIP || {};
    let _timer = null, _last = 0;
    function _installed() { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (_) { return false; } }
    function _mode() { try { return (VIP.home && VIP.home.getHomeMode && VIP.home.getHomeMode()) || null; } catch (_) { return null; } }
    // #952 (owner): "el posible duplicado hacelo por teléfono y que tome algo del celular": el navegador no da el IMEI, así que se genera UNA
    // vez un ID propio del celular (localStorage) y viaja en cada ping; el radar cruza cuentas por ese ID (+ token de push + modelo).
    function _deviceId() { try { let v = localStorage.getItem('vip_device_id'); if (!v || v.length < 8) { v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('d-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)); localStorage.setItem('vip_device_id', v); } return v; } catch (_) { return null; } }
    async function ping(force) {
        if (!VIP.state || !VIP.state.currentToken) return;
        if (document.hidden) return;
        const now = Date.now(); if (!force && now - _last < 50000) return; _last = now;
        try {
            await fetch(VIP.config.API_URL + '/api/activity/ping', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VIP.state.currentToken }, body: JSON.stringify({ installed: _installed(), mode: _mode(), device: Object.assign({}, window.VIP_DEVICE || {}, { id: _deviceId() }) }) /* #823: qué teléfono usa · #952: + ID del celular */, keepalive: true });
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
