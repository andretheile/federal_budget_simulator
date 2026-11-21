import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import { applyDebtPreset, projectDebt, resolveDebtAssumptions, simulate, type CountryPack, type Scenario } from "../engine/index.ts";
import { loadPack } from "../packs.ts";
import {
  crossing,
  debtHeadline,
  debtView,
  interestComparisons,
  lastOf,
  recordAt,
  referenceRows,
  samePath,
  tableYears,
  type DebtView,
} from "./debtModel.ts";

/**
 * Testland at the defaults (market rate 4 %, growth 3 %, 30 years): interest starts at 1 % of GDP
 * and 2.5 % of revenue, the debt at 50 % of GDP. Compared items: parliament (0.1 % of GDP),
 * defence and family benefits (2 % each), pensions (16 %).
 */
const NONE: Scenario = { policies: {} };
const ALL: Scenario = { policies: Object.fromEntries(testland.policies.map((policy) => [policy.id, { enabled: true }])) };

function view(scenario: Scenario, assumptions?: Parameters<typeof debtView>[3], pack: CountryPack = testland): DebtView {
  return debtView(pack, scenario, simulate(pack, scenario), assumptions)!;
}

describe("the paths to show", () => {
  it("without measures there is one path and no band", () => {
    const v = view(NONE);
    expect(v).toMatchObject({ measuresOn: false, twoPaths: false, hasRange: false });
    expect(samePath(v.projection.baseline, v.projection.reform)).toBe(true);
  });

  it("measures that change the balance give two paths, and a range gives a band", () => {
    expect(view({ policies: { family_bonus: { enabled: true } } })).toMatchObject({ measuresOn: true, twoPaths: true, hasRange: false });
    expect(view(ALL)).toMatchObject({ measuresOn: true, twoPaths: true, hasRange: true });
  });

  it("a measure on the interest item changes only the base year, which is enough for two paths", () => {
    // Halving the interest item changes the base-year balance but not the projection, which computes interest itself.
    const pack = testlandCopy();
    pack.policies.push({
      id: "halve_interest",
      label: { en: "Halve interest", de: "Zinsen halbieren" },
      summary: { en: "-", de: "-" },
      topic: "other",
      params: [],
      effects: [{ type: "scale", target: "exp.interest", factor: 0.5, quality: "estimate" }],
      catches: [],
      sources: [],
    });
    const v = view({ policies: { halve_interest: { enabled: true } } }, undefined, pack);
    expect(v.measuresOn).toBe(true);
    // The base year differs (interest is half), so both paths are drawn; the years after are the same.
    expect(v.twoPaths).toBe(true);
    expect(v.projection.reform.years).toEqual(v.projection.baseline.years);
  });

  it("is for the whole state when the page shows one level", () => {
    const scenario: Scenario = { policies: { cut_admin: { enabled: true } }, level: "central" };
    const filtered = simulate(testland, scenario);
    expect(filtered.level).toBe("central");
    const v = debtView(testland, scenario, filtered, undefined)!;
    expect(v.whole.level).toBe("all");
    expect(v.projection).toEqual(projectDebt(testland, simulate(testland, { ...scenario, level: "all" })));
  });

  it("finds records by year", () => {
    const { reform } = view(NONE).projection;
    expect(recordAt(reform, 2024)).toBe(reform.start);
    expect(recordAt(reform, 2034)?.year).toBe(2034);
    expect(recordAt(reform, 2055)).toBeUndefined();
    expect(lastOf(reform).year).toBe(2054);
  });

  it("has no view for a pack without debt data", () => {
    const pack = testlandCopy();
    delete pack.debt;
    expect(debtView(pack, NONE, simulate(pack), undefined)).toBeUndefined();
  });
});

