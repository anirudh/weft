import type { HorizonPayload } from '@weft/shared';

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
