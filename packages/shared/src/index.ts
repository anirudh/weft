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
  mail: z.array(MailRow),
  stats: z.object({
    messagesTotal: z.number(),
    messagesKept: z.number(),
    messagesSkipped: z.number(),
    threadsExtracted: z.number(),
  }),
});
export type HorizonPayload = z.infer<typeof HorizonPayload>;
