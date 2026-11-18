import { describe, expect, it } from "vitest";
import {
  bracketsToCurve,
  curveAffected,
  curveAverageRate,
  curveOwed,
  curveRate,
  curveTotal,
  payMoreOrLess,
  scheduleBands,
  type RateCurve,
  type ScheduleBand,
} from "./curve.ts";
import { affectedUnits, scheduleAmount, scheduleTotal, totalUnits, unitsAbove, type Bracket } from "./distribution.ts";
import { testland } from "./__fixtures__/testland.ts";
import type { Distribution, DistributionBin, ParetoTail } from "./types.ts";

function dist(bins: DistributionBin[], tail?: ParetoTail): Distribution {
  return { id: "d", label: { en: "d" }, variable: { en: "x" }, unit: { en: "units" }, year: 2024, bins, tail, quality: "estimate", sources: [] };
}

const curve = (points: [number, number][], scale?: number): RateCurve => ({ points: points.map(([x, y]) => ({ x, y })), scale });

/** 20 units spread evenly over [0, 10]: unitsAbove(t) = 20 - 2t. */
const uniform = dist([{ from: 0, to: 10, count: 20, mean: 5 }]);
/** Testland incomes: 20 units on [0, 10], 20 on [10, 30], 10 on [30, 50], all evenly spread. */
const income = testland.distributions.income;
/** Testland wealth: a negative bin, two skewed bins and a Pareto tail of 5 units above 1000 with alpha 2. */
const wealth = testland.distributions.wealth;
/** 45 units evenly on [0, 1000] and a tail of 5 units above 1000. */
const withTail = (alpha: number): Distribution => dist([{ from: 0, to: 1000, count: 45, mean: 500 }], { from: 1000, count: 5, alpha });

/** Today's Testland tariff, 20 % from 10 and 40 % from 30, as brackets and as curve points in percent. */
const brackets: Bracket[] = [
  { from: 10, rate: 0.2 },
  { from: 30, rate: 0.4 },
];
const today = curve([[10, 20], [30, 20], [30, 40]], 0.01);
/** The fixture's default reform: 10 % at 10, rising linearly to 40 % at 30. */
const ramp = curve([[10, 10], [30, 40]], 0.01);

function expectClose(actual: number, expected: number, relative = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(relative * Math.max(1, Math.abs(expected)));
}

/** Every value at which the rate or the density can have a kink or a jump. */
function breakpoints(d: Distribution, ...curves: RateCurve[]): number[] {
  const xs = curves.flatMap((c) => c.points.map((p) => p.x));
  for (const bin of d.bins) xs.push(bin.from, bin.mean, bin.to);
  if (d.tail) xs.push(d.tail.from);
  return [...new Set(xs)].sort((a, b) => a - b);
}

/** Integral of f over [a, b] by the midpoint rule, which never evaluates f at a breakpoint. */
function midpoint(f: (t: number) => number, a: number, b: number, slices = 4000): number {
  const h = (b - a) / slices;
  let sum = 0;
  for (let i = 0; i < slices; i++) sum += f(a + (i + 0.5) * h);
  return sum * h;
}

/**
 * Integral of rate * unitsAbove by brute force, from the public single-value functions only.
 * Above the last breakpoint the rate is constant, where the bracket code gives the exact rest.
 */
function bruteTotal(d: Distribution, c: RateCurve): number {
  const xs = breakpoints(d, c);
  let sum = 0;
  for (let i = 0; i + 1 < xs.length; i++) sum += midpoint((t) => curveRate(c, t) * unitsAbove(d, t), xs[i], xs[i + 1]);
  const last = xs[xs.length - 1];
  return sum + scheduleTotal(d, [{ from: last, rate: curveRate(c, last) }]);
}

/** What a unit owes by brute force: the marginal rate integrated piece by piece up to v. */
function bruteOwed(c: RateCurve, v: number): number {
  const xs = c.points.map((p) => p.x).filter((x) => x < v);
  const stops = [...new Set(xs), v];
  let sum = 0;
  for (let i = 0; i + 1 < stops.length; i++) sum += midpoint((t) => curveRate(c, t), stops[i], stops[i + 1], 2000);
  return sum;
}

