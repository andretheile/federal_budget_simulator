/**
 * The simulation: base amounts + enabled policies -> reform amounts, with attribution.
 *
 * State is the amount of every leaf. Enabled policies are applied in pack order, each policy's
 * effects in listed order, each effect against the current state, so two measures on the same
 * node compound instead of double counting. An effect's delta is the change it caused at the
 * moment it was applied, which makes the policy deltas add up to the total change by
 * construction.
 *
 * Besides the amounts, the state holds what is left of every breakdown group that an
 * excludeGroups effect has touched, so a group cannot be removed from a node twice.
 *
 * `simulate` expects a pack that passed `validatePack`. The pack is indexed once and the index is
 * cached by object identity, so a pack must not be mutated after its first use.
 */
import { bracketsToCurve, curveAffected, curveTotal, type RateCurve } from "./curve.ts";
import { affectedUnits, orderBrackets, scheduleTotal, type AffectedUnits, type Bracket } from "./distribution.ts";
import {
  CURVE_MAX_POINTS,
  CURVE_MIN_POINTS,
  LEVEL_IDS,
  type BudgetNode,
  type ConstSchedule,
  type Country,
  type CountryPack,
  type CurveParam,
  type CurvePoint,
  type Distribution,
  type Effect,
  type LevelId,
  type Policy,
  type Quality,
  type ScheduleEffect,
  type Value,
} from "./types.ts";

export type Side = "revenue" | "expenditure";

/**
 * Value of a policy parameter: a number, the selected group ids of a `groups` param, or the
 * points of a `curve` param.
 */
export type ParamValue = number | string[] | CurvePoint[];
export type ParamValues = Record<string, ParamValue>;

export interface PolicyState {
  enabled: boolean;
  /** Missing params fall back to their default. Number params are clamped to [min, max]. */
  params?: ParamValues;
}

export type LevelFilter = LevelId | "all";

export interface Scenario {
  /** Keyed by policy id. Policies that are not listed are off. */
  policies: Record<string, PolicyState>;
  /** Show only one level of government. Absent or "all" means the whole state. */
  level?: LevelFilter;
}

export interface Totals {
  revenue: number;
  expenditure: number;
  /** revenue - expenditure */
  balance: number;
}

export interface NodeResult {
  id: string;
  side: Side;
  /** Id of the enclosing group, null for top-level nodes. */
  parent: string | null;
  isLeaf: boolean;
  baseline: number;
  reform: number;
  /** reform - baseline */
  delta: number;
}

export type WarningCode =
  | "clamped"
  | "not_finite"
  | "empty_group"
  | "brackets_reordered"
  | "baseline_yields_nothing"
  | "repeated_exclusion"
  | "unknown_level";

export interface SimulationWarning {
  code: WarningCode;
  message: string;
  policy?: string;
  /** Index into policy.effects. */
  effect?: number;
  node?: string;
}

/** The part of an effect that reappeared at another node (`shift` in the contract). */
export interface ShiftResult {
  /** The node that received the shifted amount (`shift.to`). */
  target: string;
  side: Side;
  /** `shift.quality`, or the effect's quality if the shift has none. */
  quality: Quality;
  /** Change of that node caused by the shift, with the level filter applied. */
  delta: number;
  /**
   * The shifted amount at the low end of the policy's range: `delta` times the shift's own
   * multiplier that is worse for the balance, and, if the effect's uncertainty has a basis, times
   * the multiplier the effect's group uses for its low end as well.
   */
  low: number;
  /** The same at the high end of the range. */
  high: number;
  /** True if the receiving node was cut off at zero. */
  clamped: boolean;
}

export interface EffectResult {
  /** Index into policy.effects. */
  index: number;
  type: Effect["type"];
  /** The node the effect hit. */
  target: string;
  side: Side;
  quality: Quality;
  /**
   * Change of the target node caused by this effect, with the level filter applied.
   * Positive means more revenue for a `rev.` node and more spending for an `exp.` node.
   * A `shift` is not included here; see `shift`.
   */
  delta: number;
  /**
   * `delta` at the low end of the policy's range: times the uncertainty multiplier that is worse for
   * the balance. For an effect whose uncertainty has a basis, "worse" is judged on the sum of all
   * effects with that basis and their shifts, so every member uses the same multiplier.
   */
  low: number;
  /** `delta` at the high end of the policy's range: times the other multiplier. */
  high: number;
  /** True if the result was cut off at zero. */
  clamped: boolean;
  /** `schedule` effects: units above the lowest threshold at which the reform differs from the baseline. */
  affected?: AffectedUnits;
  /**
   * `schedule` effects: what the schedules yield on the distribution, before `yield` and before
   * calibration to the target. Comparing `baseline` with the target's base amount shows how well
   * the model reproduces the official figure. `baseline` is absent for an effect without one.
   */
  model?: { reform: number; baseline?: number };
  /**
   * `excludeGroups` effects: the share of the node's current amount that the selected groups
   * stood for before this effect. It is smaller than their share in the breakdown if an earlier
   * effect has already removed part of them, and 0 if nothing of them was left.
   */
  excludedShare?: number;
  /** `excludeGroups` effects: the selected group ids. */
  excludedGroups?: string[];
  /** Effects with a `shift`: what reappeared at the other node. */
  shift?: ShiftResult;
}

