import type { DebtIntroFacts, DebtLeadText, DebtMessages, PhaseWords } from "./messages.ts";

function intro({ baseYear, plan }: DebtIntroFacts): string {
  if (!plan) {
    return `So entwickelten sich Schulden und Zinsen, wenn der Haushalt von ${baseYear} im Verhältnis zur Wirtschaft so bliebe.`;
  }
  return `Bis ${plan.until} folgen Schulden und Wachstum der amtlichen Planung „${plan.label}“; danach behält der Haushalt ohne Zinsen den Anteil an der Wirtschaftsleistung, den er ${plan.until} hat, und es gelten die Annahmen.`;
}

function when({ start, startYear, full, last }: PhaseWords): string {
  if (last !== undefined && startYear > last) return `ab ${start}, nach dem Ende der Rechnung`;
  if (full === undefined) return `ab ${start}`;
  if (last !== undefined && full > last) return `ab ${start}, voll erst ab ${full}, nach dem Ende der Rechnung`;
  return `ab ${start}, voll ab ${full}`;
}

function lead(f: DebtLeadText): string {
  const measures = f.interestWithout !== undefined;
  const sentences: string[] = [];
  if (f.paidOff !== undefined) {
    sentences.push(
      `Bei ${f.rate} Zins für neue Schulden wären die Schulden${measures ? " mit den eingeschalteten Maßnahmen" : ""} im Jahr ${f.paidOff} abbezahlt; danach fielen keine Zinsen mehr an.`,
    );
    sentences.push(
      measures
        ? `Ohne die Maßnahmen müsste der Staat im Jahr ${f.year} ${f.interestWithout} aller Einnahmen für Zinsen ausgeben; ${f.baseYear} waren es ${f.interestToday}.`
        : `${f.baseYear} gingen ${f.interestToday} aller Einnahmen für Zinsen drauf.`,
    );
  } else if (f.negative) {
    sentences.push(
      `Bei ${f.rate} Zins für neue Schulden bekäme der Staat im Jahr ${f.year}${measures ? " mit den eingeschalteten Maßnahmen" : ""} Zinsen, statt welche zu zahlen: ${f.interest} seiner Einnahmen. ${f.baseYear} zahlte er ${f.interestToday}.`,
    );
  } else {
    sentences.push(
      `Bei ${f.rate} Zins für neue Schulden müsste der Staat im Jahr ${f.year}${measures ? " mit den eingeschalteten Maßnahmen" : ""} ${f.interest} aller Einnahmen für Zinsen ausgeben` +
        (f.range ? ` (je nach Schätzung ${f.range})` : "") +
        (measures ? `, ohne sie ${f.interestWithout}` : "") +
        `; ${f.baseYear} waren es ${f.interestToday}.`,
    );
  }
  if (f.paidOff === undefined) {
    sentences.push(
      `Die Schulden lägen dann bei ${f.debt} der Wirtschaftsleistung (BIP)` +
        (f.debtWithout !== undefined ? `, ohne die Maßnahmen bei ${f.debtWithout}` : "") +
        `; ${f.baseYear} waren es ${f.debtToday}.`,
    );
  }
  if (f.overtakes) {
    const { label, since } = f.overtakes;
    sentences.push(
      since === f.baseYear
        ? `Schon ${since} kosteten die Zinsen mehr als alles, was der Staat für ${label} ausgibt.`
        : measures
          ? `Mit den Maßnahmen kosteten die Zinsen ab ${since} mehr als alles, was der Staat für ${label} ausgibt.`
          : `Ab ${since} kosteten die Zinsen mehr als alles, was der Staat für ${label} ausgibt.`,
    );
  }
  return sentences.join(" ");
}

export const debtDe: DebtMessages = {
  title: "Wohin das führt: Schulden und Zinsen",
  caveat: "Eine Wenn-dann-Rechnung, keine Prognose.",
  intro,
  lead,
  wholeState: (level) =>
    `Die Haushaltsansicht oben zeigt nur „${level}“. Diese Rechnung gilt trotzdem für den ganzen Staat, mit allen eingeschalteten Maßnahmen.`,
  announce: (year, interest, without) =>
    without === undefined
      ? `Zinsen ${year}: ${interest} aller Einnahmen.`
      : `Zinsen ${year}: ${interest} aller Einnahmen mit den Maßnahmen, ${without} ohne sie.`,

  figures: {
    interest: (year) => `Zinsen ${year}`,
    interestUnit: "aller Einnahmen",
    debt: (year) => `Schulden ${year}`,
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
      ? `Zinsen ${year}: ${interest} aller Einnahmen (${baseYear}: ${today})`
      : `Zinsen ${year}: ${interest} aller Einnahmen mit Ihren Maßnahmen, ${without} ohne (${baseYear}: ${today})`,
  footerLink: "Schulden und Zinsen",

  loading: "Diagramme und Annahmen werden geladen …",
  loadFailed: "Die Diagramme konnten nicht geladen werden. Vielleicht fehlt gerade die Verbindung.",
  retry: "Noch einmal versuchen",
  show: "Diagramme und Annahmen zeigen",
};
