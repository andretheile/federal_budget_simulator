import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "./__fixtures__/testland.ts";
import { defaultGoal, findGoal, goalLevel, goalProgress, measureGoal } from "./goals.ts";
import { simulate, simulatePolicy, type Scenario } from "./simulate.ts";
import type { Goal } from "./types.ts";

const on = (...ids: string[]): Scenario => ({ policies: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) });
const centralGap = findGoal(testland, "central_gap")!;
const closeDeficit = findGoal(testland, "close_deficit")!;

describe("finding goals", () => {
  it("by id, the default, and the level each is about", () => {
    expect(centralGap.amount).toBe(100);
    expect(defaultGoal(testland)).toBe(centralGap);
    expect(findGoal(testland, "no_such")).toBeUndefined();
    expect(goalLevel(centralGap)).toBe("central");
    // Without a level a goal is about the whole state.
    expect(goalLevel(closeDeficit)).toBe("all");
  });

  it("a pack without goals.json has none", () => {
    const pack = testlandCopy();
    delete pack.goals;
    expect(defaultGoal(pack)).toBeUndefined();
    expect(findGoal(pack, "central_gap")).toBeUndefined();
    expect(goalProgress(pack, on("cut_admin"), "central_gap")).toBeUndefined();
  });
});

describe("goalProgress", () => {
  it("without measures nothing is closed", () => {
    expect(goalProgress(testland, { policies: {} }, centralGap)).toEqual({
      goal: centralGap,
      level: "central",
      needed: 100,
      improvement: 0,
      improvementLow: 0,
      improvementHigh: 0,
      excluded: [],
      excludedImprovement: 0,
      excludedImprovementLow: 0,
      excludedImprovementHigh: 0,
      remaining: 100,
      remainingLow: 100,
      remainingHigh: 100,
      share: 0,
      closed: false,
      closedLow: false,
      closedHigh: false,
    });
  });

  it("measures a level by the relief of that level, with its range", () => {
    // 96 less basic income support, which the centre pays alone, and a fifth of 6 more administration.
    const progress = goalProgress(testland, on("no_basic_income_non_citizens"), "central_gap")!;
    expect(progress.improvement).toBeCloseTo(94.8, 9);
    expect(progress.improvementLow).toBeCloseTo(48 - 12 * 0.2, 9);
    expect(progress.improvementHigh).toBeCloseTo(94.8, 9);
    expect(progress.remaining).toBeCloseTo(5.2, 9);
    expect(progress.remainingLow).toBeCloseTo(54.4, 9);
    expect(progress.remainingHigh).toBeCloseTo(5.2, 9);
    expect(progress.share).toBeCloseTo(0.948, 9);
    expect(progress).toMatchObject({ closed: false, closedLow: false, closedHigh: false });
  });

  it("is exactly the figure the simulation gives for that level", () => {
    for (const scenario of [on("no_basic_income_non_citizens"), on("cut_pensions", "family_bonus"), on(...testland.policies.map((p) => p.id))]) {
      const result = simulate(testland, { ...scenario, level: "central" });
      const progress = goalProgress(testland, scenario, centralGap)!;
      // The scoreboard of a single level shows reform minus baseline, with deltaLow and deltaHigh as its range.
      expect(progress.improvement).toBe(result.reform.balance - result.baseline.balance);
      expect(progress.improvementLow).toBe(result.deltaLow.balance);
      expect(progress.improvementHigh).toBe(result.deltaHigh.balance);
    }
    // And for one measure on its own, what its card lists as the relief of the level.
    const alone = simulatePolicy(testland, "cut_pensions", undefined, "central")!;
    expect(goalProgress(testland, on("cut_pensions"), centralGap)!.improvement).toBeCloseTo(alone.delta.balance, 9);
  });

  it("keeps the linked ranges of the simulation, even where the low end lies above the central value", () => {
    // insure_civil_servants: the centre pays a fifth of the employer's part (50) and bears half of
    // the 15 less income tax. The end of the range is chosen on the effect on the whole state.
    const progress = goalProgress(testland, on("insure_civil_servants"), centralGap)!;
    expect(progress.improvement).toBeCloseTo(-10 - 7.5, 9);
    expect(progress.improvementLow).toBeCloseTo(-40 * 0.2 - 15 * 0.8 * 1.5 * 0.5, 9);
    expect(progress.improvementHigh).toBeCloseTo(-55 * 0.2 - 15 * 1.1 * 0.5 * 0.5, 9);
    expect(progress.improvementLow).toBeGreaterThan(progress.improvement);
    expect(progress.remaining).toBeCloseTo(117.5, 9);
  });

  it("does not depend on the level the scenario is filtered to", () => {
    const scenario = on("no_basic_income_non_citizens", "cut_admin");
    const unfiltered = goalProgress(testland, scenario, centralGap);
    for (const level of ["all", "central", "state", "social_security", "local"] as const) {
      expect(goalProgress(testland, { ...scenario, level }, centralGap)).toEqual(unfiltered);
    }
  });

  it("a goal without a level is about the whole state's balance", () => {
    // wealth_tax +40 (20 to 50) and cut_admin +40.
    const progress = goalProgress(testland, { ...on("wealth_tax", "cut_admin"), level: "central" }, closeDeficit)!;
    const whole = simulate(testland, on("wealth_tax", "cut_admin"));
    expect(progress.level).toBe("all");
    expect(progress.improvement).toBe(whole.reform.balance - whole.baseline.balance);
    expect(progress.improvement).toBeCloseTo(80, 9);
    expect(progress.improvementLow).toBeCloseTo(60, 9);
    expect(progress.improvementHigh).toBeCloseTo(90, 9);
    expect(progress.remaining).toBeCloseTo(320, 9);
  });

  it("closes a goal, and says whether the whole range does", () => {
    // Centre: halve_mp_pay +5, cut_admin +0.5 on parliament and +7.8 on other administration,
    // no_basic_income_non_citizens +94.8 (45.6 to 94.8).
    const progress = goalProgress(testland, on("halve_mp_pay", "cut_admin", "no_basic_income_non_citizens"), centralGap)!;
    expect(progress.improvement).toBeCloseTo(108.1, 9);
    expect(progress.improvementLow).toBeCloseTo(58.9, 9);
    expect(progress.remaining).toBe(0);
    expect(progress.remainingLow).toBeCloseTo(41.1, 9);
    expect(progress.remainingHigh).toBe(0);
    expect(progress.share).toBeCloseTo(1.081, 9);
    expect(progress).toMatchObject({ closed: true, closedLow: false, closedHigh: true });
  });

  it("a measure that burdens the level takes it further from the goal", () => {
    const progress = goalProgress(testland, on("defense_target"), centralGap)!;
    expect(progress.improvement).toBeCloseTo(-100, 9);
    expect(progress.remaining).toBeCloseTo(200, 9);
    expect(progress.share).toBeCloseTo(-1, 9);
    expect(progress.closed).toBe(false);
  });

  it("takes a goal that is not in the pack, too", () => {
    const goal: Goal = { ...centralGap, id: "small", amount: 5 };
    expect(goalProgress(testland, on("halve_mp_pay"), goal)!.closed).toBe(true);
  });
});

