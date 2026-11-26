import { describe, expect, it } from "vitest";
import { testland, testlandWhoPays } from "./__fixtures__/testland.ts";
import { valueAtShare } from "./distribution.ts";
import { measureWhoPays, whoPays, type WhoPays } from "./incidence.ts";
import { simulate, simulatePolicy, type Scenario } from "./simulate.ts";

const pack = testlandWhoPays();
const on = (...ids: string[]): Scenario => ({ policies: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) });
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
const scope = (result: WhoPays, id: string) => result.scopes.find((entry) => entry.id === id)!;

describe("whoPays", () => {
  it("is undefined for a pack without incidence.json", () => {
    expect(whoPays(testland, simulate(testland))).toBeUndefined();
    expect(measureWhoPays(testland, simulatePolicy(testland, "raise_top_tax_rate")!)).toBeUndefined();
  });

  it("needs a simulation of the whole budget", () => {
    expect(() => whoPays(pack, simulate(pack, { ...on("cut_admin"), level: "central" }))).toThrow(/level "all"/);
  });

  it("spreads today's taxes by the node entries, coverage and payers included", () => {
    const taxes = scope(whoPays(pack, simulate(pack))!, "taxes");
    expect(taxes.total).toEqual({ today: 2500, reform: 2500 });
    expect(taxes.groupsTotal.today).toBeCloseTo(2300, 9);
    expect(taxes.groups.map((group) => group.today)).toEqual([expect.closeTo(395, 9), expect.closeTo(995, 9), expect.closeTo(910, 9)]);
    expect(taxes.groups.map((group) => group.shareToday)).toEqual([expect.closeTo(395 / 2300, 12), expect.closeTo(995 / 2300, 12), expect.closeTo(910 / 2300, 12)]);
    expect(taxes.payers).toEqual([{ id: "companies", today: expect.closeTo(200, 9), reform: expect.closeTo(200, 9) }]);
    // Units, income and the share of the group's income.
    expect(taxes.groups.map((group) => group.units)).toEqual([50, 40, 10]);
    expect(taxes.groups[2].incomeShare).toBe(0.3);
    expect(taxes.groups[2].rateToday).toBeCloseTo(910 / 300, 12);
  });

  it("adds up to the budget's revenue in a statement of lines, today and with every measure on", () => {
    const scenario = on(...pack.policies.map((policy) => policy.id));
    const result = simulate(pack, scenario);
    const statement = whoPays(pack, result)!.statement;
    expect(statement.today).toBeCloseTo(result.baseline.revenue, 9);
    expect(statement.reform).toBeCloseTo(result.reform.revenue, 9);
    expect(statement.lines.map((line) => line.payer)).toEqual([undefined, "companies", "not_a_tax"]);
    expect(sum(statement.lines.map((line) => line.today))).toBeCloseTo(4000, 9);
    for (const line of statement.lines) {
      expect(sum(line.items.map((item) => item.today))).toBeCloseTo(line.today, 9);
      expect(sum(line.items.map((item) => item.reform))).toBeCloseTo(line.reform, 9);
    }
    // Behind each line the nodes it consists of: VAT is on the groups' line and the companies' line.
    const items = (payer?: string) => statement.lines.find((line) => line.payer === payer)!.items.map((item) => item.node);
    expect(items()).toEqual(["rev.taxes.income", "rev.taxes.vat", "rev.taxes.wealth", "rev.social_contributions"]);
    // Income tax there with measures only: the knock-on of insure_civil_servants.
    expect(items("companies")).toEqual(["rev.taxes.income", "rev.taxes.vat"]);
    expect(items("not_a_tax")).toEqual(["rev.other"]);
  });

  it("the measures' changes add up to the change of what the groups and payers pay", () => {
    const result = simulate(pack, on(...pack.policies.map((policy) => policy.id)));
    const who = whoPays(pack, result)!;
    for (const entry of who.scopes) {
      for (let g = 0; g < entry.groups.length; g++) {
        const changes = sum(who.measures.map((measure) => measure.scopes[entry.id].groups[g]));
        expect(changes).toBeCloseTo(entry.groups[g].delta, 9);
      }
      for (const payer of entry.payers) {
        const changes = sum(who.measures.map((measure) => measure.scopes[entry.id].payers[payer.id] ?? 0));
        expect(changes).toBeCloseTo(payer.reform - payer.today, 9);
      }
      expect(entry.groupsTotal.reform - entry.groupsTotal.today + sum(entry.payers.map((payer) => payer.reform - payer.today))).toBeCloseTo(entry.total.reform - entry.total.today, 9);
    }
  });

  it("a proportional change of a node leaves the shares untouched", () => {
    const one = testlandWhoPays();
    one.incidence!.scopes = [{ id: "income", label: { en: "Income tax", de: "Einkommensteuer" }, nodes: ["rev.taxes.income"] }];
    one.policies.push({
      id: "scale_income_tax",
      label: { en: "x", de: "x" },
      summary: { en: "x", de: "x" },
      topic: "taxes",
      params: [],
      effects: [{ type: "scale", target: "rev.taxes.income", factor: 1.3, quality: "estimate" }],
      catches: [],
      sources: [],
    });
    const result = whoPays(one, simulate(one, on("scale_income_tax")))!.scopes[0];
    for (const group of result.groups) expect(group.shareReform).toBeCloseTo(group.shareToday, 12);
    expect(result.groupsTotal.reform).toBeCloseTo(1950, 9);
  });

  it("spreads a change of a group node leaf by leaf, each leaf with its own entry", () => {
    // +10 % on all taxes: +150 income tax by its profile, +100 VAT of which 80 by its profile and 20 on companies.
    const measure = measureWhoPays(pack, simulatePolicy(pack, "vat_on_everything")!)!;
    expect(measure.groups).toEqual([expect.closeTo(7.5 + 32, 9), expect.closeTo(67.5 + 32, 9), expect.closeTo(75 + 16, 9)]);
    expect(measure.payers).toEqual({ companies: expect.closeTo(20, 9) });
  });

  it("computes a schedule's change from the distribution: a higher top rate leaves the bottom half alone", () => {
    expect(valueAtShare(pack.distributions.income, 0.5)).toBeCloseTo(15, 12);
    expect(valueAtShare(pack.distributions.income, 0.9)).toBeCloseTo(40, 12);
    const result = simulatePolicy(pack, "raise_top_tax_rate")!;
    const measure = measureWhoPays(pack, result)!;
    expect(measure.groups).toEqual([0, expect.closeTo(31.25, 9), expect.closeTo(93.75, 9)]);
    expect(sum(measure.groups)).toBeCloseTo(result.delta.revenue, 9);
    // The editable curve: the default tariff lowers the tax for incomes from 10 to 23 1/3 and raises it above.
    const curve = measureWhoPays(pack, simulatePolicy(pack, "redraw_income_tax")!)!;
    expect(curve.groups[0]).toBeLessThan(0);
    expect(curve.groups[2]).toBeGreaterThan(0);
    expect(sum(curve.groups)).toBeCloseTo(simulatePolicy(pack, "redraw_income_tax")!.delta.revenue, 9);
  });

  it("scales the computed change to the effect's yield", () => {
    const halved = testlandWhoPays();
    const effect = halved.policies.find((policy) => policy.id === "raise_top_tax_rate")!.effects[0];
    if (effect.type !== "schedule") throw new Error("schedule expected");
    effect.yield = 0.5;
    expect(measureWhoPays(halved, simulatePolicy(halved, "raise_top_tax_rate")!)!.groups).toEqual([0, expect.closeTo(15.625, 9), expect.closeTo(46.875, 9)]);
  });

  it("an effect's own incidence takes the whole change: a profile, a payer or a profile with payers", () => {
    // insure_civil_servants: +100 contributions by their profile; its -15 of income tax lands on companies.
    const civil = measureWhoPays(pack, simulatePolicy(pack, "insure_civil_servants")!)!;
    expect(civil.groups).toEqual([expect.closeTo(30, 9), expect.closeTo(50, 9), expect.closeTo(20, 9)]);
    expect(civil.payers).toEqual({ companies: expect.closeTo(-15, 9) });
    expect(civil.scopes.taxes).toEqual({ groups: [0, 0, 0], payers: { companies: expect.closeTo(-15, 9) } });

    const mixed = testlandWhoPays();
    mixed.policies.find((policy) => policy.id === "raise_top_tax_rate")!.effects[0].incidence = "half_companies";
    const measure = measureWhoPays(mixed, simulatePolicy(mixed, "raise_top_tax_rate")!)!;
    expect(measure.groups).toEqual([0, expect.closeTo(31.25, 9), expect.closeTo(31.25, 9)]);
    expect(measure.payers).toEqual({ companies: expect.closeTo(62.5, 9) });
  });

  describe("incidenceAbove: the part of a schedule's change from the rates at or above a threshold", () => {
    // raise_top_tax_rate: the top rate from 30 up rises from 40 to 50 %; the model rises by 10, x 12.5 = 125.
    const withAbove = (from: number, incidence: string, own?: string) => {
      const copy = testlandWhoPays();
      const effect = copy.policies.find((policy) => policy.id === "raise_top_tax_rate")!.effects[0];
      if (effect.type !== "schedule") throw new Error("schedule expected");
      effect.incidenceAbove = { from, incidence };
      if (own) effect.incidence = own;
      return measureWhoPays(copy, simulatePolicy(copy, "raise_top_tax_rate")!)!;
    };

    it("a change only above the threshold goes wholly by the profile named there", () => {
      const measure = withAbove(30, "half_companies");
      expect(measure.groups).toEqual([0, expect.closeTo(31.25, 9), expect.closeTo(31.25, 9)]);
      expect(measure.payers).toEqual({ companies: expect.closeTo(62.5, 9) });
    });

    it("a change only below the threshold goes wholly by the rule for the rest", () => {
      // Nobody has an income of 60: the whole change is the rest, computed from the distribution.
      const measure = withAbove(60, "companies");
      expect(measure.groups).toEqual([0, expect.closeTo(31.25, 9), expect.closeTo(93.75, 9)]);
      expect(measure.payers).toEqual({});
      // With an own profile, the rest goes by that.
      expect(withAbove(60, "companies", "vat").groups).toEqual([expect.closeTo(50, 9), expect.closeTo(50, 9), expect.closeTo(25, 9)]);
    });

    it("a change on both sides splits, and the parts add up to the effect's change", () => {
      // From 40: the five units between 30 and 40 add 2.5 below; the five above 40 add 5 below and
      // 2.5 above. x 12.5: 31.25 above to companies, the rest 31.25 and 62.5 from the distribution.
      const measure = withAbove(40, "companies");
      expect(measure.groups).toEqual([0, expect.closeTo(31.25, 9), expect.closeTo(62.5, 9)]);
      expect(measure.payers).toEqual({ companies: expect.closeTo(31.25, 9) });
      expect(sum(measure.groups) + measure.payers.companies).toBeCloseTo(125, 9);
      // Spread like the node instead of computed: the rest by the income tax profile.
      const copy = testlandWhoPays();
      delete copy.incidence!.distributions;
      const effect = copy.policies.find((policy) => policy.id === "raise_top_tax_rate")!.effects[0];
      if (effect.type !== "schedule") throw new Error("schedule expected");
      effect.incidenceAbove = { from: 40, incidence: "companies" };
      const node = measureWhoPays(copy, simulatePolicy(copy, "raise_top_tax_rate")!)!;
      expect(node.groups).toEqual([expect.closeTo(93.75 * 0.05, 9), expect.closeTo(93.75 * 0.45, 9), expect.closeTo(93.75 * 0.5, 9)]);
      expect(node.payers).toEqual({ companies: expect.closeTo(31.25, 9) });
    });

    it("works with a curve as the reform", () => {
      // The default curve raises the rates between 20 and 30 (from 20 % to 25 to 40 %) and lowers them from 10 to 20.
      const copy = testlandWhoPays();
      const effect = copy.policies.find((policy) => policy.id === "redraw_income_tax")!.effects[0];
      if (effect.type !== "schedule") throw new Error("schedule expected");
      effect.incidenceAbove = { from: 20, incidence: "companies" };
      const result = simulatePolicy(copy, "redraw_income_tax")!;
      const measure = measureWhoPays(copy, result)!;
      expect(sum(measure.groups) + (measure.payers.companies ?? 0)).toBeCloseTo(result.delta.revenue, 9);
      expect(measure.payers.companies).toBeGreaterThan(0);
    });
  });

  it("incidenceShare sends a part of the change, set by a param, to a profile or payer of its own", () => {
    // insure_civil_servants: +100 contributions; the employer's share (default 50 %) to companies here.
    const copy = testlandWhoPays();
    const effect = copy.policies.find((policy) => policy.id === "insure_civil_servants")!.effects[0];
    effect.incidenceShare = { share: { param: "employer_share", scale: 0.01 }, incidence: "companies" };
    const at = (share: number) => measureWhoPays(copy, simulatePolicy(copy, "insure_civil_servants", { employer_share: share })!)!;
    const half = at(50);
    // 50 to companies; the other 50 by the contributions profile; the knock-on of -15 to companies as before.
    expect(half.groups).toEqual([expect.closeTo(15, 9), expect.closeTo(25, 9), expect.closeTo(10, 9)]);
    expect(half.payers).toEqual({ companies: expect.closeTo(50 - 15, 9) });
    const all = at(100);
    expect(all.groups).toEqual([0, 0, 0]);
    // At 100 % the employer pays all of it, and no knock-on on income tax is left (ratio 0.3 - 0.003 x 100).
    expect(all.payers).toEqual({ companies: expect.closeTo(100, 9) });
  });

  it("counts no change of spending", () => {
    const measure = measureWhoPays(pack, simulatePolicy(pack, "cut_admin")!)!;
    expect(measure.groups).toEqual([0, 0, 0]);
    expect(measure.payers).toEqual({});
  });

  it("works out the change per person and as a share of the group's income", () => {
    const result = whoPays(pack, simulate(pack, on("raise_top_tax_rate")))!;
    const top = scope(result, "taxes").groups[2];
    expect(top.delta).toBeCloseTo(93.75, 9);
    expect(top.deltaPerUnit).toBeCloseTo(9.375, 9);
    expect(top.rateReform).toBeCloseTo((910 + 93.75) / 300, 12);
    expect(scope(result, "taxes").groups[0].delta).toBe(0);
  });
});
