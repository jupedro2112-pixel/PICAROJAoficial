// ========================================
// UI - User-interface utilities module
// ========================================

window.VIP = window.VIP || {};

VIP.ui = (function () {

    // ---- Modal helpers ----

    function showModal(modalId) {
        document.getElementById(modalId).classList.remove('hidden');
    }

    function hideModal(modalId) {
        if (modalId === 'changePasswordModal' && VIP.state.passwordChangePending) {
            return;
        }
        document.getElementById(modalId).classList.add('hidden');

        // Reset OTP step states when closing modals
        if (modalId === 'resetPassModal') {
            const s1 = document.getElementById('resetStep1');
            const s2 = document.getElementById('resetStep2');
            const s3 = document.getElementById('resetStep3');
            if (s1) s1.style.display = '';
            if (s2) s2.style.display = 'none';
            if (s3) s3.style.display = 'none';
        }
        if (modalId === 'registerModal') {
            const s1 = document.getElementById('registerStep1');
            if (s1) s1.style.display = '';
        }
    }

    // ---- Toast & copy ----

    function showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            showToast('✅ Copiado');
        } catch (error) {
            showToast('Error al copiar', 'error');
        }
    }

    function copyToClipboard(elementId) {
        const element = document.getElementById(elementId);
        const text = element.textContent;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('📋 Copiado al portapapeles', 'success');
            }).catch(() => { fallbackCopy(text); });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity  = '0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        try { document.execCommand('copy'); showToast('✅ Copiado', 'success'); } catch (e) {}
        document.body.removeChild(el);
    }

    // ---- Screen switching ----

    function showLoginScreen() {
        try { document.documentElement.classList.remove('has-session'); document.documentElement.classList.remove('access-pending'); } catch (_) {} // #581 // #342: el token no sirvió → ahora sí el login
        document.getElementById('loginScreen').classList.remove('hidden');
        // #283: sin sesión no hay carga gratis pendiente que mostrar.
        try { document.body.classList.remove('ig-pending'); document.body.classList.remove('is-tester'); const b = document.getElementById('installGiftBar'); if (b) b.style.display = 'none'; } catch (_) {}
        document.getElementById('chatScreen').classList.add('hidden');
        // #826: app recién instalada desde el navegador y el acceso automático falló ⇒ el usuario ya viene escrito y se pide sólo la clave.
        try {
            const pu = sessionStorage.getItem('vip_prefill_user');
            const inp = document.getElementById('username');
            if (pu && inp && !inp.value) {
                inp.value = pu;
                const pw = document.getElementById('password'); if (pw) setTimeout(() => { try { pw.focus(); } catch (_) {} }, 300);
                VIP.ui.showToast('👋 Tu usuario ya está escrito: poné tu contraseña para entrar (es la misma de la página).', 'info');
            }
        } catch (_) {}
    }

    function showChatScreen() {
        try { document.documentElement.classList.remove('access-pending'); } catch (_) {} // #581
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('chatScreen').classList.remove('hidden');
        const _username = VIP.state.currentUser?.username || 'Usuario';
        const _curUser = document.getElementById('currentUser');
        if (_curUser) _curUser.textContent = _username;
        const _dashUser = document.getElementById('dashUserName');
        try { const bu = document.getElementById('bsUserName'); if (bu && VIP.state.currentUser) bu.textContent = VIP.state.currentUser.username || '—'; } catch (_) {} // #636
        if (_dashUser) _dashUser.textContent = _username;

        adjustLayout();
        syncBalance();
        startBalancePolling();
        sendWelcomeMessages();
        if (VIP.stories && VIP.stories.load) VIP.stories.load(); // #361: historias activas (anillo arriba a la derecha)
        try { if (VIP.home && VIP.home.maybeShowMenuChooser) VIP.home.maybeShowMenuChooser(); } catch (_) {} // #366: ¿menú fácil o completo? (#595: siempre, también al entrar con el registro)
        // #595 (owner): "cuando entre quede todo minimizado": misiones y VIP plegados, paneles del básico cerrados
        try { localStorage.removeItem('vip_ms_open'); } catch (_) {}
        try { const mb = document.getElementById('missionsCardBody'); if (mb) { mb.hidden = true; mb.style.display = ''; } /* #629: con `hidden`, que es lo que lee toggleMissionsCard; el display:none inline la dejaba trabada */ const vb = document.getElementById('vipCardBody'); if (vb) vb.style.display = 'none'; ['bvLoadPanel', 'bvWdPanel'].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; }); } catch (_) {}
        try { if (VIP.home && VIP.home.refreshPendingDeposits) VIP.home.refreshPendingDeposits(); } catch (_) {} // #376: ¿hay una carga pendiente?

        // Cartel del bono por instalar la app (se muestra si no lo reclamó aún).
        // #596 (owner, limpieza): el cartel del bono por instalar quedó apagado (#221) y no se inicializa más.

        // Encuesta de notificaciones: aparece una sola vez para que el
        // usuario elija su grupo (suave / normal / activo / solo reembolsos).
        // #596 (owner, limpieza): la encuesta de notificaciones ya NO salta sola al entrar (se puede elegir desde Perfil/Configuración).
        // NOTA: el welcome del publicista NO se muestra acá. Se muestra
        // pre-auth desde app.js al cargar la página si el visitante llegó
        // por una vanity URL / ?p=CODE. Ver public/js/publisherwelcome.js.
    }

    // ---- Layout ----

    function adjustLayout() {
        // El layout ahora es una columna flex (.chat-screen): el header y la
        // barra de escribir están en el flujo normal y el chat ocupa el resto
        // con flex:1. No hace falta compensar con márgenes.
    }

    // ---- Balance ----

    async function syncBalance() {
        if (!VIP.state.currentToken || !VIP.state.currentUser) return;

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/balance/live`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.balance !== undefined) {
                    VIP.state.currentUser.balance = data.balance;
                    updateBalanceDisplay(data.balance);

                    const previousBalance = parseFloat(localStorage.getItem('lastBalance') || '0');
                    const newBalance      = parseFloat(data.balance);
                    if (Math.abs(newBalance - previousBalance) > 0.01) {
                        localStorage.setItem('lastBalance', newBalance);
                        if (newBalance > previousBalance) {
                            // Subió el saldo (carga/premio): invitación grande al
                            // casino en vez del toast chico (owner 2026-08-05).
                            showCasinoInvite(newBalance);
                        } else {
                            showBalanceToast(newBalance);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error sincronizando saldo:', error);
        }
    }

    // Saldo empujado por SOCKET (el server emite `balance_updated` al acreditar
    // una carga, premio o devolución): mismo tratamiento que el polling, pero
    // instantáneo — el cliente ve la invitación al casino apenas el agente carga.
    function handleBalancePush(balance) {
        const newBalance = parseFloat(balance);
        if (!Number.isFinite(newBalance)) return;
        if (VIP.state.currentUser) VIP.state.currentUser.balance = newBalance;
        updateBalanceDisplay(newBalance);
        const previousBalance = parseFloat(localStorage.getItem('lastBalance') || '0');
        if (Math.abs(newBalance - previousBalance) > 0.01) {
            localStorage.setItem('lastBalance', newBalance);
            if (newBalance > previousBalance) {
                showCasinoInvite(newBalance);
            } else {
                showBalanceToast(newBalance);
            }
        }
    }

    // ---- Invitación al casino tras una carga (owner 2026-08-05) ----
    // Cuando el saldo SUBE, un recuadro grande y bien visible invita a entrar al
    // casino YA LOGUEADO (VIP.ui.enterCasino, el SSO de siempre). Se va solo a
    // los 15 segundos (barra de tiempo incluida) o con la ✕. Throttle de 60s:
    // el evento puede llegar por socket Y por el polling de saldo — una sola vez.
    let _lastCasinoInviteAt = 0;
    let _casinoInviteTimer = null;

    function showCasinoInvite(balance) {
        // #597 (owner, limpieza): este cartel violeta "¡Saldo acreditado! · Jugar ahora · ¿Ya estás en Telegram?" se SACÓ: duplicaba la
        // burbuja de carga acreditada (#563). Se deja la función (la llama el sondeo de saldo) pero no muestra nada.
        return;
        const now = Date.now();
        if (now - _lastCasinoInviteAt < 60000) return;
        if (!VIP.state.currentUser) return;
        if (VIP.ui._casinoOpen) return; // ya está jugando: no tapar el casino
        _lastCasinoInviteAt = now;

        let box = document.getElementById('casinoInviteBox');
        if (!box) {
            box = document.createElement('div');
            box.id = 'casinoInviteBox';
            box.style.cssText =
                'position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:19000;' +
                'width:min(92vw,380px);background:linear-gradient(150deg,#1a0033,#2d0052);' +
                'border:2px solid #ffd700;border-radius:18px;padding:18px 16px 14px;text-align:center;' +
                'box-shadow:0 12px 44px rgba(212,175,55,0.6);display:none;';
            document.body.appendChild(box);
        }
        const amt = Number(balance) || 0;
        box.innerHTML =
            '<button type="button" onclick="VIP.ui.hideCasinoInvite()" ' +
                'style="position:absolute;top:6px;right:10px;background:none;border:none;color:#999;font-size:20px;cursor:pointer;line-height:1;">×</button>' +
            '<div style="font-size:30px;line-height:1;margin-bottom:6px;">💰</div>' +
            '<div style="color:#00ff88;font-weight:900;font-size:16px;margin-bottom:2px;">¡Saldo acreditado!</div>' +
            '<div style="color:#fff;font-weight:800;font-size:22px;margin-bottom:10px;">$' + amt.toLocaleString('es-AR') + '</div>' +
            '<button type="button" onclick="VIP.ui.hideCasinoInvite();VIP.ui.enterCasino();" ' +
                'style="width:100%;background:linear-gradient(135deg,#d4af37,#ffd700);color:#000;border:none;' +
                'padding:14px;border-radius:26px;font-weight:900;font-size:16px;cursor:pointer;' +
                'box-shadow:0 4px 16px rgba(212,175,55,0.5);">🎰 JUGAR AHORA EN 1GIROX</button>' +
            '<div style="color:#aaa;font-size:10.5px;margin-top:7px;">Entrás directo, con tu sesión ya iniciada</div>' +
            // 🪦 Acá iba el cartel informativo del código de $5.000: reemplazado
            // (owner 2026-08-05) por la mini-ENCUESTA de Comunidad de abajo.
            (localStorage.getItem('communitySurveyDone') === '1' ? '' :
            '<div id="casinoInviteSurvey" style="margin-top:9px;padding:9px 10px;background:rgba(41,169,235,0.10);border:1px solid rgba(41,169,235,0.45);border-radius:10px;">' +
                '<div style="color:#9ad8f7;font-size:11.5px;font-weight:800;">📣 ¿Ya estás en nuestra Comunidad de Telegram?</div>' +
                '<div style="color:#8fb9cc;font-size:10px;margin-top:2px;">Bonos, códigos gratis y avisos exclusivos.</div>' +
                '<div style="display:flex;gap:8px;margin-top:8px;">' +
                    '<button type="button" onclick="VIP.ui.casinoInviteJoinCommunity()" ' +
                        'style="flex:1;background:linear-gradient(135deg,#29a9eb,#53bdeb);color:#fff;border:none;padding:9px 6px;border-radius:18px;font-weight:900;font-size:12px;cursor:pointer;">🚀 SÍ, quiero entrar</button>' +
                    '<button type="button" onclick="VIP.ui.casinoInviteAlreadyIn()" ' +
                        'style="flex:1;background:rgba(255,255,255,0.10);color:#cde;border:1px solid rgba(255,255,255,0.25);padding:9px 6px;border-radius:18px;font-weight:800;font-size:12px;cursor:pointer;">✅ Ya estoy en la Comunidad</button>' +
                '</div>' +
            '</div>') +
            '<div style="height:3px;background:rgba(255,255,255,0.12);border-radius:2px;margin-top:9px;overflow:hidden;">' +
                '<div id="casinoInviteBar" style="height:100%;width:100%;background:#ffd700;transition:width 15s linear;"></div></div>';
        box.style.display = 'block';

        // Barra de tiempo: 100% → 0 en los 15s de vida del recuadro.
        requestAnimationFrame(function () {
            const bar = document.getElementById('casinoInviteBar');
            if (bar) requestAnimationFrame(function () { bar.style.width = '0%'; });
        });
        clearTimeout(_casinoInviteTimer);
        _casinoInviteTimer = setTimeout(hideCasinoInvite, 15000);
    }

    function hideCasinoInvite() {
        clearTimeout(_casinoInviteTimer);
        const box = document.getElementById('casinoInviteBox');
        if (box) box.style.display = 'none';
    }

    // ---- Mini-encuesta de Comunidad dentro de la invitación al casino ----
    // "SÍ, quiero entrar" → abre la Comunidad de Telegram (el link que se carga
    // en el panel → sección Comandos → card Comunidad; chat.js lo mantiene
    // aplicado en el pill del header, con fallback al dominio propio).
    // Cualquiera de las dos respuestas queda recordada: la encuesta no se
    // repite en próximas cargas (localStorage), el resto del cartel sigue igual.
    function casinoInviteJoinCommunity() {
        try { localStorage.setItem('communitySurveyDone', '1'); } catch (e) {}
        const pill = document.getElementById('canalTelegramHeaderBtn');
        // Fallback /go/comunidad: el server redirige al link vigente de la config
        // (owner 2026-08-06 — nunca más el 404 de canal-proximamente).
        const url = (pill && pill.href) || '/go/comunidad';
        window.open(url, '_blank', 'noopener');
        const s = document.getElementById('casinoInviteSurvey');
        if (s) s.style.display = 'none';
    }

    function casinoInviteAlreadyIn() {
        try { localStorage.setItem('communitySurveyDone', '1'); } catch (e) {}
        const s = document.getElementById('casinoInviteSurvey');
        if (s) s.style.display = 'none';
        showToast('¡Genial! 🙌 Gracias por estar en la Comunidad', 'success');
    }

    function showBalanceToast(balance) {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
            color: #000;
            padding: 15px 25px;
            border-radius: 12px;
            font-weight: bold;
            font-size: 16px;
            z-index: 10000;
            animation: slideIn 0.3s ease;
            box-shadow: 0 5px 20px rgba(0, 255, 136, 0.4);
        `;
        toast.innerHTML = `💰 Saldo actualizado: <span style="font-size: 20px;">$${balance.toLocaleString()}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function updateBalanceDisplay(balance) {
        const balanceElement = document.getElementById('userBalance');
        const txt = '$' + Math.round(Number(balance) || 0).toLocaleString('es-AR'); // #847: siempre formato argentino ($12.345)
        if (balanceElement) {
            balanceElement.textContent = txt;
        }
        // #847 (owner): "el saldo del usuario en Girox, en el completo, básico y perfil, arriba de todo": la franja "Tu saldo para jugar".
        try { document.querySelectorAll('.js-play-bal').forEach((el) => { el.textContent = txt; }); } catch (_) {}
        try { const bb = document.getElementById('basicBalance'); if (bb) bb.textContent = txt; } catch (_) {}
    }

    function startBalancePolling() {
        if (VIP.state.balanceCheckInterval) {
            clearInterval(VIP.state.balanceCheckInterval);
        }
        // 90s (antes 30s): el poll de saldo por-usuario era la causa raíz del lag
        // — para jugadores de un publicista TODAS las lecturas van por una única
        // key (30/min) y con pocos usuarios online se saturaba (logs 2026-08-16).
        // El saldo igual se actualiza al instante por socket (`balance_updated`)
        // en cargas/retiros/bonos, y al cerrar el casino (syncBalance). El poll
        // solo cubre cambios por juego mientras el cliente mira la PWA sin jugar.
        VIP.state.balanceCheckInterval = setInterval(syncBalance, 90000);
    }

    function stopBalancePolling() {
        if (VIP.state.balanceCheckInterval) {
            clearInterval(VIP.state.balanceCheckInterval);
            VIP.state.balanceCheckInterval = null;
        }
    }

    // ---- Welcome message ----

    async function sendWelcomeMessages() {
        const welcomeKey  = 'lastWelcome_' + (VIP.state.currentUser?.userId || '');
        const lastWelcome = parseInt(localStorage.getItem(welcomeKey) || '0');
        const hoursSince  = (Date.now() - lastWelcome) / 3600000;
        if (hoursSince < 24) {
            return;
        }

        // La bienvenida ahora la genera el BACKEND como mensaje de sistema
        // (lado admin), no el cliente. Antes se mandaba con el token del
        // usuario vía sendSystemMessage → quedaba registrada con
        // senderRole='user' y aparecía como si la hubiera escrito el propio
        // usuario. El endpoint /api/messages/welcome la crea con
        // senderRole='admin' y tiene su propio throttle de 24h server-side.
        //
        // CON REINTENTOS (fix 2026-08-05): antes un fallo de red se tragaba en
        // silencio y sin retry → el cliente entraba (típico: por link de acceso
        // en una red lenta/Tor) con el chat VACÍO, y como la bienvenida es la
        // que crea el ChatStatus, el chat tampoco aparecía del lado del admin
        // hasta que el cliente escribiera o recargara la página.
        const delays = [0, 2500, 7000]; // 3 intentos
        for (let i = 0; i < delays.length; i++) {
            if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
            try {
                const response = await fetch(`${VIP.config.API_URL}/api/messages/welcome`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${VIP.state.currentToken}`
                    }
                });
                if (response.ok) {
                    // Refrescar el chat para mostrar los mensajes recién creados.
                    setTimeout(() => { try { VIP.chat.loadMessages(); } catch (e) {} }, 300);
                    localStorage.setItem(welcomeKey, Date.now().toString());
                    return;
                }
                // 4xx (ej. 401 por sesión a medio armar): reintentar igual — el
                // endpoint es idempotente (throttle server-side de 24h).
            } catch (error) {
                // red caída/lenta: probamos de nuevo con el próximo delay
            }
        }
        console.warn('[welcome] no se pudo enviar la bienvenida tras 3 intentos (se reintenta en la próxima carga)');
    }

    // ---- CBU ----

    async function loadAndShowCBU(ev, opts) {
        const silent = !!(opts && opts.silent) || (ev && ev.silent === true);
        const now = Date.now();
        if (now - VIP.state.lastCbuClickTime < VIP.config.CBU_CLICK_COOLDOWN_MS) {
            if (!silent) showToast('Espera unos segundos antes de volver a solicitar el CBU.', 'info');
            return;
        }
        VIP.state.lastCbuClickTime = now;

        try {
            const metaEventId = VIP.pixel && VIP.pixel.enabled ? VIP.pixel.newEventId() : null;
            const response = await fetch(`${VIP.config.API_URL}/api/cbu/request`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VIP.state.currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ metaEventId })
            });

            if (response.ok) {
                const data = await response.json();
                document.getElementById('cbuBankDisplay').textContent    = data.cbu.bank    || '-';
                document.getElementById('cbuTitularDisplay').textContent = data.cbu.titular || '-';
                document.getElementById('cbuNumberDisplay').textContent  = data.cbu.number  || '-';
                document.getElementById('cbuAliasDisplay').textContent   = data.cbu.alias   || '-';

                // #364 (owner): sin modal — el CBU aparece directo en el chat como tarjeta con botones.
                setTimeout(() => { VIP.chat.loadMessages(); try { VIP.chat.scrollToBottom && VIP.chat.scrollToBottom(); } catch (_) {} }, 400);
                if (!silent) showToast('💳 CBU enviado al chat 👇', 'success');

                // Meta Pixel — InitiateCheckout (usuario va a depositar).
                if (VIP.pixel) VIP.pixel.trackWithId(metaEventId, 'InitiateCheckout', { content_name: 'cbu_request' });
            } else {
                showToast('Error solicitando CBU', 'error');
            }
        } catch (error) {
            console.error('Error solicitando CBU:', error);
            showToast('Error de conexión', 'error');
        }
    }

    // ---- Referrals (#317, réplica #168-#175 del gemelo, adaptada a 1girox) ----
    // Copys: regla #314 del owner → hablar de "comisión por la ACTIVIDAD de tus referidos",
    // nunca "lo que pierdan" (queda chocante). El número que se muestra es el netwin del mes.
    const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let _refData = null;
    let _refLoadedAt = 0;
    const _refMoney = (n) => '$' + new Intl.NumberFormat('es-AR').format(Math.round(Number(n) || 0));
    function _refPct(rate) { return _refPctNum(_refPctOf(rate)); }
    function _refPctOf(rate) { const n = Number(rate); return Math.round((Number.isFinite(n) ? n : 0) * 10000) / 100; }
    function _refPctNum(p) { const n = Number(p) || 0; return (Number.isInteger(n) ? n : n.toFixed(n * 10 % 1 ? 2 : 1)) + '%'; }
    function _refMaxPct(d) { const lv = (d && d.level) || {}; return _refPctNum(lv.maxPct != null ? lv.maxPct : _refPctOf(d && d.rate)); }
    function _refAgo(d) {
        if (!d) return '';
        const ms = Date.now() - new Date(d).getTime();
        const dias = Math.floor(ms / 86400000);
        if (dias <= 0) return 'hoy';
        if (dias === 1) return 'hace 1 día';
        if (dias < 30) return 'hace ' + dias + ' días';
        const m = Math.floor(dias / 30);
        return m === 1 ? 'hace 1 mes' : 'hace ' + m + ' meses';
    }

    async function fetchReferralDashboard(force) {
        if (!force && _refData && Date.now() - _refLoadedAt < 60000) return _refData;
        const r = await fetch(`${VIP.config.API_URL}/api/referrals/dashboard`, { headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` } });
        if (!r.ok) throw new Error('dashboard ' + r.status);
        const d = await r.json();
        _refData = d; _refLoadedAt = Date.now();
        VIP.state.referralData = d;
        // #171 el cartel promocional muestra el MÁXIMO alcanzable ("hasta el 3%"); el % propio va en el tablero.
        const lv = d.level || {};
        document.querySelectorAll('.referralRatePct').forEach(el => { el.textContent = _refPctNum(lv.maxPct != null ? lv.maxPct : _refPctOf(d.rate)); });
        document.querySelectorAll('.referralMyPct').forEach(el => { el.textContent = _refPctNum(lv.pct != null ? lv.pct : _refPctOf(d.rate)); });
        return d;
    }

    async function openReferralModal() {
        showModal('referralModal');
        await loadReferralData(true);
    }

    async function loadReferralData(force) {
        const c = document.getElementById('referralContent');
        if (c && !_refData) c.innerHTML = '<span style="color:var(--p-muted);font-size:12px;">Cargando tus referidos…</span>';
        try {
            const d = await fetchReferralDashboard(force);
            renderReferralModal(d);
            renderReferralHomeCard(d);
        } catch (err) {
            console.error('[Referrals] Error cargando datos:', err);
            if (c) c.innerHTML = '<span style="color:#ff4444;font-size:12px;">No se pudieron cargar tus datos de referidos. Reintentá.</span>';
        }
    }

    // #171 tile de un NIVEL de comisión (cantidad de referidos activos → %).
    function _refTierHtml(t, lv) {
        const on = t.reached, cur = t.current;
        let foot;
        if (cur) foot = '<span class="ref-pill" style="background:var(--p-green-soft);color:var(--p-green);border:1px solid var(--p-green-soft);">⭐ Tu nivel actual</span>';
        else if (on) foot = '<span class="ref-pill" style="background:var(--p-red-soft);color:var(--p-red);border:1px solid var(--p-red-soft);">✅ Alcanzado</span>';
        else foot = '<span class="ref-pill" style="background:var(--p-surface);color:var(--p-muted);border:1px solid var(--p-surface);">🔒 Te faltan ' + Math.max(0, t.count - (lv.active || 0)) + '</span>';
        return '<div style="flex:1;min-width:96px;text-align:center;padding:9px 6px;border-radius:10px;background:' + (cur ? 'var(--p-green-soft)' : (on ? 'var(--p-red-soft)' : 'var(--p-surface)')) + ';border:1px solid ' + (cur ? 'var(--p-green-soft)' : (on ? 'var(--p-red-soft)' : 'var(--p-surface)')) + ';">' +
            '<div style="font-size:11px;font-weight:900;color:var(--p-text);margin-top:2px;">' + t.count + ' ACTIVOS</div>' +
            '<div style="font-size:22px;font-weight:900;color:' + (on ? 'var(--p-red)' : 'var(--p-muted)') + ';line-height:1.15;">' + _refPctNum(t.pct) + '</div>' +
            '<div style="font-size:9.5px;color:var(--p-muted);margin-bottom:6px;">de comisión</div>' + foot + '</div>';
    }

    function renderReferralModal(d) {
        const c = document.getElementById('referralContent');
        if (!c || !d) return;
        const t = d.totals || {}, lv = d.level || {}, per = d.period || {};
        const pct = _refPct(d.rate);
        const tiers = lv.tiers || [];
        const maxCount = lv.maxCount || (tiers.length ? tiers[tiers.length - 1].count : 10);
        const prog = Math.min(100, Math.round((lv.active || 0) / Math.max(1, maxCount) * 100));
        const tiersOn = lv.enabled !== false && lv.mode === 'tiers' && tiers.length;
        const netInfoId = 'refNetInfo';
        let html = '';
        // Link (solo el link: más directo que el código)
        html += '<div style="background:var(--p-surface);border:1px solid var(--p-red);border-radius:12px;padding:12px;margin-bottom:12px;">' +
            '<span style="color:#b0b0b0;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:5px;">Tu link de referido</span>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<span id="myReferralLink" style="font-size:12px;color:var(--p-green);word-break:break-all;flex:1;min-width:0;">' + _esc(d.referralLink || '—') + '</span>' +
            '<button onclick="VIP.ui.copyReferralLink()" style="background:var(--p-green-soft);border:1px solid var(--p-green);color:var(--p-green);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;">📋 Copiar</button>' +
            '</div>' +
            '<button onclick="VIP.ui.shareReferralLink()" style="width:100%;margin-top:9px;background:var(--p-red);color:#fff;border:none;border-radius:10px;padding:10px;font-weight:900;font-size:13px;cursor:pointer;">🔗 INVITAR A TUS AMIGOS</button>' +
            '<div style="font-size:10px;color:var(--p-muted);margin-top:6px;text-align:center;">Tu amigo entra por el link, se registra y queda vinculado a vos para siempre. Código: <b style="color:var(--p-red);letter-spacing:1px;">' + _esc(d.referralCode || '') + '</b></div>' +
            '</div>';
        // #651 (owner): botón grande con lo ACUMULADO del mes; se desbloquea y acredita solo el 1° (pago automático de referidos)
        html += '<button type="button" class="ref-acc-btn" onclick="VIP.ui.toggleReferralNetLossInfo()">' +
            '<span class="ra-k">💰 Tu comisión acumulada este mes</span>' +
            '<span class="ra-v">' + _refMoney(t.commissionMonth) + '</span>' +
            '<span class="ra-s">Se desbloquea y se acredita sola en tu saldo · ' + _esc(per.nextCredit || 'el 1° del mes que viene') + '</span>' +
            '</button>';
        // Tiles
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">' +
            '<div class="ref-modal-tile" style="border-color:var(--p-green-soft);"><span class="v" style="color:var(--p-green);">👥 ' + (tiersOn ? (lv.active || 0) : (t.active || 0)) + '</span><span class="l">Referidos activos<br><span style="color:var(--p-muted);">(' + (tiersOn ? 'cargaron al menos ' + _refMoney(lv.minChargedARS) : 'los que cargaron') + ')</span></span></div>' +
            '<div class="ref-modal-tile" style="border-color:var(--p-red-soft);"><span class="v" style="color:var(--p-red);">💰 ' + _refMoney(t.commissionMonth) + '</span><span class="l">Tu comisión acumulada<br><span style="color:var(--p-muted);">(' + pct + ' de la actividad de este mes' + (tiersOn ? ' · tu nivel' : '') + ')</span></span></div>' +
            '<div class="ref-modal-tile" style="border-color:var(--p-red-soft);cursor:pointer;" onclick="VIP.ui.toggleReferralNetLossInfo()"><span class="v" style="color:#ff6b6b;">📉 ' + _refMoney(t.netLossMonth) + '</span><span class="l">Actividad neta de tus referidos (este mes)<br><span style="color:#ff9a9a;">ℹ️ tocá: es un monto variable</span></span></div>' +
            '<div class="ref-modal-tile" style="border-color:rgba(0,170,255,.4);"><span class="v" style="color:#4fc3ff;">📊 ' + _refMoney(t.totalCharged) + '</span><span class="l">Total cargado por<br>tus referidos</span></div>' +
            '</div>';
        html += '<div id="' + netInfoId + '" style="display:none;background:var(--p-red-soft);border:1px solid var(--p-red-soft);border-radius:10px;padding:10px;margin-bottom:10px;font-size:11.5px;line-height:1.55;color:#eee;">' +
            '<b style="color:#ff9a9a;">¿Por qué cambia este número?</b> Es el resultado neto del juego de tus referidos en el mes (lo que apostaron menos lo que ganaron), sumado. Si un referido gana, el número BAJA (y tu comisión también); si no, SUBE. Por eso puede moverse día a día. Lo que cobrás se calcula con el número final del mes y se acredita solo el 1° del mes siguiente.' +
            (t.netwinPartial ? '<br><span style="color:#ffb347;">⚠️ Ahora mismo no pudimos leer la actividad de algún referido (la plataforma está demorada): el total puede estar incompleto por unos minutos.</span>' : '') + '</div>';
        html += '<div style="background:var(--p-surface);border-radius:10px;padding:9px 11px;margin-bottom:12px;font-size:11.5px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
            '<span style="color:#b0b0b0;">Período actual: <b style="color:var(--p-text);">' + _esc(per.label || per.key || '—') + '</b></span>' +
            '<span style="color:#b0b0b0;">Próxima acreditación: <b style="color:var(--p-text);">' + _esc(per.nextCredit || '—') + '</b></span></div>';
        // Tabla de referidos
        const rows = d.referrals || [];
        html += '<div style="background:var(--p-surface);border:1px solid var(--p-red-soft);border-radius:12px;padding:10px;margin-bottom:12px;">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:13px;font-weight:900;color:var(--p-red);">👥 MIS REFERIDOS (' + rows.length + ')</span></div>';
        if (!rows.length) {
            html += '<div style="color:var(--p-muted);font-size:12px;padding:8px 0;">Todavía no tenés referidos. Compartí tu link y empezá a cobrar.</div>';
        } else {
            html += '<div style="overflow-x:auto;"><table class="ref-table"><thead><tr><th>Usuario</th><th>Estado</th><th style="text-align:right;">Cargado</th><th style="text-align:right;">Actividad</th><th style="text-align:right;">Tu ' + pct + '</th></tr></thead><tbody>';
            rows.forEach(r => {
                const st = r.active ? '<span class="ref-pill" style="background:var(--p-green-soft);color:var(--p-green);">Activo</span>' : '<span class="ref-pill" style="background:var(--p-red-soft);color:#ff8080;">Sin carga</span>';
                const net = r.netLossMonth === null ? '<span style="color:var(--p-muted);">…</span>' : _refMoney(Math.max(0, r.netLossMonth));
                const com = r.commissionMonth === null ? '<span style="color:var(--p-muted);">…</span>' : '<b style="color:var(--p-green);">' + _refMoney(r.commissionMonth) + '</b>';
                html += '<tr><td><b style="color:var(--p-text);">' + _esc(r.username) + '</b><br><span style="color:var(--p-muted);font-size:9.5px;">Se registró ' + _refAgo(r.registeredAt) + (r.qualified ? ' · ✔ activo para tu nivel' : (r.active ? ' · cargó menos de ' + _refMoney(lv.minChargedARS) : '')) + '</span></td>' +
                    '<td>' + st + '</td><td style="text-align:right;">' + _refMoney(r.totalCharged) + '</td><td style="text-align:right;color:#ff9a9a;">' + net + '</td><td style="text-align:right;">' + com + '</td></tr>';
            });
            html += '</tbody></table></div>';
        }
        html += '</div>';
        // #171 Nivel de comisión según referidos activos
        if (tiersOn) {
            const next = lv.nextTier;
            html += '<div style="background:linear-gradient(135deg,var(--p-text),var(--p-text));border:1.5px solid var(--p-red);border-radius:12px;padding:12px;margin-bottom:12px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;"><span style="font-size:13px;font-weight:900;color:var(--p-red);">🏆 TU NIVEL DE COMISIÓN</span><span style="font-size:12px;color:var(--p-text);font-weight:900;">' + (lv.active || 0) + ' / ' + maxCount + ' <span style="font-size:9.5px;color:var(--p-muted);font-weight:400;">referidos activos</span></span></div>' +
                '<div style="display:flex;align-items:center;gap:10px;margin:8px 0 6px;">' +
                '<div style="font-size:34px;font-weight:900;color:var(--p-green);line-height:1;">' + _refPctNum(lv.pct) + '</div>' +
                '<div style="font-size:11px;color:var(--p-muted);line-height:1.45;">' + (lv.currentTier ? 'Estás en el nivel de <b style="color:var(--p-text);">' + lv.currentTier.count + ' referidos activos</b>. ' : 'Todavía no llegaste al primer nivel. ') +
                (next ? 'Con <b style="color:var(--p-red);">' + next.missing + ' más</b> pasás al <b style="color:var(--p-red);">' + _refPctNum(next.pct) + '</b>.' : '¡Estás en el <b style="color:var(--p-red);">máximo</b>!') + '</div></div>' +
                '<div style="font-size:10.5px;color:var(--p-muted);margin:0 0 6px;">Cuantos más amigos activos traés, mayor es el % de comisión que cobrás por la actividad de TODOS tus referidos, todos los meses. Referido activo = cargó al menos <b style="color:var(--p-text);">' + _refMoney(lv.minChargedARS) + '</b> en total.</div>' +
                '<div class="dash-ref-bar" style="height:11px;"><div class="dash-ref-fill" style="width:' + prog + '%;"></div></div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">' + tiers.map(x => _refTierHtml(x, lv)).join('') + '</div>' +
                (t.historicalMilestones > 0 ? '<div style="font-size:10.5px;color:var(--p-green);margin-top:8px;text-align:center;">Ya cobraste ' + _refMoney(t.historicalMilestones) + ' en premios por referidos 🏆</div>' : '') +
                '</div>';
        }
        html += '<div style="font-size:10.5px;color:var(--p-muted);text-align:center;line-height:1.5;">Total cobrado en comisiones: <b style="color:var(--p-red);">' + _refMoney(t.historicalCommission) + '</b>. La comisión del mes se calcula con la actividad final del mes y se acredita sola el 1° del mes siguiente. Sin límite de referidos ni de ganancia.</div>';
        c.innerHTML = html;
    }

    function toggleReferralNetLossInfo() {
        const el = document.getElementById('refNetInfo');
        if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
    }

    // Card del home: nivel actual + progreso al próximo % + INVITAR AHORA (#171).
    function renderReferralHomeCard(d) {
        const c = document.getElementById('referralHomeCard');
        if (!c) return;
        if (!d) { c.style.display = 'none'; return; }
        const lv = d.level || {}, tiers = lv.tiers || [];
        const tiersOn = lv.enabled !== false && lv.mode === 'tiers' && tiers.length;
        const maxCount = lv.maxCount || (tiers.length ? tiers[tiers.length - 1].count : 10);
        const prog = Math.min(100, Math.round((lv.active || 0) / Math.max(1, maxCount) * 100));
        const steps = tiers.slice(0, 4).map(t => '<div class="dash-ref-step' + (t.reached ? ' on' : '') + '"><b>' + (t.current ? '⭐' : (t.reached ? '✅' : '🔒')) + '</b>' + t.count + ' activos<br>' + _refPctNum(t.pct) + '</div>').join('');
        const next = lv.nextTier;
        c.innerHTML = '<div class="dash-ref">' +
            '<div class="dash-ref-head"><span style="font-size:18px;">👥</span><span class="dash-ref-title">INVITÁ A TUS AMIGOS · cobrá hasta el ' + _refMaxPct(d) + '</span><button class="dash-ref-cta" onclick="VIP.ui.openReferralModal()">VER NIVELES ›</button></div>' +
            (tiersOn ? ('<div class="dash-ref-bar"><div class="dash-ref-fill" style="width:' + prog + '%;"></div></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--p-muted);margin-bottom:4px;"><span>' + (lv.active || 0) + ' / ' + maxCount + ' referidos activos · cobrás <b style="color:var(--p-green);">' + _refPctNum(lv.pct) + '</b></span><span style="color:var(--p-red);">' + (next ? 'Te faltan ' + next.missing + ' para el ' + _refPctNum(next.pct) : '¡Nivel máximo!') + '</span></div>' +
            '<div class="dash-ref-steps">' + steps + '</div>') : '') +
            '<button class="dash-ref-invite" onclick="VIP.ui.shareReferralLink()">🔗 INVITAR AHORA</button>' +
            '</div>';
        c.style.display = '';
        try { adjustLayout(); } catch (_) {}
    }
    async function loadReferralHomeCard() {
        if (!VIP.state || !VIP.state.currentToken) return;
        const u = VIP.state.currentUser;
        if (u && u.role && u.role !== 'user') return;
        try { renderReferralHomeCard(await fetchReferralDashboard(false)); } catch (_) {}
    }

    // Popup promocional: una vez por apertura de la app (sessionStorage), solo clientes.
    // Si hay otro modal abierto (cambio de clave, bienvenida, instalación…) espera a que se
    // cierre (reintenta hasta ~2 min) y recién ahí marca "mostrado".
    let _refPromoTimer = null;
    const REF_PROMO_COOLDOWN_MS = 24 * 60 * 60 * 1000; // #319 (owner): 1 vez cada 24 h por dispositivo (antes 30 min)
    function maybeShowReferralPromo() {
        const u = VIP.state.currentUser;
        if (!u || (u.role && u.role !== 'user')) { console.info('[ref-promo] no se muestra: cuenta de staff o usuario no cargado'); return; }
        // localStorage con cooldown (no sessionStorage: iOS/Chrome restauran la pestaña y el
        // "una vez por apertura" no se disparaba nunca más). ?refpromo=1 fuerza mostrarlo.
        const force = /[?&]refpromo=1/.test(location.search || '');
        try {
            const last = Number(localStorage.getItem('vip_refPromoAt') || 0);
            if (!force && last && Date.now() - last < REF_PROMO_COOLDOWN_MS) { console.info('[ref-promo] ya mostrado hace ' + Math.round((Date.now() - last) / 60000) + ' min'); return; }
        } catch (_) {}
        if (_refPromoTimer) return;
        let tries = 0;
        const attempt = async () => {
            _refPromoTimer = null;
            tries++;
            const cur = VIP.state.currentUser;
            if (!cur || !VIP.state.currentToken) return;
            if (cur.mustChangePassword === true || VIP.state.passwordChangePending || VIP.state._landingCredsActive) { if (tries < 24) _refPromoTimer = setTimeout(attempt, 5000); return; }
            const open = Array.from(document.querySelectorAll('.modal')).find(m => !m.classList.contains('hidden') && m.id !== 'referralPromoModal');
            if (open) { console.info('[ref-promo] espera: modal abierto ' + open.id); if (tries < 24) _refPromoTimer = setTimeout(attempt, 5000); return; }
            try {
                const d = await fetchReferralDashboard(false);
                const ex = document.getElementById('referralPromoExtra');
                const lv = d.level || {};
                if (ex && lv.enabled !== false && lv.mode === 'tiers' && lv.tiers && lv.tiers.length) ex.textContent = 'Tu % sube con tus amigos activos: ' + lv.tiers.map(t => t.count + ' amigos = ' + _refPctNum(t.pct)).join(' · ');
            } catch (_) {}
            try { localStorage.setItem('vip_refPromoAt', String(Date.now())); } catch (_) {}
            console.info('[ref-promo] mostrando');
            showModal('referralPromoModal');
        };
        _refPromoTimer = setTimeout(attempt, 1800);
    }

    // #170 Invitar: copia el link SIEMPRE y abre un chooser con WhatsApp, Telegram, otras apps y copiar.
    // #317: el texto que se comparte es el del comando /sys_referidos_compartir (#308b, editable
    // en COMANDOS, viene en /api/rewards/summary); si no está, uno por defecto. Siempre con el link.
    function _refShareText(link) {
        // #529: en este repo la plantilla viene en el tablero (/api/referrals/dashboard.shareTpl, comando /sys_referidos_compartir)
        let tpl = (_refData && _refData.shareTpl) || '🎰 Sumate a PICA ROJA con mi link: cargas automáticas en segundos y reembolsos todos los días 👉 {link}';
        tpl = String(tpl).replace(/\{link\}/g, link || '').replace(/\{codigo\}/g, (_refData && _refData.referralCode) || '').replace(/\{pct\}/g, String(_refMaxPct(_refData)).replace('%', ''));
        if (link && tpl.indexOf(link) === -1) tpl += '\n' + link;
        return tpl;
    }
    async function shareReferralLink() {
        let link = (_refData && _refData.referralLink) || null;
        if (!link) { try { link = (await fetchReferralDashboard(false)).referralLink; } catch (_) {} }
        if (!link) { showToast('No pudimos generar tu link. Probá de nuevo.', 'error'); return; }
        const pct = _refMaxPct(_refData);
        const text = _refShareText(link);
        let copied = false;
        try { await navigator.clipboard.writeText(link); copied = true; } catch (_) { try { fallbackCopy(link); copied = true; } catch (_) {} }
        const old = document.getElementById('referralShareChooser'); if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'referralShareChooser';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:2147483200;display:flex;align-items:center;justify-content:center;padding:14px;'; // #317: arriba del casino y del hub PREMIOS
        ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
        const enc = encodeURIComponent(text);
        const WA = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';
        const TG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';
        const item = (bg, icon, title, sub, onclick) =>
            '<button onclick="' + onclick + '" style="width:100%;display:flex;align-items:center;gap:12px;background:var(--p-surface);border:1px solid var(--p-border);border-radius:14px;padding:10px 12px;cursor:pointer;margin-top:8px;text-align:left;color:var(--p-text);transition:background .15s;" onmouseover="this.style.background=\'var(--p-surface)\'" onmouseout="this.style.background=\'var(--p-surface)\'">' +
            '<span style="flex-shrink:0;width:42px;height:42px;border-radius:12px;background:' + bg + ';display:flex;align-items:center;justify-content:center;box-shadow:none;">' + icon + '</span>' +
            '<span style="flex:1;min-width:0;"><span style="display:block;font-weight:800;font-size:14px;">' + title + '</span><span style="display:block;font-size:11px;color:var(--p-muted);line-height:1.3;">' + sub + '</span></span>' +
            '<span style="color:var(--p-muted);font-size:18px;">›</span></button>';
        ov.innerHTML = '<div style="background:var(--p-card);border:1px solid var(--p-border);border-radius:22px;padding:16px;max-width:420px;width:100%;color:var(--p-text);box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:var(--p-font);">' /* #651: estilo de la app */ +
            '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">' +
            '<span style="flex-shrink:0;width:40px;height:40px;border-radius:12px;background:var(--p-red);display:flex;align-items:center;justify-content:center;font-size:20px;">🔗</span>' +
            '<div style="flex:1;min-width:0;"><div style="font-weight:900;font-size:16px;letter-spacing:.2px;">Invitá a tus amigos</div>' +
            '<div style="font-size:12px;color:var(--p-muted);margin-top:2px;">Cobrás hasta el <b style="color:var(--p-red);">' + pct + '</b> de comisión por la actividad de tus amigos: cuantos más activos, mayor tu %.</div></div>' +
            '<button onclick="document.getElementById(\'referralShareChooser\').remove()" aria-label="Cerrar" style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:var(--p-surface);border:1px solid var(--p-border);color:var(--p-text);font-size:16px;cursor:pointer;">✕</button></div>' +
            '<div style="background:var(--p-surface);border:1px dashed var(--p-border-hi, var(--p-border));border-radius:12px;padding:9px 11px;display:flex;align-items:center;gap:8px;">' +
            '<span style="flex:1;min-width:0;font-size:11.5px;color:var(--p-text);font-weight:700;word-break:break-all;">' + _esc(link) + '</span>' +
            '<span style="flex-shrink:0;font-size:10.5px;font-weight:800;color:' + (copied ? 'var(--p-green)' : 'var(--p-red)') + ';white-space:nowrap;">' + (copied ? '✓ Copiado' : '') + '</span></div>' +
            '<div style="font-size:10.5px;color:var(--p-muted);margin:10px 0 2px;text-transform:uppercase;letter-spacing:1px;font-weight:800;">Enviar por</div>' +
            item('#25d366', WA, 'WhatsApp', 'Se abre con el mensaje y tu link listos', 'window.open(\'https://wa.me/?text=' + enc + '\',\'_blank\')') +
            item('#229ed9', TG, 'Telegram', 'Elegí el chat o grupo donde compartirlo', 'window.open(\'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text.replace(link, '').trim()) + '\',\'_blank\')') +
            (navigator.share ? item('linear-gradient(135deg,#7c3aed,#4f46e5)', '<span style="font-size:20px;">📤</span>', 'Otras apps', 'Instagram, SMS, Messenger, correo…', 'VIP.ui.shareReferralNative()') : '') +
            item('var(--p-red)', '<span style="font-size:20px;">📋</span>', 'Copiar el link', 'Para pegarlo donde quieras', 'VIP.ui.copyReferralLink()') +
            '</div>';
        document.body.appendChild(ov);
    }
    async function shareReferralNative() {
        const link = (_refData && _refData.referralLink) || '';
        const text = _refShareText(link);
        try { await navigator.share({ title: 'Invitación', text }); const ov = document.getElementById('referralShareChooser'); if (ov) ov.remove(); } catch (e) { /* cancelado */ }
    }
    function copyReferralLink() {
        const link = (_refData && _refData.referralLink) || (document.getElementById('myReferralLink') || {}).textContent || '';
        if (link && link !== '—') navigator.clipboard.writeText(link).then(() => showToast('✅ Link copiado', 'success')).catch(() => fallbackCopy(link));
    }
    function copyReferralCode() { copyReferralLink(); } // legacy: el código ya no se muestra suelto

    // ---- Canal informativo (delegated from chat module) ----

    function loadCanalInformativoUrl() {
        return VIP.chat.loadCanalInformativoUrl();
    }

    // ---- PWA install ----

    async function installApp() {
        const ua        = navigator.userAgent;
        const isIOS     = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
        const isAndroid = /Android/.test(ua);
        const isWindows = /Windows/.test(ua);
        const isMac     = /Macintosh|MacIntel/.test(ua) && !isIOS;

        if (!window.deferredPrompt) {
            // #249: en Android dentro del navegador de Instagram/Facebook/TikTok no existe el
            // prompt nativo. Se abre ESTA página en Google Chrome (intent://), donde el botón
            // instala con un toque. Es el único caso en que la app manda a Chrome (owner).
            // #259 (owner): en Android sin prompt nativo (otro navegador, Instagram, o Chrome sin
            // ofrecerlo) se muestra la info con un BOTÓN "Apretá acá para abrir en Google Chrome"
            // (intent:// que abre esta misma dirección en Chrome; ahí el botón instala directo).
            if (isIOS)          showInstallInstructions('ios');
            else if (isAndroid) showInstallInstructions('android');
            else if (isWindows) showInstallInstructions('windows');
            else if (isMac)     showInstallInstructions('mac');
            else                showInstallInstructions('generic');
            return;
        }

        // #864: el instalador del navegador se usa una sola vez; si falla, instrucciones (antes quedaba trabado sin hacer nada).
        let outcome = 'dismissed';
        try { const dp = window.deferredPrompt; window.deferredPrompt = null; await dp.prompt(); outcome = (await dp.userChoice).outcome; }
        catch (e) { console.warn('[PWA] prompt falló', e); showInstallInstructions(isIOS ? 'ios' : (isAndroid ? 'android' : 'generic')); return; }

        if (outcome === 'accepted') {
            showToast('✅ Instalando app...', 'success');
            // Recordatorio de notificaciones para Android (flujo directo via deferredPrompt)
            setTimeout(() => {
                showInstallInstructions('android-notif');
            }, 2000);
        } else {
            showToast('❌ Instalación cancelada', 'error');
        }
        window.deferredPrompt = null;
    }

    // #826 (owner): "cuando instalan desde el navegador, decirles que vayan a la app de inicio y recordarles su usuario y contraseña; el inicio
    // es automático, pero por si falla". Recuadro con los datos (la clave sólo si la app la conoce: la inicial o la que recordó en el teléfono).
    function installCredsHtml() {
        const u = (VIP.state && VIP.state.currentUser && VIP.state.currentUser.username) || '';
        if (!u) return '';
        let pw = ''; try { pw = (VIP.autoload && VIP.autoload.getPassword && VIP.autoload.getPassword()) || ''; } catch (_) {}
        const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        return '<div style="margin:12px 0 4px;padding:10px 12px;border-radius:12px;border:1px solid var(--p-border,#ddd);background:var(--p-surface,#f5f5f5);text-align:left">' +
            '<p style="margin:0 0 6px;font-weight:800">📲 Después, abrí <b>PICA ROJA</b> desde tu pantalla de inicio</p>' +
            '<p style="margin:0 0 8px;font-size:12.5px">Entrás <b>solo, con tu cuenta</b>. Por si alguna vez te pide los datos:</p>' +
            '<p style="margin:0;font-size:13px">👤 Usuario: <b style="font-family:monospace">' + esc(u) + '</b></p>' +
            '<p style="margin:2px 0 0;font-size:13px">🔑 Contraseña: <b style="font-family:monospace">' + (pw ? esc(pw) : 'la misma que usás acá') + '</b></p>' +
            (pw ? '' : '<p style="margin:6px 0 0;font-size:11.5px;color:var(--p-muted,#777)">¿No la recordás? Cambiala ahora en Perfil → 🔑 Clave antes de instalar.</p>') +
            '</div>';
    }
    function showInstalledReminder() {
        const box = installCredsHtml(); if (!box) return;
        // Si ya hay un aviso de instalación abierto (Android: "Un paso más"), se suma ahí en vez de abrir otro encima.
        const open = document.querySelector('.ios-install-modal .ios-install-content');
        if (open) { if (!open.querySelector('[data-creds]')) { const btn = open.querySelector('button'); const w = document.createElement('div'); w.setAttribute('data-creds', '1'); w.innerHTML = box; open.insertBefore(w, btn); } return; }
        const modal = document.createElement('div');
        modal.className = 'ios-install-modal';
        modal.innerHTML = '<div class="ios-install-content"><h3>✅ ¡App instalada!</h3>' + box +
            '<button onclick="this.closest(\'.ios-install-modal\').remove()" class="btn btn-primary" style="margin-top:15px;">Entendido</button></div>';
        document.body.appendChild(modal);
    }

    function showInstallInstructions(platform) {
        try { if (VIP.home && VIP.home.installManifestSync) VIP.home.installManifestSync(); } catch (_) {} // #826: token fresco antes de "Agregar a inicio"
        const modal = document.createElement('div');
        modal.className = 'ios-install-modal';

        let title, steps, note;
        // Plataformas móviles: se muestra el aviso de notificaciones
        const isMobilePlatform = platform === 'ios' || platform === 'android' || platform === 'android-notif';

        // Pantalla dedicada de recordatorio de notificaciones post-instalación (Android nativo)
        if (platform === 'android-notif') {
            modal.innerHTML = `
                <div class="ios-install-content">
                    <h3>🔔 Un paso más</h3>
                    <div class="ios-notif-note">
                        <p class="t">🔔 Lo más importante: permitir notificaciones</p>
                        <p>
                            Cuando abras la app instalada y te pida acceso,
                            <strong>aceptá y permitir notificaciones</strong>.<br>
                            Sin esto, <u>no te van a llegar los avisos importantes</u>.
                        </p>
                    </div>
                    <button onclick="this.closest('.ios-install-modal').remove()" class="btn btn-primary" style="margin-top:15px;">Entendido</button>
                </div>
            `;
            document.body.appendChild(modal);
            return;
        }

        if (platform === 'ios') {
            title = '📱 Instalar en iPhone / iPad';
            note  = '⚠️ <strong>Solo funciona desde Safari.</strong>';
            steps = [
                'Abrí esta página en <strong>Safari</strong> (no Chrome, no otro navegador)',
                'Tocá el botón <strong>Compartir</strong> <span style="font-size:18px">⬆️</span> en la barra inferior de Safari',
                'Deslizá hacia abajo y tocá <strong>"Agregar a pantalla de inicio"</strong>',
                'Presioná <strong>"Agregar"</strong>'
            ];
        } else if (platform === 'android') {
            title = '📱 Instalar la app en Android';
            // Link de acceso directo a ESTA dirección en Google Chrome (intent://): si Chrome no está
            // abierto lo abre; si no está instalado cae a la misma URL (S.browser_fallback_url).
            let chromeHref = location.href;
            try {
                const u = new URL(location.href);
                chromeHref = 'intent://' + u.host + u.pathname + u.search + '#Intent;scheme=' + u.protocol.replace(':', '') + ';package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end';
            } catch (_) {}
            const isChrome = /Chrome\//.test(navigator.userAgent) && !/EdgA|OPR|SamsungBrowser|Instagram|FBAN|FBAV|FB_IAB/i.test(navigator.userAgent);
            note = '<div style="margin:0 0 12px;">' +
                '<p style="color:#fff;margin:0 0 10px;">' + (isChrome
                    ? 'Estás en Chrome pero todavía no te ofrece instalar. Abrí este link de acceso directo en <strong>Google Chrome</strong> y tocá <strong>Instalar app</strong>:'
                    : 'Para instalar de forma directa, abrí este link de acceso directo en <strong>Google Chrome</strong>:') + '</p>' +
                '<a href="' + chromeHref + '" style="display:block;text-align:center;background:linear-gradient(135deg,#1a73e8,#4285f4);color:#fff;font-weight:900;border-radius:12px;padding:14px;text-decoration:none;font-size:15px;box-shadow:0 6px 18px rgba(26,115,232,.4);">👉 Apretá acá para abrir en Google Chrome</a>' +
                '<button type="button" onclick="VIP.ui.copyText(location.href)" style="display:block;width:100%;margin-top:8px;background:none;border:1px solid rgba(255,255,255,.3);color:#ddd;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;">📋 Copiar el link para pegarlo en Chrome</button>' +
                '</div><p style="color:#aaa;font-size:12px;margin:0 0 6px;">Si Chrome no te muestra "Instalar app" solo, hacelo a mano:</p>';
            steps = [
                'Tocá el ícono <strong>⋮</strong> (tres puntos) arriba a la derecha',
                'Seleccioná <strong>"Instalar app"</strong> o <strong>"Agregar a pantalla de inicio"</strong>',
                'Presioná <strong>"Instalar"</strong>'
            ];
        } else if (platform === 'windows') {
            title = '💻 Instalar en Windows (PC)';
            note  = '💡 Funciona en Chrome o Edge.';
            steps = [
                'Abrí esta página en <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>',
                'En Chrome: hacé clic en el ícono de instalación <strong>⊕</strong> en la barra de direcciones',
                'En Edge: hacé clic en el ícono <strong>⊕</strong> o el menú <strong>⋯</strong> → <strong>"Aplicaciones"</strong> → <strong>"Instalar este sitio como aplicación"</strong>',
                'Confirmá la instalación'
            ];
        } else if (platform === 'mac') {
            title = '💻 Instalar en Mac';
            note  = '💡 Funciona en Chrome o Safari.';
            steps = [
                'Abrí esta página en <strong>Google Chrome</strong> o <strong>Safari</strong>',
                'En Chrome: hacé clic en el ícono <strong>⊕</strong> en la barra de direcciones',
                'En Safari: usá <strong>Archivo → Agregar a Dock</strong> (macOS Sonoma o superior)',
                'Confirmá la instalación'
            ];
        } else {
            title = '📱 Instalar App';
            note  = '';
            steps = [
                'Abrí esta página en <strong>Chrome</strong> o <strong>Safari</strong>',
                'Buscá la opción <strong>"Agregar a pantalla de inicio"</strong> o <strong>"Instalar app"</strong> en el menú del navegador',
                'Confirmá la instalación'
            ];
        }

        // Aviso de notificaciones destacado para iOS y Android
        const notifWarning = isMobilePlatform ? `
            <div class="ios-notif-note">
                <p class="t">🔔 Lo más importante: permitir notificaciones</p>
                <p>
                    Una vez instalada, cuando la app te pida acceso, <strong>aceptá y permitir notificaciones</strong>.
                    Sin esto, <u>no te van a llegar los avisos importantes</u>.
                </p>
            </div>` : '';

        modal.innerHTML = `
            <div class="ios-install-content">
                <h3>${title}</h3>
                ${note ? `<p class="ios-note">${note}</p>` : ''}
                <ol>${steps.map(s => `<li>${s}</li>`).join('')}</ol>
                ${isMobilePlatform ? installCredsHtml() : ''}
                ${notifWarning}
                <button onclick="this.closest('.ios-install-modal').remove()" class="btn btn-primary" style="margin-top:15px;">Entendido</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    function isAppInstalled() {
        const standalone = window.matchMedia('(display-mode: standalone)').matches ||
                           window.navigator.standalone === true;
        if (!standalone) return false;
        // Also require notification permission to be granted
        const notifGranted = ('Notification' in window) && Notification.permission === 'granted';
        return notifGranted;
    }

    function isAppStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone === true;
    }

    return {
        showModal,
        hideModal,
        showToast,
        copyText,
        copyToClipboard,
        fallbackCopy,
        showLoginScreen,
        showChatScreen,
        adjustLayout,
        syncBalance,
        handleBalancePush,
        showCasinoInvite,
        hideCasinoInvite,
        casinoInviteJoinCommunity,
        casinoInviteAlreadyIn,
        showBalanceToast,
        updateBalanceDisplay,
        startBalancePolling,
        stopBalancePolling,
        sendWelcomeMessages,
        loadAndShowCBU,
        openReferralModal,
        loadReferralData,
        copyReferralCode,
        copyReferralLink,
        loadReferralHomeCard, maybeShowReferralPromo, shareReferralLink, shareReferralNative, toggleReferralNetLossInfo, fetchReferralDashboard, // #529
        loadCanalInformativoUrl,
        installApp,
        showInstallInstructions,
        isAppInstalled,
        isAppStandalone,
        installCredsHtml, showInstalledReminder // #829: exportados en el return (asignarlos a VIP.ui DENTRO de este IIFE tiraba error: VIP.ui aún no existe y frenaba TODO el bundle)
    };

})();

