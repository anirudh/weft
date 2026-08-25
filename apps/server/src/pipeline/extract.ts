import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { ExtractionResult } from '@weft/shared';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { generateJson, type ThinkingLevel } from '../vertex/client.js';
import { validateAnchor } from './anchor.js';

const MAX_MESSAGES = 20;
const MAX_CHARS = 12_000;

export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    obligations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          court: { type: 'STRING', enum: ['yours', 'theirs'] },
          temporalClass: { type: 'STRING', enum: ['deadline', 'event', 'window', 'waiting_on', 'reference', 'ambient'] },
          anchorDate: { type: 'STRING', description: 'YYYY-MM-DD copied from a date stated in the text. Empty string if none is stated.' },
          anchorIsExplicit: { type: 'BOOLEAN', description: 'True only when a date appears literally in the text.' },
          anchorQuote: { type: 'STRING', description: 'The exact words the date came from. Empty if none.' },
          title: { type: 'STRING', description: "Short imperative from the reader's point of view." },
          detail: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['court', 'temporalClass', 'anchorDate', 'anchorIsExplicit', 'anchorQuote', 'title', 'detail', 'confidence'],
      },
    },
  },
  required: ['obligations'],
} as const;

export const SYSTEM = `You extract obligations from email threads.

Two different things belong on the reader's Horizon, and they are tested differently.

1. WORK — something the reader must do, or they lose something or something goes
   wrong. A date in the text is not enough; there has to be a consequence.
2. COMMITMENTS — somewhere the reader is expected to be, or something already on
   their day: an appointment, a class, a camp, a flight, a meeting, a calendar
   invitation, an event they registered for. These do NOT need a consequence. The
   test is only whether the reader would want it on their day. Extract them as
   events. Do not apply the loss test to these — a yoga class is a real commitment
   even though nothing goes wrong if it is missed.

The commonest error in both directions: treating a marketing date as work, and
throwing away a genuine appointment because missing it costs nothing.

court "yours"  = the reader owes the next move.
court "theirs" = the reader asked a specific person or organisation for something and
                 the answer has not come back.

temporalClass:
  deadline   the reader must act before a date or lose something
  event      somewhere the reader is expected: an appointment, class, camp, flight,
             meeting, calendar invitation, or an event they registered for
  window     an option the reader holds stays open until a date, then closes
  waiting_on someone owes the reader a reply or a decision
  reference  a record the reader will need later (a policy number, a contract)
  ambient    a newsletter or announcement — nothing is owed

WHAT IS NOT AN OBLIGATION. Return nothing for these, however urgent the wording and
however firm the date:
- Promotional offers. A discount code, a sale, early-bird pricing, a trade-in deal, a
  referral bonus. "Expires Thursday" is the seller's deadline, not the reader's — when
  it passes the reader has lost nothing they had. This is the single most common
  mistake: a marketing email with a real date is still marketing.
- Receipts, order confirmations, shipping notices, payment-received notices. The money
  already moved. Extract these ONLY when the message says the reader still owes money,
  and then it is a deadline with the amount in detail.
- Anything that completes on its own: a refund already approved and in transit, a
  package on its way, a service that resumes automatically, an account that renews
  without the reader doing anything. Nobody is waiting on anybody.
- Events the reader is not actually going to: a webinar, summit, launch or party
  being advertised to a mailing list. The dividing line is whether this reader is
  booked in — they registered, RSVP'd, were invited by name, or it is on their
  calendar — or whether the same email went to everybody. Booked in is an event;
  advertised is nothing.

WHAT IS ALWAYS WORTH EXTRACTING:
- Subscription and trial renewals. A trial converting to paid, a plan auto-renewing, a
  price rising on a date. The reader keeps the money only by acting before that date,
  so this is a real window or deadline even though no human is asking anything of them.
  Put the amount and the date in detail.
  A trial or free period ENDING counts, even when the email is written as an upsell and
  never names a price — trials convert by default, so the end date is the last day the
  reader can decide. This is the one case where a marketing email carries a real
  obligation, because the reader's own money is already committed to moving.
- Anything a school, camp, employer, doctor, government body, bank or brokerage asks
  the reader to complete, return, confirm or schedule: a form, a survey, an
  evaluation, a preference, an appointment to book, a statement to review. These are
  obligations even when nothing visibly goes wrong if they are skipped, because a
  real person is expecting them back.
- Every appointment, class, camp session, lesson, flight and meeting, including ones
  that arrive as calendar invitations.
- Anything the reader personally asked for that has not arrived.

Rules:
- Return an empty list when the thread creates no obligation. Most mail creates none.
- NEVER invent a date. Put a value in anchorDate only when a date literally appears in
  the text, and copy the exact source words into anchorQuote. If the text states no
  date, set anchorDate to "" and anchorIsExplicit to false. Do not infer a date from
  urgency.
- Titles are short and imperative, written from the reader's point of view.
- One obligation per distinct action. Do not restate the same action twice.`;