describe("the marginal rate of a curve", () => {
  const c = curve([[10, 0.1], [30, 0.3], [30, 0.4], [50, 0.5]]);

  it("is 0 below the first point, interpolated between points and constant above the last", () => {
    expect(curveRate(c, -5)).toBe(0);
    expect(curveRate(c, 9.99)).toBe(0);
    expect(curveRate(c, 10)).toBe(0.1);
    expect(curveRate(c, 20)).toBeCloseTo(0.2, 12);
    expect(curveRate(c, 40)).toBeCloseTo(0.45, 12);
    expect(curveRate(c, 50)).toBe(0.5);
    expect(curveRate(c, 1e9)).toBe(0.5);
  });

  it("at a step the later point applies from there upward", () => {
    expect(curveRate(c, 29.999999)).toBeCloseTo(0.3, 6);
    expect(curveRate(c, 30)).toBe(0.4);
    expect(curveRate(curve([[10, 0.1], [10, 0.2], [10, 0.3]]), 10)).toBe(0.3);
  });

  it("is multiplied by the scale", () => {
    expect(curveRate(today, 20)).toBeCloseTo(0.2, 12);
    expect(curveRate(today, 30)).toBeCloseTo(0.4, 12);
    expect(curveRate(curve([]), 5)).toBe(0);
  });
});

describe("what one unit owes", () => {
  it("is the integral of the marginal rate up to its value", () => {
    // The ramp: T(v) = 0.1 u + 0.0075 u^2 with u = v - 10 up to 30, then 5 + 0.4 (v - 30).
    expect(curveOwed(ramp, 5)).toBe(0);
    expect(curveOwed(ramp, 10)).toBe(0);
    expect(curveOwed(ramp, 20)).toBeCloseTo(1.75, 12);
    expect(curveOwed(ramp, 30)).toBeCloseTo(5, 12);
    expect(curveOwed(ramp, 45)).toBeCloseTo(11, 12);
    expect(curveOwed(ramp, -3)).toBe(0);
    expect(curveOwed(curve([]), 100)).toBe(0);
  });

  it("equals the bracket code for a pure step function", () => {
    const steps = bracketsToCurve(brackets);
    expect(steps.points).toEqual([
      { x: 10, y: 0.2 },
      { x: 30, y: 0.2 },
      { x: 30, y: 0.4 },
    ]);
    for (const v of [-10, 0, 10, 10.5, 20, 30, 30.5, 45, 1000]) {
      expect(curveOwed(steps, v)).toBeCloseTo(scheduleAmount(brackets, v), 12);
      expect(curveOwed(today, v)).toBeCloseTo(scheduleAmount(brackets, v), 12);
    }
  });

  it("agrees with integrating the rate numerically", () => {
    const wiggly = curve([[2, 5], [8, 30], [8, 12], [15, 12], [22, 45], [40, 20], [40, 50]], 0.01);
    for (const v of [1, 2, 5, 8, 11, 15, 19.5, 22, 33, 40, 47]) expectClose(curveOwed(wiggly, v), bruteOwed(wiggly, v), 1e-7);
  });

  it("gives the average rate", () => {
    expect(curveAverageRate(today, 45)).toBeCloseTo(10 / 45, 12);
    expect(curveAverageRate(ramp, 20)).toBeCloseTo(1.75 / 20, 12);
    expect(curveAverageRate(ramp, 0)).toBe(0);
    expect(curveAverageRate(ramp, -5)).toBe(0);
    // The average rate approaches the top marginal rate from below.
    expect(curveAverageRate(today, 1e9)).toBeCloseTo(0.4, 6);
  });
});

