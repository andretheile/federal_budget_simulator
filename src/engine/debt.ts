/**
 * The debt and interest projection: where the balance of a scenario leads over the coming years.
 *
 * It is a what-if calculation, not a forecast. Money is in currency units per year, ratios and
 * rates in the results are fractions (0.6 is 60 %). The assumptions are in the units of their
 * params in debt.json: percent, percent, years, and percentage points of GDP per year.
 *
 * The model, for year t = 1 ... horizon (the pack's year baseYear + t):
 *   - GDP grows by the nominal growth rate g: GDP_t = GDP_0 (1 + g)^t.
 *   - The primary balance (the balance before interest) keeps the base year's share of GDP, plus
 *     the drift for every year that has passed: p_t = p_0 + drift t, P_t = p_t GDP_t, with
 *     p_0 = (balance + interest) / GDP_0 of the scenario. Revenue keeps its share of GDP as well.
 *     So every measure applies in full and for good from the first year on.
 *   - The debt at the end of the previous year, D_{t-1}, carries the average rate ρ_{t-1}. In year t
 *     the refinanced share s of it moves to the market rate m, so it pays ρ'_t = (1 - s) ρ_{t-1} + s m
 *     and interest is I_t = ρ'_t D_{t-1}. Money borrowed during year t pays interest from t + 1 on.
 *   - The deficit I_t - P_t is added to the debt and carries the market rate:
 *     ρ_t = (ρ'_t D_{t-1} + m (I_t - P_t)) / D_t. A surplus repays debt and leaves the rate of the
 *     rest at ρ'_t. The debt does not go below zero; a surplus beyond that is not counted.
 *   - The starting rate ρ_0 is base-year interest divided by the debt at the end of the base year.
 *
 * Base-year interest is the base amount of the budget's interest node (debt.json `interest.node`)
 * if the pack names one, otherwise `interest.value`. The primary balance uses the interest of the
 * scenario, so in the base year primary balance - interest equals the simulated balance exactly.
 * Interest after the base year is computed from the debt, so a measure that changes the interest
 * node itself changes the base-year balance but not the projection.
 *
 * The projection covers the pack's whole budget, every level of government it has, in the accounts
 * of that budget (debt.json `accounts`): the whole state in national accounts for the German pack,
 * the federal government in the unified budget for the US pack. `projectDebt` refuses a result
 * filtered to one level of government, `projectScenario` ignores the scenario's level filter.
 *
 * Years are the pack's years (country.json `baseYearStart`): calendar years, or fiscal years such
 * as the US one from October to September; year t of the projection is the pack's year
 * baseYear + t, and GDP, the plan's points and the timing of measures are counted in those years.
 *
 * Measures act from the first year measures can act (debt.json `measuresFrom`, by default the
 * first projection year), each in full unless its `timing` says it starts later or builds up over
 * years (timing.ts). Where every measure acts in full from the first projection year, the paths
 * with measures are computed exactly as described above. Otherwise each year's primary balance and
 * revenue with measures come from the scenario simulated with each measure at its share of that
 * year (simulateWeighted), so measures that act on the same items interact as they do in full; see
 * timedEffects.
 *
 * The starting path is either the base year's budget, as above, or an official plan (debt.json
 * `plans`) that the projection follows in the plan's years and continues from its last year with
 * the assumptions; see followPaths. In a plan's year it meets the plan's debt ratio, or, where the
 * plan projects no debt (the US budget), takes the plan's primary balance. Which path is the
 * pack's choice (debt.json `follow`), and the visitor can choose the other (DebtAssumptions.follow).
 *
 * The debt grows by the deficit alone: what else moves it (loans the state grants, the US credit
 * financing accounts, changes in cash balances) is carried only in a followed plan's years that give
 * a debt ratio, and not projected beyond them; there is no assumption for it.
 */
import { simulate, simulateWeighted, type Scenario, type SimulationResult, type Totals } from "./simulate.ts";
import { measurePhase, measuresFrom, shareInYear, type MeasurePhase } from "./timing.ts";
import {
  DEBT_ASSUMPTION_IDS,
  type CountryPack,
  type DebtAssumptionId,
  type DebtAssumptionParam,
  type DebtFile,
  type DebtPlan,
  type DebtPlanAccounts,
  type DebtPlanPoint,
  type DebtPreset,
} from "./types.ts";

