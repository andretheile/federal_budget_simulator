// @vitest-environment jsdom
/**
 * Mounts the whole interface on the Testland fixture and uses it the way a visitor would:
 * through the switch, the slider and the level filter, reading what the page then says.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ONE_COLUMN, Simulator } from "./App.tsx";
import { testland } from "./engine/__fixtures__/testland.ts";

// Every test here renders the whole page, most of them several times: a fraction of a second on a
// quiet machine, but past vitest's 5 s when other programs keep the processor busy.
vi.setConfig({ testTimeout: 20_000 });

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no canvas; the bar labels then simply stay out.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

/** A fresh in-memory localStorage per test; the one of the test environment is not reliable across Node versions. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(hash = ""): void {
  if (hash) window.history.replaceState(null, "", hash);
  root = createRoot(container);
  act(() => root.render(<Simulator pack={testland} />));
}

const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const text = (selector: string): string => (query(selector).textContent ?? "").replace(/[  ]/g, " ");
/** The headline figure as screen readers get it: the final value, not a frame of the animation. */
const headline = (): string => text(".scoreboard__number [data-final-value]");
const click = (selector: string): void => act(() => query(selector).click());

describe("the simulator on Testland", () => {
  it("shows today's balance and changes it when a measure is switched on", () => {
    mount("#lang=en");
    expect(headline()).toBe("−XTS 400");
    expect(text('[data-testid="balance-state"]')).toBe("Deficit");
    expect(text(".scoreboard__change")).toContain("No measure is switched on");

    const toggle = '#policy-halve_mp_pay [role="switch"]';
    expect(query(toggle).getAttribute("aria-checked")).toBe("false");
    click(toggle);

    expect(query(toggle).getAttribute("aria-checked")).toBe("true");
    expect(headline()).toBe("−XTS 395");
    expect(text(".scoreboard__change")).toContain("+XTS 5");
    expect(text(".scoreboard__change")).toContain("1 measure switched on");
    // The scenario is in the address, without a new history entry.
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay");
    // And the waterfall names the measure between today and the simulated balance.
    expect(text(".wf")).toContain("Halve MPs' pay");
    expect(text(".wf")).toContain("Simulated");

    click(toggle);
    expect(headline()).toBe("−XTS 400");
    expect(window.location.hash).toBe("#lang=en");
  });

  it("restores a scenario and the language from the address", () => {
    mount("#lang=de&s=defense_target.share.4~family_bonus");
    expect(document.documentElement.lang).toBe("de");
    expect(text('[data-testid="balance-state"]')).toBe("Defizit");
    // 400 deficit, defence 200 -> 400 and family bonus +100.
    expect(headline()).toBe("−700 XTS");
    expect(query('#policy-defense_target [role="switch"]').getAttribute("aria-checked")).toBe("true");
    expect(query('#policy-cut_admin [role="switch"]').getAttribute("aria-checked")).toBe("false");
  });

  it("names the pack's base year as the pack does, and puts a country chosen on the page in the address", () => {
    root = createRoot(container);
    act(() => root.render(<Simulator pack={testland} countries={["xx", "yy"]} />));
    expect(text(".masthead__country")).toBe("Testland, budget year 2024 (April 2024 to March 2025)");
    // A first visit to the bare address leaves it bare.
    expect(window.location.hash).toBe("");
    act(() => root.unmount());
    // After the switch the new country's page writes its address at once, so a reload stays there.
    root = createRoot(container);
    act(() => root.render(<Simulator pack={testland} countries={["xx", "yy"]} countrySwitched />));
    expect(window.location.hash).toMatch(/^#c=xx&lang=[a-z]+$/);
  });

  it("says so when a pack has no measures yet, and leaves out the waterfall", () => {
    window.history.replaceState(null, "", "#lang=en");
    root = createRoot(container);
    act(() => root.render(<Simulator pack={{ ...testland, policies: [], collections: undefined, goals: undefined }} />));
    expect(text("#measures")).toContain("No measures have been added for this country yet.");
    expect(container.querySelector("#what-changed")).toBeNull();
    expect(text(".scoreboard__change")).toContain("No measure is switched on");
  });

  it("previews a setting on the card before the measure is switched on, then applies it", () => {
    mount("#lang=en");
    click("#policy-cut_admin .policy__more");
    const slider = query<HTMLInputElement>("#cut_admin-cut");
    expect(slider.getAttribute("aria-valuetext")).toBe("10%");
    expect(text("#policy-cut_admin .policy__amount")).toContain("+XTS 40");

    // React listens for the native input event; set the value the way a browser does.
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "25");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(text("#policy-cut_admin .policy__amount")).toContain("+XTS 100");
    expect(headline()).toBe("−XTS 400");

    click('#policy-cut_admin [role="switch"]');
    expect(headline()).toBe("−XTS 300");
    expect(window.location.hash).toBe("#lang=en&s=cut_admin.cut.25");
  });

  it("shows a blocker where nobody can miss it, on the card and among the catches", () => {
    mount("#lang=en");
    const card = "#policy-no_basic_income_non_citizens";
    expect(text(`${card} .catch-tag--blocker`)).toContain("Blocker: legal");
    click(`${card} .policy__more`);
    expect(text(`${card} .catch--blocker`)).toContain("The constitution guarantees a subsistence minimum.");
    expect(text(`${card} .catch--blocker .catch__severity`)).toBe("Blocker");
    // The range of the estimate and its quality are stated.
    expect(text(`${card} .facts`)).toContain("+XTS 36 to +XTS 90");
    expect(text(`${card} .facts`)).toContain("Estimate");
  });

  it("shows the change, not a balance, for a single level of government", () => {
    mount("#lang=en&s=defense_target~L.central");
    expect(text(".scoreboard__label")).toBe("Central government: change compared with 2024");
    expect(headline()).toBe("−XTS 100");
    expect(text('[data-testid="balance-state"]')).toBe("Burden");
    expect(text(".scoreboard__change")).toContain("No balance is shown for a single level");
    expect(container.querySelector(".scoreboard__ratios")).toBeNull();
    expect(container.querySelector(".bar__gap-label")).toBeNull();
  });

  it("switches language without losing the scenario", () => {
    mount("#lang=en&s=halve_mp_pay");
    expect(document.documentElement.lang).toBe("en");
    click('.langs button[lang="de"]');
    expect(document.documentElement.lang).toBe("de");
    expect(text(".masthead__name")).toBe("Haushaltssimulator");
    expect(text('[data-testid="balance-state"]')).toBe("Defizit");
    expect(headline()).toBe("−395 XTS");
    expect(window.location.hash).toBe("#lang=de&s=halve_mp_pay");
    expect(window.localStorage.getItem("budget-simulator:language")).toBe("de");
  });

  it("drills from a block of the bar into its items and marks what a measure changed", () => {
    mount("#lang=en&s=family_bonus");
    // The list starts on the largest spending category.
    expect(text(".detail__title")).toBe("Social protection");
    const rows = [...container.querySelectorAll(".rows .row")];
    expect(rows.map((row) => row.querySelector(".row__label")?.textContent)).toEqual([
      "Pensions",
      "Basic income support",
      "Family benefits",
    ]);
    expect(rows[2].classList.contains("is-changed")).toBe(true);
    expect((rows[2].textContent ?? "").replace(/[  ]/g, " ")).toContain("+XTS 100");
    expect(rows[0].classList.contains("is-changed")).toBe(false);

    // Another category through its legend entry, which is the keyboard path.
    const admin = [...container.querySelectorAll<HTMLButtonElement>(".legend__item")].find((item) =>
      item.textContent?.includes("Administration"),
    );
    act(() => admin!.click());
    expect(text(".detail__title")).toBe("Administration");
    expect([...container.querySelectorAll(".rows .row__label")].map((label) => label.textContent)).toEqual([
      "Other administration",
      "Parliament",
    ]);
  });
});

