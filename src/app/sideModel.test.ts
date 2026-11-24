/**
 * The side of the budget a measure acts on, on named measures of both packs as they are in the
 * working tree and on Testland. If a pack does not validate, the test fails with its own errors.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import type { CountryPack, Policy } from "../engine/index.ts";
import { loadPack } from "../packs.ts";
import { budgetHolder, policySide, policySides, sideOfNode } from "./sideModel.ts";

let de: CountryPack;
let us: CountryPack;

beforeAll(async () => {
  for (const id of ["de", "us"]) {
    const result = await loadPack(id);
    if (!result.ok) throw new Error(`countries/${id} does not validate: ${JSON.stringify(result.errors.slice(0, 3))}`);
    if (id === "de") de = result.pack;
    else us = result.pack;
  }
});

const policy = (pack: CountryPack, id: string): Policy => {
  const found = pack.policies.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no measure ${id}`);
  return found;
};

describe("the side of a budget item", () => {
  it("is the side of the tree it lies on, for a group and for a leaf", () => {
    expect(sideOfNode(testland, "rev.taxes")).toBe("revenue");
    expect(sideOfNode(testland, "rev.taxes.wealth")).toBe("revenue");
    expect(sideOfNode(testland, "exp.admin")).toBe("expenditure");
    expect(sideOfNode(testland, "exp.admin.parliament")).toBe("expenditure");
    expect(sideOfNode(testland, "no.such.item")).toBeUndefined();
  });
});

describe("the side of a measure", () => {
  it("is revenue for a tax and spending for a cut, in Germany", () => {
    expect(policySide(de, policy(de, "wealth_tax"))).toBe("revenue");
    expect(policySide(de, policy(de, "vat_rates"))).toBe("revenue");
    expect(policySide(de, policy(de, "income_tax_schedule"))).toBe("revenue");
    expect(policySide(de, policy(de, "child_benefit_amount"))).toBe("expenditure");
    expect(policySide(de, policy(de, "ukraine_military_aid"))).toBe("expenditure");
    expect(policySide(de, policy(de, "pension_level"))).toBe("expenditure");
  });

  it("is both for the German measures that change contributions or fees as well as spending", () => {
    for (const id of ["broadcasting_fee_abolish", "civil_service_pensions", "early_retirement_45_years", "pension_insurance_for_all", "retirement_age"]) {
      expect(policySide(de, policy(de, id)), id).toBe("both");
    }
  });

  it("is revenue, spending or both in the United States", () => {
    expect(policySide(us, policy(us, "tariff_all_imports"))).toBe("revenue");
    expect(policySide(us, policy(us, "social_security_benefit_tax"))).toBe("revenue");
    expect(policySide(us, policy(us, "defense_spending_gdp"))).toBe("expenditure");
    expect(policySide(us, policy(us, "tariff_rebate_checks"))).toBe("expenditure");
    // Ending the enhanced premium credits: less spending on the credits, more income tax.
    expect(policySide(us, policy(us, "aca_enhanced_credits"))).toBe("both");
  });

  it("counts where a shift passes something on: a cut of spending that comes back as less revenue is both", () => {
    // In Testland the cut in pensions passes a part on to basic income, on the same side.
    expect(policySide(testland, policy(testland, "cut_pensions"))).toBe("expenditure");
    const pack = testlandCopy();
    const cut = policy(pack, "cut_pensions");
    const shift = cut.effects[0].shift;
    if (!shift) throw new Error("cut_pensions has no shift");
    shift.to = "rev.taxes.income";
    // Whatever its share: the ratio is a setting ("fallback"), and at 0 nothing is passed on.
    expect(policySide(pack, cut)).toBe("both");
  });

  it("is that of every item touched: contributions and the income tax they lower are revenue, the employer's part spending", () => {
    expect(policySide(testland, policy(testland, "insure_civil_servants"))).toBe("both");
    const pack = testlandCopy();
    const revenueOnly = policy(pack, "insure_civil_servants");
    revenueOnly.effects = [revenueOnly.effects[0]];
    expect(policySide(pack, revenueOnly)).toBe("revenue");
  });

  it("is worked out once for every measure of a pack", () => {
    const sides = policySides(testland);
    expect(sides).toBe(policySides(testland));
    expect(sides.size).toBe(testland.policies.length);
    expect(sides.get("wealth_tax")).toBe("revenue");
    expect(sides.get("halve_mp_pay")).toBe("expenditure");
    expect(sides.get("insure_civil_servants")).toBe("both");
    expect(policySides(de).get("retirement_age")).toBe("both");
  });
});

describe("whose budget a pack shows", () => {
  it("is the whole state's where it has several levels, the central government's where it has that one alone", () => {
    expect(budgetHolder(de)).toBe("state");
    expect(budgetHolder(testland)).toBe("state");
    expect(budgetHolder(us)).toBe("central");
  });
});
