/**
 * Testland's two official plans: the ministry's projection for the whole state in national
 * accounts (debt 52 % and 55 % of GDP, balance -4 % and -3.5 % in 2025 and 2026, interest for 2026
 * only), and the central budget's interest in cash (110 and 120), which cannot be set against the
 * projection.
 */
import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import { projectScenario, simulate } from "../engine/index.ts";
import { defaultDebtAssumptions } from "./debtLink.ts";
import { comparablePlans, otherPlans, planAgainstDefaults, planFields, planSeries } from "./debtPlans.ts";

describe("the official plans of a pack", () => {
  it("sorts them into those drawn against the projection and those that stand apart", () => {
    expect(comparablePlans(testland).map((plan) => plan.id)).toEqual(["ministry_projection"]);
    expect(otherPlans(testland).map((plan) => plan.id)).toEqual(["central_budget_interest"]);
    const pack = testlandCopy();
    delete pack.debt!.plans;
    expect(comparablePlans(pack)).toEqual([]);
    expect(otherPlans(pack)).toEqual([]);
  });

  it("gives a plan's values of one figure where it has them, within the chart's years", () => {
    const [plan] = comparablePlans(testland);
    expect(planSeries(plan, "debtRatio", 2024, 2054)).toEqual([
      { year: 2025, value: 0.52 },
      { year: 2026, value: 0.55 },
    ]);
    expect(planSeries(plan, "interestRatio", 2024, 2054)).toEqual([{ year: 2026, value: 0.012 }]);
    // A horizon of one year ends before the plan's second year.
    expect(planSeries(plan, "debtRatio", 2024, 2025)).toEqual([{ year: 2025, value: 0.52 }]);
  });

  it("names the figures a plan gives, in a fixed order", () => {
    expect(planFields(comparablePlans(testland)[0])).toEqual(["debtRatio", "balanceRatio", "interestRatio", "interestToRevenue"]);
    expect(planFields(otherPlans(testland)[0])).toEqual(["interest"]);
  });

  it("sets a plan's last debt ratio against the projection at its defaults, without measures and following no plan", () => {
    const whole = simulate(testland, { policies: { halve_mp_pay: { enabled: true } } });
    const defaults = defaultDebtAssumptions(testland.debt!);
    const against = planAgainstDefaults(testland, comparablePlans(testland)[0], whole, { ...defaults, follow: "ministry_projection" });
    expect(against?.year).toBe(2026);
    expect(against?.plan).toBe(0.55);
    // The path without measures at the defaults, whatever the scenario and the plan followed.
    const plain = projectScenario(testland, { policies: {} }, defaults)!.baseline.years[1];
    expect(plain.year).toBe(2026);
    expect(against?.model).toBeCloseTo(plain.debtRatio, 12);
    expect(against?.model).toBeCloseTo(0.5574, 4);
    expect(planAgainstDefaults(testland, otherPlans(testland)[0], whole, defaults)).toBeUndefined();
  });
});
