import { describe, expect, it } from 'vitest';
import {
  monthlyCents, parseCadence, parseMoney, renewalIsDistant, resolveRecurring, rollForward, serviceKey,
} from './recurring.js';

describe('parsing money out of the prose the model actually writes', () => {
  it('reads the shapes seen in real mail', () => {
    // Every one of these is a real detail string from the mailbox.
    expect(parseMoney('$6.99 monthly subscription renews on 27 August 2026')).toEqual({ cents: 699, currency: 'USD' });
    expect(parseMoney('Subscription renews on 7 September 2026 for $89.00/month')).toEqual({ cents: 8900, currency: 'USD' });
    expect(parseMoney('Renews September 14, 2026 for $16.53 including tax')).toEqual({ cents: 1653, currency: 'USD' });
    expect(parseMoney('$11.49/month renews on 4 Sept 2026')).toEqual({ cents: 1149, currency: 'USD' });
  });

  it('handles thousands separators and non-dollar currencies', () => {
    expect(parseMoney('renews at $1,234.50 a year')).toEqual({ cents: 123450, currency: 'USD' });
    expect(parseMoney('£79.99 annually')).toEqual({ cents: 7999, currency: 'GBP' });
    expect(parseMoney('16.53 EUR per month')).toEqual({ cents: 1653, currency: 'EUR' });
  });

  it('returns nothing rather than guessing', () => {
    expect(parseMoney('Renews on September 3, 2026')).toBeNull();
    expect(parseMoney('a free trial ending soon')).toBeNull();
  });
});

describe('cadence', () => {
  it('reads the common phrasings', () => {
    expect(parseCadence('$6.99 monthly subscription')).toBe('monthly');
    expect(parseCadence('$89.00/month on Sep 7')).toBe('monthly');
    expect(parseCadence('Trial renewed at $7.99/week')).toBe('weekly');
    expect(parseCadence('renews at $79.99/year')).toBe('yearly');
    expect(parseCadence('billed quarterly')).toBe('quarterly');
  });

  it('does not invent one', () => {
    expect(parseCadence('Renews September 14, 2026 for $16.53 including tax')).toBeNull();
  });
});

describe('normalising to a monthly cost so different cadences can be added', () => {
  it('converts weekly using 52 weeks, not four', () => {
    // $7.99 a week is $34.62 a month, not $31.96. The four-week shortcut
    // understates a weekly subscription by about 8% a year.
    expect(monthlyCents(799, 'weekly')).toBe(3462);
  });

  it('divides a year by twelve and a quarter by three', () => {
    expect(monthlyCents(12000, 'yearly')).toBe(1000);
    expect(monthlyCents(3000, 'quarterly')).toBe(1000);
  });

  it('counts a one-off as no running cost', () => {
    expect(monthlyCents(5000, 'one_off')).toBe(0);
  });
});

