/**
 * The official plans of a pack's debt.json (`plans`) beside the projection: which can be drawn
 * against it (the pack's whole budget in the projection's accounts, isComparablePlanIn) and which
 * are figures of their own, their values year by year, how a plan is followed, and how a comparable
 * plan differs from the calculation at its defaults. Used by the body of the debt section only, so
 * it loads with it.
 */
import type { PlanFollowing } from "../i18n/debt/messages.ts";
import {
  isComparablePlanIn,
  projectDebt,
  type CountryPack,
  type DebtAssumptions,
  type DebtPlan,
  type DebtPlanPoint,
  type SimulationResult,
} from "../engine/index.ts";
import { recordAt } from "./debtModel.ts";


/** The figures of a plan that can be drawn against a path of the projection. */
export type PlanMeasure = "debtRatio" | "interestRatio" | "interestToRevenue";

/** The pack's official plans that describe what the projection describes, and can be drawn against it. */
export function comparablePlans(pack: CountryPack): DebtPlan[] {
  const debt = pack.debt;
  return debt ? (debt.plans ?? []).filter((plan) => isComparablePlanIn(debt, plan)) : [];
}

/** The pack's other official plans: another scope or other accounts, figures of their own. */
export function otherPlans(pack: CountryPack): DebtPlan[] {
  const debt = pack.debt;
  return debt ? (debt.plans ?? []).filter((plan) => !isComparablePlanIn(debt, plan)) : [];
}

/**
 * What following a plan takes from it in its years after the base year: its debt where every such
 * point gives one, its budget before interest where none does (a budget that projects deficits but
 * no debt), and either in its years where some do.
 */
export function planFollowingOf(plan: DebtPlan, baseYear: number): PlanFollowing {
  const points = plan.points.filter((point) => point.year > baseYear);
  const withDebt = points.filter((point) => point.debtRatio !== undefined).length;
  return withDebt === points.length ? "debt" : withDebt === 0 ? "balance" : "mixed";
}

/** A plan's values of one figure, year by year, where it gives one, within the years from `first` to `last`. */
export function planSeries(plan: DebtPlan, measure: PlanMeasure, first: number, last: number): { year: number; value: number }[] {
  return plan.points.flatMap((point) => {
    const value = point[measure];
    return value !== undefined && Number.isFinite(value) && point.year >= first && point.year <= last ? [{ year: point.year, value }] : [];
  });
}

/** The figures a plan gives in any of its years, in a fixed order. */
export const PLAN_FIELDS = ["debtRatio", "balanceRatio", "interestRatio", "interestToRevenue", "interest"] as const satisfies readonly (keyof DebtPlanPoint)[];

export function planFields(plan: DebtPlan): (typeof PLAN_FIELDS)[number][] {
  return PLAN_FIELDS.filter((field) => plan.points.some((point) => point[field] !== undefined));
}

/**
 * The last year in which a comparable plan gives the debt ratio, with the plan's value and that of
 * the base year's budget continued, at the default assumptions and without measures: the plan
 * starts from what has been decided since the base year, the continuation does not. Undefined if the plan gives no debt
 * ratio, or its year lies beyond the horizon of the defaults.
 */
export function planAgainstDefaults(
  pack: CountryPack,
  plan: DebtPlan,
  whole: SimulationResult,
  defaults: DebtAssumptions,
): { year: number; plan: number; model: number } | undefined {
  const point = [...plan.points].reverse().find((candidate) => candidate.debtRatio !== undefined);
  if (!point || point.debtRatio === undefined || !pack.debt) return undefined;
  // The base year's budget continued: no plan followed, whatever the pack's starting path.
  const record = recordAt(projectDebt(pack, whole, { ...defaults, follow: null }).baseline, point.year);
  return record ? { year: point.year, plan: point.debtRatio, model: record.debtRatio } : undefined;
}
