/** base delay, in milliseconds, for the exponential reconnection backoff. */
export const RECONNECT_BASE_DELAY_MS = 1_000;

/** maximum delay, in milliseconds, between reconnection attempts. */
export const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Computes the delay to wait before the next reconnection attempt.
 *
 * Uses exponential backoff (doubling with each consecutive attempt) capped at a maximum, so
 * that recovery from a transient drop is quick while a server that stays unreachable is not
 * hammered with reconnection attempts.
 *
 * @param attempts - the number of reconnection attempts already made (0 for the first retry)
 * @param baseMs - the base delay for the first retry
 * @param maxMs - the maximum delay between attempts
 * @returns the delay, in milliseconds, to wait before the next attempt
 */
export function computeReconnectDelay(
    attempts: number,
    baseMs: number = RECONNECT_BASE_DELAY_MS,
    maxMs: number = RECONNECT_MAX_DELAY_MS
): number {
    return Math.min(baseMs * 2 ** attempts, maxMs);
}