describe("measureGoal", () => {
  it("measures several goals of one level against one simulation", () => {
    const scenario = on("no_basic_income_non_citizens");
    const result = simulate(testland, { ...scenario, level: "central" });
    expect(measureGoal(centralGap, result)).toEqual(goalProgress(testland, scenario, centralGap));
    const bigger: Goal = { ...centralGap, id: "bigger", amount: 200 };
    expect(measureGoal(bigger, result).remaining).toBeCloseTo(105.2, 9);
  });

  it("refuses a result for another level", () => {
    expect(() => measureGoal(centralGap, simulate(testland))).toThrow(/about level "central", but the result is for level "all"/);
    expect(() => measureGoal(closeDeficit, simulate(testland, { policies: {}, level: "central" }))).toThrow(/about level "all"/);
  });
});

describe("excluded nodes", () => {
  const without = (goal: Goal, ...nodes: string[]): Goal => ({
    ...goal,
    excluded: nodes.map((node) => ({ node, reason: { en: "Outside the rule.", de: "Außerhalb der Regel." } })),
  });

  it("leave their changes out of the improvement and report them beside it", () => {
    // The whole state: defense_target costs 100, all of it on the excluded exp.defense.
    const progress = goalProgress(testland, on("defense_target", "cut_admin"), closeDeficit);
    expect(progress.excluded).toEqual([
      { node: "exp.defense", improvement: -100 },
      { policy: "family_bonus", improvement: 0 },
    ]);
    expect(progress.excludedImprovement).toBeCloseTo(-100, 9);
    expect(progress.improvement).toBeCloseTo(40, 9);
    expect(progress.remaining).toBeCloseTo(360, 9);
    // A node the scenario does not touch is listed with 0.
    expect(goalProgress(testland, on("cut_admin"), closeDeficit).excluded).toEqual([
      { node: "exp.defense", improvement: 0 },
      { policy: "family_bonus", improvement: 0 },
    ]);
  });

  it("counted plus excluded is the scoreboard's figure for the level, at both ends of the range", () => {
    const goal = without(centralGap, "exp.admin", "exp.defense");
    for (const scenario of [on("insure_civil_servants"), on("cut_pensions", "family_bonus", "defense_target"), on(...testland.policies.map((p) => p.id))]) {
      const result = simulate(testland, { ...scenario, level: "central" });
      const progress = goalProgress(testland, scenario, goal);
      expect(progress.improvement + progress.excludedImprovement).toBeCloseTo(result.reform.balance - result.baseline.balance, 9);
      expect(progress.improvementLow + progress.excludedImprovementLow).toBeCloseTo(result.deltaLow.balance, 9);
      expect(progress.improvementHigh + progress.excludedImprovementHigh).toBeCloseTo(result.deltaHigh.balance, 9);
      // The excluded part is the change of the excluded nodes at the level.
      const onNodes = -(result.nodes["exp.admin"].delta + result.nodes["exp.defense"].delta);
      expect(progress.excludedImprovement).toBeCloseTo(onNodes, 9);
      expect(progress.excluded.map((entry) => entry.node)).toEqual(["exp.admin", "exp.defense"]);
    }
  });

  it("take the same end of each measure's range as the rest", () => {
    // insure_civil_servants at the centre: a fifth of the employer's part (50) on exp.admin.other,
    // excluded, and half of the 15 less income tax, counted. The multiplier is chosen on the whole
    // state (0.8 at the low end, 1.1 at the high end) and applies to both parts alike.
    const progress = goalProgress(testland, on("insure_civil_servants"), without(centralGap, "exp.admin"));
    expect(progress.excludedImprovement).toBeCloseTo(-10, 9);
    expect(progress.excludedImprovementLow).toBeCloseTo(-8, 9);
    expect(progress.excludedImprovementHigh).toBeCloseTo(-11, 9);
    expect(progress.improvement).toBeCloseTo(-7.5, 9);
    expect(progress.improvementLow).toBeCloseTo(-9, 9);
    expect(progress.improvementHigh).toBeCloseTo(-4.125, 9);
  });

  it("a shift that lands on an excluded node is left out with it", () => {
    // cut_pensions: the centre saves 40 on pensions and pays 40 more basic income support (the shift).
    const progress = goalProgress(testland, on("cut_pensions"), without(centralGap, "exp.social.basic_income"));
    expect(progress.excludedImprovement).toBeCloseTo(-40, 9);
    expect(progress.improvement).toBeCloseTo(40, 9);
    const result = simulate(testland, { ...on("cut_pensions"), level: "central" });
    expect(progress.improvementLow + progress.excludedImprovementLow).toBeCloseTo(result.deltaLow.balance, 9);
  });

  it("refuse a node inside a group that an effect changes as a whole", () => {
    // cut_admin scales exp.admin; what of it falls on the parliament cannot be told apart.
    expect(() => goalProgress(testland, on("cut_admin"), without(centralGap, "exp.admin.parliament"))).toThrow(
      /excludes "exp.admin.parliament", but effect 0 of policy "cut_admin" changes "exp.admin"/,
    );
    // Without that measure switched on there is nothing to tell apart.
    expect(goalProgress(testland, on("halve_mp_pay"), without(centralGap, "exp.admin.parliament")).improvement).toBe(0);
  });
});

