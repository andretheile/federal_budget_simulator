import { describe, expect, it } from "vitest";
import {
  affectedUnits,
  excessAbove,
  marginalRate,
  orderBrackets,
  scheduleAmount,
  scheduleTotal,
  totalAmount,
  totalUnits,
  unitsAbove,
} from "./distribution.ts";
import { testland } from "./__fixtures__/testland.ts";
import type { Distribution, DistributionBin, ParetoTail } from "./types.ts";

function dist(bins: DistributionBin[], tail?: ParetoTail): Distribution {
  return {
    id: "d",
    label: { en: "d" },
    variable: { en: "x" },
    unit: { en: "units" },
    year: 2024,
    bins,
    tail,
    quality: "estimate",
    sources: [],
  };
}

/** One bin whose mean is its midpoint: 20 units uniform on [0, 10]. */
const uniform = dist([{ from: 0, to: 10, count: 20, mean: 5 }]);

/** One skewed bin: 10 units on [100, 1000] with mean 400, so 20/3 units on [100, 400] and 10/3 on [400, 1000]. */
const skewed = dist([{ from: 100, to: 1000, count: 10, mean: 400 }]);

/** Pareto tail only matters above 1000: 5 units, alpha 2, mean 2000. */
const withTail = dist([{ from: 0, to: 1000, count: 45, mean: 500 }], { from: 1000, count: 5, alpha: 2 });

describe("a uniform bin", () => {
  it("counts the units above a threshold", () => {
    expect(unitsAbove(uniform, -1)).toBe(20);
    expect(unitsAbove(uniform, 0)).toBe(20);
    expect(unitsAbove(uniform, 2.5)).toBe(15);
    expect(unitsAbove(uniform, 5)).toBe(10);
    expect(unitsAbove(uniform, 10)).toBe(0);
    expect(unitsAbove(uniform, 11)).toBe(0);
  });

  it("matches the closed form n * (hi - a)^2 / (2 * (hi - lo)) for the excess", () => {
    expect(excessAbove(uniform, 0)).toBe(100); // everything: 20 * 5
    expect(excessAbove(uniform, 5)).toBe(25); // 20 * 5^2 / 20
    expect(excessAbove(uniform, 8)).toBe(4); // 20 * 2^2 / 20
    expect(excessAbove(uniform, 10)).toBe(0);
    expect(excessAbove(uniform, -3)).toBe(160); // 20 * (5 + 3)
  });
});

describe("a threshold inside a skewed bin", () => {
  it("in the upper part", () => {
    // Only the 10/3 units on [400, 1000] reach above 500.
    expect(unitsAbove(skewed, 500)).toBeCloseTo((10 / 3) * (500 / 600), 12);
    expect(excessAbove(skewed, 500)).toBeCloseTo(((10 / 3) * 500 ** 2) / (2 * 600), 9);
  });

  it("in the lower part", () => {
    // 20/3 units on [100, 400]: half of them are above 250. All 10/3 upper units are above it.
    expect(unitsAbove(skewed, 250)).toBeCloseTo(10 / 3 + 10 / 3, 12);
    // lower: (20/3) * 150^2 / (2 * 300) = 250; upper: (10/3) * (700 - 250) = 1500
    expect(excessAbove(skewed, 250)).toBeCloseTo(1750, 9);
  });

  it("exactly at the mean", () => {
    expect(unitsAbove(skewed, 400)).toBeCloseTo(10 / 3, 12);
    expect(excessAbove(skewed, 400)).toBeCloseTo((10 / 3) * 300, 9);
  });
});

