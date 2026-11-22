import { describe, expect, it } from "vitest";
import { testland, testlandFiscal, testlandFiscalFiles, testlandFiles } from "./__fixtures__/testland.ts";
import {
  defaultFollow,
  followablePlans,
  isComparablePlan,
  isComparablePlanIn,
  isFollowablePlanIn,
  projectDebt,
  projectScenario,
  projectionAccounts,
  resolveDebtAssumptions,
} from "./debt.ts";
import { simulate, type Scenario } from "./simulate.ts";
import { measurePhase, shareInYear } from "./timing.ts";
import { formatIssue, validatePack, type ValidationIssue } from "./validate.ts";
import { calendarYears, yearBeginningOn, yearEnd, yearOfDate, yearShort, yearStart } from "./years.ts";

const fiscal = testlandFiscal();
const on = (...ids: string[]): Scenario => ({ policies: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) });

describe("a pack's years", () => {
  it("calendar years: 1 January to 31 December, named by their number", () => {
    expect(calendarYears(testland)).toBe(true);
    expect([yearStart(testland, 2027), yearEnd(testland, 2027)]).toEqual(["2027-01-01", "2027-12-31"]);
    expect(yearOfDate(testland, "2027-12-31")).toBe(2027);
    expect(yearBeginningOn(testland, "2027-01-01")).toBe(2027);
    expect(yearBeginningOn(testland, "2027-07-01")).toBeUndefined();
    expect(yearShort(testland, 2030)).toBeUndefined();
  });

  it("fiscal years from October, named after the year they end in", () => {
    expect(calendarYears(fiscal)).toBe(false);
    expect([yearStart(fiscal, 2024), yearEnd(fiscal, 2024)]).toEqual(["2023-10-01", "2024-09-30"]);
    expect([yearStart(fiscal, 2027), yearEnd(fiscal, 2027)]).toEqual(["2026-10-01", "2027-09-30"]);
    expect(yearOfDate(fiscal, "2026-09-30")).toBe(2026);
    expect(yearOfDate(fiscal, "2026-10-01")).toBe(2027);
    expect(yearOfDate(fiscal, "2027-01-01")).toBe(2027);
    expect(yearBeginningOn(fiscal, "2025-10-01")).toBe(2026);
    expect(yearBeginningOn(fiscal, "2026-01-01")).toBeUndefined();
    // A leap year's last day: FY 2024 ends on 30 September 2024 whatever February had.
    expect(yearEnd(fiscal, 2025)).toBe("2025-09-30");
  });

  it("later years are named after the base year's short name", () => {
    expect(yearShort(fiscal, 2030)).toEqual({ en: "FY 2030", de: "Haushaltsjahr 2030" });
    expect(yearShort(fiscal, 2024)).toEqual(fiscal.country.baseYearShort);
  });

  it("a year named after the year it starts in, from April", () => {
    const april = { country: { baseYear: 2024, baseYearStart: "2024-04-01" } };
    expect([yearStart(april, 2024), yearEnd(april, 2024)]).toEqual(["2024-04-01", "2025-03-31"]);
    expect(yearOfDate(april, "2025-02-01")).toBe(2024);
    expect(yearOfDate(april, "2025-04-01")).toBe(2025);
    // 1 January of the base year is a calendar year.
    expect(calendarYears({ country: { baseYear: 2024, baseYearStart: "2024-01-01" } })).toBe(true);
  });
});

