import type { DebtIntroFacts, DebtLeadText, DebtMessages, PhaseWords } from "./messages.ts";

function intro({ baseYear, plan }: DebtIntroFacts): string {
  if (!plan) {
    return `This is how debt and interest would develop if the budget of ${baseYear} kept its size relative to the economy.`;
  }
  return `Up to ${plan.until}, debt and growth follow the official plan “${plan.label}”. After that, the budget before interest keeps the share of economic output it has in ${plan.until}, and the assumptions apply.`;
}

function when({ start, startYear, full, last }: PhaseWords): string {
  if (last !== undefined && startYear > last) return `from ${start}, after the end of the calculation`;
  if (full === undefined) return `from ${start}`;
  if (last !== undefined && full > last) return `from ${start}, in full only from ${full}, after the end of the calculation`;
  return `from ${start}, in full from ${full}`;
}

function lead(f: DebtLeadText): string {
  const measures = f.interestWithout !== undefined;
  const sentences: string[] = [];
  if (f.paidOff !== undefined) {
    sentences.push(
      `At ${f.rate} interest on new debt, the debt would be paid off by ${f.paidOff}${measures ? " with the measures switched on" : ""}, and no interest would be due after that.`,
    );
    sentences.push(
      measures
        ? `Without the measures the state would have to spend ${f.interestWithout} of all its revenue on interest in ${f.year}; in ${f.baseYear} it was ${f.interestToday}.`
        : `In ${f.baseYear}, ${f.interestToday} of all revenue went on interest.`,
    );
  } else if (f.negative) {
    sentences.push(
      `At ${f.rate} interest on new debt, the state would receive interest in ${f.year} instead of paying it${measures ? ", with the measures switched on" : ""}: ${f.interest} of its revenue. In ${f.baseYear} it paid ${f.interestToday}.`,
    );
  } else {
    sentences.push(
      `At ${f.rate} interest on new debt, the state would have to spend ${f.interest} of all its revenue on interest in ${f.year}` +
        (measures ? " with the measures switched on" : "") +
        (f.range ? ` (${f.range}, depending on the estimates)` : "") +
        (measures ? `, and ${f.interestWithout} without them` : "") +
        `; in ${f.baseYear} it was ${f.interestToday}.`,
    );
  }
  if (f.paidOff === undefined) {
    sentences.push(
      `Its debt would be ${f.debt} of economic output (GDP)` +
        (f.debtWithout !== undefined ? `, ${f.debtWithout} without the measures` : "") +
        `; in ${f.baseYear} it was ${f.debtToday}.`,
    );
  }
  if (f.overtakes) {
    const { label, since } = f.overtakes;
    sentences.push(
      since === f.baseYear
        ? `Already in ${since}, interest cost more than everything the state spends on ${label}.`
        : measures
          ? `With the measures, interest would cost more than everything the state spends on ${label} from ${since}.`
          : `From ${since}, interest would cost more than everything the state spends on ${label}.`,
    );
  }
  return sentences.join(" ");
}

export const debtEn: DebtMessages = {
  title: "Where this leads: debt and interest",
  caveat: "A what-if calculation, not a forecast.",
  intro,
  lead,
  wholeState: (level) =>
    `The budget view above shows only “${level}”. This calculation is for the whole state all the same, with all the measures switched on.`,
  announce: (year, interest, without) =>
    without === undefined
      ? `Interest in ${year}: ${interest} of all revenue.`
      : `Interest in ${year}: ${interest} of all revenue with the measures, ${without} without them.`,

  figures: {
    interest: (year) => `Interest in ${year}`,
    interestUnit: "of all revenue",
    debt: (year) => `Debt in ${year}`,
    debtUnit: "of economic output (GDP)",
    withMeasures: "with the measures switched on",
    withMeasuresBy: (year) => `with the measures switched on, as far as they act by ${year}`,
    noMeasures: "no measure switched on",
    rate: (rate) => `at ${rate} interest on new debt`,
    range: (range) => `${range}, depending on the estimates`,
    without: (value) => `without the measures: ${value}`,
    inYear: (year, value) => `${year}: ${value}`,
  },
  timing: {
    from: (year, measuresOn) =>
      measuresOn
        ? `In this calculation measures act from ${year}; until then the path with measures is the path without them.`
        : `Measures that are switched on act in this calculation from ${year}.`,
    why: (year) => `Why from ${year}?`,
    laterTitle: "Acting later or step by step:",
    when,
  },
  teaserLink: (year) => `Where does this lead? Debt and interest to ${year}`,
  teaserFigure: (year, interest, without, baseYear, today) =>
    without === undefined
      ? `Interest in ${year}: ${interest} of all revenue (${baseYear}: ${today})`
      : `Interest in ${year}: ${interest} of all revenue with your measures, ${without} without (${baseYear}: ${today})`,
  footerLink: "Debt and interest",

  loading: "Loading the charts and assumptions …",
  loadFailed: "The charts could not be loaded. Perhaps there is no connection at the moment.",
  retry: "Try again",
  show: "Show the charts and assumptions",
};
