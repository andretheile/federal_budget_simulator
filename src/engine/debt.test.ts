import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "./__fixtures__/testland.ts";
import {
  applyDebtPreset,
  decodeScenario,
  encodeScenario,
  firstYearAbove,
  firstYearBelow,
  isComparablePlan,
  isFollowablePlan,
  longRunDebtRatio,
  presetApplies,
  projectDebt,
  projectScenario,
  resolveDebtAssumptions,
  simulate,
  simulatePolicy,
  type BudgetNode,
  type CountryPack,
  type DebtAssumptions,
  type DebtFile,
  type DebtPath,
  type DebtProjection,
  type DebtYear,
  type Scenario,
} from "./index.ts";

/**
 * Testland's debt: 5000 at the end of 2024, base-year interest 100 from exp.interest (2 %), GDP
 * 10000, revenue 4000, balance -400, so the primary balance is -300 (-3 % of GDP). The tests
 * change what they need on a copy.
 */

/** A copy of Testland, changed before it is first used (the engine caches its index per pack). */
function pack(change?: (pack: CountryPack, debt: DebtFile) => void): CountryPack {
  const copy = testlandCopy();
  change?.(copy, copy.debt!);
  return copy;
}

/** Sets the base amount of a leaf. */
function setAmount(p: CountryPack, id: string, amount: number): void {
  const visit = (nodes: BudgetNode[]): void => {
    for (const node of nodes) {
      if (node.id === id && "amount" in node) node.amount = amount;
      if ("children" in node) visit(node.children);
    }
  };
  visit(p.budget.revenue);
  visit(p.budget.expenditure);
}

/** Lets a test run the model far beyond the horizons a visitor can choose. */
function longHorizons(_: CountryPack, debt: DebtFile): void {
  debt.assumptions.find((param) => param.id === "horizon")!.max = 2000;
}

function project(p: CountryPack, assumptions: Partial<DebtAssumptions>, scenario?: Scenario): DebtProjection {
  return projectDebt(p, simulate(p, scenario), assumptions);
}

const ALL: Scenario = { policies: Object.fromEntries(testland.policies.map((policy) => [policy.id, { enabled: true }])) };

/** Each expected field to 9 significant digits or so. */
function expectYear(actual: DebtYear, expected: Partial<DebtYear>): void {
  for (const [key, value] of Object.entries(expected) as [keyof DebtYear, number][]) {
    expect(actual[key], key).toBeCloseTo(value, 9);
  }
}

const PATHS = ["baseline", "reform", "reformLow", "reformHigh"] as const;

describe("the model, worked out by hand", () => {
  it("three years: half the debt refinanced each year at 4 %, no growth", () => {
    const p = pack((_, debt) => (debt.refinancing.share = 0.5));
    const { baseline } = project(p, { market_rate: 4, growth: 0, horizon: 3, drift: 0 });
    expectYear(baseline.start, {
      year: 2024,
      gdp: 10000,
      revenue: 4000,
      primaryBalance: -300,
      interest: 100,
      balance: -400,
      debt: 5000,
      debtRatio: 0.5,
      interestRatio: 0.01,
      interestToRevenue: 0.025,
      averageRate: 0.02,
    });
    expect(baseline.years).toHaveLength(3);
    // Year 1: the debt pays 0.5 * 2 % + 0.5 * 4 % = 3 %, so 150. The deficit of 150 + 300 = 450 is borrowed at 4 %.
    expectYear(baseline.years[0], { year: 2025, gdp: 10000, primaryBalance: -300, interest: 150, balance: -450, debt: 5450, averageRate: 168 / 5450 });
    // Year 2: 5450 * (0.5 * 168 / 5450 + 0.5 * 4 %) = 84 + 109 = 193; deficit 493.
    expectYear(baseline.years[1], { year: 2026, interest: 193, balance: -493, debt: 5943, averageRate: (193 + 0.04 * 493) / 5943 });
    // Year 3: 5943 * (0.5 * 212.72 / 5943 + 0.5 * 4 %) = 106.36 + 118.86 = 225.22; deficit 525.22.
    expectYear(baseline.years[2], { year: 2027, interest: 225.22, balance: -525.22, debt: 6468.22, debtRatio: 0.646822 });
  });

  it("two years with nominal growth of 10 %", () => {
    const p = pack((_, debt) => {
      debt.refinancing.share = 0.5;
      debt.assumptions.find((param) => param.id === "growth")!.max = 10;
    });
    const { baseline } = project(p, { market_rate: 4, growth: 10, horizon: 2, drift: 0 });
    // Year 1: GDP 11000, primary balance -3 % of it = -330, interest 150, debt 5000 + 480.
    expectYear(baseline.years[0], { gdp: 11000, revenue: 4400, primaryBalance: -330, interest: 150, debt: 5480, averageRate: 169.2 / 5480 });
    // Year 2: GDP 12100, primary balance -363, interest 5480 * (0.5 * 169.2 / 5480 + 2 %) = 84.6 + 109.6.
    expectYear(baseline.years[1], {
      gdp: 12100,
      revenue: 4840,
      primaryBalance: -363,
      interest: 194.2,
      balance: -557.2,
      debt: 6037.2,
      debtRatio: 6037.2 / 12100,
      interestRatio: 194.2 / 12100,
      interestToRevenue: 194.2 / 4840,
      primaryBalanceRatio: -0.03,
    });
  });

  it("a drift lowers the primary balance by its amount of GDP for every year that has passed", () => {
    const p = pack((_, debt) => (debt.refinancing.share = 0.5));
    const { baseline } = project(p, { market_rate: 4, growth: 0, horizon: 2, drift: -0.1 });
    // -3.1 % and -3.2 % of 10000.
    expectYear(baseline.years[0], { primaryBalance: -310, interest: 150, debt: 5460, averageRate: 168.4 / 5460 });
    expectYear(baseline.years[1], { primaryBalance: -320, interest: 193.4, debt: 5973.4, primaryBalanceRatio: -0.032 });
  });
});

