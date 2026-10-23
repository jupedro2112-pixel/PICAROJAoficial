// ============================================
// FIREBASE CLOUD MESSAGING + CACHE SERVICE WORKER
// SW único para notificaciones push Y caché PWA.
// Versión: 2.3.0
// ============================================
// ROOT CAUSE FIX: antes existían dos SWs (firebase-messaging-sw.js y
// user-sw.js) compitiendo en el mismo scope (/). Eso provocaba que el
// token FCM apuntara a un SW pero las notificaciones llegaran al otro,
// invalidando todos los envíos. Ahora este es el único SW activo.
// ============================================
// PWA WEBAPK FIX: Chrome Android exige que el SW responda (con
// event.respondWith) a la navegación hacia start_url para generar un
// WebAPK real. Si el SW ignora navigation requests (return sin llamar
// respondWith), Chrome no lo considera capaz de controlar start_url y
// sólo ofrece un acceso directo/shortcut en lugar de instalar la app
// como WebAPK. Se usa redirect:'manual' para que las redirecciones de
// Cloudflare Challenge sean seguidas por el navegador de forma nativa
// (opaqueredirect), sin que el SW actúe como proxy cross-origin.
// ============================================

// SDK Firebase self-hosted (mismo origen). Antes se importaba desde gstatic,
// pero en redes flaky ese host puede fallar y romper el SW entero. Sirviendo
// los scripts del propio dominio garantizamos que el SW siempre instale.
// Fallback a gstatic si el archivo local no estuviera disponible.
try {
  importScripts('/lib/firebase/9.1.2/firebase-app-compat.js');
  importScripts('/lib/firebase/9.1.2/firebase-messaging-compat.js');
} catch (localImportErr) {
  console.warn('[FCM-SW] No se pudo importar Firebase SDK local, cayendo a gstatic:', localImportErr && localImportErr.message);
  importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-messaging-compat.js');
}

