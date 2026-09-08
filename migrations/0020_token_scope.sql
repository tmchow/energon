-- Admin-scoped tokens. NULL means account (every token minted before this column).
-- The Worker also adds this via ensureColumns on a 0005-shaped DB.
ALTER TABLE tokens ADD COLUMN scope TEXT;
