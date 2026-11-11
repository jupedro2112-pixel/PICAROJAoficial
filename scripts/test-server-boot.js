#!/usr/bin/env node
// #1122: CARGA server.js con los módulos externos simulados (no hay node_modules) para detectar errores de arranque que node --check no ve
// (p. ej. usar authMiddleware antes de definirlo tiró producción). Uso: node scripts/test-server-boot.js
const Module = require('module'); const path = require('path');
const mk = (name) => { const f = function () { return p; }; const p = new Proxy(f, {
  get(t, k) { if (k === 'then') return undefined; if (k === Symbol.toPrimitive) return () => ''; if (k === Symbol.iterator) return function* () {}; if (k === 'prototype') return {}; if (k === '__esModule') return false; return p; },
  apply() { return p; }, construct() { return p; } }); return p; };
const real = new Set(['fs','path','crypto','os','http','https','url','util','events','stream','zlib','child_process','querystring','buffer','net','tls','dns','assert','vm','module','timers','string_decoder','worker_threads','perf_hooks','readline','cluster']);
const orig = Module._load;
Module._load = function (req, parent, isMain) {
  if (real.has(req) || req.startsWith('node:')) return orig.apply(this, arguments);
  if (req.startsWith('.') || req.startsWith('/')) { try { return orig.apply(this, arguments); } catch (e) { if (e.code === 'MODULE_NOT_FOUND' && !/src\/|config\//.test(String(e.message))) return mk(req); throw e; } }
  return mk(req);
};
process.env.PORT = '0';
process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e); });
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e); });
try { require(path.resolve(__dirname, '..', 'server.js')); console.log('server.js carga OK'); } catch (e) { console.log('ERROR AL CARGAR:', e.stack.split('\n').slice(0, 6).join('\n')); process.exitCode = 1; }
setTimeout(() => process.exit(0), 4000);
