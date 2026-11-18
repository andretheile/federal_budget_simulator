import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "./__fixtures__/testland.ts";
import {
  evaluateValue,
  findNode,
  perCapita,
  resolveParams,
  shareOfGdp,
  simulate,
  simulatePolicy,
  type ParamValues,
  type Scenario,
} from "./simulate.ts";
import {
  LEVEL_IDS,
  type BudgetNode,
  type CountryPack,
  type Effect,
  type ExcludeGroupsEffect,
  type GroupNode,
  type LeafNode,
  type LevelId,
  type Param,
  type Policy,
} from "./types.ts";

/** A scenario with the given policies enabled. A value of `true` means default parameters. */
function enable(policies: Record<string, ParamValues | true>, level?: LevelId): Scenario {
  const scenario: Scenario = { policies: {}, level };
  for (const [id, params] of Object.entries(policies)) {
    scenario.policies[id] = params === true ? { enabled: true } : { enabled: true, params };
  }
  return scenario;
}

const ALL = Object.fromEntries(testland.policies.map((policy) => [policy.id, true as const]));

function policy(id: string, effects: Effect[], params: Param[] = []): Policy {
  return { id, label: { en: id }, summary: { en: id }, topic: "other", params, effects, catches: [], sources: [] };
}

/** Testland with its policies replaced. */
function withPolicies(...policies: Policy[]): CountryPack {
  const pack = testlandCopy();
  pack.policies = policies;
  return pack;
}

/** Finds a node in a pack without going through the engine, so the pack can still be changed afterwards. */
function nodeOf(pack: CountryPack, id: string): BudgetNode {
  const search = (nodes: BudgetNode[]): BudgetNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = "children" in node ? search(node.children) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  const found = search([...pack.budget.revenue, ...pack.budget.expenditure]);
  if (!found) throw new Error(`no node ${id}`);
  return found;
}

const leafOf = (pack: CountryPack, id: string): LeafNode => nodeOf(pack, id) as LeafNode;
const groupOf = (pack: CountryPack, id: string): GroupNode => nodeOf(pack, id) as GroupNode;

/** Runs one ad-hoc policy on Testland. */
function run(effects: Effect[], params: Param[] = [], values?: ParamValues) {
  const pack = withPolicies(policy("p", effects, params));
  const result = simulate(pack, { policies: { p: { enabled: true, params: values } } });
  return { pack, result, policy: result.policies[0] };
}

describe("baseline", () => {
  const result = simulate(testland);

  it("derives totals from the leaves", () => {
    expect(result.baseline).toEqual({ revenue: 4000, expenditure: 4400, balance: -400 });
    expect(result.reform).toEqual(result.baseline);
    expect(result.delta).toEqual({ revenue: 0, expenditure: 0, balance: 0 });
    expect(result.reformLow).toEqual(result.baseline);
    expect(result.reformHigh).toEqual(result.baseline);
    expect(result.policies).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.level).toBe("all");
  });

  it("reports every node, groups as the sum of their leaves", () => {
    expect(Object.keys(result.nodes)).toHaveLength(17);
    expect(result.nodes["rev.taxes"]).toEqual({
      id: "rev.taxes",
      side: "revenue",
      parent: null,
      isLeaf: false,
      baseline: 2500,
      reform: 2500,
      delta: 0,
    });
    expect(result.nodes["exp.social"].baseline).toBe(2200);
    expect(result.nodes["exp.admin"].baseline).toBe(400);
    expect(result.nodes["exp.admin.parliament"]).toMatchObject({ parent: "exp.admin", isLeaf: true, side: "expenditure", baseline: 10 });
  });

  it("exposes share of GDP and per-capita helpers", () => {
    expect(shareOfGdp(testland, result.baseline.balance)).toBe(-0.04);
    expect(perCapita(testland, result.baseline.balance)).toBe(-4);
  });

  it("ignores disabled and unknown policies", () => {
    const scenario: Scenario = {
      policies: { wealth_tax: { enabled: false, params: { rate: 5 } }, no_such_policy: { enabled: true } },
    };
    expect(simulate(testland, scenario).reform).toEqual(result.baseline);
  });

  it("finds nodes by id", () => {
    expect(findNode(testland, "exp.admin.parliament")).toBe(groupOf(testland, "exp.admin").children[0]);
    expect(findNode(testland, "exp.admin")).toBe(testland.budget.expenditure[4]);
    expect(findNode(testland, "exp.nope")).toBeUndefined();
  });
});

describe("effect types", () => {
  it("scale: new = old * factor", () => {
    const result = simulate(testland, enable({ halve_mp_pay: true }));
    expect(result.nodes["exp.admin.parliament"]).toMatchObject({ baseline: 10, reform: 5, delta: -5 });
    expect(result.nodes["exp.admin"].reform).toBe(395);
    expect(result.reform).toEqual({ revenue: 4000, expenditure: 4395, balance: -395 });
    expect(result.policies[0].delta).toEqual({ revenue: 0, expenditure: -5, balance: 5 });
    expect(result.policies[0].effects[0]).toMatchObject({
      index: 0,
      type: "scale",
      target: "exp.admin.parliament",
      side: "expenditure",
      quality: "official",
      delta: -5,
      low: -5,
      high: -5,
      clamped: false,
    });
  });

  it("add: new = old + amount, with a param multiplied by an indicator", () => {
    // 2 per household * 50 households
    const result = simulate(testland, enable({ family_bonus: true }));
    expect(result.nodes["exp.social.family"].reform).toBe(300);
    expect(result.policies[0].delta).toEqual({ revenue: 0, expenditure: 100, balance: -100 });
    expect(simulate(testland, enable({ family_bonus: { amount: 5 } })).nodes["exp.social.family"].reform).toBe(450);
  });

  it("set: new = amount", () => {
    // 3 % of GDP 10000
    const result = simulate(testland, enable({ defense_target: true }));
    expect(result.nodes["exp.defense"].reform).toBeCloseTo(300, 9);
    expect(result.policies[0].delta.expenditure).toBeCloseTo(100, 9);
    expect(simulate(testland, enable({ defense_target: { share: 2 } })).delta.balance).toBeCloseTo(0, 9);
    expect(simulate(testland, enable({ defense_target: { share: 1 } })).delta.balance).toBeCloseTo(100, 9);
  });

  it("excludeGroups: new = old * (1 - excluded share * (1 - retained))", () => {
    // 400 * (1 - 0.3 * 0.8) = 304, plus 6 of extra administration
    const result = simulate(testland, enable({ no_basic_income_non_citizens: true }));
    expect(result.nodes["exp.social.basic_income"].reform).toBeCloseTo(304, 9);
    expect(result.nodes["exp.admin.other"].reform).toBe(396);
    const [exclude, add] = result.policies[0].effects;
    expect(exclude.delta).toBeCloseTo(-96, 9);
    expect(exclude.excludedShare).toBeCloseTo(0.3, 12);
    expect(exclude.excludedGroups).toEqual(["non_eu"]);
    expect(add.delta).toBe(6);
    expect(add.excludedShare).toBeUndefined();
    expect(result.policies[0].delta.balance).toBeCloseTo(90, 9);
  });

  it("excludeGroups: takes the groups from a param or from a fixed list", () => {
    const both = simulate(testland, enable({ no_basic_income_non_citizens: { groups: ["non_eu", "eu"] } }));
    expect(both.policies[0].effects[0].excludedShare).toBeCloseTo(0.4, 12);
    expect(both.nodes["exp.social.basic_income"].reform).toBeCloseTo(400 * (1 - 0.4 * 0.8), 9);

    const none = simulate(testland, enable({ no_basic_income_non_citizens: { groups: [] } }));
    expect(none.nodes["exp.social.basic_income"].reform).toBe(400);

    const fixed = run([
      { type: "excludeGroups", target: "exp.social.basic_income", breakdown: "citizenship", groups: ["eu", "non_eu", "citizens"], quality: "estimate" },
    ]);
    expect(fixed.policy.effects[0].excludedShare).toBeCloseTo(1, 12);
    expect(fixed.result.nodes["exp.social.basic_income"].reform).toBeCloseTo(0, 9);
  });

  it("excludeGroups: `retained` can be a param", () => {
    const { result } = run(
      [{ type: "excludeGroups", target: "exp.social.basic_income", breakdown: "citizenship", groups: ["non_eu"], retained: { param: "kept", scale: 0.01 }, quality: "estimate" }],
      [{ id: "kept", type: "number", label: { en: "kept" }, unit: "percent", min: 0, max: 100, step: 1, default: 50 }],
    );
    expect(result.nodes["exp.social.basic_income"].reform).toBeCloseTo(400 * (1 - 0.3 * 0.5), 9);
  });

  it("schedule without baseline: absolute, delta = model(reform) * yield", () => {
    // Only the Pareto tail is above 1000: excess 5 * 1000 / (2 - 1) = 5000; 1 % of it is 50; yield 0.8.
    const result = simulate(testland, enable({ wealth_tax: true }));
    expect(result.nodes["rev.taxes.wealth"].reform).toBeCloseTo(40, 9);
    expect(result.policies[0].delta.revenue).toBeCloseTo(40, 9);
    expect(result.policies[0].effects[0].affected).toEqual({ threshold: 1000, units: 5, share: 0.1 });

    // Threshold inside the tail: 1.25 households above 2000, excess 2500.
    const higher = simulate(testland, enable({ wealth_tax: { threshold: 2000 } }));
    expect(higher.delta.revenue).toBeCloseTo(20, 9);
    expect(higher.policies[0].effects[0].affected?.units).toBeCloseTo(1.25, 12);
    expect(higher.policies[0].effects[0].affected?.share).toBeCloseTo(0.025, 12);

    expect(simulate(testland, enable({ wealth_tax: { rate: 2 } })).delta.revenue).toBeCloseTo(80, 9);
  });

  it("schedule with baseline: calibrated to the official amount", () => {
    // model(baseline) = 0.2 * 400 + 0.4 * 100 = 120, model(reform) = 0.2 * 400 + 0.5 * 100 = 130.
    // delta = 1500 * (130 / 120 - 1) = 125
    const result = simulate(testland, enable({ raise_top_tax_rate: true }));
    expect(result.nodes["rev.taxes.income"].reform).toBeCloseTo(1625, 9);
    expect(result.policies[0].effects[0].affected).toEqual({ threshold: 30, units: 10, share: 0.2 });

    // A reform that equals the baseline changes nothing and affects nobody.
    const same = simulate(testland, enable({ raise_top_tax_rate: { top_rate: 40 } }));
    expect(same.delta.revenue).toBeCloseTo(0, 9);
    expect(same.policies[0].effects[0].affected).toEqual({ threshold: null, units: 0, share: 0 });
  });
});

