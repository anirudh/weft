/**
 * One-time capture: turns real threads into a shareable corpus.
 *
 * Run against a machine that still has message bodies in SQLite. Once ingest
 * stops persisting bodies this cannot be re-run without refetching, which is
 * why the output is committed rather than regenerated.
 *
 * Every body is rewritten by a model before it is written to disk. The rewrite
 * keeps what makes a thread hard — its structure, its wording, and above all
 * its dates — and replaces every name, address, account number and amount with
 * invented ones. Nothing here should be traceable to a real person.
 *
 *   npx tsx apps/server/src/eval/capture.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import { env } from '../env.js';
import { generateJson } from '../vertex/client.js';
import { CASES } from './cases.js';

const OUT = resolve(process.cwd(), 'apps/server/src/eval/fixtures');
const LIVE = resolve(process.cwd(), 'data/weft.db');
const BACKUP = resolve(process.cwd(), process.argv[2] ?? 'data/weft.db.bak-20260824-182322');

/** Which thread each case came from. Gitignored: it is a list of one person's
 *  real obligations, and it is only needed on the machine holding that mail. */
const MAP_FILE = resolve(process.cwd(), 'data/capture-map.json');
if (!existsSync(MAP_FILE)) {
  console.error('missing data/capture-map.json — capture only runs where the source mailbox lives.');
  process.exit(1);
}
const MAP = JSON.parse(readFileSync(MAP_FILE, 'utf8')) as Record<string, { source: 'current' | 'backup'; locator: string }>;

const dbs = {
  current: new BetterSqlite3(LIVE, { readonly: true }),
  backup: new BetterSqlite3(BACKUP, { readonly: true }),
};
const bodies = new BetterSqlite3(LIVE, { readonly: true });

const SCRUB_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fromName: { type: 'STRING' },
    fromEmail: { type: 'STRING' },
    subject: { type: 'STRING' },
    body: { type: 'STRING' },
  },
  required: ['fromName', 'fromEmail', 'subject', 'body'],
} as const;

const SCRUB_SYSTEM = `You rewrite an email so it can be published as a test fixture.

Keep, exactly:
- Every date and time, in the same format they are written. "07-30-2026" stays
  "07-30-2026" and "27-JUL-26" stays "27-JUL-26". Date formats are the thing
  several of these fixtures exist to test.
- The structure, length and register of the message.
- Any phrase that makes the message hard to classify: "offer expires",
  "auto-pay enabled", "your trial ends", "please confirm", "no action needed".
- Whether it reads as marketing, transactional, personal or automated.

Replace, everywhere it appears:
- Personal names, including in greetings and signatures — invent new ones.
- Email addresses, phone numbers, postal addresses.
- Account, order, ticket, policy, case and reference numbers — invent new ones
  of the same shape and length.
- Company names, ONLY where the company is small, local or a school. Keep large
  consumer brands, since which brand it is affects nothing.
- URLs: replace with plausible ones on the same domain. Strip all query strings,
  which is where tracking identifiers live.

Money: keep amounts to the same order of magnitude, but change the digits.

Do not summarise, do not shorten, do not clean it up. Boilerplate, footers and
legal text should stay roughly as long as they were. Return the rewritten
message only.`;

type Row = { id: number; account_id: number; gmail_thread_id: string; subject: string };

async function capture(c: (typeof CASES)[number]) {
  const entry = MAP[c.id];
  if (!entry) return { id: c.id, ok: false, why: 'no entry in data/capture-map.json' };
  const row = dbs[entry.source]
    .prepare('SELECT t.id, t.account_id, t.gmail_thread_id, t.subject FROM obligations o JOIN threads t ON t.id = o.thread_id WHERE o.title = ? LIMIT 1')
    .get(entry.locator) as Row | undefined;
  if (!row) return { id: c.id, ok: false, why: 'no thread for locator' };

  const msgs = bodies
    .prepare('SELECT from_name, from_email, subject, body_text, internal_date, is_sent FROM messages WHERE account_id = ? AND thread_id = ? AND is_bulk = 0 ORDER BY internal_date')
    .all(row.account_id, row.gmail_thread_id) as {
      from_name: string; from_email: string; subject: string; body_text: string; internal_date: number; is_sent: number;
    }[];
  if (!msgs.length) return { id: c.id, ok: false, why: 'no messages' };

  const scrubbed = [];
  for (const m of msgs) {
    const { data } = await generateJson<{ fromName: string; fromEmail: string; subject: string; body: string }>({
      model: env.GEMINI_COMPOSE_MODEL,
      system: SCRUB_SYSTEM,
      user: `From: ${m.from_name} <${m.from_email}>\nSubject: ${m.subject}\n\n${m.body_text.slice(0, 8000)}`,
      schema: SCRUB_SCHEMA as unknown as Record<string, unknown>,
      thinkingLevel: 'low',
    });
    scrubbed.push({
      fromName: data.fromName,
      fromEmail: data.fromEmail,
      subject: data.subject,
      date: new Date(m.internal_date).toISOString().slice(0, 10),
      isSent: Boolean(m.is_sent),
      body: data.body,
    });
  }

  // Pinned to the day after the thread's last message: the production case is
  // mail read shortly after it arrives, and a fixed clock keeps the expected
  // result stable forever.
  const last = Math.max(...msgs.map((m) => m.internal_date));
  const today = new Date(last + 86_400_000).toISOString().slice(0, 10);

  const fixture = {
    id: c.id,
    note: c.note,
    today,
    subject: scrubbed[0]?.subject ?? row.subject,
    messages: scrubbed,
    expect: c.expect,
    ...(c.knownGap ? { knownGap: true } : {}),
  };
  writeFileSync(resolve(OUT, `${c.id}.json`), JSON.stringify(fixture, null, 2) + '\n');
  return { id: c.id, ok: true, why: `${scrubbed.length} message(s), today=${today}` };
}

mkdirSync(OUT, { recursive: true });
let ok = 0;
for (const c of CASES) {
  const r = await capture(c);
  if (r.ok) ok++;
  console.log(`  ${r.ok ? 'ok  ' : 'MISS'} ${r.id.padEnd(30)} ${r.why}`);
}
console.log(`\n${ok}/${CASES.length} captured into ${OUT}`);
process.exit(0);
