import type { HorizonPayload, SubscriptionState, SubscriptionsLens } from '@weft/shared';

export async function fetchHorizon(): Promise<HorizonPayload> {
  const res = await fetch('/api/horizon');
  if (!res.ok) throw new Error(`horizon ${res.status}`);
  return res.json() as Promise<HorizonPayload>;
}

/** Clearing a loop. Local-only: Weft has read-only Gmail access and never
 *  touches the mailbox — these flags live in the local database. */
export async function clearObligation(id: number, how: 'complete' | 'dismiss' | 'reopen'): Promise<void> {
  const res = await fetch(`/api/obligations/${id}/${how}`, { method: 'POST' });
  if (!res.ok) throw new Error(`${how} ${res.status}`);
}

export async function fetchSubscriptions(): Promise<SubscriptionsLens> {
  const res = await fetch('/api/lens/subscriptions');
  if (!res.ok) throw new Error(`subscriptions ${res.status}`);
  return res.json() as Promise<SubscriptionsLens>;
}

/** Record a decision about a recurring charge. The key is normalised server
 *  side, so a raw service name off an obligation works as well as a lens key. */
export async function setSubscriptionState(
  key: string,
  state: SubscriptionState,
  name?: string,
): Promise<void> {
  const res = await fetch(`/api/lens/subscriptions/${encodeURIComponent(key)}/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, name }),
  });
  if (!res.ok) throw new Error(`subscription state ${res.status}`);
}
