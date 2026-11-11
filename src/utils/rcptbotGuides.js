'use strict';
// #1079-o: guías como archivo .txt para cada grupo (y para armar los PDF).
// #1106 (owner: "un mensaje de bienvenida en cada grupo, presentación breve fijada y después el archivo con la explicación completa, para cada grupo
// correspondiente; lo del grupo 1 no hace falta explicar dónde va, sólo lo que pasa en su grupo"). Todo depende de cómo está armada la estructura:
// ctx = { group, close: '' | 'all' | 'weekdays' | 'weekly', monthly, srcQuote, usdtCheck, fichas }
// welcomeSrc / welcomeDst = la presentación breve (HTML de Telegram); src / dst = el archivo completo (texto plano).

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function closeTxt(ctx, html) {
  const b = (t) => (html ? '<b>' + t + '</b>' : t);
  if (ctx.close === 'weekdays') return 'cierre automático de ' + b('lunes a viernes a las 13 h') + ' (lo del fin de semana entra en el del lunes)';
  if (ctx.close === 'all') return 'cierre automático ' + b('todos los días a las 13 h');
  if (ctx.close === 'weekly') return 'cierre automático ' + b('semanal, los lunes a las 00:00');
  if (ctx.monthly) return 'cierre automático ' + b('a fin de mes') + ' (día 1 a las 00:00)';
  return 'cierre ' + b('a mano') + ' cuando completen el monto (/cierre o el botón)';
}

function welcomeSrc(ctx = {}) {
  return `👋 <b>BIENVENIDOS · ${esc(ctx.group || 'grupo')}</b>
Soy el bot de comprobantes de este grupo.

📸 <b>Mandá la foto del comprobante ENTERO</b> (que se vea el monto con los centavos). Lo leo, lo sumo y te contesto ✅ con la suma actualizada.
⚠️ Si no lo puedo leer, te pido una foto legible: <b>no se suma</b> hasta que llegue bien.
✏️ Si el monto o el decimal está mal, <b>respondé la foto con el monto correcto</b> y lo corrijo.
🔒 ${closeTxt(ctx, true)}${ctx.close || ctx.monthly ? '; también podés cerrar a mano con /cierre' : ''}.${ctx.srcQuote ? `
💱 Después de cada cierre: <b>Cotizar</b> (precio del USDT y comisión) y <b>Enviado</b> (foto de los USDT${ctx.usdtCheck ? '; controlo que coincida' : ''}).` : ''}

📘 Abajo va el archivo con la explicación completa. Botones: ver la suma, comandos y CBU.`;
}

function welcomeDst(ctx = {}) {
  if (ctx.fichas) return `👋 <b>BIENVENIDOS · ${esc(ctx.group || 'grupo')}</b>
Soy el bot de comprobantes. Este es un <b>grupo de FICHAS</b>.

🧾 Acá llegan los comprobantes que corresponden a este grupo, todos en <b>una sola cuenta</b>, con la <b>suma del mes</b>. Durante el mes no hay cierres.
🔒 El <b>día 1</b> llega el cierre del mes: tocás <b>🎰 Completar fichas del mes anterior</b> y escribís el monto.
➖ Resto la suma del mes menos las fichas: la diferencia queda <b>pendiente</b> y la cuenta nueva arranca desde ahí hasta llegar a 0.
✏️ Si alguien corrige un monto o un decimal, llega aclarado.

📗 Abajo va el archivo con la explicación completa.`;
  return `👋 <b>BIENVENIDOS · ${esc(ctx.group || 'grupo')}</b>
Soy el bot de comprobantes.

🧾 Acá llegan los comprobantes que corresponden a este grupo, todos en <b>una sola cuenta</b>, con el monto y la suma acumulada.
🔒 ${closeTxt(ctx, true)} ⇒ ⏳ <b>PENDIENTE A COTIZAR</b>.
💱 <b>Cotizar</b>: precio del USDT y comisión ⇒ calculo los USDT ⇒ 📤 <b>PENDIENTE A ENVIAR</b>.
✅ <b>Enviado</b>: mandás la foto de los USDT${ctx.usdtCheck ? ' y controlo que coincida' : ''} ⇒ listo.
✏️ Si alguien corrige un monto o un decimal, llega aclarado.

📗 Abajo va el archivo con la explicación completa.`;
}