export const EXAMPLES = `<examples>
<example>
<thread>From: ORIGIN <news@origin.com>
Subject: Casual Boots. Serious Backbone.
Shop the new arrivals. 20% off this week only.</thread>
<output>{"obligations":[]}</output>
</example>
<example>
<thread>From: Google Store <no-reply@google.com>
Subject: $200 off the Pixel 11 — ends August 27
Use code KEIF6ZP6 for $200 off. Offer expires 8/27/2026 at 11:59 pm PT. Trade in an
eligible device for up to $400 back.</thread>
<output>{"obligations":[]}</output>
</example>
<example>
<thread>From: The Atlantic <accounts@noreply.theatlantic.com>
Subject: Your trial ends soon. Here's how to keep reading.
Keep reading. Keep thinking. Keep growing. We hope you have been enjoying your trial,
which will end on 08/27/2026. There is still time to explore everything The Atlantic
has to offer, including unlimited access to every Atlantic story, the app, narrated
articles, daily games and a 169-year archive.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"window","anchorDate":"2026-08-27","anchorIsExplicit":true,"anchorQuote":"end on 08/27/2026","title":"Decide on The Atlantic before the trial converts","detail":"Trial ends 27 August; no price stated in the email","confidence":0.8}]}</output>
</example>
<example>
<thread>From: Larkspur Elementary <office@larkspur.org>
Subject: Fall permission packet
Please sign and return the field trip form by Friday August 29.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"deadline","anchorDate":"2026-08-29","anchorIsExplicit":true,"anchorQuote":"Friday August 29","title":"Sign and return the field trip form","detail":"Larkspur Elementary fall permission packet","confidence":0.95}]}</output>
</example>
<example>
<thread>From: Dana Whitlock <dana@northgate.co>
Subject: Re: pricing tiers
Circling back on this. We need to decide before the board meets.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"deadline","anchorDate":"","anchorIsExplicit":false,"anchorQuote":"","title":"Reply to Dana about the pricing tiers","detail":"Second ask; no date stated","confidence":0.8}]}</output>
</example>
<example>
<thread>From: Harbour Swim Academy <bookings@harbourswim.com>
Subject: Lesson confirmed
Maya's swim lesson is confirmed for Thursday 27 August at 4:30pm with Coach Mel.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"event","anchorDate":"2026-08-27","anchorIsExplicit":true,"anchorQuote":"Thursday 27 August","title":"Maya's swim lesson at Harbour Swim Academy","detail":"4:30pm with Coach Mel","confidence":0.95}]}</output>
</example>
<example>
<thread>From: Wildwood Camps <camps@wildwoodcamps.com>
Subject: How did we do? Camp evaluation for Maya
Please take a few minutes to complete the evaluation for Maya's session. Your
feedback shapes next summer's programme.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"deadline","anchorDate":"","anchorIsExplicit":false,"anchorQuote":"","title":"Complete the Wildwood camp evaluation for Maya","detail":"No date stated","confidence":0.8}]}</output>
</example>
<example>
<thread>From: Sub Club <hello@subclub.com>
Subject: Join us live: affiliate marketing that actually works
Register now for our free live session on Thursday 27 August. Seats are limited.</thread>
<output>{"obligations":[]}</output>
</example>
<example>
<thread>From: Amazon <no-reply@amazon.com>
Subject: Your refund has been processed
We have issued a refund of $24.99 for order #114-7222008. Expect it in 3-5 business days.</thread>
<output>{"obligations":[]}</output>
</example>
<example>
<thread>From: You
Date: 2026-08-14
Hi — could you let me know whether a spot opened up on the waitlist for Maya?

---

From: Wildwood Family Team <family@wildwoodcamps.com>
Date: 2026-08-14
Thanks, we have logged this as ticket #482100 and will reach out if a space becomes available.</thread>
<output>{"obligations":[{"court":"theirs","temporalClass":"waiting_on","anchorDate":"2026-08-14","anchorIsExplicit":true,"anchorQuote":"2026-08-14","title":"Hear back on the Wildwood waitlist for Maya","detail":"Ticket #482100; no answer since 14 August","confidence":0.85}]}</output>
</example>
<example>
<thread>From: Riverside Club <billing@riversideclub.com>
Subject: Your August statement
Your August statement reflects a balance of $312.50, due 31 August 2026.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"deadline","anchorDate":"2026-08-31","anchorIsExplicit":true,"anchorQuote":"due 31 August 2026","title":"Pay the Riverside Club statement balance","detail":"$312.50 due 31 August","confidence":0.95}]}</output>
</example>
</examples>`;

