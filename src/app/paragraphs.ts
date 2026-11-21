/**
 * A long text of the pack, such as the note on a goal, in paragraphs a reader can follow. The packs
 * write such notes as one block. A blank line in the text starts a paragraph; within a block that
 * is still long, paragraphs are made of whole sentences, a few hundred characters each.
 *
 * Sentences end where a period, question or exclamation mark follows a word of at least four
 * letters, a year (four digits), an amount with its unit ("€22bn", "€470m", "€62,100", "104 %",
 * "12,6 Mrd. €") or a closing bracket or quote, and the next sentence starts with a capital. That is
 * deliberately cautious: "Mrd. Euro", "S. 16", "6. Juli", "Einzelplan 60. Der", "z. B." and
 * "e.g. The" are never cut, at the price of a few sentence ends that are not used: an amount counts
 * only with a currency sign or a percent sign, never as a bare number, which may be a date or an
 * ordinal. Nothing is dropped or changed: joined with spaces, the paragraphs give the text back.
 */

/** Words of four letters or more that end in a period without ending a sentence. */
const ABBREVIATIONS = new Set(["abschn", "bspw", "ggfs", "inkl", "insb", "prof", "sept", "ziff", "approx", "corp", "dept", "govt", "incl"]);

/**
 * An amount with its unit at the end of a text: a currency sign before the number, with an optional
 * short unit ("€22bn", "€470m", "$1.2tn", "€62,100"), or a percent or currency sign after it ("104 %",
 * "80%", "12,6 Mrd. €"). No abbreviation ends in one, so a period after it ends a sentence.
 */
const AMOUNT = /(?:[€$£]\s?\d[\d.,]*(?:\s?(?:bn|m|tn|k))?|[%€$£])$/u;

/** Where a sentence may end: the end mark and the space after it, before a capital or an opening quote or bracket. */
const END = /([.!?])(\s+)(?=["„“‚‘«»(]?\p{Lu})/gu;

/** The text cut into sentences; joined with single spaces they give the text back (up to its spacing). */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const match of text.matchAll(END)) {
    const at = match.index;
    const before = text.slice(start, at);
    const word = /(\p{L}+)$/u.exec(before)?.[1];
    const closing = /[)\]"'”“’»«]$/u.test(before);
    const year = /(?:^|[^\d.,])\d{4}$/.test(before);
    const amount = AMOUNT.test(before);
    const ends = closing || year || amount || (word !== undefined && word.length >= 4 && !ABBREVIATIONS.has(word.toLowerCase()));
    if (!ends) continue;
    out.push(text.slice(start, at + 1).trim());
    start = at + match[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * The text's own paragraphs: a blank line starts one, and nothing else does. For the notes of the
 * debt projection, which the pack breaks where it wants a break; a block stays whole however long.
 */
export function blocks(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * The text in paragraphs of about `target` characters, made of whole sentences. A short sentence
 * stays with the one before it rather than stand alone.
 */
export function paragraphs(text: string, target = 340): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block) => {
      if (block.length <= target * 1.4) return [block];
      const out: string[] = [];
      let current = "";
      for (const sentence of sentences(block)) {
        const fits = current.length + 1 + sentence.length <= target;
        // A short sentence is not left on its own if the paragraph before it has room enough.
        const short = sentence.length < 60 && current.length + 1 + sentence.length <= target * 1.35;
        if (current && !fits && !short) {
          out.push(current);
          current = sentence;
        } else {
          current = current ? `${current} ${sentence}` : sentence;
        }
      }
      if (current) out.push(current);
      return out;
    });
}
