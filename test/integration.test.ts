import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { pool, query } from "../src/db.js";
import {
  claimDeliveries,
  markSucceeded,
  markFailed,
  markDead,
  listDead,
  replayDelivery,
  reapStale,
} from "../src/repository.js";

// NOTE: this hits the real database (docker compose up + npm run migrate first).
// It truncates tables between tests, so point it at a dev/test DB, not production.

let app: FastifyInstance;

before(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await query("TRUNCATE deliveries, messages, endpoints RESTART IDENTITY CASCADE");
});

// Helper: create an endpoint row and return its id.
async function createEndpoint(url = "http://localhost:4000", secret = "testsecret") {
  const res = await app.inject({
    method: "POST",
    url: "/endpoints",
    payload: { url, secret },
  });
  assert.equal(res.statusCode, 201);
  return res.json().id as string;
}

// Helper: directly insert a delivery and return its id (bypassing the API).
async function seedDelivery(endpointId: string) {
  const m = await query<{ id: string }>(
    "INSERT INTO messages (endpoint_id, payload) VALUES ($1, $2) RETURNING id",
    [endpointId, { hello: "world" }],
  );
  const d = await query<{ id: string }>(
    "INSERT INTO deliveries (message_id) VALUES ($1) RETURNING id",
    [m.rows[0].id],
  );
  return { messageId: m.rows[0].id, deliveryId: d.rows[0].id };
}

test("POST /messages durably creates a pending delivery (202)", async () => {
  const endpointId = await createEndpoint();

  const res = await app.inject({
    method: "POST",
    url: "/messages",
    payload: { endpoint_id: endpointId, payload: { event: "user.created" } },
  });
  assert.equal(res.statusCode, 202);
  const { message_id } = res.json();

  const { rows } = await query<{ status: string; attempt_count: number }>(
    "SELECT status, attempt_count FROM deliveries WHERE message_id = $1",
    [message_id],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].attempt_count, 0);
});

test("same idempotency key does not enqueue twice", async () => {
  const endpointId = await createEndpoint();
  const headers = { "idempotency-key": "order-42" };
  const payload = { endpoint_id: endpointId, payload: { n: 1 } };

  const r1 = await app.inject({ method: "POST", url: "/messages", headers, payload });
  const r2 = await app.inject({ method: "POST", url: "/messages", headers, payload });

  // Same message returned both times.
  assert.equal(r1.json().message_id, r2.json().message_id);

  // Exactly one delivery, not two.
  const { rows } = await query<{ c: number }>(
    "SELECT count(*)::int AS c FROM deliveries WHERE message_id = $1",
    [r1.json().message_id],
  );
  assert.equal(rows[0].c, 1);
});

test("claim marks in_progress, increments attempt, and returns delivery data", async () => {
  const endpointId = await createEndpoint("http://localhost:4000", "s3cr3t");
  const { deliveryId, messageId } = await seedDelivery(endpointId);

  const claimed = await claimDeliveries(50);
  const mine = claimed.find((c) => c.id === deliveryId);

  assert.ok(mine, "our delivery was claimed");
  assert.equal(mine.attempt_count, 1, "attempt incremented on claim");
  assert.equal(mine.message_id, messageId);
  assert.equal(mine.url, "http://localhost:4000");
  assert.equal(mine.secret, "s3cr3t");

  const { rows } = await query<{ status: string }>(
    "SELECT status FROM deliveries WHERE id = $1",
    [deliveryId],
  );
  assert.equal(rows[0].status, "in_progress");
});

test("markSucceeded sets status to succeeded", async () => {
  const endpointId = await createEndpoint();
  const { deliveryId } = await seedDelivery(endpointId);

  await markSucceeded(deliveryId);

  const { rows } = await query<{ status: string }>(
    "SELECT status FROM deliveries WHERE id = $1",
    [deliveryId],
  );
  assert.equal(rows[0].status, "succeeded");
});

test("markFailed returns to pending and schedules a future retry", async () => {
  const endpointId = await createEndpoint();
  const { deliveryId } = await seedDelivery(endpointId);

  const future = new Date(Date.now() + 60_000);
  await markFailed(deliveryId, "HTTP 503", future);

  const { rows } = await query<{ status: string; next_attempt_at: Date; last_error: string }>(
    "SELECT status, next_attempt_at, last_error FROM deliveries WHERE id = $1",
    [deliveryId],
  );
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].last_error, "HTTP 503");
  assert.ok(new Date(rows[0].next_attempt_at).getTime() > Date.now(), "scheduled in the future");
});

test("dead delivery appears in the DLQ and can be replayed", async () => {
  const endpointId = await createEndpoint();
  const { deliveryId } = await seedDelivery(endpointId);

  await markDead(deliveryId, "gave up");

  const dead = await listDead(50);
  assert.ok(dead.some((d) => d.id === deliveryId), "shows up in the dead-letter queue");

  const replayed = await replayDelivery(deliveryId);
  assert.equal(replayed, true);

  const { rows } = await query<{ status: string; attempt_count: number }>(
    "SELECT status, attempt_count FROM deliveries WHERE id = $1",
    [deliveryId],
  );
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].attempt_count, 0, "attempt budget reset on replay");
});

test("replay of a non-dead delivery is a no-op (returns false)", async () => {
  const endpointId = await createEndpoint();
  const { deliveryId } = await seedDelivery(endpointId); // still 'pending'

  assert.equal(await replayDelivery(deliveryId), false);
});

test("reaper resets a stale in_progress delivery back to pending", async () => {
  const endpointId = await createEndpoint();
  const { deliveryId } = await seedDelivery(endpointId);

  await claimDeliveries(50); // now in_progress with locked_at = now()
  const reaped = await reapStale(0); // 0ms lease => anything already claimed is stale

  assert.ok(reaped >= 1, "at least our row was reaped");
  const { rows } = await query<{ status: string }>(
    "SELECT status FROM deliveries WHERE id = $1",
    [deliveryId],
  );
  assert.equal(rows[0].status, "pending");
});
