// #770 (owner 2026-10-21): GASTOS — pagos que salen de la cuenta del banco (hgcash) o se registran a mano para que el CIERRE del día
// los descuente y la conciliación explique esa salida. Panel → Atención → 💸 Gastos. `paidVia: 'hgcash'` = se pagó por la API
// (createCashOut con externalID 'gasto-<id>', idempotente); 'manual' = ya se pagó por otro lado, sólo se registra.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  dateKey: { type: String, required: true, index: true },     // YYYY-MM-DD (ART) del gasto
  amount: { type: Number, required: true, min: 1 },
  concept: { type: String, required: true, trim: true, maxlength: 120 },
  toCBU: { type: String, default: null, trim: true },
  toName: { type: String, default: null, trim: true },
  toCUIT: { type: String, default: null, trim: true },
  paidVia: { type: String, enum: ['hgcash', 'manual'], default: 'manual', index: true },
  // #904 (owner): 'fondeo' = plata que ENTRA a la cuenta de pagos ("se stockeó para pagos $1.650.000"): el cierre la toma como INGRESO y
  // explica con ella la entrada al banco. 'gasto' = lo de siempre (sale plata y se descuenta del resultado).
  kind: { type: String, enum: ['gasto', 'fondeo'], default: 'gasto', index: true },
  // #1038 (owner 2026-11-08, "Anotar movimientos"): por qué cuenta pasó la plata. 'main' = banco principal (hgcash: tiene que verse en el
  // extracto ⇒ se cruza con BankMovement/API), 'external' = otra cuenta / efectivo (no pasa por el banco), '<id>' = cuenta secundaria de
  // Config['bankAccounts']. null = registro viejo (se interpreta: paidVia 'hgcash' ⇒ main, si no external).
  account: { type: String, default: null, index: true },
  source: { type: String, default: 'panel' },      // 'caja' = anotado desde el botón del Chat completo
  // Comprobante (foto / PDF) como data URL; no viaja en los listados (select:false).
  receipt: { data: { type: String, default: null, select: false }, mime: { type: String, default: null }, name: { type: String, default: null }, size: { type: Number, default: 0 } },
  // Cruce con el banco: { status: 'pending' | 'matched' | 'unmatched' | 'na', movementId, externalId, amount, date, checkedAt, checks, note }
  bankMatch: { type: mongoose.Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['paid', 'paying', 'failed'], default: 'paid', index: true },
  hgId: { type: String, default: null },
  hgError: { type: String, default: null },
  // #1090: pago por API que quedó EN PROCESO (timeout / error de red / 5xx / respuesta ambigua): { since, checks, lastAt, last } — lo resuelve
  // _gastoPayingTick consultando al banco (nunca se re-envía el pago solo).
  hgCheck: { type: mongoose.Schema.Types.Mixed, default: null },
  createdBy: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });
module.exports = mongoose.models.Expense || mongoose.model('Expense', schema);