describe("details that depend on the engine of the browser or the size of the screen", () => {
  it("puts the label of the waterfall's zero line on the side where there is room", () => {
    // All levels, a deficit: zero is at the right end of the scale, the label stands left of it.
    mount("#lang=en");
    expect(query(".wf__zero-label").className).toContain("is-left");
    act(() => root.unmount());

    // One level, a relief: the scale starts at zero, the label stands right of the line. Centred
    // on it, half the label would be outside the plot, which on a phone is outside the screen.
    mount("#lang=en&s=cut_admin~L.central");
    expect(text('[data-testid="balance-state"]')).toBe("Relief");
    expect(query<HTMLElement>(".wf__zero-label").style.left).toBe("0%");
    expect(query(".wf__zero-label").className).toContain("is-right");
  });

  it("keeps the focus mark on the level bar while it is worked with the arrow keys", () => {
    mount("#lang=en");
    const bar = query(".levelbar");
    const option = query<HTMLInputElement>(".levelbar__option input");
    expect(bar.classList.contains("is-keyboard")).toBe(false);
    act(() => option.focus());
    act(() => void option.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(bar.classList.contains("is-keyboard")).toBe(true);
    // A click with the mouse, or leaving the bar, ends it.
    act(() => void option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })));
    expect(bar.classList.contains("is-keyboard")).toBe(false);
    act(() => void option.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(bar.classList.contains("is-keyboard")).toBe(true);
    act(() => option.blur());
    expect(bar.classList.contains("is-keyboard")).toBe(false);
  });

  describe("the order of measures and budget", () => {
    /** A window of this width: media queries answered the way the browser would. */
    function widthOf(width: number, motion: "reduce" | "no-preference" = "no-preference"): void {
      const answer = (media: string): boolean => {
        if (media.includes("prefers-reduced-motion")) return motion === "reduce";
        const max = /max-width:\s*(\d+)px/.exec(media);
        const min = /min-width:\s*(\d+)px/.exec(media);
        return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
      };
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (media: string) => ({ matches: answer(media), media, addEventListener() {}, removeEventListener() {} }),
      });
    }
    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia;
    });
    /** The parts of the workspace from top to bottom, and whether the line to the debt section stands before it. */
    const order = (): { parts: string[]; teaserFirst: boolean } => ({
      parts: [...query(".workspace").children].map((element) => element.classList[0]),
      teaserFirst: query(".workspace").previousElementSibling?.classList.contains("debt-teaser") ?? false,
    });

    it("puts the measures first where the page has one column: on a phone and on a tablet", () => {
      expect(ONE_COLUMN).toBe("(max-width: 1079px)");
      for (const width of [390, 768, 1079]) {
        widthOf(width);
        mount("#lang=en");
        // The row of sections in the band leads to the debt section; no line to it in the page.
        expect(order()).toEqual({ parts: ["policies", "budget"], teaserFirst: false });
        expect(container.querySelector(".debt-teaser")).toBeNull();
        act(() => root.unmount());
      }
      mount("#lang=en");
    });

    it("puts the budget beside the measures, first, where the page has two columns", () => {
      for (const width of [1080, 1440]) {
        widthOf(width);
        mount("#lang=en");
        expect(order()).toEqual({ parts: ["budget", "policies"], teaserFirst: true });
        // Beside each other, measures and budget need no row of sections.
        expect(container.querySelector(".sectionnav")).toBeNull();
        act(() => root.unmount());
      }
      mount("#lang=en");
    });

    describe("the row of sections (one column)", () => {
      /** Where the window was asked to scroll to. */
      let scrolled: ScrollToOptions[];
      beforeEach(() => {
        scrolled = [];
        window.scrollTo = ((options: ScrollToOptions) => void scrolled.push(options)) as typeof window.scrollTo;
      });
      const links = (): HTMLAnchorElement[] => [...container.querySelectorAll<HTMLAnchorElement>(".sectionnav a")];

      it("is a named navigation landmark in the band, with the measures, the budget and the debt section", () => {
        widthOf(390);
        mount("#lang=en");
        const nav = query(".scoreboard__band nav.sectionnav");
        expect(nav.getAttribute("aria-label")).toBe("Sections");
        expect(links().map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
          ["Measures", "#measures"],
          ["Budget", "#budget"],
          ["Debt", "#debt"],
        ]);
        // Each leads to a section that exists and can take the focus.
        for (const id of ["measures", "budget", "debt"]) expect(query(`#${id}`).tabIndex).toBe(-1);
        act(() => root.unmount());
        widthOf(768);
        mount("#lang=de");
        expect(query("nav.sectionnav").getAttribute("aria-label")).toBe("Abschnitte");
        expect(links().map((link) => link.textContent)).toEqual(["Maßnahmen", "Haushalt", "Schulden"]);
      });

      it("jumps to a section without touching the address, gives it the focus and marks it as the current one", () => {
        widthOf(390);
        mount("#lang=en&s=halve_mp_pay");
        const before = window.location.hash;
        const budget = links()[1];
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        act(() => void budget.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(true);
        expect(window.location.hash).toBe(before);
        expect(document.activeElement).toBe(query("#budget"));
        expect(budget.getAttribute("aria-current")).toBe("location");
        expect(links().filter((link) => link.hasAttribute("aria-current"))).toHaveLength(1);
        // Smoothly where motion is welcome.
        expect(scrolled.at(-1)?.behavior).toBe("smooth");
      });

      it("does not scroll smoothly where the visitor asks for less motion", () => {
        widthOf(390, "reduce");
        mount("#lang=en");
        act(() => links()[2].click());
        expect(scrolled.at(-1)?.behavior).toBe("auto");
        expect(document.activeElement).toBe(query("#debt"));
      });

      it("is not there while the curve editor lies over the page", () => {
        widthOf(390);
        mount("#lang=en&e=redraw_income_tax.tariff");
        expect(container.querySelector(".sheet")).not.toBeNull();
        expect(container.querySelector(".sectionnav")).toBeNull();
      });
    });
  });
});

