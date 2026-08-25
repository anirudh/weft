/**
 * Runs the real compose prompt over the frozen brief cases and reports what
 * changed.
 *
 *   npm run eval:brief                 one pass over every case
 *   npm run eval:brief -- --reps 3     three passes, to separate a real change
 *                                      from the model wobbling
 *   npm run eval:brief -- --only money just the cases whose id contains "money"
 *   npm run eval:brief -- --print      show the briefs, which is the only way to
 *                                      judge the half no assertion can reach
 *
 * Separate from `npm run eval` because it exercises a different prompt on a
 * different model, and because a voice change should be able to run without
 * paying for the extraction corpus.
 *
 * Exits non-zero on any failure, so it can gate a commit.
 */
import { BRIEF_CASES, type BriefCase } from './brief-cases.js';
import { env } from '../env.js';
import { generateJson, type ThinkingLevel } from '../vertex/client.js';
import { SYSTEM, SCHEMA, EXAMPLE } from '../pipeline/compose.js';
import { lintVoice, formatViolations } from '@weft/shared';

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const REPS = Math.max(1, Number(arg('--reps') ?? 1));
const ONLY = arg('--only');
const PRINT = process.argv.includes('--print');

const buildInput = (c: BriefCase) => {
  const line = (o: { whenLabel: string; title: string; detail: string }) =>
    `- [${o.whenLabel}] ${o.title}${o.detail ? ` - ${o.detail}` : ''}`;
  return [
    `Today is ${c.date}.`,
    'YOUR COURT',
    c.yours.length ? c.yours.map(line).join('\n') : '- nothing open',
    'THEIR COURT',
    c.theirs.length ? c.theirs.map(line).join('\n') : '- nothing outstanding from anyone else',
    `THIS WEEK: ${c.week.map((d) => `${d.label}: ${d.count === 0 ? 'nothing' : d.count}`).join(' - ')}`,
  ].join('\n');
};

/** Every money figure in a string, normalised so $89 and $89.00 compare equal. */
const money = (s: string) =>
  new Set([...s.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]!.replace(/,/g, ''))));

type Failure = { rule: string; detail: string };

function check(c: BriefCase, input: string, out: { headline: string; notes: string[] }): Failure[] {
  const fails: Failure[] = [];
  const all = [out.headline, ...out.notes].join('\n');

  for (const text of [out.headline, ...out.notes]) {
    const v = lintVoice(text);
    if (v.length) fails.push({ rule: 'voice', detail: formatViolations(text, v) });
  }

  const words = out.headline.trim().split(/\s+/).length;
  if (words > 14) fails.push({ rule: 'headline-length', detail: `${words} words, cap is 14` });
  if (/^(good |hello|hi\b|welcome)/i.test(out.headline.trim())) {
    fails.push({ rule: 'headline-greeting', detail: out.headline });
  }
  if (out.notes.length < 2 || out.notes.length > 4) {
    fails.push({ rule: 'note-count', detail: `${out.notes.length}, expected 2 to 4` });
  }

  // The assertion that matters. A reader can catch a clumsy sentence; they
  // cannot catch a number that was never in their mail.
  const fromInput = money(input);
  for (const n of money(all)) {
    if (!fromInput.has(n)) {
      // A total the model worked out from the parts is legitimate and common.
      const sum = [...fromInput].reduce((a, b) => a + b, 0);
      if (Math.abs(n - sum) < 0.01) continue;
      fails.push({ rule: 'invented-money', detail: `$${n} appears in the brief but not in the input` });
    }
  }

  for (const word of c.forbid ?? []) {
    if (all.toLowerCase().includes(word.toLowerCase())) {
      fails.push({ rule: 'forbidden-for-this-case', detail: `"${word}"` });
    }
  }
  return fails;
}

const cases = BRIEF_CASES.filter((c) => !ONLY || c.id.includes(ONLY));
let passed = 0;
let failed = 0;
let tokensIn = 0;
let tokensOut = 0;

for (const c of cases) {
  const input = buildInput(c);
  const results: Failure[][] = [];

  for (let rep = 0; rep < REPS; rep++) {
    const { data: out, usage } = await generateJson<{ headline: string; notes: string[] }>({
      model: env.GEMINI_COMPOSE_MODEL,
      // Mirrors composeNow exactly. If this drifts from the real call, the
      // corpus measures a prompt the product does not use.
      system: SYSTEM,
      user: `${EXAMPLE}\n\n<input>${input}</input>`,
      schema: SCHEMA as unknown as Record<string, unknown>,
      thinkingLevel: env.GEMINI_COMPOSE_THINKING as ThinkingLevel,
    });
    tokensIn += usage.promptTokens;
    tokensOut += usage.outputTokens;
    results.push(check(c, input, out));
    if (PRINT) {
      console.log(`\n  ${c.id} (rep ${rep + 1})\n  ${out.headline}`);
      for (const n of out.notes) console.log(`    - ${n}`);
    }
  }

  const bad = results.filter((r) => r.length > 0);
  if (bad.length === 0) {
    passed++;
    console.log(`  PASS ${REPS > 1 ? `${REPS}/${REPS}  ` : ''}${c.id}`);
  } else {
    failed++;
    console.log(`  FAIL ${REPS > 1 ? `${REPS - bad.length}/${REPS}  ` : ''}${c.id}  ${c.note}`);
    for (const f of bad[0]!) console.log(`         ${f.rule}: ${f.detail}`);
  }
}

console.log(
  `\n  ${passed}/${cases.length} passed${failed ? `, ${failed} failed` : ''} - ` +
    `${tokensIn.toLocaleString()} tokens in, ${tokensOut.toLocaleString()} out`,
);
process.exit(failed ? 1 : 0);
