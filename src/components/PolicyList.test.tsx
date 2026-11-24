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
    expect(chips()).toEqual(["All measures10", "Budget debate3", "Savings2"]);
    expect(chip("All measures").getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toHaveLength(10);
    expect(container.querySelector(".collection-note")).toBeNull();
  });

  it("narrows the list to a collection, alphabetically, says what it is, and puts it in the address", () => {
    mount("#lang=en&s=halve_mp_pay");
    click(chip("Budget debate"));
    expect(chip("Budget debate").getAttribute("aria-pressed")).toBe("true");
    // Revenue first, then spending; alphabetical within each.
    expect(cards()).toEqual(["wealth_tax", "cut_admin", "defense_target"]);
    expect(plain(query(".collection-note p").textContent)).toBe("Measures proposed in the debate on next year's budget.");
    expect(plain(query(".collection-note summary").textContent)).toBe("Sources (1)");
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay&f=budget_debate");
    // The topics are those of the collection's measures, alphabetically.
    expect(all(".filter__item").map((item) => plain(item.textContent))).toEqual(["All topics 3", "Defence 1", "State and administration 1", "Taxes 1"]);
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
    expect(chip("All measures").getAttribute("aria-pressed")).toBe("true");
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
    expect(chip("All measures").getAttribute("aria-pressed")).toBe("true");
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
    expect(chip("All measures").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.hash).toBe("#lang=en");
  });

  it("speaks German", () => {
    mount("#lang=de&s=halve_mp_pay&f=budget_debate");
    expect(chips()).toEqual(["Alle Maßnahmen10", "Haushaltsdebatte3", "Einsparungen2"]);
    expect(plain(query(".hidden-on").textContent)).toBe("1 eingeschaltete Maßnahme ist ausgeblendet und zählt trotzdem mit.Alle zeigen");
  });
});

describe("the two filter rows", () => {
  it("say what each first entry stands for: all measures, all topics", () => {
    mount();
    const firstCollection = plain(all(".collections__item")[0].querySelector(".collections__name")?.textContent);
    const firstTopic = plain(all(".filter__item")[0].textContent);
    expect(firstCollection).toBe("All measures");
    expect(firstTopic).toBe(`All topics ${testland.policies.length}`);
    mount("#lang=de");
    expect(plain(all(".collections__item")[0].querySelector(".collections__name")?.textContent)).toBe("Alle Maßnahmen");
    expect(plain(all(".filter__item")[0].textContent)).toBe(`Alle Themen ${testland.policies.length}`);
    // Each row is a group with a name of its own for screen readers.
    expect(query(".collections").getAttribute("aria-label")).toBe("Maßnahmen auswählen");
    expect(query(".filter").getAttribute("aria-label")).toBe("Thema");
  });

  describe("the topics as one row that scrolls sideways (a phone)", () => {
    /** Lays the row out as a phone would: 300 px wide, chips of 100 px one after the other. */
    function phoneLayout(): () => void {
      const scrolled: number[] = [];
      const row = (element: Element): boolean => element.classList.contains("filter");
      const chipIndex = (element: Element): number => [...(element.parentElement?.children ?? [])].indexOf(element);
      const descriptors = {
        scrollWidth: Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth"),
        clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth"),
        offsetLeft: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetLeft"),
        offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
        scrollTo: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo"),
      };
      Object.defineProperty(Element.prototype, "scrollWidth", {
        configurable: true,
        get(this: Element) {
          return row(this) ? this.children.length * 100 : 0;
        },
      });
      Object.defineProperty(Element.prototype, "clientWidth", {
        configurable: true,
        get(this: Element) {
          return row(this) ? 300 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains("filter__item") ? chipIndex(this) * 100 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains("filter__item") ? 100 : 0;
        },
      });
      Object.defineProperty(Element.prototype, "scrollTo", {
        configurable: true,
        value(this: Element, options: ScrollToOptions) {
          scrolled.push(options.left ?? 0);
          this.scrollLeft = options.left ?? 0;
          this.dispatchEvent(new Event("scroll"));
        },
      });
      (phoneLayout as unknown as { scrolled: number[] }).scrolled = scrolled;
      return () => {
        for (const [name, descriptor] of Object.entries(descriptors)) {
          const target = name === "offsetLeft" || name === "offsetWidth" ? HTMLElement.prototype : Element.prototype;
          if (descriptor) Object.defineProperty(target, name, descriptor);
          else delete (target as unknown as Record<string, unknown>)[name];
        }
      };
    }

    it("brings the chosen topic into view and marks the side where there is more", () => {
      const restore = phoneLayout();
      try {
        mount();
        const row = query(".filter");
        const chips = all(".filter__item");
        expect(chips.length).toBeGreaterThan(3);
        // At the start: more to the right only.
        expect([row.dataset.start, row.dataset.end]).toEqual(["false", "true"]);
        // The last chip, chosen with the keyboard as with a tap: scrolled into view.
        act(() => chips[chips.length - 1].click());
        const scrolled = (phoneLayout as unknown as { scrolled: number[] }).scrolled;
        expect(scrolled.at(-1)).toBe(chips.length * 100 - 300);
        expect(row.scrollLeft).toBe(chips.length * 100 - 300);
        expect([row.dataset.start, row.dataset.end]).toEqual(["true", "false"]);
        // Back to all topics: the row goes back to its start.
        act(() => all(".filter__item")[0].click());
        expect(row.scrollLeft).toBe(0);
        // The chips stay buttons that say whether they are chosen.
        expect(all(".filter__item").every((chip) => chip.tagName === "BUTTON" && chip.hasAttribute("aria-pressed"))).toBe(true);
      } finally {
        restore();
      }
    });
  });
});

