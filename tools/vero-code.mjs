#!/usr/bin/env node
/* VERO access-code tool. Runs locally; never talks to Cloudflare.
 *
 *   node tools/vero-code.mjs new --id c_sales01 --role sales [--label "optional note"] [--daily 20]
 *       -> prints the code ONCE (give it to the person) and the SQL to paste into the D1 console.
 *   node tools/vero-code.mjs revoke --id c_sales01        -> SQL that disables the code immediately
 *   node tools/vero-code.mjs restore --id c_sales01       -> SQL that re-enables a revoked code
 *   node tools/vero-code.mjs logout --id c_sales01        -> SQL that ends active sessions (code stays valid)
 *   node tools/vero-code.mjs list                          -> SQL to list codes (no hashes)
 *   node tools/vero-code.mjs secret                        -> random value for TOKEN_SIGNING_KEY / IP_HASH_SALT
 *
 * Codes: "VERO-" + 20 Crockford base32 characters (100 random bits), shown in groups of 4.
 * Only SHA-256 of the normalised code (uppercase, letters/digits only) is stored.
 */
import { createHash, randomBytes } from 'node:crypto';

const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newCode() {
  const b = randomBytes(20); let s = '';
  for (let i = 0; i < 20; i++) s += ALPHA[b[i] & 31];
  return 'VERO-' + s.match(/.{4}/g).join('-');
}
export function normalizeCode(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
export function hashCode(code) { return createHash('sha256').update(normalizeCode(code)).digest('hex'); }
const sq = v => "'" + String(v).replace(/'/g, "''") + "'";
export function insertSql({ id, role, label, daily }, code) {
  return `INSERT INTO access_codes (id, code_hash, role, label, daily_limit) VALUES (${sq(id)}, ${sq(hashCode(code))}, ${sq(role)}, ${label ? sq(label) : 'NULL'}, ${daily ? Number(daily) : 'NULL'});`;
}

function args(argv) { const o = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) o[a.slice(2)] = argv[++i]; else o._.push(a); } return o; }
function main() {
  const a = args(process.argv.slice(2)); const cmd = a._[0];
  const idOk = id => /^c_[a-z0-9_]{2,30}$/.test(id || '');
  if (cmd === 'new') {
    if (!idOk(a.id)) return die('--id must look like c_sales01 (lowercase letters, digits, _)');
    if (['admin', 'sales', 'dealer'].indexOf(a.role) < 0) return die('--role must be admin, sales or dealer');
    if (a.daily && !(Number(a.daily) > 0 && Number(a.daily) <= 200)) return die('--daily must be 1-200');
    const code = newCode();
    console.log('\nAccess code for ' + a.id + ' (' + a.role + ') — give this to the person ONCE; it is not stored anywhere:\n\n    ' + code + '\n');
    console.log('Paste into Cloudflare > D1 > ugreen-vero > Console:\n\n' + insertSql(a, code) + '\n');
    if (a.role === 'dealer') console.log('Note: dealers are not in AI_ROLES during the pilot; this code will be refused until AI_ROLES includes "dealer".\n');
  } else if (cmd === 'revoke') {
    if (!idOk(a.id)) return die('--id required');
    console.log(`UPDATE access_codes SET active = 0, revoked_at = datetime('now') WHERE id = ${sq(a.id)};`);
  } else if (cmd === 'restore') {
    if (!idOk(a.id)) return die('--id required');
    console.log(`UPDATE access_codes SET active = 1, revoked_at = NULL, token_epoch = token_epoch + 1 WHERE id = ${sq(a.id)};`);
  } else if (cmd === 'logout') {
    if (!idOk(a.id)) return die('--id required');
    console.log(`UPDATE access_codes SET token_epoch = token_epoch + 1 WHERE id = ${sq(a.id)};`);
  } else if (cmd === 'list') {
    console.log('SELECT id, role, label, active, daily_limit, created_at, revoked_at, last_used_at FROM access_codes ORDER BY id;');
  } else if (cmd === 'secret') {
    console.log(randomBytes(32).toString('base64url'));
  } else {
    console.log('Usage: node tools/vero-code.mjs new --id c_sales01 --role sales | revoke --id .. | restore --id .. | logout --id .. | list | secret');
  }
}
function die(m) { console.error('Error: ' + m); process.exitCode = 1; }
if (import.meta.url === 'file://' + process.argv[1] || process.argv[1].endsWith('vero-code.mjs')) main();
