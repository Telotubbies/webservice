-- 0014 - organization settings: URL-safe unique slug, timezone, language.
-- The slug default keeps older inserts (tests, seed) valid; self-serve creation
-- always supplies a chosen slug. Existing rows are backfilled from their id.

ALTER TABLE organizations
  ADD COLUMN slug     text,
  ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Bangkok',
  ADD COLUMN language text NOT NULL DEFAULT 'en';

-- FORCE RLS applies to the table owner too and this migration has no org
-- context, so lift it for the backfill (same transaction, restored below).
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
UPDATE organizations SET slug = 'org-' || left(id::text, 8) WHERE slug IS NULL;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

ALTER TABLE organizations
  ALTER COLUMN slug SET DEFAULT ('org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT organizations_slug_key UNIQUE (slug),
  ADD CONSTRAINT organizations_slug_format
    CHECK (length(slug) BETWEEN 3 AND 40 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT organizations_language_check CHECK (language IN ('en', 'th'));
