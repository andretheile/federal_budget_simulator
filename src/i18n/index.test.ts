import { describe, expect, it } from "vitest";
import { de } from "./de.ts";
import { en } from "./en.ts";
import { intlLocale, languagesOf, localeFor, localize, messagesFor, pickLanguage } from "./index.ts";

describe("localize", () => {
  const text = { en: "Health", de: "Gesundheit" };

  it("returns the text in the wanted language", () => {
    expect(localize(text, "de")).toBe("Gesundheit");
    expect(localize(text, "en")).toBe("Health");
  });

  it("falls back to the base language, then to English", () => {
    expect(localize(text, "de-AT")).toBe("Gesundheit");
    expect(localize(text, "fr")).toBe("Health");
    expect(localize({ en: "Only English" }, "de")).toBe("Only English");
  });

  it("gives an empty string for a missing text", () => {
    expect(localize(undefined, "de")).toBe("");
  });
});

describe("dictionaries", () => {
  it("has one per language and falls back to English", () => {
    expect(messagesFor("de")).toBe(de);
    expect(messagesFor("de-CH")).toBe(de);
    expect(messagesFor("en")).toBe(en);
    expect(messagesFor("fr")).toBe(en);
  });

  /** Both dictionaries must answer every question, including the ones that are functions. */
  it("has the same keys in German and English", () => {
    const keys = (value: unknown, path = ""): string[] =>
      value !== null && typeof value === "object"
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${path}.${key}`))
        : [`${path}:${typeof value}`];
    expect(keys(de).sort()).toEqual(keys(en).sort());
  });
});

describe("pickLanguage", () => {
  const pack = ["de", "en"];

  it("offers the pack's locales, and English in any case", () => {
    expect(languagesOf(["de", "en"])).toEqual(["de", "en"]);
    expect(languagesOf(["fr"])).toEqual(["fr", "en"]);
  });

  it("prefers the link, then the stored choice, then the browser, then the pack's first locale", () => {
    expect(pickLanguage(pack, { url: "en", stored: "de", browser: ["de-DE"] })).toBe("en");
    expect(pickLanguage(pack, { stored: "en", browser: ["de-DE"] })).toBe("en");
    expect(pickLanguage(pack, { browser: ["fr-FR", "en-US"] })).toBe("en");
    expect(pickLanguage(pack, { browser: ["de-AT"] })).toBe("de");
    expect(pickLanguage(pack, { browser: ["ja"] })).toBe("de");
    expect(pickLanguage(pack)).toBe("de");
  });

  it("ignores a language the pack does not offer", () => {
    expect(pickLanguage(pack, { url: "fr", browser: ["en-GB"] })).toBe("en");
    expect(pickLanguage(pack, { url: "xx" })).toBe("de");
  });
});

describe("intlLocale", () => {
  it("formats English the British way and leaves other languages alone", () => {
    expect(intlLocale("en")).toBe("en-GB");
    expect(intlLocale("en-US")).toBe("en-US");
    expect(intlLocale("de")).toBe("de");
  });
});

describe("the locale a country is written in", () => {
  it("is the country's own English where English is its first language, British English otherwise", () => {
    expect(localeFor("en", { id: "us", locales: ["en", "de"] })).toBe("en-US");
    expect(localeFor("de", { id: "us", locales: ["en", "de"] })).toBe("de");
    expect(localeFor("en", { id: "de", locales: ["de", "en"] })).toBe("en-GB");
    // A region the engine does not know is no region: British English.
    expect(localeFor("en", { id: "xt", locales: ["en", "de"] })).toBe("en-GB");
  });
});
