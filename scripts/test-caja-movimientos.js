// #1038: ejecuta el bloque "ANOTAR MOVIMIENTOS" de server.js con modelos y banco simulados: cruce de un fondeo con una entrada pendiente del
// banco, egreso que no es un retiro (la salida del retiro se descarta por externalId) y se encuentra por la API, externo ⇒ 'na', comprobante
// obligatorio para agentes, doble anotación en 10 min ⇒ 409, dos entradas iguales ⇒ se elige por nombre.
const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const src = fs.readFileSync('server.js', 'utf8');
const a = src.indexOf('// ===== #1038 (owner 2026-11-08): ANOTAR MOVIMIENTOS (caja) ====='); const b = src.indexOf("app.get('/api/admin/gastos'", a);
if (a < 0 || b < 0) throw new Error('bloque no encontrado'); const block = src.slice(a, b);
const store = { exp: [], mov: [], payouts: [{ id: 'pay-1', hgTransactionId: 'req-1' }], live: [], closes: [] };
function q(data) { const o = { select: () => o, sort: () => o, limit: () => o, lean: () => o, then: (res, rej) => Promise.resolve(typeof data === 'function' ? data() : data).then(res, rej) }; return o; }
const getp = (o, k) => k.split('.').reduce((x, p) => (x == null ? undefined : x[p]), o);
function match(d, f) { return Object.keys(f).every((k) => { const v = f[k]; if (k === '$or') return v.some((o) => match(d, o)); const dv = getp(d, k);
  if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof RegExp)) { if ('$in' in v && !v.$in.some((x) => x === dv || (x === null && dv == null))) return false; if ('$nin' in v && v.$nin.some((x) => x === dv || (x === null && dv == null))) return false; if ('$ne' in v && dv === v.$ne) return false; if ('$gte' in v && !(dv >= v.$gte)) return false; if ('$lte' in v && !(dv <= v.$lte)) return false; return true; }
  if (v instanceof RegExp) return v.test(String(dv)); return dv === v || (v === null && dv == null); }); }
const setp = (o, k, v) => { const ps = k.split('.'); let x = o; for (let i = 0; i < ps.length - 1; i++) { x[ps[i]] = x[ps[i]] || {}; x = x[ps[i]]; } x[ps[ps.length - 1]] = v; };
const apply = (d, u) => { for (const [k, v] of Object.entries(u.$set || {})) setp(d, k, v); for (const [k, v] of Object.entries(u.$inc || {})) setp(d, k, (getp(d, k) || 0) + v); };
const Expense = { find: (f) => q(() => store.exp.filter((d) => match(d, f))), findOne: (f) => q(() => store.exp.find((d) => match(d, f)) || null), updateOne: async (f, u) => { const d = store.exp.find((x) => match(x, f)); if (d) apply(d, u); return {}; }, deleteOne: async (f) => { store.exp = store.exp.filter((d) => !match(d, f)); },
  create: async (d) => { const o = Object.assign({ createdAt: new Date() }, JSON.parse(JSON.stringify(d))); o.createdAt = new Date(o.createdAt); store.exp.push(o); return Object.assign({}, o, { toObject: () => Object.assign({}, o) }); } };
const BankMovement = { find: (f) => q(() => store.mov.filter((d) => match(d, f))), findOne: (f) => q(() => store.mov.find((d) => match(d, f)) || null), exists: async (f) => store.mov.some((d) => match(d, f)), updateOne: async (f, u) => { const d = store.mov.find((x) => match(x, f)); if (d) apply(d, u); return {}; },
  create: async (d) => { if (store.mov.some((m) => m.movementId === d.movementId)) { const e = new Error('dup'); e.code = 11000; throw e; } store.mov.push(Object.assign({}, d)); return d; } };
