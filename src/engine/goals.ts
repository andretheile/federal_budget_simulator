/**
 * Goals (goals.json): how far a scenario goes towards a target for the balance of one level of
 * government, or of the whole state.
 *
 * The improvement is the change of that level's balance that the scenario causes, reform minus
 * baseline, with the low and high end of the measures' range: for a single level the same figures
 * that the interface shows as the relief or burden of that level, for the whole state the change
 * of the balance. The goal names its level, so the result does not depend on the level filter the
 * scenario carries.
 *
 * A goal can exclude budget nodes and measures (Goal.excluded). For a node, the changes on it and on
 * every node below it do not count. For a measure, its own result inside the scenario at the goal's
 * level does not count (PolicyResult.delta, low and high: the figure the interface shows for it at
 * that level), so the order in which measures act on the same items stays as it is. A change that
 * falls under both, an excluded measure acting on an excluded node, is left out once and counted
 * under the measure's entry. The improvement is what is left; the excluded part is reported beside
 * it, so that counted plus excluded is again the level's figure.
 *
 * The low and high end of the excluded part follow the linked ranges of the simulation: at the low
 * end an excluded measure contributes its own low value (PolicyResult.low), and every other effect
 * and shift on an excluded node its own low value (EffectResult.low, ShiftResult.low), at the high
 * end the high values. So the counted and the excluded part describe the same case at each end and
 * add up to the level's deltaLow and deltaHigh; the end is not chosen anew for the counted part
 * alone, and its low end can lie above its central value. This needs every effect and shift of a
 * measure that is not excluded to target a node either inside an excluded node or outside all of
 * them, never a group above one; validation ensures that, and measureGoal throws otherwise.
 *
 * Like every figure of the simulation, the improvement is a static effect on the base year's
 * budget. The goal's amount usually refers to a later year and may come from different accounts;
 * the pack's note on the goal says what that glosses over.
 */
import { simulate, type LevelFilter, type Scenario, type Side, type SimulationResult } from "./simulate.ts";
import type { CountryPack, Goal } from "./types.ts";

export interface GoalProgress {
  goal: Goal;
  /** The level whose balance the goal is about: the goal's level, or "all" for the whole state. */
  level: LevelFilter;
  /** How much the balance has to improve: the goal's amount. */
  needed: number;
  /**
   * How far the scenario improves the level's balance, as far as it counts: reform minus baseline
   * balance at that level, less the excluded part. Negative if it worsens it. Without any measure
   * exactly 0; without exclusions exactly the level's figure.
   */
  improvement: number;
  /**
   * The improvement at the low end of the measures' range: SimulationResult.deltaLow.balance at the
   * level, less the excluded part at the low end. As everywhere in the simulation, each measure takes
   * the end of its range that is worse for the whole state; for a single level this can lie above
   * `improvement`, see Uncertainty.basis.
   */
  improvementLow: number;
  /** The improvement at the high end of the range: SimulationResult.deltaHigh.balance at the level, less the excluded part. */
  improvementHigh: number;
  /**
   * One entry per excluded node or measure of the goal, in the goal's order, with exactly one of
   * `node` and `policy`: the improvement of the level's balance that does not count, on that node
   * and below it, or by that measure; 0 if the scenario changes nothing there or the measure is off.
   * A measure's entry includes what it changes on excluded nodes; the node's entry does not.
   */
  excluded: { node?: string; policy?: string; improvement: number }[];
  /** The sum of `excluded`: improvement + excludedImprovement is the level's figure. */
  excludedImprovement: number;
  /** The excluded part at the low end of the range: improvementLow + excludedImprovementLow is the level's deltaLow. */
  excludedImprovementLow: number;
  /** The excluded part at the high end of the range: improvementHigh + excludedImprovementHigh is the level's deltaHigh. */
  excludedImprovementHigh: number;
  /** needed - improvement, but at least 0: what is still missing. */
  remaining: number;
  /** needed - improvementLow, at least 0: what is missing at the low end of the range. */
  remainingLow: number;
  /** needed - improvementHigh, at least 0: what is missing at the high end of the range. */
  remainingHigh: number;
  /** improvement / needed: 1 when the goal is just reached, above 1 beyond it, below 0 if the balance worsens. */
  share: number;
  /** improvement >= needed */
  closed: boolean;
  /** improvementLow >= needed: closed even at the low end of the range. */
  closedLow: boolean;
  /** improvementHigh >= needed: closed at the high end of the range. */
  closedHigh: boolean;
}

/** The level a goal is about: its own, or "all" for the whole state. */
export function goalLevel(goal: Goal): LevelFilter {
  return goal.level ?? "all";
}

/** The goal with this id; undefined if the pack has no goals or none with this id. */
export function findGoal(pack: CountryPack, id: string): Goal | undefined {
  return pack.goals?.goals.find((goal) => goal.id === id);
}

/** The goal the pack names as its default; undefined if the pack has no goals.json. */
export function defaultGoal(pack: CountryPack): Goal | undefined {
  return pack.goals ? findGoal(pack, pack.goals.default) : undefined;
}