describe("closed forms", () => {
  it("no deficit, no growth and an unchanged rate keep the debt constant", () => {
    // exp.health 700 -> 300: expenditure 4000, balance 0, primary balance 100 = interest.
    for (const share of [0.25, 1]) {
      const p = pack((p, debt) => {
        setAmount(p, "exp.health", 300);
        debt.refinancing.share = share;
      });
      const { baseline } = project(p, { market_rate: 2, growth: 0, horizon: 50, drift: 0 });
      expect(baseline.start.balance).toBe(0);
      for (const year of baseline.years) expectYear(year, { debt: 5000, interest: 100, balance: 0, averageRate: 0.02 });
    }
  });

  it("market rate equal to the old rate and all debt refinanced: debt(t) = debt(t-1) (1 + r) - primary balance(t)", () => {
    const p = pack((_, debt) => (debt.refinancing.share = 1));
    const { baseline } = project(p, { market_rate: 2, growth: 3, horizon: 50, drift: 0 });
    let previous = baseline.start;
    for (const year of baseline.years) {
      expect(year.debt).toBeCloseTo(previous.debt * 1.02 - year.primaryBalance, 6);
      expect(year.averageRate).toBeCloseTo(0.02, 12);
      previous = year;
    }
  });

  it("with all debt refinanced every year, any market rate gives the textbook formula from the first year", () => {
    const p = pack((_, debt) => (debt.refinancing.share = 1));
    const { baseline } = project(p, { market_rate: 5, growth: 1, horizon: 20, drift: 0 });
    let previous = baseline.start;
    for (const year of baseline.years) {
      expect(year.debt).toBeCloseTo(previous.debt * 1.05 - year.primaryBalance, 6);
      previous = year;
    }
  });

  it("the accounts add up in every year of every path", () => {
    const p = pack();
    const result = simulate(p, ALL);
    const projection = projectDebt(p, result);
    for (const key of PATHS) {
      const path = projection[key];
      const totals = key === "baseline" ? result.baseline : result[key];
      // The base year is the simulated balance exactly.
      expect(path.start.balance).toBe(totals.balance);
      expect(path.start.primaryBalance - path.start.interest).toBeCloseTo(totals.balance, 9);
      expect(path.start.revenue).toBe(totals.revenue);
      let previous = path.start;
      for (const year of path.years) {
        expect(year.year).toBe(previous.year + 1);
        expect(year.balance).toBeCloseTo(year.primaryBalance - year.interest, 9);
        expect(year.debt).toBeCloseTo(Math.max(0, previous.debt - year.balance), 9);
        expect(year.debtRatio).toBeCloseTo(year.debt / year.gdp, 12);
        expect(year.interestRatio).toBeCloseTo(year.interest / year.gdp, 12);
        expect(year.interestToRevenue).toBeCloseTo(year.interest / year.revenue, 12);
        expect(year.revenue / year.gdp).toBeCloseTo(totals.revenue / 10000, 12);
        previous = year;
      }
    }
  });
});