describe("a rate curve on a card", () => {
  it("has no slider in the settings, but its own way into the editor", () => {
    // The fixture's income tax measure has one parameter, a rate curve. The card counts no
    // setting for it in its details and offers the editor instead.
    mount("#lang=en");
    const card = "#policy-redraw_income_tax";
    expect(text(`${card} .policy__more`)).toBe("Details: Redraw the income tax");
    expect(text(`${card} .policy__edit`)).toBe("Edit curve: Redraw the income tax");
    const before = headline();
    click(`${card} [role="switch"]`);
    expect(headline()).not.toBe(before);
    click(`${card} .policy__more`);
    expect(container.querySelector(`${card} .policy__panel .param`)).toBeNull();
    expect(text(`${card} .policy__panel`)).not.toContain("Settings");
    expect(text(`${card} .policy__panel`)).toContain("Where it shows in the budget");
  });

  it("shows a display unit of the pack on a slider instead of the generic one", () => {
    mount("#lang=en");
    click("#policy-family_bonus .policy__more");
    const slider = query<HTMLInputElement>("#family_bonus-amount");
    expect(slider.getAttribute("aria-valuetext")?.replace(/[\u00a0\u202f]/g, " ")).toBe("2 XTS per household");
    expect(text("#policy-family_bonus .param__value")).toBe("2 XTS per household");
  });
});

