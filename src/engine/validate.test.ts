import { describe, expect, it } from "vitest";
import { testland, testlandFiles } from "./__fixtures__/testland.ts";
import { formatIssue, formatPath, validatePack, validatePackFiles, type ValidationIssue } from "./validate.ts";

/**
 * The raw files of Testland, loosely typed so a test can break them in any way.
 *
 * Where things are:
 *   budget.revenue      [0] rev.taxes (income, vat, wealth)  [1] rev.social_contributions  [2] rev.other
 *   budget.expenditure  [0] exp.social (pensions, basic_income, family)  [1] health  [2] education
 *                       [3] defense  [4] exp.admin (parliament, other)  [5] interest
 *   policies            [0] halve_mp_pay  [1] cut_admin  [2] no_basic_income_non_citizens  [3] wealth_tax
 *                       [4] raise_top_tax_rate  [5] defense_target  [6] family_bonus
 *                       [7] cut_pensions (scale on exp.social.pensions with a shift to exp.social.basic_income)
 */
type Loose = any;
interface Files {
  id?: string;
  country: Loose;
  budget: Loose;
  policies: { policies: Loose[] };
  sources: Loose;
  distributions: Record<string, Loose>;
}

function errorsAfter(mutate: (files: Files) => void): ValidationIssue[] {
  const files = testlandFiles() as Files;
  mutate(files);
  const result = validatePack(files);
  return result.ok ? [] : result.errors;
}

function warningsAfter(mutate: (files: Files) => void): ValidationIssue[] {
  const files = testlandFiles() as Files;
  mutate(files);
  return validatePack(files).warnings;
}

/** The change must produce exactly this one error: nothing missed, no follow-up errors. */
function expectOnly(mutate: (files: Files) => void, file: string, path: string, message: RegExp): void {
  const errors = errorsAfter(mutate);
  expect(errors.map(formatIssue)).toHaveLength(1);
  expect(errors[0]).toEqual({ file, path, message: expect.stringMatching(message) });
}

/** The change must produce this error, possibly among others. */
function expectError(mutate: (files: Files) => void, file: string, path: string, message: RegExp): void {
  expect(errorsAfter(mutate)).toContainEqual({ file, path, message: expect.stringMatching(message) });
}

const basicIncome = (f: Files): Loose => f.budget.expenditure[0].children[1];
const citizenship = (f: Files): Loose => basicIncome(f).breakdowns.citizenship;

