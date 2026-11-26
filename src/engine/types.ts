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
 *   incidence.json          -> IncidenceFile (optional: who pays the revenue, by income group)
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
  /**
   * What the source is used for or where in it a figure is. A plain string is shown in every
   * language; a localized text in the language shown. The title stays in the source's own language.
   */
  note?: string | LocalizedText;
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
  /**
   * The first day of the base year, as an ISO date (YYYY-MM-DD), where the pack's years are not
   * calendar years: "2024-10-01" for the US fiscal year 2025, which runs from October 2024 to
   * September 2025; "2024-04-01" for a year from April 2024 to March 2025 that is named after the
   * year it starts in. Every later year starts on the same day and month, one year later each.
   * Absent: calendar years, 1 January. The debt projection counts its years on this calendar, and
   * the dates of a measure's timing are placed in them (years.ts).
   */
  baseYearStart?: string;
  /**
   * How the masthead names the base year where it is not a calendar year, e.g. "fiscal year 2025
   * (October 2024 to September 2025)". Absent: "base year" and the number.
   */
  baseYearLabel?: LocalizedText;
  /**
   * The short name of the base year where the bare number would mislead, as headings and labels use
   * it: "FY 2025", "Haushaltsjahr 2025" ("Balance FY 2025", "compared with FY 2025"). Absent: the
   * number. Charts and tables of later years keep plain years.
   */
  baseYearShort?: LocalizedText;
  /**
   * The pack is being written and is not live yet: a production build leaves it out unless asked to
   * include previews, and the development server marks it as a preview (scripts/preview-packs.ts).
   */
  preview?: boolean;
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
  /**
   * What the card's face says: what the measure does and what its default setting shows, in at
   * most two sentences. Up to SUMMARY_FACE_LENGTH characters it is shown whole; a longer one is cut
   * to two lines until the card is opened, and validation warns about it.
   */
  summary: LocalizedText;
  /**
   * The rest, at the top of the opened card: how the figure is calculated, how to use the
   * settings, how the measure works together with others. Paragraphs are separated by a blank line.
   */
  explanation?: LocalizedText;
  topic: PolicyTopic;
  /** May be empty for pure on/off measures. */
  params: Param[];
  /** At least one. */
  effects: Effect[];
  /** What stands against the measure itself: law, economics, costs that move, practice, politics. */
  catches: Catch[];
  /**
   * Limits of the calculation, not of the measure: what the figure leaves out and what the model
   * assumes. Shown under a heading of their own after the catches, and not counted among them.
   */
  limits?: PolicyLimit[];
  sources: SourceId[];
  /**
   * When the measure acts in the debt projection, how its effect builds up to the full amount its
   * effects describe, and whether it ends. Absent: in full and for good from the first year
   * measures can act (debt.json `measuresFrom`). The budget view of the base year is not affected:
   * the figure on the card and the scoreboard is the effect of a year in which the measure acts in
   * full, for a one-off (TimingPhase.once) the amount it pays or raises once.
   */
  timing?: PolicyTiming;
}

/**
 * One way a measure comes into effect: from a date, rising linearly to its full effect over a
 * number of years, and either for good, for a number of years (`lasts`) or once (`once`). The full
 * effect is what the measure's effects describe: a steady state, or for a one-off its amount.
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
  /**
   * A one-off, such as a rebate paid once: the measure's effects are the amount, and it counts in
   * full in the one year of the projection that its start falls in (`from`, or the first year
   * measures can act), whatever the day; in no other year. Not split over two years, as a payment is
   * not a rate over time. Not with `years`, `yearsPerUnit` or `lasts`.
   */
  once?: true;
  /**
   * Whole years for which the measure acts, counted from its start in the projection (`from`, or
   * the first year measures can act if that is later), such as a tax break that expires or a
   * programme that runs four years. It acts in full from its start and stops at once after the last
   * day: from 1 January 2028 for 3 years means to 31 December 2030, which in years from October puts
   * three quarters of a year into the first and a quarter into the last. Absent: for good. Not with
   * `years`, `yearsPerUnit` or `once`.
   */
  lasts?: number;
}

