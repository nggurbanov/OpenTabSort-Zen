import test from "node:test";
import assert from "node:assert/strict";

import { createSafeLogEvent } from "../modules/safe-log.mjs";

test("Given secret-bearing log data When redacted Then provider secrets are not retained", () => {
  const safe = createSafeLogEvent({
    headers: { authorization: "Bearer sk-live-secret", "x-api-key": "AIza-secret" },
    body: "token sk-another-secret",
  });

  assert.equal(safe.headers.authorization, "[redacted]");
  assert.equal(safe.headers["x-api-key"], "[redacted]");
  assert.equal(safe.body, "token sk-[redacted]");
});