/**
 * The exact prompt the extractor sends. Exported so the eval harness in
 * ./eval exercises this and not a copy of it — a fixture suite that drifts
 * away from the code it is meant to guard is worse than no suite at all.
 */
export function buildExtractionPrompt(a: {
  threadText: string; subject: string; today: string; accountEmail: string;
}): string {
  return `${EXAMPLES}

Today is ${a.today}. You are reading the mailbox of ${a.accountEmail}.

<thread>
Subject: ${a.subject}

${a.threadText}
</thread>`;
}

export type ExtractProgress = {
  state: 'idle' | 'running' | 'done' | 'error';
  done: number; total: number; obligations: number; capped: number;
  tokensIn: number; tokensOut: number; failures: number; error?: string;
};
let progress: ExtractProgress = { state: 'idle', done: 0, total: 0, obligations: 0, capped: 0, tokensIn: 0, tokensOut: 0, failures: 0 };
export const getExtractProgress = () => progress;

/** Head-and-tail truncation: the request is usually at the start, the current state at the end. */
export function buildThreadText(msgs: { fromName: string; fromEmail: string; subject: string; bodyText: string; internalDate: number; isSent: boolean }[]) {
  let capped = false;
  let use = msgs;
  if (use.length > MAX_MESSAGES) {
    capped = true;
    use = [...use.slice(0, 5), ...use.slice(-(MAX_MESSAGES - 5))];
  }
  const parts = use.map((m) => {
    const who = m.isSent ? 'You' : `${m.fromName || m.fromEmail} <${m.fromEmail}>`;
    const when = new Date(m.internalDate).toISOString().slice(0, 10);
    return `From: ${who}\nDate: ${when}\n${m.bodyText}`;
  });
  let text = parts.join('\n\n---\n\n');
  if (text.length > MAX_CHARS) {
    capped = true;
    text = text.slice(0, MAX_CHARS * 0.6) + '\n\n[…middle of thread omitted…]\n\n' + text.slice(-MAX_CHARS * 0.4);
  }
  return { text, capped };
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; if (it !== undefined) await fn(it); }
  }));
}

