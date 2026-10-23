# Carpeta `landing/` = la landing publicada en Vercel (picaroja-landing.vercel.app)

Es la landing que el owner tiene publicada en Vercel (vino en `landing2.zip`, 2026-10-19). NO la sirve este
backend: se sube a Vercel a mano (arrastrar la carpeta en el proyecto `picaroja-landing`, o `vercel deploy`).

Cambios de este repo sobre la original (#535): aviso del código de referido (`?ref=`), las 3 plataformas con logo
(Girox · Ganamos Pronto · Jugaygana Pronto; se actualizan solas desde `GET /api/landing/info` del backend), los servicios sólo
con título, barra de progreso y entrada DIRECTA a la sesión (sin pantalla de credenciales: quedan en Perfil, dentro de la app).

`vercel.json` (#553): SÓLO reescrituras para que `picaroja-landing.vercel.app/CODIGO` sirva la landing (Vercel sirve primero los
archivos reales, `img/` incluido). ⚠️ NO subir el `vercel.json`/`blank.html` del zip original: mandaban a una página en blanco a todo visitante fuera de Argentina (y a quien
entra por VPN/Tor, como el owner desde Tails). Se sacaron el 2026-10-19 (#543).

Antes de subir, revisá en `index.html`:
- `API_BASE_DEFAULT` = `https://picaroja.com` (backend real de PICA ROJA, #570). NO `vipcargas.com` (es VIPCARGAS, otra página) ni
  `chat1girox.com` ni el host `.elasticbeanstalk.com` (sólo HTTP).
- Ese dominio tiene que tener el dominio de la landing en `ALLOWED_ORIGINS` (CORS), si no el registro falla en el navegador.
- `BONUS_BIG` / `BONUS_SUB`: la oferta REAL (misma que ve el usuario; Meta penaliza el cloaking).