// Window aliases for onclick="..." in HTML
window.showModal             = VIP.ui.showModal;
window.hideModal             = VIP.ui.hideModal;
window.showToast             = VIP.ui.showToast;
window.copyText              = VIP.ui.copyText;
window.copyToClipboard       = VIP.ui.copyToClipboard;
window.copyReferralCode      = VIP.ui.copyReferralCode;
window.copyReferralLink      = VIP.ui.copyReferralLink;
window.installApp            = VIP.ui.installApp;
window.showInstallInstructions = VIP.ui.showInstallInstructions;

// ---- PWA install prompt event handlers (must be top-level) ----

window.deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
        return;
    }
    window.deferredPrompt = e;
    const loginInstallBtn  = document.getElementById('installBtn');
    const headerInstallBtn = document.getElementById('headerInstallBtn');
    const appInstallBtn    = document.getElementById('appInstallBtn');
    if (loginInstallBtn)  { loginInstallBtn.style.display = 'flex'; loginInstallBtn.classList.remove('hidden'); }
    if (headerInstallBtn) { headerInstallBtn.style.display = 'flex'; headerInstallBtn.classList.remove('hidden'); }
    if (appInstallBtn)    { appInstallBtn.style.display = 'flex'; appInstallBtn.classList.add('show'); }
});

