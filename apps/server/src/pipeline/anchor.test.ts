import { describe, expect, it } from 'vitest';
import { quoteContainsDate, validateAnchor } from './anchor.js';

describe('quoteContainsDate', () => {
  it('accepts real date expressions', () => {
    for (const q of [
      'Friday August 29', 'by Friday', 'on 29th August', '2026-08-29', '8/29',
      'is tomorrow', 'today', 'next Monday', 'next week', 'Aug 29', '29 Aug',
      'within 3 days', 'in 2 weeks', 'Mon, 25 Aug', 'May 4',
      // Found in real mail during the first extraction run: a registrar wrote
      // the expiry as 07-30-2026 and the validator threw the deadline away.
      '07-30-2026', '30-07-2026', '30.07.2026', '7-30-26',
      // HDFC Bank statements use this; it was 8 of the 9 rejections in the
      // first full run over real mail.
      '27-JUL-26', '03-AUG-26', '17/AUG/2026',
    ]) expect(quoteContainsDate(q), q).toBe(true);
  });

  it('rejects vague urgency — the case that actually bit us', () => {
    for (const q of [
      'before the board meets', 'as soon as possible', 'shortly', 'at your earliest convenience',
      'soon', 'urgently', 'when you get a chance', '', '   ',
    ]) expect(quoteContainsDate(q), q).toBe(false);
  });

  it('does not treat ordinary words as dates', () => {
    // "may" the verb, "sat" and "march" as ordinary words: all common in mail.
    for (const q of ['you may need to reply', 'we sat down to review', 'a long march to launch']) {
      expect(quoteContainsDate(q), q).toBe(false);
    }
  });
});

describe('validateAnchor', () => {
  it('keeps a date backed by a real quote', () => {
    const r = validateAnchor({ anchorDate: '2026-08-29', anchorIsExplicit: true, anchorQuote: 'Friday August 29' });
    expect(r).toMatchObject({ anchorDate: '2026-08-29', anchorValidated: true });
  });

  it('strips a fabricated date even when the model swears it is explicit', () => {
    const r = validateAnchor({ anchorDate: '2026-08-24', anchorIsExplicit: true, anchorQuote: 'before the board meets' });
    expect(r.anchorDate).toBeNull();
    expect(r.anchorValidated).toBe(false);
    expect(r.anchorIsExplicit).toBe(false);
  });

  it('rejects a non-date string in the date field', () => {
    // 3.5-flash-lite returned literally "unknown" here during benchmarking.
    const r = validateAnchor({ anchorDate: 'unknown', anchorIsExplicit: false, anchorQuote: 'before the board meets' });
    expect(r.anchorDate).toBeNull();
    expect(r.anchorValidated).toBe(false);
  });

  it('treats "no date stated" as valid, not as a failure', () => {
    const r = validateAnchor({ anchorDate: '', anchorIsExplicit: false, anchorQuote: '' });
    expect(r.anchorDate).toBeNull();
    expect(r.anchorValidated).toBe(true);
  });
});
