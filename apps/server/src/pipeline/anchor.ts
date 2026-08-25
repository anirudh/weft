/**
 * Guards against the failure we measured: a model returning a confident
 * anchor_date with anchor_is_explicit=true, citing a quote that contains no
 * date at all ("before the board meets"). An invented deadline that looks
 * verified is worse than no deadline, because the whole Horizon ordering is a
 * function of anchors.
 *
 * Deliberately strict. A false negative only costs the item its date — it still
 * appears, sorted in the undated band. A false positive puts a fabricated
 * deadline at the top of someone's morning.
 */

// "may" and "march" are excluded here on purpose: both are ordinary English
// words far more often than month names ("you may need to reply"). They are
// matched below, but only when adjacent to a digit.
const FULL_MONTHS = 'january|february|april|june|july|august|september|october|november|december';
const FULL_DAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const ABBR_MONTHS = 'jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const ABBR_DAYS = 'mon|tues?|weds?|thur?s?|fri|sat|sun';

const PATTERNS: RegExp[] = [
  new RegExp(`\\b(${FULL_MONTHS})\\b`, 'i'),
  new RegExp(`\\b(${FULL_DAYS})\\b`, 'i'),
  // Abbreviations only next to a digit — "sat" and "mar" are ordinary words,
  // and "may" is a modal verb far more often than a month.
  new RegExp(`\\b(${ABBR_MONTHS})\\b[-/.\\s]*\\d`, 'i'),
  new RegExp(`\\d[-/.\\s]*\\b(${ABBR_MONTHS})\\b`, 'i'),
  new RegExp(`\\b(${ABBR_DAYS})\\b[-/.,\\s]*\\d`, 'i'),
  /\b(may|march)\s+\d/i,
  /\d\s*(may|march)\b/i,
  /\d\s*(st|nd|rd|th)\b/i,
  /\b\d{4}-\d{1,2}-\d{1,2}\b/,
  // Dashed and dotted day-first/month-first forms. Real mail uses these
  // constantly — "07-30-2026" from a registrar cost us a deadline in testing.
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/,
  /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,
  /\b(today|tomorrow|tonight)\b/i,
  /\b(this|next)\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bwithin\s+\d+\s+(day|week|hour)/i,
  /\bin\s+\d+\s+(day|week)s?\b/i,
];

/** True when the quote contains something that could actually denote a date. */
export function quoteContainsDate(quote: string): boolean {
  const q = quote.trim();
  if (!q) return false;
  return PATTERNS.some((re) => re.test(q));
}

export type AnchorInput = { anchorDate: string; anchorIsExplicit: boolean; anchorQuote: string };
export type AnchorOutput = { anchorDate: string | null; anchorIsExplicit: boolean; anchorQuote: string; anchorValidated: boolean };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function validateAnchor(input: AnchorInput): AnchorOutput {
  const date = input.anchorDate.trim();
  const quote = input.anchorQuote.trim();

  // No date claimed: nothing to verify, and nothing to get wrong.
  if (!date) return { anchorDate: null, anchorIsExplicit: false, anchorQuote: quote, anchorValidated: true };

  // A date that isn't a date. "unknown" showed up in real output from 3.5-flash-lite.
  if (!ISO.test(date)) return { anchorDate: null, anchorIsExplicit: false, anchorQuote: quote, anchorValidated: false };

  // The claim we actually check: the quote must contain a date expression.
  if (!quoteContainsDate(quote)) {
    return { anchorDate: null, anchorIsExplicit: false, anchorQuote: quote, anchorValidated: false };
  }

  return { anchorDate: date, anchorIsExplicit: input.anchorIsExplicit, anchorQuote: quote, anchorValidated: true };
}
