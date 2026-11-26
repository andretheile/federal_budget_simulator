import type { WhoPaysMessages } from "./messages.ts";

/** A pack's label inside a sentence: "Taxes" -> "taxes". */
const lower = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

export const whoPaysEn: WhoPaysMessages = {
  title: "Who pays",
  intro:
    "How taxes and levies are spread over the people in the country, from the smallest incomes to the largest, and what the measures switched on change about it.",
  scopes: "What the bars add up",
  headline: (scope, spread, total, top, topPays, topHas, bottom, bottomPays, bottomHas) =>
    `${scope}: ${spread} of ${total} can be spread over income groups. ${top}: pays ${topPays} of that, has ${topHas} of income. ${bottom}: pays ${bottomPays}, has ${bottomHas}.`,
  listLabel: (scope) => `Shares by income group (${lower(scope)})`,
  from: (amount) => `from ${amount} a year`,
  pays: (share) => `pays ${share}`,
  has: (share) => `has ${share} of income`,
  ofIncome: (share) => `that is ${share} of its income`,
  paysChanged: (now, today) => `pays ${now} instead of ${today}`,
  instead: (now, today) => `${now} instead of ${today}`,
  points: (signed) => `${signed} points`,
  perUnitChange: (amount, more, perUnit) => `pays on average ${amount} ${more ? "more" : "less"} ${perUnit} a year`,
  same: "pays as much as before",
  key: (year) =>
    `Bar: share of the part that can be spread over income groups. Vertical line: share in ${year}, where the measures change it. Diamond: share of income.`,
  ranking: (text) => `Who is in which group: ${text}`,
  outside: (amount) => `Not in the bars: ${amount} that cannot be spread over the income groups; the statement below says who pays it.`,
  statementTitle: "Where all revenue comes from",
  statementIntro: (total) => `The ${total} of revenue in the panel above, by who pays it.`,
  groupsLine: "People, spread by income",
  chartCovers: (scope, amount) => `Of this, in the bars above (${lower(scope)}): ${amount}.`,
  today: (amount, year) => `${year}: ${amount}`,
  total: "Total revenue",
  itemsOf: (label) => `Break down ${label}`,
  counted: (list) => `Wholly or partly spread over the income groups are the changes of: ${list}.`,
  notCounted: "Not spread over the income groups:",
  outsideMeasure: (measure, payers) => `${measure} (${payers})`,
  payerChange: (payer, amount, more) => `${payer} ${amount} ${more ? "more" : "less"}`,
  methodTitle: "How it is calculated",
  computed: (text) => text,
  quality: "Data quality",
  sources: "Sources",
  stripTitle: (perUnit) => `Who pays more or less, on average ${perUnit} a year`,
  stripLine: (first, firstChange, last, lastChange) => `${first}: ${firstChange} · ${last}: ${lastChange}`,
  stripMore: "more",
  stripLess: "less",
  stripOutside: "Not spread over the income groups:",
  stripNone: "None of it can be spread over income groups.",
  detailTitle: "By income group",
  columnGroup: "Group",
  columnPerUnit: (perUnit) => `On average ${perUnit} a year`,
  columnTotal: "In all",
  teaserLink: "Who pays",
  teaserToday: (group, share, scope) => `${group}: ${share} of the part that can be spread over groups (${lower(scope)})`,
  teaserChanged: (group, now, today, scope) =>
    `${group}: ${now} instead of ${today} of the part that can be spread over groups (${lower(scope)}), with the measures`,
};
