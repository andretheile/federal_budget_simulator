/**
 * The rules of a number slider, apart from how it is drawn:
 *   - values lie on the grid min + k * step, inside [min, max];
 *   - while a finger or the mouse drags, the value snaps to the base-year value and to the default
 *     when it comes within 1 % of the range, so both can be hit;
 *   - a slider with more than 200 positions moves 1 % of its range per arrow key and 10 % per
 *     Page key instead of one step, and stops at the base-year value and the default on the way;
 *   - a typed value is read in the language of the page, then put inside the range and on the grid;
 *   - which way a slider's move from its base-year value pushes the balance, for this slider alone.
 */
import { decimalsOf } from "../i18n/format.ts";
import { simulatePolicy, type CountryPack, type LevelFilter, type NumberParam, type ParamValues, type Policy } from "../engine/index.ts";
import { directionOf, type Direction } from "./policyModel.ts";

/** Above this many positions one step of the slider is too small to be useful on its own. */
export const FINE_POSITIONS = 200;
/** How close (as a share of the range) a dragged value must come to the base-year value or the default to land on it. */
export const SNAP_SHARE = 0.01;

/** Number of steps from one end of the slider to the other. */
export function positions(param: NumberParam): number {
  return Math.round((param.max - param.min) / param.step);
}

/** The value inside the range and on the grid min + k * step, with the noise of binary fractions removed. */
export function onGrid(value: number, param: NumberParam): number {
  const clamped = Math.min(param.max, Math.max(param.min, value));
  const k = Math.round((clamped - param.min) / param.step);
  const digits = Math.max(decimalsOf(param.step), decimalsOf(param.min));
  return Math.min(param.max, Math.max(param.min, Number((param.min + k * param.step).toFixed(digits))));
}

/** The values a slider stops at on its way: the base-year value and the default, where they lie on the scale. */
export function landmarks(param: NumberParam): number[] {
  const out: number[] = [];
  for (const value of [param.baseline, param.default]) {
    if (value !== undefined && value >= param.min && value <= param.max && !out.includes(value)) out.push(value);
  }
  return out;
}

/** A value reached by dragging: the base-year value or the default if it is within 1 % of the range, else the value itself. */
export function snapWhileDragging(value: number, param: NumberParam): number {
  const reach = (param.max - param.min) * SNAP_SHARE;
  let best = value;
  let distance = Infinity;
  for (const mark of landmarks(param)) {
    const d = Math.abs(mark - value);
    if (d <= reach + 1e-9 && d < distance) {
      best = mark;
      distance = d;
    }
  }
  return best;
}

/** One press of an arrow key (small) or a Page key (large) on a slider with many positions: its size, on the grid, at least one step. */
export function keyStep(param: NumberParam, large: boolean): number {
  const share = large ? 0.1 : 0.01;
  const steps = Math.max(1, Math.round(((param.max - param.min) * share) / param.step));
  return steps * param.step;
}

const KEYS: Record<string, [direction: 1 | -1, large: boolean]> = {
  ArrowRight: [1, false],
  ArrowUp: [1, false],
  ArrowLeft: [-1, false],
  ArrowDown: [-1, false],
  PageUp: [1, true],
  PageDown: [-1, true],
};

/**
 * The value after a key press, for a slider with more than 200 positions; null for any other key or
 * slider, which the browser then handles as usual. A move that would pass the base-year value or the
 * default stops there.
 */
export function valueAfterKey(key: string, value: number, param: NumberParam): number | null {
  const move = KEYS[key];
  if (!move || positions(param) <= FINE_POSITIONS) return null;
  const [direction, large] = move;
  const target = value + direction * keyStep(param, large);
  const passed = landmarks(param)
    .filter((mark) => (direction > 0 ? mark > value && mark <= target : mark < value && mark >= target))
    .sort((a, b) => direction * (a - b));
  return onGrid(passed[0] ?? target, param);
}

/** A typed value, read with either decimal mark, inside the range and on the grid; null if it is no number. */
export function typedValue(text: string, param: NumberParam, parse: (text: string) => number): number | null {
  const parsed = parse(text);
  return Number.isFinite(parsed) ? onGrid(parsed, param) : null;
}

/** How far the value is from the base-year value, in the slider's own unit; null without one, or at it. */
export function changeFromBase(value: number, param: NumberParam): number | null {
  if (param.baseline === undefined) return null;
  const digits = Math.max(decimalsOf(param.step), decimalsOf(param.baseline));
  const change = Number((value - param.baseline).toFixed(digits));
  return change === 0 ? null : change;
}

/**
 * Which way the move of one slider from its base-year value to its current value pushes the balance:
 * the measure as set, against the same measure with only this slider back at its base-year value.
 * Other sliders of the measure may pull the other way; that is theirs to show.
 */
export function sliderDirection(
  pack: CountryPack,
  policy: Policy,
  params: ParamValues,
  param: NumberParam,
  level: LevelFilter,
  noise: number,
  /** The measure's effect on the balance as set, if the caller has it already. */
  balanceNow?: number,
): Direction {
  if (param.baseline === undefined || params[param.id] === param.baseline) return "neutral";
  const now = balanceNow ?? simulatePolicy(pack, policy.id, params, level)?.delta.balance;
  const atBase = simulatePolicy(pack, policy.id, { ...params, [param.id]: param.baseline }, level);
  if (now === undefined || !atBase) return "neutral";
  return directionOf(now - atBase.delta.balance, noise);
}
