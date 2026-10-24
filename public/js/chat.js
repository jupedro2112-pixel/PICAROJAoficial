// ========================================
// CHAT - Messaging module
// ========================================

window.VIP = window.VIP || {};

VIP.chat = (function () {

    // ---- Helpers ----

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function scrollToBottom() {
        const container = document.getElementById('chatMessages');
        if (container) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            container.scrollTop = container.scrollHeight;
        }
    }

    // ---- Lightbox ----

    function openLightbox(src) {
        const lightbox = document.getElementById('lightbox');
        const lightboxImage = document.getElementById('lightboxImage');
        lightboxImage.src = src;
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox(event) {
        if (event.target.id === 'lightbox' || event.target.classList.contains('lightbox-close')) {
            const lightbox = document.getElementById('lightbox');
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    // ---- Multi-plataforma: botones en mensajes de sistema ----

    function _platLabel(opt) {
        return (opt.emoji ? opt.emoji + ' ' : '') + (opt.name || opt.id || '');
    }

    function _renderPlatformWidget(message) {
        const md = message && message.metadata;
        if (!md || typeof md !== 'object') return '';
        if (md.kind === 'platform_choice') {
            const mid = escapeHtml(String(message.id || ''));
            const mov = escapeHtml(String(md.movementId || ''));
            const opts = Array.isArray(md.options) ? md.options : [];
            if (md.chosen) {
                const chosen = opts.find(o => o.id === md.chosen);
                const txt = md.chosen === 'manual' ? 'Ya te lo cargó un agente' : ('Elegiste ' + (chosen ? _platLabel(chosen) : escapeHtml(String(md.chosen))));
                return `<div class="plat-choice plat-done" data-plat-msg="${mid}">✅ ${txt}</div>`;
            }
            if (!opts.length) return '';
            const btns = opts.map(o =>
                `<button type="button" class="plat-btn" data-plat="${escapeHtml(String(o.id))}" ` +
                `onclick="VIP.chat.choosePlatform('${mov}','${escapeHtml(String(o.id))}',this)">${escapeHtml(_platLabel(o))}</button>`
            ).join('');
            return `<div class="plat-choice" data-plat-msg="${mid}" data-plat-mov="${mov}"><div class="plat-btns">${btns}</div></div>`;
        }
        // #275: carga acreditada → botón "Jugar ahora" (abre la plataforma ADENTRO de la app).
        if (md.kind === 'deposit_credited') {
            const pid = escapeHtml(String(md.platform || 'girox'));
            return `<div class="plat-choice"><button type="button" class="plat-btn plat-play-now" onclick="VIP.home.playNow('${pid}')">🎰 Jugar ahora</button></div>`;
        }
        // #283: oferta de carga GRATIS por instalar la app → botón que vuelve a abrir la hoja.
        if (md.kind === 'install_gift_offer') {
            return `<div class="plat-choice"><button type="button" class="plat-btn plat-play-now" onclick="VIP.home.installGiftOpen()">🎁 Ver mi extra por instalar la app</button></div>`;
        }
        // #364 (owner): tarjeta del CBU como en la gemela — CBU / Alias / Titular, Copiar CBU, Copiar ALIAS y el botón
        // verde "Por favor enviar comprobante aquí" que abre el adjuntar. El texto del mensaje (/sys_cbu) va arriba.
        if (md.kind === 'cbu_card') {
            const row = (k, v) => v ? `<div class="cbu-row"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>` : '';
            const cbu = String(md.cbu || ''), alias = String(md.alias || '');
            return `<div class="cbu-card">
                <div class="cbu-box">${row('CBU', cbu)}${row('Alias', alias)}${row('Titular', md.titular)}${row('Banco', md.bank)}</div>
                <div class="cbu-actions">
                    ${cbu ? `<button type="button" class="cbu-copy" onclick="VIP.ui.copyText('${escapeHtml(cbu)}')">Copiar CBU</button>` : ''}
                    ${alias ? `<button type="button" class="cbu-copy" onclick="VIP.ui.copyText('${escapeHtml(alias)}')">Copiar ALIAS</button>` : ''}
                    <button type="button" class="cbu-send" onclick="VIP.chat.attachFromCard()">📎 Por favor enviar comprobante aquí</button>
                </div>
            </div>`;
        }
        // #376: ciclo del comprobante en la carga automática.
        if (md.kind === 'deposit_pending') {
            return `<div class="dep-pill dep-wait">⏳ ${md.escalated ? 'Un agente la está revisando' : 'En verificación · se acredita sola'}</div>`;
        }
        if (md.kind === 'receipt_duplicate') return '<div class="dep-pill dep-dup">⚠️ Comprobante ya usado · no se acredita</div>';
        // #384: respuesta automática de Soporte con botón al sector (carga automática / retirar premio).
        if (md.kind === 'go_section' || (md.target === 'terms' && md.label)) { // #702: + refund (info de reembolso) y terms (Bases y condiciones, dentro de la app)
            const t = String(md.target || 'full');
            const act = t === 'receipt' ? "VIP.autoload.sendReceipt()" /* #905: comprobante no válido ⇒ adjuntarlo de nuevo */ : t === 'withdraw' ? "VIP.withdraw.openWithdrawModal()"
                : t === 'refund' ? "VIP.home.svcRefund()"
                : t === 'terms' ? "VIP.home.openTerms()"
                : t === 'sorteo' ? "VIP.sorteos.open('mensual')" /* #944: explicación del sorteo ⇒ abre la ventana del sorteo */
                : "VIP.home.setHomeMode('full')";
            const label = escapeHtml(String(md.label || (t === 'withdraw' ? '💸 Ir a Retirar premio' : '⚡ Ir a Carga automática')));
            if (t === 'terms') return `<button type="button" class="chat-terms-mini" onclick="${act}">📄 Bases y condiciones</button>`; // #878: chico, no molesta
            return `<div class="plat-choice"><button type="button" class="plat-btn plat-play-now${t === 'terms' ? ' plat-terms' : ''}" onclick="${act}">${label}</button></div>`;
        }
        if (md.kind === 'deposit_rejected') return '<div class="dep-pill dep-rej">❌ Carga no acreditada</div>';
        if (md.kind === 'platform_link' && md.url) {
            const url = encodeURI(String(md.url));
            const label = escapeHtml(_platLabel({ emoji: md.emoji, name: md.name || 'la plataforma' }));
            return `<div class="plat-choice"><a class="plat-btn plat-link" href="${url}" target="_blank" rel="noopener noreferrer">🎮 Entrar a ${label}</a></div>`;
        }
        return '';
    }

    // Marca el mensaje con botones como resuelto (lo llama el socket
    // `platform_choice_resolved` y el propio click). `platformId` puede ser el id de
    // la plataforma, 'manual' (lo cargó un agente a mano) o un texto ya armado.
    // #364: el botón de la tarjeta CBU abre el selector de archivo (mismo que el clip de abajo).
    function attachFromCard() {
        const fi = document.getElementById('fileInput');
        if (fi) { try { fi.click(); return; } catch (_) {} }
        const b = document.getElementById('attachBtn'); if (b) b.click();
    }

    function markPlatformChoiceResolved(messageId, platformId, labelOverride) {
        const box = document.querySelector(`.plat-choice[data-plat-msg="${messageId}"]`);
        if (!box) return;
        let label = labelOverride || '';
        if (!label) {
            const btn = box.querySelector(`.plat-btn[data-plat="${platformId}"]`);
            label = platformId === 'manual' ? 'Ya te lo cargó un agente' : ('Elegiste ' + (btn ? btn.textContent : platformId));
        }
        box.classList.add('plat-done');
        box.innerHTML = '✅ ' + escapeHtml(label);
    }

    let _platBusy = false;
    async function choosePlatform(movementId, platformId, btnEl) {
        if (_platBusy) return;
        if (!VIP.state.currentToken) return;
        _platBusy = true;
        const box = btnEl && btnEl.closest ? btnEl.closest('.plat-choice') : null;
        const label = btnEl ? btnEl.textContent : platformId;
        if (box) box.querySelectorAll('.plat-btn').forEach(b => { b.disabled = true; });
        if (btnEl) btnEl.classList.add('plat-loading');
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/platform-choice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VIP.state.currentToken}` },
                body: JSON.stringify({ movementId, platform: platformId })
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) {
                // 409 = ya se resolvió (timeout / agente / otro dispositivo) → mostrar el resultado.
                if (r.status === 409 && box) {
                    const msgId = box.getAttribute('data-plat-msg');
                    markPlatformChoiceResolved(msgId, d.platform || 'manual', d.error || 'Esta transferencia ya fue procesada');
                } else {
                    if (box) box.querySelectorAll('.plat-btn').forEach(b => { b.disabled = false; });
                    if (btnEl) btnEl.classList.remove('plat-loading');
                    VIP.ui.showToast(d.error || 'No pudimos procesar tu elección', 'error');
                }
                return;
            }
            if (box) {
                const msgId = box.getAttribute('data-plat-msg');
                markPlatformChoiceResolved(msgId, platformId, 'Elegiste ' + label + (d.redirected ? ' — te mandamos el link 👇' : ' — ¡te la estamos cargando! 🎉'));
            }
            VIP.ui.showToast(d.redirected ? 'Listo, mirá el link que te mandamos 👇' : '¡Listo! Tu carga va a ' + (d.label || label), 'success');
        } catch (e) {
            if (box) box.querySelectorAll('.plat-btn').forEach(b => { b.disabled = false; });
            if (btnEl) btnEl.classList.remove('plat-loading');
            VIP.ui.showToast('Error de conexión. Probá de nuevo.', 'error');
        } finally {
            _platBusy = false;
        }
    }

    // ---- Message rendering ----

    function createMessageElement(message) {
        const isFromUser = message.senderRole === 'user';

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        if (message.id && message.id.startsWith('temp-')) {
            wrapper.setAttribute('data-temp-id', message.id);
        } else if (message.id) {
            wrapper.setAttribute('data-message-id', message.id);
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isFromUser ? 'agente' : 'usuario'}`;

        const time = new Date(message.timestamp).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Argentina/Buenos_Aires'
        });

        let contentHtml = '';
        let imageUrl = null;
        if (message.type === 'image') {
            imageUrl = encodeURI(message.content);
            contentHtml = `<img src="${imageUrl}" loading="lazy" style="cursor:pointer;">`;
        } else if (message.type === 'video') {
            const safeUrl = encodeURI(message.content);
            contentHtml = `<video src="${safeUrl}" controls preload="metadata" style="max-width:100%;max-height:300px;border-radius:8px;"></video>`;
        } else {
            let content = escapeHtml(message.content);
            const urlRegex = /(https?:\/\/[^\s<]+[^\s<.,;:!?])/g;
            content = content.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>');
            content = content.replace(/\n/g, '<br>');
            contentHtml = `<div style="white-space: pre-wrap;">${content}</div>`;
        }

        // Tildes estilo WhatsApp SOLO en los mensajes propios del cliente:
        // ✓✓ gris = enviado; ✓✓ celeste (#53bdeb, el tono del "leído" de WhatsApp)
        // = un admin abrió el chat. El estado inicial sale de message.read; el
        // cambio en vivo lo empuja el server (evento messages_read_by_admin).
        const ticksHtml = isFromUser
            ? `<span class="msg-ticks${message.read ? ' msg-read' : ''}" title="${message.read ? 'Leído' : 'Enviado'}">` +
              `<svg viewBox="0 0 18 12" width="17" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
              `<path d="M1.3 6.8l3.1 3.1L10.9 3.2"/><path d="M7.6 9.6l1.3 1.3L16.7 3.2"/></svg></span>`
            : '';
        // MULTI-PLATAFORMA (2026-10-16): mensajes de sistema con botones.
        //   metadata.kind = 'platform_choice' → "¿dónde querés jugar?" (un botón por
        //     plataforma; al tocar → POST /api/platform-choice). Si ya se resolvió
        //     (metadata.chosen) muestra la elección en vez de los botones.
        //   metadata.kind = 'platform_link' → botón que abre el link externo de la
        //     plataforma (Ganamos sin API).
        const platformHtml = _renderPlatformWidget(message);
        // #377: respuestas de Soporte firmadas con la persona de turno (Martín / Sofía / Agustina).
        const _who = (!isFromUser && message.type !== 'system' && message.senderRole !== 'system' && (message.channel === 'support' || (message.metadata && message.metadata.agentName)))
            ? `<div class="msg-who">${escapeHtml((message.metadata && message.metadata.agentName) || message.senderUsername || 'Soporte')} · Soporte</div>` : '';
        msgDiv.innerHTML = `${_who}${contentHtml}${platformHtml}<span class="message-time">${time}${ticksHtml}</span>`;

        if (imageUrl) {
            const img = msgDiv.querySelector('img');
            if (img) {
                img.addEventListener('click', function() {
                    openLightbox(imageUrl);
                });
            }
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = '📋';
        copyBtn.onclick = () => VIP.ui.copyText(
            message.type === 'image' ? '[Imagen]' :
            message.type === 'video' ? '[Video]' :
            message.content
        );

        wrapper.appendChild(msgDiv);
        wrapper.appendChild(copyBtn);
        return wrapper;
    }

    function addMessageToChat(message) {
        const container = document.getElementById('chatMessages');

        if (message.id) {
            const existingById = container.querySelector(`[data-message-id="${message.id}"]`);
            if (existingById) return;

            const existingByTemp = container.querySelector(`[data-temp-id="${message.id}"]`);
            if (existingByTemp) {
                existingByTemp.setAttribute('data-message-id', message.id);
                existingByTemp.removeAttribute('data-temp-id');
                return;
            }
        }

        const wrapper = createMessageElement(message);
        container.appendChild(wrapper);
        requestAnimationFrame(() => scrollToBottom());
    }

    function getDateLabel(dateStr) {
        const msgDate = new Date(dateStr);
        const today = getArgentinaDate();
        const yesterday = getArgentinaDate();
        yesterday.setDate(yesterday.getDate() - 1);

        const msgDay = msgDate.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
        const todayStr = today.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
        const yesterdayStr = yesterday.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

        if (msgDay === todayStr) return 'Hoy';
        if (msgDay === yesterdayStr) return 'Ayer';

        return msgDate.toLocaleDateString('es-AR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'America/Argentina/Buenos_Aires'
        });
    }

    function createDateSeparator(label) {
        const sep = document.createElement('div');
        sep.className = 'chat-date-separator';
        sep.innerHTML = `<span>${label}</span>`;
        return sep;
    }

    function renderMessages(messages) {
        const container = document.getElementById('chatMessages');
        const isInitialLoad = VIP.state.lastMessagesHash === '';
        const wasAtBottom = isInitialLoad || (container.scrollHeight - container.scrollTop - container.clientHeight) < 60;

        const fragment = document.createDocumentFragment();
        VIP.state.processedMessageIds.clear();

        let lastDateLabel = '';
        messages.forEach(msg => {
            if (msg.id) VIP.state.processedMessageIds.add(msg.id);
            const dateLabel = getDateLabel(msg.timestamp);
            if (dateLabel !== lastDateLabel) {
                fragment.appendChild(createDateSeparator(dateLabel));
                lastDateLabel = dateLabel;
            }
            const wrapper = createMessageElement(msg);
            if (wrapper) fragment.appendChild(wrapper);
        });

        container.innerHTML = '';
        container.appendChild(fragment);
        // #401: la presentación de Soporte (#supportIntro) desaparece cuando el cliente YA escribió en esta sesión del
        // chat; si el chat se cerró (6 h sin respuesta) no hay mensajes suyos visibles → vuelve a aparecer como al principio.
        // #613 (owner): la charla está ABIERTA si el cliente escribió después del último cierre; cerrada ⇒ selector + aviso fijado
        // "Chat cerrado · fecha" (el historial queda y se vuelve a ver, con fechas, al abrir de nuevo).
        try {
            let lastUser = -1, lastClosed = -1, closedAt = null;
            messages.forEach((m, i) => { if (!m) return; if (m.senderRole === 'user') lastUser = i; if (m.metadata && m.metadata.kind === 'support_closed') { lastClosed = i; closedAt = m.timestamp; } });
            const open = lastUser > lastClosed;
            document.body.classList.toggle('sp-sent', open);
            const pin = document.getElementById('spClosed');
            if (pin) {
                if (!open && lastClosed >= 0) {
                    let when = '';
                    try { const d = new Date(closedAt); when = d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' }); } catch (_) {}
                    pin.textContent = '🔒 Chat cerrado' + (when ? ' · ' + when : ''); pin.hidden = false;
                } else pin.hidden = true;
            }
        } catch (_) {}

        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            const adminRoles = ['admin', 'depositor', 'withdrawer'];
            if (VIP.state.lastMessageId && VIP.state.lastMessageId !== lastMsg.id && adminRoles.includes(lastMsg.senderRole)) {
                VIP.notifications.playNotificationSound();
            }
            VIP.state.lastMessageId = lastMsg.id;
        }

        if (wasAtBottom) {
            requestAnimationFrame(() => scrollToBottom());
        }
    }

    async function loadMessages(force = false) {
        if (VIP.state.isLoadingMessages && !force) return;
        if (!VIP.state.currentUser || !VIP.state.currentUser.userId) return;

        VIP.state.isLoadingMessages = true;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);


            const response = await fetch(
                `${VIP.config.API_URL}/api/messages/${VIP.state.currentUser.userId}?limit=15`,
                {
                    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` },
                    signal: controller.signal
                }
            );
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                const messages = data.messages || [];

                if (messages.length > 0) {
                }

                const messagesHash = messages.map(m => m.id).join(',');
                if (messagesHash !== VIP.state.lastMessagesHash || force) {
                    VIP.state.lastMessagesHash = messagesHash;
                    renderMessages(messages);
                }

                // El cliente acaba de VER el chat → avisar para que los ✓✓ del
                // agente en el panel se pinten de celeste (visto).
                markReceivedAsRead();
            } else {
                console.error('[loadMessages] Error en respuesta:', response.status);
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error cargando mensajes:', error);
            }
        } finally {
            VIP.state.isLoadingMessages = false;
        }
    }

    // Marca como LEÍDOS los mensajes que el agente le mandó al cliente (visto de
    // WhatsApp del lado del ADMIN). Throttle CON COLA: una ráfaga de llamadas =
    // 1 request ahora + 1 al final — así el último mensaje nunca queda sin visto.
    let _lastReadReceiptAt = 0;
    let _readReceiptTimer = null;
    function markReceivedAsRead() {
        if (!VIP.state.currentToken) return;
        const now = Date.now();
        const wait = 4000 - (now - _lastReadReceiptAt);
        if (wait > 0) {
            if (!_readReceiptTimer) {
                _readReceiptTimer = setTimeout(() => { _readReceiptTimer = null; markReceivedAsRead(); }, wait);
            }
            return;
        }
        _lastReadReceiptAt = now;
        fetch(`${VIP.config.API_URL}/api/messages/read-received`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
        }).catch(() => {});
    }

    async function sendMessage(_ev, _quick) {
        const quick = (typeof _quick === 'string' && _quick) ? _quick : null; // #384: acceso rápido de Soporte (cargar | retirar | otro)
        const input = document.getElementById('messageInput');
        const content = input.value.trim();

        if (!content) return;
        try { document.body.classList.add('sp-sent'); } catch (_) {} // #373: la presentación de Soporte se achica

        if (content.startsWith('/')) {
            VIP.ui.showToast('No puedes enviar comandos', 'error');
            input.value = '';
            input.style.height = 'auto';
            return;
        }

        const now = Date.now();
        const recentTimestamps = VIP.state.sentMessageTimestamps.filter(
            t => now - t < VIP.config.FRONTEND_MSG_RATE_WINDOW_MS
        );
        if (recentTimestamps.length >= VIP.config.FRONTEND_MSG_RATE_MAX) {
            VIP.ui.showToast('Estás enviando mensajes muy rápido. Esperá un momento.', 'info');
            input.value = '';
            input.style.height = 'auto';
            return;
        }
        VIP.state.sentMessageTimestamps.length = 0;
        VIP.state.sentMessageTimestamps.push(...recentTimestamps, now);

        if (now - VIP.state.lastSentMessageTimestamp < 3000) {
            const recentContent = VIP.state.pendingSentMessages.get(content);
            if (recentContent && (now - recentContent) < 3000) {
                input.value = '';
                input.style.height = 'auto';
                return;
            }
        }
        VIP.state.pendingSentMessages.set(content, now);

        for (const [msg, timestamp] of VIP.state.pendingSentMessages.entries()) {
            if (now - timestamp > 10000) {
                VIP.state.pendingSentMessages.delete(msg);
            }
        }

        const tempId = 'temp-' + now;
        const tempMessage = {
            id: tempId,
            senderId: VIP.state.currentUser.userId,
            senderUsername: VIP.state.currentUser.username,
            senderRole: 'user',
            content: content,
            type: 'text',
            timestamp: new Date().toISOString()
        };
        addMessageToChat(tempMessage);

        input.value = '';
        input.style.height = 'auto';

        scrollToBottom();
        setTimeout(scrollToBottom, 100);
        setTimeout(scrollToBottom, 300);

        if (VIP.state.socket && VIP.state.socket.connected) {
            VIP.state.socket.emit('send_message', { content, type: 'text', channel: 'support', quick: quick || undefined }); // #377/#384
            return;
        }

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/messages/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({ content, type: 'text', channel: 'support', quick: quick || undefined }) // #384
            });

            if (response.ok) {
                const savedMessage = await response.json();
                const tempMsgElement = document.querySelector(`[data-temp-id="${tempId}"]`);
                if (tempMsgElement) {
                    tempMsgElement.setAttribute('data-message-id', savedMessage.id);
                    tempMsgElement.removeAttribute('data-temp-id');
                    tempMsgElement.classList.add('message-saved');
                }
                scrollToBottom();
            } else {
                const tempMsgElement = document.querySelector(`[data-temp-id="${tempId}"]`);
                if (tempMsgElement) {
                    tempMsgElement.classList.add('message-error');
                    const msgDiv = tempMsgElement.querySelector('.message');
                    if (msgDiv) { msgDiv.style.opacity = '0.5'; msgDiv.style.border = '1px solid #ff4444'; }
                }
                VIP.ui.showToast('Error al enviar mensaje', 'error');
            }
        } catch (error) {
            console.error('❌ Error enviando mensaje:', error);
            const tempMsgElement = document.querySelector(`[data-temp-id="${tempId}"]`);
            if (tempMsgElement) {
                tempMsgElement.classList.add('message-error');
                const msgDiv = tempMsgElement.querySelector('.message');
                if (msgDiv) { msgDiv.style.opacity = '0.5'; msgDiv.style.border = '1px solid #ff4444'; }
            }
            VIP.ui.showToast('Error de conexión', 'error');
        }
    }

    // Convierte un File de imagen a un data URL JPEG comprimido y seguro de enviar.
    // Resuelve 3 problemas reales que veíamos con fotos de clientes:
    //  1) "Foto toda negra": un canvas recién creado es transparente; al
    //     exportar a JPEG (que no tiene canal alfa) los píxeles transparentes
    //     —p. ej. de un PNG o una captura— quedan NEGROS. Por eso se rellena
    //     el canvas de blanco ANTES de dibujar la imagen.
    //  2) "Foto negra" en fotos enormes: iOS/Android fallan al hacer un único
    //     drawImage de una imagen de muchos megapíxeles hacia un canvas chico y
    //     devuelven un canvas en negro. Por eso se reduce en pasos de 2x.
    //  3) "La foto desaparece y no se envía": el data URL pesaba demasiado y el
    //     server/proxy lo rechazaba. Por eso se itera bajando calidad/tamaño
    //     hasta que el resultado entre en un presupuesto de bytes seguro.
    function compressImage(file, { maxDim = 1600, quality = 0.85, maxBytes = 900 * 1024 } = {}) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            const cleanup = () => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } };

            const proceed = () => {
                try {
                    const srcW = img.naturalWidth || img.width;
                    const srcH = img.naturalHeight || img.height;
                    if (!srcW || !srcH) {
                        cleanup();
                        reject(new Error('La imagen no tiene dimensiones válidas'));
                        return;
                    }

                    // Dibuja `source` en un canvas de w×h SIEMPRE sobre fondo
                    // blanco (evita que lo transparente salga negro en el JPEG).
                    const paint = (source, w, h) => {
                        const c = document.createElement('canvas');
                        c.width = w;
                        c.height = h;
                        const cx = c.getContext('2d');
                        cx.fillStyle = '#ffffff';
                        cx.fillRect(0, 0, w, h);
                        cx.drawImage(source, 0, 0, w, h);
                        return c;
                    };

                    // Renderiza la imagen a targetW×targetH. Si el original es
                    // mucho más grande, baja en pasos de 2x: un solo drawImage
                    // gigante→chico devuelve negro en varios móviles.
                    const renderAt = (targetW, targetH) => {
                        let curW = srcW, curH = srcH;
                        let source = img;
                        while (curW > targetW * 2 && curH > targetH * 2) {
                            curW = Math.round(curW / 2);
                            curH = Math.round(curH / 2);
                            source = paint(source, curW, curH);
                        }
                        return paint(source, targetW, targetH);
                    };

                    // Ajusta las dimensiones de salida a un máximo de `dim`.
                    const fit = (dim) => {
                        let w = srcW, h = srcH;
                        if (w > dim || h > dim) {
                            if (w >= h) { h = Math.round(h * (dim / w)); w = dim; }
                            else { w = Math.round(w * (dim / h)); h = dim; }
                        }
                        return { w: Math.max(1, w), h: Math.max(1, h) };
                    };

                    // Itera tamaño y calidad hasta entrar en maxBytes. Las fotos
                    // simples salen al primer intento; sólo las muy pesadas bajan.
                    const dims = [maxDim, 1280, 1024, 800];
                    let best = null;
                    for (let di = 0; di < dims.length; di++) {
                        const { w, h } = fit(dims[di]);
                        const canvas = renderAt(w, h);
                        let q = quality;
                        for (let qi = 0; qi < 6 && q >= 0.4; qi++) {
                            const dataUrl = canvas.toDataURL('image/jpeg', q);
                            best = dataUrl;
                            if (dataUrl.length <= maxBytes) {
                                cleanup();
                                resolve(dataUrl);
                                return;
                            }
                            q -= 0.12;
                        }
                    }
                    // No bajó de maxBytes ni en el tamaño más chico: devolvemos
                    // el mejor intento (el server aplica su propio límite duro).
                    cleanup();
                    resolve(best);
                } catch (err) {
                    cleanup();
                    reject(err);
                }
            };

            img.onload = () => {
                // decode() asegura que los píxeles estén listos antes de dibujar:
                // en algunos móviles onload dispara antes de tiempo → canvas negro.
                if (typeof img.decode === 'function') {
                    img.decode().then(proceed).catch(proceed);
                } else {
                    proceed();
                }
            };
            img.onerror = () => {
                cleanup();
                reject(new Error('No se pudo decodificar la imagen'));
            };
            img.src = url;
        });
    }

    function readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
            reader.readAsDataURL(file);
        });
    }

    function removeTempMessage(tempId) {
        const el = document.querySelector(`[data-temp-id="${tempId}"]`);
        if (el) el.remove();
    }

    async function parseErrorMessage(response, fallback) {
        try {
            const body = await response.json();
            if (body && body.error) return body.error;
        } catch (_) {}
        return fallback || `Error ${response.status}`;
    }

    // Marca el mensaje temporal como fallido SIN borrarlo: así la foto NO
    // "desaparece" del chat — el cliente la sigue viendo y sabe que falló
    // (mismo comportamiento que un mensaje de texto que no se pudo enviar).
    function markTempMessageError(tempId) {
        const el = document.querySelector(`[data-temp-id="${tempId}"]`);
        if (!el) return;
        el.classList.add('message-error');
        const msgDiv = el.querySelector('.message');
        if (msgDiv) { msgDiv.style.opacity = '0.55'; msgDiv.style.border = '1px solid #ff4444'; }
    }

    async function sendMediaMessage({ dataUrl, fileType, fileLabel, tempId }) {
        const tempMessage = {
            id: tempId,
            senderId: VIP.state.currentUser?.id || 'me',
            senderUsername: VIP.state.currentUser?.username || 'Yo',
            senderRole: 'user',
            content: dataUrl,
            timestamp: new Date(),
            type: fileType
        };
        addMessageToChat(tempMessage);
        scrollToBottom();

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/messages/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({ content: dataUrl, type: fileType })
            });

            if (!response.ok) {
                // Antes hacía removeTempMessage() y la foto desaparecía. Ahora
                // se marca como fallida y queda visible para reintentar.
                markTempMessageError(tempId);
                const errMsg = await parseErrorMessage(response, `No se pudo enviar ${fileLabel.toLowerCase()}`);
                VIP.ui.showToast(`${fileLabel}: ${errMsg}`, 'error');
                return false;
            }

            loadMessages();
            VIP.ui.showToast(`${fileLabel} enviada`, 'success');
            return true;
        } catch (error) {
            // Error de red: tampoco se borra la foto, se marca como fallida.
            console.error('Error enviando archivo:', error);
            markTempMessageError(tempId);
            VIP.ui.showToast(`${fileLabel}: error de conexión, no se pudo enviar`, 'error');
            return false;
        }
    }

    async function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (!isImage && !isVideo) {
            VIP.ui.showToast('Solo se permiten imágenes o videos', 'error');
            e.target.value = '';
            return;
        }
        if (isImage && file.size > 30 * 1024 * 1024) {
            VIP.ui.showToast('La imagen es muy grande. Máximo 30 MB', 'error');
            e.target.value = '';
            return;
        }
        if (isVideo && file.size > 3.5 * 1024 * 1024) {
            VIP.ui.showToast('El video es muy grande. Máximo 3.5 MB', 'error');
            e.target.value = '';
            return;
        }

        const fileType = isVideo ? 'video' : 'image';
        const fileLabel = isVideo ? '🎥 Video' : '📸 Imagen';
        const tempId = 'temp-' + fileType + '-' + Date.now();

        const sendingIndicator = document.getElementById('sendingIndicator');
        if (sendingIndicator) sendingIndicator.style.display = 'block';

        try {
            const dataUrl = isImage
                ? await compressImage(file)
                : await readAsDataUrl(file);

            await sendMediaMessage({ dataUrl, fileType, fileLabel, tempId });
        } catch (error) {
            console.error('Error enviando archivo:', error);
            removeTempMessage(tempId);
            VIP.ui.showToast(`Error al enviar ${fileLabel.toLowerCase()}`, 'error');
        } finally {
            if (sendingIndicator) sendingIndicator.style.display = 'none';
            e.target.value = '';
        }
    }

    async function handlePaste(e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        for (const item of items) {
            if (!item.type.startsWith('image/')) continue;
            e.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;

            if (file.size > 30 * 1024 * 1024) {
                VIP.ui.showToast('La imagen es muy grande. Máximo 30 MB', 'error');
                return;
            }

            const tempId = 'temp-image-' + Date.now();
            const sendingIndicator = document.getElementById('sendingIndicator');
            if (sendingIndicator) sendingIndicator.style.display = 'block';

            try {
                const dataUrl = await compressImage(file);
                await sendMediaMessage({ dataUrl, fileType: 'image', fileLabel: '📸 Imagen', tempId });
            } catch (error) {
                console.error('Error enviando imagen pegada:', error);
                removeTempMessage(tempId);
                VIP.ui.showToast('Error al enviar imagen', 'error');
            } finally {
                if (sendingIndicator) sendingIndicator.style.display = 'none';
            }
            break;
        }
    }

    async function sendSystemMessage(content) {
        try {
            await fetch(`${VIP.config.API_URL}/api/messages/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({ content: content, type: 'text' })
            });
            setTimeout(() => loadMessages(), 200);
        } catch (error) {
            console.error('Error enviando mensaje de sistema:', error);
        }
    }

    // Canal de Telegram = el canal de la COMUNIDAD (owner 2026-08-03: es UNO solo,
    // config única en el panel → Comunidad (Telegram) → "Canal Oficial"). Alimenta
    // los DOS botones: el pill celeste del header y la opción del menú hamburguesa.
    // FALLBACK = /go/comunidad (owner 2026-08-06): redirect del SERVER al link
    // vigente de la config — reemplaza al 404 de canal-proximamente, que se
    // llevaba los clicks tempranos cuando este fetch tardaba (Tor) o el
    // localStorage no sobrevivía (Tor Browser lo borra por sesión). Aplicar acá
    // el link directo sigue valiendo: ahorra el hop del redirect.
    const CANAL_FALLBACK_URL = '/go/comunidad';

    function _applyCanalUrl(url) {
        const href = url || CANAL_FALLBACK_URL;
        const menuBtn = document.getElementById('canalInformativoBtn');
        const headerBtn = document.getElementById('canalTelegramHeaderBtn');
        if (menuBtn) { menuBtn.href = href; menuBtn.style.display = 'inline-flex'; }
        if (headerBtn) { headerBtn.href = href; headerBtn.style.display = 'flex'; }
    }

    // Config de Comunidad (canal / soporte / logo): CON REINTENTOS y REFRESCO.
    // Historia (2026-08-05): un solo fetch al arranque, sin retry → si fallaba
    // (Tor/3G) o el admin guardaba la config DESPUÉS de que el cliente abriera
    // la app, los links quedaban clavados en los fallbacks hasta recargar la
    // página. Ahora: 3 intentos con backoff + reintento en background cada 60s
    // hasta lograrlo + re-fetch al abrir el menú ☰ (throttled a 30s del último
    // ÉXITO, así un cambio del panel llega rápido sin spamear el server).
    let _communityCfgOkAt = 0;
    let _communityCfgRetryTimer = null;

    // Aplica una config de Comunidad a los 3 lugares (pill del canal, Soporte
    // 24/7 del menú, logo del chat).
    function _applyCommunityCfg(data) {
        if (!data) return;
        _applyCanalUrl(data.channelUrl || '');
        const supportBtn = document.getElementById('menuSupportBtn');
        if (supportBtn && data.supportUrl) supportBtn.href = data.supportUrl;
        const avatar = document.getElementById('chatTopbarAvatar');
        if (avatar && data.chatLogoUrl) avatar.src = data.chatLogoUrl;
    }

    async function loadCanalInformativoUrl() {
        // 0) CACHE PRIMERO (fix 2026-08-05): aplicar YA la última config
        // conocida (localStorage) — sin esto, mientras el fetch tardaba (Tor),
        // el pill quedaba apuntando al fallback y un click temprano llevaba a
        // /canal-proximamente aunque la config estuviera perfecta. La red de
        // abajo solo REFRESCA por si el panel cambió algo.
        try {
            const cached = JSON.parse(localStorage.getItem('communityCfgCache') || 'null');
            if (cached) _applyCommunityCfg(cached);
        } catch (e) { /* cache corrupto: se ignora */ }

        if (Date.now() - _communityCfgOkAt < 30000) return; // éxito fresco: nada que hacer
        for (let i = 0; i < 3; i++) {
            if (i) await new Promise((r) => setTimeout(r, i === 1 ? 2500 : 7000));
            try {
                const response = await fetch(`${VIP.config.API_URL}/api/config/community`, {
                    headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
                });
                if (!response.ok) continue;
                const data = await response.json();
                _applyCommunityCfg(data);
                try {
                    localStorage.setItem('communityCfgCache', JSON.stringify({
                        channelUrl: data.channelUrl || '',
                        supportUrl: data.supportUrl || '',
                        chatLogoUrl: data.chatLogoUrl || ''
                    }));
                } catch (e) { /* storage lleno: no es crítico */ }
                _communityCfgOkAt = Date.now();
                clearTimeout(_communityCfgRetryTimer);
                return;
            } catch {
                // red caída/lenta: reintenta con el próximo delay
            }
        }
        // Los 3 intentos fallaron: si había cache quedó aplicada (arriba); si
        // no, fallback visible. Se sigue intentando en background — la config
        // SIEMPRE termina llegando sin recargar la página.
        if (!localStorage.getItem('communityCfgCache')) _applyCanalUrl('');
        clearTimeout(_communityCfgRetryTimer);
        _communityCfgRetryTimer = setTimeout(() => {
            loadCanalInformativoUrl().catch(() => {});
        }, 60000);
    }

    return {
        escapeHtml,
        scrollToBottom,
        attachFromCard, // #364
        openLightbox,
        closeLightbox,
        markReceivedAsRead,
        createMessageElement,
        addMessageToChat,
        renderMessages,
        loadMessages,
        sendMessage,
        handleFileSelect,
        handlePaste,
        sendSystemMessage,
        loadCanalInformativoUrl,
        // multi-plataforma
        choosePlatform,
        markPlatformChoiceResolved
    };

})();

// Window aliases required for onclick="..." in HTML and in createMessageElement
window.openLightbox  = VIP.chat.openLightbox;
window.closeLightbox = VIP.chat.closeLightbox;
window.sendMessage   = VIP.chat.sendMessage;
