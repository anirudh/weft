import { useEffect, useState } from 'react';
import { Horizon } from './Horizon.js';
import { Subscriptions } from './Subscriptions.js';
import { fetchSubscriptions } from './api.js';

type Tab = 'horizon' | 'subscriptions';

/**
 * The shell that holds the lenses.
 *
 * Horizon is not one of them. It is the front page — what needs you today,
 * whatever it happens to be about. A lens is a standing question you keep
 * asking of the same mail ("what am I paying for?"), and it earns a tab because
 * it has its own unit, its own shape and its own cadence of being read.
 *
 * The Subscriptions tab is always present once anything recurring has been
 * found. A tab that appears and disappears with the data is a tab you cannot
 * learn: you go looking for the thing you saw yesterday and the door is gone.
 */
export function App() {
  const [tab, setTab] = useState<Tab>('horizon');
  const [subCount, setSubCount] = useState<number | null>(null);

  // The count is the tab's whole justification, so it is fetched at the shell
  // rather than inside the lens — the nav has to know before you click.
  useEffect(() => {
    fetchSubscriptions()
      .then((d) => setSubCount(d.activeCount))
      .catch(() => setSubCount(0));
  }, []);

  const tabClass = (t: Tab) => (t === tab ? 'tab-active' : 'tab');

  return (
    <>
      <nav className="tabs">
        <div className="tabs-left">
          <span className="wordmark">Weft</span>
          <button type="button" className={tabClass('horizon')} onClick={() => setTab('horizon')}>
            Horizon
          </button>
          {subCount !== null && subCount > 0 && (
            <button type="button" className={tabClass('subscriptions')} onClick={() => setTab('subscriptions')}>
              Subscriptions
              <span className="tab-count">{subCount}</span>
            </button>
          )}
        </div>
      </nav>

      {/* The lens reports its own count back up, so a decision made inside it
          moves the badge immediately instead of leaving a stale number until
          the next reload. */}
      {tab === 'horizon' ? <Horizon /> : <Subscriptions onCount={setSubCount} />}
    </>
  );
}
