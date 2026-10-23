// #414 (owner 2026-10-18): SOPORTE PARA VISITANTES (sin cuenta). Desde la pantalla de ingreso cualquiera puede abrir
// una conversación dejando nombre, teléfono y motivo; se sigue con un token secreto (no hay login). El panel la ve en
// la columna "Visitantes" al lado de la de clientes y responde desde ahí. Los mensajes viven embebidos en el hilo
// (pocos por conversación). Se borran solos a los 30 días del último movimiento (TTL en lastAt).
const mongoose = require('mongoose');

const guestMsgSchema = new mongoose.Schema({
  id: { type: String, required: true },
  from: { type: String, enum: ['guest', 'agent', 'system'], required: true },
  content: { type: String, required: true, maxlength: 2000 },
  agent: { type: String, default: null },   // nombre de la persona de turno (soporte) que respondió
  at: { type: Date, default: Date.now }
}, { _id: false });

const guestThreadSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  token: { type: String, required: true, index: true },   // secreto del visitante (localStorage)
  name: { type: String, required: true, maxlength: 60 },
  phone: { type: String, required: true, maxlength: 30 },
  motivo: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
  messages: { type: [guestMsgSchema], default: [] },
  unreadAdmin: { type: Number, default: 1 },   // mensajes del visitante sin leer por el panel
  lastFrom: { type: String, default: 'guest' },
  lastAt: { type: Date, default: Date.now, index: true },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});
guestThreadSchema.index({ lastAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

module.exports = mongoose.models['GuestThread'] || mongoose.model('GuestThread', guestThreadSchema);