/**
 * Values of the assumptions, keyed by id, in the units of their params (see DebtAssumptionId), and
 * the starting path.
 *
 * `follow` is the starting path:
 *   a plan id   follow that plan of debt.json `plans` (it must be one that can be followed,
 *               isFollowablePlanIn). In the plan's years the path without measures reproduces the
 *               plan's debt ratio, or where the plan gives none its primary balance, with the plan's
 *               growth where it gives one; after the plan's last year the primary balance is the
 *               plan's primary balance of that year, as a share of GDP, see followPaths.
 *   null        continue the base year's budget: no plan is followed.
 *   absent      the pack's starting path: debt.json `follow` if it names one, otherwise the base
 *               year's budget.
 * resolveDebtAssumptions writes it out: the plan id, or null where the pack names a plan but the
 * base year is chosen. Only for a pack that names no plan, where the base year is the default,
 * does it stay absent, so that such a pack's assumptions look as they always did.
 */
export type DebtAssumptions = Record<DebtAssumptionId, number> & { follow?: string | null };

/** One year of a path. Money in currency units, ratios and rates as fractions. */
export interface DebtYear {
  year: number;
  gdp: number;
  /** Revenue, at the scenario's share of GDP. */
  revenue: number;
  /** Revenue minus spending other than interest. */
  primaryBalance: number;
  /** Interest paid in the year, on the debt at the end of the year before. */
  interest: number;
  /** primaryBalance - interest; negative is a deficit. */
  balance: number;
  /** Debt at the end of the year, as the pack's stock measures it (debt.json `stock`). Never below zero. */
  debt: number;
  /** debt / gdp */
  debtRatio: number;
  /** interest / gdp */
  interestRatio: number;
  /** interest / revenue */
  interestToRevenue: number;
  /** primaryBalance / gdp */
  primaryBalanceRatio: number;
  /** balance / gdp */
  balanceRatio: number;
  /**
   * Average interest rate the debt carries at the end of the year, after this year's refinancing
   * and new borrowing. In the base year: base-year interest / debt, the model's starting rate.
   */
  averageRate: number;
}

/** Where the debt ratio of a path ends up if the assumptions held for ever. */
export type DebtLongRun =
  /** The ratio settles at `debtRatio` (a fraction of GDP); 0 means the debt is paid off. */
  | { kind: "converges"; debtRatio: number }
  /** The debt grows faster than the economy without limit. */
  | { kind: "diverges" }
  /** The drift keeps changing the primary balance, so the ratio never settles. */
  | { kind: "drifts" };

export interface DebtPath {
  /** The base year: debt and interest as observed, primary balance and balance of this path. */
  start: DebtYear;
  /** One record per year from baseYear + 1 to baseYear + horizon. */
  years: DebtYear[];
  longRun: DebtLongRun;
}

export interface DebtProjection {
  /** The assumptions the projection ran with: defaults filled in, values clamped to their range, horizon rounded. */
  assumptions: DebtAssumptions;
  baseYear: number;
  /** Share of the debt refinanced each year (debt.json `refinancing.share`). */
  refinancingShare: number;
  /** Base-year interest that sets the starting rate: the interest node's base amount, or `interest.value`. */
  baseInterest: number;
  /** Without any measure. */
  baseline: DebtPath;
  /** With the scenario's measures. The same as `baseline` if none is enabled. */
  reform: DebtPath;
  /**
   * Set when the projection follows a plan (assumptions.follow) and the plan has a year within the
   * horizon: `plan` is its id, `until` the last year taken from the plan. Years up to `until` are
   * the plan's (for the path without measures), later years the continuation. `balanceYears`, where
   * there are any, are the plan's years in which it gives no debt ratio: there the path takes the
   * plan's primary balance and computes interest and debt itself, instead of meeting the plan's debt.
   */
  followed?: { plan: string; until: number; balanceYears?: number[] };
  /** From the low end of the measures' range (reformLow.balance), the worse one: its debt is the higher. */
  reformLow: DebtPath;
  /** From the high end of the measures' range (reformHigh.balance): its debt is the lower. */
  reformHigh: DebtPath;
  /**
   * The first year in which measures can act (debt.json `measuresFrom`, by default the first
   * projection year). Before it the paths with measures are the path without them; if it lies
   * after the first projection year, their base-year record is the observed base year as well.
   */
  measuresFrom: number;
  /**
   * When each measure that is switched on acts, in pack order: start, years of build-up, the first
   * year of its full effect, and whether it acts in full from `measuresFrom` (`immediate`).
   */
  phases: MeasurePhase[];
}

/** The numeric fields of DebtYear, for the search helpers. */
export type DebtMeasure = Exclude<keyof DebtYear, "year">;

/** The param of an assumption. Throws if the pack lacks it, which validation rules out. */
export function debtAssumptionParam(debt: DebtFile, id: DebtAssumptionId): DebtAssumptionParam {
  const param = debt.assumptions.find((candidate) => candidate.id === id);
  if (!param) throw new Error(`debt.json has no assumption "${id}". Validate the pack before using it.`);
  return param;
}