/**
 * The timing of a measure in the debt projection. The phase fields at the top apply to every
 * setting, or, with `param` and `below`, to settings at or above the param's baseline; `below` is a
 * phase of its own and takes none of the fields at the top, an end included.
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
  /**
   * Who pays this effect's change at a revenue node (incidence.json): the id of a profile, for a
   * change that does not fall on everybody who pays the tax in proportion, or of a payer outside
   * the income groups. Absent: computed from the distribution for a `schedule` effect on one that
   * incidence.json names, otherwise spread like the node's amount. Not on spending.
   */
  incidence?: string;
  /**
   * A part of the change that goes by a profile or payer of its own, set by a value between 0 and 1
   * that may follow a param: the employer's part of new contributions that the state pays as the
   * employer, say. The rest is spread as without it (by `incidence`, `incidenceAbove` or the usual
   * rule). Only on a revenue node.
   */
  incidenceShare?: { share: Value; incidence: string };
  /**
   * Who pays this change, in a sentence: where it is not spread over the income groups ("Heirs of
   * firms pay more; no source places them in income groups"), or what a spread assumes ("Counted as
   * if guests got the whole cut"). Shown with the strip of who pays, on the card's face only where
   * nothing is spread, and under the chart of who pays. Only on a revenue node.
   */
  incidenceNote?: LocalizedText;
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
  /** Who pays the passed-on part at a revenue node, as EffectBase.incidence; absent: like the node's amount. */
  incidence?: string;
  /** Who pays the passed-on part, in a sentence, as EffectBase.incidenceNote. */
  incidenceNote?: LocalizedText;
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
  /**
   * Who pays the part of the change that comes from the rates at or above `from` on the
   * distribution's variable (incidence.json): a profile or a payer, for a schedule whose upper part
   * falls on other people than the rest, such as wages above a contribution ceiling. The part is the
   * model's change on the slice of every unit's value at or above `from` (the schedule with a rate of
   * zero below it); the rest is the change on the slice below. Both are scaled to the effect's
   * actual change like the whole. The rest follows the effect's own `incidence`, or without one the
   * usual rule (computed from a named distribution, else the node's profile). `from` >= 0.
   */
  incidenceAbove?: { from: number; incidence: string };
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
 * A limit of the calculation of a measure: something the figure leaves out or an assumption of the
 * model. Unlike a catch it says nothing against the measure, so it has no kind and no severity.
 */
export interface PolicyLimit {
  text: LocalizedText;
  sources?: SourceId[];
}

/**
 * The longest summary, in characters, that a card's face shows whole: room for what the measure
 * does and what its default shows. On a phone (390 px wide) that is about five lines, on a desktop
 * three, in German and English. Validation warns about a longer one.
 */
