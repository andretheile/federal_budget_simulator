// @vitest-environment jsdom
/**
 * What a measure's card says about effects that are passed on to another item, about effects that
 * vary together, and about an effect of nothing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { testland, testlandCopy, testlandTimed } from "../engine/__fixtures__/testland.ts";
import type { CountryPack } from "../engine/index.ts";

let container: HTMLDivElement;
let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
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

function mount(hash: string, pack: CountryPack = testland): void {
  window.history.replaceState(null, "", hash);
  const created = createRoot(container);
  root = created;
  act(() => created.render(<Simulator pack={pack} />));
}

const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const plain = (value: string | null | undefined): string => (value ?? "").replace(/[  ]/g, " ");
const text = (selector: string): string => plain(query(selector).textContent);
const all = (selector: string): string[] => [...container.querySelectorAll(selector)].map((element) => plain(element.textContent));
const expand = (card: string): void => act(() => query(`${card} .policy__more`).click());

const INSURE = "#policy-insure_civil_servants";

describe("a part of an effect that is passed on to another item", () => {
  it("is headed by the pack's own words and worded by its sign and side: less revenue", () => {
    mount("#lang=en");
    expect(text(`${INSURE} .policy__shift-label`)).toBe("Less income tax");
    expect(text(`${INSURE} .policy__shift`)).toContain("XTS 15 less revenue from “Income tax”");
    expect(text(`${INSURE} .policy__shift`)).not.toContain("Cost shift");
    expect(text(`${INSURE} .policy__shift`)).not.toContain("reappear");
  });

  it("reads the other way when the effect is reversed: more revenue", () => {
    const pack = testlandCopy();
    const policy = pack.policies.find((candidate) => candidate.id === "insure_civil_servants")!;
    (policy.effects[0] as { amount: number }).amount = -100;
    mount("#lang=en", pack);
    expect(text(`${INSURE} .policy__shift`)).toContain("XTS 15 more revenue from “Income tax”");
  });

  it("keeps the wording of a cost that reappears elsewhere, with the generic heading where the pack gives none", () => {
    mount("#lang=en");
    expect(text("#policy-cut_pensions .policy__shift")).toContain("Cost shift: XTS 40 reappear as spending on “Basic income support”");
    expect(container.querySelector("#policy-cut_pensions .policy__shift-label")).toBeNull();
  });

  it("shows its quality, note and sources in the details, like an effect", () => {
    mount("#lang=en");
    expand(INSURE);
    const shift = query(`${INSURE} .effect__shift`);
    expect(plain(shift.querySelector(".effect__shift-title")?.textContent)).toBe("Less income tax");
    expect(plain(shift.querySelector(".quality")?.textContent)).toBe("Estimate");
    expect(plain(shift.querySelector(".effect__note")?.textContent)).toBe("Employees deduct their own part, taxed at 30 %.");
    expect(plain(shift.querySelector(".sources")?.textContent)).toContain("Income tax statistics");
  });
});

describe("effects that vary together", () => {
  it("give their ends as the measure's low and high end, not as a range of their own", () => {
    mount("#lang=en");
    expand(INSURE);
    const lines = all(`${INSURE} .effect > .effect__line`);
    expect(lines[0]).toContain("at the low end of the measure's range +XTS 80, at its high end +XTS 110");
    expect(lines[0]).not.toContain(" to ");
    // The shift's ends belong to the same two cases.
    expect(text(`${INSURE} .effect__shift .effect__line`)).toContain("at the low end of the measure's range −XTS 18, at its high end −XTS 8");
  });

  it("an effect of its own keeps its own range", () => {
    mount("#lang=en");
    expand("#policy-cut_pensions");
    expect(all("#policy-cut_pensions .effect > .effect__line")[0]).toContain("−XTS 160 to −XTS 120");
  });
});

describe("an effect of nothing", () => {
  /**
   * A copy of the fixture with a budget the size of a country's (every amount times a billion),
   * where halving MPs' pay changes a budget item by 4 units: floating-point noise at that size (as
   * the 4 euros the German pack once showed), though the formatter would write "−XTS 4".
   */
  function almostNothing(): CountryPack {
    const pack = testlandCopy();
    const scale = (nodes: unknown[]): void => {
      for (const node of nodes as { amount?: number; children?: unknown[] }[]) {
        if (typeof node.amount === "number") node.amount *= 1e9;
        if (node.children) scale(node.children);
      }
    };
    scale(pack.budget.revenue);
    scale(pack.budget.expenditure);
    const policy = pack.policies.find((candidate) => candidate.id === "halve_mp_pay")!;
    policy.effects = [{ type: "add", target: "exp.admin.parliament", amount: -4, quality: "official" }];
    return pack;
  }

  it("is a plain zero on the card, without sign, triangle or 'improves'", () => {
    mount("#lang=en", almostNothing());
    const figure = query("#policy-halve_mp_pay .policy__figure");
    expect(plain(figure.querySelector(".policy__amount")?.textContent)).toBe("XTS 0");
    expect(figure.querySelector(".icon")).toBeNull();
    expect(plain(figure.textContent)).toContain("no effect on the balance");
    expect(plain(figure.textContent)).not.toContain("improves");
    expand("#policy-halve_mp_pay");
    expect(all("#policy-halve_mp_pay .effect > .effect__line")[0]).toMatch(/^XTS 0 /);
  });

  it("is a plain zero in the scoreboard once the measure is on", () => {
    mount("#lang=en&s=halve_mp_pay", almostNothing());
    expect(text(".scoreboard__change")).toContain("XTS 0 compared with 2024");
    expect(text(".scoreboard__change")).not.toContain("−XTS 0");
  });
});

