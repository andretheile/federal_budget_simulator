/**
 * zod schemas mirroring types.ts. They check the shape of each file on its own; everything that
 * needs a second file or a sum (references, share totals, locales) is checked in validate.ts.
 *
 * Objects are strict: an unknown key is an error. A misspelt optional key such as `yeild` or
 * `retaind` would otherwise be dropped silently and change the result.
 */
import { z } from "zod";
import type {
  Breakdown,
  Budget,
  BudgetNode,
  BracketSchedule,
  Catch,
  ConstBracketSchedule,
  ConstSchedule,
  Country,
  CurveParam,
  CurveSchedule,
  DebtFile,
  Distribution,
  Effect,
  EffectShift,
  Goal,
  GoalsFile,
  GroupNode,
  LeafNode,
  LocalizedText,
  NumberParam,
  Param,
  PointsSchedule,
  PoliciesFile,
  Policy,
  PolicyCollection,
  PolicyLimit,
  PolicyTiming,
  Schedule,
  Source,
  TimingPhase,
  Value,
} from "./types.ts";

const SNAKE = "[a-z0-9]+(?:_[a-z0-9]+)*";
const ID_PATTERN = new RegExp(`^${SNAKE}$`);
const NODE_ID_PATTERN = new RegExp(`^(?:rev|exp)(?:\\.${SNAKE})+$`);

const text = z.string().min(1);
const year = z.number().int().min(1900).max(2200);
const share = z.number().min(0).max(1);

type IssuePath = readonly PropertyKey[];

interface RawIssue {
  code?: string;
  path: PropertyKey[];
  message: string;
  expected?: string;
  errors?: RawIssue[][];
}

/**
 * zod reports a failed union as one "Invalid input" issue with the issues of every variant
 * nested inside. Report the variant the author most likely meant: one whose basic type matched
 * and that knows all the keys that are present, and of those the one with the fewest problems.
 */
export function flattenIssues(issues: readonly unknown[], prefix: IssuePath = []): { path: IssuePath; message: string }[] {
  const out: { path: IssuePath; message: string }[] = [];
  for (const issue of issues as readonly RawIssue[]) {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union" && issue.errors && issue.errors.length > 0) {
      const wrongType = (variant: RawIssue[]): boolean =>
        variant.some((inner) => inner.code === "invalid_type" && inner.path.length === 0);
      // A variant that does not know one of the keys that are present is not the one that was meant.
      const strangeKeys = (variant: RawIssue[]): boolean =>
        variant.some((inner) => inner.code === "unrecognized_keys" && inner.path.length === 0);
      const rightType = issue.errors.filter((variant) => !wrongType(variant));
      const fitting = rightType.filter((variant) => !strangeKeys(variant));
      const plausible = fitting.length > 0 ? fitting : rightType;
      if (plausible.length > 0) {
        const best = plausible.reduce((a, b) => (b.length < a.length ? b : a));
        out.push(...flattenIssues(best, path));
      } else {
        const expected = issue.errors.flatMap((variant) => variant.map((inner) => inner.expected ?? ""));
        out.push({ path, message: `Invalid input: expected ${[...new Set(expected.filter(Boolean))].join(" or ")}` });
      }
    } else {
      out.push({ path, message: issue.message });
    }
  }
  return out;
}

/**
 * A schema for an object that comes in several forms, told apart by which key is present. This
 * keeps error messages specific where z.union can only say that nothing matched: the form that
 * was meant is checked and its problems are reported as they are. `misplaced` names keys of
 * forms that exist elsewhere in the contract but are not allowed here, with the message to give.
 */
function byKey<T>(forms: Record<string, z.ZodType<T>>, misplaced: Record<string, string> = {}): z.ZodType<T> {
  const keys = Object.keys(forms);
  return z.unknown().transform((value, ctx): T => {
    const present = typeof value === "object" && value !== null ? value : {};
    const key = keys.find((candidate) => candidate in present);
    if (key === undefined) {
      for (const [wrong, message] of Object.entries(misplaced)) {
        if (wrong in present) {
          ctx.addIssue({ code: "custom", message });
          return z.NEVER;
        }
      }
    }
    const result = forms[key ?? keys[0]].safeParse(value);
    if (result.success) return result.data;
    for (const issue of flattenIssues(result.error.issues)) {
      ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
    }
    return z.NEVER;
  });
}