describe("calibrated versus absolute schedules", () => {
  const brackets = {
    baseline: { brackets: [{ from: 10, rate: 0.2 }, { from: 30, rate: 0.4 }] },
    reform: { brackets: [{ from: 10, rate: 0.2 }, { from: 30, rate: 0.5 }] },
  };

  it("an absolute schedule adds the modelled amount itself", () => {
    const { result } = run([{ type: "schedule", target: "rev.taxes.income", distribution: "income", reform: brackets.reform, quality: "estimate" }]);
    expect(result.delta.revenue).toBeCloseTo(130, 9);
  });

  it("a calibrated schedule applies the modelled relative change to the current amount", () => {
    const calibrated: Effect = { type: "schedule", target: "rev.taxes.income", distribution: "income", ...brackets, quality: "estimate" };
    expect(run([calibrated]).result.delta.revenue).toBeCloseTo(1500 / 12, 9);
    // After the node has doubled, the same relative change is twice as large.
    const doubled = run([{ type: "scale", target: "rev.taxes.income", factor: 2, quality: "estimate" }, calibrated]);
    expect(doubled.policy.effects[1].delta).toBeCloseTo(3000 / 12, 9);
    expect(doubled.result.nodes["rev.taxes.income"].reform).toBeCloseTo(3250, 9);
  });

  it("multiplies both kinds by `yield`", () => {
    const calibrated = run([{ type: "schedule", target: "rev.taxes.income", distribution: "income", ...brackets, yield: 0.6, quality: "estimate" }]);
    expect(calibrated.result.delta.revenue).toBeCloseTo(75, 9);
    const absolute = run(
      [{ type: "schedule", target: "rev.taxes.wealth", distribution: "income", reform: brackets.reform, yield: { param: "y", scale: 0.01 }, quality: "estimate" }],
      [{ id: "y", type: "number", label: { en: "y" }, unit: "percent", min: 0, max: 100, step: 1, default: 50 }],
    );
    expect(absolute.result.delta.revenue).toBeCloseTo(65, 9);
  });

  it("works on a negative first bin and a Pareto tail at once", () => {
    // 1 % on all positive wealth: excess over 0 is 30*40 + 10*400 + 5*2000 = 15200 (the negative bin pays nothing).
    const { result } = run([{ type: "schedule", target: "rev.taxes.wealth", distribution: "wealth", reform: { brackets: [{ from: 0, rate: 0.01 }] }, quality: "estimate" }]);
    expect(result.delta.revenue).toBeCloseTo(152, 9);
    expect(result.policies[0].effects[0].affected).toEqual({ threshold: 0, units: 45, share: 0.9 });
  });

  it("keeps thresholds in order when a slider pushes one past the next, and says so", () => {
    const pack = withPolicies(
      policy(
        "p",
        [
          {
            type: "schedule",
            target: "rev.taxes.wealth",
            distribution: "income",
            reform: { brackets: [{ from: { param: "start" }, rate: 0.1 }, { from: 30, rate: 0.3 }] },
            quality: "estimate",
          },
        ],
        [{ id: "start", type: "number", label: { en: "start" }, unit: "currency", min: 0, max: 50, step: 1, default: 10 }],
      ),
    );
    const at = (start: number) => simulate(pack, { policies: { p: { enabled: true, params: { start } } } });
    expect(at(10).warnings).toEqual([]);
    expect(at(10).delta.revenue).toBeCloseTo(0.1 * 400 + 0.3 * 100, 9);
    // At 40 the first bracket lies above the second: 30 % applies from 40 on. Excess over 40 is 5 * 5 = 25.
    const crossed = at(40);
    expect(crossed.delta.revenue).toBeCloseTo(0.3 * 25, 9);
    expect(crossed.warnings.map((w) => w.code)).toEqual(["brackets_reordered"]);
    // No jump where the thresholds cross.
    expect(Math.abs(at(30).delta.revenue - at(29.999).delta.revenue)).toBeLessThan(0.01);
    expect(Math.abs(at(30.001).delta.revenue - at(30).delta.revenue)).toBeLessThan(0.01);
  });
});

describe("parameters", () => {
  const wealthTax = testland.policies.find((p) => p.id === "wealth_tax")!;
  const exclusion = testland.policies.find((p) => p.id === "no_basic_income_non_citizens")!;

  it("fall back to defaults", () => {
    expect(resolveParams(testland, wealthTax)).toEqual({ rate: 1, threshold: 1000 });
    expect(resolveParams(testland, wealthTax, { rate: 2 })).toEqual({ rate: 2, threshold: 1000 });
    expect(resolveParams(testland, wealthTax, { rate: NaN, threshold: ["x"] })).toEqual({ rate: 1, threshold: 1000 });
    expect(resolveParams(testland, exclusion)).toEqual({ groups: ["non_eu"] });
  });

  it("clamp numbers to [min, max]", () => {
    expect(resolveParams(testland, wealthTax, { rate: 99, threshold: -5 })).toEqual({ rate: 5, threshold: 0 });
    const result = simulate(testland, enable({ wealth_tax: { rate: 99 } }));
    expect(result.policies[0].params).toEqual({ rate: 5, threshold: 1000 });
    expect(result.delta.revenue).toBeCloseTo(200, 9);
  });

  it("drop unknown groups and keep the breakdown's order", () => {
    expect(resolveParams(testland, exclusion, { groups: ["non_eu", "martians", "eu", "eu"] })).toEqual({ groups: ["eu", "non_eu"] });
    expect(resolveParams(testland, exclusion, { groups: 3 })).toEqual({ groups: ["non_eu"] });
  });

  it("evaluate values as (param * scale + offset) * indicator", () => {
    const indicators = testland.country.indicators;
    expect(evaluateValue(7, {}, indicators)).toBe(7);
    expect(evaluateValue({ param: "p" }, { p: 3 }, indicators)).toBe(3);
    expect(evaluateValue({ param: "p", scale: 2, offset: 1 }, { p: 3 }, indicators)).toBe(7);
    expect(evaluateValue({ param: "p", scale: 0.5, times: "gdp" }, { p: 3 }, indicators)).toBe(15000);
    expect(evaluateValue({ param: "p", offset: 1, times: "population" }, { p: 3 }, indicators)).toBe(400);
    expect(evaluateValue({ param: "p", times: "households" }, { p: 3 }, indicators)).toBe(150);
    expect(evaluateValue({ param: "missing" }, {}, indicators)).toBeNaN();
    expect(evaluateValue({ param: "p" }, { p: ["a"] }, indicators)).toBeNaN();
  });
});

