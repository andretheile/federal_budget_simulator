import { describe, expect, it } from "vitest";
import { testland, testlandCopy, testlandTimed } from "./__fixtures__/testland.ts";
import { projectDebt, projectScenario } from "./debt.ts";
import { simulate, simulateWeighted, type Scenario } from "./simulate.ts";
import { decimalYear, measurePhase, measuresFrom, shareInYear } from "./timing.ts";

const on = (...ids: string[]): Scenario => ({ policies: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) });
const ALL: Scenario = on(...testland.policies.map((policy) => policy.id));
const timed = testlandTimed();

describe("the phase of a measure", () => {
  it("the first year measures can act: the pack's, or the first projection year", () => {
    expect(measuresFrom(timed)).toBe(2026);
    expect(measuresFrom(testland)).toBe(2025);
  });

  it("a measure without timing acts in full from that year", () => {
    expect(measurePhase(timed, "halve_mp_pay")).toEqual({ policy: "halve_mp_pay", from: "2026-01-01", start: 2026, years: 0, full: 2026, immediate: true });
    expect(measurePhase(testland, "cut_admin")).toEqual({ policy: "cut_admin", from: "2025-01-01", start: 2025, years: 0, full: 2025, immediate: true });
    expect(measurePhase(timed, "no_such")).toBeUndefined();
  });

  it("a build-up over years, a later start, or both", () => {
    expect(measurePhase(timed, "cut_admin")).toEqual({ policy: "cut_admin", from: "2026-01-01", start: 2026, years: 4, full: 2030, immediate: false });
    expect(measurePhase(timed, "wealth_tax")).toEqual({ policy: "wealth_tax", from: "2028-01-01", start: 2028, years: 0, full: 2028, immediate: false });
  });

  it("the build-up can depend on how far a param is from its baseline, and on the direction", () => {
    // Two years per point above 2 %, from mid-2027.
    expect(measurePhase(timed, "defense_target", { share: 3 })).toMatchObject({ from: "2027-07-01", start: 2027, years: 2, full: 2030 });
    expect(measurePhase(timed, "defense_target", { share: 4.5 })).toMatchObject({ years: 5, full: 2033 });
    // Below the baseline: over one year from the first year measures can act.
    expect(measurePhase(timed, "defense_target", { share: 1.5 })).toMatchObject({ from: "2026-01-01", years: 1, full: 2027, immediate: false });
    // The default (3 %) applies where no value is given.
    expect(measurePhase(timed, "defense_target")?.years).toBe(2);
  });

  it("a start before the first year measures can act counts as that year", () => {
    const pack = testlandTimed();
    pack.policies.find((policy) => policy.id === "wealth_tax")!.timing!.from = "2025-03-01";
    expect(measurePhase(pack, "wealth_tax")).toEqual({ policy: "wealth_tax", from: "2026-01-01", start: 2026, years: 0, full: 2026, immediate: true });
  });
});

describe("the share of a year", () => {
  it("decimal years count days", () => {
    expect(decimalYear("2027-01-01")).toBe(2027);
    expect(decimalYear("2027-07-01")).toBeCloseTo(2027 + 181 / 365, 12);
    expect(decimalYear("2028-07-01")).toBeCloseTo(2028 + 182 / 366, 12);
  });

  it("a linear build-up over four years, averaged over each year", () => {
    const phase = measurePhase(timed, "cut_admin")!;
    expect([2025, 2026, 2027, 2028, 2029, 2030, 2040].map((year) => shareInYear(phase, year))).toEqual([0, 0.125, 0.375, 0.625, 0.875, 1, 1]);
  });

  it("a start in the middle of a year gives that part of the year", () => {
    const phase = { ...measurePhase(timed, "wealth_tax")!, from: "2027-07-01" };
    expect(shareInYear(phase, 2026)).toBe(0);
    expect(shareInYear(phase, 2027)).toBeCloseTo(184 / 365, 12);
    expect(shareInYear(phase, 2028)).toBe(1);
  });

  it("a build-up that starts in the middle of a year", () => {
    // Two years from mid-2027: a quarter of a year's worth by the end of 2027, and so on.
    const phase = measurePhase(timed, "defense_target", { share: 3 })!;
    const a = 2027 + 181 / 365;
    const integral = (x: number) => (x <= a ? 0 : x <= a + 2 ? (x - a) ** 2 / 4 : 1 + (x - a - 2));
    for (const year of [2027, 2028, 2029]) expect(shareInYear(phase, year)).toBeCloseTo(integral(year + 1) - integral(year), 12);
    expect(shareInYear(phase, 2030)).toBe(1);
    // The shares add up to the years of full effect the build-up costs: half of its length.
    const lost = [2026, 2027, 2028, 2029, 2030].reduce((sum, year) => sum + (1 - shareInYear(phase, year)), 0) - (a - 2026);
    expect(lost).toBeCloseTo(1, 12);
  });
});