describe("the address while a value changes fast", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // 31 clicks, each of which renders the whole page again.
  it("is written at most a few dozen times in ten seconds, and always ends on the last state", { timeout: 30_000 }, () => {
    // Safari throws after about 100 calls of replaceState in ten seconds; a drag can change the
    // scenario a hundred times in a few seconds. The budget itself, over ten seconds of changes,
    // is tested on a clock moved by hand in addressWriter.test.ts; here: that the page uses it.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    mount("#lang=en");
    const replace = vi.spyOn(window.history, "replaceState");
    const toggle = '#policy-halve_mp_pay [role="switch"]';
    // More changes at once than the budget allows (25).
    for (let i = 0; i < 31; i++) click(toggle);
    expect(replace.mock.calls.length).toBeLessThanOrEqual(25);
    expect(headline()).toBe("−XTS 395");
    // The latest state follows within a moment.
    act(() => void vi.advanceTimersByTime(150));
    expect(window.location.hash).toBe("#lang=en&s=halve_mp_pay");
    // After a pause, writes go straight through again.
    act(() => void vi.advanceTimersByTime(5_000));
    click(toggle);
    expect(window.location.hash).toBe("#lang=en");
  });

  it("does not take the page down when the browser refuses to write it", () => {
    mount("#lang=en");
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new DOMException("Attempt to use history.replaceState() more than 100 times per 10 seconds", "SecurityError");
    });
    click('#policy-halve_mp_pay [role="switch"]');
    expect(headline()).toBe("−XTS 395");
  });
});