export async function runExtraction(limit?: number): Promise<ExtractProgress> {
  const pending = await db
    .select({ id: schema.threads.id, accountId: schema.threads.accountId, gmailThreadId: schema.threads.gmailThreadId, subject: schema.threads.subject })
    .from(schema.threads)
    .where(and(eq(schema.threads.isBulk, false), eq(schema.threads.extractState, 'pending')))
    .limit(limit ?? 10_000);

  const accountEmail = new Map(
    (await db.select().from(schema.accounts)).map((a) => [a.id, a.email]),
  );

  progress = { state: 'running', done: 0, total: pending.length, obligations: 0, capped: 0, tokensIn: 0, tokensOut: 0, failures: 0 };
  const today = new Date().toISOString().slice(0, 10);

  try {
    await pool(pending, 6, async (t) => {
      const msgs = await db
        .select({
          gmailId: schema.messages.gmailId, fromName: schema.messages.fromName, fromEmail: schema.messages.fromEmail,
          subject: schema.messages.subject, bodyText: schema.messages.bodyText,
          internalDate: schema.messages.internalDate, isSent: schema.messages.isSent,
        })
        .from(schema.messages)
        .where(and(eq(schema.messages.accountId, t.accountId), eq(schema.messages.threadId, t.gmailThreadId), eq(schema.messages.isBulk, false)))
        .orderBy(asc(schema.messages.internalDate));

      if (msgs.length === 0) {
        await db.update(schema.threads).set({ extractState: 'skipped' }).where(eq(schema.threads.id, t.id));
        progress.done++;
        return;
      }

      const { text, capped } = buildThreadText(msgs);
      if (capped) progress.capped++;

      const user = buildExtractionPrompt({
        threadText: text,
        subject: t.subject,
        today,
        accountEmail: accountEmail.get(t.accountId) ?? 'the reader',
      });

      try {
        const { data, usage } = await generateJson<unknown>({
          model: env.GEMINI_EXTRACT_MODEL,
          system: SYSTEM,
          user,
          schema: SCHEMA as unknown as Record<string, unknown>,
          thinkingLevel: env.GEMINI_EXTRACT_THINKING as ThinkingLevel,
        });
        progress.tokensIn += usage.promptTokens;
        progress.tokensOut += usage.outputTokens + usage.thoughtTokens;

        const parsed = ExtractionResult.safeParse(data);
        if (!parsed.success) throw new Error('schema mismatch: ' + parsed.error.issues[0]?.message);

        const now = Date.now();
        for (const o of parsed.data.obligations) {
          const anchor = validateAnchor({ anchorDate: o.anchorDate, anchorIsExplicit: o.anchorIsExplicit, anchorQuote: o.anchorQuote });
          await db.insert(schema.obligations).values({
            accountId: t.accountId,
            threadId: t.id,
            sourceMessageId: msgs[msgs.length - 1]?.gmailId ?? '',
            court: o.court,
            temporalClass: o.temporalClass,
            anchorDate: anchor.anchorDate,
            anchorIsExplicit: anchor.anchorIsExplicit,
            anchorQuote: anchor.anchorQuote,
            anchorValidated: anchor.anchorValidated,
            title: o.title,
            detail: o.detail,
            confidence: o.confidence,
            createdAt: now,
            updatedAt: now,
          });
          progress.obligations++;
        }

        await db.update(schema.threads)
          .set({ extractState: 'done', wasCapped: capped, extractHash: createHash('sha256').update(text).digest('hex') })
          .where(eq(schema.threads.id, t.id));
      } catch (err) {
        progress.failures++;
        await db.update(schema.threads).set({ extractState: 'pending' }).where(eq(schema.threads.id, t.id));
        if (progress.failures <= 3) progress.error = String(err).slice(0, 200);
      }
      progress.done++;
    });
    progress.state = 'done';
  } catch (err) {
    progress = { ...progress, state: 'error', error: String(err) };
  }
  return progress;
}
