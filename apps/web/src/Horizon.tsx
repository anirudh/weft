import { useEffect, useState } from 'react';
import type { HorizonPayload, Obligation } from '@weft/shared';
import { clearObligation, fetchHorizon, setSubscriptionState } from './api.js';
import { Accounts } from './components/Accounts.js';
import { MailTable } from './components/MailTable.js';
import { OpenLoops } from './components/OpenLoops.js';
import { ThisWeek } from './components/ThisWeek.js';

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

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
  const open = data.openLoops.yours.length + data.openLoops.theirs.length;

  return (
    <>
      <main className="body">
        <div className="title-row">
          <h1 className="title">{dateLabel(data.date)}</h1>
          <span className="title-meta">
            {connected ? `${data.stats.messagesTotal.toLocaleString()} messages synced` : 'no accounts connected'}
          </span>
        </div>

        <Accounts accounts={data.accounts} />

        <section className="section">
          <div className="section-head">
            <span className="section-label">State</span>
            {data.edition?.stale && <span className="section-note">rewriting…</span>}
          </div>
          {data.edition ? (
            <>
              <h2 className="headline">{data.edition.headline}</h2>
              <ol className="notes">
                {data.edition.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ol>
            </>
          ) : connected ? (
            <>
              <h2 className="headline">Nothing read yet.</h2>
              <p className="empty">Pull the last 30 days to see a brief here.</p>
            </>
          ) : (
            <>
              <h2 className="headline">Connect a mailbox to begin.</h2>
              <p className="empty">
                Weft asks for read-only access. It cannot label, send, archive or delete anything.
              </p>
            </>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <span className="section-label">Open loops</span>
            <span className="section-note">
              {open === 0 ? 'nothing open' : `${open} open across ${data.accounts.length} mailboxes`}
            </span>
          </div>
          <OpenLoops
          onDecide={onDecide} {...data.openLoops} onClear={onClear} busy={busy} />
        </section>

        <section className="section">
          <div className="section-head">
            <span className="section-label">This week</span>
            <span className="section-note">every commitment and deadline, by the day it falls on</span>
          </div>
          <ThisWeek days={data.week} later={data.later} />
        </section>

        <section className="section">
          <div className="section-head">
            <span className="section-label">Mail</span>
            <span className="section-note">
              {data.stats.messagesTotal === 0
                ? 'nothing synced yet'
                : `sorted by relevance \u2014 ${data.stats.messagesSkipped.toLocaleString()} bulk messages never shown`}
            </span>
          </div>
          {data.mail.length === 0
            ? <p className="empty">No mail synced yet.</p>
            : <MailTable rows={data.mail} ranked={false} />}
        </section>
      </main>
    </>
  );
}