describe("compounding", () => {
  it("applies two policies on the same node one after the other", () => {
    // Parliament: 10 -> 5 (halved) -> 4.5 (10 % cut). Not 10 - 5 - 1 = 4.
    const result = simulate(testland, enable({ halve_mp_pay: true, cut_admin: true }));
    expect(result.nodes["exp.admin.parliament"].reform).toBeCloseTo(4.5, 9);
    expect(result.nodes["exp.admin.other"].reform).toBeCloseTo(351, 9);
    expect(result.nodes["exp.admin"].reform).toBeCloseTo(355.5, 9);
    const [halve, cut] = result.policies;
    expect(halve.delta.expenditure).toBeCloseTo(-5, 9);
    // The cut is 10 % of what is left, 395, not of the original 400.
    expect(cut.delta.expenditure).toBeCloseTo(-39.5, 9);
    expect(result.delta.expenditure).toBeCloseTo(-44.5, 9);
  });

  it("applies policies in pack order, whatever the order in the scenario", () => {
    const a = simulate(testland, { policies: { cut_admin: { enabled: true }, halve_mp_pay: { enabled: true } } });
    const b = simulate(testland, { policies: { halve_mp_pay: { enabled: true }, cut_admin: { enabled: true } } });
    expect(a).toEqual(b);
    expect(a.policies.map((p) => p.id)).toEqual(["halve_mp_pay", "cut_admin"]);
  });

  it("applies the effects of one policy in listed order against the current state", () => {
    const first = run([
      { type: "scale", target: "exp.defense", factor: 0.5, quality: "estimate" },
      { type: "add", target: "exp.defense", amount: 20, quality: "estimate" },
    ]);
    expect(first.result.nodes["exp.defense"].reform).toBe(120);
    expect(first.policy.effects.map((e) => e.delta)).toEqual([-100, 20]);

    const second = run([
      { type: "add", target: "exp.defense", amount: 20, quality: "estimate" },
      { type: "scale", target: "exp.defense", factor: 0.5, quality: "estimate" },
    ]);
    expect(second.result.nodes["exp.defense"].reform).toBe(110);
    expect(second.policy.effects.map((e) => e.delta)).toEqual([20, -110]);
  });
});

describe("excludeGroups keeps track of what is left of each group", () => {
  /** Testland with a breakdown { a: 30 %, b: 20 %, c: 50 % } on exp.interest, which is 100. */
  function withAbc(...policies: Policy[]): CountryPack {
    const pack = withPolicies(...policies);
    const group = (id: string, share: number) => ({ id, label: { en: id, de: id }, share });
    leafOf(pack, "exp.interest").breakdowns = {
      abc: { label: { en: "abc", de: "abc" }, basis: "spending", groups: [group("a", 0.3), group("b", 0.2), group("c", 0.5)], quality: "estimate", sources: [] },
      xy: { label: { en: "xy", de: "xy" }, basis: "spending", groups: [group("x", 0.5), group("y", 0.5)], quality: "estimate", sources: [] },
    };
    return pack;
  }
  const exclude = (groups: string[], extra: Partial<ExcludeGroupsEffect> = {}): Effect => ({
    type: "excludeGroups",
    target: "exp.interest",
    breakdown: "abc",
    groups,
    quality: "estimate",
    ...extra,
  });
  /** Runs the effects as one policy each, in order, and returns the amounts of exp.interest and the effect results. */
  function chain(...effects: Effect[]) {
    const pack = withAbc(...effects.map((effect, i) => policy(`p${i}`, [effect])));
    const result = simulate(pack, enable(Object.fromEntries(effects.map((_, i) => [`p${i}`, true as const]))));
    return { result, amount: result.nodes["exp.interest"].reform, effects: result.policies.map((p) => p.effects[0]) };
  }

  it("A then B removes exactly A + B of the base amount", () => {
    // 100 -> 70 -> 50, not 100 -> 70 -> 56.
    const { result, amount, effects } = chain(exclude(["a"]), exclude(["b"]));
    expect(amount).toBeCloseTo(50, 9);
    expect(effects[0].delta).toBeCloseTo(-30, 9);
    expect(effects[1].delta).toBeCloseTo(-20, 9);
    expect(result.warnings).toEqual([]);
    // The order does not matter, and neither does doing it in one step.
    expect(chain(exclude(["b"]), exclude(["a"])).amount).toBeCloseTo(50, 9);
    expect(chain(exclude(["a", "b"])).amount).toBeCloseTo(50, 9);
    expect(chain(exclude(["a"]), exclude(["b"]), exclude(["c"])).amount).toBeCloseTo(0, 9);
  });

  it("reports the share of the node's current amount that the selected groups stood for", () => {
    const { effects } = chain(exclude(["a"]), exclude(["b"]), exclude(["b", "c"]));
    expect(effects[0].excludedShare).toBeCloseTo(0.3, 12); // 30 of 100
    expect(effects[1].excludedShare).toBeCloseTo(0.2 / 0.7, 12); // 20 of the 70 that are left
    expect(effects[2].excludedShare).toBeCloseTo(1, 12); // only c is left: 50 of 50
    expect(effects.map((e) => e.excludedGroups)).toEqual([["a"], ["b"], ["b", "c"]]);
  });

  it("the same group twice removes nothing the second time", () => {
    const { result, amount, effects } = chain(exclude(["a"]), exclude(["a"]));
    expect(amount).toBeCloseTo(70, 9);
    expect(effects[1].delta).toBe(0);
    expect(effects[1].excludedShare).toBe(0);
    expect(effects[1].excludedGroups).toEqual(["a"]);
    // The one case that is still reported: the selection had nothing left to remove.
    expect(result.policies[0].warnings).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ code: "repeated_exclusion", policy: "p1", effect: 0, node: "exp.interest" });
  });

  it("an overlapping selection removes only what is still there", () => {
    const { result, amount, effects } = chain(exclude(["a"]), exclude(["a", "b"]));
    expect(amount).toBeCloseTo(50, 9);
    expect(effects[1].delta).toBeCloseTo(-20, 9);
    expect(effects[1].excludedShare).toBeCloseTo(0.2 / 0.7, 12);
    expect(result.warnings).toEqual([]);
  });

  it("an exclusion after a `scale` on the same node removes the right share of the current amount", () => {
    const halve: Effect = { type: "scale", target: "exp.interest", factor: 0.5, quality: "estimate" };
    // 100 -> 50 -> 35: group a is 30 % of whatever the node is now.
    const first = chain(halve, exclude(["a"]));
    expect(first.amount).toBeCloseTo(35, 9);
    expect(first.effects[1].delta).toBeCloseTo(-15, 9);
    expect(first.effects[1].excludedShare).toBeCloseTo(0.3, 12);
    // 100 -> 70 -> 35 -> 25: after a is gone and the rest was halved, b is 10 of 35.
    const second = chain(exclude(["a"]), halve, exclude(["b"]));
    expect(second.amount).toBeCloseTo(25, 9);
    expect(second.effects[2].delta).toBeCloseTo(-10, 9);
  });

  it("other effects are assumed to hit all groups alike", () => {
    // 100 -> 70 -> 100 (add 30) -> b is still 2/7 of the node.
    const { amount } = chain(exclude(["a"]), { type: "add", target: "exp.interest", amount: 30, quality: "estimate" }, exclude(["b"]));
    expect(amount).toBeCloseTo(100 * (1 - 0.2 / 0.7), 9);
  });

  it("with `retained` 0.5 a second exclusion of the same group removes the remaining half", () => {
    const half = exclude(["a"], { retained: 0.5 });
    // 100 -> 85 (half of the 30) -> 77.5 (half of the remaining 15) -> 70 (the rest)
    const { result, effects } = chain(half, half, exclude(["a"]));
    expect(effects[0].delta).toBeCloseTo(-15, 9);
    expect(effects[1].delta).toBeCloseTo(-7.5, 9);
    expect(effects[1].excludedShare).toBeCloseTo(0.15 / 0.85, 12);
    expect(effects[2].delta).toBeCloseTo(-7.5, 9);
    expect(result.nodes["exp.interest"].reform).toBeCloseTo(70, 9);
    expect(result.warnings).toEqual([]);
  });

  it("two policies on the same group never remove more than the group", () => {
    // The fixture policy keeps 20 % of the non-EU share (400 -> 304); a second policy removes the group outright.
    const pack = testlandCopy();
    pack.policies.push(policy("all_out", [{ type: "excludeGroups", target: "exp.social.basic_income", breakdown: "citizenship", groups: ["non_eu"], quality: "estimate" }]));
    const result = simulate(pack, enable({ no_basic_income_non_citizens: true, all_out: true }));
    // Together exactly the 30 % that the group stands for: 400 -> 280.
    expect(result.nodes["exp.social.basic_income"].reform).toBeCloseTo(280, 9);
    expect(result.policies[0].effects[0].delta).toBeCloseTo(-96, 9);
    expect(result.policies[1].effects[0].delta).toBeCloseTo(-24, 9);
    expect(result.policies[1].effects[0].excludedShare).toBeCloseTo(0.06 / 0.76, 12);
  });

  it("keeps the weights per node and per breakdown", () => {
    // Two breakdowns of one node are independent views: excluding a (30 %) and x (50 %) multiplies.
    const two = chain(exclude(["a"]), exclude(["x"], { breakdown: "xy" }));
    expect(two.amount).toBeCloseTo(100 * 0.7 * 0.5, 9);
    expect(two.result.warnings).toEqual([]);

    // The same breakdown on another node has its own weights.
    const pack = withAbc(policy("p0", [exclude(["a"])]), policy("p1", [exclude(["a"], { target: "exp.defense" })]));
    leafOf(pack, "exp.defense").breakdowns = leafOf(pack, "exp.interest").breakdowns;
    const result = simulate(pack, enable({ p0: true, p1: true }));
    expect(result.nodes["exp.interest"].reform).toBeCloseTo(70, 9);
    expect(result.nodes["exp.defense"].reform).toBeCloseTo(140, 9);
    expect(result.warnings).toEqual([]);
  });

  it("starts from the full shares in every run", () => {
    const pack = withAbc(policy("p0", [exclude(["a"])]), policy("p1", [exclude(["b"])]));
    const both = enable({ p0: true, p1: true });
    expect(simulate(pack, both)).toEqual(simulate(pack, both));
    expect(simulate(pack, enable({ p1: true })).nodes["exp.interest"].reform).toBeCloseTo(80, 9);
    expect(simulate(pack, both).nodes["exp.interest"].reform).toBeCloseTo(50, 9);
    expect(simulate(pack, enable({ p0: true })).nodes["exp.interest"].reform).toBeCloseTo(70, 9);
  });

  it("warns only when nothing was left, not when a group never had a share", () => {
    const pack = withAbc(policy("p0", [exclude(["a", "b", "c"])]), policy("p1", [exclude(["c"])]));
    const result = simulate(pack, enable({ p0: true, p1: true }));
    expect(result.nodes["exp.interest"].reform).toBeCloseTo(0, 9);
    expect(result.warnings.map((w) => w.code)).toEqual(["repeated_exclusion"]);

    const empty = withAbc(policy("p0", [exclude(["a"])]));
    leafOf(empty, "exp.interest").breakdowns!.abc.groups = [
      { id: "a", label: { en: "a", de: "a" }, share: 0 },
      { id: "c", label: { en: "c", de: "c" }, share: 1 },
    ];
    expect(simulate(empty, enable({ p0: true })).warnings).toEqual([]);
  });
});

