// @vitest-environment jsdom
/**
 * The band of scoreboard and goal bar while it floats over the content is compact at every width:
 * that is decided by the stylesheets alone, so this reads them the way the browser does (as rules
 * inside media queries) and checks the rules that make it so. jsdom lays nothing out; how tall the
 * band then is was measured in real browsers.
 */
import { describe, expect, it } from "vitest";

/**
 * The stylesheet as written. Vitest hands CSS to tests as empty modules (also with ?raw), so it is
 * read from disk; through process.getBuiltinModule, as the app's own types know nothing of Node.
 */
type Fs = { readFileSync(path: URL, encoding: "utf8"): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): Fs } }).process.getBuiltinModule("node:fs");
const written = (file: string): string => fs.readFileSync(new URL(file, import.meta.url), "utf8");

/** Every style rule of a stylesheet with the media query it stands in ("" for none). */
function rulesOf(file: string): { media: string; selectors: string[]; style: CSSStyleDeclaration }[] {
  const element = document.createElement("style");
  element.textContent = written(file);
  document.head.appendChild(element);
  const sheet = element.sheet as CSSStyleSheet;
  const out: { media: string; selectors: string[]; style: CSSStyleDeclaration }[] = [];
  const walk = (rules: CSSRuleList, media: string): void => {
    for (const rule of [...rules]) {
      if (rule instanceof CSSMediaRule) walk(rule.cssRules, rule.media.mediaText);
      else if (rule instanceof CSSStyleRule)
        out.push({ media, selectors: rule.selectorText.split(",").map((part) => part.trim().replace(/\s+/g, " ")), style: rule.style });
    }
  };
  walk(sheet.cssRules, "");
  element.remove();
  return out;
}

/** The value a property gets for a selector inside a media query, from the last rule that sets it. */
function valueOf(file: string, media: string, selector: string, property: string): string {
  const matching = rulesOf(file).filter((rule) => rule.media.replace(/\s+/g, " ") === media && rule.selectors.includes(selector));
  const values = matching.map((rule) => rule.style.getPropertyValue(property)).filter(Boolean);
  return values.at(-1) ?? "";
}

describe("the band while it floats over the content", () => {
  it("has a smaller headline figure and less padding from a tablet on", () => {
    expect(valueOf("./scoreboard.css", "(min-width: 600px)", ".scoreboard.is-stuck .scoreboard__number", "font-size")).toMatch(/^clamp\(/);
    expect(valueOf("./scoreboard.css", "(min-width: 600px)", ".scoreboard.is-stuck .scoreboard__inner", "padding-block")).not.toBe("");
  });

  it("on a wide screen: goal, picker and bar in one line, the state in one more, the other lines left for the top of the page", () => {
    const media = "(min-width: 1080px)";
    for (const selector of [".scoreboard.is-stuck .goalbar__level", ".scoreboard.is-stuck .goalbar__excluded", ".scoreboard.is-stuck .goalbar__others"])
      expect(valueOf("./goal.css", media, selector, "display")).toBe("none");
    // What the other levels bear stays, in its short form beside the state.
    expect(valueOf("./goal.css", media, ".scoreboard.is-stuck .goalbar__others-chip", "display")).toBe("inline-flex");
    expect(valueOf("./goal.css", media, ".scoreboard.is-stuck .goalbar__inner", "grid-template-areas")).toMatch(/"head track track"\s*"status status status"/);
  });

  it("on a phone and a tablet: the goal by its year and level beside the bar, and the state in one line", () => {
    const media = "(max-width: 1079px)";
    for (const selector of [
      ".scoreboard.is-stuck .goalbar__picker",
      ".scoreboard.is-stuck .goalbar__more",
      ".scoreboard.is-stuck .goalbar__level",
      ".scoreboard.is-stuck .goalbar__excluded",
      ".scoreboard.is-stuck .goalbar__others",
      ".scoreboard.is-stuck .goalbar__room",
    ])
      expect(valueOf("./goal.css", media, selector, "display")).toBe("none");
    expect(valueOf("./goal.css", media, ".scoreboard.is-stuck .goalbar__label-year", "display")).toBe("inline");
    expect(valueOf("./goal.css", media, ".scoreboard.is-stuck .goalbar__line", "flex-wrap")).toBe("nowrap");
  });

  it("keeps the room of the words under the rows below them, ending in an empty row that takes what is left", () => {
    expect(valueOf("./goal.css", "", ".goalbar__room", "grid-row")).toBe("status-start / spacer-end");
    expect(valueOf("./goal.css", "", ".goalbar__inner", "grid-template-rows")).toBe("repeat(6, auto) 1fr");
    // Where the words have a row of their own with what is measured beside them, the room is theirs alone.
    expect(valueOf("./goal.css", "(min-width: 1080px)", ".goalbar__room", "grid-area")).toBe("status");
  });
});
