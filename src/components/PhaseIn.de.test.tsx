// @vitest-environment jsdom
/**
 * Measures acting later, on the German pack, where the real case matters: the retirement age. Raised,
 * it acts from 2032 at nine years per year of age (67.5 in full from 2037, 70 from 2059, after the end
 * of the calculation in 2054); lowered to 65, it acts at once from 2027, the pack's first year.
 *
 * This reads countries/de as it is in the working tree. If the pack does not validate, the test
 * fails with the pack's own errors.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Simulator } from "../App.tsx";
import type { CountryPack } from "../engine/index.ts";
import { loadPack } from "../packs.ts";
import { debtModule } from "./DebtSection.tsx";

// The whole German page, rendered several times.
vi.setConfig({ testTimeout: 30_000 });

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
  await debtModule.load();
}, 60_000);

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
const line = (): string => plain(container.querySelector("#policy-retirement_age .policy__timing > span:not(.policy__stand-in)")?.textContent);
const later = (): string[] => [...container.querySelectorAll("#debt .debt__later li")].map((item) => plain(item.textContent));

describe("the retirement age in the debt projection", () => {
  it("at 67.5, the default: from 2032, in full from 2037", () => {
    mount("#lang=de&s=retirement_age");
    expect(line()).toBe("Die Zahl ist die volle Wirkung; in der Rechnung zu Schulden und Zinsen ab 2032, voll ab 2037.");
    expect(later()).toEqual(["Renteneintrittsalter ändern: ab 2032, voll ab 2037"]);
    expect(plain(container.querySelector("#debt .debt__timing > p")?.textContent)).toBe(
      "Maßnahmen wirken in dieser Rechnung ab 2027; bis dahin verläuft der Pfad mit Maßnahmen wie der ohne.",
    );
    expect(plain(container.querySelector(".dfig--debt .dfig__condition")?.textContent)).toMatch(/^mit den eingeschalteten Maßnahmen, bei /);
  });

  it("at 70: in full only after the end of the calculation, and the figures say so", () => {
    mount("#lang=de&s=retirement_age.age.70");
    expect(line()).toBe("Die Zahl ist die volle Wirkung; in der Rechnung zu Schulden und Zinsen ab 2032, voll ab 2059.");
    expect(later()).toEqual(["Renteneintrittsalter ändern: ab 2032, voll erst ab 2059, nach dem Ende der Rechnung"]);
    expect(plain(container.querySelector(".dfig--debt .dfig__condition")?.textContent)).toMatch(
      /^mit den eingeschalteten Maßnahmen, soweit sie bis 2054 wirken, bei /,
    );
    mount("#lang=en&s=retirement_age.age.70");
    expect(later()).toEqual(["Change the retirement age: from 2032, in full only from 2059, after the end of the calculation"]);
  });

  it("at 65: at once from the pack's first year, so the section names nothing more", () => {
    mount("#lang=de&s=retirement_age.age.65");
    expect(line()).toBe("Die Zahl ist die volle Wirkung; in der Rechnung zu Schulden und Zinsen ab 2027.");
    expect(container.querySelector("#debt .debt__later")).toBeNull();
    expect(plain(container.querySelector(".dfig--debt .dfig__condition")?.textContent)).toMatch(/^mit den eingeschalteten Maßnahmen, bei /);
  });

  it("names the reason for 2027 from the pack", () => {
    mount("#lang=de&s=retirement_age");
    const why = container.querySelector("#debt .debt__why");
    expect(plain(why?.querySelector("summary")?.textContent)).toBe("Warum ab 2027?");
    expect(plain(why?.querySelector("p")?.textContent)).toMatch(/^Maßnahmen wirken in der Projektion frühestens 2027/);
  });
});