describe("surpluses", () => {
  it("repay debt and leave the average rate of the rest unchanged", () => {
    // exp.health 700 -> 0: balance +300, primary balance +400.
    const p = pack((p, debt) => {
      setAmount(p, "exp.health", 0);
      debt.refinancing.share = 0.5;
    });
    const { baseline } = project(p, { market_rate: 4, growth: 0, horizon: 2, drift: 0 });
    // Year 1: the debt pays 3 %, 150; the surplus of 250 repays debt; the rest still pays 3 %.
    expectYear(baseline.years[0], { primaryBalance: 400, interest: 150, balance: 250, debt: 4750, averageRate: 0.03 });
    // Year 2: 0.5 * 3 % + 0.5 * 4 % = 3.5 % on 4750.
    expectYear(baseline.years[1], { interest: 166.25, balance: 233.75, debt: 4516.25, averageRate: 0.035 });
  });

  it("the debt does not go below zero", () => {
    // No interest node: interest.value 10 on a debt of 500 (2 %); balance +300, primary balance +310.
    const p = pack((p, debt) => {
      setAmount(p, "exp.health", 0);
      delete debt.interest.node;
      debt.interest.value = 10;
      debt.stock.value = 500;
      debt.refinancing.share = 0.5;
    });
    const { baseline } = project(p, { market_rate: 4, growth: 0, horizon: 4, drift: 0 });
    expectYear(baseline.start, { primaryBalance: 310, interest: 10, debt: 500, averageRate: 0.02 });
    expectYear(baseline.years[0], { interest: 15, debt: 205 });
    // 205 * 3.5 % = 7.175; the surplus of 302.825 is more than the debt.
    expectYear(baseline.years[1], { interest: 7.175, debt: 0 });
    expectYear(baseline.years[2], { interest: 0, balance: 310, debt: 0, debtRatio: 0 });
    expectYear(baseline.years[3], { interest: 0, debt: 0 });
  });
});

describe("assumptions", () => {
  it("a horizon of one year gives one year, the same as the first of a longer projection", () => {
    const p = pack();
    const one = project(p, { horizon: 1 });
    const many = project(p, { horizon: 30 });
    expect(one.reform.years).toHaveLength(1);
    expect(one.reform.years[0]).toEqual(many.reform.years[0]);
    expect(one.reform.years[0].year).toBe(2025);
    expect(many.reform.years.at(-1)!.year).toBe(2054);
  });

  it("missing values take the default, the rest are clamped and the horizon is rounded", () => {
    const debt = testland.debt!;
    expect(resolveDebtAssumptions(debt)).toEqual({ market_rate: 4, growth: 3, horizon: 30, drift: 0 });
    expect(resolveDebtAssumptions(debt, { market_rate: 99, growth: Number.NaN, horizon: 12.6, drift: -9 })).toEqual({
      market_rate: 10,
      growth: 3,
      horizon: 13,
      drift: -0.5,
    });
    expect(resolveDebtAssumptions(debt, { horizon: 0 }).horizon).toBe(1);
    const projection = project(testland, { horizon: 12.6, market_rate: 99 });
    expect(projection.assumptions).toEqual({ market_rate: 10, growth: 3, horizon: 13, drift: 0 });
    expect(projection.baseline.years).toHaveLength(13);
  });

  it("a preset replaces the values it names and keeps the others", () => {
    const debt = testland.debt!;
    const [highRates, ageing] = debt.presets;
    const current = { market_rate: 5, growth: 1, horizon: 10, drift: 0.2 };
    const aged = applyDebtPreset(debt, current, ageing);
    expect(aged).toEqual({ market_rate: 5, growth: 2, horizon: 10, drift: -0.1 });
    expect(presetApplies(ageing, aged)).toBe(true);
    expect(presetApplies(highRates, aged)).toBe(false);
    expect(presetApplies(highRates, applyDebtPreset(debt, aged, highRates))).toBe(true);
    expect(current).toEqual({ market_rate: 5, growth: 1, horizon: 10, drift: 0.2 });
  });
});

