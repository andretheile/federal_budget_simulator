/**
 * Shape of a UI dictionary. Every user-visible string of the interface that does not come from a
 * country pack lives here, once per language. Texts with numbers or names in them are functions,
 * so each language can order and inflect them as it needs.
 */
import type { Catch, LevelId, PolicyTopic, Quality, WarningCode } from "../engine/index.ts";
import type { LegalMessages } from "./legal/messages.ts";
import type { DebtMessages } from "./debt/messages.ts";

export type IndicatorId = "gdp" | "population" | "households" | "grossDebt";

export interface Messages {
  app: {
    name: string;
    tagline: string;
    loading: string;
    skipToContent: string;
    title(country: string, year: number): string;
    countryYear(country: string, year: number): string;
  };
  dev: {
    badge: string;
    /** Why the fixture is shown: the wanted pack is invalid, there is none, or it was asked for. */
    invalid(packId: string): string;
    noPack: string;
    fixture: string;
    errors(count: number): string;
  };
  header: {
    level: string;
    allLevels: string;
    language: string;
    country: string;
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
    baseYear(year: number): string;
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
    balanceLabel(year: number): string;
    /** After a change: against the base year, which is not always today. */
    vsBase(year: number): string;
    asBase(year: number): string;
    measuresOn(count: number): string;
    ofGdp(share: string): string;
    perInhabitant(amount: string): string;
    rangeLabel: string;
    announce(balance: string, state: string, change: string): string;
    levelLabel(level: string, year: number): string;
    relief: string;
    burden: string;
    unchanged: string;
    noLevelBalance: string;
    announceLevel(level: string, change: string, state: string, year: number): string;
  };
  budget: {
    title(year: number): string;
    intro: string;
    introLevel(level: string): string;
    hint: string;
    other(count: number): string;
    gap(kind: "deficit" | "surplus", amount: string): string;
    /** The mark for the base-year value of a bar or a row. */
    baseMark(amount: string, year: number): string;
    shareOf(side: "revenue" | "expenditure", share: string): string;
    path: string;
    up: string;
    /** Said after a row that opens the next level, for screen readers. */
    breakDown: string;
    key(year: number): string;
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
    allTopics: string;
    topics: Record<PolicyTopic, string>;
    switchOn(label: string): string;
    on: string;
    off: string;
    alone: string;
    aloneLevel(level: string): string;
    combined(amount: string): string;
    combinedHint: string;
    ofAll(side: "revenue" | "expenditure", share: string): string;
    ofLevel(side: "revenue" | "expenditure", share: string): string;
    perInhabitant(amount: string): string;
    ofDeficit(share: string, year: number): string;
    meterLabel(share: string, year: number): string;
    settings: string;
    settingCount(count: number): string;
    previewHint: string;
    /** A setting's value in the base year, under its slider. */
    baseValue(value: string, year: number): string;
    /** The end of a slider's scale where the base-year value lies: "0 % · 2024". */
    baseAtEnd(end: string, year: number): string;
    /** Name of the button that sets a slider back to its base-year value. */
    toBaseValue(value: string, year: number): string;
    /** How far a setting is from its base-year value, for screen readers. */
    changeFromBase(change: string, year: number): string;
    /** The tag before a setting that is an assumption of the calculation, not a political choice. */
    assumption: string;
    /** Name of the button that shows a setting's value and turns it into a field. */
    typeValue(label: string, value: string): string;
    /** Name of that field. */
    valueField(label: string): string;
    selectedShare(share: string, basis: "spending" | "recipients", item: string): string;
    /** Said before a group's share, for screen readers. */
    groupShare: string;
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
    catchCount(count: number): string;
    moreCatches(count: number): string;
    severity: Record<Catch["severity"], string>;
    kind: Record<Catch["kind"], string>;
    effects: string;
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
    warnings: Record<Exclude<WarningCode, "empty_group">, string> & { empty_group(year: number): string };
    /** The repeated_exclusion warning when the measures that got there first are known. */
    alreadyExcludedBy(measures: string): string;
    warningItem(item: string): string;
    none: string;
  };
  /** The editor for rate curves, and its entry on a measure's card. */
  curve: {
    /** Small caption above the preview on the card. */
    section: string;
    edit: string;
    asBase(year: number): string;
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
    hover(at: string, rate: string, base: string | null, average: string, averageBase: string | null, year: number): string;
    point(name: string, at: string, rate: string, average: string, averageBase: string | null, year: number): string;
    axisRate: string;
    compressed: string;
    scaleNote(knee: string, max: string): string;
    legend: {
      reform: string;
      base(year: number): string;
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
    toBase(year: number): string;
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
    topBase(rate: string, from: string, year: number): string;
    examples: string;
    exampleBase(year: number): string;
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
    modelCalibrated(distribution: string, after: string, base: string, change: string, item: string, amount: string, year: number): string;
    modelAbsolute(distribution: string, after: string, item: string): string;
  };
  waterfall: {
    title: string;
    intro(year: number): string;
    empty: string;
    zero: string;
    introLevel: string;
    zeroLevel(year: number): string;
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
  };
  levelFallback: Record<LevelId, string>;
  /** Imprint and privacy statement (src/i18n/legal/). */
  legal: LegalMessages;
  /** The debt and interest projection (src/i18n/debt/). */
  debt: DebtMessages;
}
