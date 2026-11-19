/**
 * The goal bar's view of a goal, on Testland. The default goal "central_gap" asks the central
 * government's balance to improve by 100. On its own, no_basic_income_non_citizens improves it by
 * 94.8 (45.6 to 94.8), cut_admin by 8.8, raise_top_tax_rate by 62.5 (no range); the wealth tax goes
 * to the provinces and changes nothing there; insure_civil_servants burdens it by 17.5 (both ends of
 * its range, -17 and -15.125, lie above that). "close_deficit" is about the whole state (400) and
 * leaves out exp.defense and the measure family_bonus.
 */
import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import { findGoal, goalLevel, simulate, type Goal, type Scenario } from "../engine/index.ts";
import { atGoalLevel, chosenGoal, goalView, otherLevelsChange } from "./goalModel.ts";

const central = findGoal(testland, "central_gap")!;
const whole = findGoal(testland, "close_deficit")!;
const on = (...ids: string[]): Scenario => ({ policies: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) });
const viewOf = (goal: Goal, scenario: Scenario) => goalView(goal, simulate(testland, { ...scenario, level: goalLevel(goal) }));

describe("the state of a goal", () => {
  it("nothing switched on: the whole amount is missing, and the bar is empty", () => {
    const view = viewOf(central, on());
    expect(view.state).toBe("none");
    expect(view.remaining).toBe(100);
    expect(view.range).toBeUndefined();
    expect(view.bar).toEqual({ zero: 0, goal: 100, fill: null, range: null, value: 0 });
  });

  it("switched on, but nothing reaches the goal's level: unchanged, not 'none'", () => {
    // The wealth tax accrues to the provinces.
    const view = viewOf(central, on("wealth_tax"));
    expect(view.state).toBe("unchanged");
    expect(view.improvement).toBe(0);
    expect(view.bar.fill).toBeNull();
  });

  it("partly closed: what is covered, what is missing, the range including the central figure", () => {
    const view = viewOf(central, on("no_basic_income_non_citizens"));
    expect(view.state).toBe("partial");
    expect(view.improvement).toBeCloseTo(94.8, 9);
    expect(view.remaining).toBeCloseTo(5.2, 9);
    expect(view.range?.[0]).toBeCloseTo(45.6, 9);
    expect(view.range?.[1]).toBeCloseTo(94.8, 9);
    expect(view.bar.fill?.direction).toBe("improve");
    expect(view.bar.fill?.from).toBe(0);
    expect(view.bar.fill?.to).toBeCloseTo(94.8, 6);
    expect(view.bar.value).toBe(95);
  });

  it("closed at the central figure but not at the cautious end of the range", () => {
    const view = viewOf(central, on("no_basic_income_non_citizens", "cut_admin"));
    expect(view.state).toBe("closed");
    expect(view.surplus).toBeCloseTo(3.6, 9);
    expect(view.closedCautious).toBe(false);
    expect(view.cautious).toBeCloseTo(54.4, 9);
    expect(view.remainingCautious).toBeCloseTo(45.6, 9);
    // The scale reaches past the goal; the goal's tick stands inside the bar.
    expect(view.bar.goal).toBeCloseTo((100 / 103.6) * 100, 6);
    expect(view.bar.value).toBe(100);
  });

  it("closed even at the cautious end", () => {
    const view = viewOf(central, on("no_basic_income_non_citizens", "raise_top_tax_rate"));
    expect(view.state).toBe("closed");
    expect(view.closedCautious).toBe(true);
    expect(view.remainingCautious).toBe(0);
  });

  it("a burden: the gap grows, the fill runs left of zero and is marked as worsening", () => {
    const view = viewOf(central, on("insure_civil_servants"));
    expect(view.state).toBe("burden");
    expect(view.growth).toBeCloseTo(17.5, 9);
    expect(view.remaining).toBeCloseTo(117.5, 9);
    // Both ends of the measure's range lie above its central figure; the range shown takes all three.
    expect(view.range?.[0]).toBeCloseTo(-17.5, 9);
    expect(view.range?.[1]).toBeCloseTo(-15.125, 9);
    expect(view.bar.zero).toBeCloseTo((17.5 / 117.5) * 100, 6);
    expect(view.bar.fill).toEqual({ from: 0, to: view.bar.zero, direction: "worsen" });
    expect(view.bar.value).toBe(0);
  });

  it("a mix: what relieves and what burdens are netted, either way", () => {
    expect(viewOf(central, on("no_basic_income_non_citizens", "insure_civil_servants")).state).toBe("partial");
    const net = viewOf(central, on("no_basic_income_non_citizens", "defense_target"));
    expect(net.state).toBe("burden");
    expect(net.growth).toBeCloseTo(5.2, 9);
  });

  it("is measured at the goal's level whatever level the result it came from shows", () => {
    expect(atGoalLevel(central, simulate(testland, { policies: {}, level: "central" }))).toBe(true);
    expect(atGoalLevel(central, simulate(testland, { policies: {} }))).toBe(false);
    expect(atGoalLevel(whole, simulate(testland, { policies: {} }))).toBe(true);
    expect(() => goalView(central, simulate(testland, { policies: {} }))).toThrow();
  });
});

