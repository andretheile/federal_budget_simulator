// @vitest-environment jsdom
/**
 * Who pays on the German pack, as it is in the working tree: under the chart of a scope, a measure's
 * sentence stands only with the part of it that the scope shows. Bringing civil servants into the
 * pension insurance changes contributions (not in "Steuern") and, as they deduct them, wage tax.
 *
 * If the pack does not validate, the test fails with the pack's own errors.
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

const plain = (value: string | null | undefined): string => (value ?? "").replace(/[  ]/g, " ");
const under = (): string => plain(container.querySelector(".whopays__measures")?.textContent);

describe("the sentences under the chart of who pays", () => {
  const contributions = "Den Arbeitgeberanteil zahlt der Staat selbst";
  const wageTax = "Weniger Lohnsteuer zahlen dieselben Beamten";

  it("under taxes: only the wage tax the measure changes, with its own sentence", () => {
    mount("#c=de&lang=de&s=pension_insurance_for_all");
    expect(under()).toContain("Alle zahlen in die gesetzliche Rente ein (Keiner Gruppe zugeordnet");
    expect(under()).toContain("weniger)");
    expect(under()).toContain(wageTax);
    expect(under()).not.toContain(contributions);
  });

  it("under taxes and contributions: both parts, with both sentences", () => {
    mount("#c=de&lang=de&s=pension_insurance_for_all&w=taxes_and_contributions");
    expect(under()).toContain("Der Staat selbst");
    expect(under()).toContain(contributions);
    expect(under()).toContain(wageTax);
  });
});