// ============================================
// CONFIGURACIÓN DE CACHÉ
// ============================================
const CACHE_VERSION = 'v603'; // v603: botón 'Cargá el comprobante aquí' en respuestas de Soporte (#905) // v602: resumen 'Cómo funciona todo' en Soporte (#900) // v601: carga mínima $2.000 (#897) // v600: número de celular siempre bien armado para el SMS (#893) // v599: cartel activá notificaciones desde la 2ª carga (#892) // v598: rollover ×3 antifraude en Info/cargas/retiro + plazo del fueguito (#885) // v597: retiro bien explicado (#884) // v596: toda carga ×3 en Bases (#883) // v595: retiro con detalle del rollover (#881) // v594: retiro sin código por retiro (#879) // v593: soporte más corto y Bases chico (#878) // v592: reseña con regalo del 20% tras la 5ª carga (#875) // v591: fotos de juegos por nuestro server + ajuste de pantalla compacto (#869/#870) // v590: deslizar desde el costado para volver + Estirar pantalla (#868) // v589: ajuste de pantalla con arriba y abajo por separado (#867) // v588: favoritos abren el juego elegido en pantalla completa, logueado (#866) // v587: ajustar la pantalla al teléfono (modelo con buscador) + Info sin borroso (#865) // v586: favoritos abren Girox logueado (sin pantalla negra) + carteles de instalar encima de Girox (#863/#864) // v585: el último ingreso pedido es el que abre Girox (#862) // v584: FIX favoritos/Deportes entran logueados (ingreso intacto) (#861) // v583: cuotas en historias de partido, diagnóstico de juegos, Info fina (#858-#860) // v582: favoritos abren el juego directo con la sesión del jugador (#857) // v581: juegos con la sesión canjeada por el server + Info en tiras horizontales (#855/#856) // v580: Deportes/juegos de historias con el mismo ingreso que favoritos; directo si Girox ya está abierto (#854) // v579: Info estilo Pinterest en grilla (#852) // v578: juegos con el mismo ingreso que el botón de Girox (#851) // v577: juegos favoritos entran logueados (SSO con token) (#848) // v576: franja 'Tu saldo para jugar' arriba en Inicio, básico y Perfil (#847) // v575: Carga rápida compacta y abierta sólo al entrar por pauta (#843) // v574: sólo favoritos (10 de entrada, editables), sin Top juegos (#842) // v573: juegos favoritos en el Inicio con buscador (#840) // v572: primera carga 100% + después 50% extra instalando la app y activando notificaciones; Carga rápida con datos y extra pendiente (#839) // v571: al entrar siempre Girox directo salvo que la persona haya elegido otro menú (#836) // v570: reembolso diario 10% (#833) // v569: la gente nueva entra logueada sí o sí (reintentos, gracia del link, respaldo con usuario y clave; verify no borra la sesión por un corte) (#831) // v568: FIX la app no cargaba (error en ui.js frenaba todo el bundle) + login si falla el link de acceso (#829) // v567: historias automáticas (Deportes, slot de la semana, retirar, VIP) (#827) // v566: la app instalada entra con la sesión (iPhone) + recordatorio de usuario y clave (#826) // v565: el aviso del comprobante pide titular, CUIT, fecha y hora, monto y N° de operación (#825) // v564: ajuste por teléfono (margen superior real, barra del casino compacta) (#823) // v563: bono vigente adentro de CARGAR AHORA (#813) // v562: aviso comprobante con datos visibles (#808) // v561: recomendación de cambiar la clave (#806) // v560: carga rápida abierta tras el registro + historias salen del casino (#798/#799) // v559: el selector marca el menú actual (#795) // v558: menú completo como estaba, sólo la fila de servicios (#794) // v557: servicios en una línea en el completo + Cargá acá en burbujas (#791/#792) // v556: FIX Perfil (recuadro sin cerrar) + recuadro de usuario oculto (#790) // v555: Perfil: teléfono arriba, recuadro de usuario bien armado (#789) // v554: colores sobrios + título Top juegos en una línea (#787/#788) // v553: Top juegos = 10 más jugados de 1girox con fotos reales y enlace directo (#786) // v552: Jugar ahora en las fotos (#785) // v551: Perfil con el recuadro de usuario arriba + saldo (#783) // v550: fotos de Top juegos abren el juego directo (#782) // v549: Bases y condiciones embebible + chat sin selección al tocar (#777) // v548: FIX cuelgue total al abrir Carga rápida en el casino (#776) // v547: pulsos sólo con transform (#774) // v546: ruleta y misiones compactas (#768) // v545: PRIMERA CARGA llamativa (#766) + Perfil con usuario·logo·saldo y SMS arriba (#767) // v544: básico con nivel+racha como el completo, sin nombre ni saldo; accesos con recuadro e íconos de línea (#765) // v543: servicios más chicos (#764) // v542: servicios con los textos centrados (#761) // v541: básico compacto (#759) // v540: servicios en dos columnas horizontales, más bajos (#758) // v539: básico con mínimos adentro de CARGAR/RETIRAR, sin franja, plataformas más chicas (#757) // v538: Top juegos en negro, bloque de servicios más junto (#756) // v537: básico con los servicios arriba (#755) // v536: CARGÁ AHORA centrado y corto, sin la pastilla NOVEDAD (#754) // v535: sin la tarjeta de Telegram arriba; servicios como estaban (#752) // v534: Inicio y básico con 'Todo lo que ofrecemos 100% para vos', carga mínima adentro del botón, Telegram bajo el nivel (#751) // v533: registro sólo con invitación (#748) + tarjeta del canal de Telegram en el Inicio (#749) // v532: historias con bono (+X% en la próxima carga, push a todos, Reclamar ahora → Girox) (#742) // v531: barra del casino: logo al lado de Menú y PICA ROJA centrado (#741) // v530: el extra pendiente por instalar se acredita solo al abrir la app instalada (#740) // v529: bundle minificado + HTML liviano + preload (#738/#739) // v528: panel de Carga rápida compacto, burbuja visible con el panel abierto, aviso de 5 s arriba de la burbuja (#737) // v527: barra de instalar fina, 'Instalar app', sin subtítulo (#736) // v526: cargas siguientes: mismo cartel sin botones, 3 s (#735) // v525: selector de menús: Completo primero, Girox directo segundo como Recomendado (#734) // v524: al abrir la app todos entran directo a Girox; el menú se cambia desde Menú (#733) // v523: barra del casino centrada, sin superposiciones (#732) // v522: cartel de carga con el extra sobre el casino (regla perdida); barra Instalar fija sin cargas; pendiente en la Carga rápida y arriba en completo/básico (#731) // v521: el cartel de carga con el extra por instalar se ve también dentro de Girox (#730) // v520: al entrar a Girox el panel arranca cerrado + aviso de 5 s bajo la burbuja (#729) // v519: primera carga sin la app en el casino = cartel del menú completo que se queda; recordatorio del pendiente abajo (#727) // v518: la barra de instalar de la base se ve también dentro del casino; sin botón de instalar en la Carga rápida (#726) // v517: la burbuja vuelve a su lugar fijo y no puede estirarse (#724) // v516: burbuja simple (logo + CARGA RÁPIDA), al cargar se cierra el panel; botón 'Instalar la app' sin hablar del extra (#723) // v515: instalar la app en el casino como en el menú completo: oferta que se queda + botón 'instalar después' en la Carga rápida; sin barra fija (#722) // v514: tras la carga la burbuja queda arriba con logo + CARGA RÁPIDA sin el aviso de mover (#721) // v513: tras la carga, la burbuja mini se centra sobre PICA ROJA en la barra (#720) // v512: instalar la app dentro del casino: barra fija abajo + línea en el cartel de carga (#719) // v511: limpieza de punta a punta: funciones muertas, imágenes comprimidas, meta description (#718) // v510: la burbuja se esconde mientras el panel de Carga rápida está abierto y avisa que se puede mover (#717) // v509: tras una carga o un retiro dentro del casino la burbuja de Carga rápida se minimiza (#716) // v508: cartel ¡Felicitaciones! al pedir un retiro + Retiro de prueba (#714); Soporte 'Con el bono' explica el rollover (#715) // v507: cartel ¡Buena suerte! al cargar dentro del casino (#712); burbuja minimizada si entra a jugar desde otro menú, abierta en Girox directo (#713) // v506: Carga rápida minimizable a sólo el logo (burbuja movible) y burbuja más chica (#711) // v505: Info con 'La plataforma que quieras' (Girox, Ganamos y Jugaygana, todas originales) y niveles sin mencionar 1win (#710) // v504: botón Carga de prueba para testers + reinicio de usuario de prueba (#708); nota del casino sin 'escribinos a Soporte' (#709) // v503: barra del casino: Info al lado de Historias, marca centrada con recuadro (#707) // v502: nota de carga mínima resumida y más grande; Adjuntar comprobante llamativo con la carga mínima hasta la 5ª carga (#706) // v501: barra del casino con la marca en el medio y Menú = selector (#703/#704), landing entra directo a Girox (#704), cargar en verde y retirar en rojo (#705) // v500: Soporte con respuestas automáticas por tema + Bases y condiciones dentro de la app (#702) // v499: barra del casino en una línea con el formato de la barra principal, sin el texto 'Estás en Girox' (#701) // v498: barra del casino con Historias, Menú completo, Info y Perfil (#700) // v497: el casino con sesión siempre adentro (Carga rápida) + conexión al casino más paciente y con motivo (#695) // v496: sin 'Elegí dónde jugar' en el Inicio del completo (#694) // v495: sin hueco debajo de las tarjetas de juegos del Inicio (#692) // v494: 'escribinos a Soporte' con link directo en las notas de carga mínima (#691) // v493: la franja de carga mínima se ve hasta la 3ª carga (#690) // v492: Inicio: racha y nivel arriba de CARGÁ AHORA, franja de carga mínima más chica y firme (#689) // v491: texto firme: con menos de $5.000 la carga NO va a ser acreditada (#688) // v490: botón Ir a Soporte dentro de la Carga rápida del casino (#687) // v489: carga mínima bien grande en los botones de cargar (#686) // v488: Bases y condiciones al pie del Perfil (#685) // v487: carga mínima $5.000 bien clara en todos lados: con $5.000 o más automática, con menos Soporte (#684) // v486: link a Bases y condiciones en Info (#683) // v485: Girox directo no queda predeterminado; al volver a entrar se elige de nuevo (#678) // v484: ruleta por carga del día ($10.000 sumando cargas) (#677) // v483: guía de primera carga en el Inicio del completo (cartel con flecha a CARGÁ AHORA) (#675) // v482: historia 'Instalá la app' con link app:instalar (#674) // v481: instalar en iPhone con la sesión (manifest con token de acceso + menú) (#673) // v480: tarjeta Girox directo explica que abre Girox por ser la seleccionada; abre la preferida si tiene API (#672) // v479: Girox directo entra a 1girox al abrir la app sin preguntar el menú (#671) // v478: menú Girox directo (abre la plataforma al toque) + Retirar dentro de la Carga rápida (#670) // v477: la ruleta se desbloquea con carga de $20.000 (#669) // v476: ruleta: sólo la línea resumida de premios, con Sin premio (#668) // v475: ganadores de la ruleta con premios en % además de plata (#667) // v474: ruleta con premios resumidos y ganadores plegados con Ver más (#666) // v473: Info con tarjetas estilo página, textos legibles y Ver más recuadrado (#664) // v472: Niveles VIP en tarjetas, abre plegado en el nivel actual con Ver más (#663) // v471: Fueguito: en todos lados dice rollover = apostar, no cargar (#662) // v470: Niveles VIP con X arriba y modal que termina arriba de la barra inferior (#661) // v469: rollover ×5 en todos los regalos (menos referidos) explicado en Info; niveles VIP con Ver menos/Cerrar (#659) // v468: ruleta ×5 en la Info; rollover del fueguito 30× por default (#658) // v467: todas las explicaciones del fueguito hablan de rollover (#657) // v466: Fueguito por ROLLOVER escalonado (#654); historias se pausan al mantener apretado (#655) // v465: número de corrido en la verificación; historia de Telegram regalo semanal (#652) // v464: Referidos: botón de acumulado (se desbloquea solo el 1°) y cartel de compartir con el estilo de la app (#651) // v463: NOVEDAD de referidos: 5% para siempre a los referidos antes de diciembre (#650) // v462: ayudante de número por provincia en la verificación; historia de Misiones (#648) // v461: verificación con +54 9 fijo y explicación; links de historias verificar/soporte (#647) // v460: verificación arriba del Perfil (Importante); historias nuevas con la pica, links verificar/soporte, sin logo arriba (#646) // v459: Perfil: verificación de teléfono, notificaciones con Activar, sin Cambiar menú ni fueguito (#645) // v458: barra inferior Cambiar menú·Inicio·Perfil; franja segura con fondo; Retirar más verde (#644) // v457: margen inferior seguro con respaldo para Android borde a borde (#643) // v456: básico: plataformas arriba de CARGAR (#642) // v455: CARGÁ AHORA grande arriba del Inicio; Info resumido con Ver más (#641) // v454: Info reordenado + Fueguito (#640) // v453: Inicio ordenado (nivel+fuego · pendiente · Cambiar menú centrado · bono debajo), Copiar en rojo (#639) // v452: menú 2 sin parpadeo al recargar; barra superior bajo el notch (#638) // v451: línea nivel+fueguito arriba del Inicio; barra inferior más baja (#637) // v450: Carga automática limpia (sin nivel/fueguito/misiones), Cambiar menú sólo en Inicio, completo recomendado (#636) // v449: menús activos desde el panel; nivel VIP en la completa (#635) // v448: un solo JS y un solo CSS versionados e inmutables; sin 'viejo y después nuevo' (#634) // v447: adentro del casino no se cambia de plataforma (#633) // v446: 'Jugar ahora' tras la carga abre el casino adentro con Carga rápida (#632) // v445: Carga rápida abierta sola al entrar a jugar (#631) // v444: casino sin cajón de chat: sólo el panel Carga rápida (#630) // v443: la tarjeta Misiones del inicio completo vuelve a abrir (#629) // v442: básico: saldo a la izquierda, 'Fueguito' con etiqueta Novedad (#628) // v441: básico simple: nombre·saldo·racha en una línea, nivel junto a Cambiar menú (#627) // v440: aviso de 1ª carga resumido junto a 'Adjuntar comprobante' (#626) // v439: accesos del básico centrados en 4 columnas; pin.css sin restos de comentario (#624) // v438: JUGÁ AQUÍ abre el selector de plataformas (#623) // v437: Info con textos minimizados, todo en una pantalla (#622) // v436: PLATAFORMA en el centro de la barra superior (#621) // // v435: botón Plataforma en la barra (#620) // // v434: carteles de instalar/notificaciones con el estilo de la app (#619) // // v433: barra Instalar app abajo sin tapar el menú (#618) // // v432: diego651917 tester (#616) // // v431: historias tipo Instagram (#615) // // v430: prueba100 ve los tests (#614) // // v429: 'Chat cerrado · fecha' fijado bajo las opciones; el historial se conserva (#613) // // v428: presentación 'Bienvenido al soporte' arriba del chat (#612) // // v427: sin franja blanca abajo del básico; aviso de 1ª carga abre el panel de carga del básico (#610/#611) // // v426: historias sin cortar la foto; aviso de 1ª carga en los 3 menús (#607/#608) // // v425: 'el agente cerró el chat' visible, básico sin recorte, INICIO arriba (#604-#606) // // v424: charla sólo chat, 'Chat cerrado', acuse nuevo (#603) // // v423: soporte de problemas: selector de tema, charla limpia, cierre desde el panel (#602) // // v422: casino sin chat: sólo el panel de carga automática (#601) // // v421: menú intermedio llena la pantalla (#600) // // v420: soporte con botones prediseñados y bienvenida corta (#599) // // v419: Carga rápida del casino simple y burbuja libre (#598) // // v418: sin el cartel violeta 'Saldo acreditado' tras la carga (#597) // // v417: limpieza de carteles al entrar (#596) // // v416: entrada limpia: sin cartel de instalar ni popup de referidos; sólo el selector; todo plegado (#595) // // v415: sello de las historias con recuadro (#594) // // v414: historias con franja difuminada y logo arriba del texto (#592) // // v413: INICIO cierra CARGAR/RETIRAR en el básico (#588) // // v412: historias a pantalla completa, texto abajo de todo (#587) // // v411: historias sin banda negra, sello dentro de la foto (#585) // // v410: básico sin Niveles VIP en la fila de abajo (#584) // // v409: Carga auto en el básico expande CARGAR en la misma pantalla (#583) // // v408: historias con recuadro profesional (#582) // // v407: alta por landing entra directo a cargar sin ver el registro (#581) // // v406: instalar pendiente llamativo en nocturno (#579); básico = recomendado (#580) // // v405: menú básico con nivel VIP y fueguito (#578) // // v404: etiquetas de las plataformas adentro del tile (#576) // // v403: menú 2 = pantalla acortada, sin bloques blancos (#575) // // v402: sin barra de scroll visible en los menús (#574) // // v401: fondo en el recuadro Comprobante/Retirar (#572) // // v400: fila Comprobante/Retirar sólo tapa su línea; relleno en #homePanel (#571) // // v399: Fijar adentro del selector de menú; Cambiar menú sin etiqueta (#569) // // v398: fila Comprobante/Retirar fija abajo en Carga auto (#568) // // v397: cartel 1ª carga sólo en Inicio; menú 2 sin tapar (relleno en los scrollers) (#567) // // v396: dónde jugar primero, burbuja de carga, instalar arriba, Fijar, cartel 1ª carga, menú 2 fijo (#563-#565) // // v395: hoja 'Jugar ahora' por encima de la barra del menú 2 (#561) // // v394: menú preseleccionado para el ingreso (#559) · fueguito 'Racha' (#560) // // v393: menú opción 2: Perfil abajo, Soporte arriba (#558) // // v392: historias con foto completa y pie debajo (#556) // // v391: chips de servicio desde el panel (#555) // // v390: INGRESO no exime del SMS (#553) + limpieza CSS // // v389: limpieza de código muerto de la pantalla de ingreso (#549) // // v388: registro premium Pinterest con pasos; fix bloques ocultos (#548) // // v387: fix Registrarse (form oculto) + limpieza (#543) // // v386: ingreso compacto, registro en pantalla interna (#542) // // v385: Registrarse desde el inicio con nombre + SMS; sin 'Agregar a Inicio' en el ingreso (#541) // // v384: INICIO va al menú elegido (#539) · sin bono en el registro de la app (#540) // // v383: modo Iniciar sesión + acomodo de la pantalla de ingreso (#538) // // v382: banner del bono: 100% grande + 'instalando la app · si no, 50%' (#537) // // v381: fueguito mini, banner recordatorio, referidos Pinterest (#536) // // v380: registro automático con barra y entrada directa (#534) // // v379: link de referido → registro automático (#533) // // v378: código de referido también en el registro rápido (#532) // // v377: subtítulo del bono cuando el % sin app es 0 // // v376: pantalla de registro nueva (idea landing2, bono, 3 plataformas, servicios) (#530) // v375: REFERIDOS 2.0 (tablero, niveles, popup, chooser) (#529) // v374: ver mas en el basico, opiniones pegadas, fueguito junto a cambiar menu, misiones en una linea, plataformas chicas (#528) // v373: ajustes del Inicio completo (fotos mas chicas, fila arriba, plataformas en columna, boton mas arriba) (#527) // v372: fila de servicios del Inicio completo prolija (#526) // v371: novedad 'aprovecha reembolso 25% hasta diciembre' en una linea (#525) // v370: accesos en el basico; Misiones en la fila del Inicio completo; Reembolso 'Diario 25%' (#524) // v369: Inicio completo: novedad en una fila, plataformas en linea, Recomendado con recuadro, Girox legible (#523) // v368: modo nocturno mas sobrio y con mas separacion (#522) // v367: 'Menu facil' pasa a llamarse 'Menu intermedio' (#521) // v366: boton 'Cambiar menu' arriba del Inicio (#520) // v365: INICIO abre el selector de menu; se van los pases de abajo (#519) // v364: Info explica las misiones de la semana arriba de todo (#518) // v363: basico compacto, entra en una pantalla (#517) // v362: basico con Cargar/Retirar explicados y resueltos ahi, selector de otro menu mas grande (#516) // v361: misiones por nivel VIP (#515) // v360: misiones por nivel visibles en la app (#514) // v359: logo original de Ganamos (#513) // v358: MENU BASICO (cargar, retirar, elegir plataforma) + opcion en el selector (#512) // v357: 'Pronto' sutil en todas las plataformas sin API (#511) // v356: fix Referidos duplicado como Reembolso (#510) // v355: menu facil: Reembolso·Misiones / Referidos·Ruleta; sin Ver plataforma ni Soporte (#510) // v354: menu facil en recuadros sin encimar, saludo compacto (#509) // v353: misiones plegadas en el home completo + nota de rollover (#508) // v352: diego576413 en modo test completo (#506) // v351: cerrar sesion para diego576413 (#505) // v350: bono de segunda carga y misiones semanales en la app (#504) // v349: Jugaygana en negro; primera tarjeta de juegos sin el titulo 'Top 10' (#498) // v348: selector de reembolsos prolijo con reclamar directo (#497) // v347: Ganamos con fondo violeta en todos lados (#496) // v346: los 'jugando' varian rato a rato (#495) // v345: tarjetas de juegos un poco mas chicas (#494) // v344: revertidos #490 y #492 (tema claro por defecto, sin pastilla, iconos de siempre) (#493) // v343: menu facil con el formato viejo e iconos realistas (#492) // v342: tarjetas de juegos completas y mas chicas (#491) // v341: negro por defecto (blanco desde Perfil), menu facil en lista de tarjetas anchas, etiqueta +X% primera carga (#490) // v340: recuadro de juegos toma la altura de las tarjetas (#489) // v339: Top juegos individuales con 'N jugando' en el Inicio (#489) // v338: cartel BONO DE PRIMERA CARGA al entrar (X% / Y% con la app) (#488) // v337: captura aclara cuando muestra la clave inicial (#486) // v336: Inicio completo apenas mas chico para que entre la linea del menu facil; deslizable si no entra (#485) // v335: sin la foto de lobbies 2x2; la opcion de menu aplica en menu facil y completo sin ocultar nada (#482) // v334: opcion 2 = barra inferior con los botones reales (Carga auto · Inicio · Soporte), Info arriba, 'menu' en el saludo (#481) // v333: captura con logo y clave visible (#478), fondo del saludo (#479), menu opcion 2 barra inferior (#480) // v332: historias con boton interno app:referidos (#474); usuario de prueba lalodj499910 (#476) // v331: dos fotos nuevas en el deslizante del Inicio (slots y lobbies en vivo 2x2) (#473) // v330: novedad en Referidos: el 5% baja al 3% en diciembre (#472) // v329: 'Ver la plataforma' con selector Girox / Ganamos (Pronto) / Jugaygana (Pronto) (#470) // v328: condiciones de referidos y niveles VIP estilo 1win, detalle por nivel y soporte Telegram para Black (#465) // v327: medidor de uso de la app (ping cada 60 s) para Datos IA (#459) // v326: reembolso 'de tu NETWIN' en inicio/menu; promo 'valida hasta diciembre' solo dentro de los modales (#458) // v325: historias rehechas sin pie interno (franja inferior libre), Soporte con los 3, arriba solo el nombre (#456) // v324: historias: logo + PICA ROJA arriba a la izquierda (Instagram), sello de abajo en blanco sin pildora (#455) // v323: barras de progreso de historias tipo Instagram (#454) // v322: historias tipo WhatsApp: foto completa, sello de marca al pie, sin bloque negro (#453) // v321: visor de historias: marca arriba, texto abajo sobre fondo negro desgastado sin pisar la foto (#452) // v320: modal 'Tu opinion' con el estilo de la app (#450) // v319: Menu facil con avatar + nombre desplegable (ver mas); sin 'GIROX - LA APP QUE PAGA' en la entrada (#448/#449) // v318: detalle de reembolsos en inicio solo con el % diario (#447) // v317: selector de reembolsos: tres botones rojos con letra blanca e iconos de linea (#446) // v316: iconos con mas presencia (trazo grueso, duotono, caja rojo claro) (#445) // v315: alerta del banco sin pausar si el panel lo configura asi (#443) // v314: alerta 'banco con fallas' en el retiro (#442) // v313: Inicio post-login con iconos de linea (entrada, menu facil, selector, instalar app) (#441) // v312: iconos de linea (Pinterest) en Info y Perfil en vez de emojis (#440) // v311: Info: texto de plataformas en su linea, solo Girox/Ganamos/Jugaygana en negrita (#439) // v310: Info: texto de 'La plataforma que quieras' en negrita (#438) // v309: 'Cerrar sesion' en Perfil tambien para diego294290 (#437) // v308: parte superior del inicio un poco mas abajo, centrada con la de abajo (#436) // v307: 'Pronto' en vez de 'Proximamente' en Elegi donde jugar (#435) // v306: fila prioritaria 'Carga automatica y atencion personalizada' arriba de los beneficios (#434) // v305: 'CARGAS Y PAGOS LAS 24 HS SIN LIMITES' bajo el titulo (#433) // v304: beneficios con texto completo en tres filas (VIP PICA ROJA, reembolsos diarios/semanales/mensuales, referidos) (#432) // v303: mas espacio entre bloques del inicio; 'Jugaygana' con J mayuscula (#431) // v302: inicio en exactamente una pantalla de telefono (sin scroll, opiniones con el alto sobrante), sin burbuja de Soporte (#430) // v301: inicio mas compacto para que las opiniones entren en la pantalla principal (#429) // v300: recuadro 'Elegi donde jugar' debajo de Registrarse (jugaygana en minuscula), sin linea de estrellas, opiniones visibles (#428) // v299: inicio solo 'Completa tu nombre para registrarte' + 'Registrarse ya'; sin olvide clave / soporte / ya tengo cuenta (#427) // v298: paso 'Te registraste con exito' con usuario y clave antes de entrar (#426) // v297: la entrada con nombre es LA forma de registro; sin 'Crear mi cuenta' (#425) // v296: ingreso con tarjetas de beneficios (VIP, reembolsos, elegi donde jugar, referidos) con iconos de linea (#424) // v295: Girox nunca 'Proximamente' en la fila del ingreso (#423) // v294: fila de las 3 plataformas en el ingreso, Ganamos y jugaygana 'Proximamente' (#423) // v293: entrada rapida automatica para quien llega por link de publicidad (#422) // v292: entrada rapida solo con el nombre cuando el registro esta desactivado en el panel (#421) // v291: boton de ingreso 'Iniciar sesion', mas chico (#420) // v290: ingreso mas compacto arriba, reseñas con comentario visible, burbuja de Soporte chica en la punta (#419) // v289: registro siempre visible (tambien con link de publicista), 'Olvide mi contraseña', registro = usuario + clave + telefono + SMS, 'Confirmar y entrar' (#418) // v288: ingreso como estaba (login visible + Crear mi cuenta), reseñas deslizandose, historias como anillo arriba a la derecha (#417) // v287: ingreso sin chips ni ticker; historias publicadas + opinion de la gente (reseña que rota) (#416) // v286: ingreso en UNA pantalla estilo registro de app (sin scroll, explicacion resumida, linea de confianza) (#415) // v285: ingreso como REGISTRO (SMS), soporte para visitantes (burbuja + panel), ticker sobrio con el final del nombre visible (#414) // v284: 'Cerrar sesion' al pie de Perfil solo para lalodj (#412) // v283: botones Comprobante aqui / Retirar premio a mitad y mitad sin desbordar (#409) // v282: Info: 'La plataforma que quieras' (texto nuevo, jugaygana en minuscula) (#407) // v281: Perfil: el link de la pagina va recto debajo del titulo, en una linea (#406) // v280: fueguito: requisito por MONTO cargado en N dias (no por cantidad de cargas) en textos del home y del modal (#405) // v279: Perfil reordenado (Canjear codigo arriba, Menu, Nocturno + Notificaciones, datos + Capturar, Fueguito, resto) y mas compacto (#404) // v278: etiquetas Telegram / Historias de la barra mas chicas, sin corte (#403) // v277: la barra 'Instala la app' pendiente ya no tapa Comprobante aqui / Retirar premio (#402) // v276: Soporte: la presentacion se va cuando el cliente ya escribio; cierre automatico a las 6 h sin respuesta y el chat arranca de cero para el (#401) // v275: Perfil: modo nocturno arriba con Activar/Desactivar, filas usuario/clave/pagina en una linea, Ocultar debajo de Copiar; nocturno: texto --p-inv sobre fondos negros (#399) // v274: modo nocturno solo dentro de Perfil, sin boton en la barra (#396) // v273: modo nocturno de la app (Perfil + barra, #392), Perfil con codigo de referido y clave visible (#393), ruleta sin probabilidades (#390), Retirar premio verde + 'Comprobante aqui' (#391), Info en tarjetas con titulo recuadrado (#394) // v272: 'Retirar premio' con minimo y 'pago automatico' afuera; textos de los botones editables // v271: chips de Soporte mandan solos; Cargar/Retirar responden con boton al sector // v270: plataformas de carga automatica en una fila de cuadrados // v269: codigo SMS en cada retiro // v268: pantalla de ingreso nueva (marca, servicio, reembolsos, plataformas, carga minima, resenas) // v267: pestanas de plataformas iguales (3 cuadrados) + Soporte independiente del chat viejo // v266: retiro minimo $10.000 configurable + 'pago automatico' en el modal de retiro // v265: JUGAYGANA como tercera plataforma (Proximamente) // v264: Soporte paralelo (chat nuevo desde hoy, respuestas firmadas por la persona de turno) // v263: carga automatica: aviso de comprobante duplicado, acuse 'recibimos tu comprobante', franja 'carga pendiente' y rechazo // v262: Soporte 100% soporte (sin cartel de carga automatica ni botones extra; bienvenida nueva) // v261: ruleta: como se desbloquea (carga minima), premio mayor 1 cada 1000, estado bloqueado // v260: Carga manual -> SOPORTE (Martin se presenta, chat con el estilo de la pagina) // v259: ruleta con el estilo nuevo + aviso 'promocion hasta diciembre' en reembolsos // v258: nombre de la app 'PICA ROJA oficial' + logo real de Telegram en la barra // v257: tema Pinterest (blanco, grises, rojo) en toda la app salvo Carga manual // v256: Info del servicio en un solo mensaje, sin app/notificaciones (quedan en Perfil) // v255: el selector facil/completo pregunta en cada arranque y tras 10 min afuera; boton 'Pasar al menu completo' // v254: MENU FACIL (selector al entrar + pantalla de 6 accesos grandes) // v253: al entrar a Carga manual el CBU aparece solo // v252: tarjeta CBU en el chat con 'Por favor enviar comprobante aqui' // v251: letras de la barra de arriba mas chicas, sin cortes // v250: fix endpoint del Telegram de la barra // v249: Telegram a la izquierda, colores en las puntas, 'Historias' mas chico // v248: HISTORIAS (anillo arriba a la derecha + visor) // v247: resenas: 'Deja tu opinion' fija y chica, el resto desliza // v246: Info del servicio con el reembolso diario // v245: tarjeta Reembolso del inicio con el % diario (25) // v244: icono nuevo (pica) + nombre CARGAS AUTOMATIC // v243: titulo/nombre de la app 'CARGAS AUTOMATICA' // v242: tarjeta del fueguito mas baja // v241: fotos del inicio mas grandes // v240: regla del fueguito en una linea // v239: 'Proximamente' visible debajo de Ganamos (tarjeta y pestana del Inicio) // v238: inicio sin puntitos ni etiqueta; boton de cargar abajo de la foto // v237: referidos 5% (texto desde el server) // v236: logo de Ganamos (pica violeta) + promedio de resenas con estrella parcial // v235: reembolso DIARIO de vuelta (25%), semanal 3%, mensual 1%, cartel NOVEDAD en Inicio // v234: JS/CSS network-first (los deploys se ven en la primera apertura); regla del fueguito arriba del modal // v233: fueguito: 'minimo 10 cargas entre racha y racha' visible aunque el server no mande el valor // v232: premios del fueguito x5 en los textos por defecto // v231: texto del fueguito: minimo 5 cargas entre racha y racha // v230: fueguito: la condicion se ve adentro del modal (estaba oculta), minimo 5 cargas por racha // v229: carga manual: avatar de asistente mujer y 'Escribi aqui' en el campo // v228: sin parpadeo del login con sesion guardada; verificacion general sin errores // v227: sin el boton 'Link casino aqui' en carga auto y manual // v226: regla del fueguito (minimo 10 cargas por racha, si no vuelve a 0) a la vista en la tarjeta // v225: carga auto: el panel scrollea adentro, los botones de abajo no se enciman // v224: boton rojo encima de la foto (sin reservar lugar) y sin leyenda abajo // v223: recuadro de fotos al espacio que sobra: Inicio sin deslizar, opiniones a la vista // v222: sin el boton LINK CASINO en el Inicio // v221: puntos del carrusel arriba del boton rojo (no detras de LINK CASINO) // v220: ajuste y centrado por modelo (chico/estandar/grande, tablet centrada, bajos, safe areas) en Inicio, carga auto y manual // v219: carga automatica ocupa toda la pantalla y escala en telefonos altos (Samsung A56 etc.) // v218: fotos del Inicio con la version pegada al link (sin cache viejo) // v217: fotos del Inicio con nombres nuevos (g1..g5) y en el orden pedido; sin fotos anteriores // v216: 'LINK CASINO AQUI · www.1girox.com' como boton en el Inicio y en carga auto/manual // v215: sin el boton 'Ver completas' en las fotos // v214: boton 'Link plataforma' abajo de carga auto y carga manual (abre el casino para jugar) // v213: fotos nuevas del carrusel del Inicio (5 grillas de juegos) // v212: fondo como estaba antes (se quitaron los cambios de tono #321/#325) // v211: fondo un poco mas oscuro y barra superior con el mismo fondo // v210: leyenda del carrusel = link de la plataforma (www.1girox.com) que abre aparte adentro de la app // v209: boton 'Ver completas / Achicar' en las fotos del Inicio (pantalla completa) // v208: fotos completas en el Inicio (recuadro con altura propia) y boton chiquito sobre el final de la foto // v207: fondo azul profundo (mas claridad), vidrio un poco mas claro // v206: boton de cargar en una linea, mas bajo // v205: etiqueta 'FOTO ILUSTRATIVA · aca no se juega' en cada foto y leyenda clara // v204: foto principal de la pagina completa de Girox primera en el carrusel, con recuadro fino tipo pantalla // v203: opiniones de jugadores con mas vida (vidrio, estrellas doradas, insignia de promedio) // v202: sin la linea 'Vista ilustrativa' en el Inicio // v201: boton grande 'Para cargar ahora mismo · apreta aqui' debajo de las fotos // v200: fotos del Inicio a todo el ancho con recuadro y fondo desenfocado // v199: tests tambien con la app instalada para el usuario de prueba // v198: Inicio con carrusel de fotos ilustrativas de Girox (cada 2 s) en vez de la pagina embebida // v197: numero de version visible en Perfil (app vNNN) // v196: con la app instalada no hay test ni para lalodj (funciona como app real) // v195: Inicio siempre al entrar; carga minima tambien en el paso 2 y en el cartel del chat // v194: cabecera del chat 'Carga manual' con asistente // v193: perfil con avatar (recuadro de usuario, selector de iconos, iconos de nivel que se desbloquean) // v192: recarga automatica al entrar una version nueva; tarjetas Girox/Ganamos compactas en carga auto; saldo con el numero abajo // v191: carga minima $5.000 siempre visible (linea en la tarjeta + boton), aun sin redeploy // v190: Girox siempre elegible (nunca 'Proximamente') // v189: Girox siempre seleccionable; Ganamos como estaba (pestaña abre su pagina) con etiqueta Proximamente // v188: carga minima $5.000 en el boton de comprobante y el paso 1 (configurable); iconos de casino discretos y patron tenue de fondo // v187: aviso premium 'la unica app que paga todo en el momento' en el Inicio; Ganamos visible como 'Proximamente' (no seleccionable hasta tener API) // v186: Jugar ahora abre la plataforma afuera con autologin y linea finita 'Volver a cargas'; tests solo para el usuario de prueba; textos segun plataformas habilitadas (Ganamos apagada) // v185: 'Adjuntar comprobante aqui'; un solo cartel (Jugar ahora + extra por instalar) y barra pendiente de punta a punta; fueguito del inicio como estaba, premios plegables y condicion abajo en el modal; niveles VIP abren la escalera (tambien en el test); sin Soporte en vivo en Perfil // v184: niveles VIP escalera 1win (19 niveles) con la plata que desbloquea cada nivel // v183: Info sin opiniones ni ruleta; nivel VIP al lado del saldo con la app instalada (+test); fueguito con barra de niveles y regla de cargas minimas // v182: oferta por instalar la app = % EXTRA sobre la carga (50%), 'cargarlo ahora' o 'despues de jugar' // v181: Informacion del servicio con el estilo de la barra de arriba (recuadros de vidrio, texto grande) // v180: sin globo flotante de soporte // v179: barra de arriba 'Carga auto' // v178: 'Recomendado' debajo de Girox // v177: carga gratis — 'la instalo despues' pinta el boton grande de abajo tambien en test y sin depender del server // v176: pasos 1 y 2 de 'Carga aca' en recuadros, compactos (sin scroll) // v175: carga GRATIS por instalar la app en la primera carga (hoja de oferta, boton grande pendiente, reclamo desde la app instalada, test) // v174: 'Carga aca' centrada con paso 2 (adjunta la foto abajo); boton 'Carga aqui (adjunta la foto aqui)' // v173: opiniones deslizan solas (pausa al tocar) // v172: carrusel de opiniones con 30 reseñas al azar por apertura // v171: vuelven las paginas embebidas al entrar (sin modo logo) // v170: Inicio en modo logo (sin cargar la web), 'Ver pagina' desde el 2º ingreso, texto explicativo grande con links, test de 2º ingreso // v169: nota 'vista ilustrativa · para cargar usa la barra de arriba' en el Inicio // v168: cartel 'Jugar ahora' al acreditarse la carga (abre la plataforma adentro de la app) + boton test chiquito en carga manual y automatica // v167: Perfil en estilo oscuro // v166: resenas discretas (sin fondo blanco) con 'Deja tu opinion' primero; sin aviso de verificar telefono // v165: toda la barra con el estilo del Inicio (iconos SVG, vidrio, corte diamantado); Fueguito diario arriba de la carga automatica // v164: carga automatica con alias+titular y explicacion de plataformas (sin Entrar); Fueguito diario entre Cargar y Retirar; cartel del chat corto 'Recomendable' + Ir a carga automatica // v163: Inicio moderno/futurista (sin retro); resenas tipo Google deslizantes al pie del Inicio; Perfil con usuario/clave/link protagonistas + capturar // v162: Inicio al centro, separado y retro; reembolso / ruleta / referidos arriba del Inicio; carga automatica sencilla // v161: barra de arriba Inicio / Carga automatica / Carga manual / Info / Perfil (usuario+clave, cambiar clave, notificaciones, canal, codigo, instalar, fueguito); sin botones abajo en la entrada // v160: pantalla de entrada — Girox abierto adentro, Ganamos para cambiar, Carga manual / Carga automatica // v159: chat estilo WhatsApp como pantalla principal + cartel 'Servicio completo' con menu deslizante (Ver todo) que despliega la app completa // v158: circulos de la cabecera mas chicos // v157: cabecera apenas mas baja // v156: franja del saldo a la mitad de alto // v155: Instalar app (IMPORTANTE) al lado del saldo; abajo Referidos + Como funciona en una linea // v154: app instalada → casino adentro con carga rapida en formato CARGA (descartable); navegador → aparte con barra Volver // v153: el casino se abre APARTE en /jugar.html con barra 'Volver a la app' (login por API; Ganamos su web; prueba = home publica) // v152: Android sin prompt — info con boton 'Apreta aca para abrir en Google Chrome' (link de acceso directo) // v151: bono de nivel VIP a reclamar con cartel de felicidades y eleccion de plataforma; home compactada en una pantalla; saldo arriba // v150: niveles VIP sin plata — solo nivel y porcentajes // v149: 'Recomendado' en rojo en el recuadro de Girox // v148: Info del servicio — app+notis en una linea arriba, titulo chico, ruleta plegada en vez de niveles VIP // v147: tarjeta de nivel VIP con barra de progreso y escalera desbloqueable debajo de Guarda tu acceso // v146: circulo de arriba 'Soporte aqui' con icono de chat (sin logo de Girox) // v145: Retirar premio en una linea, fila de acciones a la mitad de alto // v144: niveles VIP plegados debajo de reseñas en Info del servicio // v143: instalar app — Android con prompt instala directo, iPhone/otros ven los pasos, Instagram en Android abre Chrome; el botón dice qué va a pasar // v142: fix div sobrante de la tarjeta de carga; Retirar 'se retira automaticamente'; circulo de arriba restaura la burbuja // v141: tarjeta de carga sin paso 2; Cargar aqui dice adjuntar comprobante / se carga automaticamente // v140: prueba = página principal de cada casino; burbuja con ícono de chat y X adentro // v139: Probá las plataformas mejor presentado; modo prueba sin la carga rápida dentro del casino // v138: fila de reembolsos sin recortes + modal de reembolso simple estilo cambio de clave // v137: burbuja de soporte compacta (foto), se saca con X y queda arriba al lado del fueguito // v136: cobro de referidos desde la app, aviso de clave inicial, tarjetas de plataforma chicas con logo (Ganamos violeta) // v135: referidos — como funciona plegado, el resto en una pantalla // v134: fila Cargar aqui (adjuntar comprobante) + Retirar mi premio en rojo // v133: info del servicio — reseñas plegadas arriba, niveles VIP detallados abajo, una hoja centrada // v132: pruebas de plataforma y Ganamos SIEMPRE dentro de la app (recuadro embebido), nada de Chrome // v131: pruebas de plataforma (Girox/Ganamos en Chrome) dentro del soporte // v130: 'Guardá tu acceso a la app' plegable debajo de reembolsos con la captura adentro // v129: fueguito resumido (racha + reclamar + premios) // v128: '¿Dónde querés jugar?' arriba del CBU — tocar = elegir (queda fija), Entrar abre con sesión // v127: burbuja flotante 'Soporte en vivo aquí' (arrastrable, minimizable, abierta al entrar) en vez de la fila; campana y fueguito en los círculos de arriba // v126: info del servicio nueva (por qué elegirnos, reembolsos NOVEDAD, ruleta), reembolsos verdes 'Cobrá tu reembolso acá', ruleta del home, captura solo link/usuario/clave // v125: carga en 2 pasos (CBU → comprobante, acceso secundario) + RETIRAR verde grande con brillo // v124: link de la app completo en la tarjeta de carga // v123: rojo de marketing, arriba al mínimo, reembolsos a la mitad, plataforma FIJA, cómo funciona separado abajo, modales en formato nuevo // v122: barra de soporte sin cortes en pantallas angostas // v121: tema diamante/futurista (vidrio, cian/violeta, cortes diamantados, Montserrat) — chau serif // v120: cabecera de círculos (Canal/Info/Código/Instalar/Clave) sin menú desplegable, carga compacta, barra del casino con plataformas + volver al menú de cargas, estilo premium negro/dorado // v119: home limpia — chau bono por instalar la app, cómo funciona plegado arriba, barra inferior REFERIDOS / INSTALAR APP, explicación completa en el chat // v118: HOME 2.0 — carga automática al frente (CBU/alias/datos de acceso/captura), chat como SOPORTE arriba, plataformas para elegir dónde jugar, cómo funciona el servicio, reembolsos compactos // v117: multi-plataforma — botones "¿dónde querés jugar?" (Girox / Ganamos) y link externo en los mensajes de sistema // v116: Información del Servicio y mini-tarjeta muestran el % vigente del bono por instalar la app (chau 100% fijo)
// v115: // v115: ruleta diaria con premios en % y tabla de probabilidades + bonos pendientes se aplican solos en la carga + sin bono de bienvenida para registros manuales
// v114: // v114: el cartel del bono por instalar la app toma el % y los textos del server (editables en COMANDOS) — chau 100% fijo
// v113: // v113: REEMBOLSO ACUMULATIVO de por vida en el perfil (tarjeta + reclamar + actualizar) — ESPEC-REEMBOLSO-1GIROX
// v112: // v112: la burbuja del casino ahora es una PASTILLA con logo 1G + "CARGA RÁPIDA" (no más 🎧 que parecía soporte de la página), el panel arranca ABIERTO al entrar, y pista de que se puede arrastrar
const CACHE_NAME = 'sala-juegos-fcm-' + CACHE_VERSION;