/** A change of a node seen as a change of the balance: more revenue and less spending are positive. No -0. */
function onBalance(amount: number, side: Side): number {
  return side === "revenue" ? amount : 0 - amount;
}

/** Whether node `id` is `root` or lies below it, by the parent links of the result. */
function within(result: SimulationResult, id: string, root: string): boolean {
  let current: string | null = id;
  while (current !== null) {
    if (current === root) return true;
    current = result.nodes[current]?.parent ?? null;
  }
  return false;
}

/** The excluded part of a result: per entry at the central value, in total at both ends of the range. */
function excludedPart(
  goal: Goal,
  result: SimulationResult,
): Pick<GoalProgress, "excluded" | "excludedImprovement" | "excludedImprovementLow" | "excludedImprovementHigh"> {
  const entries = goal.excluded ?? [];
  const fail = (problem: string): never => {
    throw new Error(`Goal "${goal.id}" ${problem}. Validate the pack before using it.`);
  };
  const policies = new Set<string>();
  const nodes: string[] = [];
  for (const entry of entries) {
    if ((entry.node === undefined) === (entry.policy === undefined)) fail('has an excluded entry without exactly one of "node" and "policy"');
    if (entry.policy !== undefined) policies.add(entry.policy);
    if (entry.node !== undefined) {
      if (!result.nodes[entry.node]) fail(`excludes the unknown node "${entry.node}"`);
      nodes.push(entry.node);
    }
  }

  const byPolicy = new Map<string, number>();
  const byNode = new Map<string, number>(nodes.map((node) => [node, 0]));
  let low = 0;
  let high = 0;
  for (const policy of result.policies) {
    if (policies.has(policy.id)) {
      // All of the measure's change is left out under its own entry, including what falls on an
      // excluded node, so that nothing is left out twice.
      byPolicy.set(policy.id, policy.delta.balance);
      low += policy.low.balance;
      high += policy.high.balance;
      continue;
    }
    for (const effect of policy.effects) {
      for (const part of [effect, effect.shift]) {
        if (!part) continue;
        const outer = nodes.find((node) => node !== part.target && within(result, node, part.target));
        if (outer !== undefined) {
          fail(
            `excludes "${outer}", but effect ${effect.index} of policy "${policy.id}" changes "${part.target}", ` +
              "a group above it, as a whole; the excluded part cannot be told apart",
          );
        }
        const node = nodes.find((candidate) => within(result, part.target, candidate));
        if (node === undefined) continue;
        byNode.set(node, (byNode.get(node) ?? 0) + onBalance(part.delta, part.side));
        low += onBalance(part.low, part.side);
        high += onBalance(part.high, part.side);
      }
    }
  }
  const excluded = entries.map((entry) =>
    entry.policy !== undefined
      ? { policy: entry.policy, improvement: byPolicy.get(entry.policy) ?? 0 }
      : { node: entry.node as string, improvement: byNode.get(entry.node as string) ?? 0 },
  );
  return {
    excluded,
    excludedImprovement: excluded.reduce((sum, entry) => sum + entry.improvement, 0),
    excludedImprovementLow: low,
    excludedImprovementHigh: high,
  };
}

/**
 * How far a simulation result goes towards a goal. The result must be simulated at the goal's level
 * (goalLevel); for any other level this throws, since the figures would belong to another level.
 * Use it to measure several goals of one level against one simulation; goalProgress simulates by
 * itself.
 */
export function measureGoal(goal: Goal, result: SimulationResult): GoalProgress {
  const level = goalLevel(goal);
  if (result.level !== level) {
    throw new Error(
      `Goal "${goal.id}" is about level "${level}", but the result is for level "${result.level}". ` +
        "Simulate at the goal's level, or use goalProgress.",
    );
  }
  const needed = goal.amount;
  const part = excludedPart(goal, result);
  const improvement = result.reform.balance - result.baseline.balance - part.excludedImprovement;
  const improvementLow = result.deltaLow.balance - part.excludedImprovementLow;
  const improvementHigh = result.deltaHigh.balance - part.excludedImprovementHigh;
  const missing = (value: number): number => Math.max(0, needed - value);
  return {
    goal,
    level,
    needed,
    improvement,
    improvementLow,
    improvementHigh,
    ...part,
    remaining: missing(improvement),
    remainingLow: missing(improvementLow),
    remainingHigh: missing(improvementHigh),
    share: improvement / needed,
    closed: improvement >= needed,
    closedLow: improvementLow >= needed,
    closedHigh: improvementHigh >= needed,
  };
}

/**
 * How far a scenario goes towards a goal, given as the goal itself or its id. The scenario is
 * simulated at the goal's level, whatever level filter it carries. Undefined if the id names no
 * goal of the pack.
 */
export function goalProgress(pack: CountryPack, scenario: Scenario, goal: Goal): GoalProgress;
export function goalProgress(pack: CountryPack, scenario: Scenario, goal: string): GoalProgress | undefined;
export function goalProgress(pack: CountryPack, scenario: Scenario, goal: Goal | string): GoalProgress | undefined {
  const found = typeof goal === "string" ? findGoal(pack, goal) : goal;
  if (!found) return undefined;
  return measureGoal(found, simulate(pack, { ...scenario, level: goalLevel(found) }));
}
