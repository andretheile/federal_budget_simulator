// @vitest-environment jsdom
/**
 * The curve editor on the Testland fixture, used the way a visitor would: opened from the card,
 * changed through the table, the keyboard, the pointer and the presets, undone, closed and opened
 * again from the address. Testland's income tax: today 20 % from 10 and 40 % from 30; the default
 * curve rises from 10 % at 10 to 40 % at 30; its effect alone is +125 on a deficit of 400.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Simulator } from "../App.tsx";
import { testland } from "../engine/__fixtures__/testland.ts";
import { simulate, type CurvePoint } from "../engine/index.ts";
import { createFormatters } from "../i18n/format.ts";
import { editorModule } from "./CurveEditor.tsx";

// Every test here renders the whole page with the editor open, and again on every key or pointer
// event: a fraction of a second on a quiet machine, but past vitest's 5 s when it is busy.
vi.setConfig({ testTimeout: 20_000 });

let container: HTMLDivElement;
let root: Root;
const CARD = "#policy-redraw_income_tax";
const en = createFormatters("en", "XTS");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  // jsdom lays nothing out. The chart measures its frame and draws only once it has a width, so
  // give every element a box: 800 wide, at the origin.
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) } as DOMRect;
  };
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

// The inside of the editor is a part of the app of its own. Here it is loaded beforehand, so the
// editor opens at once, as it does in a browser once its code has been fetched ahead of time.
// How the sheet behaves while that part is on its way, or missing, is tested further below.
beforeAll(async () => {
  await editorModule.load();
}, 30_000);

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(hash = "#lang=en"): void {
  window.history.replaceState(null, "", hash);
  root = createRoot(container);
  act(() => root.render(<Simulator pack={testland} />));
}

const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const all = <T extends Element = HTMLElement>(selector: string): T[] => [...document.querySelectorAll<T>(selector)];
const text = (selector: string): string => (query(selector).textContent ?? "").replace(/[\u00a0\u202f]/g, " ");
const headline = (): string => text(".scoreboard__number [data-final-value]");
const click = (selector: string | HTMLElement): void =>
  act(() => (typeof selector === "string" ? query(selector) : selector).click());
/** An attribute with Intl's no-break spaces made plain. */
const attr = (element: Element, name: string): string => (element.getAttribute(name) ?? "").replace(/[\u00a0\u202f]/g, " ");
const press = (target: Element, key: string, init: KeyboardEventInit = {}): void =>
  act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));