// Logs por-fetch del SW (corren en CADA request). Apagados por default;
// poner SW_DEBUG = true para diagnosticar. Los logs de install/activate quedan.
const SW_DEBUG = false;
function _slog() { if (SW_DEBUG) console.log.apply(console, arguments); }

const PRECACHE_URLS = [
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Determina si un asset (no navegación) debe usar network-first.
// NOTA: Las navigation requests (modo 'navigate') se excluyen antes de
// llegar aquí, por lo que NO es necesario listar '/' ni '/index.html'.
function isNetworkFirst(url) {
  // #348: TODO el JS/CSS propio va network-first (el server los manda con no-cache): el deploy se ve en la
  // PRIMERA apertura, sin esperar a la siguiente (antes stale-while-revalidate servía el JS viejo una vez más).
  // Sin red, cae al caché.
  try {
    var u = new URL(url);
    if (u.origin === self.location.origin && (u.pathname.indexOf('/js/') === 0 || u.pathname.indexOf('/css/') === 0)) return !u.searchParams.has('v'); // #634: con ?v= es inmutable → cache-first
  } catch (e) {}
  return (
    url.includes('/app.js') ||
    url.includes('/manifest.json')
  );
}

// Módulos JS/CSS propios: stale-while-revalidate — se sirven del caché
// (rápido, igual que antes) pero se revalidan en background, así un deploy
// llega a los clientes en la SIGUIENTE carga sin bumpear CACHE_VERSION a mano
// (causa raíz de los bugs "fantasma" de código viejo cacheado).
function isStaleWhileRevalidate(url) {
  try {
    var u = new URL(url);
    if (u.origin !== self.location.origin) return false;
    // Se incluye /img/ (fondos del chat): son archivos que no cambian nunca y
    // pesan decenas de KB — servirlos del caché evita que el chat aparezca sin
    // fondo mientras cargan en una conexión lenta.
    // #634: /js/ y /css/ ya NO van stale-while-revalidate (era lo que mostraba la versión vieja un rato y después
    // "se actualizaba"): con ?v= son inmutables (cache-first, rama final) y sin ?v= van network-first.
    return u.pathname.indexOf('/img/') === 0;
  } catch (e) {
    return false;
  }
}

// Verifica si una URL pertenece a Cloudflare u otros dominios de seguridad
// que NUNCA deben pasar por el caché del SW.
function isCloudflareOrSecurityUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'challenges.cloudflare.com' ||
      parsed.hostname.endsWith('.cloudflare.com') ||
      parsed.pathname.startsWith('/cdn-cgi/')
    );
  } catch (e) {
    return false;
  }
}

