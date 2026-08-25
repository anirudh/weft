import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { Edition, Obligation, WeekDay } from '@weft/shared';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { generateJson, type ThinkingLevel } from '../vertex/client.js';

/**
 * The one paragraph at the top of the page. Everything below it is a list the
 * reader can already scan, so a brief that restates the list earns nothing —
 * its whole job is to say what the lists cannot: what today is shaped like,
 * what collides, what is quietly about to cost money.
 *
 * One call per edition, cached on a hash of the exact inputs. Re-opening
 * Horizon without new mail — or after clearing something and undoing it — is
 * free, and the hash changes the moment the open set does.
 */

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: {
      type: 'STRING',
      description: 'One sentence naming the shape of the day. No greeting, no date, at most 14 words.',
    },
    notes: {
      type: 'ARRAY',
      description: 'Two to four short observations that add something the lists below do not already say.',
      items: { type: 'STRING' },
    },
  },
  required: ['headline', 'notes'],
} as const;

const SYSTEM = `You write the standing summary at the top of a daily mail brief.

Below your text the reader already sees every open obligation with its own date
label, a seven-day calendar, and the mail itself. Restating any of that is wasted
space. Your job is what a list cannot do: say what the day is shaped like, point
out what collides, and name what is quietly about to cost money.

The headline is one sentence. It names the shape of the day — not a greeting, not
the date, not a count of unread mail.

Then two to four notes. Each must earn its place by doing one of these:
- connecting two items the reader would not connect themselves
- grouping several small things into one movement ("three subscriptions renew
  inside a fortnight, together about $130 a month")
- naming the one thing that actually matters most today, and why
- pointing out a genuinely empty stretch, when there is one

Voice:
- Forward-facing. Never "you are late", "overdue", "you missed". If a date has
  passed, the question is whether it is still open, not whose fault it is.
- Plain and calm. No exclamation marks, no urgency theatre, no motivational lines.
- Second person, present tense. Short sentences.
- Never invent anything. Every fact must come from the data given. If you are not
  sure of a detail, leave it out rather than guess it.
- Do not thank, encourage, or comment on how busy the reader is.`;

const EXAMPLE = `<example>
<input>Today is Monday 24 August.
YOUR COURT
- [By tomorrow] Confirm attendance for the Brightpath trial class — class is tomorrow at 16:00
- [Closes tomorrow] Cancel Notewell Premium trial before renewal — $7.99/week
- [Closes in 3 days] Manage Lightbox subscription before auto-renewal — $7.71 on 27 August
- [In 14 days] Cancel Atlas AI Pro subscription before renewal — $110.29/month on 7 September
THEIR COURT
- [Worth chasing] Hear back on the Wildwood waitlist request — no answer in 10 days
THIS WEEK: Tue: 1 · Wed: 1 · Thu: 3 · Fri-Sun: nothing</input>
<output>{"headline":"A quiet week with money leaking out of the edges of it.","notes":["Four subscriptions renew between tomorrow and 7 September, together about $125 a month — Atlas AI Pro is nearly all of it.","Tomorrow is the only day with a hard commitment: the Brightpath class at 16:00, and confirmation has to land before it starts.","Thursday carries three items and the rest of the week is empty, so anything you want to move has somewhere to go.","Wildwood have been silent on the waitlist for ten days; that one is worth a nudge rather than more waiting."]}</output>
</example>`;

/** Everything that can change the brief. Nothing else. */
export function inputHash(parts: { cursors: string[]; loops: Obligation[]; date: string }): string {
  const h = createHash('sha256');
  h.update(parts.date);
  h.update(parts.cursors.join(','));
  for (const o of [...parts.loops].sort((a, b) => a.id - b.id)) {
    h.update(`${o.id}:${o.court}:${o.temporalClass}:${o.anchorDate}:${o.whenLabel}:${o.title}`);
  }
  return h.digest('hex');
}

export function buildInput(date: string, yours: Obligation[], theirs: Obligation[], week: WeekDay[]): string {
  const line = (o: Obligation) => `- [${o.whenLabel}] ${o.title}${o.detail ? ` — ${o.detail}` : ''}`;
  const days = week
    .map((d) => `${d.label}: ${d.items.length === 0 ? 'nothing' : `${d.items.length}`}`)
    .join(' · ');
  return [
    `Today is ${date}.`,
    'YOUR COURT',
    yours.length ? yours.map(line).join('\n') : '- nothing open',
    'THEIR COURT',
    theirs.length ? theirs.map(line).join('\n') : '- nothing outstanding from anyone else',
    `THIS WEEK: ${days}`,
  ].join('\n');
}

export type ComposeInput = {
  date: string;
  cursors: string[];
  yours: Obligation[];
  theirs: Obligation[];
  week: WeekDay[];
};

const row2edition = (r: { composedAt: number; headline: string; notes: string }, stale: boolean): Edition => ({
  composedAt: new Date(r.composedAt).toISOString(),
  headline: r.headline,
  notes: JSON.parse(r.notes) as string[],
  stale,
});

/** Hashes currently being composed, so N requests do not start N model calls. */
const inFlight = new Set<string>();

/**
 * Returns the cached edition when the inputs are unchanged. On a miss it returns
 * the PREVIOUS edition marked stale and writes the new one in the background.
 *
 * This never blocks, and that is the whole point. Composition is a 3.7-flash
 * call that takes about eight seconds. It used to run inside GET /api/horizon,
 * so completing a task — which changes the open set, which changes this hash —
 * made the button appear frozen for eight seconds while an AI wrote a paragraph
 * nobody was waiting for. Measured: the write itself is 2ms.
 */
export async function composeEdition(input: ComposeInput): Promise<Edition | null> {
  const loops = [...input.yours, ...input.theirs];
  if (loops.length === 0) return null; // nothing to say, and saying so is worse than silence

  const hash = inputHash({ cursors: input.cursors, loops, date: input.date });

  const [cached] = await db.select().from(schema.editions).where(eq(schema.editions.inputHash, hash));
  if (cached) return row2edition(cached, false);

  if (!inFlight.has(hash)) {
    inFlight.add(hash);
    void composeNow(input, hash).finally(() => inFlight.delete(hash));
  }

  const [latest] = await db
    .select()
    .from(schema.editions)
    .orderBy(desc(schema.editions.composedAt))
    .limit(1);
  return latest ? row2edition(latest, true) : null;
}

/** The actual model call. Never throws: a brief that cannot be written must not
 *  take the page down with it, because everything below it is already correct. */
async function composeNow(input: ComposeInput, hash: string): Promise<void> {
  try {
    const { data } = await generateJson<{ headline: string; notes: string[] }>({
      model: env.GEMINI_COMPOSE_MODEL,
      system: SYSTEM,
      user: `${EXAMPLE}\n\n<input>${buildInput(input.date, input.yours, input.theirs, input.week)}</input>`,
      schema: SCHEMA as unknown as Record<string, unknown>,
      thinkingLevel: env.GEMINI_COMPOSE_THINKING as ThinkingLevel,
    });

    const headline = String(data?.headline ?? '').trim();
    const notes = (Array.isArray(data?.notes) ? data.notes : []).map((n) => String(n).trim()).filter(Boolean);
    if (!headline) return;

    await db
      .insert(schema.editions)
      .values({ inputHash: hash, composedAt: Date.now(), headline, notes: JSON.stringify(notes) })
      .onConflictDoNothing();
  } catch {
    // Swallowed on purpose: the next request will try again.
  }
}