describe("timing in fiscal years", () => {
  it("a measure without timing acts in full from the first day of the first year measures can act", () => {
    expect(measurePhase(fiscal, "halve_mp_pay")).toEqual({
      policy: "halve_mp_pay",
      from: "2025-10-01",
      start: 2026,
      years: 0,
      full: 2026,
      immediate: true,
      yearStart: "2025-10-01",
    });
  });

  it("a start on 1 January falls in the fiscal year that began in October, for the rest of its days", () => {
    const phase = measurePhase(fiscal, "wealth_tax")!;
    expect(phase).toEqual({ policy: "wealth_tax", from: "2026-01-01", start: 2026, years: 0, full: 2027, immediate: false, yearStart: "2025-10-01" });
    expect(shareInYear(phase, 2025)).toBe(0);
    // 1 January to 30 September 2026: 273 of the 365 days of FY 2026.
    expect(shareInYear(phase, 2026)).toBeCloseTo(273 / 365, 12);
    expect(shareInYear(phase, 2027)).toBe(1);
  });

  it("a build-up counts in fiscal years", () => {
    const phase = measurePhase(fiscal, "cut_admin")!;
    expect(phase).toMatchObject({ from: "2025-10-01", start: 2026, years: 4, full: 2030 });
    expect([2025, 2026, 2027, 2028, 2029, 2030].map((year) => shareInYear(phase, year))).toEqual([0, 0.125, 0.375, 0.625, 0.875, 1]);
  });

  it("a calendar-year pack places the same dates as before", () => {
    const calendar = { ...measurePhase(fiscal, "wealth_tax")!, yearStart: undefined };
    // Without the fiscal calendar, 1 January 2026 starts the calendar year 2026 in full.
    expect(shareInYear(calendar, 2026)).toBe(1);
  });
});

describe("accounts of the pack's own", () => {
  const debt = fiscal.debt!;
  const [ministry, centralInterest] = debt.plans!;

  it("the projection's accounts are the pack's, national accounts by default", () => {
    expect(projectionAccounts(debt)).toBe("budget");
    expect(projectionAccounts(testland.debt!)).toBe("national_accounts");
  });

  it("a plan for the whole budget in those accounts can be drawn against it and followed", () => {
    expect(isComparablePlanIn(debt, ministry)).toBe(true);
    expect(isFollowablePlanIn(debt, ministry)).toBe(true);
    expect(isComparablePlanIn(debt, centralInterest)).toBe(false);
    // In national accounts, as for Germany, it would not be.
    expect(isComparablePlanIn(testland.debt!, ministry)).toBe(false);
    expect(isComparablePlan(ministry)).toBe(false);
    expect(followablePlans(debt).map((plan) => plan.id)).toEqual(["ministry_projection"]);
    expect(defaultFollow(debt)).toBe("ministry_projection");
    expect(resolveDebtAssumptions(debt).follow).toBe("ministry_projection");
  });
});

describe("the projection of a one-level, fiscal-year pack", () => {
  it("follows the plan in its own accounts, in fiscal years", () => {
    const projection = projectScenario(fiscal)!;
    expect(projection.followed).toEqual({ plan: "ministry_projection", until: 2026 });
    expect(projection.baseline.start.year).toBe(2024);
    expect(projection.baseline.years.slice(0, 2).map((year) => year.year)).toEqual([2025, 2026]);
    expect(projection.baseline.years[0].debtRatio).toBeCloseTo(0.52, 12);
    expect(projection.baseline.years[1].debtRatio).toBeCloseTo(0.55, 12);
    expect(projection.measuresFrom).toBe(2026);
  });

  it("measures act from the pack's first year, with their share of each fiscal year", () => {
    const projection = projectScenario(fiscal, on("wealth_tax"))!;
    const gap = (i: number) => projection.reform.years[i].primaryBalanceRatio - projection.baseline.years[i].primaryBalanceRatio;
    // FY 2025: before measures can act; FY 2026: 273 of 365 days; FY 2027 on: in full (40, 0.4 % of GDP).
    expect(projection.reform.years[0]).toEqual(projection.baseline.years[0]);
    expect(gap(1)).toBeCloseTo((0.004 * 273) / 365, 12);
    expect(gap(2)).toBeCloseTo(0.004, 12);
    expect(projection.reform.start).toEqual(projection.baseline.start);
    expect(projection.phases).toEqual([measurePhase(fiscal, "wealth_tax")]);
  });

  it("the one level is the whole budget: a scenario filtered to it projects the same", () => {
    const scenario = on("cut_admin", "family_bonus");
    expect(simulate(fiscal, { ...scenario, level: "central" }).reform).toEqual(simulate(fiscal, scenario).reform);
    expect(projectScenario(fiscal, { ...scenario, level: "central" })).toEqual(projectScenario(fiscal, scenario));
    // projectDebt still asks for the unfiltered result, which projectScenario and the interface pass.
    expect(() => projectDebt(fiscal, simulate(fiscal, { ...scenario, level: "central" }))).toThrow(/filtered to level "central"/);
  });
});