window.addEventListener('appinstalled', () => {
    const loginInstallBtn  = document.getElementById('installBtn');
    const headerInstallBtn = document.getElementById('headerInstallBtn');
    const appInstallBtn    = document.getElementById('appInstallBtn');
    if (loginInstallBtn)  { loginInstallBtn.style.display = 'none'; loginInstallBtn.classList.add('hidden'); }
    if (headerInstallBtn) { headerInstallBtn.style.display = 'none'; headerInstallBtn.classList.add('hidden'); }
    if (appInstallBtn)    { appInstallBtn.classList.add('hidden'); }
    window.deferredPrompt = null;
    VIP.ui.showToast('✅ App instalada exitosamente', 'success');
    setTimeout(() => { try { VIP.ui.showInstalledReminder(); } catch (_) {} }, 1200); // #826
});

// Hide install buttons if already running as standalone
if (VIP.ui.isAppStandalone()) {
    const loginInstallBtn  = document.getElementById('installBtn');
    const headerInstallBtn = document.getElementById('headerInstallBtn');
    const appInstallBtn    = document.getElementById('appInstallBtn');
    if (loginInstallBtn)  { loginInstallBtn.style.display = 'none'; loginInstallBtn.classList.add('hidden'); }
    if (headerInstallBtn) { headerInstallBtn.style.display = 'none'; headerInstallBtn.classList.add('hidden'); }
    if (appInstallBtn)    { appInstallBtn.classList.add('hidden'); }
}


