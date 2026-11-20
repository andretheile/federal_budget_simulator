/**
 * Marginal-rate curves: what one unit owes, and totals over a binned distribution.
 *
 * A curve is a list of points ordered by x. The marginal rate is 0 below the first point, linear
 * between consecutive points and constant above the last one; two points with the same x are a
 * step, and the later one applies from x upward. Brackets are the special case of a pure step
 * function (see bracketsToCurve), so every schedule of the contract can be handled here.
 *
 * What a unit with value v owes is T(v), the integral of the marginal rate m up to v. Summed over
 * all units that is the integral of m(t) * unitsAbove(t) over t. With the within-bin model of
 * distribution.ts unitsAbove is linear between breakpoints, so the integrand is a product of two
 * linear functions on every piece and is integrated exactly. In the Pareto tail it is a linear
 * rate times a power law, which has a closed form as well.
 *
 * Nothing here allocates per call except where a result object is returned; a caller that
 * redraws on every pointer move can pass the same curve objects and reuse the band array.
 */
import { distributionShape, lastAtOrBelow, shapeAbove, type AffectedUnits, type Bracket, type DistributionShape } from "./distribution.ts";
import type { CurvePoint, Distribution } from "./types.ts";

/**
 * A marginal-rate curve ready for calculation: points ordered by x, the rate being y * (scale ?? 1).
 * This is the shape of a `points` baseline in a pack, so one can be passed as it is; the value of
 * a curve param becomes one by wrapping it: { points: value, scale: 0.01 }.
 */
export interface RateCurve {
  readonly points: readonly CurvePoint[];
  readonly scale?: number;
}

/** One band of a distribution in scheduleBands. */
export interface ScheduleBand {
  /** Lower edge, included. */
  from: number;
  /** Upper edge, excluded; Infinity for the open band at the top. */
  to: number;
  /** Units in the band. */
  units: number;
  /** What these units owe in total under the baseline (0 without one). */
  baseline: number;
  /** What they owe in total under the reform. */
  reform: number;
  /** reform - baseline */
  delta: number;
  /** delta / units; 0 for an empty band. */
  perUnit: number;
}

/** Result of payMoreOrLess. */
export interface PayMoreOrLess {
  /** Units that owe more under the reform than under the baseline, by more than the tolerance. */
  more: number;
  /** Units that owe less, by more than the tolerance. */
  less: number;
  /** Everybody else. */
  same: number;
  moreShare: number;
  lessShare: number;
  sameShare: number;
}

const EMPTY: RateCurve = Object.freeze({ points: Object.freeze([]) as readonly CurvePoint[] });

/** Rates that differ by less than this are the same rate. */
const RATE_EPSILON = 1e-12;

/**
 * The step function of a list of brackets as a curve. `brackets` must have non-decreasing
 * thresholds (see orderBrackets).
 */
export function bracketsToCurve(brackets: readonly Bracket[]): RateCurve {
  const points: CurvePoint[] = [];
  let previous = 0;
  brackets.forEach((bracket, i) => {
    // The first point needs no partner: the rate below it is 0 by definition.
    if (i > 0) points.push({ x: bracket.from, y: previous });
    points.push({ x: bracket.from, y: bracket.rate });
    previous = bracket.rate;
  });
  return { points };
}

/** Index of the last point with x <= v, or -1. With a step at v that is the later point. */
function lastPointAtOrBelow(points: readonly CurvePoint[], v: number): number {
  let i = points.length - 1;
  while (i >= 0 && points[i].x > v) i--;
  return i;
}

/** Marginal rate at v. At a step this is the rate that applies from there upward. */
export function curveRate(curve: RateCurve, v: number): number {
  const points = curve.points;
  const i = lastPointAtOrBelow(points, v);
  if (i < 0) return 0;
  const p = points[i];
  const scale = curve.scale ?? 1;
  if (i === points.length - 1) return p.y * scale;
  const q = points[i + 1]; // q.x > v >= p.x
  return (p.y + ((q.y - p.y) * (v - p.x)) / (q.x - p.x)) * scale;
}

/** Marginal rate just below v: differs from curveRate only where the curve has a step at v. */
function curveRateBelow(curve: RateCurve, v: number): number {
  const points = curve.points;
  let i = points.length - 1;
  while (i >= 0 && points[i].x >= v) i--;
  if (i < 0) return 0;
  const p = points[i];
  const scale = curve.scale ?? 1;
  if (i === points.length - 1) return p.y * scale;
  const q = points[i + 1]; // q.x >= v > p.x
  return (p.y + ((q.y - p.y) * (v - p.x)) / (q.x - p.x)) * scale;
}

