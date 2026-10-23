// #444 (owner 2026-10-18): HISTORIAL de fallas del banco (retiros). Un evento por alerta (inicio → cierre) y también los
// "avisos de salida" sueltos (pago OK que avisa a clientes anotados sin alerta activa). Panel: Configuración → Banco con fallas.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  startedAt: { type: Date, default: Date.now, index: true },
  endedAt: { type: Date, default: null },
  mode: { type: String, default: 'manual' },        // 'manual' | 'auto' | 'aviso'
  reason: { type: String, default: null },
  openedBy: { type: String, default: null },
  closedBy: { type: String, default: null },
  notifiedTotal: { type: Number, default: 0 },      // a cuántas personas se les avisó al cerrar
  notifiedWaiters: { type: Number, default: 0 },    // quisieron retirar durante la falla
  notifiedFailed: { type: Number, default: 0 },     // su pago falló
  failedPayouts: { type: Number, default: 0 },      // pagos fallidos contados durante la falla
  createdAt: { type: Date, default: Date.now }
});
schema.index({ startedAt: -1 });
module.exports = mongoose.models['BankOutageEvent'] || mongoose.model('BankOutageEvent', schema);