describe("sharing the link", () => {
  const share = ".masthead__tools .tool";
  const press = (selector: string): Promise<void> => act(async () => query(selector).click());
  const setClipboard = (value: unknown): void => {
    Object.defineProperty(navigator, "clipboard", { value, configurable: true });
  };
  const setExecCommand = (value: unknown): void => {
    Object.defineProperty(document, "execCommand", { value, configurable: true });
  };

  afterEach(() => {
    setClipboard(undefined);
    setExecCommand(undefined);
  });

  it("copies the address of the scenario and says so on the button", async () => {
    const written: string[] = [];
    setClipboard({ writeText: (value: string) => (written.push(value), Promise.resolve()) });
    mount("#lang=en&s=halve_mp_pay");
    await press(share);
    expect(written).toEqual([`${window.location.origin}/#lang=en&s=halve_mp_pay`]);
    expect(text(share)).toBe("Link copied");
    expect(text(".masthead__status")).toBe("Link copied");
    expect(container.querySelector(".sharebox")).toBeNull();
  });

  it("falls back to copying a selection where the clipboard is not available or refuses", async () => {
    const copied: string[] = [];
    setExecCommand((command: string) => {
      // What a browser would copy: the selection in the helper field.
      const field = document.querySelector<HTMLTextAreaElement>("body > textarea")!;
      if (command === "copy") copied.push(field.value.slice(field.selectionStart, field.selectionEnd));
      return true;
    });
    for (const clipboard of [undefined, { writeText: () => Promise.reject(new Error("not allowed")) }]) {
      setClipboard(clipboard);
      mount("#lang=en&s=halve_mp_pay");
      act(() => query(share).focus());
      await press(share);
      expect(copied.pop()).toBe(`${window.location.origin}/#lang=en&s=halve_mp_pay`);
      expect(text(share)).toBe("Link copied");
      // The helper field is gone and the keyboard focus is back on the button.
      expect(document.querySelectorAll("body > textarea")).toHaveLength(0);
      expect(document.activeElement).toBe(query(share));
      act(() => root.unmount());
    }
    mount();
  });

  it("hands over the link itself when the browser will not copy at all", async () => {
    setClipboard({ writeText: () => Promise.reject(new Error("not allowed")) });
    setExecCommand(() => {
      throw new Error("blocked");
    });
    mount("#lang=en&s=halve_mp_pay");
    await press(share);
    // Said for everyone, announced for screen readers, and the link is there, focused and selected.
    expect(text(".sharebox p")).toContain("Copying did not work");
    expect(text(".masthead__status")).toContain("Copying did not work");
    const field = query<HTMLInputElement>(".sharebox input");
    expect(field.value).toBe(`${window.location.origin}/#lang=en&s=halve_mp_pay`);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    expect(document.querySelectorAll("body > textarea")).toHaveLength(0);

    // It stays, and keeps up with the scenario, until the visitor closes it.
    click('#policy-cut_admin [role="switch"]');
    expect(query<HTMLInputElement>(".sharebox input").value).toBe(window.location.href);
    expect(window.location.hash).toContain("cut_admin");
    click(".sharebox__close");
    expect(container.querySelector(".sharebox")).toBeNull();
    expect(document.activeElement).toBe(query(share));

    // Escape closes it as well.
    await press(share);
    act(
      () =>
        void query(".sharebox input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.querySelector(".sharebox")).toBeNull();
  });
});

describe("the explanation of a block in the budget bars", () => {
  /** The floating explanation; it is drawn in a layer of its own, outside the app's container. */
  const tip = (): string | null => document.querySelector(".tip")?.textContent?.replace(/[  ]/g, " ") ?? null;
  const pointer = (target: Element, type: string, pointerType: string): void =>
    act(() => void target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType })));
  /** What a browser sends for a tap: the finger arrives, presses, lifts and is gone again, then the click. */
  const tap = (target: HTMLElement): void => {
    for (const type of ["pointerover", "pointerdown", "pointerup", "pointerout"]) pointer(target, type, "touch");
    act(() => target.click());
  };
  const block = (side: string, index: number): HTMLElement =>
    container.querySelectorAll<HTMLElement>(`.bar--${side} .seg`)[index];

  it("opens on a tap and stays until the next tap elsewhere", () => {
    mount("#lang=en");
    expect(tip()).toBeNull();
    const first = block("expenditure", 0);
    tap(first);
    // The tap opens the block in the list, as before, and now also says what the block is.
    expect(text(".detail__title")).toBe("Social protection");
    expect(tip()).toContain("Social protection");
    expect(tip()).toContain("of spending");
    expect(first.classList.contains("is-active")).toBe(true);

    // Another block: the explanation moves there, and there is only one.
    tap(block("revenue", 0));
    expect(document.querySelectorAll(".tip")).toHaveLength(1);
    expect(tip()).toContain("of revenue");

    // A legend entry works the same way, also where a tap does not focus a button (Safari).
    const entry = [...container.querySelectorAll<HTMLButtonElement>(".bar--expenditure .legend__item")].find((item) =>
      item.textContent?.includes("Administration"),
    )!;
    tap(entry);
    expect(tip()).toContain("Administration");

    pointer(query(".masthead__name"), "pointerdown", "touch");
    expect(tip()).toBeNull();
  });

  it("follows the mouse without staying after a click", () => {
    mount("#lang=en");
    const first = block("expenditure", 0);
    pointer(first, "pointerover", "mouse");
    expect(tip()).toContain("Social protection");
    pointer(first, "pointerdown", "mouse");
    act(() => first.click());
    expect(tip()).toContain("Social protection");
    pointer(first, "pointerout", "mouse");
    expect(tip()).toBeNull();
  });

  it("opens on keyboard focus of a legend entry and closes on Escape", () => {
    mount("#lang=en");
    const entry = query<HTMLButtonElement>(".bar--revenue .legend__item");
    act(() => entry.focus());
    expect(tip()).toContain("of revenue");
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(tip()).toBeNull();
    act(() => entry.blur());
    act(() => entry.focus());
    expect(tip()).toContain("of revenue");
    act(() => entry.blur());
    expect(tip()).toBeNull();
  });
});
