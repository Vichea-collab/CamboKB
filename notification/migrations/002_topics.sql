-- Forum topics in the owner's group: one topic per kind of alert ("New orders", "Payments", ...).
-- Telegram gives each topic a thread id; we remember it so the topic is created once, not per message.
CREATE TABLE topics (
  chat_id    bigint NOT NULL,
  key        text NOT NULL,
  thread_id  integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, key)
);

-- Which topic a queued message belongs in (NULL: no topic, e.g. a customer's private chat).
ALTER TABLE messages ADD COLUMN topic text;