describe("following a plan that projects balances but no debt", () => {
  // The ministry's plan with debt in FY 2025, and only a balance and interest in FY 2026, as a
  // budget that projects deficits but not debt.
  const byBalance = (lastToo = true): ReturnType<typeof testlandFiscal> => {
    const pack = testlandFiscal();
    const plan = pack.debt!.plans![0];
    plan.points = [
      { year: 2025, debtRatio: 0.52, balanceRatio: -0.04 },
      lastToo ? { year: 2026, balanceRatio: -0.035, interestRatio: 0.012, growth: 0.04 } : { year: 2026, debtRatio: 0.55, balanceRatio: -0.035, interestRatio: 0.012, growth: 0.04 },
    ];
    return pack;
  };

  it("can be followed where every point without a debt ratio gives a balance and interest", () => {
    const pack = byBalance();
    expect(isFollowablePlanIn(pack.debt!, pack.debt!.plans![0])).toBe(true);
    delete pack.debt!.plans![0].points[1].interestRatio;
    expect(isFollowablePlanIn(pack.debt!, pack.debt!.plans![0])).toBe(false);
  });

  it("takes the plan's primary balance where it gives no debt, and computes interest and debt itself", () => {
    const projection = projectScenario(byBalance())!;
    expect(projection.followed).toEqual({ plan: "ministry_projection", until: 2026, balanceYears: [2026] });
    const [first, second, third] = projection.baseline.years;
    // FY 2025 meets the plan's debt; FY 2026 takes its primary balance, -3.5 % + 1.2 %.
    expect(first.debtRatio).toBeCloseTo(0.52, 12);
    expect(second.primaryBalanceRatio).toBeCloseTo(-0.023, 12);
    expect(second.gdp).toBeCloseTo(first.gdp * 1.04, 9);
    // Interest is the model's, not the plan's 1.2 %, and the debt grows by the deficit alone.
    // A quarter of the debt pays the market rate of 4 %, the rest the rate it carried (fixture).
    expect(second.interest).toBeCloseTo(first.debt * (0.75 * first.averageRate + 0.25 * 0.04), 9);
    expect(second.interestRatio).not.toBeCloseTo(0.012, 4);
    expect(second.debt).toBeCloseTo(first.debt + second.interest - second.primaryBalance, 9);
    // After the plan it holds that primary balance (no drift in the fixture's defaults).
    expect(third.primaryBalanceRatio).toBeCloseTo(-0.023, 12);
  });

  it("measures act on top of the plan's balance as on top of its debt", () => {
    const pack = byBalance();
    const projection = projectScenario(pack, on("wealth_tax"))!;
    const gap = (i: number) => projection.reform.years[i].primaryBalanceRatio - projection.baseline.years[i].primaryBalanceRatio;
    expect(gap(1)).toBeCloseTo((0.004 * 273) / 365, 12);
    expect(gap(2)).toBeCloseTo(0.004, 12);
  });

  it("takes the plan's revenue with its balance where the point gives interest as a share of revenue, and holds it", () => {
    const pack = byBalance();
    // Revenue 1.2 % / 2.5 % = 48 % of GDP in FY 2026, against 40 % in the base year.
    pack.debt!.plans![0].points[1].interestToRevenue = 0.025;
    const projection = projectScenario(pack)!;
    const share = (year: { revenue: number; gdp: number }) => year.revenue / year.gdp;
    const [first, second, third] = projection.baseline.years;
    // FY 2025 meets the plan's debt and keeps the base year's revenue share.
    expect(share(first)).toBeCloseTo(0.4, 12);
    expect(share(second)).toBeCloseTo(0.48, 12);
    expect(second.interestToRevenue).toBeCloseTo(second.interest / second.revenue, 12);
    expect(share(third)).toBeCloseTo(0.48, 12);
    // Revenue moves no debt: the paths are those without the plan's revenue but for revenue.
    const without = projectScenario(byBalance())!;
    expect(projection.baseline.years.map((year) => year.debt)).toEqual(without.baseline.years.map((year) => year.debt));
    // A measure's revenue adds to the plan's: the wealth tax, 0.4 % of GDP, from 1 January 2026.
    const taxed = projectScenario(pack, on("wealth_tax"))!;
    expect(share(taxed.reform.years[0])).toBeCloseTo(0.4, 12);
    expect(share(taxed.reform.years[1])).toBeCloseTo(0.48 + (0.004 * 273) / 365, 12);
    expect(share(taxed.reform.years[2])).toBeCloseTo(0.484, 12);
  });

  it("keeps the base year's revenue share in a year with a debt ratio, and where a point gives no share of revenue", () => {
    const debtYear = byBalance(false);
    debtYear.debt!.plans![0].points[1].interestToRevenue = 0.025;
    for (const year of projectScenario(debtYear)!.baseline.years.slice(0, 3)) expect(year.revenue / year.gdp).toBeCloseTo(0.4, 12);
    for (const year of projectScenario(byBalance())!.baseline.years.slice(0, 3)) expect(year.revenue / year.gdp).toBeCloseTo(0.4, 12);
  });

  it("a plan that gives debt in every year is followed as before, without balance years", () => {
    const projection = projectScenario(byBalance(false))!;
    expect(projection.followed).toEqual({ plan: "ministry_projection", until: 2026 });
    expect(projection).toEqual(projectScenario(testlandFiscal()));
  });
});

