import assert from "node:assert/strict";
import test from "node:test";
import { computeReconnectDelay, RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS } from "./ReconnectPolicy.ts";

test("returns the base delay for the first attempt", () => {
    assert.equal(computeReconnectDelay(0), RECONNECT_BASE_DELAY_MS);
});

test("doubles the delay with each consecutive attempt", () => {
    assert.equal(computeReconnectDelay(1), RECONNECT_BASE_DELAY_MS * 2);
    assert.equal(computeReconnectDelay(2), RECONNECT_BASE_DELAY_MS * 4);
    assert.equal(computeReconnectDelay(3), RECONNECT_BASE_DELAY_MS * 8);
});

test("caps the delay at the configured maximum", () => {
    // a large attempt count would overflow the cap; it must clamp to the maximum
    assert.equal(computeReconnectDelay(100), RECONNECT_MAX_DELAY_MS);
});

test("never exceeds the maximum across a range of attempts", () => {
    for (let attempts = 0; attempts < 50; attempts++) {
        assert.ok(computeReconnectDelay(attempts) <= RECONNECT_MAX_DELAY_MS);
    }
});

test("honours custom base and max delays", () => {
    assert.equal(computeReconnectDelay(0, 500, 4_000), 500);
    assert.equal(computeReconnectDelay(2, 500, 4_000), 2_000);
    assert.equal(computeReconnectDelay(5, 500, 4_000), 4_000);
});
