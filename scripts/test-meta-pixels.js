// #990: a qué píxeles manda la CAPI según el publicista del cliente. Correr: node scripts/test-meta-pixels.js
'use strict';
process.env.META_PIXEL_ID = '1111111111111111'; process.env.META_CAPI_ACCESS_TOKEN = 't1';
process.env.META_PIXEL_ID_2 = '2222222222222222'; process.env.META_CAPI_ACCESS_TOKEN_2 = 't2'; process.env.META_PIXEL_PUBLISHER_2 = 'PICAROJAOK, picarojaok';
process.env.META_PIXEL_ID_3 = '3333333333333333'; process.env.META_CAPI_ACCESS_TOKEN_3 = 't3'; // sin alcance = partner: recibe todo
process.env.META_PIXEL_ID_4 = '4444444444444444'; process.env.META_PIXEL_PUBLISHER_4 = 'otro'; // sin token = sólo navegador
process.env.META_PIXEL_ID_5 = '5555555555555555'; process.env.META_CAPI_ACCESS_TOKEN_5 = 't5'; process.env.META_PIXEL_PUBLISHER_5 = '*';
// sin node_modules: axios simulado (el servicio sólo lo usa para enviar; acá no se envía nada)
const Module = require('module'); const _res = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'axios' ? 'axios-stub' : _res.call(this, req, ...a); };
require.cache['axios-stub'] = { id: 'axios-stub', filename: 'axios-stub', loaded: true, exports: { post: async () => ({ data: { events_received: 1 } }) } };
const m = require('../src/services/metaCapiService');
const ns = (info) => m._capiDestinations(info).map((d) => d.n).join(',');
const must = (got, exp, what) => { if (got !== exp) { console.error('✘ ' + what + ': ' + got + ' (esperado ' + exp + ')'); process.exit(1); } console.log('✔ ' + what + ' → #' + got); };
must(ns(undefined), '1,2,3,5', 'todos los que tienen token');
must(ns({ publisher: 'picarojaok', campaignCode: 'PICAROJAOK' }), '1,2,3,5', 'cliente de PICAROJAOK: propio + el del publicista + partner + *');
must(ns({ publisher: 'otro', campaignCode: 'OTRA' }), '1,2,3,5', 'cliente de otro publicista: el _2 de SSM sigue recibiendo TODO (como hoy: picaroja2026)');
must(ns(null), '1,2,3,5', 'cliente sin campaña: el propio, el _2 y los sin alcance');
process.env.META_PIXEL_ID_6 = '6060606060606060'; process.env.META_CAPI_ACCESS_TOKEN_6 = 't6'; process.env.META_PIXEL_PUBLISHER_6 = 'PICAROJAOK';
must(ns({ publisher: 'otro', campaignCode: 'OTRA' }), '1,2,3,5', 'un _6 con alcance PICAROJAOK NO recibe clientes de otro publicista');
must(ns({ publisher: 'x', campaignCode: 'PICAROJAOK' }), '1,2,3,5,6', 'el _6 recibe los clientes de PICAROJAOK por CAPI (esto es lo que faltaba)');
delete process.env.META_PIXEL_ID_6; delete process.env.META_CAPI_ACCESS_TOKEN_6; delete process.env.META_PIXEL_PUBLISHER_6;
must(ns({ publisher: null, campaignCode: 'picarojaok' }), '1,2,3,5', 'coincide por código (mayúsculas/minúsculas)');
const L = m.listPixels(); if (L.length !== 5 || L[3].token || !L[1].label.startsWith('partner (recibe todo')) { console.error('✘ listPixels', L); process.exit(1); }
// píxeles del PANEL (Config['metaPixels'] descifrados por el server): valen igual que los de SSM
m.setConfigPixels([{ id: 'p1', label: 'picarojaok (panel)', pixelId: '6666666666666666', token: 'tp', scope: ['PICAROJAOK'] }, { id: 'p2', pixelId: '7777777777777777', token: '', scope: ['*'] }]);
must(ns({ publisher: 'picarojaok', campaignCode: 'PICAROJAOK' }), '1,2,3,5,cp1', 'panel: el píxel del publicista recibe por CAPI (el sin token no)');
must(ns({ publisher: 'otro', campaignCode: 'OTRA' }), '1,2,3,5', 'panel: otro publicista no lo recibe');
(async () => { const ids = await m.pixelIdsForCampaign('PICAROJAOK'); const exp = '2222222222222222,5555555555555555,6666666666666666,7777777777777777'; if (ids.join(',') !== exp) { console.error('✘ navegador: ' + ids.join(',') + ' (esperado ' + exp + ')'); process.exit(1); } console.log('✔ navegador de la landing: SSM con alcance + panel (sin el propio ni el partner sin alcance)'); console.log('✔ TODO OK'); })();
console.log('✔ listPixels OK · ' + L.map((p) => '#' + p.n + ' ' + p.label).join(' · '));
