import { describe, expect, it } from "vitest";
import { testland, testlandManyEffects as manyEffects } from "../engine/__fixtures__/testland.ts";
import { simulatePolicy, type Effect, type Policy } from "../engine/index.ts";
import { balanceOfEffect, effectGroups, MANY_EFFECTS, paramsOfEffect } from "./effectGroups.ts";

describe("paramsOfEffect", () => {
  it("finds every param an effect names, and none in its texts", () => {
    const byId = (id: string): Policy => testland.policies.find((policy) => policy.id === id)!;
    expect(paramsOfEffect(byId("cut_admin").effects[0])).toEqual(["cut"]);
    expect(paramsOfEffect(byId("no_basic_income_non_citizens").effects[0])).toEqual(["groups"]);
    expect(paramsOfEffect(byId("halve_mp_pay").effects[0])).toEqual([]);
    // A schedule names its curve.
    expect(paramsOfEffect(byId("redraw_income_tax").effects[0])).toEqual(["tariff"]);
    // A shift is part of the effect.
    const shifted: Effect = {
      type: "add",
      target: "exp.health",
      amount: { param: "a", scale: 1 },
      quality: "estimate",
      shift: { to: "exp.education", ratio: { param: "b", scale: 0.01 }, label: { en: "param", de: "param" } },
    } as Effect;
    expect(paramsOfEffect(shifted)).toEqual(["a", "b"]);
  });
});

describe("effectGroups", () => {
  it("leaves a measure with few effects as it is", () => {
    for (const policy of testland.policies) {
      expect(policy.effects.length).toBeLessThanOrEqual(MANY_EFFECTS);
      const result = simulatePolicy(testland, policy.id)!;
      expect(effectGroups(policy, result.effects, result.effects)).toBeUndefined();
    }
  });

  it("groups many by the setting that drives them, in the order of the settings, the largest first", () => {
    const { pack, policy } = manyEffects();
    const result = simulatePolicy(pack, policy.id)!;
    const groups = effectGroups(policy, result.effects, result.effects)!;
    expect(groups.map((group) => group.params)).toEqual([["staff"], ["pay"], []]);
    // Staff: 50, 40, 30 shown; 20 and 10 one step away.
    expect(groups[0].shown.map((effect) => effect.index)).toEqual([2, 5, 1]);
    expect(groups[0].rest.map((effect) => effect.index)).toEqual([4, 0]);
    expect(groups[0].balance).toBeCloseTo(150);
    expect(groups[0].restBalance).toBeCloseTo(30);
    // Pay: two, both shown; the fixed one worsens the balance.
    expect(groups[1].shown.map((effect) => effect.index)).toEqual([6, 3]);
    expect(groups[1].rest).toEqual([]);
    expect(groups[2].balance).toBeCloseTo(-3);
    // Together they are the measure.
    expect(groups.reduce((sum, group) => sum + group.balance, 0)).toBeCloseTo(result.delta.balance);
  });

  it("keeps the order of the default settings while a slider moves, and shows a single further item", () => {
    const { pack, policy } = manyEffects();
    const defaults = simulatePolicy(pack, policy.id)!.effects;
    // Pay at 50: its effects outgrow the staff cuts, but the order and the split stay.
    const moved = simulatePolicy(pack, policy.id, { staff: 1, pay: 50 })!;
    const groups = effectGroups(policy, moved.effects, defaults)!;
    expect(groups[0].shown.map((effect) => effect.index)).toEqual([2, 5, 1]);
    expect(groups[1].balance).toBeGreaterThan(groups[0].balance);
    expect(groups[0].balance).toBeCloseTo(15);
    // One group alone shows five.
    const staffOnly = (effect: Effect): Effect => ({ ...effect, amount: { param: "staff", scale: -1 } }) as Effect;
    const alone = { ...policy, params: [policy.params[0]], effects: policy.effects.map(staffOnly) };
    const one = effectGroups(alone, moved.effects, defaults)!;
    expect(one).toHaveLength(1);
    expect(one[0].shown).toHaveLength(5);
    expect(one[0].rest).toHaveLength(3);
    // A group of four shows all four: a single further item is not put behind a button of its own.
    const payFirst = { ...policy, effects: policy.effects.map((effect, i) => (i === 0 ? ({ ...effect, amount: { param: "pay", scale: -1 } } as Effect) : effect)) };
    const four = effectGroups(payFirst, moved.effects, defaults)!;
    expect(four[0].shown).toHaveLength(4);
    expect(four[0].rest).toEqual([]);
  });

  it("counts a passed-on part with the effect it belongs to", () => {
    const pensions = testland.policies.find((policy) => policy.id === "cut_pensions")!;
    const effect = simulatePolicy(testland, pensions.id)!.effects[0];
    expect(effect.shift).toBeDefined();
    expect(balanceOfEffect(effect)).toBeCloseTo(-effect.delta - effect.shift!.delta);
  });
});
