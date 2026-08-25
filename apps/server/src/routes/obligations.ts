import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/**
 * Completing and dismissing are the same shape of act — the reader is telling
 * Horizon this loop is closed — but they mean different things and are kept
 * apart deliberately. "Completed" says it got done. "Dismissed" says it will
 * not get done and that is fine. Collapsing them into one button would make the
 * completed list a lie, and the completed list is the only record Weft keeps of
 * what the reader actually did.
 *
 * Both are reversible. Weft has read-only access to Gmail, so nothing here
 * touches the mailbox — these flags live only in the local database.
 */
export async function obligationRoutes(app: FastifyInstance) {
  const set = async (id: number, patch: { completedAt?: number | null; dismissedAt?: number | null }) => {
    const [row] = await db.select({ id: schema.obligations.id }).from(schema.obligations).where(eq(schema.obligations.id, id));
    if (!row) return null;
    await db.update(schema.obligations).set({ ...patch, updatedAt: Date.now() }).where(eq(schema.obligations.id, id));
    return { id };
  };

  app.post<{ Params: { id: string } }>('/api/obligations/:id/complete', async (req, reply) => {
    const r = await set(Number(req.params.id), { completedAt: Date.now(), dismissedAt: null });
    return r ?? reply.code(404).send({ error: 'no such obligation' });
  });

  app.post<{ Params: { id: string } }>('/api/obligations/:id/dismiss', async (req, reply) => {
    const r = await set(Number(req.params.id), { dismissedAt: Date.now(), completedAt: null });
    return r ?? reply.code(404).send({ error: 'no such obligation' });
  });

  /** Undo, for either. A mis-click must never quietly bury something real. */
  app.post<{ Params: { id: string } }>('/api/obligations/:id/reopen', async (req, reply) => {
    const r = await set(Number(req.params.id), { completedAt: null, dismissedAt: null });
    return r ?? reply.code(404).send({ error: 'no such obligation' });
  });
}
