/**
 * Second capture pass, and the one that is actually load-bearing.
 *
 * The model rewrite makes a fixture read naturally; it must not be trusted to
 * remove identity. Asked to keep "large consumer brands" it kept the reader's
 * gym, doctor, bank and registrar — which as a set describe a person more
 * precisely than their name would.
 *
 * So every sender identity in the source mailbox is mapped to an invented one
 * here, in code, deterministically, and applied to every field. Which brand a
 * message is from never affects how it should be classified, so nothing of
 * value is lost by replacing all of them.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

const DIR = resolve(process.cwd(), 'apps/server/src/eval/fixtures');
const db = new BetterSqlite3(resolve(process.cwd(), 'data/weft.db'), { readonly: true });

const BRANDS = [
  'Northwind', 'Lumen', 'Harbour', 'Oakfield', 'Brightpath', 'Cedarline', 'Kestrel', 'Meridian',
  'Alder', 'Thornbury', 'Larkspur', 'Pinehurst', 'Wexford', 'Ashgrove', 'Fairmont', 'Rooksby',
  'Halcyon', 'Windrow', 'Belmont', 'Cranwell', 'Dunmore', 'Eastvale', 'Fernhill', 'Glenmoor',
  'Havenside', 'Ironwood', 'Junewell', 'Kingsley', 'Loxley', 'Marlowe', 'Netherby', 'Orrell',
  'Pemberton', 'Quilling', 'Ravensmere', 'Southgate', 'Tarnbrook', 'Ulverton', 'Vardon', 'Westray',
];
const PEOPLE = [
  'Elin Moss', 'Rafe Calder', 'Nadia Orr', 'Tom Wexler', 'Priya Vale', 'Joss Bramley', 'Iris Kane',
  'Dev Ashbury', 'Mira Sale', 'Owen Trent', 'Lena Hart', 'Cass Berryman', 'Nell Fairbairn', 'Otto Vane',
];

const pick = <T>(list: T[], key: string): T => {
  const n = parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16);
  return list[n % list.length]!;
};

/** shop.example.com -> example; mail.northwind.co.uk -> northwind */
const brandToken = (domain: string): string => {
  const parts = domain.toLowerCase().split('.').filter((p) => !['com', 'org', 'net', 'io', 'co', 'uk', 'in'].includes(p));
  return parts[parts.length - 1] ?? domain;
};

// Everything that appears as a sender anywhere in the real mailbox.
const senders = db.prepare('SELECT DISTINCT from_email, from_name FROM messages').all() as
  { from_email: string; from_name: string }[];

/**
 * Sender display names are full of ordinary words — "Every", "Board", "Connect",
 * "Care", "App". Substituting those wrecks the prose they appear inside, and
 * they identify nobody, so they are skipped. Anything shorter than four
 * characters is skipped for the same reason.
 */
const STOPWORDS = new Set([
  'app', 'apps', 'care', 'team', 'mail', 'news', 'info', 'help', 'shop', 'club', 'home',
  'board', 'connect', 'every', 'edu', 'store', 'health', 'support', 'service', 'services',
  'account', 'accounts', 'alerts', 'billing', 'notify', 'update', 'updates', 'family',
  'school', 'office', 'admin', 'group', 'online', 'digital', 'studio', 'center', 'centre',
  'email', 'reply', 'noreply', 'donotreply', 'member', 'members', 'community', 'live',
]);

const map = new Map<string, string>();
const addWord = (real: string, fake: string) => {
  const k = real.toLowerCase().trim();
  if (k.length < 4 || STOPWORDS.has(k) || map.has(k)) return;
  map.set(k, fake);
};

for (const s of senders) {
  const domain = (s.from_email.split('@')[1] ?? '').toLowerCase();
  if (domain) {
    const token = brandToken(domain);
    const fake = pick(BRANDS, token);
    addWord(token, fake);
    // Whole domains too, so "mail.northwind.co.uk" does not survive as a unit.
    addWord(domain, `${fake.toLowerCase()}.example`);
  }
  const name = (s.from_name ?? '').trim();
  // A display name with a space is a person; a single token is usually a brand.
  if (name && name.includes(' ') && name.length < 40) addWord(name, pick(PEOPLE, name));
  else if (name) addWord(name, pick(BRANDS, name));
}

// Terms that identify the reader's household or their subscriptions directly,
// whatever the sender: children's names, their school, the gym, the products
// they pay for. That table is a description of one family, so it lives beside
// the mailbox in data/ rather than in the repo. Absent, this pass still does
// the sender mapping above, which is the bulk of the work.
const TERMS_FILE = resolve(process.cwd(), 'data/anonymise-terms.json');
if (existsSync(TERMS_FILE)) {
  const extra = JSON.parse(readFileSync(TERMS_FILE, 'utf8')) as Record<string, string>;
  for (const [real, fake] of Object.entries(extra)) addWord(real, fake);
  console.log(`  loaded ${Object.keys(extra).length} local terms from data/anonymise-terms.json`);
} else {
  console.log('  no data/anonymise-terms.json — sender mapping only');
}

// Longest first, so a two-word name is replaced before its squashed form
// can partially match it.
const ordered = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scrub(text: string): { out: string; hits: string[] } {
  let out = text;
  const hits: string[] = [];
  for (const [real, fake] of ordered) {
    // Word boundaries are the whole game here. Without them "hob" rewrites the
    // middle of "scheduled" and the fixture stops being English.
    //
    // Distinctive tokens drop the trailing boundary so compounds are caught —
    // "Noteshelf3", "SchwabSafe" — which a strict boundary leaves standing.
    // Short tokens keep it, or "steam" starts eating "steamed".
    const tail = real.length >= 6 ? '' : '(?![A-Za-z0-9])';
    const re = new RegExp(`(?<![A-Za-z0-9])${escape(real)}${tail}`, 'gi');
    if (re.test(out)) { hits.push(real); out = out.replace(re, fake); }
  }
  // Any remaining address on a real-looking domain becomes an example.com one.
  out = out.replace(/[\w.+-]+@[\w.-]+\.\w{2,}/g, (m) => {
    const local = m.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    return `${local}@${pick(BRANDS, m).toLowerCase()}.example`;
  });
  return { out, hits };
}

/**
 * Scrub parsed values, never the file text. In raw JSON an escaped newline is
 * the two characters \ and n, so every word starting a new line looks as if it
 * is preceded by the letter n and the boundary check silently fails.
 */
const walk = (v: unknown, hits: Set<string>): unknown => {
  if (typeof v === 'string') {
    const r = scrub(v);
    r.hits.forEach((h) => hits.add(h));
    return r.out;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, hits));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, hits)]));
  }
  return v;
};

let touched = 0;
const allHits = new Set<string>();
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  const path = resolve(DIR, file);
  const raw = readFileSync(path, 'utf8');
  const out = JSON.stringify(walk(JSON.parse(raw), allHits), null, 2) + '\n';
  if (out !== raw) { writeFileSync(path, out); touched++; }
}
console.log(`  rewrote ${touched} fixture(s)`);
console.log(`  ${map.size} identities in the replacement map, ${allHits.size} of them actually present`);
console.log(`  replaced: ${[...allHits].sort().slice(0, 24).join(', ')}${allHits.size > 24 ? ' …' : ''}`);
process.exit(0);
