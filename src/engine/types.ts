/**
 * Country pack contract, v0.
 *
 * A country pack is a directory `countries/<id>/` with
 *   country.json            -> Country
 *   budget.json             -> Budget
 *   policies.json           -> PoliciesFile
 *   sources.json            -> Record<SourceId, Source>
 *   distributions/<id>.json -> Distribution (the file name is the id)
 *
 * Conventions
 * - Money is in plain currency units per year (euros, not millions).
 * - Shares and rates are fractions between 0 and 1, except policy parameters, whose `unit` says
 *   what they are.
 * - Ids are lower_snake_case. Budget node ids are dotted paths, unique across the whole budget,
 *   starting with `rev.` or `exp.`.
 * - Only leaf nodes carry amounts. Group totals are always derived by summing leaves.
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
  /** Today's value, for display only. */
  baseline?: number;
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

export type Param = NumberParam | GroupsParam;

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

export interface EffectBase {
  /** Budget node id. */
  target: string;
  quality: Quality;
  /** Multipliers on this effect's delta for the low and the high estimate. Does not apply to a `shift`. */
  uncertainty?: { low: number; high: number };
  sources?: SourceId[];
  note?: LocalizedText;
}

/**
 * Optional on `scale` and `excludeGroups` effects: part of what the effect removes from its
 * target reappears at another node, for example when people who lose one benefit fall back on
 * another one that a different level of government pays.
 *
 * removed = target total before the effect - target total after it (after clamping).
 * removed * ratio is then added to `to` like an `add` effect. If the effect increased the target,
 * both are negative.
 */
export interface EffectShift {
  /** Budget node id that receives the cost. Not the target, nor a node above or below it. */
  to: string;
  /** Part of the removed amount that reappears at `to`; >= 0, may exceed 1. */
  ratio: Value;
  /** Multipliers on the shifted amount only, for the low and the high estimate. Default 1 and 1. */
  uncertainty?: { low: number; high: number };
}

/** new = old * factor */
export interface ScaleEffect extends EffectBase {
  type: "scale";
  factor: Value;
  shift?: EffectShift;
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
  shift?: EffectShift;
}

/**
 * A marginal-rate schedule integrated over a distribution.
 * With `baseline` the effect is calibrated: delta = current target * (model(reform) / model(baseline) - 1).
 * Without it the effect is absolute: delta = model(reform). Either is multiplied by (yield ?? 1).
 */
export interface ScheduleEffect extends EffectBase {
  type: "schedule";
  distribution: string;
  reform: Schedule;
  baseline?: ConstSchedule;
  yield?: Value;
}

export type Effect = ScaleEffect | AddEffect | SetEffect | ExcludeGroupsEffect | ScheduleEffect;

/** Marginal rates, ascending `from`. */
export interface Schedule {
  brackets: { from: Value; rate: Value }[];
}

export interface ConstSchedule {
  brackets: { from: number; rate: number }[];
}

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
}

export const LEVEL_IDS: readonly LevelId[] = ["central", "state", "local", "social_security"];
