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
must(ns({ publisher: 'otro', campaignCode: 'OTRA' }), '1,3,5', 'cliente de otro publicista: NO va al píxel de picarojaok');
must(ns(null), '1,3,5', 'cliente sin campaña: sólo los sin alcance');
must(ns({ publisher: null, campaignCode: 'picarojaok' }), '1,2,3,5', 'coincide por código (mayúsculas/minúsculas)');
const L = m.listPixels(); if (L.length !== 5 || L[3].token || L[1].label !== 'publicista PICAROJAOK/picarojaok') { console.error('✘ listPixels', L); process.exit(1); }
console.log('✔ listPixels OK · ' + L.map((p) => '#' + p.n + ' ' + p.label).join(' · '));
console.log('✔ TODO OK');
