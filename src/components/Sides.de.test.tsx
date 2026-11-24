// @vitest-environment jsdom
/**
 * The two sides of the budget on the German pack, where a measure on both sides can be set so that
 * one of them does not change: abolishing the broadcasting fee (revenue) and shrinking the
 * broadcasters (spending, and their own sales). Set to keep the broadcasters' spending as it is, the
 * card says only that the state takes in less, and the measure keeps its place in the list.
 *
 * This reads countries/de as it is in the working tree. If the pack does not validate, the test
 * fails with the pack's own errors.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import type { CountryPack } from "../engine/index.ts";
import { loadPack } from "../packs.ts";

let pack: CountryPack;
let container: HTMLDivElement;
let root: Root | undefined;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  const result = await loadPack("de");
  if (!result.ok) throw new Error(`countries/de does not validate: ${JSON.stringify(result.errors.slice(0, 3))}`);
  pack = result.pack;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

function mount(hash: string): void {
  act(() => root?.unmount());
  window.history.replaceState(null, "", hash);
  root = createRoot(container);
  act(() => root!.render(<Simulator pack={pack} />));
}

/** No-break and narrow no-break spaces, as the formatters write them, as plain spaces. */
const plain = (value: string | null | undefined): string => (value ?? "").replace(/[  ]/g, " ");
const text = (selector: string): string => plain(container.querySelector(selector)?.textContent);
const FEE = "#policy-broadcasting_fee_abolish";

describe("a German measure on both sides", () => {
  it("gives both amounts at its default settings, and no share of either side", () => {
    mount("#lang=de");
    expect(text(`${FEE} .policy__topic`)).toBe("Staat und Verwaltung · , Einnahmen, Ausgaben");
    expect(text(`${FEE} .policy__what`)).toMatch(/^verschlechtert den Saldo: Der Staat nimmt [\d,]+ Mrd\. € weniger ein und gibt [\d,]+ Mrd\. € weniger aus\.$/);
    expect(text(`${FEE} .policy__proportion`)).toMatch(/^[\d.]+ € je Einwohner$/);
    expect(container.querySelector(FEE)?.closest(".policy-side")?.id).toBe("measures-both");
  });

  it("names only the side that changes where the other does not, and keeps its place in the list", () => {
    mount("#lang=de&s=broadcasting_fee_abolish.spending_cut.0");
    expect(text(`${FEE} .policy__what`)).toBe("verschlechtert den Saldo: Der Staat nimmt weniger ein.");
    // Then the figure is that side's change, and its share of all revenue is said again.
    expect(text(`${FEE} .policy__proportion`)).toMatch(/^[\d,]+ % aller Einnahmen · [\d.]+ € je Einwohner$/);
    expect(text(`${FEE} .policy__topic`)).toBe("Staat und Verwaltung · , Einnahmen, Ausgaben");
    expect(container.querySelector(FEE)?.closest(".policy-side")?.id).toBe("measures-both");
  });

  it("stands in the section for both sides with the other German measures of that kind", () => {
    mount("#lang=de");
    const both = [...container.querySelectorAll("#measures-both .policy")].map((card) => card.id.replace(/^policy-/, ""));
    for (const id of ["broadcasting_fee_abolish", "civil_service_pensions", "early_retirement_45_years", "pension_insurance_for_all", "retirement_age"]) {
      expect(both).toContain(id);
    }
    expect(container.querySelector("#measures-revenue #policy-wealth_tax")).not.toBeNull();
    expect(container.querySelector("#measures-expenditure #policy-child_benefit_amount")).not.toBeNull();
  });
});
