import { describe, expect, it } from 'vitest';
import { buildInput, inputHash } from './compose.js';
import type { Obligation, WeekDay } from '@weft/shared';

const ob = (o: Partial<Obligation>): Obligation => ({
  id: 1, accountEmail: 'a@b.com', threadId: 't', sourceMessageId: 'm', court: 'yours',
  temporalClass: 'deadline', anchorDate: '2026-08-27', anchorIsExplicit: true, anchorQuote: '',
  anchorValidated: true, title: 'Pay the Riverside Club statement balance', detail: '$312.50',
  confidence: 0.9, completedAt: null, dismissedAt: null, service: '', score: 0.85, bucket: 'this_week',
  whenLabel: 'By Thursday', mergedCount: 1, ...o,
});
const base = { cursors: ['1000001', '2000002'], date: 'Monday 24 August' };

describe('the edition cache key', () => {
  it('is stable for identical inputs — reopening Horizon must be free', () => {
    const loops = [ob({ id: 1 }), ob({ id: 2, title: 'Cancel Lightbox' })];
    expect(inputHash({ ...base, loops })).toBe(inputHash({ ...base, loops: [...loops] }));
  });

  it('ignores the order the obligations arrive in', () => {
    const a = [ob({ id: 1 }), ob({ id: 2, title: 'Cancel Lightbox' })];
    expect(inputHash({ ...base, loops: a })).toBe(inputHash({ ...base, loops: [...a].reverse() }));
  });

  it('changes when a loop is cleared, so the brief is rewritten', () => {
    const before = [ob({ id: 1 }), ob({ id: 2, title: 'Cancel Lightbox' })];
    expect(inputHash({ ...base, loops: before.slice(1) })).not.toBe(inputHash({ ...base, loops: before }));
  });

  it('changes when only the label moved — yesterday\'s wording must not persist', () => {
    // Same obligation, one day later: "By Thursday" has become "By tomorrow".
    const loops = [ob({ whenLabel: 'By Thursday' })];
    const later = [ob({ whenLabel: 'By tomorrow' })];
    expect(inputHash({ ...base, loops: later })).not.toBe(inputHash({ ...base, loops }));
  });

  it('changes when new mail arrives, even with the same obligations', () => {
    const loops = [ob({})];
    expect(inputHash({ ...base, cursors: ['1000042', '2000002'], loops }))
      .not.toBe(inputHash({ ...base, loops }));
  });

  it('changes on a new day, so a brief never outlives its date', () => {
    const loops = [ob({})];
    expect(inputHash({ ...base, date: 'Tuesday 25 August', loops })).not.toBe(inputHash({ ...base, loops }));
  });
});

describe('what the composer is shown', () => {
  const week: WeekDay[] = [
    { date: '2026-08-24', label: 'Today', isToday: true, items: [] },
    { date: '2026-08-25', label: 'Tue 25', isToday: false, items: [{ id: 1, title: 'Brightpath' }] },
  ];

  it('carries the when-label and detail, not the raw score', () => {
    const text = buildInput('Monday 24 August', [ob({})], [], week);
    expect(text).toContain('[By Thursday] Pay the Riverside Club statement balance — $312.50');
    expect(text).not.toContain('0.85'); // ranking is Horizon's business, not the writer's
  });

  it('names an empty court rather than leaving a blank the model will fill', () => {
    const text = buildInput('Monday 24 August', [ob({})], [], week);
    expect(text).toContain('nothing outstanding from anyone else');
  });

  it('gives the week as counts, so the brief can spot an empty stretch', () => {
    expect(buildInput('Monday 24 August', [ob({})], [], week)).toContain('Today: nothing · Tue 25: 1');
  });
});
