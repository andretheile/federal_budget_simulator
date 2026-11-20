/**
 * The texts of the debt section's body, for a language. They are imported only by the body
 * (components/DebtBody.tsx), so they travel with its code instead of weighing on the first page.
 * Like the main dictionary, a language without texts of its own gets the English ones.
 */
import { baseLanguage } from "../index.ts";
import { debtBodyDe } from "./body-de.ts";
import { debtBodyEn } from "./body-en.ts";
import type { DebtBodyMessages } from "./messages.ts";

const dictionaries: Record<string, DebtBodyMessages> = { de: debtBodyDe, en: debtBodyEn };

export function debtBodyMessages(language: string): DebtBodyMessages {
  return dictionaries[language] ?? dictionaries[baseLanguage(language)] ?? debtBodyEn;
}
