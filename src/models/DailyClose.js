// #500 (owner 2026-10-18): CIERRE DIARIO AUTOMÁTICO. Como no va a haber empleados que hagan cierres, el server genera uno por
// día (hora argentina) con los números reales (depósitos, retiros, VENTA = netwin, regalos, NETO, nuevos vs retenidos) y el
// admin sólo completa la COMISIÓN DEL BANCO (o se aplica el % por defecto de Config['closeConfig']) y, al final, la COTIZACIÓN
// USDT → el cierre pasa a 'finalizado' con el resultado en pesos y en dólares. Único por dateKey (idempotente entre instancias).
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  dateKey: { type: String, required: true, unique: true, index: true },   // YYYY-MM-DD (ART)
  status: { type: String, enum: ['pendiente', 'finalizado'], default: 'pendiente', index: true },
  // Números del día (pesos), generados automáticamente
  depositos: { type: Number, default: 0 }, cargas: { type: Number, default: 0 }, cargadores: { type: Number, default: 0 },
  retiros: { type: Number, default: 0 }, retirosN: { type: Number, default: 0 },
  venta: { type: Number, default: 0 },          // netwin = depósitos − retiros
  regalos: { type: Number, default: 0 },        // bonos, reembolsos, ruleta, fueguito, VIP, instalar, referidos
  neto: { type: Number, default: 0 },           // venta − regalos
  nuevos: { type: Number, default: 0 }, retenidos: { type: Number, default: 0 },
  ventaRetenidos: { type: Number, default: 0 }, ventaNuevos: { type: Number, default: 0 },
  // #501 ARQUEO: lo que dice el BANCO vs lo que dice el sistema. Auto = movimientos del banco (webhook hgcash) y payouts pagados;
  // manual = lo que el admin lee del resumen del banco (pisa lo automático). diferencia = (entró − salió del banco) − (depósitos − retiros)
  bankSource: { type: String, default: null }, // 'api' (listado de movimientos del banco) | 'webhook' (avisos recibidos) — #503
  bankInAuto: { type: Number, default: 0 }, bankOutAuto: { type: Number, default: 0 }, payoutsPaid: { type: Number, default: 0 }, bankMovsIn: { type: Number, default: 0 },
  bankInManual: { type: Number, default: null }, bankOutManual: { type: Number, default: null },
  bankIn: { type: Number, default: 0 }, bankOut: { type: Number, default: 0 },
  difIn: { type: Number, default: 0 }, difOut: { type: Number, default: 0 }, diferencia: { type: Number, default: 0 },
  arqueo: { type: String, enum: ['sin_datos', 'cuadra', 'faltante', 'sobrante'], default: 'sin_datos' },
  // #502 saldo del banco a las 00:00 (inicio del día) y a las 00:00 del día siguiente (fin); manual pisa lo de la API
  bankBalanceStart: { type: Number, default: null }, bankBalanceEnd: { type: Number, default: null }, bankBalanceDelta: { type: Number, default: null },
  bankBalanceStartManual: { type: Number, default: null }, bankBalanceEndManual: { type: Number, default: null }, bankBalanceSource: { type: String, default: null },
  // Lo que completa el admin
  bankCommissionPct: { type: Number, default: null },   // % sobre los depósitos (si se usa el % por defecto)
  bankCommissionArs: { type: Number, default: 0 },      // monto final de comisión (pesos)
  bankCommissionSource: { type: String, default: null }, // 'default' | 'manual' (monto) | 'manual_pct' (% del día, #501)
  resultado: { type: Number, default: 0 },              // neto − comisión del banco
  usdtRate: { type: Number, default: null },
  resultadoUsd: { type: Number, default: null },
  notes: { type: String, default: '' },
  // #744 (owner): CONCILIACIÓN automática: desglose del día (auto/manual/banco) y posibles causas de la diferencia. Se recalcula solo.
  detalle: { type: mongoose.Schema.Types.Mixed, default: null },
  // #888: totales del CIERRE DEL PANEL DE 1GIROX que carga el owner ({ cargas, retiros, bonos, by, at }) para compararlos con la app.
  giroxPanel: { type: mongoose.Schema.Types.Mixed, default: null },
  gastos: { type: Number, default: 0 }, // #770: gastos del día (Expense) — se descuentan del RESULTADO
  // #913: INGRESOS de la cuenta que el sistema no tiene como depósito: retiros pagados por BANCO EXTERNO (las fichas salieron, la plata no)
  // y FONDEOS (#904). Se restan de la diferencia del arqueo (no tocan el RESULTADO).
  pagosExternos: { type: Number, default: 0 }, fondeos: { type: Number, default: 0 }, ingresosExternos: { type: Number, default: 0 },
  // #948: INGRESOS / GASTOS del día en plata. feeDepositsArs = cargas × feePerDeposit ($50 por transferencia); gastosBanco = gastos pagados por la API.
  // resultado = ingresosTotal − egresosTotal · resultadoCaja = sólo con lo que salió de ESTE banco · bankBalanceExpectedEnd = saldo 00 hs + resultadoCaja.
  feePerDeposit: { type: Number, default: 50 }, feeDepositsArs: { type: Number, default: 0 }, gastosBanco: { type: Number, default: 0 },
  ingresosTotal: { type: Number, default: 0 }, egresosTotal: { type: Number, default: 0 }, resultadoCaja: { type: Number, default: 0 }, bankBalanceExpectedEnd: { type: Number, default: null },
  autoFinalizedAt: { type: Date, default: null },
  generatedAt: { type: Date, default: Date.now },
  recalculatedAt: { type: Date, default: null },
  finalizedAt: { type: Date, default: null },
  finalizedBy: { type: String, default: null },
  updatedBy: { type: String, default: null }
});
module.exports = mongoose.models['DailyClose'] || mongoose.model('DailyClose', schema);
