/**
 * When measures act in the debt projection, as the interface says it: the start as a year, or as
 * month and year where a measure starts within a year, and the first whole year in full where it
 * builds up. The engine decides the phases (engine/timing.ts); this only puts them into words.
 */
import type { MeasurePhase } from "../engine/index.ts";
import { intlLocale } from "../i18n/index.ts";
import type { PhaseWords } from "../i18n/debt/messages.ts";

/** "2032-01-01" -> "2032"; "2027-07-01" -> "Juli 2027" / "July 2027". */
export function startText(from: string, language: string): string {
  const [year, month, day] = from.split("-").map(Number);
  if (month === 1 && day === 1) return String(year);
  try {
    return new Intl.DateTimeFormat(intlLocale(language), { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, day)),
    );
  } catch {
    return String(year);
  }
}

/** The words for one phase; `last` is the last year of the calculation, where there is one. */
export function phaseWords(phase: MeasurePhase, language: string, last?: number): PhaseWords {
  return {
    start: startText(phase.from, language),
    startYear: phase.start,
    full: phase.years > 0 ? phase.full : undefined,
    last,
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
