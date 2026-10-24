// #915: puntaje de un jugador en un sorteo y período (lo recalcula `_sorteoTick` cada 20 min con los stats de 1girox: apostado del período).
// Entran TODOS los clientes con al menos una carga real en el período (ranking "del general"); `joined` dice si está anotado (sólo los
// anotados pueden ganar). Único por (key, periodKey, userId).
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key: { type: String, required: true },
  periodKey: { type: String, required: true },    // mensual: 'YYYY-MM' · gran: 'YYYY-MM-DD_YYYY-MM-DD'
  userId: { type: String, required: true },
  username: { type: String, required: true },
  points: { type: Number, default: 0 },           // total (base + extras)
  basePts: { type: Number, default: 0 },          // por lo apostado con plata real
  dayPts: { type: Number, default: 0 },           // gran: +N por cada día con cargas >= mínimo
  missionPts: { type: Number, default: 0 },       // gran: +% por semanas con misiones
  wagered: { type: Number, default: 0 },          // apostado bruto (stats)
  realShare: { type: Number, default: 1 },        // cargas / (cargas + bono otorgado) del período
  deposits: { type: Number, default: 0 },         // cantidad de cargas reales en el período
  depositTotal: { type: Number, default: 0 },
  depositDays: { type: Number, default: 0 },      // días con cargas >= mínimo (gran)
  missionWeeks: { type: Number, default: 0 },
  joined: { type: Boolean, default: false },
  eligible: { type: Boolean, default: false },    // anotado + carga real en el período
  firstDepositAt: { type: Date, default: null },  // desempate
  updatedAt: { type: Date, default: Date.now }
});
schema.index({ key: 1, periodKey: 1, userId: 1 }, { unique: true });
schema.index({ key: 1, periodKey: 1, points: -1, wagered: -1 });
module.exports = mongoose.models['SorteoScore'] || mongoose.model('SorteoScore', schema);