/** What one unit with value v owes: the integral of the marginal rate up to v. */
export function curveOwed(curve: RateCurve, v: number): number {
  const points = curve.points;
  const n = points.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (v <= p.x) break;
    if (i === n - 1) {
      sum += p.y * (v - p.x);
      break;
    }
    const q = points[i + 1];
    const width = q.x - p.x;
    if (width <= 0) continue;
    const end = v < q.x ? v : q.x;
    const yEnd = p.y + ((q.y - p.y) * (end - p.x)) / width;
    sum += ((p.y + yEnd) / 2) * (end - p.x);
  }
  return sum * (curve.scale ?? 1);
}

/** What one unit with value v owes as a share of v. 0 for v <= 0. */
export function curveAverageRate(curve: RateCurve, v: number): number {
  return v > 0 ? curveOwed(curve, v) / v : 0;
}

/** (e^(q * L) - 1) / q, with its limit L at q = 0. L may be Infinity if q < 0. */
function growth(q: number, L: number): number {
  return q === 0 ? L : Math.expm1(q * L) / q;
}

/**
 * Integral over [a, b] of rate(t) * unitsAbove(t), where the rate runs linearly from `ra` at a to
 * `rb` at b. b may be Infinity if ra === rb.
 */
function piece(shape: DistributionShape, a: number, b: number, ra: number, rb: number): number {
  const { xs, nStart, nEnd, top } = shape;
  const slope = rb === ra ? 0 : (rb - ra) / (b - a);
  let sum = 0;
  let t = a;
  let rt = ra;

  // Below the first bin everybody is above.
  if (t < xs[0]) {
    const u = b < xs[0] ? b : xs[0];
    const ru = ra + slope * (u - a);
    sum += shape.total * ((rt + ru) / 2) * (u - t);
    t = u;
    rt = ru;
  }

  // Inside the bins: a product of two linear functions on every piece.
  if (t < b && t < top) {
    let i = lastAtOrBelow(xs, t);
    const last = xs.length - 1;
    while (t < b && i < last) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const u = b < x1 ? b : x1;
      const ru = ra + slope * (u - a);
      const dn = (nEnd[i] - nStart[i]) / (x1 - x0);
      const nt = nStart[i] + dn * (t - x0);
      const nu = nStart[i] + dn * (u - x0);
      sum += ((u - t) / 6) * (2 * rt * nt + rt * nu + ru * nt + 2 * ru * nu);
      t = u;
      rt = ru;
      i++;
    }
  }

  // In the tail: N(s) = nt * (t / s)^alpha from t on.
  const tail = shape.tail;
  if (t < b && tail) {
    const L = b === Infinity ? Infinity : Math.log(b / t);
    const nt = tail.count * Math.pow(tail.from / t, tail.alpha);
    const units = nt * t * growth(1 - tail.alpha, L); // integral of N
    if (slope === 0) {
      sum += rt * units;
    } else {
      const moment = nt * t * t * growth(2 - tail.alpha, L); // integral of s * N(s)
      sum += (rt - slope * t) * units + slope * moment;
    }
  }
  return sum;
}

/** Integral over [lo, hi] of marginal rate * unitsAbove, before scaling. hi may be Infinity. */
function integrate(shape: DistributionShape, points: readonly CurvePoint[], lo: number, hi: number): number {
  const n = points.length;
  if (n === 0) return 0;
  if (lo < points[0].x) lo = points[0].x; // the rate is 0 below the first point
  if (!(hi > lo)) return 0;
  let sum = 0;
  let a = lo;
  for (let i = lastPointAtOrBelow(points, lo); i < n && a < hi; i++) {
    const p = points[i];
    if (i === n - 1) {
      sum += piece(shape, a, hi, p.y, p.y);
      break;
    }
    const q = points[i + 1];
    if (q.x <= a) continue; // a step, or a segment that ends where we start
    const b = hi < q.x ? hi : q.x;
    const width = q.x - p.x;
    const ra = p.y + ((q.y - p.y) * (a - p.x)) / width;
    const rb = p.y + ((q.y - p.y) * (b - p.x)) / width;
    sum += piece(shape, a, b, ra, rb);
    a = b;
  }
  return sum;
}

/** What all units of the distribution owe in total under the curve: model(S) of the contract. */
export function curveTotal(dist: Distribution, curve: RateCurve): number {
  return integrate(distributionShape(dist), curve.points, -Infinity, Infinity) * (curve.scale ?? 1);
}