export const idSchema = z.string().regex(ID_PATTERN, "must be lower_snake_case (a-z, 0-9 and _)");

export const nodeIdSchema = z
  .string()
  .regex(NODE_ID_PATTERN, 'must be a dotted path of lower_snake_case segments starting with "rev." or "exp."');

export const localizedTextSchema = z.object({ en: text }).catchall(text);

export const qualitySchema = z.enum(["official", "derived", "estimate"]);

export const levelIdSchema = z.enum(["central", "state", "local", "social_security"]);

export const sourceSchema = z.strictObject({
  title: text,
  publisher: text,
  url: text,
  accessed: z.iso.date("must be an ISO date (YYYY-MM-DD)"),
  year: year.optional(),
  note: z.union([text, localizedTextSchema]).optional(),
});

export const sourcesFileSchema = z.record(idSchema, sourceSchema);

const sourceIds = z.array(z.string());

export const indicatorSchema = z.strictObject({
  value: z.number().positive(),
  quality: qualitySchema,
  sources: sourceIds,
  year: year.optional(),
});

export const countrySchema = z.strictObject({
  id: z.string().regex(/^[a-z]{2}$/, "must be a lower-case ISO 3166-1 alpha-2 code"),
  name: localizedTextSchema,
  currency: z.string().regex(/^[A-Z]{3}$/, "must be an ISO 4217 code"),
  locales: z.array(text).min(1),
  baseYear: year,
  baseYearStart: z.iso.date("must be an ISO date (YYYY-MM-DD)").optional(),
  baseYearLabel: localizedTextSchema.optional(),
  baseYearShort: localizedTextSchema.optional(),
  preview: z.boolean().optional(),
  levels: z.partialRecord(levelIdSchema, z.strictObject({ name: localizedTextSchema })),
  indicators: z.strictObject({
    gdp: indicatorSchema,
    population: indicatorSchema,
    households: indicatorSchema.optional(),
    grossDebt: indicatorSchema.optional(),
  }),
  methodology: localizedTextSchema.optional(),
});

export const breakdownSchema = z.strictObject({
  label: localizedTextSchema,
  basis: z.enum(["spending", "recipients"]),
  groups: z.array(z.strictObject({ id: idSchema, label: localizedTextSchema, share })).min(1),
  quality: qualitySchema,
  sources: sourceIds,
  year: year.optional(),
  note: localizedTextSchema.optional(),
});

const nodeBase = {
  id: nodeIdSchema,
  label: localizedTextSchema,
  description: localizedTextSchema.optional(),
  code: text.optional(),
  breakdowns: z.record(idSchema, breakdownSchema).optional(),
};

export const leafNodeSchema = z.strictObject({
  ...nodeBase,
  amount: z.number().min(0),
  levels: z.partialRecord(levelIdSchema, share),
  quality: qualitySchema,
  sources: sourceIds.min(1),
  year: year.optional(),
  note: localizedTextSchema.optional(),
});

export const groupNodeSchema: z.ZodType<GroupNode> = z.strictObject({
  ...nodeBase,
  children: z.array(z.lazy(() => budgetNodeSchema)).min(1),
});

/**
 * A node is a group if it has `children`, otherwise a leaf. Dispatching on that key by hand
 * (instead of z.union) keeps the error messages specific: a typo in a leaf is reported as that
 * typo, not as "does not match any variant".
 */
export const budgetNodeSchema: z.ZodType<BudgetNode> = z.unknown().transform((value, ctx): BudgetNode => {
  const isGroup = typeof value === "object" && value !== null && "children" in value;
  const result = isGroup ? groupNodeSchema.safeParse(value) : leafNodeSchema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
  }
  return z.NEVER;
});

export const budgetSchema = z.strictObject({
  revenue: z.array(budgetNodeSchema).min(1),
  expenditure: z.array(budgetNodeSchema).min(1),
});

const binSchema = z.strictObject({
  from: z.number(),
  to: z.number(),
  count: z.number().min(0),
  mean: z.number(),
});

export const distributionSchema = z.strictObject({
  id: idSchema,
  label: localizedTextSchema,
  variable: localizedTextSchema,
  unit: localizedTextSchema,
  year,
  bins: z.array(binSchema).min(1),
  tail: z
    .strictObject({
      from: z.number().positive(),
      count: z.number().min(0),
      alpha: z.number().gt(1),
    })
    .optional(),
  quality: qualitySchema,
  sources: sourceIds,
  note: localizedTextSchema.optional(),
});

