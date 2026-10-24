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
    // #923 (owner: "usá fotos del auto 208"): el `img` de un premio puede ser un emoji o una FOTO (ruta /images/... o URL http). `cls` = clase del contenedor.
    const isPic = (v) => /^(\/|https?:\/\/)/.test(String(v || ''));
    function pic(v, cls, alt) { v = v || '🎁'; return isPic(v) ? '<span class="' + cls + ' pic"><img src="' + esc(v) + '" alt="' + esc(alt || '') + '" loading="lazy"></span>' : '<span class="' + cls + '">' + esc(v) + '</span>'; }

    async function load() {
        if (_loading) return; const tok = VIP.state && VIP.state.currentToken; if (!tok) return; _loading = true;
        try {
            const r = await fetch(VIP.config.API_URL + '/api/sorteos', { headers: { 'Authorization': 'Bearer ' + tok } });
            if (!r.ok) return; _data = await r.json(); paintCards(); if (_open) paintView(_open);
            if (_inline && _inlineKey && _inlineView === 'main') paintView(_inlineKey, _el('srtInlineBody'), null); // #928
        } catch (_) {} finally { _loading = false; }
    }
    // ---- Tarjetas (básico / intermedio) y banner (Girox directo)
    function cardSub(s) {
        if (s.status === 'soon') return (s.me && s.me.joined ? 'Registrado ✅ · empieza en ' : 'Empieza en ') + cdShort(s.startsInMs);
        if (s.status === 'closed') return s.winners && s.winners.length ? 'Cerrado · ver ganadores' : 'Cerrado · ganadores el ' + fday(s.publishAt);
        if (s.me && s.me.joined) return s.me.points > 0 ? 'Registrado · puesto #' + s.me.rank : 'Registrado ✅';
        return 'Anotate para sumar';
    }
    function paintCards() {
        const list = (_data && _data.enabled && _data.sorteos) || [];
        // #926 (owner): las tarjetas del básico/intermedio van IGUAL que en el completo: dos mitades lado a lado (Gran Sorteo | Sorteo mensual).
        const ordered = ['gran', 'mensual'].map((k) => list.find((x) => x.key === k)).filter(Boolean).concat(list.filter((x) => !['gran', 'mensual'].includes(x.key)));
        const pair = () => ordered.map((s) => { const p1 = (s.prizes || [])[0] || {}; return '<button type="button" class="srt-ban" onclick="VIP.sorteos.open(\'' + s.key + '\', event)">' + pic(p1.img || s.emoji, 'srt-ban-img', p1.name) + '<span class="srt-ban-t"><b>🏆 ' + esc(s.title) + '</b><small>' + esc(cardSub(s)) + '</small><em>Ver más ›</em></span></button>'; }).join('');
        document.querySelectorAll('[data-srt-cards]').forEach((box) => {
            if (!ordered.length) { box.hidden = true; box.innerHTML = ''; return; }
            box.hidden = false; box.classList.toggle('one', ordered.length === 1); box.innerHTML = pair();
            if (_inline && _inline.previousElementSibling === box) { const idx = ['gran', 'mensual'].indexOf(_inlineKey); const btns = box.querySelectorAll('.srt-ban'); if (btns[idx]) btns[idx].classList.add('on'); }
        });
        paintCasino(); // #917/#935: barra del casino
        // #922 (owner): el banner de Girox directo dividido en DOS: a la izquierda el Gran Sorteo (auto), a la derecha el mensual (iPhone).
        document.querySelectorAll('[data-srt-banner]').forEach((box) => {
            if (!ordered.length) { box.hidden = true; box.innerHTML = ''; return; }
            box.hidden = false; box.classList.toggle('one', ordered.length === 1); box.innerHTML = pair();
        });
    }
    // ---- Pantalla del sorteo
    // #928 (owner): "cuando la gente aprieta sorteo, que se vea ahí adentro sin que se abra en el menú y que se pueda sacar desde ahí".
    // Tocando una de las dos mitades el sorteo se DESPLIEGA debajo (panel .srt-inline con ✕); la pantalla completa queda para el botón de adentro
    // del casino (no hay dónde desplegar).
    let _inline = null, _inlineKey = null, _inlineView = 'main';
    // #941 (owner): "abrilo tipo ventana, que la cruz arriba quede fija para cerrar; apretando afuera de la ventana que se pueda salir; deslizar
    // para abajo también". Siempre la VENTANA (#srtModal): el panel desplegado (#928) queda sin uso.
    function open(key, ev) {
        const m = _el('srtModal'); if (!m) return; _swipeInit();
        _open = key || 'mensual'; m.hidden = false; document.documentElement.classList.add('srt-lock');
        const t = _el('srtTerms'); if (t) t.hidden = true;
        if (_data) paintView(_open); else { const b = _el('srtBody'); if (b) b.innerHTML = '<div class="srt-note">Cargando…</div>'; }
        load();
        clearInterval(_tick); _tick = setInterval(tickCd, 1000);
        try { document.addEventListener('keydown', _esc); } catch (_) {}
    }
    function close() { closeInline(); const m = _el('srtModal'); if (m) m.hidden = true; const w = _el('srtWin'); if (w) { w.style.transform = ''; w.style.transition = ''; } _open = null; if (!_inline) clearInterval(_tick); document.documentElement.classList.remove('srt-lock'); try { document.removeEventListener('keydown', _esc); } catch (_) {} }
    // Deslizar hacia abajo para cerrar: desde la cabecera siempre; desde el cuerpo sólo si está arriba de todo (scrollTop 0).
    let _sw = null, _swReady = false;
    function _swipeInit() {
        if (_swReady) return; const w = _el('srtWin'), b = _el('srtBody'), h = _el('srtHead'); if (!w || !b || !h) return; _swReady = true;
        const start = (e, fromHead) => { const t = e.touches && e.touches[0]; if (!t) return; if (!fromHead && b.scrollTop > 0) { _sw = null; return; } const tl = _el('srtTerms'); if (tl && !tl.hidden && !fromHead) { _sw = null; return; } _sw = { y: t.clientY, dy: 0, head: fromHead }; w.style.transition = 'none'; };
        const move = (e) => { if (!_sw) return; const t = e.touches && e.touches[0]; if (!t) return; _sw.dy = Math.max(0, t.clientY - _sw.y); if (_sw.dy > 0) { w.style.transform = 'translateY(' + _sw.dy + 'px)'; if (_sw.head || b.scrollTop <= 0) { try { e.preventDefault(); } catch (_) {} } } };
        const end = () => { if (!_sw) return; const dy = _sw.dy; _sw = null; w.style.transition = 'transform .18s ease-out'; if (dy > 90) { w.style.transform = 'translateY(110%)'; setTimeout(close, 160); } else w.style.transform = ''; };
        h.addEventListener('touchstart', (e) => start(e, true), { passive: true }); b.addEventListener('touchstart', (e) => start(e, false), { passive: true });
        w.addEventListener('touchmove', move, { passive: false }); w.addEventListener('touchend', end); w.addEventListener('touchcancel', end);
    }
    function openInline(key, host) {
        if (_inline && _inlineKey === key && _inline.previousElementSibling === host) { closeInline(); return; } // mismo botón ⇒ se pliega
        closeInline();
        const s = get(key); const p = document.createElement('div'); p.className = 'srt-inline'; p.id = 'srtInline';
        // #929 (owner): "sacá de adentro del sorteo del auto el sorteo del auto" → sin título repetido arriba (la mitad tocada ya lo dice); sólo la ✕.
        // #940 (owner): "que se abra; el Próximamente de abajo no" ⇒ sin la fila de arriba: la ✕ flota sobre el contenido y lo primero es el sorteo.
        p.innerHTML = '<button type="button" class="srt-inline-x srt-inline-x-float" onclick="VIP.sorteos.closeInline()" aria-label="Cerrar">✕ Cerrar</button><div class="srt-inline-body" id="srtInlineBody"><div class="srt-note">Cargando…</div></div>';
        host.insertAdjacentElement('afterend', p); _inline = p; _inlineKey = key; _inlineView = 'main';
        try { host.querySelectorAll('.srt-ban').forEach((b) => b.classList.remove('on')); const btns = host.querySelectorAll('.srt-ban'); const idx = ['gran', 'mensual'].indexOf(key); if (btns[idx]) btns[idx].classList.add('on'); } catch (_) {}
        if (_data) paintView(key, _el('srtInlineBody'), null); load();
        clearInterval(_tick); _tick = setInterval(tickCd, 1000);
        try { setTimeout(() => { p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); } catch (_) {}
    }
    function closeInline() {
        if (_inline) { try { const host = _inline.previousElementSibling; if (host) host.querySelectorAll('.srt-ban.on').forEach((b) => b.classList.remove('on')); } catch (_) {} _inline.remove(); }
        _inline = null; _inlineKey = null; _inlineView = 'main'; if (!_open) clearInterval(_tick);
    }
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
    // #920 (owner): "ponele más lugar cuando entrás: lo principal, con imágenes de lo que se sortea" → portada con los premios grandes.
    function hero(s) {
        const P = (s.prizes || []); const by = (n) => P.find((p) => p.pos === n) || { name: '', value: '', img: '🎁' };
        const p1 = by(1), p2 = by(2), p3 = by(3);
        const side = (p) => '<div class="srt-hero-s">' + pic(p.img, 'srt-hero-img s', p.name) + '<i class="srt-hero-pos">' + p.pos + '° puesto</i><b>' + esc(p.name) + '</b>' + (p.value ? '<small>' + esc(p.value) + '</small>' : '') + '</div>';
        return '<div class="srt-hero"><div class="srt-hero-t">' + (s.key === 'mensual' ? '🎁 Lo que se sortea este mes' : '🎁 Lo que se sortea') + '</div>' +
            '<div class="srt-hero-1' + (isPic(p1.img) ? ' has-pic' : '') + '">' + pic(p1.img, 'srt-hero-img', p1.name) + '<div class="srt-hero-1t"><i class="srt-hero-pos">🥇 1° puesto</i><b>' + esc(p1.name) + '</b>' + (p1.value ? '<small>' + esc(p1.value) + '</small>' : '') + '</div></div>' +
            '<div class="srt-hero-row">' + side(p2) + side(p3) + '</div>' +
            '<p class="srt-hero-p">Ganan los 3 anotados con más puntos al cierre. Cada premio se puede cobrar en efectivo por su valor.</p></div>';
    }
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
        if (s.draw && s.draw.winners && s.draw.winners.length) h += '<p class="srt-p"><b>🎁 ' + esc((s.extra && s.extra.title) || 'SORTEO') + ' · ganadores</b> (' + s.draw.winners.length + ' × ' + money(s.draw.amount) + '):</p><div class="srt-table">' + s.draw.winners.map((w) => '<div class="srt-row' + (w.me ? ' me' : '') + '"><span class="srt-r">🎁</span><span class="srt-n">' + esc(w.name) + (w.me ? ' <i>vos</i>' : '') + '</span><b class="srt-pts">' + money(s.draw.amount) + '</b></div>').join('') + '</div><p class="srt-p srt-muted">Semilla del sorteo: ' + esc(s.draw.seed) + '</p>';
        return h + '</div>';
    }
    function winnersList(w) { return '<div class="srt-table">' + w.map((x) => '<div class="srt-row' + (x.me ? ' me' : '') + '"><span class="srt-r">' + ['🥇', '🥈', '🥉'][x.pos - 1] + '</span><span class="srt-n">' + esc(x.name) + (x.me ? ' <i>vos</i>' : '') + '</span><b class="srt-pts">' + num(x.points) + ' pts</b></div>').join('') + '</div>'; }
    function joinBlock(s, compact) {
        const me = s.me || {}, ck = me.checks || {}, req = (_data && _data.requirements) || {};
        const cls = compact ? ' compact' : '';
        if (me.joined) return '<div class="srt-reg">✅ Registrado en el ' + esc(s.title) + '<small> · desde el ' + esc(fday(me.joinedAt)) + '</small></div>'; // #929 · #943: por sorteo
        const row = (k, ok, txt, extra) => (req[k] === false ? '' : '<li class="' + (ok ? 'ok' : 'no') + '"><i>' + (ok ? '✅' : '⬜') + '</i><span>' + txt + (extra || '') + '</span></li>');
        const tg = _data && _data.telegramUrl ? ' <button type="button" class="srt-link" onclick="VIP.sorteos.tgOpen()">Unirme ›</button>' : '';
        return '<div class="srt-join' + cls + '"><b>📝 Anotate al ' + esc(s.title) + '</b><small>Sorteo independiente: anotarte acá vale sólo para este sorteo. Para poder ganar tenés que cumplir esto:</small><ul class="srt-req">' +
            row('app', ck.app, 'Tener la app de PICA ROJA instalada', ck.app ? '' : ' <button type="button" class="srt-link" onclick="try{VIP.home.installGiftOpen&&VIP.home.installGiftOpen()}catch(_){}">¿Cómo? ›</button>') +
            row('notif', ck.notif, 'Notificaciones activadas', ck.notif ? '' : ' <button type="button" class="srt-link" onclick="try{VIP.notifications&&VIP.notifications.requestNotificationPermission&&VIP.notifications.requestNotificationPermission()}catch(_){}">Activar ›</button>') +
            row('deposit', ck.deposit, 'Al menos una carga real', ck.deposit ? '' : ' <button type="button" class="srt-link" onclick="VIP.sorteos.close();try{VIP.home.easyLoad()}catch(_){}">Cargar ›</button>') +
            (req.telegram === false ? '' : '<li class="' + (ck.telegram ? 'ok' : 'no') + '"><i>' + (ck.telegram ? '✅' : '⬜') + '</i><label><input type="checkbox" id="srtTg_' + s.key + '"' + (ck.telegram ? ' checked' : '') + '> Ya me uní al Telegram de PICA ROJA (ahí anunciamos los ganadores)</label>' + tg + '</li>') +
            '</ul><button type="button" class="srt-btn' + (compact ? ' sm' : '') + '" onclick="VIP.sorteos.join(\'' + s.key + '\')">Anotarme al ' + esc(s.title) + '</button></div>';
    }
    function crossCard(s) {
        const o = (_data.sorteos || []).find((x) => x.key !== s.key); if (!o) return '';
        const p1 = (o.prizes || [])[0] || {};
        return '<button type="button" class="srt-cross" onclick="VIP.sorteos.open(\'' + o.key + '\')">' + pic(p1.img || o.emoji, 'srt-card-img', p1.name) + '<span class="srt-card-t"><b>' + esc(o.title) + '</b><i>' + esc(p1.name) + '</i><small>' + esc(cardSub(o)) + '</small></span><em>Ver ›</em></button>';
    }
    // #921 (owner): orden de la pantalla — 1) inicio del sorteo bien chico arriba · 2) anotarse compacto · 3) el premio · 4) cómo sumar puntos ·
    // 5) ranking · 6) Bases (y la tarjeta del otro sorteo al final).
    function strip(s) {
        const until = untilOf(s);
        const lbl = s.status === 'soon' ? '⏳ Empieza en <b data-cd-short="' + until + '">' + esc(cdShort(s.startsInMs)) + '</b>' : (s.status === 'live' ? '<em class="srt-live">● EN VIVO</em> · termina en <b data-cd-short="' + until + '">' + esc(cdShort(s.endsInMs)) + '</b>' : '🔒 Cerrado · ganadores el ' + esc(fday(s.publishAt)));
        return '<div class="srt-strip"><span>' + lbl + '</span><small>Del ' + esc(fday(s.start)) + ' al ' + esc(fday(s.end)) + '</small></div>';
    }
    function paintView(key, bodyEl, titleEl) {
        const s = get(key); const b = bodyEl || _el('srtBody'), t = titleEl === undefined ? _el('srtTitle') : titleEl; if (!b) return;
        if (!s) { b.innerHTML = '<div class="srt-note">' + (_data && _data.enabled === false ? 'Por ahora no hay sorteos activos.' : 'Este sorteo no está disponible.') + '</div>'; return; }
        if (t) t.textContent = s.emoji + ' ' + s.title;
        let h = strip(s);                 // 1) inicio, chico
        h += joinBlock(s, true);          // 2) anotarse, compacto
        h += hero(s);                     // 3) el premio
        if (s.extra && s.extra.enabled) h += '<div class="srt-extra"><b>🎁 ' + esc(s.extra.title || 'SORTEO EXTRA') + ' · ' + esc(s.title) + ': ' + num(s.extra.winners) + ' ganadores al azar de ' + money(s.extra.amount) + ' (' + money(s.extra.amount * s.extra.winners) + ' extra en este sorteo)</b><small><b>Extra, aparte del ranking. Para TODOS los que cargan:</b> con ' + num(s.extra.minDeposits) + ' cargas o más ' + (s.key === 'gran' ? 'durante el sorteo' : 'en el mes') + ' entrás al sorteo, ' + (s.extra.requireJoin ? 'estando anotado' : 'estés o no anotado y sin importar el ranking') + '. Se sortea el día 1 del mes siguiente, con la semilla publicada.' + (s.counts.extraElegibles ? ' <b>Ya cumplen ' + num(s.counts.extraElegibles) + ' clientes.</b>' : '') + '</small></div>'; // #939
        // 4) cómo sumar puntos
        h += '<div class="srt-sec"><h3>🧮 Cómo sumás puntos</h3><ul class="srt-rules"><li>🎰 <b>' + num(s.rules.pts) + ' pts</b> cada ' + money(s.rules.ptsPer) + ' apostados con plata real</li>' + (s.rules.dayDepositPts ? '<li>📅 <b>+' + num(s.rules.dayDepositPts) + ' pts</b> por cada día que cargás ' + money(s.rules.dayDepositMin) + ' o más</li>' : '') + (s.rules.missionWeekPct ? '<li>🎯 <b>+' + num(s.rules.missionWeekPct) + '%</b> de tus puntos de la semana si completás tus misiones semanales</li>' : '') + '<li>🚫 Los bonos no suman: cuenta la parte proporcional a tus cargas</li><li>🔄 Se actualiza cada 20 minutos · ganadores el ' + esc(fdh(s.publishAt)) + '</li></ul></div>';
        h += rankingBlock(s);             // 5) ranking
        // 6) #936 (owner): las Bases de ESTE sorteo escritas abajo, sobre el sorteo (sin botón): las del auto en el del auto, las del teléfono en el del teléfono
        // #943 (owner): "las Bases abajo de todo, minimizadas, como para maximizar y leer, y después minimizar de nuevo"
        h += '<div class="srt-sec srt-tc-sec"><button type="button" class="srt-tc-toggle" onclick="VIP.sorteos.tcToggle(this)" aria-expanded="false"><span>📜 Bases y condiciones · ' + esc(s.title) + '</span><i>Maximizar ▾</i></button><ol class="srt-tc" hidden>' + (s.terms || []).map((x) => '<li><b>' + esc(x.t) + ':</b> ' + esc(x.d) + '</li>').join('') + '</ol></div>';
        // #925 (owner): sin la tarjeta del otro sorteo al pie ("sacá adentro del auto, abajo, el del iPhone").
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
    // #935 (owner, captura de la gemela): dentro del casino, con el sorteo ABIERTO hay un banner debajo de la barra ("🏆 Sorteo mensual ·
    // Empieza en… · Ver más ▾" y un – para cerrarlo) y en el medio de la barra queda PICA ROJA; CERRADO, queda la píldora "Sorteo mensual" en el
    // medio y tocarla vuelve a abrir el banner. El estado se recuerda en el teléfono (vip_srt_casino_bar).
    function _casinoBarOpen() { try { return localStorage.getItem('vip_srt_casino_bar') === 'open'; } catch (_) { return false; } } // #937: al iniciar, resumido (píldora) sin abrir
    function casinoBar(open) { try { localStorage.setItem('vip_srt_casino_bar', open ? 'open' : 'closed'); } catch (_) {} paintCasino(); }
    function paintCasino() {
        const list = (_data && _data.enabled && _data.sorteos) || [];
        const s0 = list.find((x) => x.status === 'live') || list[0];
        const btn = _el('casinoSrtBtn'), brand = _el('casinoBrand'), bar = _el('casinoSrtBar');
        if (!btn && !bar) return;
        const openBar = !!s0 && _casinoBarOpen();
        if (brand) brand.hidden = !!s0 && !openBar;
        if (btn) {
            btn.hidden = !s0 || openBar;
            if (s0) { const ti = btn.querySelector('[data-srt-brand-title]'), su = btn.querySelector('[data-srt-brand-sub]'), ic = btn.querySelector('[data-srt-brand-ico]'); const p1 = (s0.prizes || [])[0] || {};
                if (ti) ti.textContent = s0.title; if (ic) { const v = p1.img || s0.emoji || '🏆'; if (isPic(v)) { ic.classList.add('pic'); ic.innerHTML = '<img src="' + esc(v) + '" alt="">'; } else { ic.classList.remove('pic'); ic.textContent = v; } }
                if (su) su.textContent = s0.status === 'live' ? (s0.me && s0.me.joined && s0.me.points > 0 ? 'PUESTO #' + num(s0.me.rank) : 'EN VIVO · NOVEDAD') : (s0.status === 'soon' ? 'NOVEDAD · ' + cdShort(s0.startsInMs).toUpperCase() : 'CERRADO'); }
        }
        if (bar) {
            bar.hidden = !openBar;
            if (openBar) { const p1 = (s0.prizes || [])[0] || {};
                bar.innerHTML = '<button type="button" class="csb-main" onclick="VIP.sorteos.openMini(\'' + s0.key + '\')">' + pic(p1.img || s0.emoji, 'srt-ban-img', p1.name) + '<span class="srt-ban-t"><b>🏆 ' + esc(s0.title) + '</b><small>' + esc(cardSub(s0)) + '</small></span><em>Anotate, es gratis ›</em></button><button type="button" class="csb-x" onclick="VIP.sorteos.casinoBar(false)" title="Cerrar: vuelve arriba, al medio de la barra" aria-label="Cerrar">✕</button>';
            } else bar.innerHTML = '';
        }
    }
    // #933 (owner): "que ese menú en Girox abra una ventana ahí adentro, no en el menú: una explicación resumida y, si quiere ver más, que vaya al
    // menú; sólo el contador y lo que se sortea". Hoja chica sobre el casino: contador vivo, los 3 premios con imagen, 2 líneas y "Ver más".
    function openMini(key) {
        key = key || 'mensual'; closeMini();
        const s = get(key); const m = document.createElement('div'); m.className = 'srt-mini'; m.id = 'srtMini'; m.setAttribute('role', 'dialog');
        m.addEventListener('click', (e) => { if (e.target === m) closeMini(); });
        // #938 (owner): "detallá un poco más de AMBOS sorteos pero resumido, sin que tape tanto; que estén los increíbles premios; el detalle en otro
        // lado; y el Ver más es 'Anotate, es gratis'".
        const inner = () => {
            const list2 = (_data && _data.enabled && _data.sorteos) || [];
            const ordered = ['gran', 'mensual'].map((k) => list2.find((x) => x.key === k)).filter(Boolean);
            if (!ordered.length) return '<div class="srt-mini-box"><div class="srt-note">' + (_data ? 'Por ahora no hay sorteos activos.' : 'Cargando…') + '</div></div>';
            const one = (s2) => {
                const until = untilOf(s2);
                const when = s2.status === 'closed' ? '🔒 Cerrado' : (s2.status === 'soon' ? '⏳ Empieza en <b data-cd-short="' + until + '">' + esc(cdShort(s2.startsInMs)) + '</b>' : '<em class="srt-live">● EN VIVO</em> · termina en <b data-cd-short="' + until + '">' + esc(cdShort(s2.endsInMs)) + '</b>');
                const me = s2.me || {}; const mine = me.joined ? (me.points > 0 ? ' · ✅ puesto #' + num(me.rank) : ' · ✅ anotado') : '';
                return '<div class="srt-mini-s"><div class="srt-mini-sh"><b>' + esc(s2.emoji + ' ' + s2.title) + '</b><small>' + when + mine + '</small></div>' +
                    '<div class="srt-mini-prizes">' + (s2.prizes || []).map((p) => '<div class="srt-mini-p">' + pic(p.img, 'srt-mini-img', p.name) + '<b>' + esc(p.name) + '</b>' + (p.value ? '<small>' + esc(p.value) + '</small>' : '') + '</div>').join('') + '</div>' +
                    '<p class="srt-mini-txt">' + (s2.key === 'gran' ? 'Del ' + esc(fday(s2.start)) + ' al ' + esc(fday(s2.end)) + ' · ' + num(s2.rules.pts) + ' pts cada ' + money(s2.rules.ptsPer) + ' apostados' + (s2.rules.dayDepositPts ? ' · +' + num(s2.rules.dayDepositPts) + ' por día que cargás' : '') + (s2.extra && s2.extra.enabled ? ' · ' + esc(s2.extra.title || 'SORTEO EXTRA') + ': ' + num(s2.extra.winners) + ' × ' + money(s2.extra.amount) + ' al azar' : '') : 'Todos los meses · ' + num(s2.rules.pts) + ' pts cada ' + money(s2.rules.ptsPer) + ' apostados' + (s2.extra && s2.extra.enabled ? ' · ' + esc(s2.extra.title || 'SORTEO') + ': ' + num(s2.extra.winners) + ' × ' + money(s2.extra.amount) + ' para los que cargan ' + num(s2.extra.minDeposits) + ' veces en el mes' : '')) + '. Ganan los 3 anotados con más puntos.</p></div>';
            };
            return '<div class="srt-mini-box"><div class="srt-mini-head"><b>🏆 ¡Increíbles premios!</b><button type="button" class="srt-x" onclick="VIP.sorteos.closeMini()" aria-label="Cerrar">✕</button></div>' + ordered.map(one).join('') +
                '<button type="button" class="srt-btn sm" onclick="VIP.sorteos.goMenu(\'' + ordered[0].key + '\')">Anotate, es gratis ›</button><p class="srt-mini-foot">El detalle completo y las Bases están en el menú.</p></div>';
        };
        m.innerHTML = inner(); document.body.appendChild(m); m._paint = () => { m.innerHTML = inner(); };
        clearInterval(_tick); _tick = setInterval(tickCd, 1000);
        if (!_data) load().then(() => { const x = _el('srtMini'); if (x && x._paint) x._paint(); });
    }
    function closeMini() { const m = _el('srtMini'); if (m) m.remove(); if (!_open && !_inline) clearInterval(_tick); }
    // "Ver más": cierra la hoja y el casino y despliega el sorteo en el menú (donde estén las dos mitades).
    function goMenu(key) {
        closeMini();
        try { if (VIP.ui && VIP.ui.closeCasinoFrame) VIP.ui.closeCasinoFrame(); } catch (_) {}
        setTimeout(() => {
            open(key); // #941: la ventana del sorteo sobre el menú
        }, 350);
    }
    function tcToggle(btn) { try { const ol = btn.nextElementSibling; const open = ol.hidden; ol.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); const i = btn.querySelector('i'); if (i) i.textContent = open ? 'Minimizar ▴' : 'Maximizar ▾'; if (open) setTimeout(() => { try { btn.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {} }, 50); } catch (_) {} }
    function tgOpen() { const u = _data && _data.telegramUrl; if (u) window.open(u, '_blank', 'noopener'); }
    function termsHtml(s) { return '<h2>📜 Bases y condiciones · ' + esc(s.title) + '</h2><ol class="srt-tc">' + (s.terms || []).map((x) => '<li><b>' + esc(x.t) + ':</b> ' + esc(x.d) + '</li>').join('') + '</ol><p class="srt-p srt-muted">PICA ROJA · ' + esc(fday(_data.now)) + '</p>'; }
    function terms(key) {
        const s = get(key || _inlineKey || _open); if (!s) return;
        if (_inline && _inlineKey === s.key) { // #928: las Bases también ahí adentro, con "Volver al sorteo"
            const b = _el('srtInlineBody'); if (!b) return; _inlineView = 'terms';
            b.innerHTML = '<button type="button" class="srt-back-inline" onclick="VIP.sorteos.termsClose()">‹ Volver al sorteo</button>' + termsHtml(s);
            try { _inline.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
            return;
        }
        const box = _el('srtTermsBody'), lay = _el('srtTerms'); if (!box || !lay) return;
        box.innerHTML = termsHtml(s); lay.hidden = false; try { box.scrollTop = 0; } catch (_) {}
    }
    function termsClose() {
        if (_inline && _inlineView === 'terms') { _inlineView = 'main'; paintView(_inlineKey, _el('srtInlineBody'), null); try { _inline.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} return; }
        const lay = _el('srtTerms'); if (lay) lay.hidden = true;
    }
    function init() {
        load(); clearInterval(_poll); _poll = setInterval(load, 5 * 60 * 1000);
        try { document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); }); } catch (_) {}
    }
    VIP.sorteos = { init, load, open, close, closeInline, openMini, closeMini, goMenu, paintCasino, casinoBar, join, terms, termsClose, tcToggle, tgOpen };
})();
