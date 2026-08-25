/**
 * Runs the real extraction prompt against the frozen corpus and reports what
 * changed. This is the thing that turns a prompt edit from a judgement call
 * into a number.
 *
 *   npm run eval                 one pass over every fixture
 *   npm run eval -- --reps 3     three passes, to separate a real change from
 *                                the model flipping on a borderline case
 *   npm run eval -- --only sub   just the fixtures whose id contains "sub"
 *
 * Each fixture pins its own `today`, so results never drift with the calendar.
 * Exits non-zero if anything regresses, so it can gate a commit.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExtractionResult } from '@weft/shared';
import { env } from '../env.js';
import { generateJson, type ThinkingLevel } from '../vertex/client.js';
import { SYSTEM, SCHEMA, buildExtractionPrompt, buildThreadText } from '../pipeline/extract.js';

type Fixture = {
  id: string; note: string; today: string; subject: string; knownGap?: boolean;
  messages: { fromName: string; fromEmail: string; subject: string; date: string; isSent: boolean; body: string }[];
  expect: { obligations: 'none' } | { obligations: 'some'; court?: string; temporalClass?: string; anchorDate?: string };
};

const DIR = resolve(process.cwd(), 'apps/server/src/eval/fixtures');
const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const REPS = Math.max(1, Number(arg('--reps') ?? 1));
const ONLY = arg('--only');

const fixtures: Fixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as Fixture)
  .filter((f) => !ONLY || f.id.includes(ONLY))
  .sort((a, b) => a.id.localeCompare(b.id));

type Obl = { court: string; temporalClass: string; anchorDate: string; title: string };

async function once(f: Fixture): Promise<{ obligations: Obl[]; tokens: number }> {
  const { text } = buildThreadText(
    f.messages.map((m) => ({
      fromName: m.fromName, fromEmail: m.fromEmail, subject: m.subject,
      bodyText: m.body, internalDate: Date.parse(m.date), isSent: m.isSent,
    })),
  );
  const { data, usage } = await generateJson<unknown>({
    model: env.GEMINI_EXTRACT_MODEL,
    system: SYSTEM,
    user: buildExtractionPrompt({ threadText: text, subject: f.subject, today: f.today, accountEmail: 'reader@example.com' }),
    schema: SCHEMA as unknown as Record<string, unknown>,
    thinkingLevel: env.GEMINI_EXTRACT_THINKING as ThinkingLevel,
  });
  const parsed = ExtractionResult.safeParse(data);
  if (!parsed.success) throw new Error('schema mismatch');
  return { obligations: parsed.data.obligations as unknown as Obl[], tokens: usage.promptTokens + usage.outputTokens };
}

/** Why a run failed, in the fewest words that let you act on it. */
function judge(f: Fixture, got: Obl[]): string | null {
  if (f.expect.obligations === 'none') {
    return got.length === 0 ? null : `expected nothing, got ${got.length}: ${got.map((o) => o.title).join('; ').slice(0, 60)}`;
  }
  if (got.length === 0) return 'expected an obligation, got none';
  const e = f.expect;
  if (e.court && !got.some((o) => o.court === e.court)) return `no obligation in ${e.court} court (got ${got.map((o) => o.court).join(',')})`;
  if (e.temporalClass && !got.some((o) => o.temporalClass === e.temporalClass)) return `no ${e.temporalClass} (got ${got.map((o) => o.temporalClass).join(',')})`;
  if (e.anchorDate !== undefined && !got.some((o) => (o.anchorDate ?? '') === e.anchorDate)) {
    return `no anchor ${e.anchorDate === '' ? '(undated)' : e.anchorDate} (got ${got.map((o) => o.anchorDate || 'undated').join(',')})`;
  }
  return null;
}

async function pool<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; if (it !== undefined) await fn(it); }
  }));
}

const results = new Map<string, { passes: number; failures: string[] }>();
let tokens = 0;
const jobs = fixtures.flatMap((f) => Array.from({ length: REPS }, () => f));

await pool(jobs, 6, async (f) => {
  let why: string | null;
  try {
    const r = await once(f);
    tokens += r.tokens;
    why = judge(f, r.obligations);
  } catch (err) {
    why = `error: ${String(err).slice(0, 60)}`;
  }
  const cur = results.get(f.id) ?? { passes: 0, failures: [] };
  if (why === null) cur.passes++; else cur.failures.push(why);
  results.set(f.id, cur);
});

let pass = 0, fail = 0, gaps = 0, flaky = 0;
for (const f of fixtures) {
  const r = results.get(f.id)!;
  const solid = r.passes === REPS;
  const dead = r.passes === 0;
  const rate = REPS > 1 ? ` ${r.passes}/${REPS}` : '';

  if (solid) { pass++; console.log(`  PASS${rate}  ${f.id}`); continue; }
  if (f.knownGap) { gaps++; console.log(`  GAP ${rate}  ${f.id}  — ${r.failures[0]}`); continue; }
  if (!dead) { flaky++; fail++; console.log(`  FLAKY${rate} ${f.id}  — ${r.failures[0]}`); continue; }
  fail++;
  console.log(`  FAIL${rate}  ${f.id}  — ${r.failures[0]}`);
  console.log(`          ${f.note}`);
}

console.log(`\n  ${pass}/${fixtures.length - gaps} passed · ${gaps} known gap(s) · ${flaky} flaky · ${tokens.toLocaleString()} tokens`);
if (fail > 0) console.log('  regression: a fixture that used to hold no longer does.');
process.exit(fail > 0 ? 1 : 0);
