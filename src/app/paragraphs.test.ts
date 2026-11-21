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

  it("ends a sentence after an amount with its unit, as the packs write them now", () => {
    // From the German pack's English texts: amounts as the interface writes them.
    expect(
      sentences(
        "The calculation deducts the 2030 amount from spending in 2024 (€7.17bn), about 19%; the draft budget 2027 contains €7.07bn. The draft does not disclose how the ministry calculated the saving.",
      ),
    ).toEqual([
      "The calculation deducts the 2030 amount from spending in 2024 (€7.17bn), about 19%; the draft budget 2027 contains €7.07bn.",
      "The draft does not disclose how the ministry calculated the saving.",
    ]);
    expect(
      sentences("One fund needs one board; own assumption: about €1m, so the saving is €24m. Together with advertising €237m. The range applies to both effects."),
    ).toEqual(["One fund needs one board; own assumption: about €1m, so the saving is €24m.", "Together with advertising €237m.", "The range applies to both effects."]);
    expect(sentences("Single parents get up to eight months at 80%. The minimum rises from €300 to €330, the maximum from €1,800 to €1,900.")).toEqual([
      "Single parents get up to eight months at 80%.",
      "The minimum rises from €300 to €330, the maximum from €1,800 to €1,900.",
    ]);
    expect(sentences("Here the first kink stays at €17,005. Not included: the abolition of the surcharge.")).toEqual([
      "Here the first kink stays at €17,005.",
      "Not included: the abolition of the surcharge.",
    ]);
    // And in German, with the unit after the number.
    expect(
      sentences("Die Bundesregierung rechnet für ukrainische Geflüchtete mit etwa 104 %. Diese Kosten tragen dann Länder und Kommunen. Gespart werden 46,3 Mio. €. Mehr nicht."),
    ).toEqual([
      "Die Bundesregierung rechnet für ukrainische Geflüchtete mit etwa 104 %.",
      "Diese Kosten tragen dann Länder und Kommunen.",
      "Gespart werden 46,3 Mio. €.",
      "Mehr nicht.",
    ]);
  });

  it("still does not cut after a bare number, an abbreviated unit or an amount inside a sentence", () => {
    // A bare number may be a date or an ordinal; "Mrd." and "Mio." are followed by their currency.
    expect(sentences("Beschlossen am 6. Juli 2026 mit 22 Mrd. Euro und 862 Mio. Euro Mehrausgaben (Nr. 5, Abs. 3 Satz 2). Danach nicht.")).toEqual([
      "Beschlossen am 6. Juli 2026 mit 22 Mrd. Euro und 862 Mio. Euro Mehrausgaben (Nr. 5, Abs. 3 Satz 2).",
      "Danach nicht.",
    ]);
    // An amount followed by a lower-case word is inside its sentence; so is a case name.
    expect(sentences("It costs €22bn. of which half falls on the states. See Learning Resources, Inc. v. Trump. The end.")).toEqual([
      "It costs €22bn. of which half falls on the states.",
      "See Learning Resources, Inc. v. Trump.",
      "The end.",
    ]);
    // A closing straight quote ends a sentence like a typographic one.
    expect(sentences("The source says 'zu beachten'. Page 3 gives the amount.")).toEqual(["The source says 'zu beachten'.", "Page 3 gives the amount."]);
    // Joined again, the sentences give the text back.
    const text = "Together €8.97bn, 58.2% of this item; per percentage point fewer posts €89.7m. The range runs from 50% to 110%.";
    expect(sentences(text).join(" ")).toBe(text);
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
