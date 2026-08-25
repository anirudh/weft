const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`gmail ${status}: ${message}`);
  }
}

/** Gmail rate-limits per user per second; retry the transient statuses with backoff. */
async function request<T>(accessToken: string, path: string, attempt = 0): Promise<T> {
  const res = await fetch(GMAIL + path, { headers: { authorization: `Bearer ${accessToken}` } });
  if (res.status === 429 || res.status === 403 || res.status >= 500) {
    if (attempt < 5) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 400 + Math.random() * 300));
      return request<T>(accessToken, path, attempt + 1);
    }
  }
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new GmailError(res.status, body.error?.message ?? 'unknown');
  return body;
}

export type GmailProfile = {
  emailAddress: string; messagesTotal: number; threadsTotal: number; historyId: string;
};

/** Identifies which account a token belongs to — avoids needing an extra scope. */
export const getProfile = (accessToken: string) => request<GmailProfile>(accessToken, '/profile');

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string; threadId: string; labelIds?: string[];
  snippet?: string; internalDate?: string; payload?: GmailPart;
};

export async function listMessageIds(
  accessToken: string, query: string, pageToken?: string,
): Promise<{ ids: string[]; nextPageToken?: string }> {
  const qs = new URLSearchParams({ q: query, maxResults: '500' });
  if (pageToken) qs.set('pageToken', pageToken);
  const res = await request<{ messages?: { id: string }[]; nextPageToken?: string }>(
    accessToken, `/messages?${qs}`,
  );
  return { ids: (res.messages ?? []).map((m) => m.id), nextPageToken: res.nextPageToken };
}

export const getMessage = (accessToken: string, id: string) =>
  request<GmailMessage>(accessToken, `/messages/${id}?format=full`);

/** Headers-only fetch. One quota unit instead of five — cheap enough to backfill. */
export function getMessageHeaders(accessToken: string, id: string, names: string[]) {
  const qs = names.map((n) => `metadataHeaders=${encodeURIComponent(n)}`).join('&');
  return request<GmailMessage>(accessToken, `/messages/${id}?format=metadata&${qs}`);
}

/** The only headers the bulk filter classifies on. */
export const BULK_HEADERS = ['List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted'];

const decode = (data: string) => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

const stripHtml = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim();

/** Walks the MIME tree preferring text/plain, falling back to stripped HTML. */
export function extractBody(payload: GmailPart | undefined, limit = 50_000): string {
  if (!payload) return '';
  let plain = '', html = '';
  const walk = (p: GmailPart) => {
    if (p.filename) return; // attachment
    const data = p.body?.data;
    if (data) {
      if (p.mimeType === 'text/plain') plain += decode(data) + '\n';
      else if (p.mimeType === 'text/html') html += decode(data) + '\n';
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  const text = plain.trim() || stripHtml(html);
  return text.replace(/\r/g, '').slice(0, limit);
}

export function headerMap(payload: GmailPart | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of payload?.headers ?? []) out[h.name.toLowerCase()] = h.value;
  return out;
}

/** "Dana Whitlock <dana@x.co>" -> { name, email } */
export function parseAddress(raw: string | undefined): { name: string; email: string } {
  if (!raw) return { name: '', email: '' };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: (m[1] ?? '').trim(), email: (m[2] ?? '').trim().toLowerCase() };
  return { name: '', email: raw.trim().toLowerCase() };
}