describe("a valid pack", () => {
  it("is returned typed, without errors or warnings", () => {
    const result = validatePack(testlandFiles());
    expect(result).toEqual({ ok: true, pack: testland, warnings: [] });
  });

  it("does not need distributions, policies or optional fields", () => {
    const files = testlandFiles() as Files;
    files.policies.policies = [];
    files.distributions = {};
    delete files.country.methodology;
    delete files.country.indicators.households;
    delete files.country.indicators.grossDebt;
    files.sources = { finance_ministry: files.sources.finance_ministry, stats_office: files.sources.stats_office };
    const result = validatePack(files);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("accepts shares that miss 1 by no more than the tolerance", () => {
    const files = testlandFiles() as Files;
    files.budget.revenue[1].levels = { central: 0.4995, social_security: 0.4995 };
    citizenship(files).groups[0].share = 0.601;
    expect(validatePack(files).ok).toBe(true);
  });
});

describe("shape of the files", () => {
  it("a missing file", () => {
    expectOnly((f) => delete f.budget, "budget.json", "$", /file is missing/);
    expectOnly((f) => delete (f as Loose).sources, "sources.json", "$", /file is missing/);
    expectOnly((f) => delete (f as Loose).country, "country.json", "$", /file is missing/);
    expectOnly((f) => delete (f as Loose).policies, "policies.json", "$", /file is missing/);
  });

  it("a missing required field", () => {
    expectOnly((f) => delete f.budget.revenue[1].amount, "budget.json", "$.revenue[1].amount", /expected number/);
    expectOnly((f) => delete f.country.indicators.gdp, "country.json", "$.indicators.gdp", /expected object/);
    expectOnly((f) => delete f.policies.policies[0].catches, "policies.json", "$.policies[0].catches", /expected array/);
    expectOnly((f) => delete f.sources.stats_office.publisher, "sources.json", "$.stats_office.publisher", /expected string/);
    expectOnly((f) => delete f.distributions.income.year, "distributions/income.json", "$.year", /expected number/);
  });

  it("a value of the wrong type", () => {
    expectOnly((f) => (f.country.baseYear = "2024"), "country.json", "$.baseYear", /expected number, received string/);
    expectOnly((f) => (f.budget.revenue[1].amount = null), "budget.json", "$.revenue[1].amount", /expected number/);
    expectOnly((f) => ((f.policies as Loose).policies = {}), "policies.json", "$.policies", /expected array/);
  });

  it("an unknown key, which is how a misspelt optional field shows up", () => {
    expectOnly((f) => (f.policies.policies[3].effects[0].yeild = 0.5), "policies.json", "$.policies[3].effects[0]", /Unrecognized key: "yeild"/);
    expectOnly((f) => (f.budget.revenue[0].children[0].nota = { en: "x", de: "x" }), "budget.json", "$.revenue[0].children[0]", /Unrecognized key: "nota"/);
    expectOnly((f) => (f.country.capital = "Testville"), "country.json", "$", /Unrecognized key: "capital"/);
    expectOnly((f) => (f.budget.revenue[1].levels = { federal: 1 }), "budget.json", "$.revenue[1].levels", /Unrecognized key: "federal"/);
  });

  it("a value outside its enumeration", () => {
    expectOnly((f) => (f.budget.revenue[1].quality = "guess"), "budget.json", "$.revenue[1].quality", /official/);
    expectOnly((f) => (f.policies.policies[0].topic = "sports"), "policies.json", "$.policies[0].topic", /migration/);
    expectOnly((f) => (f.policies.policies[0].effects[0].type = "multiply"), "policies.json", "$.policies[0].effects[0].type", /scale/);
    expectOnly((f) => (f.policies.policies[2].catches[0].severity = "fatal"), "policies.json", "$.policies[2].catches[0].severity", /blocker/);
    expectOnly((f) => (f.policies.policies[1].params[0].unit = "euros"), "policies.json", "$.policies[1].params[0].unit", /percent/);
  });

  it("numbers out of range", () => {
    expectOnly((f) => (f.budget.revenue[1].amount = -1), "budget.json", "$.revenue[1].amount", />=0/);
    expectOnly((f) => (f.budget.revenue[1].levels = { social_security: 1.5 }), "budget.json", "$.revenue[1].levels.social_security", /<=1/);
    expectOnly((f) => (f.distributions.wealth.tail.alpha = 1), "distributions/wealth.json", "$.tail.alpha", />1/);
    expectOnly((f) => (f.distributions.income.bins[0].count = -3), "distributions/income.json", "$.bins[0].count", />=0/);
    expectOnly((f) => (f.policies.policies[1].params[0].step = 0), "policies.json", "$.policies[1].params[0].step", />0/);
    expectOnly((f) => (f.country.indicators.gdp.value = 0), "country.json", "$.indicators.gdp.value", />0/);
  });

  it("empty lists where at least one entry is required", () => {
    expectOnly((f) => (f.budget.expenditure[4].children = []), "budget.json", "$.expenditure[4].children", />=1/);
    expectOnly((f) => (f.budget.revenue[1].sources = []), "budget.json", "$.revenue[1].sources", />=1/);
    expectOnly((f) => (f.policies.policies[0].effects = []), "policies.json", "$.policies[0].effects", />=1/);
    expectOnly((f) => (f.country.locales = []), "country.json", "$.locales", />=1/);
  });

  it("malformed ids, codes and dates", () => {
    expectOnly((f) => (f.policies.policies[0].id = "Halve-MP-Pay"), "policies.json", "$.policies[0].id", /lower_snake_case/);
    expectOnly((f) => (f.budget.revenue[2].id = "rev.Other"), "budget.json", "$.revenue[2].id", /dotted path/);
    expectOnly((f) => (f.budget.revenue[2].id = "other"), "budget.json", "$.revenue[2].id", /dotted path/);
    expectOnly((f) => (f.country.currency = "eur"), "country.json", "$.currency", /ISO 4217/);
    expectOnly((f) => (f.sources.stats_office.accessed = "15.01.2025"), "sources.json", "$.stats_office.accessed", /ISO date/);
    expectError((f) => (f.country.id = "XXX"), "country.json", "$.id", /ISO 3166/);
  });

  it("a text without English", () => {
    expectOnly((f) => (f.budget.revenue[1].label = { de: "Sozialbeiträge" }), "budget.json", "$.revenue[1].label.en", /expected string/);
    expectOnly((f) => (f.country.name.en = ""), "country.json", "$.name.en", />=1 characters/);
  });

  it("a value that is neither a number nor a param reference", () => {
    expectOnly((f) => (f.policies.policies[0].effects[0].factor = "half"), "policies.json", "$.policies[0].effects[0].factor", /expected number or object/);
    // The variant that was meant is reported, not "does not match any variant".
    expectOnly(
      (f) => (f.policies.policies[1].effects[0].factor = { param: "cut", scael: -0.01 }),
      "policies.json",
      "$.policies[1].effects[0].factor",
      /Unrecognized key: "scael"/,
    );
    expectOnly((f) => (f.policies.policies[2].effects[0].groups = "non_eu"), "policies.json", "$.policies[2].effects[0].groups", /expected array or object/);
  });

  it("does not bury one broken file under follow-up errors in the others", () => {
    // Without country.json the locales and levels are unknown; budget and policies are not blamed for that.
    expectOnly((f) => (f.country.locales = "en"), "country.json", "$.locales", /expected array/);
    // Without budget.json no policy target can be resolved; that is not reported once per effect.
    expectOnly((f) => (f.budget.revenue = 5), "budget.json", "$.revenue", /expected array/);
    // Without sources.json no source reference can be resolved.
    expectOnly((f) => (f.sources.stats_office.url = 7), "sources.json", "$.stats_office.url", /expected string/);
    // A distribution that fails its shape check is not also reported as an unknown reference.
    expectOnly((f) => (f.distributions.wealth.bins = []), "distributions/wealth.json", "$.bins", />=1/);
  });
});

describe("ids", () => {
  it("duplicate node id, anywhere in the budget", () => {
    expectOnly((f) => (f.budget.revenue[2].id = "rev.social_contributions"), "budget.json", "$.revenue[2].id", /duplicate node id "rev.social_contributions"/);
    expectOnly((f) => (f.budget.expenditure[2].id = "exp.health"), "budget.json", "$.expenditure[2].id", /duplicate node id "exp.health"/);
  });

  it("node id with the prefix of the other side", () => {
    expectOnly((f) => (f.budget.revenue[2].id = "exp.other"), "budget.json", "$.revenue[2].id", /must start with "rev\."/);
    expectOnly((f) => (f.budget.expenditure[5].id = "rev.interest"), "budget.json", "$.expenditure[5].id", /must start with "exp\."/);
  });

  it("duplicate policy id", () => {
    expectOnly((f) => (f.policies.policies[1].id = "halve_mp_pay"), "policies.json", "$.policies[1].id", /duplicate policy id "halve_mp_pay"/);
  });

  it("duplicate param id within a policy", () => {
    expectError((f) => (f.policies.policies[3].params[1].id = "rate"), "policies.json", "$.policies[3].params[1].id", /duplicate param id "rate"/);
    // The same id in two different policies is fine.
    const files = testlandFiles() as Files;
    files.policies.policies[1].params[0].id = "rate";
    files.policies.policies[1].effects[0].factor.param = "rate";
    expect(validatePack(files).ok).toBe(true);
  });

  it("duplicate group id within a breakdown", () => {
    expectError((f) => (citizenship(f).groups[1].id = "citizens"), "budget.json", "$.expenditure[0].children[1].breakdowns.citizenship.groups[1].id", /duplicate group id "citizens"/);
  });

  it("country id that differs from the directory name", () => {
    expectOnly((f) => (f.id = "yy"), "country.json", "$.id", /is "xx" but the pack directory is "yy"/);
  });

  it("distribution id that differs from the file name", () => {
    expectOnly((f) => (f.distributions.income.id = "incomes"), "distributions/income.json", "$.id", /is "incomes" but the file is named "income.json"/);
  });
});

describe("shares", () => {
  it("level shares that do not sum to 1", () => {
    expectOnly((f) => (f.budget.revenue[1].levels = { social_security: 0.9 }), "budget.json", "$.revenue[1].levels", /shares sum to 0.9, expected 1/);
    expectOnly((f) => (f.budget.revenue[0].children[0].levels = { central: 0.5, state: 0.502 }), "budget.json", "$.revenue[0].children[0].levels", /shares sum to 1.002/);
    expectOnly((f) => (f.budget.revenue[1].levels = {}), "budget.json", "$.revenue[1].levels", /shares sum to 0/);
  });

  it("breakdown shares that do not sum to 1", () => {
    expectOnly((f) => (citizenship(f).groups[0].share = 0.5), "budget.json", "$.expenditure[0].children[1].breakdowns.citizenship.groups", /shares sum to 0.9, expected 1/);
  });

  it("a level the country does not have", () => {
    expectOnly((f) => (f.budget.revenue[1].levels = { local: 1 }), "budget.json", "$.revenue[1].levels.local", /level "local" is not defined in country.json/);
    expectError((f) => delete f.country.levels.state, "budget.json", "$.revenue[0].children[0].levels.state", /level "state" is not defined/);
    expectError((f) => (f.country.levels = {}), "country.json", "$.levels", /at least one level/);
  });
});

describe("locales", () => {
  it("every text needs every locale of the country", () => {
    const cases: [string, string, (f: Files) => Loose][] = [
      ["country.json", "$.name", (f) => f.country.name],
      ["country.json", "$.methodology", (f) => f.country.methodology],
      ["country.json", "$.levels.state.name", (f) => f.country.levels.state.name],
      ["budget.json", "$.revenue[0].label", (f) => f.budget.revenue[0].label],
      ["budget.json", "$.revenue[0].description", (f) => f.budget.revenue[0].description],
      ["budget.json", "$.revenue[0].children[2].note", (f) => f.budget.revenue[0].children[2].note],
      ["budget.json", "$.expenditure[0].children[1].breakdowns.citizenship.label", (f) => citizenship(f).label],
      ["budget.json", "$.expenditure[0].children[1].breakdowns.citizenship.note", (f) => citizenship(f).note],
      ["budget.json", "$.expenditure[0].children[1].breakdowns.citizenship.groups[2].label", (f) => citizenship(f).groups[2].label],
      ["distributions/wealth.json", "$.label", (f) => f.distributions.wealth.label],
      ["distributions/wealth.json", "$.variable", (f) => f.distributions.wealth.variable],
      ["distributions/wealth.json", "$.unit", (f) => f.distributions.wealth.unit],
      ["distributions/wealth.json", "$.note", (f) => f.distributions.wealth.note],
      ["policies.json", "$.policies[2].label", (f) => f.policies.policies[2].label],
      ["policies.json", "$.policies[2].summary", (f) => f.policies.policies[2].summary],
      ["policies.json", "$.policies[2].params[0].label", (f) => f.policies.policies[2].params[0].label],
      ["policies.json", "$.policies[2].effects[0].note", (f) => f.policies.policies[2].effects[0].note],
      ["policies.json", "$.policies[2].catches[1].text", (f) => f.policies.policies[2].catches[1].text],
    ];
    for (const [file, path, pick] of cases) {
      expectOnly((f) => delete pick(f).de, file, path, /text for locale "de" is missing/);
    }
  });

  it("a new locale in country.json makes every text incomplete", () => {
    const errors = errorsAfter((f) => f.country.locales.push("fr"));
    expect(errors.length).toBeGreaterThan(50);
    expect(errors.every((e) => /locale "fr"/.test(e.message))).toBe(true);
  });

  it("extra translations and duplicate locales", () => {
    const files = testlandFiles() as Files;
    files.country.name.fr = "Testlande";
    expect(validatePack(files).ok).toBe(true);
    expectOnly((f) => f.country.locales.push("en"), "country.json", "$.locales[2]", /duplicate locale "en"/);
  });
});

describe("references", () => {
  it("unknown source, wherever sources are cited", () => {
    const cases: [string, string, (f: Files) => Loose][] = [
      ["country.json", "$.indicators.gdp.sources[0]", (f) => f.country.indicators.gdp],
      ["country.json", "$.indicators.grossDebt.sources[0]", (f) => f.country.indicators.grossDebt],
      ["budget.json", "$.revenue[1].sources[0]", (f) => f.budget.revenue[1]],
      ["budget.json", "$.expenditure[0].children[1].breakdowns.citizenship.sources[0]", (f) => citizenship(f)],
      ["distributions/income.json", "$.sources[0]", (f) => f.distributions.income],
      ["policies.json", "$.policies[3].sources[0]", (f) => f.policies.policies[3]],
      ["policies.json", "$.policies[2].effects[0].sources[0]", (f) => f.policies.policies[2].effects[0]],
      ["policies.json", "$.policies[2].catches[0].sources[0]", (f) => f.policies.policies[2].catches[0]],
    ];
    for (const [file, path, pick] of cases) {
      expectOnly((f) => (pick(f).sources = ["nowhere"]), file, path, /unknown source "nowhere"/);
    }
  });

  it("unknown budget node", () => {
    expectOnly((f) => (f.policies.policies[0].effects[0].target = "exp.admin.palace"), "policies.json", "$.policies[0].effects[0].target", /unknown budget node "exp.admin.palace"/);
    expectOnly((f) => (f.policies.policies[2].params[0].node = "exp.social.nothing"), "policies.json", "$.policies[2].params[0].node", /unknown budget node "exp.social.nothing"/);
  });

  it("unknown breakdown", () => {
    expectOnly((f) => (f.policies.policies[2].effects[0].breakdown = "age"), "policies.json", "$.policies[2].effects[0].breakdown", /node "exp.social.basic_income" has no breakdown "age"/);
    expectOnly((f) => (f.policies.policies[2].params[0].breakdown = "age"), "policies.json", "$.policies[2].params[0].breakdown", /has no breakdown "age"/);
    // A groups param must point at a node that has the breakdown, not just at any node.
    expectOnly((f) => (f.policies.policies[2].params[0].node = "exp.health"), "policies.json", "$.policies[2].params[0].breakdown", /node "exp.health" has no breakdown "citizenship"/);
  });

  it("unknown group id", () => {
    expectOnly((f) => (f.policies.policies[2].effects[0].groups = ["non_eu", "martians"]), "policies.json", "$.policies[2].effects[0].groups[1]", /unknown group "martians"/);
    expectOnly((f) => (f.policies.policies[2].params[0].default = ["martians"]), "policies.json", "$.policies[2].params[0].default[0]", /unknown group "martians"/);
    expectOnly((f) => (f.policies.policies[2].params[0].default = ["eu", "eu"]), "policies.json", "$.policies[2].params[0].default[1]", /duplicate group "eu"/);
  });

  it("unknown distribution", () => {
    expectOnly((f) => (f.policies.policies[3].effects[0].distribution = "inheritances"), "policies.json", "$.policies[3].effects[0].distribution", /unknown distribution "inheritances"/);
    expectError((f) => delete f.distributions.income, "policies.json", "$.policies[4].effects[0].distribution", /unknown distribution "income"/);
  });

  it("unknown param", () => {
    expectError((f) => (f.policies.policies[1].effects[0].factor.param = "cutt"), "policies.json", "$.policies[1].effects[0].factor.param", /unknown param "cutt" in policy "cut_admin"/);
    expectError((f) => (f.policies.policies[3].effects[0].reform.brackets[0].rate.param = "ratio"), "policies.json", "$.policies[3].effects[0].reform.brackets[0].rate.param", /unknown param "ratio"/);
    expectError((f) => (f.policies.policies[3].effects[0].yield = { param: "leakage" }), "policies.json", "$.policies[3].effects[0].yield.param", /unknown param "leakage"/);
    expectError((f) => (f.policies.policies[2].effects[0].groups.param = "who"), "policies.json", "$.policies[2].effects[0].groups.param", /unknown param "who"/);
    expectError((f) => (f.policies.policies[2].effects[0].retained = { param: "kept" }), "policies.json", "$.policies[2].effects[0].retained.param", /unknown param "kept"/);
  });

  it("a param of the wrong type", () => {
    expectOnly((f) => (f.policies.policies[2].effects[1].amount = { param: "groups" }), "policies.json", "$.policies[2].effects[1].amount.param", /"groups" is a groups param; a number param is needed/);
    expectOnly(
      (f) => {
        f.policies.policies[3].effects.push({ type: "excludeGroups", target: "exp.social.basic_income", breakdown: "citizenship", groups: { param: "rate" }, quality: "estimate" });
      },
      "policies.json",
      "$.policies[3].effects[1].groups.param",
      /"rate" is a number param; a groups param is needed/,
    );
  });

  it("a groups param whose groups do not exist in the breakdown the effect reads", () => {
    // A second breakdown on another node, with other group ids.
    const addAges = (f: Files, ids: string[]): void => {
      f.budget.expenditure[1].breakdowns = {
        age: {
          label: { en: "By age", de: "Nach Alter" },
          basis: "recipients",
          groups: ids.map((id) => ({ id, label: { en: id, de: id }, share: 1 / ids.length })),
          quality: "estimate",
          sources: [],
        },
      };
      f.policies.policies[2].effects.push({ type: "excludeGroups", target: "exp.health", breakdown: "age", groups: { param: "groups" }, quality: "estimate" });
    };
    expectOnly((f) => addAges(f, ["young", "old"]), "policies.json", "$.policies[2].effects[2].groups.param", /none of the groups offered by param "groups" exist in breakdown "age" of "exp.health"/);

    // If only some are missing the pack is valid, with a warning.
    const files = testlandFiles() as Files;
    addAges(files, ["citizens", "eu"]);
    const result = validatePack(files);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      { file: "policies.json", path: "$.policies[2].effects[2].groups.param", message: expect.stringMatching(/group\(s\) non_eu offered by param "groups" do not exist/) },
    ]);
  });

  it("`times: households` without a households indicator", () => {
    expectOnly((f) => delete f.country.indicators.households, "policies.json", "$.policies[6].effects[0].amount.times", /no "households" indicator/);
  });
});

