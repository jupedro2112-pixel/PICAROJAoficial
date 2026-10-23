// ========================================
// FIRE - Fueguito (racha diaria) module
// ========================================

window.VIP = window.VIP || {};

VIP.fire = (function () {

    async function loadFireStatus() {
        try {
            const response = await fetch(`${VIP.config.API_URL}/api/fire/status`, {
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });
            if (response.ok) {
                VIP.state.fireStatus = await response.json();
                updateFireButton();
            }
        } catch (error) {
            console.error('Error cargando fueguito:', error);
        }
    }

    function updateFireButton() {
        if (!VIP.state.fireStatus) return;

        const btn    = document.getElementById('fireBtn');
        const streak = document.getElementById('fireStreak');
        if (!btn || !streak) return;

        streak.textContent = VIP.state.fireStatus.streak || 0;

        if (VIP.state.fireStatus.canClaim) {
            btn.style.animation = 'fire-pulse 1s ease infinite';
            btn.style.opacity   = '1';
        } else {
            btn.style.animation = 'none';
            btn.style.opacity   = '0.7';
        }
    }

    async function showFireModal() {
        // Siempre refrescar el estado al abrir: así se reflejan premios que el
        // servidor ya expiró/consumió (efectivo del mismo día, 100% próxima carga
        // aplicado por un operador) y no queda un botón de reclamo "viejo" por
        // estado cacheado en memoria.
        await loadFireStatus();
        if (!VIP.state.fireStatus) {
            VIP.ui.showToast('Error cargando datos del fueguito', 'error');
            return;
        }

        const streak = VIP.state.fireStatus.streak || 0;
        document.getElementById('fireStreakModal').textContent = streak;
        document.getElementById('fireLastClaim').textContent = VIP.state.fireStatus.lastClaim
            ? new Date(VIP.state.fireStatus.lastClaim).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
            : 'Nunca';

        // Req 2: Progreso visual hasta 100 días
        const maxDays = 100;
        const progressPercent = Math.min((streak / maxDays) * 100, 100);
        document.getElementById('fireProgressBar').style.width = progressPercent + '%';
        document.getElementById('fireProgressBar').textContent = Math.round(progressPercent) + '%';
        document.getElementById('fireProgressText').textContent = `${Math.min(streak, maxDays)}/${maxDays} días`;

        const claimBtn  = document.getElementById('claimFireBtn');
        const condition = document.getElementById('fireCondition');

        if (VIP.state.fireCountdownInterval) {
            clearInterval(VIP.state.fireCountdownInterval);
        }

        // #348: la misma regla arriba del modal
        // #405: regla por MONTO (el mínimo por cantidad sólo si el panel lo tiene > 0).
        const _fA = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
        const _st = VIP.state.fireStatus || {};
        const _rqA = Number(_st.nextReqAmount) || 0, _rqD = Number(_st.nextReqDays) || 0, _rqH = Number(_st.nextReqHave) || 0, _rqDay = Number(_st.nextReqDay) || 0;
        try { const top = document.getElementById('fireRuleTop'); const _rN = Number(_st.rolloverNeed) || 0, _rH = Number(_st.rolloverHave) || 0, _rD = Number(_st.rolloverForDay) || 0, _rX = Number(_st.rolloverExpiresDay) || 0; if (top) { top.innerHTML = _rN > 0 ? ('🎯 Para cobrar el premio del día ' + _rD + ': rollover de <b>' + _fA(_rN) + '</b> en esta racha (apostar en la plataforma, <b>no cargar</b>) · llevás <b>' + _fA(_rH) + '</b>' + (_st.rolloverUnknown ? ' <i>(no pudimos leer tus apuestas ahora)</i>' : '') + ' · no hacen falta más fueguitos: sólo llegar al rollover · vuelve a 0 con cada premio') : ''; top.style.display = _rN > 0 ? '' : 'none'; } } catch (_) {} // #654
        const activityConditionEl = document.getElementById('fireActivityCondition');
        if (activityConditionEl) {
            // #347: si el server todavía no manda el mínimo (sin redeploy) se muestra el default 10; sólo 0 explícito lo apaga.
            const _mdRaw = VIP.state.fireStatus.minDeposits;
            const _md = (_mdRaw == null || _mdRaw === '') ? 0 : (Number(_mdRaw) || 0); // #405: default 0 (la regla es por monto)
            const _d1 = ((VIP.state.fireStatus.milestones || [])[0] || {}).day || 10; // #294: ejemplo con el primer hito
            // #654: la regla es por ROLLOVER (apostado), escalando por hito; vuelve a 0 al cobrar o al pasar al hito siguiente
            const _msL = (VIP.state.fireStatus.milestones || []).filter((m) => Number(m.rollover) > 0);
            const _esc = _msL.map((m) => 'día ' + m.day + ' → ' + _fA(m.rollover)).join(' · ');
            // #885: plazo por hito (días para llegar a los fueguitos y completar las apuestas)
            const _pzL = (VIP.state.fireStatus.milestones || []).filter((m) => Number(m.depositDays) > 0).map((m) => m.day + ' 🔥 en ' + m.depositDays + ' días').join(' · ');
            const _pzTxt = _pzL ? '<br>⏳ <strong>Plazo de cada racha:</strong> ' + _pzL + '. En ese plazo tenés que llegar a los fueguitos <strong>y</strong> completar las apuestas del premio. <strong>No es plata que perdés:</strong> es lo que apostás jugando en la plataforma, ganes o pierdas (si ganás, la plata es tuya). Si se vence el plazo, ese premio se pierde y arrancás un tramo nuevo.' : '';
            activityConditionEl.innerHTML = _pzTxt.replace(/^<br>/, '') + (_pzTxt ? '<br>' : '') + (_msL.length
                ? '📋 <strong>Condición:</strong> cada premio pide un <strong>rollover</strong> que va subiendo: ' + _esc + '. <strong>Rollover = apostar en la plataforma, no cargar</strong>: lo que cargás no suma, suma lo que jugás. Al llegar al hito sólo te falta completar el rollover (no hacen falta más fueguitos). Al cobrar, o si una racha llega a un hito nuevo, el contador vuelve a <strong>0</strong>.'
                : '📋 <strong>Condición:</strong> reclamá tu fueguito cada día; el premio de cada racha se acredita al llegar al día.');
        }

        const pendingBonusEl = document.getElementById('firePendingBonus');
        if (pendingBonusEl) {
            if (VIP.state.fireStatus.pendingNextLoadBonus) {
                pendingBonusEl.style.display = 'block';
                pendingBonusEl.innerHTML = '🎉 <strong style="color:#d4af37;">Tenés un 30% en tu próxima carga disponible!</strong> Avisale a un operador cuando quieras usarlo.';
            } else {
                pendingBonusEl.style.display = 'none';
            }
        }

        // #885: aviso (una vez) si un premio pendiente se venció por plazo
        try { const px = VIP.state.fireStatus.plazoExpired; if (px && px.day && VIP.ui && VIP.ui.showToast) VIP.ui.showToast('⏳ Se venció el plazo de ' + px.days + ' días del premio del día ' + px.day + '. Arrancás un tramo nuevo: seguí sumando fueguitos 🔥', 'info'); } catch (_) {}
        // Mostrar botón de reclamo de premio en efectivo si hay uno pendiente
        let claimRewardBtn = document.getElementById('claimFireRewardBtn');
        const pendingCash = VIP.state.fireStatus.pendingCashReward || 0;
        const pendingCashEl = document.getElementById('firePendingCashReward');
        if (pendingCashEl) {
            if (pendingCash > 0) {
                // Aviso de rollover: el premio se juega ya, pero para RETIRARLO hay
                // que apostar (multiplicador × premio) — lo exige la plataforma.
                const _mult = VIP.state.fireStatus.rolloverMultiplier || 0;
                const _rolloverNote = _mult > 0
                    ? `<span style="font-size:11px;color:#ffb84d;">🎯 Para poder retirarlo: rollover x${_mult} = apostar $${Math.round(pendingCash * _mult).toLocaleString('es-AR')} (apostar, no cargar)</span><br>`
                    : '';
                pendingCashEl.style.display = 'block';
                const _pN = Number(VIP.state.fireStatus.rolloverNeed) || 0, _pH = Number(VIP.state.fireStatus.rolloverHave) || 0, _pX = Number(VIP.state.fireStatus.rolloverExpiresDay) || 0; // #654
                const _pBar = _pN > 0 ? `<div style="margin:6px 0 4px;height:8px;border-radius:999px;background:rgba(255,255,255,.15);overflow:hidden;"><i style="display:block;height:100%;width:${Math.min(100, Math.round(_pH / _pN * 100))}%;background:#ffd700;"></i></div><span style="font-size:11px;color:#ffe08a;">Rollover: apostaste $${_pH.toLocaleString('es-AR')} de $${_pN.toLocaleString('es-AR')} (no cuenta lo cargado)</span><br>` : '';
                pendingCashEl.innerHTML = `
                    <strong style="color:#ffd700;">🏆 ¡Tenés $${pendingCash.toLocaleString('es-AR')} para reclamar!</strong><br>
                    <span style="font-size:12px;color:#ccc;">Premio de tu racha Fueguito día ${VIP.state.fireStatus.pendingCashRewardDay}</span><br>
                    ${(function () { const dl = VIP.state.fireStatus.plazoDeadline; if (!dl) return ''; const left = Math.max(0, Math.ceil((new Date(dl).getTime() - Date.now()) / 86400000)); return '<span style="font-size:11.5px;color:#ffe08a;">⏳ Te ' + (left === 1 ? 'queda 1 día' : 'quedan ' + left + ' días') + ' (plazo de ' + VIP.state.fireStatus.plazoDays + ' días) para completar las apuestas y cobrarlo. Apostar es jugar, no perder.</span><br>'; })()}
                    ${_pBar}
                    ${_rolloverNote}
                    <button id="claimFireRewardBtn" onclick="VIP.fire.claimFireReward()" style="margin-top:8px;background:linear-gradient(135deg,#d4af37,#ffd700);color:#000;border:none;padding:10px 20px;border-radius:20px;font-weight:900;font-size:14px;cursor:pointer;">💰 Reclamar $${pendingCash.toLocaleString('es-AR')}</button>
                `;
            } else {
                pendingCashEl.style.display = 'none';
            }
        }

        // #294: resumen del plegable "Premios por racha" (el detalle de todos los días se achica/agranda).
        try {
            const ms = VIP.state.fireStatus.milestones || [];
            const nxt = ms.find((m) => m.status !== 'completed');
            const sum = document.getElementById('fireMsSummary');
            if (sum) sum.textContent = nxt ? ('próx. día ' + nxt.day + (nxt.reward ? ' · $' + Number(nxt.reward).toLocaleString('es-AR') : '')) : 'todos listos';
        } catch (_) {}
        const milestonesEl = document.getElementById('fireMilestonesMenu');
        if (milestonesEl && VIP.state.fireStatus.milestones) {
            milestonesEl.innerHTML = VIP.state.fireStatus.milestones.map(m => {
                let statusIcon, statusLabel, statusClass;
                if (m.status === 'completed') {
                    statusIcon = '✅'; statusLabel = 'Completado'; statusClass = 'milestone-done';
                } else if (m.status === 'next') {
                    statusIcon = '🔓'; statusLabel = '¡Próximo!'; statusClass = 'milestone-next';
                } else {
                    statusIcon = '🔒'; statusLabel = 'Bloqueado'; statusClass = 'milestone-locked';
                }
                let rewardText;
                if (m.type === 'next_load_bonus') {
                    rewardText = '30% en próxima carga';
                } else {
                    rewardText = m.reward ? `$${m.reward.toLocaleString('es-AR')}` : '-';
                }
                // 🪦 Antes acá se mostraba "(requiere actividad del mes)" según
                // hasDepositRequirement: ese requisito fue reemplazado por el
                // ROLLOVER (2026-08-05) — se avisa el objetivo de apuestas.
                const _fsMult = VIP.state.fireStatus.rolloverMultiplier || 0;
                const depositNote = (_fsMult > 0 && m.type === 'cash' && m.reward)
                    ? ` <span style="font-size:10px;color:#ffb84d;">(retiro con rollover x${_fsMult})</span>`
                    : '';
                // #405: requisito por monto de cada premio
                // #885 (owner): "10 fueguitos en 20 días": plazo para llegar Y apostar; apostar es jugar, no perder
                const _pz = Number(m.depositDays) || 0;
                const reqNote = (Number(m.rollover) > 0)
                    ? `<br><span style="font-size:10.5px;color:#aaa;">${m.day} 🔥 en ${_pz || m.day * 2} días · en ese plazo apostás ${_fA(m.rollover)} jugando (no es plata perdida: todo lo que apostás suma, ganes o pierdas)</span>`
                    : (_pz ? `<br><span style="font-size:10.5px;color:#aaa;">${m.day} 🔥 en ${_pz} días</span>` : ''); // #654
                return `<div class="milestone-item ${statusClass}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin:4px 0;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);">
                    <span>${statusIcon} <strong>Día ${m.day}</strong>: ${rewardText}${depositNote}${reqNote}</span>
                    <span style="font-size:11px;color:#aaa;">${statusLabel}</span>
                </div>`;
            }).join('');
        }

        if (VIP.state.fireStatus.canClaim) {
            claimBtn.disabled = false;
            claimBtn.textContent = '🔥 Reclamar Fueguito';
            claimBtn.style.background = 'linear-gradient(135deg, #ff4500 0%, #ff6347 100%)';
            condition.innerHTML = '✅ <strong style="color: #00ff88;">Podés reclamar tu fueguito hoy!</strong>';
        } else {
            claimBtn.disabled = true;
            claimBtn.textContent = '⏳ Ya reclamado';
            claimBtn.style.background = '#666';
            startFireCountdown();
        }

        VIP.ui.showModal('fireModal');
    }

    function startFireCountdown() {
        if (VIP.state.fireCountdownInterval) {
            clearInterval(VIP.state.fireCountdownInterval);
        }

        const argentinaMidnight = getArgentinaMidnight();

        function updateCountdown() {
            const current = getArgentinaDate();
            const diff    = argentinaMidnight - current.getTime();

            if (diff <= 0) {
                loadFireStatus();
                if (VIP.state.fireCountdownInterval) {
                    clearInterval(VIP.state.fireCountdownInterval);
                }
                return;
            }

            const hours   = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            const condition = document.getElementById('fireCondition');
            if (condition && VIP.state.fireStatus && !VIP.state.fireStatus.canClaim) {
                condition.innerHTML = '⏳ Próximo fueguito disponible en: <strong style="color: #ff4500;">' +
                    String(hours).padStart(2, '0') + ':' +
                    String(minutes).padStart(2, '0') + ':' +
                    String(seconds).padStart(2, '0') + '</strong>';
            }
        }

        updateCountdown();
        VIP.state.fireCountdownInterval = setInterval(updateCountdown, 1000);
    }

    async function claimFire() {
        const claimBtn = document.getElementById('claimFireBtn');

        if (claimBtn) { claimBtn.disabled = true; claimBtn.textContent = 'Procesando...'; }

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/fire/claim`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                VIP.ui.showToast(`🔥 ${data.message}`, 'success');

                VIP.state.fireStatus.canClaim   = false;
                VIP.state.fireStatus.lastClaim  = new Date().toISOString();
                VIP.state.fireStatus.streak     = data.streak;
                if (data.pendingNextLoadBonus !== undefined) {
                    VIP.state.fireStatus.pendingNextLoadBonus = data.pendingNextLoadBonus;
                }
                if (data.pendingCashReward !== undefined) {
                    VIP.state.fireStatus.pendingCashReward    = data.pendingCashReward;
                    VIP.state.fireStatus.pendingCashRewardDay = data.pendingCashRewardDay;
                }

                startFireCountdown();
                updateFireButton();

                if (data.rewardType === 'cash_pending') {
                    VIP.chat.sendSystemMessage(`🏆 ¡Fueguito día ${data.streak}! Tenés $${data.reward.toLocaleString('es-AR')} para reclamar en el recuadro de Fueguito.`);
                } else if (data.rewardType === 'next_load_bonus') {
                    VIP.chat.sendSystemMessage(`🎉 ¡Recompensa Fueguito día 15! Tenés 30% en tu próxima carga. Avisale a un operador cuando quieras usarlo.`);
                } else {
                    VIP.chat.sendSystemMessage(`🔥 Día ${data.streak} de racha Fueguito!`);
                }

                setTimeout(() => { VIP.ui.hideModal('fireModal'); }, 1500);
            } else {
                VIP.ui.showToast(data.error || data.message || 'Error', 'error');
                if (claimBtn) { claimBtn.disabled = false; claimBtn.textContent = '🔥 Reclamar Fueguito'; }
            }
        } catch (error) {
            console.error('Error reclamando fueguito:', error);
            VIP.ui.showToast('Error de conexión', 'error');
            if (claimBtn) { claimBtn.disabled = false; claimBtn.textContent = '🔥 Reclamar Fueguito'; }
        }
    }

    async function claimFireReward() {
        const btn = document.getElementById('claimFireRewardBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Cargando...'; }

        try {
            const response = await fetch(`${VIP.config.API_URL}/api/fire/claim-reward`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${VIP.state.currentToken}` }
            });

            const data = await response.json();

            if (response.ok && data.success) {
                VIP.ui.showToast(`🎉 ${data.message}`, 'success');
                VIP.state.fireStatus.pendingCashReward    = 0;
                VIP.state.fireStatus.pendingCashRewardDay = 0;
                VIP.chat.sendSystemMessage(`🎉 ¡Fueguito! ${data.message}`);
                // Recargar el modal para reflejar el cambio
                await loadFireStatus();
                setTimeout(() => { VIP.ui.hideModal('fireModal'); }, 1500);
            } else {
                const errMsg = data.error || 'Error al reclamar recompensa';
                VIP.ui.showToast('⚠️ ' + errMsg, 'error');
                if (btn) { btn.disabled = false; btn.textContent = `💰 Reclamar`; }
            }
        } catch (error) {
            console.error('Error reclamando recompensa fueguito:', error);
            VIP.ui.showToast('Error de conexión', 'error');
            if (btn) { btn.disabled = false; btn.textContent = `💰 Reclamar`; }
        }
    }

    // #294: achicar/agrandar el detalle de todos los días.
    function toggleMilestones() {
        const w = document.getElementById('fireMilestonesWrap'), ch = document.getElementById('fireMsChevron');
        if (!w) return;
        const open = w.style.display === 'none';
        w.style.display = open ? '' : 'none';
        if (ch) ch.textContent = open ? '▲ achicar' : '▼ ver todos';
    }
    return {
        loadFireStatus,
        updateFireButton,
        showFireModal,
        startFireCountdown,
        claimFire,
        claimFireReward,
        toggleMilestones
    };

})();

// Window aliases
window.showFireModal = VIP.fire.showFireModal;
window.claimFire     = VIP.fire.claimFire;