// ============================================
// CONFIGURACIÓN DE FIREBASE
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyAjZuVIxNY-SrnihkyNVupZ8AhXX6qxAxY",
  authDomain: "saladejuegos-673fa.firebaseapp.com",
  projectId: "saladejuegos-673fa",
  storageBucket: "saladejuegos-673fa.firebasestorage.app",
  messagingSenderId: "553123191180",
  appId: "1:553123191180:web:277eb460ef78dab8525ea9",
  measurementId: "G-3ZJRT0NCTE"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

console.log('[FCM-SW] Firebase Messaging Service Worker v4 iniciado');

// ============================================
// NOTIFICACIONES EN BACKGROUND (FCM SDK)
// ============================================
messaging.onBackgroundMessage(function(payload) {
  console.log('[FCM-SW] Notificación en background:', payload);

  const notif = payload.notification || {};
  const webNotif = (payload.webpush && payload.webpush.notification) || {};

  const title = notif.title || webNotif.title || 'Sala de Juegos';
  const body  = notif.body  || webNotif.body  || 'Tienes un mensaje del soporte';
  const icon  = notif.icon  || webNotif.icon  || '/icons/icon-192x192.png';
  const badge = notif.badge || webNotif.badge || '/icons/icon-72x72.png';
  const tag   = (payload.data && payload.data.tag) || 'chat-message';

  // Confirmación de entrega: si el envío vino con batchId+userId, avisar al
  // backend que el push llegó realmente (cubre el falso "enviado" cuando
  // FCM acepta el mensaje pero la subscription estaba muerta).
  const _data = payload.data || {};
  if (_data.batchId && _data.userId) {
    fetch('/api/notifications/confirm-delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: _data.batchId, userId: _data.userId }),
      keepalive: true
    }).catch(function (err) {
      console.warn('[FCM-SW] confirm-delivery falló:', err && err.message);
    });
  }

  const options = {
    body,
    icon,
    badge,
    tag,
    requireInteraction: false,
    data: _data,
    actions: [
      { action: 'open',  title: 'Abrir chat' },
      { action: 'close', title: 'Cerrar'     }
    ],
    vibrate: [200, 100, 200]
  };

  return self.registration.showNotification(title, options);
});

