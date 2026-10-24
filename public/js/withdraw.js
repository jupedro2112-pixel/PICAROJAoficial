// ========================================
// WITHDRAW - Retiro autogestionado del usuario
// ========================================
// Flujo: el usuario completa sus datos bancarios + monto. Si su teléfono no
// está verificado, se le exige verificación por SMS antes de retirar. Si ya lo
// tiene verificado, ese paso se saltea. El retiro real lo procesa el backend
// (POST /api/withdrawal/request) que descuenta el saldo en JugaYGana y manda
// un mensaje automático al chat para el agente.

window.VIP = window.VIP || {};

VIP.withdraw = (function () {

    let _balance = 0;
    let _otpPhone = null;        // teléfono al que se envió el OTP
    let _pendingWithdraw = null; // { titular, cbu, alias, amount, saveData }
    let _otpMode = 'phone';      // #382: 'phone' = verificar teléfono (una vez) · 'withdraw' = código de ESTE retiro
    function _otpRequired() { try { const d = VIP.home && VIP.home.platformsData; return !(d && d.withdrawOtp === false); } catch (_) { return true; } }

    function _el(id) { return document.getElementById(id); }

    function _showError(id, msg) {
        const e = _el(id);
        if (e) { e.textContent = msg; e.classList.add('show'); }
    }

    function _clearError(id) {
        const e = _el(id);
        if (e) { e.textContent = ''; e.classList.remove('show'); }
    }

    // step: 'form' | 'otp-phone' | 'otp-code'
    function _showStep(step) {
        const form = _el('withdrawForm');
        const otpStep = _el('withdrawOtpStep');
        const phoneSub = _el('withdrawOtpPhoneSub');
        const codeSub = _el('withdrawOtpCodeSub');
        if (form) form.style.display = (step === 'form') ? '' : 'none';
        if (otpStep) otpStep.style.display = (step === 'otp-phone' || step === 'otp-code') ? '' : 'none';
        if (phoneSub) phoneSub.style.display = (step === 'otp-phone') ? '' : 'none';
        if (codeSub) codeSub.style.display = (step === 'otp-code') ? '' : 'none';
    }

    function _prefillOtpPhone(fullPhone) {
        if (!fullPhone) return;
        const select = _el('withdrawOtpPrefix');
        const input = _el('withdrawOtpPhone');
        if (!select || !input) return;
        const prefixes = Array.from(select.options)
            .map(o => o.value)
            .sort((a, b) => b.length - a.length); // más largo primero
        for (const p of prefixes) {
            if (fullPhone.startsWith(p)) {
                select.value = p;
                input.value = fullPhone.slice(p.length);
                return;
            }
        }
        input.value = fullPhone.replace(/^\+/, '');
    }

    // #379: retiro mínimo configurable (llega en /api/platforms.withdrawMinArs; 10.000 si todavía no respondió).
    function _withdrawMin() {
        try { const d = VIP.home && VIP.home.platformsData; const n = Number(d && d.withdrawMinArs); if (Number.isFinite(n) && n > 0) return n; } catch (_) {}
        return 5000; // #976: retiro mínimo $5.000 (antes $10.000)
    }
    // #442: BANCO CON FALLAS → alerta en el modal y botón deshabilitado (el server igual rechaza con 503 BANK_OUTAGE).
    let _bankOutage = false;
    async function _checkBankStatus() {
        const box = _el('withdrawBankAlert'); const btn = _el('withdrawSubmitBtn');
        try {
            const r = await fetch(`${VIP.config.API_URL}/api/withdrawal/bank-status`, { headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` } });
            const d = r.ok ? await r.json() : { outage: false };
            _bankOutage = !!(d && d.outage);
            if (box) { box.textContent = _bankOutage ? (d.message || 'El banco está con fallas. Apenas se normalice te avisamos. Disculpá las molestias.') : ''; box.style.display = _bankOutage ? '' : 'none'; }
            const pause = _bankOutage && d.pause !== false; // #443: si el panel no pausa, sólo se avisa
            if (btn) { btn.disabled = pause; if (pause) btn.textContent = 'Retiros pausados por el banco'; else if (btn.textContent === 'Retiros pausados por el banco') btn.textContent = '💸 Continuar'; }
        } catch (_) { _bankOutage = false; }
    }
    async function openWithdrawModal() {
        _clearError('withdrawError');
        _clearError('withdrawOtpPhoneError');
        _clearError('withdrawOtpCodeError');
        _otpPhone = null;
        _pendingWithdraw = null;
        _showStep('form');
        const noBalance = _el('withdrawNoBalance');
        if (noBalance) noBalance.style.display = 'none';
        const balEl = _el('withdrawBalanceAmount');
        if (balEl) balEl.textContent = '...';

        VIP.ui.showModal('withdrawModal');
        _checkBankStatus(); // #442
        await _loadAccountAndBalance();
    }

    // #881: detalle del rollover arriba del formulario: saldo total, cuánto es retirable, cuánto está bloqueado y cuánto falta apostar.
    let _rolloverShown = false;
    function _paintRollover(r) {
        // #884 (owner): "en retiro explicá bien cuánto tiene disponible para retirar, con detalle, que no se quejen todos a soporte".
        _rolloverShown = false;
        let box = _el('withdrawRollover');
        if (!box) { const anchor = _el('withdrawNoBalance'); if (!anchor || !anchor.parentNode) return; box = document.createElement('div'); box.id = 'withdrawRollover'; box.className = 'wd-roll'; anchor.parentNode.insertBefore(box, anchor); }
        if (!r) { box.style.display = 'none'; box.innerHTML = ''; return; }
        const m = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
        const wMin = _withdrawMin();
        if (!(r.locked > 0)) {
            box.innerHTML = '<div class="wd-roll-big ok">✅ Podés retirar <b>' + m(r.available) + '</b></div><div class="wd-roll-p">Todo tu saldo ya está liberado: no tenés apuestas pendientes.' + (r.claimable > 0 ? ' 🎁 Además tenés <b>' + m(r.claimable) + '</b> para reclamar en el regalito de la plataforma.' : '') + '</div>';
            box.style.display = ''; return;
        }
        const items = (r.items || []).filter((x) => x.remaining > 0);
        const row = (x) => {
            const what = x.kind === 'bonus' ? '🎁 Bono' : x.kind === 'deposit' ? '💵 Carga' : '🎯 Objetivo';
            const mult = x.multiplier ? ' ×' + x.multiplier : '';
            return '<div class="wd-roll-it"><div class="wd-roll-row"><span>' + what + ' de <b>' + m(x.locked) + '</b>' + (mult ? ' <small>(rollover' + mult + ')</small>' : '') + '</span><b class="wd-roll-falta">faltan ' + m(x.remaining) + '</b></div>'
                + '<div class="wd-roll-bar"><i style="width:' + Math.max(2, Math.min(100, x.pct || 0)) + '%"></i></div>'
                + '<small>Llevás apostado ' + m(x.progress) + ' de ' + m(x.target) + ' (' + (x.pct || 0) + '%). Cuando llegues, esos ' + m(x.locked) + ' pasan solos a retirables.</small></div>';
        };
        box.innerHTML = '<div class="wd-roll-big' + (r.available >= wMin ? ' ok' : '') + '">Podés retirar hoy: <b>' + m(r.available) + '</b></div>'
            + '<div class="wd-roll-sum"><span>Saldo total <b>' + m(r.balance) + '</b></span><span>Todavía en juego <b>' + m(r.locked) + '</b></span></div>'
            + (items.length ? '<div class="wd-roll-h">Qué te falta para liberar el resto</div>' + items.map(row).join('') : '')
            + (r.available < wMin ? '<p class="wd-roll-p wd-roll-warn">El retiro mínimo es ' + m(wMin) + '. Cuando lo retirable llegue a ese monto vas a poder pedirlo desde acá.</p>' : '')
            + '<details class="wd-roll-faq"><summary>¿Por qué no puedo retirar todo mi saldo?</summary><ul>'
            + '<li><b>Cada carga</b> se juega ×' + _depX(r) + ' antes de retirarla y <b>cada bono o regalo</b> ×' + _bonX(r) + '. Es para que el servicio no se use para mover plata sin jugar.</li>'
            + '<li><b>Cuenta lo que apostás</b> en la plataforma, ganes o pierdas, no lo que cargás.</li>'
            + '<li>Se va liberando <b>solo</b> a medida que jugás: no hace falta pedir nada ni escribir a soporte.</li>'
            + '<li>Lo que ganes jugando también suma a tu saldo y se libera con la misma regla.</li>'
            + (r.claimable > 0 ? '<li>🎁 Tenés <b>' + m(r.claimable) + '</b> para reclamar en el regalito de la plataforma.</li>' : '')
            + '</ul></details>';
        box.style.display = '';
        _rolloverShown = true;
        if (r.available < wMin) { const form = _el('withdrawForm'); if (form) form.style.display = 'none'; }
    }
    function _bonX(r) { const d = (r.items || []).find((x) => x.kind === 'bonus' && x.multiplier); return d ? d.multiplier : 5; }
    function _depX(r) { const d = (r.items || []).find((x) => x.kind === 'deposit' && x.multiplier); if (d) return d.multiplier; try { const v = Number(VIP.home.platformsData.depositRolloverX); if (v > 0) return v; } catch (_) {} return 3; }

    async function _loadAccountAndBalance() {
        // 1. Datos bancarios guardados + estado del teléfono.
        try {
            const res = await fetch(`${VIP.config.API_URL}/api/withdrawal/account`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                const acc = data.account || {};
                if (acc.titular) _el('withdrawTitular').value = acc.titular;
                if (acc.cbu) _el('withdrawCbu').value = acc.cbu;
                if (acc.alias) _el('withdrawAlias').value = acc.alias;
                if (data.phone) _prefillOtpPhone(data.phone);
                // Mantener el estado local de verificación sincronizado.
                if (VIP.state.currentUser && typeof data.phoneVerified === 'boolean') {
                    VIP.state.currentUser.phoneVerified = data.phoneVerified;
                }
            }
        } catch (e) { /* no bloquea: el formulario sigue usable */ }

        // 2. Saldo en vivo (JugaYGana).
        try {
            const res = await fetch(`${VIP.config.API_URL}/api/balance/live`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                // #881: se puede retirar sólo lo RETIRABLE (lo que dice 1girox), no el saldo total con el bono adentro.
                _balance = Number(data.available != null ? data.available : data.balance) || 0;
                _paintRollover(data.rollover || null);
            } else {
                _balance = Number(VIP.state.currentUser && VIP.state.currentUser.balance) || 0;
            }
        } catch (e) {
            _balance = Number(VIP.state.currentUser && VIP.state.currentUser.balance) || 0;
        }

        const balEl = _el('withdrawBalanceAmount');
        if (balEl) balEl.textContent = '$' + _balance.toLocaleString('es-AR');

        // Saldo por debajo del mínimo de retiro (Config, #379: $10.000 por defecto) → bloquear el formulario y avisar.
        const _wMin = _withdrawMin();
        try { document.querySelectorAll('.wd-min').forEach((el) => { el.textContent = '$' + _wMin.toLocaleString('es-AR'); }); const ai = _el('withdrawAmount'); if (ai) { ai.min = String(_wMin); ai.placeholder = 'Ej: ' + _wMin.toLocaleString('es-AR'); } } catch (_) {}
        if (_balance < _wMin && !_rolloverShown) {
            const noBalance = _el('withdrawNoBalance');
            const form = _el('withdrawForm');
            if (noBalance) noBalance.style.display = '';
            if (form) form.style.display = 'none';
        }
    }

    async function handleWithdrawSubmit(e) {
        if (e) e.preventDefault();
        _clearError('withdrawError');

        const titular = (_el('withdrawTitular').value || '').trim();
        const cbu = (_el('withdrawCbu').value || '').trim();
        const alias = (_el('withdrawAlias').value || '').trim();
        const amount = Number(_el('withdrawAmount').value);
        const saveData = _el('withdrawSaveData').checked;

        if (!titular || !cbu || !alias) {
            _showError('withdrawError', 'Completá titular, CVU/CBU y alias.');
            return;
        }
        if (!amount || amount < _withdrawMin()) {
            _showError('withdrawError', 'El monto mínimo de retiro es $' + _withdrawMin().toLocaleString('es-AR') + '.');
            return;
        }
        if (amount > _balance) {
            _showError('withdrawError', _rolloverShown ? `Hoy podés retirar hasta $${_balance.toLocaleString('es-AR')}: el resto es bono que todavía tiene rollover (arriba ves cuánto te falta apostar).` : `No podés retirar más que tu saldo disponible ($${_balance.toLocaleString('es-AR')}).`); // #881
            return;
        }

        _pendingWithdraw = { titular, cbu, alias, amount, saveData };

        // Para retirar, la cuenta debe tener el teléfono verificado por SMS.
        // Si todavía no lo verificó, se abre el paso de verificación SMS antes
        // de procesar el retiro (el registro de inicio es sin SMS, opcional).
        const verified = VIP.state.currentUser && VIP.state.currentUser.phoneVerified === true;
        if (!verified) {
            _otpMode = 'phone';
            _clearError('withdrawOtpPhoneError');
            _showStep('otp-phone');
            return;
        }

        // #382: con el teléfono verificado, cada retiro se confirma con un código SMS.
        if (_otpRequired()) { await sendWithdrawConfirmOtp(); return; }
        await _doWithdraw();
    }

    // #382: pide el código SMS de ESTE retiro (va al teléfono verificado de la cuenta).
    async function sendWithdrawConfirmOtp() {
        const submitBtn = _el('withdrawSubmitBtn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Enviando SMS...'; }
        try {
            const res = await fetch(`${VIP.config.API_URL}/api/withdrawal/send-otp`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VIP.state.currentToken}` }, body: JSON.stringify({ amount: _pendingWithdraw && _pendingWithdraw.amount })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success && data.required === false) { await _doWithdraw(); return; }
            if (res.ok && data.success) {
                _otpMode = 'withdraw';
                const amt = _pendingWithdraw ? '$' + Number(_pendingWithdraw.amount).toLocaleString('es-AR') : '';
                _el('withdrawOtpMsg').textContent = '🔒 Para confirmar el retiro de ' + amt + ' te enviamos un código SMS al ' + (data.phone || 'tu teléfono') + '. Si no fuiste vos, no lo compartas.';
                _el('withdrawOtpCode').value = '';
                _clearError('withdrawOtpCodeError');
                const vb = _el('withdrawOtpVerifyBtn'); if (vb) vb.textContent = '✅ Confirmar retiro';
                _showStep('otp-code');
                setTimeout(() => _el('withdrawOtpCode').focus(), 50);
            } else if (data.code === 'PHONE_VERIFICATION_REQUIRED') {
                _otpMode = 'phone'; _showStep('otp-phone');
            } else {
                _showError('withdrawError', data.error || 'No se pudo enviar el SMS. Probá de nuevo en un momento.');
            }
        } catch (_) { _showError('withdrawError', 'Error de conexión.'); }
        finally { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💸 Continuar'; } }
    }
    function resendOtp() { if (_otpMode === 'withdraw') sendWithdrawConfirmOtp(); else sendWithdrawOtp(); }

    async function sendWithdrawOtp() {
        _clearError('withdrawOtpPhoneError');
        const prefix = _el('withdrawOtpPrefix').value;
        const number = (_el('withdrawOtpPhone').value || '').trim();
        const btn = _el('withdrawOtpSendBtn');

        if (!number || number.replace(/\D/g, '').length < 7) {
            _showError('withdrawOtpPhoneError', 'Ingresá un número válido (mínimo 7 dígitos).');
            return;
        }
        // #893: mismo armado que "Verificá tu teléfono" (todo junto, sin 0 ni 15; Argentina = +549 + 10 números)
        let fullPhone;
        try { const fx = VIP.auth.phoneFix(prefix, number); if (fx.error) { _showError('withdrawOtpPhoneError', fx.error); return; } fullPhone = fx.phone; }
        catch (_) { fullPhone = prefix + number.replace(/[\s\-().]/g, '').replace(/^0+/, ''); }

        if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
        try {
            const res = await fetch(`${VIP.config.API_URL}/api/auth/verify-phone/send-otp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({ phone: fullPhone })
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok && data.success) {
                _otpPhone = fullPhone;
                _el('withdrawOtpMsg').textContent = `✅ Te enviamos un código SMS al ${data.phone || fullPhone}.`;
                _el('withdrawOtpCode').value = '';
                _clearError('withdrawOtpCodeError');
                _showStep('otp-code');
                setTimeout(() => _el('withdrawOtpCode').focus(), 50);
            } else if (data && data.code === 'PHONE_ALREADY_OWN') {
                // #879: ya estaba verificado (la app no se había enterado): sigue el retiro sin volver a verificar.
                if (VIP.state.currentUser) { VIP.state.currentUser.phone = fullPhone; VIP.state.currentUser.phoneVerified = true; }
                if (_otpRequired()) { _showStep('form'); await sendWithdrawConfirmOtp(); } else { _showStep('form'); await _doWithdraw(); }
            } else {
                _showError('withdrawOtpPhoneError', data.error || 'No se pudo enviar el SMS. Intentá de nuevo.');
            }
        } catch (err) {
            _showError('withdrawOtpPhoneError', 'Error de conexión.');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '📱 Enviar código SMS'; }
        }
    }

    async function verifyWithdrawOtp() {
        _clearError('withdrawOtpCodeError');
        const code = (_el('withdrawOtpCode').value || '').trim();
        const btn = _el('withdrawOtpVerifyBtn');

        if (!code || code.length < 6) {
            _showError('withdrawOtpCodeError', 'Ingresá el código de 6 dígitos.');
            return;
        }
        // #382: código de confirmación de ESTE retiro → va directo al pedido con el código.
        if (_otpMode === 'withdraw') { await _doWithdraw(code); return; }
        if (!_otpPhone) {
            _showError('withdrawOtpCodeError', 'Volvé al paso anterior y reenviá el código.');
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }
        try {
            const res = await fetch(`${VIP.config.API_URL}/api/auth/verify-phone/confirm`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({ phone: _otpPhone, otpCode: code })
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok && data.success) {
                if (VIP.state.currentUser) {
                    VIP.state.currentUser.phone = _otpPhone;
                    VIP.state.currentUser.phoneVerified = true;
                    VIP.state.currentUser.phoneVerificationPending = false;
                }
                // Teléfono verificado → código SMS de este retiro (#382) o el retiro directo.
                if (_otpRequired()) { _showStep('form'); await sendWithdrawConfirmOtp(); } else await _doWithdraw();
            } else {
                _showError('withdrawOtpCodeError', data.error || 'Código incorrecto o expirado.');
                if (btn) { btn.disabled = false; btn.textContent = '✅ Verificar y retirar'; }
            }
        } catch (err) {
            _showError('withdrawOtpCodeError', 'Error de conexión.');
            if (btn) { btn.disabled = false; btn.textContent = '✅ Verificar y retirar'; }
        }
    }

    async function _doWithdraw(otpCode) {
        if (!_pendingWithdraw) return;

        const onOtpStep = _el('withdrawOtpStep') && _el('withdrawOtpStep').style.display !== 'none';
        const errorTarget = onOtpStep ? 'withdrawOtpCodeError' : 'withdrawError';
        const submitBtn = _el('withdrawSubmitBtn');
        const verifyBtn = _el('withdrawOtpVerifyBtn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Procesando...'; }
        if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.textContent = 'Procesando...'; }

        try {
            const metaEventId = (VIP.pixel && VIP.pixel.enabled) ? VIP.pixel.newEventId() : null;
            const res = await fetch(`${VIP.config.API_URL}/api/withdrawal/request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${VIP.state.currentToken}`
                },
                body: JSON.stringify({
                    titular: _pendingWithdraw.titular,
                    cbu: _pendingWithdraw.cbu,
                    alias: _pendingWithdraw.alias,
                    amount: _pendingWithdraw.amount,
                    saveData: _pendingWithdraw.saveData,
                    otpCode: otpCode || undefined, // #382
                    metaEventId
                })
            });
            const data = await res.json().catch(() => ({}));

            if (res.ok && data.success) {
                if (VIP.pixel && metaEventId) {
                    VIP.pixel.trackWithId(metaEventId, 'WithdrawRequest', {
                        value: _pendingWithdraw.amount,
                        currency: 'ARS'
                    });
                }
                const _wdAmt = _pendingWithdraw && _pendingWithdraw.amount; // #714
                _pendingWithdraw = null;
                VIP.ui.hideModal('withdrawModal');
                VIP.ui.showToast('✅ ' + (data.message || 'Retiro solicitado correctamente'), 'success');
                try { if (VIP.home && VIP.home.onWithdrawRequested) VIP.home.onWithdrawRequested(_wdAmt); } catch (_) {} // #714: cartel ¡Felicitaciones!
                setTimeout(() => VIP.chat.loadMessages(), 500);
                setTimeout(() => VIP.ui.syncBalance(), 1500);
                return;
            }

            if (data.code === 'WITHDRAW_OTP_REQUIRED') { // #382
                await sendWithdrawConfirmOtp();
            } else if (data.code === 'WITHDRAW_OTP_INVALID') {
                _showStep('otp-code');
                _showError('withdrawOtpCodeError', data.error || 'Código incorrecto o expirado.');
            } else if (data.code === 'PHONE_VERIFICATION_REQUIRED') {
                // No debería pasar (ya verificamos), pero por las dudas reabrimos el paso SMS.
                _otpMode = 'phone';
                _showStep('otp-phone');
                _showError('withdrawOtpPhoneError', data.error || 'Verificá tu teléfono para poder retirar.');
            } else {
                if (data.code === 'ROLLOVER_LOCKED' && data.rollover) { _showStep('form'); _paintRollover(data.rollover); _balance = Number(data.rollover.available) || 0; const be = _el('withdrawBalanceAmount'); if (be) be.textContent = '$' + _balance.toLocaleString('es-AR'); } // #881
                _showError(data.code === 'ROLLOVER_LOCKED' ? 'withdrawError' : errorTarget, data.error || 'No se pudo procesar el retiro.');
            }
        } catch (err) {
            _showError(errorTarget, 'Error de conexión.');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💸 Continuar'; }
            if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = '✅ Verificar y retirar'; }
        }
    }

    function backToForm() {
        _clearError('withdrawOtpPhoneError');
        _showStep('form');
    }

    function backToPhone() {
        _clearError('withdrawOtpCodeError');
        if (_otpMode === 'withdraw') { _showStep('form'); return; } // #382: el código del retiro vuelve al formulario
        _showStep('otp-phone');
    }

    return {
        openWithdrawModal,
        handleWithdrawSubmit,
        sendWithdrawOtp,
        verifyWithdrawOtp,
        sendWithdrawConfirmOtp,
        resendOtp,
        backToForm,
        backToPhone
    };

})();

window.openWithdrawModal = VIP.withdraw.openWithdrawModal;
