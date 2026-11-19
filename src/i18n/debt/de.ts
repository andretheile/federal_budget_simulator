import type { DebtLeadText, DebtMessages } from "./messages.ts";

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
  intro: (baseYear) =>
    `Eine Wenn-dann-Rechnung, keine Prognose: So entwickelten sich Schulden und Zinsen, wenn der Haushalt von ${baseYear} mit den eingeschalteten Maßnahmen im Verhältnis zur Wirtschaft so bliebe.`,
  lead,
  wholeState: (level) =>
    `Die Haushaltsansicht oben zeigt nur „${level}“. Diese Rechnung gilt trotzdem für den ganzen Staat, mit allen eingeschalteten Maßnahmen.`,
  announce: (year, interest, without) =>
    without === undefined
      ? `Zinsen ${year}: ${interest} aller Einnahmen.`
      : `Zinsen ${year}: ${interest} aller Einnahmen mit den Maßnahmen, ${without} ohne sie.`,

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