/** Type into a field the way a browser does, then leave it with Enter. */
function type(field: HTMLInputElement, value: string): void {
  act(() => {
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  press(field, "Enter");
}

/** The headline the scoreboard shows for the fixture's income tax measure with these points. */
function balanceWith(points: CurvePoint[]): string {
  const result = simulate(testland, { policies: { redraw_income_tax: { enabled: true, params: { tariff: points } } } });
  return en.money(result.reform.balance, { signed: true }).replace(/[\u00a0\u202f]/g, " ");
}

const p = (...pairs: [number, number][]): CurvePoint[] => pairs.map(([x, y]) => ({ x, y }));
const rows = (): string[][] =>
  all(".points tbody tr").map((row) => [...row.querySelectorAll<HTMLInputElement>("input")].map((input) => input.value));
const open = (): void => click(`${CARD} .policy__edit`);

describe("the curve on the card", () => {
  it("shows a preview against today's curve, says whether it differs, and opens the editor", () => {
    mount();
    expect(container.querySelector(`${CARD} .curve-preview .curve-preview__today`)).not.toBeNull();
    // The fixture's default is not today's tariff.
    expect(text(`${CARD} .curve-state`)).toBe("changed");
    expect(text(`${CARD} .policy__curve-state`)).toContain("top rate 40% from XTS 30");
    expect(document.querySelector(".sheet")).toBeNull();
    open();
    expect(text(".sheet__title")).toBe("Redraw the income tax");
    expect(query(".sheet").getAttribute("role")).toBe("dialog");
    expect(window.location.hash).toBe("#lang=en&e=redraw_income_tax.tariff");
    // The page behind is out of reach; the scoreboard is not.
    expect(query("main").hasAttribute("inert")).toBe(true);
    expect(query(".masthead").hasAttribute("inert")).toBe(true);
    expect(query(".scoreboard").hasAttribute("inert")).toBe(false);
  });

  it("says 'as in 2024' for the base year's curve, and names a preset", () => {
    mount("#lang=en&s=redraw_income_tax.tariff.10_20_30_20_30_40");
    expect(text(`${CARD} .curve-state`)).toBe("as in 2024");
    act(() => root.unmount());
    mount("#lang=en&s=redraw_income_tax.tariff.10_25");
    expect(text(`${CARD} .curve-state`)).toBe("changed");
    expect(text(`${CARD} .policy__curve-preset`)).toBe("Preset: Flat tax of 25 %");
  });
});

describe("the editor", () => {
  it("moves a point through the table, which switches the measure on and changes the balance", () => {
    mount();
    expect(headline()).toBe("−XTS 400");
    open();
    expect(rows()).toEqual([
      ["10", "10"],
      ["30", "40"],
    ]);
    expect(text(".editor__off")).toContain("switched off");
    // The rate of the second point from 40 % to 50 %.
    type(all<HTMLInputElement>(".points tbody tr")[1].querySelectorAll("input")[1] as HTMLInputElement, "50");
    expect(rows()[1]).toEqual(["30", "50"]);
    expect(query('.sheet [role="switch"]').getAttribute("aria-checked")).toBe("true");
    expect(headline()).toBe(balanceWith(p([10, 10], [30, 50])));
    expect(headline()).not.toBe("−XTS 400");
    expect(window.location.hash).toBe("#lang=en&s=redraw_income_tax.tariff.10_10_30_50&e=redraw_income_tax.tariff");
    // The readouts follow: the measure's own effect, and the top rate.
    const alone = simulate(testland, { policies: { redraw_income_tax: { enabled: true, params: { tariff: p([10, 10], [30, 50]) } } } }).delta.balance;
    expect(text(".editor__side .policy__amount")).toBe(en.money(alone, { signed: true }).replace(/[\u00a0\u202f]/g, " "));
    expect(text(".editor__top")).toBe("50% from XTS 30 · 2024: 40% from XTS 30");
  });

  it("keeps a typed amount between the neighbours and says so", () => {
    mount("#lang=en&s=redraw_income_tax.tariff.10_20_30_20_30_40&e=redraw_income_tax.tariff");
    // The first point of the step at 30 cannot go to 45: it stops at its neighbour.
    type(all(".points tbody tr")[1].querySelector("input") as HTMLInputElement, "45");
    expect(rows()[1]).toEqual(["30", "20"]);
    type(all(".points tbody tr")[0].querySelector("input") as HTMLInputElement, "45");
    expect(rows()[0]).toEqual(["30", "20"]);
    expect(text('.editor__main [role="status"]')).toContain("Limited to XTS 30");
    // Typed with the other decimal mark, and the arrow keys in a field step along the grid.
    const rate = all(".points tbody tr")[2].querySelectorAll("input")[1] as HTMLInputElement;
    type(rate, "42,5");
    expect(rows()[2][1]).toBe("42.5");
    press(rate, "ArrowUp");
    expect(rows()[2][1]).toBe("43");
  });

  it("adds a point on the curve without changing anything, and removes one", () => {
    mount("#lang=en&s=redraw_income_tax&e=redraw_income_tax.tariff");
    const before = headline();
    type(query<HTMLInputElement>(".points__add input"), "20");
    act(() => query<HTMLFormElement>(".points__add").requestSubmit());
    expect(rows()).toEqual([
      ["10", "10"],
      ["20", "25"],
      ["30", "40"],
    ]);
    expect(headline()).toBe(before);
    expect(all(".cchart__handle")).toHaveLength(3);
    // Added from the table, the focus stays in the table: on the new row.
    expect(document.activeElement).toBe(all(".points tbody tr")[1].querySelector("input"));
    // Removing the first point changes the curve; the focus goes to the remove button that is now first.
    click(query('[aria-label="Remove point 1"]'));
    expect(rows()).toEqual([
      ["20", "25"],
      ["30", "40"],
    ]);
    expect(document.activeElement).toBe(query('[aria-label="Remove point 1"]'));
    expect(headline()).toBe(balanceWith(p([20, 25], [30, 40])));
    // Down to the fewest points the parameter allows (1): the last one cannot go.
    click(query('[aria-label="Remove point 1"]'));
    expect(rows()).toHaveLength(1);
    expect(query<HTMLButtonElement>('[aria-label="Remove point 1"]').disabled).toBe(true);
  });

  it("works with the keyboard on the chart's handles", () => {
    mount("#lang=en&s=redraw_income_tax&e=redraw_income_tax.tariff");
    const handles = all(".cchart__handle");
    expect(handles).toHaveLength(2);
    expect(handles[1].getAttribute("role")).toBe("slider");
    expect(handles[1].getAttribute("aria-label")).toBe("Point 2 of 2");
    expect(attr(handles[1], "aria-valuetext")).toBe("XTS 30, 40%");
    expect(handles[1].getAttribute("aria-roledescription")).toBe("curve point");
    expect(query(`#${CSS.escape(handles[1].getAttribute("aria-describedby")!)}`).textContent).toContain("Delete removes the point");

    act(() => handles[1].focus());
    press(handles[1], "ArrowUp");
    expect(attr(handles[1], "aria-valuetext")).toBe("XTS 30, 41%");
    press(handles[1], "ArrowUp", { shiftKey: true });
    expect(attr(handles[1], "aria-valuetext")).toBe("XTS 30, 51%");
    press(handles[1], "ArrowLeft");
    expect(attr(handles[1], "aria-valuetext")).toBe("XTS 29, 51%");
    // It cannot pass the first point.
    press(handles[1], "ArrowLeft", { shiftKey: true });
    press(handles[1], "ArrowLeft", { shiftKey: true });
    expect(attr(handles[1], "aria-valuetext")).toBe("XTS 10, 51%");
    expect(headline()).toBe(balanceWith(p([10, 10], [10, 51])));
    // Delete removes it; the focus goes to the neighbour.
    press(handles[1], "Delete");
    expect(all(".cchart__handle")).toHaveLength(1);
    expect(document.activeElement).toBe(all(".cchart__handle")[0]);
    expect(text('.editor__main [role="status"]')).toBe("Point 2 of 2 removed.");
    press(all(".cchart__handle")[0], "Delete");
    expect(text('.editor__main [role="status"]')).toBe("One point has to stay.");
  });

  it("drags a point with the pointer, along the grid and only along the axis that moved", () => {
    mount("#lang=en&s=redraw_income_tax&e=redraw_income_tax.tariff");
    const layer = query(".cchart__layer");
    const handle = all(".cchart__handle")[1];
    const at = { x: parseFloat(handle.style.left), y: parseFloat(handle.style.top) };
    const pointer = (type: string, x: number, y: number): void =>
      act(() => void layer.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "mouse", button: 0 })));
    pointer("pointerdown", at.x + 3, at.y + 2);
    // Straight up by 30 pixels; one pixel sideways is not a move along x.
    for (let step = 1; step <= 5; step++) pointer("pointermove", at.x + 3 + (step === 5 ? 1 : 0), at.y + 2 - 6 * step);
    pointer("pointerup", at.x + 4, at.y - 28);
    act(() => layer.click());
    const [x, rate] = attr(handle, "aria-valuetext").split(", ");
    expect(x).toBe("XTS 30");
    expect(Number.parseFloat(rate)).toBeGreaterThan(44);
    expect(Number.isInteger(Number.parseFloat(rate))).toBe(true);
    // The press selected the handle; the click that ends a drag adds nothing.
    expect(handle.classList.contains("is-selected")).toBe(true);
    expect(all(".cchart__handle")).toHaveLength(2);
    expect(headline()).not.toBe("−XTS 275");
  });

  it("adds a point where the curve is clicked", () => {
    mount("#lang=en&s=redraw_income_tax&e=redraw_income_tax.tariff");
    const layer = query(".cchart__layer");
    const [first, second] = all(".cchart__handle").map((handle) => ({ x: parseFloat(handle.style.left), y: parseFloat(handle.style.top) }));
    const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    act(() => void layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: middle.x, clientY: middle.y, pointerType: "mouse" })));
    act(() => void layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: middle.x, clientY: middle.y })));
    expect(rows()).toEqual([
      ["10", "10"],
      ["20", "25"],
      ["30", "40"],
    ]);
    // A click far from the curve adds nothing.
    act(() => void layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: middle.x, clientY: 40, pointerType: "mouse" })));
    act(() => void layer.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: middle.x, clientY: 40 })));
    expect(rows()).toHaveLength(3);
  });

  it("applies presets, goes back to the base year's curve and undoes one step", () => {
    mount();
    open();
    const presets = all<HTMLButtonElement>(".preset");
    expect(presets.map((button) => button.textContent)).toEqual([
      "Flat tax of 25 %",
      "50 % on income above 40Today's tariff below 40.",
    ]);
    expect(text(".preset__note")).toBe("Today's tariff below 40.");
    click(presets[0]);
    expect(presets[0].getAttribute("aria-pressed")).toBe("true");
    expect(rows()).toEqual([["10", "25"]]);
    expect(headline()).toBe(balanceWith(p([10, 25])));
    // The preset's sources are named.
    expect(text(".presets__sources")).toContain("Income tax statistics");

    const undo = all<HTMLButtonElement>(".editor__toolbar .tool")[1];
    expect(undo.textContent).toBe("Undo");
    click(undo);
    expect(rows()).toEqual([
      ["10", "10"],
      ["30", "40"],
    ]);
    expect(undo.disabled).toBe(true);

    const reset = all<HTMLButtonElement>(".editor__toolbar .tool")[0];
    expect(reset.textContent).toBe("2024 curve");
    click(reset);
    expect(rows()).toEqual([
      ["10", "20"],
      ["30", "20"],
      ["30", "40"],
    ]);
    // Today's curve costs exactly nothing, and the button has nothing more to do.
    expect(headline()).toBe("−XTS 400");
    expect(text(".editor__side .policy__amount")).toBe("XTS 0");
    expect(reset.disabled).toBe(true);
    expect(text(".pay__row--same")).toContain("100%");
    // Ctrl+Z undoes as well.
    expect(undo.disabled).toBe(false);
    press(query(".editor"), "z", { ctrlKey: true });
    expect(rows()).toEqual([
      ["10", "10"],
      ["30", "40"],
    ]);
  });

  it("shows what the curve does: who pays more or less, the examples, how it is calculated", () => {
    mount("#lang=en&s=redraw_income_tax&e=redraw_income_tax.tariff");
    // The default against today: incomes between 10 and 23 1/3 pay less, above it more.
    expect(text(".pay__row--more")).toContain("16.7 (33.3%)");
    expect(text(".pay__row--less")).toContain("13.3 (26.6%)");
    expect(text(".pay__row--same")).toContain("20 (40.1%)");
    expect(text(".editor__side .editor__note")).toContain("Counted: taxpayers.");
    // An income of 20 owes 2 today and 1.75 after; one of 45 owes 10 today and 11 after.
    const examples = all(".examples tbody tr").map((row) => (row.textContent ?? "").replace(/[\u00a0\u202f]/g, " "));
    expect(examples[0]).toContain("Typical taxpayer");
    expect(examples[0]).toContain("XTS 2 (10.0%)");
    expect(examples[0]).toContain("XTS 2 (8.8%)");
    expect(examples[1]).toContain("XTS 10 (22.2%)");
    expect(examples[1]).toContain("XTS 11 (24.4%)");
    expect(examples[1]).toContain("+XTS 1");
    expect(text(".editor__model")).toBe(
      "The curve is applied to the distribution “Taxable income”, where it yields XTS 130 instead of XTS 120 in 2024 (+8.3%); this relative change is carried over to the budget item “Income tax” (XTS 1,500).",
    );
  });

  it("closes with Escape, gives the focus back, and opens again from the address", () => {
    mount();
    const button = query(`${CARD} .policy__edit`);
    act(() => button.focus());
    click(button);
    press(query(".sheet"), "Escape");
    expect(document.querySelector(".sheet")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(window.location.hash).toBe("#lang=en");
    expect(query("main").hasAttribute("inert")).toBe(false);

    act(() => root.unmount());
    mount("#lang=en&s=redraw_income_tax.tariff.10_25&e=redraw_income_tax.tariff");
    expect(text(".sheet__title")).toBe("Redraw the income tax");
    expect(rows()).toEqual([["10", "25"]]);
    expect(headline()).toBe(balanceWith(p([10, 25])));
    // Closing a sheet that came with the link puts the focus on the measure's card.
    click(".sheet__close");
    expect(document.activeElement).toBe(query(`${CARD} .policy__edit`));
  });

  it("ignores an editor in the address that the pack does not have", () => {
    for (const hash of ["#lang=en&e=redraw_income_tax.nothing", "#lang=en&e=cut_admin.cut", "#lang=en&e=nonsense", "#lang=en&e=a.b.c"]) {
      mount(hash);
      expect(document.querySelector(".sheet")).toBeNull();
      expect(query("main").hasAttribute("inert")).toBe(false);
      act(() => root.unmount());
    }
    mount();
  });

  it("names a changed curve above the measures, with a way into the editor", () => {
    mount("#lang=en&s=redraw_income_tax.tariff.10_25");
    expect(text(".changed-curves")).toContain("A curve is changed in this scenario");
    click(".changed-curves__open");
    expect(text(".sheet__title")).toBe("Redraw the income tax");
    act(() => root.unmount());
    // Today's curve is not a change, and a measure that is off is not part of the scenario.
    mount("#lang=en&s=redraw_income_tax.tariff.10_20_30_20_30_40");
    expect(document.querySelector(".changed-curves")).toBeNull();
  });

  it("shows the measure's other settings as sliders", () => {
    // Testland's curve measure has no other setting; Germany's has one. Here: the absence.
    mount("#lang=en&e=redraw_income_tax.tariff");
    expect(document.querySelector(".editor .param")).toBeNull();
  });
});

