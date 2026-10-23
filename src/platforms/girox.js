/**
 * Adaptador de plataforma: 1GIROX.
 *
 * Es una envoltura FINA sobre `src/services/giroxService.js` (que sigue siendo el
 * cliente real de la Partner API y lo siguen usando ~110 call sites de server.js
 * como `girox.*`). Existe para que la capa multi-plataforma (`src/platforms/index.js`)
 * pueda tratar a girox igual que a cualquier otra plataforma: mismo contrato,
 * mismos nombres de método (ver `docs/PLATFORMS.md`).
 *
 * ⚠️ No agregar lógica acá: todo lo de girox vive en giroxService. Si hace falta un
 * método nuevo en el contrato, se agrega en giroxService y se re-exporta acá.
 */
const svc = require('../services/giroxService');

module.exports = Object.assign({}, svc, {
  id: 'girox',
  defaultName: 'Girox',
  defaultEmoji: '🎰',
  /** true cuando la Partner API está configurada (env GIROX_API_URL + GIROX_API_KEY). */
  isConnected: () => svc.isEnabled(),
  /** Capacidades que esta plataforma soporta de verdad (lo lee server.js para abrir/cerrar flujos). */
  capabilities: {
    deposit: true,
    withdraw: true,
    gift: true,        // creditUserBalance / creditGift (regalos = bono 0)
    depositBonus: true, // bono adjunto a la carga (wagering.bonus_amount)
    stats: true,       // getPlayerStats / getPlayersStatsBatch (netwin, apostado, bonus.granted)
    sso: true          // createSession (login único)
  }
});