/**
 * The assumptions a projection runs with: missing or non-finite values fall back to the default,
 * every value is clamped to its param's [min, max], and the horizon is rounded to whole years.
 * The starting path is the one asked for if it is null or names a plan of the pack that can be
 * followed; otherwise it is the pack's (defaultFollow). See DebtAssumptions.follow for how it is
 * written.
 */
export function resolveDebtAssumptions(debt: DebtFile, given?: Partial<DebtAssumptions>): DebtAssumptions {
  const out = {} as DebtAssumptions;
  for (const id of DEBT_ASSUMPTION_IDS) {
    const param = debtAssumptionParam(debt, id);
    const value = given?.[id];
    let n = typeof value === "number" && Number.isFinite(value) ? value : param.default;
    if (id === "horizon") n = Math.round(n);
    out[id] = Math.min(param.max, Math.max(param.min, n));
  }
  const wanted = given?.follow;
  const follow =
    wanted === null ? null : typeof wanted === "string" && followable(debt, wanted) ? wanted : (defaultFollow(debt) ?? null);
  if (follow !== null) out.follow = follow;
  else if (defaultFollow(debt) !== undefined) out.follow = null;
  return out;
}

/** Whether the pack has a plan with this id that can be followed. */
function followable(debt: DebtFile, id: string): boolean {
  const plan = debt.plans?.find((candidate) => candidate.id === id);
  return plan !== undefined && isFollowablePlanIn(debt, plan);
}

/**
 * The plan the projection follows unless the visitor chooses the base year: debt.json `follow`,
 * if it names a plan that can be followed (validation makes sure it does). Undefined if the pack
 * names none: then the base year's budget is the starting path.
 */
export function defaultFollow(debt: DebtFile): string | undefined {
  return debt.follow !== undefined && followable(debt, debt.follow) ? debt.follow : undefined;
}

/** The plans of the pack that can be followed: the starting paths there are besides the base year's budget. */
export function followablePlans(debt: DebtFile): DebtPlan[] {
  return (debt.plans ?? []).filter((plan) => isFollowablePlanIn(debt, plan));
}

/**
 * The assumptions after choosing a preset: the preset's values replace the current ones, the rest
 * stay, and so does the starting path. A preset acts on whichever path is chosen.
 */
export function applyDebtPreset(debt: DebtFile, current: Partial<DebtAssumptions>, preset: DebtPreset): DebtAssumptions {
  return resolveDebtAssumptions(debt, { ...current, ...preset.values });
}

/** The accounts of the pack's budget and so of the projection (debt.json `accounts`): national accounts unless the pack says otherwise. */
export function projectionAccounts(debt: DebtFile): DebtPlanAccounts {
  return debt.accounts ?? "national_accounts";
}

/**
 * Whether an official projection (debt.json `plans`) describes what the projection describes, the
 * pack's whole budget (`scope` "all") in the accounts of that budget (projectionAccounts), so that
 * its points can be drawn against the projection's path. Any other plan is a figure of its own, to
 * be shown with its scope and never on the same axis.
 */
export function isComparablePlanIn(debt: DebtFile, plan: DebtPlan): boolean {
  return plan.scope === "all" && plan.accounts === projectionAccounts(debt);
}

/**
 * isComparablePlanIn for a pack whose budget is in national accounts, as the German one: the whole
 * state in national accounts. A pack with other accounts needs isComparablePlanIn.
 */
export function isComparablePlan(plan: DebtPlan): boolean {
  return plan.scope === "all" && plan.accounts === "national_accounts";
}

/** Whether a point says what the path without measures does in its year: meet its debt, or take its primary balance. */
function followablePoint(point: DebtPlanPoint): boolean {
  return point.debtRatio !== undefined || (point.balanceRatio !== undefined && point.interestRatio !== undefined);
}

/**
 * Whether every point gives a debt ratio, or else a balance and an interest ratio; the years
 * follow one another without a gap; and the last point has a balance ratio.
 */
function followableShape(plan: DebtPlan): boolean {
  const last = plan.points[plan.points.length - 1];
  return (
    last !== undefined &&
    last.balanceRatio !== undefined &&
    plan.points.every((point, i) => followablePoint(point) && (i === 0 || point.year === plan.points[i - 1].year + 1))
  );
}

/**
 * Whether a plan can be followed (DebtAssumptions.follow): it describes what the projection
 * describes (isComparablePlanIn); every point gives a debt ratio, which the path without measures
 * then meets, or else a balance and an interest ratio, whose sum, the plan's primary balance, it
 * then takes; the years follow one another without a gap; and the last point has a balance ratio,
 * from which the projection continues after the plan.
 */
export function isFollowablePlanIn(debt: DebtFile, plan: DebtPlan): boolean {
  return isComparablePlanIn(debt, plan) && followableShape(plan);
}