describe("a measure that acts later in the debt projection (Testland with timing)", () => {
  const timed = testlandTimed();
  /** The line under the figure, as shown (not its invisible stand-ins). */
  const line = (id: string): string => text(`#policy-${id} .policy__timing > span:not(.policy__stand-in)`);
  const slide = (id: string, value: number): void =>
    act(() => {
      const slider = query<HTMLInputElement>(`#policy-${id} input[type=range]`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, String(value));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("says under the figure that it is the full effect, and when the projection has it", () => {
    mount("#lang=en", timed);
    expect(line("cut_admin")).toBe("The figure is the full effect; in the projection of debt and interest from 2026, in full from 2030.");
    expect(line("wealth_tax")).toBe("The figure is the full effect; in the projection of debt and interest from 2028.");
    // The amount stays the full yearly effect, as on any other card.
    expect(text("#policy-cut_admin .policy__amount")).toBe("+XTS 40");
    // A measure without timing of its own says nothing of the kind.
    expect(document.querySelector("#policy-halve_mp_pay .policy__timing")).toBeNull();
    act(() => root?.unmount());
    mount("#lang=de", timed);
    expect(line("defense_target")).toBe("Die Zahl ist die volle Wirkung; in der Rechnung zu Schulden und Zinsen ab Juli 2027, voll ab 2030.");
  });

  it("follows the slider, while the line keeps the room of its longest form", () => {
    mount("#lang=en", timed);
    expand("#policy-defense_target");
    const standIns = (): string[] =>
      [...document.querySelectorAll("#policy-defense_target .policy__stand-in")].map((element) => plain(element.textContent));
    const room = standIns();
    // The lower end, the upper end and the baseline are among them, with the widest digits; hidden from screen readers.
    expect(room.length).toBeGreaterThanOrEqual(2);
    expect(room.every((entry) => /^The figure is the full effect; in the projection of debt and interest from /.test(entry))).toBe(true);
    expect(room.some((entry) => entry.includes("in full from 8888"))).toBe(true);
    for (const element of document.querySelectorAll("#policy-defense_target .policy__stand-in")) expect(element.getAttribute("aria-hidden")).toBe("true");
    slide("defense_target", 4);
    expect(line("defense_target")).toBe("The figure is the full effect; in the projection of debt and interest from July 2027, in full from 2032.");
    slide("defense_target", 1);
    expect(line("defense_target")).toBe("The figure is the full effect; in the projection of debt and interest from 2026, in full from 2027.");
    // The longest forms (the ends of the slider) are kept as room whatever the setting.
    const longest = (entries: string[]): number => Math.max(...entries.map((entry) => entry.length));
    expect(longest(standIns())).toBe(longest(room));
  });

  it("gives the pack's note and sources in the details", () => {
    mount("#lang=de", timed);
    expand("#policy-wealth_tax");
    const section = [...document.querySelectorAll("#policy-wealth_tax .policy__section")].find(
      (element) => plain(element.querySelector("h4")?.textContent) === "Wann sie wirkt",
    );
    expect(section).toBeDefined();
    expect(plain(section!.querySelector(".policy__timing-detail")?.textContent)).toBe(
      "In der Rechnung zu Schulden und Zinsen wirkt die Maßnahme bei dieser Einstellung ab 2028.",
    );
    expect(plain(section!.querySelector(".policy__timing-note")?.textContent)).toBe("Die erste Veranlagung ist für 2028.");
    expect(section!.querySelector(".sources")).not.toBeNull();
  });
});