describe("distributions", () => {
  it("bins that are not contiguous", () => {
    expectOnly((f) => (f.distributions.income.bins[1].from = 11), "distributions/income.json", "$.bins[1].from", /11 does not continue the previous bin, which ends at 10/);
  });

  it("a mean outside its bin", () => {
    expectOnly((f) => (f.distributions.income.bins[1].mean = 31), "distributions/income.json", "$.bins[1].mean", /31 lies outside the bin \[10, 30\]/);
    expectOnly((f) => (f.distributions.wealth.bins[0].mean = -101), "distributions/wealth.json", "$.bins[0].mean", /lies outside/);
  });

  it("a bin that does not ascend", () => {
    expectError((f) => (f.distributions.income.bins[2].to = 30), "distributions/income.json", "$.bins[2]", /"from" \(30\) must be below "to" \(30\)/);
    // Bins in the wrong order are caught as not contiguous.
    expectError((f) => f.distributions.income.bins.reverse(), "distributions/income.json", "$.bins[1].from", /does not continue/);
  });

  it("a tail that does not start where the bins end", () => {
    expectOnly((f) => (f.distributions.wealth.tail.from = 2000), "distributions/wealth.json", "$.tail.from", /2000 must equal the end of the last bin, 1000/);
  });

  it("a distribution without units", () => {
    expectError(
      (f) => f.distributions.income.bins.forEach((bin: Loose) => (bin.count = 0)),
      "distributions/income.json",
      "$.bins",
      /contains no units/,
    );
  });
});