describe("simulating measures at a share of their effect", () => {
  it("a share of 1 is simulate, exactly; a share of 0 leaves the measure out", () => {
    const shares = new Map(testland.policies.map((policy) => [policy.id, 1]));
    expect(simulateWeighted(testland, ALL, shares)).toEqual(simulate(testland, ALL));
    expect(simulateWeighted(testland, ALL)).toEqual(simulate(testland, ALL));
    const without = { ...ALL, policies: { ...ALL.policies } };
    delete without.policies.wealth_tax;
    expect(simulateWeighted(testland, ALL, new Map([["wealth_tax", 0]]))).toEqual(simulate(testland, without));
  });

  it("each effect does that share of what it would do", () => {
    const at = (id: string, share: number) => simulateWeighted(testland, on(id), new Map([[id, share]])).delta.balance;
    // scale: cut_admin saves 40.
    expect(at("cut_admin", 0.5)).toBeCloseTo(20, 9);
    // add: family_bonus costs 100.
    expect(at("family_bonus", 0.25)).toBeCloseTo(-25, 9);
    // set: defense_target raises defence from 200 to 300.
    expect(at("defense_target", 0.3)).toBeCloseTo(-30, 9);
    // excludeGroups with a fifth retained, and 6 more administration: 96 - 6 in full.
    expect(at("no_basic_income_non_citizens", 0.5)).toBeCloseTo(45, 9);
    // schedule: the wealth tax raises 40.
    expect(at("wealth_tax", 0.75)).toBeCloseTo(30, 9);
    // A shift moves its share along: cut_pensions saves 160 on pensions, a quarter of it comes back.
    expect(at("cut_pensions", 0.5)).toBeCloseTo(60, 9);
  });

  it("measures interact as in full: a later measure acts on what a partial one left", () => {
    // halve_mp_pay (parliament 10 -> 5) in full, then cut_admin (10 % of exp.admin) at half: it
    // cuts 5 % of what is left, 5 + 390, not half of what it cuts alone.
    const result = simulateWeighted(testland, on("halve_mp_pay", "cut_admin"), new Map([["cut_admin", 0.5]]));
    expect(result.delta.balance).toBeCloseTo(5 + 0.05 * 395, 9);
    expect(result.reform.balance - result.baseline.balance).toBeCloseTo(24.75, 9);
  });

  it("keeps the linked ranges: the low end at a share is that share of the low end", () => {
    const full = simulate(testland, on("insure_civil_servants"));
    const half = simulateWeighted(testland, on("insure_civil_servants"), new Map([["insure_civil_servants", 0.5]]));
    expect(half.deltaLow.balance).toBeCloseTo(full.deltaLow.balance / 2, 9);
    expect(half.deltaHigh.balance).toBeCloseTo(full.deltaHigh.balance / 2, 9);
  });
});

