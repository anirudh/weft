import { describe, expect, it } from 'vitest';
import { detectCancellation, namesService } from './cancellation.js';

const found = (s: string) => detectCancellation(s) !== null;

describe('what a confirmation actually looks like', () => {
  it('reads committed statements as confirmations', () => {
    for (const s of [
      'Your subscription has been cancelled. You will retain access until 12 September 2026.',
      'Your Premium membership was canceled on 3 September.',
      'Cancellation confirmed — sorry to see you go.',
      "We've cancelled your plan as requested.",
      'You have successfully cancelled your subscription.',
      'Your plan will not renew and access ends 30 September 2026.',
      'Auto-renewal is now off for this subscription.',
      'Your subscription will end on 14 September 2026.',
      'You will no longer be charged for this service.',
    ]) {
      expect(found(s), s).toBe(true);
    }
  });
});

describe('the failure that would cost real money', () => {
  it('never reads cancellation instructions as a cancellation', () => {
    // Every one of these is boilerplate on a receipt for a LIVE subscription.
    // Treating any of them as confirmation would drop a real charge out of the
    // monthly total with nothing on screen to say it had gone.
    for (const s of [
      'To learn more or cancel, review your subscription.',
      'Cancel any time in Settings.',
      'You can cancel your subscription at any time from your account page.',
      'To avoid being charged, you must cancel at least a day before each renewal date.',
      'If you cancel, your subscription will not renew.',
      'Please cancel before the renewal date if you no longer want the plan.',
      'Want to cancel? Here is how to cancel your membership.',
      'Your subscription automatically renews until canceled.',
      // These ten shapes came out of a real mailbox against two genuine
      // cancellations. All of them are reassurance about STARTING something —
      // the opposite of the thing being detected — and an earlier pass read
      // every one of them as a confirmed cancellation.
      'You will not be charged any fees and you will not be auto-enrolled.',
      'You will not be charged during the free trial period (the first 7 days of your subscription).',
      'A form of payment is required at sign-up, but you will not be charged until the device ships.',
    ]) {
      expect(found(s), s).toBe(false);
    }
  });

  it('keeps the two real confirmations that survived that sweep', () => {
    expect(found('You have successfully canceled your Northwind Reader subscription.')).toBe(true);
    // "anymore" is the whole signal: it implies a charge that was happening.
    expect(found("Thanks for trying Ultra Plus. You won't be charged anymore")).toBe(true);
  });

  it('reads the real Apple receipt shape as no cancellation at all', () => {
    const receipt = [
      'Subscription Confirmed. Northwind Notes Premium.',
      'Renewal Price $6.49/week, starting Aug 24, 2026.',
      'Your subscription automatically renews until canceled.',
      'To avoid being charged, you must cancel at least a day before each renewal date.',
      'To learn more or cancel, review your subscription.',
    ].join(' ');
    expect(detectCancellation(receipt)).toBeNull();
  });

  it('still finds the confirmation when boilerplate sits beside it', () => {
    // The realistic case: a genuine cancellation email that also carries the
    // usual footer. Judging the whole body would throw this away.
    const body = [
      'Your subscription has been cancelled.',
      'You can cancel any time from Settings.',
      'To learn more, visit our help centre.',
    ].join(' ');
    expect(detectCancellation(body)?.quote).toBe('Your subscription has been cancelled.');
  });
});

describe('the evidence it hands back', () => {
  it('returns the sentence, so one click is a decision and not faith', () => {
    const e = detectCancellation('Thanks for writing in. Cancellation confirmed for your annual plan. Refunds take 5 days.');
    expect(e?.quote).toBe('Cancellation confirmed for your annual plan.');
  });

  it('caps a runaway sentence rather than handing a paragraph to a table row', () => {
    const long = `Your subscription has been cancelled ${'and '.repeat(120)}goodbye.`;
    expect(detectCancellation(long)!.quote.length).toBeLessThanOrEqual(200);
  });

  it('says nothing about an empty body', () => {
    expect(detectCancellation('')).toBeNull();
  });
});

describe('the second gate: does the email name the service', () => {
  const sub = { name: 'Lightbox: Photo & Video Editor', key: 'lightbox photo video editor' };

  it('matches on the display name as the model wrote it', () => {
    expect(namesService('Your Lightbox: Photo & Video Editor plan has been cancelled.', sub)).toBe(true);
  });

  it('matches on the normalised key too', () => {
    expect(namesService('cancellation confirmed for lightbox photo video editor', sub)).toBe(true);
  });

  it('refuses a cancellation for something else entirely', () => {
    // The real case: two genuine confirmations in the mailbox, neither for a
    // service in the ledger. Nothing to attach to, so nothing is proposed.
    expect(namesService('You have successfully canceled your Northwind Reader subscription.', sub)).toBe(false);
  });

  it('never lets a very short name match half the mailbox', () => {
    expect(namesService('we have cancelled your plan', { name: 'X', key: 'x' })).toBe(false);
  });
});
