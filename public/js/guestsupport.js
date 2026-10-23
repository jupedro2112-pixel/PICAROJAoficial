// #414 (owner 2026-10-18): SOPORTE PARA VISITANTES en la pantalla de ingreso (sin cuenta).
// Burbuja abajo a la derecha → panel con la asistente de PICA ROJA. Paso 1: nombre + teléfono + motivo. Paso 2: chat
// tipo burbujas (polling cada 8 s). El hilo se guarda en localStorage (vip_guest_support) para seguirlo después.
(function () {
    'use strict';
    window.VIP = window.VIP || {};
    const KEY = 'vip_guest_support';
    let _thread = null, _token = null, _timer = null, _open = false, _agent = 'Soporte';
    const _el = (id) => document.getElementById(id);
    const _esc = (s) => { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; };
    const _api = () => (window.VIP && VIP.config && VIP.config.API_URL) || '';
    function _load() { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && j.id && j.token) { _thread = { id: j.id }; _token = j.token; } } catch (_) {} }
    function _save() { try { if (_thread && _token) localStorage.setItem(KEY, JSON.stringify({ id: _thread.id, token: _token })); else localStorage.removeItem(KEY); } catch (_) {} }
    function _fmtT(d) { try { return new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } }
    function _paintAgent() { const n = _el('gsAgentName'); if (n) n.textContent = _agent || 'Soporte'; }
    function _showStep(step) {
        const f = _el('gsForm'), c = _el('gsChat');
        if (f) f.style.display = step === 'form' ? '' : 'none';
        if (c) c.style.display = step === 'chat' ? '' : 'none';
    }
    function _render(th) {
        const box = _el('gsMessages'); if (!box || !th) return;
        const msgs = th.messages || [];
        box.innerHTML = msgs.map((m) => {
            const mine = m.from === 'guest';
            const who = !mine ? '<small class="gs-who">' + _esc(m.agent || _agent || 'Soporte') + ' · Soporte</small>' : '';
            return '<div class="gs-msg ' + (mine ? 'gs-mine' : 'gs-theirs') + '">' + who + '<div class="gs-txt">' + _esc(m.content) + '</div><small class="gs-time">' + _fmtT(m.at) + '</small></div>';
        }).join('') + (th.status === 'closed' ? '<div class="gs-closed">Consulta cerrada · si necesitás algo más, escribinos de nuevo.</div>' : '');
        box.scrollTop = box.scrollHeight;
        const st = _el('gsStatus'); if (st) st.textContent = msgs.some((m) => m.from === 'agent') ? 'te respondió Soporte' : 'enviado · te respondemos en minutos';
    }
    async function _poll() {
        if (!_thread || !_token) return;
        try {
            const r = await fetch(_api() + '/api/public/support/' + encodeURIComponent(_thread.id) + '?token=' + encodeURIComponent(_token));
            if (r.status === 404) { _thread = null; _token = null; _save(); _showStep('form'); return; }
            if (!r.ok) return;
            const j = await r.json();
            if (j && j.thread) { _thread = j.thread; if (j.agentName) { _agent = j.agentName; _paintAgent(); } _render(_thread); }
        } catch (_) {}
    }
    function _startPoll() { clearInterval(_timer); _timer = setInterval(() => { if (_open && !document.hidden) _poll(); }, 8000); }
    async function start(ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        const name = (_el('gsName') || {}).value || '', phone = (_el('gsPhone') || {}).value || '', motivo = (_el('gsMotivo') || {}).value || '';
        const err = _el('gsErr'); if (err) err.textContent = '';
        const btn = _el('gsStartBtn'); if (btn) btn.disabled = true;
        try {
            const r = await fetch(_api() + '/api/public/support/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), phone: phone.trim(), motivo: motivo.trim() }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { if (err) err.textContent = j.error || 'No pudimos enviar tu consulta. Probá de nuevo.'; return; }
            _thread = j.thread; _token = j.token; if (j.agentName) { _agent = j.agentName; _paintAgent(); }
            _save(); _showStep('chat'); _render(_thread); _startPoll();
        } catch (_) { if (err) err.textContent = 'Sin conexión. Probá de nuevo.'; }
        finally { if (btn) btn.disabled = false; }
    }
    async function send(ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        const inp = _el('gsInput'); const content = (inp && inp.value || '').trim();
        if (!content || !_thread || !_token) return;
        inp.value = '';
        try {
            const r = await fetch(_api() + '/api/public/support/' + encodeURIComponent(_thread.id) + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: _token, content }) });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.message) { _thread.messages = (_thread.messages || []).concat([j.message]); _thread.status = 'open'; _render(_thread); }
            else if (r.status === 404) { _thread = null; _token = null; _save(); _showStep('form'); }
        } catch (_) {}
    }
    function open() {
        const p = _el('gsPanel'); if (!p) return;
        p.classList.add('open'); _open = true;
        const b = _el('gsBubble'); if (b) b.classList.add('hide');
        if (_thread && _token) { _showStep('chat'); _poll(); _startPoll(); } else { _showStep('form'); setTimeout(() => { try { _el('gsName').focus(); } catch (_) {} }, 200); }
    }
    function close() {
        const p = _el('gsPanel'); if (p) p.classList.remove('open');
        _open = false; clearInterval(_timer);
        const b = _el('gsBubble'); if (b) b.classList.remove('hide');
    }
    function reset() { _thread = null; _token = null; _save(); _showStep('form'); }
    function init() { _load(); if (_thread) _poll(); }
    document.addEventListener('DOMContentLoaded', init);
    VIP.guestSupport = { open, close, start, send, reset, toggle: () => (_open ? close() : open()) };
})();
