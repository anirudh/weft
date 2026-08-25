import { OAuth2Client } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '../env.js';
import { db, schema } from '../db/index.js';

export function oauthClient() {
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  });
}

/** Short-lived CSRF state. In-memory is fine: single user, single process. */
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

export function beginConsent(loginHint?: string): string {
  for (const [s, at] of pendingStates) if (Date.now() - at > STATE_TTL_MS) pendingStates.delete(s);

  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());

  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    // Forces a refresh token even when this account has consented before.
    prompt: 'consent',
    scope: env.GOOGLE_SCOPES.split(/[\s,]+/).filter(Boolean),
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
}

export function consumeState(state: string | undefined): boolean {
  if (!state || !pendingStates.has(state)) return false;
  pendingStates.delete(state);
  return true;
}

export async function exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string }> {
  const { tokens } = await oauthClient().getToken(code);
  if (!tokens.access_token) throw new Error('no access_token in token response');
  if (!tokens.refresh_token) {
    // Without this we cannot sync tomorrow. Better to fail loudly at connect time.
    throw new Error('no refresh_token returned — consent must use prompt=consent and access_type=offline');
  }
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

export class NeedsReconnectError extends Error {
  constructor(public readonly email: string) {
    super(`${email} needs to be reconnected`);
  }
}

/**
 * A fresh access token for an account. On invalid_grant the refresh token is
 * dead — most likely the 7-day expiry that applies while the OAuth consent
 * screen is in Testing. We flag the account rather than failing silently.
 */
export async function accessTokenFor(account: { id: number; email: string; refreshToken: string }): Promise<string> {
  const client = oauthClient();
  client.setCredentials({ refresh_token: account.refreshToken });
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('empty access token');
    if (account.id) {
      await db.update(schema.accounts).set({ needsReconnect: false }).where(eq(schema.accounts.id, account.id));
    }
    return token;
  } catch (err) {
    const msg = String(err);
    if (msg.includes('invalid_grant') || msg.includes('invalid_request')) {
      await db.update(schema.accounts).set({ needsReconnect: true }).where(eq(schema.accounts.id, account.id));
      throw new NeedsReconnectError(account.email);
    }
    throw err;
  }
}
