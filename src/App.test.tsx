// @vitest-environment jsdom
/**
 * Mounts the whole interface on the Testland fixture and uses it the way a visitor would:
 * through the switch, the slider and the level filter, reading what the page then says.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "./App.tsx";
import { testland } from "./engine/__fixtures__/testland.ts";

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no canvas; the bar labels then simply stay out.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

/** A fresh in-memory localStorage per test; the one of the test environment is not reliable across Node versions. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(hash = ""): void {
  if (hash) window.history.replaceState(null, "", hash);
  root = createRoot(container);
  act(() => root.render(<Simulator pack={testland} />));
}

const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const text = (selector: string): string => (query(selector).textContent ?? "").replace(/[  ]/g, " ");
/** The headline figure as screen readers get it: the final value, not a frame of the animation. */
const headline = (): string => text(".scoreboard__number [data-final-value]");
const click = (selector: string): void => act(() => query(selector).click());

describe("the simulator on Testland", () => {
  it("shows today's balance and changes it when a measure is switched on", () => {
    mount("#lang=en");
    expect(headline()).toBe("−XTS 400");
    expect(text('[data-testid="balance-state"]')).toBe("Deficit");
    expect(text(".scoreboard__change")).toContain("No measure is switched on");

    const toggle = '#policy-halve_mp_pay [role="switch"]';
    expect(query(toggle).getAttribute("aria-checked")).toBe("false");
    click(toggle);

    expect(query(toggle).getAttribute("aria-checked")).toBe("true");
    expect(headline()).toBe("−XTS 395");
    expect(text(".scoreboard__change")).toContain("+XTS 5");
    expect(text(".scoreboard__change")).toContain("1 measure switched on");
    // The scenario is in the address, without a new history entry.
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay");
    // And the waterfall names the measure between today and the simulated balance.
    expect(text(".wf")).toContain("Halve MPs' pay");
    expect(text(".wf")).toContain("Simulated");

    click(toggle);
    expect(headline()).toBe("−XTS 400");
    expect(window.location.hash).toBe("#lang=en");
  });

  it("restores a scenario and the language from the address", () => {
    mount("#lang=de&s=defense_target.share.4~family_bonus");
    expect(document.documentElement.lang).toBe("de");
    expect(text('[data-testid="balance-state"]')).toBe("Defizit");
    // 400 deficit, defence 200 -> 400 and family bonus +100.
    expect(headline()).toBe("−700 XTS");
    expect(query('#policy-defense_target [role="switch"]').getAttribute("aria-checked")).toBe("true");
    expect(query('#policy-cut_admin [role="switch"]').getAttribute("aria-checked")).toBe("false");
  });

  it("previews a setting on the card before the measure is switched on, then applies it", () => {
    mount("#lang=en");
    click("#policy-cut_admin .policy__more");
    const slider = query<HTMLInputElement>("#cut_admin-cut");
    expect(slider.getAttribute("aria-valuetext")).toBe("10%");
    expect(text("#policy-cut_admin .policy__amount")).toContain("+XTS 40");

    // React listens for the native input event; set the value the way a browser does.
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "25");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(text("#policy-cut_admin .policy__amount")).toContain("+XTS 100");
    expect(headline()).toBe("−XTS 400");

    click('#policy-cut_admin [role="switch"]');
    expect(headline()).toBe("−XTS 300");
    expect(window.location.hash).toBe("#lang=en&s=cut_admin.cut.25");
  });

  it("shows a blocker where nobody can miss it, on the card and among the catches", () => {
    mount("#lang=en");
    const card = "#policy-no_basic_income_non_citizens";
    expect(text(`${card} .catch-tag--blocker`)).toContain("Blocker: legal");
    click(`${card} .policy__more`);
    expect(text(`${card} .catch--blocker`)).toContain("The constitution guarantees a subsistence minimum.");
    expect(text(`${card} .catch--blocker .catch__severity`)).toBe("Blocker");
    // The range of the estimate and its quality are stated.
    expect(text(`${card} .facts`)).toContain("+XTS 36 to +XTS 90");
    expect(text(`${card} .facts`)).toContain("Estimate");
  });

  it("shows the change, not a balance, for a single level of government", () => {
    mount("#lang=en&s=defense_target~L.central");
    expect(text(".scoreboard__label")).toBe("Central government: change compared with today");
    expect(headline()).toBe("−XTS 100");
    expect(text('[data-testid="balance-state"]')).toBe("Burden");
    expect(text(".scoreboard__change")).toContain("No balance is shown for a single level");
    expect(container.querySelector(".scoreboard__ratios")).toBeNull();
    expect(container.querySelector(".bar__gap-label")).toBeNull();
  });

  it("switches language without losing the scenario", () => {
    mount("#lang=en&s=halve_mp_pay");
    expect(document.documentElement.lang).toBe("en");
    click('.langs button[lang="de"]');
    expect(document.documentElement.lang).toBe("de");
    expect(text(".masthead__name")).toBe("Haushaltssimulator");
    expect(text('[data-testid="balance-state"]')).toBe("Defizit");
    expect(headline()).toBe("−395 XTS");
    expect(window.location.hash).toBe("#lang=de&s=halve_mp_pay");
    expect(window.localStorage.getItem("budget-simulator:language")).toBe("de");
  });

  it("drills from a block of the bar into its items and marks what a measure changed", () => {
    mount("#lang=en&s=family_bonus");
    // The list starts on the largest spending category.
    expect(text(".detail__title")).toBe("Social protection");
    const rows = [...container.querySelectorAll(".rows .row")];
    expect(rows.map((row) => row.querySelector(".row__label")?.textContent)).toEqual([
      "Pensions",
      "Basic income support",
      "Family benefits",
    ]);
    expect(rows[2].classList.contains("is-changed")).toBe(true);
    expect((rows[2].textContent ?? "").replace(/[  ]/g, " ")).toContain("+XTS 100");
    expect(rows[0].classList.contains("is-changed")).toBe(false);

    // Another category through its legend entry, which is the keyboard path.
    const admin = [...container.querySelectorAll<HTMLButtonElement>(".legend__item")].find((item) =>
      item.textContent?.includes("Administration"),
    );
    act(() => admin!.click());
    expect(text(".detail__title")).toBe("Administration");
    expect([...container.querySelectorAll(".rows .row__label")].map((label) => label.textContent)).toEqual([
      "Other administration",
      "Parliament",
    ]);
  });
});
