import { z } from 'zod';

/**
 * The vocabulary of the whole app. Both the server and the web client import
 * from here, so a change to an obligation's shape is a compile error on both
 * sides rather than a runtime surprise.
 */

/** How an item's relevance moves over time. See the temporal model in the design. */
export const TemporalClass = z.enum([
  'deadline',   // climbs toward its date, stays up once passed
  'event',      // matters in a window around the date, dead after
  'window',     // steady while open, then a cliff
  'waiting_on', // the inverse case: silence makes it louder
  'reference',  // never decays, never surfaces — findable, not shown
  'ambient',    // a half-life, then gone
]);
export type TemporalClass = z.infer<typeof TemporalClass>;

/** Who owes the next move. */
export const Court = z.enum(['yours', 'theirs']);
export type Court = z.infer<typeof Court>;

/**
 * Exactly what the extractor model is required to return, per obligation.
 *
 * `anchorQuote` exists because a model will otherwise invent a date and mark it
 * explicit. It must contain the literal words the date came from, so the server
 * can verify the claim in code instead of trusting it.
 */
export const ExtractedObligation = z.object({
  court: Court,
  temporalClass: TemporalClass,
  anchorDate: z.string(),        // 'YYYY-MM-DD', or '' when the text states none
  anchorIsExplicit: z.boolean(),
  anchorQuote: z.string(),       // literal source words, or ''
  title: z.string(),
  detail: z.string(),
  confidence: z.number().min(0).max(1),
  /** Set only for recurring commitments. The subscriptions lens is defined by
   *  these being populated rather than by matching words in the title. */
  service: z.string().default(''),
  amount: z.string().default(''),      // as written, e.g. "110.29"
  currency: z.string().default(''),    // ISO-ish, e.g. "USD"
  cadence: z.string().default(''),     // monthly | weekly | yearly | quarterly | one_off
});
export type ExtractedObligation = z.infer<typeof ExtractedObligation>;