describe("interest against budget items", () => {
  it("says in which year interest overtakes each item, at the item's share of GDP", () => {
    const v = view(NONE);
    const rows = interestComparisons(testland, v);
    expect(rows.map((row) => row.node)).toEqual(["exp.admin.parliament", "exp.defense", "exp.social.family", "exp.social.pensions"]);
    const [parliament, defence, family, pensions] = rows;
    expect(parliament).toMatchObject({ amount: 10, share: 0.001, without: { first: 2024, atEnd: true, drop: null } });
    expect(defence).toMatchObject({ amount: 200, share: 0.02, without: { first: 2028, atEnd: true, drop: null } });
    expect(family.label).toEqual({ en: "families", de: "Familien" });
    expect(defence.label).toEqual({ en: "Defence", de: "Verteidigung" });
    expect(pensions.without).toEqual({ first: null, atEnd: false, drop: null });
    // The year before, interest was not yet above defence; that year it is.
    const { baseline } = v.projection;
    expect(recordAt(baseline, 2027)!.interestRatio).toBeLessThanOrEqual(0.02);
    expect(recordAt(baseline, 2028)!.interestRatio).toBeGreaterThan(0.02);
    // Without measures both paths agree.
    for (const row of rows) expect(row.with).toEqual(row.without);
  });

  it("compares like with like: with the measures, against the item as the measures leave it", () => {
    // family_bonus raises family benefits from 2 % to 3 % of GDP and adds that much to the deficit.
    const [, defence, family] = interestComparisons(testland, view({ policies: { family_bonus: { enabled: true } } }));
    expect(family).toMatchObject({ amount: 200, amountWith: 300, share: 0.02, shareWith: 0.03 });
    expect(family.without.first).toBe(2028);
    expect(family.with.first).toBe(2032);
    // Defence stays as it is; the higher deficit makes interest overtake it no later than before.
    expect(defence.with.first).toBeLessThanOrEqual(2028);
  });

  it("says when interest falls back below an item", () => {
    // At a market rate of 0 the old rates die out and interest goes towards nothing.
    const [parliament] = interestComparisons(testland, view(NONE, { market_rate: 0 }));
    expect(parliament.without).toEqual({ first: 2024, atEnd: false, drop: 2032 });
    const { baseline } = view(NONE, { market_rate: 0 }).projection;
    expect(recordAt(baseline, 2031)!.interestRatio).toBeGreaterThan(0.001);
    expect(recordAt(baseline, 2032)!.interestRatio).toBeLessThanOrEqual(0.001);
  });

  it("crossing() on its own", () => {
    const { baseline } = view(NONE).projection;
    expect(crossing(baseline, 0)).toEqual({ first: 2024, atEnd: true, drop: null });
    expect(crossing(baseline, 1)).toEqual({ first: null, atEnd: false, drop: null });
  });

  it("has none when the pack names none", () => {
    const pack = testlandCopy();
    delete pack.debt!.comparisons;
    expect(interestComparisons(pack, view(NONE, undefined, pack))).toEqual([]);
  });
});

describe("the reference values", () => {
  it("says when the projection gets above each value, with and without the measures", () => {
    const rows = referenceRows(testland, view({ policies: { family_bonus: { enabled: true } } }));
    expect(rows.map((row) => row.reference.id)).toEqual(["neighbour", "treaty_limit", "peak_1995"]);
    const [neighbour, treaty, peak] = rows;
    expect(neighbour.interest).toEqual({ value: 0.035, without: 2037, with: 2035 });
    // 3.5 % of GDP on revenue of 35 % of GDP: a tenth of revenue goes on interest.
    expect(neighbour.interestRevenue!.value).toBeCloseTo(0.1, 12);
    const { baseline } = view({ policies: {} }).projection;
    expect(neighbour.interestRevenue!.without).toBe(baseline.years.find((record) => record.interestToRevenue > neighbour.interestRevenue!.value)!.year);
    expect(peak.interestRevenue).toBeUndefined();
    expect(neighbour.debt).toEqual({ value: 1.2, without: 2044, with: 2040 });
    expect(treaty.interest).toBeUndefined();
    expect(treaty.debt).toEqual({ value: 0.6, without: 2028, with: 2027 });
    expect(peak.debt).toBeUndefined();
    expect(peak.interest).toEqual({ value: 0.04, without: 2041, with: 2037 });
  });
});

