
/**
 * Service Worker para Admin Panel - Sala de Juegos
 * Maneja notificaciones push y caché de la app
 *
 * IMPORTANTE: Incrementar CACHE_VERSION en cada deploy para forzar
 * la invalidación del caché en dispositivos con la app instalada.
 */

// ============================================
// FIREBASE CLOUD MESSAGING — handler de background del panel admin.
// Sin esto, los push al admin con la app cerrada no se mostraban (este SW
// no importaba el SDK y no había handler de background).
// ============================================
try {
    importScripts('/lib/firebase/9.1.2/firebase-app-compat.js');
    importScripts('/lib/firebase/9.1.2/firebase-messaging-compat.js');
} catch (localImportErr) {
    console.warn('[SW-Admin] Firebase SDK local no disponible, cayendo a gstatic:', localImportErr && localImportErr.message);
    importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/9.1.2/firebase-messaging-compat.js');
}

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

// Bump this version with every deploy so the admin PWA always loads fresh code.
const CACHE_VERSION = 'v183'; // v161: borrar una historia automática desde el Cronograma (#828) // v160: historias automáticas en Cronograma + Historias abajo (#827) // v159: análisis diario de la estrategia de notificaciones arriba del Cronograma (#824) // v158: chat de soporte sin Comunidad (Abiertos · Cerrados · Pagos) (#822) // v157: estrategia automática fija (sin lanzar ni editar) + Notificaciones abajo (#821) // v156: detalle adentro de cada recuadro del mes + Cronograma limpio con el autopiloto arriba (#818/#819) // v155: autopiloto de retención + a quién le llegó y cómo van reclamando en el Cronograma (#816/#817) // v154: Cronograma arriba de todo (#815) + Chats · Soporte arriba y columna Soporte abajo (#814) // v153: resultados en todas las campañas (#807) // v152: link de resultados del publicista (#805) // v151: carga rebotada (#803) // v150: clave de Datos en todo pedido admin (#796) // v149: historia de bono en 1 toque (#772) // v148: sección Gastos (pago por API + registro) que el cierre descuenta y explica (#770) // v147: sección Cargas automáticas + limpieza de datos de prueba (#762/#763) // v146: títulos del menú más chicos y compactos (#753) // v145: Soporte pendientes/cerrados sin visitantes (#747), registro sólo con invitación (#748), invitación a la comunidad (#749), análisis del día en Cargas y Retiros pendientes (#750) // v144: ingreso del panel con logo y PICA ROJA oficial (#746) // v143: clave también en Cuentas y Dashboard de publicistas (#745) // v142: cierres automáticos con conciliación, panel estilo Pinterest con PICA ROJA Panel, Referidos en App, clave en Publicidad y Cierres (#744/#745) // v141: menú reorganizado + clave para todo lo que es Datos y SMS (#743) // v140: historias con bono + push a todos (#742) // v139: botón Diagnóstico de 1girox y del servidor en Banco automático (#698) // v138: botón Devolver (transferencia menor al mínimo) en Soporte y Movimientos (#693) // v137: textos de la ruleta por carga del día (#677) // v136: tilde 'Girox directo' en Menús activos (#670) // v135: campo 'Carga que desbloquea la ruleta' (#669) // v134: fix borrar historia de publicista (chocaba con Historias de la app, #660) // v133: premios del Fueguito con columna Rollover $ (#654) // v132: Menús activos en Elegir menú; Cierres al final del grupo App (#635) // v131: menú: Cargas pendientes y Reseñas en Atención, grupo App con Historias (#625) // v130: Notificaciones: Lote con regalo arriba, resto plegado (#609) // // v129: Cerrar charla en Soporte (#602) // // v128: generador de fotos de historias (#594) // // v127: clave Datos IA, Notificaciones bajo Estrategia, historias semanales, historial de pagos (#590-#593) // // v126: Configuración arriba + Página de la app editable (#589) // // v125: Confirmación de pagos (#566) // // v124: card Webhooks salientes (#562) // // v123: tilde SMS en el registro desde el inicio (#541) // // v122: tilde pantalla de ingreso = Iniciar sesión (#538) // // v121: escape en la tabla de referidores (#532) // // v120: REFERIDOS 2.0 en el panel (actividad, ranking, niveles, netwin vivo) (#529) // v119: misiones atadas al nivel VIP (#515) // v118: misiones por nivel de cliente (#514) // v117: rollover global y anti-multicuenta (#509) // v116: anti-estafa de misiones (#508) // v115: reintento de misiones rebotadas (#504) // v114: Estrategia clientes · publicidad (#504) // v113: entradas/salidas del dia por API del banco (#503) // v112: diferencia explicita, saldo del banco a las 00:00, estado Pendiente (#502) // v111: arqueo (faltante/sobrante vs banco) y comision editable por dia en los cierres (#501) // v110: Cierres automaticos (#500) // v109: Cierre de ayer de la base retenida (#499) // v108: venta = netwin en toda la seccion, inversion en dolares, REAL vs ESTIMACION (#487) // v107: revision #486 (moneda convierte lo escrito, sin snapshots automaticos, fechas ART) // v106: Panorama como pestana principal, base siempre desde el inicio (#484) // v105: panorama 'despues de la inversion' con curva de retencion; campos en la moneda elegida (#483) // v104: texto de la opcion 2 (#481) // v103: Elegir menu (#480), base actual del panorama (#477) // v102: Datos IA mas rapido (agregaciones) + panorama de inversion con base desde el inicio, promos futuras y USDT (#477) // v101: gasto total desde el inicio (#468) + promociones vigentes y futuras en analisis y calculador (#469) // v99: calculador con tarjeta 'Hoy, como esta' vs 'Sumando la inversion' (#467) // v98: gasto por dia en la serie, costo por nuevo por periodo, guardar veredicto con nota (#466) // v97: calculador: ROI solo sobre clientes por pauta, % organico editable, dias para recuperar el costo (#464) // v96: aviso de demora en Datos IA (#463) // v95: Datos IA premium: veredicto, grupos, informe con semaforo, historial con revision y calibracion (#461) // v94: seccion Datos IA (analisis por dia/semana/mes + comparativa con la otra pagina) (#459) // v93: banco con fallas: mensajes editables en la tarjeta + historial con horarios y avisados (#444) // v92: configuracion editable del banco con fallas (auto, umbral, pausar, avisar) (#443) // v91: tarjeta 'Banco con fallas (retiros)' en Configuracion (#442) // v90: tilde de registro: default entrada con nombre (#425) // v89: texto del tilde de registro: links de publicidad siempre con entrada rapida (#422) // v88: tilde 'Registro de clientes' (SMS / entrada rapida) en Configuracion (#421) // v87: columna Visitantes (soporte sin cuenta) en Soporte (#414) // v86: menu sin 'No se usa' (Automatizacion / Estrategia de bonos eliminadas), Comandos → Configuracion / Comandos (#408) // v85: aclaracion del minimo de cantidad de cargas del fueguito (0 = por monto, #405) // v84: modo nocturno del panel (default, boton en el pie del menu, #388) + COMANDOS con sectores abiertos, tarjetas con color/icono/titulo/descripcion e indice de chips (#389) // v83: Soporte arriba de todo del menu (grupo Atencion), Chat viejo abajo bajo 'Interno' (#387) // v82: panel con el estilo de la app, COMANDOS por sectores plegables, Chat viejo + Soporte abajo del menu (#383) // v81: toggle codigo SMS en cada retiro (#382) // v80: aviso en Chats (el cliente no lo ve) + columna Soporte con el canal (#380) // v79: retiro minimo configurable (#379) // v78: columna Soporte (#377) // v77: seccion Cargas pendientes (#376) // v76: seccion Historias (#361) // v75: % de referidos editable (#351) // v74: rangos de reembolso con DIARIO (#349) // v73: minimo de cargas del fueguito: default 10 (#347) // v72: minimo de cargas del fueguito: default 5 (#344) // v71: API de 1girox (Base URL + key) desde el panel, en Banco automatico (#310) // v70: carga minima configurable en Bonos automaticos (#299) // v69: cronograma tipo hoja del mes (selector de mes, panel del dia, + para programar ese dia) y reparto de un lote en hasta 60 lotes parejos con horarios automaticos y conteo con app (#297) // v68: tilde de plataformas ofrecidas en COMANDOS (#296) // v67: formulario del lote como el gemelo (sin regalo, auto/agente, 1a carga/todas, franja horaria, segmento cargadores), guardar en un plan del mes desde el formulario y calendario del plan (#295) // v66: planes de estrategia del mes (guardar/aplicar) + comparativo con impulso real (7 dias, repetidores) y clientes recuperados, dia a dia y por plan; impacto real en el detalle del lote (#293) // v65: escalera VIP editable (umbral / bono / rakeback por nivel + tasa), replica 1win (#292) // v64: minimo de cargas en el plazo del premio del Fueguito (#291) // v63: % automatico de la PRIMERA carga (publicidad, 50%) + extra por instalar la app en 50% (#290) // v62: carga GRATIS por instalar la app (1ª carga) en Bonos automaticos + etiqueta en Transacciones (#283) // v61: el % de 'Servicio completo' ahora es el bono real de la carga automatica (#274) // v60: % del cartel 'Servicio completo' del chat principal de la app en Bonos automaticos (#266) // v59: logo por plataforma en Configuración → Plataformas (#232) // v58: ruleta diaria — gate 'solo clientes activos de la semana' (#228) // v57: toggle ON/OFF del bono por instalar la app (apagado por default, #221) // v56: multi-plataforma — selector de plataforma en la carga manual, banner "esperando que el cliente elija dónde jugar" con botones para el agente, card Configuración → Plataformas de juego, estados hgcash esperando/derivado // v55: 📅 Cronograma: campañas programadas, calendario mensual, tandas, rangos de días/fechas y comparativo semanal (réplica #190 de AUTOREEMBOLSOSjygactivo) // v54: tope propio por lote (% completo hasta $X + Y% del resto) (réplica #189 de AUTOREEMBOLSOSjygactivo) // v53: el secreto hgcash de AWS ya no se acepta si hay uno en el panel (#216). v52: Banco automático — cards "Cuenta hgcash conectada" (token+secreto desde el panel, #320) y "Reenviar los avisos a otras páginas" (#326) // v51: banner del bono app sin '100%' para reclamos viejos sin % congelado // v50: lotes — tope del % en el cartel, horas para usar el bono tras canjear, resumen canjeó/cargó/venció (réplica #172/#173) // v49: premios configurables de la ruleta diaria (%/plata/sin premio + probabilidades) + tope de bonos automáticos + toast/banners de bono automático // v48: % del bono por instalar la app editable en COMANDOS + banners del chat con el % congelado de cada cliente // v47: card "Reembolso acumulativo" en Configuración + etiqueta/filtro del reembolso acumulativo en Transacciones // v46: Transacciones con ruleta / rakeback / nivel VIP (etiquetas, filtros, tarjetas, total regalos) // v44: mensajes de sistema del chat — INTERNOS (adminOnly) en VERDE con etiqueta "🔒 INTERNO"; automáticos al cliente siguen naranja con 🤖
const CACHE_NAME = 'admin-sala-' + CACHE_VERSION;

