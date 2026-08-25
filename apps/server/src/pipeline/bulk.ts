/**
 * Deterministic bulk filter. No model involved — this decides what is worth
 * spending a model call on, so it must be cheap, explainable and auditable.
 * Every decision records a reason.
 */

export type BulkVerdict = { isBulk: boolean; reason: string | null };

export type BulkInput = {
  labelIds: string[];
  headers: Record<string, string>;
  fromEmail: string;
  isSent: boolean;
  /** True when this thread contains a message you sent — you engaged with it. */
  threadHasReply: boolean;
};

const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|alerts?|mailer-daemon|postmaster|bounces?)[-_.@]/i;

export function classify(m: BulkInput): BulkVerdict {
  // Exemptions first — these override every drop rule below.
  if (m.isSent) return { isBulk: false, reason: null };
  // If you replied in this thread you cared about it, whatever its headers say.
  if (m.threadHasReply) return { isBulk: false, reason: null };

  const h = Object.fromEntries(Object.entries(m.headers).map(([k, v]) => [k.toLowerCase(), v]));

  if (m.labelIds.includes('CATEGORY_PROMOTIONS')) return { isBulk: true, reason: 'category:promotions' };
  if (m.labelIds.includes('CATEGORY_SOCIAL')) return { isBulk: true, reason: 'category:social' };

  // Header rules stop here for Updates and Personal.
  //
  // Measured on 1,553 real messages: applying them everywhere dropped 801
  // messages from these two categories, including a school class confirmation
  // due the next day ("precedence: bulk") and order receipts ("no-reply"
  // sender). Transactional senders use the very same headers as marketers —
  // List-Unsubscribe, no-reply addresses, Precedence: bulk — so no header rule
  // can separate "20% off boots" from "your class is tomorrow". That judgement
  // needs the body, which is the extractor's job, not this filter's.
  if (m.labelIds.includes('CATEGORY_UPDATES') || m.labelIds.includes('CATEGORY_PERSONAL')) {
    return { isBulk: false, reason: null };
  }

  const precedence = (h['precedence'] ?? '').toLowerCase();
  if (['bulk', 'list', 'junk'].includes(precedence)) return { isBulk: true, reason: `precedence:${precedence}` };

  if ((h['auto-submitted'] ?? '').toLowerCase().startsWith('auto-')) {
    return { isBulk: true, reason: 'auto-submitted' };
  }

  // A mailing list you can leave is, by definition, not addressed to you personally.
  if (h['list-unsubscribe']) return { isBulk: true, reason: 'list-unsubscribe' };
  if (h['list-id']) return { isBulk: true, reason: 'list-id' };

  if (NO_REPLY.test(m.fromEmail)) return { isBulk: true, reason: 'sender:no-reply' };

  return { isBulk: false, reason: null };
}