describe("two points too close together for a finger", () => {
  // A step of two percentage points at 30: about 10 px apart on the chart.
  const STEP = "#lang=en&s=redraw_income_tax.tariff.10_20_30_20_30_22&e=redraw_income_tax.tariff";
  const coarse = (matches: boolean): void => {
    window.matchMedia = ((query: string) => ({
      matches: matches && query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  };
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  const tab = (index: number): HTMLElement => query(`.cchart__tab[data-tab="${index}"]`);
  const at = (element: HTMLElement) => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top) });
  /** A finger on `target`, moved by dy, lifted. */
  const drag = (target: HTMLElement, from: { x: number; y: number }, dy: number): void => {
    const layer = query(".cchart__layer");
    const fire = (element: Element, type: string, y: number): void =>
      act(() => void element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: from.x, clientY: y, pointerId: 3, pointerType: "touch", isPrimary: true })));
    fire(target, "pointerdown", from.y);
    for (let step = 1; step <= 5; step++) fire(layer, "pointermove", from.y + (dy * step) / 5);
    fire(layer, "pointerup", from.y + dy);
  };
  const values = (): string[] => all(".cchart__handle").map((handle) => attr(handle, "aria-valuetext"));

  it("each get a tab on a touch screen, the higher one above, the lower one below", () => {
    coarse(true);
    mount(STEP);
    expect(all(".cchart__tab").map((element) => [element.dataset.tab, element.textContent])).toEqual([
      ["1", "20%"],
      ["2", "22%"],
    ]);
    const handles = all(".cchart__handle");
    expect(at(tab(2)).y).toBeLessThan(at(handles[2]).y - 22);
    expect(at(tab(1)).y).toBeGreaterThan(at(handles[1]).y + 22);
    // The tabs are for the finger only.
    expect(tab(1).getAttribute("aria-hidden")).toBe("true");
    expect(tab(1).hasAttribute("tabindex")).toBe(false);
  });

  it("moves exactly the point whose tab was dragged", () => {
    coarse(true);
    mount(STEP);
    expect(values()).toEqual(["XTS 10, 20%", "XTS 30, 20%", "XTS 30, 22%"]);
    // The upper tab, up: the 22 % point rises, the 20 % point stays.
    drag(tab(2), at(tab(2)), -40);
    expect(values()[1]).toBe("XTS 30, 20%");
    expect(Number.parseFloat(values()[2].split(", ")[1])).toBeGreaterThan(27);
    expect(all(".cchart__handle")[2].classList.contains("is-selected")).toBe(true);
    // Undo, then the lower tab, down: the 20 % point falls, the 22 % point stays.
    click(all<HTMLButtonElement>(".editor__toolbar .tool")[1]);
    expect(values()).toEqual(["XTS 10, 20%", "XTS 30, 20%", "XTS 30, 22%"]);
    drag(tab(1), at(tab(1)), 40);
    expect(Number.parseFloat(values()[1].split(", ")[1])).toBeLessThan(15);
    expect(values()[2]).toBe("XTS 30, 22%");
    expect(all(".cchart__handle")[1].classList.contains("is-selected")).toBe(true);
  });

  it("get tabs once a finger has been used, also where the screen does not say it is a touch screen", () => {
    coarse(false);
    mount(STEP);
    expect(all(".cchart__tab")).toHaveLength(0);
    // A tap somewhere on the chart away from the curve.
    const layer = query(".cchart__layer");
    act(() => void layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 400, clientY: 40, pointerType: "touch" })));
    expect(all(".cchart__tab")).toHaveLength(2);
  });

  it("get no tabs with a mouse: it can point at either", () => {
    coarse(false);
    mount(STEP);
    const layer = query(".cchart__layer");
    const upper = at(all(".cchart__handle")[2]);
    act(() => void layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: upper.x, clientY: upper.y - 2, pointerId: 1, pointerType: "mouse", button: 0 })));
    act(() => void layer.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: upper.x, clientY: upper.y - 2, pointerId: 1, pointerType: "mouse" })));
    expect(all(".cchart__tab")).toHaveLength(0);
    expect(all(".cchart__handle")[2].classList.contains("is-selected")).toBe(true);
  });
});

