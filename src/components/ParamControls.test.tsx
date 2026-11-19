// @vitest-environment jsdom
/**
 * The number slider used the way a visitor would: dragged, moved with keys, typed into, sent back
 * to the base year. Rendered on its own, in German, with the fixture's base year (2024).
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Direction } from "../app/policyModel.ts";
import { createUi, UiContext } from "../app/ui.ts";
import { testland } from "../engine/__fixtures__/testland.ts";
import type { NumberParam } from "../engine/index.ts";
import { NumberControl } from "./ParamControls.tsx";

let container: HTMLDivElement;
let root: Root;
/** Every value the slider reported, in order. */
let reported: number[];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  reported = [];
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Like the German petrol tax: 5,410 positions, base year 65.45, default 51.41. */
const petrol: NumberParam = {
  id: "petrol",
  type: "number",
  label: { en: "Petrol", de: "Benzin" },
  unit: "count",
  unitLabel: { en: "ct/l", de: "ct/l" },
  min: 35.9,
  max: 90,
  step: 0.01,
  default: 51.41,
  baseline: 65.45,
};
const rate: NumberParam = { id: "rate", type: "number", label: { en: "Rate", de: "Satz" }, unit: "percent", min: 0, max: 5, step: 0.1, default: 1, baseline: 0 };
const avoidance: NumberParam = {
  id: "avoidance",
  type: "number",
  label: { en: "Avoidance", de: "Ausweichen" },
  unit: "percent",
  min: 0,
  max: 70,
  step: 5,
  default: 35,
  role: "assumption",
};

function Harness({ param, start, direction }: { param: NumberParam; start: number; direction?: Direction }) {
  const [value, setValue] = useState(start);
  return (
    <NumberControl
      id="s"
      param={param}
      value={value}
      direction={direction}
      onChange={(next) => {
        reported.push(next);
        setValue(next);
      }}
    />
  );
}

function mount(param: NumberParam, start: number, direction?: Direction): void {
  root = createRoot(container);
  act(() =>
    root.render(
      <UiContext value={createUi(testland, "de")}>
        <Harness param={param} start={start} direction={direction} />
      </UiContext>,
    ),
  );
}

const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const plain = (value: string | null | undefined): string => (value ?? "").replace(/[  ]/g, " ");
const text = (selector: string): string => plain(query(selector).textContent);
const slider = (): HTMLInputElement => query<HTMLInputElement>("input[type=range]");
const valueNow = (): number => Number(slider().value);

