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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
/** The starting points: each option's name (with its tag) and whether it is chosen. */
const radios = (): [string, boolean][] =>
  all<HTMLLabelElement>(".dstart__option").map((option) => [
    plain(option.querySelector(".dstart__label")?.textContent),
    option.querySelector<HTMLInputElement>("input")!.checked,
  ]);
function choose(name: string): void {
  const option = all<HTMLLabelElement>(".dstart__option").find((candidate) => plain(candidate.querySelector(".dstart__label")?.textContent) === name);
  if (!option) throw new Error(`no starting point "${name}"`);
  act(() => option.querySelector<HTMLInputElement>("input")!.click());
}
const press = (target: Element, key: string): void =>
  act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

describe("before its code has arrived", () => {
  // The body's code is loaded once, as for the other tests, so that no test waits for a dynamic
  // import whose timing is the module loader's; each attempt here is held back by hand instead.
  beforeAll(async () => {
    await debtModule.load();
  }, 30_000);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Each attempt to load the body waits until the test resolves or rejects it, inside act. */
  function holdBack(): { resolve(): Promise<void>; reject(): Promise<void> }[] {
    const attempts: { resolve(): Promise<void>; reject(): Promise<void> }[] = [];
    vi.spyOn(debtModule, "current").mockReturnValue(undefined);
    vi.spyOn(debtModule, "load").mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          attempts.push({
            resolve: () => act(async () => resolve(await import("./DebtBody.tsx"))),
            reject: () => act(async () => reject(new TypeError("Failed to fetch dynamically imported module"))),
          });
        }),
    );
    return attempts;
  }

  it("states the result at once and loads the rest when asked", async () => {
    const attempts = holdBack();
    mount();
    expect(lead()).toContain("15.8% of all its revenue on interest in 2054");
    // jsdom cannot tell when the section comes into view, so the section offers a button.
    expect(container.querySelector(".dchart")).toBeNull();
    expect(attempts).toHaveLength(0);
    click(button("Show the charts and assumptions"));
    expect(text(".debt__loading")).toBe("Loading the charts and assumptions …");
    expect(attempts).toHaveLength(1);
    await attempts[0].resolve();
    expect(container.querySelector(".debt__pending")).toBeNull();
    expect(all(".dchart")).toHaveLength(2);
  });

  it("says so when it cannot be loaded, and tries again on request", async () => {
    const attempts = holdBack();
    mount();
    click(button("Show the charts and assumptions"));
    await attempts[0].reject();
    expect(text(".debt__pending.is-failed p")).toBe("The charts could not be loaded. Perhaps there is no connection at the moment.");
    click(button("Try again"));
    expect(attempts).toHaveLength(2);
    await attempts[1].resolve();
    expect(all(".dchart")).toHaveLength(2);
  });
});

