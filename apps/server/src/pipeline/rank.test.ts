import { describe, expect, it } from 'vitest';
import { bucket, daysUntil, score, whenLabel } from './rank.js';
import type { Rankable } from './rank.js';

/** Fixed clock: Saturday 23 August 2026, 08:04 local. */
const NOW = new Date(2026, 7, 23, 8, 4).getTime();
const at = (o: Partial<Rankable>): Rankable => ({
  temporalClass: 'deadline', anchorDate: null, lastMessageAt: NOW, ...o,
});

describe('daysUntil', () => {
  it('counts calendar days, not elapsed hours', () => {
    // 23:00 today to 00:30 tomorrow is 1.5 hours but one calendar day.
    expect(daysUntil('2026-08-24', new Date(2026, 7, 23, 23, 0).getTime())).toBe(1);
    expect(daysUntil('2026-08-23', NOW)).toBe(0);
    expect(daysUntil('2026-08-21', NOW)).toBe(-2);
  });
});

describe('the case this whole model exists for', () => {
  it('ranks an older email above a newer one when its event is still ahead', () => {
    // Dance camp: arrived 6 Aug, ran on the 11th — passed.
    const dance = at({ temporalClass: 'event', anchorDate: '2026-08-11', lastMessageAt: new Date(2026, 7, 6).getTime() });
    // Music camp: arrived 4 Aug — two days OLDER — but starts on the 25th.
    const music = at({ temporalClass: 'event', anchorDate: '2026-08-25', lastMessageAt: new Date(2026, 7, 4).getTime() });

    expect(score(music, NOW)).toBeGreaterThan(score(dance, NOW));
    expect(bucket(dance, NOW)).toBe('receded');
    expect(whenLabel(dance, NOW)).toBe('Passed');
    expect(whenLabel(music, NOW)).toBe('Tuesday');
  });
});

describe('deadlines', () => {
  it('climbs toward the date', () => {
    const far = at({ anchorDate: '2026-09-20' });
    const soon = at({ anchorDate: '2026-08-26' });
    const due = at({ anchorDate: '2026-08-23' });
    expect(score(far, NOW)).toBeLessThan(score(soon, NOW));
    expect(score(soon, NOW)).toBeLessThan(score(due, NOW));
  });

  it('lets a live deadline outrank a passed one', () => {
    // The case from a real Horizon: a Figma renewal three days gone was tying
    // with things genuinely due in a week. The live one deserves the attention.
    const passed = at({ anchorDate: '2026-08-20' });   // three days ago
    const live = at({ anchorDate: '2026-08-30' });     // in seven days
    expect(score(live, NOW)).toBeGreaterThan(score(passed, NOW));
  });

  it('recedes a deadline more than a week past', () => {
    expect(bucket(at({ anchorDate: '2026-08-14' }), NOW)).toBe('receded');
  });

  it('holds one day of grace, then rots', () => {
    // A domain that expired on 30 July is not today's work on 23 August.
    // This is the case that put "Shop the Northwind Supply sale" at the top of a
    // real Horizon two weeks after the sale ended.
    const due = at({ anchorDate: '2026-08-23' });
    const slipped = at({ anchorDate: '2026-08-22' });
    const week = at({ anchorDate: '2026-08-16' });
    const fortnight = at({ anchorDate: '2026-08-09' });
    const dead = at({ anchorDate: '2026-07-30' });

    expect(score(slipped, NOW)).toBe(score(due, NOW)); // yesterday is still today's work
    expect(score(week, NOW)).toBeLessThan(score(slipped, NOW));
    expect(score(fortnight, NOW)).toBeLessThan(score(week, NOW));
    expect(bucket(dead, NOW)).toBe('receded');
  });

  it('never uses accusatory wording, whatever the date', () => {
    for (const iso of ['2026-08-23', '2026-08-22', '2026-08-19', '2026-07-30']) {
      expect(whenLabel(at({ anchorDate: iso }), NOW)).not.toMatch(/late|overdue|missed|failed/i);
    }
    expect(whenLabel(at({ anchorDate: '2026-08-22' }), NOW)).toBe('Do today');
    // Read-only access cannot know whether you acted, so it asks.
    expect(whenLabel(at({ anchorDate: '2026-08-19' }), NOW)).toBe('Still open?');
  });

  it('keeps a fresh undated obligation visible rather than inventing urgency', () => {
    const undated = at({ anchorDate: null, lastMessageAt: NOW });
    expect(bucket(undated, NOW)).toBe('this_week');
    expect(whenLabel(undated, NOW)).toBe('No date given');
    expect(score(undated, NOW)).toBeLessThan(score(at({ anchorDate: '2026-08-23' }), NOW));
  });

  it('decays an undated obligation on the age of its thread', () => {
    // A camp waiver whose own detail said "Monday August 3rd" sat mid-list
    // three weeks later, because the model quoted "first day" and the anchor
    // validator rightly threw the date away. Undated is not timeless.
    const fresh = at({ anchorDate: null, lastMessageAt: NOW });
    const fortnight = at({ anchorDate: null, lastMessageAt: new Date(2026, 7, 9).getTime() });
    const stale = at({ anchorDate: null, lastMessageAt: new Date(2026, 7, 1).getTime() });
    expect(score(fortnight, NOW)).toBeLessThan(score(fresh, NOW));
    expect(score(stale, NOW)).toBeLessThan(score(fortnight, NOW));
    expect(bucket(stale, NOW)).toBe('receded');
  });
});

describe('anchors are read at local midnight', () => {
  it('does not shift a label by a day west of Greenwich', () => {
    // new Date('2026-08-21') is UTC midnight — the evening of the 20th in
    // California, which used to age every waiting_on by an extra day.
    const w = at({ temporalClass: 'waiting_on', anchorDate: '2026-08-21' });
    expect(whenLabel(w, NOW)).toBe('Waiting 2 days');
  });
});

describe('waiting_on rises with silence', () => {
  it('gets louder the longer it goes unanswered', () => {
    const fresh = at({ temporalClass: 'waiting_on', lastMessageAt: new Date(2026, 7, 22).getTime() });
    const stale = at({ temporalClass: 'waiting_on', lastMessageAt: new Date(2026, 7, 12).getTime() });
    expect(score(stale, NOW)).toBeGreaterThan(score(fresh, NOW));
    expect(whenLabel(stale, NOW)).toBe('Worth chasing');
  });

  it('still never outranks your own due deadline', () => {
    const veryStale = at({ temporalClass: 'waiting_on', lastMessageAt: new Date(2026, 6, 1).getTime() });
    expect(score(veryStale, NOW)).toBeLessThan(score(at({ anchorDate: '2026-08-23' }), NOW));
  });
});

describe('classes that should stay out of the way', () => {
  it('excludes reference entirely', () => {
    const receipt = at({ temporalClass: 'reference' });
    expect(score(receipt, NOW)).toBe(0);
    expect(bucket(receipt, NOW)).toBe('receded');
  });

  it('decays ambient on a half-life', () => {
    const today = at({ temporalClass: 'ambient', lastMessageAt: NOW });
    const old = at({ temporalClass: 'ambient', lastMessageAt: new Date(2026, 7, 14).getTime() });
    expect(score(old, NOW)).toBeLessThan(score(today, NOW));
    expect(bucket(old, NOW)).toBe('receded');
  });
});