/**
 * Units above the lowest value at which the reform's marginal rate differs from the baseline's.
 * Without a baseline the comparison is against a rate of 0 everywhere.
 */
export function curveAffected(dist: Distribution, reform: RateCurve, baseline: RateCurve = EMPTY): AffectedUnits {
  const a = reform.points;
  const b = baseline.points;
  let i = 0;
  let j = 0;
  // Walk the x values of both curves in ascending order.
  while (i < a.length || j < b.length) {
    const x = j >= b.length || (i < a.length && a[i].x <= b[j].x) ? a[i].x : b[j].x;
    while (i < a.length && a[i].x === x) i++;
    while (j < b.length && b[j].x === x) j++;
    // The curves differ from x on if they differ right at x, or drift apart before the next x.
    let differ = Math.abs(curveRate(reform, x) - curveRate(baseline, x)) > RATE_EPSILON;
    if (!differ && (i < a.length || j < b.length)) {
      const next = j >= b.length || (i < a.length && a[i].x <= b[j].x) ? a[i].x : b[j].x;
      differ = Math.abs(curveRateBelow(reform, next) - curveRateBelow(baseline, next)) > RATE_EPSILON;
    }
    if (differ) {
      const shape = distributionShape(dist);
      const units = shapeAbove(shape, x);
      return { threshold: x, units, share: shape.total > 0 ? units / shape.total : 0 };
    }
  }
  return { threshold: null, units: 0, share: 0 };
}

/** Units at or above a band edge. A unit that sits exactly on a bin edge counts with its own bin. */
function unitsFrom(shape: DistributionShape, edge: number): number {
  const i = lastAtOrBelow(shape.edges, edge);
  if (i >= 0 && shape.edges[i] === edge) return shape.fromEdge[i];
  return shapeAbove(shape, edge);
}

function fillBand(
  band: ScheduleBand,
  shape: DistributionShape,
  reform: RateCurve,
  baseline: RateCurve,
  from: number,
  to: number,
  unitsLow: number,
  unitsHigh: number,
): void {
  const units = unitsLow - unitsHigh;
  band.from = from;
  band.to = to;
  band.units = units;
  band.reform = owedInBand(shape, reform, from, to, units, unitsHigh);
  band.baseline = baseline.points.length === 0 ? 0 : owedInBand(shape, baseline, from, to, units, unitsHigh);
  band.delta = band.reform - band.baseline;
  band.perUnit = units > 0 ? band.delta / units : 0;
}

/**
 * What the units with from <= value < to owe in total. Each of them owes T(from) for the part of
 * its value below the band; inside the band the rate at t is paid by every unit of the band that
 * lies above t, which is unitsAbove(t) minus the units above the band.
 */
function owedInBand(shape: DistributionShape, curve: RateCurve, from: number, to: number, units: number, unitsHigh: number): number {
  const scale = curve.scale ?? 1;
  const below = curveOwed(curve, from);
  const inside = integrate(shape, curve.points, from, to) * scale;
  if (to === Infinity) return below * units + inside;
  return below * units + inside - unitsHigh * (curveOwed(curve, to) - below);
}

/**
 * A schedule's effect by band of the distribution: how many units a band holds, what they owe in
 * total under the baseline and under the reform, the difference, and the difference per unit.
 *
 * By default the bands are the distribution's own bins, plus an open band for the tail. With
 * `edges` (ascending) the bands run from each edge to the next, plus an open band above the last
 * edge if any units lie there; units below the first edge are left out.
 *
 * Pass the previous result as `out` to have its objects overwritten instead of allocating new
 * ones on every call.
 */
export function scheduleBands(
  dist: Distribution,
  reform: RateCurve,
  baseline: RateCurve = EMPTY,
  edges?: ArrayLike<number>,
  out: ScheduleBand[] = [],
): ScheduleBand[] {
  const shape = distributionShape(dist);
  const list = edges ?? shape.edges;
  let count = 0;
  let low = list.length > 0 ? unitsFrom(shape, list[0]) : 0;
  for (let k = 0; k < list.length; k++) {
    const last = k === list.length - 1;
    const high = last ? 0 : unitsFrom(shape, list[k + 1]);
    if (last && !(low > 0)) break; // nothing above the last edge: no open band
    const band = (out[count] ??= { from: 0, to: 0, units: 0, baseline: 0, reform: 0, delta: 0, perUnit: 0 });
    fillBand(band, shape, reform, baseline, list[k], last ? Infinity : list[k + 1], low, high);
    count++;
    low = high;
  }
  out.length = count;
  return out;
}

