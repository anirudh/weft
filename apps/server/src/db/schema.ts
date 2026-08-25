import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Every table carries account_id from the first migration. Retrofitting account
 * scoping later would touch every query, and v0.1 already runs two mailboxes.
 */

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  refreshToken: text('refresh_token').notNull(),
  /** Gmail sync cursor. Null until the first backfill completes. */
  historyId: text('history_id'),
  backfilledAt: integer('backfilled_at'),
  /** Set when the refresh token stops working — surfaced as "reconnect", never a silent failure. */
  needsReconnect: integer('needs_reconnect', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  gmailId: text('gmail_id').notNull(),
  threadId: text('thread_id').notNull(),
  fromName: text('from_name').notNull().default(''),
  fromEmail: text('from_email').notNull().default(''),
  toEmail: text('to_email').notNull().default(''),
  subject: text('subject').notNull().default(''),
  snippet: text('snippet').notNull().default(''),
  bodyText: text('body_text').notNull().default(''),
  internalDate: integer('internal_date').notNull(),
  labelIds: text('label_ids').notNull().default('[]'),
  isSent: integer('is_sent', { mode: 'boolean' }).notNull().default(false),
  /** Set by pipeline/bulk.ts. Bulk mail never reaches the model. */
  isBulk: integer('is_bulk', { mode: 'boolean' }).notNull().default(false),
  /** Why it was dropped, so the filter is auditable rather than magic. */
  bulkReason: text('bulk_reason'),
  contentHash: text('content_hash').notNull(),
  /** Bulk-relevant headers only: list-unsubscribe, precedence, auto-submitted. */
  headers: text('headers').notNull().default('{}'),
  headersFetched: integer('headers_fetched', { mode: 'boolean' }).notNull().default(false),
}, (t) => ({
  uniqPerAccount: uniqueIndex('messages_account_gmail_id').on(t.accountId, t.gmailId),
  byThread: index('messages_thread').on(t.accountId, t.threadId),
  byDate: index('messages_date').on(t.internalDate),
}));

export const threads = sqliteTable('threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  gmailThreadId: text('gmail_thread_id').notNull(),
  subject: text('subject').notNull().default(''),
  lastMessageAt: integer('last_message_at').notNull(),
  messageCount: integer('message_count').notNull().default(0),
  isBulk: integer('is_bulk', { mode: 'boolean' }).notNull().default(false),
  /** pending | done | skipped */
  extractState: text('extract_state').notNull().default('pending'),
  /** Hash of the thread text at extraction time; a change re-queues the thread. */
  extractHash: text('extract_hash'),
  /** True when the thread exceeded the size cap and its middle was dropped. */
  wasCapped: integer('was_capped', { mode: 'boolean' }).notNull().default(false),
}, (t) => ({
  uniqPerAccount: uniqueIndex('threads_account_gmail_id').on(t.accountId, t.gmailThreadId),
  byState: index('threads_extract_state').on(t.extractState),
}));

export const obligations = sqliteTable('obligations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  threadId: integer('thread_id').notNull().references(() => threads.id),
  sourceMessageId: text('source_message_id').notNull().default(''),
  court: text('court').notNull(),
  temporalClass: text('temporal_class').notNull(),
  /** Null whenever the date could not be validated against anchorQuote. */
  anchorDate: text('anchor_date'),
  anchorIsExplicit: integer('anchor_is_explicit', { mode: 'boolean' }).notNull().default(false),
  /** The literal words the model claims the date came from. Checked in code. */
  anchorQuote: text('anchor_quote').notNull().default(''),
  anchorValidated: integer('anchor_validated', { mode: 'boolean' }).notNull().default(false),
  title: text('title').notNull(),
  detail: text('detail').notNull().default(''),
  confidence: real('confidence').notNull().default(0),
  completedAt: integer('completed_at'),
  dismissedAt: integer('dismissed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  byThread: index('obligations_thread').on(t.threadId),
  byOpen: index('obligations_open').on(t.completedAt, t.dismissedAt),
}));

export const editions = sqliteTable('editions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Hash of (sync cursors + open obligation set). Re-opening with no new mail is free. */
  inputHash: text('input_hash').notNull().unique(),
  composedAt: integer('composed_at').notNull(),
  headline: text('headline').notNull(),
  notes: text('notes').notNull().default('[]'),
});

export const syncRuns = sqliteTable('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  /** backfill | incremental */
  kind: text('kind').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  messagesFetched: integer('messages_fetched').notNull().default(0),
  error: text('error'),
});
