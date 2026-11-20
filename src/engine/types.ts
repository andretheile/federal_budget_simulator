/**
 * Country pack contract, v0.
 *
 * A country pack is a directory `countries/<id>/` with
 *   country.json            -> Country
 *   budget.json             -> Budget
 *   policies.json           -> PoliciesFile (the policies, and optional collections of them)
 *   sources.json            -> Record<SourceId, Source>
 *   distributions/<id>.json -> Distribution (the file name is the id)
 *   debt.json               -> DebtFile (optional: the debt and interest projection)
 *   goals.json              -> GoalsFile (optional: how far a level's balance has to improve)
 *
 * Conventions
 * - Money is in plain currency units per year (euros, not millions).
 * - Shares and rates are fractions between 0 and 1, except policy parameters, whose `unit` says
 *   what they are.
 * - Ids are lower_snake_case. Budget node ids are dotted paths, unique across the whole budget,
 *   starting with `rev.` or `exp.`.
 * - Only leaf nodes carry amounts. Group totals are always derived by summing leaves.
 * - A marginal-rate schedule is either a list of brackets (steps) or a curve of points with
 *   linear interpolation between them; see CurveParam for the meaning of the points.
 *
 * The zod schemas in schema.ts mirror these types; validate.ts adds the cross-reference checks.
 */

/** "en" is required; a text must also contain every locale listed in `country.locales`. */
export type LocalizedText = { en: string } & Record<string, string>;

export type Quality = "official" | "derived" | "estimate";
export type SourceId = string;

/** Subsectors of general government, ESA 2010 S.1311 to S.1314. */
export type LevelId = "central" | "state" | "local" | "social_security";

export interface Source {
  title: string;
  publisher: string;
  url: string;
  /** ISO date (YYYY-MM-DD) the source was last checked. */
  accessed: string;
  year?: number;
  note?: string;
}

export interface Indicator {
  value: number;
  quality: Quality;
  sources: SourceId[];
  year?: number;
}

export interface Country {
  /** ISO 3166-1 alpha-2, lower case. */
  id: string;
  name: LocalizedText;
  /** ISO 4217. */
  currency: string;
  /** The first entry is the default locale. */
  locales: string[];
  baseYear: number;
  /** Levels of government that exist in this country, with their local names. */
  levels: Partial<Record<LevelId, { name: LocalizedText }>>;
  indicators: {
    gdp: Indicator;
    population: Indicator;
    households?: Indicator;
    grossDebt?: Indicator;
  };
  methodology?: LocalizedText;
}

export interface Budget {
  revenue: BudgetNode[];
  expenditure: BudgetNode[];
}

export type BudgetNode = GroupNode | LeafNode;

export interface NodeBase {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  /** Classification code, e.g. COFOG "GF10" or ESA "D51". */
  code?: string;
  breakdowns?: Record<string, Breakdown>;
}

export interface GroupNode extends NodeBase {
  /** Non-empty. */
  children: BudgetNode[];
}

export interface LeafNode extends NodeBase {
  /** Base-year amount, >= 0. */
  amount: number;
  /** Shares per level of government. Must sum to 1 (tolerance 0.001); keys must exist in country.levels. */
  levels: Partial<Record<LevelId, number>>;
  quality: Quality;
  /** At least one. */
  sources: SourceId[];
  /** Only if it differs from country.baseYear. */
  year?: number;
  note?: LocalizedText;
}

export interface BreakdownGroup {
  id: string;
  label: LocalizedText;
  share: number;
}

export interface Breakdown {
  label: LocalizedText;
  basis: "spending" | "recipients";
  /** Shares sum to 1 (tolerance 0.001). */
  groups: BreakdownGroup[];
  quality: Quality;
  sources: SourceId[];
  year?: number;
  note?: LocalizedText;
}

export interface DistributionBin {
  from: number;
  to: number;
  count: number;
  mean: number;
}

export interface ParetoTail {
  from: number;
  count: number;
  alpha: number;
}

export interface Distribution {
  id: string;
  label: LocalizedText;
  /** What is distributed, e.g. "net wealth per household". */
  variable: LocalizedText;
  /** What is counted, e.g. "households". */
  unit: LocalizedText;
  year: number;
  /** Ascending and contiguous (bins[i].to === bins[i+1].from), from <= mean <= to. The first `from` may be negative. */
  bins: DistributionBin[];
  /** Pareto tail above the last bin; tail.from === last bin.to; alpha > 1. */
  tail?: ParetoTail;
  quality: Quality;
  sources: SourceId[];
  note?: LocalizedText;
}