describe("excluded measures", () => {
  const reason = { en: "Already in the plan.", de: "Schon im Plan." };

  it("leave out the measure's own result inside the scenario, at the goal's level", () => {
    // family_bonus costs 100, half of it at the centre; cut_admin relieves the centre by 8.8.
    const goal: Goal = { ...centralGap, excluded: [{ policy: "family_bonus", reason }] };
    const scenario = on("family_bonus", "cut_admin");
    const progress = goalProgress(testland, scenario, goal);
    const result = simulate(testland, { ...scenario, level: "central" });
    const bonus = result.policies.find((policy) => policy.id === "family_bonus")!;
    expect(progress.excluded).toEqual([{ policy: "family_bonus", improvement: bonus.delta.balance }]);
    expect(progress.excludedImprovement).toBeCloseTo(-50, 9);
    expect(progress.improvement).toBeCloseTo(8.8, 9);
    // A measure that is off leaves out nothing.
    expect(goalProgress(testland, on("cut_admin"), goal).excluded).toEqual([{ policy: "family_bonus", improvement: 0 }]);
  });

  it("keep the order in which measures act on the same items, and the linked ranges", () => {
    // no_basic_income_non_citizens removes part of basic income support before cut_pensions shifts
    // pensioners onto it; the excluded measure keeps exactly its share of that sequence.
    const goal: Goal = { ...centralGap, excluded: [{ policy: "insure_civil_servants", reason }] };
    const scenario = on(...testland.policies.map((p) => p.id));
    const progress = goalProgress(testland, scenario, goal);
    const result = simulate(testland, { ...scenario, level: "central" });
    const own = result.policies.find((policy) => policy.id === "insure_civil_servants")!;
    expect(progress.excludedImprovement).toBe(own.delta.balance);
    expect(progress.excludedImprovementLow).toBe(own.low.balance);
    expect(progress.excludedImprovementHigh).toBe(own.high.balance);
    expect(progress.improvement + progress.excludedImprovement).toBeCloseTo(result.reform.balance - result.baseline.balance, 9);
    expect(progress.improvementLow + progress.excludedImprovementLow).toBeCloseTo(result.deltaLow.balance, 9);
    expect(progress.improvementHigh + progress.excludedImprovementHigh).toBeCloseTo(result.deltaHigh.balance, 9);
  });

  it("a change under both an excluded measure and an excluded node is left out once, under the measure", () => {
    // cut_admin acts on exp.admin, which is excluded too; no_basic_income_non_citizens adds 6 to
    // exp.admin.other, of which the centre bears 1.2.
    const goal: Goal = {
      ...centralGap,
      excluded: [
        { node: "exp.admin", reason },
        { policy: "cut_admin", reason },
      ],
    };
    const scenario = on("cut_admin", "no_basic_income_non_citizens");
    const progress = goalProgress(testland, scenario, goal);
    const result = simulate(testland, { ...scenario, level: "central" });
    const cut = result.policies.find((policy) => policy.id === "cut_admin")!;
    expect(progress.excluded[1]).toEqual({ policy: "cut_admin", improvement: cut.delta.balance });
    expect(progress.excluded[0].node).toBe("exp.admin");
    expect(progress.excluded[0].improvement).toBeCloseTo(-1.2, 9);
    // Left out once: the two entries together are the change on exp.admin, nothing more.
    expect(progress.excludedImprovement).toBeCloseTo(-result.nodes["exp.admin"].delta, 9);
    expect(progress.improvement).toBeCloseTo(96, 9);
    expect(progress.improvement + progress.excludedImprovement).toBeCloseTo(result.reform.balance - result.baseline.balance, 9);
  });

  it("an excluded measure may change a group above an excluded node", () => {
    const goal: Goal = {
      ...centralGap,
      excluded: [
        { node: "exp.admin.parliament", reason },
        { policy: "cut_admin", reason },
      ],
    };
    const progress = goalProgress(testland, on("cut_admin", "halve_mp_pay"), goal);
    // halve_mp_pay acts on the excluded parliament (5); cut_admin, after it, is left out as a whole.
    expect(progress.excluded[0].improvement).toBeCloseTo(5, 9);
    expect(progress.improvement).toBeCloseTo(0, 9);
  });
});
