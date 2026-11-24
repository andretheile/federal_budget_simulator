// @vitest-environment jsdom
/**
 * The two forms of the budget overview on Testland: the switch, the address, the flow's buttons in
 * keyboard order with their names, and the selection both forms share.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import type { CountryPack } from "../engine/index.ts";
import { flowModule } from "./BudgetView.tsx";

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no canvas: labels break after every word, which changes nothing tested here.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  // The flow is a chunk of its own; here it is there from the start, as after a preload.
  await flowModule.load();
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

function mount(hash: string, pack: CountryPack = testland): void {
  window.history.replaceState(null, "", hash);
  root = createRoot(container);
  act(() => root.render(<Simulator pack={pack} />));
}

const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const clean = (text: string | null | undefined): string => (text ?? "").replace(/[  ]/g, " ");
const formButton = (name: string): HTMLButtonElement => {
  const button = [...container.querySelectorAll<HTMLButtonElement>(".budget__forms button")].find(
    (candidate) => candidate.textContent === name,
  );
  if (!button) throw new Error(`no switch ${name}`);
  return button;
};
const node = (name: string): HTMLButtonElement => {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button.flow__node")].find((candidate) =>
    candidate.getAttribute("aria-label")?.startsWith(`${name},`),
  );
  if (!button) throw new Error(`no node ${name}`);
  return button;
};

describe("the switch between bars and the flow of money", () => {
  it("shows the bars by default and puts the flow in the address only when it is chosen", () => {
    mount("#lang=en");
    expect(container.querySelector(".bars")).not.toBeNull();
    expect(container.querySelector(".flow")).toBeNull();
    expect(query(".budget__forms").getAttribute("role")).toBe("group");
    expect(query(".budget__forms").getAttribute("aria-label")).toBe("View");
    expect(formButton("Bars").getAttribute("aria-pressed")).toBe("true");
    expect(formButton("Money flow").getAttribute("aria-pressed")).toBe("false");

    act(() => formButton("Money flow").click());
    expect(container.querySelector(".bars")).toBeNull();
    expect(container.querySelector(".flow__grid")).not.toBeNull();
    expect(formButton("Money flow").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.hash).toBe("#lang=en&v=flow");
    expect(clean(query(".budget .section-head p").textContent)).toMatch(/^Where the money comes from \(left\)/);
    expect(clean(query(".flow__note").textContent)).toBe(
      "The bands show amounts, not which revenue pays for which spending.",
    );

    act(() => formButton("Bars").click());
    expect(container.querySelector(".bars")).not.toBeNull();
    expect(window.location.hash).toBe("#lang=en");
  });

  it("opens on the flow from a link, and follows the address back and forth", () => {
    mount("#lang=de&v=flow");
    expect(container.querySelector(".flow__grid")).not.toBeNull();
    expect(formButton("Geldfluss").getAttribute("aria-pressed")).toBe("true");
    act(() => {
      window.history.replaceState(null, "", "#lang=de");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(container.querySelector(".bars")).not.toBeNull();
  });
});

describe("the flow of money", () => {
  it("has a name, and buttons for the nodes in keyboard order: the heads, the left column, then the right", () => {
    mount("#lang=en&v=flow");
    const grid = query(".flow__grid");
    expect(grid.getAttribute("role")).toBe("group");
    expect(grid.getAttribute("aria-label")).toBe("Money flow: where the money comes from and where it goes");
    const names = [...grid.querySelectorAll("button")].map((button) =>
      clean(button.getAttribute("aria-label") ?? button.textContent),
    );
    expect(names).toEqual([
      "Revenue",
      "Taxes, XTS 2,500, 62.5% of revenue",
      "Social contributions, XTS 1,200, 30.0% of revenue",
      "Other revenue, XTS 300, 7.5% of revenue",
      "Spending",
      "Social protection, XTS 2,200, 50.0% of spending",
      "Education, XTS 800, 18.2% of spending",
      "Health, XTS 700, 15.9% of spending",
      "Administration, XTS 400, 9.1% of spending",
      "Defence, XTS 200, 4.5% of spending",
      "Interest, XTS 100, 2.3% of spending",
    ]);
    // The deficit closes the gap on the left; there is nothing to break down, so it is text.
    const deficit = query(".flow__balance--deficit");
    expect(deficit.tagName).toBe("P");
    expect(clean(deficit.querySelector(".visually-hidden")?.textContent)).toBe("Deficit XTS 400");
    expect(clean(query(".flow__head--middle").textContent)).toBe("Budget XTS 4,400");
    // The drawing is for the eye only.
    expect(query(".flow__svg").getAttribute("aria-hidden")).toBe("true");
  });

  it("selects an area as the bars do, and keeps the selection when the form changes", () => {
    mount("#lang=en&v=flow");
    // The page starts on the largest spending area.
    expect(node("Social protection").getAttribute("aria-pressed")).toBe("true");
    expect(clean(query(".detail__title").textContent)).toBe("Social protection");

    act(() => node("Administration").click());
    expect(node("Administration").getAttribute("aria-pressed")).toBe("true");
    expect(node("Social protection").getAttribute("aria-pressed")).toBe("false");
    expect(clean(query(".detail__title").textContent)).toBe("Administration");

    act(() => formButton("Bars").click());
    const entry = [...container.querySelectorAll<HTMLButtonElement>(".legend__item")].find((item) =>
      item.textContent?.includes("Administration"),
    );
    expect(entry?.getAttribute("aria-pressed")).toBe("true");
    expect(clean(query(".detail__title").textContent)).toBe("Administration");

    // Chosen in the bars, kept in the flow.
    const health = [...container.querySelectorAll<HTMLButtonElement>(".legend__item")].find((item) =>
      item.textContent?.includes("Health"),
    );
    act(() => health!.click());
    act(() => formButton("Money flow").click());
    // An area without items of its own shows in the list of its side, as in the bars: the side is what is selected.
    expect(clean(query(".detail__title").textContent)).toBe("Spending");
    expect(query(".flow__head--expenditure button").getAttribute("aria-pressed")).toBe("true");
    expect(node("Health").getAttribute("aria-pressed")).toBe("false");
    act(() => node("Education").click());
    act(() => formButton("Bars").click());
    act(() => formButton("Money flow").click());
    expect(node("Education").getAttribute("aria-pressed")).toBe("false");
    expect(clean(query(".detail__title").textContent)).toBe("Spending");

    // The head of a column selects the whole side.
    const revenue = query<HTMLButtonElement>(".flow__head--revenue button");
    act(() => revenue.click());
    expect(revenue.getAttribute("aria-pressed")).toBe("true");
    expect(clean(query(".detail__title").textContent)).toBe("Revenue");
  });

  it("shows the scenario and its changes as the legend of the bars does", () => {
    mount("#lang=en&s=family_bonus&v=flow");
    const social = node("Social protection");
    expect(clean(social.getAttribute("aria-label"))).toBe(
      "Social protection, XTS 2,300, 51.1% of spending, +XTS 100 compared with 2024",
    );
    expect(clean(social.textContent)).toContain("+XTS 100");
    expect(clean(query(".flow__balance--deficit .visually-hidden").textContent)).toBe("Deficit XTS 500");
    expect(clean(query(".flow__head--expenditure").textContent)).toContain("+XTS 100");
  });

  it("calls the gap of a single level a difference, not a balance", () => {
    mount("#lang=en&s=L.central&v=flow");
    expect(container.querySelector(".flow__balance--deficit")).toBeNull();
    expect(clean(query(".flow__balance--difference").textContent)).toMatch(/^Difference/);
    expect(clean(query(".budget .section-head p").textContent)).toMatch(
      /^Revenue \(left\) and spending \(right\) of this level \(Central government\) on one scale\./,
    );
  });

  it("shows areas the bars fold on their own where it has room, and the list follows the form on screen", () => {
    // Two small areas the bars fold into "Other areas (2)".
    const pack = testlandCopy();
    pack.budget.expenditure.push({
      id: "exp.culture",
      label: { en: "Culture", de: "Kultur" },
      amount: 20,
      levels: { state: 1 },
      quality: "official",
      sources: ["finance_ministry"],
    });
    mount("#lang=en", pack);
    const fold = [...container.querySelectorAll<HTMLButtonElement>(".legend__item")].find((item) =>
      item.textContent?.includes("Other areas (2)"),
    );
    act(() => fold!.click());
    expect(clean(query(".detail__title").textContent)).toBe("Other areas (2)");

    act(() => formButton("Money flow").click());
    // The flow has room for both: no fold, so the list is that of the whole side.
    expect(container.querySelectorAll("button.flow__node--right")).toHaveLength(7);
    expect(node("Culture")).toBeDefined();
    expect(clean(query(".detail__title").textContent)).toBe("Spending");
    expect(container.querySelectorAll(".rows .row")).toHaveLength(7);

    // Back in the bars, the fold is still what was chosen.
    act(() => formButton("Bars").click());
    expect(clean(query(".detail__title").textContent)).toBe("Other areas (2)");
  });
});
