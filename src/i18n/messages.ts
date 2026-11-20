/**
 * Shape of a UI dictionary. Every user-visible string of the interface that does not come from a
 * country pack lives here, once per language. Texts with numbers or names in them are functions,
 * so each language can order and inflect them as it needs.
 */
import type { Catch, LevelId, PolicyTopic, Quality, WarningCode } from "../engine/index.ts";
import type { LegalMessages } from "./legal/messages.ts";
import type { DebtMessages } from "./debt/messages.ts";

export type IndicatorId = "gdp" | "population" | "households" | "grossDebt";

/**
 * The base year as the texts name it: the number, or the pack's short name where the bare number
 * would mislead ("FY 2025", "Haushaltsjahr 2025"; country.json `baseYearShort`). Charts and tables
 * of later years always use numbers.
 */
export type YearName = number | string;

/**
 * What a slider's baseline is called: the base year (its number or short name), or the baseline's
 * own name where it is not the base year's value (a param's baselineLabel, "Geltendes Recht"),
 * which the texts quote.
 */
export type SliderBase = YearName | { named: string };

export interface Messages {
  app: {
    name: string;
    tagline: string;
    /** The tagline of a pack without measures yet: the budget is all there is to see. */
    taglineOverview: string;
    loading: string;
    skipToContent: string;
    title(country: string, year: YearName): string;
    countryYear(country: string, year: number): string;
    /** The country with the pack's own name for its base year, such as a fiscal year. */
    countryPeriod(country: string, period: string): string;
  };
  dev: {
    /** On the page of a pack that marks itself as a preview: not live yet. */
    preview: string;
    badge: string;
    /** Why the fixture is shown: the wanted pack is invalid, there is none, or it was asked for. */
    invalid(packId: string): string;
    noPack: string;
    fixture: string;
    errors(count: number): string;
  };
  /** The row in the floating band that leads to the sections where the page has one column. */
  nav: {
    /** Name of the navigation landmark. */
    label: string;
    measures: string;
    budget: string;
    debt: string;
  };
  header: {
    level: string;
    allLevels: string;
    language: string;
    country: string;
    /** After a country's name in the switch, for a pack that is not live yet. */
    preview: string;
    share: string;
    shareHint: string;
    copied: string;
    /** Said when the link could not be copied; the link itself is shown below it. */
    copyFailed: string;
    /** Name of the field that then holds the link. */
    linkField: string;
    close: string;
    reset: string;
    resetHint: string;
  };
  common: {
    revenue: string;
    expenditure: string;
    deficit: string;
    surplus: string;
    balanced: string;
    /** The base year as a label, where the old wording said "today": the start of the waterfall. */
    baseYear(year: YearName): string;
    simulated: string;
    perYear: string;
    improves: string;
    worsens: string;
    noEffect: string;
    relieves: string;
    burdens: string;
    noEffectLevel: string;
    unchanged: string;
    sources: string;
    details: string;
    range(low: string, high: string): string;
    lessThan(value: string): string;
    externalLink: string;
    quote(text: string): string;
  };
  scoreboard: {
    label: string;
    balanceLabel(year: YearName): string;
    /** After a change: against the base year, which is not always today. */
    vsBase(year: YearName): string;
    asBase(year: YearName): string;
    /** A pack without measures: only the year the figures are for. */
    asBaseOnly(year: YearName): string;
    measuresOn(count: number): string;
    ofGdp(share: string): string;
    perInhabitant(amount: string): string;
    rangeLabel: string;
    announce(balance: string, state: string, change: string): string;
    levelLabel(level: string, year: YearName): string;
    relief: string;
    burden: string;
    unchanged: string;
    noLevelBalance: string;
    announceLevel(level: string, change: string, state: string, year: YearName): string;
  };
  budget: {
    title(year: YearName): string;
    intro: string;
    introLevel(level: string): string;
    hint: string;
    other(count: number): string;
    gap(kind: "deficit" | "surplus", amount: string): string;
    /** The mark for the base-year value of a bar or a row. */
    baseMark(amount: string, year: YearName): string;
    shareOf(side: "revenue" | "expenditure", share: string): string;
    path: string;
    up: string;
    /** Said after a row that opens the next level, for screen readers. */
    breakDown: string;
    key(year: YearName): string;
    hiddenZero(count: number): string;
    noItems: string;
    quality: string;
    levels: string;
    figureFor(year: number): string;
    listCaption(label: string): string;
  };
  policies: {
    title: string;
    intro: string;
    topic: string;
    /** The first chip of the topic row. */
    allTopics: string;
    /** The first entry of the collection row: every measure of the pack. */
    allMeasures: string;
    topics: Record<PolicyTopic, string>;
    switchOn(label: string): string;
    on: string;
    off: string;
    alone: string;
    aloneLevel(level: string): string;
    combined(amount: string): string;
    combinedHint: string;
    /**
     * Under the card's figure for a measure that acts later or builds up in the debt projection:
     * that the figure is the full effect, and when the projection has it (`when`, from DebtMessages.timing).
     */
    timingLine(when: string): string;
    /**
     * Under the figure, where the range of the estimate reaches the other side of zero: the range,
     * and that the measure may also do the opposite. `opposite`: what it then does ("worsen" the
     * balance or "burden" the level shown, or the reverse), `level`: whether a single level is shown.
     */
    rangeCrossesZero(range: string, opposite: "worsen" | "improve", level: boolean): string;
    /** Heading of the details on when the measure acts. */
    timingTitle: string;
    /** The first sentence of those details; `setting`: the timing depends on a slider, so it is said for its current value. */
    timingDetail(when: string, setting: boolean): string;
    ofAll(side: "revenue" | "expenditure", share: string): string;
    ofLevel(side: "revenue" | "expenditure", share: string): string;
    perInhabitant(amount: string): string;
    ofDeficit(share: string, year: YearName): string;
    meterLabel(share: string, year: YearName): string;
    settings: string;
    settingCount(count: number): string;
    previewHint: string;
    /**
     * A setting's baseline, under its slider. `base` is the base year, or the baseline's own name
     * where it is not the base year's value (the param's baselineLabel, e.g. "Geltendes Recht").
     */
    baseValue(value: string, base: SliderBase): string;
    /** The end of a slider's scale where the baseline lies: "0 % · 2024". */
    baseAtEnd(end: string, base: SliderBase): string;
    /** Name of the button that sets a slider back to its baseline. */
    toBaseValue(value: string, base: SliderBase): string;
    /** How far a setting is from its baseline, for screen readers. */
    changeFromBase(change: string, base: SliderBase): string;
    /** The tag before a setting that is an assumption of the calculation, not a political choice. */
    assumption: string;
    /** Name of the button that shows a setting's value and turns it into a field. */
    typeValue(label: string, value: string): string;
    /** Name of that field. */
    valueField(label: string): string;
    /**
     * Under a choice of groups (the chips), what the chosen ones stand for in the item. Worded for
     * whatever the chips are, nationalities or levels of government: "the selection", not "groups".
     */
    selectedShare(share: string, basis: "spending" | "recipients", item: string): string;
    /** Said before a group's share, for screen readers. */
    groupShare: string;
    /** Under the chips when none is chosen. */
    noGroups: string;
    facts: string;
    rangeFact: string;
    singleValue: string;
    qualityFact: string;
    affected: string;
    affectedValue(count: string, unit: string, share: string): string;
    threshold(variable: string, value: string): string;
    catches: string;
    noCatches: string;
    /** Heading of the limits of the calculation in the details, after the catches; they are not counted among them. */
    limits: string;
    /** Heading of the details on the goal that leaves the measure out: the statement, the full reason and its sources. */
    goalTitle: string;
    catchCount(count: number): string;
    moreCatches(count: number): string;
    severity: Record<Catch["severity"], string>;
    kind: Record<Catch["kind"], string>;
    effects: string;
    /**
     * Many effects are grouped by the setting that drives them, with the largest shown. The button
     * that shows the further ones of a group: how many, and what they do to the balance together.
     */
    moreEffects(count: number, balance: string): string;
    /** The same button once they are shown. */
    fewerEffects: string;
    /** The heading of a group of effects that no setting drives. */
    effectsFixed: string;
    /** Among many effects: what opens an effect's note, its sources, or both. */
    effectNote(note: boolean, sources: boolean): string;
    showInBudget(label: string): string;
    effectSide(side: "revenue" | "expenditure"): string;
    byLevel: string;
    /** Heading of a passed-on part that is a cost reappearing elsewhere, when the pack gives no label. */
    shift: string;
    /** Heading of any other passed-on part (a knock-on effect), when the pack gives no label. */
    knockOn: string;
    /** What happens at the other item, by its side and by whether it goes up or down. */
    shiftLine(amount: string, to: string, side: "revenue" | "expenditure", up: boolean): string;
    /**
     * The two ends of an effect that varies together with the measure's other effects: what it is
     * at the measure's low and at its high end, not a range of its own.
     */
    linkedRange(low: string, high: string): string;
    clampedNote: string;
    warnings: Record<Exclude<WarningCode, "empty_group">, string> & { empty_group(year: YearName): string };
    /** The repeated_exclusion warning when the measures that got there first are known. */
    alreadyExcludedBy(measures: string): string;
    warningItem(item: string): string;
    none: string;
    /** The pack has no measures at all yet. */
    noneInPack: string;
    /** Name of the filter by collection (the pack's named groups of measures), for screen readers. */
    collectionFilter: string;
    /** Said before the badges of the collections a measure belongs to, for screen readers. */
    partOf: string;
    /** Switched-on measures that the filters hide; they count all the same. */
    hiddenOn(count: number): string;
    showAll: string;
  };
  /**
   * The goal bar under the scoreboard: how far the measures switched on go towards a goal of the
   * pack, such as the gap in a financial plan. Amounts come in formatted; every figure is the pack's
   * or the engine's.
   */
  goal: {
    /** The small label before the goal's name. */
    label: string;
    /** The same with the goal's year, where only one line is left (a phone, while scrolling). */
    labelYear(year: number): string;
    /** What a screen reader hears for the picker's label (seen: "Goal · Federal government"); no level: the whole state. */
    scopedLabel(level: string | undefined): string;
    /** The tag of the closed state. */
    closed: string;
    /**
     * The state in one sentence that leads with the figure, then what qualifies it. Where only one
     * line is left (a phone, while scrolling) the first sentence stands alone.
     */
    none(needed: string): string;
    noneWhy: string;
    unchanged(needed: string): string;
    unchangedWhy: string;
    /** Measures change the level's balance, but only on what the goal leaves out. */
    uncountedWhy: string;
    partial(covered: string, remaining: string): string;
    closedBy(covered: string): string;
    surplus(surplus: string): string;
    burden(growth: string, gap: string): string;
    /** Closed at the cautious end of the range as well. */
    cautiousAlso: string;
    /** Closed at the central figure, but not at the cautious end of the range. */
    cautiousMissing(missing: string): string;
    /** Only what reaches the goal's level counts; `level` is the pack's name for it. */
    level(level: string): string;
    /** The goal is about the whole state. */
    wholeState: string;
    /** For a goal of one level: the other levels together are burdened at the same time by `amount`. */
    othersBurden(amount: string): string;
    /** The same where the bar has one line; `amount` is signed. */
    othersShort(amount: string): string;
    /** The details: what the measures do at each level. */
    levelsTitle: string;
    levelsNote: string;
    /** A budget item the goal leaves out, by its name. */
    excludedItem(label: string): string;
    /** A measure the goal leaves out, by its name. */
    excludedPolicy(label: string): string;
    /** The line for one thing left out that is not zero: what it is and its signed amount; the reason follows. */
    excludedOne(what: string, amount: string): string;
    /** One of several things left out, for excludedMany. */
    excludedPart(what: string, amount: string): string;
    /** The line for several things left out, already joined; the reasons are in the details. */
    excludedMany(items: string): string;
    /** The button that leads to the reasons where none is written out: after excludedMany, or after excludedOne or cardExcluded without a short reason. */
    why: string;
    /** The same button after a short reason, where the full reason says more. */
    moreReason: string;
    /** On the card of a measure the goal leaves out; the short reason follows, if there is one. */
    cardExcluded(goal: string): string;
    /** The button that opens the description, the note and the sources. */
    details: string;
    /** What the screen reader hears after a change. */
    announce(goal: string, status: string): string;
    /** The panel with the details. */
    amount: string;
    amountValue(amount: string, year: number): string;
    levelFact: string;
    wholeStateName: string;
    excludedTitle: string;
    noteTitle: string;
    loading: string;
    loadFailed: string;
    retry: string;
  };
  /** The editor for rate curves, and its entry on a measure's card. */
  curve: {
    /** Small caption above the preview on the card. */
    section: string;
    edit: string;
    asBase(year: YearName): string;
    changed: string;
    preset(label: string): string;
    topRate(rate: string, from: string): string;
    /** The notice above the measures when the scenario holds a changed curve. */
    changedTitle(count: number): string;
    show(measure: string): string;
    dialog(measure: string): string;
    close: string;
    /** While the inside of the editor is still on its way. */
    loading: string;
    /** When the inside of the editor could not be loaded, e.g. offline. */
    loadFailed: string;
    retry: string;
    /** What the curve means, in plain words. `currency` is the name of the currency, e.g. "Euro". */
    explain(currency: string): string;
    hint: string;
    /** `base` and `averageBase`: the base year's rates there, if there is a base-year curve. */
    hover(at: string, rate: string, base: string | null, average: string, averageBase: string | null, year: YearName): string;
    point(name: string, at: string, rate: string, average: string, averageBase: string | null, year: YearName): string;
    axisRate: string;
    compressed: string;
    scaleNote(knee: string, max: string): string;
    legend: {
      reform: string;
      base(year: YearName): string;
      average: string;
      distribution: string;
      examples: string;
    };
    pointRole: string;
    pointName(index: number, count: number): string;
    keys: string;
    offHint: string;
    presets: string;
    presetSources: string;
    toBase(year: YearName): string;
    toDefault: string;
    undo: string;
    remove: string;
    added(name: string): string;
    removed(name: string): string;
    tooMany(max: number): string;
    tooFew(min: number): string;
    effect: string;
    pay: string;
    payMore: string;
    payLess: string;
    paySame: string;
    counted(unit: string, tolerance: string): string;
    from(amount: string): string;
    top: string;
    topNote: string;
    topBase(rate: string, from: string, year: YearName): string;
    examples: string;
    exampleBase(year: YearName): string;
    exampleAfter: string;
    exampleChange: string;
    owes(amount: string, rate: string): string;
    examplesNote: string;
    perYear: string;
    points: string;
    pointColumn: string;
    amountColumn(currency: string): string;
    rateColumn: string;
    amountField(index: number, currency: string): string;
    rateField(index: number): string;
    removeNamed(index: number): string;
    addAt: string;
    add: string;
    addNote: string;
    clampedTo(value: string): string;
    otherSettings: string;
    model: string;
    modelCalibrated(distribution: string, after: string, base: string, change: string, item: string, amount: string, year: YearName): string;
    modelAbsolute(distribution: string, after: string, item: string): string;
  };
  waterfall: {
    title: string;
    intro(year: YearName): string;
    empty: string;
    zero: string;
    introLevel: string;
    zeroLevel(year: YearName): string;
    totalChange: string;
    rangeNote: string;
    orderNote: string;
  };
  about: {
    title: string;
    staticNote: string;
    methodology: string;
    noMethodology: string;
    qualityTitle: string;
    quality: Record<Quality, string>;
    qualityMeaning: Record<Quality, string>;
    indicators: string;
    indicator: Record<IndicatorId, string>;
    sourcesTitle(count: number): string;
    accessed(date: string): string;
    licence: string;
    /** The footer link to the repository (src/site/project.ts). */
    sourceCode: string;
  };
  units: {
    ofGdp(value: string): string;
    /**
     * Abbreviations for a thousand million and a million in compact numbers. Where they go and how
     * they are spaced comes from `Intl`; the wording is fixed here because browsers ship different
     * CLDR versions ("€12.4B" in one, "€12.4bn" in the next). Leave out to use the browser's.
     */
    billion?: string;
    million?: string;
    /** For a currency counted in trillions (format.ts): "tn", "Bio.". */
    trillion?: string;
  };
  levelFallback: Record<LevelId, string>;
  /** Imprint and privacy statement (src/i18n/legal/). */
  legal: LegalMessages;
  /** The debt and interest projection (src/i18n/debt/). */
  debt: DebtMessages;
}
