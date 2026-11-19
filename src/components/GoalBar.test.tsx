// @vitest-environment jsdom
/**
 * The goal bar on Testland, used the way a visitor would. The default goal, "Gap in the central
 * budget", asks the central government's balance to improve by 100. On its own,
 * no_basic_income_non_citizens improves it by 94.8 (45.6 to 94.8), cut_admin by 8.8; the wealth tax
 * goes to the provinces; insure_civil_servants burdens the centre by 17.5. "Close the deficit" is
 * about the whole state (400) and leaves out exp.defense and the measure family_bonus.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Simulator } from "../App.tsx";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import type { CountryPack } from "../engine/index.ts";
import { editorModule } from "./CurveEditor.tsx";
import { goalDetailsModule } from "./GoalBar.tsx";

let container: HTMLDivElement;
let root: Root | undefined;

// The lazily loaded parts are loaded once, here, as the curve editor's tests do: a test then never
// waits for a dynamic import whose timing is the module loader's. How the details behave while
// their code is on its way, or cannot be loaded, is tested with each attempt held back by hand
// ("the details before their code has arrived").
beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  await editorModule.load();
  await goalDetailsModule.load();
}, 30_000);

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(hash = "#lang=en", pack: CountryPack = testland): void {
  // A test may mount more than once: the page before goes first, so nothing of it is found.
  const previous = root;
  if (previous) act(() => previous.unmount());
  window.history.replaceState(null, "", hash);
  const created = createRoot(container);
  root = created;
  act(() => created.render(<Simulator pack={pack} />));
}

const plain = (value: string | null | undefined): string => (value ?? "").replace(/[\u00a0\u202f]/g, " ");
const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const text = (selector: string): string => plain(query(selector).textContent);
/** What the bar says in words: the sentence and its qualifiers, without the invisible stand-ins. */
const status = (): string =>
  [...container.querySelectorAll(".goalbar__status > .goalbar__line:not(.goalbar__stand-in) > :not(.goalbar__others-chip)")]
    .map((part) => plain(part.textContent))
    .join(" | ");