describe("behaviour", () => {
  it("a higher market rate never lowers the debt, nor interest while rates are not negative, in deficit or in surplus", () => {
    for (const p of [pack(), pack((p) => setAmount(p, "exp.health", 0))]) {
      const result = simulate(p, ALL);
      let previous: DebtPath | undefined;
      for (let rate = -1; rate <= 10; rate += 0.5) {
        const { reform } = projectDebt(p, result, { market_rate: rate, horizon: 40 });
        if (previous) {
          reform.years.forEach((year, i) => {
            expect(year.debt).toBeGreaterThanOrEqual(previous!.years[i].debt);
            // Below zero a higher rate on a debt that is larger because it is paid off more slowly
            // can mean more negative interest, so interest only rises with the rate from 0 up.
            if (rate > 0) expect(year.interest).toBeGreaterThanOrEqual(previous!.years[i].interest);
          });
          if (previous.years.at(-1)!.debt > 0) expect(reform.years.at(-1)!.debt).toBeGreaterThan(previous.years.at(-1)!.debt);
        }
        previous = reform;
      }
    }
  });

  it("carries no state from one call to the next and changes neither the pack nor the result", () => {
    const p = pack();
    const result = simulate(p, ALL);
    const packBefore = JSON.stringify(p);
    const resultBefore = JSON.stringify(result);
    const first = projectDebt(p, result, { market_rate: 1 });
    projectDebt(p, result, { market_rate: 9, growth: -2, horizon: 50, drift: 0.5 });
    projectScenario(p, { policies: {} }, { market_rate: 7 });
    const again = projectDebt(p, result, { market_rate: 1 });
    expect(again).toEqual(first);
    expect(again).not.toBe(first);
    expect(JSON.stringify(p)).toBe(packBefore);
    expect(JSON.stringify(result)).toBe(resultBefore);
  });

  it("without measures all four paths are the baseline", () => {
    const projection = projectScenario(testland)!;
    for (const key of ["reform", "reformLow", "reformHigh"] as const) expect(projection[key]).toEqual(projection.baseline);
  });

  it("the range of the measures carries through: the low end has the higher debt", () => {
    const projection = projectScenario(testland, ALL)!;
    const { reform, reformLow, reformHigh } = projection;
    expect(reformLow.start.balance).toBeLessThan(reformHigh.start.balance);
    reform.years.forEach((year, i) => {
      expect(reformLow.years[i].debt).toBeGreaterThanOrEqual(year.debt);
      expect(year.debt).toBeGreaterThanOrEqual(reformHigh.years[i].debt);
    });
    expect(reformLow.years.at(-1)!.debt).toBeGreaterThan(reformHigh.years.at(-1)!.debt);
  });

  it("a measure counts in full and for good, at its share of GDP", () => {
    // cut_admin saves 40, 0.4 % of GDP: 41.2 in year 1 at 3 % growth, and the debt is that much lower.
    const p = pack();
    const projection = project(p, { growth: 3 }, { policies: { cut_admin: { enabled: true } } });
    expect(projection.reform.start.primaryBalance - projection.baseline.start.primaryBalance).toBeCloseTo(40, 9);
    expect(projection.baseline.years[0].debt - projection.reform.years[0].debt).toBeCloseTo(41.2, 9);
    projection.reform.years.forEach((year, i) => {
      expect(year.primaryBalance - projection.baseline.years[i].primaryBalance).toBeCloseTo(0.004 * year.gdp, 6);
    });
  });

  it("a measure on the interest node changes the base year but not the projection, which computes interest itself", () => {
    const p = pack((p) =>
      p.policies.push({
        id: "halve_interest",
        label: { en: "Halve interest", de: "Zinsen halbieren" },
        summary: { en: "-", de: "-" },
        topic: "other",
        params: [],
        effects: [{ type: "scale", target: "exp.interest", factor: 0.5, quality: "estimate" }],
        catches: [],
        sources: [],
      }),
    );
    const projection = project(p, {}, { policies: { halve_interest: { enabled: true } } });
    expectYear(projection.reform.start, { interest: 50, balance: -350, primaryBalance: -300, averageRate: 0.02 });
    expect(projection.reform.years).toEqual(projection.baseline.years);
    expect(projection.baseInterest).toBe(100);
  });

  it("without an interest node it takes interest.value", () => {
    const p = pack((_, debt) => delete debt.interest.node);
    const projection = project(p, {});
    expect(projection.baseInterest).toBe(95);
    expectYear(projection.baseline.start, { interest: 95, balance: -400, primaryBalance: -305, averageRate: 0.019 });
  });
});