// ============================================
// CLICK EN NOTIFICACIÓN
// ============================================
self.addEventListener('notificationclick', function(event) {
  console.log('[FCM-SW] Click en notificación:', event.action);

  event.notification.close();

  if (event.action === 'close') return;

  // #742: si la notificación trae una URL (ej. /?story=<id>), la app abierta la recibe por mensaje y abre esa historia; si no
  // hay ventana, se abre esa URL.
  const _url = (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            try { client.postMessage({ type: 'vip-open', url: _url }); } catch (e) {}
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(_url);
        }
      })
  );
});

// ============================================
// INSTALACIÓN
// ============================================
self.addEventListener('install', function(event) {
  console.log('[FCM-SW] Instalando', CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(PRECACHE_URLS);
      })
      .catch(function(err) {
        console.log('[FCM-SW] Error al pre-cachear:', err);
      })
  );

  self.skipWaiting();
});

// ============================================
// ACTIVACIÓN
// ============================================
self.addEventListener('activate', function(event) {
  console.log('[FCM-SW] Activado', CACHE_VERSION);

  // IMPORTANT: clients.claim() must be inside event.waitUntil so that
  // navigator.serviceWorker.ready only resolves AFTER the SW is actually
  // controlling the page. If claim() is called outside waitUntil, the
  // ready promise may resolve before navigator.serviceWorker.controller
  // is set, causing getToken() to fail in standalone/PWA mode because
  // FCM internally checks the controller state.
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(name) {
          if (name !== CACHE_NAME) {
            console.log('[FCM-SW] Eliminando caché antiguo:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ============================================
// FETCH (ESTRATEGIA DE CACHÉ)
// ============================================
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // PWA WEBAPK FIX: responder a navigation requests con fetch de red
  // (sin caché). Esto es imprescindible para que Chrome Android verifique
  // que el SW controla start_url y genere un WebAPK real en lugar de un
  // acceso directo. redirect:'manual' devuelve opaqueredirect para
  // redirecciones cross-origin (p. ej. Cloudflare Challenge), que Chrome
  // sigue de forma nativa sin que el SW actúe como proxy.
  if (event.request.mode === 'navigate') {
    _slog('[FCM-SW] Navigation request - respondiendo con red (sin caché):', url);
    event.respondWith(
      fetch(event.request, { redirect: 'manual' })
        .catch(function() {
          _slog('[FCM-SW] Red no disponible para navegación:', url);
          return new Response('Sin conexión - por favor verificá tu internet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
    );
    return;
  }

  // Excluir URLs de Cloudflare, cdn-cgi y cualquier dominio de seguridad.
  if (isCloudflareOrSecurityUrl(url)) {
    _slog('[FCM-SW] URL de seguridad excluida del caché:', url);
    return;
  }

  // Excluir API y sockets: siempre van a red.
  if (url.includes('/api/') || url.includes('/socket.io/')) return;

  if (isStaleWhileRevalidate(url)) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        var network = fetch(event.request).then(function(response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var toCache = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, toCache);
            });
          }
          return response;
        }).catch(function() {
          // Sin red: si había caché ya se devolvió; si no, propagar el fallo.
          return cached;
        });
        return cached || network;
      })
    );
    return;
  }

  if (isNetworkFirst(url)) {
    // Network-first: siempre intenta red para que los deploys sean inmediatos.
    _slog('[FCM-SW] Network-first para:', url);
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var toCache = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, toCache);
            });
          }
          return response;
        })
        .catch(function() {
          _slog('[FCM-SW] Red no disponible, buscando en caché:', url);
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-first para assets estáticos estables (iconos, fuentes, etc.)
    event.respondWith(
      caches.match(event.request)
        .then(function(cached) {
          if (cached) {
            _slog('[FCM-SW] Cache hit para:', url);
            return cached;
          }
          _slog('[FCM-SW] Cache miss - red para:', url);
          return fetch(event.request).then(function(response) {
            if (response && response.status === 200 && response.type === 'basic') {
              var toCache = response.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, toCache);
              });
            }
            return response;
          });
        })
        .catch(function() {
          return undefined;
        })
    );
  }
});

// ============================================
// MENSAJES DESDE LA APP
// ============================================
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
