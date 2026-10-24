// #915 (owner 2026-10-24): SORTEOS CON RANKING EN VIVO — tarjetas en el menú básico / intermedio (abajo del saldo), banner en Girox directo,
// pantalla completa por sorteo (ranking con nombres tapados salvo el propio, podio de premios, cuenta regresiva, cómo suman los puntos,
// inscripción con requisitos) y Bases y condiciones en una capa aparte que se cierra con la ✕ de arriba a la izquierda.
// Datos: GET /api/sorteos (cada 5 min y al abrir) · POST /api/sorteos/:key/join. Estilo: verde (tokens --srt-* en pin.css).
(function () {
    'use strict';
    window.VIP = window.VIP || {};
    const _el = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
    const num = (n) => Math.round(Number(n) || 0).toLocaleString('es-AR');
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const fday = (d) => { const x = new Date(new Date(d).getTime() - 3 * 3600000); return x.getUTCDate() + ' de ' + MESES[x.getUTCMonth()]; };
    const fdh = (d) => { const x = new Date(d); return fday(d) + ', ' + String(x.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })) + ' h'; };
    let _data = null, _open = null, _tick = null, _poll = null, _loading = false;
    function toast(m, t) { try { if (VIP.ui && VIP.ui.showToast) return VIP.ui.showToast(m, t || 'info'); } catch (_) {} try { alert(m); } catch (_) {} }
    function cd(ms) { ms = Math.max(0, Number(ms) || 0); const s = Math.floor(ms / 1000); return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }; }
    function cdShort(ms) { const c = cd(ms); return c.d > 0 ? c.d + ' d ' + c.h + ' h' : (c.h > 0 ? c.h + ' h ' + c.m + ' min' : c.m + ' min'); }
    function untilOf(s) { return new Date(s.status === 'soon' ? s.start : s.end).getTime(); }
    function get(key) { return _data && (_data.sorteos || []).find((x) => x.key === key); }

    async function load() {
        if (_loading) return; const tok = VIP.state && VIP.state.currentToken; if (!tok) return; _loading = true;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/sorteos', { headers: { 'Authorization': 'Bearer ' + tok } });
            if (!r.ok) return; _data = await r.json(); paintCards(); if (_open) paintView(_open);
        } catch (_) {} finally { _loading = false; }
    }
    // ---- Tarjetas (básico / intermedio) y banner (Girox directo)
    function cardSub(s) {
        if (s.status === 'soon') return 'Empieza en ' + cdShort(s.startsInMs);
        if (s.status === 'closed') return s.winners && s.winners.length ? 'Cerrado · ver ganadores' : 'Cerrado · ganadores el ' + fday(s.publishAt);
        if (s.me && s.me.joined) return s.me.points > 0 ? 'Puesto #' + s.me.rank + ' · ' + num(s.me.points) + ' pts' : 'Anotado · cargá y jugá para sumar';
        return 'Anotate para sumar';
    }
    function paintCards() {
        const list = (_data && _data.enabled && _data.sorteos) || [];
        document.querySelectorAll('[data-srt-cards]').forEach((box) => {
            if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
            box.hidden = false;
            box.innerHTML = list.map((s) => { const p1 = (s.prizes || [])[0] || {}; return '<button type="button" class="srt-card" onclick="VIP.sorteos.open(\'' + s.key + '\')"><span class="srt-card-img">' + esc(p1.img || s.emoji) + '</span><span class="srt-card-t"><b>' + esc(s.title) + '</b><i>' + esc(p1.name || '') + '</i><small>' + esc(cardSub(s)) + '</small></span></button>'; }).join('');
        });
        document.querySelectorAll('[data-srt-banner]').forEach((box) => {
            const s = list.find((x) => x.status === 'live') || list[0];
            if (!s) { box.hidden = true; box.innerHTML = ''; return; }
            const p1 = (s.prizes || [])[0] || {};
            box.hidden = false;
            box.innerHTML = '<button type="button" class="srt-ban" onclick="VIP.sorteos.open(\'' + s.key + '\')"><span class="srt-ban-img">' + esc(p1.img || s.emoji) + '</span><span class="srt-ban-t"><b>🏆 ' + esc(s.title) + '</b><small>' + esc(cardSub(s)) + '</small></span><em>Ver más ›</em></button>';
        });
    }
    // ---- Pantalla del sorteo
    function open(key) {
        const m = _el('srtModal'); if (!m) return;
        _open = key || 'mensual'; m.hidden = false; document.documentElement.classList.add('srt-lock');
        const t = _el('srtTerms'); if (t) t.hidden = true;
        if (_data) paintView(_open); else { const b = _el('srtBody'); if (b) b.innerHTML = '<div class="srt-note">Cargando…</div>'; }
        load();
        clearInterval(_tick); _tick = setInterval(tickCd, 1000);
        try { document.addEventListener('keydown', _esc); } catch (_) {}
    }
    function close() { const m = _el('srtModal'); if (m) m.hidden = true; _open = null; clearInterval(_tick); document.documentElement.classList.remove('srt-lock'); try { document.removeEventListener('keydown', _esc); } catch (_) {} }
    function _esc(e) { if (e && e.key === 'Escape') { const t = _el('srtTerms'); if (t && !t.hidden) termsClose(); else close(); } }
    function tickCd() {
        document.querySelectorAll('[data-cd]').forEach((el) => { const c = cd(Number(el.getAttribute('data-cd')) - Date.now()); const q = (k) => el.querySelector('[data-k="' + k + '"]'); ['d', 'h', 'm', 's'].forEach((k) => { const x = q(k); if (x) x.textContent = String(c[k]).padStart(2, '0'); }); });
        document.querySelectorAll('[data-cd-short]').forEach((el) => { el.textContent = cdShort(Number(el.getAttribute('data-cd-short')) - Date.now()); });
    }
    function cdBlock(s) {
        const until = untilOf(s); const lbl = s.status === 'soon' ? 'EMPIEZA EN' : (s.status === 'live' ? 'TERMINA EN' : 'CERRADO');
        if (s.status === 'closed') return '<div class="srt-cd-h"><b>' + esc(s.title) + '</b><span>CERRADO</span></div>';
        const c = cd(until - Date.now()); const box = (k, v, t) => '<div class="srt-cd-b"><b data-k="' + k + '">' + String(v).padStart(2, '0') + '</b><small>' + t + '</small></div>';
        return '<div class="srt-cd-h"><b>' + esc(s.emoji + ' ' + s.title) + '</b><span>' + lbl + '</span></div><div class="srt-cd" data-cd="' + until + '">' + box('d', c.d, 'DÍAS') + box('h', c.h, 'HS') + box('m', c.m, 'MIN') + box('s', c.s, 'SEG') + '</div>';
    }
    function prizesRow(s) { return '<div class="srt-prizes">' + (s.prizes || []).map((p) => '<div class="srt-prize"><span class="srt-prize-img">' + esc(p.img) + '<i class="srt-medal m' + p.pos + '">' + p.pos + '</i></span><b>' + esc(p.name) + '</b>' + (p.value ? '<small>' + esc(p.value) + '</small>' : '') + '</div>').join('') + '</div>'; }
    function podium(s) {
        const P = (s.prizes || []); const by = (n) => P.find((p) => p.pos === n) || { name: '', value: '', img: '🎁' };
        const col = (n, cls) => { const p = by(n); return '<div class="srt-pod ' + cls + '"><span class="srt-pod-cup c' + n + '">' + (n === 1 ? '🏆' : (n === 2 ? '🥈' : '🥉')) + '</span><b>' + n + '° puesto</b><small>' + esc(p.name) + (p.value ? ' · ' + esc(p.value) : '') + '</small><div class="srt-pod-bar b' + n + '">' + n + '</div></div>'; };
        return '<div class="srt-podium">' + col(2, 'p2') + col(1, 'p1') + col(3, 'p3') + '</div>';
    }
    function rankingBlock(s) {
        const me = s.me || {}; let h = '<div class="srt-sec"><h3>📊 Ranking' + (s.status === 'live' ? ' <em class="srt-live">● en vivo</em>' : '') + '</h3>';
        if (s.status === 'soon') {
            h += '<p class="srt-p">El ranking arranca el <b>' + fday(s.start) + '</b>. Cada <b>' + money(s.rules.ptsPer) + '</b> apostados con plata real = <b>' + num(s.rules.pts) + ' puntos</b>. Anotate ahora para que tus apuestas sumen desde el primer minuto.</p>';
            h += '<p class="srt-p srt-muted">Ya se anotaron <b>' + num(s.counts.anotados) + '</b> clientes.</p>';
        } else {
            const mine = me.points > 0 ? '<div class="srt-me' + (me.joined ? '' : ' srt-me-warn') + '"><span>Tu puesto</span><b>#' + num(me.rank) + '</b><small>' + num(me.points) + ' pts · apostaste ' + money(me.wagered) + (me.joined ? '' : ' · <u>no estás anotado: no podés ganar</u>') + '</small></div>'
                : '<div class="srt-me srt-me-0"><span>Todavía no sumaste</span><b>0 pts</b><small>' + (me.joined ? 'Cargá y jugá: cada ' + money(s.rules.ptsPer) + ' apostados = ' + num(s.rules.pts) + ' pts' : 'Anotate, cargá y jugá para entrar al ranking') + '</small></div>';
            h += mine;
            if (s.status === 'closed' && s.winners && s.winners.length) h += '<p class="srt-p"><b>Ganadores del período:</b></p>' + winnersList(s.winners);
            const rows = s.top || [];
            h += rows.length ? '<div class="srt-table">' + rows.map((r) => '<div class="srt-row' + (r.me ? ' me' : '') + '"><span class="srt-r">' + (r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : '#' + r.rank) + '</span><span class="srt-n">' + esc(r.name) + (r.me ? ' <i>vos</i>' : '') + '</span><b class="srt-pts">' + num(r.points) + ' pts</b></div>').join('') + '</div>' : '<p class="srt-p srt-muted">Todavía nadie sumó puntos en este período.</p>';
            h += '<p class="srt-p srt-muted">' + num(s.counts.participantes) + ' jugando · ' + num(s.counts.anotados) + ' anotados · se actualiza cada 20 min. Los nombres van tapados: sólo vos ves el tuyo completo.</p>';
        }
        if (s.winners && s.winners.length && s.status !== 'closed') h += '<p class="srt-p"><b>🏅 Ganadores del mes pasado:</b></p>' + winnersList(s.winners);
        if (s.draw && s.draw.winners && s.draw.winners.length) h += '<p class="srt-p"><b>🎁 Premio extra sorteado</b> (' + s.draw.winners.length + ' × ' + money(s.draw.amount) + '):</p><div class="srt-table">' + s.draw.winners.map((w) => '<div class="srt-row' + (w.me ? ' me' : '') + '"><span class="srt-r">🎁</span><span class="srt-n">' + esc(w.name) + (w.me ? ' <i>vos</i>' : '') + '</span><b class="srt-pts">' + money(s.draw.amount) + '</b></div>').join('') + '</div><p class="srt-p srt-muted">Semilla del sorteo: ' + esc(s.draw.seed) + '</p>';
        return h + '</div>';
    }
    function winnersList(w) { return '<div class="srt-table">' + w.map((x) => '<div class="srt-row' + (x.me ? ' me' : '') + '"><span class="srt-r">' + ['🥇', '🥈', '🥉'][x.pos - 1] + '</span><span class="srt-n">' + esc(x.name) + (x.me ? ' <i>vos</i>' : '') + '</span><b class="srt-pts">' + num(x.points) + ' pts</b></div>').join('') + '</div>'; }
    function joinBlock(s) {
        const me = s.me || {}, ck = me.checks || {}, req = (_data && _data.requirements) || {};
        if (me.joined) return '<div class="srt-join ok"><b>✅ Estás anotado</b><small>desde el ' + fdh(me.joinedAt) + '. Tus apuestas suman puntos solas.</small></div>';
        const row = (k, ok, txt, extra) => (req[k] === false ? '' : '<li class="' + (ok ? 'ok' : 'no') + '"><i>' + (ok ? '✅' : '⬜') + '</i><span>' + txt + (extra || '') + '</span></li>');
        const tg = _data && _data.telegramUrl ? ' <button type="button" class="srt-link" onclick="VIP.sorteos.tgOpen()">Unirme ›</button>' : '';
        return '<div class="srt-join"><b>📝 Anotarme para participar</b><small>Para sumar puntos y poder ganar tenés que cumplir esto:</small><ul class="srt-req">' +
            row('app', ck.app, 'Tener la app de PICA ROJA instalada', ck.app ? '' : ' <button type="button" class="srt-link" onclick="try{VIP.home.installGiftOpen&&VIP.home.installGiftOpen()}catch(_){}">¿Cómo? ›</button>') +
            row('notif', ck.notif, 'Notificaciones activadas', ck.notif ? '' : ' <button type="button" class="srt-link" onclick="try{VIP.notifications&&VIP.notifications.requestNotificationPermission&&VIP.notifications.requestNotificationPermission()}catch(_){}">Activar ›</button>') +
            row('deposit', ck.deposit, 'Al menos una carga real', ck.deposit ? '' : ' <button type="button" class="srt-link" onclick="VIP.sorteos.close();try{VIP.home.easyLoad()}catch(_){}">Cargar ›</button>') +
            (req.telegram === false ? '' : '<li class="' + (ck.telegram ? 'ok' : 'no') + '"><i>' + (ck.telegram ? '✅' : '⬜') + '</i><label><input type="checkbox" id="srtTg_' + s.key + '"' + (ck.telegram ? ' checked' : '') + '> Ya me uní al Telegram de PICA ROJA (ahí anunciamos los ganadores)</label>' + tg + '</li>') +
            '</ul><button type="button" class="srt-btn" onclick="VIP.sorteos.join(\'' + s.key + '\')">Anotarme ahora</button></div>';
    }
    function crossCard(s) {
        const o = (_data.sorteos || []).find((x) => x.key !== s.key); if (!o) return '';
        const p1 = (o.prizes || [])[0] || {};
        return '<button type="button" class="srt-cross" onclick="VIP.sorteos.open(\'' + o.key + '\')"><span class="srt-card-img">' + esc(p1.img || o.emoji) + '</span><span class="srt-card-t"><b>' + esc(o.title) + '</b><i>' + esc(p1.name) + '</i><small>' + esc(cardSub(o)) + '</small></span><em>Ver ›</em></button>';
    }
    function paintView(key) {
        const s = get(key); const b = _el('srtBody'), t = _el('srtTitle'); if (!b) return;
        if (!s) { b.innerHTML = '<div class="srt-note">' + (_data && _data.enabled === false ? 'Por ahora no hay sorteos activos.' : 'Este sorteo no está disponible.') + '</div>'; return; }
        if (t) t.textContent = s.emoji + ' ' + s.title;
        let h = '';
        if (s.key === 'mensual') {
            if (s.extra && s.extra.enabled) h += '<div class="srt-extra"><b>🎁 Premio extra: ' + money(s.extra.amount * s.extra.winners) + ' en ' + num(s.extra.winners) + ' ganadores de ' + money(s.extra.amount) + '</b><small>Por cada ' + num(s.extra.per) + ' clientes anotados con al menos ' + num(s.extra.minDeposits) + ' cargas en el mes se sortean ' + num(s.extra.winners) + ' premios de ' + money(s.extra.amount) + '. Participan todos los que cumplan, sin importar el ranking.' + (s.counts.extraWinners ? ' <b>Hoy ya hay ' + num(s.counts.extraWinners) + ' premios en juego.</b>' : '') + '</small></div>';
            h += '<div class="srt-sec srt-cdwrap">' + cdBlock(s) + '<p class="srt-p srt-muted">Del ' + fday(s.start) + ' al ' + fday(s.end) + ' · ganadores el ' + fdh(s.publishAt) + '</p></div>';
            h += rankingBlock(s);
            h += '<div class="srt-sec"><h3>🏅 Ganadores</h3>' + podium(s) + '<p class="srt-p">Los 3 anotados con más puntos al cierre ganan. Se publican el ' + fdh(s.publishAt) + ' y los contacta nuestro Soporte de entrega de premios.</p></div>';
            h += '<div class="srt-sec"><h3>🧮 Cómo sumás puntos</h3><ul class="srt-rules"><li>🎰 <b>' + num(s.rules.pts) + ' pts</b> cada ' + money(s.rules.ptsPer) + ' apostados con plata real</li><li>🚫 Los bonos no suman: cuenta la parte proporcional a tus cargas</li><li>🔄 Se actualiza cada 20 minutos</li></ul></div>';
        } else {
            h += '<div class="srt-sec srt-cdwrap">' + cdBlock(s) + prizesRow(s) + '<ul class="srt-rules"><li>🎰 <b>' + num(s.rules.pts) + ' pts</b> cada ' + money(s.rules.ptsPer) + ' apostados</li>' + (s.rules.dayDepositPts ? '<li>📅 <b>+' + num(s.rules.dayDepositPts) + ' pts</b> por cada día que cargás ' + money(s.rules.dayDepositMin) + ' o más</li>' : '') + (s.rules.missionWeekPct ? '<li>🎯 <b>+' + num(s.rules.missionWeekPct) + '%</b> de tus puntos de la semana si completás tus misiones semanales</li>' : '') + '</ul><p class="srt-p">Del ' + fday(s.start) + ' al ' + fday(s.end) + '. Ganan los 3 anotados con más puntos.</p></div>';
            h += rankingBlock(s);
            h += '<div class="srt-sec"><h3>🏅 Ganadores</h3>' + podium(s) + '</div>';
        }
        h += joinBlock(s);
        h += crossCard(s);
        h += '<button type="button" class="srt-terms-btn" onclick="VIP.sorteos.terms(\'' + s.key + '\')">📜 Bases y condiciones ›</button>';
        b.innerHTML = h; try { b.scrollTop = 0; } catch (_) {}
    }
    async function join(key) {
        const tok = VIP.state && VIP.state.currentToken; if (!tok) return;
        const cb = _el('srtTg_' + key); const telegram = cb ? !!cb.checked : true;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/sorteos/' + encodeURIComponent(key) + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok }, body: JSON.stringify({ telegram }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { toast(j.error || 'No se pudo anotar', 'error'); return; }
            toast('🏆 ¡Listo! Ya estás anotado. Tus apuestas suman puntos.', 'success'); await load();
        } catch (_) { toast('Sin conexión. Probá de nuevo.', 'error'); }
    }
    function tgOpen() { const u = _data && _data.telegramUrl; if (u) window.open(u, '_blank', 'noopener'); }
    function terms(key) {
        const s = get(key || _open); const box = _el('srtTermsBody'), lay = _el('srtTerms'); if (!s || !box || !lay) return;
        box.innerHTML = '<h2>📜 Bases y condiciones · ' + esc(s.title) + '</h2><ol class="srt-tc">' + (s.terms || []).map((x) => '<li><b>' + esc(x.t) + ':</b> ' + esc(x.d) + '</li>').join('') + '</ol><p class="srt-p srt-muted">PICA ROJA · ' + esc(fday(_data.now)) + '</p>';
        lay.hidden = false; try { box.scrollTop = 0; } catch (_) {}
    }
    function termsClose() { const lay = _el('srtTerms'); if (lay) lay.hidden = true; }
    function init() {
        load(); clearInterval(_poll); _poll = setInterval(load, 5 * 60 * 1000);
        try { document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); }); } catch (_) {}
    }
    VIP.sorteos = { init, load, open, close, join, terms, termsClose, tgOpen };
})();
