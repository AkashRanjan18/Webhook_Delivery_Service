import { pool, query } from "../src/db.js";

const API = process.env.API_URL ?? "http://localhost:3000";
const RECEIVER = process.env.RECEIVER_URL ?? "http://localhost:4000";
const SECRET = process.env.SECRET ?? "testsecret";
const COUNT = Number(process.env.COUNT ?? 500);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  // 1. Register a fresh endpoint pointing at the receiver.
  const epRes = await fetch(`${API}/endpoints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: RECEIVER, secret: SECRET }),
  });
  const { id: endpointId } = (await epRes.json()) as { id: string };
  console.log(`endpoint ${endpointId} -> ${RECEIVER}`);

  // 2. Enqueue COUNT messages (in bounded-concurrency batches).
  const t0 = Date.now();
  for (let i = 0; i < COUNT; i += CONCURRENCY) {
    const batch = [];
    for (let j = i; j < Math.min(i + CONCURRENCY, COUNT); j++) {
      batch.push(
        fetch(`${API}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint_id: endpointId, payload: { seq: j } }),
        }),
      );
    }
    await Promise.all(batch);
  }
  const enqueueMs = Date.now() - t0;
  console.log(
    `enqueued ${COUNT} messages in ${enqueueMs}ms (${Math.round((COUNT / enqueueMs) * 1000)}/s)`,
  );

  // 3. Poll until every delivery for this endpoint is terminal (succeeded or dead).
  const deliverStart = Date.now();
  while (true) {
    const { rows } = await query<{ done: number }>(
      `SELECT count(*)::int AS done
       FROM deliveries d JOIN messages m ON m.id = d.message_id
       WHERE m.endpoint_id = $1 AND d.status IN ('succeeded', 'dead')`,
      [endpointId],
    );
    if (rows[0].done >= COUNT) break;
    if (Date.now() - deliverStart > 180_000) {
      console.log("timed out waiting for deliveries");
      break;
    }
    await sleep(500);
  }
  const deliverMs = Date.now() - deliverStart;

  // 4. Gather stats.
  const { rows: statusRows } = await query<{ status: string; c: number }>(
    `SELECT status, count(*)::int AS c
     FROM deliveries d JOIN messages m ON m.id = d.message_id
     WHERE m.endpoint_id = $1 GROUP BY status`,
    [endpointId],
  );
  const { rows: latRows } = await query<{ ms: number }>(
    `SELECT EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000 AS ms
     FROM deliveries d JOIN messages m ON m.id = d.message_id
     WHERE m.endpoint_id = $1 AND d.status = 'succeeded'
     ORDER BY ms`,
    [endpointId],
  );
  const latencies = latRows.map((r) => Number(r.ms));

  console.log("\n─── results ───────────────────────────────");
  console.log(`messages:            ${COUNT}`);
  console.log(`enqueue throughput:  ${Math.round((COUNT / enqueueMs) * 1000)}/s`);
  console.log(`time to deliver all: ${(deliverMs / 1000).toFixed(1)}s`);
  console.log(
    `delivery throughput: ${Math.round((COUNT / deliverMs) * 1000)}/s`,
  );
  console.log("status breakdown:");
  for (const r of statusRows) console.log(`  ${r.status.padEnd(11)} ${r.c}`);
  console.log("delivery latency (accepted -> delivered):");
  console.log(`  p50 ${percentile(latencies, 50).toFixed(0)}ms`);
  console.log(`  p95 ${percentile(latencies, 95).toFixed(0)}ms`);
  console.log(`  p99 ${percentile(latencies, 99).toFixed(0)}ms`);
  console.log("───────────────────────────────────────────");
}

main()
  .catch((err) => {
    console.error("benchmark failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
