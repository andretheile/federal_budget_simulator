// @vitest-environment jsdom
/**
 * What a measure's card says about effects that are passed on to another item, about effects that
 * vary together, and about an effect of nothing.
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