// Only pre-cache stable assets (icons rarely change).
const PRECACHE_URLS = [
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

// Main admin files that must always be fetched fresh from the network after a
// redeploy so admins never run stale admin.js code.
function isNetworkFirst(url) {
    return (
        url.includes('/adminprivado2026/') ||
        url.includes('admin.js') ||
        url.includes('admin.css') ||
        url.includes('manifest.json')
    );
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

// Instalación del Service Worker
self.addEventListener('install', (event) => {
    console.log('[SW-Admin] Instalando Service Worker', CACHE_VERSION);
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW-Admin] Pre-cacheando recursos estables');
                return cache.addAll(PRECACHE_URLS);
            })
            .catch((err) => {
                console.log('[SW-Admin] Error al pre-cachear:', err);
            })
    );
    
    self.skipWaiting();
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
    console.log('[SW-Admin] Service Worker activado', CACHE_VERSION);
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW-Admin] Eliminando cache antiguo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    
    self.clients.claim();
});

// Interceptar fetch requests
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }

    const url = event.request.url;

    // CLOUDFLARE FIX: nunca interceptar navigation requests.
    // Igual que en firebase-messaging-sw.js: si el SW intercepta una
    // navegación y Cloudflare redirige a challenges.cloudflare.com,
    // el challenge falla porque la respuesta se sirve en el contexto URL
    // incorrecto. Dejando pasar las navegaciones, el challenge se resuelve
    // correctamente y la pantalla de "red incompatible" desaparece.
    if (event.request.mode === 'navigate') {
        console.log('[SW-Admin] Navigation request - pasando al navegador nativo:', url);
        return;
    }

    // Excluir URLs de Cloudflare y seguridad.
    if (isCloudflareOrSecurityUrl(url)) {
        console.log('[SW-Admin] URL de seguridad excluida del caché:', url);
        return;
    }

    if (url.includes('/api/') || 
        url.includes('/socket.io/')) {
        return;
    }

    if (isNetworkFirst(url)) {
        // Network-first con `cache: 'no-store'`: ignora el caché HTTP del
        // navegador para que admin.js / index.html / admin.css siempre lleguen
        // frescos del servidor tras un deploy (el caché del SW queda solo como
        // respaldo offline).
        event.respondWith(
            fetch(event.request, { cache: 'no-store' })
                .then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        // Only cache same-origin ('basic') responses.
                        // Opaque cross-origin responses are excluded intentionally
                        // to avoid caching errors or security issues.
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    console.log('[SW-Admin] Red no disponible, buscando en caché:', url);
                    return caches.match(event.request);
                })
        );
    } else {
        // Cache-first for icons and other stable assets.
        event.respondWith(
            caches.match(event.request)
                .then((response) => {
                    if (response) {
                        return response;
                    }
                    return fetch(event.request)
                        .then((networkResponse) => {
                            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                                return networkResponse;
                            }
                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, responseToCache);
                                });
                            return networkResponse;
                        });
                })
                .catch(() => undefined)
        );
    }
});

