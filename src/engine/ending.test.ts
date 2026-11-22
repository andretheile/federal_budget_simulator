import { describe, expect, it } from "vitest";
import { testland, testlandCopy, testlandEnding, testlandEndingFiles, testlandFiscal } from "./__fixtures__/testland.ts";
import { projectScenario, type DebtProjection } from "./debt.ts";
import { goalProgress } from "./goals.ts";
import { simulate, type Scenario } from "./simulate.ts";
import { measurePhase, shareInYear } from "./timing.ts";
import type { CountryPack } from "./types.ts";
import { formatIssue, validatePack, type ValidationIssue } from "./validate.ts";

const ending = testlandEnding();
const on = (...ids: string[]): Scenario => ({ policies: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) });
/** reform minus baseline of one figure, by projection year (index 0 is the first year after the base year). */
const gap = (projection: DebtProjection, key: "primaryBalanceRatio" | "revenue" | "debt", path: "reform" | "reformLow" | "reformHigh" = "reform") => (i: number) =>
  projection[path].years[i][key] - projection.baseline.years[i][key];

describe("the phase of a measure that ends", () => {
  it("a one-off: one year, the year of its date, in full", () => {
    expect(measurePhase(ending, "family_bonus")).toEqual({
      policy: "family_bonus",
      from: "2027-07-01",
      start: 2027,
      years: 0,
      full: 2027,
      immediate: false,
      last: 2027,
      once: true,
    });
    const phase = measurePhase(ending, "family_bonus")!;
    expect([2026, 2027, 2028].map((year) => shareInYear(phase, year))).toEqual([0, 1, 0]);
  });

  it("a measure that lasts: from its start for whole years, in full, and then not at all", () => {
    const phase = measurePhase(ending, "raise_top_tax_rate")!;
    expect(phase).toEqual({ policy: "raise_top_tax_rate", from: "2026-07-01", start: 2026, years: 0, full: 2027, immediate: false, last: 2030, to: "2030-06-30" });
    const shares = [2025, 2026, 2027, 2028, 2029, 2030, 2031].map((year) => shareInYear(phase, year));
    expect(shares[0]).toBe(0);
    expect(shares[1]).toBeCloseTo(184 / 365, 12);
    expect(shares.slice(2, 5)).toEqual([1, 1, 1]);
    expect(shares[5]).toBeCloseTo(181 / 365, 12);
    expect(shares[6]).toBe(0);
  });

  it("an end counts from the start in the projection: a date before the first year measures can act moves it", () => {
    const pack = testlandEnding();
    pack.policies.find((policy) => policy.id === "raise_top_tax_rate")!.timing!.from = "2020-01-01";
    expect(measurePhase(pack, "raise_top_tax_rate")).toMatchObject({ from: "2026-01-01", start: 2026, last: 2029, to: "2029-12-31" });
    pack.policies.find((policy) => policy.id === "family_bonus")!.timing!.from = undefined;
    expect(measurePhase(pack, "family_bonus")).toMatchObject({ from: "2026-01-01", start: 2026, last: 2026, once: true });
  });

  it("below the baseline a phase of its own: here a one-off, above it for good", () => {
    expect(measurePhase(ending, "defense_target", { share: 1.5 })).toMatchObject({ from: "2026-01-01", start: 2026, last: 2026, once: true, immediate: false });
    const above = measurePhase(ending, "defense_target", { share: 4 })!;
    expect(above).toMatchObject({ from: "2027-07-01", start: 2027, years: 0 });
    expect(above.last).toBeUndefined();
  });

  it("in fiscal years: a one-off falls in full into the year of its date, a measure that lasts counts days", () => {
    const pack = testlandFiscal();
    const bonus = pack.policies.find((policy) => policy.id === "family_bonus")!;
    bonus.timing = { from: "2026-01-01", once: true, note: { en: "-", de: "-" }, sources: ["finance_ministry"] };
    const once = measurePhase(pack, "family_bonus")!;
    // 1 January 2026 lies in FY 2026 (October 2025 to September 2026).
    expect(once).toMatchObject({ from: "2026-01-01", start: 2026, last: 2026, once: true, yearStart: "2025-10-01" });
    expect([2025, 2026, 2027].map((year) => shareInYear(once, year))).toEqual([0, 1, 0]);
    bonus.timing = { from: "2026-01-01", lasts: 2, note: { en: "-", de: "-" }, sources: ["finance_ministry"] };
    const lasts = measurePhase(pack, "family_bonus")!;
    // To 31 December 2027, which lies in FY 2028 (October 2027 to September 2028, with 29 February).
    expect(lasts).toMatchObject({ start: 2026, last: 2028, to: "2027-12-31" });
    expect(shareInYear(lasts, 2026)).toBeCloseTo(273 / 365, 12);
    expect(shareInYear(lasts, 2027)).toBe(1);
    expect(shareInYear(lasts, 2028)).toBeCloseTo(92 / 366, 12);
    expect(shareInYear(lasts, 2029)).toBe(0);
  });

  it("a measure without an end has none of the new fields", () => {
    const phase = measurePhase(testlandFiscal(), "wealth_tax")!;
    expect(Object.keys(phase)).toEqual(["policy", "from", "start", "years", "full", "immediate", "yearStart"]);
  });
});