export type PolicyTopic =
  | "migration"
  | "social"
  | "taxes"
  | "pensions"
  | "defense"
  | "climate"
  | "state"
  | "europe"
  | "other";

export interface Policy {
  id: string;
  label: LocalizedText;
  summary: LocalizedText;
  topic: PolicyTopic;
  /** May be empty for pure on/off measures. */
  params: Param[];
  /** At least one. */
  effects: Effect[];
  catches: Catch[];
  sources: SourceId[];
  /**
   * When the measure acts in the debt projection and how its effect builds up to the full amount
   * its effects describe. Absent: in full from the first year measures can act (debt.json
   * `measuresFrom`). The budget view of the base year is not affected.
   */
  timing?: PolicyTiming;
}

/**
 * One way a measure comes into effect: from a date, rising linearly to its full effect over a
 * number of years. The full effect is what the measure's effects describe, a steady state.
 */
export interface TimingPhase {
  /**
   * The first day the measure acts, as an ISO date (YYYY-MM-DD). A date before the first year
   * measures can act (debt.json `measuresFrom`) counts as the start of that year. Absent: the start
   * of that year.
   */
  from?: string;
  /** Years from `from` until the effect is full, rising linearly. Absent or 0: full at once. */
  years?: number;
  /**
   * Further years per unit of distance between the timing's param and its baseline, for a change
   * that cannot happen at once, such as a retirement age that rises by months per birth cohort.
   * Needs PolicyTiming.param.
   */
  yearsPerUnit?: number;
}

/**
 * The timing of a measure in the debt projection. The phase fields at the top apply to every
 * setting, or, with `param` and `below`, to settings at or above the param's baseline.
 */
export interface PolicyTiming extends TimingPhase {
  /**
   * A number param of the policy with a `baseline`. Its distance from the baseline is the unit of
   * `yearsPerUnit`, and its direction chooses between the phase at the top (at or above the
   * baseline) and `below`.
   */
  param?: string;
  /** The phase when `param` is below its baseline. Needs `param`. Absent: the phase at the top. */
  below?: TimingPhase;
  /** Where the dates and durations come from, in plain words. */
  note: LocalizedText;
  /** At least one. */
  sources: SourceId[];
}

export type ParamUnit = "percent" | "percent_gdp" | "currency" | "years" | "count";

export interface NumberParam {
  id: string;
  type: "number";
  label: LocalizedText;
  unit: ParamUnit;
  min: number;
  max: number;
  step: number;
  /** Value when the policy is first switched on. */
  default: number;
  /**
   * The value in the base year (the law of the base year), for display only. With every number
   * param at its baseline a measure must change nothing; validation warns if it does.
   */
  baseline?: number;
  /**
   * What the baseline is, where it is not the base year's value: "Current law", say, for a limit
   * that the law of the base year already raises later. It then stands in for the base year wherever
   * the baseline is shown or named ("Current law: 67 years" instead of "2024: 67 years").
   */
  baselineLabel?: LocalizedText;
  /**
   * A display unit written after the number, e.g. "cents per litre". It replaces the generic
   * formatting of `unit` on screen; `unit` still says what the value is for validation.
   */
  unitLabel?: LocalizedText;
  /**
   * "assumption": the param is not something a government decides but an assumption of the
   * calculation, for example how many people avoid a tax or what replacement benefits cost. The
   * interface marks it as such. Absent: a political choice. An assumption has no `baseline`.
   */
  role?: "assumption";
}

export interface GroupsParam {
  id: string;
  type: "groups";
  label: LocalizedText;
  /** Multi-select over the group ids of `breakdown` on `node`. */
  node: string;
  breakdown: string;
  default: string[];
}

/** One point of a marginal-rate curve: at value `x` the rate is `y`. */
export type CurvePoint = { x: number; y: number };

/**
 * An editable marginal-rate curve, for example an income tax tariff.
 *
 * Points are ordered by x, non-decreasing. Two points with the same x form a step, and the later
 * one applies from x upward. The marginal rate is 0 below the first point, linearly interpolated
 * between consecutive points, and constant at the last point's value above the last point. What
 * a unit with value v owes is the integral of the marginal rate from 0 to v.
 */
