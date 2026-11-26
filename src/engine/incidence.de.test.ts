/**
 * Who pays on the German pack, as it is in the working tree: the income tax profile is the engine's
 * own result on taxable_income, a higher top rate falls on the top only, the lines add up.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadPack } from "../packs.ts";
import { scheduleBands } from "./curve.ts";
import { valueAtShare } from "./distribution.ts";
import { measureWhoPays, whoPays } from "./incidence.ts";
import { simulate, simulatePolicy } from "./simulate.ts";
import type { CountryPack, CurvePoint, ScheduleEffect } from "./types.ts";

let pack: CountryPack;

beforeAll(async () => {
  const result = await loadPack("de");
  if (!result.ok) throw new Error(`countries/de does not validate: ${JSON.stringify(result.errors.slice(0, 3))}`);
  pack = result.pack;
});

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
const schedule = (): ScheduleEffect => pack.policies.find((policy) => policy.id === "income_tax_schedule")!.effects[0] as ScheduleEffect;
const today = (): CurvePoint[] => {
  const param = pack.policies.find((policy) => policy.id === "income_tax_schedule")!.params[0];
  if (param.type !== "curve" || !param.baseline) throw new Error("curve with a baseline expected");
  return param.baseline;
};

describe("who pays in the German pack", () => {
  it("the income tax profile is what the 2024 schedule yields on taxable_income, cut at the groups' shares", () => {
    const dist = pack.distributions.taxable_income;
    const edges = [dist.bins[0].from, valueAtShare(dist, 0.5), valueAtShare(dist, 0.9), valueAtShare(dist, 0.99)];
    const bands = scheduleBands(dist, schedule().baseline as { points: CurvePoint[]; scale: number }, { points: [] }, edges);
    const owed = bands.map((band) => band.reform);
    const shares = owed.map((value) => value / sum(owed));
    pack.incidence!.profiles.income_tax.shares.forEach((share, g) => expect(share).toBeCloseTo(shares[g], 6));
  });

  it("a higher top rate in the curve editor falls on the top 1 % only, from the distribution", () => {
    const points = today().map((point, i, all) => (i === all.length - 1 ? { ...point, y: 50 } : point));
    const result = simulatePolicy(pack, "income_tax_schedule", { schedule: points, behaviour: 0 })!;
    const measure = measureWhoPays(pack, result)!;
    expect(measure.groups.slice(0, 3)).toEqual([0, 0, 0]);
    expect(measure.groups[3]).toBeGreaterThan(0);
    expect(sum(measure.groups)).toBeCloseTo(result.delta.revenue, 3);
    // A step to 45 % at 66,760: the bottom half and the next 40 % (up to 58,136) pay the same.
    const wider = [...today().filter((point) => point.x < 66760), { x: 66760, y: 42 }, { x: 66760, y: 45 }, { x: 277825, y: 45 }];
    const more = measureWhoPays(pack, simulatePolicy(pack, "income_tax_schedule", { schedule: wider, behaviour: 0 })!)!;
    expect(more.groups.slice(0, 2)).toEqual([0, 0]);
    expect(more.groups[2]).toBeGreaterThan(0);
    expect(more.groups[3]).toBeGreaterThan(0);
  });

  it("a proportional rise of the income tax keeps its shares", () => {
    const points = today().map((point) => ({ ...point, y: point.y * 1.1 }));
    const result = whoPays(pack, simulate(pack, { policies: { income_tax_schedule: { enabled: true, params: { schedule: points } } } }))!;
    const measure = result.measures[0];
    const profile = pack.incidence!.profiles.income_tax.shares;
    const total = sum(measure.groups);
    measure.groups.forEach((change, g) => expect(change / total).toBeCloseTo(profile[g], 6));
  });

  it("a higher standard VAT rate is spread leaf by leaf: the state pays its part of the other goods, not of restaurant meals", () => {
    const result = simulatePolicy(pack, "vat_rates", { standard: 21, reduced: 7 })!;
    const measure = measureWhoPays(pack, result)!;
    const leaves = result.effects[0].leaves!;
    expect(Object.keys(leaves).sort()).toEqual(["rev.taxes.consumption.vat.standard.other", "rev.taxes.consumption.vat.standard.restaurants"]);
    const coverage = pack.incidence!.nodes["rev.taxes.consumption.vat.standard.other"].coverage!;
    expect(measure.payers.state).toBeCloseTo(leaves["rev.taxes.consumption.vat.standard.other"] * (1 - coverage), 3);
    expect(sum(measure.groups) + measure.payers.state).toBeCloseTo(result.delta.revenue, 3);
  });

  it("taxes on company profits are with companies; the surcharge on corporate tax too", () => {
    const measure = measureWhoPays(pack, simulatePolicy(pack, "corporate_tax_rate")!)!;
    expect(measure.groups).toEqual([0, 0, 0, 0]);
    expect(Object.keys(measure.payers)).toEqual(["companies"]);
  });

  it("civil servants into the pension insurance: the employer's part follows the slider to the state", () => {
    const at = (share: number) => {
      const result = simulatePolicy(pack, "pension_insurance_for_all", { employer_share: share })!;
      const contributions = result.effects[0].delta;
      return { measure: measureWhoPays(pack, result)!, contributions };
    };
    // The slider runs from 50 to 100 %.
    for (const share of [50, 75, 100]) {
      const { measure, contributions } = at(share);
      expect(measure.payers.state ?? 0).toBeCloseTo((contributions * share) / 100, 0);
      expect(measure.groups).toEqual([0, 0, 0, 0]);
    }
  });

  it("a higher flat-rate tax on capital income falls mostly on the top 1 %, nothing on the bottom half", () => {
    const measure = measureWhoPays(pack, simulatePolicy(pack, "capital_income_flat_tax")!)!;
    expect(measure.groups[0]).toBe(0);
    expect(measure.groups[3] / sum(measure.groups)).toBeCloseTo(0.736264, 6);
  });

  it("contribution schedules: a rate up to today's ceiling is spread like contributions, what a higher ceiling raises is placed in no group", () => {
    const param = pack.policies.find((policy) => policy.id === "pension_contribution_schedule")!.params[0];
    if (param.type !== "curve" || !param.baseline) throw new Error("curve expected");
    // 19.6 % instead of 18.6 % up to the ceiling of 90,600.
    const rate = param.baseline.map((point) => (point.y > 0 ? { ...point, y: 19.6 } : point));
    const byRate = measureWhoPays(pack, simulatePolicy(pack, "pension_contribution_schedule", { schedule: rate })!)!;
    const profile = pack.incidence!.profiles.contributions.shares;
    const spread = sum(byRate.groups);
    expect(spread).toBeGreaterThan(0);
    byRate.groups.forEach((change, g) => expect(change / spread).toBeCloseTo(profile[g], 6));
    // Only the wage tax knock-on (a shift) goes to no group.
    expect(Object.keys(byRate.payers)).toEqual(["unassigned"]);
    expect(byRate.payers.unassigned).toBeLessThan(0);
    // The ceiling doubled: the contributions all go to no group.
    const ceiling = [{ x: 0, y: 18.6 }, { x: 181200, y: 18.6 }, { x: 181200, y: 0 }];
    const result = simulatePolicy(pack, "pension_contribution_schedule", { schedule: ceiling })!;
    const byCeiling = measureWhoPays(pack, result)!;
    expect(byCeiling.groups.every((change) => Math.abs(change) < 1)).toBe(true);
    expect(byCeiling.payers.unassigned).toBeCloseTo(result.delta.revenue, 0);
  });

  it("the wealth tax: the top 1 % pays 82.5 %, the rest is placed in no group", () => {
    const measure = measureWhoPays(pack, simulatePolicy(pack, "wealth_tax")!)!;
    const total = sum(measure.groups) + measure.payers.unassigned;
    expect(measure.groups.slice(0, 3)).toEqual([0, 0, 0]);
    expect(measure.groups[3] / total).toBeCloseTo(0.825, 6);
  });

  it("withholding tax on capital income: the corporations' 35 % is with companies", () => {
    const taxes = whoPays(pack, simulate(pack))!.statement.lines.find((line) => line.payer === "companies")!;
    const item = taxes.items.find((entry) => entry.node === "rev.taxes.income.capital_income")!;
    expect(item.today / 50.435256e9).toBeCloseTo(18662 / 53314, 5);
  });

  it("with every measure on, the lines add up to the revenue the scoreboard shows", () => {
    const result = simulate(pack, { policies: Object.fromEntries(pack.policies.map((policy) => [policy.id, { enabled: true }])) });
    const who = whoPays(pack, result)!;
    expect(who.statement.today).toBeCloseTo(result.baseline.revenue, 0);
    expect(who.statement.reform).toBeCloseTo(result.reform.revenue, 0);
    for (const scope of who.scopes) {
      const spread = scope.groupsTotal.reform + sum(scope.payers.map((payer) => payer.reform));
      expect(spread).toBeCloseTo(scope.total.reform, 0);
    }
  });
});
