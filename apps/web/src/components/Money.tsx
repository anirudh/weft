/** Cents to something readable. Money is the whole point of this lens, so it is
 *  never rounded away — $2.99 and $189.00 both appear in full. */
export function money(cents: number, currency = 'USD'): string {
  const symbol = { USD: '$', GBP: '£', EUR: '€', INR: '₹' }[currency] ?? '$';
  return `${symbol}${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CADENCE_WORD: Record<string, string> = {
  monthly: 'a month', weekly: 'a week', yearly: 'a year',
  quarterly: 'a quarter', one_off: 'once',
};
export const cadenceWord = (c: string): string => CADENCE_WORD[c] ?? '';

/** `new Date('2026-09-07')` is parsed as UTC and renders as the 6th for anyone
 *  west of Greenwich. Every date in this app is a local calendar day. */
export function humanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  // The year appears only when it is not this one. A renewal 11 months out
  // reading "29 July" invites you to think it has already gone.
  const sameYear = y === new Date().getFullYear();
  return new Date(y, m - 1, d).toLocaleDateString('en-GB',
    sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
}
