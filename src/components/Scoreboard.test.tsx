// @vitest-environment jsdom
/**
 * The scoreboard while a curve editor lies below it: it keeps the room of the widest figures and
 * of its fullest change line, so that its height cannot change while the editor is open. Whether
 * the lines then really keep their height is a matter of layout, checked in the browsers; here:
 * that the stand-ins are there, what they say, and that nobody but the layout sees them.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { testland } from "../engine/__fixtures__/testland.ts";
import { editorModule } from "./CurveEditor.tsx";
import { standIn, widest } from "./Scoreboard.tsx";

let container: HTMLDivElement;
let root: Root | undefined;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  await editorModule.load();
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  const mounted = root;
  if (mounted) act(() => mounted.unmount());
  root = undefined;
  container.remove();
});

function mount(hash: string): void {
  window.history.replaceState(null, "", hash);
  const created = createRoot(container);
  root = created;
  act(() => created.render(<Simulator pack={testland} />));
}

const plain = (value: string | null | undefined): string => (value ?? "").replace(/[  ]/g, " ");
const texts = (selector: string): string[] => [...document.querySelectorAll(selector)].map((element) => plain(element.textContent));

describe("stand-ins for the widest figures", () => {
  it("write every digit as the widest one", () => {
    expect(widest("−119,1 Mrd. €")).toBe("−888,8 Mrd. €");
    expect(widest("+€1.7bn", "5")).toBe("+€5.5bn");
  });

  it("have as many digits as amounts of the budget's size can have", () => {
    expect(standIn(119.1e9)).toBeCloseTo(-888.8e9, -6);
    expect(standIn(-202.8e9)).toBeCloseTo(-888.8e9, -6);
    expect(standIn(2_147.5e9)).toBeCloseTo(-8_888e9, -6);
    expect(standIn(400)).toBeCloseTo(-888.8, 6);
    expect(standIn(0)).toBeCloseTo(-8.888, 6);
  });
});

describe("the scoreboard above an open curve editor", () => {
  it("keeps the room of the widest figures, words and change line, hidden from everyone but the layout", () => {
    mount("#lang=en&e=redraw_income_tax.tariff");
    // The headline: the balance of −400 has three digits, so does its stand-in.
    expect(texts(".scoreboard__hero .slot__stand-in .scoreboard__number")).toEqual(["−XTS 888"]);
    // The state word keeps the room of the other two.
    expect(plain(document.querySelector('[data-testid="balance-state"]')?.textContent)).toBe("Deficit");
    expect(texts(".scoreboard__hero .slot__stand-in .state")).toEqual(["Surplus", "Balanced"]);
    // The change line keeps the room of its fullest form: nothing else is on, so one measure at most.
    const lines = texts(".scoreboard__changes > .slot__stand-in");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("−XTS 888 compared with 2024");
    expect(lines[0]).toContain("8 measure switched on");
    expect(lines[0]).toContain("Range −XTS 888 to −XTS 888");
    // ... and of the line that says no measure is on, which is what it says now.
    expect(lines[1]).toBe(plain(document.querySelector(".scoreboard__change .muted")?.textContent));
    // Revenue, spending and the ratios.
    expect(texts(".scoreboard__side .slot__stand-in")).toHaveLength(2);
    expect(texts(".scoreboard__ratios .slot__stand-in")).toHaveLength(2);
    for (const element of document.querySelectorAll(".slot__stand-in")) expect(element.getAttribute("aria-hidden")).toBe("true");
    // The figures that are read out are the real ones.
    expect(plain(document.querySelector(".scoreboard__number [data-final-value]")?.textContent)).toBe("−XTS 400");
  });

  it("counts the measures that can be on while the editor is open: those on already, and the edited one", () => {
    mount("#lang=en&s=halve_mp_pay&e=redraw_income_tax.tariff");
    expect(texts(".scoreboard__changes > .slot__stand-in")).toHaveLength(1);
    expect(texts(".scoreboard__changes > .slot__stand-in")[0]).toContain("8 measures switched on");
  });

  it("has no stand-ins without an editor", () => {
    mount("#lang=en&s=halve_mp_pay");
    expect(document.querySelectorAll(".slot, .slot__stand-in, .scoreboard__changes")).toHaveLength(0);
  });
});
