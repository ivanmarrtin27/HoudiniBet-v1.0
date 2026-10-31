-- Promo types + pending checkout discount on users.
-- Types: free_days | free_month | discount_20 | discount_40

ALTER TABLE promo_codes ADD COLUMN type TEXT NOT NULL DEFAULT 'free_days';

UPDATE promo_codes
SET type = 'free_days'
WHERE type IS NULL OR TRIM(type) = '';

ALTER TABLE users ADD COLUMN pending_promo_percent INTEGER;
ALTER TABLE users ADD COLUMN pending_promo_code TEXT;
