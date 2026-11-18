/**
 * Languages of the interface.
 *
 * A language is a locale code a country pack lists in `country.locales` (plus "en", which every
 * pack text must have). The interface strings come from the dictionary of that language, or from
 * the English one if nobody has written a dictionary for it yet; pack texts are picked with
 * `localize`, which falls back the same way.
 */
import type { LocalizedText } from "../engine/index.ts";
import { de } from "./de.ts";
import { en } from "./en.ts";
import type { Messages } from "./messages.ts";

export type { Messages } from "./messages.ts";

export const FALLBACK_LANGUAGE = "en";

const dictionaries: Record<string, Messages> = { de, en };

/** "de-AT" -> "de" */
export function baseLanguage(locale: string): string {
  return locale.toLowerCase().split(/[-_]/)[0] ?? "";
}

/** Whether somebody has written a dictionary for this language. */
export function hasDictionary(language: string): boolean {
  return dictionaries[language] !== undefined || dictionaries[baseLanguage(language)] !== undefined;
}

/** The dictionary for a language, or the English one if there is none. */
export function messagesFor(language: string): Messages {
  return dictionaries[language] ?? dictionaries[baseLanguage(language)] ?? en;
}

/**
 * A pack text in the wanted language. Falls back to the base language ("de" for "de-AT"), then to
 * English, which every pack text has. A missing text gives "".
 */
export function localize(text: LocalizedText | undefined, language: string): string {
  if (!text) return "";
  return text[language] ?? text[baseLanguage(language)] ?? text[FALLBACK_LANGUAGE] ?? "";
}

/** The languages a visitor can choose for a pack: its locales in pack order, then English. */
export function languagesOf(packLocales: readonly string[]): string[] {
  const out: string[] = [];
  for (const locale of [...packLocales, FALLBACK_LANGUAGE]) {
    if (locale && !out.includes(locale)) out.push(locale);
  }
  return out;
}

function match(wanted: string | null | undefined, available: readonly string[]): string | undefined {
  if (!wanted) return undefined;
  const lower = wanted.toLowerCase();
  return (
    available.find((language) => language.toLowerCase() === lower) ??
    available.find((language) => baseLanguage(language) === baseLanguage(lower))
  );
}

export interface LanguageHints {
  /** From the link the visitor opened. Wins over everything else. */
  url?: string | null;
  /** What the visitor chose last time. */
  stored?: string | null;
  /** The browser's languages, most wanted first. */
  browser?: readonly string[];
}

/**
 * Which language to start in: the one in the link, else the one chosen last time, else the first
 * browser language the pack offers, else the pack's first locale.
 */
export function pickLanguage(packLocales: readonly string[], hints: LanguageHints = {}): string {
  const available = languagesOf(packLocales);
  const fromBrowser = (hints.browser ?? []).map((wanted) => match(wanted, available)).find(Boolean);
  return (
    match(hints.url, available) ?? match(hints.stored, available) ?? fromBrowser ?? available[0] ?? FALLBACK_LANGUAGE
  );
}

/**
 * The locale handed to `Intl`. English is formatted the British way ("€12.4bn", "12 March 2025"),
 * which is what readers of European budget figures are used to.
 */
export function intlLocale(language: string): string {
  return baseLanguage(language) === "en" && !language.includes("-") ? "en-GB" : language;
}
