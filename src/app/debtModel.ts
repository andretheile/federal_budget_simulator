/**
 * View logic of the debt and interest projection, kept out of the components: which paths there
 * are to show, the facts behind the sentence that opens the section, when interest overtakes the
 * budget items the pack names, when the projection reaches the reference values, and which years
 * the table lists.
 *
 * The projection is always for the pack's whole budget: the whole state, where the pack has several
 * levels of government, or the budget of its one level. If the visitor has filtered the budget view
 * to one level, the scenario is simulated once more without the filter (see useDebtView).
 */
import { useMemo } from "react";
import type { PlanFollowing } from "../i18n/debt/messages.ts";
import {
  findNode,
  firstYearAbove,
  projectDebt,
  simulate,
  type CountryPack,
  type DebtAssumptions,
  type DebtPath,
  type DebtProjection,
  type DebtReference,
  type DebtYear,
  type LocalizedText,
  type Scenario,
  type SimulationResult,
} from "../engine/index.ts";

/**
 * Whether the projection covers a state of several levels of government, which the texts call "the
 * state", or the budget of the pack's one level, which they do not name (see i18n/debt/messages.ts).
 */
export function coversState(pack: CountryPack): boolean {
  return Object.keys(pack.country.levels).length > 1;
}

/**
 * How the projection follows the plan it follows, in the plan's years within the horizon: its debt,
 * its budget before interest where the plan gives no debt (`followed.balanceYears`), or both in
 * different years. Undefined where it follows none.
 */
export function planFollowing(projection: DebtProjection, pack: CountryPack): PlanFollowing | undefined {
  const followed = projection.followed;
  if (!followed) return undefined;
  const balance = new Set(followed.balanceYears ?? []);
  if (balance.size === 0) return "debt";
  const plan = pack.debt?.plans?.find((candidate) => candidate.id === followed.plan);
  const years = (plan?.points ?? []).map((point) => point.year).filter((year) => year > projection.baseYear && year <= followed.until);
  return years.every((year) => balance.has(year)) ? "balance" : "mixed";
}

export interface DebtView {
  projection: DebtProjection;
  /** The simulation of the scenario without a level filter, which the projection starts from. */
  whole: SimulationResult;
  /** Whether at least one measure is switched on. */
  measuresOn: boolean;
  /** Whether the measures change the projection: then there are two paths, without and with them. */
  twoPaths: boolean;
  /** Whether the range of the measures' estimates gives a band around the path with them. */
  hasRange: boolean;
}

/** All records of a path, base year first. */
export function recordsOf(path: Pick<DebtPath, "start" | "years">): DebtYear[] {
  return [path.start, ...path.years];
}

/** The last year of a path: the end of the horizon. */
export function lastOf(path: Pick<DebtPath, "start" | "years">): DebtYear {
  return path.years[path.years.length - 1] ?? path.start;
}

