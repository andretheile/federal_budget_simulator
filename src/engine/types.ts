/**
 * Country pack contract, v0.
 *
 * A country pack is a directory `countries/<id>/` with
 *   country.json            -> Country
 *   budget.json             -> Budget
 *   policies.json           -> PoliciesFile
 *   sources.json            -> Record<SourceId, Source>
 *   distributions/<id>.json -> Distribution (the file name is the id)
 *   debt.json               -> DebtFile (optional: the debt and interest projection)
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

/** Content of policies.json. */
export interface PoliciesFile {
  policies: Policy[];
}

/** A validated country pack: the parsed content of all files of one country. */
export interface CountryPack {
  country: Country;
  budget: Budget;
  /** In file order, which is the order policies are applied in. */
  policies: Policy[];
  sources: Record<SourceId, Source>;
  /** Keyed by distribution id. */
  distributions: Record<string, Distribution>;
  /** Content of debt.json. Absent if the pack has none: then there is no debt projection. */
  debt?: DebtFile;
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
   * least one. Assumptions it does not name keep their current value.
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
  /** What the projection is and what it leaves out, in plain words; shown with it. */
  note: LocalizedText;
}
