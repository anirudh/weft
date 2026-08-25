import type { FastifyInstance } from 'fastify';
import type { Subscription, SubscriptionState, SubscriptionsLens } from '@weft/shared';
import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { daysUntil } from '../pipeline/rank.js';
import { monthlyCents as toMonthly, rollForward, serviceKey, type Cadence } from '../pipeline/recurring.js';
import { detectCancellation, namesService } from '../pipeline/cancellation.js';

/**
 * The subscriptions lens.
 *
 * Horizon's unit is the obligation — one email, one thing to do. This lens's
 * unit is the SERVICE, and that difference is the whole point. One domain
 * currently produces three obligations from three separate emails and appears
 * three times on Horizon; here it is one row with a date and a price.
 *
 * It is also the only surface that can show a renewal a year out. Horizon is a
 * decay function, so anything far away scores low and stays hidden until it is
 * imminent — which is exactly when it is too late to decide.
 */

const APPLE = { url: 'https://apps.apple.com/account/subscriptions', label: 'Apple subscriptions' };
const PLAY = { url: 'https://play.google.com/store/account/subscriptions', label: 'Google Play' };
const GOOGLE = { url: 'https://myaccount.google.com/subscriptions', label: 'Google subscriptions' };

/**
 * Where you actually cancel. Read off the BILLER, which is the sender, not off
 * the product name — and the difference is not cosmetic. Plenty of first-party
 * apps can be billed through the other platform's store, and matching on the
 * name then sends you to a cancellation page where the subscription does not
 * exist. A link that confidently wastes your time is worse than no link, so the
 * name is only ever a fallback.
 */
function manageLink(from: string, name: string, detail: string): { url: string; label: string } | null {
  const sender = from.toLowerCase();
  if (/@(.+\.)?google\.com$/.test(sender) && /googleplay/.test(sender)) return PLAY;
  if (/@(.+\.)?apple\.com$/.test(sender) || /@(.+\.)?itunes\.com$/.test(sender)) return APPLE;
  if (/@(.+\.)?google\.com$/.test(sender) || /@(.+\.)?youtube\.com$/.test(sender)) return GOOGLE;

  // No recognised biller in the sender: fall back to the product name, which is
  // right for a first-party service (iCloud) and silent for everything else.
  const hay = `${name} ${detail}`.toLowerCase();
  if (/google play|play store/.test(hay)) return PLAY;
  if (/\bapple\b|icloud|app store|itunes/.test(hay)) return APPLE;
  if (/\bgoogle\b|youtube/.test(hay)) return GOOGLE;
  return null;
}

function label(days: number | null, paused: boolean): string {
  if (paused) return 'Paused';
  if (days === null) return 'No date given';
  if (days < 0) return 'Renewed';
  if (days === 0) return 'Renews today';
  if (days === 1) return 'Renews tomorrow';
  if (days <= 31) return `In ${days} days`;
  if (days <= 60) return 'Next month';
  return `In ${Math.round(days / 30)} months`;
}

/**
 * Which of two emails about the same service should represent it.
 *
 * Written as ordered rules rather than a pile of booleans, because the pile
 * silently produced wrong rows: a projected renewal outranked a date an email
 * had actually stated, simply because the projection happened to fall earlier.
 * The precedence is the whole logic, so it is now the shape of the code.
 */
function beats(next: Subscription, held: Subscription): boolean {
  // 1. Knowing the price is worth more than any date. An unpriced row cannot
  //    join the total, which is the number the whole lens exists to show.
  if ((next.amountCents !== null) !== (held.amountCents !== null)) return next.amountCents !== null;

  // 2. A date is better than none, whatever its provenance.
  if ((next.daysUntil !== null) !== (held.daysUntil !== null)) return next.daysUntil !== null;
  if (next.daysUntil === null || held.daysUntil === null) return false;

  // 3. Stated beats projected. Evidence outranks inference even when the
  //    inference lands sooner: a date rolled forward off last month's notice
  //    must never displace one this month's notice actually gave.
  if (next.estimated !== held.estimated) return !next.estimated;

  // 4. Same footing: the soonest one still ahead, since that is the one you can
  //    still act on.
  return next.daysUntil < held.daysUntil;
}

