import { query } from "./db.js";

export interface ClaimedDelivery {
  id: string;
  message_id: string;
  attempt_count: number;
  payload: Record<string, unknown>;
  url: string;
  secret: string;
}


export async function claimDeliveries(limit: number): Promise<ClaimedDelivery[]> {
  const result = await query<ClaimedDelivery>(
    `
    WITH due AS (
      SELECT id
      FROM deliveries
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    ),
    claimed AS (
      UPDATE deliveries d
      SET status        = 'in_progress',
          locked_at     = now(),
          attempt_count = d.attempt_count + 1,
          updated_at    = now()
      FROM due
      WHERE d.id = due.id
      RETURNING d.id, d.message_id, d.attempt_count
    )
    SELECT c.id, c.message_id, c.attempt_count, m.payload, e.url, e.secret
    FROM claimed c
    JOIN messages  m ON m.id = c.message_id
    JOIN endpoints e ON e.id = m.endpoint_id
    `,
    [limit],
  );
  return result.rows;
}

export async function markSucceeded(id: string): Promise<void> {
  await query(
    "UPDATE deliveries SET status = 'succeeded', updated_at = now() WHERE id = $1",
    [id],
  );
}

export async function markFailed(
  id: string,
  error: string,
  nextAttemptAt: Date,
): Promise<void> {
  await query(
    `UPDATE deliveries
     SET status = 'pending', last_error = $2, next_attempt_at = $3,
         locked_at = NULL, updated_at = now()
     WHERE id = $1`,
    [id, error, nextAttemptAt],
  );
}

export async function markDead(id: string, error: string): Promise<void> {
  await query(
    `UPDATE deliveries
     SET status = 'dead', last_error = $2, locked_at = NULL, updated_at = now()
     WHERE id = $1`,
    [id, error],
  );
}


export async function reapStale(staleMs: number): Promise<number> {
  const result = await query(
    `UPDATE deliveries
     SET status = 'pending', locked_at = NULL, updated_at = now()
     WHERE status = 'in_progress'
       AND locked_at < now() - ($1 * interval '1 millisecond')`,
    [staleMs],
  );
  return result.rowCount ?? 0;
}

export interface DeadDelivery {
  id: string;
  message_id: string;
  attempt_count: number;
  last_error: string | null;
  updated_at: Date;
}

export async function listDead(limit: number): Promise<DeadDelivery[]> {
  const result = await query<DeadDelivery>(
    `SELECT id, message_id, attempt_count, last_error, updated_at
     FROM deliveries
     WHERE status = 'dead'
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}


export async function replayDelivery(id: string): Promise<boolean> {
  const result = await query(
    `UPDATE deliveries
     SET status = 'pending', attempt_count = 0, next_attempt_at = now(),
         locked_at = NULL, last_error = NULL, updated_at = now()
     WHERE id = $1 AND status = 'dead'`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}