describe("the paths with a measure that ends", () => {
  it("a one-off changes the primary balance in its year only; the debt it added stays, with its interest", () => {
    const projection = projectScenario(ending, on("family_bonus"))!;
    const primary = gap(projection, "primaryBalanceRatio");
    const debt = gap(projection, "debt");
    // 2025 and 2026: nothing; 2027: the 100 of the bonus, 1 % of GDP as it is a share of base-year GDP; then nothing.
    expect([0, 1, 3, 10].map(primary)).toEqual([0, 0, 0, 0]);
    expect(primary(2)).toBeCloseTo(-0.01, 12);
    expect(debt(1)).toBe(0);
    expect(debt(2)).toBeGreaterThan(0);
    // The extra debt carries the market rate of 4 % from then on and is never repaid.
    expect(debt(3)).toBeCloseTo(debt(2) * 1.04, 6);
    expect(debt(10)).toBeCloseTo(debt(2) * 1.04 ** 8, 4);
    // The low and high end end too.
    expect(gap(projection, "primaryBalanceRatio", "reformLow")(3)).toBe(0);
    expect(gap(projection, "primaryBalanceRatio", "reformHigh")(3)).toBe(0);
  });

  it("a measure that lasts changes balance and revenue while it acts, and nothing afterwards", () => {
    const projection = projectScenario(ending, on("raise_top_tax_rate"))!;
    const revenue = gap(projection, "revenue");
    const share = (i: number) => revenue(i) / (125 * (projection.reform.years[i].gdp / 10000));
    expect(share(0)).toBe(0);
    expect(share(1)).toBeCloseTo(184 / 365, 9);
    expect([2, 3, 4].map(share).map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 1, 1]);
    expect(share(5)).toBeCloseTo(181 / 365, 9);
    expect([6, 7, 20].map(revenue)).toEqual([0, 0, 0]);
    expect(gap(projection, "primaryBalanceRatio")(6)).toBe(0);
    // What it repaid stays repaid.
    expect(gap(projection, "debt")(20)).toBeLessThan(0);
  });

  it("is not taken for a measure in full from the first year: a one-off without a date acts in year 1 only", () => {
    const pack = testlandCopy();
    pack.policies.find((policy) => policy.id === "family_bonus")!.timing = { once: true, note: { en: "-", de: "-" }, sources: ["finance_ministry"] };
    const projection = projectScenario(pack, on("family_bonus"))!;
    expect(projection.phases[0]).toMatchObject({ start: 2025, last: 2025, immediate: false });
    expect(gap(projection, "primaryBalanceRatio")(0)).toBeCloseTo(-0.01, 12);
    expect(gap(projection, "primaryBalanceRatio")(1)).toBe(0);
  });

  it("the long run holds the balance without a measure that has ended, also on a followed plan", () => {
    // A market rate below growth: the debt ratio settles where the primary balance it holds leads.
    const assumptions = { market_rate: 2, growth: 4 };
    for (const follow of [null, "ministry_projection"]) {
      const alone = projectScenario(ending, on("family_bonus"), { ...assumptions, follow })!;
      expect(alone.reform.longRun).toEqual(alone.baseline.longRun);
      // With a measure for good beside it, the long run is that of the one for good alone.
      const both = projectScenario(ending, on("family_bonus", "cut_admin"), { ...assumptions, follow })!;
      const lasting = projectScenario(ending, on("cut_admin"), { ...assumptions, follow })!;
      expect(both.reform.longRun).toEqual(lasting.reform.longRun);
      expect(both.reformLow.longRun).toEqual(lasting.reformLow.longRun);
    }
  });

  it("on a followed plan a one-off moves the path off the plan for good by the debt it added", () => {
    const projection = projectScenario(ending, on("family_bonus"), { follow: "ministry_projection" })!;
    expect(projection.followed).toEqual({ plan: "ministry_projection", until: 2026 });
    expect(gap(projection, "primaryBalanceRatio")(2)).toBeCloseTo(-0.01, 12);
    expect(gap(projection, "primaryBalanceRatio")(3)).toBe(0);
    expect(gap(projection, "debt")(5)).toBeGreaterThan(0);
  });
});