describe("what a goal leaves out", () => {
  it("lists only what is not zero, in the goal's order, with the sum", () => {
    expect(viewOf(whole, on("wealth_tax")).excluded).toEqual([]);
    const view = viewOf(whole, on("wealth_tax", "defense_target", "family_bonus"));
    expect(view.excluded.map((change) => change.node ?? change.policy)).toEqual(["exp.defense", "family_bonus"]);
    expect(view.excluded[0].improvement).toBeCloseTo(-100, 9);
    expect(view.excluded[1].improvement).toBeCloseTo(-100, 9);
    expect(view.excludedTotal).toBeCloseTo(-200, 9);
    // What is left out does not count: the wealth tax's 40 is all that does.
    expect(view.improvement).toBeCloseTo(40, 9);
    expect(view.state).toBe("partial");
  });

  it("writes a figure within floating-point noise as zero: no sign, no direction, no fill", () => {
    const view = viewOf(whole, on("defense_target"));
    expect(view.improvement).toBe(0);
    expect(view.state).toBe("unchanged");
    expect(view.bar.fill).toBeNull();
  });
});

describe("the goal a page shows", () => {
  it("is the one asked for, else the pack's default; none without goals", () => {
    expect(chosenGoal(testland, undefined)?.id).toBe("central_gap");
    expect(chosenGoal(testland, "close_deficit")?.id).toBe("close_deficit");
    expect(chosenGoal(testland, "no_such_goal")?.id).toBe("central_gap");
    const { goals: _, ...withoutGoals } = testlandCopy();
    expect(chosenGoal(withoutGoals, undefined)).toBeUndefined();
  });
});

describe("what the other levels bear", () => {
  // no_basic_income_non_citizens relieves the centre by 94.8 while the provinces pay 4.8 more for
  // administration; cut_admin relieves the centre by 8.8 and the provinces by 31.2; halve_mp_pay
  // touches the centre alone. Testland has no measure that only moves a cost between levels while
  // relieving the centre: this is the nearest.
  const whole = (scenario: Scenario) => simulate(testland, { ...scenario, level: "all" });
  const withWhole = (goal: Goal, scenario: Scenario) => goalView(goal, simulate(testland, { ...scenario, level: goalLevel(goal) }), whole(scenario));

  it("is the whole state's change less the goal level's, shown when the other levels are burdened", () => {
    const view = withWhole(central, on("no_basic_income_non_citizens"));
    expect(view.state).toBe("partial");
    expect(view.othersBurden).toBeCloseTo(4.8, 9);
    // With the goal closed, and with the gap growing, alike.
    const both = withWhole(central, on("no_basic_income_non_citizens", "family_bonus"));
    expect(both.state).toBe("partial");
    expect(both.othersBurden).toBeCloseTo(54.8, 9);
    const growing = withWhole(central, on("family_bonus"));
    expect(growing.state).toBe("burden");
    expect(growing.othersBurden).toBeCloseTo(50, 9);
  });

  it("is zero when the other levels are relieved or unchanged, for a whole-state goal, and without the whole state", () => {
    expect(withWhole(central, on("cut_admin")).othersBurden).toBe(0);
    expect(withWhole(central, on("halve_mp_pay")).othersBurden).toBe(0);
    expect(withWhole(findGoal(testland, "close_deficit")!, on("no_basic_income_non_citizens")).othersBurden).toBe(0);
    expect(viewOf(central, on("no_basic_income_non_citizens")).othersBurden).toBe(0);
  });

  it("writes floating-point noise as zero, and a real amount as it is", () => {
    const totals = (balance: number) => ({ revenue: 4000, expenditure: 4000 - balance, balance });
    const result = (level: "all" | "central", change: number) =>
      ({ level, baseline: totals(-400), reform: totals(-400 + change) }) as unknown as Parameters<typeof otherLevelsChange>[0];
    // The noise level is a billionth of the larger side, here 4400e-9.
    expect(otherLevelsChange(result("central", 10), result("all", 10 - 4e-6))).toBe(0);
    expect(otherLevelsChange(result("central", 10), result("all", 10 - 1e-3))).toBeCloseTo(-1e-3, 9);
    expect(otherLevelsChange(result("central", 10), result("all", 15))).toBeCloseTo(5, 9);
  });
});
