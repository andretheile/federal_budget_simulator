import type { DebtBodyMessages } from "./messages.ts";

export const debtBodyEn: DebtBodyMessages = {
  assumptions: "Assumptions",
  presets: "Presets",
  presetChosen: (label) => `Chosen: ${label}`,
  reset: "Reset assumptions",
  resetHint: "Set all assumptions back to their defaults",
  explain: {
    market_rate: (refinanced) =>
      `The rate at which the state borrows new money and replaces loans that fall due: ${refinanced} of the debt each year. The rest keeps its old rate until it runs out.`,
    growth: () => "Nominal means including inflation. The faster the economy grows, the less the debt weighs relative to it.",
    horizon: () => "How many years the calculation looks ahead.",
    drift: () =>
      "The budget before interest gets better (plus) or worse (minus) by this share of economic output every year, for example because pensions, health and care grow faster than the economy.",
  },
  whereFrom: "Where the default comes from",

  interestTitle: "Interest",
  interestOfRevenue: "as a share of all the state's revenue",
  interestOfGdp: "as a share of economic output (GDP)",
  unitLabel: "Show interest as",
  unitRevenue: "Share of all revenue",
  unitGdp: "Share of GDP",
  debtTitle: "Debt",
  debtOfGdp: "as a share of economic output (GDP)",
  legend: {
    with: "with the measures",
    without: "without measures",
    same: "the same with and without the measures",
    range: "range of the estimates",
    reference: "reference value",
  },
  chartControl: (title) => `${title}, year by year`,
  keys: "Arrow keys: one year on or back. Page Up, Page Down: five years. Home, End: first and last year.",
  readout: (year, parts) => `${year}: ${parts.join(" · ")}`,
  readoutPart: (label, value) => `${label} ${value}`,
  withAmount: (share, amount) => `${share} (${amount})`,
  offScale: (label, value) => `${label} ${value}\u00a0↑`,

  comparisonsTitle: "When interest costs more than …",
  comparisonsNote:
    "Each item keeps its share of economic output, as all spending does in this calculation. Amounts for the whole state.",
  itemToday: (baseYear, amount, share) => `${baseYear}: ${amount}, ${share} of GDP`,
  itemWith: (amount, share) => `with the measures: ${amount}, ${share} of GDP`,
  crossing: {
    already: (baseYear) => `already in ${baseYear}`,
    since: (year) => `from ${year}`,
    never: (lastYear) => `not by ${lastYear}`,
    between: (first, drop, baseYear) => (first === baseYear ? `in ${baseYear}, no longer from ${drop}` : `from ${first} to ${drop - 1}`),
  },
  bothPaths: (withText, withoutText) => `with the measures ${withText}, without ${withoutText}`,

  referencesTitle: "For comparison",
  referencesNote: "Figures of other countries and earlier years, and when the calculation reaches them.",
  referenceName: (label, year) => (year === undefined ? label : `${label} ${year}`),
  referenceInterestRevenue: (value) => `interest ${value} of revenue`,
  referenceInterest: (value) => `interest ${value} of GDP`,
  referenceDebt: (value) => `debt ${value} of GDP`,
  reach: {
    already: (baseYear) => `above it already in ${baseYear}`,
    year: (year) => `reached in ${year}`,
    never: (lastYear) => `not reached by ${lastYear}`,
  },

  limitsTitle: "What the calculation assumes and what it leaves out",
  levelsNote: (levels) => `The calculation is for the whole state: ${levels}.`,
  list: (items) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`),

  basisTitle: "Where the figures come from",
  stock: (year) => `Debt at the end of ${year}`,
  stockValue: (amount, share) => `${amount}, ${share} of GDP`,
  interest: (year) => `Interest in ${year}`,
  interestValue: (amount, share) => `${amount}, ${share} of GDP`,
  refinancing: "Refinanced every year",
  refinancingValue: (share, maturity) =>
    maturity === undefined ? `${share} of the debt` : `${share} of the debt; the loans have ${maturity} left to run on average`,

  tableTitle: "The figures as a table",
  tableCaption: "Interest and debt in selected years",
  year: "Year",
  path: "Measures",
  without: "without",
  with: "with",
  interestShareRevenue: "Interest: share of all revenue",
  interestShareGdp: "Interest: share of GDP",
  interestAmount: "Interest",
  debtShareGdp: "Debt: share of GDP",
  debtAmount: "Debt",
  tableNote: "Amounts at the prices of each year, that is including inflation.",
  ofRevenue: (share) => `${share} of revenue`,
};
