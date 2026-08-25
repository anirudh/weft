/**
 * Frozen inputs for the brief, so a change to its voice can be compared instead
 * of admired.
 *
 * The extraction corpus asserts structure: did the model find an obligation, in
 * the right court, on the right date. None of that works here, because there is
 * no correct brief. Two good briefs about the same day share no sentences.
 *
 * So these assert the things that are true of every good brief and no bad one:
 * it obeys voice.md's mechanical rules, it stays inside its own shape, and every
 * number in it came from the input. That last one is the important one. A brief
 * is prose about money, and the only failure the reader cannot catch by reading
 * is a figure that was never in their mail.
 *
 * Written by hand rather than captured, because the input to compose is already
 * anonymous: it is titles and labels, not mail.
 */

export type BriefCase = {
  id: string;
  note: string;
  date: string;
  yours: { whenLabel: string; title: string; detail: string }[];
  theirs: { whenLabel: string; title: string; detail: string }[];
  week: { label: string; count: number }[];
  /** Words that would be wrong for this particular day, beyond the global lint. */
  forbid?: string[];
};

const WEEK = (...counts: number[]) =>
  ['Today', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({ label, count: counts[i] ?? 0 }));

export const BRIEF_CASES: BriefCase[] = [
  {
    id: 'money-heavy',
    note: 'Several renewals at once. The brief should total them rather than list them again.',
    date: 'Monday 24 August',
    yours: [
      { whenLabel: 'Closes tomorrow', title: 'Cancel the Notewell Premium trial before renewal', detail: '$6.49/week from 25 August' },
      { whenLabel: 'Closes in 3 days', title: 'Decide on Lightbox before auto-renewal', detail: '$9.25 on 27 August' },
      { whenLabel: 'In 14 days', title: 'Decide on Atlas AI Pro before renewal', detail: '$89.00/month on 7 September' },
      { whenLabel: 'By Thursday', title: 'Reply to the Northgate repurchase offer', detail: 'Offer expires 31 August' },
    ],
    theirs: [],
    week: WEEK(0, 1, 1, 2, 0, 0, 0),
  },
  {
    id: 'one-hard-commitment',
    note: 'A single timed thing among vaguer ones. It should be the thing named first.',
    date: 'Tuesday 8 September',
    yours: [
      { whenLabel: 'By tomorrow', title: 'Confirm attendance for the Brightpath trial class', detail: 'Class is tomorrow at 16:00; confirm 20 minutes before' },
      { whenLabel: 'No date given', title: 'Secure the Meridian account', detail: '' },
      { whenLabel: 'In 11 days', title: 'Submit tax documents to Larkspur Holdings', detail: 'For the dividend payment' },
    ],
    theirs: [],
    week: WEEK(1, 1, 0, 0, 0, 0, 0),
  },
  {
    id: 'empty-stretch',
    note: 'A genuinely clear run. Worth naming, and one of the few things a list cannot show.',
    date: 'Wednesday 16 September',
    yours: [{ whenLabel: 'By Thursday', title: 'Pay the Riverside Club statement balance', detail: '$312.50 due by 17 September' }],
    theirs: [{ whenLabel: 'Worth chasing', title: 'Hear back on the Wildwood waitlist request', detail: 'No answer in 10 days' }],
    week: WEEK(0, 0, 1, 0, 0, 0, 0),
  },
  {
    id: 'nothing-open',
    note: 'The empty case. It must not manufacture significance, and must not congratulate.',
    date: 'Saturday 19 September',
    yours: [],
    theirs: [],
    week: WEEK(0, 0, 0, 0, 0, 0, 0),
    forbid: ['congratulations', 'enjoy', 'relax', 'well deserved', 'nothing to worry'],
  },
  {
    id: 'a-date-has-passed',
    note: 'The forward-facing rule, which is the one most likely to break under a rewrite.',
    date: 'Thursday 24 September',
    yours: [
      { whenLabel: 'Still open?', title: 'Sign and return the Harbour Swim medical waiver', detail: 'Was due 3 September' },
      { whenLabel: 'Do today', title: 'Cast the remote vote for the Larkspur AGM', detail: 'Voting closes today at 17:00' },
    ],
    theirs: [],
    week: WEEK(1, 0, 0, 1, 0, 0, 0),
    forbid: ['should have', 'you were meant to', 'slipped', 'neglected'],
  },
  {
    id: 'their-court-only',
    note: 'Nothing is the readers move. The brief must not invent work for them.',
    date: 'Monday 28 September',
    yours: [],
    theirs: [
      { whenLabel: 'Worth chasing', title: 'Hear back from Northgate about the meeting', detail: 'No answer in 12 days' },
      { whenLabel: 'Just asked', title: 'Hear back on the Brightpath refund', detail: 'Asked yesterday' },
    ],
    week: WEEK(0, 0, 0, 0, 0, 0, 0),
  },
];