export const SUMMARY_FACE_LENGTH = 200;

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
  /** Content of incidence.json. Absent if the pack has none: then there is no view of who pays. */
  incidence?: IncidenceFile;
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
  /**
   * Share of the debt that takes the market rate each year, above 0 and at most 1; the rest keeps
   * the rate it carried, and new borrowing pays the market rate. The model has one market rate and
   * reprices geometrically: after n years 1 - (1 - share)^n of the base year's debt carries it.
   * Usually 1 / averageMaturity, which fits where maturities are spread evenly. Where much of the
   * debt is in bills that roll over within the year (the US), the share maturing within a year
   * overstates repricing in later years, as bills are counted again each year, and 1 / average
   * maturity understates the first years; a share at which the model reproduces an official
   * sensitivity of interest to rates is then closer. The note says which, with quality "derived".
   */
  share: number;
  /** The average residual maturity in years, for display, whether or not the share is derived from it. */
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
   * The total revenue of the same government as `interestRatio` (for another country, its general
   * government) as a fraction of GDP, for the same year and from the same source as `interestRatio`,
   * which it requires. With it the interest burden can also be shown as
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
 *
 * A projection that follows the plan meets the point's `debtRatio` where it gives one; where it
 * gives none, as in a budget that projects deficits but not debt, it takes the point's primary
 * balance, `balanceRatio` plus `interestRatio`, and computes interest and debt itself. There it takes
 * the plan's revenue as well where the point gives `interestToRevenue`: `interestRatio /
 * interestToRevenue` of GDP, the revenue on which the plan's interest is that share.
 */
export interface DebtPlanPoint {
  year: number;
  /** Debt, as the pack's stock measures it (DebtFile.stock), as a fraction of GDP. */
  debtRatio?: number;
  /** Balance (revenue minus spending, negative for a deficit) as a fraction of GDP, in the plan's accounts. */
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
 * Which accounts a budget, the debt projection or an official projection follows:
 *   national_accounts  national accounts (ESA 2010, SNA 2008): what is due in the period, financial
 *                      transactions such as loans left out; the German pack's budget
 *   cash               budget plans and financial statistics in cash: payments in and out of the
 *                      budgets, as the German federal budget counts them
 *   budget             a government's own budget accounts as its budget law defines them, mostly
 *                      cash with the exceptions that law makes, such as the US unified budget
 *                      (interest on the public debt as it accrues, loans at their subsidy cost)
 */
export type DebtPlanAccounts = "national_accounts" | "cash" | "budget";

/**
 * An official projection of the country's own path, for example the government's medium-term
 * fiscal projection: shown next to the model's path, and followed where the pack or the visitor
 * chooses it as the starting path.
 *
 * The projection covers the pack's whole budget, every level of government it has, in the
 * accounts of that budget (DebtFile.accounts). A plan with `scope` "all" in those accounts
 * describes the same thing and can be drawn against it (isComparablePlanIn); any other plan, such as
 * the interest bill in the central government's cash budget beside a projection in national
 * accounts, is a figure of its own that must be shown with its scope.
 */
export interface DebtPlan {
  id: string;
  label: LocalizedText;
  /**
   * Whose finances the figures describe: "all" for the pack's whole budget (the whole state, or in a
   * pack with one level that level), or one level of government of several.
   */
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
  /** A year after the base year: a calendar year, or the pack's own year (country.json `baseYearStart`). */
  year: number;
  note: LocalizedText;
  sources?: SourceId[];
}

/** Content of debt.json. */
export interface DebtFile {
  /**
   * The debt the projection carries, at the end of the base year: the debt that the deficits of the
   * pack's budget add to. For an EU country the Maastricht debt of general government; for the US
   * federal budget the debt held by the public.
   */
  stock: DebtFigure;
  /**
   * Interest in the base year, on the same debt and in the same accounts as the budget: for an EU
   * country interest payable (ESA 2010 D.41), for the US federal budget net interest.
   */
  interest: DebtInterest;
  /**
   * The accounts the pack's budget (budget.json) is in, and so the projection: an official plan can
   * be drawn against the projection and followed only if it is for the whole budget (`scope` "all")
   * in these accounts. Absent: "national_accounts".
   */
  accounts?: DebtPlanAccounts;
  refinancing: DebtRefinancing;
  /** Exactly one param per DebtAssumptionId, in the order the interface shows them. */
  assumptions: DebtAssumptionParam[];
  /** Ready-made sets of assumptions. debt.json may leave the list out; it is then empty. */
  presets: DebtPreset[];
  /** Values to compare the projection with. debt.json may leave the list out; it is then empty. */
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
   * (isFollowablePlanIn). Without it the projection continues the base year's budget, and follows a
   * plan only when one is chosen (DebtAssumptions.follow).
   */
  follow?: string;
  /**
   * Whose budget and debt the projection covers, as a phrase that completes "This calculation
   * covers …" and, in German, "Diese Rechnung gilt für …" (accusative): "the federal government's
   * unified budget and its debt held by the public", "den Gesamthaushalt des Bundes und seine
   * Schulden in der Hand des Publikums". Shown under the projection with what it leaves out, in
   * place of the list of levels. Needed where the budget is one level's, such as the US federal
   * budget: the interface then neither speaks of "the state" nor knows on its own what the budget
   * covers. Absent: a pack of several levels is "the whole state" with its levels named, a pack of
   * one level is named by that level.
   */
  covers?: LocalizedText;
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
  /**
   * The reason in one short sentence, for the card of an excluded measure and the goal bar's line;
   * `reason` stays one step away, in the details. Absent: a reason of up to GOAL_REASON_SHORT
   * characters stands there itself; a longer one only in the details.
   */
  reasonShort?: LocalizedText;
  sources?: SourceId[];
}

/** The longest `reason` of a goal exclusion that stands on a card or the goal bar itself, without `reasonShort`. */
export const GOAL_REASON_SHORT = 90;

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

// ---------------------------------------------------------------------------------------------
// incidence.json: who pays the revenue, by income group (optional)
// ---------------------------------------------------------------------------------------------

/** One income group. Groups are listed from the lowest incomes to the highest. */
export interface IncidenceGroup {
  id: string;
  label: LocalizedText;
  /** Share of the population's units in the group, above 0; all groups sum to 1. */
  share: number;
  /**
   * Lowest income of the group in the ranking's income concept, per year and in the prices of
   * `population.year`, where a source gives one. Absent for the first group and where none is known.
   */
  from?: number;
}

/** How a burden, or a change of one, is spread over the groups. */
export interface IncidenceProfile {
  label?: LocalizedText;
  /** One number per group, in group order, each >= 0; with `payers` they sum to 1. */
  shares: number[];
  /**
   * Parts that land on payers outside the groups, by payer id, for a change that falls partly on
   * them: the surcharge on capital income and on company profits, say. Absent: all on the groups.
   */
  payers?: Record<string, number>;
  quality: Quality;
  /** At least one. */
  sources: SourceId[];
  /** Year of the data, unit of the source, what was assumed. */
  note?: LocalizedText;
}

/**
 * Somebody who pays outside the income groups (companies, employers, people abroad, the state
 * itself), or revenue that nobody pays as a tax (fees, sales, interest).
 */
export interface IncidencePayer {
  id: string;
  label: LocalizedText;
  note?: LocalizedText;
  /** Where the note's figures come from. */
  sources?: SourceId[];
}

/**
 * How a revenue node's amount is spread. `coverage` of it (0 to 1; default 1 with a profile, 0
 * without) is spread over the groups by `profile`, the rest goes to `payer`. A node without an
 * entry takes the entry of its nearest ancestor; every revenue leaf must have one, so that nothing
 * stays unnamed and the lines add up to the budget's revenue.
 */
export interface IncidenceNode {
  profile?: string;
  coverage?: number;
  payer?: string;
  note?: LocalizedText;
}

/** What the chart of the income groups adds up: for example taxes alone, or taxes with social contributions. */
export interface IncidenceScope {
  id: string;
  label: LocalizedText;
  /** Revenue nodes of budget.json, at least one, none inside another. */
  nodes: string[];
  note?: LocalizedText;
}

/** Content of incidence.json. */
export interface IncidenceFile {
  population: {
    /** What the units are, in the plural: "Menschen", "households". */
    unit: LocalizedText;
    /** How an amount per unit is written after it: "je Person", "per household". Absent: a generic "per unit". */
    perUnit?: LocalizedText;
    /** Number of units, for amounts per unit. */
    count: number;
    /** What the units are ranked by, in words a visitor understands. */
    ranking: LocalizedText;
    /** Year of the ranking and of the groups' income bounds. */
    year: number;
    quality: Quality;
    sources: SourceId[];
    note?: LocalizedText;
  };
  /** 2 to 12, from the lowest incomes to the highest. */
  groups: IncidenceGroup[];
  /** Each group's share of all income, in the ranking's income concept. */
  income: {
    /** Per group, summing to 1. */
    shares: number[];
    /** Total income of the population per year in currency units, if known: gives "x % of their income". */
    total?: number;
    concept: LocalizedText;
    quality: Quality;
    sources: SourceId[];
    note?: LocalizedText;
  };
  /** Keyed by profile id. */
  profiles: Record<string, IncidenceProfile>;
  /** Payers outside the income groups, in the order the page lists them. Ids differ from the profiles' ids. */
  payers?: IncidencePayer[];
  /** Revenue node id -> how the node's amount is spread. */
  nodes: Record<string, IncidenceNode>;
  /**
   * Distributions of the pack whose units, ranked by the distribution's variable, may stand for the
   * population ranked by income. For a `schedule` effect on such a distribution the engine works out
   * itself which group pays how much of the change.
   */
  distributions?: Record<string, { note: LocalizedText }>;
  /** At least one; the first is what the page opens with. */
  scopes: IncidenceScope[];
  /** What the view shows, what it leaves out and what it assumes, in plain words. */
  note: LocalizedText;
}
