import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { ExtractionResult } from '@weft/shared';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { generateJson, type ThinkingLevel } from '../vertex/client.js';
import { validateAnchor } from './anchor.js';
import { alreadySettled } from './settled.js';
import { resolveRecurring } from './recurring.js';

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
          service: { type: 'STRING', description: 'For a recurring charge only: the bare name of the thing being paid for, e.g. "Lightbox". Empty otherwise.' },
          amount: { type: 'STRING', description: 'Digits only, e.g. "110.29". Empty if no price is stated.' },
          currency: { type: 'STRING', description: 'USD, GBP, EUR, INR. Empty if no price is stated.' },
          cadence: { type: 'STRING', enum: ['none', 'monthly', 'weekly', 'yearly', 'quarterly', 'one_off'], description: 'How often it recurs. Use "none" when this is not a recurring charge.' },
        },
        required: ['court', 'temporalClass', 'anchorDate', 'anchorIsExplicit', 'anchorQuote', 'title', 'detail', 'confidence', 'service', 'amount', 'currency', 'cadence'],
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
- A subject line is not evidence, in either direction. "Action required", "Urgent"
  and "Final notice" appear on marketing constantly, and a genuine obligation is
  often worded flatly. Read the body, not the header.
- Requests for the reader's opinion. Satisfaction surveys, programme evaluations,
  feedback forms, review requests, research panels, "how did we do". Someone would
  like the reader's time; nobody is owed anything, and nothing anywhere changes if it
  never happens. This holds when a school, a camp or a doctor is asking — a real
  sender does not make a request an obligation.
- Account housekeeping. Verifying or confirming an email address, adding a phone
  number, setting a password, completing a profile, or reviewing routine sign-in
  activity. A message that tells the reader no action is needed if it was them is a
  notification, whatever the subject line calls itself. These sit in an account
  indefinitely at no cost. Three things that look
  like housekeeping and are NOT: a real security incident such as a breach or a
  locked account, a payment that has already failed, and a card about to expire on a
  service the reader pays for. Those have consequences and do belong.
- Notices with nothing to decide. A statement made available, an account summary, a
  case or application status update, a programme announcing that it has begun. The
  reader can sign in and look; looking changes nothing. A statement DOES belong when
  money is owed by a date, or when it names a specific thing the reader has to change
  — an escrow analysis saying the standing transfer must be updated is an obligation,
  the same statement with nothing to adjust is not.
- Optional participation. Calls for proposals, award nominations, council or committee
  applications, speaker sign-ups, invitations to send in questions, member perks and
  discount codes. Nothing anywhere changes if the reader never does these. Applying
  for something the reader actually needs — a place, a waitlist, a school bus — is not
  optional participation and does belong.
- Updated terms, policies and consent settings where a default carries over if the
  reader does nothing. Privacy policy revisions, consent preference updates, new terms
  of service. Accepting the default is a normal outcome, not a failure. A change to
  what the reader PAYS is a different thing and belongs.
- Newsletters and round-ups. A club or company digest with many unrelated sections —
  classes opening, courts closing, a member discount, an event next month, a billing
  reminder that applies to everybody — is ONE ambient item, not a list of obligations.
  Read it as a whole and return nothing. The rule below about a single email carrying
  several obligations is the opposite case: it is for mail where every part concerns
  this reader, like a welcome pack for their own enrolment. If a digest does contain
  something addressed to this reader personally — their booking, their balance, their
  child's place — extract that one thing and nothing else from it.
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
- Anything a school, camp, employer, doctor, government body, bank or brokerage needs
  back: a form, a waiver, a consent, a document, a preference, an appointment to
  book, a statement with money owed, a declaration that changes what the reader is
  charged. These are obligations even when nothing visibly goes wrong if they are
  skipped, because a real person is expecting them back. The one exception is a
  request for feedback, covered above — a waiver a child cannot attend camp without
  is an obligation; the same camp asking how the session went is not.
- Every appointment, class, camp session, lesson, flight and meeting, including ones
  that arrive as calendar invitations.
- A credit, voucher, session or balance the reader has already paid for that will
  expire unused. They own it, and it is about to become nothing. This is narrow and
  means paid-for: a percentage-off code or a member discount was never theirs and
  stays out.
- Anything the reader personally asked for that has not arrived.

Every exclusion above describes mail that asks nothing of the reader. None of them
applies to court "theirs": if the reader asked a person or an organisation for
something and no answer has come back, that is a waiting_on no matter what else is
on this list.

The exclusions above are a list of specific shapes, not an instruction to be sparing.
Measured: each one alone is harmless, but together they start suppressing genuine
obligations that sit near the line — a real waiting_on was lost this way. If a thread
does ask something of the reader, or the reader is genuinely owed an answer, extract
it. Only the shapes named above are excluded.

Rules:
- Return an empty list when the thread creates no obligation. Most mail creates none.
- NEVER invent a date. Put a value in anchorDate only when a date literally appears in
  the text, and copy the exact source words into anchorQuote. If the text states no
  date, set anchorDate to "" and anchorIsExplicit to false. Do not infer a date from
  urgency.
