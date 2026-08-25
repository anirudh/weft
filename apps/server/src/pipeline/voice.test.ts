import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatViolations, lintVoice, VOICE_RULES } from '@weft/shared';
import { whenLabel } from './rank.js';
import { label as renewalLabel } from '../routes/subscriptions.js';
import { VOICE_LABELS, VOICE_PROSE, voice } from './voice.js';
import { REPO_ROOT } from '../env.js';
import type { TemporalClass } from '@weft/shared';

const clean = (s: string) => {
  const v = lintVoice(s);
  if (v.length) throw new Error(formatViolations(s, v));
  return true;
};

describe('the lint catches what it claims to', () => {
  it('flags the constructions voice.md bans', () => {
    const cases: [string, string][] = [
      ['accusation', 'This payment is overdue.'],
      ['alarm', 'Action required on your account.'],
      ['exclamation', 'Three things renew this week!'],
      ['chatbot', 'I hope this helps with your week.'],
      ['padding', 'It is worth noting that two renew on Friday.'],
      ['ai-lexicon', 'A crucial decision about your plan.'],
      ['fancy-is', 'Thursday serves as the busiest day.'],
      ['metaphor-noun', 'Renewals are the bedrock of the month.'],
      ['not-just', 'This is not just a renewal, but a decision.'],
      ['stacked-hedge', 'It may possibly renew on Friday.'],
      ['long-dash', 'Two renewals land Friday — both are small.'],
      ['smart-punctuation', 'The “free” trial ends Friday.'],
      ['greeting', 'Good morning. Three things need you.'],
      ['encouragement', "You've got this."],
    ];
    for (const [id, text] of cases) {
      expect(lintVoice(text).map((v) => v.id), text).toContain(id);
    }
  });

  it('leaves real Weft copy alone', () => {
    // Every one of these is text the product actually ships. A lint that fires
    // on them is a lint nobody will keep.
    for (const s of [
      'Do today',
      'Still open?',
      'Worth chasing',
      'Nothing needs you.',
      'Renews today',
      'Closes in 3 days',
      'A quiet week with money leaking out of the edges of it.',
      'Four subscriptions renew between tomorrow and 7 September, together about $125 a month.',
      'Hover renews the domain on 31 July.',
      'Renewal notice arrived 21 August, after you marked this cancelled.',
    ]) {
      expect(clean(s), s).toBe(true);
    }
  });

  it('gives every rule a fix worth reading', () => {
    for (const r of VOICE_RULES) {
      expect(r.fix.length, r.id).toBeGreaterThan(10);
      expect(r.id).toMatch(/^[a-z-]+$/);
    }
  });
});

describe('the strings the product already ships', () => {
  const CLASSES: TemporalClass[] = ['deadline', 'event', 'window', 'waiting_on', 'reference', 'ambient'];
  const NOW = new Date(2026, 7, 25).getTime();

  it('every label rank.ts can produce is clean', () => {
    // Enumerated rather than sampled: whenLabel is a pure function of class and
    // day offset, so the full set of things it can ever say is finite.
    for (const temporalClass of CLASSES) {
      for (let d = -40; d <= 40; d++) {
        const at = new Date(NOW + d * 86_400_000);
        const iso = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
        for (const anchorDate of [iso, null]) {
          clean(whenLabel({ temporalClass, anchorDate, lastMessageAt: NOW - Math.abs(d) * 86_400_000 }, NOW));
        }
      }
    }
  });

  it('every renewal label the lens can produce is clean', () => {
    for (const paused of [true, false]) {
      for (const days of [null, -30, -1, 0, 1, 5, 31, 45, 200, 400]) clean(renewalLabel(days, paused));
    }
  });

  it('the text written into the web UI is clean', () => {
    // Reads the JSX text nodes out of source. Crude, but it is the only thing
    // standing between a hand-typed string and the reader.
    const dir = resolve(REPO_ROOT, 'apps/web/src');
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => resolve(dir, f));

    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/>([^<>{}]{4,120})</g)) {
        const text = m[1]!.trim();
        // `>` also ends arrow functions and generics, so the naive match drags
        // in code. Keep only what could actually be a sentence on screen.
        if (!text || !/^[A-Za-z0-9$"']/.test(text)) continue;
        if (/[;={}()[\]]|=>|\breturn\b|\bconst\b|className/.test(text)) continue;
        if (!/[a-z]{3}/i.test(text)) continue;
        const v = lintVoice(text);
        if (v.length) offenders.push(`${f.split('/').pop()}: ${formatViolations(text, v)}`);
      }
    }
    expect(offenders.join('\n')).toBe('');
  });
});

describe('voice.md is load-bearing, not decoration', () => {
  it('reaches the prompts that write to the reader', () => {
    expect(VOICE_PROSE).toContain('Forward-facing');
    expect(VOICE_LABELS).toContain('imperative');
  });

  it('fails loudly when a section it depends on is renamed away', () => {
    // The failure mode this exists to prevent: someone tidies a heading, the
    // prompts quietly lose their voice rules, and nothing says so.
    expect(() => voice('Tone Of Voice')).toThrow(/has no "## Tone Of Voice"/);
  });

  it('obeys its own rules', () => {
    // A voice document that breaks its own bans teaches the model the wrong
    // thing, because the model reads it as a sample of the register.
    for (const section of ['Voice', 'Naming things', 'Judgment']) {
      for (const line of voice(section).split('\n')) {
        // The ban list necessarily quotes the words it bans.
        clean(line);
      }
    }
  });
});