// Platform modal — private state (no DOM exposure for sensitive data)
VIP.ui._platformPasswordVisible = false;

VIP.ui._copyUsernameToClipboard = function(username, onSuccess) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(username).then(onSuccess).catch(function() {
      VIP.ui.showToast('👤 Tu usuario: ' + username, 'info');
    });
  } else {
    VIP.ui.showToast('👤 Tu usuario: ' + username, 'info');
  }
};

VIP.ui.openPlatformModal = function() {
  const modal = document.getElementById('platformModal');
  if (!modal) return;
  const username = VIP.state.currentUser?.username || '';
  const userEl = document.getElementById('platformModalUser');
  if (userEl) userEl.textContent = username || 'Usuario';

  // Mostrar contraseña si está disponible en memoria de sesión (sin exponerla en el DOM)
  const pwd = VIP.state.sessionPassword || '';
  VIP.ui._platformPasswordVisible = false;
  const pwdEl = document.getElementById('platformModalPassword');
  const pwdInputSection = document.getElementById('platformPasswordInputSection');
  const pwdToggle = document.getElementById('platformPasswordToggle');
  if (pwdEl) {
    pwdEl.textContent = pwd ? '••••••••' : '—';
    if (pwdToggle) pwdToggle.textContent = '👁';
  }
  if (pwdInputSection) pwdInputSection.style.display = pwd ? 'none' : 'block';

  // Resetear feedback de copia
  const feedback = document.getElementById('platformCopyFeedback');
  if (feedback) feedback.style.display = 'none';

  modal.style.display = 'flex';

  // Auto-copiar usuario al abrir el modal
  if (username) {
    VIP.ui._copyUsernameToClipboard(username, function() {
      if (feedback) feedback.style.display = 'block';
      VIP.ui.showToast('✅ Usuario copiado: ' + username, 'success');
    });
  }
};