describe("the whole state only", () => {
  it("projectDebt refuses a result filtered to one level; projectScenario ignores the filter", () => {
    const filtered = simulate(testland, { ...ALL, level: "state" });
    expect(() => projectDebt(testland, filtered)).toThrow(/whole state, but the result is filtered to level "state"/);
    const whole = projectDebt(testland, simulate(testland, ALL));
    expect(projectScenario(testland, { ...ALL, level: "state" })).toEqual(whole);
    expect(projectScenario(testland, ALL)).toEqual(whole);
  });

  it("a pack without debt.json works as before and simply has no projection", () => {
    const without = pack((p) => delete p.debt);
    expect(simulate(without, ALL)).toEqual(simulate(testland, ALL));
    expect(simulatePolicy(without, "cut_pensions")).toEqual(simulatePolicy(testland, "cut_pensions"));
    expect(decodeScenario(encodeScenario(ALL), without)).toEqual(decodeScenario(encodeScenario(ALL), testland));
    expect(projectScenario(without, ALL)).toBeUndefined();
    expect(() => projectDebt(without, simulate(without))).toThrow(/has no debt.json/);
  });
});

describe("the long run", () => {
  it("below growth the ratio settles at p (1 + g) / (m - g), which a long run of the model reaches", () => {
    // p = -3 %, m = 1 %, g = 4 %: 0.03 * 1.04 / 0.03 = 1.04.
    const p = pack(longHorizons);
    const short = project(p, { market_rate: 1, growth: 4, horizon: 30 });
    expect(short.baseline.longRun).toEqual({ kind: "converges", debtRatio: expect.closeTo(1.04, 12) });
    const long = project(p, { market_rate: 1, growth: 4, horizon: 2000 });
    expect(long.baseline.years.at(-1)!.debtRatio).toBeCloseTo(1.04, 6);
  });

  it("a primary surplus below growth pays the debt off", () => {
    const p = pack((p) => setAmount(p, "exp.health", 0));
    expect(project(p, { market_rate: 1, growth: 4 }).baseline.longRun).toEqual({ kind: "converges", debtRatio: 0 });
  });

  it("a primary deficit with rates at or above growth grows without limit", () => {
    expect(project(testland, { market_rate: 4, growth: 3 }).baseline.longRun).toEqual({ kind: "diverges" });
    expect(project(testland, { market_rate: 3, growth: 3 }).baseline.longRun).toEqual({ kind: "diverges" });
  });

  it("a primary surplus with rates above growth: paid off below p / (m - g), unbounded above it", () => {
    // Primary surplus 4 % of GDP, market rate 10 %, no growth: the line lies at 40 % of GDP.
    const cases: [number, DebtYear["debtRatio"], string][] = [
      [5000, 50, "diverges"],
      [3000, 0, "converges"],
    ];
    for (const [stock, after, kind] of cases) {
      const p = pack((p, debt) => {
        longHorizons(p, debt);
        setAmount(p, "exp.health", 0);
        debt.stock.value = stock;
        debt.refinancing.share = 0.5;
      });
      const assumptions = { market_rate: 10, growth: 0 };
      expect(project(p, { ...assumptions, horizon: 1 }).baseline.longRun.kind).toBe(kind);
      expect(project(p, { ...assumptions, horizon: 30 }).baseline.longRun.kind).toBe(kind);
      // The model run on confirms it.
      const last = project(p, { ...assumptions, horizon: 300 }).baseline.years.at(-1)!;
      if (after === 0) expect(last.debt).toBe(0);
      else expect(last.debtRatio).toBeGreaterThan(after);
    }
  });

  it("a balanced primary budget with rates equal to growth keeps the ratio where the old rates leave it", () => {
    // exp.health 700 -> 400: balance -100, primary balance 0.
    const p = pack((p, debt) => {
      longHorizons(p, debt);
      setAmount(p, "exp.health", 400);
    });
    const longRun = project(p, { market_rate: 3, growth: 3, horizon: 30 }).baseline.longRun;
    const last = project(p, { market_rate: 3, growth: 3, horizon: 2000 }).baseline.years.at(-1)!;
    expect(longRun).toEqual({ kind: "converges", debtRatio: expect.closeTo(last.debtRatio, 9) });
    expect(last.debtRatio).toBeLessThan(0.5);
  });

  it("a drift never settles", () => {
    expect(project(testland, { drift: 0.1 }).baseline.longRun).toEqual({ kind: "drifts" });
    expect(project(testland, { drift: -0.1 }).reform.longRun).toEqual({ kind: "drifts" });
  });

  it("is the same whether attached to the path or computed again", () => {
    const projection = project(testland, { market_rate: 2, growth: 3.5 });
    expect(longRunDebtRatio(projection, projection.reform)).toEqual(projection.reform.longRun);
  });
});

