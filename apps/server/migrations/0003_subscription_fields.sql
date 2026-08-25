-- The subscriptions lens needs money as a number, not as prose.
--
-- Until now an amount existed only inside `detail` — "Renews on September 3,
-- 2026 for $2.99". You cannot total a sentence, and you certainly cannot chart
-- one. Three fields, all optional, populated only where an obligation is a
-- recurring commitment.
--
-- `service` is the unit the lens groups by. An obligation is per-email; a
-- subscription is per-service, which is why one domain currently appears three
-- times on Horizon as three separate obligations.
ALTER TABLE obligations ADD COLUMN service TEXT NOT NULL DEFAULT '';
ALTER TABLE obligations ADD COLUMN amount_cents INTEGER;
ALTER TABLE obligations ADD COLUMN currency TEXT NOT NULL DEFAULT '';
-- monthly | weekly | yearly | quarterly | one_off
ALTER TABLE obligations ADD COLUMN cadence TEXT NOT NULL DEFAULT '';

CREATE INDEX obligations_service ON obligations (service) WHERE service <> '';
