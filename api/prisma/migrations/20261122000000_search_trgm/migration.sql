-- Typo-tolerant shop search: trigram matching (pg_trgm ships with Postgres and is a trusted extension).
-- Additive: nothing is changed or dropped, so the previous image keeps working.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
