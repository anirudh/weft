import { describe, expect, it } from 'vitest';
import { alreadySettled } from './settled.js';

/** Shape of a real bank statement, invented figures. */
const STATEMENT = `Statement ready Your credit card statement is available Account Larkspur
Credit Card (...4102) Due date 09/04/2026 Minimum payment due $210.00 Statement balance
$3894.60 Auto-pay enabled You're already enrolled in automatic payments. We'll pay the
amount you scheduled from your account. Visit our Resource Center to manage your account.`;

describe('alreadySettled', () => {
  it('silences the exact row that leaked in production', () => {
    // The model wrote "(Auto-pay enabled)" into its own detail and extracted anyway.
    expect(alreadySettled({
      title: 'Pay the Larkspur credit card statement balance',
      detail: 'Statement balance $3894.60, minimum payment $210.00 due 09/04/2026 (Auto-pay enabled)',
      source: STATEMENT,
    })).toBe(true);
  });

  it('leaves a statement alone when nothing says it is automatic', () => {
    expect(alreadySettled({
      title: 'Pay the Riverside Club statement balance',
      detail: '$312.50 due 31 August; late fee applies if not received',
      source: 'Your August statement reflects a balance of $312.50, due 31 August 2026. A late fee applies if payment is not received.',
    })).toBe(false);
  });

  it('stands down the moment the automatic path looks broken', () => {
    for (const trouble of [
      'Auto-pay is enabled but your last payment was declined.',
      'You are enrolled in auto-pay. Your card has expired — update your payment method.',
      'Automatic payments are on. Your account is past due.',
    ]) {
      expect(alreadySettled({ title: 'Pay the balance', detail: '', source: trouble })).toBe(false);
    }
  });

  it('never silences a subscription renewal, which is a decision not a bill', () => {
    // Both read as "money leaves automatically". Only one can be prevented.
    // This one is a real row from a real mailbox and it must survive.
    expect(alreadySettled({
      title: 'Manage upcoming Rivergate Spa membership payment',
      detail: 'Membership coming off freeze; payment automatically deducts on 15 September',
      source: 'Your membership is coming off freeze. Your monthly payment will be automatically deducted from your account on 15 September 2026. To cancel or change your plan, visit your account.',
    })).toBe(false);

    expect(alreadySettled({
      title: 'Pay for the Northwind TV subscription',
      detail: '$11.49 charged monthly',
      source: 'Your Northwind TV subscription will be automatically charged to your payment method on 9 September 2026 for $11.49. Cancel any time in Settings.',
    })).toBe(false);
  });

  it('never touches an obligation that is not about money', () => {
    expect(alreadySettled({
      title: 'Sign and return the field trip form',
      detail: 'Due Friday',
      source: 'Please sign and return the form. Separately, auto-pay is enabled on your camp fees.',
    })).toBe(false);
  });

  it('does not fire on a statement that merely mentions autopay as an option', () => {
    expect(alreadySettled({
      title: 'Pay the monthly statement balance',
      detail: '',
      source: 'Payment is due by the last day of the month. Enrol in auto-pay to never miss a payment.',
    })).toBe(false);
  });
});