- Titles are short and imperative, written from the reader's point of view.
- For a recurring charge — a subscription, membership, plan or domain — also fill
  service, amount, currency and cadence. These are a structured copy of what you
  would put in detail anyway: service is the bare name ("Lightbox", not "Decide on
  Lightbox subscription"), amount is digits only, cadence is how often it recurs.
  Leave service, amount and currency empty and set cadence to "none" for anything
  that is not a recurring charge. Never infer a
  price that is not stated — an empty amount is correct and useful, because the
  renewal date still matters.
- One obligation per distinct action. Do not restate the same action twice.
- A single email often carries several separate obligations. A welcome pack can name
  a fee to pay, a form that reduces that fee, a second form needed only in some
  circumstances, and a start date — that is four, not one. Read to the end and return
  every one. Finding something excluded in one paragraph is never a reason to stop
  reading the rest: exclusions remove a part, never the whole message.`;

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
<thread>From: The Meridian <accounts@noreply.themeridian.com>
Subject: Your trial ends soon. Here's how to keep reading.
Keep reading. Keep thinking. Keep growing. We hope you have been enjoying your trial,
which will end on 08/27/2026. There is still time to explore everything The Meridian
has to offer, including unlimited access to every Meridian story, the app, narrated
articles, daily games and a 169-year archive.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"window","anchorDate":"2026-08-27","anchorIsExplicit":true,"anchorQuote":"end on 08/27/2026","title":"Decide on The Meridian before the trial converts","detail":"Trial ends 27 August; no price stated in the email","confidence":0.8,"service":"The Meridian","amount":"","currency":"","cadence":"yearly"}]}</output>
</example>
<example>
<thread>From: Larkspur Elementary <office@larkspur.org>
Subject: Fall permission packet
Please sign and return the field trip form by Friday August 29.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"deadline","anchorDate":"2026-08-29","anchorIsExplicit":true,"anchorQuote":"Friday August 29","title":"Sign and return the field trip form","detail":"Larkspur Elementary fall permission packet","confidence":0.95,"service":"","amount":"","currency":"","cadence":"none"}]}</output>
</example>
<example>
<thread>From: Dana Whitlock <dana@northgate.co>
Subject: Re: pricing tiers
Circling back on this. We need to decide before the board meets.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"deadline","anchorDate":"","anchorIsExplicit":false,"anchorQuote":"","title":"Reply to Dana about the pricing tiers","detail":"Second ask; no date stated","confidence":0.8,"service":"","amount":"","currency":"","cadence":"none"}]}</output>
</example>
<example>
<thread>From: Harbour Swim Academy <bookings@harbourswim.com>
Subject: Lesson confirmed
Maya's swim lesson is confirmed for Thursday 27 August at 4:30pm with Coach Mel.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"event","anchorDate":"2026-08-27","anchorIsExplicit":true,"anchorQuote":"Thursday 27 August","title":"Maya's swim lesson at Harbour Swim Academy","detail":"4:30pm with Coach Mel","confidence":0.95,"service":"","amount":"","currency":"","cadence":"none"}]}</output>
</example>
<example>
<thread>From: Wildwood Camps <camps@wildwoodcamps.com>
Subject: How did we do? Camp evaluation for Maya
Please take a few minutes to complete the evaluation for Maya's session. Your
feedback shapes next summer's programme.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"deadline","anchorDate":"","anchorIsExplicit":false,"anchorQuote":"","title":"Complete the Wildwood camp evaluation for Maya","detail":"No date stated","confidence":0.8,"service":"","amount":"","currency":"","cadence":"none"}]}</output>
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
<output>{"obligations":[{"court":"theirs","temporalClass":"waiting_on","anchorDate":"2026-08-14","anchorIsExplicit":true,"anchorQuote":"2026-08-14","title":"Hear back on the Wildwood waitlist for Maya","detail":"Ticket #482100; no answer since 14 August","confidence":0.85,"service":"","amount":"","currency":"","cadence":"none"}]}</output>
</example>
<example>
<thread>From: Riverside Club <billing@riversideclub.com>
Subject: Your August statement
Your August statement reflects a balance of $312.50, due 31 August 2026.</thread>
<output>{"obligations":[{"court":"yours","temporalClass":"deadline","anchorDate":"2026-08-31","anchorIsExplicit":true,"anchorQuote":"due 31 August 2026","title":"Pay the Riverside Club statement balance","detail":"$312.50 due 31 August","confidence":0.95,"service":"","amount":"","currency":"","cadence":"none"}]}</output>
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
  /** Dropped because the source said they were already taken care of. */
  settled: number;
  /** How many carried a service and cadence — the subscriptions lens. */
  recurring: number;
  tokensIn: number; tokensOut: number; failures: number; error?: string;
};
let progress: ExtractProgress = { state: 'idle', done: 0, total: 0, obligations: 0, capped: 0, settled: 0, recurring: 0, tokensIn: 0, tokensOut: 0, failures: 0 };
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

  progress = { state: 'running', done: 0, total: pending.length, obligations: 0, capped: 0, settled: 0, recurring: 0, tokensIn: 0, tokensOut: 0, failures: 0 };
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
          // Verified against the source, like the anchor is. The model is told
          // that an enrolled auto-pay is not an obligation and still says it is
          // about a quarter of the time on real mail.
          if (alreadySettled({ title: o.title, detail: o.detail, source: text })) {
            progress.settled++;
            continue;
          }
          const anchor = validateAnchor({ anchorDate: o.anchorDate, anchorIsExplicit: o.anchorIsExplicit, anchorQuote: o.anchorQuote });
          const recurring = resolveRecurring({
            service: o.service, amount: o.amount, currency: o.currency, cadence: o.cadence,
            title: o.title, detail: o.detail,
          });
          if (recurring.service) progress.recurring++;
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
            service: recurring.service,
            amountCents: recurring.amountCents,
            currency: recurring.currency,
            cadence: recurring.cadence,
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
