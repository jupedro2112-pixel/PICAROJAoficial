/**
 * PhoneLog (#1028, owner 2026-11-07): HISTORIAL DE NÚMEROS de celular que cargó cada cliente.
 *
 * Una fila por cada vez que un cliente deja / confirma un número: con SMS ('sms'), sin SMS cuando el
 * interruptor está apagado ('nosms', el cliente confirma "sí, es correcto" en el mismo cuadro), o el
 * número que ya tenía antes de existir este registro ('historico', cargado por la migración mig1028).
 * Se lee desde el panel → 📒 Historial de números (abajo de todo, con clave propia).
 * Permanente (sin TTL): sirve para rastrear números aunque el cliente los cambie después.
 */
const mongoose = require('mongoose');

const phoneLogSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  username: { type: String, default: null, index: true },
  phone: { type: String, required: true, index: true },
  via: { type: String, enum: ['sms', 'nosms', 'historico'], default: 'nosms', index: true },
  source: { type: String, default: null }, // 'retiro' | 'registro' | 'perfil' | 'entrada' | 'migracion' …
  at: { type: Date, default: Date.now, index: true }
}, { timestamps: false });

phoneLogSchema.index({ at: -1 });

module.exports = mongoose.models.PhoneLog || mongoose.model('PhoneLog', phoneLogSchema);
