/**
 * Validation of a country pack: the zod shape of every file, then everything that needs more than
 * one value to judge (references between files, sums of shares, locales, bins, brackets).
 *
 * Every problem is reported with the file and the JSON path it was found at. Cross-file checks
 * are skipped for a file that already failed its shape check, so one typo does not bury the
 * report under follow-up errors.
 */
import type { z } from "zod";
import { scheduleTotal, totalUnits } from "./distribution.ts";
import {
  budgetSchema,
  countrySchema,
  distributionSchema,
  policiesFileSchema,
  sourcesFileSchema,
} from "./schema.ts";
import { evaluateBrackets, evaluateValue, type ParamValues } from "./simulate.ts";
import type {
  Breakdown,
  BudgetNode,
  CountryPack,
  Distribution,
  Effect,
  LevelId,
  LocalizedText,
  Param,
  Policy,
  SourceId,
  Value,
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

const COUNTRY = "country.json";
const BUDGET = "budget.json";
const POLICIES = "policies.json";
const SOURCES = "sources.json";
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
  const slots: Record<string, "country" | "budget" | "policies" | "sources"> = {
    [COUNTRY]: "country",
    [BUDGET]: "budget",
    [POLICIES]: "policies",
    [SOURCES]: "sources",
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

interface RawIssue {
  code?: string;
  path: PropertyKey[];
  message: string;
  expected?: string;
  errors?: RawIssue[][];
}

/**
 * zod reports a failed union as one "Invalid input" issue with the issues of every variant
 * nested inside. Report the variant the author most likely meant: one whose basic type matched,
 * and of those the one with the fewest problems.
 */
function flattenIssues(issues: readonly RawIssue[], prefix: Path = []): { path: Path; message: string }[] {
  const out: { path: Path; message: string }[] = [];
  for (const issue of issues) {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union" && issue.errors && issue.errors.length > 0) {
      const wrongType = (variant: RawIssue[]): boolean =>
        variant.some((inner) => inner.code === "invalid_type" && inner.path.length === 0);
      const plausible = issue.errors.filter((variant) => !wrongType(variant));
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
    for (const issue of flattenIssues(result.error.issues as unknown as RawIssue[])) {
      error(file, issue.path, issue.message);
    }
    return undefined;
  };

  const country = parse(COUNTRY, countrySchema, files.country);
  const budget = parse(BUDGET, budgetSchema, files.budget);
  const policiesFile = parse(POLICIES, policiesFileSchema, files.policies);
  const sources = parse(SOURCES, sourcesFileSchema, files.sources);
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

  for (const [name, distribution] of Object.entries(distributions)) {
    const file = distributionFile(name);
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
  }

  // --- policies.json --------------------------------------------------------------------------

  const checkPolicy = (policy: Policy, base: Path): void => {
    text(POLICIES, [...base, "label"], policy.label);
    text(POLICIES, [...base, "summary"], policy.summary);
    refs(POLICIES, [...base, "sources"], policy.sources);

    const params = new Map<string, Param>();
    const usedParams = new Set<string>();
    const defaults: ParamValues = {};

    policy.params.forEach((param, i) => {
      const path = [...base, "params", i];
      if (params.has(param.id)) error(POLICIES, [...path, "id"], `duplicate param id "${param.id}" in policy "${policy.id}"`);
      else params.set(param.id, param);
      text(POLICIES, [...path, "label"], param.label);

      if (param.type === "number") {
        if (param.min > param.max) {
          error(POLICIES, path, `min (${param.min}) is above max (${param.max})`);
        } else if (param.default < param.min || param.default > param.max) {
          error(POLICIES, [...path, "default"], `${param.default} lies outside [${param.min}, ${param.max}]`);
        }
        defaults[param.id] = Math.min(param.max, Math.max(param.min, param.default));
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
        error(POLICIES, [...path, "param"], `param "${value.param}" is a groups param; a number param is needed here`);
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
      const shift = effect.type === "scale" || effect.type === "excludeGroups" ? effect.shift : undefined;
      if (!shift) return;
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
            error(POLICIES, [...path, "groups", "param"], `param "${paramId}" is a number param; a groups param is needed here`);
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
          const distribution = own(distributions, effect.distribution);
          if (!distributionNames.has(effect.distribution)) {
            error(POLICIES, [...path, "distribution"], `unknown distribution "${effect.distribution}"`);
          }
          let evaluable = checkValue(effect.yield, [...path, "yield"]);
          effect.reform.brackets.forEach((bracket, k) => {
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
          if (effect.baseline) {
            const brackets = effect.baseline.brackets;
            let ascending = true;
            for (let k = 1; k < brackets.length; k++) {
              if (!(brackets[k].from > brackets[k - 1].from)) {
                ascending = false;
                error(
                  POLICIES,
                  [...path, "baseline", "brackets", k, "from"],
                  `thresholds must be ascending, but ${brackets[k].from} follows ${brackets[k - 1].from}`,
                );
              }
            }
            if (distribution && ascending && !(scheduleTotal(distribution, brackets) > 0)) {
              error(
                POLICIES,
                [...path, "baseline"],
                `the baseline schedule yields nothing on distribution "${effect.distribution}", so the effect cannot be calibrated`,
              );
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
    policy.catches.forEach((item, i) => {
      text(POLICIES, [...base, "catches", i, "text"], item.text);
      refs(POLICIES, [...base, "catches", i, "sources"], item.sources);
    });
    policy.params.forEach((param, i) => {
      if (!usedParams.has(param.id)) warn(POLICIES, [...base, "params", i], `param "${param.id}" is not used by any effect`);
    });
  };

  if (policiesFile) {
    const seen = new Set<string>();
    policiesFile.policies.forEach((policy, i) => {
      if (seen.has(policy.id)) error(POLICIES, ["policies", i, "id"], `duplicate policy id "${policy.id}"`);
      seen.add(policy.id);
      checkPolicy(policy, ["policies", i]);
    });
  }

  // --- result ---------------------------------------------------------------------------------

  const complete =
    country && budget && policiesFile && sources && Object.keys(distributions).length === distributionNames.size;
  if (sources && complete) {
    for (const id of Object.keys(sources)) {
      if (!usedSources.has(id)) warn(SOURCES, [id], `source "${id}" is never referenced`);
    }
  }

  if (errors.length > 0 || !complete) return { ok: false, errors: sortByFile(errors), warnings: sortByFile(warnings) };
  return {
    ok: true,
    pack: { country, budget, policies: policiesFile.policies, sources, distributions },
    warnings: sortByFile(warnings),
  };
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
