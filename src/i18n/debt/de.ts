import type { YearName } from "../messages.ts";
import type { DebtIntroFacts, DebtLeadText, DebtMessages, PhaseWords } from "./messages.ts";

/*
 * A year is a number ("2024") or the pack's name of it ("Haushaltsjahr 2025"). The number stands
 * alone where German lets it ("2024 waren es", "Zinsen 2054"); the name then needs "im".
 */
/** "2024", or "im Haushaltsjahr 2025": a year as an adverb, inside a sentence. */
const inJahr = (year: YearName): string => (typeof year === "number" ? `${year}` : `im ${year}`);
/** The same at the start of a sentence. */
const InJahr = (year: YearName): string => (typeof year === "number" ? `${year}` : `Im ${year}`);
/** "im Jahr 2054", or "im Haushaltsjahr 2054". */
const imJahr = (year: YearName): string => (typeof year === "number" ? `im Jahr ${year}` : `im ${year}`);
/** "von 2024", or "im Haushaltsjahr 2025": the year a budget is of. */
const vonJahr = (year: YearName): string => (typeof year === "number" ? `von ${year}` : `im ${year}`);

function intro({ baseYear, plan }: DebtIntroFacts): string {
  if (!plan) {
    return `So entwickelten sich Schulden und Zinsen, wenn der Haushalt ${vonJahr(baseYear)} im Verhältnis zur Wirtschaft so bliebe.`;
  }
  const after = `Danach behält der Haushalt ohne Zinsen den Anteil an der Wirtschaftsleistung, den er ${inJahr(plan.until)} hat`;
  if (plan.by === "balance") {
    return `Bis ${plan.until} folgt der Haushalt ohne Zinsen der amtlichen Planung „${plan.label}“, das Wachstum ebenso, wo sie es angibt; Zinsen und Schulden ergeben sich aus den Annahmen. ${after}, und auch das Wachstum folgt den Annahmen.`;
  }
  if (plan.by === "mixed") {
    return `Bis ${plan.until} folgt die Rechnung der amtlichen Planung „${plan.label}“: ihren Schulden in den Jahren, für die sie welche angibt, sonst ihrem Haushalt ohne Zinsen, mit Zinsen und Schulden nach den Annahmen; das Wachstum folgt der Planung, wo sie es angibt. ${after}, und es gelten die Annahmen.`;
  }
  return `Bis ${plan.until} folgen Schulden und Wachstum der amtlichen Planung „${plan.label}“. ${after}, und es gelten die Annahmen.`;
}

function when({ start, startYear, full, last, fullName }: PhaseWords): string {
  const fullText = fullName ?? full;
  if (last !== undefined && startYear > last) return `ab ${start}, nach dem Ende der Rechnung`;
  if (full === undefined) return `ab ${start}`;
  if (last !== undefined && full > last) return `ab ${start}, voll erst ab ${fullText}, nach dem Ende der Rechnung`;
  return `ab ${start}, voll ab ${fullText}`;
}

