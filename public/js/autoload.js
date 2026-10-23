// =====================================================================
// CARGA AUTOMÁTICA — tarjeta "💳 CARGÁ ACÁ" del home (2026-10-16, WORKLOG #220)
//
// Pedido del owner: el CHAT pasa a ser SOPORTE (arriba) y la carga tiene su propio
// lugar en el home, con todo lo que el cliente necesita a la vista al entrar:
//   • CBU vigente, alias, banco y titular (GET /api/config/cbu — sin spamear el chat
//     como hace el botón CBU de la barra).
//   • Sus datos de acceso: usuario, contraseña (la que usó al entrar, guardada en ESTE
//     dispositivo) y el link de la app.
//   • "📸 Guardar captura": arma una imagen con todos esos datos y la comparte/descarga
//     para que el cliente la guarde en el teléfono y no pierda su acceso.
//   • "📎 Enviar comprobante": abre la cámara/galería del chat (mismo flujo de siempre →
//     la auto-carga hgcash matchea el comprobante y, si hay 2 plataformas, le pregunta
//     dónde jugar).
// La tarjeta vive en #autoLoadCard (index.html); acá sólo se completan los datos.
// =====================================================================
(function () {
    'use strict';
    window.VIP = window.VIP || {};

    const PW_KEY = 'vip_access_pw'; // contraseña del cliente guardada en SU dispositivo (base64)
    let _cbu = null;
    let _pwVisible = false;
    let _lastBlobUrl = null;
    let _loading = null;

    // ---- contraseña: memoria de sesión + persistencia local ----
    function _decode(s) { try { return decodeURIComponent(escape(atob(s))); } catch (_) { return ''; } }
    function _encode(s) { try { return btoa(unescape(encodeURIComponent(s))); } catch (_) { return ''; } }

    // La llama auth.js al loguear y al CAMBIAR la clave (botón llave de la cabecera):
    // la tarjeta de carga se refresca sola — muestra siempre la clave vigente, no se edita ahí.
    function rememberPassword(pw) {
        if (!pw) return;
        VIP.state.sessionPassword = pw;
        try { localStorage.setItem(PW_KEY, _encode(pw)); } catch (_) {}
        try { _renderPassword(); } catch (_) {}
    }
    function forgetPassword() {
        try { localStorage.removeItem(PW_KEY); } catch (_) {}
    }
    function getPassword() {
        if (VIP.state && VIP.state.sessionPassword) return VIP.state.sessionPassword;
        let saved = '';
        try { saved = _decode(localStorage.getItem(PW_KEY) || ''); } catch (_) {}
        if (saved && VIP.state) VIP.state.sessionPassword = saved;
        return saved;
    }

    function appLink() {
        const base = window.__VIP_PUBLIC_BASE_URL__;
        if (base && !/PLACEHOLDER/.test(base) && /^https?:\/\//.test(base)) return base.replace(/\/+$/, '');
        return (location.origin || '').replace(/\/+$/, '');
    }
    function username() {
        return (VIP.state && VIP.state.currentUser && VIP.state.currentUser.username) || '';
    }
    function _el(id) { return document.getElementById(id); }
    function _set(id, v) { const e = _el(id); if (e) e.textContent = v == null || v === '' ? '—' : String(v); }

    async function _loadCbu() {
        try {
            const r = await fetch(VIP.config.API_URL + '/api/config/cbu', { headers: { 'Authorization': 'Bearer ' + VIP.state.currentToken } });
            if (!r.ok) return null;
            return await r.json();
        } catch (_) { return null; }
    }

    function _renderPassword() {
        const pw = getPassword();
        const span = _el('alPassword');
        const toggle = _el('alPwToggle');
        const manual = _el('alPwManual');
        // Sin clave guardada en este dispositivo (sesión vieja): se indica que la cambie
        // desde la llave de arriba — al cambiarla, acá aparece la nueva.
        if (span) span.textContent = pw ? (_pwVisible ? pw : '••••••••') : 'tocá 🔑 Clave arriba';
        if (toggle) { toggle.textContent = _pwVisible ? 'ocultar' : 'ver'; toggle.style.display = pw ? '' : 'none'; }
        if (manual) manual.style.display = 'none';
        // #241: clave inicial (asd123) → pedirle que la cambie desde la llave de arriba.
        const hint = _el('alPwHint');
        if (hint) hint.style.display = (pw && /^asd123$/i.test(pw)) ? '' : 'none';
    }

    // Completa la tarjeta del home. Se llama al entrar (VIP.home.init) y cuando
    // cambia algo (login, contraseña nueva).
    async function init() {
        const card = _el('autoLoadCard');
        if (!card) return;
        if (!VIP.state || !VIP.state.currentToken) return;
        _pwVisible = false;
        _set('alUser', username());
        // Se muestra sin https:// para que entre entero; "Copiar" copia la URL completa (data-full).
        _set('alLink', appLink().replace(/^https?:\/\//, ''));
        try { const le = _el('alLink'); if (le) le.dataset.full = appLink(); } catch (_) {}
        _renderPassword();
        if (!_cbu) ['alBank', 'alTitular', 'alCbu', 'alAlias'].forEach(id => _set(id, 'cargando…'));
        if (!_loading) _loading = _loadCbu().finally(() => { _loading = null; });
        const cbu = await _loading;
        if (cbu) _cbu = cbu;
        if (_cbu) {
            _set('alBank', _cbu.bank); _set('alTitular', _cbu.titular); _set('alCbu', _cbu.number);
            _set('alAlias', _cbu.alias || '—'); // #271
        } else {
            ['alBank', 'alTitular', 'alCbu', 'alAlias'].forEach(id => _set(id, 'no disponible'));
        }
    }

    function refresh() { _cbu = null; return init(); }

    function togglePassword() {
        if (!getPassword()) return;
        _pwVisible = !_pwVisible;
        _renderPassword();
    }

    function saveManualPassword() {
        const i = _el('alPwInput');
        const v = i && i.value.trim();
        if (!v) return;
        rememberPassword(v);
        if (i) i.value = '';
        _pwVisible = true;
        _renderPassword();
        VIP.ui.showToast('Contraseña guardada en este dispositivo', 'success');
    }

    function copy(id) {
        const e = _el(id);
        if (!e) return;
        VIP.ui.copyText((e.dataset && e.dataset.full) || e.textContent || '');
    }

    function sendReceipt() {
        // #808 (owner): aviso en TODOS los botones de adjuntar: el comprobante con todos los datos visibles o se rechaza.
        try { VIP.ui.showToast('📸 Mandá el comprobante con TODOS los datos visibles (titular, CUIT, fecha y hora, monto y N° de operación). Si no se ven, la carga se rechaza.', 'info'); } catch (_) {}
        // Abre el selector de foto del chat: el comprobante viaja por el chat de
        // soporte y la auto-carga hgcash lo matchea.
        const a = _el('attachBtn');
        if (a) a.click();
        VIP.ui.showToast('📎 Elegí la foto del comprobante: la carga entra sola.', 'info');
        // Pixel: el cliente va a depositar.
        try { if (VIP.pixel && VIP.pixel.enabled) VIP.pixel.track('InitiateCheckout', { content_name: 'autoload_receipt' }); } catch (_) {}
    }

    // ---- captura ----
    function _wrap(ctx, text, x, y, maxW, lineH) {
        const words = String(text || '').split(' ');
        let line = '';
        for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); y += lineH; line = w; }
            else line = test;
        }
        if (line) ctx.fillText(line, x, y);
        return y + lineH;
    }

    // La captura lleva SOLO lo que el cliente tiene que guardar (owner #228): link de la
    // app, su usuario y su contraseña. Nada de CBU ni pasos (eso cambia y vive en la app).
    // #478 (owner): título = logo de la marca; la clave se ve SIEMPRE (la guardada o la predeterminada de acceso).
    const DEFAULT_ACCESS_PW = 'asd123';
    const _brandLogo = new Image(); try { _brandLogo.src = '/icons/icon-192x192.png'; } catch (_) {}
    function _drawCard() {
        const W = 1080, H = 1080;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, '#141826'); grad.addColorStop(1, '#06070d');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#ff2d55'; ctx.lineWidth = 8; ctx.strokeRect(20, 20, W - 40, H - 40);
        const pad = 90;
        let y = 170;
        // Logo redondo + nombre de la marca como título
        try { if (_brandLogo.complete && _brandLogo.naturalWidth) { ctx.save(); ctx.beginPath(); ctx.arc(W / 2, 150, 70, 0, Math.PI * 2); ctx.closePath(); ctx.clip(); ctx.drawImage(_brandLogo, W / 2 - 70, 80, 140, 140); ctx.restore(); } } catch (_) {}
        y = 290;
        ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.font = '900 64px Montserrat, system-ui, sans-serif';
        ctx.fillText('PICA ROJA', W / 2, y); y += 44;
        ctx.fillStyle = '#9aa0b2'; ctx.font = '600 28px Montserrat, system-ui, sans-serif';
        ctx.fillText('oficial · cargas automáticas · mis datos de acceso', W / 2, y); y += 100;
        ctx.textAlign = 'left';
        function row(label, value, color) {
            ctx.fillStyle = '#9aa0b2'; ctx.font = '700 28px Montserrat, system-ui, sans-serif'; ctx.fillText(label.toUpperCase(), pad, y); y += 56;
            ctx.fillStyle = color || '#fff'; ctx.font = '800 54px ui-monospace, Menlo, Consolas, monospace';
            y = _wrap(ctx, value || '—', pad, y, W - pad * 2, 62) + 44;
        }
        row('Link de la app', appLink().replace(/^https?:\/\//, ''), '#ff6b6b');
        row('Usuario', username(), '#ffffff');
        const pwSaved = getPassword(); const pw = pwSaved || DEFAULT_ACCESS_PW;
        row('Contraseña', pw, '#ffd166');
        if (!pwSaved) { ctx.fillStyle = '#9aa0b2'; ctx.font = '600 24px Montserrat, system-ui, sans-serif'; ctx.fillText('(clave inicial: si la cambiaste, usá la tuya)', pad, y - 20); y += 20; } // #486
        ctx.fillStyle = '#6f7790'; ctx.font = '500 24px Montserrat, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Generada el ' + new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), W / 2, H - 70);
        return c;
    }

    // #270: si el modal Perfil está abierto, el botón y la vista previa son los de ahí.
    function _pfOpen() { const m = document.getElementById('profileModal'); return !!(m && !m.classList.contains('hidden')); }
    async function saveCapture() {
        const btn = (_pfOpen() && _el('pfCaptureBtn')) || _el('alCaptureBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }
        try {
            if (!_cbu) { const c = await _loadCbu(); if (c) _cbu = c; }
            const canvas = _drawCard();
            const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
            if (!blob) throw new Error('sin imagen');
            const name = 'carga-' + (username() || 'usuario') + '.png';
            const file = (typeof File === 'function') ? new File([blob], name, { type: 'image/png' }) : null;
            // Vista previa SIEMPRE (en iPhone el share puede no ofrecer "Guardar imagen";
            // con la previa, mantener apretado → "Guardar en Fotos").
            if (_lastBlobUrl) { try { URL.revokeObjectURL(_lastBlobUrl); } catch (_) {} }
            _lastBlobUrl = URL.createObjectURL(blob);
            const prev = (_pfOpen() && _el('pfCapturePreview')) || _el('alCapturePreview');
            if (prev) {
                prev.style.display = '';
                prev.innerHTML = '<div style="color:#ffd700;font-weight:800;font-size:12.5px;margin-bottom:6px;">📸 Tu captura está lista. Mantené apretada la imagen → "Guardar imagen" (o tocá Descargar).</div>' +
                    '<img src="' + _lastBlobUrl + '" alt="Captura de tus datos" style="width:100%;border-radius:10px;border:1px solid #d4af37;">' +
                    '<div style="display:flex;gap:8px;margin-top:8px;">' +
                    '<a href="' + _lastBlobUrl + '" download="' + name + '" style="flex:1;text-align:center;background:#d4af37;color:#000;font-weight:900;border-radius:9px;padding:10px;text-decoration:none;font-size:13px;">⬇️ Descargar</a>' +
                    '<button type="button" onclick="VIP.autoload.hidePreview()" style="flex:0 0 auto;background:rgba(255,255,255,0.08);color:#ccc;border:1px solid rgba(255,255,255,0.2);border-radius:9px;padding:10px 12px;font-size:13px;cursor:pointer;">Cerrar</button>' +
                    '</div>';
                prev.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            // Compartir / guardar nativo cuando se puede (Android: "Guardar en Fotos", WhatsApp, etc.).
            if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file], title: 'Mis datos de carga', text: 'Datos para cargar y entrar a la app' }); } catch (_) { /* el cliente canceló */ }
            }
            VIP.ui.showToast('📸 Captura lista — guardala en tu teléfono', 'success');
        } catch (e) {
            VIP.ui.showToast('No se pudo generar la captura. Probá de nuevo.', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '📸 Capturar mis datos'; }
        }
    }

    function hidePreview() {
        ['alCapturePreview', 'pfCapturePreview'].forEach((id) => { const prev = _el(id); if (prev) { prev.style.display = 'none'; prev.innerHTML = ''; } });
    }

    // Al arrancar: si hay contraseña guardada en el dispositivo, dejarla en memoria
    // (también la usa el modal de acceso manual al casino).
    try { getPassword(); } catch (_) {}

    function getCbu() { return _cbu; }
    // #839: la Carga rápida del casino (Girox directo) pide los datos SOLA; antes esperaba a que el Inicio completo los cargara y en
    // Girox directo quedaba "cargando datos…" para siempre.
    function ensureCbu() {
        if (_cbu) return Promise.resolve(_cbu);
        if (!VIP.state || !VIP.state.currentToken) return Promise.resolve(null);
        if (!_loading) _loading = _loadCbu().finally(() => { _loading = null; });
        return _loading.then((c) => { if (c) _cbu = c; return _cbu; });
    }
    VIP.autoload = { init, refresh, getCbu, ensureCbu, togglePassword, saveManualPassword, copy, sendReceipt, saveCapture, hidePreview, rememberPassword, forgetPassword, getPassword, appLink };
})();
