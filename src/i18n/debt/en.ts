import type { DebtIntroFacts, DebtLeadText, DebtMessages, PhaseWords } from "./messages.ts";

function intro({ baseYear, plan }: DebtIntroFacts): string {
  if (!plan) {
    return `This is how debt and interest would develop if the budget of ${baseYear} kept its size relative to the economy.`;
  }
  const after = `After that, the budget before interest keeps the share of economic output it has in ${plan.until}`;
  if (plan.by === "balance") {
    return `Up to ${plan.until}, the budget before interest follows the official plan “${plan.label}”, and so does growth where the plan gives it; interest and debt come from the assumptions. ${after}, and growth too comes from the assumptions.`;
  }
  if (plan.by === "mixed") {
    return `Up to ${plan.until}, the calculation follows the official plan “${plan.label}”: its debt in the years it gives one, otherwise its budget before interest, with interest and debt from the assumptions; growth follows the plan where it gives it. ${after}, and the assumptions apply.`;
  }
  return `Up to ${plan.until}, debt and growth follow the official plan “${plan.label}”. ${after}, and the assumptions apply.`;
}

function when({ start, startYear, full, fullName, horizonEnd, once, until }: PhaseWords): string {
  const after = horizonEnd !== undefined && startYear > horizonEnd ? ", after the end of the calculation" : "";
  if (once !== undefined) return `once, in ${once}${after}`;
  if (until !== undefined) return `from ${start} to ${until}${after}`;
  if (after) return `from ${start}${after}`;
  const fullText = fullName ?? full;
  if (full === undefined) return `from ${start}`;
  if (horizonEnd !== undefined && full > horizonEnd) return `from ${start}, in full only from ${fullText}, after the end of the calculation`;
  return `from ${start}, in full from ${fullText}`;
}

function lead(f: DebtLeadText): string {
  const measures = f.interestWithout !== undefined;
  const sentences: string[] = [];
  // A state of several levels is "the state"; a budget of one level is not named here (see messages.ts).
  if (f.paidOff !== undefined) {
    sentences.push(
      `At ${f.rate} interest on new debt, the debt would be paid off by ${f.paidOff}${measures ? " with the measures switched on" : ""}, and no interest would be due after that.`,
    );
    sentences.push(
      measures
        ? f.state
          ? `Without the measures the state would have to spend ${f.interestWithout} of all its revenue on interest in ${f.year}; in ${f.baseYear} it was ${f.interestToday}.`
          : `Without the measures, ${f.interestWithout} of all revenue would go on interest in ${f.year}; in ${f.baseYear} it was ${f.interestToday}.`
        : `In ${f.baseYear}, ${f.interestToday} of all revenue went on interest.`,
    );
  } else if (f.negative) {
    sentences.push(
      f.state
        ? `At ${f.rate} interest on new debt, the state would receive interest in ${f.year} instead of paying it${measures ? ", with the measures switched on" : ""}: ${f.interest} of its revenue. In ${f.baseYear} it paid ${f.interestToday}.`
        : `At ${f.rate} interest on new debt, interest would come in instead of going out in ${f.year}${measures ? ", with the measures switched on" : ""}: ${f.interest} of revenue. In ${f.baseYear}, ${f.interestToday} of revenue went on interest.`,
    );
  } else {
    sentences.push(
      (f.state
        ? `At ${f.rate} interest on new debt, the state would have to spend ${f.interest} of all its revenue on interest in ${f.year}`
        : `At ${f.rate} interest on new debt, ${f.interest} of all revenue would go on interest in ${f.year}`) +
        (measures ? " with the measures switched on" : "") +
        (f.range ? ` (${f.range}, depending on the estimates)` : "") +
        (measures ? `, and ${f.interestWithout} without them` : "") +
        `; in ${f.baseYear} it was ${f.interestToday}.`,
    );
  }
  if (f.paidOff === undefined) {
    sentences.push(
      `${f.state ? "Its" : "The"} debt would be ${f.debt} of economic output (GDP)` +
        (f.debtWithout !== undefined ? `, ${f.debtWithout} without the measures` : "") +
        `; in ${f.baseYear} it was ${f.debtToday}.`,
    );
  }
  if (f.overtakes) {
    const { label, since, already } = f.overtakes;
    const item = f.state ? `everything the state spends on ${label}` : `all spending on ${label}`;
    sentences.push(
      already
        ? `Already in ${since}, interest cost more than ${item}.`
        : measures
          ? `With the measures, interest would cost more than ${item} from ${since}.`
          : `From ${since}, interest would cost more than ${item}.`,
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
    withMeasuresEnded: (year, notYet, all) =>
      notYet
        ? `with the measures switched on, as far as they act by ${year} (some have ended by then)`
        : all
          ? "with the measures switched on, which have ended by then"
          : "with the measures switched on, some of which have ended by then",
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
    laterTitle: (ending) => (ending ? "Acting later, step by step, once or for a limited time:" : "Acting later or step by step:"),
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
