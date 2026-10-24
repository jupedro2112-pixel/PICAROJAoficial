// #959 (owner 2026-10-24): picaroja.com entra SIEMPRE por Cloudflare y después por el balanceador de AWS (y nginx de Elastic Beanstalk).
// Antes `trust proxy = 1` hacía que req.ip fuera la IP del nodo de Cloudflare (miles de clientes compartían el mismo límite de intentos y
// un atacante lo esquivaba cambiando de nodo). Ahora se confía sólo en los saltos de Cloudflare (rangos publicados) y en las redes
// privadas/locales (ELB interno, nginx): el primer salto que NO es de ellos es la IP real del cliente. Si alguien pega directo al
// balanceador salteando Cloudflare, su IP no es de confianza y lo que ponga en X-Forwarded-For se ignora.
'use strict';
const CF_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
const PRIV_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16'];
const CF_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
function ip4(ip) { const p = String(ip).split('.'); if (p.length !== 4) return null; let n = 0; for (const x of p) { if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null; n = n * 256 + Number(x); } return n; }
function in4(ip, cidr) { const [net, bits] = cidr.split('/'); const a = ip4(ip), n = ip4(net); if (a == null || n == null) return false; const b = Number(bits); if (b === 0) return true; const div = Math.pow(2, 32 - b); return Math.floor(a / div) === Math.floor(n / div); }
function exp6(ip) { const h = String(ip).split('%')[0]; const parts = h.split('::'); if (parts.length > 2) return null; const a = parts[0] ? parts[0].split(':') : [], b = parts.length === 2 && parts[1] ? parts[1].split(':') : []; const fill = 8 - a.length - b.length; if (fill < 0 || (parts.length === 1 && fill !== 0)) return null; const all = a.concat(Array(parts.length === 2 ? fill : 0).fill('0'), b); if (all.length !== 8) return null; let out = ''; for (const x of all) { if (!/^[0-9a-f]{0,4}$/i.test(x)) return null; out += parseInt(x || '0', 16).toString(2).padStart(16, '0'); } return out; }
function in6(ip, cidr) { const [net, bits] = cidr.split('/'); const a = exp6(ip), n = exp6(net); if (!a || !n) return false; return a.slice(0, Number(bits)) === n.slice(0, Number(bits)); }
function isTrustedHop(ip) {
  ip = String(ip || '').trim(); if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.includes(':')) return ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip) || CF_V6.some((c) => in6(ip, c));
  return PRIV_V4.some((c) => in4(ip, c)) || CF_V4.some((c) => in4(ip, c));
}
module.exports = { isTrustedHop, in4, in6 };