export interface CurveParam {
  id: string;
  type: "curve";
  label: LocalizedText;
  /** The distributed variable, e.g. taxable income; also the editor's range. min >= 0. */
  x: { unit: "currency"; min: number; max: number; step: number };
  /** The rate. */
  y: { unit: "percent"; min: number; max: number; step: number };
  /** Value when the policy is first switched on. */
  default: CurvePoint[];
  /** Today's curve, for display only. */
  baseline?: CurvePoint[];
  /** Fewest points a value may have. Default 1. */
  minPoints?: number;
  /** Most points a value may have. Default 12. */
  maxPoints?: number;
  /** Ready-made curves to pick from. `note` is shown with the preset, e.g. what it leaves out. */
  presets?: { id: string; label: LocalizedText; note?: LocalizedText; points: CurvePoint[]; sources?: SourceId[] }[];
  /** Example units for "pays today / pays after", e.g. the median income. */
  examples?: { x: number; label: LocalizedText }[];
}

export type Param = NumberParam | GroupsParam | CurveParam;

/** Defaults of CurveParam.minPoints and CurveParam.maxPoints. */
export const CURVE_MIN_POINTS = 1;
export const CURVE_MAX_POINTS = 12;

export type IndicatorRef = "gdp" | "population" | "households";

export interface ParamRef {
  param: string;
  scale?: number;
  offset?: number;
  times?: IndicatorRef;
}

/**
 * A constant, or a reference to a number param that evaluates to
 * (paramValue * (scale ?? 1) + (offset ?? 0)) * (indicator value if `times` is set, else 1).
 */
export type Value = number | ParamRef;

/**
 * Multipliers on an effect's delta for the low and the high estimate. The engine orders the two
 * ends by their effect on the balance (more revenue is better, more spending is worse), so which
 * of the two is called low does not matter.
 */
export interface Uncertainty {
  low: number;
  high: number;
  /**
   * Effects of one policy whose uncertainty names the same basis depend on the same uncertain
   * quantity (for example the same wage sum) and vary together: the engine adds up their effects
   * on the balance, shifts included, and applies one multiplier to all of them, the one that is
   * worse for that sum. Without a basis every effect is its own group, as before, and its shift
   * keeps its own range. Effects with the same basis must have the same `low` and `high`.
   */
  basis?: string;
}

export interface EffectBase {
  /** Budget node id. */
  target: string;
  quality: Quality;
  /**
   * Multipliers on this effect's delta for the low and the high estimate. Without a `basis` they
   * do not apply to the effect's `shift`; with one they do (see Uncertainty.basis).
   */
  uncertainty?: Uncertainty;
  sources?: SourceId[];
  note?: LocalizedText;
  /** Part of the change at the target that is passed on to another node; see EffectShift. */
  shift?: EffectShift;
}

/**
 * Optional on every effect: a stated share of the change at the target is passed on to another
 * node. Two uses:
 * - a cost shift: part of what the effect removes reappears elsewhere, for example when people who
 *   lose one benefit fall back on another one that a different level of government pays;
 * - a knock-on effect: higher social contributions lower income tax, because employees deduct
 *   them from their taxable income.
 *
 * change = target total after the effect - target total before it (after clamping).
 * `to` changes by -change * ratio, like an `add` effect: a saving at the target reappears as a cost,
 * more contributions at the target come with less income tax at `to`.
 */
export interface EffectShift {
  /** Budget node id that receives the passed-on part. Not the target, nor a node above or below it. */
  to: string;
  /** Share of the target's change that is passed on, with the opposite sign; >= 0, may exceed 1. */
  ratio: Value;
  /**
   * Multipliers on the passed-on amount, for the low and the high estimate. Default 1 and 1. With a
   * `basis` on the effect's own uncertainty they come on top of the effect's multiplier.
   */
  uncertainty?: { low: number; high: number };
  /** A few words on what the passed-on part is, shown instead of the generic "cost shift". */
  label?: LocalizedText;
  /** Quality of the passed-on part. Default: the effect's quality. */
  quality?: Quality;
  sources?: SourceId[];
  note?: LocalizedText;
}

/** new = old * factor */
export interface ScaleEffect extends EffectBase {
  type: "scale";
  factor: Value;
}

/** new = old + amount */
export interface AddEffect extends EffectBase {
  type: "add";
  amount: Value;
}

/** new = amount */
export interface SetEffect extends EffectBase {
  type: "set";
  amount: Value;
}

/**
 * The breakdown lives on the target node.
 * new = old * (1 - sum(share of excluded groups) * (1 - (retained ?? 0)))
 *
 * The share is what is left of the groups at that moment: the simulation keeps track of how much
 * of each group earlier excludeGroups effects on the same node and breakdown have already
 * removed, so excluding a group twice does not remove it twice.
 */
