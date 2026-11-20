/**
 * The horizontal scale of a curve chart, and the ticks on both axes.
 *
 * A curve runs over the whole range of its parameter, for the German income tax from 0 to a
 * million euros, while nine in ten taxpayers have less than 60,000. On a linear scale over the
 * whole range they would share a sliver at the left edge. When a distribution is that skewed the
 * scale is linear up to a knee and compressed above it, again linearly: the knee is a round value
 * at or above the point below which 95 % of the units lie, and the part up to it takes most of
 * the width. A straight segment stays straight inside each part; one that crosses the knee bends
 * there, which is why the chart marks the compressed part and says what it holds.
 *
 * Positions are fractions of the plot width, 0 at the left edge and 1 at the right.
 */
import { totalUnits, unitsAbove, type Distribution } from "../engine/index.ts";

export interface XScale {
  min: number;
  max: number;
  /** Where the compressed part begins; null for a scale that is linear throughout. */
  knee: number | null;
  /** The part of the width that the values up to the knee take (1 for a linear scale). */
  split: number;
}

/** Below this share of the range, the units would be crowded into the left edge. */
const CROWDED = 0.25;
/** The share of the units that the uncompressed part holds at least. */
const QUANTILE = 0.95;
/** The share of the width the uncompressed part takes. */
const SPLIT = 0.7;

/** The value below which `share` of the units lie, found by bisection on the engine's own unitsAbove. */
export function quantile(dist: Distribution, share: number): number {
  const total = totalUnits(dist);
  const wanted = total * (1 - share);
  let low = dist.bins[0]?.from ?? 0;
  let high = dist.tail ? dist.tail.from : (dist.bins[dist.bins.length - 1]?.to ?? low);
  // Above the last bin only the tail is left; widen until it holds less than wanted.
  while (unitsAbove(dist, high) > wanted && Number.isFinite(high) && high < 1e15) high = high > 0 ? high * 2 : 1;
  for (let i = 0; i < 100 && high - low > Math.abs(high) * 1e-9; i++) {
    const middle = (low + high) / 2;
    if (unitsAbove(dist, middle) > wanted) low = middle;
    else high = middle;
  }
  return high;
}

/** The smallest of 1, 2, 2.5, 5 times a power of ten that is at least `value`. */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    const candidate = factor * power;
    if (candidate >= value * (1 - 1e-12)) return candidate;
  }
  return 10 * power;
}

/** The scale for a curve over [min, max] on this distribution. */
export function chooseScale(dist: Distribution | undefined, min: number, max: number): XScale {
  const linear: XScale = { min, max, knee: null, split: 1 };
  if (!dist || !(max > min)) return linear;
  const range = max - min;
  const bulk = quantile(dist, QUANTILE);
  if (bulk - min >= CROWDED * range) return linear;
  const knee = niceCeil(Math.max(bulk, min + range * 0.01));
  // A knee near the end would compress hardly anything; then a linear scale is clearer.
  if (!(knee > min) || knee - min >= 0.6 * range) return linear;
  return { min, max, knee, split: SPLIT };
}

/** Position of a value as a fraction of the width; values outside the range are clamped. */
export function toFraction(scale: XScale, value: number): number {
  const { min, max, knee, split } = scale;
  const v = Math.min(max, Math.max(min, value));
  if (knee === null) return max > min ? (v - min) / (max - min) : 0;
  if (v <= knee) return ((v - min) / (knee - min)) * split;
  return split + ((v - knee) / (max - knee)) * (1 - split);
}

/** The value at a fraction of the width; the inverse of toFraction. */
export function fromFraction(scale: XScale, fraction: number): number {
  const { min, max, knee, split } = scale;
  const f = Math.min(1, Math.max(0, fraction));
  if (knee === null) return min + f * (max - min);
  if (f <= split) return min + (f / split) * (knee - min);
  return knee + ((f - split) / (1 - split)) * (max - knee);
}

/** Value per pixel at a value: how far one pixel of pointer movement goes there. */
export function valuePerPixel(scale: XScale, value: number, width: number): number {
  const { min, max, knee, split } = scale;
  if (!(width > 0)) return Infinity;
  if (knee === null) return (max - min) / width;
  return value < knee ? (knee - min) / (split * width) : (max - knee) / ((1 - split) * width);
}

/** The step of 1, 2, 2.5 or 5 times a power of ten that leaves at least `gap` pixels between ticks. */
function tickStep(span: number, pixels: number, gap: number): number {
  if (!(span > 0) || !(pixels > 0)) return Infinity;
  return niceCeil((span * gap) / pixels);
}

function multiples(from: number, to: number, step: number): number[] {
  if (!Number.isFinite(step) || step <= 0) return [];
  const out: number[] = [];
  const first = Math.ceil(from / step - 1e-9) * step;
  for (let k = 0, v = first; v <= to + step * 1e-9 && k < 1000; k++, v = first + k * step) out.push(Number(v.toPrecision(12)));
  return out;
}

/**
 * Tick values for the horizontal axis at the given width, with at least `gap` pixels between
 * neighbours. On a compressed scale each part gets its own step; the knee is always a tick, and
 * so is the end of the range when there is room for it.
 */
export function xTicks(scale: XScale, width: number, gap: number): number[] {
  const { min, max, knee, split } = scale;
  if (!(width > 0)) return [];
  const parts: [number, number, number][] =
    knee === null ? [[min, max, width]] : [[min, knee, width * split], [knee, max, width * (1 - split)]];
  const values = new Set<number>();
  for (const [from, to, pixels] of parts) {
    for (const value of multiples(from, to, tickStep(to - from, pixels, gap))) values.add(value);
  }
  if (knee !== null) values.add(knee);
  // Keep the knee and drop whatever crowds it or another tick; walk from the left.
  const sorted = [...values].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const value of sorted) {
    const at = toFraction(scale, value) * width;
    const previous = kept[kept.length - 1];
    if (previous !== undefined && at - toFraction(scale, previous) * width < gap - 1e-6) {
      if (value === knee) kept[kept.length - 1] = value;
      continue;
    }
    kept.push(value);
  }
  return kept;
}

/** Tick values for a linear axis over [min, max] that is `pixels` long. */
export function linearTicks(min: number, max: number, pixels: number, gap: number): number[] {
  return multiples(min, max, tickStep(max - min, pixels, gap));
}
