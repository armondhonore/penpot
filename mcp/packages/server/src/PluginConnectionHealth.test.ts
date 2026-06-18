import assert from "node:assert/strict";
import test from "node:test";
import { assertPluginResponsive, HEARTBEAT_STALE_THRESHOLD_MS } from "./PluginConnectionHealth.ts";

test("passes for a responsive connection with a recent heartbeat", () => {
    const now = 1_000_000;
    assert.doesNotThrow(() => assertPluginResponsive({ frozen: false, lastHeartbeat: now - 5_000 }, now));
});

test("passes when the heartbeat age is exactly at the threshold", () => {
    const now = 1_000_000;
    const lastHeartbeat = now - HEARTBEAT_STALE_THRESHOLD_MS;
    assert.doesNotThrow(() => assertPluginResponsive({ frozen: false, lastHeartbeat }, now));
});

test("throws a frozen-specific error when the tab reported it is being frozen", () => {
    const now = 1_000_000;
    // frozen takes precedence even if the heartbeat is otherwise recent
    assert.throws(() => assertPluginResponsive({ frozen: true, lastHeartbeat: now }, now), /has been frozen/);
});

test("throws a suspended error when no heartbeat has arrived within the threshold", () => {
    const now = 1_000_000;
    const lastHeartbeat = now - (HEARTBEAT_STALE_THRESHOLD_MS + 1);
    assert.throws(
        () => assertPluginResponsive({ frozen: false, lastHeartbeat }, now),
        /appears to be suspended by the browser/
    );
});

test("includes the heartbeat age, in seconds, in the suspended error", () => {
    const now = 1_000_000;
    const lastHeartbeat = now - 45_000; // 45s stale
    assert.throws(() => assertPluginResponsive({ frozen: false, lastHeartbeat }, now), /no heartbeat for 45s/);
});

test("honours a custom stale threshold", () => {
    const now = 1_000_000;
    const lastHeartbeat = now - 2_000; // 2s old

    // would be fresh under the default threshold, but stale under a 1s threshold
    assert.doesNotThrow(() => assertPluginResponsive({ frozen: false, lastHeartbeat }, now));
    assert.throws(
        () => assertPluginResponsive({ frozen: false, lastHeartbeat }, now, 1_000),
        /appears to be suspended by the browser/
    );
});
