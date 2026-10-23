// #502 (owner 2026-10-18): SALDO DEL BANCO A LAS 00:00 (hora argentina). El server consulta la API del banco (hgcash GET /accounts)
// apenas cambia el día y guarda el saldo: el cierre del día D usa el saldo de las 00:00 de D (inicio) y el de las 00:00 de D+1
// (fin). Si la API no informa saldo, el admin lo puede escribir a mano en el cierre. Único por dateKey.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  dateKey: { type: String, required: true, unique: true, index: true }, // día que EMPIEZA con este saldo (00:00 ART)
  takenAt: { type: Date, default: Date.now },
  late: { type: Boolean, default: false },        // se tomó después de las 00:30 (server caído / sin API a esa hora)
  balance: { type: Number, default: null },
  currency: { type: String, default: null },
  accountId: { type: String, default: null },
  source: { type: String, default: 'api' },       // api | manual
  raw: { type: mongoose.Schema.Types.Mixed, default: null }, // la cuenta tal como vino (sin token) para ver qué campos informa
  error: { type: String, default: null }
});
module.exports = mongoose.models['BankBalanceSnapshot'] || mongoose.model('BankBalanceSnapshot', schema);
