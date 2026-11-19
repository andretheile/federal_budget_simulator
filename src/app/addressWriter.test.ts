/**
 * The budget for writing the address, on a clock the test moves by hand: exact, and as fast on a
 * busy machine as on an idle one.
 */
import { describe, expect, it } from "vitest";
import { addressWriter, type Clock } from "./addressWriter.ts";

/** A clock and its timers, moved only by `advance`. */
function manualClock() {
  let time = 0;
  let next = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: Clock = {
    now: () => time,
    setTimeout: (callback, ms) => {
      const id = next++;
      timers.set(id, { at: time + ms, callback });
      return id;
    },
    clearTimeout: (handle) => void timers.delete(handle as number),
  };
  const advance = (ms: number): void => {
    const end = time + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      time = due[1].at;
      due[1].callback();
    }
    time = end;
  };
  return { clock, advance };
}

/** The address and a state that changes: what Safari would see. */
function page() {
  const { clock, advance } = manualClock();
  let state = 0;
  let address = 0;
  const writes: number[] = [];
  const writer = addressWriter({
    clock,
    isCurrent: () => address === state,
    write: () => {
      address = state;
      writes.push(clock.now());
    },
  });
  const change = (): void => {
    state += 1;
    writer.request();
  };
  return { writer, change, advance, writes, clock, latest: () => address === state };
}

/** The most writes in any ten seconds. */
function mostInTenSeconds(writes: number[]): number {
  return Math.max(0, ...writes.map((start) => writes.filter((at) => at >= start && at < start + 10_000).length));
}

describe("writing the address while a value changes fast", () => {
  it("writes at most 25 times in a burst, and the last state within 150 ms", () => {
    const p = page();
    for (let i = 0; i < 121; i++) p.change();
    expect(p.writes.length).toBeLessThanOrEqual(25);
    expect(p.latest()).toBe(false);
    p.advance(150);
    expect(p.latest()).toBe(true);
  });

  it("stays below Safari's limit while changes go on for ten seconds, and always ends on the last state", () => {
    const p = page();
    for (let i = 0; i < 121; i++) p.change();
    p.advance(150);
    const before = p.writes.length;
    // One change every 50 ms for ten seconds.
    for (let i = 0; i < 200; i++) {
      p.change();
      p.advance(50);
    }
    const during = p.writes.length - before;
    expect(during).toBeLessThanOrEqual(100);
    expect(during).toBeGreaterThan(50);
    expect(mostInTenSeconds(p.writes)).toBeLessThan(100);
    p.advance(150);
    expect(p.latest()).toBe(true);
  });

  it("writes straight through again after a pause, and not at all when nothing changed", () => {
    const p = page();
    for (let i = 0; i < 121; i++) p.change();
    p.advance(5_000);
    const count = p.writes.length;
    p.change();
    expect(p.writes.length).toBe(count + 1);
    expect(p.latest()).toBe(true);
    // A request for the state the address already has writes nothing.
    p.writer.request();
    expect(p.writes.length).toBe(count + 1);
  });

  it("drops a waiting write when it is disposed", () => {
    const p = page();
    for (let i = 0; i < 40; i++) p.change();
    p.writer.dispose();
    const count = p.writes.length;
    p.advance(1_000);
    expect(p.writes.length).toBe(count);
  });
});
