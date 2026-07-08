# Webhook Delivery Service (mini-Svix)

A reliable webhook delivery service in TypeScript/Node + Postgres. Apps hand it an
event and a destination; it **guarantees delivery even when the receiver is down,
slow, or flaky** — with retries, exponential backoff, crash recovery, HMAC signing,
idempotency, and a dead-letter queue with replay.

The whole point is **reliability**: once the API returns `202`, the event is durably
on disk and *will* be delivered, even if every worker crashes and restarts.

---

## Architecture

```
                          POST /messages
  sender app  ───────────────────────────────►  ┌─────────────────────────┐
  (the client)                                   │   API (Fastify)         │
                                                 │   one transaction:      │
                                                 │   messages + deliveries │
                                                 └───────────┬─────────────┘
                                                             │ (Postgres — durable)
                          ┌──────────────┐      ┌────────────▼───────────┐
                          │   messages   │      │      deliveries        │
                          │ (immutable   │      │ work queue + state     │
                          │  event)      │      │ machine, next_attempt  │
                          └──────────────┘      └────────────┬───────────┘
                                                             │ FOR UPDATE SKIP LOCKED
                                                             ▼
  receiver  ◄──────── POST (signed) ───────────  ┌─────────────────────────┐
  (client's customer)   X-Webhook-Signature      │   worker                │
                                                  │   deliver / retry /     │
                                                  │   backoff / DLQ / reaper│
                                                  └─────────────────────────┘
```

**Two hops:** the sender POSTs an event to the API (hop 1); the worker later POSTs it
onward to the receiver's registered URL (hop 2). The API and worker are **separate
processes** so delivery load/failures never affect the accept path.

### Why the API just says "202 accepted" and doesn't deliver

Reliability. The API's only job is to record the event durably and acknowledge.
Actual delivery happens later in the background worker. Even if every worker is down,
the event is safely on disk and will be delivered when they recover. The `COMMIT` of
that one transaction *is* the durability guarantee.

---

## Reliability mechanisms

| Concern | Mechanism |
|---|---|
| Many workers, no double-processing | `FOR UPDATE SKIP LOCKED` claim — workers skip locked rows instead of waiting |
| Receiver down/slow | Exponential backoff with a cap and full jitter (no thundering herd) |
| Worker crashes mid-delivery | Lease (`locked_at`) + a reaper that resets stale `in_progress` rows |
| Slow/hung receiver | Per-request timeout via `AbortController` |
| Give up gracefully | After `MAX_ATTEMPTS`, move to a `dead` state (dead-letter queue) |
| Recover dead messages | `GET /deliveries/dead` + `POST /deliveries/:id/replay` |
| Client retries `POST /messages` | Idempotency-Key + partial unique index + `ON CONFLICT DO NOTHING` |
| Receiver trusts the webhook | HMAC-SHA256 signature over `timestamp.body`, sent as a header |
| Receiver dedupes our retries | Stable `X-Webhook-Id` header (delivery is at-least-once) |

---

## Tech stack

- **TypeScript + Node** (strict, ESM/NodeNext)
- **Fastify** — HTTP API with schema validation and structured logging
- **Postgres** (via `pg`) — durable store *and* the job queue (no separate broker)
- **Docker Compose** — local Postgres
- Raw SQL migrations run by a tiny script; `node:test` for tests. Minimal dependencies.

---

## Run it

```bash
docker compose up -d          # start Postgres
npm install
npm run migrate               # apply the schema
```

Then, in separate terminals:

```bash
npm run dev                   # API on :3000
npm run worker                # background delivery worker
FAIL_RATE=0 npm run receiver  # a test receiver on :4000 (set FAIL_RATE=0.5 to see retries)
```

### Try it

```bash
# register a destination (the receiver)
curl -X POST localhost:3000/endpoints \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:4000","secret":"testsecret"}'

# enqueue an event (use the id from above)
curl -X POST localhost:3000/messages \
  -H 'Content-Type: application/json' \
  -d '{"endpoint_id":"<id>","payload":{"event":"user.created","id":42}}'
```

Watch the **receiver** terminal print the webhook arriving with a verified signature.

---

## API

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness check |
| `POST /endpoints` | Register a destination `{ url, secret }` → `{ id }` |
| `POST /messages` | Enqueue an event `{ endpoint_id, payload }` → `202 { message_id }`. Honors optional `Idempotency-Key` header |
| `GET /deliveries/dead` | List the dead-letter queue |
| `POST /deliveries/:id/replay` | Re-queue a dead delivery for a fresh set of attempts |

---

## Testing

```bash
npm test                 # unit tests (backoff, signing) — no DB needed
npm run test:integration # integration tests — needs Postgres up + migrated
```

Integration tests exercise the pipeline against a real Postgres: durable accept,
idempotency dedupe, the claim state machine, retry scheduling, dead-letter, replay,
and the crash reaper.

---

## Benchmark

```bash
# with API + worker + receiver running:
COUNT=1000 FAIL_RATE=0.3 npm run benchmark
```

Enqueues `COUNT` messages, then measures how long the worker takes to drive them all
to a terminal state, reporting enqueue/delivery throughput and delivery latency
(p50/p95/p99) — even under an injected receiver failure rate.

```
─── results (example) ─────────────────────
messages:            1000
enqueue throughput:  ~X/s
time to deliver all: ~Ys
delivery throughput: ~Z/s
status breakdown:    succeeded 1000
delivery latency:    p50 .. / p95 .. / p99 ..
────────────────────────────────────────────
```
*(Fill in with your machine's real numbers after a run.)*

---

## Design decisions & trade-offs

- **Postgres as the queue, not Kafka/Redis.** At this scale, `SKIP LOCKED` gives a
  correct concurrent queue with one dependency and full durability. A broker would add
  operational weight without a clear win here.
- **At-least-once, not exactly-once.** If a receiver processes a request but its `2xx`
  response is lost, we retry and may deliver twice. That's why we sign a stable
  `X-Webhook-Id` — receivers dedupe on it. Claiming exactly-once would be dishonest.
- **Increment `attempt_count` on claim, not on result** — a worker that crashes
  mid-delivery still "spends" an attempt, so a poison message can't retry forever.
- **Schema designed ahead** (`locked_at`, `last_error`) so the worker and DLQ needed no
  later migration.

### Known follow-ups
- Encrypt endpoint secrets at rest (currently plaintext).
- Migration-tracking table (currently migrations are idempotent and re-runnable).
- Topic/subscription fan-out (one event → many endpoints).
- Metrics endpoint (queue depth, success rate, oldest pending).

---

## Roadmap

- [x] Module 1 — durable accept + schema (API, `messages`, `deliveries`)
- [x] Module 2 — worker: claim (`SKIP LOCKED`), deliver, retries + backoff, reaper
- [x] Module 3 — idempotency + HMAC signing
- [x] Module 4 — dead-letter queue + replay
- [x] Module 5 — failure-simulation receiver, tests + benchmark