describe("the opening sentence", () => {
  it("without measures: the end of the horizon against the base year, and the largest item interest is above", () => {
    const v = view(NONE);
    const headline = debtHeadline(v, interestComparisons(testland, v));
    const end = lastOf(v.projection.reform);
    expect(headline).toEqual({
      year: 2054,
      baseYear: 2024,
      marketRate: 4,
      interestToday: 0.025,
      interest: end.interestToRevenue,
      interestWithout: undefined,
      interestRange: undefined,
      debtToday: 0.5,
      debt: end.debtRatio,
      debtWithout: undefined,
      paidOff: undefined,
      // Defence and family benefits are both 2 % of GDP; the first one listed is named.
      overtakes: { label: testland.budget.expenditure[3].label, since: 2028 },
    });
  });

  it("with measures: both paths, the range, and the items as the measures leave them", () => {
    const v = view(ALL);
    const headline = debtHeadline(v, interestComparisons(testland, v));
    expect(headline.interest).toBe(lastOf(v.projection.reform).interestToRevenue);
    expect(headline.interestWithout).toBe(lastOf(v.projection.baseline).interestToRevenue);
    expect(headline.debtWithout).toBe(lastOf(v.projection.baseline).debtRatio);
    const [low, high] = headline.interestRange!;
    expect(low).toBeLessThan(headline.interest);
    expect(high).toBeGreaterThan(headline.interest);
    // With all measures defence is 3 % of GDP and stays above interest; parliament is the largest left.
    expect(headline.overtakes).toEqual({ label: { en: "Parliament", de: "Parlament" }, since: 2024 });
  });

  it("names the year the debt is paid off", () => {
    const pack = testlandCopy();
    pack.debt!.stock.value = 500;
    const health = pack.budget.expenditure[1];
    if ("amount" in health) health.amount = 0;
    const v = view(NONE, { market_rate: 1 }, pack);
    const headline = debtHeadline(v);
    expect(headline.paidOff).toBe(v.projection.reform.years.find((record) => record.debt === 0)!.year);
    expect(headline.interest).toBe(0);
  });

  it("without the list of items it says nothing about them", () => {
    expect(debtHeadline(view(NONE)).overtakes).toBeUndefined();
  });
});

describe("the years of the table", () => {
  it("the base year, round steps and always the last year", () => {
    expect(tableYears(2024, 30)).toEqual([2024, 2029, 2034, 2039, 2044, 2049, 2054]);
    expect(tableYears(2024, 50)).toEqual([2024, 2034, 2044, 2054, 2064, 2074]);
    expect(tableYears(2024, 13)).toEqual([2024, 2029, 2034, 2037]);
    expect(tableYears(2024, 10)).toEqual([2024, 2026, 2028, 2030, 2032, 2034]);
    expect(tableYears(2024, 1)).toEqual([2024, 2025]);
  });
});

describe("the German pack", () => {
  it("starts from the government's projection by default, with the 2024 budget continued as the other path", async () => {
    const result = await loadPack("de");
    if (!result.ok) {
      console.info("countries/de is not valid right now; the German figures are not checked");
      return;
    }
    const pack = result.pack;
    const debt = pack.debt!;
    const at = (v: DebtView, year: number) => recordAt(v.projection.reform, year)!;
    const defaults = view(NONE, undefined, pack);
    expect(defaults.projection.followed).toEqual({ plan: "government_projection_2026_09", until: 2030 });
    // Up to 2030 the path is the projection's: 78.25 % of GDP in 2030.
    expect(at(defaults, 2030).debtRatio).toBeCloseTo(0.7825, 6);
    expect(at(defaults, 2044).interestToRevenue).toBeCloseTo(0.084, 3);
    expect(at(defaults, 2044).debtRatio).toBeCloseTo(1.217, 3);
    const continued = view(NONE, resolveDebtAssumptions(debt, { follow: null }), pack);
    expect(continued.projection.followed).toBeUndefined();
    expect(at(continued, 2044).interestToRevenue).toBeCloseTo(0.07, 3);
    expect(at(continued, 2044).debtRatio).toBeCloseTo(1.016, 3);
    // US rates act on whichever path is chosen.
    const unitedStates = debt.presets.find((preset) => preset.id === "united_states")!;
    const us = view(NONE, applyDebtPreset(debt, resolveDebtAssumptions(debt), unitedStates), pack);
    expect(us.projection.followed?.plan).toBe("government_projection_2026_09");
    expect(at(us, 2044).interestToRevenue).toBeCloseTo(0.135, 3);
    expect(at(us, 2044).debtRatio).toBeCloseTo(1.315, 3);
    const usContinued = view(NONE, applyDebtPreset(debt, resolveDebtAssumptions(debt, { follow: null }), unitedStates), pack);
    expect(at(usContinued, 2044).interestToRevenue).toBeCloseTo(0.129, 3);
    expect(at(usContinued, 2044).debtRatio).toBeCloseTo(1.259, 3);
    // Interest is above police already and overtakes defence in 2026 on both paths; on the
    // projection it overtakes education in 2049, which the 2024 budget continued never does.
    const rows = interestComparisons(pack, defaults);
    expect(rows.find((row) => row.node === "exp.safety.police")?.without.first).toBe(2024);
    expect(rows.find((row) => row.node === "exp.defence")?.without.first).toBe(2026);
    expect(rows.find((row) => row.node === "exp.education")?.without.first).toBe(2049);
    expect(interestComparisons(pack, continued).find((row) => row.node === "exp.education")?.without.first).toBeNull();
  });
});
