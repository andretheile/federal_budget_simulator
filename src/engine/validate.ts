/**
 * Validation of a country pack: the zod shape of every file, then everything that needs more than
 * one value to judge (references between files, sums of shares, locales, bins, brackets).
 *
 * Every problem is reported with the file and the JSON path it was found at. Cross-file checks
 * are skipped for a file that already failed its shape check, so one typo does not bury the
 * report under follow-up errors.
 */
import type { z } from "zod";
import { bracketsToCurve, curveAffected, curveTotal } from "./curve.ts";
import { isComparablePlan, isFollowablePlan } from "./debt.ts";
import { scheduleTotal, totalUnits } from "./distribution.ts";
import {
  budgetSchema,
  countrySchema,
  debtFileSchema,
  distributionSchema,
  flattenIssues,
  goalsFileSchema,
  policiesFileSchema,
  sourcesFileSchema,
} from "./schema.ts";
import { evaluateBrackets, evaluateValue, simulate, simulatePolicy, type ParamValues } from "./simulate.ts";
import {
  CURVE_MAX_POINTS,
  CURVE_MIN_POINTS,
  DEBT_ASSUMPTION_IDS,
  DEBT_ASSUMPTION_UNITS,
  type Breakdown,
  type BudgetNode,
  type CountryPack,
  type CurveParam,
  type CurvePoint,
  type DebtAssumptionId,
  type DebtAssumptionParam,
  type Distribution,
  type Effect,
  type LevelId,
  type LocalizedText,
  type Param,
  type Policy,
  type SourceId,
  type Value,
} from "./types.ts";

/** The parsed JSON of each file of one pack, before any checking. */
export interface RawPackFiles {
  /** Name of the pack directory. If given, country.id must equal it. */
  id?: string;
  country?: unknown;
  budget?: unknown;
  policies?: unknown;
  sources?: unknown;
  /** Keyed by file name without ".json". */
  distributions?: Record<string, unknown>;
  /** debt.json, which is optional: undefined means the pack has none. */
  debt?: unknown;
  /** goals.json, which is optional: undefined means the pack has none. */
  goals?: unknown;
}

export interface ValidationIssue {
  /** Path of the file inside the pack directory, e.g. "budget.json" or "distributions/income.json". */
  file: string;
  /** JSON path inside that file, e.g. "$.expenditure[2].children[0].levels". */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; pack: CountryPack; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

/** Allowed deviation from 1 for sums of shares. */
export const SHARE_TOLERANCE = 0.001;

/** A stand-in for comparing two curves where the effect's own distribution is not usable. */
const ONE_UNIT: Distribution = {
  id: "one_unit",
  label: { en: "one unit" },
  variable: { en: "value" },
  unit: { en: "unit" },
  year: 2000,
  bins: [{ from: 0, to: 1, count: 1, mean: 0.5 }],
  quality: "estimate",
  sources: [],
};

const COUNTRY = "country.json";
const BUDGET = "budget.json";
const POLICIES = "policies.json";
const SOURCES = "sources.json";
const DEBT = "debt.json";
const GOALS = "goals.json";
const distributionFile = (id: string): string => `distributions/${id}.json`;

type Path = readonly PropertyKey[];

/** "$.revenue[0].children[1].amount" */
export function formatPath(path: Path): string {
  let out = "$";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(key))) out += `.${String(key)}`;
    else out += `[${JSON.stringify(String(key))}]`;
  }
  return out;
}

/** One line per issue: "budget.json $.revenue[0].amount: Too small: expected number to be >=0". */
export function formatIssue(issue: ValidationIssue): string {
  return `${issue.file} ${issue.path}: ${issue.message}`;
}

/** Check the parsed files of one pack. */
export function validatePack(files: RawPackFiles): ValidationResult {
  return check(files, [], [], new Set());
}

/**
 * Check a pack given the text of its JSON files, keyed by path relative to the pack directory
 * ("country.json", "distributions/income.json"). Files that are not valid JSON are reported like
 * any other error; files the contract does not know are ignored with a warning.
 */
export function validatePackFiles(texts: Record<string, string>, id?: string): ValidationResult {
  const files: RawPackFiles = { id, distributions: {} };
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const unreadable = new Set<string>();
  const slots: Record<string, "country" | "budget" | "policies" | "sources" | "debt" | "goals"> = {
    [COUNTRY]: "country",
    [BUDGET]: "budget",
    [POLICIES]: "policies",
    [SOURCES]: "sources",
    [DEBT]: "debt",
    [GOALS]: "goals",
  };
  for (const [file, text] of Object.entries(texts)) {
    const slot = Object.hasOwn(slots, file) ? slots[file] : undefined;
    const distribution = /^distributions\/([^/]+)\.json$/.exec(file)?.[1];
    if (!slot && distribution === undefined) {
      warnings.push({ file, path: "$", message: "not part of the country pack contract, ignored" });
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (cause) {
      errors.push({ file, path: "$", message: `not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` });
      unreadable.add(file);
      continue;
    }
    if (slot) files[slot] = value;
    else if (distribution !== undefined) files.distributions![distribution] = value;
  }
  return check(files, errors, warnings, unreadable);
}

interface NodeInfo {
  node: BudgetNode;
  isLeaf: boolean;
  /** Sum of the base amounts of all leaves at or below the node. */
  total: number;
  /** Ids of the groups the node lies in, outermost first. */
  ancestors: readonly string[];
}

function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

function sumsToOne(sum: number): boolean {
  return Math.abs(sum - 1) <= SHARE_TOLERANCE + 1e-9;
}

function isFraction(n: number): boolean {
  return n >= 0 && n <= 1;
}

function round(n: number): number {
  return Number(n.toPrecision(6));
}

/** Whether a and b differ by at most `tolerance` of the larger of the two. */
function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b));
}

