import { describe, expect, it } from "vitest";
import { formatIssue, simulate, simulatePolicy } from "./engine/index.ts";
import { hasPack, listPackIds, loadPack } from "./packs.ts";

/**
 * Runs the loader and validatePack over whatever is in /countries right now. That directory is
 * written by other people and may be missing, half-finished or invalid at any moment, so an
 * invalid pack does not fail this suite: it is printed. Checking the packs for real is the job
 * of `npm run validate`.
 */
describe("country packs in /countries", () => {
  it("can be listed, loaded and validated without throwing", async () => {
    const ids = listPackIds();
    if (ids.length === 0) console.info("countries/ has no packs yet");
    for (const id of ids) {
      expect(hasPack(id)).toBe(true);
      const result = await loadPack(id);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        for (const issue of result.errors) {
          expect(typeof issue.file).toBe("string");
          expect(issue.path.startsWith("$")).toBe(true);
          expect(issue.message.length).toBeGreaterThan(0);
        }
        console.info(`countries/${id}: invalid (not a test failure)\n  ${result.errors.slice(0, 20).map(formatIssue).join("\n  ")}`);
        continue;
      }
      // A valid pack must simulate: nothing enabled, and every policy on its own at defaults.
      const base = simulate(result.pack);
      expect(Number.isFinite(base.baseline.balance)).toBe(true);
      for (const policy of result.pack.policies) {
        const alone = simulatePolicy(result.pack, policy.id);
        expect(Number.isFinite(alone?.delta.balance)).toBe(true);
      }
      console.info(`countries/${id}: valid, balance ${base.baseline.balance}`);
    }
  });

  it("simulate the same on every call: each policy alone, with every level filter in between", async () => {
    const levels = ["all", "central", "state", "local", "social_security"] as const;
    for (const id of listPackIds()) {
      const result = await loadPack(id);
      if (!result.ok) continue;
      const pack = result.pack;
      const everything = Object.fromEntries(pack.policies.map((policy) => [policy.id, { enabled: true }]));
      const scenarios = [...pack.policies.map((policy) => ({ [policy.id]: { enabled: true } })), everything];
      for (const policies of scenarios) {
        const first = levels.map((level) => simulate(pack, { policies, level }));
        const again = levels.map((level) => simulate(pack, { policies, level }));
        expect(again).toEqual(first);
        expect(simulate(pack, { policies })).toEqual(first[0]);
        // This pack object has been simulated many times by now. A copy that never was must agree,
        // otherwise something is carried over from call to call.
        levels.forEach((level, i) => {
          const untouched = JSON.parse(JSON.stringify(pack)) as typeof pack;
          expect(simulate(untouched, { policies, level })).toEqual(first[i]);
        });
        // The levels that exist add up to the whole, on every call.
        const parts = first.slice(1).reduce((sum, r) => sum + r.delta.balance, 0);
        expect(Math.abs(parts - first[0].delta.balance)).toBeLessThan(1e-12 * (1 + first[0].baseline.expenditure));
      }
    }
  });

  it("reports a pack that does not exist as an error instead of rejecting", async () => {
    expect(hasPack("no-such-country")).toBe(false);
    const result = await loadPack("no-such-country");
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([{ file: "", path: "$", message: 'there is no country pack "no-such-country"' }]);
  });
});