function src(ctx = {}) {
  const n = ctx.srcQuote ? [6, 7, 8] : [0, 6, 7];
  return `GUÍA · GRUPO QUE ENVÍA COMPROBANTES${ctx.group ? ' · ' + ctx.group : ''}
================================================

1) QUÉ HACE EL BOT
Cada comprobante que mandan acá:
   - lo lee (monto con centavos),
   - lo SUMA y contesta ✅ con la suma actualizada y el total del mes.
No hace falta escribir nada: sólo mandar la foto.

2) CÓMO MANDAR UN COMPROBANTE
   - Foto del comprobante ENTERO, sin cortes ni reflejos: que se vea el monto CON CENTAVOS.
   - Un comprobante por mensaje.
   - Si es PDF, escribí el monto en el texto del mensaje (ej. 50000,82).
   - Fijate bien los CENTAVOS: si no corresponden, el bot avisa y no lo suma.

3) QUÉ CONTESTA EL BOT
   ✅ REENVIADO / SUMADO ... entró y se sumó. Muestra la suma y el total del mes.
   ⚠️ NO SE PUDO LEER ...... NO se sumó. Mandá una foto bien legible y se suma
                            (o respondé la foto con el monto con centavos).
   ❌ TERMINACIÓN MAL ...... los centavos no corresponden. NO se sumó.
                            Si el cliente se equivocó, tocá el botón y elegí; si el monto está mal,
                            respondé la foto con el monto correcto.
   🚫 DUPLICADO ............ ese comprobante ya se mandó: NO se suma.
                            Si es otra transferencia distinta: botón "Es otro comprobante: sumarlo".
   ⛔ SIN CBU .............. no transferir hasta el aviso de CBU nuevo.

4) CORREGIR UN MONTO O UN DECIMAL
   - Respondé la foto (o la respuesta del bot) con el monto correcto, con centavos (ej. 25000,82).
   - El bot lo corrige y ajusta la suma. Del otro lado llega aclarado qué se corrigió y quién.
   - Si ya entró en un cierre no se puede corregir así: usá /restar o /anterior.
   - /anular respondiendo un comprobante lo saca de la suma.

5) CIERRE
   - ${closeTxt(ctx, false)}.
   - A mano: /cierre (todo) o /cierre 500.000 (sólo ese monto; el resto sigue sumando).
   - Después del cierre la suma arranca de $0. El TOTAL DEL MES sigue sin corte hasta fin de mes.
${ctx.srcQuote ? `
6) COTIZAR Y ENVIAR (propio de este grupo)
   💱 Cotizar ............ el bot pide el precio del USDT y la comisión %: respondé su mensaje con
                           "1150 0" (USDT a $1.150, sin comisión). Hace la cuenta:
                           pesos ÷ precio − comisión = USDT A ENVIAR ⇒ 📤 PENDIENTE A ENVIAR
   ✅ Enviado ............ respondé su mensaje con la FOTO del envío de los USDT ⇒ ✅ VERIFICADO ENVIADO.${ctx.usdtCheck ? `
                           El bot lee los USDT de la foto: si no coincide avisa ❌ NO COINCIDE y sigue
                           pendiente; si está bien igual, botón "OK (a verificar)".` : ''}
` : ''}
${n[1]}) COMANDOS (o el botón 📋 Ver comandos)
   /total ............... suma actualizada y total del mes
   /cierre .............. cierra TODO lo sumado · /cierre 500.000 ... sólo ese monto
   /anterior 13.686.199 . suma lo que venían acumulando antes del bot
   /restar 50.000 ....... resta un monto
   /anular .............. respondiendo un comprobante: lo saca de la suma
   /cbu ................. a qué CBU transferir ahora (titular, CBU, alias, terminación)
   /ayuda ............... menú con botones · /guia ...... esta guía

${n[2]}) CBU
   - Cuando cambia, llega 📢 CAMBIO DE CBU / CAMBIO DE TERMINACIÓN (queda fijado arriba).
   - Transferir SIEMPRE al CBU vigente y con la terminación que dice.
   - ⛔ SIN CBU: no transferir hasta que llegue el CBU nuevo.
`;
}

