import { test } from "node:test";
import assert from "node:assert/strict";
import { sign } from "../src/signing.js";

test("sign is deterministic for the same inputs", () => {
  assert.equal(sign("secret", "123", "body"), sign("secret", "123", "body"));
});

test("sign changes when any input changes", () => {
  const base = sign("secret", "123", "body");
  assert.notEqual(base, sign("other", "123", "body"), "secret matters");
  assert.notEqual(base, sign("secret", "124", "body"), "timestamp matters");
  assert.notEqual(base, sign("secret", "123", "other"), "body matters");
});

test("sign returns a 64-char hex SHA-256 digest", () => {
  assert.match(sign("secret", "123", "body"), /^[0-9a-f]{64}$/);
});