export async function subscriptionRoutes(app: FastifyInstance) {
  app.get('/api/lens/subscriptions', async (): Promise<SubscriptionsLens> => {
    const now = Date.now();

    const rows = await db
      .select({
        id: schema.obligations.id,
        service: schema.obligations.service,
        amountCents: schema.obligations.amountCents,
        currency: schema.obligations.currency,
        cadence: schema.obligations.cadence,
        anchorDate: schema.obligations.anchorDate,
        detail: schema.obligations.detail,
        gmailThreadId: schema.threads.gmailThreadId,
        accountEmail: schema.accounts.email,
        fromEmail: schema.messages.fromEmail,
        title: schema.obligations.title,
        messageAt: schema.messages.internalDate,
      })
      .from(schema.obligations)
      .innerJoin(schema.threads, eq(schema.threads.id, schema.obligations.threadId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.obligations.accountId))
      // Left: the source message is normally present, but a row must never
      // disappear from the ledger just because its sender cannot be resolved.
      .leftJoin(schema.messages, eq(schema.messages.gmailId, schema.obligations.sourceMessageId))
      // Deliberately NOT filtered on completedAt/dismissedAt. Those close an
      // OBLIGATION — "I dealt with that email" — and a subscription outlives
      // any one email about it. Honouring them here meant clearing the renewal
      // card on Horizon dropped a live charge out of the monthly total with no
      // sign it had gone. What a row is doing here is governed by
      // subscription_state and nothing else.
      .where(sql`${schema.obligations.service} <> ''`);

    const decided = new Map<string, { state: SubscriptionState; name: string; at: number }>(
      (await db.select().from(schema.subscriptionState)).map((r) => [
        r.serviceKey,
        { state: r.state as SubscriptionState, name: r.serviceName, at: r.decidedAt },
      ]),
    );

    // Group by service. Where one service arrives through several emails, the
    // soonest future date wins — that is the one you can still act on.
    const byService = new Map<string, Subscription>();

    for (const r of rows) {
      const key = serviceKey(r.service);
      if (!key) continue;

      const cadence = r.cadence as Cadence;
      const paused = /\bpaused?\b|\bon hold\b|\bfreeze\b/i.test(r.detail);
      const link = manageLink(r.fromEmail ?? '', r.service, r.detail);

      // A stated date that has passed is projected to the next occurrence. A
      // paused subscription is not, because the next charge is exactly the
      // thing that is not happening.
      const rolled = r.anchorDate && !paused ? rollForward(r.anchorDate, cadence, now) : null;
      const nextDate = rolled?.date ?? r.anchorDate;
      const estimated = rolled?.estimated ?? false;
      const days = nextDate ? daysUntil(nextDate, now) : null;

      const next: Subscription = {
        key,
        name: r.service,
        accountEmail: r.accountEmail,
        threadId: r.gmailThreadId,
        nextDate,
        daysUntil: days,
        whenLabel: label(days, paused),
        estimated,
        amountCents: r.amountCents ?? null,
        currency: r.currency || 'USD',
        cadence: r.cadence,
        monthlyCents: r.amountCents ? toMonthly(r.amountCents, cadence) : 0,
        manageUrl: link?.url ?? null,
        manageLabel: link?.label ?? null,
        paused,
        state: decided.get(key)?.state ?? 'active',
        decidedAt: decided.has(key) ? new Date(decided.get(key)!.at).toISOString() : null,
        proposedCancelled: null,
        chargedAfterCancel: null,
        mergedCount: 1,
      };

      const held = byService.get(key);
      if (!held) { byService.set(key, next); continue; }

      held.mergedCount += 1;
      if (beats(next, held)) byService.set(key, { ...next, mergedCount: held.mergedCount });
    }

    const byNextDate = (a: Subscription, b: Subscription) => {
      if (a.paused !== b.paused) return a.paused ? 1 : -1;
      if (a.daysUntil === null) return 1;
      if (b.daysUntil === null) return -1;
      return a.daysUntil - b.daysUntil;
    };

    const all = [...byService.values()].sort(byNextDate);

    // ── Cancellation proposals ───────────────────────────────────────────────
    // Scanned over real mail rather than asked of a model: the question is
    // "does this sentence say it is off", which is exactly the kind of thing
    // code answers the same way twice. Bulk mail is excluded because the
    // marketing that survives the sentence test is all promotional reassurance
    // about signing UP, and the ledger is the second gate: a confirmation for
    // something you do not subscribe to has nothing to attach to.
    const candidates = await db
      .select({
        subject: schema.messages.subject,
        body: schema.messages.bodyText,
        threadId: schema.messages.threadId,
        internalDate: schema.messages.internalDate,
        accountEmail: schema.accounts.email,
      })
      .from(schema.messages)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.messages.accountId))
      .where(and(eq(schema.messages.isBulk, false), sql`${schema.messages.bodyText} like '%cancel%'`));

    for (const c of candidates) {
      const text = `${c.subject}\n${c.body}`;
      const evidence = detectCancellation(text);
      if (!evidence) continue;

      // Attach only to a service this email actually names, and only where you
      // have not already decided — a proposal is for an open question.
      for (const sub of all) {
        if (sub.state !== 'active' || sub.proposedCancelled) continue;
        if (!namesService(text, sub)) continue;
        sub.proposedCancelled = {
          quote: evidence.quote,
          threadId: c.threadId,
          accountEmail: c.accountEmail,
          receivedAt: new Date(c.internalDate).toISOString(),
        };
      }
    }

    // ── Charged after cancel ─────────────────────────────────────────────────
    // The contradiction worth knowing about. An obligation carrying a `service`
    // IS a renewal notice — that is what populates the field — so one dated
    // after you said the money stops means it did not.
    for (const sub of all) {
      if (sub.state !== 'cancelled') continue;
      const since = decided.get(sub.key)?.at ?? 0;
      const later = rows
        .filter((r) => serviceKey(r.service) === sub.key && r.messageAt !== null && r.messageAt > since)
        .sort((a, b) => (b.messageAt ?? 0) - (a.messageAt ?? 0))[0];
      if (!later) continue;
      sub.chargedAfterCancel = {
        title: later.title,
        threadId: later.gmailThreadId,
        accountEmail: later.accountEmail,
        receivedAt: new Date(later.messageAt!).toISOString(),
      };
    }

    // Cancelled leaves the ledger entirely. Kept does not: the money is still
    // going out, so it stays in the total at full price and simply stops being
    // something you are asked about.
    const cancelled = all.filter((s) => s.state === 'cancelled');
    const subscriptions = all.filter((s) => s.state !== 'cancelled');

    const active = subscriptions.filter((s) => !s.paused);
    const priced = active.filter((s) => s.amountCents !== null);
    const monthlyTotalCents = priced.reduce((n, s) => n + s.monthlyCents, 0);

    return {
      monthlyTotalCents,
      currency: priced[0]?.currency ?? 'USD',
      activeCount: active.length,
      unpricedCount: active.length - priced.length,
      pausedCount: subscriptions.length - active.length,
      keptCount: active.filter((s) => s.state === 'kept').length,
      largest: [...priced].sort((a, b) => b.monthlyCents - a.monthlyCents)[0] ?? null,
      subscriptions,
      cancelled,
    };
  });

  /**
   * Record a decision about a service.
   *
   * Reversible in both directions: 'active' deletes the row. Weft has read-only
   * access to Gmail, so marking something cancelled asserts nothing about the
   * outside world — it records what you told it, and can be told otherwise.
   */
  app.put<{ Params: { key: string }; Body: { state?: string; name?: string } }>(
    '/api/lens/subscriptions/:key/state',
    async (req, reply) => {
      // Normalised here rather than at the caller, so Horizon can send the raw
      // service name off an obligation and the lens can send its own key. The
      // function is idempotent, so re-keying a key is a no-op.
      const key = serviceKey(decodeURIComponent(req.params.key));
      const state = req.body?.state;
      if (!key) return reply.code(400).send({ error: 'missing service key' });

      if (state === 'active') {
        await db.delete(schema.subscriptionState).where(eq(schema.subscriptionState.serviceKey, key));
        return { key, state: 'active' };
      }
      if (state !== 'kept' && state !== 'cancelled') {
        return reply.code(400).send({ error: "state must be 'kept', 'cancelled' or 'active'" });
      }

      const row = { serviceKey: key, state, serviceName: req.body?.name ?? '', decidedAt: Date.now() };
      await db
        .insert(schema.subscriptionState)
        .values(row)
        .onConflictDoUpdate({ target: schema.subscriptionState.serviceKey, set: row });
      return { key, state };
    },
  );
}
