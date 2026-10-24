// #981 (owner 2026-10-24): TICKET de un sorteo — número correlativo por (key, periodKey) que emite el motor cuando el cliente lo gana (juego del día,
// día con carga o hito). Es lo que se sortea para el 1° premio y los quincenales. Nunca se borra ni se reasigna: el cliente lo ve en la app.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, required: true },          // 'mensual' | 'gran'
  periodKey: { type: String, required: true },
  n: { type: Number, required: true },            // número del ticket (1..N)
  userId: { type: String, required: true },
  username: { type: String, required: true },
  reason: { type: String, default: 'juego' },     // 'juego' | 'dia' | 'hito'
  at: { type: Date, default: Date.now }
});
schema.index({ key: 1, periodKey: 1, n: 1 }, { unique: true });
schema.index({ key: 1, periodKey: 1, userId: 1, n: 1 });
schema.index({ key: 1, periodKey: 1, at: -1 });
module.exports = mongoose.models['SorteoTicket'] || mongoose.model('SorteoTicket', schema);
