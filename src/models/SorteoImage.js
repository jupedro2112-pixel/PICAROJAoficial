// #967 (owner 2026-10-24): foto de un premio de los Sorteos subida a MANO desde el panel (adjuntar archivo). Se guarda en la base (no en
// disco: en AWS hay varias instancias y el disco no se comparte) y se sirve por GET /api/sorteos/img/:id con caché larga.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  key: { type: String, required: true },    // 'mensual' | 'gran'
  pos: { type: Number, required: true },    // 1..3
  mime: { type: String, required: true },   // image/jpeg | image/png | image/webp
  data: { type: Buffer, required: true },
  size: { type: Number, default: 0 },
  uploadedBy: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.models['SorteoImage'] || mongoose.model('SorteoImage', schema);
