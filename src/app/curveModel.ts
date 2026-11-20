/**
 * The rules for editing a rate curve: moving, adding and removing points, the grid the steps
 * follow, presets and today's curve, and one step of undo. Pure functions on lists of points in
 * the units of the parameter (x in currency, y in percent); a list is never changed in place.
 *
 * The rules, all taken from the parameter:
 *   - x stays in [x.min, x.max] and y in [y.min, y.max];
 *   - a point cannot pass its neighbours: its x is clamped between theirs. Meeting a neighbour's
 *     x is allowed and makes a step;
 *   - there are never fewer than minPoints or more than maxPoints points;
 *   - drags and arrow keys move along the grid min + k * step; a value the pack wrote off the
 *     grid (23.97 %) stays as it is until that coordinate is moved;
 *   - adding a point never changes the curve: the new point lies on it.
 */
import {
  CURVE_MAX_POINTS,
  CURVE_MIN_POINTS,
  bracketsToCurve,
  curveAffected,
  curveRate,
  totalAmount,
  totalUnits,
  type CurveParam,
  type CurvePoint,
  type Distribution,
  type Policy,
  type RateCurve,
  type ScheduleEffect,
} from "../engine/index.ts";

export interface Axis {
  min: number;
  max: number;
  step: number;
}

/** How many points a value of this parameter may have. */
export function pointLimits(param: CurveParam): { min: number; max: number } {
  return { min: param.minPoints ?? CURVE_MIN_POINTS, max: param.maxPoints ?? CURVE_MAX_POINTS };
}

/** Removes the noise of binary fractions: 0.1 + 0.2 is 0.3 here. */
export function clean(value: number): number {
  return Number(value.toPrecision(12));
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The grid value nearest to `value`, inside the axis. */
export function snap(value: number, axis: Axis): number {
  const k = Math.round((value - axis.min) / axis.step);
  return clamp(clean(axis.min + k * axis.step), axis.min, axis.max);
}

/**
 * The grid value `count` steps up (direction 1) or down (-1) from `value`. From a value off the
 * grid the first step goes to the next grid value in that direction.
 */
export function stepFrom(value: number, axis: Axis, direction: 1 | -1, count = 1): number {
  const position = (value - axis.min) / axis.step;
  const onGrid = Math.abs(position - Math.round(position)) < 1e-9;
  const base = onGrid ? Math.round(position) : direction > 0 ? Math.floor(position) : Math.ceil(position);
  return clamp(clean(axis.min + (base + direction * count) * axis.step), axis.min, axis.max);
}

/** The range of x the point at `index` may take: between its neighbours and inside the axis. */
export function xBounds(points: readonly CurvePoint[], index: number, axis: Axis): [number, number] {
  const low = index > 0 ? Math.max(axis.min, points[index - 1].x) : axis.min;
  const high = index < points.length - 1 ? Math.min(axis.max, points[index + 1].x) : axis.max;
  return [low, Math.max(low, high)];
}

/**
 * The points with the one at `index` moved towards `to`, clamped by the rules above. Returns the
 * same list if nothing changes, so a caller can tell a move that hit a wall from a real one.
 */
export function movePoint(
  points: readonly CurvePoint[],
  index: number,
  to: Partial<CurvePoint>,
  param: CurveParam,
): readonly CurvePoint[] {
  const point = points[index];
  if (!point) return points;
  const [low, high] = xBounds(points, index, param.x);
  const x = clamp(to.x ?? point.x, low, high);
  const y = clamp(to.y ?? point.y, param.y.min, param.y.max);
  if (x === point.x && y === point.y) return points;
  const next = points.slice();
  next[index] = { x, y };
  return next;
}

/** One arrow key: a grid step along x or y, or ten with the modifier held. */
export function nudgePoint(
  points: readonly CurvePoint[],
  index: number,
  along: "x" | "y",
  direction: 1 | -1,
  large: boolean,
  param: CurveParam,
): readonly CurvePoint[] {
  const point = points[index];
  if (!point) return points;
  const axis = along === "x" ? param.x : param.y;
  const value = stepFrom(point[along], axis, direction, large ? 10 : 1);
  return movePoint(points, index, { [along]: value }, param);
}

/**
 * Where a dragged point goes. `start` is the point when the drag began, `target` the value under
 * the handle now (start plus the pointer's movement), `moved` how far the pointer has travelled
 * in pixels along each axis. A coordinate the pointer has hardly moved along keeps its start
 * value, so a horizontal drag does not nudge the rate onto the grid; otherwise it snaps.
 */
export function dragPoint(
  points: readonly CurvePoint[],
  index: number,
  start: CurvePoint,
  target: CurvePoint,
  moved: { x: number; y: number },
  param: CurveParam,
  threshold = 3,
): readonly CurvePoint[] {
  const x = Math.abs(moved.x) < threshold ? start.x : snap(target.x, param.x);
  const y = Math.abs(moved.y) < threshold ? start.y : snap(target.y, param.y);
  return movePoint(points, index, { x, y }, param);
}

export function canAdd(points: readonly CurvePoint[], param: CurveParam): boolean {
  return points.length < pointLimits(param).max;
}

export function canRemove(points: readonly CurvePoint[], param: CurveParam): boolean {
  return points.length > pointLimits(param).min;
}

/** The rate of the curve at x, in the parameter's units. */
export function rateAt(points: readonly CurvePoint[], x: number): number {
  return curveRate({ points }, x);
}

/**
 * The points with a new point on the curve at x (snapped to the grid), and the index of the
 * point to move next. The curve itself does not change:
 *   - between two points the new one takes the rate there;
 *   - above the last point it takes the last rate, which applies there;
 *   - below the first point the rate is 0 up to the first point. A point at (x, 0) alone would
 *     turn the jump at the first point into a ramp, so a second point (first x, 0) keeps the jump,
 *     unless the first rate is 0 anyway.
 * Null if the limit on the number of points does not allow it, or the point is already there.
 */
export function addPoint(
  points: readonly CurvePoint[],
  at: number,
  param: CurveParam,
): { points: CurvePoint[]; index: number } | null {
  const x = snap(at, param.x);
  const room = pointLimits(param).max - points.length;
  if (room < 1) return null;
  const first = points[0];
  if (first && x < first.x) {
    const extra: CurvePoint[] = first.y === 0 ? [{ x, y: 0 }] : [{ x, y: 0 }, { x: first.x, y: 0 }];
    if (extra.length > room) return null;
    return { points: [...extra, ...points], index: 0 };
  }
  const y = rateAt(points, x);
  // After every point at or below x: at a step that is after its later point, whose rate applies at x.
  let index = 0;
  while (index < points.length && points[index].x <= x) index++;
  if (points.some((point) => point.x === x && point.y === y)) return null;
  const next = points.slice();
  next.splice(index, 0, { x, y });
  return { points: next, index };
}

/** Where a new point goes when it is added without a place on the chart: halfway into the widest gap of the visible range. */
export function suggestedX(points: readonly CurvePoint[], param: CurveParam, after?: number): number {
  const { x } = param;
  if (after !== undefined && points[after]) {
    const from = points[after].x;
    const to = after + 1 < points.length ? points[after + 1].x : x.max;
    return snap((from + to) / 2, x);
  }
  const edges = [x.min, ...points.map((point) => point.x), x.max];
  let best = 0;
  for (let i = 1; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] > edges[best + 1] - edges[best]) best = i;
  return snap((edges[best] + edges[best + 1]) / 2, x);
}

