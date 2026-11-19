/**
 * The debt and interest projection: where the balance of a scenario leads over the coming years.
 *
 * It is a what-if calculation, not a forecast. Money is in currency units per year, ratios and
 * rates in the results are fractions (0.6 is 60 %). The assumptions are in the units of their
 * params in debt.json: percent, percent, years, and percentage points of GDP per year.
 *
 * The model, for year t = 1 ... horizon (calendar year baseYear + t):
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
 * The projection is always for the whole state: `projectDebt` refuses a result filtered to one level
 * of government, `projectScenario` ignores the scenario's level filter.
 */
import { simulate, type Scenario, type SimulationResult, type Totals } from "./simulate.ts";
import {
  DEBT_ASSUMPTION_IDS,
  type CountryPack,
  type DebtAssumptionId,
  type DebtAssumptionParam,
  type DebtFile,
  type DebtPreset,
} from "./types.ts";

/** Values of the assumptions, keyed by id, in the units of their params (see DebtAssumptionId). */
export type DebtAssumptions = Record<DebtAssumptionId, number>;

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
  /** Gross debt at the end of the year. Never below zero. */
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
  /** From the low end of the measures' range (reformLow.balance), the worse one: its debt is the higher. */
  reformLow: DebtPath;
  /** From the high end of the measures' range (reformHigh.balance): its debt is the lower. */
  reformHigh: DebtPath;
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
  return out;
}

/** The assumptions after choosing a preset: the preset's values replace the current ones, the rest stay. */
export function applyDebtPreset(debt: DebtFile, current: Partial<DebtAssumptions>, preset: DebtPreset): DebtAssumptions {
  return resolveDebtAssumptions(debt, { ...current, ...preset.values });
}

/** Whether every value the preset sets is the current one, e.g. to mark the preset as chosen. */
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
  const projection: DebtProjection = {
    assumptions,
    baseYear: setup.baseYear,
    refinancingShare: setup.share,
    baseInterest,
    baseline: { ...path(setup, result.baseline, baseInterest), longRun: { kind: "drifts" } },
    reform: { ...path(setup, result.reform, scenarioInterest), longRun: { kind: "drifts" } },
    reformLow: { ...path(setup, result.reformLow, scenarioInterest), longRun: { kind: "drifts" } },
    reformHigh: { ...path(setup, result.reformHigh, scenarioInterest), longRun: { kind: "drifts" } },
  };
  for (const key of ["baseline", "reform", "reformLow", "reformHigh"] as const) {
    projection[key].longRun = longRunDebtRatio(projection, projection[key]);
  }
  return projection;
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
 */
export function longRunDebtRatio(projection: DebtProjection, debtPath: Pick<DebtPath, "start" | "years">): DebtLongRun {
  const { assumptions, refinancingShare: share } = projection;
  if (assumptions.drift !== 0) return { kind: "drifts" };
  const market = assumptions.market_rate / 100;
  const growth = assumptions.growth / 100;
  const last = debtPath.years[debtPath.years.length - 1] ?? debtPath.start;
  const p = last.primaryBalanceRatio;
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