/** isFollowablePlanIn for a pack whose budget is in national accounts; a pack with other accounts needs isFollowablePlanIn. */
export function isFollowablePlan(plan: DebtPlan): boolean {
  return isComparablePlan(plan) && followableShape(plan);
}

/**
 * Whether every value the preset sets is the current one, e.g. to mark the preset as chosen. The
 * starting path plays no part: a preset applies on either.
 */
export function presetApplies(preset: DebtPreset, assumptions: DebtAssumptions): boolean {
  return DEBT_ASSUMPTION_IDS.every((id) => preset.values[id] === undefined || preset.values[id] === assumptions[id]);
}

interface Setup {
  baseYear: number;
  gdp: number;
  debt: number;
  /** Starting average rate ρ_0. */
  rate: number;
  share: number;
  market: number;
  growth: number;
  drift: number;
  horizon: number;
}

function record(
  year: number,
  gdp: number,
  revenue: number,
  primaryBalance: number,
  interest: number,
  debt: number,
  averageRate: number,
): DebtYear {
  const balance = primaryBalance - interest;
  return {
    year,
    gdp,
    revenue,
    primaryBalance,
    interest,
    balance,
    debt,
    debtRatio: debt / gdp,
    interestRatio: interest / gdp,
    interestToRevenue: interest / revenue,
    primaryBalanceRatio: primaryBalance / gdp,
    balanceRatio: balance / gdp,
    averageRate,
  };
}

/** The path of one balance. `interest` is the scenario's base-year interest, which makes up the primary balance. */
function path(setup: Setup, totals: Totals, interest: number): Omit<DebtPath, "longRun"> {
  const { baseYear, share, market, growth, drift, horizon } = setup;
  const primaryShare = (totals.balance + interest) / setup.gdp;
  const revenueShare = totals.revenue / setup.gdp;
  const start = record(baseYear, setup.gdp, totals.revenue, totals.balance + interest, interest, setup.debt, setup.rate);
  // The simulated balance itself, not (balance + interest) - interest, which can differ in the last digit.
  start.balance = totals.balance;
  start.balanceRatio = totals.balance / setup.gdp;

  const years: DebtYear[] = [];
  let gdp = setup.gdp;
  let debt = setup.debt;
  let rate = setup.rate;
  for (let t = 1; t <= horizon; t++) {
    gdp *= 1 + growth;
    const primaryBalance = (primaryShare + drift * t) * gdp;
    const paid = (1 - share) * rate + share * market;
    const due = paid * debt;
    const deficit = due - primaryBalance;
    if (deficit > 0) {
      const next = debt + deficit;
      rate = (due + market * deficit) / next;
      debt = next;
    } else {
      rate = paid;
      debt = Math.max(0, debt + deficit);
    }
    years.push(record(baseYear + t, gdp, revenueShare * gdp, primaryBalance, due, debt, rate));
  }
  return { start, years };
}

/** A plan the projection follows, reduced to what the calculation needs. */
interface Followed {
  id: string;
  /** Index t (year - baseYear) of the plan's first year after the base year. */
  first: number;
  /** Index t of the plan's last year. */
  last: number;
  /** Debt ratio by index t, where the plan gives one. */
  debtRatio: Map<number, number>;
  /** Primary balance ratio (balance plus interest) by index t, where the plan gives no debt ratio. */
  primaryRatio: Map<number, number>;
  /** The plan's growth by index t, where it gives one. */
  growth: Map<number, number>;
  /** Balance ratio of the plan's last year. */
  balanceRatio: number;
}

/** The part of a plan after the base year; undefined if nothing of it lies after the base year. */
function followedPlan(plan: DebtPlan, baseYear: number): Followed | undefined {
  const points = plan.points.filter((point) => point.year > baseYear);
  const last = points[points.length - 1];
  if (!last || last.balanceRatio === undefined || !points.every(followablePoint)) return undefined;
  const debtRatio = new Map<number, number>();
  const primaryRatio = new Map<number, number>();
  const growth = new Map<number, number>();
  for (const point of points) {
    const t = point.year - baseYear;
    if (point.debtRatio !== undefined) debtRatio.set(t, point.debtRatio);
    else if (point.balanceRatio !== undefined && point.interestRatio !== undefined) primaryRatio.set(t, point.balanceRatio + point.interestRatio);
    if (point.growth !== undefined) growth.set(t, point.growth);
  }
  return { id: plan.id, first: points[0].year - baseYear, last: last.year - baseYear, debtRatio, primaryRatio, growth, balanceRatio: last.balanceRatio };
}

