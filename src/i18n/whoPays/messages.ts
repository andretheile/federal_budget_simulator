/**
 * Texts of "Who pays": the section under the budget, the strip on a measure's card and in the curve
 * editor, and the line near the top that leads to the section. Groups, payers, scopes, the ranking
 * and every note come from the pack's incidence.json; what is said in words is here.
 *
 * Plain words: "zahlt", "hat", "je Person". No "Inzidenz", no "Dezil". A group paying more is
 * neither good nor bad: "zahlt mehr", "zahlt weniger", never the words of the balance.
 *
 * Shares come formatted ("16,4 %"), points of change formatted and signed ("+0,6"), amounts
 * formatted ("42,2 Mrd. €"). `scope` is the scope's label as the pack writes it ("Steuern"), `unit`
 * the population's units ("Menschen"), `perUnit` how an amount per unit is written ("je Person").
 */
import type { YearName } from "../messages.ts";

export interface WhoPaysMessages {
  title: string;
  /** Under the heading: what the section shows. */
  intro: string;
  /** The switch between the scopes: its name for screen readers. */
  scopes: string;
  /**
   * The opening sentence: how much of the scope can be spread over the groups (every share below is a
   * share of that), then what the top and the bottom group pay of it and have of income; with measures
   * `pays` is `instead`'s "17,0 % statt 16,4 %".
   */
  headline(scope: string, spread: string, total: string, top: string, topPays: string, topHas: string, bottom: string, bottomPays: string, bottomHas: string): string;
  /** Name of the list of groups, for screen readers. */
  listLabel(scope: string): string;
  /** A group's lower bound: "ab 28.800 € im Jahr". */
  from(amount: string): string;
  /** "zahlt 16,4 %": of the part spread over the groups, which the opening sentence names. */
  pays(share: string): string;
  /** "hat 9,9 % der Einkommen" */
  has(share: string): string;
  /** "das sind 31 % ihres Einkommens" */
  ofIncome(share: string): string;
  /** With measures: "zahlt 17,0 % statt 16,4 %" */
  paysChanged(now: string, today: string): string;
  /** The change in points: "+0,6 Punkte". */
  points(signed: string): string;
  /** The change per unit and year, an average, in words: "zahlt im Schnitt 120 € mehr je Person und Jahr". */
  perUnitChange(amount: string, more: boolean, perUnit: string): string;
  /** A group whose amount does not change. */
  same: string;
  /** What the marks mean. */
  key(year: YearName): string;
  /** A share with measures against today: "17,0 % statt 16,4 %". */
  instead(now: string, today: string): string;
  /** Where the lower bounds are given: what they are, in the pack's words. */
  ranking(text: string): string;
  /** The rest of the scope, not in the chart, which the statement shows by who pays it. */
  outside(amount: string): string;
  /** The statement of all revenue. */
  statementTitle: string;
  statementIntro(total: string): string;
  /** The line of the income groups together. */
  groupsLine: string;
  /** Which part of the groups' line the chart covers. */
  chartCovers(scope: string, amount: string): string;
  /** "heute 1.388,6 Mrd. €" after a line's amount with measures. */
  today(amount: string, year: YearName): string;
  total: string;
  /** Opens the nodes behind a line. */
  itemsOf(label: string): string;
  /** Under the chart: the measures it counts, and those whose change lands with payers. */
  counted(list: string): string;
  notCounted: string;
  /** One measure whose change lands with payers: "Körperschaftsteuer (Unternehmen 42,2 Mrd. € mehr)". */
  outsideMeasure(measure: string, payers: string): string;
  /** A payer's change: "Unternehmen 42,2 Mrd. € mehr". */
  payerChange(payer: string, amount: string, more: boolean): string;
  /** How it is calculated. */
  methodTitle: string;
  /** The schedule of a measure is computed from a distribution: what that means, in the pack's words. */
  computed(text: string): string;
  quality: string;
  sources: string;
  /** The strip on a card and in the curve editor. */
  stripTitle(perUnit: string): string;
  /** The face's line: the first and the last group. */
  stripLine(first: string, firstChange: string, last: string, lastChange: string): string;
  /** A change per unit, signed, with the words: "+120 €" with "mehr". */
  stripMore: string;
  stripLess: string;
  /** Before the payers' changes: "Nicht auf die Einkommensgruppen verteilt:". */
  stripOutside: string;
  /** The strip when nothing is spread over the groups. */
  stripNone: string;
  /** In a card's details and the curve editor: the heading of the table by group ("Nach Einkommensgruppen"). */
  detailTitle: string;
  /** The column heads of the strip's table. */
  columnGroup: string;
  columnPerUnit(perUnit: string): string;
  columnTotal: string;
  /** The line near the top. */
  teaserLink: string;
  teaserToday(group: string, share: string, scope: string): string;
  teaserChanged(group: string, now: string, today: string, scope: string): string;
}