export const curvePointSchema = z.strictObject({ x: z.number(), y: z.number() });

const curvePoints = z.array(curvePointSchema);

const curveAxis = <U extends string>(unit: U) =>
  z.strictObject({ unit: z.literal(unit), min: z.number(), max: z.number(), step: z.number().positive() });

export const curveParamSchema = z.strictObject({
  id: idSchema,
  type: z.literal("curve"),
  label: localizedTextSchema,
  x: curveAxis("currency"),
  y: curveAxis("percent"),
  default: curvePoints,
  baseline: curvePoints.optional(),
  minPoints: z.number().int().min(0).optional(),
  maxPoints: z.number().int().min(1).optional(),
  presets: z
    .array(
      z.strictObject({
        id: idSchema,
        label: localizedTextSchema,
        note: localizedTextSchema.optional(),
        points: curvePoints,
        sources: sourceIds.optional(),
      }),
    )
    .optional(),
  examples: z.array(z.strictObject({ x: z.number(), label: localizedTextSchema })).optional(),
});

export const numberParamSchema = z.strictObject({
  id: idSchema,
  type: z.literal("number"),
  label: localizedTextSchema,
  unit: z.enum(["percent", "percent_gdp", "currency", "years", "count"]),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  default: z.number(),
  baseline: z.number().optional(),
  baselineLabel: localizedTextSchema.optional(),
  unitLabel: localizedTextSchema.optional(),
  role: z.literal("assumption").optional(),
});

export const paramSchema = z.discriminatedUnion("type", [
  numberParamSchema,
  z.strictObject({
    id: idSchema,
    type: z.literal("groups"),
    label: localizedTextSchema,
    node: z.string(),
    breakdown: z.string(),
    default: z.array(z.string()),
  }),
  curveParamSchema,
]);

export const valueSchema = z.union([
  z.number(),
  z.strictObject({
    param: z.string(),
    scale: z.number().optional(),
    offset: z.number().optional(),
    times: z.enum(["gdp", "population", "households"]).optional(),
  }),
]);

const uncertaintySchema = z.strictObject({ low: z.number(), high: z.number() });

/** An effect's own uncertainty may name a basis that ties it to other effects (see types.ts). */
const effectUncertaintySchema = uncertaintySchema.extend({ basis: idSchema.optional() });

/** Allowed on every effect: a share of the target's change passed on to another node. */
export const shiftSchema = z.strictObject({
  to: z.string(),
  ratio: valueSchema,
  uncertainty: uncertaintySchema.optional(),
  label: localizedTextSchema.optional(),
  quality: qualitySchema.optional(),
  sources: sourceIds.optional(),
  note: localizedTextSchema.optional(),
});

const effectBase = {
  target: z.string(),
  quality: qualitySchema,
  uncertainty: effectUncertaintySchema.optional(),
  sources: sourceIds.optional(),
  note: localizedTextSchema.optional(),
  shift: shiftSchema.optional(),
};

export const bracketScheduleSchema = z.strictObject({
  brackets: z.array(z.strictObject({ from: valueSchema, rate: valueSchema })).min(1),
});

export const curveScheduleSchema = z.strictObject({
  curve: z.strictObject({ param: z.string(), scale: z.number().optional() }),
});

export const constBracketScheduleSchema = z.strictObject({
  brackets: z.array(z.strictObject({ from: z.number(), rate: share })).min(1),
});

export const pointsScheduleSchema = z.strictObject({
  points: curvePoints.min(1),
  scale: z.number().optional(),
});

/** A reform: brackets, or the value of a curve param. */
export const scheduleSchema: z.ZodType<Schedule> = byKey<Schedule>(
  { brackets: bracketScheduleSchema, curve: curveScheduleSchema },
  { points: 'fixed "points" are only allowed in a baseline; a reform needs "brackets" or "curve"' },
);

/** A baseline: brackets, or fixed curve points. */
export const constScheduleSchema: z.ZodType<ConstSchedule> = byKey<ConstSchedule>(
  { brackets: constBracketScheduleSchema, points: pointsScheduleSchema },
  { curve: 'a "curve" schedule is only allowed as the reform; a baseline needs "brackets" or "points"' },
);

