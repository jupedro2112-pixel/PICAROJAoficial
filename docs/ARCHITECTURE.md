# ARCHITECTURE — Cómo funciona VIPCARGASANTINO

> Mapa arquitectónico para entender el repo y modificarlo sin romper nada.
> **No reemplaza leer el código** del área puntual que vayas a tocar — el código es la
> verdad y este doc puede quedar viejo. Si encontrás algo desactualizado acá, corregilo
> (regla permanente en CLAUDE.md: este doc se actualiza junto con WORKLOG.md).
>
> Última actualización: **2026-10-16** — MULTI-PLATAFORMA (#219): capa `src/platforms/` (girox +
> esqueleto de Ganamos), pregunta "¿dónde querés jugar?" en la auto-carga, derivación por link a la
> plataforma sin API, `platform` en Transaction/PendingPayout/BankMovement (§2, §4.10, §5 AUTO-CARGA,
> §7, §9; detalle operativo en `docs/PLATFORMS.md`). Antes: 2026-10-07 — hgcash desde el panel: credenciales cifradas
> (panel > SSM, firma del webhook: solo el secreto del panel si hay uno (#216)) y reenvío de avisos
> configurable (§5 AUTO-CARGA, §9). Antes: 2026-09-30 — lotes: tope del % en textos, `useHours` (bono
> canjeado vence a las 24 h), resumen por lote (§2 NotifBatch). Antes: 2026-09-18 — bonos AUTOMÁTICOS en la carga con tope
> (`resolveAutoBonus`, `src/utils/bonusCap.js`), registro manual sin bienvenida, ruleta
> diaria con premios configurables (§2, §5, §8, §9). Antes: 2026-09-11 — reembolso ACUMULATIVO de por vida sobre plata
> real (ESPEC-REEMBOLSO-1GIROX, réplica de la gemela): §2 (CashbackClaim + campos
> cashback* de User), §4.4 (reference vip-cbk), §4.5 (creditGift con rollover), §4.6
> (`bonus.granted` del /stats), §5 (flujo nuevo + el período descuenta el bono
> otorgado), §9 (trampas). Antes: 2026-09-07 (regalos como bono 0), 2026-08-03 — niveles VIP por apostado acumulado (réplica de
> Stake): §2 (VipWagerMonth + campos User), §4.4 (references vip-lvl/vip-rake), §4.6
> reescrita (el scraping del panel se ELIMINÓ en la v1.9 — ahora stats por username con
> la Partner API), §4.8 (envs VIP_*, se fueron las GIROX_ADMIN_*), §5 (flujo VIP +
> reembolsos corregido), §7 (crons VIP).
> Antes: 2026-07-31 — migración JUGAYGANA → 1girox (§4, flujos de plata de §5, trampas).
> Lectura integral previa: 2026-07-09 (server.js completo, 28 modelos, servicios, PWA y
> panel). Los números de línea derivan con cada cambio — usalos como referencia
> aproximada y confirmá con grep.

Índice:
1. Visión general del negocio
2. Modelos de datos y relaciones
3. Ciclo de request / autenticación / roles
4. Integración 1girox (Partner API + panel de reportes)
5. Flujos principales (paso a paso)
6. Front-end: PWA cliente y panel admin
7. Motores automáticos / crons
8. Convenciones importantes
9. Trampas / "no rompas esto"

---

## 1. Visión general del negocio

Sala de juegos para Argentina que es un **wrapper sobre 1girox** (plataforma de juego
externa; Partner API REST/JSON, panel de administración `admin.1girox.com`, web del
jugador `1girox.com`). Hasta el 2026-07-31 la plataforma era **JUGAYGANA**
(`admin.agentesadmin.bet` / `jugaygana44.bet`) — ver §4 para la migración.
El sistema VIPCARGAS:
- Capta jugadores (pauta/publicistas/referidos/orgánico) y los crea en 1girox por API.
- Gestiona **cargas** (manuales por agente, o AUTOMÁTICAS vía banco hgcash + IA de
  comprobantes) y **retiros** (self-service con confirmación de agente y pago
  automático por hgcash).
- Da **reembolsos** sobre la pérdida real/NETWIN (DIARIO desde #349 2026-10-17 · semanal/mensual — el diario se había
  eliminó el 2026-08-07), **ruleta
  diaria**, **fueguito** (racha), **bono instalación $5.000**, **referidos** (5% desde #351 — antes 8% — de
  netwin → owner-revenue, y 7% de eso al referidor) y **campañas/publicistas** con
  sub-atribución por influencer.
- El "saldo real" del jugador vive en 1girox; VIPCARGAS guarda atribución, bonos,
  reclamos y el registro permanente de transacciones.
- Al casino se entra por **login único (SSO)**: el botón CASINO pide un link de acceso
  de un solo uso — el cliente ya no tipea usuario ni contraseña de la plataforma.

UX del cliente: PWA (`public/`) con chat en vivo (Socket.IO) + push (FCM). Los
agentes operan desde `public/adminprivado2026/`. Deploy: AWS Elastic Beanstalk
(posible multi-instancia → Redis para socket.io adapter, rate-limits y locks).
Secrets desde AWS SSM cargados async en el bootstrap (final de server.js).

## 2. Modelos de datos y relaciones (`src/models/`)

Todos los modelos canónicos viven en `src/models/`. `config/database.js` los
re-exporta (NO los redefine, salvo **ExternalUser** y **UserActivity** que son
exclusivos suyos) y es el `connectDB` REAL que usa server.js (TTL de mensajes con
autorreparación de índice). `src/models/index.js` tiene OTRO connectDB con las
migraciones de índices de referidos — **NO se usa desde server.js** (solo exporta
modelos); sus migraciones corren únicamente si algo llamara a ese connectDB.

### Núcleo
- **User** — jugadores y staff. Claves: `id` (uuid string — casi todo el código usa
  `id`, NO `_id`), `username` + **`usernameLower`** (copia indexada para búsquedas
  case-insensitive; la mantiene un pre-save + backfill en cada arranque — ver
  `findUserByUsernameCI`), `password` (bcrypt vía pre-save), `role`, `phone` +
  **`phoneKey`** (clave normalizada para unicidad — quita país/0/9 AR), `phoneVerified`,
  `phoneVerificationPending` (bloquea SOLO retiros), `mustChangePassword` (bloquea casi
  todo vía authMiddleware), `tokenVersion` (revocación de sesiones), `isBlocked`/
  `blockReason`. **1girox:** `giroxUserId` (ID numérico del jugador — desde la v1.9 lo
  devuelve el propio `stats` y se persiste "gratis"; ya no bloquea nada, todo va por
  username), `giroxSyncStatus`
  (`pending|synced|linked|error|invalid_username|not_applicable`), `giroxSyncError`,
  `giroxPasswordSynced` (la clave local es bcrypt irrecuperable: los migrados se crearon
  con clave random y la real se replica en el próximo login). Campos `jugaygana*`
  (`jugayganaUserId/Username/SyncStatus/SyncError`) y `source:'jugaygana'` **se conservan
  intactos para poder revertir** — ya no se usan para operar. FCM: `fcmToken` legacy + `fcmTokens[]`
  (multi-dispositivo, `context:'standalone'` = PWA instalada). Atribución:
  `acquisitionCampaign/Source/Influencer/Utm`, `createdByEmployeeId`. Referidos:
  `referralCode`, `referredByUserId`. Meta: `metaFbc/metaFbp/landingUrl`.
  Anti-multicuenta: `registrationIp/UserAgent`. Panel: `tags[]`, `adminNotes`,
  `tagHistory`. **VIP:** `lifetimeWagered` (cache de la suma de VipWagerMonth, sólo se
  actualiza con `$max`), `vipLevel` (0 = sin nivel; NUNCA baja; se avanza recién
  DESPUÉS de acreditar el bono del nivel), `vipLevelUpdatedAt`. Otros:
  `installBonusClaimed`, `notificationPlan`, `notifMonthlyCounts`,
  `loginWithoutPassword`, `withdrawalAccount`, `pendingAccessCode`. **Multi-plataforma (#219):**
  `lastPlatform` (última elegida al cargar; fallback del timeout) y `platforms` (estado de la cuenta
  en cada plataforma ≠ girox).
- **Transaction** — registro PERMANENTE (sin TTL). `type`: deposit|withdrawal|bonus|
  refund|transfer|referral_commission|fire_reward|rakeback|vip_levelup|roulette
  ('roulette' desde 2026-09-07: antes el premio de la ruleta no escribía
  Transaction). `metadata.creditedAs` ('bonus'|'deposit') guarda cómo salió el
  regalo de verdad en 1girox.
  `metadata.source` distingue regalos ('install_bonus','welcome_gift') y devoluciones
  ('payout_refund') que se EXCLUYEN de los reportes de carga real. **Fuente de toda la
  analítica.** `platform` (default 'girox', #219) = plataforma donde se movió la plata.
- **VipWagerMonth** — apostado de casino de un usuario en un mes calendario (ART).
  Base del acumulado VIP (`User.lifetimeWagered` = suma de estos buckets). Único por
  `userId+monthKey`; el motor SIEMPRE escribe con `$set` (nunca `$inc`) → recalcular
  es idempotente y multi-instancia-safe. `closed:true` = mes terminado y recalculado
  completo (no se vuelve a consultar a la plataforma).
- **Message** — chat. **TTL 3 días** (índice sobre `timestamp`, autorreparado en
  connectDB). `senderRole` define el lado; `adminOnly:true` = solo lo ven admins;
  `metadata.kind:'welcome'` = throttle de bienvenida.
- **ChatStatus** — estado de conversación (open/closed/payments/comunidad + category
  cargas/pagos). Se crea recién con ACTIVIDAD del usuario (welcome o primer mensaje),
  no al crear la cuenta. Lleva el reloj SLA (`pendingSince/Preview/Type`).
- **ChatDelay** — snapshot permanente de demoras de atención que superaron el umbral
  (sobrevive al TTL de Message). Umbrales: cargas 2min / pagos 30min (configurables).

### Plata / banco automático (hgcash)
- **BankMovement** — cada movimiento que hgcash notifica por webhook. `matchStatus`:
  pending→claiming→shadow_matched|auto_charged|manual_charged|needs_review|duplicate|
  error|ignored|**awaiting_platform** (esperando que el cliente elija dónde jugar, #219)|
  **redirected** (eligió una plataforma sin API → se lo mandó al link; consumido). Dedupe por
  `movementId` único. Campos `platform`, `platformAskedAt/ChosenAt/ChoiceBy`, `platformChoiceMsgId`,
  `redirectedUrl`.
- **Comprobante** — cada imagen que la IA (Claude vision) clasificó como comprobante.
  `dedupeKey` (N° operación normalizado, descartando CBU/CUIT) + `imageHash` (SHA-256)
  para detectar reutilización. `bankMatchStatus` para la auto-carga.
- **HgcashCharge** — candado de idempotencia de la carga automática: índice único por
  `chargeKey` (coelsaCode) — la MISMA transferencia se acredita UNA sola vez entre
  instancias. Si la carga falla en 1girox, el registro se BORRA para permitir retry
  (el retry manda la misma `reference`, así que no puede duplicar del otro lado).
- **PendingPayout** — retiro self-service pendiente de que un agente confirme.
  `deductAtPay:true` (flujo actual) = las fichas se descuentan AL CONFIRMAR, no al
  solicitar. `debitConfirmed` = verificación anti-retiro-fantasma (el saldo tiene que
  haber bajado de verdad). `status`: pending_review→paying→paid|failed|cancelled.

### Captación / marketing
- **Campaign** — publicista/pauta. `code` inmutable (va en la URL). **`giroxApiKey`**
  (`select:false`, texto plano, formato `pk_...`) = la cuenta del publicista en 1girox:
  una key sola reemplaza al par usuario+contraseña de sub-agente que había en JUGAYGANA
  (la jerarquía la define la key). **`hasGiroxKey`** es el espejo booleano SIN
  select:false para que el listado del panel muestre el badge sin traer el secreto —
  mantenerlo en sincronía en TODOS los caminos que escriben o limpian la key. Los campos
  `jugayganaUsername/jugayganaPassword` quedan para revertir. También `influencers[]`
  (lista fija para sub-atribución analítica).
  **⚠️ RUTEO POR DUEÑO (2026-08-05):** la key MASTER NO ve por Partner API a los
  jugadores creados bajo un sub-agente. `User.giroxOwnerCampaign` marca la campaña
  dueña (se setea en el alta del publisher_admin con key OK) y `giroxService` firma
  TODAS las operaciones de ese jugador con la key de esa campaña (keyResolver
  inyectado desde server.js, cache 60s; el batch de stats se agrupa por key).
  Consecuencia: las cargas a esos jugadores salen del SALDO del sub-agente en
  1girox — mantenerlos fondeados.
- **CampaignClick** (TTL 90 días), **InfluencerStory** (placement con costo; la
  atribución de registros es por VENTANA HORARIA calculada a demanda en
  publisherAnalyticsService).
- **Referral**: ReferralEvent (atribución, 1 por referido), ReferralCommission
  (cálculo por período `YYYY-MM`, con liquidación INCREMENTAL/delta —
  `settledOwnerRevenue`), ReferralPayout (pagos, soporta múltiples por período).

### Notificaciones / retención
- **NotificationRule** (+ Suggestion con approval-gate 48h, + NotificationHistory con
  tracking de ROI), **NotifTemplate** (tipos: invitacion|regalo|reembolso — bono_50/100
  ELIMINADOS), **ScheduledNotif** (once/daily/weekly, worker cada 60s), **PromoBonus**
  (bono de carga vigente ≤30%, 1 sola carga, cap de LECTURA a 30% en
  `_getActivePromoBonus` — los bonos de LOTE `sourceRuleCode:'lote'` están EXENTOS
  del cap y pueden ser de $ FIJO vía `montoFijoARS`), **BonusStrategyConfig** +
  **StrategyEnrollment** (estrategia por voto de encuesta — APAGADA),
  **EncuestaVote/EncuestaFire** (motor encuesta — bonos apagados),
  **InactividadFire** (motor inactivos — APAGADO).
- **NotifBatch** (2026-08-10) — LOTE de notificaciones con regalo enviado por un
  agente (roles admin|depositor; withdrawer solo lee el historial): audiencia
  (`audienceType`: 'list' usernames pegados / 'inactive' sin login ≥ N días con
  cupo opcional, los más recientes primero / 'all' lote completo — tope de
  sanidad 20k) + regalo (`percent` próxima carga o `fixed` $) + `validHours`
  (1-168). **El envío lo hace un MOTOR reanudable** (`_processNotifBatchQueue`,
  cron 45s + kick al crear): cada destinatario arranca `delivery:null` y se
  procesa con CLAIM ATÓMICO ($elemMatch delivery:null → 'sending' via
  findOneAndUpdate con proyección posicional) → deploy/reinicio a mitad de lote
  se retoma solo ('sending' colgado >10 min se recupera) y dos instancias EB
  nunca duplican a nadie. El PromoBonus del modo window también lo crea el
  motor (idempotente por promoBonusId). `sendDone:true` cuando no quedan
  pendientes.
  Modo **'code'**: el código (uppercase, exclusivo del lote, sin colisión con el
  código de bienvenida ni con otro lote activo) se canjea en la PWA por el MISMO
  endpoint `/api/community-code/claim` (los lotes se chequean PRIMERO vía
  `_tryClaimNotifBatchCode`; quien no está en el lote recibe "código no válido").
  Modo **'window'**: el bono se activa a todos al enviar. El bono es un
  **PromoBonus** con `expiresAt` del lote → cartel verde del chat + "Marcar usado"
  existentes — **EXCEPTO fichas (`fixed`)**, que SIEMPRE se acreditan
  automáticas como bono girox (por código: al canjear; por tiempo: al enviar,
  las acredita el motor) vía `_creditNotifBatchGift` (`creditUserBalance` con
  `multiplier=rolloverX` del lote validado contra `bonus.multipliers`;
  reference idempotente `vip-nbatch-{batchId}-{userId}`; auto-claim v1.7;
  Transaction `source:'notif_batch'`). **Candados anti-abuso** en toda
  acreditación: topes por usuario cruzando lotes (3 créditos/24h,
  $300k/7d — constantes `NOTIF_BATCH_USER_MAX_*`) → bloqueo + ALERTA URGENTE
  (log ERROR, nota admin-only, socket `security_alert` → toast rojo en el
  panel); guard bono-sobre-bono; fallos transitorios reintentan solos (el
  recipient queda 'sending' y vence a los 10 min); lo no acreditado queda en
  `recipients[].creditError`. **Código PÚBLICO** (`isPublic:true`,
  `audienceType:'public'`): sin destinatarios ni envío (se sube a Telegram/
  redes a mano) — CUALQUIER role:user canjea una vez (append atómico a
  recipients con cupo opcional `maxClaims` vía `$expr $size`), misma mecánica
  de regalo y topes. Envío: Message de chat + `sendPushIfOffline` por destinatario, EN
  SEGUNDO PLANO (la respuesta HTTP no espera); la entrega queda en
  `recipients[].delivery` ('socket'|'push'|'none'|'error') y el canal en
  `recipients[].channel` ('app'|'browser'|'none', misma clasificación que el badge
  del chat). Endpoints: `POST /api/admin/notif-batches` (+ `/preview`),
  `GET /api/admin/notif-batches` (+ `/:id` con estado del bono por usuario, leído
  del PromoBonus). Panel: cards "🎁 Lote con regalo" y "📤 Lotes enviados" en
  Notificaciones. El depósito con bonus marca el PromoBonus activo como usado
  automáticamente (ya existía), aplica también a los de lote.
- **Lotes con regalo — réplica #172/#173 del gemelo (2026-09-30, #212):** `NotifBatch.useHours`
  (default 24): en modo 'code' con %, el PromoBonus vence a `canje + useHours` (en 'window'
  sigue el `expiresAt` del lote). El % de lote lo aplica `resolveAutoBonus` con el tope de
  `bonusCap` vía `_loteBonusAmount`; `_loteCapTxt` arma " (X% hasta $20.000, el resto al
  20%)" para la nota interna, el texto al cliente (`_giftLabelOf`) y el cartel verde del
  chat (`capTxt` de `GET /api/admin/promo-bonus`). `PromoBonus.usesCount/usesTotalBonus`
  registran la carga que lo usó (los setea `settle()` al aplicar, `revert()` los limpia) y
  alimentan el resumen por lote: `GET /api/admin/notif-batches` (usados/activos/vencidos/
  bonoTotal) y `GET /:id` (vencimiento lazy + `outcome` used|active|expired|cancelled +
  `summary`). Código ajeno a la lista → "Este código no es para tu cuenta". **#295:** ahora SÍ hay
  `applyMode` ('auto'|'agent'), `applyScope` ('first'|'all'), `applyFrom/applyTo` (franja HH:mm AR,
  `_inDailyWindowAR`), `giftType:'none'` (sólo aviso) y audiencia `depositors` (cargadores recientes);
  los campos se copian al PromoBonus y `claimPromoBonusPercent` los respeta (agent → no se suma solo;
  fuera de franja → no se suma y sigue activo; all → `$inc usesCount`, no se marca usado). Antes (#210)
  el % de lote era siempre automático y de una sola carga.
- **DailyRouletteSpin** — 1 giro/día (índices únicos userId+dateKey y
  username+dateKey). Auto-crédito en 1girox; `credit_failed` → retry desde panel.
  v2 (2026-09-18): `prizeType` cash|percent|none, `prizePct`, `rolloverX`, status
  `percent_pending`. Los premios viven en `Config['dailyRoulette']` (panel). El % ganado
  queda en `User.dailyRoulettePendingPct/Label/WonAt` hasta que lo consume una carga.
- **CashbackClaim** (2026-09-11) — reclamo del **reembolso ACUMULATIVO de por vida**
  (ESPEC-REEMBOLSO-1GIROX §3/§4, ver §5). Índice ÚNICO `userId+dateKey+seq` (**no
  quitar**): el reintento tras un fallo reusa el `seq` → misma reference
  `vip-cbk-<userId>-<día>-<seq>` → la plataforma dedupe. `status` pending|credited
  (los pending cuentan como cobrado), `creditedAs` bonus|deposit. En **User** viven
  `cashbackAnchorAt` / `cashbackCarryNet` / `cashbackCarryGranted`: acumulador
  PLEGADO del neto de por vida (la API admite 92 días por consulta: tramo vivo > 85
  días → se consolidan 60 en el carry con update atómico condicionado al ancla).
- **Datos 2.0** (2026-08-10, sin modelo nuevo): `GET /api/admin/datos2?days=7..90`
  — análisis por COHORTES: cada día ART es la camada de Users registrados ese
  día; por camada: % con 1+/2+/3+ cargas reales (type deposit sin
  payout_refund), $ depositado, $/nuevo y retención D1/3/7/14/30 (última carga
  ≥ x días post-registro; cohortes sin esa edad → null, el panel muestra "—")
  + breakdown por `acquisitionCampaign` (pauta) vs creados-por-agente vs
  orgánico. Sección "📊 Datos 2.0" del panel (`loadDatos2`, admin.js). Distinta
  de "Datos" (métricas del período) y de publisherAnalytics (por publicista).
- **Review** (1 por user, moderada), **OtpCode** (TTL 5 min, hash bcrypt, 3 intentos),
  **FbAdsWebhookQueue** (cola de reintentos al sistema externo fb-ads),
  **RefundClaim** (índice único userId+type+periodKey contra doble cobro),
  **FireStreak** (racha fueguito + premios pendientes), **Config** (key/value: cbu,
  hgcash, refundPercents, fireMilestones, flags de migración one-shot, etc.),
  **Command** (comandos `/...` y mensajes automáticos `/sys_*`, `isSystem:true`).

## 3. Ciclo de request / autenticación / roles

- `authMiddleware` (server.js ~L2497): JWT del header `Authorization: Bearer` o de la
  cookie httpOnly `admin_api_session` (el panel usa cookie). Valida firma HS256, busca
  el User por `id` con select mínimo (`AUTH_USER_FIELDS` — ⚠️ si un chequeo nuevo
  necesita otro campo, sumarlo ahí), chequea isActive/isBlocked/`tokenVersion`.
  publisher_admin: lockdown contra `PUBLISHER_ADMIN_ALLOWED_PATHS`. mustChangePassword:
  solo deja pasar `MUST_CHANGE_PASSWORD_ALLOWED_PATHS` (admins se auto-limpian).
- Middlewares de rol: `adminMiddleware` (admin/depositor/withdrawer/comunidad),
  `depositorMiddleware` (admin/depositor/comunidad), `withdrawerMiddleware`
  (admin/withdrawer), `publisherAdminMiddleware`. Acciones sensibles re-chequean
  `req.user.role === 'admin'` explícito (patrón obligatorio — ver #80).
- **`src/middlewares/auth.js` es OTRO sistema de auth** (access 15m + refresh 7d,
  blacklist EN MEMORIA no compartida entre instancias) usado SOLO por las rutas de
  referidos. Lazy getters de JWT_SECRET (SSM carga después del require).
- Secrets: `loadSecretsFromSSM()` en el bootstrap async → NUNCA leer secrets al
  require; leerlos en runtime.
- Cookies admin: `admin_session` (Path=/adminprivado2026) + `admin_api_session`
  (Path=/api), 8h, SameSite=Strict. `GET /api/admin/me` revalida la cookie contra DB
  y devuelve un token fresco para Socket.IO.
- Rate limiting: `generalLimiter` 300/min (keyed por cookie de sesión admin o IP; en
  memoria), `authLimiter` 10/min y `sensitiveLimiter` 10/15min (Redis compartido con
  fallback a memoria — `RedisBackedRateStore`), `smsIpLimiter`/`bulkSmsIpLimiter`/
  `registerIpLimiter` (Redis INCR+EXPIRE con fallback), `platformSessionLimiter`
  (SSO al casino: 20 cada 5 min **por userId, no por IP** — con el CGNAT de las
  telefónicas argentinas limitar por IP dejaría barrios enteros compartiendo cupo;
  además protege el presupuesto de 60 req/min de la Partner API).
- Socket.IO (~L7488): `authenticate` revalida contra DB (isActive/isBlocked/
  tokenVersion). Rooms: `admins`, `user_<id>`, `chat_<id>`. Maps `connectedUsers`/
  `connectedAdmins`. Entrega con ack-timeout 3s → fallback push FCM (socket fantasma).

## 4. Integración 1girox (Partner API + panel de reportes)

Migración hecha el **2026-07-31**. Los archivos de JUGAYGANA (`jugaygana.js`,
`jugaygana-movements.js`, `src/services/jugayganaService.js`,
`jugayganaPublisherSessions.js`, `referralRevenueService.js`,
`jugayganaUserLinkService.js`) **siguen en el repo pero NINGÚN código los importa** —
server.js los sacó de sus requires (~L428 hay una lápida explicando dónde vivían).
Quedan sólo para poder revertir; se borran más adelante. **No los uses para nada nuevo.**

### 4.1 Los módulos vivos

| Módulo | Usa | Para qué |
|---|---|---|
| `src/services/giroxService.js` | server.js (`girox.*`), migración | **Cliente ÚNICO de la Partner API.** Altas (`createPlatformUser`, `syncUserToPlatform`), consulta (`getUserInfoByName`, `getUserBalance(WithRetry)`), credenciales (`validateCredentials`, `changeUserPassword`), SSO (`createSession`) y plata (`depositToUser`, `withdrawFromUser`, `creditUserBalance`). Auth por header `X-Api-Key`. Rate limit + reintentos propios. |
| `src/services/giroxUserLinkService.js` | reembolsos, referidos | `resolveGiroxUserId(userId, username)` — lee `User.giroxUserId` y, si falta, lo backfillea al vuelo (match EXACTO del nombre, doble verificación). (🪦 `giroxReportsService.js` — el que scrapeaba netwin del PANEL — se ELIMINÓ el 2026-07-31 con la v1.9: el netwin sale de `getPlayerStats` de la Partner API, ver §4.6.) |
| `src/services/giroxPublisherKeys.js` | publisher_admin create-user, panel | Alta de jugadores con la **API key de la campaña** (`Campaign.giroxApiKey`). `createUserAsPublisher`, `testKey`. `invalidateSession()` quedó como **no-op** (no hay sesiones que tirar). |
| `src/utils/periodRanges.js` | reembolsos, fueguito | Rangos hoy/semana pasada/mes pasado en hora Argentina. Eran funciones de `jugaygana.js`; son PURAS y se movieron acá para que el cliente viejo se pueda borrar. (La de "ayer" se eliminó junto con el reembolso diario, 2026-08-07.) **No tocar los strings de fecha: alimentan los `periodKey` de RefundClaim.** |
| `scripts/migrate-users-to-girox.js` | one-shot manual | Migración de la base de usuarios (ver §4.7). |

### 4.2 Qué DESAPARECIÓ (el doc viejo insistía con estas cosas)

- ❌ **Los ×100 de centavos.** 1girox trabaja en **PESOS** (admite 2 decimales).
  Multiplicar por 100 en cualquier lado sería cargar 100 veces de más.
- ❌ **Las 4 sesiones independientes / `ensureSession` / mutex de login / pool por
  publicista.** No hay login: la auth es un header `X-Api-Key` fijo. No hay token que
  venza ni sesión que invalidar → un cambio de key desde el panel tiene efecto
  inmediato en TODAS las instancias (con JUGAYGANA cada instancia de EB cacheaba su
  propio pool y sólo se invalidaba la que atendía el PUT: era un bug real).
- ❌ **El HTML de Cloudflare.** La Partner API responde JSON siempre (se pide con
  `Accept: application/json`). Ya no hace falta `isHtmlBlocked()` ni el tri-estado
  found/not_found/error de `lookupUserOrError`. **Ojo:** el PANEL de reportes SÍ está
  detrás de Cloudflare y su cliente conserva la detección de HTML.
- ❌ **`jugayganaUserId` como llave de las operaciones de plata.** Todo va por
  `username`. El ID numérico ahora sólo existe para los REPORTES (ver §4.6).

### 4.3 Rate limit — 60 req/min POR KEY ⚠️ y POR INSTANCIA

La Partner API permite **60 requests por minuto POR API KEY** (confirmado por
soporte de 1girox, 2026-08-15; prometieron subirlo a 180) y devuelve 429 al
pasarse. `giroxService` tiene un limitador local de ventana deslizante **por
key**: `GIROX_MAX_RPM` (default **55**) por cada key usada (master, consultas,
publicistas). Si hay que esperar más de 30s por un lugar en la ventana, falla
rápido con `rate_limited_local` en vez de colgar la request.

**Pool de keys de consultas (`GIROX_API_KEY_CONSULTAS`, opcional, 2026-08-15):**
una o VARIAS keys del MISMO agente que la master, separadas por coma. Si están,
las lecturas de stats (`getPlayerStats` / `getPlayersStatsBatch` → reembolsos,
VIP, referidos, datos) que irían por la master firman con la key del pool con
más lugar libre en el minuto (`_pickReadsKey`), y el tráfico de fondo no
compite con cargas/retiros/SSO. Sin la env, todo va por la master como
siempre. Las keys de PUBLICISTA no se reemplazan nunca (cada una es la única
que ve a sus jugadores).

Como la plataforma puede tener límites DISTINTOS por key (2026-08-15: subió a
180 solo algunas), cada entrada acepta sufijo **`:rpm`** con su techo local
POR INSTANCIA — ej. `pk_aaa:90,pk_bbb:30` (regla: límite de esa key ÷ N
instancias). Sin sufijo, usa `GIROX_MAX_RPM` (el techo de la master). Las keys
de PUBLICISTA tienen techo propio `GIROX_PUBLISHER_MAX_RPM` (default 30 =
60÷2 instancias) — no heredan el de la master, que desde 2026-08-15 corre en
180/min (GIROX_MAX_RPM=90). Un publicista puntual con más volumen puede tener
su override con `GIROX_PUBLISHER_KEY_RPM` (`pk_x:90,...`, 2026-08-16). La
radiografía del boot muestra todo:
`[girox] config: … keys consultas cargadas: 2 (techos 30, 30/min) ·
GIROX_MAX_RPM=90 · publicistas=30 (default)/min · cache jugador=8000ms`.

**Cache corto de saldo (2026-08-16):** `getUserInfoByName` (por donde pasan
TODAS las lecturas de saldo — `getUserBalance` la usa) tiene un cache por
username (`GIROX_PLAYER_CACHE_MS`, default 8s) + coalescing de llamadas en
vuelo. Sin esto, el poll de saldo de la PWA (cada 90s por usuario) + los guards
de bono + el status saturaban la key del publicista (30/min) — era la causa
raíz del lag. Solo cachea lecturas exitosas; se invalida en cada operación de
plata del usuario (deposit/withdraw/bonus/claim), así toda lectura post-cambio
es fresca. El DÉBITO real lo valida girox server-side; el cache es solo lectura.

⚠️ **El limitador local es POR PROCESO.** En AWS EB con N instancias el techo
real es N×GIROX_MAX_RPM por key, así que el 429 sigue siendo posible. Por eso
además se reintenta respetando el header `Retry-After`. Con 2 instancias,
`GIROX_MAX_RPM` = (límite por key)/2: **30** con el límite actual de 60, **90**
si lo suben a 180.

La misma cuota la comparte el script de migración: mientras corre, producción
sigue pidiendo saldos, cargas y retiros contra el mismo cupo de la master.

### 4.4 Idempotencia por `reference` — LA REGLA DE ORO

Cada operación de plata (deposit / withdraw / bonus) lleva una `reference` de hasta
**100 caracteres** que es su llave de idempotencia. Si se repite, 1girox NO vuelve a
mover plata: responde `duplicate:true` con los datos de la operación original.

**Regla de oro: ante timeout o error de red, reintentar SIEMPRE con la MISMA
reference.** Nunca generar una nueva para el mismo pago.

Una reference mal elegida rompe plata **en las dos direcciones**:
- Si **se repite entre operaciones distintas** → la segunda vuelve `duplicate:true` y
  el cliente **NO cobra** (parece exitosa: hay que mirar el flag).
- Si **cambia entre reintentos del mismo pago** → se paga **dos veces**.

Corolario: la reference tiene que salir de algo **estable y persistido** (un id de
Transaction generado ANTES de llamar, el periodKey del reembolso, el id del movimiento
bancario). `giroxService` genera una al vuelo si no se le pasa ninguna, pero **loguea
un warning**: eso cubre sólo los reintentos internos de esa llamada, no un reintento
del usuario o del agente.

Prefijos en uso hoy:

| Prefijo | Flujo | De dónde sale |
|---|---|---|
| `vip-dep-<txId>` | Carga manual del agente | uuid generado antes de llamar y reusado como `Transaction.id` |
| `vip-depbonus-<txId>` | Bonificación de esa misma carga | ídem (Transaction del bonus) |
| `vip-wd-<txId>` | Retiro manual del agente | ídem |
| `vip-sdep-<uuid>` | `POST /api/movements/deposit` (self-service) | uuid al vuelo |
| `vip-swd-<uuid>` | `POST /api/movements/withdraw` (self-service) | uuid al vuelo ⚠️ sin persistir: no protege contra un reintento del cliente |
| `vip-bonus-<txId>` | Bono manual desde el panel | uuid reusado como Transaction.id |
| `vip-rf-<periodKey>-<userId>` | Reembolsos | **derivada del PERÍODO, no del RefundClaim.id** (ver abajo) |
| `vip-hg-<coelsa\|movementId>` | Auto-carga hgcash | identificador del MOVIMIENTO bancario (el mismo `chargeKey` del candado) |
| `vip-roulette-<spinId>` | Premio de ruleta | id del DailyRouletteSpin |
| `vip-fire-<userId>-d<día>-<fecha>` | Premio de fueguito | userId + hito + día ART |
| `vip-install-<userId>` | Bono instalación $5.000 | userId (una sola vez en la vida) |
| `vip-payout-<payoutId>` | Débito al confirmar un retiro | PendingPayout.id |
| `vip-payoutref-<payoutId>` (+ `-chips-` / `-bonus-`) | Devolución de retiro rechazado | PendingPayout.id |
| `vip-refcom-<payoutId>` | Comisión de referidos | ReferralPayout.id (uuid persistido en Mongo ANTES de llamar; si un intento anterior quedó pending/failed se REUSA el documento ⇒ misma reference) |
| `vip-lvl-<userId>-<idx>` | Bono por alcanzar un nivel VIP | userId + índice del nivel (cada nivel se paga UNA vez en la vida; por eso NO se pueden reordenar los idx de vipLevels.js) |
| `vip-rake-<fromDateStr>-<userId>` | Rakeback semanal VIP | lunes de la semana reclamada + userId (derivada del PERÍODO, igual que los reembolsos y por el mismo motivo) |
| `vip-welcome-<userId>` | Bono sorpresa del código de bienvenida (tipo cash) | userId (uno por cuenta para siempre, como el de instalación) |
| `vip-igift-<userId>` | Carga GRATIS por instalar la app (#283, ofrecida en la 1ª carga) | userId (una vez en la vida; Transaction `install_gift`) |
| `vip-cbk-<userId>-<día>-<seq>` | Reembolso ACUMULATIVO de por vida | userId + día ART + `seq` del índice único de CashbackClaim (un fallo borra el doc y el reintento recalcula el MISMO seq ⇒ misma reference) |

⚠️ **Por qué la del reembolso sale del período y no del id del claim** (`_refundReference`,
server.js ~L6086): si la acreditación falla, el handler BORRA el RefundClaim para que el
usuario pueda reintentar, y el reintento genera un id nuevo. Con una reference derivada
de ese id, un fallo FALSO (se acreditó pero se perdió la respuesta por timeout) pagaría
DOS VECES. Derivándola del `periodKey` (que ya es único por usuario+tipo+período), el
reintento manda la misma reference y la plataforma responde `duplicate:true`.

### 4.5 Rollover y bonos ACTIVOS en la plataforma

1girox tiene el feature "Rollover y Bonos" **activo**. Consecuencias:

- **Los retiros se validan contra `wagering.available`, NO contra `balance`.** El
  jugador puede tener saldo que todavía no puede retirar (objetivo de apuestas
  pendiente). `getUserBalance` devuelve `balance`, `available`, `locked`, `bonusLocked`.
  Validar contra `balance` ⇒ la plataforma rechaza con `rollover_locked` y queda un
  retiro colgado en el panel. El confirm de payouts (~L12898) ya usa `available`.
- **⚠️ #659 (2026-10-20): TODOS los regalos van con el ROLLOVER GLOBAL** `Config['bonusRolloverX']` (×5, panel → Estrategia →
  rollover; `POST /api/admin/strategy/rollover {x}` lo copia también a `fireRolloverMultiplier`, `communityWelcomeRolloverX`,
  misiones, premios en plata de la ruleta e `instantCashback.rolloverX`). En server.js el helper `_giftRolloverX()` lee ese valor y
  los tres reembolsos por período, el bono de nivel VIP y el rakeback lo pasan como `{ multiplier }` a `creditUserBalance`
  (ruleta/misiones/acumulativo ya iban por `creditGift` con su `rolloverX`). **ÚNICA excepción: comisiones de REFERIDOS**
  (`referralPayoutService`, sin multiplier ⇒ bono 0, retirables sin apostar). La devolución de retiro rechazado tampoco lleva
  rollover (no es regalo). El párrafo siguiente describe el mecanismo "bono 0" que hoy aplica sólo a referidos.
- **REGALOS = BONO 0 "regalo directo" (2026-09-07, Partner API v1.10+ — manual
  v1.15 §2.9/§2.12 en `docs/PARTNER-APIv1.15.pdf`).** `creditUserBalance` SIN
  `opts.multiplier` (reembolsos, ruleta, rakeback, bono de nivel VIP, comisiones
  de referidos, bono de instalación, parte "bonus" de una devolución) va por
  `POST /players/{u}/bonus` con `multiplier: 0`: disponible/RETIRABLE al
  instante, sin reclamo, NO pisa el bono en curso, y en el panel de 1girox
  figura como **Bono** (antes iba por `/deposit` y todo aparecía como "Carga").
  **Precheck** contra GET /config (bonos/standalone habilitados, 0 ∈
  bonus.multipliers, monto dentro de fixed_min/fixed_max) + **fallback
  automático a depósito libre con la MISMA reference** en rechazos de negocio
  (422 / feature_disabled / bonus_out_of_range / player_not_found — la
  plataforma no movió plata); errores transitorios se devuelven al caller
  (reintenta con la misma reference). Cinturón `_claimOwnGiftIfLocked`: si el
  regalo quedara "a reclamar", se reclama SOLO ese requirement_id (nunca
  claim-all). El resultado trae `creditedAs: 'bonus'|'deposit'`. **Kill switch:**
  `GIROX_GIFT_AS_BONUS=0` → todo vuelve a depósito libre.
  🪦 La regla vieja "NO usar /bonus, queda a reclamar" valió solo entre la v1.7
  y la v1.10 (2026-07-31 → 2026-08-03).
  **FUEGUITO:** rollover 0 → regalo directo; rollover >0 → **`/bonus` con ese
  multiplier** (`_creditFireReward`, server.js): bloqueado hasta apostar
  multiplier × premio y, con claim_required, el jugador lo libera tocando el
  regalito del casino al completar el objetivo. Condiciones: mult ∈
  bonus.multipliers (el POST de fire-milestones lo valida), monto en
  fixed_min/max y jugador SIN bono activo (leído `fresh`; otorgar otro lo
  PISARÍA) — si algo falla, cae al DEPÓSITO CON multiplier de antes (mismo
  candado, figura como Carga, warn `[FIRE_REWARD]`). El viejo requisito de
  cargas (milestone.requireDeposits) sigue sin chequearse.
  **La devolución de retiro rechazado (vip-payoutref-*) SIGUE por depósito**:
  no es un regalo, es plata real que vuelve.
  **`creditGift(username, amount, {description, reference, rolloverX})`**
  (2026-09-11, giroxService): regalo CON rollover genérico. rolloverX 0 →
  `creditUserBalance` (bono 0). rolloverX > 0 → `/bonus` con ese multiplier
  tras precheck (config) + lectura FRESCA del jugador: con bono activo (> $50
  bloqueado o a reclamar) cae a DEPÓSITO con `wagering.multiplier` (misma
  reference — no le pisa el bono); rechazo de negocio → depósito; transitorio
  → se devuelve al caller. Lo usa el reembolso acumulativo. (El fueguito sigue
  con `_creditFireReward`, misma lógica.)
  Con `opts.multiplier` explícito (Bonificación del panel, welcome code cash,
  lotes): `/bonus` ESTRICTO sin fallback (un rechazo se ve como error). ⚠️ Ojo
  con "bono sobre bono": un bono con rollover a quien ya tiene uno activo PISA
  el anterior y le debita lo que le quedaba.
- `depositToUser` acepta `wagering` opcional (`multiplier`, `bonus_percent`,
  `bonus_amount`, `bonus_multiplier`). Caso raro documentado: la carga se acredita pero
  el bono falla (`wagering.bonus.status === 'failed'`) → se marca `bonusFailed` y se
  loguea en ERROR. **No reintentar el depósito completo** (la reference devolvería
  duplicate): escalar a soporte de 1girox.

### 4.6 Stats por jugador — netwin y apostado (Partner API v1.8/v1.9)

**Actualizado 2026-08-03.** Desde la v1.8/v1.9 (2026-07-31, WORKLOG #101) los stats
salen de la MISMA Partner API, con la misma `X-Api-Key` y por **username**:

- `GET /players/{username}/stats?from&to` → `girox.getPlayerStats()`.
- `POST /players/stats/batch` (hasta **100 usuarios** por request) →
  `girox.getPlayersStatsBatch()`. Es lo que hace viables los referidos y el motor
  VIP sin comerse el cupo de 60 req/min.
- Devuelven `totals` + `categories.casino/sports`, cada uno con `bets_count`,
  **`wagered` (apostado)**, `payout` y `netwin` — todo en **PESOS**.
- **`bonus: { granted, still_locked }`** (sección 2.10 del manual actualizado, soporte
  1girox 2026-09-10): bono OTORGADO al jugador en el rango (cargas con %, /bonus,
  campañas, bonos dados a mano en el panel de 1girox) y cuánto sigue con rollover.
  A nivel jugador, no por categoría. `getPlayerStats`/batch lo exponen como
  `bonusGranted` / `bonusStillLocked` (0 si la API no lo manda). Es la base de
  "reembolso sobre plata REAL" = netwin − granted. **No existe** el desglose
  bono/real por apuesta (saldo unificado): no pedirlo ni inventarlo.
- ⚠️ `netwin` POSITIVO = el jugador PERDIÓ (base del reembolso); negativo = ganó.
- Rango **máximo 92 días** por consulta, evaluado en **hora argentina** del lado de
  la plataforma (`formatStatsDate` ancla a -03:00).
- **Sólo CASINO** por decisión del owner (2026-07-31): reembolsos y comisiones usan
  `casinoNetwin` (`GIROX_NETWIN_SCOPE=total` incluiría sports); el motor VIP usa
  `categories.casino.wagered` (`VIP_WAGER_SCOPE=total` ídem).
- El `not_found` del batch mezcla "no existe" y "no es tuyo" a propósito (lo aclara
  el manual): se trata igual — sin stats.

**La comisión de referidos no viene del proveedor:** 1girox devuelve todos los campos
`commission` en 0, así que la tasa es NUESTRA: `GIROX_REFERRAL_COMMISSION_PCT`
(default **5%** del netwin desde #351 2026-10-17 — antes 8% —, editable en el panel → Referidos, Config['referralCommissionPct']; env como fallback). Es la ÚNICA tasa.

**`giroxUserId`** — el propio `stats` devuelve el ID numérico del jugador y los flujos
lo persisten "gratis" (update condicional sólo si estaba vacío). Ya NO bloquea nada:
todo va por username.

🪦 **Lo que había acá antes:** `giroxReportsService.js` scrapeaba el panel
`admin.1girox.com` con un Bearer de sesión auto-renovable (base64+deflate) y el ID se
buscaba con `POST /users/fetch` (LIKE ambiguo). Era el punto más frágil de toda la
integración. **ELIMINADO el 2026-07-31** junto con `GIROX_ADMIN_USER/PASS/TOKEN`,
`GIROX_ADMIN_BASE_URL` y `GIROX_AGENT_USER_ID`.

### 4.7 Migración de la base (`scripts/migrate-users-to-girox.js`)

- **Dry-run por default**: sin flags no escribe nada (ni en Mongo ni en 1girox); para
  escribir hay que pasar `--execute`. Un argumento desconocido ABORTA. Otros flags:
  `--limit=N`, `--username=xxx`, `--retry-errors`.
- **Throttling**: cada usuario consume hasta 3 llamadas (existe? + alta + búsqueda del
  ID). Default `GIROX_MIGRATION_DELAY_MS=2500` (~24 usuarios/min). Si aparecen 429,
  **SUBIR** el delay: la cuota es compartida con producción.
- **Reanudable e idempotente**: el estado vive en Mongo (`giroxSyncStatus` /
  `giroxUserId`), no en un archivo. Los `synced`/`linked` con ID se saltean; a los que
  tienen cuenta pero les faltó el ID sólo se les reintenta el ID.
- **Las contraseñas NO se migran**: las locales son bcrypt, irrecuperables por diseño.
  Cada cuenta se crea en 1girox con una clave random fuerte que no se guarda en ningún
  lado, y el usuario queda con `giroxPasswordSynced:false`. No deja a nadie afuera: al
  casino se entra por SSO. La clave real se replica en el próximo login o cambio de
  contraseña en VIPCARGAS (server.js ~L3614) y ahí pasa a `true`.
- **No toca `jugaygana*`**: se conservan para revertir.
- Usernames válidos en 1girox: **3-18 caracteres, sólo `[A-Za-z0-9_]`**. Los que no
  pasan quedan en `giroxSyncStatus:'invalid_username'` y necesitan decisión manual.

### 4.8 Variables de entorno

Todas **lazy**: se leen en runtime, NUNCA en el `require()` (SSM carga después) —
por eso `giroxService`/`giroxReportsService`/`giroxPublisherKeys` usan getters y
construyen el cliente HTTP on-demand. Congelarlas en una const de módulo es el bug que
tenían los 4 clientes viejos.

| Variable | Default | Para qué |
|---|---|---|
| `GIROX_API_URL` | — | Base de la Partner API, sin barra final (ej. `https://api.1girox.com/api/v1`). **#310:** el panel puede pisarla (`Config['giroxCredentials']`, cifrada; `giroxService.setCredentialsOverride`) |
| `GIROX_API_KEY` | — | Header `X-Api-Key` de la cuenta MASTER (`pk_...`). **SSM, nunca en el repo** |
| `GIROX_PLAY_URL` | `https://1girox.com` | Sitio del jugador (fallback si el SSO falla) |
| `GIROX_NETWIN_SCOPE` | `casino` | `casino` \| `total` (incluiría sports) en reembolsos/comisiones |
| `GIROX_MAX_RPM` | `55` | Techo local de requests/min **por instancia** |
| `GIROX_REFERRAL_COMMISSION_PCT` | `8` | % de netwin que es owner-revenue (el proveedor ya no la informa) |
| `GIROX_GIFT_AS_BONUS` | `1` | `0/false/off` = kill switch: los regalos vuelven a acreditarse por depósito libre (como antes del 2026-09-07) |
| `VIP_USD_ARS_RATE` | `1500` | Tasa USD→ARS de los umbrales VIP (los umbrales de Stake están en USD) |
| `VIP_WAGER_SCOPE` | `casino` | Qué apostado suma para el nivel (`casino` \| `total`) |
| `VIP_WAGER_EPOCH` | `2026-07` | Primer mes que se acumula (cuando arrancó 1girox) |
| `VIP_ACTIVE_DAYS` | `3` | Días de `lastLogin` que definen "activo" para el tick de 30 min |

Opcionales/afinado: `GIROX_TIMEOUT_MS` (20000) y las `GIROX_MIGRATION_*` del script.
🪦 `GIROX_ADMIN_*` y `GIROX_AGENT_USER_ID` se fueron con el scraping del panel (#101).

Si falta la config, el arranque lo grita por consola: `girox.isEnabled()` se chequea
en el bootstrap (y `GET /api/admin/girox/health` es el diagnóstico completo).

### 4.9 Login único (SSO) — el botón CASINO

`POST /api/platform/session` (alias histórico `POST /api/auth/platform-login`,
mismo handler, ~L4250) → `girox.createSession(username)` →
`POST /players/{username}/session` de 1girox → **`redirect_url` con un código de UN
SOLO USO que vence a los 60 segundos**. No se cachea ni se persiste; el front redirige
apenas lo recibe. **No se le pide la contraseña al usuario**: ya está autenticado en
VIPCARGAS con su JWT, y el cliente nunca más necesita conocer su clave del casino.

- ⚠️ **Trampa del bloqueador de pop-ups** (`VIP.ui.enterCasino`, `public/js/ui.js`): el
  link viene de un fetch asíncrono y los navegadores —sobre todo en mobile— bloquean
  `window.open` fuera del gesto del usuario. Por eso **la pestaña se abre PRIMERO,
  vacía** (con un "🎰 Entrando al casino…"), y recién después se le cambia la URL. Si
  igual la bloquearon, se navega en la pestaña actual. Si el SSO falla, se cierra la
  pestaña y se cae al modal de acceso manual. Hay guard anti-doble-click
  (`_casinoOpening`). **No mover el `window.open` después del `await`.**
- **Auto-reparación**: si 1girox responde `player_not_found` (usuario que el script de
  migración no alcanzó, o creado mientras la migración corría), el backend lo crea al
  vuelo con una contraseña random, actualiza `giroxSyncStatus` y reintenta UNA vez.

## 5. Flujos principales

- **Registro**: `POST /api/auth/register` (user+pass; OTP solo si manda teléfono) o
  `register-quick` (link de pauta con campaignCode válido, sin SMS,
  phoneVerificationPending=true → no puede retirar hasta verificar). Crea en 1girox
  PRIMERO (`girox.syncUserToPlatform`); guarda atribución, fbc/fbp, registrationIp.
  Crea ChatStatus solo el flujo público (los usuarios creados por admin/publisher NO —
  evita chats vacíos).
- **Login**: `POST /api/auth/login` (~L3361). `findUserByUsernameCI` con
  `critical:true` (fallback regex SIEMPRE disponible — nadie queda afuera). Si no existe
  local pero SÍ en 1girox, se crea la cuenta local al vuelo (cubre jugadores que nunca
  pasaron por VIPCARGAS). Soporta login por teléfono, OTP y `temporaryCode`. Roles staff
  reciben las cookies admin. JWT 30d (registro: 90d). **Efecto lateral importante**: si
  el usuario todavía tiene `giroxPasswordSynced:false`, acá se aprovecha que la clave
  viaja en claro para replicarla en 1girox (fire-and-forget, una sola vez por usuario).
- **Alta por publisher_admin**: `giroxPublisherKeys.createUserAsPublisher(campaignCode)`
  firma el `POST /players` con la **API key de la campaña**, así el jugador queda colgado
  del publicista correcto en la jerarquía. Sin key configurada (o si falla) → fallback a
  `girox.syncUserToPlatform` con la key master. ⚠️ Si el username YA existía en 1girox,
  queda bajo el agente que lo creó primero: recrearlo con otra key NO lo mueve de rama.
  Cargas, retiros y bonos van SIEMPRE por la key master (los depósitos salen del saldo
  del dueño de la key — que es lo que queremos).
  **Multi-publicista (2026-08-07):** una cuenta publisher_admin puede tener VARIAS
  campañas (`User.publisherCampaignCodes`, lista; `publisherCampaignCode` queda como
  "principal"/compat = la primera). Los permitidos se resuelven SIEMPRE con
  `_publisherCodesOf(employee)` (server.js, unión de ambos campos). Con 2+ campañas el
  create-user exige `body.campaignCode` (validado contra su lista — un código ajeno da
  403), el selector del panel lo manda y los influencers se piden por campaña
  (`GET .../influencers?campaign=`). my-stats/users agregan sobre TODAS
  (`acquisitionCampaign: {$in}`); la lista "Mis usuarios" acepta `?campaign=` para
  filtrar y muestra a qué publicista pertenece cada usuario. La gestión del admin
  (POST/PUT `/api/admin/publisher-admins`) acepta `campaignCodes` (lista) o el legacy
  `campaignCode`.
- **Detalle de una pauta con período (#914):** `GET /api/admin/campaigns/:code/stats?from=&to=` y `…/users?from=&to=` aceptan
  fecha Y hora (ISO; el panel manda hora argentina con `-03:00`). Con período: `_campaignStatsRange` (clics, registros, FTD = primera carga de
  la vida dentro del período, cargas, retiros, neto del período); sin período: `computeCampaignStats` (desde el inicio, lo que usa el link
  público `/r/<token>`). El modal "📊 Ver detalle" tiene Desde/Hasta + Hoy/Ayer/7 d/30 d/Todo.
- **Landing de pauta (#224):** `GET /l/:code` (y `/landing/:code`) sirve `public/landing/index.html`
  con el código inyectado; `POST /api/landing/signup` crea el usuario en Girox Y en toda plataforma
  habilitada con API (`User.platforms`), devuelve usuario/clave/access link (sin `ir=casino`);
  `GET /api/landing/info` es público (plataformas + escalera). Plataforma FIJA del cliente (#225):
  `User.preferredPlatform` + `POST /api/platforms/preferred`; `decideForDeposit` no pregunta si hay fija.
- **Pauta / vanity URL**: `GET /:code` matchea Campaign.code exacto (DB directa) o slug
  del publisher (cache 30s). Setea cookie httpOnly `vip_campaign` (60 días) → el server
  reinyecta el código en CADA carga SPA (`renderIndexHtml`) para que "registro sin SMS"
  sea determinístico (las webviews de Meta rompen localStorage).
- **Bienvenida**: `POST /api/messages/welcome` — mensajes de SISTEMA + upsert de
  ChatStatus. Throttle 24h server-side. Guard `_isStaleClientWelcome` descarta
  bienvenidas-fantasma de PWA cacheadas viejas.
- **Chat**: HTTP `POST /api/messages/send` + socket `send_message` (misma lógica
  duplicada: validaciones, comandos `/`, SLA, comprobantes). Imagen de cliente →
  `analyzeComprobanteFromMessage` (IA, fire-and-forget) → aviso adminOnly
  (duplicado/verificado/manual) → `hgcashMatchFromComprobante`.
- **Carga manual**: `POST /api/admin/deposit` → `girox.depositToUser` con
  `reference = vip-dep-<txId>` (el uuid se genera ANTES de llamar y después se reusa
  como `Transaction.id`: así una operación de 1girox se rastrea hasta su fila local y
  viceversa). El bonus va como segunda llamada (`vip-depbonus-<txId>`); el mensaje al
  cliente refleja el resultado REAL y si el bonus falla → alerta adminOnly.
  Consume PromoBonus vigente y movimiento hgcash
  pendiente del mismo monto (`hgcashConsumeOnManualDeposit`). Mensajes `/sys_deposit*`,
  `/sys_reminder`, `/sys_install_app`, `/sys_recover_100`.
- **AUTO-CARGA hgcash** (`POST /api/hgcash/webhook`, firma HMAC sobre rawBody,
  fail-closed en prod): guarda BankMovement → matching contra Comprobantes por
  monto + (N° operación==coelsa/externalID, o nombre de origen + destino consistente)
  dentro de una ventana (60min desde comprobante / 10min desde movimiento). Ambigüedad
  → NO carga. `hgcashAutoCarga`: claims atómicos de movimiento y comprobante → modo
  sombra o real → **mínimo $2.000** (menor → needs_review + aviso) → candado
  HgcashCharge por coelsa → guard anti-duplicado (misma carga <8min → needs_review) →
  `depositToUser` con `reference = vip-hg-<coelsa|movementId>` (**doble candado**: el
  índice único de HgcashCharge de nuestro lado y la idempotencia de 1girox del otro) →
  Transaction + mensaje + SLA. Fallo → se BORRA el HgcashCharge y es reintentable hasta
  3 veces (la reference estable impide que el reintento duplique la carga).
  **Credenciales desde el PANEL (#215, réplica #320 de AUTOGIROXcompartido):** el
  token de API y el secreto del webhook se pueden cargar en Comandos → Banco
  automático → card "🔐 Cuenta hgcash conectada" (solo admin general,
  `GET/POST/DELETE /api/admin/hgcash/credentials`). Se guardan CIFRADOS (AES-256-GCM,
  clave derivada de `JWT_SECRET`) en `Config['hgcashCredentials']`; cada instancia los
  carga en memoria a los 8 s del arranque y cada 60 s (`_loadHgcashCredentials` →
  `hgcashPay.setTokenOverride` + `_hgcashPanelSecret`). **Panel > SSM**
  (`HGCASH_API_TOKEN` / `HGCASH_WEBHOOK_SECRET` quedan de respaldo). El webhook acepta
  la firma con CUALQUIERA de los secretos (`_hgcashWebhookSecrets()`), así un cambio de
  cuenta no pierde avisos. El POST prueba el token contra `GET /accounts` de hgcash
  antes de guardar y limpia `Config['hgcash'].accountId` (se resuelve con la cuenta
  nueva). Si `JWT_SECRET` cambia, lo guardado no se descifra → cae a SSM y la card avisa.
  **Fan-out** (#94 → #215/#326): reenvía el webhook crudo+firma a OTRAS páginas que
  comparten la cuenta hgcash. Destinos en `Config['hgcashFanout'].urls` (hasta 5, card
  "🔁 Reenviar los avisos…", `GET/POST/DELETE /api/admin/hgcash/fanout`, cache 30 s);
  si ese Config existe manda el panel (vacío = no reenviar), si no vale
  `HGCASH_FANOUT_URL` (default autoreembolsos.com, 'off' apaga). Anti-círculo: lo que
  llega con `X-Forwarded-By` no se reenvía y nunca se manda a la URL propia. Stats por
  destino en memoria por instancia (`_hgcashFanoutStats`), visibles en la card.
- **Webhook hgcash — secreto exclusivo (#216, 2026-10-13):** si hay secreto cargado en el panel,
  `_hgcashWebhookSecrets()` devuelve SOLO ese: el `HGCASH_WEBHOOK_SECRET` de SSM deja de valer y
  los avisos de la cuenta hgcash vieja se rechazan. Sin secreto en el panel vale el de SSM. ⚠️ Si
  las dos cuentas comparten usuario/secreto de hgcash esto no alcanza (no hay filtro por CBU destino).
- **Retiro self-service**: `POST /api/withdrawal/request` — exige phoneVerified, lock
  anti-doble, chequeo de saldo (UX), dedup 10min → crea PendingPayout
  (`deductAtPay:true`, SIN descontar) → mueve el chat a Pagos. El AGENTE confirma:
  `POST /api/admin/payouts/:id/pay` → `_deductChipsAtConfirm` (saldo **`available`**, no
  `balance` — ver §4.5 → `withdrawFromUser` con `reference = vip-payout-<payoutId>` →
  verificación anti-fantasma de que bajó) → cash-out hgcash (externalID=payout.id =
  idempotencia; retry con accountId fresco ante 403) → webhook/poller confirma DONE →
  aviso `/sys_payout_paid` + comprobante PDF (foto vía mupdf + link permanente
  `/api/payout-receipt/:id`). Rechazo (`/cancel`): si NO se descontó → nada que
  devolver; si se descontó → devolución (split bonus/fichas para pagos legacy).
  `pay-other-bank` = pago manual (descuenta igual). Poller `_pollPayingPayouts` cada
  45s (últimas 2h) cubre webhooks perdidos.
- **Reembolsos**: `POST /api/refunds/claim/{weekly|monthly}` — lock Redis,
  ventanas de `models/refunds.js` (semanal: lunes/martes; mensual: desde día 7),
  rangos en hora ART de `src/utils/periodRanges.js`, NETWIN real de
  `girox.getPlayerStats(username, …)` (**sólo casino**, ver §4.6; por username, sin
  gate de ID). El % sale del RANGO por pérdida del período
  (`src/utils/refundTiers.js`). 🪦 **El reembolso DIARIO se ELIMINÓ el 2026-08-07**
  (decisión del owner): `claim/daily` quedó como stub que responde "ya no está
  disponible" (para PWAs cacheadas), el status manda un stub `daily` en $0 por la
  misma razón, y los RefundClaim históricos `type:'daily'` siguen en la base (el
  enum del modelo conserva 'daily' SOLO por esos docs). **Desde 2026-08-05 los
  rangos son EDITABLES desde el panel y CADA PERÍODO tiene su propia escalera**
  (semanal ≠ mensual): `Config['refundTiersByPeriod']`
  (`{weekly/monthly: [{name,pct,max}]}` — una llave `daily` vieja se ignora),
  leída SIN cache por `getRefundTiersByPeriod()` (server.js) con fallback a
  `DEFAULT_TIERS` (3/6/10%) por período si falta/es inválida. Validación en
  `refundTiers.normalizeTiers` (1-6 rangos, % 0-100, umbrales crecientes, último
  sin techo). Endpoints `GET/POST /api/admin/refund-tiers` (solo admin general);
  el POST devuelve `commandWarnings` = comandos `/sys_*` cuyo texto menciona
  porcentajes (esos se editan A MANO desde COMANDOS). El status manda
  `tiersByPeriod` (+ `tiers` legacy = la del semanal). **Mínimos para COBRAR
  (2026-08-10):** `Config['refundMinimums']` (`{weekly, monthly}`, defaults
  $1.500/$5.000, 0 = sin mínimo), leída SIN cache por `getRefundMinimums()`.
  Si el reembolso calculado da > $0 pero MENOS que el mínimo, el claim rechaza
  ANTES de la reserva atómica (no quema el período) con el mínimo VIGENTE en el
  mensaje (`belowMinimum:true, minAmount`). Se editan en la misma card de
  rangos del panel y viajan en el mismo GET/POST de refund-tiers (`minimums`
  es opcional en el body: un panel cacheado viejo no los pisa). El status
  manda `minAmount` y `belowMinimum` por período. Los viejos
  Config['refundPercents'] quedaron `enUso:false` y su card del panel fue
  reemplazada por el editor de rangos. **El RefundClaim se CREA antes de acreditar** (el índice único
  `userId+type+periodKey` es el candado atómico contra doble cobro; si el crédito
  falla se borra la reserva). El crédito va por `creditUserBalance` con `{ multiplier: _giftRolloverX() }`
  (**#659: rollover global ×5**; antes bono 0 regalo directo — ver §4.5; fallback a depósito si el monto
  queda fuera de los límites del bono) con la reference derivada del período.
  Ver #96 y §4.4. ⚠️ En la UI los reembolsos muestran SOLO el % — los nombres
  Bronce/Plata/Oro son del nivel VIP (abajo). **Desde 2026-09-11 (ESPEC-REEMBOLSO
  §5) la base del período es la pérdida sobre plata REAL:** `netLoss = max(0,
  casinoNetwin − bonusGranted)` del mismo rango, y al monto calculado se le resta
  lo ya cobrado como reembolso ACUMULATIVO dentro del período
  (`_cashbackPaidBetween`). Un bono otorgado la semana anterior y perdido esta
  semana no se descuenta (imprecisión aceptada).
- **Reembolso ACUMULATIVO de por vida** (2026-09-11, `docs/ESPEC-REEMBOLSO-1GIROX.md` (vive en el repo gemelo, NO en este)
  de la gemela; #208): `pct%` de lo que el jugador perdió **con su plata** desde el
  alta, nunca de regalos ni de lo que ganó, sin que el mismo peso se reembolse dos
  veces. `_cashbackStateToday` (server.js) + fórmula pura en
  `src/utils/cashbackFormula.js`:
  `netoDePorVida = carryNet + netwin(ancla→hoy)` (plegado de 60 días cuando el
  tramo vivo pasa los 85 — §2 CashbackClaim/User); `regalado = max(localViejo,
  grantedViejo) + max(localVivo, grantedVivo)` (local = `bonus` de los deposits +
  Transactions `bonus|fire_reward|refund|rakeback|vip_levelup|referral_commission|
  roulette` sin `payout_refund`, matcheadas por userId O username; oficial =
  `bonus.granted`; se toma el MAYOR tramo a tramo — nunca se reembolsa un regalo
  que alguno de los dos vio; **incluye los propios reembolsos cobrados**: perder
  $C de reembolso sube neto y regalado por igual → $0); `reclamable = floor(pct% ×
  max(0, neto − regalado) − cobrado)`, `min(…, topeDiario − cobradoHoy)`, mínimo
  para cobrar. Propiedades: se acumula hasta reclamar (no vence), al reclamar queda
  en 0, una ganancia resta PARA SIEMPRE, el regalo perdido no genera reembolso.
  Endpoints: `GET /api/cashback/status` (`?fresh=1` sin cache, cooldown 30s/usuario),
  `POST /api/cashback/claim` (recalcula fresh → guard 20s → reserva `CashbackClaim`
  → guard 20s → `girox.creditGift` con rollover del panel y reference `vip-cbk-*`
  → fallo definitivo borra la reserva, `duplicate:true` = pagado → Transaction
  `type:'bonus'` + `metadata.source:'instant_cashback'` + nota admin-only),
  `GET/POST /api/admin/instant-cashback` (solo admin general: on/off, %, rollover,
  mínimo, tope diario — `Config['instantCashback']`, arranca APAGADO),
  `GET /api/admin/girox/stats-raw` (diagnóstico). PWA: tarjeta en el perfil
  (`VIP.refunds.showProfileModal`, sólo si está encendido). Panel Transacciones: se
  etiqueta "💸 Reembolso acumulativo", entra en el filtro Reembolsos (no en
  Bonificaciones). Validación: `node scripts/test-cashback-spec.js` (tabla §7).
- **Niveles VIP** (2026-08-03; escalera de **1win** desde #292 2026-10-17, antes Stake): se sube por APOSTADO acumulado de
  por vida (buckets `VipWagerMonth`, ver §2 y el motor en
  `src/services/vipLevelService.js`). Escalera en `src/utils/vipLevels.js`: 19 niveles (Bronce II US$5k … Black V
  US$5.000M) × tasa (1500) — Bronce II $7,5M ARS apostados; bono al subir 0,1% del umbral, rakeback 0,10–0,80%.
  **Editable** desde el panel (Configuración → Niveles VIP → escalera): `Config['vipLevelsConfig']` con overrides
  por idx (nombre, thresholdArs, levelUpBonusArs, rakebackPct) + `usdArsRate`; `POST /api/admin/vip-levels/table`
  (valida umbrales crecientes; `reset:true` = defaults) y `vipLevels.refreshFromConfig(Config)` (boot + 60 s +
  al guardar). Los idx se persisten: sólo AGREGAR niveles al final, nunca reordenar.
  Cada nivel destraba: (a) **bono one-time** al alcanzarlo (lo acredita el motor con
  bono con el rollover global `_giftRolloverX()` (#659; antes bono 0 — §4.5), reference `vip-lvl-<userId>-<idx>`, aviso por chat+push vía
  `/sys_vip_levelup`; `duplicate:true` = otra instancia ya pagó → no re-notificar) y
  (b) **rakeback semanal**: `POST /api/vip/rakeback/claim` paga `rakebackPct` del
  APOSTADO de casino de la semana pasada (gane o pierda) — mismo patrón de reserva
  atómica que los reembolsos (RefundClaim type `rakeback`, periodKey
  `rake:<lunes>`, reference `vip-rake-<lunes>-<userId>`). Estado:
  `GET /api/vip/status` (nivel, progreso, escalera, rakeback). El nivel NUNCA baja;
  `lifetimeWagered` sólo se escribe con `$max`. **On/off desde el panel** (SOLO admin
  general, `GET/POST /api/admin/vip-levels` → flag `vip_levels_disabled` en Config;
  apagado = no acumula, no paga, la PWA oculta la sección; reactivar recupera todo
  solo porque los buckets se recalculan con `$set`).
- **Referidos**: preview/calculate (delta incremental sobre ledger de payouts) /
  payout (acredita con `giroxService.creditUserBalance`, reference
  `vip-refcom-<payoutId>` reusando el documento de intentos fallidos). El revenue sale
  del netwin del panel × `GIROX_REFERRAL_COMMISSION_PCT` (8%) y sobre eso la tasa del
  referidor (7%). Ver §4.6. **Hoy (#351): una sola tasa, 5% por defecto, editable en el panel.**
- **Ruleta diaria** (v2 2026-09-18, premios CONFIGURABLES): gates editables en el panel
  (`Config['dailyRoulette']`: `enabled`, `requireAppInstalled` default sí,
  `minCargas30d` default 10 = "más de 10 cargas reales en 30 días"; default = la tabla
  vieja en $, así que sin guardar nada se comporta como siempre). Premios `percent`
  (X% EXTRA pendiente para la próxima carga → `User.dailyRoulettePendingPct`, lo aplica
  `resolveAutoBonus` con tope), `cash` (plata al instante vía `girox.creditGift` con
  `rolloverX`, reference `vip-roulette-<spinId>`) y `none`; `weight` = probabilidad
  (`probPct` real en status/panel/PWA). **Budget pacing** degrada a "sin premio" o al
  primer % (no gasta plata). `credit_failed` → retry desde el panel con la MISMA
  reference y el rollover del giro. Cada premio en $ escribe una **Transaction type
  'roulette'** (idempotente por metadata.spinId). ⚠️ Sigue el candado de pushes de
  ruleta (#204).
- **Fueguito (#654, 2026-10-20 — por ROLLOVER)**: reclamo diario sin requisitos; el premio de cada hito
  (Config['fireMilestones'], panel columna "Rollover $") se cobra habiendo APOSTADO `milestone.rollover` (default 30× el
  premio: 150k/300k/600k/900k… ) en la plataforma desde `FireStreak.rolloverSince` (stats `wagered` vía
  `_fireWageredSince`, cache 60 s; si la API no responde → 503 `STATS_UNAVAILABLE`, nunca se pierde el premio).
  `rolloverSince` vuelve a "ahora" (contador a 0) al cobrar, al pasar al hito siguiente sin cobrar (el pendiente se
  limpia) y al reiniciar la racha; el premio del hito N queda cobrable hasta el hito siguiente. Ya NO exige cargas
  (`requireDeposits`/`fireMinDeposits` sin efecto). `/api/fire/status` expone `rolloverNeed/Have/Unknown/ForDay/
  ExpiresDay/Since`. Crédito como bono con `fireRolloverMultiplier` (= rollover global, §4.5) vía `_creditFireReward`
  (`vip-fire-<userId>-d<día>-<fecha>`).
- **BONO AUTOMÁTICO EN LA CARGA** (2026-09-18, #210): `resolveAutoBonus(user, amount,
  usedBy)` (server.js) reserva atómico UN bono pendiente por carga, en orden: bono por
  instalar la app (% congelado) → código de bienvenida `next_charge` → % de la ruleta
  diaria → `PromoBonus` activo en % → **#290: `Config['firstDepositBonusPct']` (50%) si es la PRIMERA carga
  real del cliente (`_isFirstRealDeposit`, manual o hgcash)** → #274: `Config['autoLoadBonusPct']` sólo hgcash. Monto con TOPE (`src/utils/bonusCap.js`,
  `Config['bonusCap']` {enabled, capArs 20000, restPct 20}): `pct% × min(carga, cap) +
  restPct% × exceso` cuando pct > restPct. Lo usan la carga MANUAL (`/api/admin/deposit`:
  pisa el bonus tipeado por el agente y deja nota interna con el motivo; sin bono
  pendiente vale el del agente) y la AUTO-CARGA hgcash (bono adjunto al deposit). Si la
  carga o el bono adjunto fallan → `revert()`. Config en COMANDOS → "Bonos automáticos en
  la carga". Nada de esto se aplica a mano: el botón "Marcar como usado" del panel queda
  sólo para bonos dados por otra vía.
- **Registro MANUAL sin bienvenida** (2026-09-18): `_welcomeBonusEligible(u)` = no
  `createdByAgent` ni `acquisitionSource:'manual'`. Sin eso no hay bono por instalar la
  app (cartel oculto, claim `MANUAL_SIGNUP`) ni código de bienvenida (`MANUAL_SIGNUP`).
- **Bono por instalar la app** (🪦 antes "bono instalación $5.000" acreditado; hoy NO
  acredita plata): exige standalone real (token FCM), teléfono verificado (salvo
  cuentas creadas por agente), anti-multicuenta por token FCM compartido, reserva
  atómica (`installBonusClaimed` + `firstChargeBonusStatus:'pending'`). Es un **% EXTRA
  en la PRÓXIMA CARGA que aplica el agente a mano** y marca como usado desde el chat
  del panel (`POST /api/admin/users/:userId/first-charge-bonus/use`). **El % es
  `Config['installBonusPct']`** (default 25; 2026-09-17 — antes 100 fijo), editable en
  COMANDOS (card "Bono por instalar la app", sólo admin general) y se **congela** en
  `User.firstChargeBonusPct` al reclamar. Todos los textos lo leen por la variable
  `{pct}`: `/sys_install_bonus` (mensaje), `/sys_install_bonus_banner` y
  `/sys_install_bonus_banner_note` (cartel dorado de la PWA, que los recibe ya
  renderizados por `GET /api/install-bonus/status`). Migración al boot: "100%" literal
  guardado en esos comandos → `{pct}%`.
- **Link de acceso de un solo uso** (2026-08-03): el admin general o un DEPOSITOR
  generan `?acceso=<token>` para un cliente (`POST /api/admin/users/:userId/access-link`,
  también desde el alta del panel; regenerar pisa el anterior). En `User` vive SOLO
  el sha256 (`accessLinkHash`). El canje (`POST /api/auth/access-link`, público +
  authLimiter) borra el hash EN EL MISMO findOneAndUpdate (single-use a prueba de
  carreras), fuerza `mustChangePassword` y emite el mismo JWT del login → la PWA
  (auth.js `tryAccessLink`, disparado en el arranque por app.js) guarda el token,
  limpia la URL del historial y `verifyToken()` abre el recuadro obligatorio de
  crear contraseña (estilo WhatsApp claro/oscuro; piso front: 8+ chars con letras
  y números). No hay botón de logout en la app (eliminado a pedido del owner).
- **SLA demoras**: reloj en ChatStatus (`delayClockOnUserMessage`/`delayClockResolve`);
  responder (mensaje/comando/carga/retiro/CBU) o cerrar lo resuelve; sobre-umbral →
  ChatDelay. Reporte `GET /api/admin/chat-delays` (solo admin).

## 6. Front-end: PWA cliente y panel admin

### PWA (`public/`)
- Namespace global `window.VIP` (`VIP.config`/`VIP.state` en config.js; módulos IIFE:
  auth, socket, chat, ui, refunds, fire, roulette, reviews, promobonus, notifications,
  withdraw, installbonus, notifsurvey, publisherwelcome, campaign, meta-pixel, apptest,
  app). El orden real de carga está en index.html (el comentario de app.js está viejo).
- **SW único**: `firebase-messaging-sw.js` (CACHE_VERSION se bumpea por release —
  ver el valor actual en el archivo) — FCM + caché: `/js/` y `/css/`
  stale-while-revalidate (deploy llega en la SIGUIENTE carga sin bumpear versión),
  `/app.js` y manifest network-first, API/socket nunca. `user-sw.js` es un stub de
  auto-desregistro (no volver a registrarlo).
- **HOME 2.0 (#220, 2026-10-16):** la pantalla principal ya NO es el chat. Orden: header → barra
  de SOPORTE (`#supportBar`, la vieja `.chat-topbar`, abre `#supportPanel` = el chat a pantalla
  completa con los MISMOS ids) → `#homePanel`: `.dash-top` compacta (reembolsos + usuario) →
  `#autoLoadCard` (carga automática: CBU/alias/banco/titular, usuario, contraseña guardada en el
  dispositivo, link de la app, "enviar comprobante" = attachBtn del chat, "guardar captura" = canvas
  → share/descarga; `js/autoload.js`) → `#platformsCard` (botones por plataforma de /api/platforms,
  Girox por SSO embebido y Ganamos por link mientras no tenga API; reemplaza al botón "PÁGINA CASINO
  AQUÍ") → `#howItWorksCard` (4 pasos, escalera real de reembolsos, plataformas) → carteles de
  bonos. `js/home.js` (VIP.home) envuelve `VIP.ui.showChatScreen` (init), `VIP.refunds.updateRefundButtons`
  y `VIP.chat.addMessageToChat` (no leídos; una pregunta platform_choice abre el chat solo).
  `#homePanelToggle` quedó oculto. ⚠️ Mover `chatMessages`/`messageInput`/`attachBtn` de lugar
  rompe el cableado de app.js/chat.js: dejarlos dentro de `#supportPanel`.
  **#266 (2026-10-17) — el CHAT volvió a ser la pantalla de entrada:** `VIP.home.setHomeMode('mini'|'full')`
  (`localStorage vip_home_mode`, default mini). En **mini** `body.home-mini` pliega `#homeFull` (todo el
  home de #220–#265, max-height 0) y `#supportPanel` se muestra INLINE (position static, flex 1) con la
  cabecera WhatsApp `#waHead` (espejo de `#themeToggleBtn`/`#fireStreak`/`#chatTopbarAvatar`) y el botón
  CBU de la barra de escribir visible; burbuja/círculo de soporte/`.support-head`/`#supportTests` ocultos.
  Arriba de todo, `#serviceBanner` ("⭐ SERVICIO COMPLETO" + "Ver todo ▾") alterna el modo; su texto es
  `/sys_home_banner` con `{pct}` = `Config['autoLoadBonusPct']` (desde #274 también el bono REAL de la carga
  hgcash sin otro bono pendiente: fuente `auto_load` en `resolveAutoBonus`, con tope; la manual no lo lleva),
  ⚠️ si el cartel dice "0%" es que esa Config quedó en 0 (panel → Bonos automáticos → "Servicio completo"); la
  migración `migration_autoloadpct_10_v1_done` (#281) la fuerza a 10 una sola vez,
  **#291/#294:** con la app instalada, junto al saldo va `#homeVipStrip` (nivel VIP + progreso, `_paintInstallStrip`)
  en lugar de "Instalar app" (botón test para simularlo, con datos de ejemplo); tocarlo abre `#vipLevelsModal`
  (`openVipLevels`, escalera de `vipStatus.levels` o `GET /api/vip/levels` público). Regla del fueguito
  `Config['fireMinDeposits']` (10 cargas reales en los últimos N días del hito, si no el premio se pierde y la
  racha se reinicia — se valida en `POST /api/fire/claim-reward`; el modal la explica abajo y "Premios por racha"
  es plegable). El modal Info ya no muestra opiniones ni ruleta (ocultos por CSS).
  **#304:** Perfil con avatar (`#pfUserBox`, `openAvatarPicker`/`pickAvatar`; `User.avatar` vía `GET/POST /api/me/avatar`);
  los íconos de nivel se desbloquean por `vipStatus.levelIndex`.
  **#296 → #695:** `playNow` y todo "jugar" con sesión abren SIEMPRE ADENTRO (`openPlatform` → overlay `#casinoOverlay` con Carga rápida,
  Retirar e Ir a Soporte, también en navegador); `/jugar.html` (pestaña aparte, barra "‹ Volver a cargas") queda sólo para el modo prueba sin app instalada;
  `body.is-tester` (username en `TESTER_USERNAMES`, home.js) es lo único que muestra los botones test; `_paintPlatformTexts`
  adapta Info/tarjeta de plataformas a la cantidad de plataformas habilitadas (tilde en COMANDOS → "Plataformas
  ofrecidas"). **#298:** una plataforma habilitada SIN API es "Próximamente": visible (pestaña del Inicio y tarjeta
  deshabilitadas) pero no se puede fijar (`/api/platforms/preferred` la rechaza) ni se ofrece al cargar
  (`decideForDeposit` filtra `connected`); en la PWA la default nunca es "próximamente" y la pestaña de Ganamos
  sigue abriendo su página (#300). `.ev-hero` = aviso premium del Inicio. **#299:** `Config['minDepositArs']`
  (carga mínima informativa, `minDeposit` en `GET /api/platforms`, `_paintMinDeposit`). **#297:** Cronograma como hoja del mes
  (panel del día `#cronDayPanel`, `cronPlanDay` → formulario con fecha) y reparto en hasta 60 lotes (`SCHED_MAX_PARTS`).
  **#294:** la oferta del % extra por instalar va ADENTRO de `#playNowCard` (`#pnGift`); `playNowLater` la deja
  pendiente (barra `#installGiftBar` de punta a punta). Ya no existe `#installGiftCard`.
  **#288:** el globo flotante `#supportBubble` está OCULTO por CSS (no borrarlo: contiene `#chatTopbarAvatar`);
  el chat se abre sólo desde "Carga manual" de la barra.
  **#282:** `#autoLoadCard` va centrada y en 2 pasos (1 transferir · 2 adjuntar la foto con el botón verde
  "Cargá aquí (adjuntá la foto aquí)" = `#loadHereBtn` → `VIP.autoload.sendReceipt()`).
  **#283/#290 — % EXTRA por instalar la app (retención en la 1ª carga; antes "carga gratis", hoy 50% extra, `INSTALL_GIFT_DEFAULT`):** al acreditarse la PRIMERA carga real
  (hgcash o manual) de un cliente SIN app instalada, `maybeOfferInstallGift` guarda `User.installGift`
  (status offered, amount = pct% de la carga con tope; `Config['installGift']` {enabled, pct, capArs, days},
  panel → Bonos automáticos) y manda `/sys_install_gift_offer` con `metadata.kind='install_gift_offer'`.
  La PWA (home.js `installGift*`) abre la hoja `#installGiftCard`: "Instalar ahora y reclamar" (navegador →
  `VIP.ui.installApp()` + defer; app instalada → claim) o "Ahora quiero jugar" (`POST /api/install-gift/defer`
  → status deferred + botón grande fijo abajo `#installGiftBar`, body.ig-pending). `GET /api/install-gift/status`
  al iniciar (hoja una vez por apertura si sigue offered; botón si offered/deferred; marca expired al vencer).
  `POST /api/install-gift/claim`: exige token FCM standalone (`_rouletteHasAppInstalled`), no vencida,
  anti-multicuenta por token, reserva atómica, `creditGift` (regalo bono 0) en la plataforma fija/última con
  API o girox, ref `vip-igift-<userId>`, Transaction `install_gift` (en `CASHBACK_GIFT_TX_TYPES`), mensaje
  `/sys_install_gift_credited` con `deposit_credited` (→ "Jugar ahora"). Falla de acreditación ⇒ vuelve al
  status anterior. En la carga manual la oferta reemplaza al cartel genérico `/sys_install_app`.
  **#275:** el mensaje de depósito acreditado (hgcash y manual) lleva `metadata.kind='deposit_credited'`
  (`platform, amount, bonus`); chat.js pinta "🎰 Jugar ahora" y home.js muestra la hoja `#playNowCard` si el
  mensaje es reciente (< 3 min). `VIP.home.playNow` abre la plataforma embebida (SSO si hay API).
  **#277/#278:** el modo LOGO se probó y se descartó: el Inicio carga la web de la plataforma en `#entryFrame`
  al entrar (`entryShowSite`), como en #267.
  servido en `GET /api/platforms` → `homeBanner:{pct,text}` y cacheado en `localStorage vip_home_banner`.
  En **full** el chat vuelve a ser overlay/burbuja; `closeSupport()` en mini = pasar a full.
  **#267:** tercer modo **play** = la ENTRADA (siempre al abrir la app; el modo elegido vive en
  `sessionStorage vip_home_mode`): `body.home-play` muestra `#entryView` (tabs de plataforma
  `renderEntryTabs` + iframe público `#entryFrame` de la plataforma elegida, fallback Girox/Ganamos fijos
  hasta que responda `/api/platforms`, "Abrir la plataforma ›" a los 15 s si no embebe) y abajo
  "Carga manual" (→ mini) / "Carga automática" (→ full). Al salir el iframe se vacía. `openSupport()`
  en play = mini. El cartel tiene el chip "🎰 Plataformas" para volver.
  **#370 (2026-10-17) — TEMA "PINTEREST":** `public/css/pin.css` (último `<link>`) re-mapea `--dx-*`/`--pr-*` y pisa con
  `!important` login, barra, Inicio, Menú fácil, home completo y modales en blanco / gris #f1f1f1 / texto #111 / acento
  rojo #e60023 (verde apagado sólo para plata). Los colores inline del HTML se re-mapean con `[style*=…]` de alcance
  positivo que excluye `#supportPanel` (la Carga manual sigue WhatsApp), `#rouletteModal` y el visor de historias.
  Regla: lo nuevo de la PWA se colorea con `--p-*`; para volver al tema oscuro se quita ese link.
  **#373 — SOPORTE (ex "Carga manual"):** el modo `mini` sigue siendo el chat (`#supportPanel`), pero la barra dice
  "Soporte", la cabecera muestra a Martín y arriba del chat va `#supportIntro` (presentación estilo Stake, chips que
  dejan texto en el campo, plazo de respuesta); textos `/sys_support_name|intro|sla` → `GET /api/platforms.supportIntro`.
  Ya no se manda el CBU solo al entrar ni hay botón CBU en el chat. El chat usa el estilo claro de `pin.css`.
  **#374 — Ruleta:** premios por defecto `ROULETTE_PRIZES_2026_10_18` (20/50/100% · $5.000 · $100.000 1 cada 1.000 ·
  sin premio), migración `migration_roulette_v4_done`; la carga de la semana que desbloquea debe ser ≥ carga mínima;
  `status.minDepositArs` alimenta los textos (`.rl-min`) y el modal muestra el premio mayor con su chance real.
  **#376 — CARGAS PENDIENTES (red de seguridad de la auto-carga):** todo comprobante válido queda
  `Comprobante.reviewStatus='pending'`; la auto-carga hgcash / la carga manual del mismo monto lo cierran
  (`confirmed`, auto | manual). Si el banco automático está apagado/sombra o pasan `Config['depositReview'].escalateMinutes`
  (8) sin acreditar, `_depositReviewEscalate` avisa al cliente ("un agente la está revisando") y el panel lo lista en
  "⏳ Cargas pendientes" (`/api/admin/deposit-reviews*`): Confirmar = `_agentDepositHandler` (la función de
  `POST /api/admin/deposit`, extraída para reusarla) · Rechazar = `/sys_deposit_rejected`. Duplicados → el cliente recibe
  `/sys_receipt_duplicate`. Cliente: `GET /api/deposits/pending` + socket `deposit_review_update` → franja "⏳ Carga pendiente".
  **#908 (2026-10-24) — REENVÍOS del mismo comprobante:** la cola agrupa con `_sameReceipt(a, b)` (mismo cliente y misma imagen /
  misma `dedupeKey` / mismo monto sin un N° de operación distinto / ambos sin monto): la ficha es el primer envío, los otros van en
  `repeats[]` (+`sentTimes`). Al resolver la ficha (auto, Confirmar, Rechazar) `_depositReviewCloseRepeats` cierra los demás como
  `rejected`/`reviewResolution:'duplicate'` sin avisar al cliente; "Es otra carga distinta" confirma un envío aparte (`keepRepeats:true`).
  Un flujo nuevo que resuelva un comprobante pendiente tiene que llamar `_depositReviewCloseRepeats` (si no, los reenvíos quedan
  pendientes, escalan y se pueden cargar dos veces a mano).
  **#377 — SOPORTE paralelo:** `Message.channel='support'` para lo que escribe el cliente y las respuestas de la columna
  "💬 Soporte" del panel (`/api/admin/support/conversations|agent`); el cliente ve sólo mensajes posteriores a
  `Config['supportChannelSince']`. La persona de turno (`getSupportAgentName`, `/sys_support_names`, 8 h por turno en
  hora AR) firma esas respuestas (`senderUsername` público, `metadata.agent` real) y aparece en la presentación de la app.
  **#366 (2026-10-17):** cuarto modo **easy** = MENÚ FÁCIL para quien se pierde con tantos botones. En CADA arranque
  (#367; y de nuevo tras ≥ 10 min en segundo plano, `_menuReaskInit`), `ui.showChatScreen` → `VIP.home.maybeShowMenuChooser` abre `#menuChooser` ("¿Cómo querés ver
  la app?" fácil / completo); la elección vive en `localStorage vip_menu_pref` ('easy' | 'full') y se cambia en
  Perfil ("☰ Menú fácil / completo") o con los links al pie de cada menú (`setMenuPref`). `body.home-easy` muestra
  `#easyView`: saludo + saldo (espejo de `#userBalance`), CARGAR AHORA (→ full), grilla Reembolso (% por período de
  `refundStatus.tiersByPeriod` + badge "¡Tenés $X para cobrar!" con `canClaim/potentialAmount`) · Ruleta · Referidos
  (`.ref-pct` desde `/api/referrals/me`) · Ver la plataforma (`openPlatform`), Carga manual · Ayuda (→ mini).
  `_easyPaint` repinta al entrar, cada 15 s y desde `renderHowItWorks`. "Inicio" llama `goHome()` (easy o play
  según la preferencia) y `_initHomeMode` arranca en easy si así lo eligió. Sin cambios de backend.
  **#268:** la cabecera es la barra `header.topnav`: Inicio (play, destacado) · Carga automática (full) ·
  Carga manual (mini) · Info (`#infoBtn`) · Perfil (`#profileModal`: usuario + clave guardada, Cambiar
  clave, Notificaciones = `#notificationBtn` del inline FCM, Instalar, Código, Canal `#canalTelegramHeaderBtn`,
  Fueguito `#fireBtn`, Soporte `#headerSupportBtn`, Más ajustes = settingsModal). Los círculos de #222 ya no
  existen; sus ids viven dentro del Perfil — no borrarlos.
  **#269:** orden de la barra: Carga automática · Carga manual · │ Inicio (retro, `.tn-retro`) │ · Info · Perfil.
  El Inicio lleva `#entryServices` (Reembolso con % real, Ruleta diaria, Referidos) arriba de las pestañas.
  `body.home-full` = carga automática SENCILLA: CSS esconde `.dash-top`, `#accessCard`, `#vipCard`,
  `.home-bottom-bar` y el cartel; el DOM queda intacto (los módulos siguen pintando ahí).
  **#270/#271:** el Inicio además pinta `#entryReviews` (`VIP.reviews.renderEntrySlider`, carrusel tipo Google).
  Perfil: usuario/clave/link + captura (`VIP.autoload.saveCapture` detecta el modal abierto → `pfCapture*`).
  Carga automática: alias (`#alAlias`) + titular, tarjetas de plataforma sin "Entrar" (tocar la fija la
  suelta), y `#fireHomeCard` (Fueguito diario, desde #272 debajo del saldo a todo el ancho) — es un espejo: el `#fireBtn` real
  sigue en Perfil y fire.js le cuelga el listener ahí. El cartel del chat es una frase (`/sys_home_banner`)
  con "Ir a carga automática".
  **#273:** `#verifyPhoneBanner` oculto por CSS (no borrar: auth.js lo referencia). Reseñas: 33 sembradas al
  boot (`seed-review-NN`, flag `migration_reviews_seed_v1_done`), promedio 4,70; carrusel con "Dejá tu opinión" primero.
  **#222:** cabecera = 5 círculos (Canal/Info/Código/Instalar/Clave), menú desplegable oculto; sin
  acordeón; carga compacta SOLO CBU, clave de solo lectura; barra `#casinoTopBar` dentro del casino
  (volver al menú de cargas + tabs de plataforma, `VIP.home.renderCasinoTabs`); chat = soporte en vivo
  sin CBU (bienvenida sin CBU suelto). Estilo premium negro/dorado al final de chat.css (`--pr-*`),
  pisado por el **tema diamante/futurista #223** (`--dx-*`: vidrio, cian/violeta, clip-path, Montserrat
  vía Google Fonts → CSP style-src/font-src ampliadas en server.js).
  **#221:** "¿Cómo funciona?" iba ARRIBA plegado (quitado en #222); abajo del botón RETIRAR está `.home-bottom-bar`
  (REFERIDOS | INSTALAR APP). El cartel del bono por instalar la app se eliminó de la PWA y el
  bono está APAGADO por flag (`Config['installBonusEnabled']`, panel → COMANDOS). La explicación
  completa del servicio la manda el chat (`/sys_como_funciona`, junto con la bienvenida).
- **Header del chatScreen** (2026-08-03): [botón Información | menú hamburguesa ☰].
  TODAS las acciones (referidos, soporte con ícono de auricular, notificaciones,
  instalar app, canal, configuración, logout) viven en el desplegable `#mainMenu`
  DENTRO del `<header>`. ⚠️ Los IDs de los botones son los históricos — el JS los
  cablea por id; el inline de FCM reescribe el innerHTML de `#notificationBtn`.
- **Barra de escribir estilo WhatsApp** (réplica de foto del owner): íconos SVG de
  trazo fino sin fondo (`.wa-icon-btn`) — tarjeta = CBU, cámara = foto — + send
  verde. El fueguito NO va ahí: vive en la cabecera del chat (`.fire-topbar-btn`
  en `.chat-topbar`, ids fireBtn/fireStreak intactos). Modo oscuro vía `body.wa-dark`.
- **FCM**: todo el manejo real (getToken 3 tiers, refresh, register-token) está en el
  INLINE de index.html; `window.sendFcmTokenAfterLogin` del inline pisa a propósito la
  de notifications.js. Firebase config duplicada en index.html Y en el SW (cambiar
  ambas). iOS: push solo en PWA instalada.
- SPA sin router: `#loginScreen`/`#chatScreen` + modales. Estado de login en globals
  `window._loginMode` etc. Interceptor global de fetch (auth.js) reabre el modal
  obligatorio ante 403 MUST_CHANGE_PASSWORD.
- Server-side rendering mínimo: `renderIndexHtml` reemplaza placeholders
  (`__META_PIXEL_ID_PLACEHOLDER__`, `__VIP_PUBLIC_BASE_URL_PLACEHOLDER__`,
  `__VIP_CAMPAIGN_CODE_PLACEHOLDER__`) con cache en memoria por proceso.
- **Botón CASINO** (`#plataformaBtn` → `VIP.ui.enterCasino()`): login único contra
  1girox. Ver la trampa del pop-up blocker en §4.9. El modal de acceso manual sigue
  existiendo, pero **sólo como camino de respaldo** cuando el SSO falla.
- Duplicados front/back a mantener sincronizados: mínimo retiro $4.999, bono $5.000,
  `VIP.config.PLATFORM_URL` = `https://1girox.com` (respaldo del SSO; también aparece
  hardcodeada en los mensajes `/sys_deposit*`, `/sys_bonus` y `/sys_welcome` sembrados
  en `initializeData()`), defaults de % de reembolso.
- **Perfil del jugador** (recuadro USUARIO → `VIP.refunds.showProfileModal`): nivel
  VIP con barra de progreso + botón de rakeback semanal + reembolsos por período
  (solo %) + escalera completa (viene de `GET /api/vip/status`, no se duplica). El
  rótulo del recuadro muestra la medalla del nivel (`updateDashVipBadge`).

### Panel admin (`public/adminprivado2026/`)
- `admin.js` (~12k líneas), auth mixta: login → Bearer en memoria + cookies httpOnly;
  `checkAdminSession()` (`GET /api/admin/me`) restaura sesión al recargar.
- Roles: admin ve todo; depositor (abiertos/cerrados); withdrawer (solo Pagos);
  comunidad (abiertos/cerrados/comunidad); **publisher_admin tiene vista propia**
  (`#publisherAdminSection`, early-return en setupRoleBasedUI, funciones `pa*`).
- Chat: `renderConversations` con coalescing rAF + delegación de eventos (#91);
  `selectConversation` → `loadUserInfo` → banners (bloqueo, fraude/multicuenta,
  fueguito 30%, tags/notas, payout pendiente con botones pay/other-bank/cancel/
  dismiss/sync, promo bonus). Races protegidas por `activeConversationId` +
  AbortController — **no romper ese patrón**. La cabecera muestra el nivel VIP del
  cliente (`user.vipLevelInfo`, resuelto por el backend) y la tabla de Usuarios la
  medalla junto al nombre.
- **Nombres legacy en la API de campañas** (deuda a propósito para no romper el panel):
  el body sigue mandando `jugayganaPassword` y el endpoint se llama
  `POST /api/admin/campaigns/:code/test-jugaygana-creds`, pero adentro se guarda y se
  prueba `giroxApiKey` (el panel valida que empiece con `pk_`). La respuesta del listado
  expone `hasJugayganaCreds` mapeado desde `hasGiroxKey`. El "probar login" ya no
  loguea: consulta un jugador inexistente — 404 = key válida, 401 = key rechazada.
- `public/admin-sw.js` (scope /adminprivado2026/; `CACHE_VERSION` se bumpea por release —
  ver el valor actual en el archivo, v52 al 2026-10-07): network-first no-store para el shell.
- Servido por handlers propios con cache en memoria (`readFileCached`) + ADMIN_HOST
  check opcional; el catch-all bloquea todo otro path bajo /adminprivado2026/.
- Secciones "Automatización" y "Estrategia de bonos" están marcadas "No se usa" en el
  sidebar pero siguen funcionales (candidatas a limpieza con el owner).
- La sección "Base de Datos" fue ELIMINADA por completo (2026-07-09): era inalcanzable.

## 7. Motores automáticos / crons (todos `setInterval` en server.js — corren en CADA instancia)

| Motor | Frecuencia | Estado | Idempotencia |
|---|---|---|---|
| `_runNotifRulesEvaluator` (reglas push) | 5 min | activo (reglas refund/tier inertes: PlayerStats no portado) | lastFiredAt + ventana |
| `_runEncuestaTick` | 5 min | pushes sí, **bonos apagados** (`bDays=[]`); sin mensajes de ruleta (2026-08-30) | EncuestaFire.slotKey único |
| `_runInactividadTick` | 6 h | **APAGADO** (`INACTIVIDAD_DISABLED=true`) | InactividadFire.fireKey único |
| `_runBonusStrategy` | 10 min | **APAGADO** (`BONUS_STRATEGY_DISABLED=true`) | step en StrategyEnrollment |
| `_runDueSchedules` (ScheduledNotif) | 60 s | activo | lastRunAt |
| `_platformChoiceTick` (multi-plataforma, #219) | 60 s | activo — preguntas "¿dónde querés jugar?" vencidas → carga en la última plataforma elegida / default | claim atómico `awaiting_platform → claiming` en BankMovement |
| `_pollPayingPayouts` | 45 s | activo (confirma pagos si el webhook no llegó) | handlePayoutStatusWebhook idempotente |
| `_runVipTick` (niveles VIP) | 30 min | activo (se apaga desde el panel: Config → "Niveles VIP", flag `vip_levels_disabled` en Config, SOLO admin general — sin cache a propósito para que aplique al instante en todas las instancias) | buckets con `$set` idempotente + bono con reference `vip-lvl-*` (la plataforma dedupe) |
| `_runVipSweepCheck` (sweep VIP) | 1 h (corre a las 05 ART) | activo | claim atómico por día en Config (`vip_sweep_day`) → instancia única |
| `_runFcmPrune` | 24 h | activo | flag anti-overlap en memoria |
| `fbAdsWebhook.startWorker` | 5 min | activo | nextRetryAt |
| Limpieza mensajes >3d | 6 h | activo (red de seguridad del TTL) | deleteMany |

Migraciones one-shot: patrón flag en Config (`migration_*_done`) en `initializeData()`.
El backfill de `usernameLower` corre en CADA arranque (idempotente) y setea
`_usernameLowerReady`.

## 8. Convenciones importantes

- **Mensajes automáticos al usuario** → `renderSystemCommand(name, fallback, vars)` y
  sembrar el comando en `systemCmds` de `initializeData()`. Respuesta VACÍA en el panel
  = "no enviar" (null). Variables: montos como `${amount}` en el template y se
  reemplaza `{amount}` (el `$` queda como signo); texto como `{username}` sin `$`.
  **Un % de bono NUNCA va hardcodeado en un texto** (owner 2026-09-17: varía según el
  mes/día): guardarlo en Config, exponerlo como variable (`{pct}`) y, si el cliente lo
  tiene que ver en la PWA, mandar el texto YA renderizado desde el backend (patrón del
  cartel del bono por instalar la app). `_renderVars(template, vars)` renderiza un
  default sin ir a la base.
- **Identidad**: `user.id` (uuid), no `_id`. Username case-insensitive →
  `findUserByUsernameCI` (indexado + fallback), NUNCA regex nuevo.
- **periodKey**: `YYYY-MM` (referidos y VipWagerMonth); RefundClaim usa
  `weekly:YYYY-MM-DD` / `monthly:YYYY-MM` / `rake:YYYY-MM-DD` (lunes de la
  semana del rakeback VIP). (`daily:YYYY-MM-DD` sólo en claims históricos: el
  reembolso diario se eliminó el 2026-08-07.)
- **Montos 1girox: PESOS.** Se envían tal cual (2 decimales), y los balances y el netwin
  del panel vuelven en pesos. **NO multiplicar ni dividir por 100** — el ×100 de
  centavos era de JUGAYGANA y ya no existe.
- **Toda operación de plata lleva `reference`** estable y persistida (§4.4). Reintento
  ⇒ MISMA reference. Chequear `result.duplicate` antes de dar un pago por bueno.
- **Todo lo fire-and-forget** (tracking, comprobantes, fanout, SLA) va en try/catch y
  JAMÁS frena la respuesta al cliente — mantener ese patrón.
- **Crédito de plata al cliente = RESERVAR ATÓMICO ANTES de acreditar** (nunca acreditar
  y limpiar el flag después → TOCTOU/doble cobro). Patrón: `findOneAndUpdate` con guard
  del flag (ruleta, bono instalación, fueguito claim-reward) o `create` con índice único
  (reembolsos). Si el crédito falla, revertir la reserva. Ver #96.
- **Bonos en % NUNCA se aplican a mano** (2026-09-18): todo bono pendiente en % entra por
  `resolveAutoBonus` en la carga (manual y hgcash) con el tope de `bonusCap`. Una fuente
  nueva de bono en % ⇒ sumarla ahí (claim atómico + revert), no un banner para el agente.
- **Endpoints muertos**: se eliminan con comentario-lápida y rollback `git revert`.
- **Validación local**: sólo `node --check` (no hay node_modules en Tails).

## 9. Trampas / "no rompas esto"

- **Multi-plataforma (#219):** la auto-carga hgcash YA NO acredita directo si hay 2+ plataformas
  habilitadas: pregunta y deja el movimiento en `awaiting_platform` (lo resuelve el cliente, el
  agente o el timeout). Un flujo nuevo que mueva plata "a la plataforma" debe resolver el adaptador
  con `platforms.getAdapter(id)` y escribir `Transaction.platform`; lo que sigue llamando `girox.*`
  directo (reembolsos, VIP, lotes, referidos…) es **sólo girox a propósito** (fase 3). El estado
  `redirected` = la plata se cargó en OTRA página (no hay Transaction local). Ver §4.10 y PLATFORMS.md.

- **Usernames de 1girox: únicos GLOBALES, visibilidad POR RAMA** (caso gxdaiana323,
  2026-09-07): un nombre puede estar tomado por un jugador de OTRA estructura que
  nuestras keys no ven ni operan. `syncUserToPlatform` devuelve
  `username_taken_foreign` en ese caso y TODOS los altas (registro, panel,
  publicista) FALLAN sin dejar cuenta local — jamás crear una cuenta 'linked' a un
  jugador que la key no puede leer.
- **DOS `connectDB`**: el real es `config/database.js`; el de `src/models/index.js` NO
  se usa. No definir schemas en config/database.js.
- **Secrets por SSM**: no leer `process.env.X` al require; lazy getters. Los módulos
  `girox*` ya siguen ese patrón (getters + cliente HTTP on-demand); los 4 clientes
  viejos congelaban `process.env` en consts de módulo — no copiar ese patrón.
- **Código muerto de JUGAYGANA**: `jugaygana.js`, `jugaygana-movements.js`,
  `jugayganaService.js`, `jugayganaPublisherSessions.js`, `referralRevenueService.js` y
  `jugayganaUserLinkService.js` siguen en el repo pero **nadie los importa** (sólo se
  importan entre ellos y desde `scripts/_archive/`). Están para revertir. No agregarles
  llamadas nuevas ni "arreglarlos".
- **Montos en PESOS** — el ×100 murió con JUGAYGANA (§8).
- **`reference` = plata** (§4.4): repetida entre operaciones distintas ⇒ la segunda NO
  se acredita (vuelve `duplicate:true`); cambiada entre reintentos del mismo pago ⇒ se
  paga dos veces. La del reembolso sale del **periodKey**, no del RefundClaim.id (si
  saliera del id, el reintento tras un fallo falso pagaría doble).
- **Retiros: validar contra `available`, no `balance`** — el rollover está activo en
  1girox y parte del saldo puede estar bloqueado (§4.5).
- **Regalos = BONO 0, NO depósito** (2026-09-07): para acreditar un regalo usar
  `creditUserBalance` (bono 0 con precheck y fallback — §4.5), NUNCA `depositToUser`
  directo (figuraría como Carga en 1girox). El kill switch es
  `GIROX_GIFT_AS_BONUS=0`. La devolución de retiro rechazado es la excepción
  (plata real que vuelve → depósito). Tipo nuevo de Transaction en el panel ⇒
  etiqueta en getTransactionTypeLabel + botón de filtro + case del resumen (§6).
- **Rate limit 60/min es POR INSTANCIA** (`GIROX_MAX_RPM`, default 55): con N instancias
  el techo real es N×55. Si aparecen 429, BAJAR el valor (§4.3).
- **El netwin sale de la Partner API por username** (§4.6; 🪦 el scraping del panel
  con `giroxReportsService` y el gate por `giroxUserId` se fueron el 2026-07-31). Es
  **sólo casino** (`GIROX_NETWIN_SCOPE`) y POSITIVO = perdió.
- **Reembolsos = sobre plata REAL** (2026-09-11, ESPEC-REEMBOLSO): la base SIEMPRE
  descuenta lo regalado (`bonus.granted` oficial y/o nuestras Transactions de regalo).
  Al agregar un tipo nuevo de regalo (Transaction) sumarlo a `CASHBACK_GIFT_TX_TYPES`
  (server.js) o el acumulativo lo reembolsaría. El reembolso acumulativo cobrado
  cuenta como regalo (sin "reembolso del reembolso") — no excluirlo. El índice
  único de `CashbackClaim` (`userId+dateKey+seq`) y el plegado condicionado al ancla
  son la idempotencia multi-instancia: no tocarlos.
- **Credenciales hgcash: panel > SSM, cifradas con `JWT_SECRET`** (#215): rotar
  `JWT_SECRET` deja ilegible `Config['hgcashCredentials']` (el server cae a SSM y loguea
  ERROR; hay que recargar token+secreto en el panel). El webhook valida contra TODOS los
  secretos disponibles (`_hgcashWebhookSecrets`) — no volver a leer
  `process.env.HGCASH_WEBHOOK_SECRET` directo. `Config` baja las keys a minúsculas y
  Mongoose las castea también en los filtros: `Config.set` / `getConfig` /
  `Config.deleteOne` sobre la misma key coinciden; no cambiar ese `lowercase:true`.
- **Message TTL 3 días; Transaction permanente.** Snapshot en ChatDelay por eso.
- **ChatStatus se crea con actividad**, no al crear el usuario.
- **Atribución de publicista** se fija al registrar; el login NO la cambia. El referido
  (`?ref=`) tiene prioridad sobre publicista en el front.
- **publisher_admin**: endpoint nuevo para ese rol ⇒ sumarlo a
  `PUBLISHER_ADMIN_ALLOWED_PATHS`.
- **`adminMiddleware` deja pasar 4 roles** — todo endpoint sensible re-chequea
  `role==='admin'` explícito (patrón #80; los CRÍTICOS ya están cerrados).
- **Bono automático = una sola fuente por carga y con tope**: `resolveAutoBonus` reserva
  atómico y `revert()` si falla; el bonus tipeado por el agente se pisa cuando hay bono
  pendiente (nota interna). No volver a poner "avisale al agente" en los textos.
- **NADA de RULETA por push** (owner 2026-08-30): la ruleta diaria no está activa.
  `notificationService.isRouletteText()` bloquea en las 5 funciones de envío FCM
  cualquier push cuyo título/cuerpo mencione ruleta/roulette/giro gratis/girá (o
  `data.source` roulette) — venga de un motor, de una regla/plantilla/lote editado
  en el panel o de un envío manual. Al boot, reglas y plantillas guardadas con
  ese texto se corrigen/desactivan. Si se reactiva la ruleta, quitar ese guard.
- **Tope 30% en bonos automáticos** (owner 2026-07-08): cap de lectura en
  `_getActivePromoBonus`, validaciones ≤30 en configs, plantillas bono_50/100
  eliminadas + guard en `_runStrategyLaunch`. Los botones manuales +50/+100 del modal
  de depósito QUEDAN (herramienta del agente).
- **Multi-instancia**: crons corren en cada instancia — la idempotencia vive en los
  índices únicos (slotKey, fireKey, chargeKey, userId+dateKey) — ahora reforzada por la
  `reference` de 1girox del otro lado. No dropearlos. La blacklist JWT de
  src/middlewares/auth.js, `generalLimiter` y el limitador de RPM de `giroxService` son
  por-instancia.
- **USERS_LIST_FIELDS** (`GET /api/admin/users`) y la proyección de
  `AUTH_USER_FIELDS` (authMiddleware): campo nuevo consumido ⇒ sumarlo al select.
- **#831 — entrar logueado tras el registro:** `/api/auth/access-link` tiene 30 min de gracia para links de landing/instalación
  (`accessLinkGraceHash`); la PWA reintenta el canje y `verifyToken` (nunca borrar `userToken` por un corte: sólo con 401/403) y, si
  todo falla, `_loginWithSignupCreds` usa `sessionStorage.vip_signup_creds` que deja la landing del mismo dominio.
- **#862 — SSO de 1girox:** cada `/session` nuevo ANULA el anterior del mismo jugador: el último pedido es el que debe ir al recuadro.
- **#861 — SSO de 1girox:** el código de `/session` es de UN SOLO USO. Si el server lo canjea (`/sso/exchange`), NO pasárselo al recuadro:
  para el recuadro pedir otro `/session`. Recargar el recuadro tras el login pierde la sesión de la web (usar `launch_url` del juego).
- **#846 — jugadores de publicista:** nunca crearlos al vuelo con otra key (`setPublisherOwnedCheck`); toda carga sin bono va con `no_bonus`
  (si no, hereda reglas automáticas del panel de 1girox).
- **#839 — carga con bono:** usar SIEMPRE `_depositWithBonus` (nunca `depositToUser` con bonusAmount directo): maneja el 422 por el bono
  (repite sin bono con `no_bonus`) y el bono fallido (lo acredita aparte con `creditGift`).
- **#837 — OTP:** un `purpose` nuevo de `generateAndSendOTP` va también al enum de `src/models/OtpCode.js` (si no, ValidationError ⇒ 500 sin SMS).
- **#829 — UN error en un js de la PWA tumba TODA la app:** se sirven concatenados en un solo `/js/bundle.js`, así que un throw al cargar
  (ej. `VIP.ui.x = …` DENTRO del IIFE que define `VIP.ui`, cuando todavía es undefined) corta todo lo que viene después (app.js incluido:
  queda colgado "Entrando a tu cuenta…"). Exportar siempre en el `return` del módulo.
- **onclick inline** en panel y PWA dependen de `window.*` — no renombrar exports sin
  actualizar los strings. En `renderUsers` las comillas SIMPLES del onclick con JSON
  son a propósito.
- **CACHE de assets por proceso** (`readFileCached`, `_indexHtmlBase`,
  `_adminHtmlRendered`): index.html/admin.js/css se leen 1 vez por proceso — cambios
  llegan con el redeploy (que reinicia). No agregar contenido dinámico por-request al
  HTML sin pasar por `renderIndexHtml`.
- **Firebase config duplicada** (index.html + firebase-messaging-sw.js) y VAPID key en
  el inline: cambiar en ambos lados.
- **`Campaign.hasGiroxKey` es un espejo** de `giroxApiKey` (que es `select:false`):
  cualquier camino que escriba o limpie la key TIENE que actualizar el booleano, o el
  panel muestra el badge equivocado.
- **Trampa del pop-up blocker en el botón CASINO**: la pestaña se abre ANTES del fetch,
  dentro del gesto del usuario. Mover el `window.open` después del `await` rompe el SSO
  en mobile (§4.9).
- **`GET /api/movements` quedó sin backend**: la Partner API no expone historial de
  apuestas/movimientos, así que `girox.getUserMovements()` devuelve siempre
  `not_supported` (explícito a propósito, para fallar claro en vez de con un TypeError).
  El endpoint responde 400. Si alguien lo necesita, hay que pedirlo a 1girox o sacarlo.
- **`_communityRecommendCard` (roulette.js)**: feature pedida por el owner que nunca
  se conectó — lee `VIP.state.communityLink*` que nadie setea (el wiring real de
  comunidad es `loadCommunity()` inline → `/api/config/community`). Es MEJORA
  PENDIENTE (reconectar seteando VIP.state desde loadCommunity), no código muerto.
- **`checkUsernameAvailability` (PWA)**: existe pero no se dispara — mejora pendiente.
- **vercel.json es un artefacto** de un deploy anterior; el deploy real es AWS EB.
- **Env DB_PASSWORD ya no se usa** (sección Base de Datos eliminada 2026-07-09).

## 4.10 Multi-plataforma (#219, 2026-10-16) — ver `docs/PLATFORMS.md`

- **Registro `src/platforms/index.js`:** adaptadores `girox` (envoltura de giroxService) y `ganamos`
  (esqueleto con el mismo contrato; `isConnected()` = env `GANAMOS_API_URL`+`GANAMOS_API_KEY`).
  Settings en `Config['platforms']` (`askMode` always/first_time/never, `askTimeoutMin`,
  `defaultPlatform`, `items.<id>` {enabled, name, emoji, order, externalUrl}), cache 30 s por proceso.
- **Flujo de carga:** `hgcashAutoCarga` → `platforms.decideForDeposit(user)` → pregunta
  (`_platformAskUser`, movimiento `awaiting_platform`, mensaje con `metadata.kind='platform_choice'`)
  o carga directa → `_hgcashCreditToPlatform({platformId})` (candado coelsa + red de seguridad +
  `adapter.depositToUser` con reference `vip-hg-*` + Transaction.platform + `User.lastPlatform`).
  Plataforma sin API → `_platformRedirectUser` (movimiento `redirected`, link externo, sin Transaction).
  Resolución: `_resolvePlatformChoice` (claim atómico) desde `POST /api/platform-choice` (cliente),
  `POST /api/admin/hgcash/movements/:id/platform` (agente) o `_platformChoiceTick` (timeout).
- **Carga manual / retiros / SSO** aceptan `platform` y resuelven el adaptador (`PendingPayout.platform`).
- **Sólo girox todavía:** reembolsos, acumulativo, VIP, rakeback, ruleta, lotes, referidos, bono app.

## Cronograma de campañas programadas (#218, réplica del #190 de AUTOREEMBOLSOSjygactivo)

- **Modelo `ScheduledCampaign`**: `payload` = body exacto del POST de lotes, `parts[]` (tandas con
  `runAt`/`status`/`usernames`/`batchId`), `paused/cancelled`. Estado de la campaña derivado al leer.
- **`_createNotifBatchFromBody(body, user)`**: el cuerpo del `POST /api/admin/notif-batches` (stub de
  `res` → `{http, body}`). El endpoint y el programador llaman a la misma función: toda validación o
  efecto nuevo del lote va AHÍ.
- **Motor `_schedTick`** (setInterval 60 s en cada instancia): claim posicional
  `parts.$.status scheduled→sending`, crea el lote, marca sent/error; tanda colgada >15 min → error.
  Tandas: audiencia resuelta una vez y repartida sin repetir; cada tanda = lote `list`.
- **Rutas** `/api/admin/cronograma*` (+ `/api/admin/cronograma-report?month=`). `/api/admin/campaigns`
  es de publicistas: no reusar.
- **Rangos de audiencia**: `_notifInactiveRange` sobre la audiencia "inactivos"; campos `audienceDaysMax/dateFrom/dateTo/audienceLabel` en NotifBatch.
- **Panel**: sección 📅 Cronograma (calendario, lista con acciones, edición, comparativo semanal) +
  bloque "📅 Cuándo sale" en el formulario del lote.
- **#293 Planes de estrategia** (`StrategyPlan`: items {day, time, parts, gapHours, name, payload}; rutas
  `/api/admin/cronograma-plans` GET/POST/PUT/DELETE, `/from-month` arma el plan con lo del mes, `/:id/apply`
  programa el mes — ScheduledCampaign.notes = 'Plan "<nombre>" (aplicado a YYYY-MM)' es lo que agrupa el
  reporte por plan). **`_batchImpact(batch, depMatch)`**: primera carga 48 h · todas las cargas 48 h · extra
  del mismo día · 7 días · repetidores vs una sola · recuperados por antigüedad sin cargar (nunca/<10/10-19/
  20-29/30+ → al otro día / 48 h / 7 d / siguen activos). Lo exponen `GET /api/admin/notif-batches/:id`
  (`impact`) y `cronograma-report` (campañas, `weeks`, `days`, `plans`, `bestWeek7d`, recomendaciones).

- **#813 Retención app** (la plantilla de 8 envíos se eliminó en #819; queda el autopiloto #817): filtros de audiencia `appOnly` (token standalone, permiso ≠ denied) y `monthlyCap` (lotes recibidos en el
  mes ART, `_notifMonthCounts`) en el wrapper `_resolveNotifBatchAudience` → aplican a lotes, cronograma y planes. Plantilla
  `_batchImpact` agrega `before48h` (línea base de los mismos clientes) ⇒ `lift48h` en el reporte; el panel lo pinta por día y por lote.
  App: `.promo-live` (CARGAR AHORA + tarjeta de carga) desde `js/promobonus.js`.

## #824 Análisis de la estrategia de notificaciones
`GET /api/admin/cronograma-analysis?day=YYYY-MM-DD|month=YYYY-MM` (default ayer) → `_notifAnalysis` (cache 5 min por rango; `_batchImpact` +
`_notifBatchPeople` por lote + ventas reales totales del rango). Panel: `loadNotifAnalysis` / `_naRender` (tarjeta `#naCard` arriba del Cronograma).

## #820 Robustez de cargas y retiros
- Retiros: externalID `<id>+extSuffix` (nuevo sufijo `-rN` sólo tras rechazo confirmado del banco); timeout ⇒ `hgStatus:'UNKNOWN'` (mismo
  externalID); webhook ignora intentos viejos y no pisa `cancelled`/`other_bank`; poller 48 h por `updatedAt`; `w.duplicate` en el descuento =
  confirmado; `_payoutRetrySafe`; aviso `/sys_withdraw_delayed` (`clientDelayNotifiedAt`).
- Cargas: rematch en `status_change`; `_nameMatch` por palabras; `_depositReviewConsume` sólo mismo monto; Confirm con `_reference` del
  movimiento y exclusión mutua con `claiming`; `_hgcashRecoveryPass` (libera `claiming` >10 min, rematch cada 3 min).

## #816/#817 Cronograma: personas por envío + AUTOPILOTO
- `GET /api/admin/notif-batches/:id` → `recipients[].dep48*`, `summary.recibieron/sinNotis/fallaron/cargaron48`, `timeline {used[], firstDep[]}` (48 h).
  `GET /api/admin/cronograma/:id/audience` = audiencia de una campaña no enviada. Panel: `cronPeopleToggle` / `_cronPeopleRender`.
- Autopiloto: `Config['retentionAutopilot']`, `_autopilotMonthItems` (reglas + `arCalendar.specialDays`), `_autopilotProgramMonth`
  (`ScheduledCampaign.autoKey` único), `_autopilotTick` cada 3 h (mes en curso + siguiente), `_autopilotClearFuture` (sólo campañas con todas las
  tandas 'scheduled'). Filtro `rotGroup {n,k}` en `_resolveNotifBatchAudience` (`_rotGroupOf` FNV-1a). Rutas `GET/POST /api/admin/cronograma-autopilot`.

## #814 Soporte desde Chats + reintento de retiros automáticos
- Todo mensaje de agente a cliente (REST y socket) lleva `channel:'support'` y firma de turno; excepción: el texto del comando en REST. Las
  respuestas de comandos de agente van al canal. El filtro del cliente (`GET /api/messages`, socket.js) no cambió.
- Retiros: `needsReview = amount > payoutReview.minArs` ($100.000). `_payoutAutoFailNote` (nota interna) y `_payoutAutoRetryTick`
  (5 min; casos seguros; `PendingPayout.autoRetries`, tope 6/24 h). Alerta de banco automática: no pausa solicitudes, umbral 3.

## Datos IA (#459 → #477, 2026-10-18) — `src/services/datosIaService.js` + rutas `/api/admin/datos-ia/*`

Análisis del negocio **por reglas, sin IA externa**, a partir de Transaction / User / AppSession / RefundClaim /
DailyRouletteSpin / Message. Panel → "🧠 Datos IA" (pestañas Análisis · Comparativa · Panorama de inversión · Historial).

- **Rendimiento (#477):** NUNCA bajar movimientos sueltos (30 d ≈ 30.000 cargas). Todo se agrupa en Mongo: por período en
  hora argentina (`bucketExpr`: `$dateToString`/`$dateTrunc` con tz −03:00) y por usuario; la cohorte (primera carga en el
  rango) sale de una agregación sobre todas las cargas reales (`$sort` + `$group` por userId con `$push` de fecha+monto sólo
  para la cohorte, `$$REMOVE` para el resto). Cache 5 min por proceso. 90 días ≈ 10 s en Render.
- **Regalos:** tipos `bonus, refund, roulette, fire_reward, rakeback, vip_levelup, install_gift, referral_commission`,
  separados entre **nuevos** del período y **recurrentes**; `netwinNeto = netwin − regalos`; `tasaReclamoReembolso`.
- **Condiciones vigentes** (`_diaPromoConfig` en server.js): bono 1ª carga, carga automática, ruleta (% extra promedio por
  giro), reembolsos por período, extra por instalar, tope del bono.
- **Panorama (`project`)**: la lógica completa está en el comentario del código. Base real (desde el inicio o N días, gasto:
  escrito > `Config['adSpendTotal']` > `Config['adSpend']` prorrateado) → condiciones futuras (los regalos se CALCULAN con los
  % futuros) → inversión X en N días → 3 panoramas (±30 % en nuevos) + base actual + `explicacion[]` (cierre paso a paso).
  Cada cálculo se guarda en `DatosIaSnapshot` (nota del owner, revisión contra lo real, calibración).
- **Moneda:** `Config['usdtRate']` (manual o `?fetch=1` desde criptoya); `cur=usd&usdRate=` en análisis y panorama hace que
  los textos del server salgan en USDT; el panel convierte el resto (`_diaM`, `localStorage dia_cur`).
- **Medidor de uso:** la PWA pinguea `POST /api/activity/ping` cada 60 s (gap > 3 min = sesión nueva) → `AppSession`.


## Referidos 2.0 (#529, 2026-10-19) — réplica del gemelo PAUTANUEVAsantino

- **Tasa:** `referralTierService.resolveReferralRate(user, {activeCount})` → override por usuario > niveles por referidos ACTIVOS
  (`Config['referralMilestones']`: `{enabled, minChargedARS, basePct, tiers:[{count,pct}]}`, apagados por defecto acá) > % plano
  (`Config['referralCommissionPct']`, panel → Referidos). Es la ÚNICA función con la que se calcula (`referralCalculationService`) y se
  muestra (`/api/referrals/dashboard`, panel).
- **Pago automático:** `_runMonthlyReferralPayout` (server.js) el día 1 ART por el mes anterior; reserva idempotente
  `Config referral_autorun_<YYYY-MM>`; Calcular → Pagar con `adminUsername 'auto-referidos'`. El cobro manual (#240) sigue existiendo.
- **Tablero del cliente:** `GET /api/referrals/dashboard` (link `/?ref=CODE`, nivel, tabla por referido con netwin del mes leído de
  1girox vía `getReferredNetwinForRange`, cache 15 min, tope 60). No llamarlo masivamente: consulta la Partner API por referido con cargas.
- **Admin:** `GET /api/referrals/admin/activity` (sin 1girox), `GET /api/admin/referrals/:userId/netwin` (en vivo),
  `GET/POST /api/admin/referrals/milestones-config`, `GET/POST /api/admin/referral-rate`.
- **Front:** `ui.js` bloque Referrals (`openReferralModal`, `maybeShowReferralPromo` 1×/24 h, `shareReferralLink` chooser), `app.js`
  guarda `?ref=` 30 días (`localStorage vip_ref`) y lo fija en el registro; `/linkreferido?ref=` redirige a `/?ref=`.
- **Copy:** "comisión por la ACTIVIDAD de tus referidos", nunca "lo que pierdan". Sin % hardcodeado en HTML (sale del dashboard).

## Webhooks salientes a publicistas (#562, 2026-10-19) — `docs/ESPEC-WEBHOOKS-SALIENTES.md`

- **Qué:** POST JSON firmado (`X-Webhook-Event/Id/Timestamp/Signature`, HMAC-SHA256 de `"{ts}.{body}"`) a hasta 10 destinos
  (`Config['outboundWebhooks'].destinations[]`, secreto cifrado con `_credEncrypt`). Eventos `registro` y `primera_carga` siempre;
  `carga` y `retiro` opcionales por destino; alcance `all` o lista de publicistas/códigos (resuelto por `metaCapi.resolveEventScope`).
  **Píxel en el navegador de la landing (#797):** `GET /api/meta-pixel-id?c=<campaña>` → `metaCapi.pixelIdsForCampaign` (env/SSM
  `META_PIXEL_ID_n` + `META_PIXEL_PUBLISHER_n` con códigos/publicistas/`*`; `META_PIXEL_CAPIONLY_n=1` = sólo CAPI). La landing carga
  `fbq` con esos ids y el registro dispara `CompleteRegistration` con `eventID = metaEventId` (= `event_id` de la CAPI) para deduplicar.
  El payload NO lleva username (sólo `user.id`).
- **Servicio:** `src/services/outboundWebhookService.js` (`notify(event, user, opts)` fire-and-forget; 3 reintentos 1/4/16 s; cola
  `OutboundWebhookQueue` reintentada cada 5 min hasta 10; 4xx no se reintenta). `_isFirstDeposit(userId, {unrecorded})` decide
  `primera_carga` (= exactamente 1 depósito real; `payout_refund` no cuenta).
- **Hooks:** registro (3 altas), carga manual (A), auto-carga banco (B), self-service (C, `unrecorded`), retiro pagado (D). **Un flujo nuevo
  de registro o de carga acreditada tiene que llamar `outboundWebhook.notify(...)`** con `transactionId` estable (es el `event_id`).
- **Panel:** Configuración → "🔗 Webhooks salientes" (`/api/admin/webhooks*`, sólo admin general): alta/edición, prueba, formato para
  pasarle al publicista. Rotar `JWT_SECRET` ⇒ secretos ilegibles ⇒ recargarlos.

## Confirmación de pagos (#566, 2026-10-19)

- `Config['payoutReview']` `{minArs, autoBelow}` (`getPayoutReviewConfig`). En `POST /api/withdrawal/request`, tras crear el `PendingPayout`:
  ≥ umbral ⇒ `reviewRequired:true` (lo revisa una persona en Panel → Confirmación de pagos); < umbral y hgcash configurado ⇒
  `autoPay:true` y `_payPendingPayout(id, PAYOUT_AUTO_ACTOR, getPublicBaseUrl())` en background (misma función que `/api/admin/payouts/:id/pay`).
- `GET /api/admin/payouts/review` (withdrawer+): pendientes/fallidos con `risk` (cargas, retiros, antigüedad, celular, flags, CBU compartido)
  y `warnings`. `POST /api/admin/payouts/review-config` (admin). Aprobar/rechazar reusan `/pay` y `/cancel`.
- ⚠️ Un cambio en el flujo de pago va en `_payPendingPayout` (lo usan el botón y el automático).


## Anexo 2026-10-21 — cambios #666 a #681 (ruleta, menús, iPhone, guías)

- **Ruleta (#677):** el gate "activo" (`_rouletteIsActiveThisWeek`, nombre histórico) suma las cargas reales de HOY (día ART) y
  exige `Config['dailyRoulette'].minDepositArs` (default `ROULETTE_MIN_DEPOSIT_DEFAULT` 10.000; 0 = carga mínima general); `status`
  devuelve `todayLoaded`. Pesos default `ROULETTE_PRIZES_2026_10_18`: +20% 50 · +50% 22 · +100% 3 · $5.000 4,9 · $100.000 0,1 · nada 20
  (#679). **Lista de ganadores (#666/#667):** `/api/roulette/recent-winners` mezcla ganadores reales del día (plata y % extra) con
  entradas de ejemplo determinísticas por `dateKey` (`_rouletteSimWinners`, memo 60 s #681; turnos cada `Config['rouletteFeedSim'].slotMin`
  min sorteados con los pesos reales; `{enabled:false}` las apaga); nombres "***cas12*". Premios resumidos en una línea (#668).
- **Menús (#670/#678):** 4º menú `girox` ("Girox directo") en `MENU_ORDER`/`Config['menusEnabled']`: modo play + `_giroxDirect()` →
  `openPlatform(pref|girox, { embed: true })` (casino embebido con SSO aunque no sea standalone) + Carga rápida con botón **Retirar**
  (`VIP.home.casinoWithdraw` → `#withdrawModal` z-index 100001 sobre el overlay 99999). NO se guarda como `vip_menu_pref` salvo "Dejar fijo".
- **iPhone con sesión (#673):** `GET /manifest.json?a=<token>&menu=…&fixed=1` (ruta ANTES de `express.static`) pone el `start_url`;
  `POST /api/auth/install-link` emite un token de acceso de un solo uso con `User.accessLinkPurpose='install'` (el canje no fuerza
  cambio de clave); home.js `installManifestSync` (sólo iOS no standalone; cache 7 d en `vip_install_tok`); auth.js `tryAccessLink`
  guarda `menu`/`fixed` e ignora `?acceso=` si ya hay `userToken`.
- **Guía de primera carga (#675):** `#firstGuide` (Inicio completo, flecha a `#evCtaTop`) y `#firstGuideBasic` (básico, flecha a
  `#bvLoadBtn`), visibles con `noDeposits` de `/api/first-deposit-promo`, ✕ = `localStorage vip_fguide_off`.
- **Historias (#674/#676/#680):** 8 fotos `st2-*.png` (orden: instalar · cargá · referidos · reembolsos · ruleta · misiones · Telegram ·
  SMS), link `app:instalar` → `VIP.appTest.doInstall()`. Generador: `scratchpad/gen_stories.py` (no está en el repo; cada foto se
  regenera con su argumento `install|sms|ruleta|telegram`).
- **Seguridad (#665):** `app.use('/api/admin/datos-ia', authMiddleware, adminMiddleware, gatePin)` — la clave se pide DESPUÉS del login.
- **Casino (#695):** `ui.js enterCasino` espera 4×30 s y el error dice el motivo (`_fetchCasinoSession` devuelve `status`/`timedOut`);
  en Render el arranque en frío (~50 s) y los redeploys son la causa típica del "No pudimos abrirte el casino".

## Sorteos con ranking en vivo (#915) — `src/services/sorteos.js` + `_sorteoTick` (server.js) + `public/js/sorteos.js`
- **Modelos:** `SorteoEntry` (anotado: userId+key único, checks al anotarse, telegramDeclared) · `SorteoScore` (key+periodKey+userId único; points =
  basePts + dayPts + missionPts, wagered, realShare, deposits, joined, eligible). Config: `Config['sorteos']` (normalizada con defaults),
  `Config['sorteoDraws']` (premio extra sorteado), `Config['sorteoDiag']`.
- **Período:** mensual = mes calendario ART desde `startMonth` (`periodOf` → soon/live/closed, publishAt = día 1 siguiente 12 h); gran = `start`..`end`.
- **Puntos:** `computePoints` — pts por cada ptsPer apostados × realShare (cargas / (cargas + bono otorgado), stats de 1girox); gran suma días con
  cargas ≥ mínimo y % por semanas con `MissionClaim`. Ranking: points desc, wagered desc, primera carga asc.
- **Motor:** cada 20 min; candidatos = clientes con carga real en el período (sin PRUEBA); stats por batch (≤100, tramos ≤85 días); un fallo del batch
  deja los puntajes como estaban. Sólo anotados pueden ganar; el ranking público muestra a todos con nombre tapado (`mask`), el propio completo.
- **Requisitos para anotarse** (`_sorteoChecksOf`): app instalada (token FCM standalone), notificaciones (token), Telegram (declarado), una carga real.
  Toggles en `config.requirements`. Un requisito nuevo va ahí y en `_sorteoMissing` + checklist del front.
- **Fotos de premios (#967):** `SorteoImage` (buffer en la base) + `POST /api/admin/sorteos/prize-image` (base64, ≤600 KB) y `GET /api/sorteos/img/:id`;
  el `img` de un premio puede ser emoji, ruta `/images/...`, URL https o `/api/sorteos/img/<id>`.
- **Front (#928/#933):** tocar una mitad DESPLIEGA el sorteo ahí mismo (`openInline`, panel `.srt-inline` con ✕, Bases adentro); el recuadro de la barra
  del casino abre una HOJA RESUMIDA (`openMini`: contador, 3 premios, 2 líneas, "Ver más en el menú" ⇒ `goMenu` cierra el casino y despliega en el
  menú). La pantalla completa `#srtModal` queda de respaldo.
- **Front:** contenedores `[data-srt-cards]` (básico e intermedio) y `[data-srt-banner]` (Girox directo, sólo `body.home-play`), pantalla `#srtModal`
  con capa `#srtTerms` (Bases, ✕ arriba a la izquierda). Verde: tokens `--srt-*` en pin.css (claro + dark).

## Cierres diarios y arqueo (#500 → #913) — `DailyClose`, `_closeEnsure` / `_closeApply` / `_closeReconcile` (server.js)
- Uno por día ART (`dateKey` único); `_closeTick` cada 20 min recalcula los últimos 3 días y finaliza solo el día anterior (#744). Números del
  sistema salen de `datosIa.dayTotals` (Transaction); lado banco de la API de hgcash (`_bankDayFromApi`) o de los avisos, y saldos 00:00
  (`BankBalanceSnapshot`). `resultado = neto − comisión − gastos` (#770).
- **#948 INGRESOS / GASTOS:** `ingresosTotal = depósitos + pagosExternos + fondeos`; `egresosTotal = retiros + comisión + feeDepositsArs (cargas × perDepositFee, $50) +
  gastos`; `resultado = ingresos − egresos` (plata); `resultadoCaja` = ídem sólo con `gastosBanco`; con saldos 00 hs: `bankBalanceExpectedEnd = inicio + resultadoCaja`,
  `diferencia = real − esperado`. `neto` (fichas) y USDT quedan fuera del resultado (resultadoUsd = null).
- **Arqueo por movimientos (#913):** `diferencia = (bancoEntró − bancoSalió) − (depósitos − retiros) − ingresosExternos`, donde `ingresosExternos = pagosExternos
  (retiros pagados por BANCO EXTERNO, #904 `PendingPayout.paidVia:'other_bank'`) + fondeos (Expense kind 'fondeo')`. Son plata de la cuenta que el
  sistema no tiene como depósito: las fichas del retiro salieron en 1girox pero la plata no salió de este banco. Variante por saldos: igual,
  restando lo mismo. No tocan el RESULTADO. `dayTotals.payoutsPaid` excluye los `other_bank`.
- **Conciliación (`detalle`):** sistema (auto / a mano / prueba / pagos banco / a mano / externos / gastos / fondeos) vs banco (entradas acreditadas,
  sin acreditar, devueltas, dup) y `causas[]` con impacto firmado; `sinExplicar` = lo que queda para revisar. Lado 1girox (#888) en
  `detalle.girox` vs `DailyClose.giroxPanel` que carga el owner.
- **Regla para flujos nuevos:** todo lo que mueva plata por fuera de la API del banco deja rastro (`paidVia`, `adminUsername`, Expense) para que la
  conciliación lo nombre; un pago desde otra cuenta se marca `other_bank` (botón "Pagado por banco externo") y entra solo como ingreso.

## INICIO del panel (#876 → #913) — `GET /api/admin/inicio/stats?day=`
- Clave propia `Config['inicioPinHash']` (header `x-inicio-pin`). Día por defecto hoy; botones Hoy / Ayer / fecha. Grupos: gente en la app
  (AppSession), registros del día, cargas (1ª / retención +72 h / nuevos), **veces que cargaron** (1 / 2 / más de 2 por cliente en el día),
  **volvieron del día anterior** (cargaron ayer y hoy, con nombres; entraron ayer y hoy), retiros y neto, **aceptación de la app sobre los que
  cargaron alguna vez** (instalaron / notificaciones; `totalUsers` sólo de referencia). Todo por agregaciones; no bajar movimientos sueltos.

## Historias automáticas (#827 → #909)

`src/services/storyAutopilot.js` arma el PLAN del día (`planDay(dayKey, matches, ctx)`: determinístico para un mismo día) y `_storyAutoTick`
(server.js, cada 5 min en cada instancia) publica lo que ya pasó de hora con `Story.autoKey = sa-<día>-<slot>` ÚNICO (multi-instancia).
Slots `0..4` = **00:05 · 00:06 · 00:07 · 00:08 · 00:09 (#931: las 5 juntas al cambiar el día; `_storyAutoRetirePrevious` apaga las de días
anteriores en la misma pasada; el slot 0 es SIEMPRE Soporte/atención, los otros 4 rotan)**; lunes el slot favorito, miércoles el bono semanal; `m0..m2` = partidos a las
00:05 (**#909: sólo con `Config['storyAutoMatches']` encendida**, default apagada; panel → Cronograma → Historias automáticas).
**Rotación (#909):** cursor `(dayN*5) % temas` ⇒ los 5 temas de hoy nunca son los de ayer; `cycle = floor(dayN*5/temas)` elige la redacción
(`THEMES[k]` o `ALTS[k][cycle%3 − 1]`). Un tema nuevo va a `THEMES` **y** con 2 alternativas a `ALTS` (texto de servicio: nunca ruleta,
plata ni sueldos). Foto: `storyImage` (SVG, `GET /api/stories/:id/auto.svg?v=STORY_IMG_VER`); si la foto falla la historia sale sin foto.
**Diagnóstico:** cada pasada escribe `Config['storyAutoDiag']` (última pasada, publicadas, salteadas con motivo, error) que el panel muestra
("🛠 Motor…"). Cada historia se publica en su propio try/catch: un error no frena a las demás. Kill switch: `STORIES_AUTOPILOT_DISABLED=1`.
**Republicar (#911):** `_storyWipeForRepublish` + `_storyAutoTick({ force: true })` (one-shot `mig911StoriesRepublish` al deployar y
`POST /api/admin/stories-autopilot/republish-today`): apaga las vigentes (no las personales), borra `sa-<hoy|ayer>-*` y publica las de hoy ya.


## Centro de avisos (#971, 2026-10-24)

**Idea:** un solo lugar para todo lo automático que le llega al cliente, con un solo tope. Panel → Cronograma → 🧭 Centro de avisos; config en
`Config['notifCenter']` = { monthlyCap, journey, refundReminder, winnersStory, legacyRules }.

**Fuentes (todas pasan por la misma cola de lotes o respetan sus topes):**
| Fuente | Cuándo | Cómo sale | Tope |
|---|---|---|---|
| Recorrido por cliente (`retentionJourney.js` + `_journeyTick`) | 12–16 h ART, una vez por día | un NotifBatch por paso ("Recorrido · …"), chat + push `kind:'personal'` | 1/día; mensual sólo en pasos `capped` |
| Autopiloto (campaña masiva) | 20:00, 3 lotes | NotifBatch desde ScheduledCampaign, push `kind:'promo'` | 1/día + mensual |
| Lotes manuales del panel | cuando el agente quiere | NotifBatch | mensual si lo marca |
| Aviso del reembolso diario (#970) | 11 h | `sendNotificationToUsernames` (personal) | 1 por día, propio |
| Ofertas de bienvenida (días 5/15/30) | 18 h | historia personal + push personal | saltea a quien ya recibió un lote hoy |
| Historia con bono | mié (y sáb en el refuerzo) 12:30 | historia + push a todos (promo) | ese día el autopiloto no programa |
| Historia "pagos de la semana" | lunes 12 h | historia sin push | — |
| Reglas viejas (NotificationRule) | — | apagadas salvo `legacyRules` | — |

**Recorrido:** segmento por días desde la última carga real (`SCHED_ADAPTER.realDepositMatch`) o desde el registro: nuevo (0 cargas) · activo 0–6 · enfriando 7–13 · inactivo 14–29 · perdido 30–89 · lejano 90–180 · olvidado (+180, nada). `pickStep` devuelve a lo sumo un paso
(prioridad recuperación > nuevo > sin app; tolerancia de 2 días), con clave "<paso>@<episodio>" guardada en `User.journey.sent` (episodio = día de
la última carga: una carga nueva reinicia el recorrido). Fichas según `valueTier(avgDeposit 90 d)` chico/medio/grande = $2.000/$5.000/$10.000 ×
mult, rollover global. Preview sin enviar: `GET /api/admin/notif-center` (`_journeyScan`, cache 10 min); `POST …/run` fuerza la pasada de hoy.

**Preferencia del cliente:** `User.notifPrefs.level` all/mine/none + `fatigue`. Se aplica en `sendPushIfOffline` (lotes, por `data.kind`) y en
`notificationService.prefsFilter` (masivo = promo, usernames = personal; `kind:'system'` siempre sale). Fatiga: +1 por push promo enviada, 0 al
abrir la app (`/api/activity/ping`); ≥10 ⇒ sin promos.

**Trampas:** un aviso automático nuevo va por `_createNotifBatchFromBody` (hereda `dailyCap`/`monthlyCap`) o lleva `data.kind`; no agregar otro
cron de pushes por fuera. `_notifDayCounts`/`_notifMonthCounts` cuentan NotifBatch (no las pushes directas). Al cambiar el tope mensual el PUT
borra las campañas futuras del autopiloto (`_autopilotClearFuture`) y el tick las rearma.


## Revisión semanal automática (#973, 2026-10-24)

**Qué hace:** cada lunes (10–14 h ART, una vez, `_cronClaim('weeklyreview')`) `_weeklyMetrics(now)` arma las métricas de la semana y
`weeklyReview.decide(metrics, tuningActual)` devuelve impulsar / mantener / frenar con razones y recomendaciones. Si cambia el nivel, se guarda
`Config['journeyTuning']` (= `tuningFor(level)`: pctMult, chipsMult, apPctPlus) y se borran las campañas futuras del autopiloto para que se rearmen.
Informe + historial en `Config['weeklyReview']`. Rutas (clave de INICIO): `GET /api/admin/inicio/weekly-review`, `POST …/run` (fuerza).

**Métricas:** cargadores/cargas/monto de la semana y cargadores de la anterior; `repeatRate` = de los que cargaron la semana anterior, cuántos
también ésta (y `prevRepeatRate` para la semana previa); `giftRatio` = regalos/depósitos de los `DailyClose` de la semana; efectividad de los
NotifBatch enviados hace 7–14 d (recorrido: carga real en 7 d, por paso; masivo: en 48 h); `RefundClaim` por tipo; registrados y primeras cargas;
app instalada entre los que cargaron en 30 d; opt-out y fatiga; cohortes (`_inicioCohorts`); segmentos del último `journeyLast`.

**Dónde se aplica el nivel:** `retentionJourney.pickStep(state, now, tuning)` (bono % ×pctMult redondeado a 5, tope 200; fichas ×chipsMult
redondeadas a 500) y `_autopilotMonthItemsRaw` (`tb`: pct + apPctPlus, entre 10 y 100). El cache `_tuningCache` se refresca en
`getJourneyTuning()` (lo llaman `_journeyScan` y `getAutopilotConfig`).

**Trampas:** la decisión necesita cierres (`giftRatio` null ⇒ se trata como "hay margen") y ≥ 30 contactados para juzgar una conversión; no
cambiar los umbrales sin correr `scripts/test-weekly-review.js`. El informe en texto (`reportText`) es lo que el owner copia para analizar afuera.


## Bienvenida acotada (#974, 2026-10-24)

- **Bono de 1ª carga:** `Config['firstDepositBonusPct']` (100) con tope `Config['firstDepositCapArs']` ($15.000; 0 = libre) y 0 % sobre el resto. Se
  aplica en `resolveAutoBonus` (fuente `first_deposit`) ⇒ manual y hgcash por igual. Panel → Estrategia clientes → 1️⃣ Primera carga.
- **Extra por instalar:** `Config['installGift']` = { enabled, fixedArs ($5.000), pct, capArs, days }. `installGiftAmount` = min(fixedArs, carga) si
  fixedArs > 0; si no, pct con tope. En modo fijo `User.installGift.pct = null` (la app muestra sólo el monto). Textos con {monto}; el cartel de 1ª carga
  (`/api/first-deposit-promo`) devuelve `extraMonto`, `capArs` y renderiza `/sys_first_deposit_popup` con {tope} y {extraMonto}.
- **Anti-multicuenta de bienvenida:** `_welcomeAbuseOf(user)` busca otra cuenta con el mismo teléfono (últimos 10 dígitos), mismo `deviceIds` o mismo
  token FCM. Si hay, `resolveAutoBonus` bloquea todos los bonos de bienvenida en la primera carga (nota interna al agente) y `maybeOfferInstallGift` no
  ofrece el extra. No bloquea la cuenta ni toca ruleta/lotes/reembolsos. Sólo se evalúa cuando es la primera carga real (`_isFirstRealDeposit`).


## Registro abierto sin regalos (#975, 2026-10-24)

`User.noWelcomeGifts` se fija al crear la cuenta: landing / entrada rápida ⇒ `(!campaña || campaña === 'INGRESO') && !referido`; alta clásica ⇒
`!attributedCampaign && !isValidReferral`; en ambos casos salvo `Config['organicWelcomeGifts'] === true`. Dónde se respeta: `_welcomeAbuseOf` (motivo
⇒ `blockWelcome` en `resolveAutoBonus` y nada de extra en `maybeOfferInstallGift`), `_newbieOffersTick` (query), `retentionJourney` (pasos
`needsWelcome` con `state.noWelcome`), `/api/first-deposit-promo` (`noGifts:true`, texto `/sys_first_deposit_nogift`). Reembolsos, ruleta, lotes,
misiones, sorteos, VIP y referidos no miran el flag. Un regalo de bienvenida nuevo tiene que chequearlo.


## Rollover ×1 en la carga y confianza a las 5 cargas (#976, 2026-10-24)

- `Config['depositRolloverX']` = 1 (bono `bonusRolloverX` = 5). Textos: `.rx-dep`/`.rx-bon` los pinta home.js desde `/api/platforms`; los comandos
  usan {carga}/{rollover}. Retiro mínimo `Config['withdrawMinArs']` = 5.000; la app lo lee de `platformsData.withdrawMinArs` (fallback 5.000).
- Registro abierto (`User.noWelcomeGifts`): `retentionJourney.pickStep` calcula `trusted = !noWelcome || deposits ≥ TRUST_DEPOSITS`; sin confianza los
  regalos `fixed` se convierten en percent `UNTRUSTED_PCT` y no existe oferta de 2ª carga. Con confianza el cliente queda como cualquier otro (sin paso especial, #977).


## Sorteos v2: tickets y sorteo verificable (#981, 2026-10-24)

**Reglas** (`src/services/sorteos.js`): `computePoints(s, { days: { 'YYYY-MM-DD': { wag, dep } }, depositTotal, bonusGranted, deposits, missionWeeks, weeksElapsed })`
devuelve puntos (base con techo diario `dayCapArs` × realShare, `dayPts`, `weekPts`, `missionPts`), `depositDays`, `activeWeeks`, `streakWeeks` y
`tickets { play, days, milestones, total, got }`. `drawNumber(seed, drawKey, total, skip)` = 1 + (sha256(seed|drawKey) mod total) + skip. `terms()` arma las Bases.

**Motor** (`_sorteoTickOne`): por período, agrega cargas reales (total y por día ART), lee el apostado acumulado de 1girox (`_sorteoStats`), guarda
`cum[hoy]` y deriva `wag` por día como diferencia entre acumulados consecutivos (los días sin pasada se suman al siguiente). Emite tickets por la
diferencia entre lo que corresponde y lo ya emitido por origen (`ticketsPlay/Days/Milestones`), reservando bloques en `SorteoCounter` (`$inc`) e
insertando `SorteoTicket` (único por key+periodKey+n). Después corre `_sorteoDrawsAuto`: commit del 1° premio al cierre, revelado automático a las
48 h de `publishAt`; quincenales (`midDraws.dates`) commit al empezar el día, revelado a las 20 h. `Config['sorteoDraws']` guarda cada sorteo bajo
`key:periodKey:main` o `key:periodKey:mid:YYYY-MM-DD` ({ seed, seedHash, total, winner, skipped, revealedAt… }); la app ve la semilla sólo revelada.

**Trampas:** tickets nunca bajan (si cambia realShare, se conserva lo emitido); el commit congela `total` — tickets emitidos después no entran a ESE
sorteo; cambiar `tickets.per`/`dayCap` a mitad de período sólo afecta lo que se emite de ahí en adelante. El ganador del 1° premio se excluye del
ranking (`_sorteoWinners(key, pk, excludeUserId)`). Requisito teléfono = 10 dígitos cargados (no exige verificación: eso va al cobrar).