describe("shift: part of what an effect removes reappears at another node", () => {
  const halveDefense = (shift: NonNullable<ExcludeGroupsEffect["shift"]>, extra: object = {}): Effect => ({
    type: "scale",
    target: "exp.defense",
    factor: 0.5,
    quality: "estimate",
    shift,
    ...extra,
  });

  it("scale with a shift: the fixture's pension cut", () => {
    // Pensions 1600 -> 1440. A quarter of the 160 comes back as basic income support: 400 -> 440.
    const result = simulate(testland, enable({ cut_pensions: true }));
    expect(result.nodes["exp.social.pensions"].reform).toBeCloseTo(1440, 9);
    expect(result.nodes["exp.social.basic_income"].reform).toBeCloseTo(440, 9);
    expect(result.reform.expenditure).toBeCloseTo(4280, 9);

    const p = result.policies[0];
    const effect = p.effects[0];
    // delta, low and high of the effect stay the target part.
    expect(effect.target).toBe("exp.social.pensions");
    expect(effect.delta).toBeCloseTo(-160, 9);
    expect(effect.low).toBeCloseTo(-120, 9); // uncertainty 0.75 to 1 on the saving
    expect(effect.high).toBeCloseTo(-160, 9);
    expect(effect.shift).toEqual({
      target: "exp.social.basic_income",
      side: "expenditure",
      delta: expect.closeTo(40, 9),
      low: expect.closeTo(80, 9), // uncertainty 0.5 to 2 on the shifted cost: twice the cost is the bad end
      high: expect.closeTo(20, 9),
      clamped: false,
    });
    // The policy totals contain both parts.
    expect(p.delta.expenditure).toBeCloseTo(-120, 9);
    expect(p.delta.balance).toBeCloseTo(120, 9);
    expect(p.low.balance).toBeCloseTo(120 - 80, 9);
    expect(p.high.balance).toBeCloseTo(160 - 20, 9);
    expect(result.delta.balance).toBe(p.delta.balance);
    expect(result.warnings).toEqual([]);
  });

  it("follows the params of the ratio and of the effect", () => {
    const at = (params: ParamValues) => simulate(testland, enable({ cut_pensions: params })).policies[0];
    expect(at({ fallback: 100 }).effects[0].shift?.delta).toBeCloseTo(160, 9);
    expect(at({ fallback: 100 }).delta.balance).toBeCloseTo(0, 9);
    expect(at({ cut: 20 }).effects[0].shift?.delta).toBeCloseTo(80, 9);
    // Nothing shifted: the shift is still reported, with zeros.
    expect(at({ fallback: 0 }).effects[0].shift).toEqual({ target: "exp.social.basic_income", side: "expenditure", delta: 0, low: 0, high: 0, clamped: false });
    expect(at({ cut: 0 }).effects[0].shift?.delta).toBe(0);
    expect(at({ cut: 0 }).warnings).toEqual([]);
  });

  it("is absent on effects without a shift", () => {
    const result = simulate(testland, enable(ALL));
    const withShift = result.policies.flatMap((p) => p.effects.filter((e) => e.shift).map(() => p.id));
    expect(withShift).toEqual(["cut_pensions"]);
    expect("shift" in result.policies[0].effects[0]).toBe(false);
  });

  it("makes a cost shift between levels visible in the level filter", () => {
    const by = (level: LevelId) => simulate(testland, enable({ cut_pensions: true }, level)).policies[0];
    // Social insurance pays three quarters of the pensions and none of the basic income support.
    expect(by("social_security").effects[0].delta).toBeCloseTo(-120, 9);
    expect(by("social_security").effects[0].shift?.delta).toBe(0);
    expect(by("social_security").delta.balance).toBeCloseTo(120, 9);
    // The centre saves 40 on pensions and pays the 40 that reappear: nothing gained.
    expect(by("central").effects[0].delta).toBeCloseTo(-40, 9);
    expect(by("central").effects[0].shift?.delta).toBeCloseTo(40, 9);
    expect(by("central").delta.balance).toBeCloseTo(0, 9);
    expect(by("state").delta.balance).toBe(0);
  });

  it("excludeGroups with a shift", () => {
    // Non-EU citizens lose basic income support (120); half of that reappears as provincial spending.
    const { result, policy: p } = run([
      { type: "excludeGroups", target: "exp.social.basic_income", breakdown: "citizenship", groups: ["non_eu"], quality: "estimate", shift: { to: "exp.education", ratio: 0.5 } },
    ]);
    expect(result.nodes["exp.social.basic_income"].reform).toBeCloseTo(280, 9);
    expect(result.nodes["exp.education"].reform).toBeCloseTo(860, 9);
    expect(p.effects[0].delta).toBeCloseTo(-120, 9);
    expect(p.effects[0].excludedShare).toBeCloseTo(0.3, 12);
    expect(p.effects[0].shift).toMatchObject({ target: "exp.education", side: "expenditure", clamped: false });
    expect(p.effects[0].shift?.delta).toBeCloseTo(60, 9);
    expect(p.delta.balance).toBeCloseTo(60, 9);
  });

  it("a second exclusion with nothing left shifts nothing", () => {
    const exclude: Effect = { type: "excludeGroups", target: "exp.social.basic_income", breakdown: "citizenship", groups: ["non_eu"], quality: "estimate", shift: { to: "exp.education", ratio: 0.5 } };
    const pack = withPolicies(policy("a", [exclude]), policy("b", [exclude]));
    const result = simulate(pack, enable({ a: true, b: true }));
    expect(result.nodes["exp.education"].reform).toBeCloseTo(860, 9);
    expect(result.policies[1].effects[0].delta).toBe(0);
    expect(result.policies[1].effects[0].shift?.delta).toBe(0);
  });

  it("distributes the shifted amount over the leaves of a group like an `add`", () => {
    // Defence 200 -> 100; 40 % of the 100 goes to administration: parliament 10 -> 11, other 390 -> 429.
    const { result, policy: p } = run([halveDefense({ to: "exp.admin", ratio: 0.4 })]);
    expect(result.nodes["exp.admin.parliament"].reform).toBeCloseTo(11, 9);
    expect(result.nodes["exp.admin.other"].reform).toBeCloseTo(429, 9);
    expect(p.effects[0].shift?.delta).toBeCloseTo(40, 9);
    expect(p.delta.expenditure).toBeCloseTo(-60, 9);
  });

  it("can shift to the other side of the budget", () => {
    // 20 % of the saving reappears as revenue; a fifth less to twice as much.
    const { result, policy: p } = run([halveDefense({ to: "rev.other", ratio: 0.2, uncertainty: { low: 0.5, high: 2 } })]);
    expect(result.nodes["rev.other"].reform).toBe(320);
    expect(p.effects[0].shift).toEqual({ target: "rev.other", side: "revenue", delta: 20, low: 10, high: 40, clamped: false });
    expect(p.delta).toEqual({ revenue: 20, expenditure: -100, balance: 120 });
    expect(p.low).toEqual({ revenue: 10, expenditure: -100, balance: 110 });
    expect(p.high).toEqual({ revenue: 40, expenditure: -100, balance: 140 });
  });

  it("the ratio may exceed 1", () => {
    const { policy: p } = run([halveDefense({ to: "exp.health", ratio: 1.5 })]);
    expect(p.effects[0].shift?.delta).toBe(150);
    expect(p.delta.balance).toBe(-50);
  });

  it("keeps the two uncertainty ranges apart and orders each by the balance", () => {
    // The effect's own range applies to the target only: the shifted part has none here.
    const own = run([halveDefense({ to: "exp.health", ratio: 0.5 }, { uncertainty: { low: 0.5, high: 1 } })]).policy;
    expect([own.effects[0].low, own.effects[0].delta, own.effects[0].high]).toEqual([-50, -100, -100]);
    expect([own.effects[0].shift?.low, own.effects[0].shift?.delta, own.effects[0].shift?.high]).toEqual([50, 50, 50]);
    expect([own.low.balance, own.delta.balance, own.high.balance]).toEqual([0, 50, 50]);

    // Both ranges: the bad end is the small saving together with the large shifted cost.
    const both = run([halveDefense({ to: "exp.health", ratio: 0.5, uncertainty: { low: 0.8, high: 1.6 } }, { uncertainty: { low: 0.5, high: 1 } })]).policy;
    expect(both.effects[0].shift?.low).toBe(80);
    expect(both.effects[0].shift?.high).toBe(40);
    expect([both.low.balance, both.delta.balance, both.high.balance]).toEqual([50 - 80, 50, 100 - 40]);
    expect(both.low.balance).toBeLessThanOrEqual(both.high.balance);
  });

  it("is negative when the effect increased the target", () => {
    // Defence 200 -> 300: "removed" is -100, so half of that is taken away from health.
    const { result, policy: p } = run([{ type: "scale", target: "exp.defense", factor: 1.5, quality: "estimate", shift: { to: "exp.health", ratio: 0.5 } }]);
    expect(result.nodes["exp.defense"].reform).toBe(300);
    expect(result.nodes["exp.health"].reform).toBe(650);
    expect(p.effects[0].shift?.delta).toBe(-50);
    expect(p.delta.expenditure).toBe(50);
  });

  it("clamps the receiving node at zero and says where", () => {
    // Education doubles (+800); taking all of that from interest (100) would make it negative.
    const { result, policy: p } = run([{ type: "scale", target: "exp.education", factor: 2, quality: "estimate", shift: { to: "exp.interest", ratio: 1 } }]);
    expect(result.nodes["exp.interest"].reform).toBe(0);
    expect(p.effects[0].clamped).toBe(false);
    expect(p.effects[0].shift).toEqual({ target: "exp.interest", side: "expenditure", delta: -100, low: -100, high: -100, clamped: true });
    expect(p.delta.expenditure).toBe(700);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toMatchObject({ code: "clamped", policy: "p", effect: 0, node: "exp.interest" });
  });

  it("shifts what was really removed when the target itself was clamped", () => {
    // A factor of -1 would remove 400; the node only has 200.
    const { result, policy: p } = run([{ type: "scale", target: "exp.defense", factor: -1, quality: "estimate", shift: { to: "exp.health", ratio: 0.5 } }]);
    expect(result.nodes["exp.defense"].reform).toBe(0);
    expect(p.effects[0]).toMatchObject({ delta: -200, clamped: true });
    expect(p.effects[0].shift).toMatchObject({ delta: 100, clamped: false });
    expect(p.warnings.map((w) => [w.code, w.node])).toEqual([["clamped", "exp.defense"]]);
  });

  it("skips a shift whose ratio is not a number, but keeps the effect", () => {
    const { result, policy: p } = run([halveDefense({ to: "exp.health", ratio: { param: "nope" } })]);
    expect(result.nodes["exp.defense"].reform).toBe(100);
    expect(result.nodes["exp.health"].reform).toBe(700);
    expect(p.effects[0].shift).toEqual({ target: "exp.health", side: "expenditure", delta: 0, low: 0, high: 0, clamped: false });
    expect(p.warnings.map((w) => [w.code, w.node])).toEqual([["not_finite", "exp.health"]]);
  });

  it("falls back to base proportions when the receiving group is empty", () => {
    const { result, policy: p } = run([
      { type: "set", target: "exp.admin", amount: 0, quality: "estimate" },
      halveDefense({ to: "exp.admin", ratio: 0.8 }),
    ]);
    expect(result.nodes["exp.admin.parliament"].reform).toBeCloseTo(2, 9);
    expect(result.nodes["exp.admin.other"].reform).toBeCloseTo(78, 9);
    expect(p.effects[1].shift?.delta).toBeCloseTo(80, 9);
    expect(p.warnings.map((w) => [w.code, w.node])).toEqual([["empty_group", "exp.admin"]]);
  });

  it("later effects see the shifted amount, and group weights are left alone", () => {
    // After the pension cut basic income support is 440; non-EU citizens are still 30 % of it.
    const pack = testlandCopy();
    pack.policies.push(policy("later", [{ type: "excludeGroups", target: "exp.social.basic_income", breakdown: "citizenship", groups: ["non_eu"], quality: "estimate" }]));
    const result = simulate(pack, enable({ cut_pensions: true, later: true }));
    expect(result.nodes["exp.social.basic_income"].reform).toBeCloseTo(440 * 0.7, 9);
    expect(result.policies[1].effects[0].delta).toBeCloseTo(-132, 9);
  });

  it("keeps attribution exact: policy deltas with their shifts add up to the total change", () => {
    const pack = withPolicies(
      policy("a", [halveDefense({ to: "rev.other", ratio: 0.2 })]),
      policy("b", [{ type: "scale", target: "exp.education", factor: 2, quality: "estimate", shift: { to: "exp.interest", ratio: 1 } }]),
      policy("c", [{ type: "excludeGroups", target: "exp.social.basic_income", breakdown: "citizenship", groups: ["eu"], quality: "estimate", shift: { to: "exp.admin", ratio: 1.25 } }]),
    );
    for (const level of ["all", "central", "state", "social_security"] as const) {
      const result = simulate(pack, { ...enable({ a: true, b: true, c: true }), level });
      for (const key of ["revenue", "expenditure", "balance"] as const) {
        expect(result.policies.reduce((sum, p) => sum + p.delta[key], 0)).toBe(result.delta[key]);
        expect(result.reform[key] - result.baseline[key]).toBeCloseTo(result.delta[key], 9);
      }
    }
  });
});