VIP.ui.closePlatformModal = function() {
  const modal = document.getElementById('platformModal');
  if (modal) modal.style.display = 'none';
};

VIP.ui.copyPlatformUsername = function() {
  const username = VIP.state.currentUser?.username || '';
  if (!username) return;
  const feedback = document.getElementById('platformCopyFeedback');
  VIP.ui._copyUsernameToClipboard(username, function() {
    if (feedback) feedback.style.display = 'block';
    VIP.ui.showToast('✅ Usuario copiado: ' + username, 'success');
  });
};

// ============================================
// ENTRAR AL CASINO — login único (SSO) contra 1girox
// ============================================
//
// Antes: se abría el casino y el usuario tenía que copiar y pegar su usuario y
// contraseña a mano. Ahora el backend pide un link de acceso directo
// (POST /api/platform/session → 1girox POST /players/{username}/session) y el
// usuario entra ya logueado.
//
// ⚠️ POP-UP BLOCKER: el link viene de un fetch (asíncrono) y los navegadores —sobre
// todo en mobile— bloquean window.open si no ocurre DENTRO del gesto del usuario.
// Por eso la pestaña se abre PRIMERO, vacía, y recién después se le cambia la URL.
// Además el código de acceso vence a los 60 segundos, así que no se cachea nada.
VIP.ui._casinoOpening = false;

