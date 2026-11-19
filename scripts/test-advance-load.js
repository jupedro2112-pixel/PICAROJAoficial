// #1149 — CARGA ADELANTADA con el banco caído + soporte adelantado de la IA.
// Como el resto de los tests del repo (sin node_modules): revisa en el código las reglas que NO se pueden perder.
//   node scripts/test-advance-load.js
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const A = fs.readFileSync(path.join(ROOT, 'public/adminprivado2026/admin.js'), 'utf8');
const B = fs.readFileSync(path.join(ROOT, 'src/services/supportBot.js'), 'utf8');
const fn = (name) => { const i = S.indexOf('async function ' + name + '('); assert.ok(i > 0, 'falta ' + name); const j = S.indexOf('\nasync function ', i + 10); return S.slice(i, j > 0 ? j : i + 9000); };
let ok = 0, total = 0;
function caso(n, f) { total++; try { f(); ok++; console.log('✅ ' + n); } catch (e) { console.log('❌ ' + n + '\n   ' + e.message); } }

caso('Sólo con el banco caído: el tick no adelanta nada si `_bankInboundState` no da down, ni con el banco apagado / en sombra', () => {
  const t = fn('_advanceTick');
  assert.ok(/if \(!cfg\.enabled \|\| hg\.mode !== 'auto'\) return;/.test(t), 'apagado o sombra ⇒ no adelanta');
  assert.ok(/const st = await _bankInboundState\(cfg\); if \(!st\.down\) return;/.test(t), 'banco normal ⇒ no adelanta');
  assert.ok(/_cronClaim\('advanceload'/.test(t), 'una sola instancia por pasada');
});
caso('Banco caído = consulta fallando 3 veces, o silencio con varios clientes esperando, o marcado a mano; se levanta con la primera transferencia', () => {
  const b = fn('_bankInboundState');
  assert.ok(/_hgPollFails >= 3/.test(b) && /cfg\.silentMinutes/.test(b) && /users\.length >= cfg\.minWaiting/.test(b) && /cfg\.forceUntil/.test(b));
  assert.ok(/lastInAt > ds/.test(b), 'vuelve con la primera transferencia que entra');
  assert.ok(/_hgPollFails\+\+/.test(S) && /_hgPollOkAt = Date\.now\(\); _hgPollFails = 0;/.test(S), 'la consulta al banco mantiene la salud');
});
caso('A quién: 1+ carga verificada por el banco, sin marcas, una sola sin verificar, tope = lo máximo que cargó (techo), cuenta de origen conocida', () => {
  const e = fn('_advanceEligible');
  assert.ok(/u\.isBlocked \|\| \(u\.fraudFlags \|\| \[\]\)\.length \|\| u\.duplicateOf/.test(e) && /autoLoadOff/.test(e) && /status === 'watch'/.test(e), 'sin marcas / alerta');
  assert.ok(/'advance\.status': \{ \$in: \['claiming', 'unverified'\] \}/.test(e), 'una sola adelantada sin verificar por cliente');
  assert.ok(/matchStatus: \{ \$in: \['auto_charged', 'manual_charged'\] \}/.test(e) && /if \(!n\) return/.test(e), 'al menos una carga verificada');
  assert.ok(/const cap = Math\.min\(max, cfg\.capArs\)/.test(e) && /amount > cap/.test(e), 'tope');
  assert.ok(/if \(!known\) return/.test(e) && /_comprobanteToOurBank/.test(e), 'origen conocido y destino nuestro');
});
caso('Plata: reserva atómica antes de cargar, reference estable vip-adv-<comprobante>, reintento con la MISMA reference, tope general', () => {
  const c = fn('_advanceCredit'), f = fn('_advanceFinish'), t = fn('_advanceTick');
  assert.ok(/findOneAndUpdate\(\{ id: c\.id, advance: null, autoCharged: \{ \$ne: true \}, reviewStatus: 'pending'/.test(c), 'reserva atómica');
  assert.ok(/autoCharged: true, advance: \{ status: 'claiming'/.test(c), 'reservado ⇒ ningún otro camino lo carga');
  assert.ok(/const ref = 'vip-adv-' \+ c\.id;/.test(f) && /_depositWithBonus\(adapter, user\.username, amount, 'Carga automática \(hgcash\)', ref/.test(f), 'reference estable por _depositWithBonus');
  assert.ok(/'advance\.status': 'claiming', 'advance\.at': \{ \$lt:/.test(t) && /_advanceFinish\(c, u, false\)/.test(t), 'las reservas a medias se terminan con la misma reference');
  assert.ok(/cfg\.maxOpenArs > 0 && open \+ Number\(c\.amount\) > cfg\.maxOpenArs/.test(t), 'tope general de adelantos sin verificar');
  assert.ok(/metadata: \{ source: 'advance_hgcash', advance: true/.test(f) && /platform: pid/.test(f), 'Transaction con platform y marca de adelantada');
  assert.ok(/outboundWebhook\.notify\('carga'/.test(f) && /metaCapi\.track\('Purchase'/.test(f) && /_supportCloseAfterCharge\(/.test(f) && /maybeSendRecoveryMessage\(/.test(f), 'mismos avisos que toda carga');
});
caso('Verificación: sola cuando entra la transferencia (candado HgcashCharge), o a mano; el cliente queda de confianza y sus retiros se re-chequean', () => {
  const v = fn('_advanceVerify'), r = fn('_advanceReconcile');
  assert.ok(/ms\.length === 1 && await _advanceVerify/.test(r) && /_advanceMovementFits\(c, m, hg, ks\)/.test(r), 'sólo con UNA transferencia que coincide y de la época del comprobante');
  assert.ok(/matchStatus: 'pending' \}, \{ \$set: \{ matchStatus: 'claiming'/.test(v) && /HgcashCharge\.create/.test(v) && /matchStatus: 'auto_charged'/.test(v), 'consume el movimiento con el candado');
  assert.ok(/receiptTrusted: \{ at: new Date\(\), by \}/.test(v), 'queda de confianza');
  assert.ok(/reviewReason: \/ADELANTADA\//.test(v) && /fraudRecheck: \{ n: 0/.test(v), 'retiros frenados vuelven al re-chequeo');
  assert.ok(/receiptTrusted/.test(fn('_receiptTrust')), 'la confianza vale para la carga sin lectura (#1010)');
});
caso('Rechazo: "No llegó" ⇒ alerta (observación + sin carga automática + pierde la confianza); rechazo por repetido en Cargas pendientes ⇒ sin carga automática', () => {
  const j = fn('_advanceReject');
  assert.ok(/'advance\.status': 'unverified' \}, \{ \$set: \{ 'advance\.status': 'rejected'/.test(j) && /autoLoadOff: \{ at: now/.test(j) && /status: 'watch'/.test(j) && /receiptTrusted: \{ at: null/.test(j));
  assert.ok(/if \(reason === 'duplicado'\) await User\.updateOne\(\{ id: c\.userId \}, \{ \$set: \{ receiptTrusted: \{ at: null, by: null \}, autoLoadOff:/.test(S), 'rechazo por repetido');
});
caso('Retiros: con una adelantada sin verificar el retiro va a revisión (fail-closed)', () => {
  const g = fn('_withdrawFraudGate');
  assert.ok(/'advance\.status': \{ \$in: \['claiming', 'unverified'\] \}/.test(g) && /carga ADELANTADA/.test(g) && /catch \(_\) \{ unchecked = true; \}/.test(g));
});
caso('Panel: rutas con permisos (veredicto: admin/depositor/cajero · ajustes: sólo admin, por campo) y botones Llegó / No llegó', () => {
  assert.ok(/app\.post\('\/api\/admin\/api-failures\/:id\/advance'[\s\S]{0,300}\['admin', 'depositor', 'cajero'\]/.test(S));
  assert.ok(/app\.post\('\/api\/admin\/advance-load\/config'[\s\S]{0,200}req\.user\.role !== 'admin'/.test(S) && /Config\.updateOne\(\{ key: 'advanceload' \}, \{ \$set: set \}/.test(S), 'ajustes por campo y con la key en minúsculas');
  assert.ok(/if \(note\.trim\(\)\.length < 4\) return res\.status\(400\)/.test(S), 'Llegó y No llegó piden motivo');
  assert.ok(/window\.advVerdict = advVerdict/.test(A) && /_advItemHtml\(c, fm, fd, chip\)/.test(A) && /_advPanelHtml\(j\.adv, fm, fd\)/.test(A));
});
caso('Soporte adelantado: la 1ª vez que pide una persona atiende la IA (retiro en proceso / "contame"); si no puede, pasa DIRECTO a un agente', () => {
  assert.ok(/mins <= 180\) return \{ kind: 'wd_progress'/.test(S), '#1153: el diagnóstico del retiro en proceso no puede quedar anulado por un comentario');
  assert.ok(!/Carga automática \(adelantada\)/.test(S) && /DATO INTERNO \(el cliente NUNCA tiene que enterarse/.test(B), '#1153: la carga adelantada es interna: ni 1girox ni la IA se lo muestran al cliente');
  assert.ok(/out\.advancePending = /.test(S), '#1153: la IA sabe si el cliente tiene una adelantada sin verificar');
  assert.ok(/kind: 'support_pre'/.test(S) && /_supportPayoutDiagnose\(userId\)/.test(S) && /!preRecent && !sentByBot/.test(S), 'pre-soporte una vez y nunca si lo mandó el bot al botón');
  assert.ok(/if \(r\.handoff && await _supportPreActive\(userId\)\) r = /.test(S), 'handoff directo tras el pre-soporte');
  assert.ok(/estamos validando|lo estamos validando/.test(S), 'retiro en proceso: "lo estamos validando y en breve sale"');
  assert.ok(/u\.askedHuman/.test(B) && /u\.bankDelay/.test(B), 'la IA sabe que pidió una persona y que el banco está con demoras');
});
caso('#1150 No llegó + OTRA cuenta (o "Trucho") ⇒ cuenta cerrada y celular bloqueado; el celular bloqueado no pasa por ningún alta', () => {
  const j = fn('_advanceReject'), o = fn('_advanceOtherAccount'), k = fn('_advanceCloseAccount');
  assert.ok(/const link = \(opts && opts\.noClose\) \? null : await _advanceOtherAccount\(c\.userId\);/.test(j) && /if \(link \|\| \(opts && opts\.close\)\) closed = await _advanceCloseAccount/.test(j));
  assert.ok(/_dupAccountCheck\(u0, 'adelantada-no-llego'\);/.test(o), 're-chequeo SIN los datos del comprobante rechazado');
  assert.ok(/_blockUserAccount\(u\.id, why, by/.test(k) && /_phoneBanUser\(u, by, why\)/.test(k), 'bloqueo con historial + celular');
  assert.ok(/\['register', 'verify-phone', 'change-password'\]\.includes\(String\(purpose\)\) && await _phoneBanned\(phone\)\) return \{ success: false, banned: true/.test(S), 'no se le manda código para registrarse');
  assert.ok(/code: 'PHONE_BANNED', error: PHONE_BAN_MSG \}; \/\/ #1150/.test(S), 'ni confirma sin SMS');
  assert.strictEqual((S.match(/if \(await _phoneBanned\(req\.body && req\.body\.phone\)\) return res\.status\(403\)/g) || []).length, 2, 'alta y entrada rápida');
  assert.ok(/_phoneUnbanUser\(user\.id\)/.test(S), 'desbloquear la cuenta libera el celular');
  assert.ok(/advVerdict\(\\'' \+ c\.id \+ '\\',\\'fake\\'\)/.test(A) && /close: fake/.test(A));
});
caso('#1150 Cierre: la adelantada es carga automática, se separa (sin verificar / no llegó / otro día / entró hoy) y corrige diferencia, arqueo e ingresos', () => {
  const r = fn('_closeReconcile');
  assert.ok(/src === 'advance_hgcash'\) return 'auto'/.test(r), 'no cae en "a mano sin cuenta"');
  assert.ok(/add\('adv_pend'[^\n]*adelantadasPend, -1/.test(r) && /add\('adv_perdida'[^\n]*adelantadasPerdida, -1/.test(r) && /add\('adv_otro_dia'[^\n]*adelantadasOtroDia, -1/.test(r) && /add\('adv_entro_hoy'[^\n]*adelantadasEntraron, \+1/.test(r), 'causas con su signo');
  const i = S.indexOf('function _closeApply('), ap = S.slice(i, i + 6000);
  assert.ok(/doc\.ingresosTotal = Math\.round\(\(doc\.depositos \|\| 0\) - _advLost/.test(ap), 'la que no llegó no es ingreso');
  assert.ok(/- \(_advNet - _advLost\)\)/.test(ap) && /doc\.depositos - _depSec - _advNet - doc\.retiros/.test(ap), 'arqueo sin la plata que no entró ese día');
  const k = S.indexOf('function _closeCheck('), ck = S.slice(k, k + 6000);
  assert.ok(/it\('adelantadas', 'Cargas adelantadas \(banco caído\) verificadas', !_bad/.test(ck), 'el cierre no da OK con adelantadas sin verificar o perdidas');
  assert.ok(/_advanceCloseRecalc\(c, movement\)/.test(S) && /_closeEnsure\(k, true\)/.test(S), 'el cierre viejo se recalcula al verificar');
});
caso('#1151 Revisión: sin doble carga (prioridad de la adelantada, repetido del mismo pago, intento normal previo) y la adelantada fallida vuelve pendiente', () => {
  const mm = fn('hgcashMatchFromMovement'), ac = fn('hgcashAutoCarga'), f = fn('_advanceFinish'), tk = fn('_advanceTakeMovement');
  assert.ok(/if \(await _advanceTakeMovement\(movement, cfg\)\) return;/.test(mm) && mm.indexOf('_advanceTakeMovement') < mm.indexOf('const candidates'), 'la transferencia se ofrece primero a la adelantada');
  assert.ok(/rows\.length !== 1\) return false/.test(tk) && /_advanceMovementFits\(c, movement, hg, ks\)/.test(tk));
  assert.ok(/_advanceMovementFits\(adv, movement, await getHgcashConfig\(\), await _knownSendersOf\(adv\.userId\)\) && await _advanceVerify\(adv/.test(ac) && !/reviewResolution: 'duplicate'/.test(ac) && ac.indexOf('_advanceVerify(adv') < ac.indexOf('matchStatus: \'claiming\''), 'otro comprobante del mismo pago no carga de nuevo y NO se rechaza solo');
  assert.ok(/advance: null, matchedMovementId: null, toApiBank: \{ \$ne: true \},/.test(S) && /matchedMovementId: null, toApiBank: \{ \$ne: true \} \}/.test(fn('_advanceCredit')), 'atado a una transferencia ⇒ no se adelanta');
  assert.ok(/autoCharged: false, reviewStatus: 'pending', reviewResolution: null[^\n]*'advance\.status': 'failed'/.test(f), 'fallida ⇒ pendiente de nuevo');
  assert.ok(/reviewStatus: 'pending', autoCharged: true, 'advance\.status': \{ \$ne: 'claiming' \}/.test(fn('_depositReviewTick')), 'el cron no confirma una reserva a medias');
  assert.ok(/code: 'BANK_ALREADY_CHARGED' \}\);\n      \} catch \(e\) \{ logger\.warn\(`\[deposit-reviews\/confirm\] chequeo adelantada/.test(S), 'la confirmación a mano avisa');
});
caso('#1151 Revisión: banco caído sin falsos positivos, vínculos sin datos de adelantadas no verificadas, celular sólo propio', () => {
  const b = fn('_bankInboundState'), t = fn('_advanceTick');
  assert.ok(/now - lastInAt > 6 \* 60000/.test(b) && /lastInAt - 15 \* 60000/.test(b) && /'autoLoadOff\.at': null/.test(b), 'espera = clientes con historial y comprobantes de la caída');
  assert.ok(/if \(!st\.manual && st\.lastInAt\) cq\.createdAt\.\$gte/.test(t), 'no se adelantan comprobantes viejos');
  assert.ok(/const CQ = \{ 'advance\.status': \{ \$nin: \['claiming', 'unverified', 'rejected', 'failed'\] \}/.test(S));
  assert.ok(/via: \{ \$in: \['sms', 'historico'\] \}/.test(S) && /!== key && await _phoneBanned\(phone\)/.test(S));
  assert.ok(/movement \? \{\} : \{ 'advance\.status': 'unverified' \}/.test(fn('_advanceVerify')), 'Llegó a mano es condicional');
});
caso('#1152 Antifraude: el silencio sólo AVISA, la transferencia tiene que ser ANTERIOR a la acreditación y de cuenta conocida, la tardía deja al cliente en observación', () => {
  const b = fn('_bankInboundState');
  assert.ok(/if \(kind === 'silence' && !cfg\.silenceAuto\) \{/.test(b) && /return \{ down: false, suspect: why \}/.test(b), 'silencio = aviso, no adelanto');
  assert.ok(/silenceAuto: false \}/.test(S) && /duplicateOf: null, 'fraudFlags\.0': \{ \$exists: false \}/.test(b), 'apagado por defecto y sin secundarias en el conteo');
  const i = S.indexOf('function _advanceMovementFits('), f = S.slice(i, i + 700);
  assert.ok(/!_advFromKnown\(m, ks\)\) return false/.test(f) && /if \(!m\.date\) return false/.test(f) && /d <= _advCreditedAt\(c\) \+ 2 \* 60000/.test(f), 'pagar DESPUÉS de recibir las fichas no verifica sola');
  assert.ok(/status: 'watch', by: 'sistema'/.test(fn('_advanceFlagLate')) && /_advanceFlagLate\(c, movement\)/.test(fn('_advanceTakeMovement')));
  assert.ok(/Number\(c\.aiConfidence\) < 0\.75/.test(fn('_advanceEligible')));
});
caso('#1152 Plata: una transferencia verifica UNA sola adelantada, reparación de cortes, vencidas a los 4 días, bono con la misma reference', () => {
  const v = fn('_advanceVerify'), rc = fn('_advanceReconcile'), f = fn('_advanceFinish'), c = fn('_advanceCredit');
  assert.ok(/\{ id: c\.id, 'advance\.movementId': null, 'advance\.status': \{ \$in: \['unverified', 'verified', 'rejected'\] \} \}, \{ \$set: \{ 'advance\.movementId': movement\.movementId/.test(v) && v.indexOf("'advance.movementId': null") < v.indexOf("matchStatus: 'claiming'"), 'reserva de la adelantada ANTES de tomar el movimiento');
  assert.ok(/if \(!mv\) \{ await undo\(\); return false; \}/.test(v) && /await undo\(\); return false; \} \}/.test(v));
  assert.ok(/await _advanceRepair\(\)/.test(rc) && /_advanceReject\(c, 'sistema', 'no apareció ninguna transferencia en 4 días', \{ noClose: true \}\)/.test(rc));
  assert.ok(/'advance\.bonusPlan'/.test(f) && /Object\.assign\(\{ claimed: false \}, c\.advance\.bonusPlan\)/.test(f));
  assert.ok(/autoCharged: false, advance: null \} \}\);\n    return false;/.test(c), 'una sola abierta por cliente, atómico');
});
caso('#1152 Permisos, cierre y soporte: ajustes sólo del dueño, Trucho sólo admin, "Llegó a mano" no da OK, soporte adelantado sólo con IA', () => {
  assert.ok(/\/\^\\\/api\\\/admin\\\/advance-load\\\/config\$\/i,/.test(S), 'OWNER_ONLY_MUTATIONS');
  assert.ok(/req\.body\.close && req\.user\.role !== 'admin'\) return res\.status\(403\)/.test(S));
  assert.ok(/\['capArs', 0, 500000\]/.test(S) && /Math\.min\(6, Math\.max\(0, Number\(b\.forceHours\)/.test(S), 'topes acotados');
  assert.ok(/\['register', 'verify-phone', 'change-password'\]/.test(S) && /if \(u\.phoneVerified === true\) \{ add\(u\.phone\)/.test(S));
  const r = fn('_closeReconcile');
  assert.ok(/a\.status === 'verified' && !a\.movementId\) A\.mano\.push/.test(r) && /add\('adv_mano'[^\n]*adelantadasMano, -1/.test(r));
  const k = S.indexOf('function _closeCheck('), ck = S.slice(k, k + 6000);
  assert.ok(/\+ \(s\.adelantadasManoN \|\| 0\)/.test(ck));
  assert.ok(/const _comBase = Math\.max\(0,/.test(S) && /_advRecalcPending\.has\(k\)/.test(S));
  assert.ok(/const pre = \(!aiOn \|\| muted\) \? null :/.test(S) && /\['pending_review', 'paying'\]\.includes\(p\.status\) && mins <= 180/.test(S));
});
console.log(`\n${ok}/${total} casos OK`);
process.exit(ok === total ? 0 : 1);
