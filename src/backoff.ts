// Retry policy for failed deliveries. Pure functions / constants only —
// no I/O, no clock, no DB — so it's deterministic (minus jitter) and easy to test.

export const BASE_DELAY_MS = 1_000; // first retry waits ~1s
export const MAX_DELAY_MS = 300_000; // cap each wait at 5 minutes
export const MAX_ATTEMPTS = 10; // give up (dead-letter) after this many tries

/**
 * How long to wait before retry number `attempt` (1-based).
 *
 * Exponential growth (base * 2^(attempt-1)), capped at MAX_DELAY_MS, with
 * full jitter (random point between 0 and the capped delay) so simultaneous
 * failures don't all retry at the same instant (thundering herd).
 */
export function backoffMs(attempt: number): number {
  const exponential = BASE_DELAY_MS * 2 ** (attempt - 1);
  const capped = Math.min(exponential, MAX_DELAY_MS);
  return Math.floor(Math.random() * capped);
}