/** What the browser does when the knob is moved to a value. */
function slideTo(value: number): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider(), String(value));
    slider().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const pointer = (type: string): void =>
  act(() => void slider().dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch" })));
const key = (target: Element, name: string): boolean => {
  let event!: KeyboardEvent;
  act(() => {
    event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

describe("the base-year value", () => {
  it("stands under its tick as a button that sets the slider back to it", () => {
    mount(petrol, 51.41, "worsen");
    const base = query<HTMLButtonElement>(".param__base");
    expect(text(".param__base")).toBe("2024: 65,45 ct/l");
    expect(plain(base.getAttribute("aria-label"))).toBe("Auf den Wert von 2024 setzen: 65,45 ct/l");
    // Past the middle of the scale, the label runs from its tick towards the left.
    expect(base.className).toContain("param__base--before");
    // The slider names it for screen readers.
    expect(text(`#${slider().getAttribute("aria-describedby")}`)).toBe("2024: 65,45 ct/l");
    act(() => base.click());
    expect(valueNow()).toBe(65.45);
    expect(reported).toEqual([65.45]);
    expect(query(".param__base").className).toContain("is-current");
  });

  it("is folded into the end of the scale where it is the minimum or the maximum", () => {
    mount(rate, 1, "improve");
    expect(container.querySelector(".param__base")).toBeNull();
    const end = query<HTMLButtonElement>(".param__end--min");
    expect(text(".param__end--min")).toBe("0,0 % · 2024");
    act(() => end.click());
    expect(valueNow()).toBe(0);
  });
});

describe("the fill and the value", () => {
  it("fill the stretch from the base year to the knob in the colour of what this slider does, and say the change", () => {
    mount(petrol, 51.41, "worsen");
    expect(query(".param__slider").className).toContain("param__slider--worsen");
    expect(text(".param__value")).toBe("51,41 ct/l");
    expect(text(".param__change")).toBe(" (−14,04)");
    expect(query(".param__change").className).toContain("param__change--worsen");
    expect(plain(slider().getAttribute("aria-valuetext"))).toBe("51,41 ct/l, −14,04 gegenüber 2024, verschlechtert den Saldo");
    // The stretch runs between the two: from the knob (28 % of the scale) to the base year (55 %).
    const style = query(".param").style;
    expect(Number(style.getPropertyValue("--from"))).toBeCloseTo((51.41 - 35.9) / 54.1, 9);
    expect(Number(style.getPropertyValue("--to"))).toBeCloseTo((65.45 - 35.9) / 54.1, 9);
  });

  it("show no change and no fill at the base-year value", () => {
    mount(petrol, 65.45, "neutral");
    expect(query(".param__slider").className).toContain("param__slider--none");
    expect(container.querySelector(".param__change")).toBeNull();
    expect(plain(slider().getAttribute("aria-valuetext"))).toBe("65,45 ct/l");
  });

  it("fill from the minimum, in ink, for a slider without a base-year value", () => {
    mount({ ...petrol, baseline: undefined }, 51.41);
    expect(query(".param__slider").className).toContain("param__slider--plain");
    expect(container.querySelector(".param__change")).toBeNull();
    expect(container.querySelector(".param__base")).toBeNull();
  });
});

describe("a slider without a base-year value whose range spans zero", () => {
  /** Like the debt projection's drift: −0.5 to +0.5 points of GDP a year. */
  const drift: NumberParam = { id: "drift", type: "number", label: { en: "Drift", de: "Drift" }, unit: "percent_gdp", min: -0.5, max: 0.5, step: 0.05, default: -0.1 };

  it("is filled from zero, which a tick marks, not from its minimum", () => {
    mount(drift, -0.1);
    const style = query(".param").style;
    expect(query(".param__slider").className).not.toContain("is-from-start");
    expect(container.querySelector(".param__zero")).not.toBeNull();
    // From the knob at −0.1 (40 % of the scale) to zero (50 %).
    expect(Number(style.getPropertyValue("--from"))).toBeCloseTo(0.4, 9);
    expect(Number(style.getPropertyValue("--to"))).toBeCloseTo(0.5, 9);
    slideTo(0.3);
    expect(Number(query(".param").style.getPropertyValue("--from"))).toBeCloseTo(0.5, 9);
    expect(Number(query(".param").style.getPropertyValue("--to"))).toBeCloseTo(0.8, 9);
  });

  it("while one that does not span zero is filled from its minimum, as before", () => {
    mount({ ...petrol, baseline: undefined }, 51.41);
    expect(query(".param__slider").className).toContain("is-from-start");
    expect(container.querySelector(".param__zero")).toBeNull();
  });
});

describe("an assumption of the calculation", () => {
  it("carries a tag before its label and is drawn in grey", () => {
    mount(avoidance, 35);
    expect(text("label")).toBe("AnnahmeAusweichen");
    expect(text(".param__tag")).toBe("Annahme");
    expect(query(".param").className).toContain("param--assumption");
    expect(query(".param__slider").className).toContain("param__slider--assumption");
  });
});

describe("dragging", () => {
  it("snaps to the base-year value and to the default near them, and only while a pointer is down", () => {
    mount(petrol, 40);
    pointer("pointerdown");
    slideTo(65.1);
    expect(valueNow()).toBe(65.45);
    slideTo(51.8);
    expect(valueNow()).toBe(51.41);
    slideTo(58);
    expect(valueNow()).toBe(58);
    act(() => void window.dispatchEvent(new PointerEvent("pointerup")));
    // Moved by assistive technology, not dragged: exactly where it was put.
    slideTo(65.1);
    expect(valueNow()).toBe(65.1);
  });
});

describe("the keys", () => {
  it("move 1 % and 10 % of the range on a slider with many positions, stopping at the base year", () => {
    mount(petrol, 40);
    expect(key(slider(), "ArrowRight")).toBe(true);
    expect(valueNow()).toBe(40.54);
    const pages: number[] = [];
    for (let i = 0; i < 6; i++) {
      key(slider(), "PageUp");
      pages.push(valueNow());
    }
    // Stops at the default (51.41) and at the base year (65.45) on the way.
    expect(pages).toEqual([45.95, 51.36, 51.41, 56.82, 62.23, 65.45]);
    key(slider(), "ArrowLeft");
    expect(valueNow()).toBe(64.91);
  });

  it("are left to the browser on a slider with few positions", () => {
    mount(rate, 1);
    expect(key(slider(), "ArrowRight")).toBe(false);
    expect(valueNow()).toBe(1);
  });
});

describe("typing a value", () => {
  it("turns the value into a field, takes either decimal mark and lands on the grid", () => {
    mount(petrol, 51.41);
    const reading = query<HTMLButtonElement>(".param__reading");
    expect(plain(reading.getAttribute("aria-label"))).toBe("Benzin: 51,41 ct/l. Wert eingeben");
    act(() => reading.click());
    const field = query<HTMLInputElement>(".param__field input");
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("51,41");
    expect(field.getAttribute("aria-label")).toBe("Wert für Benzin");
    const type = (value: string): void =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    // A dot in German: a decimal mark here, since it does not group thousands.
    type("65.4537");
    key(field, "Enter");
    expect(valueNow()).toBe(65.45);
    // The focus is back on the value, which shows the new one.
    expect(document.activeElement).toBe(query(".param__reading"));
    expect(text(".param__value")).toBe("65,45 ct/l");
  });

  it("keeps the value on Escape, on something that is no number, and inside the range", () => {
    mount(petrol, 51.41);
    const open = (): HTMLInputElement => {
      act(() => query<HTMLButtonElement>(".param__reading").click());
      return query<HTMLInputElement>(".param__field input");
    };
    const type = (field: HTMLInputElement, value: string): void =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    let field = open();
    type(field, "70");
    // Escape is the field's: an editor sheet around it does not see it.
    expect(key(field, "Escape")).toBe(true);
    expect(valueNow()).toBe(51.41);
    field = open();
    type(field, "viel");
    key(field, "Enter");
    expect(valueNow()).toBe(51.41);
    field = open();
    type(field, "1000");
    act(() => field.blur());
    expect(valueNow()).toBe(90);
    expect(reported).toEqual([90]);
  });
});
