const mongoose = require('mongoose');
// #1003 (owner 2026-11-01): CÓDIGO SORPRESA en historias — 2-3 veces por semana, a cualquier hora, un código que vale `minutes` (60) y
// regala `amount` ($2.000) a los primeros `maxClaims` (10). dropKey 'cd-<día>-<hh:mm>' único ⇒ multi-instancia sin duplicar.
const codeDropSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  dropKey: { type: String, required: true, unique: true },
  code: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  maxClaims: { type: Number, required: true },
  claims: { type: Number, default: 0 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  status: { type: String, default: 'active', index: true }, // active | completed | expired
  storyId: { type: String, default: null },
  doneStoryId: { type: String, default: null },
  finishedAt: { type: Date, default: null },
  createdBy: { type: String, default: 'automático' },
  pushStats: { type: mongoose.Schema.Types.Mixed, default: null },
  // #1044-d: código exclusivo del canal de Telegram (createdBy 'telegram'): id del posteo para marcarlo AGOTADO
  tgMsgId: { type: Number, default: null },
  tgKind: { type: String, default: null }
}, { timestamps: true });
module.exports = mongoose.models.CodeDrop || mongoose.model('CodeDrop', codeDropSchema);