describe("search helpers", () => {
  const { baseline } = project(testland, {});

  it("finds the first year above a threshold, counting the base year", () => {
    const year = firstYearAbove(baseline, 0.6)!;
    const records = [baseline.start, ...baseline.years];
    const index = records.findIndex((record) => record.year === year);
    expect(records[index].debtRatio).toBeGreaterThan(0.6);
    expect(records[index - 1].debtRatio).toBeLessThanOrEqual(0.6);
    // Already above in the base year, and never above.
    expect(firstYearAbove(baseline, 0.4)).toBe(2024);
    expect(firstYearAbove(baseline, 100)).toBeNull();
  });

  it("works on any measure, e.g. the year interest overtakes defence (2 % of GDP)", () => {
    const year = firstYearAbove(baseline, 200 / 10000, "interestRatio")!;
    const record = baseline.years.find((candidate) => candidate.year === year)!;
    expect(record.interest).toBeGreaterThan(0.02 * record.gdp);
    expect(baseline.years.find((candidate) => candidate.year === year - 1)!.interestRatio).toBeLessThanOrEqual(0.02);
  });

  it("finds the first year below a threshold", () => {
    expect(firstYearBelow(baseline, 0.6)).toBe(2024);
    const surplus = project(
      pack((p) => setAmount(p, "exp.health", 0)),
      {},
    ).baseline;
    const year = firstYearBelow(surplus, 0.3)!;
    expect(surplus.years.find((record) => record.year === year)!.debtRatio).toBeLessThan(0.3);
    expect(firstYearBelow(surplus, -1)).toBeNull();
  });
});

describe("official plans", () => {
  it("only a whole-state plan in national accounts can be drawn against the projection", () => {
    const [ministry, centralInterest] = testland.debt!.plans!;
    expect(isComparablePlan(ministry)).toBe(true);
    expect(isComparablePlan(centralInterest)).toBe(false);
    expect(isComparablePlan({ ...ministry, accounts: "cash" })).toBe(false);
    expect(isComparablePlan({ ...ministry, scope: "central" })).toBe(false);
  });

  it("change nothing in the projection", () => {
    const pack = testlandCopy();
    delete pack.debt!.plans;
    expect(projectScenario(pack, { policies: {} })).toEqual(projectScenario(testland, { policies: {} }));
  });
});

