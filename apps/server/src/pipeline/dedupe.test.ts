import { describe, expect, it } from 'vitest';
import { dedupe, similarity } from './dedupe.js';
import type { Obligation } from '@weft/shared';

const ob = (o: Partial<Obligation>): Obligation => ({
  id: Math.random(), accountEmail: 'a@b.com', threadId: String(Math.random()), sourceMessageId: 'm',
  court: 'yours', temporalClass: 'event', anchorDate: '2026-09-08', anchorIsExplicit: true,
  anchorQuote: '', anchorValidated: true, title: '', detail: '', confidence: 0.9,
  completedAt: null, dismissedAt: null, service: '', score: 0.8, bucket: 'this_week', whenLabel: 'Tuesday',
  ...o, mergedCount: o.mergedCount ?? 1,
});

describe('similarity ignores verbs and articles', () => {
  it('ties the two phrasings a school actually uses', () => {
    expect(similarity('Attend Kindergarten First Day', 'First Day of Kindergarten')).toBeGreaterThanOrEqual(0.5);
  });

  it('scores the school phrasings that only just miss', () => {
    // Measured on real output: these were the two near-misses at 0.5.
    expect(similarity('Principal and Pops Playdate and Open House', 'Principal Pops and Playdate at Oakfield')).toBeGreaterThanOrEqual(0.4);
    expect(similarity('First Day of School for 1st-5th grade', 'First Day of School (Grades 1-5)')).toBeGreaterThanOrEqual(0.4);
  });
});

describe('dedupe', () => {
  it('collapses the same event arriving through several threads', () => {
    const rows = dedupe([
      ob({ title: 'Attend Kindergarten First Day', detail: 'short' }),
      ob({ title: 'First Day of Kindergarten', detail: 'a much longer explanation' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mergedCount).toBe(2);
    expect(rows[0]!.detail).toBe('a much longer explanation'); // the fuller email wins
  });

  it('keeps the higher-scoring row as the survivor', () => {
    const rows = dedupe([
      ob({ title: 'First Day of Kindergarten', score: 0.4, whenLabel: 'In 9 days' }),
      ob({ title: 'Attend Kindergarten First Day', score: 0.8, whenLabel: 'Tuesday' }),
    ]);
    expect(rows[0]!.whenLabel).toBe('Tuesday');
  });

  it('never merges across dates, even with an identical title', () => {
    expect(dedupe([
      ob({ title: 'Attend swim lesson', anchorDate: '2026-09-08' }),
      ob({ title: 'Attend swim lesson', anchorDate: '2026-09-15' }),
    ])).toHaveLength(2);
  });

  it('never merges a deadline into an event, however alike the words', () => {
    // Confirming attendance and attending fall on the same day and share most
    // of their words, but they are two separate things the reader must do.
    const rows = dedupe([
      ob({ title: "Maya's Brightpath trial class", temporalClass: 'event' }),
      ob({ title: 'Confirm attendance for the Brightpath trial class', temporalClass: 'deadline' }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('never merges across courts', () => {
    expect(dedupe([
      ob({ title: 'Wildwood waitlist request', court: 'yours' }),
      ob({ title: 'Wildwood waitlist request', court: 'theirs' }),
    ])).toHaveLength(2);
  });

  it('leaves undated obligations alone — too little signal to risk hiding one', () => {
    expect(dedupe([
      ob({ title: 'Reply to Dana', anchorDate: null }),
      ob({ title: 'Reply to Dana', anchorDate: null }),
    ])).toHaveLength(2);
  });
});