describe("totals over a distribution", () => {
  it("a flat curve equals the equivalent single bracket", () => {
    for (const d of [uniform, income, wealth, withTail(1.5)]) {
      for (const from of [-50, 0, 4, 25, 400, 1000, 2500]) {
        expectClose(curveTotal(d, curve([[from, 0.3]])), scheduleTotal(d, [{ from, rate: 0.3 }]), 1e-12);
        expectClose(curveTotal(d, curve([[from, 30]], 0.01)), scheduleTotal(d, [{ from, rate: 0.3 }]), 1e-12);
      }
    }
    expect(curveTotal(income, today)).toBeCloseTo(120, 10);
  });

  it("a pure step curve equals the equivalent brackets", () => {
    const sets: Bracket[][] = [
      brackets,
      [{ from: 0, rate: 0.1 }],
      [{ from: 0, rate: 0 }, { from: 5, rate: 0.14 }, { from: 12, rate: 0.24 }, { from: 33, rate: 0.42 }, { from: 45, rate: 0.45 }],
      [{ from: -80, rate: 0.01 }, { from: 50, rate: 0.02 }, { from: 400, rate: 0.03 }, { from: 1000, rate: 0.04 }, { from: 3000, rate: 0.05 }],
      [{ from: 20, rate: 0.5 }, { from: 21, rate: 0.1 }, { from: 2000, rate: 0.6 }],
    ];
    for (const d of [uniform, income, wealth, withTail(1.3), withTail(2), withTail(4)]) {
      for (const set of sets) expectClose(curveTotal(d, bracketsToCurve(set)), scheduleTotal(d, set), 1e-12);
    }
  });

  it("a single linear ramp over one uniform bin matches the analytic integral", () => {
    // Rate 0.05 t on [0, 10], unitsAbove 20 - 2t: integral of 0.05 t (20 - 2t) = 0.05 * (1000 - 2000/3) = 50/3.
    expectClose(curveTotal(uniform, curve([[0, 0], [10, 0.5]])), 50 / 3, 1e-13);
    // The same through what each unit owes: T(v) = 0.025 v^2, and the mean of v^2 on [0, 10] is 100/3.
    expectClose(20 * 0.025 * (100 / 3), 50 / 3, 1e-13);
    // A ramp inside the bin, flat afterwards: 0.1 at 2 rising to 0.3 at 6.
    //   [2, 6]: (0.1 + 0.05 u)(16 - 2u) integrated over u in [0, 4] = 6.4 + 4.8 - 6.4/3
    //   [6, 10]: 0.3 * 16
    expectClose(curveTotal(uniform, curve([[2, 0.1], [6, 0.3]])), 6.4 + 4.8 - 6.4 / 3 + 4.8, 1e-13);
  });

  it("the fixture's ramp over three bins is 130", () => {
    // [10, 30]: (0.1 + 0.015 u)(30 - u) over u in [0, 20] = 60 + 70 - 40 = 90; above 30: 0.4 * 100 = 40.
    expectClose(curveTotal(income, ramp), 130, 1e-13);
  });

  describe("a ramp inside the Pareto tail matches the closed form", () => {
    // Rate rising from 0 at a to r at b and flat above, on a tail of n units above xm:
    //   r n xm^alpha * ( I / (b - a) + b^(1 - alpha) / (alpha - 1) ),  I = integral of (t - a) t^-alpha over [a, b]
    const n = 5;
    const xm = 1000;
    const closedForm = (alpha: number, a: number, b: number, r: number): number => {
      const inner =
        alpha === 2
          ? Math.log(b / a) + a / b - 1
          : (b ** (2 - alpha) - a ** (2 - alpha)) / (2 - alpha) - (a * (b ** (1 - alpha) - a ** (1 - alpha))) / (1 - alpha);
      return r * n * xm ** alpha * (inner / (b - a) + b ** (1 - alpha) / (alpha - 1));
    };

    it("for ordinary exponents", () => {
      for (const alpha of [1.2, 1.5, 2.5, 3, 4.7]) {
        expectClose(curveTotal(withTail(alpha), curve([[1500, 0], [4000, 0.02]])), closedForm(alpha, 1500, 4000, 0.02), 1e-11);
        expectClose(curveTotal(withTail(alpha), curve([[1000, 0], [1000.5, 0.02]])), closedForm(alpha, 1000, 1000.5, 0.02), 1e-9);
      }
    });

    it("for alpha = 2, where the power formula divides by zero and the integral is a logarithm", () => {
      const total = curveTotal(withTail(2), curve([[1500, 0], [4000, 0.02]]));
      expect(Number.isFinite(total)).toBe(true);
      expectClose(total, closedForm(2, 1500, 4000, 0.02), 1e-12);
      // Hand-checked on the fixture: 0.02 * 5 * 1000^2 * ((ln 3 - 1 + 1/3) / 2000 + 1/3000)
      expectClose(curveTotal(wealth, curve([[1000, 0], [3000, 0.02]])), 0.02 * 5 * 1e6 * ((Math.log(3) - 2 / 3) / 2000 + 1 / 3000), 1e-12);
    });

    it("continuously in alpha around 2", () => {
      const at = (alpha: number) => curveTotal(withTail(alpha), curve([[1500, 0], [4000, 0.02]]));
      for (const step of [1e-6, 1e-9, 1e-12, 1e-15]) {
        expectClose(at(2 + step), at(2), 1e-5 * step * 1e6 + 1e-12);
        expectClose(at(2 - step), at(2), 1e-5 * step * 1e6 + 1e-12);
      }
    });

    it("for a ramp that starts in the bins and ends in the tail", () => {
      for (const alpha of [1.5, 2, 3]) expectClose(curveTotal(withTail(alpha), curve([[600, 0.1], [2600, 0.5]])), bruteTotal(withTail(alpha), curve([[600, 0.1], [2600, 0.5]])), 1e-7);
    });
  });

  it("agrees with brute-force numerical integration for an arbitrary curve", () => {
    const wiggly = curve([[2, 5], [8, 30], [8, 12], [15, 12], [22, 45], [40, 20], [40, 50]], 0.01);
    expectClose(curveTotal(income, wiggly), bruteTotal(income, wiggly), 1e-7);
    const wide = curve([[-60, 1], [0, 0], [50, 0.5], [100, 2], [100, 1], [700, 1.5], [1000, 3], [1800, 2], [5000, 4]], 0.01);
    expectClose(curveTotal(wealth, wide), bruteTotal(wealth, wide), 1e-7);
  });

  it("handles curves that start below or end above the distribution, and empty ones", () => {
    expect(curveTotal(income, curve([]))).toBe(0);
    // Entirely above a distribution without a tail: nobody is there.
    expect(curveTotal(income, curve([[60, 0.3], [80, 0.5]]))).toBe(0);
    // A point exactly at the top edge.
    expect(curveTotal(income, curve([[50, 0.3]]))).toBe(0);
    // Starting below the lowest value: everybody pays the rate on everything above the start.
    expectClose(curveTotal(income, curve([[-10, 0.1]])), 0.1 * (900 + 10 * 50), 1e-13);
    // A distribution without bins above zero width issues: a single point curve at the first edge.
    expectClose(curveTotal(uniform, curve([[0, 0.5]])), 50, 1e-13);
  });

  it("handles ramps and steps that lie below the lowest value of the distribution", () => {
    // 20 units evenly on [10, 20]; every one of them is above everything that happens below 10.
    const high = dist([{ from: 10, to: 20, count: 20, mean: 15 }]);
    // A ramp from 0 at 0 to 0.5 at 10, flat above: everyone owes 2.5 for the ramp, plus 0.5 per unit above 10.
    expectClose(curveTotal(high, curve([[0, 0], [10, 0.5]])), 20 * 2.5 + 0.5 * 20 * 5, 1e-13);
    // The ramp ends before the distribution starts: 0.25 * 4 for the ramp, then 0.5 on everything above 4.
    expectClose(curveTotal(high, curve([[0, 0], [4, 0.5]])), 20 * (1 + 0.5 * 6) + 0.5 * 20 * 5, 1e-13);
    // Steps below the distribution: 10 % from 2, 30 % from 5.
    expectClose(curveTotal(high, curve([[2, 0.1], [5, 0.1], [5, 0.3]])), 20 * (0.1 * 3 + 0.3 * 5) + 0.3 * 20 * 5, 1e-13);
    expectClose(curveTotal(high, curve([[2, 0.1], [5, 0.1], [5, 0.3]])), scheduleTotal(high, [{ from: 2, rate: 0.1 }, { from: 5, rate: 0.3 }]), 1e-13);
    // A ramp that starts below and ends inside.
    const across = curve([[4, 0.1], [16, 0.4]]);
    expectClose(curveTotal(high, across), bruteTotal(high, across), 1e-7);
    // The bands see the part below as well.
    expectClose(scheduleBands(high, curve([[0, 0], [10, 0.5]]))[0].reform, 100, 1e-13);
  });

  it("is linear in the scale and in every y", () => {
    const a = curve([[5, 10], [20, 30], [45, 50]], 0.01);
    const b = curve([[5, 20], [20, 10], [45, 40]], 0.01);
    const middle = curve([[5, 15], [20, 20], [45, 45]], 0.01);
    expectClose(curveTotal(income, middle), (curveTotal(income, a) + curveTotal(income, b)) / 2, 1e-13);
    expectClose(curveTotal(income, { points: a.points, scale: 0.02 }), 2 * curveTotal(income, a), 1e-13);
  });
});

