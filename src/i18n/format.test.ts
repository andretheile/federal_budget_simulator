import { describe, expect, it } from "vitest";
import type { NumberParam } from "../engine/index.ts";
import { createFormatters, decimalsOf } from "./format.ts";

const NBSP = " ";
/** Intl separates number and unit with no-break spaces (sometimes narrow ones); the tests do not care which. */
const plain = (text: string): string => text.replace(/[  ]/g, " ");

const de = createFormatters("de", "EUR");
const en = createFormatters("en", "EUR");

describe("money", () => {
  it("writes billions and millions the way each language reads them", () => {
    expect(plain(de.money(12.4e9))).toBe("12,4 Mrd. €");
    expect(en.money(12.4e9)).toBe("€12.4bn");
    expect(plain(de.money(60.5e6))).toBe("60,5 Mio. €");
    expect(en.money(60.5e6)).toBe("€60.5m");
    expect(plain(de.money(862e6))).toBe("862 Mio. €");
    expect(en.money(862e6)).toBe("€862m");
  });

  it("stays in billions above a thousand billion instead of switching to trillions", () => {
    expect(plain(de.money(2_028_340_000_000))).toBe("2.028,3 Mrd. €");
    expect(en.money(2_028_340_000_000)).toBe("€2,028.3bn");
  });

  it("writes amounts below a million in full", () => {
    expect(plain(de.money(1430))).toBe("1.430 €");
    expect(en.money(1430)).toBe("€1,430");
    expect(plain(de.money(999_499))).toBe("999.499 €");
    expect(plain(de.money(0))).toBe("0 €");
  });

  it("switches unit where rounding would otherwise give a thousand of the smaller one", () => {
    expect(plain(de.money(999_600))).toBe("1 Mio. €");
    expect(plain(de.money(999_700_000))).toBe("1,0 Mrd. €");
  });

  it("puts an explicit sign on changes, with a real minus sign, and none on zero", () => {
    expect(plain(de.money(12.4e9, { signed: true }))).toBe("+12,4 Mrd. €");
    expect(plain(de.money(-119.146e9, { signed: true }))).toBe("−119,1 Mrd. €");
    expect(en.money(12.4e9, { signed: true })).toBe("+€12.4bn");
    expect(en.money(-119.146e9, { signed: true })).toBe("−€119.1bn");
    expect(plain(de.money(-1430, { signed: true }))).toBe("−1.430 €");
    expect(plain(de.money(0, { signed: true }))).toBe("0 €");
    expect(plain(de.money(-0.004, { signed: true }))).toBe("0 €");
    expect(de.money(-5e9)).not.toContain("-");
  });

  it("can drop the decimal of round settings", () => {
    expect(plain(de.money(20e9, { trim: true }))).toBe("20 Mrd. €");
    expect(plain(de.money(2.5e6, { trim: true }))).toBe("2,5 Mio. €");
    expect(en.money(2e6, { trim: true })).toBe("€2m");
  });

  it("works with a currency that has no symbol", () => {
    const xts = createFormatters("en", "XTS");
    expect(plain(xts.money(-400, { signed: true }))).toBe("−XTS 400");
    expect(plain(createFormatters("de", "XTS").money(4000))).toBe("4.000 XTS");
  });

  it("keeps the browser's own abbreviations for a language without a dictionary", () => {
    const fr = createFormatters("fr", "EUR");
    expect(plain(fr.money(12.4e9))).toBe("12,4 Md €");
  });
});

describe("percentages and shares", () => {
  it("formats fractions as percentages", () => {
    expect(plain(de.percent(0.028))).toBe("2,8 %");
    expect(en.percent(0.028)).toBe("2.8%");
    expect(plain(de.percent(-0.0272, { signed: true }))).toBe("−2,7 %");
    expect(en.percent(0.031, { signed: true })).toBe("+3.1%");
    expect(plain(de.percent(0.42, { digits: 0 }))).toBe("42 %");
  });

  it("never rounds a real share to zero", () => {
    expect(plain(de.share(0.411))).toBe("41,1 %");
    expect(plain(de.share(0.0004))).toBe("0,04 %");
    expect(plain(de.share(0.00003))).toBe("weniger als 0,01 %");
    expect(en.share(0.00003)).toBe("less than 0.01%");
    expect(plain(de.share(1.32))).toBe("132 %");
    expect(plain(de.share(0))).toBe("0 %");
  });
});

describe("counts, parameters and dates", () => {
  it("rounds counts to three significant digits", () => {
    expect(plain(de.count(41_700_100))).toBe("41,7 Mio.");
    expect(en.count(41_700_100)).toBe("41.7m");
    expect(de.count(12_345)).toBe("12.300");
    expect(en.count(5)).toBe("5");
  });

  it("formats parameter values in their unit", () => {
    const param = (unit: NumberParam["unit"], step: number): NumberParam => ({
      id: "p",
      type: "number",
      label: { en: "P" },
      unit,
      min: 0,
      max: 100,
      step,
      default: 0,
    });
    expect(plain(de.param(param("percent", 1), 42))).toBe("42 %");
    expect(plain(de.param(param("percent", 0.1), 1))).toBe("1,0 %");
    expect(en.param(param("percent", 0.5), 53.5)).toBe("53.5%");
    expect(plain(de.param(param("percent_gdp", 0.1), 3.5))).toBe("3,5 % des BIP");
    expect(en.param(param("percent_gdp", 0.1), 3.5)).toBe("3.5% of GDP");
    expect(plain(de.param(param("currency", 1e9), 20e9))).toBe("20 Mrd. €");
    expect(en.param(param("currency", 100_000), 2_000_000)).toBe("€2m");
    expect(plain(de.param(param("years", 1), 67))).toBe("67 Jahre");
    expect(en.param(param("years", 1), 67)).toBe("67 years");
    expect(de.param(param("count", 1), 1200)).toBe("1.200");
  });

  it("derives decimals from the step", () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.5)).toBe(1);
    expect(decimalsOf(0.1)).toBe(1);
    expect(decimalsOf(0.25)).toBe(2);
    expect(decimalsOf(100_000)).toBe(0);
  });

  it("formats ISO dates and leaves anything else alone", () => {
    expect(de.date("2026-11-17")).toBe("17.11.2026");
    expect(en.date("2026-11-17")).toBe("17 Nov 2026");
    expect(de.date("unknown")).toBe("unknown");
  });

  it("uses no-break spaces, so a number never wraps away from its unit", () => {
    expect(de.money(12.4e9)).toContain(NBSP);
  });
});
