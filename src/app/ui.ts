/**
 * What every component needs to speak to the visitor: the dictionary, the formatters and the
 * pack, for the active language. Built once per (pack, language) and passed down by context.
 */
import { createContext, useContext } from "react";
import type { CountryPack, LevelId, LocalizedText } from "../engine/index.ts";
import { createFormatters, type Formatters } from "../i18n/format.ts";
import { localize, localeFor, messagesFor, type Messages } from "../i18n/index.ts";
import type { YearName } from "../i18n/messages.ts";

export interface Ui {
  language: string;
  pack: CountryPack;
  t: Messages;
  fmt: Formatters;
  /** A pack text in the active language. */
  text(value: LocalizedText | undefined): string;
  /** The pack's own name for a level of government. */
  levelName(level: LevelId): string;
  /**
   * The base year as headings and labels name it: the number, or the pack's short name where the
   * bare number would mislead, such as a fiscal year ("FY 2025"; country.json `baseYearShort`).
   */
  period: YearName;
}

export function createUi(pack: CountryPack, language: string): Ui {
  const t = messagesFor(language);
  return {
    language,
    pack,
    t,
    // English for a country whose own language is English follows that country's conventions
    // (en-US for the United States); otherwise English is British, as for Germany.
    fmt: createFormatters(language, pack.country.currency, t, localeFor(language, pack.country)),
    text: (value) => localize(value, language),
    levelName: (level) => localize(pack.country.levels[level]?.name, language) || t.levelFallback[level],
    period: localize(pack.country.baseYearShort, language) || pack.country.baseYear,
  };
}

export const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi must be used inside <UiContext>");
  return ui;
}