const PendingPayout = { find: (f) => q(() => store.payouts.filter((d) => match(d, f))), exists: async (f) => store.payouts.some((d) => match(d, f)) };
const hgcashPay = { isEnabled: () => true, listMovements: async () => ({ ok: true, items: store.live }) };
const routes = {}; const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, post: (p, ...h) => { routes['POST ' + p] = h[h.length - 1]; }, delete: (p, ...h) => { routes['DELETE ' + p] = h[h.length - 1]; } };
const dk = (d) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);
const ctx = { Expense, BankMovement, PendingPayout, hgcashPay, app, authMiddleware: 1, adminMiddleware: 1, logger: { info() {}, warn() {}, error(m) { store.err = m; } }, resolveHgcashAccountId: async () => 'acc-1', _cronClaim: async () => true, _closeEnsure: async (k) => { store.closes.push(k); }, _bankAccounts: async () => [{ id: 'sec1', name: 'Cuenta Juan', active: true }],
  _nameMatch: (x, y) => String(x).toLowerCase().split(' ')[0] === String(y).toLowerCase().split(' ')[0], uuidv4: () => 'e-' + (store.exp.length + 1), datosIa: { dateKeyART: dk }, setTimeout: () => 0, setInterval: () => 0, console, Date, Math, Object, Array, JSON, Number, String, Boolean, Promise, Set, Map, RegExp, Error, Buffer, parseInt, encodeURIComponent };
