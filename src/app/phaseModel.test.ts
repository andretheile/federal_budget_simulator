/**
 * When measures act in the debt projection, as the interface words it, on Testland with timing
 * (testlandTimed): measures act from 2026; cut_admin builds up over four years, wealth_tax starts in
 * 2028, defense_target from July 2027 at two years per percentage point above its baseline.
 */
import { describe, expect, it } from "vitest";
import { testlandEnding, testlandFiscal, testlandTimed } from "../engine/__fixtures__/testland.ts";
import { measurePhase } from "../engine/index.ts";
import { debtDe } from "../i18n/debt/de.ts";
import { debtEn } from "../i18n/debt/en.ts";
import { anyEnding, endedBy, laterPhases, notInFullBy, phaseWords, startText } from "./phaseModel.ts";
import { createUi } from "./ui.ts";

const pack = testlandTimed();
const phase = (id: string, params?: Record<string, number>) => measurePhase(pack, id, params)!;
const de = createUi(pack, "de");
const en = createUi(pack, "en");

describe("the start of a measure", () => {
  it("is a year where it starts with the year, month and year otherwise", () => {
    expect(startText("2032-01-01", de)).toBe("2032");
    expect(startText("2027-07-01", de)).toBe("Juli 2027");
    expect(startText("2027-07-01", en)).toBe("July 2027");
    expect(startText("2027-11-01", de)).toBe("November 2027");
  });

  it("in a pack of fiscal years: the year by its name where it starts with one, month and year otherwise, 1 January too", () => {
    // Testland's fiscal variant: years from 1 October, named after the year they end in ("FY 2026").
    const fiscal = testlandFiscal();
    const fen = createUi(fiscal, "en");
    const fde = createUi(fiscal, "de");
    expect(startText("2025-10-01", fen)).toBe("FY 2026");
    expect(startText("2025-10-01", fde)).toBe("Haushaltsjahr 2026");
    // Not "October 2025": that is how FY 2026 begins. And 1 January lies inside a fiscal year.
    expect(startText("2026-01-01", fen)).toBe("January 2026");
    expect(startText("2026-01-01", fde)).toBe("Januar 2026");
    expect(startText("2027-07-01", fen)).toBe("July 2027");
  });
});

describe("the words for a phase", () => {
  it("give the start, and the first whole year in full only where the measure builds up", () => {
    expect(phaseWords(phase("cut_admin"), en)).toEqual({ start: "2026", startYear: 2026, full: 2030, horizonEnd: undefined, fullName: 2030 });
    expect(phaseWords(phase("wealth_tax"), en)).toEqual({ start: "2028", startYear: 2028, full: undefined, horizonEnd: undefined });
    expect(phaseWords(phase("defense_target"), de, 2054)).toEqual({ start: "Juli 2027", startYear: 2027, full: 2030, horizonEnd: 2054, fullName: 2030 });
    // Further from the baseline, longer; below it, the phase of its own.
    expect(phaseWords(phase("defense_target", { share: 4 }), en).full).toBe(2032);
    expect(phaseWords(phase("defense_target", { share: 1 }), en)).toMatchObject({ start: "2026", full: 2027 });
  });

  it("name the pack's fiscal years, in the card's line and in the section's list", () => {
    const fiscal = testlandFiscal();
    const at = (id: string) => measurePhase(fiscal, id)!;
    const fen = createUi(fiscal, "en");
    const fde = createUi(fiscal, "de");
    // cut_admin builds up over four years from the first day measures can act, 1 October 2025.
    expect(phaseWords(at("cut_admin"), fen)).toMatchObject({ start: "FY 2026", startYear: 2026, full: 2030, fullName: "FY 2030" });
    expect(debtEn.timing.when(phaseWords(at("cut_admin"), fen))).toBe("from FY 2026, in full from FY 2030");
    expect(debtDe.timing.when(phaseWords(at("cut_admin"), fde))).toBe("ab Haushaltsjahr 2026, voll ab Haushaltsjahr 2030");
    // The wealth tax starts on 1 January 2026, inside FY 2026, at once: a date, not a year.
    expect(debtEn.timing.when(phaseWords(at("wealth_tax"), fen))).toBe("from January 2026");
    expect(debtDe.timing.when(phaseWords(at("wealth_tax"), fde))).toBe("ab Januar 2026");
    // A calculation that ends before the build-up does, in the section's list.
    expect(debtDe.timing.when(phaseWords(at("cut_admin"), fde, 2028))).toBe("ab Haushaltsjahr 2026, voll erst ab Haushaltsjahr 2030, nach dem Ende der Rechnung");
  });
});

