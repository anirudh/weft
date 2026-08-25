import { daysUntil } from './rank.js';

/**
 * Money as a number, and a service as a name.
 *
 * The model is asked for these directly, but it leaves them blank often enough
 * that the lens cannot depend on it — so this fills the gaps from the prose it
 * always writes anyway ("Renews on September 3, 2026 for $2.99"). Same division
 * of labour as anchor.ts: the model proposes, code checks and completes.
 *
 * A subscription is an obligation that has a service AND a cadence. That is the
 * whole predicate — no keyword matching. Measured on real mail, matching words
 * like "renew" or "trial" pulled in a home-improvement firm called Renewal by
 * Andersen and three of a child's trial coding classes.
 */

export type Cadence = 'monthly' | 'weekly' | 'yearly' | 'quarterly' | 'one_off';

const CADENCE_WORDS: [RegExp, Cadence][] = [
  [/\b(per|a|each|every)\s*(month|mo)\b|\bmonthly\b|\/\s*(month|mo)\b/i, 'monthly'],
  [/\b(per|a|each|every)\s*week\b|\bweekly\b|\/\s*(week|wk)\b/i, 'weekly'],
  [/\b(per|a|each|every)\s*(year|annum)\b|\b(yearly|annual|annually)\b|\/\s*(year|yr)\b/i, 'yearly'],
  [/\bquarterly\b|\bevery\s*(three|3)\s*months\b/i, 'quarterly'],
];

/** "$89.00" / "$1,234.50" / "USD 16.53" / "16.53 USD" */
const MONEY = /(?:(\$|£|€|USD|GBP|EUR|INR|₹)\s?)([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s?(USD|GBP|EUR|INR)\b/i;

const SYMBOL_TO_CODE: Record<string, string> = {
  $: 'USD', '£': 'GBP', '€': 'EUR', '₹': 'INR',
  usd: 'USD', gbp: 'GBP', eur: 'EUR', inr: 'INR',
};

export function parseMoney(text: string): { cents: number; currency: string } | null {
  const m = MONEY.exec(text);
  if (!m) return null;
  const raw = (m[2] ?? m[3] ?? '').replace(/,/g, '');
  const unit = (m[1] ?? m[4] ?? '').toLowerCase();
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { cents: Math.round(value * 100), currency: SYMBOL_TO_CODE[unit] ?? 'USD' };
}

export function parseCadence(text: string): Cadence | null {
  for (const [re, cadence] of CADENCE_WORDS) if (re.test(text)) return cadence;
  return null;
}

/** What one month of this costs, so different cadences can be added together. */
export function monthlyCents(cents: number, cadence: Cadence): number {
  switch (cadence) {
    case 'monthly': return cents;
    case 'weekly': return Math.round((cents * 52) / 12);
    case 'yearly': return Math.round(cents / 12);
    case 'quarterly': return Math.round(cents / 3);
    case 'one_off': return 0; // real money, but not a running cost
  }
}

/**
 * Normalises a service name so the same thing arriving through several emails
 * collapses to one row.
 *
 * The model is asked for a bare service name, and mostly gives one — but it
 * sometimes returns the whole imperative instead ("Decide on Lightbox
 * subscription before auto-renewal"). Stripping the verbs and the product
 * furniture makes grouping robust to that, rather than depending on the model
 * being consistent about granularity.
 */
export function serviceKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\s*(decide on|manage|cancel|review|renew|update|keep|choose)\b/, ' ')
    .replace(/\b(before|until|ahead of|prior to)\b.*$/, ' ')
    .replace(/\b(subscription|membership|premium|plan|renewal|auto-?renew\w*|trial|account)\b/g, ' ')
    .replace(/[^a-z0-9+. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type RecurringInput = {
  service: string; amount: string; currency: string; cadence: string;
  title: string; detail: string;
};
export type Recurring = {
  service: string; amountCents: number | null; currency: string; cadence: string;
};

/** Model output first, prose second, and nothing invented. */
export function resolveRecurring(o: RecurringInput): Recurring {
  const prose = `${o.title} ${o.detail}`;

  const money = o.amount.trim()
    ? parseMoney(`${o.currency || '$'}${o.amount}`) ?? parseMoney(o.amount)
    : parseMoney(prose);

  // "none" is the sentinel the model returns for anything not recurring; Vertex
  // will not accept an empty string inside an enum.
  const cadence = (['monthly', 'weekly', 'yearly', 'quarterly', 'one_off'] as string[]).includes(o.cadence)
    ? (o.cadence as Cadence)
    : parseCadence(prose);

  // A service with no cadence is not recurring, and a cadence with no service
  // has nothing to group under. Either way it is not for this lens.
  const service = o.service.trim();
  if (!service || !cadence) return { service: '', amountCents: null, currency: '', cadence: '' };

  return {
    service,
    amountCents: money?.cents ?? null,
    currency: money?.currency ?? '',
    cadence,
  };
}

/**
 * A recurring charge whose last known date has passed still has a next one —
 * that is what "recurring" means. Rolls the date forward by whole cadence steps
 * until it lands in the future.
 *
 * Without this, the lens sorted a subscription that renewed last month to the
 * very top and labelled it "Renewed", which is both the wrong order and the
 * least useful thing it could say. The projection is marked `estimated` so the
 * view can hedge it: Weft is read-only and cannot know you did not cancel.
 */
export function rollForward(
  iso: string,
  cadence: Cadence,
  now: number,
): { date: string; estimated: boolean } {
  const step: Record<string, (d: Date) => void> = {
    weekly: (d) => d.setDate(d.getDate() + 7),
    monthly: (d) => d.setMonth(d.getMonth() + 1),
    quarterly: (d) => d.setMonth(d.getMonth() + 3),
    yearly: (d) => d.setFullYear(d.getFullYear() + 1),
  };
  const advance = step[cadence];
  // one_off and none do not recur, so a past date stays past — correctly.
  if (!advance) return { date: iso, estimated: false };

  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const today = new Date(now).setHours(0, 0, 0, 0);
  const cur = new Date(y, m - 1, d);
  if (cur.getTime() >= today) return { date: iso, estimated: false };

  // Bounded: a weekly cadence five years stale is 260 steps, and anything
  // needing more than that is bad data rather than a subscription.
  for (let i = 0; i < 300 && cur.getTime() < today; i++) advance(cur);

  const iso2 = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
  return { date: iso2, estimated: true };
}

/**
 * Is the next charge for this service far enough off that only the ledger needs
 * to carry it?
 *
 * Horizon and the lens must not each work out "next renewal" their own way. The
 * lens rolls a past date forward; if the front page measured from the raw
 * anchor instead, a yearly renewal that went three days ago would read as
 * imminent and be offered as today's decision, while the lens said eleven
 * months. One rule, used by both.
 */
export function renewalIsDistant(
  anchorDate: string | null,
  /** Straight off the DB text column, so '' and 'none' are ordinary inputs.
   *  Anything that is not a recurring cadence simply does not roll forward. */
  cadence: string,
  now: number,
  soonDays: number,
): boolean {
  // No date at all: nothing to be imminent about.
  if (anchorDate === null) return true;
  const { date } = rollForward(anchorDate, cadence as Cadence, now);
  return daysUntil(date, now) > soonDays;
}
