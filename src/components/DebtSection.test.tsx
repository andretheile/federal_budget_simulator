// @vitest-environment jsdom
/**
 * The debt projection on the Testland fixture, used the way a visitor would: read, moved through
 * the sliders, the presets and the keyboard, shared by link, and with measures switched on.
 *
 * Testland at the defaults (market rate 4 %, growth 3 %, 30 years): interest goes from 2.5 % of
 * revenue in 2024 to 15.8 % in 2054, the debt from 50 % to 167 % of GDP, and interest overtakes
 * defence in 2028.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import type { CountryPack } from "../engine/index.ts";
import { debtModule } from "./DebtSection.tsx";

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  // jsdom lays nothing out; the charts draw once their frame has a width.
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) } as DOMRect;
  };
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(hash = "#lang=en", pack: CountryPack = testland): void {
  window.history.replaceState(null, "", hash);
  root = createRoot(container);
  act(() => root.render(<Simulator pack={pack} />));
}

const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const all = <T extends Element = HTMLElement>(selector: string): T[] => [...container.querySelectorAll<T>(selector)];
const plain = (value: string | null | undefined): string => (value ?? "").replace(/[  ]/g, " ");
const text = (selector: string): string => plain(query(selector).textContent);
const lead = (): string => text(".debt__lead");
const click = (element: HTMLElement): void => act(() => element.click());
const button = (name: string): HTMLButtonElement => {
  const found = all<HTMLButtonElement>("#debt button").find((candidate) => plain(candidate.textContent) === name);
  if (!found) throw new Error(`no button "${name}"`);
  return found;
};
/** The slider of an assumption, found by its label. */
function slider(label: string): HTMLInputElement {
  const found = all<HTMLLabelElement>(".dpanel label").find((candidate) => plain(candidate.textContent) === label);
  if (!found) throw new Error(`no slider "${label}"`);
  return container.querySelector<HTMLInputElement>(`[id="${found.htmlFor}"]`)!;
}
function slide(input: HTMLInputElement, value: number): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (target: Element, key: string): void =>
  act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

describe("before its code has arrived", () => {
  it("states the result at once and loads the rest when asked", async () => {
    mount();
    expect(lead()).toContain("15.8% of all its revenue on interest in 2054");
    // jsdom cannot tell when the section comes into view, so the section offers a button.
    expect(container.querySelector(".dchart")).toBeNull();
    click(button("Show the charts and assumptions"));
    await act(async () => {
      await debtModule.load();
    });
    expect(all(".dchart")).toHaveLength(2);
  });
});