describe("continuity", () => {
  /** The total may change by at most (largest rate) * (all units) * (distance moved), with some slack for the slope. */
  function expectSmooth(d: Distribution, at: (x: number) => RateCurve, from: number, to: number, step: number, bound: number): void {
    let previous = curveTotal(d, at(from));
    for (let x = from + step; x <= to; x += step) {
      const current = curveTotal(d, at(x));
      expect(Math.abs(current - previous)).toBeLessThanOrEqual(bound * step);
      previous = current;
    }
  }

  it("when a point is dragged across bin edges and bin means", () => {
    // Income has edges at 0, 10, 30, 50 and means at 5, 20, 40.
    expectSmooth(income, (x) => curve([[2, 0.1], [x, 0.3], [48, 0.5]]), 3, 47, 0.01, 0.5 * 50 * 2);
    // Close up around every edge and mean.
    for (const edge of [5, 10, 20, 30, 40]) {
      const at = (x: number) => curveTotal(income, curve([[2, 0.1], [x, 0.3], [48, 0.5]]));
      expect(Math.abs(at(edge + 1e-7) - at(edge))).toBeLessThan(1e-5);
      expect(Math.abs(at(edge) - at(edge - 1e-7))).toBeLessThan(1e-5);
    }
  });

  it("when a point is dragged past the start of the tail", () => {
    expectSmooth(wealth, (x) => curve([[100, 0.01], [x, 0.03], [4000, 0.02]]), 900, 1100, 0.05, 0.03 * 50 * 2);
    const at = (x: number) => curveTotal(wealth, curve([[100, 0.01], [x, 0.03], [4000, 0.02]]));
    expect(Math.abs(at(1000 + 1e-6) - at(1000))).toBeLessThan(1e-5);
    expect(Math.abs(at(1000) - at(1000 - 1e-6))).toBeLessThan(1e-5);
    // The last point too, whose rate applies all the way up.
    expectSmooth(wealth, (x) => curve([[100, 0.01], [x, 0.03]]), 900, 1100, 0.05, 0.03 * 50 * 2);
  });

  it("when a point is dragged up to another one, where the steep ramp becomes a step", () => {
    // B stays at (30, 0.4). A comes from the left with rate 0.2: in the limit A and B form the step 0.2 -> 0.4 at 30.
    const step = curveTotal(income, curve([[10, 0.2], [30, 0.2], [30, 0.4], [50, 0.4]]));
    for (const gap of [1e-3, 1e-6, 1e-9, 1e-12]) {
      const near = curveTotal(income, curve([[10, 0.2], [30 - gap, 0.2], [30, 0.4], [50, 0.4]]));
      expect(Number.isFinite(near)).toBe(true);
      expect(Math.abs(near - step)).toBeLessThanOrEqual(0.4 * 50 * gap + 1e-12);
    }
    expectClose(step, 120, 1e-13);
  });

  it("but not beyond: a point dragged past its neighbour changes places with it, which is another curve", () => {
    // Before the crossing the order is A (rate 0.1), B (rate 0.5); after it, B, A. At the same x
    // the two orders are two different steps: up to 0.1 then 0.5, or up to 0.5 then 0.1.
    const before = curveTotal(income, curve([[0, 0], [20, 0.1], [20, 0.5], [50, 0.5]]));
    const after = curveTotal(income, curve([[0, 0], [20, 0.5], [20, 0.1], [50, 0.5]]));
    expect(Math.abs(before - after)).toBeGreaterThan(1);
    // Each side is continuous up to the meeting point.
    expect(Math.abs(curveTotal(income, curve([[0, 0], [20 - 1e-9, 0.1], [20, 0.5], [50, 0.5]])) - before)).toBeLessThan(1e-6);
    expect(Math.abs(curveTotal(income, curve([[0, 0], [20, 0.5], [20 + 1e-9, 0.1], [50, 0.5]])) - after)).toBeLessThan(1e-6);
    // With equal rates the two points can pass each other without any effect.
    const same = (xa: number) => curveTotal(income, curve([[0, 0], [Math.min(xa, 20), 0.3], [Math.max(xa, 20), 0.3], [50, 0.5]]));
    expect(Math.abs(same(20 + 1e-9) - same(20 - 1e-9))).toBeLessThan(1e-6);
  });

  it("in the rate of every point", () => {
    const at = (y: number) => curveTotal(wealth, curve([[0, 0.01], [500, y], [1000, 0.02], [2500, y]]));
    expectClose(at(0.03) - at(0.02), at(0.02) - at(0.01), 1e-9);
  });
});