describe("the inside of the editor, a part of the app of its own", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The import of the editor's inside, held back until the test lets it arrive or fail. */
  function holdBack() {
    const attempts: { resolve(): Promise<void>; reject(): Promise<void> }[] = [];
    vi.spyOn(editorModule, "current").mockReturnValue(undefined);
    vi.spyOn(editorModule, "load").mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          attempts.push({
            resolve: () => act(async () => resolve(await import("./CurveEditorBody.tsx"))),
            reject: () => act(async () => reject(new TypeError("Failed to fetch dynamically imported module"))),
          });
        }),
    );
    return attempts;
  }

  it("shows the sheet with its header at once, and the editor when it has arrived", async () => {
    const attempts = holdBack();
    mount("#lang=en&e=redraw_income_tax.tariff");
    expect(text(".sheet__title")).toBe("Redraw the income tax");
    expect(query('.sheet [role="switch"]')).toBeTruthy();
    expect(text('.sheet__pending[role="status"]')).toBe("Loading the editor…");
    expect(document.querySelector(".cchart")).toBeNull();
    expect(attempts).toHaveLength(1);
    await attempts[0].resolve();
    expect(document.querySelector(".sheet__pending")).toBeNull();
    expect(all(".cchart__handle")).toHaveLength(2);
  });

  it("says so when it cannot be loaded, and tries again on request", async () => {
    const attempts = holdBack();
    mount("#lang=en&e=redraw_income_tax.tariff");
    await attempts[0].reject();
    // Not a blank page: the sheet, its header, a message and a way to try again.
    expect(text(".sheet__title")).toBe("Redraw the income tax");
    expect(text('.sheet__pending[role="alert"] p')).toContain("could not be loaded");
    const retry = query<HTMLButtonElement>(".sheet__pending button");
    expect(retry.textContent).toBe("Try again");
    click(retry);
    // While it tries, the focus waits on the title; the button is gone.
    expect(attempts).toHaveLength(2);
    expect(text('.sheet__pending[role="status"]')).toBe("Loading the editor…");
    expect(document.activeElement).toBe(query(".sheet__title"));
    await attempts[1].reject();
    click(".sheet__pending button");
    await attempts[2].resolve();
    expect(all(".cchart__handle")).toHaveLength(2);
    // Escape closes the sheet in every state.
    press(document.body, "Escape");
    expect(document.querySelector(".sheet")).toBeNull();
  });

  it("starts loading ahead of time when the pointer or the focus reaches a button that opens it", () => {
    const preload = vi.spyOn(editorModule, "preload").mockImplementation(() => undefined);
    mount("#lang=en&s=redraw_income_tax.tariff.10_25");
    const button = query(`${CARD} .policy__edit`);
    act(() => void button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
    expect(preload).toHaveBeenCalledTimes(1);
    act(() => button.focus());
    expect(preload).toHaveBeenCalledTimes(2);
    // The way in from the notice above the measures does the same.
    act(() => query(".changed-curves__open").focus());
    expect(preload).toHaveBeenCalledTimes(3);
  });
});