export const effectSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...effectBase, type: z.literal("scale"), factor: valueSchema }),
  z.strictObject({ ...effectBase, type: z.literal("add"), amount: valueSchema }),
  z.strictObject({ ...effectBase, type: z.literal("set"), amount: valueSchema }),
  z.strictObject({
    ...effectBase,
    type: z.literal("excludeGroups"),
    breakdown: z.string(),
    groups: z.union([z.array(z.string()), z.strictObject({ param: z.string() })]),
    retained: valueSchema.optional(),
  }),
  z.strictObject({
    ...effectBase,
    type: z.literal("schedule"),
    distribution: z.string(),
    reform: scheduleSchema,
    baseline: constScheduleSchema.optional(),
    yield: valueSchema.optional(),
  }),
]);

export const catchSchema = z.strictObject({
  kind: z.enum(["legal", "economic", "cost_shift", "practical", "political"]),
  severity: z.enum(["blocker", "major", "minor"]),
  text: localizedTextSchema,
  sources: sourceIds.optional(),
});

export const policyLimitSchema = z.strictObject({
  text: localizedTextSchema,
  sources: sourceIds.optional(),
});

export const timingPhaseSchema = z.strictObject({
  from: z.iso.date("must be an ISO date (YYYY-MM-DD)").optional(),
  years: z.number().min(0).optional(),
  yearsPerUnit: z.number().min(0).optional(),
});

export const policyTimingSchema = timingPhaseSchema.extend({
  param: z.string().optional(),
  below: timingPhaseSchema.optional(),
  note: localizedTextSchema,
  sources: sourceIds.min(1),
});

export const policySchema = z.strictObject({
  id: idSchema,
  label: localizedTextSchema,
  summary: localizedTextSchema,
  explanation: localizedTextSchema.optional(),
  topic: z.enum(["migration", "social", "taxes", "pensions", "defense", "climate", "state", "europe", "other"]),
  params: z.array(paramSchema),
  effects: z.array(effectSchema).min(1),
  catches: z.array(catchSchema),
  limits: z.array(policyLimitSchema).optional(),
  sources: sourceIds,
  timing: policyTimingSchema.optional(),
});

export const policyCollectionSchema = z.strictObject({
  id: idSchema,
  label: localizedTextSchema,
  description: localizedTextSchema.optional(),
  policies: z.array(z.string()).min(1),
  sources: sourceIds.optional(),
});

export const policiesFileSchema = z.strictObject({
  policies: z.array(policySchema),
  collections: z.array(policyCollectionSchema).optional(),
});

// --- debt.json ----------------------------------------------------------------------------------

const debtAssumptionId = z.enum(["market_rate", "growth", "horizon", "drift"]);

export const debtFigureSchema = z.strictObject({
  value: z.number().min(0),
  quality: qualitySchema,
  sources: sourceIds.min(1),
  note: localizedTextSchema.optional(),
});

export const debtFileSchema = z.strictObject({
  stock: debtFigureSchema.extend({ value: z.number().positive() }),
  interest: debtFigureSchema.extend({ node: z.string().optional() }),
  refinancing: z.strictObject({
    share: z.number().gt(0).max(1),
    averageMaturity: z.number().positive().optional(),
    quality: qualitySchema,
    sources: sourceIds.min(1),
    note: localizedTextSchema.optional(),
  }),
  assumptions: z.array(
    numberParamSchema.extend({
      id: debtAssumptionId,
      note: localizedTextSchema.optional(),
      sources: sourceIds.optional(),
    }),
  ),
  presets: z.array(
    z
      .strictObject({
        id: idSchema,
        label: localizedTextSchema,
        note: localizedTextSchema.optional(),
        values: z.partialRecord(debtAssumptionId, z.number()),
        sources: sourceIds.optional(),
      })
      .refine((preset) => Object.keys(preset.values).length > 0, {
        message: "a preset must set at least one assumption",
        path: ["values"],
      }),
  ).default([]),
  references: z.array(
    z.strictObject({
      id: idSchema,
      label: localizedTextSchema,
      kind: z.enum(["country", "threshold", "history"]),
      year: year.optional(),
      debtRatio: z.number().min(0).optional(),
      interestRatio: z.number().min(0).optional(),
      revenueRatio: z.number().positive().optional(),
      sources: sourceIds.min(1),
      note: localizedTextSchema.optional(),
    }),
  ).default([]),
  comparisons: z.array(z.strictObject({ node: z.string(), label: localizedTextSchema.optional() })).optional(),
  plans: z
    .array(
      z.strictObject({
        id: idSchema,
        label: localizedTextSchema,
        scope: z.enum(["all", "central", "state", "local", "social_security"]),
        accounts: z.enum(["national_accounts", "cash", "budget"]),
        points: z
          .array(
            z.strictObject({
              year,
              debtRatio: z.number().min(0).optional(),
              balanceRatio: z.number().optional(),
              interestRatio: z.number().min(0).optional(),
              interestToRevenue: z.number().min(0).optional(),
              interest: z.number().min(0).optional(),
              growth: z.number().gt(-1).optional(),
            }),
          )
          .min(1),
        quality: qualitySchema,
        sources: sourceIds.min(1),
        note: localizedTextSchema,
      }),
    )
    .optional(),
  measuresFrom: z.strictObject({ year, note: localizedTextSchema, sources: sourceIds.optional() }).optional(),
  accounts: z.enum(["national_accounts", "cash", "budget"]).optional(),
  follow: idSchema.optional(),
  note: localizedTextSchema,
});

