// #981: contador atómico de tickets por sorteo y período (reserva bloques con $inc; multi-instancia segura junto al índice único de SorteoTicket).
const mongoose = require('mongoose');
const schema = new mongoose.Schema({ key: { type: String, required: true }, periodKey: { type: String, required: true }, next: { type: Number, default: 0 } });
schema.index({ key: 1, periodKey: 1 }, { unique: true });
module.exports = mongoose.models['SorteoCounter'] || mongoose.model('SorteoCounter', schema);