export interface ExcludeGroupsEffect extends EffectBase {
  type: "excludeGroups";
  breakdown: string;
  groups: string[] | { param: string };
  retained?: Value;
}

/**
 * A marginal-rate schedule integrated over a distribution.
 * With `baseline` the effect is calibrated: delta = current target * (model(reform) / model(baseline) - 1).
 * Without it the effect is absolute: delta = model(reform). Either is multiplied by (yield ?? 1).
 *
 * `reform` is a list of brackets or the value of a curve param; `baseline` is a list of brackets
 * or fixed curve points. The two may be given in different forms.
 */
export interface ScheduleEffect extends EffectBase {
  type: "schedule";
  distribution: string;
  reform: Schedule;
  baseline?: ConstSchedule;
  yield?: Value;
}

export type Effect = ScaleEffect | AddEffect | SetEffect | ExcludeGroupsEffect | ScheduleEffect;

/** Marginal rates as steps, ascending `from`. */
export interface BracketSchedule {
  brackets: { from: Value; rate: Value }[];
}

/** Marginal rates as the value of a curve param of the same policy. The rate is y * (scale ?? 1). */
export interface CurveSchedule {
  curve: { param: string; scale?: number };
}

/** A reform schedule, in either form. */
export type Schedule = BracketSchedule | CurveSchedule;

export interface ConstBracketSchedule {
  brackets: { from: number; rate: number }[];
}

/** Marginal rates as fixed curve points (see CurveParam for their meaning). The rate is y * (scale ?? 1). */
export interface PointsSchedule {
  points: CurvePoint[];
  scale?: number;
}

/** A baseline schedule, in either form. */
export type ConstSchedule = ConstBracketSchedule | PointsSchedule;

export interface Catch {
  kind: "legal" | "economic" | "cost_shift" | "practical" | "political";
  severity: "blocker" | "major" | "minor";
  text: LocalizedText;
  sources?: SourceId[];
}

/**
 * A named group of measures that the pack chooses, for example the measures debated around one
 * year's budget. A collection only groups: it changes no measure and is not a scenario. A measure
 * can be in several collections, or in none.
 */
export interface PolicyCollection {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  /** Ids of policies in policies.json, in the order the collection lists them. At least one, each once. */
  policies: string[];
  sources?: SourceId[];
}

/** Content of policies.json. */
export interface PoliciesFile {
  policies: Policy[];
  /** Optional named groups of the policies above. */
  collections?: PolicyCollection[];
}

/** A validated country pack: the parsed content of all files of one country. */
export interface CountryPack {
  country: Country;
  budget: Budget;
  /** In file order, which is the order policies are applied in. */
  policies: Policy[];
  /** `collections` of policies.json, in file order. Absent if the file has none. */
  collections?: PolicyCollection[];
  sources: Record<SourceId, Source>;
  /** Keyed by distribution id. */
  distributions: Record<string, Distribution>;
  /** Content of debt.json. Absent if the pack has none: then there is no debt projection. */
  debt?: DebtFile;
  /** Content of goals.json. Absent if the pack has none. */
  goals?: GoalsFile;
}

export const LEVEL_IDS: readonly LevelId[] = ["central", "state", "local", "social_security"];

// ---------------------------------------------------------------------------------------------
// debt.json: the debt and interest projection (optional)
// ---------------------------------------------------------------------------------------------

/** A figure of the base year, with its quality and sources. */
export interface DebtFigure {
  /** Currency units. Above 0 for the debt stock, at least 0 for interest. */
  value: number;
  quality: Quality;
  /** At least one. */
  sources: SourceId[];
  note?: LocalizedText;
}

/** Interest paid in the base year. */
export interface DebtInterest extends DebtFigure {
  /**
   * The budget node that holds interest spending, if the budget has one: an `exp.` node, leaf or
   * group. The projection then takes base-year interest from the budget itself, so that the
   * primary balance plus interest equals the simulated balance exactly, and `value` (the official
   * interest figure) is only shown. Without a node the projection uses `value`.
   */
  node?: string;
}

/** How fast the debt takes on a new market rate. */
export interface DebtRefinancing {
  /** Share of the debt that is refinanced each year, above 0 and at most 1; usually 1 / averageMaturity. */
  share: number;
  /** The average residual maturity in years that the share is derived from, for display. */
  averageMaturity?: number;
  quality: Quality;
  /** At least one. */
  sources: SourceId[];
  note?: LocalizedText;
}

