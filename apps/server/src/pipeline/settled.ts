/**
 * A second code-side verifier, in the same spirit as anchor.ts.
 *
 * There the model claims a date and code checks the quote really contains one.
 * Here the model claims the reader must pay something, and code checks whether
 * the source already said it is paid automatically. Both verify a claim against
 * the text it came from, because a confident wrong answer is worse than none.
 *
 * The prompt already covers this ("a payment on auto-pay that is already
 * enrolled" is one of the four ways to be no obligation) and the model still
 * gets it wrong about a quarter of the time on real mail: a Chase statement
 * reading "Auto-pay enabled — you're already enrolled in automatic payments"
 * produced "Pay the Chase credit card statement balance" in production, with
 * "(Auto-pay enabled)" in its own detail. It had read the line and extracted
 * anyway.
 *
 * Deliberately narrow. This only silences an obligation when the source is
 * explicit that money moves without the reader, and never when the same source
 * shows any sign that it did not.
 */

/** The obligation has to be about paying something for this to apply at all. */
const ABOUT_PAYING = /\b(pay|paying|payment|balance|bill|statement|invoice|amount due|minimum due)\b/i;

/** The source says money moves without the reader lifting a finger. */
const AUTOPAY_ON = new RegExp(
  [
    "you'?re already enrolled in automatic payments",
    'you are already enrolled in automatic payments',
    'auto-?\\s?pay (is )?(enabled|on|active|set up)',
    'enrolled in auto-?\\s?pay',
    'automatic payments? (are|is) (on|enabled|active|set up)',
    "we'?ll pay the amount you scheduled",
    'will be (automatically )?(debited|deducted|charged) (from|to) your',
    'no action is needed if you are enrolled',
  ].join('|'),
  'i',
);

/**
 * Anything suggesting the automatic path did not work, or that something is
 * owed on top of it. Any one of these and the obligation stands.
 */
const SOMETHING_WRONG = new RegExp(
  [
    'payment (has )?(failed|was declined|declined|was returned|unsuccessful)',
    'could not (be )?process',
    'unable to process',
    'update your payment method',
    'card (has )?expired',
    'expiring soon',
    'past due',
    'overdue',
    'insufficient funds',
    'action (is )?required',
    'declined',
  ].join('|'),
  'i',
);

/**
 * A recurring charge the reader could stop is a decision, not a settled bill.
 * Both read as "money leaves automatically", but only one of them can be
 * prevented: you can cancel a subscription, you cannot cancel a card balance
 * you have already spent. Getting this wrong would silence exactly the
 * renewals this product exists to surface.
 */
const CANCELLABLE = /\b(subscription|membership|renews?|renewal|auto-?\s?renew\w*|trial|your plan)\b/i;

export type SettledInput = {
  title: string;
  detail: string;
  /** The thread text the obligation was extracted from. */
  source: string;
};

/**
 * True when this obligation should not be surfaced because the source says it
 * is already taken care of.
 */
export function alreadySettled({ title, detail, source }: SettledInput): boolean {
  if (!ABOUT_PAYING.test(`${title} ${detail}`)) return false;
  if (!AUTOPAY_ON.test(source)) return false;
  if (SOMETHING_WRONG.test(source)) return false;
  if (CANCELLABLE.test(`${title} ${detail} ${source}`)) return false;
  return true;
}
