import { describe, expect, it } from "vitest";
import { paragraphs, sentences } from "./paragraphs.ts";

describe("a long text in paragraphs", () => {
  it("cuts at the end of a sentence, never after an abbreviation, an ordinal or a page number", () => {
    const text =
      "Der Plan nennt rund 22 Mrd. Euro, beschlossen am 6. Juli 2026 (Drucksache 21/7301, S. 19). " +
      "Er nennt nur gerundete Werte. Einzelplan 60. Der Rest folgt z. B. später. Das gilt bis 2030. Danach nicht.";
    expect(sentences(text)).toEqual([
      "Der Plan nennt rund 22 Mrd. Euro, beschlossen am 6. Juli 2026 (Drucksache 21/7301, S. 19).",
      "Er nennt nur gerundete Werte.",
      "Einzelplan 60. Der Rest folgt z. B. später.",
      "Das gilt bis 2030.",
      "Danach nicht.",
    ]);
    expect(sentences("It was about EUR 22 billion, e.g. The rest. Next one.")).toEqual(["It was about EUR 22 billion, e.g. The rest.", "Next one."]);
  });

  it("keeps a short text whole and starts a paragraph at a blank line", () => {
    expect(paragraphs("One sentence. Another one.")).toEqual(["One sentence. Another one."]);
    expect(paragraphs("First block.\n\nSecond block.")).toEqual(["First block.", "Second block."]);
  });

  it("groups whole sentences into paragraphs of about the target length, and drops nothing", () => {
    const sentence = (n: number): string => `Sentence number ${n} says something about the budget that takes a while to read through.`;
    const text = Array.from({ length: 12 }, (_, i) => sentence(i + 1)).join(" ");
    const out = paragraphs(text, 300);
    expect(out.length).toBeGreaterThan(2);
    expect(out.every((paragraph) => paragraph.length <= 300)).toBe(true);
    expect(out.join(" ")).toBe(text);
  });

  it("keeps a short sentence with the one before it", () => {
    const long = "This first sentence is long enough to fill most of a paragraph on its own, which is the point here.";
    const out = paragraphs(`${long} ${long} ${long} Short one. ${long}`, 220);
    expect(out.some((paragraph) => paragraph === "Short one.")).toBe(false);
  });
});
