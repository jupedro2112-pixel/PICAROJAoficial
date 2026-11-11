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
  // #1079-b (varios bots): con qué bot llegó y el archivo, para reenviarlo con OTRO bot si el destino no tiene el mismo (los file_id son por bot)
  srcBot: { type: String, default: null },
  structId: { type: String, default: null, index: true }, // #1079-c: estructura (circuito) a la que pertenece
  fileId: { type: String, default: null },
  fileUid: { type: String, default: null, index: true }, // #1079-m: file_unique_id de Telegram (la MISMA imagen reenviada)
  dupKey: { type: String, default: null, index: true }, // #1079-m: COELSA / n° de operación leído por la IA (el mismo comprobante, otra captura)
  dupOf: { type: String, default: null },
  fileKind: { type: String, default: null }, // photo | document
  fileMime: { type: String, default: null },
  fileName: { type: String, default: null },
  caption: { type: String, default: '' },
  fwdMsgId: { type: Number, default: null },
  replyMsgId: { type: Number, default: null },
  amount: { type: Number, default: null },
  amountFrom: { type: String, default: null }, // 'ia' | 'texto' | 'corregido' | 'arrastre' | 'arrastre_mes' | 'resto'
  sender: { type: String, default: '' },
  destHolder: { type: String, default: null }, // #1094: titular y CBU/alias de DESTINO leídos por la IA (el aviso de cambio de terminación repite el último)
  destCbu: { type: String, default: null },
  status: { type: String, default: 'hold', index: true }, // hold (sin monto / sin grupo para esos centavos) | open | closed | failed | dup (duplicado, no suma) | anulado (/anular)
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
  structId: { type: String, default: null, index: true },
  structName: { type: String, default: '' },
  periodFrom: { type: Date, default: null }, // primer comprobante del período
  count: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  batchId: { type: String, default: null, index: true }, // #1079-m: = RcptFwd.closeId de los comprobantes de este cierre
  partialOf: { type: Number, default: null }, // #1079-j: cierre PARCIAL (/cierre 500.000) de este total; el resto siguió sumando
  missing: { type: Number, default: 0 },
  by: { type: String, default: '' },
  // #1079: cada cierre (13 h) queda PENDIENTE A COTIZAR hasta que en el panel le ponen la cotización
  status: { type: String, default: 'pending', index: true }, // pending (a cotizar) | quoted (/cotizado en el destino) | sent (/enviado: ya no está pendiente)
  sentBy: { type: String, default: '' },
  sentAt: { type: Date, default: null },
  quoteRate: { type: Number, default: null },
  quoteNote: { type: String, default: '' },
  quotedBy: { type: String, default: '' },
  quotedAt: { type: Date, default: null },
  // #1085: cotización con precio del USDT y comisión % ⇒ USDT a enviar; al enviar, la FOTO del envío
  quoteFeePct: { type: Number, default: null },
  quoteUsdt: { type: Number, default: null },
  sentPhoto: { type: String, default: '' },
  sentManual: { type: Boolean, default: false }, // #1099: foto de USDT que no coincidía / no se leía y el agente confirmó a mano (A VERIFICAR)
  sentReadUsdt: { type: Number, default: null }, // #1099: USDT que leyó el bot en la foto
  sentTry: { type: String, default: null } // #1099: intento de envío esperando el ✅ OK a mano
}, { timestamps: true });
const RcptClose = mongoose.models.RcptClose || mongoose.model('RcptClose', rcptCloseSchema);
module.exports = { RcptFwd, RcptClose };