/**
 * The paths when the projection follows a plan.
 *
 * GDP grows at the plan's growth in the plan's years where it gives one, otherwise at the growth
 * assumption. In a year where the plan gives a debt ratio, the path without measures sets its
 * primary balance to what makes its debt at the end of the year the plan's debt ratio times GDP:
 * the debt of the year before, plus the interest the model computes on it, minus the planned debt.
 * That primary balance absorbs everything that moves the plan's debt besides the deficit, such as
 * loans the state grants. In a year where the plan gives no debt ratio, only a balance and an
 * interest ratio (as the US budget's path, which projects no debt), the path takes the plan's primary
 * balance, their sum, and computes interest and debt itself: the model's interest at the chosen
 * rates, and the debt without what moves it besides the deficit.
 *
 * After the plan the projection holds a primary balance from the plan's last year, as a share of
 * GDP, with the drift counted from that year on: where that year gives a debt ratio, the plan's
 * balance plus the model's interest of that year, not the primary balance the debt ratio implies,
 * whose stock-flow residual would be a poor thing to hold for ever; where it gives none, the plan's
 * primary balance of that year, which the path took in it. Before the plan's first year, if the plan
 * starts later, it runs as without a plan.
 *
 * Measures act as they do without a plan: each path's primary balance is that of the path without
 * measures plus the measures' change of the base year's primary balance as a share of GDP, in every
 * year. Only the path without measures meets the plan's debt; the others move off it.
 *
 * The calculation runs at least to the plan's last year, so the balance held afterwards is defined
 * even if the horizon ends earlier; the paths are cut to the horizon.
 */
function followPaths(
  setup: Setup,
  plan: Followed,
  base: { totals: Totals; interest: number },
  scenarios: { totals: Totals; interest: number; at?: (t: number) => YearEffect }[],
): { paths: Omit<DebtPath, "longRun">[]; held: number[] } {
  const { baseYear, share, market, drift, horizon } = setup;
  const steps = Math.max(horizon, plan.last);
  const gdp = [setup.gdp];
  for (let t = 1; t <= steps; t++) gdp.push(gdp[t - 1] * (1 + (plan.growth.get(t) ?? setup.growth)));
  const baseShare = (base.totals.balance + base.interest) / setup.gdp;

  /** One path, given the primary balance of each year from the year, the debt before it and the interest due. */
  const run = (
    totals: Totals,
    interest: number,
    primaryOf: (t: number, debt: number, due: number) => number,
    revenueShareOf?: (t: number) => number,
  ): Omit<DebtPath, "longRun"> & { primary: number[] } => {
    const revenueShare = totals.revenue / setup.gdp;
    const start = record(baseYear, setup.gdp, totals.revenue, totals.balance + interest, interest, setup.debt, setup.rate);
    start.balance = totals.balance;
    start.balanceRatio = totals.balance / setup.gdp;
    const years: DebtYear[] = [];
    const primary = [0];
    let debt = setup.debt;
    let rate = setup.rate;
    for (let t = 1; t <= steps; t++) {
      const paid = (1 - share) * rate + share * market;
      const due = paid * debt;
      const primaryBalance = primaryOf(t, debt, due);
      primary.push(primaryBalance);
      const deficit = due - primaryBalance;
      if (deficit > 0) {
        const next = debt + deficit;
        rate = (due + market * deficit) / next;
        debt = next;
      } else {
        rate = paid;
        debt = Math.max(0, debt + deficit);
      }
      const revenue = (revenueShareOf ? revenueShareOf(t) : revenueShare) * gdp[t];
      if (t <= horizon) years.push(record(baseYear + t, gdp[t], revenue, primaryBalance, due, debt, rate));
    }
    return { start, years, primary };
  };

  // The path without measures: it meets the plan's debt, and in the plan's last year it fixes the
  // primary balance held afterwards, the plan's balance plus the interest of that year.
  let heldShare = NaN;
  const settled = run(base.totals, base.interest, (t, debt, due) => {
    if (t < plan.first) return (baseShare + drift * t) * gdp[t];
    if (t <= plan.last) {
      if (t === plan.last) heldShare = plan.primaryRatio.get(t) ?? plan.balanceRatio + due / gdp[t];
      const ratio = plan.debtRatio.get(t);
      if (ratio !== undefined) return debt + due - ratio * gdp[t];
      return (plan.primaryRatio.get(t) ?? NaN) * gdp[t];
    }
    return (heldShare + drift * (t - plan.last)) * gdp[t];
  });

  const paths: Omit<DebtPath, "longRun">[] = [];
  const held: number[] = [];
  for (const scenario of scenarios) {
    // The change once every measure is in full; with timing, each year has its own.
    const change = (scenario.totals.balance + scenario.interest) / setup.gdp - baseShare;
    const at = scenario.at;
    const path = at
      ? run(
          scenario.totals,
          scenario.interest,
          (t) => {
            const effect = at(t);
            return settled.primary[t] + ((effect.totals.balance + effect.interest) / setup.gdp - baseShare) * gdp[t];
          },
          (t) => at(t).totals.revenue / setup.gdp,
        )
      : run(scenario.totals, scenario.interest, (t) => settled.primary[t] + change * gdp[t]);
    paths.push({ start: path.start, years: path.years });
    held.push(heldShare + change);
  }
  return { paths, held };
}