describe("the section on Testland", () => {
  beforeAll(async () => {
    await debtModule.load();
  }, 30_000);

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
    // The ministry's projection gives interest for 2026, so it is in this chart's legend too.
    expect(all(".dchart__legend")[0].textContent).toBe("without measuresMinistry projectionreference value");
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
    expect(plain(interestChart.querySelector(".dchart__legend")?.textContent)).toBe("without measureswith the measuresrange of the estimatesMinistry projectionreference value");
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
    expect(plain(interestChart.querySelector(".dchart__legend")?.textContent)).toBe("without measuresMinistry projectionreference value");
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

describe("the official plans", () => {
  beforeAll(async () => {
    await debtModule.load();
  }, 30_000);

  it("draws the comparable plan in every chart it has figures for, and never the cash plan", () => {
    mount();
    const [interestChart, debtChart] = all(".dchart");
    const debtPlan = debtChart.querySelector('[data-plan="ministry_projection"]')!;
    // Debt for 2025 and 2026: a dashed path and a diamond for each year.
    expect(debtPlan.querySelectorAll(".dchart__plan-line")).toHaveLength(1);
    expect(debtPlan.querySelectorAll(".dchart__plan-point")).toHaveLength(2);
    // Interest only for 2026: one diamond, no path, in either unit.
    const interestPlan = interestChart.querySelector('[data-plan="ministry_projection"]')!;
    expect(interestPlan.querySelectorAll(".dchart__plan-line")).toHaveLength(0);
    expect(interestPlan.querySelectorAll(".dchart__plan-point")).toHaveLength(1);
    click(button("Share of GDP"));
    expect(interestChart.querySelectorAll('[data-plan="ministry_projection"] .dchart__plan-point')).toHaveLength(1);
    expect(container.querySelector('[data-plan="central_budget_interest"]')).toBeNull();
    expect(plain(debtChart.querySelector(".dkey--plan")?.textContent)).toBe("Ministry projection");
  });

  it("reads the plan's figure out with the year that is pointed at", () => {
    mount();
    const debt = all('.dchart [role="slider"]')[1];
    act(() => debt.focus());
    press(debt, "Home");
    press(debt, "ArrowRight");
    expect(plain(debt.getAttribute("aria-valuetext"))).toMatch(/^2025: [\d.]+% \(XTS [\d,]+\) · official plan 52%$/);
    press(debt, "ArrowRight");
    expect(plain(debt.getAttribute("aria-valuetext"))).toMatch(/ · official plan 55%$/);
    press(debt, "ArrowRight");
    expect(plain(debt.getAttribute("aria-valuetext"))).not.toContain("official plan");
  });

  it("sets out both plans apart from the charts: how the comparable one differs, and the scope of the other", () => {
    mount();
    const plans = all(".dplan");
    expect(plans).toHaveLength(2);
    expect(text(".dplans > h3")).toBe("Official plans");
    expect(plain(plans[0].querySelector(".dplan__name")?.textContent)).toBe("Ministry projection");
    // Testland starts from its 2024 budget: the sentence contrasts that with the projection.
    expect(plain(plans[0].querySelector(".dplan__intro")?.textContent)).toBe(
      "With the budget of 2024 continued, debt without measures would reach 55.7% of GDP in 2026; this plan arrives at 55%: " +
        "it includes what has been decided since 2024. What it calculates differently is set out in its note.",
    );
    expect(plain(plans[0].querySelector(".debt__note")?.textContent)).toBe("Drawn in the charts as a dashed line, with diamonds at the years it gives figures for.");
    const rows = (plan: HTMLElement): string[][] =>
      [...plan.querySelectorAll("tr")].map((row) => [...row.children].map((cell) => plain(cell.textContent)));
    expect(rows(plans[0])).toEqual([
      ["Year", "Debt, share of GDP", "Balance, share of GDP", "Interest, share of GDP", "Interest, share of all revenue"],
      ["2025", "52%", "−4%", "–", "–"],
      ["2026", "55%", "−3.5%", "1.2%", "3%"],
    ]);
    expect(plain(plans[1].querySelector(".dplan__scope")?.textContent)).toBe(
      "Covers only the level “Central government” and is counted in cash. " +
        "The calculation above describes the whole state in national accounts. These figures cannot be compared with it, so they are not in the charts.",
    );
    expect(rows(plans[1])).toEqual([
      ["Year", "Interest"],
      ["2025", "XTS 110"],
      ["2026", "XTS 120"],
    ]);
    // Note, quality and sources one click away, as for the assumptions.
    const more = plans[1].querySelector("details")!;
    expect(plain(more.querySelector("summary")?.textContent)).toBe("Note, data quality and sources");
    expect(plain(more.querySelector(".dplan__note")?.textContent)).toBe("Cash figures of the central budget.");
    expect(more.querySelector(".sources a")?.getAttribute("href")).toBe("https://example.org/accounts");
  });

  it("speaks German", () => {
    mount("#lang=de");
    expect(text(".dplans > h3")).toBe("Amtliche Planungen");
    expect(plain(all(".dplan")[1].querySelector(".dplan__scope strong")?.textContent)).toBe(
      "Gilt nur für die Ebene „Zentralstaat“ und ist in Zahlungen gerechnet (Kassenzahlen).",
    );
  });

  it("is followed when chosen as the starting point on a pack that starts from its 2024 budget", () => {
    mount("#lang=en&s=halve_mp_pay");
    expect(container.querySelector(".dchart__marker")).toBeNull();
    expect(radios()).toEqual([
      ["Official plan to 2026", false],
      ["Continue the 2024 budgetdefault", true],
    ]);
    choose("Official plan to 2026");
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay&d=fministry_projection");
    expect(all(".dchart__marker text").map((label) => plain(label.textContent))).toEqual(["from 2027 by the assumptions", "from 2027 by the assumptions"]);
    expect(text("#debt .section-head p")).toBe(
      "A what-if calculation, not a forecast. Up to 2026, debt and growth follow the official plan “Ministry projection”; after that, the budget before interest keeps the share of economic output it has in 2026, and the assumptions apply. " +
        "With the measures switched on, the path departs from the plan from the first year.",
    );
    // A slider keeps the starting point; the reset goes back to the pack's.
    slide(slider("Market interest rate"), 8);
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay&d=r8~fministry_projection");
    click(button("Reset assumptions"));
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay");
    expect(container.querySelector(".dchart__marker")).toBeNull();
  });

  it("opens from a link that follows the plan; links without one, or with one that cannot be followed, start from 2024", { timeout: 30_000 }, () => {
    mount("#lang=en&d=fministry_projection");
    expect(radios()[0]).toEqual(["Official plan to 2026", true]);
    mount2("#lang=en&d=r8");
    expect(radios()[1]).toEqual(["Continue the 2024 budgetdefault", true]);
    // A plan that cannot be followed is dropped from the address.
    mount2("#lang=en&d=fcentral_budget_interest");
    expect(window.location.hash).toBe("#lang=en");
  });
});

describe("a pack that starts from its official plan", () => {
  // Testland with the ministry's projection as its starting path, as the German pack has the government's.
  const following = (): CountryPack => {
    const pack = testlandCopy();
    pack.debt!.follow = "ministry_projection";
    return pack;
  };
  beforeAll(async () => {
    await debtModule.load();
  }, 30_000);

  it("follows it by default, everywhere debt figures are shown, with nothing in the address", { timeout: 30_000 }, () => {
    mount("#lang=en", following());
    expect(window.location.hash).toBe("#lang=en");
    expect(text("#debt .section-head p")).toBe(
      "A what-if calculation, not a forecast. Up to 2026, debt and growth follow the official plan “Ministry projection”; after that, the budget before interest keeps the share of economic output it has in 2026, and the assumptions apply. " +
        "Measures that are switched on are added from the first year.",
    );
    expect(radios()).toEqual([
      ["Official plan to 2026default", true],
      ["Continue the 2024 budget", false],
    ]);
    // The projection's path runs through the plan's figures: the plan is its diamonds on that path,
    // with no line of its own, and the year after which the assumptions take over is marked.
    const debtChart = all(".dchart")[1];
    expect(debtChart.querySelectorAll('[data-plan="ministry_projection"] .dchart__plan-point')).toHaveLength(2);
    expect(debtChart.querySelectorAll('[data-plan="ministry_projection"] .dchart__plan-line')).toHaveLength(0);
    expect(debtChart.querySelector(".dkey--plan.is-on-path .dchart__plan-line")).toBeNull();
    expect(all(".dchart__marker")).toHaveLength(2);
    expect(plain(all(".dplan")[0].querySelector(".dplan__intro")?.textContent)).toMatch(/^The calculation starts from this plan up to 2026\. With the budget of 2024 continued, /);
    expect(plain(all(".dplan")[0].querySelector(".debt__note")?.textContent)).toBe(
      "In the charts, the diamonds on the path without measures, which follows its figures up to then.",
    );
    // The line near the top and the opening sentence have the followed path's figures.
    const followedLead = lead();
    act(() => root.unmount());
    mount("#lang=en&d=b", following());
    expect(lead()).not.toBe(followedLead);
  });

  it("switches to the 2024 budget and back as a starting point of its own, written into the address only when it is not the pack's", () => {
    mount("#lang=en", following());
    choose("Continue the 2024 budget");
    expect(window.location.hash).toBe("#lang=en&d=b");
    expect(container.querySelector(".dchart__marker")).toBeNull();
    expect(text("#debt .section-head p")).toBe(
      "A what-if calculation, not a forecast: how debt and interest would develop if the budget of 2024, with the measures switched on, kept its size relative to the economy.",
    );
    // The plan is a dashed line of its own again.
    expect(all(".dchart")[1].querySelectorAll('[data-plan="ministry_projection"] .dchart__plan-line')).toHaveLength(1);
    choose("Official plan to 2026default");
    expect(window.location.hash).toBe("#lang=en");
  });

  it("keeps the starting point when a preset or a slider changes the assumptions, on either path", { timeout: 30_000 }, () => {
    mount("#lang=en", following());
    const high = button("High rates");
    click(high);
    expect(high.getAttribute("aria-pressed")).toBe("true");
    expect(window.location.hash).toBe("#lang=en&d=r8");
    expect(radios()[0][1]).toBe(true);
    expect(all(".dchart__marker")).toHaveLength(2);
    choose("Continue the 2024 budget");
    expect(window.location.hash).toBe("#lang=en&d=r8~b");
    // The preset still applies: it is about the rate, not the path.
    expect(high.getAttribute("aria-pressed")).toBe("true");
    click(button("Zero rates"));
    expect(window.location.hash).toBe("#lang=en&d=r0~b");
    expect(radios()[1][1]).toBe(true);
    click(button("Reset assumptions"));
    expect(window.location.hash).toBe("#lang=en");
    expect(radios()[0][1]).toBe(true);
  });

  it("says that the path with measures departs from the plan from the first year", () => {
    mount("#lang=en&s=halve_mp_pay", following());
    expect(text("#debt .section-head p")).toMatch(/With the measures switched on, the path departs from the plan from the first year\.$/);
    act(() => root.unmount());
    mount("#lang=de&s=halve_mp_pay", following());
    expect(text("#debt .section-head p")).toMatch(/Mit den eingeschalteten Maßnahmen weicht der Pfad vom ersten Jahr an von der Planung ab\.$/);
  });

  it("reads every form of the address", { timeout: 30_000 }, () => {
    const opened = (hash: string): { path: boolean[]; hash: string } => {
      mount(hash, following());
      const state = { path: radios().map(([, checked]) => checked), hash: window.location.hash };
      act(() => root.unmount());
      return state;
    };
    // The pack's starting point needs nothing; the other is "b".
    expect(opened("#lang=en")).toEqual({ path: [true, false], hash: "#lang=en" });
    expect(opened("#lang=en&d=b")).toEqual({ path: [false, true], hash: "#lang=en&d=b" });
    // A link that names the pack's own plan follows it, and the address is written again without it.
    expect(opened("#lang=en&d=fministry_projection")).toEqual({ path: [true, false], hash: "#lang=en" });
    expect(opened("#lang=en&d=r8~fministry_projection")).toEqual({ path: [true, false], hash: "#lang=en&d=r8" });
    // A link from before the pack named a starting point, with assumptions only: the pack's starting point.
    expect(opened("#lang=en&d=r8~y40")).toEqual({ path: [true, false], hash: "#lang=en&d=r8~y40" });
    // A plan the pack does not have, or one that cannot be followed: the pack's starting point.
    expect(opened("#lang=en&d=fno_such")).toEqual({ path: [true, false], hash: "#lang=en" });
    expect(opened("#lang=en&d=fcentral_budget_interest~b")).toEqual({ path: [false, true], hash: "#lang=en&d=b" });
    root = createRoot(container);
  });

  it("speaks German", () => {
    mount("#lang=de", following());
    expect(radios()).toEqual([
      ["Amtliche Planung bis 2026Vorgabe", true],
      ["Haushalt 2024 fortschreiben", false],
    ]);
    expect(plain(container.querySelector(".dstart legend")?.textContent)).toBe("Ausgangspunkt");
    expect(all(".dchart__marker text").map((label) => plain(label.textContent))).toEqual(["ab 2027 nach den Annahmen", "ab 2027 nach den Annahmen"]);
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
