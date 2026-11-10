const mongoose = require('mongoose');
// #1079 BOT DE COMPROBANTES (owner): cada comprobante que el bot reenvía de un grupo de origen a su grupo de destino. Suma ABIERTA
// (status 'open') hasta que en el grupo escriben /cierrededia ⇒ 'closed' + closeId. Único por (fromChat, srcMsgId): Telegram reintenta y
// hay varias instancias, el índice evita reenviar dos veces.
const rcptFwdSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  fromChat: { type: String, required: true, index: true },
  fromTitle: { type: String, default: '' },
  toChat: { type: String, default: null },
  toTitle: { type: String, default: '' },
  srcMsgId: { type: Number, required: true },
  fwdMsgId: { type: Number, default: null },
  replyMsgId: { type: Number, default: null },
  amount: { type: Number, default: null },
  amountFrom: { type: String, default: null }, // 'ia' | 'texto' | 'corregido'
  sender: { type: String, default: '' },
  status: { type: String, default: 'hold', index: true }, // hold (sin monto / sin grupo para esos centavos) | open | closed | failed
  error: { type: String, default: null },
  closeId: { type: String, default: null, index: true }
}, { timestamps: true });
rcptFwdSchema.index({ fromChat: 1, srcMsgId: 1 }, { unique: true });
const RcptFwd = mongoose.models.RcptFwd || mongoose.model('RcptFwd', rcptFwdSchema);

const rcptCloseSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  fromChat: { type: String, required: true, index: true },
  fromTitle: { type: String, default: '' },
  toChat: { type: String, default: null },
  toTitle: { type: String, default: '' },
  count: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  missing: { type: Number, default: 0 },
  by: { type: String, default: '' },
  // #1079: cada cierre (13 h) queda PENDIENTE A COTIZAR hasta que en el panel le ponen la cotización
  status: { type: String, default: 'pending', index: true }, // pending (a cotizar) | quoted (/cotizado en el destino) | sent (/enviado: ya no está pendiente)
  sentBy: { type: String, default: '' },
  sentAt: { type: Date, default: null },
  quoteRate: { type: Number, default: null },
  quoteNote: { type: String, default: '' },
  quotedBy: { type: String, default: '' },
  quotedAt: { type: Date, default: null }
}, { timestamps: true });
const RcptClose = mongoose.models.RcptClose || mongoose.model('RcptClose', rcptCloseSchema);
module.exports = { RcptFwd, RcptClose };