/** One year of a path with measures: the simulated totals and the scenario's interest node in that year. */
interface YearEffect {
  totals: Totals;
  interest: number;
}

/**
 * Each year's effect of the measures on the three paths with measures, where some measure starts
 * later than the first projection year or builds up; undefined where every measure acts in full
 * from the first projection year, so that the projection is computed exactly as without timing.
 *
 * In calendar year y every measure has its share s of its full effect (shareInYear). Where all
 * shares are 0, the year is the budget without measures; where all are 1, it is `result` itself.
 * Otherwise the scenario is simulated once more with each measure applied at its share
 * (simulateWeighted): measures that act on the same items then interact as they do in full, for
 * example a later measure that scales an item works on what an earlier, half-built-up one left.
 * Years with the same shares are simulated once. Low and high end come from the same simulation,
 * with the measures' linked ranges as in full.
 */
function timedEffects(
  pack: CountryPack,
  result: SimulationResult,
  phases: readonly MeasurePhase[],
  interestOf: (result: SimulationResult, path: "reform" | "baseline") => number,
): { at: Record<"reform" | "reformLow" | "reformHigh", (t: number) => YearEffect>; observedStart: boolean } | undefined {
  const baseYear = pack.country.baseYear;
  const earliest = measuresFrom(pack);
  if (result.policies.length === 0 || (earliest <= baseYear + 1 && phases.every((phase) => phase.immediate))) return undefined;
  const scenario: Scenario = {
    policies: Object.fromEntries(result.policies.map((policy) => [policy.id, { enabled: true, params: policy.params }])),
    level: "all",
  };
  const none = { result: undefined, interest: interestOf(result, "baseline") };
  const cache = new Map<string, { result: SimulationResult | undefined; interest: number }>();
  const yearOf = (t: number): { result: SimulationResult | undefined; interest: number } => {
    const shares = phases.map((phase) => shareInYear(phase, baseYear + t));
    if (shares.every((share) => share === 0)) return none;
    if (shares.every((share) => share === 1)) return { result, interest: interestOf(result, "reform") };
    const key = shares.join(",");
    let entry = cache.get(key);
    if (!entry) {
      const simulated = simulateWeighted(pack, scenario, new Map(phases.map((phase, i) => [phase.policy, shares[i]])));
      entry = { result: simulated, interest: interestOf(simulated, "reform") };
      cache.set(key, entry);
    }
    return entry;
  };
  const pick = (key: "reform" | "reformLow" | "reformHigh") => (t: number): YearEffect => {
    const year = yearOf(t);
    return { totals: year.result ? year.result[key] : result.baseline, interest: year.interest };
  };
  return { at: { reform: pick("reform"), reformLow: pick("reformLow"), reformHigh: pick("reformHigh") }, observedStart: earliest > baseYear + 1 };
}

/**
 * A path with measures whose effect changes from year to year, otherwise computed as `path`: the
 * primary balance and revenue of year t are those of `at(t)` as a share of base-year GDP.
 */
function timedPath(setup: Setup, totals: Totals, interest: number, at: (t: number) => YearEffect): Omit<DebtPath, "longRun"> {
  const { baseYear, share, market, growth, drift, horizon } = setup;
  const start = record(baseYear, setup.gdp, totals.revenue, totals.balance + interest, interest, setup.debt, setup.rate);
  start.balance = totals.balance;
  start.balanceRatio = totals.balance / setup.gdp;
  const years: DebtYear[] = [];
  let gdp = setup.gdp;
  let debt = setup.debt;
  let rate = setup.rate;
  for (let t = 1; t <= horizon; t++) {
    gdp *= 1 + growth;
    const effect = at(t);
    const primaryBalance = ((effect.totals.balance + effect.interest) / setup.gdp + drift * t) * gdp;
    const paid = (1 - share) * rate + share * market;
    const due = paid * debt;
    const deficit = due - primaryBalance;
    if (deficit > 0) {
      const next = debt + deficit;
      rate = (due + market * deficit) / next;
      debt = next;
    } else {
      rate = paid;
      debt = Math.max(0, debt + deficit);
    }
    years.push(record(baseYear + t, gdp, (effect.totals.revenue / setup.gdp) * gdp, primaryBalance, due, debt, rate));
  }
  return { start, years };
}

/**
 * Projects debt and interest from a simulation result. The result must be for the whole state
 * (level "all"); for a filtered result this throws, see projectScenario. Throws as well if the pack
 * has no debt data, so check `pack.debt` first.
 */