function check(
  files: RawPackFiles,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  unreadable: ReadonlySet<string>,
): ValidationResult {
  const error = (file: string, path: Path, message: string): void => {
    errors.push({ file, path: formatPath(path), message });
  };
  const warn = (file: string, path: Path, message: string): void => {
    warnings.push({ file, path: formatPath(path), message });
  };

  // --- shape of each file ---------------------------------------------------------------------

  const parse = <T>(file: string, schema: z.ZodType<T>, raw: unknown): T | undefined => {
    if (unreadable.has(file)) return undefined;
    if (raw === undefined) {
      error(file, [], "file is missing");
      return undefined;
    }
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    for (const issue of flattenIssues(result.error.issues)) {
      error(file, issue.path, issue.message);
    }
    return undefined;
  };

  const country = parse(COUNTRY, countrySchema, files.country);
  const budget = parse(BUDGET, budgetSchema, files.budget);
  const policiesFile = parse(POLICIES, policiesFileSchema, files.policies);
  const sources = parse(SOURCES, sourcesFileSchema, files.sources);
  const debt = files.debt === undefined ? undefined : parse(DEBT, debtFileSchema, files.debt);
  const goals = files.goals === undefined ? undefined : parse(GOALS, goalsFileSchema, files.goals);
  const distributions: Record<string, Distribution> = {};
  /** Every distribution that has a file, readable or not, so a broken file is not also reported as a missing reference. */
  const distributionNames = new Set<string>();
  for (const file of unreadable) {
    const name = /^distributions\/([^/]+)\.json$/.exec(file)?.[1];
    if (name !== undefined) distributionNames.add(name);
  }
  for (const [name, raw] of Object.entries(files.distributions ?? {})) {
    distributionNames.add(name);
    const distribution = parse(distributionFile(name), distributionSchema, raw);
    if (distribution) distributions[name] = distribution;
  }

  // --- helpers that need country.json or sources.json -------------------------------------------

  const locales = country?.locales;
  const text = (file: string, path: Path, value: LocalizedText | undefined): void => {
    if (!value || !locales) return;
    for (const locale of locales) {
      if (!Object.hasOwn(value, locale)) error(file, path, `text for locale "${locale}" is missing`);
    }
  };

  const usedSources = new Set<SourceId>();
  const refs = (file: string, path: Path, ids: readonly SourceId[] | undefined): void => {
    ids?.forEach((id, i) => {
      usedSources.add(id);
      if (sources && !Object.hasOwn(sources, id)) error(file, [...path, i], `unknown source "${id}"`);
    });
  };

  // --- country.json ---------------------------------------------------------------------------

  if (country) {
    if (files.id !== undefined && country.id !== files.id) {
      error(COUNTRY, ["id"], `is "${country.id}" but the pack directory is "${files.id}"`);
    }
    country.locales.forEach((locale, i) => {
      if (country.locales.indexOf(locale) !== i) error(COUNTRY, ["locales", i], `duplicate locale "${locale}"`);
    });
    if (Object.keys(country.levels).length === 0) error(COUNTRY, ["levels"], "at least one level is needed");
    text(COUNTRY, ["name"], country.name);
    text(COUNTRY, ["baseYearLabel"], country.baseYearLabel);
    text(COUNTRY, ["baseYearShort"], country.baseYearShort);
    text(COUNTRY, ["methodology"], country.methodology);
    for (const [level, entry] of Object.entries(country.levels)) text(COUNTRY, ["levels", level, "name"], entry.name);
    for (const [key, indicator] of Object.entries(country.indicators)) {
      refs(COUNTRY, ["indicators", key, "sources"], indicator.sources);
    }
  }

  // --- budget.json ----------------------------------------------------------------------------

  const nodes = new Map<string, NodeInfo>();

  const checkBreakdown = (id: string, breakdown: Breakdown, path: Path): void => {
    text(BUDGET, [...path, "label"], breakdown.label);
    text(BUDGET, [...path, "note"], breakdown.note);
    refs(BUDGET, [...path, "sources"], breakdown.sources);
    const seen = new Set<string>();
    let sum = 0;
    breakdown.groups.forEach((group, i) => {
      if (seen.has(group.id)) error(BUDGET, [...path, "groups", i, "id"], `duplicate group id "${group.id}" in breakdown "${id}"`);
      seen.add(group.id);
      sum += group.share;
      text(BUDGET, [...path, "groups", i, "label"], group.label);
    });
    if (!sumsToOne(sum)) error(BUDGET, [...path, "groups"], `shares sum to ${round(sum)}, expected 1`);
  };

  const walk = (node: BudgetNode, side: "revenue" | "expenditure", path: Path, ancestors: readonly string[] = []): number => {
    const prefix = side === "revenue" ? "rev." : "exp.";
    if (!node.id.startsWith(prefix)) {
      error(BUDGET, [...path, "id"], `"${node.id}" is on the ${side} side, so it must start with "${prefix}"`);
    }
    text(BUDGET, [...path, "label"], node.label);
    text(BUDGET, [...path, "description"], node.description);
    for (const [id, breakdown] of Object.entries(node.breakdowns ?? {})) {
      checkBreakdown(id, breakdown, [...path, "breakdowns", id]);
    }

    let total = 0;
    if ("children" in node) {
      node.children.forEach((child, i) => {
        total += walk(child, side, [...path, "children", i], [...ancestors, node.id]);
      });
    } else {
      total = node.amount;
      let sum = 0;
      for (const level of Object.keys(node.levels) as LevelId[]) {
        sum += node.levels[level] ?? 0;
        if (country && !country.levels[level]) {
          error(BUDGET, [...path, "levels", level], `level "${level}" is not defined in country.json`);
        }
      }
      if (!sumsToOne(sum)) error(BUDGET, [...path, "levels"], `shares sum to ${round(sum)}, expected 1`);
      refs(BUDGET, [...path, "sources"], node.sources);
      text(BUDGET, [...path, "note"], node.note);
    }

    if (nodes.has(node.id)) error(BUDGET, [...path, "id"], `duplicate node id "${node.id}"`);
    else nodes.set(node.id, { node, isLeaf: !("children" in node), total, ancestors });
    return total;
  };

  if (budget) {
    budget.revenue.forEach((node, i) => walk(node, "revenue", ["revenue", i]));
    budget.expenditure.forEach((node, i) => walk(node, "expenditure", ["expenditure", i]));
  }

  // --- distributions/*.json ---------------------------------------------------------------------

  /** Distributions whose bins are in order, so that schedules can be integrated over them. */
  const sound = new Set<string>();
  for (const [name, distribution] of Object.entries(distributions)) {
    const file = distributionFile(name);
    const before = errors.length;
    if (distribution.id !== name) error(file, ["id"], `is "${distribution.id}" but the file is named "${name}.json"`);
    text(file, ["label"], distribution.label);
    text(file, ["variable"], distribution.variable);
    text(file, ["unit"], distribution.unit);
    text(file, ["note"], distribution.note);
    refs(file, ["sources"], distribution.sources);
    distribution.bins.forEach((bin, i) => {
      if (!(bin.from < bin.to)) {
        error(file, ["bins", i], `"from" (${bin.from}) must be below "to" (${bin.to})`);
      } else if (bin.mean < bin.from || bin.mean > bin.to) {
        error(file, ["bins", i, "mean"], `${bin.mean} lies outside the bin [${bin.from}, ${bin.to}]`);
      }
      const previous = distribution.bins[i - 1];
      if (previous && bin.from !== previous.to) {
        error(file, ["bins", i, "from"], `${bin.from} does not continue the previous bin, which ends at ${previous.to}`);
      }
    });
    const last = distribution.bins[distribution.bins.length - 1];
    if (distribution.tail && last && distribution.tail.from !== last.to) {
      error(file, ["tail", "from"], `${distribution.tail.from} must equal the end of the last bin, ${last.to}`);
    }
    if (!(totalUnits(distribution) > 0)) error(file, ["bins"], "the distribution contains no units");
    if (errors.length === before) sound.add(name);
  }

  // --- policies.json --------------------------------------------------------------------------

  const checkPolicy = (policy: Policy, base: Path): void => {
    text(POLICIES, [...base, "label"], policy.label);
    text(POLICIES, [...base, "summary"], policy.summary);
    refs(POLICIES, [...base, "sources"], policy.sources);

    const params = new Map<string, Param>();
    const usedParams = new Set<string>();
    const defaults: ParamValues = {};

    const checkCurveParam = (param: CurveParam, path: Path): void => {
      const { x, y } = param;
      if (x.min < 0) error(POLICIES, [...path, "x", "min"], `${x.min} is below 0`);
      if (!(x.min < x.max)) error(POLICIES, [...path, "x"], `min (${x.min}) must be below max (${x.max})`);
      if (!(y.min < y.max)) error(POLICIES, [...path, "y"], `min (${y.min}) must be below max (${y.max})`);
      const minPoints = param.minPoints ?? CURVE_MIN_POINTS;
      const maxPoints = param.maxPoints ?? CURVE_MAX_POINTS;
      if (minPoints > maxPoints) {
        error(POLICIES, [...path, "minPoints"], `minPoints (${minPoints}) is above maxPoints (${maxPoints})`);
      }

      const checkPoints = (points: readonly CurvePoint[], at: Path): void => {
        if (minPoints <= maxPoints && (points.length < minPoints || points.length > maxPoints)) {
          error(POLICIES, at, `${points.length} point(s), but the param allows ${minPoints} to ${maxPoints}`);
        }
        points.forEach((point, k) => {
          if (point.x < x.min || point.x > x.max) {
            error(POLICIES, [...at, k, "x"], `${point.x} lies outside [${x.min}, ${x.max}]`);
          }
          if (point.y < y.min || point.y > y.max) {
            error(POLICIES, [...at, k, "y"], `${point.y} lies outside [${y.min}, ${y.max}]`);
          }
          if (k > 0 && point.x < points[k - 1].x) {
            error(POLICIES, [...at, k, "x"], `points must be ordered by x, but ${point.x} follows ${points[k - 1].x}`);
          }
        });
      };

      checkPoints(param.default, [...path, "default"]);
      if (param.baseline) checkPoints(param.baseline, [...path, "baseline"]);
      const presetIds = new Set<string>();
      param.presets?.forEach((preset, k) => {
        const at = [...path, "presets", k];
        if (presetIds.has(preset.id)) error(POLICIES, [...at, "id"], `duplicate preset id "${preset.id}" in param "${param.id}"`);
        presetIds.add(preset.id);
        text(POLICIES, [...at, "label"], preset.label);
        text(POLICIES, [...at, "note"], preset.note);
        refs(POLICIES, [...at, "sources"], preset.sources);
        checkPoints(preset.points, [...at, "points"]);
      });
      param.examples?.forEach((example, k) => {
        const at = [...path, "examples", k];
        text(POLICIES, [...at, "label"], example.label);
        if (example.x < x.min || example.x > x.max) {
          error(POLICIES, [...at, "x"], `${example.x} lies outside [${x.min}, ${x.max}]`);
        }
      });
    };

    policy.params.forEach((param, i) => {
      const path = [...base, "params", i];
      if (params.has(param.id)) error(POLICIES, [...path, "id"], `duplicate param id "${param.id}" in policy "${policy.id}"`);
      else params.set(param.id, param);
      text(POLICIES, [...path, "label"], param.label);

      if (param.type === "number") {
        text(POLICIES, [...path, "unitLabel"], param.unitLabel);
        text(POLICIES, [...path, "baselineLabel"], param.baselineLabel);
        if (param.baselineLabel !== undefined && param.baseline === undefined) {
          warn(POLICIES, [...path, "baselineLabel"], `param "${param.id}" names its baseline but has none; drop "baselineLabel" or add "baseline"`);
        }
        if (param.role === "assumption" && param.baseline !== undefined) {
          warn(POLICIES, [...path, "baseline"], `param "${param.id}" is an assumption, which has no base-year value; drop "baseline" or "role"`);
        }
        if (param.min > param.max) {
          error(POLICIES, path, `min (${param.min}) is above max (${param.max})`);
        } else if (param.default < param.min || param.default > param.max) {
          error(POLICIES, [...path, "default"], `${param.default} lies outside [${param.min}, ${param.max}]`);
        }
        defaults[param.id] = Math.min(param.max, Math.max(param.min, param.default));
        return;
      }

      if (param.type === "curve") {
        checkCurveParam(param, path);
        defaults[param.id] = param.default;
        return;
      }

      defaults[param.id] = param.default;
      if (!budget) return;
      const node = nodes.get(param.node);
      if (!node) {
        error(POLICIES, [...path, "node"], `unknown budget node "${param.node}"`);
        return;
      }
      const breakdown = own(node.node.breakdowns, param.breakdown);
      if (!breakdown) {
        error(POLICIES, [...path, "breakdown"], `node "${param.node}" has no breakdown "${param.breakdown}"`);
        return;
      }
      param.default.forEach((group, k) => {
        if (!breakdown.groups.some((candidate) => candidate.id === group)) {
          error(POLICIES, [...path, "default", k], `unknown group "${group}" in breakdown "${param.breakdown}" of "${param.node}"`);
        } else if (param.default.indexOf(group) !== k) {
          error(POLICIES, [...path, "default", k], `duplicate group "${group}"`);
        }
      });
    });

    /** Returns whether the value can be evaluated. */
    const checkValue = (value: Value | undefined, path: Path): boolean => {
      if (value === undefined || typeof value === "number") return true;
      let ok = true;
      usedParams.add(value.param);
      const param = params.get(value.param);
      if (!param) {
        error(POLICIES, [...path, "param"], `unknown param "${value.param}" in policy "${policy.id}"`);
        ok = false;
      } else if (param.type !== "number") {
        error(POLICIES, [...path, "param"], `param "${value.param}" is a ${param.type} param; a number param is needed here`);
        ok = false;
      } else if ((param.unit === "percent" || param.unit === "percent_gdp") && value.scale === undefined) {
        // 1 % would be read as 1, that is as 100 %. The range check on rates cannot see that.
        warn(POLICIES, path, `param "${value.param}" is in ${param.unit} but is used without "scale"; to get a fraction it needs "scale": 0.01`);
      }
      if (value.times === "households" && country && !country.indicators.households) {
        error(POLICIES, [...path, "times"], 'country.json has no "households" indicator');
        ok = false;
      }
      return ok;
    };

    /** The value at default parameter values; undefined if that needs an indicator and country.json is not readable. */
    const atDefaults = (value: Value): number | undefined => {
      if (typeof value === "number") return value;
      return country ? evaluateValue(value, defaults, country.indicators) : undefined;
    };

    const checkShift = (effect: Effect, path: Path): void => {
      const shift = effect.shift;
      if (!shift) return;
      text(POLICIES, [...path, "label"], shift.label);
      text(POLICIES, [...path, "note"], shift.note);
      refs(POLICIES, [...path, "sources"], shift.sources);
      if (checkValue(shift.ratio, [...path, "ratio"])) {
        const ratio = atDefaults(shift.ratio);
        if (ratio !== undefined && !(Number.isFinite(ratio) && ratio >= 0)) {
          error(POLICIES, [...path, "ratio"], `${ratio} at default parameter values is not a finite number >= 0`);
        }
      }
      if (!budget) return;
      const to = nodes.get(shift.to);
      if (!to) {
        error(POLICIES, [...path, "to"], `unknown budget node "${shift.to}"`);
        return;
      }
      if (shift.to === effect.target) {
        error(POLICIES, [...path, "to"], `"${shift.to}" is the effect's own target; a shift needs another node`);
      } else if (to.ancestors.includes(effect.target)) {
        error(POLICIES, [...path, "to"], `"${shift.to}" lies inside the effect's target "${effect.target}"`);
      } else if (nodes.get(effect.target)?.ancestors.includes(shift.to)) {
        error(POLICIES, [...path, "to"], `"${shift.to}" contains the effect's target "${effect.target}"`);
      }
      if (!to.isLeaf && to.total === 0) {
        error(
          POLICIES,
          [...path, "to"],
          `shift to group "${shift.to}", whose leaves are all zero: there are no proportions to distribute the amount by`,
        );
      }
    };

    const checkEffect = (effect: Effect, path: Path): void => {
      text(POLICIES, [...path, "note"], effect.note);
      refs(POLICIES, [...path, "sources"], effect.sources);
      const target = nodes.get(effect.target);
      if (budget && !target) error(POLICIES, [...path, "target"], `unknown budget node "${effect.target}"`);
      checkShift(effect, [...path, "shift"]);

      switch (effect.type) {
        case "scale":
          checkValue(effect.factor, [...path, "factor"]);
          break;

        case "add":
        case "set":
          checkValue(effect.amount, [...path, "amount"]);
          if (target && !target.isLeaf && target.total === 0) {
            error(
              POLICIES,
              [...path, "target"],
              `"${effect.type}" on group "${effect.target}", whose leaves are all zero: there are no proportions to distribute the amount by`,
            );
          }
          break;

        case "excludeGroups": {
          if (checkValue(effect.retained, [...path, "retained"]) && effect.retained !== undefined) {
            const retained = atDefaults(effect.retained);
            if (retained !== undefined && !isFraction(retained)) {
              error(POLICIES, [...path, "retained"], `${retained} at default parameter values is not a share between 0 and 1`);
            }
          }
          const breakdown = target ? own(target.node.breakdowns, effect.breakdown) : undefined;
          if (target && !breakdown) {
            error(POLICIES, [...path, "breakdown"], `node "${effect.target}" has no breakdown "${effect.breakdown}"`);
          }
          const known = breakdown ? new Set(breakdown.groups.map((group) => group.id)) : undefined;
          if (Array.isArray(effect.groups)) {
            effect.groups.forEach((group, k) => {
              if (known && !known.has(group)) {
                error(POLICIES, [...path, "groups", k], `unknown group "${group}" in breakdown "${effect.breakdown}" of "${effect.target}"`);
              }
            });
            break;
          }
          const paramId = effect.groups.param;
          usedParams.add(paramId);
          const param = params.get(paramId);
          if (!param) {
            error(POLICIES, [...path, "groups", "param"], `unknown param "${paramId}" in policy "${policy.id}"`);
          } else if (param.type !== "groups") {
            error(POLICIES, [...path, "groups", "param"], `param "${paramId}" is a ${param.type} param; a groups param is needed here`);
          } else if (known) {
            // The param offers the groups of its own breakdown. The effect reads the shares from the
            // breakdown on its target, so the ids have to exist there as well.
            const offered = own(nodes.get(param.node)?.node.breakdowns, param.breakdown)?.groups ?? [];
            const missing = offered.filter((group) => !known.has(group.id)).map((group) => group.id);
            if (offered.length > 0 && missing.length === offered.length) {
              error(
                POLICIES,
                [...path, "groups", "param"],
                `none of the groups offered by param "${paramId}" exist in breakdown "${effect.breakdown}" of "${effect.target}"`,
              );
            } else if (missing.length > 0) {
              warn(
                POLICIES,
                [...path, "groups", "param"],
                `group(s) ${missing.join(", ")} offered by param "${paramId}" do not exist in breakdown "${effect.breakdown}" of "${effect.target}"; selecting them has no effect on this node`,
              );
            }
          }
          break;
        }

        case "schedule": {
          // Only a distribution that passed its own checks is integrated over.
          const distribution = sound.has(effect.distribution) ? own(distributions, effect.distribution) : undefined;
          if (!distributionNames.has(effect.distribution)) {
            error(POLICIES, [...path, "distribution"], `unknown distribution "${effect.distribution}"`);
          }
          let evaluable = checkValue(effect.yield, [...path, "yield"]);
          const reform = effect.reform;
          /** The curve param the reform is taken from, if it is one. */
          let curveParam: CurveParam | undefined;
          if ("curve" in reform) {
            // The reform is the value of a curve param of this policy.
            const at = [...path, "reform", "curve"];
            const paramId = reform.curve.param;
            usedParams.add(paramId);
            const param = params.get(paramId);
            if (!param) {
              error(POLICIES, [...at, "param"], `unknown param "${paramId}" in policy "${policy.id}"`);
            } else if (param.type !== "curve") {
              error(POLICIES, [...at, "param"], `param "${paramId}" is a ${param.type} param; a curve param is needed here`);
            } else {
              const scale = reform.curve.scale ?? 1;
              if (reform.curve.scale === undefined) {
                warn(POLICIES, at, `the curve of param "${paramId}" is in percent but is used without "scale"; to get a fraction it needs "scale": 0.01`);
              }
              const offending = param.default.findIndex((point) => !isFraction(point.y * scale));
              if (offending >= 0) {
                error(
                  POLICIES,
                  at,
                  `point ${offending} of the default curve gives a rate of ${round(param.default[offending].y * scale)}, which is not between 0 and 1 (a percent curve needs "scale": 0.01)`,
                );
              } else {
                // Its rates make sense, so it can be compared with the baseline below.
                curveParam = param;
              }
            }
          } else {
            reform.brackets.forEach((bracket, k) => {
              const at = [...path, "reform", "brackets", k];
              evaluable = checkValue(bracket.from, [...at, "from"]) && evaluable;
              evaluable = checkValue(bracket.rate, [...at, "rate"]) && evaluable;
            });
            if (evaluable && country) {
              const brackets = evaluateBrackets(effect, defaults, country.indicators);
              for (let k = 0; k < brackets.length; k++) {
                if (k > 0 && !(brackets[k].from > brackets[k - 1].from)) {
                  error(
                    POLICIES,
                    [...path, "reform", "brackets", k, "from"],
                    `thresholds must be ascending at default parameter values, but ${brackets[k].from} follows ${brackets[k - 1].from}`,
                  );
                }
                if (!isFraction(brackets[k].rate)) {
                  error(
                    POLICIES,
                    [...path, "reform", "brackets", k, "rate"],
                    `${brackets[k].rate} at default parameter values is not a rate between 0 and 1 (a percent param needs "scale": 0.01)`,
                  );
                }
              }
            }
          }
          if (effect.baseline) {
            const baseline = effect.baseline;
            let usable = true;
            let model = 0;
            if ("points" in baseline) {
              const scale = baseline.scale ?? 1;
              baseline.points.forEach((point, k) => {
                const at = [...path, "baseline", "points", k];
                if (point.x < 0) {
                  usable = false;
                  error(POLICIES, [...at, "x"], `${point.x} is below 0`);
                }
                if (k > 0 && point.x < baseline.points[k - 1].x) {
                  usable = false;
                  error(POLICIES, [...at, "x"], `points must be ordered by x, but ${point.x} follows ${baseline.points[k - 1].x}`);
                }
                if (!isFraction(point.y * scale)) {
                  error(
                    POLICIES,
                    [...at, "y"],
                    `${point.y} gives a rate of ${round(point.y * scale)}, which is not between 0 and 1 (percent needs "scale": 0.01)`,
                  );
                }
              });
              if (distribution && usable) model = curveTotal(distribution, baseline);
            } else {
              const brackets = baseline.brackets;
              for (let k = 1; k < brackets.length; k++) {
                if (!(brackets[k].from > brackets[k - 1].from)) {
                  usable = false;
                  error(
                    POLICIES,
                    [...path, "baseline", "brackets", k, "from"],
                    `thresholds must be ascending, but ${brackets[k].from} follows ${brackets[k - 1].from}`,
                  );
                }
              }
              if (distribution && usable) model = scheduleTotal(distribution, brackets);
            }
            if (distribution && usable && !(model > 0)) {
              error(
                POLICIES,
                [...path, "baseline"],
                `the baseline schedule yields nothing on distribution "${effect.distribution}", so the effect cannot be calibrated`,
              );
            }
            // The param's own baseline is only shown, the effect's baseline is what the reform is
            // measured against. Where both exist they should be the same curve.
            const shown = curveParam?.baseline;
            if (curveParam && shown && usable && "curve" in reform && shown.every((point, k) => k === 0 || point.x >= shown[k - 1].x)) {
              const calibration = "points" in baseline ? baseline : bracketsToCurve(baseline.brackets);
              const differs = curveAffected(distribution ?? ONE_UNIT, { points: shown, scale: reform.curve.scale }, calibration).threshold;
              if (differs !== null) {
                warn(
                  POLICIES,
                  [...base, "params", policy.params.indexOf(curveParam), "baseline"],
                  `the baseline of param "${curveParam.id}" differs from the calibration baseline of effect ${policy.effects.indexOf(effect)} (from ${round(differs)} on); today's curve is the effect's baseline, so the param's copy shows something else`,
                );
              }
            }
            if (target && target.total === 0) {
              warn(POLICIES, [...path, "target"], `calibrated schedule on "${effect.target}", whose base amount is zero: the effect will always be zero`);
            }
          }
          break;
        }
      }
    };

    policy.effects.forEach((effect, i) => checkEffect(effect, [...base, "effects", i]));

    // Effects that share an uncertainty basis vary with one multiplier, so they must state the same one.
    const bases = new Map<string, number[]>();
    policy.effects.forEach((effect, i) => {
      const basis = effect.uncertainty?.basis;
      if (basis !== undefined) bases.set(basis, [...(bases.get(basis) ?? []), i]);
    });
    for (const [basis, members] of bases) {
      const first = policy.effects[members[0]].uncertainty!;
      for (const i of members.slice(1)) {
        const other = policy.effects[i].uncertainty!;
        if (other.low !== first.low || other.high !== first.high) {
          error(
            POLICIES,
            [...base, "effects", i, "uncertainty"],
            `effects with uncertainty basis "${basis}" must have the same low and high; effect ${members[0]} has ${first.low} and ${first.high}`,
          );
        }
      }
      if (members.length === 1 && !policy.effects[members[0]].shift) {
        warn(
          POLICIES,
          [...base, "effects", members[0], "uncertainty", "basis"],
          `basis "${basis}" ties nothing together: no other effect of policy "${policy.id}" has it, and the effect has no shift`,
        );
      }
    }
    policy.catches.forEach((item, i) => {
      text(POLICIES, [...base, "catches", i, "text"], item.text);
      refs(POLICIES, [...base, "catches", i, "sources"], item.sources);
    });
    policy.params.forEach((param, i) => {
      if (!usedParams.has(param.id)) warn(POLICIES, [...base, "params", i], `param "${param.id}" is not used by any effect`);
    });

    // Timing: a param it depends on is a number param with a baseline; only then can it scale or choose.
    const timing = policy.timing;
    if (timing) {
      const at = [...base, "timing"];
      text(POLICIES, [...at, "note"], timing.note);
      refs(POLICIES, [...at, "sources"], timing.sources);
      if (timing.param !== undefined) {
        const param = params.get(timing.param);
        if (!param) error(POLICIES, [...at, "param"], `unknown param "${timing.param}" in policy "${policy.id}"`);
        else if (param.type !== "number") error(POLICIES, [...at, "param"], `param "${timing.param}" is a ${param.type} param; timing needs a number param`);
        else if (param.baseline === undefined) {
          error(POLICIES, [...at, "param"], `param "${timing.param}" has no baseline, which timing measures the distance and direction from`);
        }
      } else {
        if (timing.yearsPerUnit !== undefined) error(POLICIES, [...at, "yearsPerUnit"], '"yearsPerUnit" needs "param": the distance of which param?');
        if (timing.below !== undefined) error(POLICIES, [...at, "below"], '"below" needs "param": below the baseline of which param?');
      }
      if (timing.below?.yearsPerUnit !== undefined && timing.param === undefined) {
        error(POLICIES, [...at, "below", "yearsPerUnit"], '"yearsPerUnit" needs "param": the distance of which param?');
      }
      const phases = [timing, ...(timing.below ? [timing.below] : [])];
      if (!timing.below && phases.every((phase) => phase.from === undefined && !phase.years && !phase.yearsPerUnit)) {
        warn(POLICIES, at, "the timing has no start date and no build-up, so the measure acts in full from the first year measures can act, as without timing");
      }
      if (country) {
        for (const [phase, path] of [[timing, at], [timing.below, [...at, "below"]]] as const) {
          if (phase?.from !== undefined && Number(phase.from.slice(0, 4)) <= country.baseYear) {
            warn(POLICIES, [...path, "from"], `${phase.from} lies in the base year ${country.baseYear} or before it; measures act in the projection only after the base year`);
          }
        }
      }
    }
  };

  if (policiesFile) {
    const seen = new Set<string>();
    policiesFile.policies.forEach((policy, i) => {
      if (seen.has(policy.id)) error(POLICIES, ["policies", i, "id"], `duplicate policy id "${policy.id}"`);
      seen.add(policy.id);
      checkPolicy(policy, ["policies", i]);
    });

    // Collections: unique ids, and each lists existing policies, each once.
    const collectionIds = new Set<string>();
    policiesFile.collections?.forEach((collection, i) => {
      const path = ["collections", i];
      if (collectionIds.has(collection.id)) error(POLICIES, [...path, "id"], `duplicate collection id "${collection.id}"`);
      collectionIds.add(collection.id);
      text(POLICIES, [...path, "label"], collection.label);
      text(POLICIES, [...path, "description"], collection.description);
      refs(POLICIES, [...path, "sources"], collection.sources);
      collection.policies.forEach((id, k) => {
        if (collection.policies.indexOf(id) !== k) {
          error(POLICIES, [...path, "policies", k], `policy "${id}" is listed twice in collection "${collection.id}"`);
        } else if (!seen.has(id)) {
          error(POLICIES, [...path, "policies", k], `unknown policy "${id}"`);
        }
      });
    });
  }

  // --- debt.json ------------------------------------------------------------------------------

  if (debt) {
    for (const key of ["stock", "interest", "refinancing"] as const) {
      text(DEBT, [key, "note"], debt[key].note);
      refs(DEBT, [key, "sources"], debt[key].sources);
    }
    text(DEBT, ["note"], debt.note);
    if (debt.measuresFrom) {
      text(DEBT, ["measuresFrom", "note"], debt.measuresFrom.note);
      refs(DEBT, ["measuresFrom", "sources"], debt.measuresFrom.sources);
      if (country && !(debt.measuresFrom.year > country.baseYear)) {
        error(DEBT, ["measuresFrom", "year"], `${debt.measuresFrom.year} is not after the base year ${country.baseYear}; the projection's first year is ${country.baseYear + 1}`);
      }
    }

    const grossDebt = country?.indicators.grossDebt;
    if (grossDebt && !near(grossDebt.value, debt.stock.value, 0.001)) {
      warn(DEBT, ["stock", "value"], `${debt.stock.value} differs from the grossDebt indicator in country.json (${grossDebt.value})`);
    }

    const interestNode = debt.interest.node;
    if (interestNode !== undefined && budget) {
      const info = nodes.get(interestNode);
      if (!info) {
        error(DEBT, ["interest", "node"], `unknown budget node "${interestNode}"`);
      } else if (!interestNode.startsWith("exp.")) {
        error(DEBT, ["interest", "node"], `"${interestNode}" is a revenue node; interest is spending, an "exp." node`);
      } else if (info.total === 0) {
        warn(DEBT, ["interest", "node"], `"${interestNode}" is zero in the base year, so the projection starts with an average interest rate of 0`);
      } else if (!near(info.total, debt.interest.value, 0.1)) {
        warn(
          DEBT,
          ["interest", "node"],
          `the base amount of "${interestNode}" (${info.total}) differs from interest.value (${debt.interest.value}) by more than 10 %; the projection uses the node`,
        );
      }
    }

    const assumptions = new Map<DebtAssumptionId, DebtAssumptionParam>();
    debt.assumptions.forEach((param, i) => {
      const path = ["assumptions", i];
      if (assumptions.has(param.id)) {
        error(DEBT, [...path, "id"], `duplicate assumption "${param.id}"`);
        return;
      }
      assumptions.set(param.id, param);
      text(DEBT, [...path, "label"], param.label);
      text(DEBT, [...path, "unitLabel"], param.unitLabel);
      text(DEBT, [...path, "note"], param.note);
      refs(DEBT, [...path, "sources"], param.sources);
      const unit = DEBT_ASSUMPTION_UNITS[param.id];
      if (param.unit !== unit) error(DEBT, [...path, "unit"], `"${param.id}" is in ${unit}, not ${param.unit}`);
      if (param.min > param.max) {
        error(DEBT, path, `min (${param.min}) is above max (${param.max})`);
      } else if (param.default < param.min || param.default > param.max) {
        error(DEBT, [...path, "default"], `${param.default} lies outside [${param.min}, ${param.max}]`);
      }
      if (param.id === "horizon") {
        for (const key of ["min", "max", "step", "default"] as const) {
          if (!Number.isInteger(param[key])) error(DEBT, [...path, key], `${param[key]} is not a whole number of years`);
        }
        if (param.min < 1) error(DEBT, [...path, "min"], `${param.min} is below 1: the projection needs at least one year`);
      } else if ((param.id === "market_rate" || param.id === "growth") && !(param.min > -100)) {
        error(DEBT, [...path, "min"], `${param.min} % is not above -100 %`);
      }
    });
    for (const id of DEBT_ASSUMPTION_IDS) {
      if (!assumptions.has(id)) error(DEBT, ["assumptions"], `assumption "${id}" is missing`);
    }

    const presetIds = new Set<string>();
    debt.presets.forEach((preset, i) => {
      const path = ["presets", i];
      if (presetIds.has(preset.id)) error(DEBT, [...path, "id"], `duplicate preset id "${preset.id}"`);
      presetIds.add(preset.id);
      text(DEBT, [...path, "label"], preset.label);
      text(DEBT, [...path, "note"], preset.note);
      refs(DEBT, [...path, "sources"], preset.sources);
      for (const id of DEBT_ASSUMPTION_IDS) {
        const value = preset.values[id];
        const param = assumptions.get(id);
        // A param whose range is itself broken has already been reported.
        if (value === undefined || !param || param.min > param.max) continue;
        if (value < param.min || value > param.max) {
          error(DEBT, [...path, "values", id], `${value} lies outside [${param.min}, ${param.max}]`);
        } else if (id === "horizon" && !Number.isInteger(value)) {
          error(DEBT, [...path, "values", id], `${value} is not a whole number of years`);
        }
      }
    });

    // The starting path: a plan the projection follows unless the visitor chooses the base year.
    if (debt.follow !== undefined) {
      const plan = debt.plans?.find((candidate) => candidate.id === debt.follow);
      const at = ["follow"];
      if (!plan) {
        error(DEBT, at, `unknown plan "${debt.follow}"`);
      } else if (!isComparablePlan(plan)) {
        error(
          DEBT,
          at,
          `plan "${plan.id}" is for ${plan.scope === "all" ? "the whole state" : `level "${plan.scope}"`} in ${plan.accounts} accounts; only a plan for the whole state in national_accounts can be followed`,
        );
      } else if (!isFollowablePlan(plan)) {
        error(DEBT, at, `plan "${plan.id}" cannot be followed: it needs a "debtRatio" in every point, one point for every year without gaps, and a "balanceRatio" in its last point`);
      } else if (country && !plan.points.some((point) => point.year > country.baseYear)) {
        warn(DEBT, at, `plan "${plan.id}" has no year after the base year ${country.baseYear}, so following it changes nothing`);
      }
    }

    const referenceIds = new Set<string>();
    debt.references.forEach((reference, i) => {
      const path = ["references", i];
      if (referenceIds.has(reference.id)) error(DEBT, [...path, "id"], `duplicate reference id "${reference.id}"`);
      referenceIds.add(reference.id);
      text(DEBT, [...path, "label"], reference.label);
      text(DEBT, [...path, "note"], reference.note);
      refs(DEBT, [...path, "sources"], reference.sources);
      if (reference.debtRatio === undefined && reference.interestRatio === undefined) {
        error(DEBT, path, 'a reference needs "debtRatio", "interestRatio" or both');
      }
      if (reference.kind !== "threshold" && reference.year === undefined) {
        error(DEBT, path, `a reference of kind "${reference.kind}" needs a "year"`);
      }
      // Ratios are fractions. A debt of 500 % of GDP or interest of 20 % of GDP is more likely a percentage typed as is.
      if (reference.debtRatio !== undefined && reference.debtRatio > 5) {
        warn(DEBT, [...path, "debtRatio"], `${reference.debtRatio} means ${round(reference.debtRatio * 100)} % of GDP; ratios are fractions (1.2 is 120 %)`);
      }
      if (reference.interestRatio !== undefined && reference.interestRatio > 0.2) {
        warn(DEBT, [...path, "interestRatio"], `${reference.interestRatio} means ${round(reference.interestRatio * 100)} % of GDP; ratios are fractions (0.03 is 3 %)`);
      }
      // Revenue is only there to turn interest into a share of revenue. (Without any ratio the error above says enough.)
      if (reference.revenueRatio !== undefined && reference.interestRatio === undefined && reference.debtRatio !== undefined) {
        error(DEBT, [...path, "revenueRatio"], '"revenueRatio" needs "interestRatio": it only serves to show interest as a share of revenue');
      }
      if (reference.revenueRatio !== undefined && reference.revenueRatio > 1) {
        warn(DEBT, [...path, "revenueRatio"], `${reference.revenueRatio} means ${round(reference.revenueRatio * 100)} % of GDP; ratios are fractions (0.45 is 45 %)`);
      }
    });

    // Budget items the interest bill is compared with: spending items that exist, each once, not interest itself.
    const compared = new Set<string>();
    (debt.comparisons ?? []).forEach((comparison, i) => {
      const path = ["comparisons", i];
      text(DEBT, [...path, "label"], comparison.label);
      if (compared.has(comparison.node)) error(DEBT, [...path, "node"], `"${comparison.node}" is compared twice`);
      compared.add(comparison.node);
      if (!budget) return;
      const info = nodes.get(comparison.node);
      if (!info) error(DEBT, [...path, "node"], `unknown budget node "${comparison.node}"`);
      else if (!comparison.node.startsWith("exp.")) error(DEBT, [...path, "node"], `"${comparison.node}" is a revenue node; interest is compared with spending, an "exp." node`);
      else if (comparison.node === debt.interest.node) error(DEBT, [...path, "node"], `"${comparison.node}" is the interest node itself`);
      else if (info.total === 0) warn(DEBT, [...path, "node"], `"${comparison.node}" is zero in the base year, so interest is above it from the start`);
    });

    // Official projections: unique ids, a scope that exists, years in order, a value in every point.
    const planIds = new Set<string>();
    (debt.plans ?? []).forEach((plan, i) => {
      const path = ["plans", i];
      if (planIds.has(plan.id)) error(DEBT, [...path, "id"], `duplicate plan id "${plan.id}"`);
      planIds.add(plan.id);
      text(DEBT, [...path, "label"], plan.label);
      text(DEBT, [...path, "note"], plan.note);
      refs(DEBT, [...path, "sources"], plan.sources);
      if (plan.scope !== "all" && country && !country.levels[plan.scope]) {
        error(DEBT, [...path, "scope"], `level "${plan.scope}" is not defined in country.json`);
      }
      plan.points.forEach((point, k) => {
        const at = [...path, "points", k];
        const previous = plan.points[k - 1];
        if (previous && !(point.year > previous.year)) {
          error(DEBT, [...at, "year"], `years must be ascending, each once, but ${point.year} follows ${previous.year}`);
        }
        const { debtRatio, balanceRatio, interestRatio, interestToRevenue, interest } = point;
        if ([debtRatio, balanceRatio, interestRatio, interestToRevenue, interest].every((value) => value === undefined)) {
          error(DEBT, at, 'a point needs at least one of "debtRatio", "balanceRatio", "interestRatio", "interestToRevenue" and "interest"');
        }
        // Ratios are fractions; a value far beyond any real one is more likely a percentage typed as is.
        if (debtRatio !== undefined && debtRatio > 5) {
          warn(DEBT, [...at, "debtRatio"], `${debtRatio} means ${round(debtRatio * 100)} % of GDP; ratios are fractions (1.2 is 120 %)`);
        }
        if (balanceRatio !== undefined && Math.abs(balanceRatio) > 0.5) {
          warn(DEBT, [...at, "balanceRatio"], `${balanceRatio} means ${round(balanceRatio * 100)} % of GDP; ratios are fractions (-0.03 is -3 %)`);
        }
        if (interestRatio !== undefined && interestRatio > 0.2) {
          warn(DEBT, [...at, "interestRatio"], `${interestRatio} means ${round(interestRatio * 100)} % of GDP; ratios are fractions (0.03 is 3 %)`);
        }
        if (interestToRevenue !== undefined && interestToRevenue > 1) {
          warn(DEBT, [...at, "interestToRevenue"], `${interestToRevenue} means ${round(interestToRevenue * 100)} % of revenue; ratios are fractions (0.05 is 5 %)`);
        }
        if (point.growth !== undefined && Math.abs(point.growth) > 0.5) {
          warn(DEBT, [...at, "growth"], `${point.growth} means ${round(point.growth * 100)} % growth; growth is a fraction (0.03 is 3 %)`);
        }
      });
    });
  }

  // --- goals.json -----------------------------------------------------------------------------

  if (goals) {
    const goalIds = new Set<string>();
    goals.goals.forEach((goal, i) => {
      const path = ["goals", i];
      if (goalIds.has(goal.id)) error(GOALS, [...path, "id"], `duplicate goal id "${goal.id}"`);
      goalIds.add(goal.id);
      text(GOALS, [...path, "label"], goal.label);
      text(GOALS, [...path, "description"], goal.description);
      text(GOALS, [...path, "note"], goal.note);
      refs(GOALS, [...path, "sources"], goal.sources);
      if (goal.level !== undefined && country && !country.levels[goal.level]) {
        error(GOALS, [...path, "level"], `level "${goal.level}" is not defined in country.json`);
      }
      if (country && goal.year < country.baseYear) {
        warn(GOALS, [...path, "year"], `${goal.year} lies before the base year ${country.baseYear}`);
      }

      // Excluded measures exist and are listed once. Excluded nodes exist, are listed once, none lies
      // inside another, and no effect of a measure that is not excluded itself changes a group above one.
      const entries = goal.excluded ?? [];
      const excludedPolicies = new Set(entries.flatMap((entry) => (entry.policy === undefined ? [] : [entry.policy])));
      const listed = new Set(entries.flatMap((entry) => (entry.node === undefined ? [] : [entry.node])));
      const seenNodes = new Set<string>();
      const seenPolicies = new Set<string>();
      entries.forEach((exclusion, k) => {
        const at = [...path, "excluded", k];
        text(GOALS, [...at, "reason"], exclusion.reason);
        refs(GOALS, [...at, "sources"], exclusion.sources);
        const policyId = exclusion.policy;
        if (policyId !== undefined) {
          if (seenPolicies.has(policyId)) error(GOALS, [...at, "policy"], `policy "${policyId}" is excluded twice`);
          else if (policiesFile && !policiesFile.policies.some((policy) => policy.id === policyId)) {
            error(GOALS, [...at, "policy"], `unknown policy "${policyId}"`);
          }
          seenPolicies.add(policyId);
          return;
        }
        const node = exclusion.node;
        if (node === undefined) return; // the schema has reported it
        if (seenNodes.has(node)) {
          error(GOALS, [...at, "node"], `"${node}" is excluded twice`);
          return;
        }
        seenNodes.add(node);
        if (!budget) return;
        const info = nodes.get(node);
        if (!info) {
          error(GOALS, [...at, "node"], `unknown budget node "${node}"`);
          return;
        }
        const outer = info.ancestors.find((id) => listed.has(id));
        if (outer !== undefined) error(GOALS, [...at, "node"], `"${node}" lies inside "${outer}", which is excluded already`);
        policiesFile?.policies.forEach((policy) => {
          // An excluded measure is left out as a whole, so where its effects land does not matter.
          if (excludedPolicies.has(policy.id)) return;
          policy.effects.forEach((effect, e) => {
            for (const target of [effect.target, effect.shift?.to]) {
              if (target === undefined || !info.ancestors.includes(target)) continue;
              error(
                GOALS,
                [...at, "node"],
                `"${node}" lies inside "${target}", which ${target === effect.target ? "" : "the shift of "}effect ${e} of policy "${policy.id}" changes as a whole; the part that falls on "${node}" cannot be told apart, so exclude "${target}", a node that no effect reaches into, or the policy`,
              );
            }
          });
        });
      });
    });
    if (!goalIds.has(goals.default)) error(GOALS, ["default"], `unknown goal "${goals.default}"`);
  }

  // --- result ---------------------------------------------------------------------------------

  const complete =
    country &&
    budget &&
    policiesFile &&
    sources &&
    Object.keys(distributions).length === distributionNames.size &&
    (files.debt === undefined || debt !== undefined) &&
    (files.goals === undefined || goals !== undefined);
  if (sources && complete) {
    for (const id of Object.keys(sources)) {
      if (!usedSources.has(id)) warn(SOURCES, [id], `source "${id}" is never referenced`);
    }
  }

  if (errors.length > 0 || !complete) return { ok: false, errors: sortByFile(errors), warnings: sortByFile(warnings) };
  const pack: CountryPack = { country, budget, policies: policiesFile.policies, sources, distributions };
  if (policiesFile.collections) pack.collections = policiesFile.collections;
  if (debt) pack.debt = debt;
  if (goals) pack.goals = goals;
  for (const issue of nonZeroAtBaseline(pack, warnings)) warnings.push(issue);
  return { ok: true, pack, warnings: sortByFile(warnings) };
}