describe("following a plan", () => {
  // Testland's ministry projection: 52 % of GDP in 2025, 55 % in 2026 with 4 % growth, balance -3.5 % in 2026.
  const FOLLOW = { follow: "ministry_projection" };
  const preset = testland.debt!.presets.find((candidate) => candidate.id === "ministry_plan")!;

  it("without follow the projection is what it always was", () => {
    const plain = projectScenario(testland, ALL)!;
    expect(plain.followed).toBeUndefined();
    expect("follow" in plain.assumptions).toBe(false);
    expect(projectScenario(testland, ALL, { follow: undefined })).toEqual(plain);
    // A plan that cannot be followed, or none at all, is dropped and changes nothing.
    for (const follow of ["central_budget_interest", "no_such"]) {
      const projection = projectScenario(testland, ALL, { follow })!;
      expect(projection).toEqual(plain);
    }
  });

  it("only a whole-state plan in national accounts with a debt ratio every year can be followed", () => {
    const [ministry, centralInterest] = testland.debt!.plans!;
    expect(isFollowablePlan(ministry)).toBe(true);
    expect(isFollowablePlan(centralInterest)).toBe(false);
    expect(isFollowablePlan({ ...ministry, points: [ministry.points[0], { ...ministry.points[1], year: 2027 }] })).toBe(false);
    expect(isFollowablePlan({ ...ministry, points: [ministry.points[0], { ...ministry.points[1], balanceRatio: undefined }] })).toBe(false);
    expect(isFollowablePlan({ ...ministry, points: [{ year: 2025, balanceRatio: -0.04 }, ministry.points[1]] })).toBe(false);
    expect(resolveDebtAssumptions(testland.debt!, { follow: "central_budget_interest" }).follow).toBeUndefined();
    expect(resolveDebtAssumptions(testland.debt!, FOLLOW).follow).toBe("ministry_projection");
  });

  it("the path without measures meets the plan's debt ratio in each of its years, with the plan's growth", () => {
    const projection = projectScenario(testland, { policies: {} }, FOLLOW)!;
    const [y2025, y2026] = projection.baseline.years;
    expect(y2025.debtRatio).toBeCloseTo(0.52, 12);
    expect(y2026.debtRatio).toBeCloseTo(0.55, 12);
    // 3 % growth from the assumption in 2025, 4 % from the plan in 2026.
    expectYear(y2025, { gdp: 10300, debt: 5356, interest: 125, primaryBalance: -231 });
    expectYear(y2026, { gdp: 10712, debt: 5891.6 });
    expect(projection.followed).toEqual({ plan: "ministry_projection", until: 2026 });
  });

  it("after the plan it holds the plan's last balance plus the model's interest, and the drift counts from there", () => {
    const projection = projectScenario(testland, { policies: {} }, { ...FOLLOW, drift: -0.1 })!;
    const [, y2026, y2027, y2028] = projection.baseline.years;
    const held = -0.035 + y2026.interestRatio;
    expect(y2027.primaryBalanceRatio).toBeCloseTo(held - 0.001, 12);
    expect(y2028.primaryBalanceRatio).toBeCloseTo(held - 0.002, 12);
    // Growth after the plan is the assumption's again.
    expect(y2027.gdp / y2026.gdp).toBeCloseTo(1.03, 12);
    // The debt at the end of the plan is the plan's whatever the drift.
    expect(y2026.debtRatio).toBeCloseTo(0.55, 12);
  });

  it("measures shift the path as they do without a plan", () => {
    const projection = projectScenario(testland, ALL, FOLLOW)!;
    const base = projectScenario(testland, ALL)!;
    // The change of the base year's primary balance, as a share of GDP, applies in every year.
    const change = base.reform.start.primaryBalanceRatio - base.baseline.start.primaryBalanceRatio;
    for (const key of ["reform", "reformLow", "reformHigh"] as const) {
      const own = base[key].start.primaryBalanceRatio - base.baseline.start.primaryBalanceRatio;
      projection[key].years.forEach((year, i) => {
        expect(year.primaryBalanceRatio - projection.baseline.years[i].primaryBalanceRatio).toBeCloseTo(own, 12);
      });
    }
    // Only the path without measures meets the plan; the measures of ALL improve the balance, so
    // the debt stays below it.
    expect(change).toBeGreaterThan(0);
    expect(projection.reform.years[1].debtRatio).toBeLessThan(0.55);
    expect(projection.baseline.years[1].debtRatio).toBeCloseTo(0.55, 12);
    expect(projection.reform.start).toEqual(base.reform.start);
  });

  it("the horizon can end inside the plan; the long run still holds the balance after the plan", () => {
    const short = projectScenario(testland, { policies: {} }, { ...FOLLOW, horizon: 1 })!;
    expect(short.baseline.years).toHaveLength(1);
    expect(short.followed).toEqual({ plan: "ministry_projection", until: 2025 });
    const long = projectScenario(testland, { policies: {} }, { ...FOLLOW, horizon: 30 })!;
    expect(short.baseline.years[0]).toEqual(long.baseline.years[0]);
    // At 4 % on new debt and 3 % growth a primary deficit diverges, whether the horizon ends in or after the plan.
    expect(long.baseline.years[2].primaryBalanceRatio).toBeLessThan(0);
    expect(short.baseline.longRun).toEqual({ kind: "diverges" });
    expect(long.baseline.longRun).toEqual({ kind: "diverges" });
  });

  it("a preset can follow a plan; one without follow stops following", () => {
    const followed = applyDebtPreset(testland.debt!, resolveDebtAssumptions(testland.debt!), preset);
    expect(followed.follow).toBe("ministry_projection");
    expect(presetApplies(preset, followed)).toBe(true);
    const highRates = testland.debt!.presets[0];
    expect(presetApplies(highRates, { ...followed, market_rate: 8 })).toBe(false);
    const after = applyDebtPreset(testland.debt!, followed, highRates);
    expect(after.follow).toBeUndefined();
    expect(presetApplies(highRates, after)).toBe(true);
    expect(presetApplies(preset, after)).toBe(false);
  });
});
