import { useEffect, useState } from 'react';
import type { HorizonPayload, Obligation } from '@weft/shared';
import { clearObligation, fetchHorizon, setSubscriptionState } from './api.js';
import { Accounts } from './components/Accounts.js';
import { MailTable } from './components/MailTable.js';
import { ClearedLoops, OpenLoops } from './components/OpenLoops.js';
import { ThisWeek } from './components/ThisWeek.js';

const dateLabel = (iso: string) => {
  if (iso.length > 10) {
    return new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }
  const [year = 1970, month = 1, day = 1] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
};

export function Horizon() {
  const [data, setData] = useState<HorizonPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    fetchHorizon().then(setData).catch((e: unknown) => setError(String(e)));
  }, []);

  /**
   * Strike the card out immediately, then let the server reorder.
   *
   * Clearing a loop changes the ranking, This Week and the mail order, and only
   * the server knows how — but waiting for it to say so made the button feel
   * broken. So the visual state is optimistic and the ordering is authoritative:
   * the strikethrough happens on click, the row moves when the payload returns.
   * If the request fails the refetch puts it back.
   */
  const onClear = (id: number, how: 'complete' | 'dismiss' | 'reopen') => {
    const now = new Date().toISOString();
    const patch = (o: Obligation): Obligation =>
      o.id !== id
        ? o
        : {
            ...o,
            completedAt: how === 'complete' ? now : null,
            dismissedAt: how === 'dismiss' ? now : null,
          };
    setData((d) =>
      d && {
        ...d,
        openLoops: {
          yours: d.openLoops.yours.map(patch),
          theirs: d.openLoops.theirs.map(patch),
          completed: d.openLoops.completed.map(patch),
          dismissed: d.openLoops.dismissed.map(patch),
        },
      },
    );

    setBusy(id);
    clearObligation(id, how)
      .then(fetchHorizon)
      .then(setData)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(null));
  };

  /**
   * Answer a renewal. Recorded against the service rather than this email, so
   * next month's notice does not ask again — and the ledger picks up the same
   * decision, because both surfaces read the same table.
   */
  const onDecide = (o: Obligation, state: 'kept' | 'cancelled') => {
    setBusy(o.id);
    setData((d) =>
      !d
        ? d
        : {
            ...d,
            openLoops: {
              ...d.openLoops,
              yours: d.openLoops.yours.filter((x) => x.id !== o.id),
              theirs: d.openLoops.theirs.filter((x) => x.id !== o.id),
            },
          },
    );
    // The name goes with it: a cancelled service whose last email ages out
    // would otherwise show as a blank row in the collapsed list.
    setSubscriptionState(o.service, state, o.service)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => {
        setBusy(null);
        fetchHorizon().then(setData).catch((e: unknown) => setError(String(e)));
      });
  };

  if (error) return <main className="body"><p className="empty">Could not reach the server — {error}</p></main>;
  if (!data) return <main className="body"><p className="empty">Loading…</p></main>;

  const connected = data.accounts.length > 0;
  const needsAccountAttention = !connected || data.accounts.some((account) => account.needsReconnect);
  const open = data.openLoops.yours.length + data.openLoops.theirs.length;
  const cleared = data.openLoops.completed.length + data.openLoops.dismissed.length;

  return (
    <main className="body-horizon">
      <header className="horizon-brief">
        <div className="horizon-date-row">
          <h1 className="horizon-date">{dateLabel(data.date)}</h1>
          {data.edition?.stale && <span className="horizon-brief-status">rewriting…</span>}
        </div>

        <section aria-label="Daily state brief">
          {data.edition ? (
            <>
              <h2 className="horizon-headline">{data.edition.headline}</h2>
              <div className="horizon-notes">
                {data.edition.notes.map((note, index) => <p key={index}>{note}</p>)}
              </div>
            </>
          ) : connected ? (
            <>
              <h2 className="horizon-headline">Mail is being read in the background.</h2>
              <p className="horizon-empty">This page updates automatically after launch or refresh.</p>
            </>
          ) : (
            <>
              <h2 className="horizon-headline">Connect a mailbox to begin.</h2>
              <p className="horizon-empty">
                Weft asks for read-only access. It cannot label, send, archive or delete anything.
              </p>
            </>
          )}
        </section>

        {needsAccountAttention && <div className="horizon-account-alert"><Accounts accounts={data.accounts} /></div>}
      </header>

      <div className="horizon-grid">
        <section className="horizon-main" aria-label={`${open} open loops`}>
          <OpenLoops
            {...data.openLoops}
            onClear={onClear}
            onDecide={onDecide}
            busy={busy}
            compact
            showCleared={false}
          />

          <div className="horizon-disclosures">
            <details className="horizon-disclosure">
              <summary>
                <span className="disclosure-label">
                  <span className="disclosure-closed">Cleared today · collapsed</span>
                  <span className="disclosure-open">Cleared today · {cleared}</span>
                </span>
                <span className="disclosure-closed">Show</span>
                <span className="disclosure-open">Hide</span>
              </summary>
              {cleared === 0
                ? <p className="horizon-disclosure-empty">Nothing cleared today.</p>
                : <ClearedLoops {...data.openLoops} onClear={onClear} onDecide={onDecide} busy={busy} compact />}
            </details>

            <details className="horizon-disclosure">
              <summary>
                <span className="disclosure-label">
                  <span className="disclosure-closed">Mail · collapsed</span>
                  <span className="disclosure-open">Mail · {data.mail.length}</span>
                </span>
                <span className="disclosure-closed">Show</span>
                <span className="disclosure-open">Hide</span>
              </summary>
              {data.mail.length === 0
                ? <p className="horizon-disclosure-empty">No mail synced yet.</p>
                : <div className="horizon-mail-scroll"><MailTable rows={data.mail} ranked={false} /></div>}
            </details>
          </div>
        </section>

        <aside className="horizon-rail" aria-label="Next seven days">
          <ThisWeek days={data.week} later={data.later} compact />
        </aside>
      </div>
    </main>
  );
}
