// @vitest-environment jsdom
/**
 * A second kind of pack, on the US pack as it is in the working tree: a fiscal year with its own
 * short name, one level of government, the US dollar counted in trillions, American English, and
 * (for now) no measures. The German pack is checked against the same places, unchanged.
 *
 * If the pack does not validate, the test fails with the pack's own errors.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Simulator } from "../App.tsx";
import { testland } from "../engine/__fixtures__/testland.ts";
import type { CountryPack } from "../engine/index.ts";
import { loadPack } from "../packs.ts";

vi.setConfig({ testTimeout: 30_000 });

let us: CountryPack;
let container: HTMLDivElement;
let root: Root | undefined;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  const result = await loadPack("us");
  if (!result.ok) throw new Error(`countries/us does not validate: ${JSON.stringify(result.errors.slice(0, 3))}`);
  us = result.pack;
}, 60_000);

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

function mount(hash: string, pack: CountryPack, extra: { countries?: string[]; previews?: string[] } = {}): void {
  act(() => root?.unmount());
  window.history.replaceState(null, "", hash);
  root = createRoot(container);
  act(() => root!.render(<Simulator pack={pack} onCountry={() => {}} {...extra} />));
}

/** A window of this width: media queries answered the way the browser would. */
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
/** Opens the first item of the budget's list that has details of its own (a leaf), and returns them. */
function firstLeafDetails(): string {
  const button = container.querySelector<HTMLButtonElement>(".row button.row__main[aria-expanded]");
  if (!button) throw new Error("no leaf in the list");
  act(() => button.click());
  return plain(container.querySelector(".row__details:not([hidden])")?.textContent);
}

describe("the US pack", () => {
  it("names its fiscal year as the pack does, in headings and labels", () => {
    mount("#lang=en", us);
    expect(text(".scoreboard__label")).toBe("Balance FY 2025");
    expect(text("#budget-title")).toBe("The budget in FY 2025");
    expect(text(".masthead__country")).toBe("United States, fiscal year 2025 (Oct 2024 to Sep 2025)");
    expect(document.title).toBe("Budget Simulator: United States, FY 2025");
    mount("#lang=de", us);
    expect(text(".scoreboard__label")).toBe("Saldo Haushaltsjahr 2025");
    expect(text("#budget-title")).toBe("Der Haushalt im Haushaltsjahr 2025");
  });

  it("counts in trillions, in American English and in German", () => {
    mount("#lang=en", us);
    expect(text(".scoreboard__number [data-final-value]")).toMatch(/^−\$\d\.\d\dT$/);
    expect(text(".scoreboard__side:last-child .scoreboard__amount [data-final-value]")).toMatch(/^\$\d\.\d\dT$/);
    mount("#lang=de", us);
    expect(text(".scoreboard__number [data-final-value]")).toMatch(/^−\d,\d\d Bio\. \$$/);
  });

  it("does not say on every item that the one level bears all of it", () => {
    mount("#lang=en", us);
    expect(firstLeafDetails()).not.toContain("Borne by");
    // Germany's levels are named as before.
    mount("#lang=en", testland);
    expect(firstLeafDetails()).toContain("Borne by");
  });

  it("does not name the one level after a shifted effect on a card", () => {
    const shifting = us.policies.find((policy) => policy.effects.some((effect) => effect.shift));
    if (!shifting) return; // No US measure shifts an effect yet.
    mount(`#lang=en&s=${shifting.id}`, us);
    const shift = text(`#policy-${shifting.id} .policy__shift`);
    expect(shift.length).toBeGreaterThan(0);
    expect(shift).not.toContain("(Federal government)");
  });

  it("without measures yet: the budget first on one column, and no row of one section", () => {
    if (us.policies.length > 0) return; // The pack has gained measures meanwhile: nothing to check here.
    widthOf(390);
    mount("#lang=en", us);
    expect([...container.querySelectorAll(".workspace > section")].map((element) => element.id)).toEqual(["budget", "measures"]);
    expect(container.querySelector(".sectionnav")).toBeNull();
    expect(text(".masthead__tagline")).toMatch(/^Where the money in the public budget comes from/);
    expect(text(".scoreboard__change")).toBe("As in FY 2025.");
  });
});

describe("Germany, in the same places", () => {
  it("keeps the bare year, billions and British English", () => {
    mount("#lang=en", testland);
    expect(text(".scoreboard__label")).toBe("Balance 2024All levels");
    expect(text("#budget-title")).toBe("The budget in 2024");
    mount("#lang=de", testland);
    expect(text("#budget-title")).toBe("Der Haushalt 2024");
  });
});

describe("a preview pack", () => {
  it("is marked in the country switch, and on its own page", () => {
    mount("#lang=en", testland, { countries: ["xx", "yy"], previews: ["yy"] });
    expect([...container.querySelectorAll(".masthead__tools select option")].map((option) => plain(option.textContent))).toEqual([
      expect.stringMatching(/^[^(]+$/),
      expect.stringMatching(/ \(preview\)$/),
    ]);
    expect(container.querySelector(".dev-notice--preview")).toBeNull();
    mount("#lang=de", testland, { countries: ["xx", "yy"], previews: ["xx"] });
    expect(text(".dev-notice--preview")).toMatch(/^Vorschau: Dieses Land ist noch nicht veröffentlicht\./);
    expect(plain(container.querySelector(".masthead__tools select option")?.textContent)).toMatch(/ \(Vorschau\)$/);
  });
});