/**
 * Abre el casino EMBEBIDO en un recuadro a pantalla completa, dentro de la PWA.
 * El jugador nunca sale de VIPCARGAS: cierra el recuadro con la ✕ y vuelve al chat.
 *
 * Orden de las cosas (importa):
 *   1. Se muestra el recuadro con un "cargando" — INMEDIATO, en el mismo click.
 *   2. Recién ahí se pide el link de acceso al backend.
 *   3. Apenas llega, se carga en el iframe.
 *
 * ⚠️ Por qué se pide el link DESPUÉS de abrir el recuadro y no antes: el código de
 * acceso vence a los 60 SEGUNDOS y es de un solo uso. Cuanto menos tiempo pase entre
 * que la plataforma lo emite y el navegador lo usa, mejor. En conexiones lentas (o por
 * Tor) pedirlo antes y usarlo después llegaba vencido: "El enlace expiró".
 */
VIP.ui._casinoOpen = false;

/** Pide el link SSO del casino, CON TIMEOUT. Sin el timeout, un fetch colgado
 *  (red móvil que parpadea) dejaba `_casinoOpening` trabado en true por minutos
 *  → el botón CASINO no hacía NADA al volver a tocarlo ("no ingresa y queda en
 *  el mismo lugar", reclamo del owner 2026-08-19).
 *  @returns {ok:true, url} | {ok:false, error, retryable} */
// #854: con el casino YA abierto (sesión iniciada en el recuadro), ir directo a una sección/juego de la plataforma sin otro ingreso.
// Devuelve true si navegó. Lo usan favoritos e historias (Deportes, juegos).
VIP.ui.casinoGoTo = function(path) {
  // #857: DESACTIVADO — recargar el recuadro pierde la sesión de la web de 1girox. Los que la llaman caen al camino normal (cerrar y abrir
  // con el juego pedido al server). Se deja la función para no romper a quien la use.
  if (true) return false;
  try {
    if (!VIP.ui._casinoOpen || !/^\/(play\/[\w.\-\/]+|sports)$/.test(String(path || ''))) return false;
    const fr = document.getElementById('casinoFrame'); const src = fr && fr.getAttribute('src');
    if (!src || src === 'about:blank') return false;
    fr.src = new URL(src, location.href).origin + path; return true;
  } catch (_) { return false; }
};
VIP.ui._fetchCasinoSession = async function(timeoutMs) {
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function() { ctrl.abort(); }, timeoutMs || 20000) : null;
  try {
    const response = await fetch(`${VIP.config.API_URL}/api/platform/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VIP.state.currentToken}`
      },
      // Multi-plataforma (#219/#220): a qué casino entrar. Sin el campo el back usa girox.
      body: JSON.stringify({ platform: VIP.ui._casinoPlatform || 'girox', game: VIP.ui._casinoGamePath || undefined, gameName: VIP.ui._casinoGameName || undefined }), // #855/#857
      signal: ctrl ? ctrl.signal : undefined
    });
    const data = await response.json().catch(function() { return {}; });
    if (response.ok && data.success && data.redirectUrl) {
      // #857: recargar el recuadro para ir al juego/Deportes PIERDE la sesión de la web de 1girox ⇒ ya no se salta después del ingreso:
      // o el server devolvió el juego directo (launch_url del proveedor), o se abre Girox logueado (como el botón) y se avisa dónde está.
      const _gp = VIP.ui._casinoGamePath, _gn = VIP.ui._casinoGameName; VIP.ui._casinoGamePath = null; VIP.ui._casinoGameName = null; VIP.ui._casinoGameReady = false;
      if (_gp && !data.directGame) setTimeout(function () { try { VIP.ui.showToast((_gp === '/sports' ? '⚽ Ya entraste a Girox: tocá DEPORTES en el menú de arriba de Girox' : ('🎰 Ya entraste a Girox con tu cuenta: tocá la lupa 🔍 y buscá ' + (_gn || 'el juego'))) + (data.gameStep && _gp !== '/sports' && !/abrí el juego/.test(data.gameStep) ? ' · (' + data.gameStep + ')' : ''), 'info'); } catch (_) {} }, 4000); // #859: motivo visible
      return { ok: true, url: data.redirectUrl };
    }
    // 5xx = plataforma demorada/saturada → vale reintentar. 4xx (bloqueado,
    // límite de intentos) no: reintentar no lo va a cambiar.
    // #695: `status` para que el error diga QUÉ pasó (un 502/503 del hosting mientras el servidor arranca o se
    // redeploya no trae JSON y antes quedaba como "revisá tu internet").
    return { ok: false, error: data.error || null, retryable: response.status >= 500, status: response.status };
  } catch (e) {
    const timedOut = !!(e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message || ''))));
    return { ok: false, error: null, retryable: true, timedOut: timedOut, status: 0 }; // timeout o red caída → reintentable
  } finally {
    if (timer) clearTimeout(timer);
  }
};

VIP.ui.enterCasino = async function(platformId) {
  if (VIP.ui._casinoOpening) return; // anti doble-click
  VIP.ui._casinoOpening = true;
  // Multi-plataforma: con qué plataforma pedir el SSO (default girox). Lo lee
  // _fetchCasinoSession; los reintentos y "Casino aparte" reusan el mismo valor.
  VIP.ui._casinoPlatform = (typeof platformId === 'string' && platformId) ? platformId : 'girox';

  VIP.ui.closePlatformModal();
  VIP.ui._showCasinoFrame();   // recuadro visible YA, con "cargando"

  try {
    // REINTENTO AUTOMÁTICO (owner 2026-08-19): a veces el primer pedido del link
    // SSO falla (saturación momentánea, red móvil) y el jugador tenía que tocar
    // el botón de nuevo. Ahora se reintenta solo antes de mostrar el error.
    // #695 (owner, captura "Reintentando (3/3)" → "revisá tu internet"): el servidor puede tardar más de 20 s en
    // contestar (arranque en frío del hosting de prueba, redeploy, plataforma lenta) y la app se rendía antes de
    // tiempo. Ahora espera hasta 30 s por intento, 4 intentos, y avisa que puede demorar.
    const MAX_TRIES = 4;
    const WAITS = [0, 1500, 3000, 5000];
    let last = null;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      if (!VIP.ui._casinoOpen) return; // salió del casino mientras cargaba
      if (attempt > 1) {
        const status = document.getElementById('casinoFrameStatus');
        if (status) status.textContent = '🔄 Conectando con el casino… puede tardar unos segundos (' + attempt + '/' + MAX_TRIES + ')';
        await new Promise(function(r) { setTimeout(r, WAITS[attempt - 1] || 3000); });
        if (!VIP.ui._casinoOpen) return;
      }
      last = await VIP.ui._fetchCasinoSession(30000);
      if (last.ok || !last.retryable) break;
    }

    if (last && last.ok) {
      // Si cerró el overlay durante el pedido, NO arrancar el casino oculto
      // (quedaría corriendo con sonido de fondo).
      if (!VIP.ui._casinoOpen) return;
      const frame = document.getElementById('casinoFrame');
      if (frame) frame.src = last.url;

      // VIGILANTE: el `load` del iframe dispara aunque la app de adentro se quede
      // colgada. El caso típico es el BLOQUEO DE COOKIES DE TERCEROS: el casino
      // carga, intenta leer su sesión, el navegador se la niega por estar embebido
      // en otro dominio, y queda girando para siempre. Desde afuera no se puede
      // detectar (es otro origen, no podemos mirar adentro), así que se usa un
      // tiempo límite y se le ofrece al jugador la salida.
      clearTimeout(VIP.ui._casinoWatchdog);
      VIP.ui._casinoWatchdog = setTimeout(function() {
        if (!VIP.ui._casinoOpen) return;
        VIP.ui._casinoFrameStuck();
      }, 15000);
      return;
    }

    // #695: motivo claro según lo que pasó (sin inventar "tu internet" cuando el servidor es el que no contestó).
    let why = last && last.error;
    if (!why) {
      if (last && last.timedOut) why = 'El servidor tardó demasiado en responder. Esperá unos segundos y tocá Reintentar.';
      else if (last && last.status >= 500) why = 'El servidor está ocupado o reiniciando (error ' + last.status + '). Esperá unos segundos y tocá Reintentar.';
      else if (last && last.status === 0) why = 'No hay conexión con el servidor. Revisá tu internet y tocá Reintentar.';
      else why = 'No pudimos abrirte el casino. Tocá Reintentar.';
    }
    VIP.ui._casinoFrameError(why);
  } finally {
    VIP.ui._casinoOpening = false;
  }
};

/**
 * Abre el casino en una PESTAÑA APARTE (no embebido).
 *
 * Es la salida cuando el navegador no deja que el casino funcione dentro del
 * recuadro. Al abrirse como sitio principal, sus cookies dejan de ser "de terceros"
 * y la sesión funciona normal.
 *
 * ⚠️ La pestaña se abre ANTES del fetch, dentro del gesto del usuario: si se abriera
 * después, el bloqueador de pop-ups (sobre todo en mobile) la mataría.
 * Y se pide un link NUEVO a propósito: el anterior ya lo consumió el iframe y los
 * códigos son de un solo uso.
 */
VIP.ui.openCasinoInTab = async function() {
  let win = null;
  try {
    win = window.open('', '_blank');
    if (win && win.document) {
      win.document.write(
        '<!doctype html><meta charset="utf-8"><title>Entrando al casino…</title>' +
        '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
        'height:100vh;background:#12101a;color:#d4af37;font-family:system-ui,sans-serif;' +
        'font-size:18px;font-weight:700">🎰 Entrando al casino…</body>'
      );
    }
  } catch (e) { win = null; }

  try {
    // Mismo reintento automático que enterCasino (la pestaña placeholder ya
    // está abierta, así que reintentar el fetch no molesta al pop-up blocker).
    let r = await VIP.ui._fetchCasinoSession(20000);
    if (!r.ok && r.retryable) {
      try { if (win && !win.closed && win.document && win.document.body) win.document.body.textContent = '🔄 Reintentando…'; } catch (e2) {}
      await new Promise(function(res) { setTimeout(res, 1500); });
      r = await VIP.ui._fetchCasinoSession(20000);
    }

    if (r.ok) {
      if (win && !win.closed) {
        win.location.href = r.url;
      } else {
        // Pop-up bloqueado → se navega en la pestaña actual.
        window.location.href = r.url;
        return;
      }
      VIP.ui.closeCasinoFrame();
      return;
    }
    if (win && !win.closed) win.close();
    VIP.ui.showToast(r.error || 'No pudimos abrirte el casino. Intentá de nuevo.', 'error');
  } catch (e) {
    if (win && !win.closed) win.close();
    VIP.ui.showToast('Sin conexión. Intentá de nuevo.', 'error');
  }
};

/** El casino no terminó de cargar dentro del recuadro: se ofrece abrirlo aparte. */
VIP.ui._casinoFrameStuck = function() {
  const status = document.getElementById('casinoFrameStatus');
  const frame = document.getElementById('casinoFrame');
  if (!status) return;
  // El iframe se deja visible por si en realidad terminó de cargar y sólo tardó:
  // el aviso se muestra encima, sin tapar el juego.
  status.style.display = 'flex';
  status.style.position = 'absolute';
  status.style.inset = 'auto 0 0 0';
  status.style.background = 'rgba(13,13,26,0.96)';
  status.style.padding = '18px';
  status.innerHTML =
    '<div style="color:#ffd479;font-size:15px;font-weight:700;line-height:1.45;max-width:460px;">' +
      '¿El casino no termina de cargar?</div>' +
    '<div style="color:#aaa;font-size:13px;font-weight:400;line-height:1.45;max-width:460px;">' +
      'Tu navegador puede estar bloqueando el casino por estar abierto acá adentro. ' +
      'Abrilo aparte y va a funcionar normal.</div>' +
    '<button type="button" onclick="VIP.ui.openCasinoInTab()" ' +
      'style="background:linear-gradient(135deg,#6a0dad,#9b30ff);color:#fff;border:none;' +
      'padding:12px 26px;border-radius:24px;font-weight:800;font-size:15px;cursor:pointer;">' +
      '↗ Abrir el casino aparte</button>' +
    '<button type="button" onclick="document.getElementById(\'casinoFrameStatus\').style.display=\'none\'" ' +
      'style="background:none;color:#888;border:none;font-size:13px;cursor:pointer;">' +
      'Seguir esperando</button>';
  if (frame) frame.style.display = 'block';
};

