// @vitest-environment jsdom
/**
 * The list of measures on Testland with its filter by collection: "Budget debate" lists wealth_tax,
 * cut_admin and defense_target, with a description and a source; "Savings" lists cut_admin and
 * halve_mp_pay, without either. cut_admin is in both.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import type { CountryPack } from "../engine/index.ts";

let container: HTMLDivElement;
let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  const mounted = root;
  if (mounted) act(() => mounted.unmount());
  root = undefined;
  container.remove();
});

function mount(hash = "#lang=en", pack: CountryPack = testland): void {
  // A test may mount more than once: the page before goes first, so nothing of it is found.
  const previous = root;
  if (previous) act(() => previous.unmount());
  window.history.replaceState(null, "", hash);
  const created = createRoot(container);
  root = created;
  act(() => created.render(<Simulator pack={pack} />));
}

const plain = (value: string | null | undefined): string => (value ?? "").replace(/[  ]/g, " ");
const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const all = (selector: string): HTMLElement[] => [...container.querySelectorAll<HTMLElement>(selector)];
const cards = (): string[] => all(".policy-list > .policy").map((card) => card.id.replace(/^policy-/, ""));
const chips = (): string[] => all(".collections__item").map((chip) => plain(chip.textContent));
const chip = (name: string): HTMLButtonElement => {
  const found = all(".collections__item").find((candidate) => plain(candidate.querySelector(".collections__name")?.textContent) === name);
  if (!found) throw new Error(`no chip "${name}"`);
  return found as HTMLButtonElement;
};
const click = (element: Element): void => act(() => (element as HTMLElement).click());
const headline = (): string => plain(query(".scoreboard__number [data-final-value]").textContent);

describe("the filter by collection", () => {
  it("offers all measures and each collection, with how many measures each has", () => {
    mount();
    expect(query(".collections").getAttribute("role")).toBe("group");
    expect(query(".collections").getAttribute("aria-label")).toBe("Choose measures");
    expect(chips()).toEqual(["All10", "Budget debate3", "Savings2"]);
    expect(chip("All").getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toHaveLength(10);
    expect(container.querySelector(".collection-note")).toBeNull();
  });

  it("narrows the list to a collection in its order, says what it is, and puts it in the address", () => {
    mount("#lang=en&s=halve_mp_pay");
    click(chip("Budget debate"));
    expect(chip("Budget debate").getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toEqual(["wealth_tax", "cut_admin", "defense_target"]);
    expect(plain(query(".collection-note p").textContent)).toBe("Measures proposed in the debate on next year's budget.");
    expect(plain(query(".collection-note summary").textContent)).toBe("Sources (1)");
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay&f=budget_debate");
    // The topics are those of the collection's measures.
    expect(all(".filter__item").map((item) => plain(item.textContent))).toEqual(["All 3", "Taxes 1", "State and administration 1", "Defence 1"]);
  });

  it("a collection without a description and sources has no line about it", () => {
    mount("#lang=en&f=savings");
    expect(cards()).toEqual(["cut_admin", "halve_mp_pay"]);
    expect(container.querySelector(".collection-note")).toBeNull();
  });

  it("says how many measures switched on it hides, which still count, and shows them all again with one click", () => {
    mount("#lang=en&s=halve_mp_pay~family_bonus&f=budget_debate");
    expect(headline()).toBe("−XTS 495");
    expect(plain(query(".hidden-on").textContent)).toBe("2 measures switched on are hidden by the filter and still count.Show all");
    click(query(".hidden-on__show"));
    expect(chip("All").getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toHaveLength(10);
    expect(container.querySelector(".hidden-on")).toBeNull();
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay~family_bonus");
    expect(headline()).toBe("−XTS 495");
  });

  it("counts what the topic filter hides as well, in the singular for one", () => {
    mount("#lang=en&s=halve_mp_pay");
    const taxes = all(".filter__item").find((item) => plain(item.textContent).startsWith("Taxes"))!;
    click(taxes);
    expect(plain(query(".hidden-on span").textContent)).toBe("1 measure switched on is hidden by the filter and still counts.");
  });

  it("is lifted when a hidden measure is to be shown, from the waterfall", () => {
    mount("#lang=en&s=halve_mp_pay&f=budget_debate");
    const link = all(".wf__link").find((candidate) => plain(candidate.textContent).includes("MPs"));
    if (!link) throw new Error("no link in the waterfall");
    click(link);
    expect(chip("All").getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toContain("halve_mp_pay");
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay");
  });

  it("follows the address, and ignores a collection the pack does not have", () => {
    mount("#lang=en&f=savings");
    act(() => {
      window.history.replaceState(null, "", "#lang=en&f=budget_debate");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(cards()).toEqual(["wealth_tax", "cut_admin", "defense_target"]);
    mount("#lang=en&f=no_such_collection");
    expect(chip("All").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.hash).toBe("#lang=en");
  });

  it("speaks German", () => {
    mount("#lang=de&s=halve_mp_pay&f=budget_debate");
    expect(chips()).toEqual(["Alle10", "Haushaltsdebatte3", "Einsparungen2"]);
    expect(plain(query(".hidden-on").textContent)).toBe("1 eingeschaltete Maßnahme ist ausgeblendet und zählt trotzdem mit.Alle zeigen");
  });
});

describe("the badges", () => {
  it("name each collection a measure belongs to, also two", () => {
    mount();
    const badges = (id: string): string[] => all(`#policy-${id} .policy__badge`).map((badge) => plain(badge.textContent));
    expect(badges("cut_admin")).toEqual(["Budget debate", "Savings"]);
    expect(badges("wealth_tax")).toEqual(["Budget debate"]);
    expect(badges("family_bonus")).toEqual([]);
    // For screen readers the badges are introduced.
    expect(plain(query("#policy-cut_admin .policy__tags").textContent)).toBe("State and administration. Part of: Budget debateSavings");
  });
});

describe("a pack without collections", () => {
  it("has no filter by collection and no badges, and drops f from the address", () => {
    const pack = testlandCopy();
    delete pack.collections;
    mount("#lang=en&f=budget_debate", pack);
    expect(container.querySelector(".collections")).toBeNull();
    expect(container.querySelector(".policy__badge")).toBeNull();
    expect(cards()).toHaveLength(10);
    expect(window.location.hash).toBe("#lang=en");
  });
});

describe("a link from before a measure was renamed or split", () => {
  it("loads without an error, leaves out what the pack does not have, and rewrites the address without it", () => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent): void => void errors.push(event.error);
    window.addEventListener("error", onError);
    try {
      mount("#lang=en&s=vat_reduced_categories.rate.7~halve_mp_pay~cut_admin.cut.20.no_such_param.5&f=budget_debate");
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(errors).toEqual([]);
    // The measure that is gone and the setting that is gone are left out; the rest stays.
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay~cut_admin.cut.20&f=budget_debate");
    expect(query('#policy-cut_admin [role="switch"]').getAttribute("aria-checked")).toBe("true");
    expect(plain(query(".hidden-on span").textContent)).toBe("1 measure switched on is hidden by the filter and still counts.");
    expect(container.querySelector('[id^="policy-vat_reduced"]')).toBeNull();
  });
});
