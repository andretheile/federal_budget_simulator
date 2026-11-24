/**
 * English as the United States write it, for a country whose own language is American English
 * (i18n/index.ts localeFor). The interface's English is British; only the words that differ are
 * replaced here. Numbers, money and dates follow the locale through the formatters.
 */
import { en, sideTexts } from "./en.ts";
import type { Messages } from "./messages.ts";

export const enUS: Messages = {
  ...en,
  policies: { ...en.policies, ...sideTexts("the federal government"), topics: { ...en.policies.topics, defense: "Defense" } },
  curve: {
    ...en.curve,
    clampedTo: (value) => `Limited to ${value}: a point cannot overtake its neighbors.`,
    examplesNote: "Amounts per year. The figure in parentheses is the average rate: the amount divided by the value on the horizontal axis.",
  },
};
