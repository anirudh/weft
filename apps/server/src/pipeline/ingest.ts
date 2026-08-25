import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { accessTokenFor, NeedsReconnectError } from '../google/oauth.js';
import { BULK_HEADERS, extractBody, getMessage, headerMap, listMessageIds, parseAddress } from '../google/gmail.js';

export type SyncProgress = {
  email: string;
  state: 'idle' | 'listing' | 'fetching' | 'done' | 'error';
  fetched: number;
  total: number;
  error?: string;
};

const progress = new Map<number, SyncProgress>();
export const getProgress = () => [...progress.values()];
export const isSyncing = () => [...progress.values()].some((p) => p.state === 'listing' || p.state === 'fetching');

/** Bounded concurrency — Gmail rate-limits per user per second. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        if (item !== undefined) await fn(item);
      }
    }),
  );
}

type Account = { id: number; email: string; refreshToken: string };

/**
 * One-time 30-day pull, run explicitly rather than hidden inside a page load.
 * `newer_than` covers received and sent alike; spam and trash are excluded by
 * default, which is what we want.
 */
export async function backfillAccount(account: Account): Promise<SyncProgress> {
  const p: SyncProgress = { email: account.email, state: 'listing', fetched: 0, total: 0 };
  progress.set(account.id, p);
  const runStart = Date.now();

  const [run] = await db.insert(schema.syncRuns)
    .values({ accountId: account.id, kind: 'backfill', startedAt: runStart })
    .returning({ id: schema.syncRuns.id });

  try {
    const token = await accessTokenFor(account);

    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await listMessageIds(token, `newer_than:${env.BACKFILL_DAYS}d`, pageToken);
      ids.push(...page.ids);
      pageToken = page.nextPageToken;
      p.total = ids.length;
    } while (pageToken);

    // Skip anything already stored so a re-run is cheap and resumable.
    const existing = new Set(
      (await db.select({ gmailId: schema.messages.gmailId })
        .from(schema.messages).where(eq(schema.messages.accountId, account.id)))
        .map((r) => r.gmailId),
    );
    const todo = ids.filter((id) => !existing.has(id));
    p.state = 'fetching';
    p.fetched = ids.length - todo.length;

    await pool(todo, 8, async (id) => {
      const msg = await getMessage(token, id);
      const h = headerMap(msg.payload);
      const from = parseAddress(h.from);
      const body = extractBody(msg.payload);
      const subject = h.subject ?? '';
      const internalDate = Number(msg.internalDate ?? Date.now());
      const labelIds = msg.labelIds ?? [];

      await db.insert(schema.messages).values({
        accountId: account.id,
        gmailId: msg.id,
        threadId: msg.threadId,
        fromName: from.name,
        fromEmail: from.email,
        toEmail: parseAddress(h.to).email,
        subject,
        snippet: msg.snippet ?? '',
        bodyText: body,
        internalDate,
        labelIds: JSON.stringify(labelIds),
        isSent: labelIds.includes('SENT'),
        contentHash: createHash('sha256').update(subject + '\n' + body).digest('hex'),
        headers: JSON.stringify(
          Object.fromEntries(
            BULK_HEADERS.map((n) => [n.toLowerCase(), h[n.toLowerCase()]])
              .filter((e): e is [string, string] => Boolean(e[1]))
              .map(([k, v]) => [k, v.slice(0, 400)]),
          ),
        ),
        headersFetched: true,
      }).onConflictDoNothing();

      p.fetched++;
    });

    await rebuildThreads(account.id);

    await db.update(schema.accounts)
      .set({ backfilledAt: Date.now() })
      .where(eq(schema.accounts.id, account.id));

    p.state = 'done';
    if (run) {
      await db.update(schema.syncRuns)
        .set({ finishedAt: Date.now(), messagesFetched: p.fetched })
        .where(eq(schema.syncRuns.id, run.id));
    }
    return p;
  } catch (err) {
    p.state = 'error';
    p.error = err instanceof NeedsReconnectError ? `${account.email} needs reconnecting` : String(err);
    if (run) {
      await db.update(schema.syncRuns)
        .set({ finishedAt: Date.now(), error: p.error })
        .where(eq(schema.syncRuns.id, run.id));
    }
    return p;
  }
}

/** Derives thread rows from stored messages. Threads are the unit extraction runs on. */
export async function rebuildThreads(accountId: number) {
  const rows = await db
    .select({
      threadId: schema.messages.threadId,
      lastMessageAt: sql<number>`max(internal_date)`,
      messageCount: sql<number>`count(*)`,
      subject: sql<string>`(
        select subject from messages m2
        where m2.account_id = messages.account_id and m2.thread_id = messages.thread_id
        order by m2.internal_date asc limit 1
      )`,
    })
    .from(schema.messages)
    .where(eq(schema.messages.accountId, accountId))
    .groupBy(schema.messages.threadId);

  for (const r of rows) {
    await db.insert(schema.threads).values({
      accountId,
      gmailThreadId: r.threadId,
      subject: r.subject ?? '',
      lastMessageAt: Number(r.lastMessageAt),
      messageCount: Number(r.messageCount),
    }).onConflictDoUpdate({
      target: [schema.threads.accountId, schema.threads.gmailThreadId],
      set: {
        lastMessageAt: Number(r.lastMessageAt),
        messageCount: Number(r.messageCount),
        subject: r.subject ?? '',
      },
    });
  }
  return rows.length;
}
