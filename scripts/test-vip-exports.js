// #1034: toda función llamada como VIP.<ns>.<fn>( en index.html o en public/js tiene que estar exportada por ese namespace.
// Nació del bug de #1032: un `// #1032` al frente de la primera línea de `VIP.home = {` comentó ~100 exports (Cambiar menú y
// medio home dejaron de responder). Correr después de tocar cualquier objeto de exports. Los namespaces con forma de export que el
// parser no entiende (ui, campaign) se listan en KNOWN_SKIP: si aparece algo nuevo en otro namespace, es un error real.
// Uso: node scripts/test-vip-exports.js  (sale con 1 si falta algo)
const fs = require('fs');
const js = fs.readdirSync('public/js').filter(f => f.endsWith('.js')).map(f => 'public/js/' + f);
function stripComments(t) { // quita // y /* */ pero respeta strings/templates
  let o = '', i = 0, q = null;
  while (i < t.length) { const c = t[i], n = t[i + 1];
    if (q) { o += c; if (c === '\\') { o += n; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; o += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i += 2; continue; }
    o += c; i++; }
  return o;
}
function objectAt(t, start) { // t[start]=='{' → devuelve el literal balanceado
  let d = 0, i = start, q = null;
  for (; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{' || c === '(' || c === '[') d++; else if (c === '}' || c === ')' || c === ']') { d--; if (d === 0) return t.slice(start + 1, i); } }
  return null;
}
function keys(lit) { const out = []; let d = 0, q = null, cur = '';
  const push = () => { const k = cur.trim().split(':')[0].trim().replace(/^\.\.\./, ''); if (/^[A-Za-z_$][\w$]*$/.test(k)) out.push(k); cur = ''; };
  for (let i = 0; i < lit.length; i++) { const c = lit[i];
    if (q) { cur += c; if (c === '\\') { cur += lit[++i]; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '{' || c === '(' || c === '[') d++; if (c === '}' || c === ')' || c === ']') d--;
    if (c === ',' && d === 0) { push(); continue; } cur += c; }
  push(); return out;
}
const exp = {}; const add = (ns, k) => (exp[ns] = exp[ns] || new Set()).add(k);
for (const f of js) {
  const t = stripComments(fs.readFileSync(f, 'utf8'));
  // VIP.ns = { ... }
  for (const m of t.matchAll(/(?:window\.)?VIP\.(\w+)\s*=\s*\{/g)) { const lit = objectAt(t, m.index + m[0].length - 1); if (lit) keys(lit).forEach(k => add(m[1], k)); }
  // VIP.ns = (function(){ ... return { ... }; })()
  for (const m of t.matchAll(/(?:window\.)?VIP\.(\w+)\s*=\s*\(function\s*\(\)\s*\{/g)) {
    const body = objectAt(t, m.index + m[0].length - 1); if (!body) continue;
    // último `return {` a profundidad 1 del IIFE: buscamos todos los `return {` y tomamos las claves de todos los que estén a depth 0 del body
    let d = 0, q = null; for (let i = 0; i < body.length; i++) { const c = body[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{' || c === '(' || c === '[') d++; else if (c === '}' || c === ')' || c === ']') d--;
      if (d === 0 && body.startsWith('return', i) && /\W/.test(body[i - 1] || ' ')) { const j = body.indexOf('{', i); if (j > 0 && /^return\s*$/.test(body.slice(i, j))) { const lit = objectAt(body, j); if (lit) keys(lit).forEach(k => add(m[1], k)); } } }
  }
  for (const m of t.matchAll(/Object\.assign\((?:window\.)?VIP\.(\w+)(?:\s*\|\|\s*\{\})?,\s*\{/g)) { const lit = objectAt(t, m.index + m[0].length - 1); if (lit) keys(lit).forEach(k => add(m[1], k)); }
  for (const m of t.matchAll(/(?:window\.)?VIP\.(\w+)\.(\w+)\s*=[^=]/g)) add(m[1], m[2]);
}
const used = {}; for (const f of ['public/index.html', ...js]) { const t = fs.readFileSync(f, 'utf8'); for (const x of t.matchAll(/VIP\.(\w+)\.(\w+)\s*\(/g)) { const mm = (used[x[1]] = used[x[1]] || new Map()); mm.set(x[2], (mm.get(x[2]) || new Set()).add(f.replace('public/', ''))); } }
const KNOWN_SKIP = new Set(['ui', 'campaign']); // exportan con `return Object.assign(...)` / api.x = …: el parser no los lee
const KNOWN_GUARDED = new Set([]); // revisión nocturna: 'autoload.setPassword' no existía (era rememberPassword) ⇒ ya no se tolera
let bad = 0; for (const ns of Object.keys(used).sort()) { if (KNOWN_SKIP.has(ns)) continue; for (const [fn, fl] of used[ns]) if (!(exp[ns] && exp[ns].has(fn)) && !KNOWN_GUARDED.has(ns + '.' + fn)) { bad++; console.log('❌ FALTA VIP.' + ns + '.' + fn + '  <- ' + [...fl].join(', ')); } }
console.log((bad ? '❌ ' : '✅ ') + 'namespaces:', Object.keys(used).length, 'llamadas distintas:', Object.values(used).reduce((a, m) => a + m.size, 0), 'faltantes:', bad);
process.exit(bad ? 1 : 0);