describe('service identity', () => {
  it('collapses the phrasings one service arrives under', () => {
    // Three real rows, one service. This is why the lens groups by service and
    // Horizon does not: Horizon's unit is the email, the lens's is the thing.
    const keys = [
      'Decide on Lightbox subscription before auto-renewal',
      'Manage Lightbox subscription',
      'Lightbox Premium',
    ].map(serviceKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('keeps genuinely different services apart', () => {
    expect(serviceKey('Northwind Drive+')).not.toBe(serviceKey('Northwind TV'));
  });
});

describe('resolveRecurring', () => {
  it('prefers what the model gave it', () => {
    expect(resolveRecurring({
      service: 'Google AI Ultra', amount: '110.29', currency: 'USD', cadence: 'monthly',
      title: 'Decide on Google AI Ultra', detail: 'renews 7 September',
    })).toEqual({ service: 'Google AI Ultra', amountCents: 11029, currency: 'USD', cadence: 'monthly' });
  });

  it('falls back to the prose when the model left the fields blank', () => {
    expect(resolveRecurring({
      service: 'Lightbox', amount: '', currency: '', cadence: '',
      title: 'Decide on Lightbox subscription', detail: '$6.99 monthly subscription renews on 27 August 2026',
    })).toEqual({ service: 'Lightbox', amountCents: 699, currency: 'USD', cadence: 'monthly' });
  });

  it('keeps a service whose price is not stated, because the date still matters', () => {
    const r = resolveRecurring({
      service: 'The Meridian', amount: '', currency: '', cadence: 'yearly',
      title: 'Decide on The Meridian before the trial converts', detail: 'Trial ends 21 August; no price stated',
    });
    expect(r.service).toBe('The Meridian');
    expect(r.amountCents).toBeNull();
  });

  it('refuses anything without both a service and a cadence', () => {
    // A one-line reply to a person is not a subscription however much it costs.
    expect(resolveRecurring({
      service: '', amount: '', currency: '', cadence: '',
      title: 'Pay the Riverside Club statement balance', detail: '$312.50 due by 31 August',
    }).service).toBe('');
  });
});

describe('rollForward', () => {
  const now = new Date(2026, 7, 24).getTime(); // 24 Aug 2026, local

  it('leaves a future date alone', () => {
    expect(rollForward('2026-09-07', 'monthly', now)).toEqual({ date: '2026-09-07', estimated: false });
  });

  it('treats today as still ahead', () => {
    expect(rollForward('2026-08-24', 'weekly', now)).toEqual({ date: '2026-08-24', estimated: false });
  });

  it('rolls a past monthly renewal to the next one', () => {
    expect(rollForward('2026-08-12', 'monthly', now)).toEqual({ date: '2026-09-12', estimated: true });
  });

  it('rolls a past yearly renewal a full year', () => {
    expect(rollForward('2026-07-29', 'yearly', now)).toEqual({ date: '2027-07-29', estimated: true });
  });

  it('steps a weekly cadence up to the first date not yet past', () => {
    expect(rollForward('2026-07-06', 'weekly', now)).toEqual({ date: '2026-08-24', estimated: true });
  });

  it('never projects a one-off forward — it does not recur', () => {
    expect(rollForward('2026-07-01', 'one_off', now)).toEqual({ date: '2026-07-01', estimated: false });
  });
});

describe('serviceKey is idempotent', () => {
  // The state endpoint normalises whatever it is given, so Horizon can send a
  // raw obligation title and the lens can send its own key. That only works if
  // re-keying a key is a no-op.
  it('re-keying a key changes nothing', () => {
    for (const n of [
      'Decide on Northwind TV subscription before it renews',
      'Lightbox: Photo & Video Editor',
      'Northwind Paint Premium Membership',
      'Renew Larkspur domain example.test',
      'riverside.example',
    ]) {
      expect(serviceKey(serviceKey(n))).toBe(serviceKey(n));
    }
  });
});

describe('renewalIsDistant — one rule for both surfaces', () => {
  const now = new Date(2026, 7, 25).getTime(); // 25 Aug 2026

  it('keeps an imminent renewal on the front page', () => {
    expect(renewalIsDistant('2026-08-27', 'monthly', now, 7)).toBe(false);
  });

  it('sends a far-off renewal to the ledger', () => {
    expect(renewalIsDistant('2026-11-30', 'yearly', now, 7)).toBe(true);
  });

  it('measures from the NEXT charge, not the last one', () => {
    // The hole this closes: a yearly renewal four days gone is not a decision
    // you have four days left on — the next one is eleven months out. Measured
    // from the raw anchor it read as imminent and was offered as today's work.
    expect(renewalIsDistant('2026-08-21', 'yearly', now, 7)).toBe(true);
    // …while a monthly one rolls to 21 September, still comfortably distant.
    expect(renewalIsDistant('2026-08-21', 'monthly', now, 7)).toBe(true);
    // …and a weekly one rolls to 28 August, which genuinely is imminent.
    expect(renewalIsDistant('2026-08-21', 'weekly', now, 7)).toBe(false);
  });

  it('treats a service with no date at all as ledger-only', () => {
    expect(renewalIsDistant(null, 'monthly', now, 7)).toBe(true);
  });
});
