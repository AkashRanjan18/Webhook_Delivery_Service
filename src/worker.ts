import { ClaimedDelivery, claimDeliveries, markSucceeded, markFailed, markDead, reapStale } from "./repository.js";
import { backoffMs, MAX_ATTEMPTS } from "./backoff.js";
import { sign } from "./signing.js";
import { pool } from "./db.js";

const poll_interval = 1_000;
const batch_size = 20;
const request_interval =  10_000;
const reap_interval = 30_000;
const stale_lease = 30_000;

let running_flag: boolean = true;

async function retryOrDead (delivery: ClaimedDelivery, error: string){
  if (delivery.attempt_count >= MAX_ATTEMPTS) {
    await markDead(delivery.id, error);
  } else {
    const nextAttemptAt = new Date(Date.now() + backoffMs(delivery.attempt_count));
    await markFailed(delivery.id, error, nextAttemptAt);
  }
}

async function deliverOne(delivery: ClaimedDelivery): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request_interval);

  // Serialize once so we sign the exact bytes we send.
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = sign(delivery.secret, timestamp, body);

  try {
    const res = await fetch(delivery.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Id": delivery.message_id,
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Signature": signature,
      },
      body,
      signal: controller.signal,
    });

    if (res.ok) {
      await markSucceeded(delivery.id);
      return;
    }

    const error = `HTTP ${res.status}`;
    
    const permanent =
      res.status >= 400 &&
      res.status < 500 &&
      res.status !== 408 &&
      res.status !== 429;

    if (permanent) {
      await markDead(delivery.id, error);
    } else {
      await retryOrDead(delivery, error);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await retryOrDead(delivery, error);
  } finally {
    clearTimeout(timer);
  }
}

async function tick(): Promise<void> {
  const batch = await claimDeliveries(batch_size);
  if (batch.length === 0) return;
  await Promise.allSettled(batch.map(deliverOne));
}

async function loop(): Promise<void> {
  if (!running_flag) return;
  try {
    await tick();
  } catch (err) {
    console.error("tick failed:", err);
  } finally {
    if (running_flag) setTimeout(loop, poll_interval);
  }
}

const reaper = setInterval(async () => {
  try {
    const n = await reapStale(stale_lease);
    if (n > 0) console.log(`reaped ${n} stale delivery(ies)`);
  } catch (err) {
    console.error("reaper failed:", err);
  }
}, reap_interval);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down worker …`);
  running_flag = false;
  clearInterval(reaper);
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log("worker started");
void loop();
