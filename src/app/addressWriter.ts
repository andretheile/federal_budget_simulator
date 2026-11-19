/**
 * Writes the scenario into the address without upsetting the browser. Safari allows replaceState
 * about 100 times in ten seconds and throws after that; dragging a point of a curve changes the
 * scenario on every move. So writes draw on a budget: 25 at once, refilled at 7 a second, which
 * stays below Safari's limit in any ten seconds. When the budget is spent, the latest state is
 * written as soon as there is room again, within about 150 ms.
 *
 * The clock can be passed in, so the budget can be tested without waiting for real time.
 */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The browser's clock, looked up on every call (so that test environments can replace it). */
export const browserClock: Clock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface AddressWriter {
  /** The state has changed: write it now if the budget allows, otherwise as soon as it does. */
  request(): void;
  /** Drops a write that is waiting. */
  dispose(): void;
}

export function addressWriter({
  write,
  isCurrent,
  clock = browserClock,
  burst = 25,
  perSecond = 7,
}: {
  /** Writes the latest state into the address. */
  write(): void;
  /** Whether the address already says the latest state. */
  isCurrent(): boolean;
  clock?: Clock;
  burst?: number;
  perSecond?: number;
}): AddressWriter {
  let tokens = burst;
  let at = clock.now();
  let pending: unknown;
  const attempt = (): void => {
    pending = undefined;
    if (isCurrent()) return;
    const now = clock.now();
    tokens = Math.min(burst, tokens + ((now - at) * perSecond) / 1000);
    at = now;
    if (tokens < 1) {
      pending = clock.setTimeout(attempt, Math.ceil(((1 - tokens) * 1000) / perSecond));
      return;
    }
    tokens -= 1;
    write();
  };
  return {
    // A write that is already waiting will pick up this state too.
    request: () => {
      if (pending === undefined) attempt();
    },
    dispose: () => {
      if (pending !== undefined) clock.clearTimeout(pending);
      pending = undefined;
    },
  };
}
