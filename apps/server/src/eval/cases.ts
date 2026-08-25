/**
 * The corpus, chosen rather than sampled. Every entry here is a case that cost
 * real time to get right, or that a plausible prompt change would break.
 *
 * Two selection rules, both deliberate:
 *
 * 1. Structure over subject matter. What makes a thread hard is its shape — a
 *    marketing mail carrying a genuine hard date, a statement whose fine print
 *    says auto-pay is already on — not what it is about. So nothing medical,
 *    immigration-related or identity-financial is here even in scrubbed form.
 *    The same difficulty is available in a subscription receipt.
 *
 * 2. Both directions. A corpus of things that should extract teaches a model to
 *    extract everything. Half of these must produce nothing.
 *
 * How each id maps back to a thread in a real mailbox lives in
 * data/capture-map.json, which is gitignored — the mapping is a list of one
 * person's actual obligations, and it is only needed to regenerate fixtures on
 * the machine that has the source mail.
 */

export type Expectation =
  | { obligations: 'none' }
  | {
      obligations: 'some';
      court?: 'yours' | 'theirs';
      temporalClass?: string;
      anchorDate?: string;
      /** Minimum distinct obligations. For emails that carry several, where the
       *  failure is finding one of them and stopping rather than misclassifying. */
      atLeast?: number;
    };

export type Case = {
  id: string;
  /** Why this thread is in the corpus. Read this before changing its label. */
  note: string;
  expect: Expectation;
  /** True where today's prompt is known to get this wrong. Reported, not failed. */
  knownGap?: boolean;
};

