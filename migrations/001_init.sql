

CREATE TABLE IF NOT EXISTS endpoints (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    url        text        NOT NULL,
    secret     text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id uuid        NOT NULL REFERENCES endpoints (id),
    payload     jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS deliveries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      uuid        NOT NULL REFERENCES messages (id),
    status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'succeeded', 'failed', 'dead')),
    attempt_count   integer     NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_at       timestamptz,          -- lease timestamp, set when a worker claims the row (Module 2)
    last_error      text,                 -- last failure reason, for debugging / DLQ
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS idx_deliveries_status_next_attempt
    ON deliveries (status, next_attempt_at);
