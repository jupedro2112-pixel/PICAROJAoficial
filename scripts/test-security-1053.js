// #1053 Auditoría de seguridad de todo el sistema: los arreglos siguen en su lugar. Correr: node scripts/test-security-1053.js
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const N = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'notificationRoutes.js'), 'utf8');
let ok = 0, fail = 0;
function caso(n, fn) { try { fn(); ok++; console.log('✅ ' + n); } catch (e) { fail++; console.log('❌ ' + n + '\n   ' + e.message); } }
caso('Link de acceso: un depositor no lo genera para clientes que ya cargaron', () => assert.ok(/code: 'ADMIN_ONLY_FOR_DEPOSITORS'/.test(S)));
caso('Push masivas y plantillas: sólo el admin general (agentes: sólo /send a un cliente)', () => assert.ok(/decoded\.role !== 'admin' && req\.method !== 'GET' && req\.method !== 'HEAD' && !\/\^\\\/send\\\/\?\$\/\.test\(req\.path\)/.test(N)));
caso('Login por SMS sólo para clientes (los 3 accesos por código: login, verificación y reset; el de teléfono + clave pide la clave igual)', () => { const m = S.match(/User\.findOne\(\{ phone: normalizedPhone, phoneVerified: true(, role: 'user')? \}/g) || []; assert.ok(m.filter((x) => x.includes("role: 'user'")).length >= 3, m.join(' | ')); });
caso('Código temporal: 24 h y cuenta como intento fallido', () => { assert.ok(/getTime\(\) < 24 \* 3600000 \/\/ #965 → #1053/.test(S)); assert.ok(/_loginFail\(_lk\); \/\/ #1053: cuenta para el bloqueo/.test(S)); });
caso('El staff no ve el código temporal del cliente', () => assert.ok(/-pendingAccessCode -tokenVersion/.test(S)));
caso('Clave pública asd123 en cuenta con cargas: no entra y se anula', () => assert.ok(/code: 'DEFAULT_PASSWORD_REVOKED'/.test(S)));
caso('Bono que tipea el agente: tope único, sin secundarias/marcadas, agentes hasta 50%', () => { assert.ok(/if \(user\.duplicateOf \|\| _isFlagged\(user\) \|\| user\.isBlocked\) _agentBonus = 0;/.test(S)); assert.ok(/_agentBonus = await _capGift\(_agentBonus\)/.test(S)); });
caso('Bono de 1ª carga: reserva atómica (no se cobra dos veces)', () => { assert.ok(/firstDepositBonusAt: null \}, \{ \$set: \{ firstDepositBonusAt: new Date\(\) \} \}/.test(S)); assert.ok(!/source: 'first_deposit', label: `bono de bienvenida de la primera carga \(\$\{fp0?\}%\)`, revert: async \(\) => \{\} \}/.test(S)); });
caso('El modelo guarda firstDepositBonusAt (si no, Mongoose descarta el campo)', () => assert.ok(/firstDepositBonusAt: \{ type: Date, default: null \}/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'models', 'User.js'), 'utf8'))));
console.log(`\n${ok}/${ok + fail} casos OK`); process.exit(fail ? 1 : 0);