describe("which measures are named", () => {
  it("are those that start later than the pack's first year or build up", () => {
    const phases = ["halve_mp_pay", "cut_admin", "wealth_tax"].map((id) => phase(id));
    expect(phases[0].immediate).toBe(true);
    expect(laterPhases(phases).map((entry) => entry.policy)).toEqual(["cut_admin", "wealth_tax"]);
  });

  it("are not yet in full by the last year where they start or are in full after it", () => {
    const phases = [phase("cut_admin"), phase("wealth_tax")];
    expect(notInFullBy(phases, 2054)).toBe(false);
    expect(notInFullBy(phases, 2029)).toBe(true);
    expect(notInFullBy([phase("wealth_tax")], 2027)).toBe(true);
    expect(notInFullBy([phase("wealth_tax")], 2028)).toBe(false);
    // A measure without timing of its own acts in full from the pack's first year (2026).
    expect(notInFullBy([phase("halve_mp_pay")], 2026)).toBe(false);
    expect(notInFullBy([phase("halve_mp_pay")], 2025)).toBe(true);
  });
});

describe("measures that end (Testland with ends: measures act from 2026)", () => {
  // family_bonus: a one-off on 1 July 2027. raise_top_tax_rate: four years from 1 July 2026 to 30 June
  // 2030. defense_target: below its baseline a one-off, from 2026; above it for good from July 2027.
  const ending = testlandEnding();
  const at = (id: string, params?: Record<string, number>) => measurePhase(ending, id, params)!;
  const een = createUi(ending, "en");
  const ede = createUi(ending, "de");

  it("a one-off counts once, in the year it falls in, and says no start", () => {
    expect(phaseWords(at("family_bonus"), een)).toMatchObject({ startYear: 2027, once: 2027 });
    expect(debtEn.timing.when(phaseWords(at("family_bonus"), een))).toBe("once, in 2027");
    expect(debtDe.timing.when(phaseWords(at("family_bonus"), ede))).toBe("einmal, im Jahr 2027");
    // A one-off below a slider's baseline, a measure for good above it.
    expect(debtEn.timing.when(phaseWords(at("defense_target", { share: 1 }), een))).toBe("once, in 2026");
    expect(debtEn.timing.when(phaseWords(at("defense_target"), een))).toBe("from July 2027");
    // After the end of the calculation, as for a start.
    expect(debtEn.timing.when(phaseWords(at("family_bonus"), een, 2026))).toBe("once, in 2027, after the end of the calculation");
  });

  it("a measure for a number of years: from its start to its end, by month where they lie within a year", () => {
    expect(phaseWords(at("raise_top_tax_rate"), een)).toMatchObject({ start: "July 2026", until: "June 2030" });
    expect(debtEn.timing.when(phaseWords(at("raise_top_tax_rate"), een))).toBe("from July 2026 to June 2030");
    expect(debtDe.timing.when(phaseWords(at("raise_top_tax_rate"), ede))).toBe("von Juli 2026 bis Juni 2030");
    // From the start of a year: whole years, by their names.
    const whole = testlandEnding();
    whole.policies.find((policy) => policy.id === "raise_top_tax_rate")!.timing!.from = "2026-01-01";
    expect(debtEn.timing.when(phaseWords(measurePhase(whole, "raise_top_tax_rate")!, createUi(whole, "en")))).toBe("from 2026 to 2029");
    // In fiscal years, a start on the first day of one: from FY 2026 to FY 2029.
    const fiscal = testlandFiscal();
    fiscal.policies.find((policy) => policy.id === "raise_top_tax_rate")!.timing = { lasts: 4, note: { en: "-", de: "-" }, sources: ["finance_ministry"] };
    const phase = measurePhase(fiscal, "raise_top_tax_rate")!;
    expect(debtEn.timing.when(phaseWords(phase, createUi(fiscal, "en")))).toBe("from FY 2026 to FY 2029");
    expect(debtDe.timing.when(phaseWords(phase, createUi(fiscal, "de")))).toBe("von Haushaltsjahr 2026 bis Haushaltsjahr 2029");
    // A one-off in fiscal years.
    fiscal.policies.find((policy) => policy.id === "raise_top_tax_rate")!.timing = { once: true, note: { en: "-", de: "-" }, sources: ["finance_ministry"] };
    const once = measurePhase(fiscal, "raise_top_tax_rate")!;
    expect(debtEn.timing.when(phaseWords(once, createUi(fiscal, "en")))).toBe("once, in FY 2026");
    expect(debtDe.timing.when(phaseWords(once, createUi(fiscal, "de")))).toBe("einmal, im Haushaltsjahr 2026");
  });

  it("tell a measure that has ended from one that has not started or is not yet in full", () => {
    const bonus = at("family_bonus");
    const surcharge = at("raise_top_tax_rate");
    expect(endedBy([bonus], 2027)).toBe(false);
    expect(endedBy([bonus], 2028)).toBe(true);
    expect(endedBy([surcharge], 2030)).toBe(false);
    expect(endedBy([surcharge], 2031)).toBe(true);
    // Ended is not "not yet in full": the one-off of 2027 is neither in 2054.
    expect(notInFullBy([bonus], 2054)).toBe(false);
    expect(notInFullBy([bonus], 2026)).toBe(true);
    expect(anyEnding([bonus])).toBe(true);
    expect(anyEnding([at("defense_target")])).toBe(false);
    // Both are listed among the measures that act later or step by step.
    expect(laterPhases([bonus, surcharge]).map((entry) => entry.policy)).toEqual(["family_bonus", "raise_top_tax_rate"]);
  });
});
