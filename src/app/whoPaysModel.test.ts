import { describe, expect, it } from "vitest";
import { testland, testlandWhoPays } from "../engine/__fixtures__/testland.ts";
import { measureWhoPays, simulate, simulatePolicy, whoPays, type Scenario } from "../engine/index.ts";
import { chartOf, largestChange, measuresOf, scopeOf, sourcesOf, spreadable, statementOf, stripOf } from "./whoPaysModel.ts";

const pack = testlandWhoPays();
const on = (...ids: string[]): Scenario => ({ policies: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) });
const who = (scenario: Scenario = on()) => whoPays(pack, simulate(pack, scenario))!;
const strip = (id: string, always = false) => {
  const result = simulatePolicy(pack, id)!;
  return stripOf(pack, measureWhoPays(pack, result), result, 1e-9, always);
};

describe("scopes", () => {
  it("is the pack's first unless another one is named; none without incidence.json", () => {
    expect(scopeOf(pack)?.id).toBe("taxes");
    expect(scopeOf(pack, "all")?.id).toBe("all");
    expect(scopeOf(pack, "nope")?.id).toBe("taxes");
    expect(scopeOf(testland)).toBeUndefined();
  });
});

describe("the chart of a scope", () => {
  it("has a row per group with today's shares, on a scale rounded up to a tenth", () => {
    const chart = chartOf(pack, who())!;
    expect(chart.rows.map((row) => row.id)).toEqual(["bottom_50", "next_40", "top_10"]);
    expect(chart.rows[1].from).toBe(15);
    expect(chart.rows[0].from).toBeUndefined();
    expect(chart.rows.map((row) => row.shareToday)).toEqual([expect.closeTo(395 / 2300, 9), expect.closeTo(995 / 2300, 9), expect.closeTo(910 / 2300, 9)]);
    expect(chart.max).toBe(0.5);
    expect(chart.changed).toBe(false);
    expect(largestChange(chart)).toBeUndefined();
  });

  it("knows when the measures moved a share, and which group moved most", () => {
    const chart = chartOf(pack, who(on("raise_top_tax_rate")))!;
    expect(chart.changed).toBe(true);
    expect(largestChange(chart)?.id).toBe("top_10");
    expect(chart.rows[0].delta).toBe(0);
    expect(chart.rows[0].change).toBeLessThan(0);
    // A measure whose change lands with companies moves nobody's share of what the groups pay.
    expect(chartOf(pack, who(on("insure_civil_servants")))!.changed).toBe(false);
  });
});

describe("the strip of a measure", () => {
  it("gives each group's change in all and per person", () => {
    const top = strip("raise_top_tax_rate")!;
    expect(top.spread).toBe(true);
    expect(top.groups.map((group) => group.change)).toEqual([0, expect.closeTo(31.25, 9), expect.closeTo(93.75, 9)]);
    expect(top.groups[2].perUnit).toBeCloseTo(9.375, 9);
    expect(top.maxPerUnit).toBeCloseTo(9.375, 9);
    expect(top.payers).toEqual([]);
  });

  it("names the payers outside the groups, with the pack's sentence", () => {
    const civil = strip("insure_civil_servants")!;
    expect(civil.payers).toEqual([{ id: "companies", label: { en: "Companies", de: "Unternehmen" }, change: expect.closeTo(-15, 9) }]);
    expect(civil.notes).toEqual([{ en: "Firms that employ civil servants pay less.", de: "Firmen mit Beamten zahlen weniger." }]);
  });

  it("is absent for a measure on spending, unless one is wanted all the same", () => {
    expect(strip("cut_admin")).toBeUndefined();
    const zero = strip("cut_admin", true)!;
    expect(zero.spread).toBe(false);
    expect(zero.groups.map((group) => group.change)).toEqual([0, 0, 0]);
  });

  it("says which measures the curve editor keeps a table of groups for", () => {
    expect(spreadable(pack, "redraw_income_tax")).toBe(true);
    expect(spreadable(pack, "insure_civil_servants")).toBe(true);
    expect(spreadable(pack, "cut_admin")).toBe(false);
    const payerOnly = testlandWhoPays();
    payerOnly.policies.find((policy) => policy.id === "raise_top_tax_rate")!.effects[0].incidence = "companies";
    expect(spreadable(payerOnly, "raise_top_tax_rate")).toBe(false);
  });
});

describe("under the chart", () => {
  it("lists the measures spread over the groups and those that land with payers", () => {
    const list = measuresOf(pack, who(on("raise_top_tax_rate", "insure_civil_servants", "cut_admin")), "taxes", 1e-9);
    expect(list.counted).toEqual(["raise_top_tax_rate"]);
    expect(list.outside.map((entry) => entry.policy)).toEqual(["insure_civil_servants"]);
    // In the scope with contributions the same measure is spread as well.
    expect(measuresOf(pack, who(on("insure_civil_servants")), "all", 1e-9).counted).toEqual(["insure_civil_servants"]);
  });

  it("the statement: the groups' line first, then each payer with its label", () => {
    const lines = statementOf(pack, who());
    expect(lines.map((line) => line.payer)).toEqual([undefined, "companies", "not_a_tax"]);
    expect(lines[1].label).toEqual({ en: "Companies", de: "Unternehmen" });
    expect(lines[1].note).toEqual({ en: "Taxes on profits.", de: "Steuern auf Gewinne." });
  });

  it("cites the sources of the population, the income and the profiles of the scope's nodes", () => {
    expect(sourcesOf(pack, "taxes").sort()).toEqual(["finance_ministry", "tax_statistics", "wealth_survey"]);
  });
});