export function removePoint(points: readonly CurvePoint[], index: number, param: CurveParam): readonly CurvePoint[] {
  if (!canRemove(points, param) || index < 0 || index >= points.length) return points;
  return points.filter((_, i) => i !== index);
}

export function samePoints(a: readonly CurvePoint[] | undefined, b: readonly CurvePoint[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((point, i) => point.x === b[i].x && point.y === b[i].y);
}

/** The preset whose points the curve has exactly, if any. */
export function matchingPreset(points: readonly CurvePoint[], param: CurveParam): NonNullable<CurveParam["presets"]>[number] | undefined {
  return param.presets?.find((preset) => samePoints(preset.points, points));
}

/** A one-unit distribution: only used to ask whether two curves differ anywhere. */
const ANYWHERE: Distribution = {
  id: "anywhere",
  label: { en: "" },
  variable: { en: "" },
  unit: { en: "" },
  year: 2000,
  bins: [{ from: 0, to: 1, count: 1, mean: 0.5 }],
  quality: "estimate",
  sources: [],
};

/** Whether two curves give the same marginal rate everywhere, whatever the notation. */
export function sameCurve(a: RateCurve, b: RateCurve): boolean {
  return curveAffected(ANYWHERE, a, b).threshold === null;
}

/**
 * Today's curve as a value of the parameter: the calibration baseline of the effect that uses it,
 * in the parameter's units. Where the parameter carries the same curve as its own `baseline`, that
 * copy is used, so its numbers are exactly the pack's and the effect is exactly zero. Null if the
 * effect has no baseline, or today's curve cannot be written as a value of the parameter (too
 * many points, or outside its ranges).
 */
export function todayPoints(param: CurveParam, effect: ScheduleEffect): CurvePoint[] | null {
  const baseline = effect.baseline;
  if (!baseline || !("curve" in effect.reform)) return null;
  const scale = effect.reform.curve.scale ?? 1;
  const today: RateCurve = "points" in baseline ? baseline : bracketsToCurve(baseline.brackets);
  let points: CurvePoint[];
  if (param.baseline && sameCurve({ points: param.baseline, scale }, today)) {
    points = param.baseline;
  } else if ((today.scale ?? 1) === scale) {
    points = today.points.slice();
  } else {
    const factor = (today.scale ?? 1) / scale;
    points = today.points.map((point) => ({ x: point.x, y: clean(point.y * factor) }));
  }
  const { min, max } = pointLimits(param);
  const fits = points.every(
    (point) => point.x >= param.x.min && point.x <= param.x.max && point.y >= param.y.min && point.y <= param.y.max,
  );
  return fits && points.length >= min && points.length <= max ? points : null;
}

/**
 * Up to what difference a unit counts as paying the same: one currency unit a year, unless that is
 * a sizeable part of what the units have (more than a ten-thousandth of the mean); then a power of
 * ten below that. Without a tolerance, rounding noise would count as a change.
 */
export function sameWithin(dist: Distribution): number {
  const units = totalUnits(dist);
  const scaled = units > 0 ? Math.abs(totalAmount(dist) / units) * 1e-4 : 0;
  if (!(scaled > 0) || scaled >= 1) return 1;
  return 10 ** Math.floor(Math.log10(scaled));
}

/** A curve parameter together with the schedule effect whose reform it is. */
export interface CurveSetting {
  param: CurveParam;
  effect: ScheduleEffect;
  /** What one unit of the parameter's y is as a rate: the reform's `scale`, 0.01 for percent. */
  scale: number;
}

/** The curve parameters of a measure that a schedule effect uses, in the order of the parameters. */
export function curveSettings(policy: Policy): CurveSetting[] {
  const out: CurveSetting[] = [];
  for (const param of policy.params) {
    if (param.type !== "curve") continue;
    const effect = policy.effects.find(
      (candidate): candidate is ScheduleEffect =>
        candidate.type === "schedule" && "curve" in candidate.reform && candidate.reform.curve.param === param.id,
    );
    if (effect && "curve" in effect.reform) out.push({ param, effect, scale: effect.reform.curve.scale ?? 1 });
  }
  return out;
}

/**
 * Today's curve for drawing, in the parameter's units: the effect's calibration baseline, whatever
 * its form. Undefined for an effect without a baseline, which compares against no charge at all.
 */
export function todayForDrawing(setting: CurveSetting): CurvePoint[] | undefined {
  const baseline = setting.effect.baseline;
  if (!baseline) return undefined;
  const today: RateCurve = "points" in baseline ? baseline : bracketsToCurve(baseline.brackets);
  const factor = (today.scale ?? 1) / setting.scale;
  return today.points.map((point) => ({ x: point.x, y: factor === 1 ? point.y : clean(point.y * factor) }));
}

/** The rate above the last point, which applies to the highest amounts, and where it starts. */
export function topRate(points: readonly CurvePoint[]): { rate: number; from: number } | null {
  const last = points[points.length - 1];
  return last ? { rate: last.y, from: last.x } : null;
}

/**
 * Whether a curve differs from today's: from the effect's baseline where there is one, otherwise
 * from the parameter's default.
 */
export function curveChanged(setting: CurveSetting, points: readonly CurvePoint[]): boolean {
  const today = todayForDrawing(setting);
  return today ? !sameCurve({ points }, { points: today }) : !sameCurve({ points }, { points: setting.param.default });
}

/**
 * The line a curve draws between `min` and `max`, in values: the rate 0 from the left edge to the
 * first point, a vertical jump there, the points themselves (a step is a vertical segment), and
 * the last rate on to the right edge. Clipped to [min, max]. Where a segment crosses one of the
 * `breaks` (the knee of a compressed scale), a point is added there, so that the drawn line bends
 * exactly where the scale does.
 */
export function curveOutline(points: readonly CurvePoint[], min: number, max: number, breaks: readonly number[] = []): CurvePoint[] {
  const raw: CurvePoint[] = [];
  const first = points[0];
  if (!first) return [{ x: min, y: 0 }, { x: max, y: 0 }];
  raw.push({ x: Math.min(min, first.x), y: 0 }, { x: first.x, y: 0 });
  for (const point of points) raw.push(point);
  raw.push({ x: Math.max(max, points[points.length - 1].x), y: points[points.length - 1].y });

  const inside: CurvePoint[] = [];
  const at = (a: CurvePoint, b: CurvePoint, x: number): CurvePoint => ({ x, y: b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
  for (let i = 0; i < raw.length; i++) {
    const point = raw[i];
    const previous = raw[i - 1];
    if (previous) {
      const cuts = [min, ...breaks, max].filter((x) => x > previous.x && x < point.x);
      for (const x of cuts) inside.push(at(previous, point, x));
    }
    if (point.x >= min && point.x <= max) inside.push(point);
  }
  // Drop exact repeats (the start at min when the first point sits there, for instance).
  return inside.filter((point, i) => i === 0 || point.x !== inside[i - 1].x || point.y !== inside[i - 1].y);
}

/**
 * One step of undo. A change begins (a drag, a key, a preset) with `begin`, which remembers the
 * curve before it; the first actual change makes that the one to go back to. A drag that ends
 * where it started leaves the previous undo in place.
 */
export interface UndoState {
  /** The curve to go back to, if there is one. */
  undo: readonly CurvePoint[] | null;
  /** The curve before the change that is under way, until it actually changes something. */
  pending: readonly CurvePoint[] | null;
}

export const NO_UNDO: UndoState = { undo: null, pending: null };

export function beginChange(state: UndoState, current: readonly CurvePoint[]): UndoState {
  return { undo: state.undo, pending: current };
}

export function recordChange(state: UndoState): UndoState {
  return state.pending ? { undo: state.pending, pending: null } : state;
}

export function afterUndo(): UndoState {
  return NO_UNDO;
}