describe("the badges", () => {
  it("name each collection a measure belongs to, also two", () => {
    mount();
    const badges = (id: string): string[] => all(`#policy-${id} .policy__badge`).map((badge) => plain(badge.textContent));
    expect(badges("cut_admin")).toEqual(["Budget debate", "Savings"]);
    expect(badges("wealth_tax")).toEqual(["Budget debate"]);
    expect(badges("family_bonus")).toEqual([]);
    // For screen readers the badges are introduced; the dot before the side is only for the eye.
    expect(plain(query("#policy-cut_admin .policy__tags").textContent)).toBe("State and administration · , Spending. Part of: Budget debateSavings");
  });
});

describe("the sections of the list, by the side of the budget", () => {
  const sections = (): string[] => all(".policy-side").map((section) => section.id);
  const headings = (): string[] => all(".policy-side__title").map((heading) => plain(heading.textContent));
  const cardsIn = (side: string): string[] => all(`#measures-${side} .policy`).map((card) => card.id.replace(/^policy-/, ""));
  const links = (): string[] => all(".sidelinks__link").map((link) => plain(link.textContent));

  it("puts revenue first, then spending, then both, each with a heading, its count and a line on what it holds", () => {
    mount("#lang=en&s=wealth_tax~cut_admin~halve_mp_pay");
    expect(sections()).toEqual(["measures-revenue", "measures-expenditure", "measures-both"]);
    // For screen readers a comma between the side and the count.
    expect(headings()).toEqual(["Revenue, 3 measures · 1 switched on", "Spending, 6 measures · 2 switched on", "Revenue and spending, 1 measure"]);
    expect(all(".policy-side__intro").map((line) => plain(line.textContent))).toEqual([
      "Measures that change what the state takes in: taxes, levies, contributions.",
      "Measures that change what the state spends: benefits, staff, subsidies.",
      "Measures that change both what the state takes in and what it spends.",
    ]);
    // Alphabetical within each.
    expect(cardsIn("revenue")).toEqual(["raise_top_tax_rate", "redraw_income_tax", "wealth_tax"]);
    expect(cardsIn("expenditure")).toEqual(["cut_admin", "cut_pensions", "defense_target", "family_bonus", "halve_mp_pay", "no_basic_income_non_citizens"]);
    expect(cardsIn("both")).toEqual(["insure_civil_servants"]);
    // Each section is named by its heading.
    for (const section of all(".policy-side")) expect(section.getAttribute("aria-labelledby")).toBe(section.querySelector("h3")?.id);
  });

  it("keeps the outline: the list's heading, the sections', then the cards'", () => {
    mount();
    const levels = all("#measures :is(h2, h3, h4)").map((heading) => heading.tagName);
    expect(levels[0]).toBe("H2");
    expect(levels[1]).toBe("H3");
    expect(levels.filter((tag) => tag === "H3")).toHaveLength(3);
    expect(levels.filter((tag) => tag === "H4")).toHaveLength(10);
    // Every card title stands below the heading of its section; the ids and classes the page relies on stay.
    for (const title of all(".policy__title")) {
      expect(title.tagName).toBe("H4");
      expect(title.closest(".policy-side")?.querySelector("h3")).not.toBeNull();
      expect(title.closest(".policy")?.id).toMatch(/^policy-/);
    }
  });

  it("speaks German", () => {
    mount("#lang=de&s=wealth_tax");
    expect(headings()).toEqual(["Einnahmen, 3 Maßnahmen · 1 eingeschaltet", "Ausgaben, 6 Maßnahmen", "Einnahmen und Ausgaben, 1 Maßnahme"]);
    expect(all(".policy-side__intro").map((line) => plain(line.textContent))).toEqual([
      "Maßnahmen, die ändern, was der Staat einnimmt: Steuern, Abgaben, Beiträge.",
      "Maßnahmen, die ändern, was der Staat ausgibt: Sozialleistungen, Personal, Zuschüsse.",
      "Maßnahmen, die ändern, was der Staat einnimmt und was er ausgibt.",
    ]);
    expect(query(".sidelinks").getAttribute("aria-label")).toBe("Abschnitte der Liste");
    expect(links()).toEqual(["Einnahmen3, 3 Maßnahmen", "Ausgaben6, 6 Maßnahmen", "Einnahmen und Ausgaben1, 1 Maßnahme"]);
  });

  it("leads to each section from a line of links, without changing the address", () => {
    const calls: ScrollToOptions[] = [];
    const before = window.scrollTo;
    window.scrollTo = ((options: ScrollToOptions) => void calls.push(options)) as typeof window.scrollTo;
    try {
      mount("#lang=en&s=wealth_tax");
      expect(query(".sidelinks").tagName).toBe("NAV");
      expect(query(".sidelinks").getAttribute("aria-label")).toBe("Sections of the list");
      // The count is for the eye; screen readers hear it in words.
      expect(links()).toEqual(["Revenue3, 3 measures", "Spending6, 6 measures", "Revenue and spending1, 1 measure"]);
      const spending = all(".sidelinks__link")[1] as HTMLAnchorElement;
      expect(spending.getAttribute("href")).toBe("#measures-expenditure");
      const hash = window.location.hash;
      click(spending);
      expect(window.location.hash).toBe(hash);
      expect(calls).toHaveLength(1);
      expect(document.activeElement).toBe(query("#measures-expenditure"));
    } finally {
      window.scrollTo = before;
    }
  });

  it("leaves out a section without a measure, keeps the heading of a single one, and then has no links", () => {
    mount("#lang=en&f=budget_debate");
    expect(sections()).toEqual(["measures-revenue", "measures-expenditure"]);
    expect(links()).toHaveLength(2);
    const taxes = all(".filter__item").find((item) => plain(item.textContent).startsWith("Taxes"))!;
    click(taxes);
    expect(sections()).toEqual(["measures-revenue"]);
    expect(headings()).toEqual(["Revenue, 1 measure"]);
    expect(container.querySelector(".sidelinks")).toBeNull();
  });

  it("says that the filter hides measures switched on, and a card brought into view from the waterfall stands in its section", () => {
    mount("#lang=en&s=halve_mp_pay&f=budget_debate");
    expect(plain(query(".hidden-on span").textContent)).toBe("1 measure switched on is hidden by the filter and still counts.");
    expect(container.querySelector("#policy-halve_mp_pay")).toBeNull();
    const link = all(".wf__link").find((candidate) => plain(candidate.textContent).includes("MPs"));
    if (!link) throw new Error("no link in the waterfall");
    click(link);
    expect(cardsIn("expenditure")).toContain("halve_mp_pay");
    expect(headings()[1]).toBe("Spending, 6 measures · 1 switched on");
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
