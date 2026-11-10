'use strict';
// #1079-o (owner: "armar un archivo de cómo funciona para los que envían y otro para los que reciben; dejarlo fijado en cada grupo cuando arranca").
// Texto plano (va como archivo .txt fijado en el grupo y se usa para armar los PDF). ctx opcional: { group, rules:[{cents, to}], other, dests:[...], sources:[...] }.

function src(ctx = {}) {
  const term = (ctx.rules || []).length
    ? (ctx.rules || []).map((r) => `   • termina en ,${r.cents}  →  ${r.to}`).join('\n') + '\n' + (ctx.other ? `   • cualquier otra terminación  →  ${ctx.other}` : '   • cualquier otra terminación  →  NO se reenvía (el bot avisa)')
    : '   • (las terminaciones las configura el administrador; con /ayuda el bot muestra las vigentes)';
  return `GUÍA · GRUPO QUE ENVÍA COMPROBANTES${ctx.group ? ' · ' + ctx.group : ''}
================================================

1) QUÉ HACE EL BOT
Cada comprobante que mandan acá:
   - lo lee (monto con centavos),
   - mira la TERMINACIÓN (los centavos) y lo reenvía al grupo que corresponde,
   - lo marca ✅ REENVIADO y lo SUMA.
No hace falta escribir nada: sólo mandar la foto.

2) CÓMO MANDAR UN COMPROBANTE
   - Foto del comprobante ENTERO, que se vea bien el monto CON CENTAVOS.
   - Un comprobante por mensaje.
   - Si es PDF, escribí el monto en el texto del mensaje (ej. 50000,82).

3) ¡ATENCIÓN A LOS CENTAVOS! (terminación)
Según cómo termina el monto, va a un grupo o a otro:
${term}
Ejemplo: $50.000,82 termina en ,82.

4) QUÉ CONTESTA EL BOT
   ✅ REENVIADO ........ se reenvió y se sumó. Muestra el acumulado, lo pendiente y el total del mes.
   ❌ TERMINACIÓN MAL .. los centavos no corresponden a este grupo. NO se sumó.
                          Si el cliente se equivocó, tocá el botón "Va a ..." y elegí el grupo:
                          llega con el aviso "el cliente se equivocó con el decimal, pero va a este grupo".
   ⚠️ NO PUDE LEER ...... respondé la foto con el monto con centavos (ej. 25000,82).
   🚫 DUPLICADO ......... ese comprobante ya se mandó (y no se cotizó): NO se suma.
                          Si es otra transferencia distinta: botón "Es otro comprobante: sumarlo".
   ⛔ SIN CBU DE BAJADA .. el grupo que recibe no tiene cuenta: NO transferir hasta el aviso de CBU nuevo.

5) COMANDOS (o el botón 📋 Ver comandos)
   /total ............... suma actualizada, pendientes y total del mes
   /cierre .............. cierra TODO lo sumado (la suma vuelve a $0)
   /cierre 500.000 ...... cierra SÓLO ese monto; el resto sigue sumando
   /anterior 13.686.199 . suma lo que venían acumulando antes del bot
   /restar 50.000 ....... resta un monto (algo mal enviado o reenviado)
   /anular .............. RESPONDIENDO un comprobante: lo saca de la suma
   /cbu ................. a qué CBU transferir ahora (titular, CBU, alias, terminación)
   /ayuda ............... menú con botones · /guia ...... esta guía

6) SI ALGO SALIÓ MAL
   - Fue al grupo equivocado: botón "↪️ ¿Terminación mal? Cambiar grupo" (antes del cierre).
   - El monto quedó mal: respondé la foto con el monto correcto.
   - Un comprobante que no va: respondelo con /anular.
   - Ya entró en un cierre: /restar con el monto.

7) CIERRE
   - Automático a las 13 h de lunes a viernes (el lunes junta todo el fin de semana).
   - También con /cierre o el botón 🔒.
   - Lo cerrado queda ⏳ PENDIENTE A COTIZAR → el que recibe marca 💱 COTIZADO
     → 📤 PENDIENTE A ENVIAR → marca ✅ ENVIADO → listo. Todo se avisa acá.
   - Después del cierre la suma arranca de $0. El TOTAL DEL MES sigue sin corte hasta fin de mes.

8) CBU DE BAJADA
   - El grupo que recibe avisa el CBU: llega 📢 CAMBIO DE CBU (queda fijado arriba).
   - Transferir SIEMPRE al CBU vigente y con la terminación que dice.
   - Los comprobantes con la terminación anterior se aceptan 24 h (transferencias ya hechas).
   - ⛔ SIN CBU DE BAJADA: no transferir hasta que llegue el CBU nuevo.
`;
}

function dst(ctx = {}) {
  const from = (ctx.sources || []).length ? (ctx.sources || []).map((s) => '   • ' + s).join('\n') : '   • (los grupos que envían, según la estructura)';
  return `GUÍA · GRUPO QUE RECIBE COMPROBANTES${ctx.group ? ' · ' + ctx.group : ''}
================================================

1) QUÉ LLEGA ACÁ
Los comprobantes que reenvía el bot desde:
${from}
Cada uno trae el monto y la suma acumulada. Además pueden llegar:
   ⚠️ "el cliente se equivocó con el decimal, pero va a este grupo" (lo eligieron a mano)
   ↪️ movido desde otro grupo · 🗑️ ANULADO · ➖ RESTADO · 📥 sumado lo anterior

2) CIERRE (13 h de lunes a viernes, o cuando el que envía lo da)
Llega 🔒 CIERRE con ⏳ PENDIENTE A COTIZAR: monto, del día/hora al día/hora y cantidad de comprobantes.
Si fue un cierre parcial lo dice ("cierre PARCIAL de $X") y el resto sigue sumando.

3) COTIZAR Y ENVIAR (o los botones del menú)
   /cotizado 1150 ....... marca COTIZADO lo pendiente a cotizar (la cotización es opcional)
                          → queda 📤 PENDIENTE A ENVIAR
   /enviado ............. marca ENVIADO → el pendiente se va
Cada paso se avisa al grupo que envía. Los botones piden confirmar.

4) VER LA SUMA
   /total ............... suma de cada grupo que envía + pendientes con todo el detalle

5) CBU DE BAJADA (la cuenta a la que transfieren)
   /nuevocbu ............ el bot muestra qué completar. Copiá, completá y mandá:
                             /nuevocbu
                             Titular: Juan Pérez
                             CBU: 0000003100012345678901
                             Alias: juan.perez
                             Terminación: ,82
                          Revisá y tocá "✅ Confirmar y avisar": la terminación cambia,
                          se avisa (fijado) al grupo que envía y el bot confirma "se dio aviso".
                          La terminación anterior se acepta 24 h más.
   Programado ........... agregá "Desde: 15/11 13:00" (y "Hasta: 20/11 13:00"):
                          avisa ya y cambia SOLO en esa fecha. Si vence sin otro CBU, avisa "sin CBU".
   /parar ............... NO HAY CBU: avisa al grupo que envía que no transfiera hasta nuevo aviso.
                          Apenas tengas CBU, poné /nuevocbu y completá los datos.
   /cbu ................. ver el CBU vigente y los programados

6) CORRECCIONES
   /anular .............. RESPONDIENDO un comprobante reenviado: lo saca de la suma (avisa a los dos grupos)
   /restar 50.000 ....... resta un monto · /anterior 13.686.199 ... suma lo que venía de antes del bot

7) OTROS
   /ayuda ............... menú con botones · /guia ...... esta guía · 📋 Ver comandos en cada suma
`;
}

module.exports = { src, dst };
