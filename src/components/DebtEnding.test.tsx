// @vitest-environment jsdom
/**
 * Measures that end, on Testland with ends (testlandEnding; measures act from 2026): the family bonus
 * is a one-off paid on 1 July 2027, the higher top tax rate lasts four years from 1 July 2026 to
 * 30 June 2030, and the defence target is a one-off below its baseline and for good above it. How
 * the cards and the debt section say when they act, and what the figures and tiles say about them.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { testlandEnding, testlandFiscal } from "../engine/__fixtures__/testland.ts";
import { projectScenario, type CountryPack } from "../engine/index.ts";
import { debtDe } from "../i18n/debt/de.ts";
import { debtEn } from "../i18n/debt/en.ts";
import { debtModule } from "./DebtSection.tsx";

let container: HTMLDivElement;
let root: Root | undefined;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) } as DOMRect;
  };
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  await debtModule.load();
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

function mount(hash: string, pack: CountryPack = testlandEnding()): void {
  // A test may mount more than once: the page before goes first, so that it neither stays mounted
  // for the rest of the file nor renders again on every later change of the address.
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
const all = (selector: string): string[] => [...container.querySelectorAll(selector)].map((element) => plain(element.textContent));
const text = (selector: string): string => plain(query(selector).textContent);
const line = (id: string): string => text(`#policy-${id} .policy__timing > span:not(.policy__stand-in)`);
const expand = (id: string): void => act(() => query(`#policy-${id} .policy__more`).click());
const detail = (id: string): string => text(`#policy-${id} .policy__timing-detail`);

describe("the card of a one-off", () => {
  it("says the figure is an amount counted once, and in which year", () => {
    mount("#lang=en");
    expect(line("family_bonus")).toBe("The figure is a one-off amount; in the projection of debt and interest it counts once, in 2027.");
    expect(text("#policy-family_bonus .policy__per")).toBe("once");
    expand("family_bonus");
    expect(detail("family_bonus")).toBe("In the projection of debt and interest the measure counts once, in 2027.");
    expect(text("#policy-family_bonus .facts dd")).toMatch(/ once$|single value/);
    mount("#lang=de");
    expect(line("family_bonus")).toBe("Die Zahl ist ein einmaliger Betrag; in der Rechnung zu Schulden und Zinsen zählt er einmal, im Jahr 2027.");
    expect(text("#policy-family_bonus .policy__per")).toBe("einmalig");
    expand("family_bonus");
    expect(detail("family_bonus")).toBe("In der Rechnung zu Schulden und Zinsen zählt die Maßnahme einmal, im Jahr 2027.");
  });

  it("in fiscal years names the fiscal year", () => {
    const pack = testlandFiscal();
    pack.policies.find((policy) => policy.id === "family_bonus")!.timing = { once: true, note: { en: "Paid once.", de: "Einmal gezahlt." }, sources: ["finance_ministry"] };
    mount("#lang=en", pack);
    expect(line("family_bonus")).toBe("The figure is a one-off amount; in the projection of debt and interest it counts once, in FY 2026.");
    mount("#lang=de", pack);
    expect(line("family_bonus")).toBe("Die Zahl ist ein einmaliger Betrag; in der Rechnung zu Schulden und Zinsen zählt er einmal, im Haushaltsjahr 2026.");
  });

  it("follows a slider that makes it a one-off below the baseline, and keeps the room of the longer line", () => {
    mount("#lang=en&s=defense_target.share.1");
    expect(line("defense_target")).toBe("The figure is a one-off amount; in the projection of debt and interest it counts once, in 2026.");
    expect(text("#policy-defense_target .policy__per")).toBe("once");
    mount("#lang=en&s=defense_target.share.4");
    expect(line("defense_target")).toBe("The figure is the full effect; in the projection of debt and interest from July 2027.");
    expect(text("#policy-defense_target .policy__per")).toBe("per year");
    // The room for the line holds both forms.
    expect(all("#policy-defense_target .policy__stand-in").some((form) => form.startsWith("The figure is a one-off amount"))).toBe(true);
  });
});

describe("the card of a measure for a number of years", () => {
  it("says from when to when it acts", () => {
    mount("#lang=en");
    expect(line("raise_top_tax_rate")).toBe("The figure is the full effect; in the projection of debt and interest from July 2026 to June 2030.");
    expect(text("#policy-raise_top_tax_rate .policy__per")).toBe("per year");
    expand("raise_top_tax_rate");
    expect(detail("raise_top_tax_rate")).toBe("In the projection of debt and interest the measure acts from July 2026 to June 2030.");
    mount("#lang=de");
    expect(line("raise_top_tax_rate")).toBe("Die Zahl ist die volle Wirkung; in der Rechnung zu Schulden und Zinsen von Juli 2026 bis Juni 2030.");
  });
});

describe("the debt section with measures that end", () => {
  it("lists them under a title that covers them, with their end", () => {
    mount("#lang=en&s=family_bonus~raise_top_tax_rate");
    expect(text(".debt__later-title")).toBe("Acting later, step by step, once or for a limited time:");
    expect(all(".debt__later li")).toEqual(["Raise the top income tax rate: from July 2026 to June 2030", "Family bonus: once, in 2027"]);
    mount("#lang=de&s=family_bonus");
    expect(text(".debt__later-title")).toBe("Später, nach und nach, einmalig oder befristet wirken:");
    expect(text(".debt__later li")).toBe("Familienbonus: einmal, im Jahr 2027");
  });

  it("says in the tiles that a measure has ended by the last year, not that it acts in full", () => {
    // The one-off alone: every measure switched on has ended.
    mount("#lang=en&s=family_bonus");
    expect(all(".dfig__condition")[0]).toBe("with the measures switched on, which have ended by then, at 4% interest on new debt");
    mount("#lang=de&s=family_bonus");
    expect(all(".dfig__condition")[0]).toBe("mit den eingeschalteten Maßnahmen, die bis dahin nicht mehr wirken, bei 4 % Zins für neue Schulden");
    // Beside a measure for good: some of them.
    mount("#lang=en&s=family_bonus~halve_mp_pay");
    expect(all(".dfig__condition")[0]).toBe("with the measures switched on, some of which have ended by then, at 4% interest on new debt");
    mount("#lang=de&s=family_bonus~halve_mp_pay");
    expect(all(".dfig__condition")[0]).toBe("mit den eingeschalteten Maßnahmen, von denen manche bis dahin nicht mehr wirken, bei 4 % Zins für neue Schulden");
    // A measure that has not started by then is not one that has ended.
    mount("#lang=en&s=family_bonus&d=y2");
    expect(all(".dfig__condition")[0]).toBe("with the measures switched on, as far as they act by 2026, at 4% interest on new debt");
    // Both at once: one measure has ended and another is not yet in full by the last year.
    expect(debtEn.figures.withMeasuresEnded(2040, true, false)).toBe("with the measures switched on, as far as they act by 2040 (some have ended by then)");
    expect(debtDe.figures.withMeasuresEnded("Haushaltsjahr 2040", true, false)).toBe(
      "mit den eingeschalteten Maßnahmen, soweit sie bis Haushaltsjahr 2040 wirken (manche wirken bis dahin nicht mehr)",
    );
  });

  it("a one-off alone: a step in the debt that stays, nothing in later balances, and the sentence says the measures' path", () => {
    const projection = projectScenario(testlandEnding(), { policies: { family_bonus: { enabled: true } } })!;
    const gap = (i: number) => projection.reform.years[i].primaryBalanceRatio - projection.baseline.years[i].primaryBalanceRatio;
    // 2027 is the third year of the projection (2025, 2026, 2027): the payment; nothing before or after.
    expect(gap(1)).toBeCloseTo(0, 12);
    expect(gap(2)).toBeLessThan(0);
    expect(gap(3)).toBeCloseTo(0, 12);
    expect(projection.reform.years[3].debt).toBeGreaterThan(projection.baseline.years[3].debt);
    mount("#lang=en&s=family_bonus");
    expect(text(".debt__lead")).toMatch(/with the measures switched on, and [\d.]+% without them; in 2024 it was/);
  });
});