export function projectDebt(pack: CountryPack, result: SimulationResult, given?: Partial<DebtAssumptions>): DebtProjection {
  const debt = pack.debt;
  if (!debt) throw new Error(`Country pack "${pack.country.id}" has no debt.json, so there is no debt projection.`);
  if (result.level !== "all") {
    throw new Error(
      `The debt projection is for the whole state, but the result is filtered to level "${result.level}". ` +
        "Simulate without a level filter, or use projectScenario.",
    );
  }
  const assumptions = resolveDebtAssumptions(debt, given);

  const nodeId = debt.interest.node;
  const node = nodeId === undefined ? undefined : result.nodes[nodeId];
  if (nodeId !== undefined && !node) throw new Error(`Unknown interest node "${nodeId}". Validate the pack before using it.`);
  const baseInterest = node ? node.baseline : debt.interest.value;
  const scenarioInterest = node ? node.reform : debt.interest.value;

  const setup: Setup = {
    baseYear: pack.country.baseYear,
    gdp: pack.country.indicators.gdp.value,
    debt: debt.stock.value,
    rate: debt.stock.value > 0 ? baseInterest / debt.stock.value : 0,
    share: debt.refinancing.share,
    market: assumptions.market_rate / 100,
    growth: assumptions.growth / 100,
    drift: assumptions.drift / 100,
    horizon: assumptions.horizon,
  };
  const keys = ["baseline", "reform", "reformLow", "reformHigh"] as const;
  const measureKeys = ["reform", "reformLow", "reformHigh"] as const;
  const phases = result.policies.flatMap((policy) => measurePhase(pack, policy.id, policy.params) ?? []);
  const interestOf = (simulated: SimulationResult, key: "reform" | "baseline"): number =>
    nodeId === undefined ? debt.interest.value : (simulated.nodes[nodeId]?.[key] ?? debt.interest.value);
  const timed = timedEffects(pack, result, phases, interestOf);
  const common = { assumptions, baseYear: setup.baseYear, refinancingShare: setup.share, baseInterest, measuresFrom: measuresFrom(pack), phases };
  /** Where measures can act only later than the first projection year, the base year is the observed one on every path. */
  const observed = (projection: DebtProjection): DebtProjection => {
    if (timed?.observedStart) for (const key of measureKeys) projection[key].start = { ...projection.baseline.start };
    return projection;
  };

  const plan = typeof assumptions.follow === "string" ? debt.plans?.find((candidate) => candidate.id === assumptions.follow) : undefined;
  const followed = plan ? followedPlan(plan, setup.baseYear) : undefined;
  if (followed && followed.first <= setup.horizon) {
    const base = { totals: result.baseline, interest: baseInterest };
    const { paths, held } = followPaths(setup, followed, base, [
      base,
      { totals: result.reform, interest: scenarioInterest, at: timed?.at.reform },
      { totals: result.reformLow, interest: scenarioInterest, at: timed?.at.reformLow },
      { totals: result.reformHigh, interest: scenarioInterest, at: timed?.at.reformHigh },
    ]);
    const projection: DebtProjection = {
      ...common,
      baseline: { ...paths[0], longRun: { kind: "drifts" } },
      reform: { ...paths[1], longRun: { kind: "drifts" } },
      reformLow: { ...paths[2], longRun: { kind: "drifts" } },
      reformHigh: { ...paths[3], longRun: { kind: "drifts" } },
      followed: { plan: followed.id, until: setup.baseYear + Math.min(followed.last, setup.horizon) },
    };
    const balanceYears = [...followed.primaryRatio.keys()].filter((t) => t <= setup.horizon).map((t) => setup.baseYear + t);
    if (balanceYears.length > 0) projection.followed!.balanceYears = balanceYears;
    // In the long run each path holds the balance it continues with after the plan, with every
    // measure in full, even where the horizon ends inside the plan or a build-up.
    keys.forEach((key, i) => (projection[key].longRun = longRunDebtRatio(projection, projection[key], held[i])));
    return observed(projection);
  }

  const reformPath = (key: (typeof measureKeys)[number]): Omit<DebtPath, "longRun"> =>
    timed ? timedPath(setup, result[key], scenarioInterest, timed.at[key]) : path(setup, result[key], scenarioInterest);
  const projection: DebtProjection = {
    ...common,
    baseline: { ...path(setup, result.baseline, baseInterest), longRun: { kind: "drifts" } },
    reform: { ...reformPath("reform"), longRun: { kind: "drifts" } },
    reformLow: { ...reformPath("reformLow"), longRun: { kind: "drifts" } },
    reformHigh: { ...reformPath("reformHigh"), longRun: { kind: "drifts" } },
  };
  for (const key of keys) {
    // With timing, the long run holds every measure in full, also where the horizon ends during a build-up.
    const full = key !== "baseline" && timed ? (result[key].balance + scenarioInterest) / setup.gdp : undefined;
    projection[key].longRun = longRunDebtRatio(projection, projection[key], full);
  }
  return observed(projection);
}

