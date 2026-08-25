import { useEffect, useState } from 'react';
import type { HorizonPayload } from '@weft/shared';
import { clearObligation, fetchHorizon } from './api.js';
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

  // Refetch rather than patch in place: clearing a loop changes the ranking,
  // This Week and the mail order too, and the server is the only thing that
  // knows how. The one card is disabled meanwhile so a double click cannot
  // complete and then immediately reopen.
  const onClear = (id: number, how: 'complete' | 'dismiss' | 'reopen') => {
    setBusy(id);
    clearObligation(id, how)
      .then(fetchHorizon)
      .then(setData)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(null));
  };

  if (error) return <main className="body"><p className="empty">Could not reach the server — {error}</p></main>;
  if (!data) return <main className="body"><p className="empty">Loading…</p></main>;

  const connected = data.accounts.length > 0;
  const open = data.openLoops.yours.length + data.openLoops.theirs.length;

  return (
    <>
      <nav className="tabs">
        <div className="tabs-left">
          <span className="wordmark">Weft</span>
          <span className="tab-active">Horizon</span>
        </div>
      </nav>

      <main className="body">
        <div className="title-row">
          <h1 className="title">{dateLabel(data.date)}</h1>
          <span className="title-meta">
            {connected ? `${data.stats.messagesTotal.toLocaleString()} messages synced` : 'no accounts connected'}
          </span>
        </div>

        <Accounts accounts={data.accounts} />

        <section className="section">
          <span className="section-label">State</span>
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
          <OpenLoops {...data.openLoops} onClear={onClear} busy={busy} />
        </section>

        <section className="section">
          <div className="section-head">
            <span className="section-label">This week</span>
            <span className="section-note">every deadline and event — click any item to open it</span>
          </div>
          <ThisWeek days={data.week} />
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
