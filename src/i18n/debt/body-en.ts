import type { DebtPlanAccounts } from "../../engine/index.ts";
import type { DebtBodyMessages } from "./messages.ts";

/** In which accounts a budget or a plan is counted, after "in" or as its own clause. */
const ACCOUNTS: Record<DebtPlanAccounts, string> = {
  national_accounts: "in national accounts",
  cash: "in cash",
  budget: "in the budget's own accounts",
};

export const debtBodyEn: DebtBodyMessages = {
  assumptions: "Assumptions",
  presets: "Presets",
  presetChosen: (label) => `Chosen: ${label}`,
  reset: "Reset assumptions",
  resetHint: "Set all assumptions back to their defaults",
  explain: {
    market_rate: (refinanced, state) =>
      state
        ? `The rate at which the state borrows new money and replaces loans that fall due: ${refinanced} of the debt each year. The rest keeps its old rate until it runs out.`
        : `The rate on new borrowing and on the loans that fall due and are replaced: ${refinanced} of the debt each year. The rest keeps its old rate until it runs out.`,
    growth: () => "Nominal means including inflation. The faster the economy grows, the less the debt weighs relative to it.",
    horizon: () => "How many years the calculation looks ahead.",
    drift: () =>
      "The budget before interest gets better (plus) or worse (minus) by this share of economic output every year, for example because pensions, health and care grow faster than the economy.",
  },
  whereFrom: "Where the default comes from",

  interestTitle: "Interest",
  interestOfRevenue: (state) => (state ? "as a share of all the state's revenue" : "as a share of all revenue"),
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
  yearsNote: (year, start, end) => `The years are fiscal years, as in the budget: ${year} runs from ${start} to ${end}.`,
  readout: (year, parts) => `${year}: ${parts.join(" · ")}`,
  readoutPart: (label, value) => `${label} ${value}`,
  withAmount: (share, amount) => `${share} (${amount})`,
  offScale: (label, value) => `${label} ${value}\u00a0↑`,
  planPart: (value) => `official plan ${value}`,
  continued: (fromYear, by) => (by === "debt" ? `from ${fromYear} by the assumptions` : `from ${fromYear} without the plan`),

  startTitle: "Starting point",
  startPlan: (until) => `Official plan to ${until}`,
  startPlanNote: (label, until, by) =>
    by === "debt"
      ? `Up to ${until}, debt and growth follow the official plan “${label}”, with what had been decided by the time it was made; after that the assumptions apply.`
      : by === "balance"
        ? `Up to ${until}, the budget before interest and growth follow the official plan “${label}”, with what had been decided by the time it was made; interest and debt come from the assumptions, and after that everything does.`
        : `Up to ${until}, the calculation follows the official plan “${label}”, with what had been decided by the time it was made: its debt where it gives one, otherwise its budget before interest; after that the assumptions apply.`,
  startBase: (baseYear) => `Continue the ${baseYear} budget`,
  startBaseNote: (baseYear) =>
    `The budget of ${baseYear} keeps its share of economic output from the first year on; what has been decided since is missing.`,
  startDefault: "default",

  plansTitle: "Official plans",
  plansIntro: ({ baseYear, year, plan, model, followed }) =>
    (followed ? `The calculation starts from this plan up to ${year}. ` : "") +
    `With the budget of ${baseYear} continued, debt without measures would reach ${model} of GDP in ${year}; this plan arrives at ${plan}: it includes what has been decided since ${baseYear}. What it calculates differently is set out in its note.`,
  planInChart: (followed, by) =>
    !followed
      ? by === "balance"
        ? "Drawn in the interest chart as a dashed line, with diamonds at the years it gives figures for; it gives no debt."
        : "Drawn in the charts as a dashed line, with diamonds at the years it gives figures for."
      : by === "debt"
        ? "In the charts, the diamonds on the path without measures, which follows its figures up to then."
        : by === "balance"
          ? "The path without measures takes its budget before interest; its interest is the model's, at the assumed rates. So the plan's own interest is drawn beside it, as a dashed line with diamonds; it gives no debt."
          : "In the debt chart, its debt as diamonds on the path without measures, which meets them; its interest, in the interest chart, as a dashed line with diamonds beside the path, whose interest is the model's.",
  planScope: (level, accounts, state) =>
    `${level === null ? (state ? "Covers the whole state" : "Covers the whole budget") : `Covers only the level “${level}”`}${
      accounts === "cash" ? " and is counted in cash" : `, ${ACCOUNTS[accounts]}`
    }.`,
  planNotComparable: (accounts, state) =>
    `The calculation above describes ${state ? "the whole state" : "the whole budget"} ${ACCOUNTS[accounts]}. These figures cannot be compared with it, so they are not in the charts.`,
  planFields: {
    debtRatio: "Debt, share of GDP",
    balanceRatio: "Balance, share of GDP",
    interestRatio: "Interest, share of GDP",
    interestToRevenue: "Interest, share of all revenue",
    interest: "Interest",
  },
  planMore: "Note, data quality and sources",
  planCaption: (label) => `Figures: ${label}`,

  comparisonsTitle: "When interest costs more than …",
  comparisonsNote: (baseYear, state) =>
    `Each item keeps its share of economic output of ${baseYear}.${state ? " Amounts for the whole state." : ""}`,
  itemToday: (baseYear, amount, share) => `${baseYear}: ${amount}, ${share} of GDP`,
  itemWith: (amount, share) => `with the measures: ${amount}, ${share} of GDP`,
  crossing: {
    already: (baseYear) => `already in ${baseYear}`,
    since: (year) => `from ${year}`,
    never: (lastYear) => `not by ${lastYear}`,
    between: ({ first, lastAbove, drop, fromBase }) => (fromBase ? `in ${first}, no longer from ${drop}` : `from ${first} to ${lastAbove}`),
  },
  bothPaths: (withText, withoutText) => `with the measures ${withText}, without ${withoutText}`,

  referencesTitle: "For comparison",
  referencesNote: "Figures of other countries and earlier years, and when the calculation reaches them.",
  referenceName: (label, year) => (year === undefined ? label : typeof year === "number" ? `${label} ${year}` : `${label}, ${year}`),
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
  covers: (what) => `This calculation covers ${what}.`,
  oneLevel: (level) => `This calculation covers the budget of one level of government, “${level}”, and its debt.`,
  list: (items) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`),

  basisTitle: "Where the figures come from",
  stock: (year, end) => (end === undefined ? `Debt at the end of ${year}` : `Debt at the end of ${year} (${end})`),
  stockValue: (amount, share) => `${amount}, ${share} of GDP`,
  interest: (year) => `Interest in ${year}`,
  interestValue: (amount, share) => `${amount}, ${share} of GDP`,
  refinancing: "Refinanced every year",
  refinancingValue: (share, maturity) =>
    maturity === undefined ? `${share} of the debt` : `${share} of the debt; the loans have ${maturity} left to run on average`,
  maturity: "Average time to maturity",

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