/**
 * Measures that change the budget although every number param that has a base-year value is set
 * to it. `baseline` is the law of the base year, so there the measure must do nothing; a remainder
 * means a rounded constant, a wrong offset or an effect that does not depend on the params. Curve
 * params go to their own baseline, if they have one; all other params keep their default. Not
 * checked: a measure without a number param that has a baseline (a curve's baseline is compared
 * with its effect's calibration baseline elsewhere), and a measure that already has a warning, so
 * that one problem gives one message.
 */
function nonZeroAtBaseline(pack: CountryPack, earlier: readonly ValidationIssue[]): ValidationIssue[] {
  const base = simulate(pack).baseline;
  const noise = Math.max(Math.abs(base.revenue), Math.abs(base.expenditure), 1) * 1e-9;
  const issues: ValidationIssue[] = [];
  pack.policies.forEach((policy, i) => {
    const at = formatPath(["policies", i]);
    const warned = earlier.some((issue) => issue.file === POLICIES && (issue.path === at || issue.path.startsWith(`${at}.`)));
    if (warned || !policy.params.some((param) => param.type === "number" && param.baseline !== undefined)) return;
    const params: ParamValues = {};
    for (const param of policy.params) {
      if ((param.type === "number" || param.type === "curve") && param.baseline !== undefined) params[param.id] = param.baseline;
    }
    const result = simulatePolicy(pack, policy.id, params);
    const balance = result?.delta.balance ?? 0;
    if (Math.abs(balance) > noise || Math.abs(result?.delta.revenue ?? 0) > noise || Math.abs(result?.delta.expenditure ?? 0) > noise) {
      issues.push({
        file: POLICIES,
        path: at,
        message: `with its params at their base-year values ("baseline") policy "${policy.id}" still changes the balance by ${round(balance)} (revenue ${round(result?.delta.revenue ?? 0)}, expenditure ${round(result?.delta.expenditure ?? 0)}); at the base year it should change nothing`,
      });
    }
  });
  return issues;
}

/** Group issues by file, in the order a reader would open the files; order within a file is kept. */
function sortByFile(issues: ValidationIssue[]): ValidationIssue[] {
  const rank = (file: string): number => {
    const i = [COUNTRY, BUDGET, POLICIES, SOURCES].indexOf(file);
    return i >= 0 ? i : 4;
  };
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => rank(a.issue.file) - rank(b.issue.file) || a.issue.file.localeCompare(b.issue.file) || a.i - b.i)
    .map((entry) => entry.issue);
}
