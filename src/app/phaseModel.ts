/**
 * When measures act in the debt projection, as the interface says it: the start as a year, or as
 * month and year where a measure starts within a year, and the first whole year in full where it
 * builds up. The engine decides the phases (engine/timing.ts); this only puts them into words.
 *
 * Years are the pack's (engine/years.ts). Where they are not calendar years, a start on the first
 * day of a year is that year by its name ("FY 2027"), not the month it begins in ("October 2026"),
 * and a start on any other day is its month and year, 1 January included.
 */
import { calendarYears, yearBeginningOn, type CountryPack, type MeasurePhase } from "../engine/index.ts";
import { intlLocale } from "../i18n/index.ts";
import type { PhaseWords } from "../i18n/debt/messages.ts";
import type { YearName } from "../i18n/messages.ts";

/** What the words need of the interface (Ui): the language, the pack, and how it names a year. */
export interface PhaseNaming {
  language: string;
  pack: CountryPack;
  yearName(year: number): YearName;
}

/** "2027-07-01" -> "Juli 2027" / "July 2027". */
function monthAndYear(from: string, language: string): string {
  const [year, month, day] = from.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat(intlLocale(language), { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, day)),
    );
  } catch {
    return String(year);
  }
}

/**
 * "2032-01-01" -> "2032"; "2027-07-01" -> "Juli 2027" / "July 2027". In US fiscal years:
 * "2026-10-01" -> "FY 2027", "2027-01-01" -> "January 2027".
 */
export function startText(from: string, naming: PhaseNaming): string {
  const { pack, language } = naming;
  if (!calendarYears(pack)) {
    const year = yearBeginningOn(pack, from);
    return year === undefined ? monthAndYear(from, language) : String(naming.yearName(year));
  }
  const [year, month, day] = from.split("-").map(Number);
  if (month === 1 && day === 1) return String(year);
  return monthAndYear(from, language);
}

/** The words for one phase; `last` is the last year of the calculation, where there is one. */
export function phaseWords(phase: MeasurePhase, naming: PhaseNaming, last?: number): PhaseWords {
  const full = phase.years > 0 ? phase.full : undefined;
  return {
    start: startText(phase.from, naming),
    startYear: phase.start,
    full,
    last,
    fullName: full === undefined ? undefined : naming.yearName(full),
  };
}

/** The switched-on measures that start later than the first year measures can act, or build up. */
export function laterPhases(phases: readonly MeasurePhase[]): MeasurePhase[] {
  return phases.filter((phase) => !phase.immediate);
}

/** Whether any of the phases is not yet in full in the last year of the calculation. */
export function notInFullBy(phases: readonly MeasurePhase[], last: number): boolean {
  return phases.some((phase) => phase.start > last || (phase.years > 0 && phase.full > last));
}
