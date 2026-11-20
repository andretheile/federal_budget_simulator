/**
 * Alphabetical order as a reader of a language expects it: umlauts beside their base letters, case
 * ignored, a quotation mark at the start not counted, numbers by value, ties in their given order.
 */
import { describe, expect, it } from "vitest";
import { alphabetical, sortKey } from "./collation.ts";

const sorted = (labels: string[], language: string): string[] => alphabetical(labels, (label) => label, language);

describe("alphabetical order", () => {
  it("puts German umlauts beside their base letters, not after z", () => {
    expect(sorted(["Ökosteuer", "Zölle", "Obergrenze", "Ärzte", "Abgaben", "Übergang", "Umsatzsteuer"], "de")).toEqual([
      "Abgaben",
      "Ärzte",
      "Obergrenze",
      "Ökosteuer",
      "Übergang",
      "Umsatzsteuer",
      "Zölle",
    ]);
  });

  it("sorts a label that opens with a quotation mark by its first letter", () => {
    expect(sortKey("„Rente mit 63“ abschaffen")).toBe("Rente mit 63“ abschaffen");
    expect(sorted(["Steuer auf Kunststoff", "„Rente mit 63“ abschaffen", "Rentenniveau ändern", "Pflege"], "de")).toEqual([
      "Pflege",
      "„Rente mit 63“ abschaffen",
      "Rentenniveau ändern",
      "Steuer auf Kunststoff",
    ]);
    expect(sorted(["\"Zero\" tolerance", "Alpha", "(Beta) plan"], "en")).toEqual(["Alpha", "(Beta) plan", "\"Zero\" tolerance"]);
  });

  it("ignores case and reads numbers as numbers", () => {
    expect(sorted(["eu-Beitrag", "Elterngeld", "EU-Beitrag kürzen"], "de")).toEqual(["Elterngeld", "eu-Beitrag", "EU-Beitrag kürzen"]);
    expect(sorted(["CO10", "CO2"], "en")).toEqual(["CO2", "CO10"]);
  });

  it("keeps labels that compare equal in the order they came in", () => {
    const items = [
      { id: "b", label: "Steuer" },
      { id: "a", label: "steuer" },
      { id: "c", label: "Steuer" },
    ];
    expect(alphabetical(items, (item) => item.label, "de").map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});
