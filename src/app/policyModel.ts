/**
 * What a policy card says about a measure, derived from the engine's result for that measure on
 * its own. Everything here is arithmetic on engine output; no numbers are made up.
 */
import {
  LEVEL_IDS,
  perCapita,
  simulatePolicy,
  type CountryPack,
  type EffectResult,
  type GroupsParam,
  type LevelId,
  type NumberParam,
  type ParamValues,
  type Policy,
  type PolicyResult,
  type Quality,
  type ShiftResult,
  type Side,
  type SourceId,
  type Totals,
} from "../engine/index.ts";

/** Which way an amount moves the balance. */
export type Direction = "improve" | "worsen" | "neutral";

/** A parameter the card has a control for: a slider or a choice of groups. */
export type Setting = NumberParam | GroupsParam;

/**
 * The parameters of a measure that the visitor can set on its card. A pack may carry kinds of
 * parameter this interface has no control for (yet); those keep their default and are not counted.
 */
export function settingsOf(policy: Policy): Setting[] {
  return policy.params.filter((param): param is Setting => {
    // Compared as text on purpose: the engine's list of kinds may be longer than what is handled here.
    const kind: string = param.type;
    return kind === "number" || kind === "groups";
  });
}

/** Differences below this are floating-point noise, whatever the size of the country. */
export function noiseLevel(baseline: Totals): number {
  return Math.max(Math.abs(baseline.revenue), Math.abs(baseline.expenditure), 1) * 1e-9;
}

export function directionOf(balanceDelta: number, noise: number): Direction {
  if (Math.abs(balanceDelta) <= noise) return "neutral";
  return balanceDelta > 0 ? "improve" : "worsen";
}

/** How a change of a budget item moves the balance: more revenue improves it, more spending worsens it. */
export function directionOfNode(side: Side, delta: number, noise: number): Direction {
  return directionOf(side === "revenue" ? delta : -delta, noise);
}

const QUALITY_RANK: Record<Quality, number> = { official: 0, derived: 1, estimate: 2 };

/** The weakest of the given quality labels; a result is only as solid as its weakest part. */
export function weakestQuality(qualities: Quality[]): Quality | undefined {
  let worst: Quality | undefined;
  for (const quality of qualities) {
    if (worst === undefined || QUALITY_RANK[quality] > QUALITY_RANK[worst]) worst = quality;
  }
  return worst;
}

export interface PolicyInsight {
  /** Effect on the balance per year, on its own. */
  balance: number;
  low: number;
  high: number;
  hasRange: boolean;
  direction: Direction;
  /** The side of the budget the measure mainly changes. */
  side: Side;
  /** |balance| as a share of that side's base-year total. */
  shareOfSide: number;
  /** |balance| per inhabitant. */
  perInhabitant: number;
  /** |balance| as a share of today's deficit; null if today's balance is not a deficit. */
  shareOfDeficit: number | null;
  quality: Quality | undefined;
}

export function insightOf(pack: CountryPack, alone: PolicyResult, baseline: Totals): PolicyInsight {
  const noise = noiseLevel(baseline);
  const balance = alone.delta.balance;
  const size = Math.abs(balance);
  const side: Side = Math.abs(alone.delta.revenue) > Math.abs(alone.delta.expenditure) ? "revenue" : "expenditure";
  const total = baseline[side];
  return {
    balance,
    low: alone.low.balance,
    high: alone.high.balance,
    hasRange: Math.abs(alone.high.balance - alone.low.balance) > noise,
    direction: directionOf(balance, noise),
    side,
    shareOfSide: total > 0 ? size / total : 0,
    perInhabitant: perCapita(pack, size),
    shareOfDeficit: baseline.balance < -noise ? size / -baseline.balance : null,
    quality: weakestQuality(alone.effects.map((effect) => effect.quality)),
  };
}

/** Every source a policy cites, on the policy itself, its effects and its catches, without repeats. */
export function sourcesOf(policy: Policy): SourceId[] {
  const ids = [
    ...policy.sources,
    ...policy.effects.flatMap((effect) => [...(effect.sources ?? []), ...(effect.shift?.sources ?? [])]),
    ...policy.catches.flatMap((item) => item.sources ?? []),
  ];
  return [...new Set(ids)];
}

const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2 } as const;

/** Catches with the most severe first; equal severities keep the order of the pack. */
export function sortedCatches(policy: Policy): Policy["catches"] {
  return [...policy.catches].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/**
 * The part of an effect that reappears at another budget item (typically at another level of
 * government). The engine reports it on every effect that declares a shift, with zeros when
 * nothing moved.
 */
export function shiftOf(effect: EffectResult): ShiftResult | undefined {
  return effect.shift && Number.isFinite(effect.shift.delta) ? effect.shift : undefined;
}

/** The levels of government a pack defines, in the engine's fixed order. */
export function levelsOf(pack: CountryPack): LevelId[] {
  return LEVEL_IDS.filter((level) => pack.country.levels[level] !== undefined);
}

export interface LevelEffect {
  level: LevelId;
  /** The measure's result seen through this level alone. */
  result: PolicyResult;
  /** Change of this level's revenue minus spending: positive relieves the level, negative burdens it. */
  net: number;
}

/** What one measure does to each level of government, on its own. */
export function effectByLevel(pack: CountryPack, policyId: string, params: ParamValues | undefined): LevelEffect[] {
  const out: LevelEffect[] = [];
  for (const level of levelsOf(pack)) {
    const result = simulatePolicy(pack, policyId, params, level);
    if (result) out.push({ level, result, net: result.delta.balance });
  }
  return out;
}

/** True if a measure relieves at least one level and burdens another: money moves between levels. */
export function movesBetweenLevels(levels: LevelEffect[], noise: number): boolean {
  return levels.some((entry) => entry.net > noise) && levels.some((entry) => entry.net < -noise);
}

/** The levels that carry a noticeable part (over 2 %) of an amount, largest first. */
export function bearers(parts: { level: LevelId; amount: number }[]): LevelId[] {
  const total = parts.reduce((sum, part) => sum + Math.abs(part.amount), 0);
  if (!(total > 0)) return [];
  return parts
    .filter((part) => Math.abs(part.amount) / total > 0.02)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .map((part) => part.level);
}