function lead(f: DebtLeadText): string {
  const measures = f.interestWithout !== undefined;
  const sentences: string[] = [];
  // Ein Staat aus mehreren Ebenen ist „der Staat“; der Haushalt einer einzigen Ebene wird hier nicht genannt (siehe messages.ts).
  if (f.paidOff !== undefined) {
    sentences.push(
      `Bei ${f.rate} Zins für neue Schulden wären die Schulden${measures ? " mit den eingeschalteten Maßnahmen" : ""} ${imJahr(f.paidOff)} abbezahlt; danach fielen keine Zinsen mehr an.`,
    );
    sentences.push(
      measures
        ? f.state
          ? `Ohne die Maßnahmen müsste der Staat ${imJahr(f.year)} ${f.interestWithout} aller Einnahmen für Zinsen ausgeben; ${inJahr(f.baseYear)} waren es ${f.interestToday}.`
          : `Ohne die Maßnahmen flössen ${imJahr(f.year)} ${f.interestWithout} aller Einnahmen in Zinsen; ${inJahr(f.baseYear)} waren es ${f.interestToday}.`
        : `${InJahr(f.baseYear)} flossen ${f.interestToday} aller Einnahmen in Zinsen.`,
    );
  } else if (f.negative) {
    sentences.push(
      f.state
        ? `Bei ${f.rate} Zins für neue Schulden bekäme der Staat ${imJahr(f.year)}${measures ? " mit den eingeschalteten Maßnahmen" : ""} Zinsen, statt welche zu zahlen: ${f.interest} seiner Einnahmen. ${InJahr(f.baseYear)} zahlte er ${f.interestToday}.`
        : `Bei ${f.rate} Zins für neue Schulden würden ${imJahr(f.year)}${measures ? " mit den eingeschalteten Maßnahmen" : ""} Zinsen eingenommen statt gezahlt: ${f.interest} der Einnahmen. ${InJahr(f.baseYear)} flossen ${f.interestToday} der Einnahmen in Zinsen.`,
    );
  } else {
    sentences.push(
      (f.state
        ? `Bei ${f.rate} Zins für neue Schulden müsste der Staat ${imJahr(f.year)}${measures ? " mit den eingeschalteten Maßnahmen" : ""} ${f.interest} aller Einnahmen für Zinsen ausgeben`
        : `Bei ${f.rate} Zins für neue Schulden flössen ${imJahr(f.year)}${measures ? " mit den eingeschalteten Maßnahmen" : ""} ${f.interest} aller Einnahmen in Zinsen`) +
        (f.range ? ` (je nach Schätzung ${f.range})` : "") +
        (measures ? `, ohne sie ${f.interestWithout}` : "") +
        `; ${inJahr(f.baseYear)} waren es ${f.interestToday}.`,
    );
  }
  if (f.paidOff === undefined) {
    sentences.push(
      `Die Schulden lägen dann bei ${f.debt} der Wirtschaftsleistung (BIP)` +
        (f.debtWithout !== undefined ? `, ohne die Maßnahmen bei ${f.debtWithout}` : "") +
        `; ${inJahr(f.baseYear)} waren es ${f.debtToday}.`,
    );
  }
  if (f.overtakes) {
    const { label, since, already } = f.overtakes;
    const item = f.state ? `alles, was der Staat für ${label} ausgibt` : `alle Ausgaben für ${label}`;
    sentences.push(
      already
        ? `Schon ${inJahr(since)} kosteten die Zinsen mehr als ${item}.`
        : measures
          ? `Mit den Maßnahmen würden die Zinsen ab ${since} mehr kosten als ${item}.`
          : `Ab ${since} würden die Zinsen mehr kosten als ${item}.`,
    );
  }
  return sentences.join(" ");
}

/** "Zinsen 2054", or "Zinsen im Haushaltsjahr 2054": a figure and its year, as a label. */
const labelled = (what: string, year: YearName): string => (typeof year === "number" ? `${what} ${year}` : `${what} im ${year}`);

export const debtDe: DebtMessages = {
  title: "Wohin das führt: Schulden und Zinsen",
  caveat: "Eine Wenn-dann-Rechnung, keine Prognose.",
  intro,
  lead,
  wholeState: (level) =>
    `Die Haushaltsansicht oben zeigt nur „${level}“. Diese Rechnung gilt trotzdem für den ganzen Staat, mit allen eingeschalteten Maßnahmen.`,
  announce: (year, interest, without) =>
    without === undefined
      ? `${labelled("Zinsen", year)}: ${interest} aller Einnahmen.`
      : `${labelled("Zinsen", year)}: ${interest} aller Einnahmen mit den Maßnahmen, ${without} ohne sie.`,

  figures: {
    interest: (year) => labelled("Zinsen", year),
    interestUnit: "aller Einnahmen",
    debt: (year) => labelled("Schulden", year),
    debtUnit: "der Wirtschaftsleistung (BIP)",
    withMeasures: "mit den eingeschalteten Maßnahmen",
    withMeasuresBy: (year) => `mit den eingeschalteten Maßnahmen, soweit sie bis ${year} wirken`,
    noMeasures: "keine Maßnahme eingeschaltet",
    rate: (rate) => `bei ${rate} Zins für neue Schulden`,
    range: (range) => `je nach Schätzung ${range}`,
    without: (value) => `ohne die Maßnahmen: ${value}`,
    inYear: (year, value) => `${year}: ${value}`,
  },
  timing: {
    from: (year, measuresOn) =>
      measuresOn
        ? `Maßnahmen wirken in dieser Rechnung ab ${year}; bis dahin verläuft der Pfad mit Maßnahmen wie der ohne.`
        : `Eingeschaltete Maßnahmen wirken in dieser Rechnung ab ${year}.`,
    why: (year) => `Warum ab ${year}?`,
    laterTitle: "Später oder nach und nach wirken:",
    when,
  },
  teaserLink: (year) => `Wohin führt das? Schulden und Zinsen bis ${year}`,
  teaserFigure: (year, interest, without, baseYear, today) =>
    without === undefined
      ? `${labelled("Zinsen", year)}: ${interest} aller Einnahmen (${baseYear}: ${today})`
      : `${labelled("Zinsen", year)}: ${interest} aller Einnahmen mit Ihren Maßnahmen, ${without} ohne (${baseYear}: ${today})`,
  footerLink: "Schulden und Zinsen",

  loading: "Diagramme und Annahmen werden geladen …",
  loadFailed: "Die Diagramme konnten nicht geladen werden. Vielleicht fehlt gerade die Verbindung.",
  retry: "Noch einmal versuchen",
  show: "Diagramme und Annahmen zeigen",
};
