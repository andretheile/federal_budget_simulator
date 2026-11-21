/**
 * Alphabetical order as a reader of a language expects it, for lists the visitor scans by name
 * (measures, topics). Umlauts and other accents sort beside their base letters, case does not
 * count, numbers count as numbers ("CO2" before "CO10"), and a label that opens with a quotation
 * mark or a bracket sorts by its first letter („Rente mit 63“ under R). Labels that compare equal
 * keep the order they came in, so the order never depends on anything but the labels.
 */

/** What a label may open with that does not count for its place: quotation marks, brackets, dashes, spaces. */
const LEADING = /^[\s"'„“”‚‘’«»‹›([{–—-]+/u;

/** The part of a label that decides its place. */
export function sortKey(label: string): string {
  return label.replace(LEADING, "");
}

const collators = new Map<string, Intl.Collator>();

/** A collator for the language: base letters only (ä as a, A as a), numbers by value. */
export function collatorFor(language: string): Intl.Collator {
  let collator = collators.get(language);
  if (!collator) {
    try {
      collator = new Intl.Collator(language, { sensitivity: "base", numeric: true });
    } catch {
      collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    }
    collators.set(language, collator);
  }
  return collator;
}

/** The items in alphabetical order of their labels in the language; equal labels keep their order. */
export function alphabetical<T>(items: readonly T[], label: (item: T) => string, language: string): T[] {
  const collator = collatorFor(language);
  return items
    .map((item, index) => ({ item, index, key: sortKey(label(item)) }))
    .sort((a, b) => collator.compare(a.key, b.key) || a.index - b.index)
    .map(({ item }) => item);
}
