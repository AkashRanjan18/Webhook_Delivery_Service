import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs, BASE_DELAY_MS, MAX_DELAY_MS } from "../src/backoff.js";

test("backoff never exceeds the cap and is never negative", () => {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const ms = backoffMs(attempt);
    assert.ok(ms >= 0, `attempt ${attempt}: non-negative`);
    assert.ok(ms <= MAX_DELAY_MS, `attempt ${attempt}: within cap`);
  }
});

test("first attempt stays within the base delay (full jitter)", () => {
  for (let i = 0; i < 100; i++) {
    const ms = backoffMs(1);
    assert.ok(ms >= 0 && ms <= BASE_DELAY_MS);
  }
});

test("backoff returns whole milliseconds", () => {
  assert.equal(Number.isInteger(backoffMs(5)), true);
});