describe("affected units", () => {
  it("agree with the bracket code for step functions", () => {
    const higher: Bracket[] = [
      { from: 10, rate: 0.2 },
      { from: 30, rate: 0.5 },
    ];
    expect(curveAffected(income, bracketsToCurve(higher), bracketsToCurve(brackets))).toEqual(affectedUnits(income, higher, brackets));
    expect(curveAffected(income, bracketsToCurve(higher))).toEqual(affectedUnits(income, higher));
    expect(curveAffected(income, bracketsToCurve(brackets), today)).toEqual({ threshold: null, units: 0, share: 0 });
    expect(curveAffected(wealth, bracketsToCurve([{ from: 1000, rate: 0.01 }]))).toEqual({ threshold: 1000, units: 5, share: 0.1 });
  });

  it("start at the lowest value where the rates differ, or begin to drift apart", () => {
    // The ramp starts at 10 with 10 % where today's tariff has 20 %.
    expect(curveAffected(income, ramp, today)).toEqual({ threshold: 10, units: 30, share: 0.6 });
    // Same rate at 10, but the reform rises from there while today's tariff stays flat.
    expect(curveAffected(income, curve([[10, 20], [30, 40]], 0.01), today).threshold).toBe(10);
    // Identical up to 30, then a different top rate.
    expect(curveAffected(income, curve([[10, 20], [30, 20], [30, 45]], 0.01), today)).toEqual({ threshold: 30, units: 10, share: 0.2 });
    // An extra point on a straight line changes nothing.
    expect(curveAffected(income, curve([[10, 10], [20, 25], [30, 40]], 0.01), ramp).threshold).toBeNull();
    // A new point above everything today's tariff knows.
    expect(curveAffected(income, curve([[10, 20], [30, 20], [30, 40], [40, 40], [45, 50]], 0.01), today)).toEqual({ threshold: 40, units: 5, share: 0.1 });
    // No curve at all against today's tariff: everyone who pays today.
    expect(curveAffected(income, curve([]), today).threshold).toBe(10);
    expect(curveAffected(income, curve([]), curve([]))).toEqual({ threshold: null, units: 0, share: 0 });
  });
});