vm.createContext(ctx); vm.runInContext(block, ctx);
const call = async (key, req) => { const h = routes[key]; if (!h) throw new Error('ruta ' + key); let out = null, status = 200; const res = { json: (j) => { out = j; return res; }, status: (s) => { status = s; return res; }, set: () => res, send: (x) => { out = x; return res; } }; await h(Object.assign({ params: {}, query: {}, body: {}, user: { username: 'agente1', role: 'depositor' } }, req || {}), res); return { status, out }; };
const IMG = 'data:image/jpeg;base64,' + Buffer.from('foto').toString('base64');
(async () => {
  const today = dk(new Date()); const now = new Date();
  // --- entrada pendiente del banco de $150.000 (nadie la reclamó) + fondeo anotado ⇒ matched y la entrada queda 'caja'
  store.mov.push({ movementId: 'm-in-1', amount: 150000, direction: 'Inbound', matchStatus: 'pending', date: now, createdAt: now, fromName: 'Pedro Dueño', status: 'approved' });
  let r = await call('POST /api/admin/caja-movimientos', { body: { kind: 'ingreso', amount: 150000, concept: 'Fondeo para pagar retiros', account: 'main', receipt: { data: IMG, name: 'f.jpg' } } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.out)); assert.strictEqual(r.out.item.bankMatch.status, 'matched'); assert.strictEqual(r.out.item.bankMatch.movementId, 'm-in-1');
  assert.strictEqual(store.mov[0].matchStatus, 'caja'); assert.strictEqual(store.mov[0].cajaExpenseId, 'e-1'); assert.ok(/VISTO en el banco/.test(r.out.message)); assert.deepStrictEqual(store.closes, [today]);
  console.log('✔ fondeo principal: cruzado con la entrada pendiente del banco (queda caja, no es carga de nadie)');
  // --- sin comprobante, agente ⇒ 400; admin ⇒ pasa
  r = await call('POST /api/admin/caja-movimientos', { body: { kind: 'egreso', amount: 1000, concept: 'Comisión', account: 'external' } }); assert.strictEqual(r.status, 400); assert.ok(/comprobante/i.test(r.out.error));
  r = await call('POST /api/admin/caja-movimientos', { body: { kind: 'egreso', amount: 1000, concept: 'Comisión', account: 'external' }, user: { username: 'admin', role: 'admin' } }); assert.strictEqual(r.status, 200); assert.strictEqual(r.out.item.bankMatch.status, 'na');
  console.log('✔ comprobante obligatorio para agentes · externo ⇒ no pasa por el banco (na)');
  // --- egreso $80.000 por la principal: la única salida igual es un RETIRO (externalId = payout) ⇒ se descarta; la API trae otra salida ⇒ matched
  store.mov.push({ movementId: 'req-1', externalId: 'pay-1', amount: 80000, direction: 'Outbound', matchStatus: 'ignored', date: now, createdAt: now, toName: 'Cliente X', status: 'approved' });
  store.live = [{ id: 'req-1', amount: 80000, direction: 'out', date: now, raw: { id: 'req-1', externalID: 'pay-1' } }, { id: 'out-9', amount: 80000, direction: 'out', date: now, raw: { id: 'out-9', toName: 'Publicista Z', status: 'approved' } }];
  r = await call('POST /api/admin/caja-movimientos', { body: { kind: 'egreso', amount: 80000, concept: 'Pago a publicista', account: 'main', party: 'Publicista Z', receipt: { data: IMG } } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.out)); assert.strictEqual(r.out.item.bankMatch.status, 'matched'); assert.strictEqual(r.out.item.bankMatch.movementId, 'out-9');
  const created = store.mov.find((m) => m.movementId === 'out-9'); assert.ok(created && created.direction === 'Outbound' && created.matchStatus === 'ignored' && created.cajaExpenseId === 'e-3', 'la salida de la API se guardó');
  assert.strictEqual(store.mov.find((m) => m.movementId === 'req-1').cajaExpenseId, undefined, 'la salida del retiro no se tocó');
  console.log('✔ egreso principal: la salida del retiro se descarta; se encuentra la otra por la API del banco y se guarda');
  // --- repetido en 10 min ⇒ 409 DUP_CAJA; con force pasa (y sin movimiento ⇒ unmatched)
  store.live = [];
  r = await call('POST /api/admin/caja-movimientos', { body: { kind: 'egreso', amount: 80000, concept: 'Otro pago', account: 'main', receipt: { data: IMG } } }); assert.strictEqual(r.status, 409); assert.strictEqual(r.out.code, 'DUP_CAJA');
  r = await call('POST /api/admin/caja-movimientos', { body: { kind: 'egreso', amount: 80000, concept: 'Otro pago', account: 'main', receipt: { data: IMG }, force: true } }); assert.strictEqual(r.status, 200); assert.strictEqual(r.out.item.bankMatch.status, 'unmatched'); assert.ok(/no aparece en el banco/.test(r.out.message));
  console.log('✔ doble anotación en 10 min pide confirmar · sin movimiento queda "no se ve" y se re-busca');
  // --- dos entradas iguales el mismo día: se elige la del nombre que dijo el agente
  store.mov.push({ movementId: 'm-in-2', amount: 50000, direction: 'Inbound', matchStatus: 'pending', date: now, createdAt: now, fromName: 'Cliente Perez', status: 'approved' });
  store.mov.push({ movementId: 'm-in-3', amount: 50000, direction: 'Inbound', matchStatus: 'no_match', date: now, createdAt: now, fromName: 'Pedro Dueño', status: 'approved' });
  r = await call('POST /api/admin/caja-movimientos', { body: { kind: 'ingreso', amount: 50000, concept: 'Fondeo chico', account: 'main', party: 'Pedro', receipt: { data: IMG } } });
  assert.strictEqual(r.out.item.bankMatch.movementId, 'm-in-3'); assert.strictEqual(store.mov.find((m) => m.movementId === 'm-in-2').matchStatus, 'pending', 'la del cliente sigue pendiente para su carga');
  console.log('✔ dos entradas iguales: se toma la del nombre indicado, la del cliente sigue disponible');
  // --- re-verificación del tick: la 'unmatched' encuentra la salida cuando llega el webhook
  store.mov.push({ movementId: 'out-10', amount: 80000, direction: 'Outbound', matchStatus: 'ignored', date: now, createdAt: now, toName: 'Proveedor', status: 'approved' });
  await ctx._cajaVerifyTick(); const e4 = store.exp.find((e) => e.id === 'e-4'); assert.strictEqual(e4.bankMatch.status, 'matched'); assert.strictEqual(e4.bankMatch.movementId, 'out-10');
  console.log('✔ tick: lo "no visto" se cruza solo cuando el movimiento llega');
  // --- listado para agentes (sin comprobante adentro) y borrado sólo admin (devuelve la entrada a no_match)
  r = await call('GET /api/admin/caja-movimientos', { query: { days: 7 } }); assert.strictEqual(r.out.items.length, 5); assert.ok(r.out.items.every((it) => !('receipt' in it) && typeof it.hasReceipt === 'boolean')); assert.strictEqual(r.out.isAdmin, false);
  r = await call('DELETE /api/admin/caja-movimientos/:id', { params: { id: 'e-1' } }); assert.strictEqual(r.status, 403);
  r = await call('DELETE /api/admin/caja-movimientos/:id', { params: { id: 'e-1' }, user: { username: 'admin', role: 'admin' } }); assert.strictEqual(r.status, 200); assert.strictEqual(store.mov.find((m) => m.movementId === 'm-in-1').matchStatus, 'no_match');
  r = await call('GET /api/admin/caja-movimientos/:id/receipt', { params: { id: 'e-3' } }); assert.strictEqual(r.status, 200); assert.ok(Buffer.isBuffer(r.out) && r.out.toString() === 'foto');
  console.log('✔ listado liviano · borrar sólo admin (la entrada vuelve a no_match) · comprobante se sirve');
  console.log('CAJA OK');
})().catch((e) => { console.error('❌', e); process.exit(1); });
