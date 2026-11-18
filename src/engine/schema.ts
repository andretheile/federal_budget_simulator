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
  Catch,
  Country,
  Distribution,
  Effect,
  EffectShift,
  GroupNode,
  LeafNode,
  LocalizedText,
  Param,
  PoliciesFile,
  Policy,
  Source,
  Value,
} from "./types.ts";

const SNAKE = "[a-z0-9]+(?:_[a-z0-9]+)*";
const ID_PATTERN = new RegExp(`^${SNAKE}$`);
const NODE_ID_PATTERN = new RegExp(`^(?:rev|exp)(?:\\.${SNAKE})+$`);

const text = z.string().min(1);
const year = z.number().int().min(1900).max(2200);
const share = z.number().min(0).max(1);

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
  note: z.string().optional(),
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

export const paramSchema = z.discriminatedUnion("type", [
  z.strictObject({
    id: idSchema,
    type: z.literal("number"),
    label: localizedTextSchema,
    unit: z.enum(["percent", "percent_gdp", "currency", "years", "count"]),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    default: z.number(),
    baseline: z.number().optional(),
  }),
  z.strictObject({
    id: idSchema,
    type: z.literal("groups"),
    label: localizedTextSchema,
    node: z.string(),
    breakdown: z.string(),
    default: z.array(z.string()),
  }),
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

const effectBase = {
  target: z.string(),
  quality: qualitySchema,
  uncertainty: uncertaintySchema.optional(),
  sources: sourceIds.optional(),
  note: localizedTextSchema.optional(),
};

/** Only allowed on `scale` and `excludeGroups` effects; on the others it is an unknown key. */
export const shiftSchema = z.strictObject({
  to: z.string(),
  ratio: valueSchema,
  uncertainty: uncertaintySchema.optional(),
});

export const scheduleSchema = z.strictObject({
  brackets: z.array(z.strictObject({ from: valueSchema, rate: valueSchema })).min(1),
});

export const constScheduleSchema = z.strictObject({
  brackets: z.array(z.strictObject({ from: z.number(), rate: share })).min(1),
});

export const effectSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...effectBase, type: z.literal("scale"), factor: valueSchema, shift: shiftSchema.optional() }),
  z.strictObject({ ...effectBase, type: z.literal("add"), amount: valueSchema }),
  z.strictObject({ ...effectBase, type: z.literal("set"), amount: valueSchema }),
  z.strictObject({
    ...effectBase,
    type: z.literal("excludeGroups"),
    breakdown: z.string(),
    groups: z.union([z.array(z.string()), z.strictObject({ param: z.string() })]),
    retained: valueSchema.optional(),
    shift: shiftSchema.optional(),
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

export const policySchema = z.strictObject({
  id: idSchema,
  label: localizedTextSchema,
  summary: localizedTextSchema,
  topic: z.enum(["migration", "social", "taxes", "pensions", "defense", "climate", "state", "europe", "other"]),
  params: z.array(paramSchema),
  effects: z.array(effectSchema).min(1),
  catches: z.array(catchSchema),
  sources: sourceIds,
});

export const policiesFileSchema = z.strictObject({ policies: z.array(policySchema) });

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
  Assert<Same<Out<typeof paramSchema>, Param>>,
  Assert<Same<Out<typeof valueSchema>, Value>>,
  Assert<Same<Out<typeof shiftSchema>, EffectShift>>,
  Assert<Same<Out<typeof effectSchema>, Effect>>,
  Assert<Same<Out<typeof catchSchema>, Catch>>,
  Assert<Same<Out<typeof policySchema>, Policy>>,
  Assert<Same<Out<typeof policiesFileSchema>, PoliciesFile>>,
];