/** Envía un mensaje al cajero desde el pop-up (mismo camino que escribir a mano
 *  → cae en el panel adminprivado2026). */
VIP.ui._casinoSendQuick = function(text) {
  const input = document.getElementById('messageInput');
  if (!input) return false;
  input.value = text;
  try { if (VIP.chat && VIP.chat.sendMessage) VIP.chat.sendMessage(); } catch (e) {}
  return true;
};

/** Acciones rápidas del pop-up. TODO termina en el chat del cajero; los botones
 *  solo le ahorran al cliente tener que escribir. */
VIP.ui.casinoQuickAction = function(action, arg) {
  switch (action) {
    case 'cargar-toggle': {
      const row = document.getElementById('casinoAmountRow');
      if (row) row.style.display = (row.style.display === 'none' || !row.style.display) ? 'flex' : 'none';
      return;
    }
    case 'cargar':
      VIP.ui._casinoSendQuick('🎰 Quiero cargar $' + Number(arg).toLocaleString('es-AR'));
      break;
    case 'cargar-otro': {
      const i = document.getElementById('messageInput');
      if (i) { i.value = '🎰 Quiero cargar $'; i.focus(); }
      break;
    }
    case 'cbu':
      try { if (VIP.ui.loadAndShowCBU) VIP.ui.loadAndShowCBU(); } catch (e) {}
      break;
    case 'comprobante': {
      const a = document.getElementById('attachBtn');
      if (a) a.click();
      break;
    }
    case 'saldo':
      try { if (VIP.ui.syncBalance) VIP.ui.syncBalance(); } catch (e) {}
      VIP.ui._casinoSendQuick('👛 ¿Me confirmás mi saldo?');
      break;
    case 'retirar': {
      // FORMULARIO REAL de retiro (pedido owner 2026-08-25): antes solo mandaba
      // "quiero retirar" al chat de CARGAS — el pedido nunca llegaba al sector
      // PAGOS y alentecía todo. Ahora abre el MISMO modal autogestionado del
      // chat normal (datos bancarios + SMS → /api/withdrawal/request → bandeja
      // de Pagos), igual que el botón "💸 RETIRAR MI PREMIO" de la página.
      try {
        if (VIP.withdraw && VIP.withdraw.openWithdrawModal) {
          // El overlay del casino vive en z-index 99999 y los modales en 10000:
          // se eleva el modal para que se vea ENCIMA del casino.
          const m = document.getElementById('withdrawModal');
          if (m) m.style.zIndex = '100001';
          VIP.withdraw.openWithdrawModal();
          break;
        }
      } catch (e) { /* si el módulo no está, cae al mensaje de siempre */ }
      VIP.ui._casinoSendQuick('💸 Quiero retirar mi premio');
      break;
    }
    case 'escribir': {
      const e2 = document.getElementById('messageInput');
      if (e2) e2.focus();
      break;
    }
  }
};

/** Crea (una sola vez) y muestra el recuadro del casino. */
VIP.ui._showCasinoFrame = function() {
  let overlay = document.getElementById('casinoOverlay');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'casinoOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#0d0d1a;display:flex;flex-direction:column;' +
      // PWA instalada en iPhone (viewport-fit=cover): padding de safe-area arriba
      // y abajo → el casino no queda bajo el notch ni en la zona del home
      // indicator (barras oscuras discretas del color del overlay).
      // #823: SIN padding arriba: la barra del casino (#casinoTopBar) ya deja el margen; con los dos se sumaba dos veces (franja vacía en
      // iPhone con isla y en muchos Android).
      'padding-bottom:env(safe-area-inset-bottom,0px);';
    // Diseño (owner 2026-08-16): el casino se ve TAL CUAL 1girox.com (iframe a
    // pantalla completa, sin barra propia arriba). Todo el "chrome" (soporte,
    // salir, abrir aparte) vive en una BURBUJA de soporte flotante abajo a la
    // derecha que abre el chat con las acciones rápidas.
    overlay.innerHTML =
      '<div id="casinoFrameStatus" style="flex:1;display:flex;flex-direction:column;gap:14px;' +
        'align-items:center;justify-content:center;color:#d4af37;font-size:16px;font-weight:700;' +
        'text-align:center;padding:20px;">🎰 Entrando al casino…</div>' +
      // `allow` habilita pantalla completa y sonido dentro de los juegos.
      // #868: franjas finas en los bordes para el gesto de "volver" (el iframe del casino se come los toques)
      '<div class="swipe-edge swipe-edge-l" aria-hidden="true"></div><div class="swipe-edge swipe-edge-r" aria-hidden="true"></div>' +
      '<iframe id="casinoFrame" title="Casino" style="flex:1;width:100%;border:0;display:none;" ' +
        'allow="autoplay; fullscreen; payment"></iframe>' +
      // BURBUJA de soporte flotante (abajo a la derecha) — abre el chat de acciones.
      // PASTILLA con logo 1G + texto (owner 2026-08-25): el circulito 🎧 parecía
      // el soporte propio de la página del casino. Con el logo de la app y
      // "CARGA RÁPIDA" a la vista queda claro que es NUESTRO chat de cargas.
      '<button type="button" id="casinoSupportBubble" onclick="VIP.ui.toggleCasinoChat()" ' +
        'title="Carga rápida 1GIROX — arrastrame si te tapa el juego" style="position:absolute;z-index:6;right:16px;' +
        'bottom:calc(18px + env(safe-area-inset-bottom,0px));border-radius:28px;' +
        'background:linear-gradient(135deg,#128c4a,#25d366);color:#fff;border:none;' +
        'box-shadow:0 6px 20px rgba(0,0,0,0.55);cursor:pointer;' +
        'display:flex;align-items:center;gap:8px;padding:8px 14px 8px 8px;">' +
        '<img src="/icons/icon-96x96.png" alt="1G" style="width:32px;height:32px;border-radius:50%;' +
        'background:#0d0d1a;padding:3px;object-fit:contain;flex:0 0 auto;">' +
        '<span style="font-weight:800;font-size:12px;letter-spacing:0.4px;white-space:nowrap;">CARGA RÁPIDA</span>' + // #723: simple, sin avisos
        '<span id="casinoChatBadge" style="display:none;position:absolute;top:-2px;right:-2px;' +
        'background:#e53935;color:#fff;border-radius:11px;min-width:20px;height:20px;line-height:20px;' +
        'font-size:12px;font-weight:800;padding:0 5px;text-align:center;">0</span></button>' +
      // #630 (owner 2026-10-20): el cajón de chat de adentro del casino (#casinoChatDrawer: Quiero Depositar, Pedir CBU, Hablar…)
      // se ELIMINÓ. En el casino sólo existe el panel chico de Carga rápida (home.js toggleCasinoLoad): datos + adjuntar, y la ✕ lo saca.
      '';
    document.body.appendChild(overlay);

    // Cuando el casino termina de cargar, se esconde el "cargando" y se muestra el juego.
    const frame = overlay.querySelector('#casinoFrame');
    frame.addEventListener('load', function() {
      // Solo cuenta el load del CASINO REAL. ⚠️ Antes el guard era `!frame.src`
      // y el reset hacía `frame.src=''` — un src vacío NAVEGA el iframe a la
      // URL de la PROPIA app (bloqueada por X-Frame-Options) y ese load espurio
      // pasaba el guard → se escondía el "Entrando al casino…" y quedaba un
      // recuadro vacío. Era LA causa del "toco el botón, carga y falla; a la
      // segunda entra" (carrera entre ese load y la llegada del link SSO).
      const src = frame.getAttribute('src');
      if (!src || src === 'about:blank') return;
      const status = document.getElementById('casinoFrameStatus');
      // #851: si se pidió un JUEGO, el primer load es el login (SSO): el cartel "Abriendo <juego>…" sigue tapando hasta que carga el juego.
      const _gpNext = VIP.ui._casinoGamePath && /^\/(play\/|sports$)/.test(VIP.ui._casinoGamePath);
      if (VIP.ui._gameNavPending) { VIP.ui._gameNavPending = false; clearTimeout(VIP.ui._gameNavSafety); }
      if (!_gpNext) { if (status) { status.style.display = 'none'; status.textContent = '🎰 Entrando al casino…'; } frame.style.display = 'block'; }
      // Si el HTML del casino llegó, se cancela el vigilante: el aviso "¿no
      // termina de cargar?" aparecía ENCIMA del casino ya funcionando (reclamo
      // owner 2026-08-15). Para el caso raro de app colgada por cookies
      // bloqueadas, el escape "↗ Abrir aparte" sigue SIEMPRE en la barra.
      clearTimeout(VIP.ui._casinoWatchdog);
      // #782: si se tocó la foto de un juego, después de que el SSO dejó la sesión iniciada se navega el recuadro DIRECTO a ese
      // juego (misma web, misma sesión). 1,5 s de margen para que el intercambio del código de un solo uso termine.
      const gp = VIP.ui._casinoGamePath; if (gp && /^\/(play\/|sports$)/.test(gp)) { // #827: también Deportes
        VIP.ui._casinoGamePath = null;
        // #851 (owner: "que use el mismo ingreso de Girox de la app y entre al juego específico con el mismo menú"): mismo SSO que el botón
        // de Girox; el login de 1girox (canje del código + datos del jugador) tarda unos segundos ⇒ recién a los 5 s se pasa al juego.
        // Mientras, el cartel tapa el recuadro (no se ve el inicio de Girox). Red de seguridad: a los 15 s se muestra igual.
        try {
          const origin = new URL(src, location.href).origin;
          if (status) { status.style.display = ''; status.textContent = '🎰 Abriendo tu juego…'; }
          const _wait = VIP.ui._casinoGameReady ? 3500 : 8000; VIP.ui._casinoGameReady = false; // #855: sesión ya canjeada ⇒ 3,5 s; si no, 8 s
          setTimeout(function() { if (VIP.ui._casinoOpen) { VIP.ui._gameNavPending = true; frame.src = origin + gp; VIP.ui._gameNavSafety = setTimeout(function() { const st = document.getElementById('casinoFrameStatus'); if (st) { st.style.display = 'none'; st.textContent = '🎰 Entrando al casino…'; } frame.style.display = 'block'; }, 15000); } }, _wait);
        } catch (_) { if (status) status.style.display = 'none'; frame.style.display = 'block'; }
      }
    });

    // BURBUJA ARRASTRABLE (owner 2026-08-25): la burbuja fija tapaba controles
    // de algunos juegos (ej. la botonera de la ruleta, abajo a la derecha) y el
    // jugador no tenía forma de tocar lo que quedaba debajo. Ahora se arrastra
    // con el dedo (o mouse); al soltarla se pega al borde izquierdo o derecho
    // (imán, estilo burbuja de Messenger) y queda ahí mientras el casino siga
    // abierto. Un toque SIN arrastre sigue abriendo el chat como siempre.
    (function _makeBubbleDraggable() {
      const b = overlay.querySelector('#casinoSupportBubble');
      if (!b || !window.PointerEvent) return; // sin pointer events → burbuja fija como antes
      b.style.touchAction = 'none'; // sin esto, el navegador scrollea en vez de arrastrar
      // #598: posición recordada
      try { const pos = JSON.parse(localStorage.getItem('vip_cq_pos') || 'null'); if (pos && pos.left >= 0 && pos.top >= 0 && pos.left < window.innerWidth - 60 && pos.top < window.innerHeight - 40) { b.style.left = pos.left + 'px'; b.style.top = pos.top + 'px'; b.style.right = 'auto'; b.style.bottom = 'auto'; } } catch (_) {}
      let startX = 0, startY = 0, startRect = null, dragging = false;
      b.addEventListener('pointerdown', function(e) {
        startX = e.clientX; startY = e.clientY;
        startRect = b.getBoundingClientRect();
        dragging = false;
        try { b.setPointerCapture(e.pointerId); } catch (_) {}
      });
      b.addEventListener('pointermove', function(e) {
        if (!startRect) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        // Umbral tap/arrastre: menos de 8px de movimiento sigue siendo un toque.
        if (!dragging && (Math.abs(dx) + Math.abs(dy)) < 8) return;
        dragging = true;
        const x = Math.min(Math.max(4, startRect.left + dx), window.innerWidth - startRect.width - 4);
        const y = Math.min(Math.max(10, startRect.top + dy), window.innerHeight - startRect.height - 10);
        b.style.left = x + 'px';
        b.style.top = y + 'px';
        b.style.right = 'auto';
        b.style.bottom = 'auto';
      });
      const end = function() {
        if (startRect && dragging) {
          // Imán al borde horizontal más cercano; la altura queda donde la dejó.
          // #598 (owner): queda DONDE la dejó (sin imán al borde) y se recuerda la posición.
          const r = b.getBoundingClientRect();
          VIP.ui._bubbleSide = (r.left + r.width / 2) < window.innerWidth / 2 ? 'left' : 'right';
          try { localStorage.setItem('vip_cq_pos', JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })); } catch (_) {}
          // El click que dispara el navegador justo después del arrastre NO
          // debe abrir el chat: se marca y se limpia solo a los 400ms (por si
          // el click nunca llega, no queda un toque "muerto").
          VIP.ui._bubbleWasDragged = true;
          setTimeout(function() { VIP.ui._bubbleWasDragged = false; }, 400);
        }
        startRect = null; dragging = false;
      };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
    })();
  }

  // Reset al abrir (por si venía de un intento anterior que falló).
  const frame = overlay.querySelector('#casinoFrame');
  const status = overlay.querySelector('#casinoFrameStatus');
  // ⚠️ 'about:blank', NUNCA '': el string vacío navega el iframe a la URL base
  // (la propia PWA) — request inútil + load espurio que rompía la carga.
  if (frame) { frame.src = 'about:blank'; frame.style.display = 'none'; }
  if (status) { status.style.display = 'flex'; status.textContent = '🎰 Entrando al casino…'; }

  overlay.style.display = 'flex';
  // Bloquea el scroll del fondo mientras el casino está abierto.
  document.body.style.overflow = 'hidden';
  VIP.ui._casinoOpen = true;

  // Badge de mensajes sin leer mientras juega: observa el listado real del chat
  // (chat.js sigue appendeando ahí aunque el casino lo tape) y cuenta lo que
  // llega con el panel de chat CERRADO. Vive para siempre; los guards de arriba
  // lo apagan fuera del casino.
  // #630: sin cajón de chat no hay contador de no leídos en la pastilla.

  // #630: al entrar no se abre nada encima del juego; la pastilla CARGA RÁPIDA abre el panel chico cuando el cliente la toca.
};