// --- goals.json ---------------------------------------------------------------------------------

export const goalSchema = z.strictObject({
  id: idSchema,
  label: localizedTextSchema,
  description: localizedTextSchema,
  level: levelIdSchema.optional(),
  amount: z.number().positive(),
  year,
  quality: qualitySchema,
  sources: sourceIds.min(1),
  note: localizedTextSchema,
  excluded: z
    .array(
      z
        .strictObject({
          node: z.string().optional(),
          policy: z.string().optional(),
          reason: localizedTextSchema,
          reasonShort: localizedTextSchema.optional(),
          sources: sourceIds.optional(),
        })
        .refine((entry) => (entry.node === undefined) !== (entry.policy === undefined), 'an excluded entry needs exactly one of "node" and "policy"'),
    )
    .optional(),
});

export const goalsFileSchema = z.strictObject({
  default: z.string(),
  goals: z.array(goalSchema).min(1),
});

// Compile-time check that the schemas and the contract types describe the same data. Mutual
// assignability catches missing required fields, wrong types and enum members that differ. It
// cannot see an optional field that is missing from a schema; the Testland fixture uses every
// optional field, so the strict schemas would reject it in the tests.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type Out<S extends z.ZodType> = z.infer<S>;
export type SchemaMatchesTypes = [
  Assert<Same<Out<typeof localizedTextSchema>, LocalizedText>>,
  Assert<Same<Out<typeof sourceSchema>, Source>>,
  Assert<Same<Out<typeof countrySchema>, Country>>,
  Assert<Same<Out<typeof breakdownSchema>, Breakdown>>,
  Assert<Same<Out<typeof leafNodeSchema>, LeafNode>>,
  Assert<Same<Out<typeof budgetSchema>, Budget>>,
  Assert<Same<Out<typeof distributionSchema>, Distribution>>,
  Assert<Same<Out<typeof curveParamSchema>, CurveParam>>,
  Assert<Same<Out<typeof paramSchema>, Param>>,
  Assert<Same<Out<typeof bracketScheduleSchema>, BracketSchedule>>,
  Assert<Same<Out<typeof curveScheduleSchema>, CurveSchedule>>,
  Assert<Same<Out<typeof constBracketScheduleSchema>, ConstBracketSchedule>>,
  Assert<Same<Out<typeof pointsScheduleSchema>, PointsSchedule>>,
  Assert<Same<Out<typeof valueSchema>, Value>>,
  Assert<Same<Out<typeof shiftSchema>, EffectShift>>,
  Assert<Same<Out<typeof effectSchema>, Effect>>,
  Assert<Same<Out<typeof catchSchema>, Catch>>,
  Assert<Same<Out<typeof policyLimitSchema>, PolicyLimit>>,
  Assert<Same<Out<typeof policySchema>, Policy>>,
  Assert<Same<Out<typeof timingPhaseSchema>, TimingPhase>>,
  Assert<Same<Out<typeof policyTimingSchema>, PolicyTiming>>,
  Assert<Same<Out<typeof policyCollectionSchema>, PolicyCollection>>,
  Assert<Same<Out<typeof policiesFileSchema>, PoliciesFile>>,
  Assert<Same<Out<typeof numberParamSchema>, NumberParam>>,
  Assert<Same<Out<typeof debtFileSchema>, DebtFile>>,
  Assert<Same<Out<typeof goalSchema>, Goal>>,
  Assert<Same<Out<typeof goalsFileSchema>, GoalsFile>>,
];
