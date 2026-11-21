import type { DebtPlanAccounts } from "../../engine/index.ts";
import type { YearName } from "../messages.ts";
import type { DebtBodyMessages } from "./messages.ts";

/** In welcher Abgrenzung ein Haushalt oder eine Planung gerechnet ist. */
const ACCOUNTS: Record<DebtPlanAccounts, string> = {
  national_accounts: "in der Abgrenzung der Volkswirtschaftlichen Gesamtrechnungen",
  cash: "in Zahlungen (Kassenzahlen)",
  budget: "in der Abgrenzung des Haushalts selbst",
};

/*
 * Ein Jahr ist eine Zahl („2024“) oder der Name, den das Paket ihm gibt („Haushaltsjahr 2025“). Die
 * Zahl steht allein, wo das Deutsche es erlaubt; der Name braucht dann „im“ (siehe debt/de.ts).
 */
/** "2024", or "im Haushaltsjahr 2025". */
const inJahr = (year: YearName): string => (typeof year === "number" ? `${year}` : `im ${year}`);
/** "von 2024", or "im Haushaltsjahr 2025". */
const vonJahr = (year: YearName): string => (typeof year === "number" ? `von ${year}` : `im ${year}`);

export const debtBodyDe: DebtBodyMessages = {
  assumptions: "Annahmen",
  presets: "Vorlagen",
  presetChosen: (label) => `Gewählt: ${label}`,
  reset: "Annahmen zurücksetzen",
  resetHint: "Alle Annahmen auf ihre Vorgabe zurücksetzen",
  explain: {
    market_rate: (refinanced, state) =>
      state
        ? `Zu diesem Zins leiht sich der Staat neues Geld und ersetzt Kredite, die fällig werden: jedes Jahr ${refinanced} der Schulden. Der Rest behält seinen alten Zins, bis er ausläuft.`
        : `Zu diesem Zins werden neue Kredite aufgenommen und fällige ersetzt: jedes Jahr ${refinanced} der Schulden. Der Rest behält seinen alten Zins, bis er ausläuft.`,
    growth: () =>
      "Nominal heißt: mit Preissteigerung. Je schneller die Wirtschaft wächst, desto weniger wiegen die Schulden im Verhältnis zu ihr.",
    horizon: () => "Wie viele Jahre die Rechnung vorausschaut.",
    drift: () =>
      "Der Haushalt ohne Zinsen wird jedes Jahr um diesen Anteil der Wirtschaftsleistung besser (plus) oder schlechter (minus), etwa weil Renten, Gesundheit und Pflege schneller wachsen als die Wirtschaft.",
  },
  whereFrom: "Woher die Vorgabe kommt",

  interestTitle: "Zinsen",
  interestOfRevenue: (state) => (state ? "als Anteil an allen Einnahmen des Staates" : "als Anteil an allen Einnahmen"),
  interestOfGdp: "als Anteil an der Wirtschaftsleistung (BIP)",
  unitLabel: "Zinsen zeigen als",
  unitRevenue: "Anteil an allen Einnahmen",
  unitGdp: "Anteil am BIP",
  debtTitle: "Schulden",
  debtOfGdp: "als Anteil an der Wirtschaftsleistung (BIP)",
  legend: {
    with: "mit den Maßnahmen",
    without: "ohne Maßnahmen",
    same: "mit und ohne Maßnahmen gleich",
    range: "Spanne der Schätzung",
    reference: "Vergleichswert",
  },
  chartControl: (title) => `${title}, Jahr für Jahr`,
  keys: "Pfeiltasten: ein Jahr vor oder zurück. Bild auf, Bild ab: fünf Jahre. Pos1, Ende: erstes und letztes Jahr.",
  yearsNote: (year, start, end) => `Die Jahre sind Haushaltsjahre wie im Haushalt: ${year} reicht vom ${start} bis zum ${end}.`,
  readout: (year, parts) => `${year}: ${parts.join(" · ")}`,
  readoutPart: (label, value) => `${label} ${value}`,
  withAmount: (share, amount) => `${share} (${amount})`,
  offScale: (label, value) => `${label} ${value}\u00a0↑`,
  planPart: (value) => `amtliche Planung ${value}`,
  continued: (fromYear, by) => (by === "debt" ? `ab ${fromYear} nach den Annahmen` : `ab ${fromYear} ohne die Planung`),

  startTitle: "Ausgangspunkt",
  startPlan: (until) => `Amtliche Planung bis ${until}`,
  startPlanNote: (label, until, by) =>
    by === "debt"
      ? `Bis ${until} folgen Schulden und Wachstum der amtlichen Planung „${label}“, mit dem, was bis zu ihrem Stand beschlossen war; danach gelten die Annahmen.`
      : by === "balance"
        ? `Bis ${until} folgen der Haushalt ohne Zinsen und das Wachstum der amtlichen Planung „${label}“, mit dem, was bis zu ihrem Stand beschlossen war; Zinsen und Schulden ergeben sich aus den Annahmen, danach alles.`
        : `Bis ${until} folgt die Rechnung der amtlichen Planung „${label}“, mit dem, was bis zu ihrem Stand beschlossen war: ihren Schulden, wo sie welche angibt, sonst ihrem Haushalt ohne Zinsen; danach gelten die Annahmen.`,
  startBase: (baseYear) => (typeof baseYear === "number" ? `Haushalt ${baseYear} fortschreiben` : `Haushalt fortschreiben wie ${inJahr(baseYear)}`),
  startBaseNote: (baseYear) =>
    `Der Haushalt ${vonJahr(baseYear)} behält vom ersten Jahr an seinen Anteil an der Wirtschaftsleistung; was seither beschlossen wurde, fehlt.`,
  startDefault: "Vorgabe",

  plansTitle: "Amtliche Planungen",
  plansIntro: ({ baseYear, year, plan, model, followed }) =>
    (followed ? `Von dieser Planung geht die Rechnung bis ${year} aus. ` : "") +
    `Mit dem Haushalt ${vonJahr(baseYear)} fortgeschrieben kämen die Schulden ohne Maßnahmen ${inJahr(year)} auf ${model} des BIP, nach dieser Planung auf ${plan}: Sie enthält, was seit ${baseYear} beschlossen wurde. Was sie anders rechnet, steht in ihrer Anmerkung.`,
  planInChart: (followed, by) =>
    !followed
      ? by === "balance"
        ? "In der Zinsgrafik gestrichelt, mit Rauten an den Jahren, für die sie Zahlen nennt; Schulden nennt sie keine."
        : "In den Grafiken gestrichelt, mit Rauten an den Jahren, für die sie Zahlen nennt."
      : by === "debt"
        ? "In den Grafiken die Rauten auf dem Pfad ohne Maßnahmen, der bis dahin ihren Zahlen folgt."
        : by === "balance"
          ? "Der Pfad ohne Maßnahmen übernimmt ihren Haushalt ohne Zinsen; seine Zinsen rechnet das Modell zu den angenommenen Sätzen. Die Zinsen der Planung stehen deshalb daneben, gestrichelt mit Rauten; Schulden nennt sie keine."
          : "In der Schuldengrafik ihre Schulden als Rauten auf dem Pfad ohne Maßnahmen, der sie trifft; ihre Zinsen in der Zinsgrafik gestrichelt mit Rauten neben dem Pfad, dessen Zinsen das Modell rechnet.",
  planScope: (level, accounts, state) =>
    `${level === null ? (state ? "Gilt für den ganzen Staat" : "Gilt für den ganzen Haushalt") : `Gilt nur für die Ebene „${level}“`}${
      accounts === "cash" ? " und ist in Zahlungen gerechnet (Kassenzahlen)" : `, ${ACCOUNTS[accounts]}`
    }.`,
  planNotComparable: (accounts, state) =>
    `Die Rechnung oben beschreibt ${state ? "den ganzen Staat" : "den ganzen Haushalt"} ${ACCOUNTS[accounts]}. Mit ihr sind diese Zahlen nicht vergleichbar; deshalb stehen sie nicht in den Grafiken.`,
  planFields: {
    debtRatio: "Schulden, Anteil am BIP",
    balanceRatio: "Saldo, Anteil am BIP",
    interestRatio: "Zinsen, Anteil am BIP",
    interestToRevenue: "Zinsen, Anteil an allen Einnahmen",
    interest: "Zinsen",
  },
  planMore: "Anmerkung, Datenqualität und Quellen",
  planCaption: (label) => `Zahlen: ${label}`,

  comparisonsTitle: "Wann die Zinsen mehr kosten als …",
  comparisonsNote: (baseYear, state) =>
    `Jeder Posten behält seinen Anteil an der Wirtschaftsleistung ${vonJahr(baseYear)}.${state ? " Beträge für den ganzen Staat." : ""}`,
  itemToday: (baseYear, amount, share) => `${baseYear}: ${amount}, ${share} des BIP`,
  itemWith: (amount, share) => `mit den Maßnahmen: ${amount}, ${share} des BIP`,
  crossing: {
    already: (baseYear) => `schon ${inJahr(baseYear)}`,
    since: (year) => `ab ${year}`,
    never: (lastYear) => `nicht bis ${lastYear}`,
    between: ({ first, lastAbove, drop, fromBase }) => (fromBase ? `${inJahr(first)}, ab ${drop} nicht mehr` : `von ${first} bis ${lastAbove}`),
  },
  bothPaths: (withText, withoutText) => `mit den Maßnahmen ${withText}, ohne ${withoutText}`,

  referencesTitle: "Zum Vergleich",
  referencesNote: "Werte anderer Länder und früherer Jahre, und wann die Rechnung sie erreicht.",
  referenceName: (label, year) => (year === undefined ? label : typeof year === "number" ? `${label} ${year}` : `${label}, ${year}`),
  referenceInterestRevenue: (value) => `Zinsen ${value} der Einnahmen`,
  referenceInterest: (value) => `Zinsen ${value} des BIP`,
  referenceDebt: (value) => `Schulden ${value} des BIP`,
  reach: {
    already: (baseYear) => `schon ${inJahr(baseYear)} darüber`,
    year: (year) => `erreicht ${inJahr(year)}`,
    never: (lastYear) => `bis ${lastYear} nicht erreicht`,
  },

  limitsTitle: "Was die Rechnung annimmt und was sie weglässt",
  levelsNote: (levels) => `Die Rechnung gilt für den ganzen Staat: ${levels}.`,
  covers: (what) => `Diese Rechnung gilt für ${what}.`,
  oneLevel: (level) => `Diese Rechnung gilt für den Haushalt einer einzigen Ebene, „${level}“, und ihre Schulden.`,
  list: (items) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`),

  basisTitle: "Woher die Zahlen kommen",
  stock: (year, end) => (end === undefined ? `Schulden Ende ${year}` : `Schulden am ${end} (Ende ${year})`),
  stockValue: (amount, share) => `${amount}, ${share} des BIP`,
  interest: (year) => (typeof year === "number" ? `Zinsen ${year}` : `Zinsen ${inJahr(year)}`),
  interestValue: (amount, share) => `${amount}, ${share} des BIP`,
  refinancing: "Jedes Jahr neu finanziert",
  refinancingValue: (share, maturity) =>
    maturity === undefined ? `${share} der Schulden` : `${share} der Schulden; die Kredite laufen im Mittel noch ${maturity}`,
  maturity: "Mittlere Restlaufzeit",

  tableTitle: "Die Zahlen als Tabelle",
  tableCaption: "Zinsen und Schulden in ausgewählten Jahren",
  year: "Jahr",
  path: "Maßnahmen",
  without: "ohne",
  with: "mit",
  interestShareRevenue: "Zinsen: Anteil an allen Einnahmen",
  interestShareGdp: "Zinsen: Anteil am BIP",
  interestAmount: "Zinsen",
  debtShareGdp: "Schulden: Anteil am BIP",
  debtAmount: "Schulden",
  tableNote: "Beträge zu Preisen des jeweiligen Jahres, also mit Preissteigerung.",
  ofRevenue: (share) => `${share} der Einnahmen`,
};