/**
 * The settings of the projection a visitor can change, and the unit each must have:
 *   market_rate  percent      interest rate on new and refinanced debt
 *   growth       percent      nominal GDP growth per year
 *   horizon      years        number of years projected; whole numbers, at least 1
 *   drift        percent_gdp  change of the primary balance per year, in percentage points of GDP;
 *                             negative for costs that grow faster than the economy, such as ageing
 */
export type DebtAssumptionId = "market_rate" | "growth" | "horizon" | "drift";

export const DEBT_ASSUMPTION_IDS: readonly DebtAssumptionId[] = ["market_rate", "growth", "horizon", "drift"];

export const DEBT_ASSUMPTION_UNITS: Readonly<Record<DebtAssumptionId, ParamUnit>> = {
  market_rate: "percent",
  growth: "percent",
  horizon: "years",
  drift: "percent_gdp",
};

/**
 * One setting of the projection. It is a number param, so the interface can show it with the same
 * slider as a policy param; `note` and `sources` say where the default comes from.
 */
export interface DebtAssumptionParam extends NumberParam {
  id: DebtAssumptionId;
  note?: LocalizedText;
  sources?: SourceId[];
}

/** A ready-made set of assumptions, e.g. "rates as in the United States". */
export interface DebtPreset {
  id: string;
  label: LocalizedText;
  note?: LocalizedText;
  /**
   * The assumptions the preset sets, in the units of their params and inside their ranges. At
   * least one. Assumptions it does not name keep their current value, and so does the starting
   * path (DebtFile.follow): a preset acts on whichever path is chosen.
   */
  values: Partial<Record<DebtAssumptionId, number>>;
  sources?: SourceId[];
}

/**
 * A value to compare the projection with: another country, a rule such as the EU's 60 % debt
 * reference value, or the country itself in another year.
 */
export interface DebtReference {
  id: string;
  label: LocalizedText;
  kind: "country" | "threshold" | "history";
  /** The year the values refer to. Absent for a threshold that holds in every year. */
  year?: number;
  /** Gross debt as a fraction of GDP (1.2 is 120 %). */
  debtRatio?: number;
  /** Interest payable as a fraction of GDP. At least one of the two ratios is required. */
  interestRatio?: number;
  /**
   * General government total revenue as a fraction of GDP, for the same year and from the same
   * source as `interestRatio`, which it requires. With it the interest burden can also be shown as
   * a share of revenue (interestRatio / revenueRatio). Leave it out where the source's revenue is
   * not comparable with the country's own.
   */
  revenueRatio?: number;
  /** At least one. */
  sources: SourceId[];
  note?: LocalizedText;
}

/**
 * A budget item the interest bill is compared with, e.g. defence: the interface says in which year
 * interest overtakes it. Like all spending in the projection, the item keeps its base-year share of
 * GDP, so the comparison is between interest and the item's share of GDP.
 */
export interface DebtComparison {
  /** An `exp.` node of the budget, leaf or group, other than the interest node. */
  node: string;
  /** A shorter name, as it reads after "spending on"; default: the node's label. */
  label?: LocalizedText;
}

/**
 * One year of an official projection. Ratios are fractions (0.6 is 60 %), money is in currency
 * units. The names are those of the same figures in the projection's DebtYear. At least one value.
 */
export interface DebtPlanPoint {
  year: number;
  /** Gross debt as a fraction of GDP. */
  debtRatio?: number;
  /** Balance (revenue minus spending, negative for a deficit) as a fraction of GDP. */
  balanceRatio?: number;
  /** Interest as a fraction of GDP. */
  interestRatio?: number;
  /** Interest as a fraction of revenue. */
  interestToRevenue?: number;
  /** Interest in currency units. */
  interest?: number;
  /**
   * Nominal GDP growth over the year before, as a fraction (0.03 is 3 %). A projection that follows
   * the plan grows GDP at this rate in this year instead of the growth assumption.
   */
  growth?: number;
}

/**
 * Which accounts an official projection follows:
 *   national_accounts  ESA 2010, like the budget in budget.json and the debt projection
 *   cash               budget plans and financial statistics: payments in and out of the budgets
 */
export type DebtPlanAccounts = "national_accounts" | "cash";

/**
 * An official projection of the country's own path, for example the government's medium-term
 * fiscal projection: shown next to the model's path, for display only. It changes nothing in the
 * model.
 *
 * The projection always covers the whole state in national accounts. A plan with `scope` "all" and
 * `accounts` "national_accounts" describes the same thing and can be drawn against it (see
 * isComparablePlan); any other plan, such as the interest bill in the central government's cash
 * budget, is a figure of its own that must be shown with its scope.
 */