function dst(ctx = {}) {
  const head = `GUÍA · GRUPO QUE RECIBE COMPROBANTES${ctx.group ? ' · ' + ctx.group : ''}
================================================

1) QUÉ LLEGA ACÁ
Los comprobantes que corresponden a este grupo, todos en UNA SOLA CUENTA (no importa de qué grupo vengan).
Cada uno trae el monto y la suma. Además pueden llegar:
   ✏️ MONTO CORREGIDO ..... el que envió corrigió el monto o el decimal (dice qué decía la foto y quién corrigió)
   ❌ ANULADO · MONTO CORREGIDO ... no era de este grupo: se descontó de la suma
   ⚠️ "se equivocó con el decimal, pero va a este grupo" (lo eligieron a mano)
   🗑️ ANULADO · ➖ RESTADO · 📥 sumado lo anterior
`;
  const tail = `
CBU DE BAJADA (la cuenta a la que transfieren)
   /nuevocbu ............ el bot muestra qué completar. Copiá, completá y mandá:
                             /nuevocbu
                             Titular: Juan Pérez
                             CBU: 0000003100012345678901
                             Alias: juan.perez
                             Terminación: ,82
                          Revisá y tocá "✅ Confirmar y avisar": se avisa (fijado) a los que envían.
   Programado ........... agregá "Desde: 15/11 13:00" (y "Hasta: 20/11 13:00").
   /parar ............... NO HAY CBU: avisa que no transfieran hasta nuevo aviso.
   /cbu ................. ver el CBU vigente y los programados

CORRECCIONES
   /anular .............. respondiendo un comprobante reenviado: lo saca de la suma
   /restar 50.000 ....... resta un monto · /anterior 13.686.199 ... suma lo que venía de antes del bot

OTROS
   /total ............... suma actualizada y pendientes
   /ayuda ............... menú con botones · /guia ...... esta guía
`;
  if (ctx.fichas) return head + `
2) GRUPO DE FICHAS: SUMA DEL MES
   - Durante el mes NO hay cierres ni cotización: se suma todo el mes.
   - Si hay un pendiente del mes anterior, cada comprobante muestra cuánto falta para llegar a 0
     (y "✅ pendiente cubierto" cuando llega); de ahí sigue sumando normal.

3) DÍA 1: CIERRE DEL MES Y FICHAS
   - Llega 🔒 CIERRE DE <MES> con la suma del mes.
   - Tocá 🎰 "Completar fichas del mes anterior" y respondé con el monto de fichas (o /fichas 12.500.000).
   - El bot calcula: pendiente anterior + suma del mes − fichas = DIFERENCIA.
   - Queda fijado 📌 FICHAS <MES> · COMPLETADO (fichas, suma, diferencia).
   - La cuenta nueva arranca en esa diferencia (negativa = falta cubrir; positiva = a favor).
` + tail;
  return head + `
2) CIERRE
   - ${closeTxt(ctx, false)}.
   - Llega 🔒 CIERRE con lo cerrado y ⏳ PENDIENTE A COTIZAR (total de todo lo que llegó).

3) COTIZAR Y ENVIAR (botones del menú)
   💱 Cotizar ........... el bot pide el precio del USDT y la comisión %: respondé su mensaje con
                          "1150 2" (USDT a $1.150, 2% de comisión). Hace la cuenta sola:
                          pesos ÷ precio − comisión = USDT A ENVIAR ⇒ 📤 PENDIENTE A ENVIAR
                          (también: /cotizado 1150 2)
   ✅ Enviado ........... respondé su mensaje con la FOTO del envío de los USDT ⇒ ✅ VERIFICADO ENVIADO.${ctx.usdtCheck ? `
                          El bot lee los USDT de la foto: si no coincide avisa ❌ NO COINCIDE y sigue
                          pendiente; si está bien igual, botón "OK (a verificar)".` : ''}
` + tail;
}

module.exports = { src, dst, welcomeSrc, welcomeDst, closeTxt };
