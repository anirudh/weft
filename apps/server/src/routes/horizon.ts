import type { FastifyInstance } from 'fastify';
import type { Bucket, HorizonPayload, Obligation, TemporalClass } from '@weft/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { bucket, daysUntil, score, whenLabel } from '../pipeline/rank.js';
import { dedupe } from '../pipeline/dedupe.js';
import { composeEdition } from '../pipeline/compose.js';
import { renewalIsDistant, serviceKey } from '../pipeline/recurring.js';

const WEEK_DAYS = 7;

export async function horizonRoutes(app: FastifyInstance) {
  app.get('/api/horizon', async (): Promise<HorizonPayload> => {
    const now = Date.now();

    const accounts = await db
      .select({
        email: schema.accounts.email,
        historyId: schema.accounts.historyId,
        backfilledAt: schema.accounts.backfilledAt,
        needsReconnect: schema.accounts.needsReconnect,
        messageCount: sql<number>`(select count(*) from messages where messages.account_id = accounts.id)`,
      })
      .from(schema.accounts);

    const raw = await db
      .select({
        id: schema.obligations.id,
        court: schema.obligations.court,
        temporalClass: schema.obligations.temporalClass,
        anchorDate: schema.obligations.anchorDate,
        anchorIsExplicit: schema.obligations.anchorIsExplicit,
        anchorQuote: schema.obligations.anchorQuote,
        anchorValidated: schema.obligations.anchorValidated,
        title: schema.obligations.title,
        detail: schema.obligations.detail,
        confidence: schema.obligations.confidence,
        service: schema.obligations.service,
        cadence: schema.obligations.cadence,
        completedAt: schema.obligations.completedAt,
        dismissedAt: schema.obligations.dismissedAt,
        sourceMessageId: schema.obligations.sourceMessageId,
        gmailThreadId: schema.threads.gmailThreadId,
        lastMessageAt: schema.threads.lastMessageAt,
        accountEmail: schema.accounts.email,
      })
      .from(schema.obligations)
      .innerJoin(schema.threads, eq(schema.threads.id, schema.obligations.threadId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.obligations.accountId));

    const ranked: Obligation[] = raw.map((o) => {
      const r = { temporalClass: o.temporalClass as TemporalClass, anchorDate: o.anchorDate, lastMessageAt: o.lastMessageAt };
      return {
        id: o.id,
        accountEmail: o.accountEmail,
        threadId: o.gmailThreadId,
        sourceMessageId: o.sourceMessageId,
        court: o.court as 'yours' | 'theirs',
        temporalClass: r.temporalClass,
        anchorDate: o.anchorDate,
        anchorIsExplicit: o.anchorIsExplicit,
        anchorQuote: o.anchorQuote,
        anchorValidated: o.anchorValidated,
        title: o.title,
        detail: o.detail,
        confidence: o.confidence,
        completedAt: o.completedAt ? new Date(o.completedAt).toISOString() : null,
        dismissedAt: o.dismissedAt ? new Date(o.dismissedAt).toISOString() : null,
        service: o.service,
        score: score(r, now),
        bucket: bucket(r, now) as Bucket,
        whenLabel: whenLabel(r, now),
        mergedCount: 1,
      };
    });

    const live = (o: Obligation) => !o.completedAt && !o.dismissedAt;

    // Dedup before slicing to 12, or near-duplicates eat the slots that should
    // hold the next real obligation.
    const open = dedupe(ranked.filter((o) => live(o) && o.bucket !== 'receded'));
    const byScore = (a: Obligation, b: Obligation) => b.score - a.score;

    // Reference and ambient are deliberately absent: findable, never surfaced.
    //
    // Events are absent too, and for a different reason. You do not DO an event,
    // you turn up to it, and This Week already draws them against the days they
    // fall on. Listing them here as well made a task list that was 38% calendar.
    const isEvent = (o: Obligation) => o.temporalClass === 'event';

    // Recurring charges have their own lens, which knows the price, the real
    // next date and where to cancel — everything this card cannot say. Seven of
    // twelve items here were renewals, so the front page was mostly a billing
    // statement.
    //
    // The imminent ones stay. "Cancel before Thursday" is a decision with a
    // deadline, which is exactly what this list is for; a domain renewing in
    // eleven months is not, and belongs in the ledger.
    const SOON_DAYS = 7;

    // A service you have already decided about is not a decision. Both states
    // silence the card and for the same reason: there is nothing left to ask.
    // Keeping it costs money, which the lens goes on reporting — but the front
    // page is for things that still need you.
    const settledServices = new Set(
      (await db.select({ k: schema.subscriptionState.serviceKey }).from(schema.subscriptionState)).map((r) => r.k),
    );

    const cadenceOf = new Map(raw.map((r) => [r.id, r.cadence]));
    const isDistantRenewal = (o: Obligation) => {
      if (!o.service) return false;
      if (settledServices.has(serviceKey(o.service))) return true;
      return renewalIsDistant(o.anchorDate, cadenceOf.get(o.id) ?? '', now, SOON_DAYS);
    };
    const onFrontPage = (o: Obligation) => !isEvent(o) && !isDistantRenewal(o);

    const yours = open.filter((o) => o.court === 'yours' && onFrontPage(o)).sort(byScore).slice(0, 12);
    const theirs = open.filter((o) => o.court === 'theirs' && onFrontPage(o)).sort(byScore).slice(0, 12);

    // Anything cleared in the last day stays on screen so Undo is reachable —
    // a mis-click must never silently bury something real. After that it goes,
    // because Horizon is a view of now, not a log.
    const clearedSince = now - 24 * 60 * 60 * 1000;
    const clearedAt = (o: Obligation) => +new Date((o.completedAt ?? o.dismissedAt)!);
    const cleared = ranked
      .filter((o) => !live(o) && clearedAt(o) >= clearedSince)
      .sort((a, b) => clearedAt(b) - clearedAt(a));
    const completed = cleared.filter((o) => o.completedAt).slice(0, 8);
    const dismissed = cleared.filter((o) => o.dismissedAt).slice(0, 8);

    // This week: seven days from today, deadlines and events only.
    const week = Array.from({ length: WEEK_DAYS }, (_, i) => {
      const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return {
        date: iso,
        label: i === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
        isToday: i === 0,
        items: dedupe(
          ranked.filter(
            (o) => !o.completedAt && o.anchorDate === iso && ['deadline', 'event', 'window'].includes(o.temporalClass),
          ),
        ).map((o) => ({ id: o.id, title: o.title })),
      };
    });

    // Everything the seven-day grid cannot hold. Without this, moving events out
    // of the task list would silently delete both flights, three school first
    // days and an AGM from the page — 15 live commitments, measured.
    const weekEnd = week[week.length - 1]?.date ?? '';
    const later = dedupe(
      ranked.filter(
        (o) => live(o) && isEvent(o) && o.bucket !== 'receded' && (o.anchorDate === null || o.anchorDate > weekEnd),
      ),
    )
      .sort((a, b) => (a.anchorDate ?? '9999').localeCompare(b.anchorDate ?? '9999'))
      .slice(0, 10)
      .map((o) => ({ id: o.id, title: o.title, whenLabel: o.whenLabel }));

    // The brief is written last, from what the reader will actually see. It is
    // cached on a hash of those exact inputs, so re-opening Horizon without new
    // mail costs nothing, and clearing a loop rewrites it.
    const composeStart = Date.now();
    const edition = await composeEdition({
      date: new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
      cursors: accounts.map((a) => a.historyId ?? ''),
      yours,
      theirs,
      week,
    });
    const composeMs = Date.now() - composeStart;
    if (composeMs > 500) app.log.info({ composeMs, composed: Boolean(edition) }, 'edition composed');

    // Mail inherits the relevance of its thread's best obligation, so the table
    // orders by what matters now rather than by arrival.
    const threadScore = new Map<string, number>();
    for (const o of ranked) {
      if (!live(o)) continue;
      threadScore.set(o.threadId, Math.max(threadScore.get(o.threadId) ?? 0, o.score));
    }

    const mailRows = await db
      .select({
        gmailId: schema.messages.gmailId,
        threadId: schema.messages.threadId,
        fromName: schema.messages.fromName,
        fromEmail: schema.messages.fromEmail,
        subject: schema.messages.subject,
        internalDate: schema.messages.internalDate,
        isSent: schema.messages.isSent,
        accountEmail: schema.accounts.email,
      })
      .from(schema.messages)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.messages.accountId))
      .where(eq(schema.messages.isBulk, false))
      .orderBy(desc(schema.messages.internalDate))
      .limit(400);

    const mail = mailRows
      .map((m) => ({
        id: m.gmailId,
        accountEmail: m.accountEmail,
        threadId: m.threadId,
        fromName: m.fromName,
        fromEmail: m.fromEmail,
        subject: m.subject,
        receivedAt: new Date(m.internalDate).toISOString(),
        isSent: m.isSent,
        score: threadScore.get(m.threadId) ?? 0,
      }))
      .sort((a, b) => b.score - a.score || +new Date(b.receivedAt) - +new Date(a.receivedAt))
      .slice(0, 60);

    const [counts] = await db
      .select({
        total: sql<number>`count(*)`,
        kept: sql<number>`sum(case when is_bulk = 0 then 1 else 0 end)`,
        skipped: sql<number>`sum(case when is_bulk = 1 then 1 else 0 end)`,
      })
      .from(schema.messages);

    const [extracted] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.threads)
      .where(eq(schema.threads.extractState, 'done'));

    return {
      date: new Date(now).toISOString(),
      accounts: accounts.map((a) => ({
        email: a.email,
        connected: !a.needsReconnect,
        backfilledAt: a.backfilledAt ? new Date(a.backfilledAt).toISOString() : null,
        messageCount: Number(a.messageCount ?? 0),
        needsReconnect: a.needsReconnect,
      })),
      edition,
      openLoops: { yours, theirs, completed, dismissed },
      week,
      later,
      mail,
      stats: {
        messagesTotal: Number(counts?.total ?? 0),
        messagesKept: Number(counts?.kept ?? 0),
        messagesSkipped: Number(counts?.skipped ?? 0),
        threadsExtracted: Number(extracted?.n ?? 0),
      },
    };
  });
}