export const ExtractionResult = z.object({
  obligations: z.array(ExtractedObligation),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

/** Which band of the Horizon an obligation falls into. */
export const Bucket = z.enum(['today', 'this_week', 'later', 'receded']);
export type Bucket = z.infer<typeof Bucket>;

/** An obligation as the UI receives it — stored fields plus computed ranking. */
export const Obligation = z.object({
  id: z.number(),
  accountEmail: z.string(),
  threadId: z.string(),
  sourceMessageId: z.string(),
  court: Court,
  temporalClass: TemporalClass,
  anchorDate: z.string().nullable(),
  anchorIsExplicit: z.boolean(),
  anchorQuote: z.string(),
  /** False when anchorQuote contained no parseable date; anchorDate is then null. */
  anchorValidated: z.boolean(),
  title: z.string(),
  detail: z.string(),
  confidence: z.number(),
  completedAt: z.string().nullable(),
  /** Set when the reader said this will not happen — cleared, but not done. */
  dismissedAt: z.string().nullable(),
  /** Non-empty when this is a recurring charge, which means the subscriptions
   *  lens also holds it — Horizon uses this to keep distant renewals off the
   *  front page without needing to guess from the title. */
  service: z.string().default(''),
  // computed server-side by pipeline/rank.ts
  score: z.number(),
  bucket: Bucket,
  /** Forward-facing, never accusatory: 'Do today', 'By Friday', 'Chase Monday'. */
  whenLabel: z.string(),
  /** How many extracted obligations this row stands for after render-time
   *  dedup. 1 means it came from a single thread. */
  mergedCount: z.number().default(1),
});
export type Obligation = z.infer<typeof Obligation>;

/** A row in the mail table: sender, subject, date — sorted by relevance. */
export const MailRow = z.object({
  id: z.string(),
  accountEmail: z.string(),
  threadId: z.string(),
  fromName: z.string(),
  fromEmail: z.string(),
  subject: z.string(),
  receivedAt: z.string(),
  isSent: z.boolean(),
  score: z.number(),
});
export type MailRow = z.infer<typeof MailRow>;

export const WeekDay = z.object({
  date: z.string(),
  label: z.string(),
  isToday: z.boolean(),
  items: z.array(z.object({ id: z.number(), title: z.string() })),
});
export type WeekDay = z.infer<typeof WeekDay>;

export const Edition = z.object({
  composedAt: z.string(),
  headline: z.string(),
  notes: z.array(z.string()),
  /** True when this brief predates the current open set and a new one is being
   *  written in the background. The page shows it rather than nothing. */
  stale: z.boolean().default(false),
});
export type Edition = z.infer<typeof Edition>;

export const AccountStatus = z.object({
  email: z.string(),
  connected: z.boolean(),
  backfilledAt: z.string().nullable(),
  messageCount: z.number(),
  /** True when the refresh token has expired and consent must be granted again. */
  needsReconnect: z.boolean(),
});
export type AccountStatus = z.infer<typeof AccountStatus>;

/**
 * What the reader has decided about a recurring charge.
 *
 * `kept` and `cancelled` are not two flavours of the same act. Kept means the
 * money continues, so the row stays in the monthly total at full price and only
 * stops asking to be decided. Cancelled means the money stops, so it leaves the
 * total. One button for both would understate what you spend.
 */
export const SubscriptionState = z.enum(['active', 'kept', 'cancelled']);
export type SubscriptionState = z.infer<typeof SubscriptionState>;

/** One recurring commitment, as the subscriptions lens sees it. */
export const Subscription = z.object({
  /** Stable key for the service, so several emails collapse to one row. */
  key: z.string(),
  name: z.string(),
  accountEmail: z.string(),
  threadId: z.string(),
  /** Next renewal, or null when nothing has stated one. */
  nextDate: z.string().nullable(),
  daysUntil: z.number().nullable(),
  whenLabel: z.string(),
  /** True when nextDate was rolled forward from a past date by the cadence
   *  rather than stated in an email. The row is still real; the date is a
   *  projection, and the view must not present it as quoted fact. */
  estimated: z.boolean(),
  amountCents: z.number().nullable(),
  currency: z.string(),
  cadence: z.string(),
  /** What one month of this costs, so cadences can be added together. */
  monthlyCents: z.number(),
  /** Where cancelling actually happens, when it can be known. */
  manageUrl: z.string().nullable(),
  manageLabel: z.string().nullable(),
  paused: z.boolean(),
  state: SubscriptionState.default('active'),
  /** An email that appears to confirm this was cancelled. A PROPOSAL only —
   *  Weft cannot see your account, and a wrong guess would drop a live charge
   *  out of the total silently. The quote is what makes confirming it a
   *  decision rather than an act of faith. */
  proposedCancelled: z
    .object({ quote: z.string(), threadId: z.string(), accountEmail: z.string(), receivedAt: z.string() })
    .nullable()
    .default(null),
  /** A renewal notice that arrived AFTER you marked this cancelled. Weft cannot
   *  read your bank, but it can notice the contradiction. */
  chargedAfterCancel: z
    .object({ title: z.string(), threadId: z.string(), accountEmail: z.string(), receivedAt: z.string() })
    .nullable()
    .default(null),
  /** When the reader decided, so a decision can be shown as recent. */
  decidedAt: z.string().nullable().default(null),
  /** How many obligations collapsed into this row. */
  mergedCount: z.number(),
});
export type Subscription = z.infer<typeof Subscription>;

export const SubscriptionsLens = z.object({
  /** Sum of monthlyCents across everything active with a known price. */
  monthlyTotalCents: z.number(),
  currency: z.string(),
  /** Everything still costing money: untouched plus explicitly kept. */
  activeCount: z.number(),
  /** Active but with no price stated — excluded from the total, not hidden. */
  unpricedCount: z.number(),
  pausedCount: z.number(),
  /** How many of the active rows the reader has explicitly decided to keep. */
  keptCount: z.number(),
  /** Marked cancelled: out of the total, collapsed rather than deleted, so the
   *  decision stays reversible and a later charge can be spotted as a
   *  contradiction. */
  cancelled: z.array(Subscription),
  /** The largest single monthly cost, which is usually the whole story. */
  largest: Subscription.nullable(),
  subscriptions: z.array(Subscription),
});
export type SubscriptionsLens = z.infer<typeof SubscriptionsLens>;

/** Everything the Horizon page needs, in one response. */
export const HorizonPayload = z.object({
  date: z.string(),
  accounts: z.array(AccountStatus),
  edition: Edition.nullable(),
  openLoops: z.object({
    yours: z.array(Obligation),
    theirs: z.array(Obligation),
    completed: z.array(Obligation),
    dismissed: z.array(Obligation),
  }),
  week: z.array(WeekDay),
  /** Commitments beyond the seven-day window, or without a usable date. They
   *  left the task list, so the calendar has to hold all of them or they vanish. */
  later: z.array(z.object({ id: z.number(), title: z.string(), whenLabel: z.string() })),
  mail: z.array(MailRow),
  stats: z.object({
    messagesTotal: z.number(),
    messagesKept: z.number(),
    messagesSkipped: z.number(),
    threadsExtracted: z.number(),
  }),
});
export type HorizonPayload = z.infer<typeof HorizonPayload>;
export * from './voice-lint.js';