export interface DebtPlan {
  id: string;
  label: LocalizedText;
  /** Whose finances the figures describe: "all" for the whole state, or one level of government. */
  scope: LevelId | "all";
  accounts: DebtPlanAccounts;
  /** By year, ascending, each year once. At least one. */
  points: DebtPlanPoint[];
  quality: Quality;
  /** At least one. */
  sources: SourceId[];
  /** What the figures are, their stand, and how they differ from the model's. */
  note: LocalizedText;
}

/** The first year in which measures can act in the projection, and why that year. */
export interface DebtMeasuresFrom {
  /** A calendar year after the base year. */
  year: number;
  note: LocalizedText;
  sources?: SourceId[];
}

/** Content of debt.json. */
export interface DebtFile {
  /** Gross debt of general government at the end of the base year (for EU countries the Maastricht debt). */
  stock: DebtFigure;
  /** Interest paid in the base year (ESA 2010 D.41, payable). */
  interest: DebtInterest;
  refinancing: DebtRefinancing;
  /** Exactly one param per DebtAssumptionId, in the order the interface shows them. */
  assumptions: DebtAssumptionParam[];
  presets: DebtPreset[];
  references: DebtReference[];
  /** Budget items to compare the interest bill with, in the order the interface lists them. Optional. */
  comparisons?: DebtComparison[];
  /** Official projections of the country's own path, for display next to the model's. Optional. */
  plans?: DebtPlan[];
  /**
   * The first year in which measures can act in the projection: before it, the path with measures is
   * the path without them. Absent: the year after the base year, the first projection year.
   */
  measuresFrom?: DebtMeasuresFrom;
  /**
   * The starting path: the id of a plan in `plans` that the projection follows unless the visitor
   * chooses to continue the base year's budget instead. It must be one that can be followed
   * (isFollowablePlan). Without it the projection continues the base year's budget, and follows a
   * plan only when one is chosen (DebtAssumptions.follow).
   */
  follow?: string;
  /** What the projection is and what it leaves out, in plain words; shown with it. */
  note: LocalizedText;
}

// ---------------------------------------------------------------------------------------------
// goals.json: targets for the balance (optional)
// ---------------------------------------------------------------------------------------------

/**
 * Something whose changes do not count towards a goal, with the reason: a budget node, for example
 * spending that the rule behind the goal finances outside it, or a measure, for example one that the
 * plan behind the goal already counts on. Exactly one of `node` and `policy`.
 */
export interface GoalExclusion {
  /** Budget node id, leaf or group. Its changes and those of every node below it are left out. */
  node?: string;
  /**
   * Policy id. Whatever the measure changes at the goal's level, inside the scenario, is left out:
   * its own result there, the figure the interface shows for it at that level.
   */
  policy?: string;
  /** Why, in a sentence a visitor understands. */
  reason: LocalizedText;
  sources?: SourceId[];
}

/**
 * A target: the balance of one level of government, or of the whole state, has to improve by
 * `amount` for `year`, for example to close a gap in the government's financial plan. Measures are
 * compared with it by how far they improve that balance, the figure the interface shows as the
 * relief or burden of a level, less the changes on excluded nodes (see goalProgress).
 */
export interface Goal {
  id: string;
  label: LocalizedText;
  /** A sentence or two on what the goal is. */
  description: LocalizedText;
  /** The level whose balance has to improve; absent for the whole state. Must exist in country.levels. */
  level?: LevelId;
  /** How much the balance has to improve, in currency units per year, like budget amounts. Above 0. */
  amount: number;
  /** The year the amount refers to. */
  year: number;
  quality: Quality;
  /** At least one. */
  sources: SourceId[];
  /** Where the amount comes from, its stand, and what comparing measures with it glosses over. */
  note: LocalizedText;
  /**
   * Nodes and measures whose changes do not count towards the goal. Each node and each measure once,
   * no node inside another. No effect or shift of a policy that is not excluded itself may target a
   * group above an excluded node, since the part of its change that falls on the excluded node could
   * not be told apart.
   */
  excluded?: GoalExclusion[];
}

/** Content of goals.json. */
export interface GoalsFile {
  /** Id of the goal shown first. */
  default: string;
  /** At least one, in the order the interface lists them. */
  goals: Goal[];
}