describe("policies", () => {
  it("schedule brackets that are not ascending at default parameter values", () => {
    expectOnly((f) => (f.policies.policies[4].effects[0].reform.brackets[1].from = 5), "policies.json", "$.policies[4].effects[0].reform.brackets[1].from", /ascending at default parameter values, but 5 follows 10/);
    // The same through a param: the default of the first threshold lies above the fixed second one.
    expectOnly(
      (f) => {
        f.policies.policies[3].effects[0].reform.brackets.push({ from: 500, rate: 0.02 });
      },
      "policies.json",
      "$.policies[3].effects[0].reform.brackets[1].from",
      /but 500 follows 1000/,
    );
    // With a lower default the same schedule is fine.
    const files = testlandFiles() as Files;
    files.policies.policies[3].effects[0].reform.brackets.push({ from: 500, rate: 0.02 });
    files.policies.policies[3].params[1].default = 400;
    expect(validatePack(files).ok).toBe(true);
  });

  it("baseline brackets that are not ascending", () => {
    expectOnly((f) => (f.policies.policies[4].effects[0].baseline.brackets[1].from = 10), "policies.json", "$.policies[4].effects[0].baseline.brackets[1].from", /ascending, but 10 follows 10/);
  });

  it("a baseline that yields nothing, which would mean dividing by zero", () => {
    expectOnly(
      (f) => (f.policies.policies[4].effects[0].baseline.brackets = [{ from: 100, rate: 0.4 }]),
      "policies.json",
      "$.policies[4].effects[0].baseline",
      /baseline schedule yields nothing on distribution "income"/,
    );
  });

  it("rates and shares that are not fractions between 0 and 1", () => {
    // The classic slip: a percent param used as a rate without "scale": 0.01.
    expectOnly(
      (f) => delete f.policies.policies[4].effects[0].reform.brackets[1].rate.scale,
      "policies.json",
      "$.policies[4].effects[0].reform.brackets[1].rate",
      /50 at default parameter values is not a rate between 0 and 1/,
    );
    expectOnly((f) => (f.policies.policies[4].effects[0].reform.brackets[0].rate = 20), "policies.json", "$.policies[4].effects[0].reform.brackets[0].rate", /20 at default/);
    expectOnly((f) => (f.policies.policies[4].effects[0].reform.brackets[0].rate = -0.1), "policies.json", "$.policies[4].effects[0].reform.brackets[0].rate", /-0.1 at default/);
    expectOnly((f) => (f.policies.policies[4].effects[0].baseline.brackets[1].rate = 40), "policies.json", "$.policies[4].effects[0].baseline.brackets[1].rate", /<=1/);
    expectOnly((f) => (f.policies.policies[2].effects[0].retained = 20), "policies.json", "$.policies[2].effects[0].retained", /20 at default parameter values is not a share between 0 and 1/);
    // Rates of exactly 0 and 1 are allowed.
    const files = testlandFiles() as Files;
    files.policies.policies[4].effects[0].reform.brackets[0].rate = 0;
    files.policies.policies[4].effects[0].baseline.brackets[1].rate = 1;
    files.policies.policies[2].effects[0].retained = 1;
    expect(validatePack(files).ok).toBe(true);
  });

  it("`add` or `set` on a group whose leaves are all zero", () => {
    const zeroTaxes = (f: Files, type: string): void => {
      for (const leaf of f.budget.revenue[0].children) leaf.amount = 0;
      f.policies.policies = [
        { id: "p", label: { en: "p", de: "p" }, summary: { en: "p", de: "p" }, topic: "taxes", params: [], effects: [{ type, target: "rev.taxes", amount: 10, quality: "estimate" }], catches: [], sources: [] },
      ];
      f.distributions = {};
      f.sources = { finance_ministry: f.sources.finance_ministry, stats_office: f.sources.stats_office };
    };
    expectOnly((f) => zeroTaxes(f, "add"), "policies.json", "$.policies[0].effects[0].target", /"add" on group "rev.taxes", whose leaves are all zero/);
    expectOnly((f) => zeroTaxes(f, "set"), "policies.json", "$.policies[0].effects[0].target", /"set" on group "rev.taxes", whose leaves are all zero/);

    // The same on a zero leaf is fine, and so is scaling the empty group.
    for (const effect of [
      { type: "set", target: "rev.taxes.wealth", amount: 10, quality: "estimate" },
      { type: "add", target: "rev.taxes.wealth", amount: 10, quality: "estimate" },
      { type: "scale", target: "rev.taxes", factor: 2, quality: "estimate" },
    ]) {
      const files = testlandFiles() as Files;
      zeroTaxes(files, "add");
      files.policies.policies[0].effects = [effect];
      expect(validatePack(files).ok).toBe(true);
    }
  });

  it("number params with an impossible range or default", () => {
    expectOnly((f) => (f.policies.policies[1].params[0].default = 60), "policies.json", "$.policies[1].params[0].default", /60 lies outside \[0, 50\]/);
    expectOnly((f) => (f.policies.policies[1].params[0].min = 80), "policies.json", "$.policies[1].params[0]", /min \(80\) is above max \(50\)/);
  });
});

