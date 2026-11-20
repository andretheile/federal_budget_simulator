/**
 * When measures act in the debt projection, as the interface words it, on Testland with timing
 * (testlandTimed): measures act from 2026; cut_admin builds up over four years, wealth_tax starts in
 * 2028, defense_target from July 2027 at two years per percentage point above its baseline.
 */
import { describe, expect, it } from "vitest";
import { testlandTimed } from "../engine/__fixtures__/testland.ts";
import { measurePhase } from "../engine/index.ts";
import { laterPhases, notInFullBy, phaseWords, startText } from "./phaseModel.ts";

const pack = testlandTimed();
const phase = (id: string, params?: Record<string, number>) => measurePhase(pack, id, params)!;

describe("the start of a measure", () => {
  it("is a year where it starts with the year, month and year otherwise", () => {
    expect(startText("2032-01-01", "de")).toBe("2032");
    expect(startText("2027-07-01", "de")).toBe("Juli 2027");
    expect(startText("2027-07-01", "en")).toBe("July 2027");
    expect(startText("2027-11-01", "de")).toBe("November 2027");
  });
});

describe("the words for a phase", () => {
  it("give the start, and the first whole year in full only where the measure builds up", () => {
    expect(phaseWords(phase("cut_admin"), "en")).toEqual({ start: "2026", startYear: 2026, full: 2030, last: undefined });
    expect(phaseWords(phase("wealth_tax"), "en")).toEqual({ start: "2028", startYear: 2028, full: undefined, last: undefined });
    expect(phaseWords(phase("defense_target"), "de", 2054)).toEqual({ start: "Juli 2027", startYear: 2027, full: 2030, last: 2054 });
    // Further from the baseline, longer; below it, the phase of its own.
    expect(phaseWords(phase("defense_target", { share: 4 }), "en").full).toBe(2032);
    expect(phaseWords(phase("defense_target", { share: 1 }), "en")).toMatchObject({ start: "2026", full: 2027 });
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
