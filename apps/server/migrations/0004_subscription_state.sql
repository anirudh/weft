-- What the reader has decided about a recurring charge.
--
-- Keyed on the SERVICE, not on an obligation, and that is the whole point.
-- Every renewal notice mints a fresh obligation — one domain in the test
-- mailbox produced four — so a decision recorded against an email is undone by
-- next month's email. Recorded against the service, you decide once.
--
-- Two states, and they are deliberately not the same act:
--
--   kept       You have decided, and the money continues. Stays in the monthly
--              total at full price; stops asking you to decide it again.
--   cancelled  The money stops. Leaves the total, and the row collapses rather
--              than vanishing, so the decision stays reversible and auditable.
--
-- Collapsing these into one "dismiss" would drop a live charge out of the
-- total silently, which is the one number this lens exists to get right.
--
-- Active is the absence of a row. Undo is a DELETE.
CREATE TABLE subscription_state (
  service_key TEXT PRIMARY KEY,
  -- kept | cancelled
  state TEXT NOT NULL,
  -- The display name as it read when decided, so a cancelled row can still be
  -- labelled if no live obligation happens to mention that service any more.
  service_name TEXT NOT NULL DEFAULT '',
  decided_at INTEGER NOT NULL
);