/** The record of a year (the pack's year), if the path has it. */
export function recordAt(path: Pick<DebtPath, "start" | "years">, year: number): DebtYear | undefined {
  if (year === path.start.year) return path.start;
  return path.years[year - path.start.year - 1];
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12 + 1e-9 * Math.max(Math.abs(a), Math.abs(b));

/** Whether two paths show the same figures in every year, up to floating-point dust. */
export function samePath(a: Pick<DebtPath, "start" | "years">, b: Pick<DebtPath, "start" | "years">): boolean {
  const left = recordsOf(a);
  const right = recordsOf(b);
  return (
    left.length === right.length &&
    left.every(
      (year, i) =>
        close(year.debtRatio, right[i].debtRatio) &&
        close(year.interestToRevenue, right[i].interestToRevenue) &&
        close(year.interestRatio, right[i].interestRatio),
    )
  );
}

/** The projection for a scenario: `result` is the simulation the page shows, which may be filtered to one level. */
export function debtView(
  pack: CountryPack,
  scenario: Scenario,
  result: SimulationResult,
  assumptions: Partial<DebtAssumptions> | undefined,
): DebtView | undefined {
  if (!pack.debt) return undefined;
  const whole = result.level === "all" ? result : simulate(pack, { ...scenario, level: "all" });
  return viewOf(pack, whole, assumptions);
}

function viewOf(pack: CountryPack, whole: SimulationResult, assumptions: Partial<DebtAssumptions> | undefined): DebtView {
  const projection = projectDebt(pack, whole, assumptions);
  const measuresOn = whole.policies.length > 0;
  return {
    projection,
    whole,
    measuresOn,
    twoPaths: measuresOn && !samePath(projection.baseline, projection.reform),
    hasRange: measuresOn && !samePath(projection.reformLow, projection.reformHigh),
  };
}

/**
 * debtView as a hook: the unfiltered simulation is redone only when the scenario changes, the
 * projection when the scenario or an assumption changes. Undefined for a pack without debt data.
 */
export function useDebtView(
  pack: CountryPack,
  scenario: Scenario,
  result: SimulationResult,
  assumptions: Partial<DebtAssumptions> | undefined,
): DebtView | undefined {
  const whole = useMemo(
    () => (!pack.debt ? undefined : result.level === "all" ? result : simulate(pack, { ...scenario, level: "all" })),
    [pack, scenario, result],
  );
  return useMemo(() => (whole && pack.debt ? viewOf(pack, whole, assumptions) : undefined), [pack, whole, assumptions]);
}

// --- budget items -------------------------------------------------------------------------------

/** When interest is above a budget item on one path. */
export interface Crossing {
  /** The first year, base year included, in which interest is above the item; null if never within the horizon. */
  first: number | null;
  /** Whether interest is above the item in the last year of the horizon. */
  atEnd: boolean;
  /** If interest falls back below the item after `first`: the first year in which it is no longer above. */
  drop: number | null;
}

export interface ComparisonRow {
  node: string;
  /** The pack's name for the comparison, or else the node's label. */
  label: LocalizedText;
  /** The item's base-year amount for the whole budget without the measures, and its share of GDP. */
  amount: number;
  share: number;
  /** The same with the measures, which may change the item itself. */
  amountWith: number;
  shareWith: number;
  /** Interest against the item without the measures. */
  without: Crossing;
  /** Interest with the measures against the item with the measures; the same as `without` if they change nothing. */
  with: Crossing;
}

/**
 * When interest is above the item on a path. Like all spending in the projection, the item keeps
 * its base-year share of GDP, so the comparison is between interest and that share.
 */
export function crossing(path: Pick<DebtPath, "start" | "years">, share: number): Crossing {
  const first = firstYearAbove(path, share, "interestRatio");
  if (first === null) return { first: null, atEnd: false, drop: null };
  const after = recordsOf(path).find((record) => record.year > first && !(record.interestRatio > share));
  return { first, atEnd: lastOf(path).interestRatio > share, drop: after ? after.year : null };
}

/** The budget items the pack compares interest with, in the pack's order. */
export function interestComparisons(pack: CountryPack, view: DebtView): ComparisonRow[] {
  const gdp = pack.country.indicators.gdp.value;
  const { projection, whole } = view;
  return (pack.debt?.comparisons ?? []).flatMap((comparison) => {
    const node = whole.nodes[comparison.node];
    if (!node) return [];
    const share = node.baseline / gdp;
    const shareWith = node.reform / gdp;
    const without = crossing(projection.baseline, share);
    return [
      {
        node: comparison.node,
        label: comparison.label ?? findNode(pack, comparison.node)?.label ?? { en: comparison.node },
        amount: node.baseline,
        share,
        amountWith: node.reform,
        shareWith,
        without,
        with: view.measuresOn ? crossing(projection.reform, shareWith) : without,
      },
    ];
  });
}

// --- reference values ---------------------------------------------------------------------------

export interface ReferenceReach {
  /** The reference value, a fraction of GDP. */
  value: number;
  /** The first year the path without the measures is above it, base year included; null if never within the horizon. */
  without: number | null;
  /** The same for the path with the measures. */
  with: number | null;
}

export interface ReferenceRow {
  reference: DebtReference;
  /** Interest as a share of all revenue, if the reference gives revenue as well (interestRatio / revenueRatio). */
  interestRevenue?: ReferenceReach;
  /** Interest as a share of GDP, if the reference gives it. */
  interest?: ReferenceReach;
  /** Debt as a share of GDP, if the reference gives it. */
  debt?: ReferenceReach;
}

/** A reference's interest as a share of its revenue, if it gives both. */
export function interestToRevenue(reference: DebtReference): number | undefined {
  return reference.interestRatio !== undefined && reference.revenueRatio !== undefined && reference.revenueRatio > 0
    ? reference.interestRatio / reference.revenueRatio
    : undefined;
}

/** Each reference of the pack, with the years in which the projection gets above its values. */
export function referenceRows(pack: CountryPack, view: DebtView): ReferenceRow[] {
  const { baseline, reform } = view.projection;
  const reach = (value: number | undefined, measure: "interestToRevenue" | "interestRatio" | "debtRatio"): ReferenceReach | undefined =>
    value === undefined
      ? undefined
      : { value, without: firstYearAbove(baseline, value, measure), with: firstYearAbove(reform, value, measure) };
  return (pack.debt?.references ?? []).map((reference) => ({
    reference,
    interestRevenue: reach(interestToRevenue(reference), "interestToRevenue"),
    interest: reach(reference.interestRatio, "interestRatio"),
    debt: reach(reference.debtRatio, "debtRatio"),
  }));
}

// --- the sentence that opens the section --------------------------------------------------------

/** The facts behind the opening sentence: ratios as fractions, years as the pack's years (numbers). */
export interface DebtHeadline {
  /** The last year of the horizon, which the sentence speaks of. */
  year: number;
  baseYear: number;
  /** The market rate on new debt, in percent as the assumption has it. */
  marketRate: number;
  /** Interest as a share of all revenue: in the base year as it is, and in the last year. */
  interestToday: number;
  /** With the measures, or without them if they change nothing. */
  interest: number;
  /** Without the measures, if they change the projection. */
  interestWithout?: number;
  /** The range of the measures' estimates for `interest`, lower value first. */
  interestRange?: [number, number];
  /** Debt as a share of GDP: in the base year and in the last year, with and without the measures. */
  debtToday: number;
  debt: number;
  debtWithout?: number;
  /** The year the debt is paid off, if that happens within the horizon (on the path with the measures). */
  paidOff?: number;
  /** The largest of the compared items that interest is above in the last year, and since when. */
  overtakes?: { label: LocalizedText; since: number };
}

export function debtHeadline(view: DebtView, comparisons: readonly ComparisonRow[] = []): DebtHeadline {
  const { projection, twoPaths, hasRange } = view;
  const { baseline, reform, reformLow, reformHigh } = projection;
  const end = lastOf(reform);
  const paid = reform.years.find((record) => record.debt === 0);
  let overtakes: DebtHeadline["overtakes"];
  let largest = -Infinity;
  for (const row of comparisons) {
    if (row.with.atEnd && row.with.first !== null && row.shareWith > largest) {
      largest = row.shareWith;
      overtakes = { label: row.label, since: row.with.drop === null ? row.with.first : lastAboveStart(reform, row.shareWith) };
    }
  }
  const low = lastOf(reformLow).interestToRevenue;
  const high = lastOf(reformHigh).interestToRevenue;
  return {
    year: end.year,
    baseYear: projection.baseYear,
    marketRate: projection.assumptions.market_rate,
    interestToday: baseline.start.interestToRevenue,
    interest: end.interestToRevenue,
    interestWithout: twoPaths ? lastOf(baseline).interestToRevenue : undefined,
    interestRange: hasRange ? [Math.min(low, high), Math.max(low, high)] : undefined,
    debtToday: baseline.start.debtRatio,
    debt: end.debtRatio,
    debtWithout: twoPaths ? lastOf(baseline).debtRatio : undefined,
    paidOff: paid?.year,
    overtakes,
  };
}

/** The first year of the last stretch in which interest stays above `share` up to the end. */
function lastAboveStart(path: Pick<DebtPath, "start" | "years">, share: number): number {
  const records = recordsOf(path);
  let since = records[records.length - 1].year;
  for (let i = records.length - 1; i >= 0 && records[i].interestRatio > share; i--) since = records[i].year;
  return since;
}

// --- the table ----------------------------------------------------------------------------------

/** The years the table lists: the base year, steps of 1, 2, 5 or 10 years, and always the last year. */
export function tableYears(baseYear: number, horizon: number): number[] {
  const step = horizon <= 6 ? 1 : horizon <= 12 ? 2 : horizon <= 35 ? 5 : 10;
  const years: number[] = [];
  for (let t = 0; t < horizon; t += step) years.push(baseYear + t);
  years.push(baseYear + horizon);
  return years;
}
