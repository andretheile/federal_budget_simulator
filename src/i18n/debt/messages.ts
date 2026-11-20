/**
 * Texts of the debt and interest projection: the section after the waterfall, the line that points
 * to it from the top of the page and its link in the footer. In two parts: what the first page
 * needs (DebtMessages, in the main dictionary) and what comes with the section's body
 * (DebtBodyMessages, in body-de.ts and body-en.ts). The figures, labels, notes and
 * sources come from the pack's debt.json; everything said in words is here, once per language.
 *
 * Plain words: "Zinsen", "Schulden", "Anteil an allen Einnahmen". Where a term is needed, it is
 * explained on the spot.
 */
import type { DebtAssumptionId } from "../../engine/index.ts";

/** The facts of the opening sentence, already formatted. */
export interface DebtLeadText {
  /** The last year of the horizon. */
  year: number;
  baseYear: number;
  /** The market rate on new debt, e.g. "3,4 %". */
  rate: string;
  /** Interest as a share of all revenue in the last year: with the measures, or without if they change nothing. Never signed. */
  interest: string;
  /** Interest is negative in the last year: the state receives it. `interest` is then the amount received. */
  negative: boolean;
  /** Without the measures, when they change the projection. */
  interestWithout?: string;
  /** The range of the measures' estimates for `interest`, already joined ("5,8 bis 6,5 %"). */
  range?: string;
  interestToday: string;
  /** Debt as a share of GDP. */
  debt: string;
  debtWithout?: string;
  debtToday: string;
  /** The year the debt is paid off, if within the horizon. */
  paidOff?: number;
  /** The largest compared item that interest is above in the last year, and since when. */
  overtakes?: { label: string; since: number };
}

/** What the section's introduction says the calculation starts from. When measures act is said apart (DebtMessages.timing). */
export interface DebtIntroFacts {
  baseYear: number;
  /** The plan the projection follows, by its label, and its last year; absent on the base year's budget. */
  plan?: { label: string; until: number };
}

/**
 * When a measure acts in the projection, ready to be put into words: its start (a year, or month and
 * year where it starts within a year), the first year it is in full if it builds up, and the last
 * year of the calculation, after which nothing is counted.
 */
export interface PhaseWords {
  /** "2032", or "Juli 2027" / "July 2027". */
  start: string;
  startYear: number;
  /** The first whole year in full, if the measure builds up; absent if it is in full at once. */
  full?: number;
  /** The last year of the calculation; absent where none applies (on a card). */
  last?: number;
}

/**
 * What the first page says about the projection: the section's heading and opening sentence, the
 * line near the top that leads to it, its link in the footer, and what stands there while the rest
 * loads. Part of the main dictionary (Messages.debt).
 */
export interface DebtMessages {
  title: string;
  /** Right under the heading, before the figures: that this is a what-if calculation, not a forecast. */
  caveat: string;
  /** Under the charts: where the calculation starts from (a plan, or the base year's budget). */
  intro(facts: DebtIntroFacts): string;
  /** The sentence that opens the section: what share of revenue goes on interest at the end, against today. */
  lead(facts: DebtLeadText): string;
  /** Said when the budget view is filtered to one level; `level` is its name. */
  wholeState(level: string): string;
  /**
   * The two figures above the sentence, each with its own label: what and which year, under which
   * condition (with the measures switched on or none, at which rate on new debt), and beside it the
   * value without the measures, the range and the base year's value. The same values as the sentence.
   */
  figures: {
    interest(year: number): string;
    interestUnit: string;
    debt(year: number): string;
    debtUnit: string;
    withMeasures: string;
    /** With measures switched on of which at least one is not yet in full in the last year. */
    withMeasuresBy(year: number): string;
    noMeasures: string;
    rate(rate: string): string;
    range(range: string): string;
    without(value: string): string;
    inYear(year: number, value: string): string;
  };
  /** When measures act in the projection: the first year for all of them, and those that act later or build up. */
  timing: {
    /** The first year measures can act; with measures switched on, also that the two paths are one before it. */
    from(year: number, measuresOn: boolean): string;
    /** The summary that opens the pack's reason for that year. */
    why(year: number): string;
    /** Above the list of switched-on measures that start later or build up. */
    laterTitle: string;
    /** "ab 2032, voll ab 2059": when one measure acts. */
    when(phase: PhaseWords): string;
  };
  /** Short version of the lead for screen readers after a change. */
  announce(year: number, interest: string, without: string | undefined): string;

  /** The line near the top of the page that leads to the section. */
  teaserLink(year: number): string;
  teaserFigure(year: number, interest: string, without: string | undefined, baseYear: number, today: string): string;
  /** Link in the footer. */
  footerLink: string;

  /** While the charts and controls are on their way. */
  loading: string;
  loadFailed: string;
  retry: string;
  /** Where the browser cannot tell when the section comes into view: a button that loads it. */
  show: string;
}

