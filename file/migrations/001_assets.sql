-- The file service's own database: a record of every image and file it stores.
-- Blobs live on disk or S3; this table says what is there, how big it is, and when it arrived.
CREATE TABLE assets (
  storage_key  text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('image', 'file')),
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes >= 0),
  width        integer,
  height       integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assets_kind_created_idx ON assets (kind, created_at DESC);
