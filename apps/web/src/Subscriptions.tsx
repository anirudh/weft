import { useCallback, useEffect, useState } from 'react';
import type { Subscription, SubscriptionState, SubscriptionsLens } from '@weft/shared';
import { fetchSubscriptions, setSubscriptionState } from './api.js';
import { cadenceWord, humanDate, money } from './components/Money.js';

/**
 * The subscriptions lens.
 *
 * Horizon shows what needs you today; this shows what you are paying for, which
 * is a different question asked on a different cadence. It is also the only
 * place a renewal a year out can appear — Horizon is a decay function, so it
 * hides anything distant until it is too late to decide.
 */
export function Subscriptions({ onCount }: { onCount?: (n: number) => void }) {
  const [data, setData] = useState<SubscriptionsLens | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const load = useCallback(() => {
    fetchSubscriptions()
      .then((d) => { setData(d); onCount?.(d.activeCount); })
      .catch((e: unknown) => setError(String(e)));
  }, [onCount]);
  useEffect(load, [load]);

  /**
   * The decision lands on screen before the server confirms it.
   *
   * Marking something kept or cancelled re-sorts the list and moves the total,
   * and only the server knows the new numbers — but waiting for it made the
   * button feel broken. So the row's own state flips at once and the payload
   * settles the arithmetic a moment later.
   */
  const decide = (s: Subscription, state: SubscriptionState) => {
    setBusy(s.key);
    setData((d) =>
      !d ? d : { ...d, subscriptions: d.subscriptions.map((x) => (x.key === s.key ? { ...x, state } : x)) },
    );
    setSubscriptionState(s.key, state, s.name)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => { setBusy(null); load(); });
  };

  if (error) return <main className="body"><p className="empty">Could not reach the server — {error}</p></main>;
  if (!data) return <main className="body"><p className="empty">Loading…</p></main>;

  if (data.subscriptions.length === 0 && data.cancelled.length === 0) {
    return (
      <main className="body">
        <h1 className="title">Nothing renewing</h1>
        <p className="empty">No subscription or membership has turned up in your mail.</p>
      </main>
    );
  }

  const yearly = money(data.monthlyTotalCents * 12, data.currency);

  const row = (s: Subscription, cancelled: boolean) => (
    <div key={s.key} className={rowClass(s, cancelled)}>
      <span className={s.daysUntil !== null && s.daysUntil <= 7 && !s.paused && !cancelled ? 'sub-when sub-when-soon' : 'sub-when'}>
        {cancelled ? 'Cancelled' : s.whenLabel}
      </span>
      <span className="sub-name">
        <span className="sub-name-text">{s.name}</span>
        {s.state === 'kept' && <span className="sub-tag">Keeping</span>}
        {s.mergedCount > 1 && <span className="loop-merged">{s.mergedCount} emails</span>}
      </span>
      <span className="sub-meta">
        {/* "Est." is not a hedge for its own sake. Weft reads mail and cannot
            see your account, so a date it worked out from a cadence must never
            look like one an email stated. */}
        {!cancelled && s.nextDate && !s.paused && (s.estimated ? `Est. ${humanDate(s.nextDate)}` : humanDate(s.nextDate))}
      </span>
      <span className="sub-amount">
        {s.amountCents === null ? <span className="sub-unpriced">Not stated</span> : money(s.amountCents, s.currency)}
        {s.amountCents !== null && <span className="sub-cadence">{cadenceWord(s.cadence)}</span>}
        {/* The number that actually matters. $7.99 a week reads cheap;
            $34.62 a month does not, and they are the same subscription. */}
        {s.amountCents !== null && s.cadence !== 'monthly' && s.monthlyCents > 0 && (
          <span className="sub-equiv">{money(s.monthlyCents, s.currency)} a month</span>
        )}
      </span>
      <span className="sub-actions">
        {cancelled || s.state === 'kept' ? (
          <button className="btn-quiet" type="button" disabled={busy === s.key} onClick={() => decide(s, 'active')}>
            Undo
          </button>
        ) : (
          <>
            <button className="btn-faint" type="button" disabled={busy === s.key} onClick={() => decide(s, 'kept')}>
              Keeping
            </button>
            <button className="btn-quiet" type="button" disabled={busy === s.key} onClick={() => decide(s, 'cancelled')}>
              Cancelled
            </button>
          </>
        )}
      </span>
      <span className="sub-manage">
        {!cancelled && (s.manageUrl
          ? <a href={s.manageUrl} target="_blank" rel="noreferrer">{s.manageLabel}</a>
          : <a href={`https://mail.google.com/mail/u/${encodeURIComponent(s.accountEmail)}/#all/${s.threadId}`} target="_blank" rel="noreferrer">Open email</a>)}
      </span>

      {/* A proposal, never an action. Weft cannot see your account, so it shows
          the sentence it is going on and lets you be the one who decides. */}
      {s.proposedCancelled && (
        <span className="sub-note sub-note-ask">
          <span className="sub-note-quote">“{s.proposedCancelled.quote}”</span>
          <a
            className="sub-note-src"
            href={`https://mail.google.com/mail/u/${encodeURIComponent(s.proposedCancelled.accountEmail)}/#all/${s.proposedCancelled.threadId}`}
            target="_blank"
            rel="noreferrer"
          >
            {humanDate(s.proposedCancelled.receivedAt.slice(0, 10))}
          </a>
          <button className="sub-note-act" type="button" disabled={busy === s.key} onClick={() => decide(s, 'cancelled')}>
            Looks cancelled. Confirm?
          </button>
        </span>
      )}

      {/* The contradiction. Weft cannot read your bank, but it can see that a
          renewal notice arrived after you said the money stops. */}
      {s.chargedAfterCancel && (
        <span className="sub-note sub-note-warn">
          Renewal notice arrived {humanDate(s.chargedAfterCancel.receivedAt.slice(0, 10))}, after you marked this cancelled.
          <a
            className="sub-note-src"
            href={`https://mail.google.com/mail/u/${encodeURIComponent(s.chargedAfterCancel.accountEmail)}/#all/${s.chargedAfterCancel.threadId}`}
            target="_blank"
            rel="noreferrer"
          >
            Check it
          </a>
        </span>
      )}
    </div>
  );

  return (
    <main className="body">
      <div className="sub-head">
        <div className="sub-total">
          <span className="section-label">Renewing</span>
          <span className="sub-figure">{money(data.monthlyTotalCents, data.currency)}</span>
          <span className="sub-figure-unit">a month</span>
        </div>
        <p className="sub-gloss">
          across {data.activeCount} {data.activeCount === 1 ? 'subscription' : 'subscriptions'} — {yearly} a year.
          {data.largest && ` ${data.largest.name} is ${Math.round((data.largest.monthlyCents / data.monthlyTotalCents) * 100)}% of it.`}
          {data.unpricedCount > 0 && ` ${data.unpricedCount} more renew at a price no email has stated.`}
          {data.pausedCount > 0 && ` ${data.pausedCount} paused.`}
          {/* Kept is counted in the total on purpose, and said out loud so the
              number is never mistaken for "only the ones I am unsure about". */}
          {data.keptCount > 0 && ` ${data.keptCount} you have decided to keep, still counted.`}
        </p>
      </div>

      <section className="section">
        <div className="subs">{data.subscriptions.map((s) => row(s, false))}</div>

        {data.cancelled.length > 0 && (
          <div className="sub-cancelled">
            <button className="sub-cancelled-toggle" type="button" onClick={() => setShowCancelled((v) => !v)}>
              {data.cancelled.length} cancelled — {showCancelled ? 'hide' : 'show'}
            </button>
            {/* Collapsed rather than deleted. Weft cannot see your account, so
                the only record that you cancelled is this one — and if a
                renewal notice turns up anyway, that is worth knowing. */}
            {showCancelled && <div className="subs">{data.cancelled.map((s) => row(s, true))}</div>}
          </div>
        )}
      </section>
    </main>
  );
}

const rowClass = (s: Subscription, cancelled: boolean) =>
  ['sub', cancelled && 'sub-struck', s.paused && 'sub-paused'].filter(Boolean).join(' ');