/** Abre/cierra el chat de cargas SOBRE el casino (el juego no se corta). */
VIP.ui.toggleCasinoChat = function() {
  // Si lo que hubo fue un ARRASTRE de la burbuja, el click posterior no abre.
  if (VIP.ui._bubbleWasDragged) return;
  // #601/#630 (owner): dentro del casino NO hay chat: la pastilla abre SIEMPRE el panel chico de Carga rápida (alias · CBU · titular +
  // adjuntar comprobante). El cajón de chat se eliminó.
  try { if (VIP.home && VIP.home.toggleCasinoLoad) VIP.home.toggleCasinoLoad(); } catch (_) {}
};

/** Muda el chat REAL (cabecera+mensajes+barra de escribir) adentro del panel.
 *  Mover los nodos conserva ids, listeners y el socket: es EL MISMO chat, no
 *  una copia — por eso el agente lo ve en su bandeja de siempre. */
VIP.ui._casinoChatMount = function() {
  const drawer = document.getElementById('casinoChatDrawer');
  const body = document.getElementById('casinoChatDrawerBody');
  const cc = document.querySelector('.chat-container');
  const cic = document.querySelector('.chat-input-container');
  if (!drawer || !body || !cc || !cic) return;
  // Marcadores invisibles para devolver cada bloque EXACTAMENTE donde estaba.
  const ph1 = document.createElement('div'); ph1.style.display = 'none';
  const ph2 = document.createElement('div'); ph2.style.display = 'none';
  cc.parentNode.insertBefore(ph1, cc);
  cic.parentNode.insertBefore(ph2, cic);
  body.appendChild(cc);
  body.appendChild(cic);
  // Dentro del panel el chat se COMPACTA (owner 2026-08-15):
  // 1. Se oculta la cabecera "Cargas 1Girox" (avatar/en línea/🔥) — el panel ya
  //    tiene su propio título y así se ven más mensajes en el 50% de alto.
  // 2. min-height:0 pisa el piso de 170px de .chat-container: con el panel
  //    corto, ese piso empujaba la barra de escribir fuera de la vista y el
  //    chat "no bajaba del todo".
  const tb = cc.querySelector('.chat-topbar');
  if (tb) tb.style.display = 'none';
  const prevMinHeight = cc.style.minHeight;
  cc.style.minHeight = '0';
  VIP.ui._casinoChatPh = { ph1: ph1, ph2: ph2, cc: cc, cic: cic, tb: tb, prevMinHeight: prevMinHeight };
  drawer.style.display = 'flex';
  // Visto: badge a cero y mensajes al final (tras el reflow del layout nuevo).
  VIP.ui._casinoChatUnread = 0;
  const badge = document.getElementById('casinoChatBadge');
  if (badge) badge.style.display = 'none';
  requestAnimationFrame(function() {
    const msgs = document.getElementById('chatMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });
};

/** Devuelve el chat a su lugar original de la página y esconde el panel. */
VIP.ui._casinoChatUnmount = function() {
  const s = VIP.ui._casinoChatPh;
  if (s) {
    // Deshacer la compactación ANTES de devolverlo: en la página el chat
    // vuelve con su cabecera y su piso de altura de siempre.
    if (s.tb) s.tb.style.display = '';
    if (s.cc) s.cc.style.minHeight = s.prevMinHeight || '';
  }
  if (s && s.ph1 && s.ph1.parentNode) { s.ph1.parentNode.insertBefore(s.cc, s.ph1); s.ph1.remove(); }
  if (s && s.ph2 && s.ph2.parentNode) { s.ph2.parentNode.insertBefore(s.cic, s.ph2); s.ph2.remove(); }
  VIP.ui._casinoChatPh = null;
  const drawer = document.getElementById('casinoChatDrawer');
  if (drawer) drawer.style.display = 'none';

  // PISTA de arrastre (una vez por sesión): recién cuando cierra el panel por
  // primera vez, un cartelito le enseña que la pastilla se puede mover — es el
  // momento justo: acaba de quedar la pastilla sola sobre el juego.
  if (!VIP.ui._bubbleHintShown && document.getElementById('casinoSupportBubble')) {
    VIP.ui._bubbleHintShown = true;
    const overlay = document.getElementById('casinoOverlay');
    if (overlay) {
      const hint = document.createElement('div');
      const side = (VIP.ui._bubbleSide === 'left') ? 'left:16px;' : 'right:16px;';
      hint.style.cssText = 'position:absolute;z-index:6;' + side +
        'bottom:calc(78px + env(safe-area-inset-bottom,0px));max-width:230px;' +
        'background:rgba(13,13,26,0.94);border:1px solid rgba(212,175,55,0.5);color:#e3bd48;' +
        'font-size:11.5px;font-weight:700;padding:7px 11px;border-radius:10px;' +
        'pointer-events:none;transition:opacity 0.5s;';
      hint.textContent = '✥ ¿Te tapa el juego? Arrastrame a donde quieras';
      overlay.appendChild(hint);
      setTimeout(function() { hint.style.opacity = '0'; }, 4200);
      setTimeout(function() { hint.remove(); }, 4800);
    }
  }
};

/** Cierra el recuadro y vuelve a VIPCARGAS. */
VIP.ui.closeCasinoFrame = function() {
  clearTimeout(VIP.ui._casinoWatchdog);
  VIP.ui._casinoGamePath = null; // #782
  // Si el chat estaba mudado al panel del casino, SIEMPRE devolverlo a la
  // página antes de cerrar (si no, la pantalla principal queda sin chat).
  VIP.ui._casinoChatUnmount();
  const overlay = document.getElementById('casinoOverlay');
  if (!overlay) return;
  // Se blanquea el src para que el casino deje de correr en segundo plano (si no,
  // sigue sonando y consumiendo datos aunque el recuadro esté oculto).
  // ⚠️ 'about:blank', NUNCA '': el vacío navega el iframe a la URL de la PWA.
  const frame = overlay.querySelector('#casinoFrame');
  if (frame) frame.src = 'about:blank';
  overlay.style.display = 'none';
  document.body.style.overflow = '';
  VIP.ui._casinoOpen = false;

  // Al volver, refrescar el saldo: es muy probable que haya cambiado jugando.
  if (VIP.ui.syncBalance) { try { VIP.ui.syncBalance(); } catch (e) {} }
};

/** Muestra un error dentro del recuadro, con la opción de reintentar o salir. */
VIP.ui._casinoFrameError = function(msg) {
  const status = document.getElementById('casinoFrameStatus');
  if (!status) {
    VIP.ui.showToast(msg, 'error');
    return;
  }
  status.style.display = 'flex';
  status.style.flexDirection = 'column';
  status.style.gap = '14px';
  status.innerHTML =
    '<div style="color:#ff8080;font-weight:700;max-width:420px;line-height:1.45;">' + msg + '</div>' +
    '<button type="button" onclick="VIP.ui.enterCasino()" ' +
      'style="background:linear-gradient(135deg,#6a0dad,#9b30ff);color:#fff;border:none;' +
      'padding:12px 26px;border-radius:24px;font-weight:800;font-size:15px;cursor:pointer;">' +
      '🔄 Reintentar</button>' +
    // #695: salida alternativa (pestaña aparte, pide un link nuevo) y "Volver a la app" (antes decía "Volver a 1GIROX", confundía)
    '<button type="button" onclick="VIP.ui.openCasinoInTab()" ' +
      'style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.2);' +
      'padding:10px 22px;border-radius:24px;font-weight:700;font-size:14px;cursor:pointer;">' +
      '↗ Abrir el casino aparte</button>' +
    '<button type="button" onclick="VIP.ui.closeCasinoFrame()" ' +
      'style="background:none;color:#aaa;border:none;font-size:14px;cursor:pointer;">' +
      '‹ Volver a la app</button>';
};

// El botón "atrás" del celular cierra el recuadro en vez de salir de la app.
window.addEventListener('popstate', function() {
  if (VIP.ui._casinoOpen) VIP.ui.closeCasinoFrame();
});

// Botón "Abrir Casino" DENTRO del modal (que ahora es el camino de respaldo, cuando
// el SSO falló). Abre el casino a secas para que el usuario entre a mano con los
// datos que el modal le muestra.
VIP.ui.goToPlatform = function() {
  window.open(VIP.config.PLATFORM_URL, '_blank');
  VIP.ui.closePlatformModal();
};


VIP.ui.togglePlatformPasswordVisibility = function() {
  const pwdEl = document.getElementById('platformModalPassword');
  const toggle = document.getElementById('platformPasswordToggle');
  if (!pwdEl) return;
  const plain = VIP.state.sessionPassword || '';
  if (!plain) return;
  VIP.ui._platformPasswordVisible = !VIP.ui._platformPasswordVisible;
  if (VIP.ui._platformPasswordVisible) {
    pwdEl.textContent = plain;
    if (toggle) toggle.textContent = '🙈';
  } else {
    pwdEl.textContent = '••••••••';
    if (toggle) toggle.textContent = '👁';
  }
};

VIP.ui.savePlatformPassword = function() {
  const input = document.getElementById('platformPasswordManualInput');
  if (!input || !input.value.trim()) return;
  const pwd = input.value.trim();
  VIP.state.sessionPassword = pwd;
  VIP.ui._platformPasswordVisible = false;
  const pwdEl = document.getElementById('platformModalPassword');
  const pwdInputSection = document.getElementById('platformPasswordInputSection');
  const pwdToggle = document.getElementById('platformPasswordToggle');
  if (pwdEl) {
    pwdEl.textContent = '••••••••';
    if (pwdToggle) pwdToggle.textContent = '👁';
  }
  if (pwdInputSection) pwdInputSection.style.display = 'none';
  input.value = '';
  VIP.ui.showToast('✅ Contraseña guardada para esta sesión', 'success');
};

VIP.ui.showPlatformPasswordChange = function() {
  // Cerrar el modal de plataforma
  VIP.ui.closePlatformModal();
  // Asegurarse de que el cambio sea voluntario (no obligatorio)
  VIP.state.passwordChangePending = false;
  // Preparar y abrir el modal de cambio de contraseña
  if (typeof VIP.auth.prepareChangePasswordModal === 'function') {
    VIP.auth.prepareChangePasswordModal();
  } else if (typeof window.prepareChangePasswordModal === 'function') {
    window.prepareChangePasswordModal();
  }
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.classList.remove('hidden');
};
