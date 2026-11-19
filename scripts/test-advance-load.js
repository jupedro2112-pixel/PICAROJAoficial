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
  assert.ok(/const ref = 'vip-adv-' \+ c\.id;/.test(f) && /_depositWithBonus\(adapter, user\.username, amount, 'Carga automática \(adelantada\)', ref/.test(f), 'reference estable por _depositWithBonus');
  assert.ok(/'advance\.status': 'claiming', 'advance\.at': \{ \$lt:/.test(t) && /_advanceFinish\(c, u, false\)/.test(t), 'las reservas a medias se terminan con la misma reference');
  assert.ok(/cfg\.maxOpenArs > 0 && open \+ Number\(c\.amount\) > cfg\.maxOpenArs/.test(t), 'tope general de adelantos sin verificar');
  assert.ok(/metadata: \{ source: 'advance_hgcash', advance: true/.test(f) && /platform: pid/.test(f), 'Transaction con platform y marca de adelantada');
  assert.ok(/outboundWebhook\.notify\('carga'/.test(f) && /metaCapi\.track\('Purchase'/.test(f) && /_supportCloseAfterCharge\(/.test(f) && /maybeSendRecoveryMessage\(/.test(f), 'mismos avisos que toda carga');
});
caso('Verificación: sola cuando entra la transferencia (candado HgcashCharge), o a mano; el cliente queda de confianza y sus retiros se re-chequean', () => {
  const v = fn('_advanceVerify'), r = fn('_advanceReconcile');
  assert.ok(/ms\.length === 1 && await _advanceVerify/.test(r), 'sólo con UNA transferencia que coincide');
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
  assert.ok(/verdict === 'reject' && note\.length < 4/.test(S), 'No llegó pide motivo');
  assert.ok(/window\.advVerdict = advVerdict/.test(A) && /_advItemHtml\(c, fm, fd, chip\)/.test(A) && /_advPanelHtml\(j\.adv, fm, fd\)/.test(A));
});
caso('Soporte adelantado: la 1ª vez que pide una persona atiende la IA (retiro en proceso / "contame"); si no puede, pasa DIRECTO a un agente', () => {
  assert.ok(/kind: 'support_pre'/.test(S) && /_supportPayoutDiagnose\(userId\)/.test(S) && /!preRecent && !sentByBot/.test(S), 'pre-soporte una vez y nunca si lo mandó el bot al botón');
  assert.ok(/if \(r\.handoff && await _supportPreActive\(userId\)\) r = /.test(S), 'handoff directo tras el pre-soporte');
  assert.ok(/estamos validando|lo estamos validando/.test(S), 'retiro en proceso: "lo estamos validando y en breve sale"');
  assert.ok(/u\.askedHuman/.test(B) && /u\.bankDelay/.test(B), 'la IA sabe que pidió una persona y que el banco está con demoras');
});
console.log(`\n${ok}/${total} casos OK`);
process.exit(ok === total ? 0 : 1);
