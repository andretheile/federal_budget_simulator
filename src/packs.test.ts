import { describe, expect, it } from "vitest";
import {
  decodeScenario,
  encodeScenario,
  findNode,
  formatIssue,
  resolveParams,
  simulate,
  simulatePolicy,
  type CountryPack,
  type Param,
  type ParamValue,
  type ParamValues,
  type Scenario,
} from "./engine/index.ts";
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

  // Heavy by design: every policy alone and all together, at five levels, each also on a fresh copy of the pack.
  it("simulate the same on every call: each policy alone, with every level filter in between", { timeout: 30_000 }, async () => {
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
          const untouched = structuredClone(pack);
          expect(simulate(untouched, { policies, level })).toEqual(first[i]);
        });
        // The levels that exist add up to the whole, on every call.
        const parts = first.slice(1).reduce((sum, r) => sum + r.delta.balance, 0);
        expect(Math.abs(parts - first[0].delta.balance)).toBeLessThan(1e-12 * (1 + first[0].baseline.expenditure));
      }
    }
  });

  it("survive a link: every policy at its defaults, with each param moved, and with all of them moved", async () => {
    for (const id of listPackIds()) {
      const result = await loadPack(id);
      if (!result.ok) continue;
      const pack = result.pack;
      const everything: Scenario = { policies: {} };
      for (const policy of pack.policies) {
        const moved: ParamValues = {};
        const variants: ParamValues[] = [{}];
        for (const param of policy.params) {
          const value = movedValue(pack, param);
          if (value === undefined) continue;
          moved[param.id] = value;
          variants.push({ [param.id]: value });
        }
        variants.push(moved);
        everything.policies[policy.id] = { enabled: true, params: moved };
        for (const params of variants) {
          const scenario: Scenario = { policies: { [policy.id]: { enabled: true, params } } };
          const link = encodeScenario(scenario, pack);
          const decoded = decodeScenario(link, pack);
          expect(Object.keys(decoded.policies), link).toEqual([policy.id]);
          expect(resolveParams(pack, policy, decoded.policies[policy.id].params), link).toEqual(resolveParams(pack, policy, params));
          expect(encodeScenario(decoded, pack)).toBe(link);
          // A moved param is in the link, so the comparison above is not between two defaults.
          for (const paramId of Object.keys(params)) expect(link, paramId).toContain(`.${paramId}.`);
        }
      }
      const link = encodeScenario(everything, pack);
      expect(encodeScenario(decodeScenario(link, pack), pack)).toBe(link);
      expect(simulate(pack, decodeScenario(link, pack))).toEqual(simulate(pack, everything));
    }
  });

  it("reports a pack that does not exist as an error instead of rejecting", async () => {
    expect(hasPack("no-such-country")).toBe(false);
    const result = await loadPack("no-such-country");
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([{ file: "", path: "$", message: 'there is no country pack "no-such-country"' }]);
  });
});

/** A value of the param other than its default, inside its range; undefined if it has none. */
function movedValue(pack: CountryPack, param: Param): ParamValue | undefined {
  if (param.type === "number") {
    const value = param.default !== param.max ? param.max : param.min;
    return value === param.default ? undefined : value;
  }
  if (param.type === "groups") {
    const all = findNode(pack, param.node)?.breakdowns?.[param.breakdown]?.groups.map((group) => group.id) ?? [];
    const everyGroup = all.length === param.default.length && all.every((group) => param.default.includes(group));
    return everyGroup ? [] : all;
  }
  const preset = param.presets?.find((candidate) => JSON.stringify(candidate.points) !== JSON.stringify(param.default));
  if (preset) return preset.points;
  // Every point one step up, or down where that would leave the range.
  const { y } = param;
  return param.default.map((point) => ({ x: point.x, y: point.y + y.step <= y.max ? point.y + y.step : point.y - y.step }));
}