/**
 * Simulates the scenario for the whole state, whatever level filter it carries, and projects debt
 * and interest from it. Undefined if the pack has no debt data. This is what the interface calls.
 */
export function projectScenario(
  pack: CountryPack,
  scenario: Scenario = { policies: {} },
  given?: Partial<DebtAssumptions>,
): DebtProjection | undefined {
  if (!pack.debt) return undefined;
  return projectDebt(pack, simulate(pack, { ...scenario, level: "all" }), given);
}

/** Enough years for the old rates to have died out at any refinancing share worth modelling. */
const LONG_RUN_STEPS = 100_000;

/**
 * Where the debt ratio of a path ends up if its last year's primary balance ratio, the market
 * rate and the growth rate held for ever. With a market rate below the growth rate the ratio
 * settles at p (1 + g) / (m - g), or at 0 if that is negative; with a primary deficit and a market
 * rate at or above growth it grows without limit; with a primary surplus and a market rate above
 * growth it depends on whether the debt, once it all carries the market rate, lies below the level
 * p (1 + g) / (m - g) (it is paid off) or above it (it grows without limit). A drift other than 0
 * never settles.
 *
 * `primaryBalanceRatio` replaces the last year's primary balance ratio as the one that holds for
 * ever; a projection that follows a plan passes the ratio it holds after the plan.
 */
export function longRunDebtRatio(
  projection: DebtProjection,
  debtPath: Pick<DebtPath, "start" | "years">,
  primaryBalanceRatio?: number,
): DebtLongRun {
  const { assumptions, refinancingShare: share } = projection;
  if (assumptions.drift !== 0) return { kind: "drifts" };
  const market = assumptions.market_rate / 100;
  const growth = assumptions.growth / 100;
  const last = debtPath.years[debtPath.years.length - 1] ?? debtPath.start;
  const p = primaryBalanceRatio ?? last.primaryBalanceRatio;
  if (market < growth) return { kind: "converges", debtRatio: Math.max(0, (p * (1 + growth)) / (market - growth)) };
  if (p < 0) return { kind: "diverges" };

  // A primary surplus or balance with a market rate at or above growth: run the model on, as
  // ratios of GDP, until the old rates have died out or the debt is paid off.
  let ratio = last.debtRatio;
  let rate = last.averageRate;
  for (let step = 0; step < LONG_RUN_STEPS && ratio > 0 && Math.abs(rate - market) > 1e-12; step++) {
    const before = ratio / (1 + growth);
    const paid = (1 - share) * rate + share * market;
    const deficit = paid * before - p;
    if (deficit > 0) {
      ratio = before + deficit;
      rate = (paid * before + market * deficit) / ratio;
    } else {
      ratio = Math.max(0, before + deficit);
      rate = paid;
    }
  }
  if (ratio <= 0) return { kind: "converges", debtRatio: 0 };
  if (market === growth) return p > 0 ? { kind: "converges", debtRatio: 0 } : { kind: "converges", debtRatio: ratio };
  if (p === 0) return { kind: "diverges" };
  const unstable = (p * (1 + growth)) / (market - growth);
  if (ratio < unstable) return { kind: "converges", debtRatio: 0 };
  if (ratio > unstable) return { kind: "diverges" };
  return { kind: "converges", debtRatio: unstable };
}

function firstYear(debtPath: Pick<DebtPath, "start" | "years">, test: (year: DebtYear) => boolean): number | null {
  if (test(debtPath.start)) return debtPath.start.year;
  for (const year of debtPath.years) if (test(year)) return year.year;
  return null;
}

/**
 * The first year of the path, base year included, in which `measure` is above `threshold`; null if
 * it never is within the horizon. The base year means it is above already.
 *
 * Examples: firstYearAbove(path, 0.6) is the first year the debt passes 60 % of GDP;
 * firstYearAbove(path, defence / gdp, "interestRatio") the year interest overtakes defence
 * spending, which keeps its base-year share of GDP in the model.
 */
export function firstYearAbove(
  debtPath: Pick<DebtPath, "start" | "years">,
  threshold: number,
  measure: DebtMeasure = "debtRatio",
): number | null {
  return firstYear(debtPath, (year) => year[measure] > threshold);
}

/** The first year of the path, base year included, in which `measure` is below `threshold`; null if never. */
export function firstYearBelow(
  debtPath: Pick<DebtPath, "start" | "years">,
  threshold: number,
  measure: DebtMeasure = "debtRatio",
): number | null {
  return firstYear(debtPath, (year) => year[measure] < threshold);
}