describe("mean preservation", () => {
  it("keeps each bin's count and total", () => {
    expect(totalUnits(skewed)).toBe(10);
    expect(totalAmount(skewed)).toBe(4000);
    expect(unitsAbove(skewed, 100)).toBeCloseTo(10, 12);
    // The excess over the lower edge plus the edge itself for every unit is the bin total.
    expect(excessAbove(skewed, 100) + 10 * 100).toBe(4000);
    expect(excessAbove(skewed, 0)).toBe(4000);
  });

  it("holds when the density is integrated numerically", () => {
    // Midpoint rule over thin slices; the density is piecewise constant, so this is exact up to rounding.
    const steps = 9000;
    const width = 900 / steps;
    let count = 0;
    let total = 0;
    for (let i = 0; i < steps; i++) {
      const lo = 100 + i * width;
      const slice = unitsAbove(skewed, lo) - unitsAbove(skewed, lo + width);
      count += slice;
      total += slice * (lo + width / 2);
    }
    expect(count).toBeCloseTo(10, 9);
    expect(total).toBeCloseTo(4000, 6);
  });

  it("holds for every bin of the fixture distributions, negative values included", () => {
    for (const d of Object.values(testland.distributions)) {
      for (const bin of d.bins) {
        const single = dist([bin]);
        expect(excessAbove(single, bin.from) + bin.count * bin.from).toBeCloseTo(bin.count * bin.mean, 9);
        expect(unitsAbove(single, bin.from - 1)).toBe(bin.count);
      }
    }
    const wealth = testland.distributions.wealth;
    // 5 * -40 + 30 * 40 + 10 * 400 + tail 5 * 2000
    expect(totalAmount(wealth)).toBe(15000);
    expect(totalUnits(wealth)).toBe(50);
    expect(excessAbove(wealth, -100)).toBeCloseTo(15000 + 50 * 100, 9);
  });

  it("treats a mean on the bin edge as a point mass there", () => {
    const low = dist([{ from: 0, to: 10, count: 4, mean: 0 }]);
    expect(excessAbove(low, -2)).toBe(8);
    expect(excessAbove(low, 0)).toBe(0);
    expect(excessAbove(low, 5)).toBe(0);
    expect(unitsAbove(low, 0)).toBe(0);
    const high = dist([{ from: 0, to: 10, count: 4, mean: 10 }]);
    expect(excessAbove(high, 0)).toBe(40);
    expect(excessAbove(high, 5)).toBe(20);
    expect(unitsAbove(high, 5)).toBe(4);
    expect(unitsAbove(high, 10)).toBe(0);
  });
});

describe("the Pareto tail", () => {
  it("is in closed form for a threshold inside the tail", () => {
    // units above a: 5 * (1000 / a)^2; excess over a: that * a / (alpha - 1)
    expect(unitsAbove(withTail, 2000)).toBeCloseTo(1.25, 12);
    expect(excessAbove(withTail, 2000)).toBeCloseTo(2500, 9);
    expect(unitsAbove(withTail, 4000)).toBeCloseTo(5 / 16, 12);
    expect(excessAbove(withTail, 4000)).toBeCloseTo((5 / 16) * 4000, 9);
  });

  it("contributes count * (mean - a) below its start, with mean = alpha * from / (alpha - 1)", () => {
    expect(unitsAbove(withTail, 1000)).toBe(5);
    expect(excessAbove(withTail, 1000)).toBe(5000); // 5 * (2000 - 1000)
    expect(totalAmount(withTail)).toBe(45 * 500 + 5 * 2000);
    expect(excessAbove(withTail, 0)).toBe(45 * 500 + 5 * 2000);
  });

  it("works with a non-integer alpha", () => {
    const d = dist([{ from: 0, to: 100, count: 1, mean: 50 }], { from: 100, count: 8, alpha: 1.5 });
    // units above 400: 8 * (100/400)^1.5 = 1; excess: 1 * 400 / 0.5 = 800
    expect(unitsAbove(d, 400)).toBeCloseTo(1, 12);
    expect(excessAbove(d, 400)).toBeCloseTo(800, 9);
  });
});

describe("continuity", () => {
  const wealth = testland.distributions.wealth;
  const points = [-100, -40, 0, 40, 100, 400, 1000];

  it("has no jump at a bin edge, at a bin mean or where the tail starts", () => {
    const eps = 1e-6;
    for (const x of points) {
      const below = excessAbove(wealth, x - eps);
      const at = excessAbove(wealth, x);
      const above = excessAbove(wealth, x + eps);
      // The excess can change by at most (units above) * (distance moved).
      expect(below - at).toBeGreaterThanOrEqual(0);
      expect(below - at).toBeLessThanOrEqual(50 * eps * 1.01);
      expect(at - above).toBeGreaterThanOrEqual(0);
      expect(at - above).toBeLessThanOrEqual(50 * eps * 1.01);
    }
  });

  it("moves a schedule total smoothly while a threshold sweeps across the whole distribution", () => {
    const step = 0.5;
    let previous = scheduleTotal(wealth, [{ from: -150, rate: 0.01 }]);
    for (let from = -150 + step; from <= 3000; from += step) {
      const current = scheduleTotal(wealth, [{ from, rate: 0.01 }]);
      // Never increases when the threshold rises, and never drops faster than rate * all units.
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      expect(previous - current).toBeLessThanOrEqual(0.01 * 50 * step + 1e-9);
      previous = current;
    }
  });

  it("counts units continuously across edges when no mean sits on an edge", () => {
    const eps = 1e-7;
    for (const x of [0, 100, 1000]) {
      expect(unitsAbove(wealth, x - eps) - unitsAbove(wealth, x + eps)).toBeLessThan(1e-4);
    }
  });
});

