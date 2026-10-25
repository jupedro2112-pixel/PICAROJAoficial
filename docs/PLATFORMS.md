# PLATFORMS — Multi-plataforma de juego (Girox + Ganamos + …)

> Creado 2026-10-16 (WORKLOG #219). Cómo funciona la capa de plataformas, qué hace
> hoy, y el **checklist para conectar la API de Ganamos** cuando el owner tenga la doc.

## 1. Qué hace hoy (fase 1)

- El cliente transfiere → hgcash avisa → el comprobante matchea → **en vez de cargar
  directo, se le pregunta "🎮 ¿Dónde querés jugar?"** con un botón por plataforma
  habilitada (mensaje de sistema con `metadata.kind = 'platform_choice'`).
- **Elige Girox** → se acredita como siempre (misma `reference vip-hg-*`, mismo candado
  `HgcashCharge`, mismo bono automático).
- **Elige Ganamos** (sin API todavía) → NO se carga acá: se le manda el **link externo**
  configurado (default `https://www.ganamosvip.me`) con `/sys_platform_redirect` y el
  movimiento queda `redirected` (consumido, nadie lo carga por error). Se asume que esa
  página comparte la cuenta hgcash (recibe el mismo aviso por el reenvío de webhooks).
- **No responde** en `askTimeoutMin` (default 10) → `_platformChoiceTick` lo carga en la
  **última plataforma que eligió** (`User.lastPlatform`) o en la **default** (girox).
- El **agente** ve en el chat del panel un banner violeta "TRANSFERENCIA RECIBIDA —
  esperando que el cliente elija" con botones para elegir por él.
- La **carga manual** del panel tiene selector de plataforma (sólo plataformas con API
  conectada; con una sola queda oculto).
- Panel → **Configuración → "🎮 Plataformas de juego"**: habilitar/deshabilitar, nombre,
  emoji, link externo, modo de pregunta (`always` / `first_time` / `never`), espera
  máxima y default. Guarda sólo el admin general.

## 2. Archivos

| Archivo | Rol |
|---|---|
| `src/platforms/index.js` | Registro: `getAdapter(id)`, `listEnabled()`, `decideForDeposit(user)`, `resolveDefaultFor(user)`, `getSettings()/saveSettings()` (Config['platforms'], cache 30 s), `labelOf(id)`. |
| `src/platforms/girox.js` | Adaptador girox = envoltura fina de `giroxService` (+ `id`, `isConnected`, `capabilities`). |
| `src/platforms/ganamos.js` | **Esqueleto** de Ganamos con el mismo contrato. `isConnected()` = `GANAMOS_API_URL` + `GANAMOS_API_KEY` presentes. Sin eso, todo devuelve `not_configured`. |
| `src/platforms/jugaygana.js` | **Esqueleto** de JUGAYGANA (#378, copia del de Ganamos): `JUGAYGANA_API_URL` + `JUGAYGANA_API_KEY`; sin web pública por defecto (se carga en el panel). Mismo checklist que §4 cambiando el prefijo. |
| `server.js` | `_platformAskUser`, `_platformRedirectUser`, `_resolvePlatformChoice`, `_resolvePlatformChoiceMessage`, `_platformChoiceTick`, `_hgcashCreditToPlatform` (segunda mitad de `hgcashAutoCarga`), `_bonusMultiplierFor`, `_sendUserSystemMessage`; endpoints `GET /api/platforms`, `POST /api/platform-choice`, `POST /api/admin/hgcash/movements/:id/platform`, `GET /api/admin/users/:id/platform-pending`, `GET/POST /api/admin/platforms`. |
| `public/js/chat.js` | Render de los botones (`_renderPlatformWidget`), `choosePlatform`, `markPlatformChoiceResolved`. CSS en `public/css/chat.css` (`.plat-*`). |
| `public/adminprivado2026/` | `populateDepositPlatforms`, `loadPlatformBanner`, `agentChoosePlatform`, `loadPlatformsCfg/savePlatformsCfg`; etiquetas hgcash `awaiting_platform` / `redirected`. |

## 3. Contrato del adaptador

Mismos nombres y mismas formas de respuesta que `giroxService` (server.js los consume sin
mirar qué plataforma hay detrás):

```
id, defaultName, defaultEmoji, capabilities{deposit,withdraw,gift,depositBonus,stats,sso}
isEnabled() / isConnected()           → bool (env de la API presente)
getPlayUrl(), getBaseUrl(), validateUsername(u), ping(), getPlatformConfig()
createPlatformUser({username,password}) → {success, player} | {success:false, alreadyExists?}
getUserInfoByName(u)                    → {username, balance, available, locked, bonusLocked, wagering} | null
syncUserToPlatform({username,password}) → {success, alreadyExists} | {success:false, code:'username_taken_foreign'}
validateCredentials(u,p), changeUserPassword(u,p)
createSession(u)                        → {success, redirectUrl}
depositToUser(u, amount, desc, reference, wagering?) → {success, duplicate, data:{transfer_id, transferId, user_balance_after}} (+bonusFailed)
withdrawFromUser(u, amount, desc, reference)
creditUserBalance(u, amount, reference, {multiplier?})  (regalo: bono 0)  → + creditedAs
creditGift(u, amount, {description, reference, rolloverX})
claimPendingBonus(u, requirementId?)
getUserBalance(u, {fresh?}), getUserBalanceWithRetry(u, {...})
getPlayerStats(u, from, to), getPlayersStatsBatch([u], from, to), formatStatsDate(d)
getUserMovements()                      → not_supported
```

Reglas que TODO adaptador respeta (ARCHITECTURE §4.4 / §8): montos en **pesos** sin ×100;
`reference` = llave de idempotencia que viene del caller (estable y persistida); errores
como `{success:false, error:'<texto para el usuario>', code, httpStatus}`; env leída
**lazy** (nunca al require: SSM carga después).

## 4. Checklist para CONECTAR la API de Ganamos

1. **Env/SSM:** `GANAMOS_API_URL` (base sin barra final), `GANAMOS_API_KEY`, opcional
   `GANAMOS_PLAY_URL`, `GANAMOS_MAX_RPM`, `GANAMOS_TIMEOUT_MS`.
2. **`src/platforms/ganamos.js`:** ajustar la tabla `ENDPOINTS` (método + path por
   operación), `_headers()` (esquema de auth real) y los mapeadores `_mapPlayer`,
   `_mapMoney`, `_mapStats` a la forma REAL de las respuestas. Son los únicos lugares con
   supuestos. Si algo no existe en Ganamos, poner su `capabilities.*` en `false`.
3. **Reglas de username** (`validateUsername`) si difieren de girox.
4. **Deploy** → el boot loguea `🎮 Plataformas (...): 🎲 Ganamos → API conectada`.
   `GET /api/admin/platforms` muestra `connected:true` y la card del panel pasa a 🟢.
5. **Qué cambia solo al conectarse:** la elección "Ganamos" deja de mandar el link y
   acredita por API (misma `reference vip-hg-*`, candado `HgcashCharge.platform`); el
   selector de la carga manual la ofrece; `POST /api/withdrawal/request` acepta
   `platform:'ganamos'` y `_deductChipsAtConfirm` debita en Ganamos; el SSO
   (`POST /api/platform/session` con `platform:'ganamos'`) devuelve `redirectUrl` real.
6. **Probar:** carga manual chica desde el panel con plataforma Ganamos → Transaction
   con `platform:'ganamos'`; transferencia real → elegir Ganamos → acredita; retiro.
7. **Todavía sólo girox (fase 3, decidir con el owner):** reembolsos (semanal/mensual y
   acumulativo), VIP, rakeback, ruleta en plata, bonos de lote, referidos, bono de
   instalación. Hoy leen stats y acreditan con `girox.*` directo. Abrirlos por plataforma
   = resolver el adaptador por `Transaction.platform` / `User.lastPlatform` y sumar la
   plataforma a las `reference` (ej. `vip-rf-<pk>-<userId>-ganamos`) para que no choquen.

## 5. Modelo de datos

- `User.preferredPlatform` (#225): plataforma FIJA elegida en la app → `decideForDeposit` no pregunta
  (`reason:'preferred'`). `POST /api/platforms/preferred {platform|null}`.
- `User.lastPlatform` (string), `User.platforms` ({ ganamos: { status, username, syncedAt, error } }).
  La landing (`POST /api/landing/signup`, #224) crea el jugador en toda plataforma conectada.
- `Transaction.platform` (default `'girox'` → histórico sin migración).
- `BankMovement`: `matchStatus` suma `awaiting_platform` y `redirected`; campos `platform`,
  `platformAskedAt`, `platformChosenAt`, `platformChoiceBy` (`user` | `agent:<u>` | `timeout`
  | `single` | `never` | `first_time` | `manual_deposit`), `platformChoiceMsgId`, `redirectedUrl`.
- `Comprobante.bankMatchStatus` suma los mismos dos estados. `HgcashCharge.platform`,
  `PendingPayout.platform`.
- `Message.metadata`: `{kind:'platform_choice', movementId, amount, options[], expiresAt, chosen?}`
  o `{kind:'platform_link', platform, name, emoji, url}` o, desde #275, `{kind:'deposit_credited',
  platform, amount, bonus}` (botón "Jugar ahora" + cartel en la PWA) o, desde #283, `{kind:'install_gift_offer',
  amount, baseAmount, pct, expiresAt}` (oferta de carga GRATIS por instalar la app). El `GET /api/messages/:userId`
  proyecta `metadata`.
- Comandos editables: `/sys_platform_choice` (`${amount}`, `{options}`, `{timeout}`, `{default}`)
  y `/sys_platform_redirect` (`{platform}`, `{name}`, `{url}`, `${amount}`).

- **Clave (#226):** todo cambio de contraseña pasa por `syncPasswordToJugaygana` → girox + `_syncPasswordOtherPlatforms`
  (cada plataforma conectada recibe la misma clave; crea al jugador si no existe).

## 6. Trampas

- `hgcashConsumeOnManualDeposit` también consume movimientos `awaiting_platform` (si el
  agente carga a mano mientras el cliente no eligió, se cierra la pregunta).
- `_resolvePlatformChoice` hace claim atómico `awaiting_platform → claiming`: doble toque,
  agente + cliente a la vez o dos instancias no cargan dos veces.
- El cache de settings es por proceso (30 s): un cambio en el panel tarda hasta 30 s en
  verse en la otra instancia de EB.
- Con `redirected` NO hay Transaction local: la plata la carga la otra página. Si hubiera
  que cargarla acá igual, es carga MANUAL (el movimiento ya está consumido).
