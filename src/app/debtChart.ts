/**
 * Geometry of the two charts of the debt projection, kept out of the component: the vertical
 * range and its ticks, the year ticks, where the labels of the reference values go in the margin
 * to the right of the plot, and how a label is broken into lines that fit there.
 *
 * Loaded with the charts, not with the first page.
 */
import { niceCeil } from "./curveScale.ts";

/** By default, a reference value this far above everything else would squash the chart; it is marked at the top edge instead. */
export const OUTLIER = 1.5;

export interface Domain {
  min: number;
  max: number;
  /** Tick values from min to max. */
  ticks: number[];
  /** For each reference value, in the order given: whether it lies above the chart and is marked at its top edge. */
  offScale: boolean[];
}

/**
 * The vertical range: from 0 (or below, for negative values) to a round value above the data and
 * the reference values, with ticks at least `gap` pixels apart. A reference value more than 1.5
 * times the next highest value, data or reference, is left out of the range and marked as lying
 * above it; Japan's debt of 214 % of GDP would otherwise flatten a projection that ends at 127 %.
 * `outlier` sets that factor; Infinity keeps every reference in the range.
 */
export function chartDomain(
  data: readonly number[],
  references: readonly number[],
  pixels: number,
  gap: number,
  outlier: number = OUTLIER,
): Domain {
  const finite = data.filter(Number.isFinite);
  const dataMax = Math.max(0, ...finite);
  const dataMin = Math.min(0, ...finite);
  const offScale = references.map(() => false);
  // Drop the highest reference while it towers over the next highest value.
  const order = references.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  for (let k = 0; k < order.length; k++) {
    const next = Math.max(dataMax, order[k + 1]?.value ?? -Infinity);
    if (next > 0 && order[k].value > outlier * next) offScale[order[k].index] = true;
    else break;
  }
  const top = Math.max(dataMax, ...references.filter((_, i) => !offScale[i]));
  const span = Math.max(top - dataMin, 1e-9);
  const step = niceCeil((span * gap) / Math.max(pixels, 1));
  const min = dataMin < 0 ? Math.floor(dataMin / step - 1e-9) * step : 0;
  // A little room above the highest value, so a line that ends there does not run along the edge.
  let max = Math.ceil(top / step - 1e-9) * step;
  if (max - top < step * 0.15) max += step;
  if (!(max > min)) max = min + step;
  const ticks: number[] = [];
  for (let v = min, k = 0; v <= max + step * 1e-6 && k < 100; k++, v = min + k * step) ticks.push(Number(v.toPrecision(12)));
  return { min, max, ticks, offScale };
}

/**
 * Year ticks between `first` and `last`, at least `gap` pixels apart on a plot `width` wide: the
 * first and the last year, and the multiples of a round step between them that keep their distance.
 * The first and last labels stand inside the plot, flush with its edges, so their neighbours keep
 * a quarter more distance from them.
 */
export function yearTicks(first: number, last: number, width: number, gap: number): number[] {
  if (!(last > first) || !(width > 0)) return [first];
  const perYear = width / (last - first);
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((candidate) => candidate * perYear >= gap) ?? 100;
  const edge = gap * 1.25;
  const kept = [first];
  const ends = (last - first) * perYear >= edge ? [last] : [];
  for (let year = Math.ceil((first + 1) / step) * step; year < last; year += step) {
    const previous = kept[kept.length - 1];
    const room = (year - previous) * perYear >= (previous === first ? edge : gap) && (ends.length === 0 || (last - year) * perYear >= edge);
    if (room) kept.push(year);
  }
  return [...kept, ...ends];
}

/** The year nearest to a horizontal position on the plot. */
export function yearAt(px: number, left: number, width: number, first: number, last: number): number {
  if (!(last > first) || !(width > 0)) return first;
  const year = first + Math.round(((px - left) / width) * (last - first));
  return Math.min(last, Math.max(first, year));
}

/**
 * Breaks a label into lines no wider than `maxWidth`, at ordinary spaces (a no-break space, as
 * between a number and its percent sign, holds), at most `maxLines` lines; a single word that is
 * too wide keeps a line of its own. `measure` gives the width of a text.
 */
export function wrapLabel(text: string, maxWidth: number, measure: (text: string) => number, maxLines = 3): string[] {
  // Pieces of text and whether a space comes before them: a compound such as "EU-Referenzwert" may
  // also break after its hyphen, if it is too wide as a whole.
  const pieces = text
    .split(/[ \t\n]+/)
    .filter(Boolean)
    .flatMap((word) => (measure(word) > maxWidth ? word.split(/(?<=-)(?=.)/) : [word]).map((piece, i) => ({ piece, space: i === 0 })));
  const lines: string[] = [];
  for (const { piece, space } of pieces) {
    const current = lines[lines.length - 1];
    const joined = current === undefined ? piece : `${current}${space ? " " : ""}${piece}`;
    if (current !== undefined && measure(joined) <= maxWidth) lines[lines.length - 1] = joined;
    else lines.push(piece);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]} …`;
  return kept;
}

/**
 * Centres for labels that want to sit at `y` and are `height` tall, so that none overlaps the next
 * by less than `gap` and all stay between `top` and `bottom` where there is room: each label moves
 * as little as it can. Returned in the order given.
 */
export function placeLabels(items: readonly { y: number; height: number }[], top: number, bottom: number, gap: number): number[] {
  const order = items.map((item, index) => ({ ...item, index })).sort((a, b) => a.y - b.y || a.index - b.index);
  const at = order.map((item) => Math.min(bottom - item.height / 2, Math.max(top + item.height / 2, item.y)));
  // Downwards: each label below the one above it.
  for (let k = 1; k < order.length; k++) {
    at[k] = Math.max(at[k], at[k - 1] + order[k - 1].height / 2 + gap + order[k].height / 2);
  }
  // Upwards from the bottom edge, for those pushed past it.
  if (order.length > 0) {
    const last = order.length - 1;
    at[last] = Math.min(at[last], bottom - order[last].height / 2);
    for (let k = last - 1; k >= 0; k--) {
      at[k] = Math.min(at[k], at[k + 1] - order[k + 1].height / 2 - gap - order[k].height / 2);
    }
  }
  const out = new Array<number>(items.length);
  order.forEach((item, k) => (out[item.index] = at[k]));
  return out;
}

/** An SVG path through the points. */
export function linePath(points: readonly { x: number; y: number }[]): string {
  let d = "";
  points.forEach((point, i) => (d += `${i === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`));
  return d;
}

/** A closed SVG path between two lines over the same x positions: along `upper`, back along `lower`. */
export function bandPath(xs: readonly number[], upper: readonly number[], lower: readonly number[]): string {
  if (xs.length === 0) return "";
  const forward = xs.map((x, i) => ({ x, y: upper[i] }));
  const back = xs.map((x, i) => ({ x, y: lower[i] })).reverse();
  return `${linePath([...forward, ...back])}Z`;
}
