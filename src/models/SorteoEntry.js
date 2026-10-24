// #915 (owner 2026-10-24): SORTEOS con ranking — inscripción de un cliente a un sorteo ('mensual' | 'gran'). Para anotarse tiene que cumplir
// los requisitos (app instalada, notificaciones, Telegram, al menos una carga real); acá queda la foto de qué cumplía al anotarse.
// Único por (userId, key): se anota una vez por sorteo (el mensual vale para todos los meses).
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  key: { type: String, required: true, index: true },          // 'mensual' | 'gran'
  userId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  joinedAt: { type: Date, default: Date.now },
  checks: { type: mongoose.Schema.Types.Mixed, default: null }, // { app, notif, telegram, deposit }
  telegramDeclared: { type: Boolean, default: false },         // el cliente marcó "ya me uní al Telegram"
  source: { type: String, default: 'app' }                     // 'app' | 'admin'
}, { timestamps: true });
schema.index({ userId: 1, key: 1 }, { unique: true });
module.exports = mongoose.models['SorteoEntry'] || mongoose.model('SorteoEntry', schema);