describe("the projection with timing", () => {
  const BASE = { follow: null, horizon: 30 } as const;

  it("without timing and with measures from the first projection year, nothing changes, exactly", () => {
    const declared = testlandCopy();
    declared.debt!.measuresFrom = { year: 2025, note: { en: "First year.", de: "Erstes Jahr." } };
    for (const assumptions of [BASE, { ...BASE, follow: "ministry_projection" }]) {
      const plain = projectScenario(testland, ALL, assumptions)!;
      const again = projectScenario(declared, ALL, assumptions)!;
      expect(again).toEqual(plain);
      expect(plain.phases.every((phase) => phase.immediate)).toBe(true);
      expect(plain.measuresFrom).toBe(2025);
    }
  });

  it("before the first year measures can act, the paths with measures are the path without them", () => {
    const projection = projectScenario(timed, ALL, BASE)!;
    for (const key of ["reform", "reformLow", "reformHigh"] as const) {
      expect(projection[key].start).toEqual(projection.baseline.start);
      expect(projection[key].years[0]).toEqual(projection.baseline.years[0]);
      expect(projection[key].years[1]).not.toEqual(projection.baseline.years[1]);
    }
    expect(projection.measuresFrom).toBe(2026);
  });

  it("a measure that builds up changes the primary balance by its share of the full effect each year", () => {
    const projection = projectScenario(timed, on("cut_admin"), BASE)!;
    const shares = [0, 0.125, 0.375, 0.625, 0.875, 1, 1];
    projection.reform.years.slice(0, 7).forEach((year, i) => {
      const gap = year.primaryBalanceRatio - projection.baseline.years[i].primaryBalanceRatio;
      expect(gap).toBeCloseTo(0.004 * shares[i], 12);
    });
    expect(projection.phases).toEqual([measurePhase(timed, "cut_admin")]);
  });

  it("a revenue measure that starts later changes revenue from then on", () => {
    const projection = projectScenario(timed, on("wealth_tax"), BASE)!;
    const revenueRatio = (i: number, key: "reform" | "baseline") => projection[key].years[i].revenue / projection[key].years[i].gdp;
    for (const i of [0, 1, 2]) expect(revenueRatio(i, "reform")).toBeCloseTo(revenueRatio(i, "baseline"), 12);
    for (const i of [3, 4, 20]) expect(revenueRatio(i, "reform") - revenueRatio(i, "baseline")).toBeCloseTo(0.004, 12);
  });

  it("measures that interact are simulated together in each year, also when following a plan", () => {
    const scenario = on("halve_mp_pay", "cut_admin");
    for (const assumptions of [BASE, { ...BASE, follow: "ministry_projection" }]) {
      const projection = projectScenario(timed, scenario, assumptions)!;
      // 2027: halve_mp_pay in full, cut_admin at 37.5 %: 5 + 0.0375 * 395.
      const gap = projection.reform.years[2].primaryBalanceRatio - projection.baseline.years[2].primaryBalanceRatio;
      expect(gap).toBeCloseTo((5 + 0.0375 * 395) / 10000, 12);
      // From 2030 both are in full: the change of the scenario as a whole.
      const full = simulate(timed, scenario).delta.balance / 10000;
      const late = projection.reform.years[10].primaryBalanceRatio - projection.baseline.years[10].primaryBalanceRatio;
      expect(late).toBeCloseTo(full, 12);
    }
  });

  it("the low and the high end follow the same shares", () => {
    const projection = projectScenario(timed, on("defense_target", "no_basic_income_non_citizens"), BASE)!;
    const full = simulate(timed, on("defense_target", "no_basic_income_non_citizens"));
    const gap = (key: "reformLow" | "reformHigh", i: number) =>
      projection[key].years[i].primaryBalanceRatio - projection.baseline.years[i].primaryBalanceRatio;
    // 2025: nothing; 2030 on: everything in full.
    expect(gap("reformLow", 0)).toBe(0);
    expect(gap("reformLow", 6)).toBeCloseTo(full.deltaLow.balance / 10000, 12);
    expect(gap("reformHigh", 6)).toBeCloseTo(full.deltaHigh.balance / 10000, 12);
    // In between, the defence build-up keeps the low end of 2028 above that of the full effect.
    expect(gap("reformLow", 3)).toBeGreaterThan(full.deltaLow.balance / 10000);
  });

  it("the long run holds every measure in full, even if the horizon ends during a build-up", () => {
    const short = projectScenario(timed, on("cut_admin"), { ...BASE, horizon: 3, market_rate: 2, growth: 3 })!;
    const long = projectScenario(timed, on("cut_admin"), { ...BASE, horizon: 40, market_rate: 2, growth: 3 })!;
    expect(short.reform.longRun).toEqual(long.reform.longRun);
    expect(short.reform.longRun.kind).toBe("converges");
  });

  it("projectDebt finds the measures in the result, so the interface needs nothing more", () => {
    const scenario: Scenario = { policies: { defense_target: { enabled: true, params: { share: 4 } } } };
    const projection = projectDebt(timed, simulate(timed, scenario), BASE);
    expect(projection.phases).toEqual([{ policy: "defense_target", from: "2027-07-01", start: 2027, years: 4, full: 2032, immediate: false }]);
    expect(projection).toEqual(projectScenario(timed, scenario, BASE));
  });
});
