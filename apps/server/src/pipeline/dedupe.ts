import type { Obligation } from '@weft/shared';

/**
 * The same obligation reaches us through several threads. A school sends the
 * calendar, then the newsletter, then the reminder; an airline sends the
 * confirmation and then the check-in notice; and both mailboxes are subscribed
 * to the same class list. Each thread is extracted independently — by design,
 * since extraction has no cross-thread context — so Horizon showed "First Day
 * of Kindergarten" twice and one flight three times.
 *
 * Dedup is deterministic and happens at render, not at extraction: the rows
 * stay intact in the database, so changing this rule never costs another token.
 *
 * Deliberately conservative. Merging two distinct obligations hides work the
 * user owes; failing to merge only repeats a line. So the bar is a shared
 * anchor date AND a high token overlap, and near-misses are left alone.
 */

// Verbs and articles carry no identity: "Attend Kindergarten First Day" and
// "First Day of Kindergarten" are one event.
const NOISE = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'on', 'at', 'in', 'and', 'or', 'your', 'you',
  'attend', 'take', 'join', 'go', 'do', 'complete', 'submit', 'send', 'make', 'get',
  'is', 'are', 'be', 'will', 'from', 'with', 'by', 'this', 'that', 'it',
]);

/** Crude suffix stripping — enough to tie "flight"/"flights", "class"/"classes". */
const stem = (w: string) => w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : ''));

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !NOISE.has(w))
      .map(stem),
  );
}

export function similarity(a: string, b: string): number {
  const [x, y] = [titleTokens(a), titleTokens(b)];
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / (x.size + y.size - shared); // Jaccard
}

// 0.4, measured rather than guessed: across the live obligation set every
// same-day pair scoring 0.40-0.50 was a genuine duplicate ("Principal and Pops
// Playdate and Open House" vs "Principal Pops and Playdate at Oakfield"),
// and the 0.45-0.50 band was empty, so there is no cliff being straddled here.
const THRESHOLD = 0.4;

/**
 * Groups obligations that share an anchor date and describe the same thing.
 * Undated obligations are never merged — without a date there is not enough
 * signal to be sure, and a wrongly hidden task is the expensive mistake.
 */
export function dedupe(obligations: Obligation[]): Obligation[] {
  const out: Obligation[] = [];

  for (const o of obligations.slice().sort((a, b) => b.score - a.score || b.confidence - a.confidence)) {
    const twin = o.anchorDate
      ? out.find(
          (k) =>
            k.anchorDate === o.anchorDate &&
            k.court === o.court &&
            // Same class too. Confirming a class and attending it fall on the
            // same day and share most of their words, but they are two separate
            // things the reader has to do — merging them loses one.
            k.temporalClass === o.temporalClass &&
            similarity(k.title, o.title) >= THRESHOLD,
        )
      : undefined;

    if (twin) {
      twin.mergedCount += 1;
      // Keep the longer detail: the fuller email usually explains it better.
      if ((o.detail?.length ?? 0) > (twin.detail?.length ?? 0)) twin.detail = o.detail;
    } else {
      out.push({ ...o, mergedCount: 1 });
    }
  }

  return out;
}