describe("effects on group nodes", () => {
  it("scale changes every leaf by the same factor", () => {
    const result = simulate(testland, enable({ cut_admin: { cut: 50 } }));
    expect(result.nodes["exp.admin.parliament"].reform).toBe(5);
    expect(result.nodes["exp.admin.other"].reform).toBe(195);
    expect(result.nodes["exp.admin"].reform).toBe(200);
  });

  it("add distributes the amount in proportion to the current amounts", () => {
    const { result, policy: p } = run([{ type: "add", target: "exp.admin", amount: 40, quality: "estimate" }]);
    expect(result.nodes["exp.admin.parliament"].reform).toBeCloseTo(11, 9);
    expect(result.nodes["exp.admin.other"].reform).toBeCloseTo(429, 9);
    expect(result.nodes["exp.admin"].reform).toBeCloseTo(440, 9);
    expect(p.effects[0].delta).toBeCloseTo(40, 9);
  });

  it("set distributes the new total in proportion to the current amounts", () => {
    const { result, policy: p } = run([{ type: "set", target: "exp.social", amount: 1100, quality: "estimate" }]);
    expect(result.nodes["exp.social.pensions"].reform).toBeCloseTo(800, 9);
    expect(result.nodes["exp.social.basic_income"].reform).toBeCloseTo(200, 9);
    expect(result.nodes["exp.social.family"].reform).toBeCloseTo(100, 9);
    expect(result.nodes["exp.social"].reform).toBeCloseTo(1100, 9);
    expect(p.effects[0].delta).toBeCloseTo(-1100, 9);
  });

  it("follows the current proportions, not the base ones", () => {
    const { result } = run([
      { type: "scale", target: "exp.admin.other", factor: 0, quality: "estimate" },
      { type: "add", target: "exp.admin", amount: 90, quality: "estimate" },
    ]);
    // Everything that is left in the group is parliament, so it takes the whole amount.
    expect(result.nodes["exp.admin.parliament"].reform).toBeCloseTo(100, 9);
    expect(result.nodes["exp.admin.other"].reform).toBe(0);
  });

  it("a schedule on a group raises all its leaves proportionally", () => {
    const { result } = run([
      { type: "schedule", target: "rev.taxes", distribution: "income", reform: { brackets: [{ from: 0, rate: 0.1 }] }, quality: "estimate" },
    ]);
    // +90 on a group of 2500: 1500 -> 1554, 1000 -> 1036, 0 stays 0.
    expect(result.nodes["rev.taxes.income"].reform).toBeCloseTo(1554, 9);
    expect(result.nodes["rev.taxes.vat"].reform).toBeCloseTo(1036, 9);
    expect(result.nodes["rev.taxes.wealth"].reform).toBe(0);
  });

  it("excludeGroups works with a breakdown on a group", () => {
    const pack = testlandCopy();
    groupOf(pack, "exp.admin").breakdowns = {
      kind: { label: { en: "kind", de: "Art" }, basis: "spending", groups: [{ id: "staff", label: { en: "s", de: "s" }, share: 0.75 }, { id: "rest", label: { en: "r", de: "r" }, share: 0.25 }], quality: "estimate", sources: [] },
    };
    pack.policies = [policy("p", [{ type: "excludeGroups", target: "exp.admin", breakdown: "kind", groups: ["rest"], quality: "estimate" }])];
    const result = simulate(pack, enable({ p: true }));
    expect(result.nodes["exp.admin.parliament"].reform).toBe(7.5);
    expect(result.nodes["exp.admin.other"].reform).toBe(292.5);
  });

  it("falls back to base proportions when an earlier effect has emptied the group", () => {
    const { result, policy: p } = run([
      { type: "set", target: "exp.admin", amount: 0, quality: "estimate" },
      { type: "add", target: "exp.admin", amount: 80, quality: "estimate" },
    ]);
    expect(result.nodes["exp.admin.parliament"].reform).toBeCloseTo(2, 9);
    expect(result.nodes["exp.admin.other"].reform).toBeCloseTo(78, 9);
    expect(p.effects[0].delta).toBe(-400);
    expect(p.effects[1].delta).toBeCloseTo(80, 9);
    expect(p.warnings.map((w) => w.code)).toEqual(["empty_group"]);
  });
});

