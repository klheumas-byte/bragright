import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const realtime = readFileSync(new URL("./realtime.js", import.meta.url), "utf8");
const provider = readFileSync(new URL("../context/RealtimeProvider.jsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../context/AuthContext.jsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.jsx", import.meta.url), "utf8");

test("one shared realtime service owns polling, reconnect, cursor, and deduplication", () => {
  assert.match(main, /<RealtimeProvider>/);
  assert.match(provider, /startRealtime\(user\.id\)/);
  assert.match(realtime, /let timer = null/);
  assert.match(realtime, /after: cursor/);
  assert.match(realtime, /seenEventIds/);
  assert.match(realtime, /window\.addEventListener\("online", resyncNow\)/);
  assert.match(realtime, /document\.addEventListener\("visibilitychange", resyncNow\)/);
  assert.match(realtime, /MAX_BACKOFF_MS/);
});

test("auth exposes three states and retries transient restoration failures", () => {
  assert.match(auth, /useState\("checking"\)/);
  assert.match(auth, /setAuthStatus\("authenticated"\)/);
  assert.match(auth, /setAuthStatus\("unauthenticated"\)/);
  assert.match(auth, /window\.setTimeout\(attemptRestore, 5_000\)/);
  assert.match(auth, /error\?\.status === 401 \|\| error\?\.status === 423/);
});
