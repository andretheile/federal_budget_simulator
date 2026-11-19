/**
 * View logic of the goal bar under the scoreboard: which state the progress towards a goal is in,
 * the range of the estimate, what was not counted, and where the parts of the bar lie. Everything
 * here is arithmetic on the engine's GoalProgress; no numbers are made up.
 *
 * The bar is one scale from the lower of zero and the worst figure to the higher of the goal and
 * the best figure: a fill from zero to the improvement (solid when it closes the gap, hatched when
 * it widens it), a thin line for the range, a tick at zero where zero is not the left edge, and the
 * tick of the goal itself.
 */
import { goalLevel, measureGoal, type CountryPack, type Goal, type GoalProgress, type SimulationResult } from "../engine/index.ts";
import { noiseLevel } from "./policyModel.ts";

/**
 * What the measures switched on do towards the goal:
 *   none       no measure is switched on
 *   unchanged  measures are on, but they change nothing at the goal's level
 *   partial    they improve the balance there, but less than the goal asks
 *   closed     they improve it by at least the goal's amount
 *   burden     they worsen it: the gap grows
 */
export type GoalState = "none" | "unchanged" | "partial" | "closed" | "burden";

/**
 * What the goal leaves out (GoalProgress.excluded), in balance terms: the change on a budget item
 * (`node`), or a measure as a whole (`policy`), exactly one of the two.
 */
export interface ExcludedChange {
  node?: string;
  policy?: string;
  /** What the change does to the balance at the goal's level: negative for a burden. */
  improvement: number;
}

export interface GoalBarGeometry {
  /** Positions in percent of the track, 0 at its left edge. */
  zero: number;
  goal: number;
  /** From zero to the improvement; null when there is none. */
  fill: { from: number; to: number; direction: "improve" | "worsen" } | null;
  /** The range of the estimate; null when there is none. */
  range: { from: number; to: number } | null;
  /** The share of the goal that is closed, 0 to 100, for the progress bar's value. */
  value: number;
}

export interface GoalView {
  goal: Goal;
  progress: GoalProgress;
  state: GoalState;
  needed: number;
  /** The improvement, written as zero within floating-point noise. */
  improvement: number;
  /** The range of the estimate, lower end first, including the central figure; undefined if there is none. */
  range?: [number, number];
  /** The most cautious figure: the lowest of the central figure and the two ends of the range. */
  cautious: number;
  /** Closed even at the cautious figure. */
  closedCautious: boolean;
  /** What is missing at the central figure, at least 0. */
  remaining: number;
  /** What is missing at the cautious figure, at least 0. */
  remainingCautious: number;
  /** How far the improvement goes beyond the goal, at least 0. */
  surplus: number;
  /** How far the gap grows: the burden, at least 0. */
  growth: number;
  /** What the goal leaves out, those entries that are not zero, in the goal's order. */
  excluded: ExcludedChange[];
  /** Their sum. */
  excludedTotal: number;
  /**
   * For a goal of one level: how much the other levels together are burdened at the same time, at
   * least 0. Zero for a whole-state goal, and when the other levels are relieved or unchanged.
   */
  othersBurden: number;
  bar: GoalBarGeometry;
}

/**
 * How the balance of all levels but one changes together: the whole state's change less the
 * level's own (counted and excluded alike), written as zero within floating-point noise. A measure
 * that relieves one level by moving a cost to the others shows here as a negative figure.
 */
export function otherLevelsChange(level: SimulationResult, whole: SimulationResult): number {
  const noise = noiseLevel(whole.baseline);
  const change = whole.reform.balance - whole.baseline.balance - (level.reform.balance - level.baseline.balance);
  return Math.abs(change) <= noise ? 0 : change;
}


/**
 * How a goal stands in a scenario, from a result simulated at the goal's level (atGoalLevel). The
 * measures the result holds tell "nothing switched on" from "switched on, but nothing changes here".
 * `whole`, the same scenario for the whole state, tells what the other levels bear at the same
 * time; it is needed only for a goal of one level.
 */
export function goalView(goal: Goal, result: SimulationResult, whole?: SimulationResult): GoalView {
  const progress = measureGoal(goal, result);
  const noise = noiseLevel(result.baseline);
  const zeroed = (value: number): number => (Math.abs(value) <= noise ? 0 : value);
  const needed = progress.needed;
  const improvement = zeroed(progress.improvement);
  const low = zeroed(Math.min(progress.improvementLow, progress.improvementHigh, improvement));
  const high = zeroed(Math.max(progress.improvementLow, progress.improvementHigh, improvement));
  const range: [number, number] | undefined = high - low > noise ? [low, high] : undefined;
  const measuresOn = result.policies.length > 0;
  // Within noise of the goal counts as reached, so that a figure written as "22.0 bn of 22.0 bn" is closed.
  const closed = improvement >= needed - noise;
  const state: GoalState = !measuresOn
    ? "none"
    : closed
      ? "closed"
      : improvement > 0
        ? "partial"
        : improvement < 0
          ? "burden"
          : "unchanged";
  const excluded = progress.excluded.filter((change) => Math.abs(change.improvement) > noise);

  // --- the bar ---
  const min = Math.min(0, low);
  const max = Math.max(needed, high);
  const span = max - min || 1;
  const at = (value: number): number => ((value - min) / span) * 100;
  const zero = at(0);
  const bar: GoalBarGeometry = {
    zero,
    goal: at(needed),
    fill:
      improvement === 0
        ? null
        : improvement > 0
          ? { from: zero, to: at(improvement), direction: "improve" }
          : { from: at(improvement), to: zero, direction: "worsen" },
    range: range ? { from: at(range[0]), to: at(range[1]) } : null,
    value: needed > 0 ? Math.round(Math.min(1, Math.max(0, improvement / needed)) * 100) : 0,
  };

  return {
    goal,
    progress,
    state,
    needed,
    improvement,
    range,
    cautious: low,
    closedCautious: low >= needed - noise,
    remaining: Math.max(0, needed - improvement),
    remainingCautious: Math.max(0, needed - low),
    surplus: Math.max(0, improvement - needed),
    growth: Math.max(0, -improvement),
    excluded,
    excludedTotal: excluded.reduce((sum, change) => sum + change.improvement, 0),
    othersBurden: goal.level !== undefined && whole && whole.level === "all" ? Math.max(0, -otherLevelsChange(result, whole)) : 0,
    bar,
  };
}

/** The goal a page shows: the one asked for, if the pack has it, otherwise the pack's default. */
export function chosenGoal(pack: CountryPack, id: string | undefined): Goal | undefined {
  const goals = pack.goals?.goals ?? [];
  return goals.find((goal) => goal.id === id) ?? goals.find((goal) => goal.id === pack.goals?.default) ?? goals[0];
}

/** Whether a simulation result can be measured against the goal as it is: it is at the goal's level. */
export function atGoalLevel(goal: Goal, result: SimulationResult): boolean {
  return result.level === goalLevel(goal);
}
