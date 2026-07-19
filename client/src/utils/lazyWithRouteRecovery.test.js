import assert from "node:assert/strict";
import test from "node:test";
import { isChunkLoadError, ROUTE_RECOVERY_PARAMETER } from "./lazyWithRouteRecovery.js";

test("recognizes browser lazy-route chunk failures", () => {
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module")), true);
  assert.equal(isChunkLoadError(new Error("Loading chunk 42 failed")), true);
  assert.equal(isChunkLoadError(new Error("Importing a module script failed")), true);
  assert.equal(isChunkLoadError(new Error("Player data was invalid")), false);
});

test("uses a dedicated bounded route-recovery marker", () => {
  assert.equal(ROUTE_RECOVERY_PARAMETER, "bragright_route_recovery");
});
