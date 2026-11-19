import { describe, expect, it } from "vitest";
import { lazyModule } from "./lazy.ts";

/** An importer whose results the test hands out one by one. */
function controlled<T>() {
  const calls: { resolve(value: T): void; reject(error: unknown): void }[] = [];
  const importer = (): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      calls.push({ resolve, reject });
    });
  return { importer, calls };
}

describe("a module loaded on demand", () => {
  it("is not there until it has arrived, and is kept afterwards", async () => {
    const { importer, calls } = controlled<{ name: string }>();
    const lazy = lazyModule(importer);
    expect(lazy.current()).toBeUndefined();
    expect(calls).toHaveLength(0);
    const loading = lazy.load();
    // Two requests while it loads share one import.
    const again = lazy.load();
    lazy.preload();
    expect(calls).toHaveLength(1);
    calls[0].resolve({ name: "editor" });
    expect(await loading).toEqual({ name: "editor" });
    expect(await again).toBe(await loading);
    expect(lazy.current()).toEqual({ name: "editor" });
    // Once there, nothing is imported again.
    await lazy.load();
    expect(calls).toHaveLength(1);
  });

  it("forgets a failed load, so that trying again imports again", async () => {
    const { importer, calls } = controlled<string>();
    const lazy = lazyModule(importer);
    const first = lazy.load();
    calls[0].reject(new TypeError("Failed to fetch dynamically imported module"));
    await expect(first).rejects.toThrow("Failed to fetch");
    expect(lazy.current()).toBeUndefined();
    const second = lazy.load();
    expect(calls).toHaveLength(2);
    calls[1].resolve("editor");
    expect(await second).toBe("editor");
    expect(lazy.current()).toBe("editor");
  });

  it("loads ahead of time without an unhandled rejection when that fails", async () => {
    const { importer, calls } = controlled<string>();
    const lazy = lazyModule(importer);
    lazy.preload();
    calls[0].reject(new Error("offline"));
    // Let the rejection settle; an unhandled one would fail the test run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lazy.current()).toBeUndefined();
    const later = lazy.load();
    calls[1].resolve("editor");
    expect(await later).toBe("editor");
  });
});
