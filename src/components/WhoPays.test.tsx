// @vitest-environment jsdom
/**
 * Who pays on the page, with Testland and its incidence.json (testlandWhoPays): the section under
 * the budget, the switch between the scopes and its key in the address, the strip on a card, the
 * line near the top, and no section for a pack without the file.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { scopeFromHash, stateToHash } from "../app/urlState.ts";
import { testland, testlandWhoPays } from "../engine/__fixtures__/testland.ts";
import { emptyScenario, type CountryPack } from "../engine/index.ts";

const pack = testlandWhoPays();
let container: HTMLDivElement;
let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function mount(hash: string, which: CountryPack = pack): void {
  act(() => root?.unmount());
  window.history.replaceState(null, "", hash || window.location.pathname);
  root = createRoot(container);
  act(() => root!.render(<Simulator pack={which} />));
}

function widthOf(width: number): void {
  const answer = (media: string): boolean => {
    const max = /max-width:\s*(\d+)px/.exec(media);
    const min = /min-width:\s*(\d+)px/.exec(media);
    return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({ matches: answer(media), media, addEventListener() {}, removeEventListener() {} }),
  });
}

const plain = (value: string | null | undefined): string => (value ?? "").replace(/[  ]/g, " ");
const text = (selector: string): string => plain(container.querySelector(selector)?.textContent);
const button = (name: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) => plain(element.textContent).trim() === name);
  if (!found) throw new Error(`no button "${name}"`);
  return found;
};

describe("the section on who pays", () => {
  it("shows a row per group with the figures in words, and a sentence above them", () => {
    mount("#lang=en");
    const rows = container.querySelectorAll("#who-pays .wp-row");
    expect(rows).toHaveLength(3);
    expect(text("#who-pays-title")).toBe("Who pays");
    // The share is of the part that can be spread, which the sentence names first; the quality mark beside it.
    expect(text(".whopays__headline")).toBe(
      "Taxes: XTS 2,300 of XTS 2,500 can be spread over income groups. Top 10%: pays 39.6% of that, has 30.0% of income. Bottom half: pays 17.2%, has 20.0%. Data quality: Estimate",
    );
    expect(plain(rows[2].textContent)).toContain("pays 39.6% · has 30.0% of income");
    expect(plain(rows[2].textContent)).toContain("that is 303.3% of its income");
    expect(plain(rows[1].textContent)).toContain("from XTS");
    // The bounds come with what they mean.
    expect(text(".whopays__ranking")).toBe("Who is in which group: ranked by income per person");
    // Neutral ink: nothing in the section speaks in the colours of the balance.
    expect(container.querySelectorAll("#who-pays .delta")).toHaveLength(0);
  });

  it("with a measure on: today's share stays, the change in points and per person in words", () => {
    mount("#lang=en&s=raise_top_tax_rate");
    const rows = [...container.querySelectorAll("#who-pays .wp-row")].map((row) => plain(row.textContent));
    expect(rows[2]).toContain("pays 41.4% instead of 39.6%");
    // An average over the group, and said so.
    expect(rows[2]).toContain("pays on average XTS 9 more per person a year");
    expect(rows[0]).toContain("pays as much as before");
    expect(container.querySelectorAll("#who-pays .wp-row__today")).toHaveLength(3);
    expect(text(".whopays__measures")).toContain("Raise the top income tax rate");
  });

  it("adds the statement up to the revenue the scoreboard shows, with the taxes behind each line", () => {
    mount("#lang=en");
    const lines = [...container.querySelectorAll(".wp-line")].map((line) => plain(line.querySelector(".wp-line__name")?.textContent));
    expect(lines).toEqual(["People, spread by income", "Companies", "Not taxes", "Total revenue"]);
    expect(text(".wp-line--total .wp-line__amount")).toBe("XTS 4,000");
    expect(plain(container.querySelectorAll(".wp-line")[1].textContent)).toContain("Value added tax");
  });

  it("switches between the scopes, and the address remembers a scope that is not the first", () => {
    mount("#lang=en");
    act(() => button("Taxes and contributions").click());
    expect(button("Taxes and contributions").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.hash).toContain("w=all");
    act(() => button("Taxes").click());
    expect(window.location.hash).not.toContain("w=");
    mount("#lang=en&w=all");
    expect(button("Taxes and contributions").getAttribute("aria-pressed")).toBe("true");
  });

  it("is not there for a pack without incidence.json", () => {
    mount("#lang=en", testland);
    expect(container.querySelector("#who-pays")).toBeNull();
    expect(container.querySelector(".whopays-teaser")).toBeNull();
    expect(container.querySelector(".wp-strip")).toBeNull();
  });
});

describe("where the visitor changes a tax", () => {
  it("the card of a measure that is on shows who pays its change, groups and payers", () => {
    mount("#lang=en&s=raise_top_tax_rate~insure_civil_servants");
    const top = container.querySelector("#policy-raise_top_tax_rate .wp-strip");
    expect(plain(top?.textContent)).toContain("Bottom half: XTS 0 · Top 10%: XTS 9 more");
    const civil = container.querySelector("#policy-insure_civil_servants .wp-strip");
    expect(plain(civil?.textContent)).toContain("Not spread over the income groups: Companies XTS 15 less.");
    expect(plain(civil?.textContent)).toContain("Who pays more or less, on average per person a year");
    // Off, the face shows no strip.
    expect(container.querySelector("#policy-wealth_tax .wp-strip")).toBeNull();
  });

  it("the line near the top leads to the section beside two columns, and says which share moved", () => {
    widthOf(1440);
    // (910 + 93.75) / (2300 + 125) = 41.4 %.
    mount("#lang=en&s=raise_top_tax_rate");
    expect(text(".whopays-teaser")).toContain("Top 10%: 41.4% instead of 39.6% of the part that can be spread over groups (taxes), with the measures");
    expect(container.querySelector<HTMLAnchorElement>(".whopays-teaser a")?.getAttribute("href")).toBe("#who-pays");
    widthOf(390);
    mount("#lang=en&s=raise_top_tax_rate");
    expect(container.querySelector(".whopays-teaser")).toBeNull();
  });
});

describe("the address", () => {
  it("writes w only for a scope of the pack that is not its first", () => {
    const state = { scenario: emptyScenario(), language: "en" };
    expect(stateToHash({ ...state, scope: "all" }, pack)).toBe("#lang=en&w=all");
    expect(stateToHash({ ...state, scope: "taxes" }, pack)).toBe("#lang=en");
    expect(stateToHash({ ...state, scope: "nope" }, pack)).toBe("#lang=en");
    expect(stateToHash({ ...state, scope: "all" }, testland)).toBe("#lang=en");
    expect(scopeFromHash("#w=all", pack)).toBe("all");
    expect(scopeFromHash("#w=taxes", pack)).toBeUndefined();
    expect(scopeFromHash("#w=all", testland)).toBeUndefined();
  });
});