describe("the section on Testland", () => {
  beforeAll(async () => {
    await debtModule.load();
  });

  it("opens with a sentence that states the result for the last year, against the base year", () => {
    mount();
    expect(lead()).toBe(
      "At 4% interest on new debt, the state would have to spend 15.8% of all its revenue on interest in 2054; in 2024 it was 2.5%. " +
        "Its debt would be 167% of economic output (GDP); in 2024 it was 50%. " +
        "From 2028, interest would cost more than everything the state spends on Defence.",
    );
    expect(text("#debt-title")).toBe("Where this leads: debt and interest");
    // The data's note on what the calculation leaves out is shown, not hidden.
    expect(text(".debt__limits")).toContain("A what-if calculation, not a forecast.");
    // One path without measures: one line, no band.
    expect(all(".dchart")[0].querySelectorAll(".dchart__line")).toHaveLength(1);
    expect(container.querySelector(".dchart__band")).toBeNull();
    expect(all(".dchart__legend")[0].textContent).toBe("without measuresreference value");
  });

  it("speaks German", () => {
    mount("#lang=de");
    expect(lead()).toMatch(/^Bei 4 % Zins für neue Schulden müsste der Staat im Jahr 2054 15,8 % aller Einnahmen für Zinsen ausgeben; 2024 waren es 2,5 %\./);
    expect(lead()).toContain("Ab 2028 kosteten die Zinsen mehr als alles, was der Staat für Verteidigung ausgibt.");
  });

  it("follows a slider at once, and puts what differs from the default into the address", () => {
    mount();
    expect(window.location.hash).toBe("#lang=en");
    slide(slider("Market interest rate"), 8);
    expect(lead()).toMatch(/^At 8% interest on new debt/);
    expect(window.location.hash).toBe("#lang=en&d=r8");
    slide(slider("Years"), 40);
    expect(lead()).toContain("in 2064");
    expect(window.location.hash).toBe("#lang=en&d=r8~y40");
    // Back to the default: the field goes again.
    slide(slider("Market interest rate"), 4);
    slide(slider("Years"), 30);
    expect(window.location.hash).toBe("#lang=en");
  });

  it("shows which preset applies, with its note and sources, and resets to the defaults", () => {
    mount();
    const high = button("High rates");
    const ageing = button("Ageing");
    expect(high.getAttribute("aria-pressed")).toBe("false");
    click(high);
    expect(high.getAttribute("aria-pressed")).toBe("true");
    expect(slider("Market interest rate").value).toBe("8");
    expect(text(".dpresets__note")).toContain("Chosen: High rates");
    expect(container.querySelector(".dpresets__note .sources")).not.toBeNull();
    expect(window.location.hash).toBe("#lang=en&d=r8");
    // A second preset keeps what it does not set.
    click(ageing);
    expect(high.getAttribute("aria-pressed")).toBe("true");
    expect(ageing.getAttribute("aria-pressed")).toBe("true");
    expect(window.location.hash).toBe("#lang=en&d=r8~g2~p-0.1");
    expect(text(".dpanel")).toContain("Pensions and health grow faster than the economy.");
    const reset = button("Reset assumptions");
    click(reset);
    expect(window.location.hash).toBe("#lang=en");
    expect(high.getAttribute("aria-pressed")).toBe("false");
    expect(reset.getAttribute("aria-disabled")).toBe("true");
  });

  it("reproduces the projection from a shared link", () => {
    mount("#lang=en&d=r8~y40");
    expect(lead()).toMatch(/^At 8% interest on new debt, the state would have to spend [\d.]+% of all its revenue on interest in 2064/);
    expect(slider("Market interest rate").value).toBe("8");
    expect(slider("Years").value).toBe("40");
    expect(button("High rates").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.hash).toBe("#lang=en&d=r8~y40");
  });

  it("follows the address when the browser moves through its history", () => {
    mount();
    act(() => {
      window.history.replaceState(null, "", "#lang=en&d=r0");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(lead()).toMatch(/^At 0% interest on new debt/);
    expect(button("Zero rates").getAttribute("aria-pressed")).toBe("true");
  });

  it("with measures: two paths, the range as a band, and what the measures change", () => {
    mount("#lang=en&s=family_bonus~no_basic_income_non_citizens");
    expect(lead()).toMatch(/with the measures switched on \([\d.]+% to [\d.]+%, depending on the estimates\), and 15.8% without them/);
    const [interestChart] = all(".dchart");
    expect(interestChart.querySelectorAll(".dchart__line")).toHaveLength(2);
    expect(interestChart.querySelector(".dchart__band")).not.toBeNull();
    expect(plain(interestChart.querySelector(".dchart__legend")?.textContent)).toBe("without measureswith the measuresrange of the estimatesreference value");
    // Family benefits as the measure leaves them: 3 % of GDP instead of 2 %.
    const families = all(".dcmp__row").find((row) => row.textContent?.startsWith("Families"))!;
    expect(plain(families.textContent)).toContain("with the measures: XTS 300, 3.0% of GDP");
  });

  it("names the year interest overtakes each budget item, or that it does not", () => {
    mount();
    const rows = all(".dcmp__row").map((row) => [plain(row.querySelector(".dcmp__name")?.textContent), plain(row.querySelector(".dcmp__when")?.textContent)]);
    expect(rows).toEqual([
      ["Parliament", "already in 2024"],
      ["Defence", "from 2028"],
      ["Families", "from 2028"],
      ["Pensions", "not by 2054"],
    ]);
  });

  it("compares with the reference values in the view a visitor sees first, and as a share of GDP", () => {
    mount();
    const [interestChart, debtChart] = all(".dchart");
    // As a share of revenue: the neighbour, whose interest is 3.5 % of GDP on revenue of 35 % of GDP, at 10 %.
    // Testland 1995 gives no revenue, so it has no line here.
    expect([...interestChart.querySelectorAll("[data-reference]")].map((g) => g.getAttribute("data-reference"))).toEqual(["neighbour"]);
    expect(plain(interestChart.querySelector(".dchart__legend")?.textContent)).toBe("without measuresreference value");
    expect(container.querySelector(".debt__main > .debt__note")).toBeNull();
    expect(debtChart.querySelectorAll(".dchart__refs > g")).toHaveLength(2);
    expect(debtChart.querySelector(".is-threshold")).not.toBeNull();
    click(button("Share of GDP"));
    expect(button("Share of GDP").getAttribute("aria-pressed")).toBe("true");
    expect(interestChart.querySelectorAll(".dchart__refs > g")).toHaveLength(2);
    expect(plain(interestChart.querySelector(".dchart__refs")?.textContent)).toBe("Neighbouring countryTestland 1995");
    // The list gives both figures of interest, and when the projection reaches each.
    const neighbour = all(".dref__row")[0];
    expect(plain(neighbour.textContent)).toContain("Neighbouring country 2024");
    expect(plain(neighbour.textContent)).toMatch(/interest 10\.0% of revenue: reached in 20\d\d/);
    expect(plain(neighbour.textContent)).toContain("interest 3.5% of GDP: reached in 2037");
    expect(plain(neighbour.textContent)).toContain("debt 120% of GDP: reached in 2044");
    expect(plain(all(".dref__row")[2].textContent)).not.toContain("of revenue");
  });

  it("puts the figures of a year under one another in the table on a phone", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({ matches: query === "(max-width: 719px)", media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      mount();
      expect(container.querySelector(".debt__scroll")).toBeNull();
      expect(all(".debt__compact thead th").map((cell) => plain(cell.textContent))).toEqual(["Year", "Interest", "Debt"]);
      const first = all(".debt__compact tbody tr")[0];
      expect([...first.querySelectorAll("td span")].map((cell) => plain(cell.textContent))).toEqual([
        "2.5% of revenue",
        "1.0% of GDP",
        "XTS 100",
        "50.0% of GDP",
        "XTS 5,000",
      ]);
      // With measures: the year over a row without and a row with them.
      mount2("#lang=en&s=family_bonus");
      const year = all(".debt__compact tbody")[0];
      expect([...year.querySelectorAll("th")].map((cell) => plain(cell.textContent))).toEqual(["2024", "without", "with"]);
      expect(year.querySelectorAll("td")).toHaveLength(4);
    } finally {
      window.matchMedia = original;
    }
  });

  it("reads the values of a year on the keyboard, in both charts", () => {
    mount();
    const [interest, debt] = all('.dchart [role="slider"]');
    expect(interest.getAttribute("aria-label")).toBe("Interest, year by year");
    act(() => interest.focus());
    expect(interest.getAttribute("aria-valuenow")).toBe("2054");
    press(interest, "Home");
    expect(interest.getAttribute("aria-valuenow")).toBe("2024");
    expect(plain(interest.getAttribute("aria-valuetext"))).toMatch(/^2024: 2.5% \(XTS 100\)$/);
    press(interest, "PageUp");
    press(interest, "ArrowRight");
    expect(interest.getAttribute("aria-valuenow")).toBe("2030");
    // The other chart shows the same year.
    expect(debt.getAttribute("aria-valuenow")).toBe("2030");
    expect(plain(text(".dchart__readout"))).toMatch(/^2030: /);
  });

  it("lists selected years in a table", () => {
    mount();
    const years = all(".debt__table tbody th").map((cell) => cell.textContent);
    expect(years).toEqual(["2024", "2029", "2034", "2039", "2044", "2049", "2054"]);
    const first = all(".debt__table tbody tr")[0];
    expect([...first.querySelectorAll("td")].map((cell) => plain(cell.textContent))).toEqual(["2.5%", "1.0%", "XTS 100", "50.0%", "XTS 5,000"]);
  });

  it("says that the projection is for the whole state when the page shows one level", () => {
    mount("#lang=en&s=cut_admin~L.central");
    expect(text(".debt__level")).toContain("This calculation is for the whole state");
    mount2("#lang=en&s=cut_admin");
    expect(container.querySelector(".debt__level")).toBeNull();
  });

  it("is reached from the top of the page and from the footer", () => {
    mount();
    expect(query<HTMLAnchorElement>(".debt-teaser a").getAttribute("href")).toBe("#debt");
    expect(text(".debt-teaser")).toContain("Interest in 2054: 15.8% of all revenue (2024: 2.5%)");
    const footer = all<HTMLAnchorElement>(".footer__links a").find((link) => link.textContent === "Debt and interest");
    expect(footer?.getAttribute("href")).toBe("#debt");
  });
});

describe("a pack without debt data", () => {
  it("has no section, no line at the top and no link in the footer", () => {
    const pack = testlandCopy();
    delete pack.debt;
    mount("#lang=en&d=r8", pack);
    expect(container.querySelector("#debt")).toBeNull();
    expect(container.querySelector(".debt-teaser")).toBeNull();
    expect(all(".footer__links a").map((link) => link.textContent)).toEqual([
      "About the numbers",
      "Source code on GitHub (opens in a new tab)",
    ]);
    // A debt field from another country's link is dropped.
    expect(window.location.hash).toBe("#lang=en");
  });
});

/** Mount again in the same test, after taking the first one down. */
function mount2(hash: string): void {
  act(() => root.unmount());
  mount(hash);
}