describe("what does not change with an end", () => {
  const plain = (pack: CountryPack) => pack.policies.map((policy) => ({ ...policy, timing: undefined }));

  it("the figure on the card and the scoreboard: the effect of a year in which the measure acts", () => {
    const withoutTiming = { ...ending, policies: plain(ending) };
    const scenario = on("family_bonus", "raise_top_tax_rate", "defense_target");
    expect(simulate(ending, scenario)).toEqual(simulate(withoutTiming, scenario));
  });

  it("goals, which compare the static effect with the goal's amount whatever the year", () => {
    const withoutTiming = { ...ending, policies: plain(ending) };
    for (const goal of testland.goals!.goals) {
      expect(goalProgress(ending, on("family_bonus", "raise_top_tax_rate"), goal)).toEqual(goalProgress(withoutTiming, on("family_bonus", "raise_top_tax_rate"), goal));
    }
  });
});

describe("validation of an end", () => {
  type Loose = any;
  const files = (mutate?: (files: Loose) => void) => {
    const raw = testlandEndingFiles() as Loose;
    mutate?.(raw);
    return raw;
  };
  const policyAt = (f: Loose, id: string) => f.policies.policies.find((policy: Loose) => policy.id === id);
  const index = (id: string) => (testlandEndingFiles() as Loose).policies.policies.findIndex((policy: Loose) => policy.id === id);
  const only = (mutate: (files: Loose) => void, path: string, message: RegExp): void => {
    const result = validatePack(files(mutate));
    const errors: ValidationIssue[] = result.ok ? [] : result.errors;
    expect(errors.map(formatIssue)).toHaveLength(1);
    expect(errors[0]).toEqual({ file: "policies.json", path, message: expect.stringMatching(message) });
  };

  it("the fixture is valid, without warnings", () => {
    expect(validatePack(testlandEndingFiles())).toEqual({ ok: true, pack: testlandEnding(), warnings: [] });
  });

  it("an end without a date or build-up is timing enough: no warning", () => {
    expect(validatePack(files((f) => delete policyAt(f, "family_bonus").timing.from))).toMatchObject({ ok: true, warnings: [] });
  });

  it("rejects both ends, an end with a build-up, and an end that is not whole years", () => {
    const bonus = `$.policies[${index("family_bonus")}].timing`;
    const tax = `$.policies[${index("raise_top_tax_rate")}].timing`;
    const defense = `$.policies[${index("defense_target")}].timing`;
    only((f) => (policyAt(f, "family_bonus").timing.lasts = 2), `${bonus}.lasts`, /a one-off \("once"\) counts in one year: leave out "lasts"/);
    only((f) => (policyAt(f, "family_bonus").timing.years = 2), `${bonus}.years`, /a measure that ends \("once"\) acts in full from its start: leave out "years" and "yearsPerUnit", or the end/);
    only((f) => (policyAt(f, "defense_target").timing.below.yearsPerUnit = 1), `${defense}.below.yearsPerUnit`, /a measure that ends \("once"\)/);
    only((f) => (policyAt(f, "raise_top_tax_rate").timing.years = 1), `${tax}.years`, /a measure that ends \("lasts"\)/);
    only((f) => (policyAt(f, "raise_top_tax_rate").timing.lasts = 2.5), `${tax}.lasts`, /must be a whole number of years/);
    only((f) => (policyAt(f, "raise_top_tax_rate").timing.lasts = 0), `${tax}.lasts`, /must be at least 1 year/);
    only((f) => (policyAt(f, "family_bonus").timing.once = false), `${bonus}.once`, /is true for a one-off/);
  });
});