describe("shift", () => {
  /** The shift of the fixture's pension cut: { to: "exp.social.basic_income", ratio: { param: "fallback", scale: 0.01 } }. */
  const shift = (f: Files): Loose => f.policies.policies[7].effects[0].shift;
  const AT = "$.policies[7].effects[0].shift";

  it("the node it shifts to must exist", () => {
    expectOnly((f) => (shift(f).to = "exp.social.nothing"), "policies.json", `${AT}.to`, /unknown budget node "exp.social.nothing"/);
  });

  it("the node must not be the target, nor a node above or below it", () => {
    expectOnly((f) => (shift(f).to = "exp.social.pensions"), "policies.json", `${AT}.to`, /"exp.social.pensions" is the effect's own target/);
    expectOnly((f) => (shift(f).to = "exp.social"), "policies.json", `${AT}.to`, /"exp.social" contains the effect's target "exp.social.pensions"/);
    // cut_admin targets the group exp.admin; a leaf of it cannot receive what the group loses.
    expectOnly(
      (f) => (f.policies.policies[1].effects[0].shift = { to: "exp.admin.other", ratio: 0.5 }),
      "policies.json",
      "$.policies[1].effects[0].shift.to",
      /"exp.admin.other" lies inside the effect's target "exp.admin"/,
    );
    // A sibling, a node in another branch and a node on the other side are all fine.
    for (const to of ["exp.social.family", "exp.admin", "exp.health", "rev.other", "rev.taxes"]) {
      const files = testlandFiles() as Files;
      shift(files).to = to;
      expect(validatePack(files)).toMatchObject({ ok: true, warnings: [] });
    }
  });

  it("the ratio at default parameter values must be a number >= 0", () => {
    expectOnly((f) => (shift(f).ratio = -0.5), "policies.json", `${AT}.ratio`, /-0.5 at default parameter values is not a finite number >= 0/);
    expectOnly((f) => (shift(f).ratio = { param: "fallback", scale: -0.01 }), "policies.json", `${AT}.ratio`, /-0.25 at default parameter values/);
    expectOnly((f) => (shift(f).ratio = { param: "fallback", scale: 0.01, offset: -1 }), "policies.json", `${AT}.ratio`, /-0.75 at default/);
    // 0 and values above 1 are allowed.
    for (const ratio of [0, 1, 2.5, { param: "fallback", scale: 0.04 }]) {
      const files = testlandFiles() as Files;
      shift(files).ratio = ratio;
      files.policies.policies[7].params = files.policies.policies[7].params.filter((p: Loose) => p.id === "cut" || typeof ratio === "object");
      expect(validatePack(files)).toMatchObject({ ok: true, warnings: [] });
    }
  });

  it("the ratio may only refer to a number param of the policy", () => {
    expectError((f) => (shift(f).ratio = { param: "fallbak", scale: 0.01 }), "policies.json", `${AT}.ratio.param`, /unknown param "fallbak" in policy "cut_pensions"/);
    expectOnly((f) => (f.policies.policies[2].effects[0].shift = { to: "exp.education", ratio: { param: "groups" } }), "policies.json", "$.policies[2].effects[0].shift.ratio.param", /"groups" is a groups param; a number param is needed/);
  });

  it("the node must not be a group whose leaves are all zero", () => {
    const zeroTaxes = (f: Files): void => {
      for (const leaf of f.budget.revenue[0].children) leaf.amount = 0;
      // Without the policies that tax income and wealth, so only the shift is at stake.
      f.policies.policies = [f.policies.policies[7]];
      f.distributions = {};
      f.sources = { finance_ministry: f.sources.finance_ministry, stats_office: f.sources.stats_office };
    };
    expectOnly(
      (f) => {
        zeroTaxes(f);
        f.policies.policies[0].effects[0].shift.to = "rev.taxes";
      },
      "policies.json",
      "$.policies[0].effects[0].shift.to",
      /shift to group "rev.taxes", whose leaves are all zero/,
    );
    // A leaf that is zero can receive an amount.
    const files = testlandFiles() as Files;
    zeroTaxes(files);
    files.policies.policies[0].effects[0].shift.to = "rev.taxes.wealth";
    expect(validatePack(files).ok).toBe(true);
  });

  it("unknown or missing keys inside `shift` are errors", () => {
    expectOnly((f) => (shift(f).ration = 0.5), "policies.json", AT, /Unrecognized key: "ration"/);
    expectOnly((f) => delete shift(f).to, "policies.json", `${AT}.to`, /expected string/);
    expectOnly((f) => delete shift(f).ratio, "policies.json", `${AT}.ratio`, /expected number or object/);
    expectOnly((f) => (shift(f).uncertainty = { low: 1 }), "policies.json", `${AT}.uncertainty.high`, /expected number/);
    expectOnly((f) => (shift(f).uncertainty = { low: 1, high: 2, mid: 1.5 }), "policies.json", `${AT}.uncertainty`, /Unrecognized key: "mid"/);
    expectOnly((f) => (f.policies.policies[7].effects[0].shift = "exp.health"), "policies.json", AT, /expected object/);
  });

  it("is only allowed on `scale` and `excludeGroups` effects", () => {
    const add = { to: "exp.health", ratio: 0.5 };
    // [3] schedule, [5] set, [6] add
    for (const i of [3, 5, 6]) {
      expectOnly((f) => (f.policies.policies[i].effects[0].shift = add), "policies.json", `$.policies[${i}].effects[0]`, /Unrecognized key: "shift"/);
    }
    // excludeGroups: [2] no_basic_income_non_citizens, first effect
    const files = testlandFiles() as Files;
    files.policies.policies[2].effects[0].shift = { to: "exp.education", ratio: 0.5, uncertainty: { low: 0.5, high: 1.5 } };
    expect(validatePack(files)).toMatchObject({ ok: true, warnings: [] });
  });

  it("counts as a use of its param, and warns about a percent param without a scale", () => {
    // `fallback` is used nowhere but in the ratio; the valid fixture has no "unused param" warning.
    expect(validatePack(testlandFiles()).warnings).toEqual([]);
    const warnings = warningsAfter((f) => delete shift(f).ratio.scale);
    expect(warnings).toEqual([{ file: "policies.json", path: `${AT}.ratio`, message: expect.stringMatching(/param "fallback" is in percent but is used without "scale"/) }]);
  });
});

describe("warnings", () => {
  it("a param no effect uses", () => {
    const warnings = warningsAfter((f) => {
      f.policies.policies[0].params.push({ id: "spare", type: "number", label: { en: "s", de: "s" }, unit: "count", min: 0, max: 1, step: 1, default: 0 });
    });
    expect(warnings).toEqual([{ file: "policies.json", path: "$.policies[0].params[0]", message: 'param "spare" is not used by any effect' }]);
  });

  it("a source nothing refers to", () => {
    const warnings = warningsAfter((f) => {
      f.sources.old_report = { ...f.sources.stats_office };
    });
    expect(warnings).toEqual([{ file: "sources.json", path: "$.old_report", message: 'source "old_report" is never referenced' }]);
  });

  it("a calibrated schedule on a node that is zero", () => {
    const warnings = warningsAfter((f) => (f.policies.policies[4].effects[0].target = "rev.taxes.wealth"));
    expect(warnings).toEqual([{ file: "policies.json", path: "$.policies[4].effects[0].target", message: expect.stringMatching(/always be zero/) }]);
  });

  it("a percent param used without a scale", () => {
    // A wealth tax of "1" would be 100 %: inside the allowed range for a rate, so only a warning can catch it.
    const warnings = warningsAfter((f) => delete f.policies.policies[3].effects[0].reform.brackets[0].rate.scale);
    expect(warnings).toEqual([
      { file: "policies.json", path: "$.policies[3].effects[0].reform.brackets[0].rate", message: expect.stringMatching(/param "rate" is in percent but is used without "scale"/) },
    ]);
    // percent_gdp without a scale: 3 would mean three times GDP.
    expect(warningsAfter((f) => delete f.policies.policies[5].effects[0].amount.scale)).toHaveLength(1);
    // Other units need no scale.
    expect(warningsAfter(() => {})).toEqual([]);
  });

  it("do not make a pack invalid", () => {
    const files = testlandFiles() as Files;
    files.sources.old_report = { ...files.sources.stats_office };
    expect(validatePack(files).ok).toBe(true);
  });
});

describe("validatePackFiles", () => {
  const texts = (): Record<string, string> => {
    const files = testlandFiles() as Files;
    return {
      "country.json": JSON.stringify(files.country),
      "budget.json": JSON.stringify(files.budget),
      "policies.json": JSON.stringify(files.policies),
      "sources.json": JSON.stringify(files.sources),
      "distributions/income.json": JSON.stringify(files.distributions.income),
      "distributions/wealth.json": JSON.stringify(files.distributions.wealth),
    };
  };

  it("parses and validates the text of the files", () => {
    expect(validatePackFiles(texts(), "xx")).toEqual({ ok: true, pack: testland, warnings: [] });
    // JSON exponent notation is plain JSON.
    const files = texts();
    files["budget.json"] = files["budget.json"].replace('"amount":1500', '"amount":1.5e3');
    expect(validatePackFiles(files, "xx")).toEqual({ ok: true, pack: testland, warnings: [] });
  });

  it("reports a file that is not valid JSON, and only that", () => {
    const files = texts();
    files["budget.json"] = files["budget.json"].slice(0, -1);
    const result = validatePackFiles(files, "xx");
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([{ file: "budget.json", path: "$", message: expect.stringMatching(/^not valid JSON: /) }]);

    const broken = texts();
    broken["distributions/wealth.json"] = "{ bins: [] }";
    const second = validatePackFiles(broken, "xx");
    expect(second.ok ? [] : second.errors).toEqual([{ file: "distributions/wealth.json", path: "$", message: expect.stringMatching(/^not valid JSON: /) }]);
  });

  it("reports missing files", () => {
    const files = texts();
    delete files["country.json"];
    delete files["sources.json"];
    const result = validatePackFiles(files, "xx");
    expect(result.ok ? [] : result.errors).toEqual([
      { file: "country.json", path: "$", message: "file is missing" },
      { file: "sources.json", path: "$", message: "file is missing" },
    ]);
    const empty = validatePackFiles({});
    expect(empty.ok ? [] : empty.errors.map((e) => e.file)).toEqual(["country.json", "budget.json", "policies.json", "sources.json"]);
  });

  it("ignores files the contract does not know, with a warning", () => {
    const files = { ...texts(), "notes.json": "{}", "distributions/old/income.json": "not even json" };
    const result = validatePackFiles(files, "xx");
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.file).sort()).toEqual(["distributions/old/income.json", "notes.json"]);
  });

  it("checks the directory name against country.id", () => {
    const result = validatePackFiles(texts(), "de");
    expect(result.ok ? [] : result.errors.map(formatIssue)).toEqual(['country.json $.id: is "xx" but the pack directory is "de"']);
  });
});

