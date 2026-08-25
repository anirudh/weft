import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { beginConsent, consumeState, exchangeCode } from '../google/oauth.js';
import { getProfile } from '../google/gmail.js';

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>
   <body style="font:16px/1.5 system-ui;padding:64px;max-width:34rem;color:#0f1420">
   ${body}<p><a href="/" style="color:#17439b">Back to Weft</a></p></body>`;

export async function accountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async () => {
    const rows = await db
      .select({
        id: schema.accounts.id,
        email: schema.accounts.email,
        historyId: schema.accounts.historyId,
        backfilledAt: schema.accounts.backfilledAt,
        needsReconnect: schema.accounts.needsReconnect,
        messageCount: sql<number>`(select count(*) from messages where messages.account_id = accounts.id)`,
      })
      .from(schema.accounts);
    return rows;
  });

  /** Kicks off consent. login_hint lets us aim at a specific mailbox. */
  app.get<{ Querystring: { email?: string } }>('/api/accounts/connect', async (req, reply) => {
    return reply.redirect(beginConsent(req.query.email));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/oauth/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      reply.type('text/html');

      if (error) return reply.code(400).send(page('Weft', `<h2>Consent was declined</h2><p>${error}</p>`));
      if (!consumeState(state)) {
        return reply.code(400).send(page('Weft', '<h2>Stale or unknown request</h2><p>Start the connection again.</p>'));
      }
      if (!code) return reply.code(400).send(page('Weft', '<h2>No authorisation code</h2>'));

      try {
        const { accessToken, refreshToken } = await exchangeCode(code);
        const profile = await getProfile(accessToken);
        const now = Date.now();

        // Re-connecting an existing account replaces its token and clears the flag,
        // but keeps its sync cursor and everything already fetched.
        await db
          .insert(schema.accounts)
          .values({
            email: profile.emailAddress,
            refreshToken,
            historyId: profile.historyId,
            needsReconnect: false,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: schema.accounts.email,
            set: { refreshToken, needsReconnect: false },
          });

        app.log.info({ email: profile.emailAddress, messagesTotal: profile.messagesTotal }, 'account connected');
        return reply.send(
          page('Weft', `<h2>Connected ${profile.emailAddress}</h2>
            <p>${profile.messagesTotal.toLocaleString()} messages in this mailbox.</p>`),
        );
      } catch (err) {
        app.log.error({ err }, 'oauth callback failed');
        return reply.code(500).send(page('Weft', `<h2>Could not connect</h2><pre>${String(err)}</pre>`));
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/accounts/:id', async (req) => {
    await db.delete(schema.accounts).where(eq(schema.accounts.id, Number(req.params.id)));
    return { ok: true };
  });
}
