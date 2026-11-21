/**
 * The years of a pack: calendar years, or years that start on another day (country.json
 * `baseYearStart`), such as the US fiscal year from 1 October to 30 September, which is named after
 * the calendar year it ends in. Year n of a pack starts on the same day and month as the base year,
 * n - baseYear calendar years later. The debt projection counts its years this way, and the
 * timing of measures places its dates in them.
 *
 * Dates are ISO strings (YYYY-MM-DD) and are read as days, without time zones.
 */
import type { Country, CountryPack, LocalizedText } from "./types.ts";

type HasCountry = Pick<CountryPack, "country"> | { country: Pick<Country, "baseYear" | "baseYearStart" | "baseYearShort"> };

/** Month, day and the difference between the calendar year a pack year starts in and its number (0 or -1). */
function startOf(pack: HasCountry): { month: number; day: number; shift: number } | undefined {
  const start = pack.country.baseYearStart;
  if (start === undefined) return undefined;
  const [year, month, day] = start.split("-").map(Number);
  if (month === 1 && day === 1 && year === pack.country.baseYear) return undefined;
  return { month, day, shift: year - pack.country.baseYear };
}

const two = (n: number): string => String(n).padStart(2, "0");

/** Whether the pack's years are calendar years: no `baseYearStart`, or 1 January of the base year. */
export function calendarYears(pack: HasCountry): boolean {
  return startOf(pack) === undefined;
}

/** The first day of the pack's year `year`: "2027-01-01" for a calendar year, "2026-10-01" for the US fiscal year 2027. */
export function yearStart(pack: HasCountry, year: number): string {
  const start = startOf(pack);
  if (!start) return `${year}-01-01`;
  return `${year + start.shift}-${two(start.month)}-${two(start.day)}`;
}

/** The last day of the pack's year `year`: "2027-12-31", or "2027-09-30" for the US fiscal year 2027. */
export function yearEnd(pack: HasCountry, year: number): string {
  const next = yearStart(pack, year + 1);
  const [y, m, d] = next.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  return `${last.getUTCFullYear()}-${two(last.getUTCMonth() + 1)}-${two(last.getUTCDate())}`;
}

/** The pack's year a date falls in: 2027 for "2027-03-15" in calendar years, 2027 for "2026-11-01" in US fiscal years. */
export function yearOfDate(pack: HasCountry, date: string): number {
  const start = startOf(pack);
  const year = Number(date.slice(0, 4));
  if (!start) return year;
  // The year whose first day is the last one on or before the date.
  const named = year - start.shift;
  return date >= yearStart(pack, named) ? named : named - 1;
}

/** The pack's year that begins on this date, if one does: 2027 for "2026-10-01" in US fiscal years; undefined for "2027-01-01" there. */
export function yearBeginningOn(pack: HasCountry, date: string): number | undefined {
  const year = yearOfDate(pack, date);
  return yearStart(pack, year) === date ? year : undefined;
}

/**
 * The short name of the pack's year `year` where the pack names its base year with one
 * (country.json `baseYearShort`, such as "FY 2025"): that name with the base year's number replaced
 * by this year's ("FY 2030"). Undefined where the pack has no short name or a locale's name does not
 * contain the base year's number: the year is then named by its number.
 */
export function yearShort(pack: HasCountry, year: number): LocalizedText | undefined {
  const short = pack.country.baseYearShort;
  if (!short) return undefined;
  const base = String(pack.country.baseYear);
  const out: Record<string, string> = {};
  for (const [locale, name] of Object.entries(short)) {
    if (!name.includes(base)) return undefined;
    out[locale] = name.split(base).join(String(year));
  }
  return out as LocalizedText;
}
