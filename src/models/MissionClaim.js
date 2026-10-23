// #504 (owner 2026-10-18): MISIONES SEMANALES automáticas. Cuando un cliente cumple la meta de una misión en la semana
// (lunes a domingo, hora argentina) el cron la acredita como regalo y deja constancia acá. Único por (userId, missionId, weekKey)
// = nunca se paga dos veces aunque haya varias instancias; la reference del crédito también lo garantiza en la plataforma.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  username: { type: String, default: null },
  missionId: { type: String, required: true },
  weekKey: { type: String, required: true, index: true },   // lunes YYYY-MM-DD (ART)
  title: { type: String, default: '' },
  rewardArs: { type: Number, default: 0 },
  status: { type: String, enum: ['credited', 'failed'], default: 'credited' },
  txId: { type: String, default: null },
  error: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});
schema.index({ userId: 1, missionId: 1, weekKey: 1 }, { unique: true });
module.exports = mongoose.models['MissionClaim'] || mongoose.model('MissionClaim', schema);