describe("schedules", () => {
  const income = testland.distributions.income;
  const baseline = [
    { from: 10, rate: 0.2 },
    { from: 30, rate: 0.4 },
  ];

  it("computes what a single unit owes", () => {
    expect(scheduleAmount(baseline, 5)).toBe(0);
    expect(scheduleAmount(baseline, 10)).toBe(0);
    expect(scheduleAmount(baseline, 20)).toBeCloseTo(2, 12);
    expect(scheduleAmount(baseline, 40)).toBeCloseTo(0.2 * 20 + 0.4 * 10, 12);
    expect(marginalRate(baseline, 9.99)).toBe(0);
    expect(marginalRate(baseline, 10)).toBe(0.2);
    expect(marginalRate(baseline, 30)).toBe(0.4);
  });

  it("integrates a schedule over the distribution", () => {
    // Excess over 10 is 20 * 10 + 10 * 30 = 500, over 30 it is 10 * 10 = 100.
    expect(excessAbove(income, 10)).toBe(500);
    expect(excessAbove(income, 30)).toBe(100);
    // 0.2 * (500 - 100) + 0.4 * 100
    expect(scheduleTotal(income, baseline)).toBeCloseTo(120, 12);
    expect(scheduleTotal(income, [{ from: 0, rate: 0.1 }])).toBeCloseTo(90, 12); // 10 % of all income, 900
    expect(scheduleTotal(income, [])).toBe(0);
  });

  it("agrees with adding up single units", () => {
    // 1000 equally likely values per bin stand in for the uniform density.
    const brackets = [
      { from: 4, rate: 0.1 },
      { from: 17, rate: 0.25 },
      { from: 33, rate: 0.45 },
    ];
    let sum = 0;
    for (const bin of income.bins) {
      const n = 1000;
      for (let i = 0; i < n; i++) {
        const x = bin.from + ((i + 0.5) / n) * (bin.to - bin.from);
        sum += (bin.count / n) * scheduleAmount(brackets, x);
      }
    }
    expect(scheduleTotal(income, brackets)).toBeCloseTo(sum, 3);
  });

  it("raises a threshold that lies below its predecessor", () => {
    const fine = orderBrackets(baseline);
    expect(fine.adjusted).toBe(false);
    expect(fine.brackets).toEqual(baseline);

    const crossed = orderBrackets([
      { from: 40, rate: 0.2 },
      { from: 30, rate: 0.4 },
    ]);
    expect(crossed.adjusted).toBe(true);
    expect(crossed.brackets).toEqual([
      { from: 40, rate: 0.2 },
      { from: 40, rate: 0.4 },
    ]);
    // The first bracket has zero width: everything above 40 pays 40 %.
    expect(scheduleTotal(income, crossed.brackets)).toBeCloseTo(0.4 * excessAbove(income, 40), 12);
  });

  it("finds the units affected by a reform", () => {
    const reform = [
      { from: 10, rate: 0.2 },
      { from: 30, rate: 0.5 },
    ];
    expect(affectedUnits(income, reform, baseline)).toEqual({ threshold: 30, units: 10, share: 0.2 });
    // Without a baseline everything with a positive rate counts.
    expect(affectedUnits(income, reform)).toEqual({ threshold: 10, units: 30, share: 0.6 });
    // A leading bracket with rate 0 does not affect anyone.
    expect(affectedUnits(income, [{ from: 0, rate: 0 }, { from: 40, rate: 0.3 }])).toEqual({ threshold: 40, units: 5, share: 0.1 });
    // A new bracket inside an old one.
    expect(affectedUnits(income, [...baseline, { from: 45, rate: 0.45 }], baseline).threshold).toBe(45);
    // Identical schedules affect nobody.
    expect(affectedUnits(income, baseline, baseline)).toEqual({ threshold: null, units: 0, share: 0 });
  });
});