describe("bands of the distribution", () => {
  const sum = (bands: ScheduleBand[], key: "units" | "baseline" | "reform" | "delta") => bands.reduce((total, band) => total + band[key], 0);

  /** What the units between two values owe, by brute force: thin slices of units times what a unit in the slice owes. */
  function bruteBand(d: Distribution, c: RateCurve, from: number, to: number): number {
    const xs = breakpoints(d, c).filter((x) => x > from && x < to);
    const stops = [from, ...xs, to];
    let total = 0;
    for (let i = 0; i + 1 < stops.length; i++) {
      const slices = 2000;
      const h = (stops[i + 1] - stops[i]) / slices;
      for (let k = 0; k < slices; k++) {
        const lo = stops[i] + k * h;
        total += (unitsAbove(d, lo) - unitsAbove(d, lo + h)) * curveOwed(c, lo + h / 2);
      }
    }
    return total;
  }

  it("by default are the distribution's own bins", () => {
    const bands = scheduleBands(income, ramp, today);
    // [0, 10): nobody pays. [10, 30): 20 units owe 40 in total either way. [30, 50): 8 each today, 9 each after.
    expect(bands).toHaveLength(3);
    expect(bands[0]).toEqual({ from: 0, to: 10, units: 20, baseline: 0, reform: 0, delta: 0, perUnit: 0 });
    expect(bands[1]).toMatchObject({ from: 10, to: 30, units: 20 });
    expectClose(bands[1].baseline, 40, 1e-12);
    expectClose(bands[1].reform, 40, 1e-12);
    expect(bands[2]).toMatchObject({ from: 30, to: 50, units: 10 });
    expectClose(bands[2].baseline, 80, 1e-12);
    expectClose(bands[2].reform, 90, 1e-12);
    expectClose(bands[2].delta, 10, 1e-11);
    expectClose(bands[2].perUnit, 1, 1e-11);
    // Together they are the model totals.
    expectClose(sum(bands, "baseline"), curveTotal(income, today), 1e-12);
    expectClose(sum(bands, "reform"), curveTotal(income, ramp), 1e-12);
  });

  it("include an open band for the tail", () => {
    const tax = curve([[100, 1], [1000, 1], [3000, 3]], 0.01);
    const bands = scheduleBands(wealth, tax);
    expect(bands.map((band) => [band.from, band.to, band.units])).toEqual([
      [-100, 0, 5],
      [0, 100, 30],
      [100, 1000, 10],
      [1000, Infinity, 5],
    ]);
    expect(bands.every((band) => band.baseline === 0)).toBe(true);
    expectClose(sum(bands, "reform"), curveTotal(wealth, tax), 1e-12);
    expect(sum(bands, "units")).toBe(totalUnits(wealth));
    // The band of the tail: what the five richest owe.
    expectClose(bands[3].reform, curveTotal(wealth, tax) - bands[2].reform, 1e-12);
    expectClose(bands[2].reform, bruteBand(wealth, tax, 100, 1000), 1e-6);
  });

  it("agree with brute force on every band, with and without a baseline", () => {
    const wiggly = curve([[2, 5], [8, 30], [8, 12], [15, 12], [22, 45], [40, 20], [40, 50]], 0.01);
    for (const band of scheduleBands(income, wiggly, today)) {
      expectClose(band.reform, bruteBand(income, wiggly, band.from, band.to), 1e-6);
      expectClose(band.baseline, bruteBand(income, today, band.from, band.to), 1e-6);
      expectClose(band.delta, band.reform - band.baseline, 1e-12);
      expectClose(band.perUnit, band.delta / band.units, 1e-12);
    }
  });

  it("can use the caller's edges", () => {
    const edges = [0, 5, 12.5, 25, 37.5];
    const bands = scheduleBands(income, ramp, today, edges);
    expect(bands.map((band) => [band.from, band.to])).toEqual([[0, 5], [5, 12.5], [12.5, 25], [25, 37.5], [37.5, Infinity]]);
    expect(bands.map((band) => band.units)).toEqual([10, 12.5, 12.5, 8.75, 6.25]);
    for (const band of bands.slice(0, 4)) expectClose(band.reform, bruteBand(income, ramp, band.from, band.to), 1e-6);
    expectClose(bands[4].reform, bruteBand(income, ramp, 37.5, 50), 1e-6);
    expectClose(sum(bands, "reform"), 130, 1e-12);
    expectClose(sum(bands, "baseline"), 120, 1e-12);
    // No open band when nothing lies above the last edge; units below the first edge are left out.
    const inner = scheduleBands(income, ramp, today, [10, 30, 50]);
    expect(inner.map((band) => [band.from, band.to, band.units])).toEqual([[10, 30, 20], [30, 50, 10]]);
    expect(scheduleBands(income, ramp, today, [])).toEqual([]);
    // Typed arrays work as edges.
    expect(scheduleBands(income, ramp, today, Float64Array.from(edges))).toEqual(bands);
  });

  it("counts a bin whose mean sits on its edge with that bin", () => {
    // All 4 units of the first bin sit at 10, all 6 of the second at 10 as well (its lower edge).
    const d = dist([
      { from: 0, to: 10, count: 4, mean: 10 },
      { from: 10, to: 20, count: 6, mean: 10 },
      { from: 20, to: 30, count: 2, mean: 25 },
    ]);
    const tax = curve([[0, 0.1]]);
    const bands = scheduleBands(d, tax);
    expect(bands.map((band) => band.units)).toEqual([4, 6, 2]);
    expectClose(bands[0].reform, 4 * 1, 1e-12);
    expectClose(bands[1].reform, 6 * 1, 1e-12);
    expectClose(bands[2].reform, 2 * 2.5, 1e-12);
    expectClose(sum(bands, "reform"), curveTotal(d, tax), 1e-12);
  });

  it("reuses the objects of a previous result when asked to", () => {
    const first = scheduleBands(wealth, ramp, today);
    const objects = [...first];
    const second = scheduleBands(wealth, curve([[0, 5]], 0.01), today, undefined, first);
    expect(second).toBe(first);
    second.forEach((band, i) => expect(band).toBe(objects[i]));
    expect(second).toEqual(scheduleBands(wealth, curve([[0, 5]], 0.01), today));
    // A shorter result truncates the array.
    expect(scheduleBands(income, ramp, today, [10, 30, 50], first)).toHaveLength(2);
  });
});

