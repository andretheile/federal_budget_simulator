/**
 * Integration of marginal-rate schedules over binned distributions.
 *
 * Within-bin model: a share p = (to - mean) / (to - from) of a bin's units is spread uniformly
 * over [from, mean], the rest uniformly over [mean, to]. This reproduces the bin's count and its
 * mean (and therefore its total, count * mean) exactly, and it is a density, so every integral
 * below is continuous in the threshold. A bin whose mean sits on an edge degenerates to a point
 * mass on that edge, which still keeps totals continuous.
 *
 * The optional Pareto tail above the last bin is handled in closed form: above a >= tail.from
 * there are count * (tail.from / a)^alpha units, and their total excess over a is that number
 * times a / (alpha - 1).
 *
 * Everything is built from two functions of a threshold a:
 *   unitsAbove(a)  = number of units with x > a
 *   excessAbove(a) = sum over all units of max(0, x - a)
 */
import type { Distribution, DistributionBin, ParetoTail } from "./types.ts";

/** A marginal rate that applies from `from` up to the next bracket's `from`. */
export interface Bracket {
  from: number;
  rate: number;
}

export interface AffectedUnits {
  /** Lowest value at which the reform's marginal rate differs from the baseline's; null if they never differ. */
  threshold: number | null;
  /** Number of units above the threshold. */
  units: number;
  /** `units` as a share of all units in the distribution. */
  share: number;
}

/** Excess over `a` of `n` units spread uniformly over [lo, hi]; a point mass if lo === hi. */
function uniformExcess(n: number, lo: number, hi: number, a: number): number {
  if (a >= hi) return 0;
  if (a <= lo) return n * ((lo + hi) / 2 - a);
  const d = hi - a;
  return (n * d * d) / (2 * (hi - lo));
}

/** How many of `n` units spread uniformly over [lo, hi] lie above `a`. */
function uniformAbove(n: number, lo: number, hi: number, a: number): number {
  if (a >= hi) return 0;
  if (a <= lo) return n;
  return (n * (hi - a)) / (hi - lo);
}

/** Number of the bin's units placed in its lower part, [from, mean]. */
function lowerCount(bin: DistributionBin): number {
  const width = bin.to - bin.from;
  if (!(width > 0)) return bin.count;
  const p = Math.min(1, Math.max(0, (bin.to - bin.mean) / width));
  return bin.count * p;
}

function binExcess(bin: DistributionBin, a: number): number {
  if (a >= bin.to) return 0;
  if (a <= bin.from) return bin.count * (bin.mean - a);
  const lower = lowerCount(bin);
  return uniformExcess(lower, bin.from, bin.mean, a) + uniformExcess(bin.count - lower, bin.mean, bin.to, a);
}

function binAbove(bin: DistributionBin, a: number): number {
  if (a >= bin.to) return 0;
  if (a < bin.from) return bin.count;
  const lower = lowerCount(bin);
  return uniformAbove(lower, bin.from, bin.mean, a) + uniformAbove(bin.count - lower, bin.mean, bin.to, a);
}

function tailAbove(tail: ParetoTail, a: number): number {
  return a <= tail.from ? tail.count : tail.count * Math.pow(tail.from / a, tail.alpha);
}

function tailExcess(tail: ParetoTail, a: number): number {
  if (a <= tail.from) return tail.count * ((tail.alpha * tail.from) / (tail.alpha - 1) - a);
  return (tailAbove(tail, a) * a) / (tail.alpha - 1);
}

/** Number of units whose value is above `a`. */
export function unitsAbove(dist: Distribution, a: number): number {
  let n = dist.tail ? tailAbove(dist.tail, a) : 0;
  for (const bin of dist.bins) n += binAbove(bin, a);
  return n;
}

/** Sum over all units of max(0, value - a): the total amount lying above the threshold `a`. */
export function excessAbove(dist: Distribution, a: number): number {
  let total = dist.tail ? tailExcess(dist.tail, a) : 0;
  for (const bin of dist.bins) total += binExcess(bin, a);
  return total;
}

/** Number of units in the distribution, tail included. */
export function totalUnits(dist: Distribution): number {
  let n = dist.tail ? dist.tail.count : 0;
  for (const bin of dist.bins) n += bin.count;
  return n;
}

/** Sum of the variable over all units, tail included. */
export function totalAmount(dist: Distribution): number {
  let total = dist.tail ? (dist.tail.count * dist.tail.alpha * dist.tail.from) / (dist.tail.alpha - 1) : 0;
  for (const bin of dist.bins) total += bin.count * bin.mean;
  return total;
}

/**
 * Make bracket thresholds non-decreasing by raising any threshold that lies below its
 * predecessor. A bracket that is overtaken this way has zero width, so the result still changes
 * continuously while a slider moves one threshold past another.
 */
export function orderBrackets(brackets: readonly Bracket[]): { brackets: Bracket[]; adjusted: boolean } {
  const out: Bracket[] = [];
  let adjusted = false;
  let previous = -Infinity;
  for (const bracket of brackets) {
    if (bracket.from < previous) {
      adjusted = true;
      out.push({ from: previous, rate: bracket.rate });
    } else {
      previous = bracket.from;
      out.push(bracket);
    }
  }
  return { brackets: out, adjusted };
}

/** Marginal rate at `x`: the rate of the last bracket that starts at or below `x`, 0 below the first. */
export function marginalRate(brackets: readonly Bracket[], x: number): number {
  let rate = 0;
  for (const bracket of brackets) {
    if (bracket.from > x) break;
    rate = bracket.rate;
  }
  return rate;
}

/** What a single unit with value `x` owes: the sum over brackets of rate * (the part of x inside the bracket). */
export function scheduleAmount(brackets: readonly Bracket[], x: number): number {
  let total = 0;
  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    if (x <= bracket.from) break;
    const upper = i + 1 < brackets.length ? brackets[i + 1].from : Infinity;
    total += bracket.rate * (Math.min(x, upper) - bracket.from);
  }
  return total;
}

/**
 * Total over all units of the distribution of what each owes under the schedule.
 * `brackets` must have non-decreasing thresholds (see orderBrackets).
 *
 * Uses sum_i rate_i * (E(from_i) - E(from_i+1)) = sum_i (rate_i - rate_i-1) * E(from_i),
 * where E is excessAbove.
 */
export function scheduleTotal(dist: Distribution, brackets: readonly Bracket[]): number {
  let total = 0;
  let previousRate = 0;
  for (const bracket of brackets) {
    const step = bracket.rate - previousRate;
    if (step !== 0) total += step * excessAbove(dist, bracket.from);
    previousRate = bracket.rate;
  }
  return total;
}

/**
 * Units above the lowest threshold at which the reform's marginal rate differs from the
 * baseline's. Without a baseline the comparison is against a rate of 0 everywhere.
 */
export function affectedUnits(
  dist: Distribution,
  reform: readonly Bracket[],
  baseline: readonly Bracket[] = [],
): AffectedUnits {
  const thresholds = [...reform, ...baseline].map((b) => b.from).sort((a, b) => a - b);
  for (const threshold of thresholds) {
    if (Math.abs(marginalRate(reform, threshold) - marginalRate(baseline, threshold)) > 1e-12) {
      const units = unitsAbove(dist, threshold);
      const all = totalUnits(dist);
      return { threshold, units, share: all > 0 ? units / all : 0 };
    }
  }
  return { threshold: null, units: 0, share: 0 };
}
