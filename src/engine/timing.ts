/**
 * When measures act in the debt projection, and how much of their effect they have in each year.
 *
 * A measure's effects describe its full, steady-state effect on the budget. In the projection it
 * acts from the first year measures can act at all (debt.json `measuresFrom`, by default the year
 * after the base year), unless its `timing` says it starts later or builds up over years.
 *
 * Time is counted in decimal years: 2027.5 is the middle of 2027. A measure that starts at time a
 * and builds up over D years has, at time x, the share r(x) = 0 before a, (x - a) / D while it
 * builds up, and 1 afterwards; with D = 0 it jumps from 0 to 1 at a. Its share in calendar year y
 * is the average of r over that year, so a measure that starts on 1 July has half its effect in
 * its first year.
 */
import { resolveParams, type ParamValues } from "./simulate.ts";
import type { CountryPack, Policy, TimingPhase } from "./types.ts";

/** When one measure acts in the projection, at given settings. */
export interface MeasurePhase {
  policy: string;
  /** The first day the measure acts: its own start, or the first day measures can act, whichever is later. ISO date. */
  from: string;
  /** The calendar year of `from`. */
  start: number;
  /** Years from `from` until the effect is full, rising linearly; 0 means at once. */
  years: number;
  /** The first calendar year in which the measure has its full effect for the whole year. */
  full: number;
  /**
   * Whether the measure acts in full from the first year measures can act, as one without timing
   * does. False for a measure that starts later or builds up.
   */
  immediate: boolean;
}

/** The first year in which measures can act in the projection: debt.json `measuresFrom`, or the year after the base year. */
export function measuresFrom(pack: CountryPack): number {
  return pack.debt?.measuresFrom?.year ?? pack.country.baseYear + 1;
}

const DAY = 86_400_000;

/** "2027-07-01" -> 2027.4959: the year plus the share of it that has passed at the start of that day. */
export function decimalYear(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const start = Date.UTC(year, 0, 1);
  const length = (Date.UTC(year + 1, 0, 1) - start) / DAY;
  return year + (Date.UTC(year, month - 1, day) - start) / DAY / length;
}

/** The phase that applies at these settings, and the distance of the timing's param from its baseline. */
function phaseOf(policy: Policy, params: ParamValues): { phase: TimingPhase; distance: number } {
  const timing = policy.timing;
  if (!timing) return { phase: {}, distance: 0 };
  const param = timing.param === undefined ? undefined : policy.params.find((candidate) => candidate.id === timing.param);
  if (!param || param.type !== "number" || param.baseline === undefined) return { phase: timing, distance: 0 };
  const value = params[param.id];
  if (typeof value !== "number") return { phase: timing, distance: 0 };
  const below = value < param.baseline;
  return { phase: below && timing.below ? timing.below : timing, distance: Math.abs(value - param.baseline) };
}

/**
 * When a measure acts in the projection at the given settings (missing ones take their default).
 * Undefined if the pack has no policy with this id.
 */
export function measurePhase(pack: CountryPack, policyId: string, params?: ParamValues): MeasurePhase | undefined {
  const policy = pack.policies.find((candidate) => candidate.id === policyId);
  if (!policy) return undefined;
  const earliest = measuresFrom(pack);
  const { phase, distance } = phaseOf(policy, resolveParams(pack, policy, params));
  const own = phase.from === undefined ? undefined : decimalYear(phase.from);
  const later = own !== undefined && own > earliest;
  const begin = later ? own : earliest;
  const years = (phase.years ?? 0) + (phase.yearsPerUnit ?? 0) * distance;
  return {
    policy: policy.id,
    from: later && phase.from !== undefined ? phase.from : `${earliest}-01-01`,
    start: Math.floor(begin),
    years,
    full: Math.ceil(begin + years),
    immediate: !later && years === 0,
  };
}

/**
 * The share of its full effect that a measure has in a calendar year: the average over the year
 * of the linear build-up. 0 before it starts, 1 once it is full, exactly.
 */
export function shareInYear(phase: MeasurePhase, year: number): number {
  const begin = decimalYear(phase.from);
  const end = begin + phase.years;
  if (year + 1 <= begin) return 0;
  if (year >= end) return 1;
  /** The integral of the share from `begin` to x. */
  const integral = (x: number): number => {
    if (x <= begin) return 0;
    if (phase.years === 0) return x - begin;
    if (x <= end) return (x - begin) ** 2 / (2 * phase.years);
    return phase.years / 2 + (x - end);
  };
  return Math.min(1, Math.max(0, integral(year + 1) - integral(year)));
}