export interface PolicyResult {
  id: string;
  /** The parameter values that were used: defaults filled in, numbers clamped, unknown groups dropped. */
  params: ParamValues;
  /** Sum of this policy's effect deltas, shifted amounts included. */
  delta: Totals;
  /** The same with every effect at its `low` value. low.balance <= high.balance. */
  low: Totals;
  /** The same with every effect at its `high` value. */
  high: Totals;
  effects: EffectResult[];
  warnings: SimulationWarning[];
}

export interface SimulationResult {
  level: LevelFilter;
  baseline: Totals;
  reform: Totals;
  /** Sum of all policy deltas, in order. Equals reform - baseline up to floating-point rounding. */
  delta: Totals;
  /** Sum of all policy `low` deltas. */
  deltaLow: Totals;
  /** Sum of all policy `high` deltas. */
  deltaHigh: Totals;
  /** baseline + deltaLow. reformLow.balance <= reformHigh.balance. */
  reformLow: Totals;
  /** baseline + deltaHigh. */
  reformHigh: Totals;
  /** Every group and leaf of the budget, keyed by node id, with the level filter applied. */
  nodes: Record<string, NodeResult>;
  /** One entry per enabled policy, in pack order. */
  policies: PolicyResult[];
  /** All warnings, including those of the individual policies. */
  warnings: SimulationWarning[];
}

// ---------------------------------------------------------------------------------------------
// Pack index
// ---------------------------------------------------------------------------------------------

interface Baseline {
  values: Float64Array;
  totals: Totals;
}

interface Prepared {
  /** Nodes in depth-first order, so the leaves below any node are a contiguous range. */
  nodes: BudgetNode[];
  index: Map<string, number>;
  sides: Side[];
  /** Index of the parent node, -1 for top-level nodes. */
  parents: Int32Array;
  leafStart: Int32Array;
  leafEnd: Int32Array;
  /** Node index of each leaf. */
  leafNode: Int32Array;
  /** Base amount of each leaf. */
  base: Float64Array;
  ones: Float64Array;
  /** Per level: the share of each leaf that belongs to it, normalised to sum to 1 per leaf. */
  weights: Map<LevelId, Float64Array>;
  /** Per `${node index}|${breakdown id}`: group id -> share, normalised to sum to 1. */
  breakdowns: Map<string, Map<string, number>>;
  baselines: Map<LevelFilter, Baseline>;
}

const prepared = new WeakMap<CountryPack, Prepared>();