describe("clamping", () => {
  it("cuts a leaf off at zero and reports what actually changed", () => {
    const { result, policy: p } = run([{ type: "add", target: "exp.defense", amount: -500, quality: "estimate" }]);
    expect(result.nodes["exp.defense"].reform).toBe(0);
    expect(p.effects[0]).toMatchObject({ delta: -200, clamped: true });
    expect(p.delta.expenditure).toBe(-200);
    expect(result.reform.expenditure).toBe(4200);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toMatchObject({ code: "clamped", policy: "p", effect: 0, node: "exp.defense" });
    expect(result.warnings).toEqual(p.warnings);
  });

  it("clamps a negative set, a negative factor and a group", () => {
    expect(run([{ type: "set", target: "exp.defense", amount: -1, quality: "estimate" }]).result.nodes["exp.defense"].reform).toBe(0);
    const scaled = run([{ type: "scale", target: "exp.defense", factor: -2, quality: "estimate" }]);
    expect(scaled.result.nodes["exp.defense"].reform).toBe(0);
    expect(scaled.policy.effects[0].clamped).toBe(true);
    const group = run([{ type: "add", target: "exp.admin", amount: -1000, quality: "estimate" }]);
    expect(group.result.nodes["exp.admin.parliament"].reform).toBe(0);
    expect(group.result.nodes["exp.admin.other"].reform).toBe(0);
    expect(group.policy.effects[0]).toMatchObject({ delta: -400, clamped: true });
  });

  it("does not warn when nothing is clamped", () => {
    expect(simulate(testland, enable(ALL)).warnings).toEqual([]);
  });

  it("skips an effect that does not evaluate to a number", () => {
    const { result, policy: p } = run([{ type: "add", target: "exp.defense", amount: { param: "nope" }, quality: "estimate" }]);
    expect(result.reform).toEqual(result.baseline);
    expect(p.warnings.map((w) => w.code)).toEqual(["not_finite"]);
  });
});

