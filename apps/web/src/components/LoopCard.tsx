import type { Obligation } from '@weft/shared';
import { Circle, X } from 'lucide-react';

type Props = {
  o: Obligation;
  primary: boolean;
  onClear: (id: number, how: 'complete' | 'dismiss' | 'reopen') => void;
  /** Only for recurring charges: records the decision against the SERVICE, so
   *  next month's renewal email does not bring the same card back. */
  onDecide: (o: Obligation, state: 'kept' | 'cancelled') => void;
  busy: boolean;
  compact?: boolean;
};

/** One open loop. Open left, the two ways to close it right — per the final design. */
export function LoopCard({ o, primary, onClear, onDecide, busy, compact = false }: Props) {
  const done = Boolean(o.completedAt);
  const dropped = Boolean(o.dismissedAt);
  const cleared = done || dropped;
  const gmail = `https://mail.google.com/mail/u/${encodeURIComponent(o.accountEmail)}/#all/${o.threadId}`;

  const className = cleared ? 'loop loop-done' : primary ? 'loop loop-primary' : 'loop';
  const displayTitle = o.detail && !o.title.toLocaleLowerCase().includes(o.detail.toLocaleLowerCase())
    ? `${o.title} — ${o.detail}`
    : o.title;

  if (compact) {
    return (
      <div className={cleared ? 'loop-row loop-row-cleared' : 'loop-row'}>
        {cleared ? (
          <button
            className="loop-row-undo"
            type="button"
            disabled={busy}
            onClick={() => onClear(o.id, 'reopen')}
          >
            Undo
          </button>
        ) : o.service ? (
          <span className="loop-row-spacer" aria-hidden="true" />
        ) : (
          <button
            className="loop-complete"
            type="button"
            disabled={busy}
            onClick={() => onClear(o.id, 'complete')}
            aria-label={`Mark ${o.title} as completed`}
            title="Mark as completed"
          >
            <Circle aria-hidden="true" size={16} strokeWidth={1.25} />
          </button>
        )}

        <span className="loop-row-copy">
          <a className="loop-row-title" href={gmail} target="_blank" rel="noreferrer" title={displayTitle}>
            {displayTitle}
          </a>
          <span className="loop-row-meta">
            {done ? 'Completed' : dropped ? 'Dismissed' : o.whenLabel}
            {o.mergedCount > 1 && ` · ${o.mergedCount} emails`}
          </span>
        </span>

        {cleared ? null : o.service ? (
          <span className="loop-row-decisions">
            <button type="button" disabled={busy} onClick={() => onDecide(o, 'kept')}>Keeping</button>
            <button type="button" disabled={busy} onClick={() => onDecide(o, 'cancelled')}>Cancelled</button>
          </span>
        ) : (
          <button
            className="loop-dismiss"
            type="button"
            disabled={busy}
            onClick={() => onClear(o.id, 'dismiss')}
            aria-label={`Dismiss ${o.title}`}
            title="Dismiss locally — nothing changes in Gmail"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="loop-top">
        <span className={primary && !cleared ? 'loop-when loop-when-now' : 'loop-when'}>
          {done ? 'Completed' : dropped ? 'Dismissed' : o.whenLabel}
        </span>
        <span className="loop-account">
          {o.mergedCount > 1 && <span className="loop-merged">{o.mergedCount} emails</span>}
          {o.accountEmail}
        </span>
      </div>
      <span className={cleared ? 'loop-title loop-title-done' : 'loop-title'}>{o.title}</span>
      {o.detail && !cleared && <span className="loop-detail">{o.detail}</span>}
      <div className="loop-actions">
        <a className="btn" href={gmail} target="_blank" rel="noreferrer">Open</a>
        <span className="loop-clear">
          {cleared ? (
            <button className="btn-quiet" type="button" disabled={busy} onClick={() => onClear(o.id, 'reopen')}>
              Undo
            </button>
          ) : o.service ? (
            /* A renewal is answered, not completed. "Mark as completed" would
               close this email and leave the subscription untouched, so the
               same card returns next month — and the ledger would still be
               waiting on the same question. These two settle it for good. */
            <>
              <button className="btn-faint" type="button" disabled={busy} onClick={() => onDecide(o, 'kept')}>
                Keeping
              </button>
              <button className="btn-quiet" type="button" disabled={busy} onClick={() => onDecide(o, 'cancelled')}>
                Cancelled
              </button>
            </>
          ) : (
            <>
              {/* Dismiss sits left and quieter: it is the rarer choice, and it
                  must never be the one you hit by muscle memory. */}
              <button className="btn-faint" type="button" disabled={busy} onClick={() => onClear(o.id, 'dismiss')}>
                Dismiss
              </button>
              <button className="btn-quiet" type="button" disabled={busy} onClick={() => onClear(o.id, 'complete')}>
                Mark as completed
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