describe("who pays more and who pays less", () => {
  it("finds the crossing point exactly", () => {
    // Reform minus today for an income v = 10 + u between 10 and 30: 0.0075 u^2 - 0.1 u, zero at u = 13 1/3.
    // Below an income of 23 1/3 people pay less, above it more; above 30 everyone pays exactly 1 more.
    const split = payMoreOrLess(income, ramp, today, 0);
    expectClose(split.less, 40 / 3, 1e-12); // incomes between 10 and 23 1/3: one unit per currency unit
    expectClose(split.more, 20 / 3 + 10, 1e-12); // 23 1/3 to 30, and everyone above 30
    expectClose(split.same, 20, 1e-12); // the 20 units below 10 pay nothing either way
    expectClose(split.moreShare, (20 / 3 + 10) / 50, 1e-12);
    expectClose(split.lessShare, 40 / 3 / 50, 1e-12);
    expectClose(split.sameShare, 0.4, 1e-12);
  });

  it("treats differences within the tolerance as unchanged", () => {
    // |difference| > 0.2: less for u between the roots of 0.0075 u^2 - 0.1 u + 0.2, more beyond the root of ... - 0.2.
    const root = (c: number, sign: 1 | -1) => (0.1 + sign * Math.sqrt(0.01 - 4 * 0.0075 * c)) / 0.015;
    const split = payMoreOrLess(income, ramp, today, 0.2);
    expectClose(split.less, root(0.2, 1) - root(0.2, -1), 1e-12);
    expectClose(split.more, 20 - root(-0.2, 1) + 10, 1e-12);
    expectClose(split.more + split.less + split.same, 50, 1e-12);
    // The largest saving is 1/3 and the largest extra payment exactly 1: nobody is beyond a tolerance of 1.
    expect(payMoreOrLess(income, ramp, today)).toEqual({ more: 0, less: 0, same: 50, moreShare: 0, lessShare: 0, sameShare: 1 });
    // Just below 1 the ten units above 30 pay more, and so do those within a hair below 30.
    expectClose(payMoreOrLess(income, ramp, today, 0.999).more, 10 + 20 - root(-0.999, 1), 1e-12);
    expect(payMoreOrLess(income, ramp, today, 1 / 3 - 1e-9).less).toBeGreaterThan(0);
    expect(payMoreOrLess(income, ramp, today, 1 / 3 + 1e-9).less).toBe(0);
  });

  it("without a baseline everyone who owes anything pays more", () => {
    const split = payMoreOrLess(income, ramp, undefined, 0);
    expectClose(split.more, 30, 1e-12);
    expect(split.less).toBe(0);
    expectClose(split.same, 20, 1e-12);
    // In the tail: owing more than 1 under a 1 % tax above 1000 means wealth above 1100.
    const tailTax = payMoreOrLess(wealth, curve([[1000, 1]], 0.01));
    expectClose(tailTax.more, 5 * (1000 / 1100) ** 2, 1e-12);
    expectClose(tailTax.same, 50 - tailTax.more, 1e-12);
  });

  it("is all unchanged for the same schedule in two forms", () => {
    expect(payMoreOrLess(income, bracketsToCurve(brackets), today, 0)).toMatchObject({ more: 0, less: 0, same: 50 });
    expect(payMoreOrLess(income, curve([]), curve([]), 0)).toMatchObject({ more: 0, less: 0, same: 50 });
  });

  it("agrees with classifying thin slices of the distribution one by one", () => {
    const reform = curve([[0, 0], [15, 30], [25, 10], [25, 35], [45, 48]], 0.01);
    for (const tolerance of [0, 0.05, 0.5]) {
      let more = 0;
      let less = 0;
      const slices = 200000;
      const h = 50 / slices;
      for (let k = 0; k < slices; k++) {
        const lo = k * h;
        const units = unitsAbove(income, lo) - unitsAbove(income, lo + h);
        const difference = curveOwed(reform, lo + h / 2) - curveOwed(today, lo + h / 2);
        if (difference > tolerance) more += units;
        else if (difference < -tolerance) less += units;
      }
      const split = payMoreOrLess(income, reform, today, tolerance);
      expect(Math.abs(split.more - more)).toBeLessThan(1e-3);
      expect(Math.abs(split.less - less)).toBeLessThan(1e-3);
    }
  });

  it("handles several crossings and a reversal in the open top", () => {
    // Reform is lower up to 20, higher from 20 to 40, lower again above 40: the difference in what
    // is owed turns three times.
    const reform = curve([[0, 0], [20, 0], [20, 60], [40, 60], [40, 0]], 0.01);
    const flat = curve([[0, 20]], 0.01);
    // difference(v): -0.2 v up to 20 (-4 at 20); then +0.4 per unit: zero at 30, +4 at 40; then -0.2 per unit: zero at 60.
    const split = payMoreOrLess(income, reform, flat, 0);
    // more: incomes between 30 and 60, i.e. everyone above 30 (the distribution ends at 50): 10 units
    expectClose(split.more, 10, 1e-12);
    // less: incomes between 0 and 30: 40 units
    expectClose(split.less, 40, 1e-12);
    expectClose(split.same, 0, 1e-12);
    // With a tail the top reverses: wealth above 60 pays less again.
    const rich = dist([{ from: 0, to: 100, count: 100, mean: 50 }], { from: 100, count: 10, alpha: 2 });
    const top = payMoreOrLess(rich, reform, flat, 0);
    expectClose(top.more, 30, 1e-12); // 30 to 60
    expectClose(top.less, 30 + 40 + 10, 1e-12); // below 30, 60 to 100, and the tail
  });
});
