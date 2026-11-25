-- Messages to the owner's group are corrected when the order moves on, instead of going out of date.

-- Telegram's own number of a sent message (NULL: sent before this existed, or with Telegram off).
ALTER TABLE messages ADD COLUMN telegram_message_id bigint;

-- A row that replaces an earlier message: the dedupe_key of that message, and when the change happened.
-- An older change that arrives late must not overwrite a newer one.
ALTER TABLE messages ADD COLUMN edits text;
ALTER TABLE messages ADD COLUMN edit_at timestamptz;
CREATE INDEX messages_edits_idx ON messages (edits) WHERE edits IS NOT NULL;
