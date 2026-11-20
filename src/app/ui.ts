/**
 * What every component needs to speak to the visitor: the dictionary, the formatters and the
 * pack, for the active language. Built once per (pack, language) and passed down by context.
 */
import { createContext, useContext } from "react";
import type { CountryPack, LevelId, LocalizedText } from "../engine/index.ts";
import { createFormatters, type Formatters } from "../i18n/format.ts";
import { localize, messagesFor, type Messages } from "../i18n/index.ts";

export interface Ui {
  language: string;
  pack: CountryPack;
  t: Messages;
  fmt: Formatters;
  /** A pack text in the active language. */
  text(value: LocalizedText | undefined): string;
  /** The pack's own name for a level of government. */
  levelName(level: LevelId): string;
}

export function createUi(pack: CountryPack, language: string): Ui {
  const t = messagesFor(language);
  return {
    language,
    pack,
    t,
    fmt: createFormatters(language, pack.country.currency, t),
    text: (value) => localize(value, language),
    levelName: (level) => localize(pack.country.levels[level]?.name, language) || t.levelFallback[level],
  };
}

export const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi must be used inside <UiContext>");
  return ui;
}
