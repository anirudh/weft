/**
 * A third code-side verifier, after anchor.ts and settled.ts.
 *
 * The question here is narrow: does this email SAY the subscription is
 * cancelled? Not "does it mention cancelling" — every receipt does. The Apple
 * receipt for a $7.99/week app ends "To learn more or cancel, review your
 * subscription", and a detector that took that as a cancellation would remove a
 * live charge from the monthly total. That is the one thing this must never do.
 *
 * So the output is a PROPOSAL, never a decision. The failure modes are not
 * symmetric: a miss costs one click, while a false positive quietly drops money
 * out of the total and you find out on your card statement. Weft has read-only
 * access and cannot check your account either way, so a human confirms.
 */

/**
 * Committed statements that the thing is off. Deliberately specific: past
 * tense, or a definite future. Nothing here matches an instruction.
 */
const CONFIRMED = [
  /(your|the)[^.!?\n]{0,40}\b(subscription|membership|plan|trial|auto-?renew\w*)\b[^.!?\n]{0,40}\b(has been|have been|was|were|is now|are now)\s+(cancell?ed|canceled|turned off|disabled|deactivated|ended)/i,
  /\b(cancell?ation|cancelation)\b[^.!?\n]{0,30}\b(confirmed|complete|completed|successful|processed|received)/i,
  /\bwe(?:'ve| have| has)?\s+(?:now\s+)?(?:cancell?ed|canceled)\b/i,
  /\byou(?:'ve| have)\s+(?:successfully\s+)?(?:cancell?ed|canceled)\b/i,
  // Renewal only. "will not be charged" was here and matched ten marketing
  // emails against two real cancellations: "you will not be charged during the
  // free trial", "not charged any fees", "not charged until launch" are all
  // reassurance about STARTING something. Only wording that implies a charge
  // was already happening survives, which is the two patterns below.
  /\b(will not|won'?t|shall not)\s+(?:automatically\s+)?(?:be\s+)?(renew|auto-?renew|be renewed)\b/i,
  /\b(will not|won'?t)\s+be\s+(?:charged|billed)\s+(?:any\s?more|again)\b/i,
  /\bauto-?renew(?:al|ing)?\b[^.!?\n]{0,30}\b(?:is|has been|was)\s+(?:now\s+)?(?:off|turned off|disabled|switched off)/i,
  /\b(your|the)[^.!?\n]{0,30}\b(subscription|membership|plan|access)\b[^.!?\n]{0,30}\b(will end|ends|expires|will expire)\s+on\b/i,
  /\byou will no longer be (?:charged|billed)\b/i,
  /\bno further (?:charges|payments|billing)\b/i,
];

/**
 * Markers that turn the same words into advice rather than a fact. Checked
 * within the matched SENTENCE, because that is the unit where the difference
 * lives: "Cancel any time in Settings" and "Your subscription has been
 * cancelled" routinely sit two lines apart in the same email.
 */
const NOT_A_FACT = new RegExp(
  [
    '\\bif you\\b',
    '\\bto cancel\\b',
    '\\bhow to\\b',
    '\\byou can\\b',
    '\\byou may\\b',
    '\\byou must\\b',
    '\\bwant to\\b',
    '\\bwish to\\b',
    '\\bwould like to\\b',
    '\\bin order to\\b',
    '\\blearn (?:more|how)\\b',
    '\\bplease\\b',
    '\\bcancel any ?time\\b',
    '\\bat least a day before\\b',
    '\\bunless\\b',
  ].join('|'),
  'i',
);

/** The sentence a match sits in. Sentences are the unit NOT_A_FACT is judged on. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf('.', index), text.lastIndexOf('\n', index),
    text.lastIndexOf('!', index), text.lastIndexOf('?', index));
  const rest = text.slice(index);
  const endRel = rest.search(/[.!?\n]/);
  const end = endRel === -1 ? text.length : index + endRel + 1;
  return text.slice(start === 0 ? 0 : start + 1, end).trim();
}

export type CancellationEvidence = {
  /** The sentence that says so, shown to the reader as the reason to confirm. */
  quote: string;
};

/**
 * Evidence that this text confirms a cancellation, or null.
 *
 * Returns the sentence rather than a bare boolean on purpose: a proposal the
 * reader cannot check is not much better than a guess, and the quote is what
 * makes one click a decision rather than an act of faith.
 */
export function detectCancellation(text: string): CancellationEvidence | null {
  if (!text) return null;
  for (const re of CONFIRMED) {
    const m = re.exec(text);
    if (!m) continue;
    const sentence = sentenceAround(text, m.index);
    if (NOT_A_FACT.test(sentence)) continue;
    // Trimmed: a "sentence" out of a marketing footer can run for a paragraph,
    // and the row has one line to show it in.
    return { quote: sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence };
  }
  return null;
}

/**
 * Does this email actually name the service?
 *
 * The second gate, and the one that stopped every survivor of the first on real
 * mail: a genuine cancellation for something absent from the ledger has nothing
 * to attach to. Matching on the display name or the normalised key both work,
 * because the model writes "Lightbox: Photo & Video Editor" and the key is
 * "lightbox photo video editor".
 */
export function namesService(text: string, service: { name: string; key: string }): boolean {
  const hay = text.toLowerCase();
  const name = service.name.trim().toLowerCase();
  // A one- or two-letter name would match half the mailbox. Nothing real is
  // that short, and a miss here only costs the proposal.
  if (name.length >= 3 && hay.includes(name)) return true;
  return service.key.length >= 3 && hay.includes(service.key);
}
