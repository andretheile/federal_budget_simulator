/**
 * When measures act in the debt projection, and how much of their effect they have in each year.
 *
 * A measure's effects describe its full, steady-state effect on the budget. In the projection it
 * acts from the first year measures can act at all (debt.json `measuresFrom`, by default the year
 * after the base year), unless its `timing` says it starts later or builds up over years.
 *
 * Time is counted in decimal years of the pack: 2027.5 is the middle of 2027. Where the pack's
 * years are not calendar years (country.json `baseYearStart`), year y runs from its first day to the
 * first day of year y + 1, and a date's place in it is counted in days: 1 January 2027 is about
 * 2027.25 in US fiscal years, which start on 1 October. A measure that starts at time a
 * and builds up over D years has, at time x, the share r(x) = 0 before a, (x - a) / D while it
 * builds up, and 1 afterwards; with D = 0 it jumps from 0 to 1 at a. Its share in calendar year y
 * is the average of r over that year, so a measure that starts on 1 July has half its effect in
 * its first year.
 *
 * A measure can end (TimingPhase.lasts, `once`). One that lasts N years acts in full from a and
 * not at all from the same day N years later: r(x) = 1 between the two, 0 elsewhere, and its share
 * in a year is again the average of r over it. A one-off has its whole effect, the amount it pays or
 * raises, in the year a falls in, and none in any other: a payment is not a rate over time.
 */
import { resolveParams, type ParamValues } from "./simulate.ts";
import type { CountryPack, Policy, TimingPhase } from "./types.ts";
import { calendarYears, yearOfDate, yearStart } from "./years.ts";

/** When one measure acts in the projection, at given settings. */
export interface MeasurePhase {
  policy: string;
  /** The first day the measure acts: its own start, or the first day measures can act, whichever is later. ISO date. */
  from: string;
  /** The year of `from`: a calendar year, or the pack's year where its years are not calendar years. */
  start: number;
  /** Years from `from` until the effect is full, rising linearly; 0 means at once. */
  years: number;
  /**
   * The first year (as `start`) in which the measure has its full effect for the whole year. For a
   * one-off, `start`. For a measure that lasts less than it takes to cover a whole year (one year
   * from a day within a year) it lies after `last`: there is no such year.
   */
  full: number;
  /**
   * Whether the measure acts in full and for good from the first year measures can act, as one
   * without timing does. False for a measure that starts later, builds up or ends.
   */
  immediate: boolean;
  /**
   * The last year (as `start`) in which the measure acts, for a measure that ends (`once` or
   * TimingPhase.lasts); absent for one that acts for good. For a one-off, `start`; it then acts in
   * that one year only, as a measure whose `start` equals `last` does.
   */
  last?: number;
  /** The last day the measure acts, as an ISO date, for a measure that lasts a number of years (TimingPhase.lasts). */
  to?: string;
  /** True for a one-off (TimingPhase.once): its whole effect falls in the year `start`. */
  once?: true;
  /**
   * The first day of the year `start`, as an ISO date, where the pack's years are not calendar
   * years ("2026-10-01" for the US fiscal year 2027); absent for calendar years. Every other year
   * starts on the same day and month, so shareInYear needs nothing else.
   */
  yearStart?: string;
}

/** The first year in which measures can act in the projection: debt.json `measuresFrom`, or the year after the base year. */
export function measuresFrom(pack: CountryPack): number {
  return pack.debt?.measuresFrom?.year ?? pack.country.baseYear + 1;
}

const DAY = 86_400_000;

/** The ISO date `days` days after `date` (before it, for a negative number). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return next.toISOString().slice(0, 10);
}

/** The last day of `years` whole years from `date`: "2028-01-01", 3 -> "2030-12-31". */
function lastDayOf(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  // 29 February plus a year without one becomes 1 March, so the last day is 28 February.
  return addDays(new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10), -1);
}

/** "2027-07-01" -> 2027.4959: the year plus the share of it that has passed at the start of that day. */
export function decimalYear(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const start = Date.UTC(year, 0, 1);
  const length = (Date.UTC(year + 1, 0, 1) - start) / DAY;
  return year + (Date.UTC(year, month - 1, day) - start) / DAY / length;
}

/** A pack, or a phase's own record of the pack's years, as years.ts needs it. */
type Years = { country: { baseYear: number; baseYearStart?: string } };

/**
 * A date's place on the pack's years: decimalYear for calendar years; otherwise the pack's year it
 * falls in plus the share of that year's days that have passed at the start of the day.
 */
function yearPosition(years: Years, date: string): number {
  if (calendarYears(years)) return decimalYear(date);
  const year = yearOfDate(years, date);
  const days = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / DAY;
  };
  const first = days(yearStart(years, year));
  return year + (days(date) - first) / (days(yearStart(years, year + 1)) - first);
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
  const own = phase.from === undefined ? undefined : yearPosition(pack, phase.from);
  const later = own !== undefined && own > earliest;
  const begin = later ? own : earliest;
  // A one-off has no build-up; validation rejects one with it.
  const years = phase.once ? 0 : (phase.years ?? 0) + (phase.yearsPerUnit ?? 0) * distance;
  const ends = phase.once === true || phase.lasts !== undefined;
  const result: MeasurePhase = {
    policy: policy.id,
    from: later && phase.from !== undefined ? phase.from : yearStart(pack, earliest),
    start: Math.floor(begin),
    years,
    full: phase.once ? Math.floor(begin) : Math.ceil(begin + years),
    immediate: !later && years === 0 && !ends,
  };
  if (!calendarYears(pack)) result.yearStart = yearStart(pack, result.start);
  if (phase.once) {
    result.last = result.start;
    result.once = true;
  } else if (phase.lasts !== undefined) {
    result.to = lastDayOf(result.from, phase.lasts);
    result.last = yearOfDate(pack, result.to);
  }
  return result;
}

/**
 * The share of its full effect that a measure has in a year of the pack (a calendar year, or the
 * pack's own year where the phase says when its years start): the average over the year of the
 * linear build-up, up to the measure's end if it has one. 0 before it starts and after it has
 * ended, 1 while it is full for the whole year, exactly. A one-off: 1 in its year, 0 in any other.
 */
export function shareInYear(phase: MeasurePhase, year: number): number {
  if (phase.once) return year === phase.start ? 1 : 0;
  const position = (date: string): number =>
    phase.yearStart === undefined ? decimalYear(date) : yearPosition({ country: { baseYear: phase.start, baseYearStart: phase.yearStart } }, date);
  const begin = position(phase.from);
  const end = begin + phase.years;
  /** The integral of the share from `begin` to x, without an end. */
  const integral = (x: number): number => {
    if (x <= begin) return 0;
    if (phase.years === 0) return x - begin;
    if (x <= end) return (x - begin) ** 2 / (2 * phase.years);
    return phase.years / 2 + (x - end);
  };
  if (phase.to !== undefined) {
    // It acts up to the start of the day after its last day.
    const stop = position(addDays(phase.to, 1));
    if (year + 1 <= begin || year >= stop) return 0;
    if (year >= end && year + 1 <= stop) return 1;
    return Math.min(1, Math.max(0, integral(Math.min(year + 1, stop)) - integral(year)));
  }
  if (year + 1 <= begin) return 0;
  if (year >= end) return 1;
  return Math.min(1, Math.max(0, integral(year + 1) - integral(year)));
}
