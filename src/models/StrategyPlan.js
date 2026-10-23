/**
 * StrategyPlan — PLAN DE ESTRATEGIA del mes (#293, owner 2026-10-17).
 *
 * "Armar un plan programable para programar todo el mes con diferentes estrategias, guardarlo y
 * después tener el análisis de cómo rindió cada día y cada semana". Un plan es una PLANTILLA
 * reutilizable: una lista de campañas por DÍA DEL MES y hora (día 1 10:00 → bono 50% a inactivos
 * 10-20 d; día 5 19:00 → fichas a todos…). Cada ítem guarda el MISMO `payload` que acepta
 * `POST /api/admin/notif-batches` (igual que ScheduledCampaign.payload).
 *
 * Aplicar un plan a un mes (`POST /api/admin/cronograma-plans/:id/apply {month}`) crea una
 * ScheduledCampaign por ítem (las fechas ya pasadas se saltean). El envío MANUAL de lotes y la
 * programación campaña por campaña siguen existiendo: el plan es una capa de conveniencia encima.
 * "Guardar este mes como plan" (`/from-month`) arma el plan a partir de lo ya programado en un mes.
 */
const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  day: { type: Number, required: true, min: 1, max: 31 },       // día del mes
  time: { type: String, required: true },                        // 'HH:mm' hora Argentina
  parts: { type: Number, default: 1, min: 1, max: 12 },          // tandas
  gapHours: { type: Number, default: 5, min: 1, max: 24 },       // horas entre tandas
  name: { type: String, default: '', maxlength: 80 },
  payload: { type: mongoose.Schema.Types.Mixed, required: true }
}, { _id: false });

const strategyPlanSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  notes: { type: String, default: '', maxlength: 500 },
  items: { type: [itemSchema], default: [] },
  createdBy: { type: String, default: null },
  updatedBy: { type: String, default: null },
  lastAppliedMonth: { type: String, default: null },             // 'YYYY-MM'
  lastAppliedAt: { type: Date, default: null },
  appliedCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.models['StrategyPlan'] || mongoose.model('StrategyPlan', strategyPlanSchema);