describe("attribution", () => {
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

  it("policy deltas add up exactly to the total change", () => {
    const result = simulate(testland, enable(ALL));
    expect(result.policies).toHaveLength(testland.policies.length);
    for (const key of ["revenue", "expenditure", "balance"] as const) {
      expect(sum(result.policies.map((p) => p.delta[key]))).toBe(result.delta[key]);
      expect(result.reform[key] - result.baseline[key]).toBeCloseTo(result.delta[key], 9);
    }
    // Hand-checked. Revenue: +40 (wealth tax) + 125 (top rate) = 165.
    expect(result.delta.revenue).toBeCloseTo(165, 9);
    // Expenditure: parliament 10 -> 5 -> 4.5; other administration 390 -> 351 -> 357 (the extra 6 comes
    // after the cut); basic income 400 -> 304; defence 200 -> 300; family benefits 200 -> 300.
    expect(result.nodes["exp.admin.other"].reform).toBeCloseTo(357, 9);
    // The pension cut comes last: 1600 -> 1440, and 40 reappear as basic income support (304 -> 344).
    expect(result.nodes["exp.social.basic_income"].reform).toBeCloseTo(344, 9);
    expect(result.reform.expenditure).toBeCloseTo(4400 - 5 - 39.5 - 96 + 6 + 100 + 100 - 160 + 40, 9);
  });

  it("effect deltas add up to the policy delta and each balance is revenue minus expenditure", () => {
    const result = simulate(testland, enable(ALL));
    for (const p of result.policies) {
      // Every effect has a target part and may have a shifted part; both count.
      const parts = p.effects.flatMap((e) => (e.shift ? [e, e.shift] : [e]));
      for (const side of ["revenue", "expenditure"] as const) {
        expect(sum(parts.filter((part) => part.side === side).map((part) => part.delta))).toBe(p.delta[side]);
        expect(sum(parts.filter((part) => part.side === side).map((part) => part.low))).toBe(p.low[side]);
        expect(sum(parts.filter((part) => part.side === side).map((part) => part.high))).toBe(p.high[side]);
      }
      expect(p.delta.balance).toBe(p.delta.revenue - p.delta.expenditure);
    }
    expect(result.reform.balance).toBe(result.reform.revenue - result.reform.expenditure);
  });

  it("node deltas add up to the same totals", () => {
    const result = simulate(testland, enable(ALL));
    const top = Object.values(result.nodes).filter((n) => n.parent === null);
    for (const side of ["revenue", "expenditure"] as const) {
      const nodes = top.filter((n) => n.side === side);
      expect(sum(nodes.map((n) => n.reform))).toBeCloseTo(result.reform[side], 9);
      expect(sum(nodes.map((n) => n.delta))).toBeCloseTo(result.delta[side], 9);
    }
    for (const node of Object.values(result.nodes)) {
      if (node.isLeaf) continue;
      const children = Object.values(result.nodes).filter((n) => n.parent === node.id);
      expect(sum(children.map((n) => n.reform))).toBeCloseTo(node.reform, 9);
      expect(node.delta).toBe(node.reform - node.baseline);
    }
  });

  it("holds when effects are clamped and when realistic amounts are used", () => {
    const pack = testlandCopy();
    // Scale Testland to the size of a real budget (about 500 billion), with awkward digits.
    const scaleUp = (node: BudgetNode): void => {
      if ("children" in node) node.children.forEach(scaleUp);
      else node.amount = node.amount * 123456789.123;
    };
    [...pack.budget.revenue, ...pack.budget.expenditure].forEach(scaleUp);
    pack.policies.push(policy("overshoot", [{ type: "add", target: "exp.interest", amount: -1e15, quality: "estimate" }]));
    const result = simulate(pack, enable({ ...ALL, overshoot: true }));
    expect(result.warnings.map((w) => w.code)).toEqual(["clamped"]);
    for (const key of ["revenue", "expenditure", "balance"] as const) {
      expect(sum(result.policies.map((p) => p.delta[key]))).toBe(result.delta[key]);
      // Totals are summed from the leaves, deltas from the effects: the two agree up to rounding,
      // here to well within a hundredth of a currency unit on half a trillion.
      expect(Math.abs(result.reform[key] - result.baseline[key] - result.delta[key])).toBeLessThan(0.01);
    }
  });

  it("simulatePolicy gives a policy's effect on its own", () => {
    expect(simulatePolicy(testland, "cut_admin")?.delta.balance).toBeCloseTo(40, 9);
    expect(simulatePolicy(testland, "cut_admin", { cut: 20 })?.delta.balance).toBeCloseTo(80, 9);
    expect(simulatePolicy(testland, "cut_admin", undefined, "state")?.delta.balance).toBeCloseTo(31.2, 9);
    expect(simulatePolicy(testland, "nope")).toBeUndefined();
  });
});

describe("ranges", () => {
  it("multiplies each effect's delta by its uncertainty and orders the ends by the balance", () => {
    const result = simulate(testland, enable({ no_basic_income_non_citizens: true }));
    const [exclude, add] = result.policies[0].effects;
    // A saving of 96 that may be only half as large: the small saving is the low end.
    expect(exclude.low).toBeCloseTo(-48, 9);
    expect(exclude.high).toBeCloseTo(-96, 9);
    // Extra cost of 6 that may be twice as large: the large cost is the low end.
    expect(add.low).toBe(12);
    expect(add.high).toBe(6);

    const p = result.policies[0];
    expect(p.low.expenditure).toBeCloseTo(-36, 9);
    expect(p.high.expenditure).toBeCloseTo(-90, 9);
    expect(p.low.balance).toBeCloseTo(36, 9);
    expect(p.delta.balance).toBeCloseTo(90, 9);
    expect(p.high.balance).toBeCloseTo(90, 9);
  });

  it("handles revenue effects and multipliers above 1", () => {
    const p = simulate(testland, enable({ wealth_tax: true })).policies[0];
    expect(p.low.revenue).toBeCloseTo(20, 9);
    expect(p.delta.revenue).toBeCloseTo(40, 9);
    expect(p.high.revenue).toBeCloseTo(50, 9);
    expect(p.low.balance).toBeCloseTo(20, 9);
    expect(p.high.balance).toBeCloseTo(50, 9);
  });

  it("defaults to no range", () => {
    const p = simulate(testland, enable({ halve_mp_pay: true })).policies[0];
    expect(p.low).toEqual(p.delta);
    expect(p.high).toEqual(p.delta);
  });

  it("adds the ranges of all policies up", () => {
    const result = simulate(testland, enable({ no_basic_income_non_citizens: true, wealth_tax: true, halve_mp_pay: true }));
    expect(result.deltaLow.balance).toBeCloseTo(5 + 36 + 20, 9);
    expect(result.delta.balance).toBeCloseTo(5 + 90 + 40, 9);
    expect(result.deltaHigh.balance).toBeCloseTo(5 + 90 + 50, 9);
    expect(result.reformLow.balance).toBeCloseTo(-400 + 61, 9);
    expect(result.reform.balance).toBeCloseTo(-400 + 135, 9);
    expect(result.reformHigh.balance).toBeCloseTo(-400 + 145, 9);
    expect(result.reformLow.revenue).toBeCloseTo(4020, 9);
    expect(result.reformHigh.revenue).toBeCloseTo(4050, 9);
    expect(result.reformLow.expenditure).toBeCloseTo(4400 - 5 - 36, 9);
    expect(result.reformHigh.expenditure).toBeCloseTo(4400 - 5 - 90, 9);
  });

  it("is ordered low <= high in terms of the balance, whatever the multipliers are", () => {
    const uncertain = (target: string, amount: number, low: number, high: number): Effect => ({
      type: "add",
      target,
      amount,
      quality: "estimate",
      uncertainty: { low, high },
    });
    const pack = withPolicies(
      policy("more_spending", [uncertain("exp.defense", 100, 0.5, 2)]),
      policy("less_spending", [uncertain("exp.health", -100, 0.5, 2)]),
      policy("more_revenue", [uncertain("rev.other", 100, 2, 0.5)]),
      policy("less_revenue", [uncertain("rev.taxes.vat", -100, 0.5, 2)]),
      policy("may_backfire", [uncertain("rev.other", 10, -1, 1)]),
    );
    const result = simulate(pack, enable({ more_spending: true, less_spending: true, more_revenue: true, less_revenue: true, may_backfire: true }));
    const balance = (id: string) => {
      const p = result.policies.find((candidate) => candidate.id === id)!;
      return [p.low.balance, p.delta.balance, p.high.balance];
    };
    expect(balance("more_spending")).toEqual([-200, -100, -50]);
    expect(balance("less_spending")).toEqual([50, 100, 200]);
    expect(balance("more_revenue")).toEqual([50, 100, 200]);
    expect(balance("less_revenue")).toEqual([-200, -100, -50]);
    expect(balance("may_backfire")).toEqual([-10, 10, 10]);
    for (const p of result.policies) expect(p.low.balance).toBeLessThanOrEqual(p.high.balance);
    expect(result.deltaLow.balance).toBe(-310);
    expect(result.deltaHigh.balance).toBe(310);
    expect(result.reformLow.balance).toBeLessThanOrEqual(result.reformHigh.balance);
  });
});

