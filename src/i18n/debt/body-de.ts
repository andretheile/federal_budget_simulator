import type { DebtBodyMessages } from "./messages.ts";

export const debtBodyDe: DebtBodyMessages = {
  assumptions: "Annahmen",
  presets: "Vorlagen",
  presetChosen: (label) => `Gewählt: ${label}`,
  reset: "Annahmen zurücksetzen",
  resetHint: "Alle Annahmen auf ihre Vorgabe zurücksetzen",
  explain: {
    market_rate: (refinanced) =>
      `Zu diesem Zins leiht sich der Staat neues Geld und ersetzt Kredite, die fällig werden: jedes Jahr ${refinanced} der Schulden. Der Rest behält seinen alten Zins, bis er ausläuft.`,
    growth: () =>
      "Nominal heißt: mit Preissteigerung. Je schneller die Wirtschaft wächst, desto weniger wiegen die Schulden im Verhältnis zu ihr.",
    horizon: () => "Wie viele Jahre die Rechnung vorausschaut.",
    drift: () =>
      "Der Haushalt ohne Zinsen wird jedes Jahr um diesen Anteil der Wirtschaftsleistung besser (plus) oder schlechter (minus), etwa weil Renten, Gesundheit und Pflege schneller wachsen als die Wirtschaft.",
  },
  whereFrom: "Woher die Vorgabe kommt",

  interestTitle: "Zinsen",
  interestOfRevenue: "als Anteil an allen Einnahmen des Staates",
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
  readout: (year, parts) => `${year}: ${parts.join(" · ")}`,
  readoutPart: (label, value) => `${label} ${value}`,
  withAmount: (share, amount) => `${share} (${amount})`,
  offScale: (label, value) => `${label} ${value}\u00a0↑`,

  comparisonsTitle: "Wann die Zinsen mehr kosten als …",
  comparisonsNote:
    "Jeder Posten behält seinen Anteil an der Wirtschaftsleistung, so wie alle Ausgaben in dieser Rechnung. Beträge für den ganzen Staat.",
  itemToday: (baseYear, amount, share) => `${baseYear}: ${amount}, ${share} des BIP`,
  itemWith: (amount, share) => `mit den Maßnahmen: ${amount}, ${share} des BIP`,
  crossing: {
    already: (baseYear) => `schon ${baseYear}`,
    since: (year) => `ab ${year}`,
    never: (lastYear) => `nicht bis ${lastYear}`,
    between: (first, drop, baseYear) => (first === baseYear ? `${baseYear}, ab ${drop} nicht mehr` : `von ${first} bis ${drop - 1}`),
  },
  bothPaths: (withText, withoutText) => `mit den Maßnahmen ${withText}, ohne ${withoutText}`,

  referencesTitle: "Zum Vergleich",
  referencesNote: "Werte anderer Länder und früherer Jahre, und wann die Rechnung sie erreicht.",
  referenceName: (label, year) => (year === undefined ? label : `${label} ${year}`),
  referenceInterestRevenue: (value) => `Zinsen ${value} der Einnahmen`,
  referenceInterest: (value) => `Zinsen ${value} des BIP`,
  referenceDebt: (value) => `Schulden ${value} des BIP`,
  reach: {
    already: (baseYear) => `schon ${baseYear} darüber`,
    year: (year) => `erreicht ${year}`,
    never: (lastYear) => `bis ${lastYear} nicht erreicht`,
  },

  limitsTitle: "Was die Rechnung annimmt und was sie weglässt",
  levelsNote: (levels) => `Die Rechnung gilt für den ganzen Staat: ${levels}.`,
  list: (items) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`),

  basisTitle: "Woher die Zahlen kommen",
  stock: (year) => `Schulden Ende ${year}`,
  stockValue: (amount, share) => `${amount}, ${share} des BIP`,
  interest: (year) => `Zinsen ${year}`,
  interestValue: (amount, share) => `${amount}, ${share} des BIP`,
  refinancing: "Jedes Jahr neu finanziert",
  refinancingValue: (share, maturity) =>
    maturity === undefined ? `${share} der Schulden` : `${share} der Schulden; die Kredite laufen im Mittel noch ${maturity}`,

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
