import type { Bucket, TemporalClass } from '@weft/shared';

/**
 * Relevance is a pure function of (class, anchor, now). No model call, so the
 * whole page reorders itself hour by hour for free — and every position is
 * explainable and testable.
 *
 * Wording is forward-facing by design: "Do today", never "2 days late". The
 * product tells you what to focus on, not that you have already failed.
 */

export type Rankable = {
  temporalClass: TemporalClass;
  anchorDate: string | null;
  /** ms — the most recent message in the thread. */
  lastMessageAt: number;
};

const DAY = 86_400_000;

/** ISO date at local midnight. `new Date('2026-08-21')` is UTC and lands on the
 *  20th for anyone west of Greenwich, which shifts every label by a day. */
const localMidnight = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).setHours(0, 0, 0, 0);
};

/** Whole calendar days from now until the anchor. Negative once it has passed. */
export function daysUntil(anchorDate: string, now: number): number {
  const today = new Date(now).setHours(0, 0, 0, 0);
  return Math.round((localMidnight(anchorDate) - today) / DAY);
}

const daysSince = (ms: number, now: number) =>
  Math.max(0, Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / DAY));

export function score(o: Rankable, now: number): number {
  const d = o.anchorDate ? daysUntil(o.anchorDate, now) : null;

  switch (o.temporalClass) {
    case 'reference':
      return 0; // findable, never surfaced

    case 'ambient': {
      const age = daysSince(o.lastMessageAt, now);
      return 0.3 * Math.pow(0.5, age / 3); // three-day half-life
    }

    case 'deadline':
      if (d === null) {
        // Undated does not mean timeless. Before this, an undated obligation
        // sat at 0.5 for ever — a camp waiver whose own detail said "Monday
        // August 3rd" was still mid-list three weeks later, because the model
        // had quoted "first day" and the anchor validator rightly rejected it.
        // With no date, the only evidence of life is the thread itself, so it
        // decays on that: still mid-band while the mail is fresh, gone by the
        // time nobody has mentioned it in a month.
        return 0.5 * Math.pow(0.5, daysSince(o.lastMessageAt, now) / 10);
      }
      if (d === 0 || d === -1) return 1;       // due, or slipped a day — still today's work
      if (d < -1) {
        // Grace, then rot — and faster than it used to. Weft has read-only
        // access, so it can never know whether you renewed the subscription;
        // it only knows nobody has mentioned it since. A deadline three days
        // past used to score 0.7 and tie with something genuinely due in a
        // week, which is backwards: the live one deserves the attention.
        if (d >= -3) return 0.45;
        if (d >= -7) return 0.25;
        return 0.05;                           // past a week: receded
      }
      if (d === 1) return 0.95;
      if (d <= 3) return 0.85;
      if (d <= 7) return 0.7;
      if (d <= 14) return 0.5;
      return 0.3;

    case 'event':
      // Undated events decay on thread age for the same reason undated
      // deadlines do: with no date, the only evidence it is still live is that
      // somebody mentioned it recently.
      if (d === null) return 0.4 * Math.pow(0.5, daysSince(o.lastMessageAt, now) / 10);
      if (d < -1) return 0.05;                 // passed: recedes hard
      if (d <= 0) return 0.9;
      if (d <= 2) return 0.8;
      if (d <= 7) return 0.6;
      return 0.35;

    case 'window':
      if (d === null) return 0.4;
      if (d < 0) return 0.05;                  // closed
      if (d <= 3) return 0.75;
      return 0.5;

    case 'waiting_on': {
      // The inverse case: silence makes it louder. Capped below 1 — it is
      // still someone else's move, so it never outranks your own deadline.
      const age = daysSince(o.anchorDate ? localMidnight(o.anchorDate) : o.lastMessageAt, now);
      if (age < 2) return 0.3;
      if (age < 5) return 0.5;
      if (age < 10) return 0.7;
      return 0.85;
    }
  }
}

export function bucket(o: Rankable, now: number): Bucket {
  if (o.temporalClass === 'reference') return 'receded';
  const s = score(o, now);
  if (s < 0.15) return 'receded';

  const d = o.anchorDate ? daysUntil(o.anchorDate, now) : null;
  if (d !== null && d <= 0 && d >= -1) return 'today';
  if (s >= 0.9) return 'today';
  if (d !== null && d <= 7) return 'this_week';
  if (d === null) return 'this_week';          // undated but live
  return 'later';
}

const WEEKDAY = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long' });
};

export function whenLabel(o: Rankable, now: number): string {
  const d = o.anchorDate ? daysUntil(o.anchorDate, now) : null;

  switch (o.temporalClass) {
    case 'deadline':
      if (d === null) return 'No date given';
      if (d === 0 || d === -1) return 'Do today';
      // Still forward-facing, and honest: the date passed and Weft cannot see
      // whether you acted. It asks rather than accuses.
      if (d < -1) return 'Still open?';
      if (d === 1) return 'By tomorrow';
      if (d <= 6) return `By ${WEEKDAY(o.anchorDate!)}`;
      return `In ${d} days`;

    case 'event':
      if (d === null) return 'Date unclear';
      if (d < -1) return 'Passed';
      if (d < 0) return 'Started';             // multi-day events anchor to day one
      if (d === 0) return 'Today';
      if (d === 1) return 'Tomorrow';
      if (d <= 6) return WEEKDAY(o.anchorDate!);
      return `In ${d} days`;

    case 'window':
      if (d === null) return 'Open';
      if (d < 0) return 'Closed';
      if (d === 0) return 'Closes today';
      if (d === 1) return 'Closes tomorrow';
      return `Closes in ${d} days`;

    case 'waiting_on': {
      const age = daysSince(o.anchorDate ? localMidnight(o.anchorDate) : o.lastMessageAt, now);
      if (age >= 5) return 'Worth chasing';
      return age <= 1 ? 'Just asked' : `Waiting ${age} days`;
    }

    case 'ambient':
      return 'Reading';
    case 'reference':
      return 'On file';
  }
}
