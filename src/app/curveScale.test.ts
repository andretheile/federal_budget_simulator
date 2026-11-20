import { describe, expect, it } from "vitest";
import { testland } from "../engine/__fixtures__/testland.ts";
import { unitsAbove, type Distribution } from "../engine/index.ts";
import { chooseScale, fromFraction, linearTicks, niceCeil, quantile, toFraction, valuePerPixel, xTicks, type XScale } from "./curveScale.ts";

/** Skewed like German taxable incomes: most units low, a long thin top. */
const skewed: Distribution = {
  id: "skewed",
  label: { en: "income" },
  variable: { en: "income" },
  unit: { en: "taxpayers" },
  year: 2024,
  bins: [
    { from: -50_000, to: 0, count: 1, mean: -10_000 },
    { from: 0, to: 20_000, count: 40, mean: 10_000 },
    { from: 20_000, to: 60_000, count: 50, mean: 35_000 },
    { from: 60_000, to: 200_000, count: 8, mean: 90_000 },
    { from: 200_000, to: 1_100_000, count: 1, mean: 400_000 },
  ],
  quality: "estimate",
  sources: [],
};

describe("choosing the scale", () => {
  it("finds quantiles with the engine's own model of the bins", () => {
    const q = quantile(skewed, 0.95);
    expect(unitsAbove(skewed, q)).toBeCloseTo(5, 6);
    expect(q).toBeGreaterThan(60_000);
    expect(q).toBeLessThan(200_000);
    expect(quantile(testland.distributions.income, 0.5)).toBeCloseTo(15, 6);
  });

  it("rounds the knee up to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceCeil(78_914)).toBe(100_000);
    expect(niceCeil(110_123)).toBe(200_000);
    expect(niceCeil(2_100)).toBe(2_500);
    expect(niceCeil(45)).toBe(50);
    expect(niceCeil(100)).toBe(100);
    expect(niceCeil(0)).toBe(0);
  });

  it("compresses the top only where the units would be crowded at the left edge", () => {
    expect(chooseScale(skewed, 0, 1_000_000)).toEqual({ min: 0, max: 1_000_000, knee: 100_000, split: 0.7 });
    // Testland's incomes fill most of the range: linear.
    expect(chooseScale(testland.distributions.income, 0, 60)).toEqual({ min: 0, max: 60, knee: null, split: 1 });
    // A narrower range is not crowded.
    expect(chooseScale(skewed, 0, 300_000).knee).toBeNull();
    expect(chooseScale(undefined, 0, 10).knee).toBeNull();
  });
});

describe("the compressed scale", () => {
  const scale: XScale = { min: 0, max: 1_000_000, knee: 100_000, split: 0.7 };

  it("is linear up to the knee and linear again above it", () => {
    expect(toFraction(scale, 0)).toBe(0);
    expect(toFraction(scale, 50_000)).toBeCloseTo(0.35, 12);
    expect(toFraction(scale, 100_000)).toBeCloseTo(0.7, 12);
    expect(toFraction(scale, 550_000)).toBeCloseTo(0.85, 12);
    expect(toFraction(scale, 1_000_000)).toBe(1);
    // Outside the range: at the edges.
    expect(toFraction(scale, -5)).toBe(0);
    expect(toFraction(scale, 2e6)).toBe(1);
  });

  it("maps back exactly, so a point near 12,000 and one at 1,000,000 can both be reached", () => {
    for (const value of [0, 11_784, 12_000, 66_760, 99_999, 100_000, 277_825, 999_999, 1_000_000]) {
      expect(fromFraction(scale, toFraction(scale, value))).toBeCloseTo(value, 6);
    }
    // On a plot 700 px wide: one pixel is about 143 euros below the knee and about 4,300 above it.
    expect(valuePerPixel(scale, 12_000, 700)).toBeCloseTo(100_000 / 490, 9);
    expect(valuePerPixel(scale, 500_000, 700)).toBeCloseTo(900_000 / 210, 9);
    expect(fromFraction(scale, 1)).toBe(1_000_000);
    expect(fromFraction(scale, 12_000 / 100_000 * 0.7)).toBeCloseTo(12_000, 6);
  });

  it("is a plain linear scale without a knee", () => {
    const linear: XScale = { min: 0, max: 60, knee: null, split: 1 };
    expect(toFraction(linear, 15)).toBe(0.25);
    expect(fromFraction(linear, 0.25)).toBe(15);
    expect(valuePerPixel(linear, 15, 600)).toBe(0.1);
  });
});

describe("ticks", () => {
  const scale: XScale = { min: 0, max: 1_000_000, knee: 100_000, split: 0.7 };

  it("give each part of a compressed scale its own step and always show the knee", () => {
    const ticks = xTicks(scale, 1000, 70);
    // 10,000 euros are 70 px below the knee; above it 250,000 would crowd the knee and is left out.
    expect(ticks).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000, 500_000, 750_000, 1_000_000]);
    expect(xTicks(scale, 1000, 100)).toEqual([0, 20_000, 40_000, 60_000, 80_000, 100_000, 500_000, 1_000_000]);
    // On a phone there is room for less.
    expect(xTicks(scale, 300, 70)).toEqual([0, 50_000, 100_000, 1_000_000]);
  });

  it("are never closer than the gap", () => {
    for (const width of [200, 330, 600, 1000]) {
      const at = xTicks(scale, width, 64).map((value) => toFraction(scale, value) * width);
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(64);
    }
  });

  it("on a linear axis are round multiples", () => {
    expect(linearTicks(0, 80, 360, 40)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(linearTicks(0, 80, 160, 40)).toEqual([0, 20, 40, 60, 80]);
    expect(linearTicks(0, 80, 150, 40)).toEqual([0, 25, 50, 75]);
    expect(linearTicks(0, 60, 600, 70)).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });
});