/**
 * The texts of the section's body: charts, assumptions, lists, table and sources. They are loaded
 * with the body's code (see body.ts), not with the first page.
 */
export interface DebtBodyMessages {
  // --- assumptions ---
  assumptions: string;
  presets: string;
  /** Said above the note of the preset that applies. */
  presetChosen(label: string): string;
  reset: string;
  resetHint: string;
  /** One or two plain sentences under each slider. `refinanced` is the share of the debt refinanced each year. */
  explain: Record<DebtAssumptionId, (refinanced: string) => string>;
  whereFrom: string;

  // --- charts ---
  interestTitle: string;
  interestOfRevenue: string;
  interestOfGdp: string;
  unitLabel: string;
  unitRevenue: string;
  unitGdp: string;
  debtTitle: string;
  debtOfGdp: string;
  legend: {
    with: string;
    without: string;
    /** The only path when measures are switched on but change nothing. */
    same: string;
    range: string;
    reference: string;
  };
  /** Name of the year control of a chart. */
  chartControl(title: string): string;
  keys: string;
  readout(year: number, parts: readonly string[]): string;
  readoutPart(label: string, value: string): string;
  /** A value with its amount in money, e.g. "7,0 % (233,5 Mrd. €)". */
  withAmount(share: string, amount: string): string;
  /** A reference value above the top of the chart. */
  offScale(label: string, value: string): string;
  /** The value of an official projection in the line above a chart. */
  planPart(value: string): string;
  /** Next to the line where the followed plan ends: the years after it are the assumptions'. */
  continued(fromYear: number): string;

  // --- the starting point ---
  startTitle: string;
  /** The option of following the pack's one plan, to its last year. */
  startPlan(until: number): string;
  startPlanNote(label: string, until: number): string;
  /** The option of continuing the base year's budget. */
  startBase(baseYear: number): string;
  startBaseNote(baseYear: number): string;
  /** Marks the option that is the pack's own. */
  startDefault: string;

  // --- official plans ---
  plansTitle: string;
  /**
   * The difference between the calculation at its defaults and a comparable official projection:
   * the calculation continues the base year's budget, the projection starts from what has been
   * decided since. Ratios already formatted.
   */
  plansIntro(facts: { baseYear: number; year: number; plan: string; model: string; followed: boolean }): string;
  /** Where a comparable projection is drawn: on the path while the projection follows it, dashed otherwise. */
  planInChart(followed: boolean): string;
  /** Whose finances a plan describes and in which accounts; `level` is null for the whole state. */
  planScope(level: string | null, cash: boolean): string;
  /** Said of a plan that cannot be set against the calculation. */
  planNotComparable: string;
  /** Row names of a plan's figures. */
  planFields: { debtRatio: string; balanceRatio: string; interestRatio: string; interestToRevenue: string; interest: string };
  planCaption(label: string): string;
  /** Summary of the disclosure with a plan's note, quality and sources. */
  planMore: string;

  // --- budget items ---
  comparisonsTitle: string;
  comparisonsNote(baseYear: number): string;
  itemToday(baseYear: number, amount: string, share: string): string;
  itemWith(amount: string, share: string): string;
  /** When interest is above the item, base year included. */
  crossing: {
    already(baseYear: number): string;
    since(year: number): string;
    never(lastYear: number): string;
    /** Above from `first` on, no longer from `drop` on. */
    between(first: number, drop: number, baseYear: number): string;
  };
  /** Both paths: "mit den Maßnahmen: …; ohne: …". */
  bothPaths(withText: string, withoutText: string): string;

  // --- reference values ---
  referencesTitle: string;
  referencesNote: string;
  referenceName(label: string, year: number | undefined): string;
  /** Interest as a share of all revenue, e.g. "Zinsen 15,0 % der Einnahmen". */
  referenceInterestRevenue(value: string): string;
  referenceInterest(value: string): string;
  referenceDebt(value: string): string;
  reach: {
    already(baseYear: number): string;
    year(year: number): string;
    never(lastYear: number): string;
  };

  // --- limits ---
  limitsTitle: string;
  /** `levels` is the list of the pack's levels of government, already joined. */
  levelsNote(levels: string): string;
  /** Joins the names of the levels: "Bund, Länder und Gemeinden". */
  list(items: readonly string[]): string;

  // --- where the figures come from ---
  basisTitle: string;
  stock(year: number): string;
  stockValue(amount: string, share: string): string;
  interest(year: number): string;
  interestValue(amount: string, share: string): string;
  refinancing: string;
  refinancingValue(share: string, maturity: string | undefined): string;

  // --- table ---
  tableTitle: string;
  tableCaption: string;
  year: string;
  path: string;
  without: string;
  with: string;
  interestShareRevenue: string;
  interestShareGdp: string;
  interestAmount: string;
  debtShareGdp: string;
  debtAmount: string;
  tableNote: string;
  /** In the phone table: a share of all revenue, e.g. "7,0 % der Einnahmen". */
  ofRevenue(share: string): string;
}
