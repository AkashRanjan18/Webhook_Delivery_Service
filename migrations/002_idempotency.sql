
ALTER TABLE messages ADD COLUMN IF NOT EXISTS idempotency_key text;


CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency_key
    ON messages (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