// Notificaciones en background del panel admin (FCM SDK). Cuando el admin
// tiene la app cerrada, FCM entrega el mensaje acá y se muestra la notif.
messaging.onBackgroundMessage((payload) => {
    console.log('[SW-Admin] Notificación en background:', payload);
    const notif = (payload && payload.notification) || {};
    const webNotif = (payload && payload.webpush && payload.webpush.notification) || {};
    const data = (payload && payload.data) || {};
    const title = notif.title || webNotif.title || 'Panel Admin';
    const body = notif.body || webNotif.body || 'Tenés una notificación nueva';
    const icon = notif.icon || webNotif.icon || '/icons/icon-192x192.png';
    return self.registration.showNotification(title, {
        body: body,
        icon: icon,
        badge: '/icons/icon-192x192.png',
        tag: data.tag || 'admin-notification',
        data: data,
        vibrate: [200, 100, 200]
    });
});

// Manejar click en notificación
self.addEventListener('notificationclick', (event) => {
    console.log('[SW-Admin] Click en notificación:', event);
    
    event.notification.close();
    
    const notificationData = event.notification.data;
    let url = '/adminprivado2026/';
    
    if (notificationData && notificationData.url) {
        url = notificationData.url;
    }
    
    if (event.action === 'close') {
        return;
    }
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url.includes('/adminprivado2026/') && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});

// Escuchar mensajes desde la app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    // NOTA: el handler SHOW_NOTIFICATION fue removido junto con el handler
    // 'push' manual. La app admin no postMessage-ea al SW para mostrar
    // notificaciones; usa el SDK FCM (background) o muestra UI in-app
    // (foreground). Este listener solo gestiona SKIP_WAITING.
});

console.log('[SW-Admin] Service Worker cargado', CACHE_VERSION);