/** Scratch space for the crossing points inside one interval; reused across calls. */
const crossings = new Float64Array(6);

/**
 * Writes the u in (0, width) at which base + slope * u + curvature * u^2 equals `level` to
 * `crossings`, starting at index `count`; returns the new count.
 */
function addCrossings(count: number, base: number, slope: number, curvature: number, level: number, width: number): number {
  const c = base - level;
  if (curvature === 0) {
    if (slope !== 0) {
      const u = -c / slope;
      if (u > 0 && u < width) crossings[count++] = u;
    }
    return count;
  }
  const discriminant = slope * slope - 4 * curvature * c;
  if (discriminant <= 0) return count; // no crossing, or the curve only touches the level
  // The numerically stable pair of roots: no subtraction of nearly equal numbers.
  const q = -0.5 * (slope + (slope >= 0 ? 1 : -1) * Math.sqrt(discriminant));
  const u1 = q / curvature;
  const u2 = q !== 0 ? c / q : NaN;
  if (u1 > 0 && u1 < width) crossings[count++] = u1;
  if (u2 > 0 && u2 < width) crossings[count++] = u2;
  return count;
}

/**
 * How many units owe more, less or the same under the reform compared with the baseline. A unit
 * counts as unchanged if the difference is at most `tolerance` currency units either way. (The
 * tolerance is widened by one part in a million million, so that rounding cannot turn a
 * difference of exactly the tolerance into a change.) With a tolerance of 0 every difference
 * counts, including the rounding noise between two notations of the same schedule; use a small
 * positive tolerance unless the curves are known to differ.
 *
 * The difference in what a unit owes is a quadratic function of its value between the points of
 * the two curves, so the values at which it crosses the tolerance are found exactly.
 */
export function payMoreOrLess(dist: Distribution, reform: RateCurve, baseline: RateCurve = EMPTY, tolerance = 1): PayMoreOrLess {
  const shape = distributionShape(dist);
  const a = reform.points;
  const b = baseline.points;
  const limit = tolerance * (1 + 1e-12);
  let more = 0;
  let less = 0;

  let i = 0;
  let j = 0;
  let difference = 0; // reform minus baseline owed at the current x
  let x = -Infinity;
  let above = shape.total; // units above the current position
  while (i < a.length || j < b.length) {
    x = j >= b.length || (i < a.length && a[i].x <= b[j].x) ? a[i].x : b[j].x;
    while (i < a.length && a[i].x === x) i++;
    while (j < b.length && b[j].x === x) j++;
    const open = i >= a.length && j >= b.length; // the last interval runs to infinity
    const next = open ? Infinity : j >= b.length || (i < a.length && a[i].x <= b[j].x) ? a[i].x : b[j].x;
    const width = next - x;
    // The difference of the marginal rates is linear on [x, next].
    const d0 = curveRate(reform, x) - curveRate(baseline, x);
    const d1 = open ? d0 : curveRateBelow(reform, next) - curveRateBelow(baseline, next);
    const curvature = open ? 0 : (d1 - d0) / (2 * width);

    let count = addCrossings(0, difference, d0, curvature, limit, width);
    count = addCrossings(count, difference, d0, curvature, -limit, width);
    // Insertion sort; there are at most four.
    for (let k = 1; k < count; k++) {
      const value = crossings[k];
      let m = k - 1;
      for (; m >= 0 && crossings[m] > value; m--) crossings[m + 1] = crossings[m];
      crossings[m + 1] = value;
    }

    // Classify each stretch between crossings by the difference at its middle.
    if (above === shape.total) above = shapeAbove(shape, x); // everything at or below the first x is unchanged
    let start = 0;
    for (let k = 0; k <= count; k++) {
      const end = k < count ? crossings[k] : width;
      const middle = end === Infinity ? start + 1 : (start + end) / 2;
      const value = difference + d0 * middle + curvature * middle * middle;
      const aboveEnd = end === Infinity ? 0 : shapeAbove(shape, x + end);
      if (value > limit) more += above - aboveEnd;
      else if (value < -limit) less += above - aboveEnd;
      above = aboveEnd;
      start = end;
    }
    if (!open) difference += d0 * width + curvature * width * width;
  }

  const total = shape.total;
  const same = total - more - less;
  return {
    more,
    less,
    same,
    moreShare: total > 0 ? more / total : 0,
    lessShare: total > 0 ? less / total : 0,
    sameShare: total > 0 ? same / total : 0,
  };
}
