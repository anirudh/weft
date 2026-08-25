import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { backfillAccount, getProgress, isSyncing } from '../pipeline/ingest.js';

export async function syncRoutes(app: FastifyInstance) {
  app.get('/api/sync/status', async () => ({ running: isSyncing(), progress: getProgress() }));

  /**
   * Starts the one-time backfill and returns immediately; the UI polls status.
   * Deliberately not part of a page load — a first pull is minutes, not milliseconds.
   */
  app.post<{ Body?: { accountId?: number } }>('/api/sync/backfill', async (req, reply) => {
    if (isSyncing()) return reply.code(409).send({ error: 'a sync is already running' });

    const accounts = req.body?.accountId
      ? await db.select().from(schema.accounts).where(eq(schema.accounts.id, req.body.accountId))
      : await db.select().from(schema.accounts);

    if (accounts.length === 0) return reply.code(400).send({ error: 'no accounts connected' });

    void (async () => {
      for (const a of accounts) {
        const result = await backfillAccount(a);
        app.log.info({ ...result }, 'backfill finished');
      }
    })();

    return { started: accounts.map((a) => a.email) };
  });
}