export const CASES: Case[] = [
  // ── Marketing carrying real dates. The single largest failure mode. ──
  { id: 'promo-pixel-code',
    note: 'Discount code with a hard expiry and a dollar figure. Expiring costs the reader nothing they had.',
    expect: { obligations: 'none' } },
  { id: 'promo-trade-in',
    note: 'Trade-in offer, firm end date, large stated value. Still an offer.',
    expect: { obligations: 'none' } },
  { id: 'promo-sale',
    note: 'Plain sale mail. Sat at the top of a real Horizon for two weeks after the sale ended.',
    expect: { obligations: 'none' } },
  { id: 'promo-rate-discount',
    note: 'Financial-sounding promo. Reads urgent, owes nothing.',
    expect: { obligations: 'none' } },
  { id: 'promo-early-bird',
    note: 'Early-bird pricing deadline — the seller\'s deadline, not the reader\'s.',
    expect: { obligations: 'none' } },
  { id: 'promo-membership-discount',
    note: 'Discount on an add-on the reader does not have. Adjacent to a real renewal, which is why it is here.',
    expect: { obligations: 'none' } },
  { id: 'promo-preorder',
    note: 'Pre-order incentive with a date attached.',
    expect: { obligations: 'none' } },
  { id: 'promo-device-insurance',
    note: 'Add-on insurance with a genuine enrolment window. Nothing is lost by ignoring it.',
    expect: { obligations: 'none' } },
  { id: 'promo-expiring-credit',
    note: "The line between a promo and a real loss: a discount code expiring costs nothing you had, a prepaid credit is property. Sat at roughly 2 passes in 8 while the exclusion rules outweighed the positive ones, and came back when the counterweight was added. Watch this one.",
    expect: { obligations: 'some', court: 'yours' }, knownGap: true },

  // ── Broadcast events. Advertised, not booked into. ──
  { id: 'broadcast-webinar',
    note: 'Live session promoted to a list. The reader did not register.',
    expect: { obligations: 'none' } },
  { id: 'broadcast-alumni-webinar',
    note: 'Alumni broadcast. Genuinely arguable, which is exactly why it is pinned.',
    expect: { obligations: 'none' } },

  // ── Things that complete on their own. ──
  { id: 'auto-refund-in-transit',
    note: 'Refund already issued. Nobody is waiting on anybody — the classic false waiting_on.',
    expect: { obligations: 'none' } },
  { id: 'auto-package-tracking',
    note: 'Shipping notice. Arrives whether or not the reader acts.',
    expect: { obligations: 'none' } },
  { id: 'auto-pay-enabled-statement',
    note: 'A balance and a due date, but the fine print says auto-pay is enrolled. The rule must beat the surface.',
    expect: { obligations: 'none' } },

  // ── Subscriptions and trials. The reader keeps the money only by acting. ──
  { id: 'sub-trial-upsell-no-price',
    note: 'Trial ending, written as an upsell, no price named. Flipped between runs — pinned to catch drift.',
    expect: { obligations: 'some', court: 'yours' } },
  { id: 'sub-renewal-dated',
    note: 'Ordinary auto-renewal with date and amount. The base case that must never regress.',
    expect: { obligations: 'some', court: 'yours', temporalClass: 'window' } },
  { id: 'sub-trial-converting',
    note: 'Trial converting to paid at a weekly rate.',
    expect: { obligations: 'some', court: 'yours' } },
  { id: 'sub-large-annual',
    note: 'The expensive one. If any renewal survives, this must.',
    expect: { obligations: 'some', court: 'yours' } },

  // ── Commitments: booked in, not advertised. ──
  { id: 'event-lesson-booking',
    note: 'A booked lesson. Nothing goes wrong if missed, so a consequence-only rule deletes it.',
    expect: { obligations: 'some', court: 'yours', temporalClass: 'event' } },
  { id: 'event-calendar-invite',
    note: 'Calendar invitation from a person. Structurally unlike any marketing mail.',
    expect: { obligations: 'some', court: 'yours', temporalClass: 'event' } },
  { id: 'event-class-confirmation',
    note: 'Confirmation required before a class. Both an event and a thing to do — the split matters.',
    expect: { obligations: 'some', court: 'yours' } },

  // ── Organisations expecting something back. ──
  { id: 'org-corporate-action',
    note: 'Reply-by with a time and timezone. Real consequence, dry wording.',
    expect: { obligations: 'some', court: 'yours', temporalClass: 'deadline' } },
  { id: 'org-statement-due',
    note: 'Balance owed with a due date and no auto-pay — the mirror of auto-pay-enabled-statement.',
    expect: { obligations: 'some', court: 'yours', temporalClass: 'deadline' } },
  { id: 'org-survey-undated',
    note: 'An organisation asking for something back with no date. Must extract, must stay undated.',
    expect: { obligations: 'some', court: 'yours', anchorDate: '' } },
  { id: 'org-school-form',
    note: 'School logistics, no deadline stated.',
    expect: { obligations: 'some', court: 'yours' } },

  // ── Their court. Must stay rare and must stay real. ──
  { id: 'waiting-on-reply',
    note: 'The reader asked; a human owes an answer. The only shape that earns Their court.',
    expect: { obligations: 'some', court: 'theirs', temporalClass: 'waiting_on' } },

  // ── Date formats that broke the anchor validator. ──
  { id: 'anchor-dashed-us-date',
    note: 'Registrar writes the expiry as 07-30-2026. This fixture exists for the date FORMAT — a dashed US date cost a real deadline until the anchor validator learned it. Whether a domain renewal is a deadline or a window is a genuine toss-up in our own taxonomy, so assert the anchor, not the class.',
    expect: { obligations: 'some', court: 'yours', anchorDate: '2026-07-30' } },

  // ── Requests for an opinion, and account plumbing. Neither costs anything to skip. ──
  { id: 'none-survey-newsletter',
    note: "A satisfaction survey. Somebody would like the reader's opinion; nobody is owed anything.",
    expect: { obligations: 'none' } },
  { id: 'none-survey-camp-evaluation',
    note: 'A camp asking for feedback on a session that already happened. Tests that a school or camp asking does not by itself make a request an obligation - the sharpest edge of this rule.',
    expect: { obligations: 'none' } },
  { id: 'none-account-security-notice',
    note: 'Routine sign-in notification. Reads urgent, asks nothing. A genuine breach would be different.',
    expect: { obligations: 'none' } },
  { id: 'none-account-verify-email',
    note: 'Email confirmation that can sit in an account forever at no cost.',
    expect: { obligations: 'none' } },

  // ── Guards: structurally adjacent, and must survive the cut. ──
  { id: 'guard-form-with-date',
    note: 'A form a camp needs back before a child can attend. Same sender type as the evaluation above, opposite answer: this one unlocks something.',
    expect: { obligations: 'some', court: 'yours' } },
  // Hand-written rather than captured — see the fixture's own note.
  { id: 'guard-tax-documents',
    note: 'Institutional document request with the deadline buried past dense rate tables. '
        + 'Guards against a prompt that only notices asks made in the first paragraph.',
    expect: { obligations: 'some', court: 'yours' } },
  { id: 'none-marketing-action-required',
    note: 'Subject line says "Action required: Book your next test". The body is an engagement nudge from a health subscription: no date, no consequence, membership continues either way. Borderline against promo-expiring-credit, and the difference is that a credit has an expiry and this has none.',
    expect: { obligations: 'none' } },
  { id: 'guard-payment-method',
    note: 'Updating a card on a paid service. Looks like account housekeeping; a lapsed card stops the service.',
    expect: { obligations: 'some', court: 'yours' } },

  // ── Nothing to decide, and nothing that changes if skipped. ──
  { id: 'none-optional-conference-proposal',
    note: "A call for session proposals with a firm deadline. Nothing anywhere changes if the reader never submits.",
    expect: { obligations: 'none' } },
  { id: 'none-optional-perk',
    note: 'See the fixture file - hand-written, not captured.',
    expect: { obligations: 'none' } },
  { id: 'none-optional-questions',
    note: "An invitation to send in questions before a session. Optional participation wearing the shape of a reply.",
    expect: { obligations: 'none' } },

  // ── Guards for this round. ──
  { id: 'guard-payment-method-needed',
    note: "Adding a payment method so money owed to the reader can actually reach them. Looks like account setup; there is real money behind it.",
    expect: { obligations: 'some', court: 'yours' } },

  // ── Hand-written: statements, status notices and consent updates are
  //    financial- or health-identifying in their real form. See each fixture. ──
  { id: 'none-statement-to-review',
    note: 'See the fixture file - hand-written, not captured.',
    expect: { obligations: 'none' } },
  { id: 'guard-statement-with-lever',
    note: 'See the fixture file - hand-written, not captured.',
    expect: { obligations: 'some', court: 'yours' } },
  { id: 'none-consent-terms-update',
    note: 'See the fixture file - hand-written, not captured.',
    expect: { obligations: 'none' } },
  { id: 'none-status-notification',
    note: 'See the fixture file - hand-written, not captured.',
    expect: { obligations: 'none' } },

  // ── Enumeration, not classification: one email, several obligations. ──
  { id: 'guard-multi-topic-email',
    note: 'See the fixture file - hand-written. Guards against exclusion rules causing '
        + 'wholesale abandonment of a dense email rather than removal of one part.',
    expect: { obligations: 'some', court: 'yours', atLeast: 3 } },

  // ── A digest is one ambient thing, not a list of obligations. ──
  { id: 'none-newsletter-digest',
    note: 'See the fixture file - hand-written at realistic length. The short stand-in it '
        + 'replaces passed easily while the real newsletter produced four obligations.',
    expect: { obligations: 'none' } },

  // ── Known gaps: reported, not failed. ──
  { id: 'gap-account-verification',
    note: "Account housekeeping with no date and no consequence. Was a known gap until the housekeeping rule landed; kept under its original id because the id is how the corpus is cited.",
    expect: { obligations: 'none' }, knownGap: true },
];
