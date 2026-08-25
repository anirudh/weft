import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { accessTokenFor } from '../google/oauth.js';
import { BULK_HEADERS, getMessageHeaders, headerMap } from '../google/gmail.js';
import { classify } from './bulk.js';

export type HeaderFillProgress = { state: 'idle' | 'running' | 'done' | 'error'; done: number; total: number; error?: string };
let headerProgress: HeaderFillProgress = { state: 'idle', done: 0, total: 0 };
export const getHeaderProgress = () => headerProgress;

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; if (it !== undefined) await fn(it); }
  }));
}

/** Backfills the bulk-relevant headers that the first ingest didn't keep. */
export async function fillMissingHeaders(): Promise<HeaderFillProgress> {
  const accounts = await db.select().from(schema.accounts);
  const pending = await db
    .select({ id: schema.messages.id, gmailId: schema.messages.gmailId, accountId: schema.messages.accountId })
    .from(schema.messages)
    .where(eq(schema.messages.headersFetched, false));

  headerProgress = { state: 'running', done: 0, total: pending.length };
  try {
    for (const account of accounts) {
      const mine = pending.filter((m) => m.accountId === account.id);
      if (mine.length === 0) continue;
      const token = await accessTokenFor(account);
      await pool(mine, 10, async (m) => {
        const msg = await getMessageHeaders(token, m.gmailId, BULK_HEADERS);
        const h = headerMap(msg.payload);
        const kept: Record<string, string> = {};
        for (const name of BULK_HEADERS) {
          const v = h[name.toLowerCase()];
          if (v) kept[name.toLowerCase()] = v.slice(0, 400);
        }
        await db.update(schema.messages)
          .set({ headers: JSON.stringify(kept), headersFetched: true })
          .where(eq(schema.messages.id, m.id));
        headerProgress.done++;
      });
    }
    headerProgress.state = 'done';
  } catch (err) {
    headerProgress = { ...headerProgress, state: 'error', error: String(err) };
  }
  return headerProgress;
}

/** Classifies every message and marks threads bulk only when all their mail is. */
export async function runBulkFilter() {
  const rows = await db
    .select({
      id: schema.messages.id,
      accountId: schema.messages.accountId,
      threadId: schema.messages.threadId,
      labelIds: schema.messages.labelIds,
      headers: schema.messages.headers,
      fromEmail: schema.messages.fromEmail,
      isSent: schema.messages.isSent,
    })
    .from(schema.messages);

  const repliedThreads = new Set(
    (await db.selectDistinct({ t: schema.messages.threadId })
      .from(schema.messages).where(eq(schema.messages.isSent, true))).map((r) => r.t),
  );

  let kept = 0, dropped = 0;
  for (const m of rows) {
    const verdict = classify({
      labelIds: JSON.parse(m.labelIds) as string[],
      headers: JSON.parse(m.headers) as Record<string, string>,
      fromEmail: m.fromEmail,
      isSent: m.isSent,
      threadHasReply: repliedThreads.has(m.threadId),
    });
    verdict.isBulk ? dropped++ : kept++;
    await db.update(schema.messages)
      .set({ isBulk: verdict.isBulk, bulkReason: verdict.reason })
      .where(eq(schema.messages.id, m.id));
  }

  // A thread is bulk only if every message in it is — one real reply rescues it.
  await db.run(sql`
    update threads set is_bulk = (
      select case when count(*) = sum(is_bulk) then 1 else 0 end
      from messages
      where messages.account_id = threads.account_id
        and messages.thread_id = threads.gmail_thread_id
    )`);

  return { kept, dropped, total: rows.length };
}

export async function bulkAudit() {
  const byReason = await db
    .select({ reason: schema.messages.bulkReason, n: sql<number>`count(*)` })
    .from(schema.messages)
    .where(eq(schema.messages.isBulk, true))
    .groupBy(schema.messages.bulkReason);

  const sampleDropped = await db
    .select({ subject: schema.messages.subject, fromName: schema.messages.fromName, reason: schema.messages.bulkReason })
    .from(schema.messages).where(eq(schema.messages.isBulk, true)).limit(12);

  const sampleKept = await db
    .select({ subject: schema.messages.subject, fromName: schema.messages.fromName })
    .from(schema.messages)
    .where(and(eq(schema.messages.isBulk, false), isNull(schema.messages.bulkReason)))
    .limit(12);

  const [threadCounts] = await db
    .select({
      total: sql<number>`count(*)`,
      keep: sql<number>`sum(case when is_bulk = 0 then 1 else 0 end)`,
    })
    .from(schema.threads);

  return { byReason, sampleDropped, sampleKept, threads: threadCounts };
}
