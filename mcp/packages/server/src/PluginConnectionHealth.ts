/**
 * Maximum age, in milliseconds, of the last application-level signal received from a plugin
 * before its connection is considered stale.
 *
 * The plugin emits an application-level heartbeat (every ~10s) from the page's event loop.
 * Unlike protocol-level pong frames - which the browser answers automatically even while the
 * tab is frozen - this heartbeat stops as soon as the browser throttles, freezes, or discards
 * the tab. A stale connection therefore signals a suspended tab whose JavaScript cannot
 * currently process tasks, so we fail fast with an actionable error instead of letting the
 * task hang until it times out.
 */
export const HEARTBEAT_STALE_THRESHOLD_MS = 30000; // 30 seconds

/**
 * Liveness state of a plugin connection, as far as the server can observe it.
 */
export interface PluginLivenessState {
    /** whether the plugin reported (via a "freeze" message) that its tab is being frozen. */
    frozen: boolean;
    /** timestamp (ms since epoch) of the last message received from the plugin over the connection. */
    lastHeartbeat: number;
}

/**
 * Asserts that a plugin connection is currently able to run tasks, throwing an actionable
 * error otherwise.
 *
 * A connection can look open at the protocol level - the browser answers ping/pong frames
 * automatically - while the tab is actually suspended and its event loop paused. This guard
 * lets the server fail fast with a clear message instead of waiting the full task timeout for
 * a response that cannot come.
 *
 * @param state - the observed liveness state of the connection
 * @param now - the current time, in ms since epoch
 * @param staleThresholdMs - the maximum heartbeat age, in ms, before the connection is deemed stale
 * @throws Error if the tab is frozen or no heartbeat has arrived within the threshold
 */
export function assertPluginResponsive(
    state: PluginLivenessState,
    now: number,
    staleThresholdMs: number = HEARTBEAT_STALE_THRESHOLD_MS
): void {
    // The plugin notified us at freeze time that its tab is being put to sleep; the page's
    // event loop is paused and cannot run the task.
    if (state.frozen) {
        throw new Error(
            `The Penpot plugin tab has been frozen by the browser and cannot run tasks. ` +
                `Please click/focus the Penpot tab to wake it, then retry.`
        );
    }

    // No application-level heartbeat has arrived recently: the socket may still look open
    // (protocol pings are answered automatically) while the tab is actually suspended.
    const heartbeatAge = now - state.lastHeartbeat;
    if (heartbeatAge > staleThresholdMs) {
        throw new Error(
            `The Penpot plugin tab appears to be suspended by the browser (no heartbeat for ` +
                `${Math.round(heartbeatAge / 1000)}s). Please click/focus the Penpot tab to wake it, ` +
                `then retry.`
        );
    }
}