describe("validation of fiscal years and accounts", () => {
  type Loose = any;
  const errorsAfter = (mutate: (files: Loose) => void): ValidationIssue[] => {
    const files = testlandFiscalFiles() as Loose;
    mutate(files);
    const result = validatePack(files);
    return result.ok ? [] : result.errors;
  };
  const warningsAfter = (mutate: (files: Loose) => void): ValidationIssue[] => {
    const files = testlandFiscalFiles() as Loose;
    mutate(files);
    return validatePack(files).warnings;
  };
  const only = (mutate: (files: Loose) => void, file: string, path: string, message: RegExp): void => {
    const errors = errorsAfter(mutate);
    expect(errors.map(formatIssue)).toHaveLength(1);
    expect(errors[0]).toEqual({ file, path, message: expect.stringMatching(message) });
  };

  it("the fiscal fixture is valid as it is, without warnings", () => {
    expect(validatePack(testlandFiscalFiles())).toEqual({ ok: true, pack: testlandFiscal(), warnings: [] });
    // The main fixture names neither, and stays as it was.
    expect(testland.country.baseYearStart).toBeUndefined();
    expect(testland.debt?.accounts).toBeUndefined();
    expect(validatePack(testlandFiles())).toMatchObject({ ok: true, warnings: [] });
  });

  it("says whose budget the projection covers in every locale, where it says so (debt.json covers)", () => {
    expect(testlandFiscal().debt?.covers).toEqual({ en: "the central government's budget and its debt", de: "den Haushalt des Zentralstaats und seine Schulden" });
    only((files) => delete files.debt.covers.de, "debt.json", "$.covers", /text for locale "de" is missing/);
    only((files) => (files.debt.covers = "the budget"), "debt.json", "$.covers", /./);
    // Optional: the main fixture, of several levels, has none.
    expect(testland.debt?.covers).toBeUndefined();
    expect(errorsAfter((files) => delete files.debt.covers)).toEqual([]);
  });

  it("the base year's first day lies in the base year or the year before, on a day every year has", () => {
    only((f) => (f.country.baseYearStart = "2022-10-01"), "country.json", "$.baseYearStart", /lies in neither the base year 2024 nor the year before/);
    only((f) => (f.country.baseYearStart = "2023-02-29"), "country.json", "$.baseYearStart", /ISO date/);
    only((f) => (f.country.baseYearStart = "2024-02-29"), "country.json", "$.baseYearStart", /29 February is not a day every year has/);
    expect(warningsAfter((f) => (f.country.baseYearStart = "2024-01-01"))).toEqual([
      { file: "country.json", path: "$.baseYearStart", message: expect.stringMatching(/1 January of the base year is a calendar year/) },
    ]);
  });

  it("a measure's start date counts as in the base year by the pack's years, not by the calendar", () => {
    const wealthTax = (f: Loose) => f.policies.policies.find((policy: Loose) => policy.id === "wealth_tax");
    // 1 October 2024 begins FY 2025, after the base year FY 2024, although it lies in calendar 2024.
    expect(warningsAfter((f) => (wealthTax(f).timing.from = "2024-10-01"))).toEqual([]);
    const i = (testlandFiscalFiles() as Loose).policies.policies.findIndex((policy: Loose) => policy.id === "wealth_tax");
    expect(warningsAfter((f) => (wealthTax(f).timing.from = "2024-09-30"))).toEqual([
      { file: "policies.json", path: `$.policies[${i}].timing.from`, message: expect.stringMatching(/2024-09-30 lies in the base year 2024 or before it/) },
    ]);
  });

  it("warns where later years cannot be named after the base year's short name", () => {
    expect(warningsAfter((f) => (f.country.baseYearShort.en = "this fiscal year"))).toEqual([
      { file: "country.json", path: "$.baseYearShort.en", message: expect.stringMatching(/does not contain the base year 2024/) },
    ]);
  });

  it("the accounts are one of the three, and the starting plan must be in them", () => {
    only((f) => (f.debt.accounts = "accrual"), "debt.json", "$.accounts", /expected one of "national_accounts"\|"cash"\|"budget"/);
    only(
      (f) => (f.debt.plans[0].accounts = "national_accounts"),
      "debt.json",
      "$.follow",
      /in national_accounts accounts; only a plan for the whole budget \("scope": "all"\) in the accounts of the pack's budget \(budget\) can be followed/,
    );
    // Without "accounts" the pack is in national accounts, and the message says how to say otherwise.
    only((f) => delete f.debt.accounts, "debt.json", "$.follow", /a pack whose budget is in other accounts says so in "accounts"/);
  });

  it("a starting plan without a debt ratio in a year needs that year's balance and interest", () => {
    const withoutDebt = (f: Loose) => delete f.debt.plans[0].points[1].debtRatio;
    expect(validatePack(((files: Loose) => (withoutDebt(files), files))(testlandFiscalFiles() as Loose))).toMatchObject({ ok: true, warnings: [] });
    only(
      (f) => (withoutDebt(f), delete f.debt.plans[0].points[1].interestRatio),
      "debt.json",
      "$.follow",
      /cannot be followed: it needs in every point a "debtRatio", or else a "balanceRatio" and an "interestRatio"/,
    );
  });

  it("warns where a plan gives its revenue in some of its years without a debt ratio but not in all", () => {
    const byBalance = (f: Loose) => {
      for (const point of f.debt.plans[0].points) delete point.debtRatio;
      f.debt.plans[0].points[0].interestRatio = 0.01;
    };
    expect(warningsAfter(byBalance)).toEqual([
      { file: "debt.json", path: "$.plans[0].points", message: expect.stringMatching(/gives "interestToRevenue" in some of its years without a debt ratio but not in 2025/) },
    ]);
    expect(warningsAfter((f) => (byBalance(f), (f.debt.plans[0].points[0].interestToRevenue = 0.03)))).toEqual([]);
  });

  it("a minimal debt.json: no presets, references, comparisons, plans, first year or starting plan", () => {
    const files = testlandFiscalFiles() as Loose;
    for (const key of ["presets", "references", "comparisons", "plans", "measuresFrom", "follow"]) delete files.debt[key];
    for (const policy of files.policies.policies) delete policy.timing;
    const result = validatePack(files);
    expect(result).toMatchObject({ ok: true, warnings: [] });
    if (!result.ok) return;
    expect(result.pack.debt?.presets).toEqual([]);
    expect(result.pack.debt?.references).toEqual([]);
    const projection = projectScenario(result.pack, on("cut_admin"))!;
    expect(projection.followed).toBeUndefined();
    expect(projection.measuresFrom).toBe(2025);
    expect(projection.reform.years[0].primaryBalanceRatio - projection.baseline.years[0].primaryBalanceRatio).toBeCloseTo(0.004, 12);
  });

  it("in a pack with one level, a plan for that level in the budget's accounts should say it covers the whole budget", () => {
    expect(warningsAfter((f) => (f.debt.plans[1].accounts = "budget"))).toEqual([
      { file: "debt.json", path: "$.plans[1].scope", message: expect.stringMatching(/"central" is the pack's only level, so the plan covers its whole budget: give "scope": "all"/) },
    ]);
  });
});