describe("level filter", () => {
  const levels = Object.keys(testland.country.levels) as LevelId[];

  it("projects every leaf by its share for the level", () => {
    const central = simulate(testland, { policies: {}, level: "central" });
    expect(central.level).toBe("central");
    expect(central.baseline).toEqual({ revenue: 1650, expenditure: 1288, balance: 362 });
    expect(central.nodes["rev.taxes.income"].baseline).toBe(750);
    expect(central.nodes["exp.social.pensions"].baseline).toBe(400);
    expect(central.nodes["exp.health"].baseline).toBe(0);
    expect(central.nodes["exp.admin"].baseline).toBe(88);

    expect(simulate(testland, { policies: {}, level: "state" }).baseline).toEqual({ revenue: 1150, expenditure: 1212, balance: -62 });
    expect(simulate(testland, { policies: {}, level: "social_security" }).baseline).toEqual({ revenue: 1200, expenditure: 1900, balance: -700 });
  });

  it("projects the reform and every delta the same way", () => {
    // The admin cut removes 10 % everywhere: 1 + 7.8 for the centre, 31.2 for the provinces.
    const central = simulate(testland, enable({ cut_admin: true }, "central"));
    expect(central.policies[0].delta.expenditure).toBeCloseTo(-8.8, 9);
    expect(central.nodes["exp.admin"].delta).toBeCloseTo(-8.8, 9);
    const state = simulate(testland, enable({ cut_admin: true }, "state"));
    expect(state.policies[0].delta.expenditure).toBeCloseTo(-31.2, 9);
    // A wealth tax that belongs to the provinces does not show up at the centre.
    expect(simulate(testland, enable({ wealth_tax: true }, "central")).delta.revenue).toBe(0);
    expect(simulate(testland, enable({ wealth_tax: true }, "state")).delta.revenue).toBeCloseTo(40, 9);
  });

  it("the levels add up to the unfiltered result: totals, nodes, policies, effects and ranges", () => {
    const whole = simulate(testland, enable(ALL));
    const parts = levels.map((level) => simulate(testland, enable(ALL, level)));
    const add = (pick: (r: typeof whole) => number) => parts.reduce((total, part) => total + pick(part), 0);

    for (const key of ["revenue", "expenditure", "balance"] as const) {
      expect(add((r) => r.baseline[key])).toBeCloseTo(whole.baseline[key], 9);
      expect(add((r) => r.reform[key])).toBeCloseTo(whole.reform[key], 9);
      expect(add((r) => r.delta[key])).toBeCloseTo(whole.delta[key], 9);
      expect(add((r) => r.deltaLow[key])).toBeCloseTo(whole.deltaLow[key], 9);
      expect(add((r) => r.deltaHigh[key])).toBeCloseTo(whole.deltaHigh[key], 9);
    }
    for (const id of Object.keys(whole.nodes)) {
      expect(add((r) => r.nodes[id].baseline)).toBeCloseTo(whole.nodes[id].baseline, 9);
      expect(add((r) => r.nodes[id].reform)).toBeCloseTo(whole.nodes[id].reform, 9);
      expect(add((r) => r.nodes[id].delta)).toBeCloseTo(whole.nodes[id].delta, 9);
    }
    whole.policies.forEach((p, i) => {
      expect(add((r) => r.policies[i].delta.balance)).toBeCloseTo(p.delta.balance, 9);
      p.effects.forEach((effect, k) => {
        expect(add((r) => r.policies[i].effects[k].delta)).toBeCloseTo(effect.delta, 9);
        if (effect.shift) expect(add((r) => r.policies[i].effects[k].shift?.delta ?? NaN)).toBeCloseTo(effect.shift.delta, 9);
      });
    });
  });

  it("the filter is only a view: the calculation behind it is the same", () => {
    // The calibrated schedule uses the whole income tax as its base, not the central half.
    const central = simulate(testland, enable({ raise_top_tax_rate: true }, "central"));
    expect(central.policies[0].delta.revenue).toBeCloseTo(62.5, 9);
    expect(central.policies[0].effects[0].affected).toEqual({ threshold: 30, units: 10, share: 0.2 });
    // Attribution still adds up inside one level.
    const all = simulate(testland, enable(ALL, "central"));
    const sum = all.policies.reduce((total, p) => total + p.delta.balance, 0);
    expect(sum).toBe(all.delta.balance);
    expect(all.reform.balance - all.baseline.balance).toBeCloseTo(all.delta.balance, 9);
  });

  it('treats "all" and no filter alike', () => {
    expect(simulate(testland, { policies: {}, level: "all" })).toEqual(simulate(testland));
  });

  it("normalises shares that are off by rounding, so the levels still add up", () => {
    const pack = testlandCopy();
    leafOf(pack, "rev.taxes.vat").levels = { central: 0.333, state: 0.333, social_security: 0.333 };
    const total = LEVEL_IDS.reduce((sum, level) => sum + simulate(pack, { policies: {}, level }).baseline.revenue, 0);
    expect(total).toBeCloseTo(4000, 9);
    expect(simulate(pack, { policies: {}, level: "central" }).nodes["rev.taxes.vat"].baseline).toBeCloseTo(1000 / 3, 9);
  });

  it("reports a level the country does not have", () => {
    const result = simulate(testland, { policies: {}, level: "local" });
    expect(result.baseline).toEqual({ revenue: 0, expenditure: 0, balance: 0 });
    expect(result.warnings.map((w) => w.code)).toEqual(["unknown_level"]);
  });
});

describe("purity", () => {
  it("does not change the pack and gives the same answer every time", () => {
    const before = JSON.stringify(testland);
    const first = simulate(testland, enable(ALL));
    const second = simulate(testland, enable(ALL));
    expect(second).toEqual(first);
    expect(JSON.stringify(testland)).toBe(before);
    expect(simulate(testland).reform).toEqual({ revenue: 4000, expenditure: 4400, balance: -400 });
  });

  it("carries nothing from one call to the next: excludeGroups with and without a shift, across level filters", () => {
    const exclude: Effect = { type: "excludeGroups", target: "exp.social.basic_income", breakdown: "citizenship", groups: ["non_eu", "eu"], quality: "estimate" };
    const build = (): CountryPack =>
      withPolicies(
        // retained 0 empties the groups for the rest of a run; a later run must start with them full again
        policy("plain", [exclude]),
        policy("shifted", [{ ...exclude, groups: ["non_eu", "citizens"], shift: { to: "exp.education", ratio: 1.04, uncertainty: { low: 0.9, high: 1.1 } } }]),
        policy("half", [{ ...exclude, groups: ["eu"], retained: 0.5, shift: { to: "exp.admin", ratio: 0.5 } }]),
      );
    const pack = build();
    const levels = ["all", "central", "state", "local", "social_security"] as const;
    const scenarios = [{ plain: true }, { shifted: true }, { half: true }, { plain: true, shifted: true }, { plain: true, shifted: true, half: true }] as const;

    for (const on of scenarios) {
      const policies = enable(on).policies;
      // First pass over all levels, then the same calls again, in the other order, on the same pack.
      const first = levels.map((level) => simulate(pack, { policies, level }));
      const again = [...levels].reverse().map((level) => simulate(pack, { policies, level })).reverse();
      expect(again).toEqual(first);
      expect(simulate(pack, { policies })).toEqual(first[0]);
      // A pack that has never been simulated gives the same answers as the much-used one.
      levels.forEach((level, i) => expect(simulate(build(), { policies, level })).toEqual(first[i]));
      // The measure really does something, every time.
      expect(first[0].delta.balance).not.toBe(0);
      for (const key of ["revenue", "expenditure", "balance"] as const) {
        expect(first.slice(1).reduce((sum, r) => sum + r.delta[key], 0)).toBeCloseTo(first[0].delta[key], 9);
      }
    }

    // Hand-checked for the much-used pack: non-EU and EU citizens are 40 % of 400.
    const plain = simulate(pack, enable({ plain: true }));
    expect(plain.delta.balance).toBeCloseTo(160, 9);
    expect(plain.policies[0].effects[0].excludedShare).toBeCloseTo(0.4, 12);
    // Non-EU and citizens are 90 % of 400 = 360; 104 % of that reappears in education.
    const shifted = simulate(pack, enable({ shifted: true })).policies[0].effects[0];
    expect(shifted.delta).toBeCloseTo(-360, 9);
    expect(shifted.shift?.delta).toBeCloseTo(374.4, 9);
    // Central government pays basic income support, the provinces education.
    expect(simulate(pack, enable({ shifted: true }, "central")).delta.balance).toBeCloseTo(360, 9);
    expect(simulate(pack, enable({ shifted: true }, "state")).delta.balance).toBeCloseTo(-374.4, 9);
  });

  it("carries nothing over on the fixture either, whatever was simulated before", () => {
    // Two of three groups, so the result depends on what is left of each of them.
    const scenario = enable({ no_basic_income_non_citizens: { groups: ["non_eu", "eu"] }, cut_pensions: true });
    const expected = simulate(testlandCopy(), scenario);
    expect(expected.nodes["exp.social.basic_income"].reform).toBeCloseTo(400 * (1 - 0.4 * 0.8) + 40, 9);
    for (let i = 0; i < 3; i++) {
      simulate(testland, enable(ALL, "central"));
      simulate(testland, enable({ no_basic_income_non_citizens: { groups: ["citizens"] } }, "state"));
      expect(simulate(testland, scenario)).toEqual(expected);
    }
  });

  it("refuses a pack whose references are broken instead of guessing", () => {
    const pack = withPolicies(policy("p", [{ type: "scale", target: "exp.nope", factor: 1, quality: "estimate" }]));
    expect(() => simulate(pack, enable({ p: true }))).toThrow(/unknown target node "exp.nope"/);
  });
});