describe("reporting", () => {
  it("groups errors by file in reading order", () => {
    const errors = errorsAfter((f) => {
      f.distributions.income.bins[1].mean = 31;
      f.policies.policies[0].effects[0].target = "exp.nope";
      f.budget.revenue[1].levels = { social_security: 0.9 };
      f.country.currency = "eur";
      f.sources.stats_office.accessed = "yesterday";
    });
    expect(errors.map((e) => e.file)).toEqual(["country.json", "budget.json", "policies.json", "sources.json", "distributions/income.json"]);
  });

  it("reports every independent problem at once", () => {
    const errors = errorsAfter((f) => {
      f.distributions.income.bins[1].mean = 31;
      f.policies.policies[0].effects[0].target = "exp.nope";
      f.budget.revenue[1].levels = { social_security: 0.9 };
      f.budget.revenue[2].sources = ["nowhere"];
    });
    expect(errors.map(formatIssue)).toEqual([
      "budget.json $.revenue[1].levels: shares sum to 0.9, expected 1",
      'budget.json $.revenue[2].sources[0]: unknown source "nowhere"',
      'policies.json $.policies[0].effects[0].target: unknown budget node "exp.nope"',
      "distributions/income.json $.bins[1].mean: 31 lies outside the bin [10, 30]",
    ]);
  });

  it("formats JSON paths", () => {
    expect(formatPath([])).toBe("$");
    expect(formatPath(["revenue", 0, "children", 12, "amount"])).toBe("$.revenue[0].children[12].amount");
    expect(formatPath(["breakdowns", "by-age", "x y"])).toBe('$.breakdowns["by-age"]["x y"]');
  });
});
