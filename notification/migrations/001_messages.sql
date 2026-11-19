-- The notification service's own database.
--
-- messages: every Telegram message waiting to be sent, and the record of what was sent. Written in the
-- same transaction as the event that caused it, then sent right away and retried until it works.
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id         bigint NOT NULL,
  text            text NOT NULL,
  parse_mode      text,
  reply_markup    jsonb,
  -- The same notification is never queued twice (e.g. "order X confirmed").
  dedupe_key      text UNIQUE,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  last_error      text,
  -- The request and event that caused it, so logs across services can be followed.
  request_id      text,
  source_event_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

CREATE INDEX messages_due_idx ON messages (status, next_attempt_at);
CREATE INDEX messages_created_idx ON messages (created_at);

-- received_events: events from the api we have already handled. A repeat (the api delivers at least once)
-- is recognised here and ignored.
CREATE TABLE received_events (
  event_id    uuid PRIMARY KEY,
  type        text NOT NULL,
  request_id  text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX received_events_received_idx ON received_events (received_at);
