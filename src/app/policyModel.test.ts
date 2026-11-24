import { describe, expect, it } from "vitest";
import { testland } from "../engine/__fixtures__/testland.ts";
import { simulate, simulatePolicy, type Param, type ParamValues, type Policy } from "../engine/index.ts";
import { insightOf, settingsOf } from "./policyModel.ts";

const policy = (id: string): Policy => {
  const found = testland.policies.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`the fixture has no policy ${id}`);
  return found;
};

describe("the settings of a measure", () => {
  it("are its sliders and its choices of groups", () => {
    expect(settingsOf(policy("cut_admin")).map((param) => param.type)).toEqual(["number"]);
    expect(settingsOf(policy("no_basic_income_non_citizens")).map((param) => param.type)).toEqual(["groups"]);
    expect(settingsOf(policy("halve_mp_pay"))).toEqual([]);
  });

  it("leave out a kind of parameter the card has no control for", () => {
    // What a newer pack may carry: a kind of parameter this interface does not know.
    const unknown = { id: "curve", type: "curve", label: { en: "Rate curve" }, default: [] } as unknown as Param;
    const known = policy("cut_admin");
    expect(settingsOf({ ...known, params: [unknown, ...known.params] })).toEqual(known.params);
    expect(settingsOf({ ...known, params: [unknown] })).toEqual([]);
  });
});

describe("what a card says about the two sides of the budget", () => {
  // Testland's revenue is 4,000, its spending 4,400.
  const baseline = simulate(testland, { policies: {} }).baseline;
  const insight = (id: string, params?: ParamValues) => insightOf(testland, simulatePolicy(testland, id, params, "all")!, baseline);

  it("gives the change of each side, and the share of the one side a measure changes", () => {
    // Cutting pensions by 10 %: 160 less, of which 40 come back as basic income.
    const cut = insight("cut_pensions");
    expect([cut.revenue, cut.expenditure, cut.balance]).toEqual([0, -120, 120]);
    expect(cut.side).toBe("expenditure");
    expect(cut.shareOfSide).toBeCloseTo(120 / 4400, 12);
  });

  it("gives no share of a side where a measure changes both: the balance is the change of neither", () => {
    // Contributions of 100 in, 15 less income tax, the employer's part of 50 out.
    const insure = insight("insure_civil_servants");
    expect(insure.revenue).toBeCloseTo(85, 9);
    expect(insure.expenditure).toBeCloseTo(50, 9);
    expect(insure.balance).toBeCloseTo(35, 9);
    expect(insure.shareOfSide).toBeNull();
  });

  it("writes a side that does not change as a plain zero", () => {
    const nothing = insight("cut_pensions", { cut: 0 });
    expect([nothing.revenue, nothing.expenditure]).toEqual([0, 0]);
    expect(nothing.direction).toBe("neutral");
  });
});