const bar = (): HTMLElement => query('.goalbar [role="progressbar"]');
const click = (element: Element): void => act(() => (element as HTMLElement).click());
const toggle = (id: string): void => click(query(`#policy-${id} [role="switch"]`));
function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("the goal bar", () => {
  it("stands in the scoreboard's band, names the goal and offers the others", () => {
    mount();
    const goalbar = query(".scoreboard__band .goalbar");
    expect(goalbar.getAttribute("data-goal")).toBe("central_gap");
    expect(text(".goalbar__label .goalbar__label-full")).toBe("Goal");
    const select = query<HTMLSelectElement>(".goalbar select");
    expect(select.value).toBe("central_gap");
    expect([...select.options].map((option) => option.textContent)).toEqual(["Close the deficit", "Gap in the central budget"]);
    // The label belongs to the picker.
    expect(container.querySelector(`label[for="${select.id}"]`)).not.toBeNull();
  });

  it("with nothing switched on: the whole amount is missing, the bar is empty and says so", () => {
    mount();
    expect(status()).toBe("XTS 100 missing. | No measure is switched on yet.");
    expect(container.querySelector(".goalbar__fill")).toBeNull();
    expect(bar().getAttribute("aria-valuemin")).toBe("0");
    expect(bar().getAttribute("aria-valuemax")).toBe("100");
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
    expect(bar().getAttribute("aria-label")).toBe("Gap in the central budget");
    // The picture and its text alternative say the same; the words themselves are hidden from screen readers.
    expect(plain(bar().getAttribute("aria-valuetext"))).toBe("XTS 100 missing. No measure is switched on yet.");
    expect(query(".goalbar__status").getAttribute("aria-hidden")).toBe("true");
    expect(text(".goalbar__level")).toBe("Only what reaches the level “Central government” counts.");
  });

  it("measures switched on that reach no further than another level change nothing here, and it says why", () => {
    mount("#lang=en&s=wealth_tax");
    expect(status()).toBe("Still XTS 100 missing. | The measures switched on change nothing here.");
    expect(text(".goalbar__level")).toBe("Only what reaches the level “Central government” counts.");
    expect(container.querySelector(".goalbar__fill")).toBeNull();
  });

  it("partly closed: covered, missing, the range, and a solid fill", () => {
    mount("#lang=en&s=no_basic_income_non_citizens");
    expect(status()).toBe("XTS 95 covered, XTS 5.2 still missing. | Range +XTS 46 to +XTS 95");
    expect(bar().getAttribute("aria-valuenow")).toBe("95");
    // The provinces pay 4.8 more meanwhile: said right after the state (see below).
    expect(plain(bar().getAttribute("aria-valuetext"))).toBe(
      "XTS 95 covered, XTS 5.2 still missing. At the same time the other levels are burdened by XTS 4.8. Range +XTS 46 to +XTS 95",
    );
    const fill = query(".goalbar__fill");
    expect(fill.classList.contains("goalbar__fill--improve")).toBe(true);
    expect(fill.style.left).toBe("0%");
    expect(container.querySelector(".goalbar__range")).not.toBeNull();
    expect(container.querySelector(".goalbar__line:not(.goalbar__stand-in) .goalbar__tag")).toBeNull();
  });

  it("closed: a modest tag, the surplus, and whether it holds at the cautious end", () => {
    mount("#lang=en&s=no_basic_income_non_citizens~cut_admin");
    expect(status()).toBe("Closed | XTS 104 covered. | XTS 3.6 more than needed. | At the low end of the range, XTS 46 is still missing.");
    expect(query(".goalbar").classList.contains("goalbar--closed")).toBe(true);
    expect(query(".goalbar__goal").classList.contains("is-met")).toBe(true);
    expect(bar().getAttribute("aria-valuenow")).toBe("100");
    mount("#lang=en&s=no_basic_income_non_citizens~raise_top_tax_rate");
    expect(status()).toBe("Closed | XTS 157 covered. | XTS 57 more than needed. | Also at the low end of the range.");
  });

  it("a burden: the gap grows, the fill is the hatched one, left of zero", () => {
    mount("#lang=en&s=insure_civil_servants");
    expect(status()).toBe("The gap grows by XTS 18 to XTS 118. | Range −XTS 18 to −XTS 15");
    expect(query(".goalbar__fill").classList.contains("goalbar__fill--worsen")).toBe(true);
    expect(container.querySelector(".goalbar__zero")).not.toBeNull();
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
  });

  it("a mix of relief and burden is netted", () => {
    mount("#lang=en&s=no_basic_income_non_citizens~insure_civil_servants");
    expect(status()).toMatch(/^XTS 77 covered, XTS 23 still missing\./);
    mount("#lang=en&s=no_basic_income_non_citizens~defense_target");
    expect(status()).toMatch(/^The gap grows by XTS 5.2 to XTS 105\./);
  });

  it("follows a switch at once", () => {
    mount();
    toggle("no_basic_income_non_citizens");
    expect(status()).toMatch(/^XTS 95 covered/);
    toggle("insure_civil_servants");
    expect(status()).toMatch(/^XTS 77 covered/);
  });

  it("measures at the goal's level whatever level the page shows", () => {
    for (const level of ["", "~L.central", "~L.state", "~L.social_security"]) {
      mount(`#lang=en&s=no_basic_income_non_citizens${level}`);
      expect(status()).toBe("XTS 95 covered, XTS 5.2 still missing. | Range +XTS 46 to +XTS 95");
    }
  });

  it("speaks German", () => {
    mount("#lang=de&s=no_basic_income_non_citizens~cut_admin");
    expect(text(".goalbar__label .goalbar__label-full")).toBe("Ziel");
    expect(status()).toBe("Geschlossen | 104 XTS gedeckt. | 3,6 XTS mehr als nötig. | Am unteren Ende der Spanne fehlen noch 46 XTS.");
    expect(text(".goalbar__level")).toBe("Es zählt nur, was auf der Ebene „Zentralstaat“ ankommt.");
    mount("#lang=de");
    expect(status()).toBe("Es fehlen 100 XTS. | Noch ist keine Maßnahme eingeschaltet.");
  });

  it("keeps the room of its longest words: invisible stand-ins, hidden from screen readers", () => {
    mount();
    const standIns = [...container.querySelectorAll(".goalbar__stand-in")];
    expect(standIns).toHaveLength(7);
    expect(standIns.every((element) => element.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(plain(standIns[4].textContent)).toMatch(/^ClosedXTS 8,888 covered\.XTS 8,888 more than needed\./);
  });

  it("tells screen readers the new state once the visitor has stopped", () => {
    vi.useFakeTimers();
    mount();
    expect(text('.goalbar [role="status"]')).toBe("");
    toggle("no_basic_income_non_citizens");
    act(() => vi.advanceTimersByTime(1100));
    expect(text('.goalbar [role="status"]')).toBe(
      "Gap in the central budget: XTS 95 covered, XTS 5.2 still missing. At the same time the other levels are burdened by XTS 4.8. Range +XTS 46 to +XTS 95",
    );
  });
});

describe("another goal", () => {
  it("is chosen with the picker, kept in the address, and taken back from it", () => {
    mount("#lang=en&s=wealth_tax");
    choose(query<HTMLSelectElement>(".goalbar select"), "close_deficit");
    expect(window.location.hash).toBe("#lang=en&s=wealth_tax&g=close_deficit");
    expect(query(".goalbar").getAttribute("data-goal")).toBe("close_deficit");
    expect(text(".goalbar__level")).toBe("What counts is the balance of the whole state.");
    expect(status()).toBe("XTS 40 covered, XTS 360 still missing. | Range +XTS 20 to +XTS 50");
    // Back to the default: the address no longer names a goal.
    choose(query<HTMLSelectElement>(".goalbar select"), "central_gap");
    expect(window.location.hash).toBe("#lang=en&s=wealth_tax");
  });

  it("opens from a link, and follows the address when it changes", () => {
    mount("#lang=en&g=close_deficit");
    expect(query<HTMLSelectElement>(".goalbar select").value).toBe("close_deficit");
    act(() => {
      window.history.replaceState(null, "", "#lang=en");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(query<HTMLSelectElement>(".goalbar select").value).toBe("central_gap");
    act(() => {
      window.history.replaceState(null, "", "#lang=en&g=close_deficit&s=halve_mp_pay");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(query(".goalbar").getAttribute("data-goal")).toBe("close_deficit");
    // An unknown goal is the default.
    mount("#lang=en&g=no_such_goal");
    expect(query(".goalbar").getAttribute("data-goal")).toBe("central_gap");
    expect(window.location.hash).toBe("#lang=en");
  });
});

describe("what a goal leaves out", () => {
  it("one thing with a short reason: named with its amount, the reason beside it", () => {
    mount("#lang=en&g=close_deficit&s=wealth_tax~defense_target");
    expect(text(".goalbar__excluded")).toBe("Not counted: the item “Defence” (−XTS 100). Defence is paid for outside the deficit rule.");
    // Only what is counted moves the bar: the wealth tax.
    expect(status()).toMatch(/^XTS 40 covered/);
  });

  it("several things: each named with its amount, the reasons one click away", async () => {
    mount("#lang=en&g=close_deficit&s=defense_target~family_bonus");
    expect(text(".goalbar__excluded")).toBe("Not counted: the item “Defence” (−XTS 100) and the measure “Family bonus” (−XTS 100). Why?");
    expect(status()).toBe("Still XTS 400 missing. | What is switched on does not count towards this goal.");
    click(query(".goalbar__why"));
    const items = [...container.querySelectorAll(".goaldetails__excluded > li")].map((item) => plain(item.textContent));
    expect(items[0]).toMatch(/^The item “Defence” −XTS 100Defence is paid for outside the deficit rule\./);
    expect(items[1]).toBe("The measure “Family bonus” −XTS 100The plan already counts on it.");
  });

  it("says nothing while what is left out is zero", () => {
    mount("#lang=en&g=close_deficit&s=wealth_tax");
    expect(container.querySelector(".goalbar__excluded")).toBeNull();
  });

  it("marks the card of a measure the goal leaves out, with the reason, and only for that goal", () => {
    mount("#lang=en&g=close_deficit");
    expect(text("#policy-family_bonus .policy__goal")).toBe("Does not count towards the goal “Close the deficit”. The plan already counts on it.");
    expect(container.querySelectorAll(".policy__goal")).toHaveLength(1);
    mount("#lang=en");
    expect(container.querySelector(".policy__goal")).toBeNull();
  });
});

describe("the details", () => {
  it("open in a dialog with the description, the facts, the note in paragraphs and the sources, and give the focus back", async () => {
    mount("#lang=en");
    const opener = query<HTMLButtonElement>(".goalbar__more");
    expect(plain(opener.textContent)).toBe("About this goal: Gap in the central budget");
    expect(opener.getAttribute("aria-haspopup")).toBe("dialog");
    act(() => opener.focus());
    click(opener);
    const dialog = query<HTMLDialogElement>("dialog.goaldialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(text(`#${CSS.escape(dialog.getAttribute("aria-labelledby")!)}`)).toBe("Gap in the central budget");
    expect(text(".goaldetails__description")).toBe("The central government's plan lacks 100 in 2027.");
    expect([...container.querySelectorAll(".goaldetails__facts dd")].map((dd) => plain(dd.textContent))).toEqual([
      "XTS 100 for 2027",
      "Central government",
      "Official",
    ]);
    expect(text(".goaldetails__note")).toBe("A cash figure for a later year.");
    expect(container.querySelector(".goaldetails .sources a")?.getAttribute("href")).toBe("https://example.org/accounts");
    click(query(".goaldialog__close"));
    expect(container.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(query(".goalbar__more"));
  });
});

describe("the details before their code has arrived", () => {
  /** Each attempt to load the details waits until the test resolves or rejects it, inside act. */
  function holdBack(): { resolve(): Promise<void>; reject(): Promise<void> }[] {
    const attempts: { resolve(): Promise<void>; reject(): Promise<void> }[] = [];
    vi.spyOn(goalDetailsModule, "current").mockReturnValue(undefined);
    vi.spyOn(goalDetailsModule, "load").mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          attempts.push({
            resolve: () => act(async () => resolve(await import("./GoalDetails.tsx"))),
            reject: () => act(async () => reject(new TypeError("Failed to fetch dynamically imported module"))),
          });
        }),
    );
    return attempts;
  }

  it("opens the dialog with its title at once, and the details when they have arrived", async () => {
    const attempts = holdBack();
    mount("#lang=en&s=no_basic_income_non_citizens");
    click(query(".goalbar__more"));
    expect(text(".goaldialog__title")).toBe("Gap in the central budget");
    expect(text('.goaldialog__pending[role="status"]')).toBe("Loading …");
    expect(container.querySelector(".goaldetails")).toBeNull();
    expect(attempts).toHaveLength(1);
    await attempts[0].resolve();
    expect(container.querySelector(".goaldialog__pending")).toBeNull();
    expect(text(".goaldetails__description")).toBe("The central government's plan lacks 100 in 2027.");
  });

  it("says so when they cannot be loaded, and tries again on request", async () => {
    const attempts = holdBack();
    mount("#lang=en&g=close_deficit&s=defense_target~family_bonus");
    click(query(".goalbar__why"));
    await attempts[0].reject();
    expect(text('.goaldialog__pending[role="alert"] p')).toBe("This could not be loaded. Perhaps there is no connection at the moment.");
    click(query(".goaldialog__button"));
    expect(attempts).toHaveLength(2);
    expect(text('.goaldialog__pending[role="status"]')).toBe("Loading …");
    await attempts[1].resolve();
    expect([...container.querySelectorAll(".goaldetails__excluded > li")]).toHaveLength(2);
  });
});

describe("packs with fewer goals", () => {
  it("one goal: its name instead of a picker", () => {
    const pack = testlandCopy();
    pack.goals!.goals = pack.goals!.goals.filter((goal) => goal.id === "central_gap");
    mount("#lang=en&g=close_deficit", pack);
    expect(container.querySelector(".goalbar select")).toBeNull();
    expect(text(".goalbar__name")).toBe("Gap in the central budget");
  });

  it("no goals: no bar", () => {
    const pack = testlandCopy();
    delete pack.goals;
    mount("#lang=en&s=halve_mp_pay", pack);
    expect(container.querySelector(".goalbar")).toBeNull();
    expect(container.querySelector(".policy__goal")).toBeNull();
  });
});

describe("while the curve editor is open", () => {
  it("stays in the band above the sheet, reports, and offers nothing to click", () => {
    mount("#lang=en&s=redraw_income_tax&e=redraw_income_tax.tariff");
    expect(container.querySelector(".sheet")).not.toBeNull();
    const goalbar = query(".goalbar");
    expect(goalbar.classList.contains("goalbar--steady")).toBe(true);
    expect(goalbar.querySelector("select, button")).toBeNull();
    expect(text(".goalbar__name")).toBe("Gap in the central budget");
    // The edited tariff yields 125 more income tax, half of which reaches the centre.
    expect(status()).toMatch(/^XTS 63 covered, XTS 38 still missing\./);
  });
});

describe("what the other levels bear at the same time", () => {
  // no_basic_income_non_citizens relieves the centre by 94.8 while the provinces pay 4.8 more;
  // family_bonus burdens the centre by 50 and the provinces by 50; cut_admin relieves both.
  const others = (): string | null => {
    const row = container.querySelector(".goalbar__others");
    return row ? plain(row.textContent) : null;
  };
  const chip = (): string | null => {
    const element = container.querySelector(".goalbar__line:not(.goalbar__stand-in) .goalbar__others-chip");
    return element ? plain(element.textContent) : null;
  };

  it("says so in a row of its own when the goal's level is relieved and the others are burdened", () => {
    mount("#lang=en&s=no_basic_income_non_citizens");
    expect(status()).toBe("XTS 95 covered, XTS 5.2 still missing. | Range +XTS 46 to +XTS 95");
    expect(chip()).toBe("Other levels −XTS 4.8");
    expect(others()).toBe("At the same time the other levels are burdened by XTS 4.8.");
    // The text alternative carries it right after the state.
    expect(plain(bar().getAttribute("aria-valuetext"))).toBe(
      "XTS 95 covered, XTS 5.2 still missing. At the same time the other levels are burdened by XTS 4.8. Range +XTS 46 to +XTS 95",
    );
    expect(query(".goalbar").classList.contains("has-others")).toBe(true);
  });

  it("goes with the closed state, so that 'closed' is never read without it", () => {
    const pack = testlandCopy();
    pack.goals!.goals.find((goal) => goal.id === "central_gap")!.amount = 90;
    mount("#lang=en&s=no_basic_income_non_citizens", pack);
    expect(status()).toBe("Closed | XTS 95 covered. | XTS 4.8 more than needed. | At the low end of the range, XTS 44 is still missing.");
    expect(others()).toBe("At the same time the other levels are burdened by XTS 4.8.");
    expect(plain(bar().getAttribute("aria-valuetext"))).toMatch(/^XTS 95 covered\. At the same time the other levels are burdened by XTS 4\.8\. /);
    // On a phone, while the band floats, the line keeps the tag and the short form (goal.css).
    expect(query(".goalbar").className).toContain("goalbar--closed");
    expect(chip()).toBe("Other levels −XTS 4.8");
  });

  it("goes with a growing gap as well", () => {
    mount("#lang=en&s=family_bonus");
    expect(status()).toMatch(/^The gap grows by XTS 50 to XTS 150\./);
    expect(others()).toBe("At the same time the other levels are burdened by XTS 50.");
  });

  it("says nothing when the other levels are relieved, or unchanged, or for a whole-state goal", () => {
    mount("#lang=en&s=cut_admin");
    expect(others()).toBeNull();
    expect(chip()).toBeNull();
    expect(query(".goalbar").classList.contains("has-others")).toBe(false);
    // halve_mp_pay touches the centre alone: the difference is nothing but floating-point arithmetic.
    mount("#lang=en&s=halve_mp_pay");
    expect(others()).toBeNull();
    mount("#lang=en&g=close_deficit&s=no_basic_income_non_citizens");
    expect(others()).toBeNull();
  });

  it("is measured for the whole state whatever level the page shows", () => {
    for (const level of ["", "~L.central", "~L.state"]) {
      mount(`#lang=en&s=no_basic_income_non_citizens${level}`);
      expect(others()).toBe("At the same time the other levels are burdened by XTS 4.8.");
    }
  });

  it("speaks German, and is announced with the state", () => {
    vi.useFakeTimers();
    mount("#lang=de");
    act(() => query<HTMLElement>('#policy-no_basic_income_non_citizens [role="switch"]').click());
    expect(others()).toBe("Zugleich werden die übrigen Ebenen um 4,8 XTS belastet.");
    expect(chip()).toBe("Übrige Ebenen −4,8 XTS");
    act(() => vi.advanceTimersByTime(1100));
    expect(text('.goalbar [role="status"]')).toBe(
      "Lücke im Zentralhaushalt: 95 XTS gedeckt, es fehlen noch 5,2 XTS. Zugleich werden die übrigen Ebenen um 4,8 XTS belastet. Spanne +46 XTS bis +95 XTS",
    );
  });

  it("stands in the one line of the bar above the curve editor", () => {
    // The edited measure is off: what is on is the measure that moves cost to the provinces.
    mount("#lang=en&s=no_basic_income_non_citizens&e=redraw_income_tax.tariff");
    expect(query(".goalbar").classList.contains("goalbar--steady")).toBe(true);
    expect(chip()).toBe("Other levels −XTS 4.8");
  });

  it("is set out level by level in the details", async () => {
    mount("#lang=en&s=no_basic_income_non_citizens");
    click(query(".goalbar__more"));
    const rows = [...container.querySelectorAll(".goaldetails__levels li")].map((row) => plain(row.textContent));
    expect(rows).toEqual(["Central government+XTS 95Relief", "Provinces−XTS 4.8Burden", "Social insuranceunchanged", "Whole state+XTS 90"]);
    expect(container.querySelector(".goaldetails__levels li.is-goal")?.textContent).toContain("Central government");
  });

  it("is not in the details without measures, nor for a whole-state goal", async () => {
    mount("#lang=en");
    click(query(".goalbar__more"));
    // The details are there, without the levels.
    expect(container.querySelector(".goaldetails")).not.toBeNull();
    expect(container.querySelector(".goaldetails__levels")).toBeNull();
    mount("#lang=en&g=close_deficit&s=no_basic_income_non_citizens");
    click(query(".goalbar__more"));
    expect(container.querySelector(".goaldetails")).not.toBeNull();
    expect(container.querySelector(".goaldetails__levels")).toBeNull();
  });
});