function prepare(pack: CountryPack): Prepared {
  const cached = prepared.get(pack);
  if (cached) return cached;

  const nodes: BudgetNode[] = [];
  const index = new Map<string, number>();
  const sides: Side[] = [];
  const parents: number[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const leafNode: number[] = [];
  const base: number[] = [];
  const breakdowns = new Map<string, Map<string, number>>();

  const visit = (node: BudgetNode, side: Side, parent: number): void => {
    const i = nodes.length;
    nodes.push(node);
    if (!index.has(node.id)) index.set(node.id, i);
    sides.push(side);
    parents.push(parent);
    starts.push(base.length);
    ends.push(0);
    for (const [id, breakdown] of Object.entries(node.breakdowns ?? {})) {
      let sum = 0;
      for (const group of breakdown.groups) sum += group.share;
      const shares = new Map<string, number>();
      for (const group of breakdown.groups) shares.set(group.id, sum > 0 ? group.share / sum : 0);
      breakdowns.set(`${i}|${id}`, shares);
    }
    if ("children" in node) {
      for (const child of node.children) visit(child, side, i);
    } else {
      leafNode.push(i);
      base.push(node.amount);
    }
    ends[i] = base.length;
  };
  for (const node of pack.budget.revenue) visit(node, "revenue", -1);
  for (const node of pack.budget.expenditure) visit(node, "expenditure", -1);

  const weights = new Map<LevelId, Float64Array>();
  for (const level of LEVEL_IDS) weights.set(level, new Float64Array(base.length));
  leafNode.forEach((nodeIndex, leaf) => {
    const node = nodes[nodeIndex];
    if ("children" in node) return;
    let sum = 0;
    for (const level of LEVEL_IDS) sum += node.levels[level] ?? 0;
    if (!(sum > 0)) return;
    for (const level of LEVEL_IDS) weights.get(level)![leaf] = (node.levels[level] ?? 0) / sum;
  });

  const result: Prepared = {
    nodes,
    index,
    sides,
    parents: Int32Array.from(parents),
    leafStart: Int32Array.from(starts),
    leafEnd: Int32Array.from(ends),
    leafNode: Int32Array.from(leafNode),
    base: Float64Array.from(base),
    ones: new Float64Array(base.length).fill(1),
    weights,
    breakdowns,
    baselines: new Map(),
  };
  prepared.set(pack, result);
  return result;
}

function totals(revenue: number, expenditure: number): Totals {
  return { revenue, expenditure, balance: revenue - expenditure };
}

/** Value of every node: leaves from the state, groups as the sum of their children. */
function nodeValues(prep: Prepared, state: Float64Array, weights: Float64Array): Float64Array {
  const values = new Float64Array(prep.nodes.length);
  for (let leaf = 0; leaf < state.length; leaf++) values[prep.leafNode[leaf]] = state[leaf] * weights[leaf];
  // Children come after their parent in depth-first order, so walking backwards completes every
  // node before it is added to its parent.
  for (let i = values.length - 1; i >= 0; i--) {
    const parent = prep.parents[i];
    if (parent >= 0) values[parent] += values[i];
  }
  return values;
}

function sideTotals(prep: Prepared, values: Float64Array): Totals {
  let revenue = 0;
  let expenditure = 0;
  for (let i = 0; i < values.length; i++) {
    if (prep.parents[i] >= 0) continue;
    if (prep.sides[i] === "revenue") revenue += values[i];
    else expenditure += values[i];
  }
  return totals(revenue, expenditure);
}

function baselineFor(prep: Prepared, level: LevelFilter, weights: Float64Array): Baseline {
  let baseline = prep.baselines.get(level);
  if (!baseline) {
    const values = nodeValues(prep, prep.base, weights);
    baseline = { values, totals: sideTotals(prep, values) };
    prep.baselines.set(level, baseline);
  }
  return baseline;
}

/** Look up a budget node by id. */
export function findNode(pack: CountryPack, id: string): BudgetNode | undefined {
  const prep = prepare(pack);
  const i = prep.index.get(id);
  return i === undefined ? undefined : prep.nodes[i];
}

// ---------------------------------------------------------------------------------------------
// Parameters and values
// ---------------------------------------------------------------------------------------------

/**
 * The parameter values a policy runs with: missing or malformed values fall back to the default,
 * numbers are clamped to [min, max], group selections are reduced to ids that exist in the
 * breakdown and put in the breakdown's order, curves are sorted and clamped (see resolveCurve).
 */
export function resolveParams(pack: CountryPack, policy: Policy, given?: ParamValues): ParamValues {
  const out: ParamValues = {};
  for (const param of policy.params) {
    const value = given?.[param.id];
    if (param.type === "number") {
      const n = typeof value === "number" && Number.isFinite(value) ? value : param.default;
      out[param.id] = Math.min(param.max, Math.max(param.min, n));
    } else if (param.type === "curve") {
      out[param.id] = resolveCurve(param, value);
    } else {
      const chosen = new Set<unknown>(Array.isArray(value) ? value : param.default);
      const prep = prepare(pack);
      const shares = prep.breakdowns.get(`${prep.index.get(param.node)}|${param.breakdown}`);
      out[param.id] = shares ? [...shares.keys()].filter((id) => chosen.has(id)) : [];
    }
  }
  return out;
}

function isPoint(value: unknown): value is CurvePoint {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
}

/**
 * The points a curve param runs with. A value that is not a list of points, or has fewer points
 * than minPoints or more than maxPoints, is replaced by the default. Otherwise the points are
 * sorted by x (points with equal x keep their order, which is what makes a step) and clamped
 * into the x and y ranges. Nothing is snapped to the step sizes.
 *
 * A value that is already in order and in range is returned as it is, without copying, so a
 * caller that resolves on every pointer move allocates nothing. The result must not be changed.
 */
export function resolveCurve(param: CurveParam, value: unknown): CurvePoint[] {
  if (!Array.isArray(value)) return param.default;
  const count = value.length;
  if (count < (param.minPoints ?? CURVE_MIN_POINTS) || count > (param.maxPoints ?? CURVE_MAX_POINTS)) return param.default;
  const { x, y } = param;
  let fine = true;
  let previous = -Infinity;
  for (const point of value) {
    if (!isPoint(point)) return param.default;
    if (point.x < previous || point.x < x.min || point.x > x.max || point.y < y.min || point.y > y.max) fine = false;
    previous = point.x;
  }
  if (fine) return value as CurvePoint[];
  return (value as CurvePoint[])
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((point) => ({
      x: Math.min(x.max, Math.max(x.min, point.x)),
      y: Math.min(y.max, Math.max(y.min, point.y)),
    }));
}

/**
 * (paramValue * (scale ?? 1) + (offset ?? 0)) * (indicator value if `times` is set, else 1).
 * NaN if the param is not a number param or the indicator does not exist.
 */
export function evaluateValue(value: Value, params: ParamValues, indicators: Country["indicators"]): number {
  if (typeof value === "number") return value;
  const raw = params[value.param];
  if (typeof raw !== "number") return NaN;
  const result = raw * (value.scale ?? 1) + (value.offset ?? 0);
  if (value.times === undefined) return result;
  const indicator = indicators[value.times];
  return indicator ? result * indicator.value : NaN;
}

/**
 * The reform brackets of a schedule effect at the given parameter values, in the order written.
 * Empty if the reform is given as a curve; scheduleView handles both forms.
 */
export function evaluateBrackets(
  effect: ScheduleEffect,
  params: ParamValues,
  indicators: Country["indicators"],
): Bracket[] {
  if (!("brackets" in effect.reform)) return [];
  return effect.reform.brackets.map((bracket) => ({
    from: evaluateValue(bracket.from, params, indicators),
    rate: evaluateValue(bracket.rate, params, indicators),
  }));
}

// ---------------------------------------------------------------------------------------------
// Schedules as curves
// ---------------------------------------------------------------------------------------------

/** A schedule effect in calculable form, for the helpers in curve.ts. */
export interface ScheduleView {
  distribution: Distribution;
  /** The reform's marginal rates at the given parameter values. */
  reform: RateCurve;
  /** The baseline's marginal rates. Undefined for an effect without a baseline: compare against no tax at all. */
  baseline: RateCurve | undefined;
}

const NO_POINTS: readonly CurvePoint[] = Object.freeze([]);

/** Bracket baselines as curves, converted once per pack. */
const stepCurves = new WeakMap<ConstSchedule, RateCurve>();
/** What the baseline of an effect yields on the effect's distribution; constant for a pack. */
const baselineTotals = new WeakMap<ScheduleEffect, number>();

function baselineCurve(baseline: ConstSchedule): RateCurve {
  if ("points" in baseline) return baseline;
  let curve = stepCurves.get(baseline);
  if (!curve) stepCurves.set(baseline, (curve = bracketsToCurve(baseline.brackets)));
  return curve;
}

function reformCurve(
  effect: ScheduleEffect,
  params: ParamValues,
  indicators: Country["indicators"],
): { curve: RateCurve; adjusted: boolean } {
  const reform = effect.reform;
  if ("curve" in reform) {
    const value = params[reform.curve.param];
    const points = Array.isArray(value) && (value.length === 0 || isPoint(value[0])) ? (value as CurvePoint[]) : NO_POINTS;
    return { curve: { points, scale: reform.curve.scale }, adjusted: false };
  }
  const ordered = orderBrackets(evaluateBrackets(effect, params, indicators));
  return { curve: bracketsToCurve(ordered.brackets), adjusted: ordered.adjusted };
}

/**
 * The two schedules of a schedule effect as curves, whatever form the pack gives them in, plus
 * the distribution they apply to. `params` are the policy's resolved parameter values
 * (resolveParams, or PolicyResult.params).
 *
 * For a reform that is a curve param this wraps the param's points without copying them, so it
 * is cheap enough to call on every pointer move.
 */
export function scheduleView(pack: CountryPack, effect: ScheduleEffect, params: ParamValues): ScheduleView {
  const distribution = pack.distributions[effect.distribution];
  if (!distribution) throw new Error(`Unknown distribution "${effect.distribution}". Validate the pack before using it.`);
  return {
    distribution,
    reform: reformCurve(effect, params, pack.country.indicators).curve,
    baseline: effect.baseline ? baselineCurve(effect.baseline) : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------------------------

interface Run {
  pack: CountryPack;
  prep: Prepared;
  /** Current amount of every leaf, unfiltered. */
  state: Float64Array;
  /** Level filter as a weight per leaf; all ones without a filter. */
  weights: Float64Array;
  /**
   * Per `${node index}|${breakdown id}`: what is left of each group. Starts at the breakdown's
   * normalised shares when an excludeGroups effect first uses the breakdown; that effect and
   * later ones multiply the weights of the groups they exclude by `retained`. All other effects
   * are assumed to hit every group alike and leave the weights alone.
   */
  groupWeights: Map<string, Map<string, number>>;
}

export function simulate(pack: CountryPack, scenario: Scenario = { policies: {} }): SimulationResult {
  const prep = prepare(pack);
  const level: LevelFilter = scenario.level ?? "all";
  const warnings: SimulationWarning[] = [];

  let weights = prep.ones;
  if (level !== "all") {
    weights = prep.weights.get(level) ?? new Float64Array(prep.base.length);
    if (!pack.country.levels[level]) {
      warnings.push({
        code: "unknown_level",
        message: `Level "${level}" does not exist in country "${pack.country.id}"; all amounts are zero.`,
      });
    }
  }

  const baseline = baselineFor(prep, level, weights);
  const run: Run = { pack, prep, state: prep.base.slice(), weights, groupWeights: new Map() };

  const policies: PolicyResult[] = [];
  const delta = totals(0, 0);
  const deltaLow = totals(0, 0);
  const deltaHigh = totals(0, 0);
  for (const policy of pack.policies) {
    const state = scenario.policies[policy.id];
    if (!state || !state.enabled) continue;
    const result = applyPolicy(run, policy, state.params);
    policies.push(result);
    addTo(delta, result.delta);
    addTo(deltaLow, result.low);
    addTo(deltaHigh, result.high);
    for (const warning of result.warnings) warnings.push(warning);
  }

  const values = policies.length === 0 ? baseline.values : nodeValues(prep, run.state, weights);
  const nodes: Record<string, NodeResult> = {};
  for (let i = 0; i < prep.nodes.length; i++) {
    const parent = prep.parents[i];
    const node = prep.nodes[i];
    nodes[node.id] = {
      id: node.id,
      side: prep.sides[i],
      parent: parent >= 0 ? prep.nodes[parent].id : null,
      isLeaf: !("children" in node),
      baseline: baseline.values[i],
      reform: values[i],
      delta: values[i] - baseline.values[i],
    };
  }

  const base = baseline.totals;
  return {
    level,
    baseline: { ...base },
    reform: policies.length === 0 ? { ...base } : sideTotals(prep, values),
    delta,
    deltaLow,
    deltaHigh,
    reformLow: totals(base.revenue + deltaLow.revenue, base.expenditure + deltaLow.expenditure),
    reformHigh: totals(base.revenue + deltaHigh.revenue, base.expenditure + deltaHigh.expenditure),
    nodes,
    policies,
    warnings,
  };
}

/** What one policy does on its own, starting from the base budget. Parameters default as usual. */
export function simulatePolicy(
  pack: CountryPack,
  policyId: string,
  params?: ParamValues,
  level?: LevelFilter,
): PolicyResult | undefined {
  return simulate(pack, { policies: { [policyId]: { enabled: true, params } }, level }).policies[0];
}

/** An amount as a share of the country's GDP. */
export function shareOfGdp(pack: CountryPack, amount: number): number {
  return amount / pack.country.indicators.gdp.value;
}

/** An amount per inhabitant. */
export function perCapita(pack: CountryPack, amount: number): number {
  return amount / pack.country.indicators.population.value;
}

function addTo(sum: Totals, part: Totals): void {
  sum.revenue += part.revenue;
  sum.expenditure += part.expenditure;
  sum.balance += part.balance;
}

function applyPolicy(run: Run, policy: Policy, given: ParamValues | undefined): PolicyResult {
  const params = resolveParams(run.pack, policy, given);
  const warnings: SimulationWarning[] = [];
  const applied = policy.effects.map((effect, index) => applyEffect(run, policy, effect, index, params, warnings));
  const effects = applied.map((entry) => entry.result);
  assignRanges(policy, applied);
  const sums = { revenue: [0, 0, 0], expenditure: [0, 0, 0] };
  effects.forEach((result) => {
    const sum = sums[result.side];
    sum[0] += result.delta;
    sum[1] += result.low;
    sum[2] += result.high;
    if (result.shift) {
      const shifted = sums[result.shift.side];
      shifted[0] += result.shift.delta;
      shifted[1] += result.shift.low;
      shifted[2] += result.shift.high;
    }
  });
  return {
    id: policy.id,
    params,
    delta: totals(sums.revenue[0], sums.expenditure[0]),
    low: totals(sums.revenue[1], sums.expenditure[1]),
    high: totals(sums.revenue[2], sums.expenditure[2]),
    effects,
    warnings,
  };
}

/** A change of a node seen as a change of the balance: more revenue and less spending are positive. */
function onBalance(amount: number, side: Side): number {
  return side === "revenue" ? amount : -amount;
}

/**
 * Fills in `low` and `high` of every effect and shift of a policy.
 *
 * Effects whose uncertainty names the same basis form one group; every other effect is a group of
 * its own. A group takes the multiplier (low or high) that is worse for the sum of its members'
 * effects on the balance, shifts of members with a basis included, and gives every member that
 * multiplier at the low end and the other one at the high end. So effects that depend on the same
 * uncertain quantity move together, and a group whose members cancel out has no range at all.
 *
 * A shift has its own multipliers on top, ordered by the shift's own effect on the balance. If the
 * effect's uncertainty has a basis, the shift moves with the effect's group as well; without one,
 * as before, the effect's multipliers apply to the target only.
 */
function assignRanges(policy: Policy, applied: Applied[]): void {
  interface Group {
    low: number;
    high: number;
    balance: number;
  }
  const groups = new Map<string, Group>();
  const keyOf = (index: number): string => {
    const basis = policy.effects[index].uncertainty?.basis;
    return basis === undefined ? `#${index}` : `basis:${basis}`;
  };
  // The multiplier is chosen on the whole change, not on the part a level filter lets through, so
  // that the low end is one consistent case and the ranges of the levels add up to the whole.
  applied.forEach(({ result, whole, wholeShift }) => {
    const definition = policy.effects[result.index];
    const key = keyOf(result.index);
    let group = groups.get(key);
    if (!group) {
      group = { low: definition.uncertainty?.low ?? 1, high: definition.uncertainty?.high ?? 1, balance: 0 };
      groups.set(key, group);
    }
    group.balance += onBalance(whole, result.side);
    if (definition.uncertainty?.basis !== undefined && result.shift) group.balance += onBalance(wholeShift, result.shift.side);
  });
  applied.forEach(({ result }) => {
    const definition = policy.effects[result.index];
    const group = groups.get(keyOf(result.index))!;
    const [worse, better] =
      group.balance * group.low <= group.balance * group.high ? [group.low, group.high] : [group.high, group.low];
    result.low = result.delta * worse;
    result.high = result.delta * better;
    const shift = result.shift;
    if (!shift) return;
    const linked = definition.uncertainty?.basis !== undefined;
    const own = definition.shift?.uncertainty;
    const [shiftLow] = range(shift.delta * (linked ? worse : 1), shift.side, own);
    const [, shiftHigh] = range(shift.delta * (linked ? better : 1), shift.side, own);
    shift.low = shiftLow;
    shift.high = shiftHigh;
  });
}

/** An applied effect: its result, and the change at its target and at its shift's node without the level filter. */
interface Applied {
  result: EffectResult;
  whole: number;
  wholeShift: number;
}

/** What happened to one node when an effect, or the shifted part of one, was applied. */
interface Change {
  /** Change of the node's total in the state, unfiltered. */
  amount: number;
  /** The same change seen through the level filter. */
  delta: number;
  /** The node was cut off at zero. */
  clamped: boolean;
  /** The node was a group with nothing in it, so the amount was distributed by base proportions. */
  emptyGroup: boolean;
}

function totalOf(run: Run, node: number): number {
  let total = 0;
  for (let i = run.prep.leafStart[node]; i < run.prep.leafEnd[node]; i++) total += run.state[i];
  return total;
}

/** Multiplies every leaf at or below the node by `factor`; a negative factor is cut off at 0. */
function scaleNode(run: Run, node: number, factor: number): Change {
  const { prep, state, weights } = run;
  const clamped = factor < 0;
  if (clamped) factor = 0;
  let amount = 0;
  let delta = 0;
  for (let i = prep.leafStart[node]; i < prep.leafEnd[node]; i++) {
    const old = state[i];
    const next = old * factor;
    state[i] = next;
    amount += next - old;
    delta += (next - old) * weights[i];
  }
  return { amount, delta, clamped, emptyGroup: false };
}

/**
 * Moves the node's total from `current` to `wanted`, cut off at 0. On a group the change is
 * distributed over the leaves in proportion to their current amounts.
 */
function moveNode(run: Run, node: number, current: number, wanted: number): Change {
  const { prep, state, weights } = run;
  const start = prep.leafStart[node];
  const end = prep.leafEnd[node];
  const clamped = wanted < 0;
  if (clamped) wanted = 0;
  let amount = 0;
  let delta = 0;
  let emptyGroup = false;
  if (end - start === 1) {
    amount = wanted - state[start];
    delta = amount * weights[start];
    state[start] = wanted;
  } else if (current > 0) {
    const change = wanted - current;
    for (let i = start; i < end; i++) {
      const old = state[i];
      const next = wanted === 0 ? 0 : Math.max(0, old + change * (old / current));
      state[i] = next;
      amount += next - old;
      delta += (next - old) * weights[i];
    }
  } else if (wanted > 0) {
    // Every leaf below the group is zero, so there are no current proportions to follow.
    // Validation rules this out for base amounts; it can still happen after an earlier effect
    // has emptied the group. Fall back to base proportions, or to equal parts.
    emptyGroup = true;
    let baseSum = 0;
    for (let i = start; i < end; i++) baseSum += prep.base[i];
    for (let i = start; i < end; i++) {
      const next = wanted * (baseSum > 0 ? prep.base[i] / baseSum : 1 / (end - start));
      state[i] = next;
      amount += next;
      delta += next * weights[i];
    }
  }
  return { amount, delta, clamped, emptyGroup };
}

/**
 * `delta` at the two ends of an uncertainty range, ordered by their effect on the balance:
 * more revenue is better, more spending is worse. Returns [low, high].
 */
function range(delta: number, side: Side, uncertainty: { low: number; high: number } | undefined): [number, number] {
  const a = delta * (uncertainty?.low ?? 1);
  const b = delta * (uncertainty?.high ?? 1);
  const aIsWorse = side === "revenue" ? a <= b : a >= b;
  return aIsWorse ? [a, b] : [b, a];
}

/** Shared by every effect that changes nothing; frozen so that it cannot carry anything from one run to the next. */
const NO_CHANGE: Change = Object.freeze({ amount: 0, delta: 0, clamped: false, emptyGroup: false });
const NOT_FINITE = "did not evaluate to a finite number";
const EMPTY_GROUP = "All amounts below the node were zero; the new amount was distributed by base-year proportions.";

function applyEffect(
  run: Run,
  policy: Policy,
  effect: Effect,
  index: number,
  params: ParamValues,
  warnings: SimulationWarning[],
): Applied {
  const { pack, prep } = run;
  const indicators = pack.country.indicators;
  const fail = (problem: string): never => {
    throw new Error(`Policy "${policy.id}", effect ${index}: ${problem}. Validate the pack before simulating it.`);
  };
  const target = prep.index.get(effect.target) ?? fail(`unknown target node "${effect.target}"`);
  const side = prep.sides[target];
  const warn = (code: WarningCode, message: string, node = effect.target): void => {
    warnings.push({ code, message, policy: policy.id, effect: index, node });
  };

  const current = totalOf(run, target);

  // An effect either multiplies every leaf by `factor`, or moves the node's total to `wanted`.
  let factor: number | undefined;
  let wanted = current;
  let affected: AffectedUnits | undefined;
  let model: EffectResult["model"];
  let excludedShare: number | undefined;
  let excludedGroups: string[] | undefined;

  switch (effect.type) {
    case "scale":
      factor = evaluateValue(effect.factor, params, indicators);
      break;
    case "add":
      wanted = current + evaluateValue(effect.amount, params, indicators);
      break;
    case "set":
      wanted = evaluateValue(effect.amount, params, indicators);
      break;
    case "excludeGroups": {
      const key = `${target}|${effect.breakdown}`;
      const shares = prep.breakdowns.get(key) ?? fail(`node "${effect.target}" has no breakdown "${effect.breakdown}"`);
      // A copy for this run: `shares` belongs to the index that is cached for the pack and must never change.
      let left = run.groupWeights.get(key);
      if (!left) run.groupWeights.set(key, (left = new Map(shares)));

      const chosen: unknown = Array.isArray(effect.groups) ? effect.groups : params[effect.groups.param];
      excludedGroups = Array.isArray(chosen)
        ? [...new Set<unknown>(chosen)].filter((id): id is string => typeof id === "string" && shares.has(id))
        : [];
      let all = 0;
      for (const weight of left.values()) all += weight;
      let selected = 0;
      let selectedAtBase = 0;
      for (const id of excludedGroups) {
        selected += left.get(id) ?? 0;
        selectedAtBase += shares.get(id) ?? 0;
      }
      // The share of the node's current amount that the selected groups still stand for.
      excludedShare = all > 0 ? selected / all : 0;
      const retained = effect.retained === undefined ? 0 : evaluateValue(effect.retained, params, indicators);
      factor = 1 - excludedShare * (1 - retained);
      if (Number.isFinite(factor)) {
        for (const id of excludedGroups) left.set(id, Math.max(0, (left.get(id) ?? 0) * retained));
      }
      if (selectedAtBase > 0 && selected === 0) {
        warn(
          "repeated_exclusion",
          `Nothing is left of group(s) ${excludedGroups.join(", ")} of breakdown "${effect.breakdown}" on "${effect.target}": ` +
            "an earlier effect has already removed them completely, so this effect changes nothing.",
        );
      }
      break;
    }
    case "schedule": {
      const dist = pack.distributions[effect.distribution] ?? fail(`unknown distribution "${effect.distribution}"`);
      const baseline = effect.baseline;
      let reform: number;
      let basis: number | undefined; // what the baseline yields, if there is one
      let adjusted: boolean;
      if ("brackets" in effect.reform && (!baseline || "brackets" in baseline)) {
        // Brackets on both sides: the step-function code, as before curves existed.
        const ordered = orderBrackets(evaluateBrackets(effect, params, indicators));
        adjusted = ordered.adjusted;
        reform = scheduleTotal(dist, ordered.brackets);
        if (baseline) basis = scheduleTotal(dist, baseline.brackets);
        affected = affectedUnits(dist, ordered.brackets, baseline?.brackets);
      } else {
        const resolved = reformCurve(effect, params, indicators);
        adjusted = resolved.adjusted;
        reform = curveTotal(dist, resolved.curve);
        const base = baseline ? baselineCurve(baseline) : undefined;
        if (baseline && base) {
          basis = baselineTotals.get(effect);
          if (basis === undefined) baselineTotals.set(effect, (basis = curveTotal(dist, base)));
        }
        affected = curveAffected(dist, resolved.curve, base);
      }
      if (adjusted) {
        warn(
          "brackets_reordered",
          "Bracket thresholds are not ascending at the current parameter values; a threshold below its predecessor was raised to it.",
        );
      }
      let raw: number;
      if (basis === undefined) {
        raw = reform;
      } else if (basis > 0) {
        raw = current * (reform / basis - 1);
      } else {
        raw = 0;
        warn("baseline_yields_nothing", "The baseline schedule yields nothing on this distribution, so the effect cannot be calibrated.");
      }
      wanted = current + raw * (effect.yield === undefined ? 1 : evaluateValue(effect.yield, params, indicators));
      model = basis === undefined ? { reform } : { reform, baseline: basis };
      break;
    }
  }

  let change = NO_CHANGE;
  if (!Number.isFinite(factor ?? wanted)) warn("not_finite", `The effect ${NOT_FINITE} and was skipped.`);
  else if (factor !== undefined) change = scaleNode(run, target, factor);
  else change = moveNode(run, target, current, wanted);
  if (change.emptyGroup) warn("empty_group", EMPTY_GROUP);
  if (change.clamped) warn("clamped", "The effect would have made the amount negative; it was cut off at zero.");

  // low and high are set by assignRanges once every effect of the policy has been applied.
  const result: EffectResult = {
    index,
    type: effect.type,
    target: effect.target,
    side,
    quality: effect.quality,
    delta: change.delta,
    low: change.delta,
    high: change.delta,
    clamped: change.clamped,
  };
  if (affected) result.affected = affected;
  if (model) result.model = model;
  if (excludedShare !== undefined) result.excludedShare = excludedShare;
  if (excludedGroups) result.excludedGroups = excludedGroups;

  // A share of the target's change is passed on to another node, with the opposite sign.
  const shift = effect.shift;
  let wholeShift = 0;
  if (shift) {
    const to = prep.index.get(shift.to) ?? fail(`unknown node "${shift.to}" to shift to`);
    const shifted = -change.amount * evaluateValue(shift.ratio, params, indicators);
    let moved = NO_CHANGE;
    if (!Number.isFinite(shifted)) {
      warn("not_finite", `The shifted amount ${NOT_FINITE}; nothing was shifted.`, shift.to);
    } else if (shifted !== 0) {
      const before = totalOf(run, to);
      moved = moveNode(run, to, before, before + shifted);
    }
    if (moved.emptyGroup) warn("empty_group", EMPTY_GROUP, shift.to);
    if (moved.clamped) warn("clamped", "The shifted amount would have made the receiving node negative; it was cut off at zero.", shift.to);
    result.shift = {
      target: shift.to,
      side: prep.sides[to],
      quality: shift.quality ?? effect.quality,
      delta: moved.delta,
      low: moved.delta,
      high: moved.delta,
      clamped: moved.clamped,
    };
    wholeShift = moved.amount;
  }
  return { result, whole: change.amount, wholeShift };
}
