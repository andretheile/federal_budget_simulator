// @vitest-environment jsdom
/**
 * What a measure's card says about effects that are passed on to another item, about effects that
 * vary together, and about an effect of nothing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { testland, testlandCopy, testlandManyEffects, testlandTimed } from "../engine/__fixtures__/testland.ts";
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
    expect(plain(figure.textContent)).toContain("changes neither revenue nor spending");
    expect(plain(figure.textContent)).not.toContain("improves");
    expect(plain(figure.textContent)).not.toContain("spends");
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
      (element) => plain(element.querySelector("h5")?.textContent) === "Wann sie wirkt",
    );
    expect(section).toBeDefined();
    expect(plain(section!.querySelector(".policy__timing-detail")?.textContent)).toBe(
      // The wealth tax's timing has no slider: no "at this setting".
      "In der Rechnung zu Schulden und Zinsen wirkt die Maßnahme ab 2028.",
    );
    expect(plain(section!.querySelector(".policy__timing-note")?.textContent)).toBe("Die erste Veranlagung ist für 2028.");
    expect(section!.querySelector(".sources")).not.toBeNull();
  });
});

describe("a central estimate whose range reaches the other side of zero", () => {
  /** Halving MPs' pay (+5) with an estimate between −5 and +10. */
  function crossing(): CountryPack {
    const pack = testlandCopy();
    const policy = pack.policies.find((candidate) => candidate.id === "halve_mp_pay")!;
    for (const effect of policy.effects) effect.uncertainty = { low: -1, high: 2 };
    return pack;
  }

  it("says so on the card, with the range, not only in the details", () => {
    mount("#lang=de", crossing());
    expect(text("#policy-halve_mp_pay .policy__direction")).toBe("verbessert den Saldo");
    expect(text("#policy-halve_mp_pay .policy__crosses")).toBe("Spanne −5 XTS bis +10 XTS: Je nach Schätzung kann die Maßnahme den Saldo auch verschlechtern.");
    act(() => root?.unmount());
    mount("#lang=en&s=L.central", crossing());
    expect(text("#policy-halve_mp_pay .policy__crosses")).toBe("Range −XTS 5 to +XTS 10: depending on the estimates, the measure may also burden this level.");
  });

  it("is not mentioned where the range stays on one side", () => {
    mount("#lang=en");
    expect(container.querySelector(".policy__crosses")).toBeNull();
  });
});

describe("the timing line at a setting that changes nothing", () => {
  it("is empty but keeps its room", () => {
    // The defence target at its baseline of 2 % changes nothing.
    mount("#lang=en&s=defense_target.share.2", testlandTimed());
    const timing = query("#policy-defense_target .policy__timing");
    expect(text("#policy-defense_target .policy__amount")).toBe("XTS 0");
    expect(timing.querySelector("span:not(.policy__stand-in)")).toBeNull();
    expect(timing.querySelectorAll(".policy__stand-in").length).toBeGreaterThan(0);
  });
});

describe("the card's texts in their places", () => {
  const BASIC = "#policy-no_basic_income_non_citizens";
  /** The headings of the opened card's sections, in order. */
  const headings = (card: string): string[] => all(`${card} .policy__section > h5`);
  /** Testland with a summary of `length` characters on halving MPs' pay, in both languages. */
  function withSummary(length: number): CountryPack {
    const pack = testlandCopy();
    const policy = pack.policies.find((candidate) => candidate.id === "halve_mp_pay")!;
    const words = (start: string): string => (start + " " + "word ".repeat(60)).slice(0, length - 1).trimEnd().padEnd(length - 1, "x") + ".";
    policy.summary = { en: words("Members of parliament get half"), de: words("Abgeordnete bekommen die Hälfte") };
    return pack;
  }

  it("shows a short summary on the face whole, and cuts a long one to two lines until the card is opened", () => {
    mount("#lang=en");
    expect(query("#policy-halve_mp_pay .policy__summary").classList.contains("is-clamped")).toBe(false);
    act(() => root?.unmount());
    // 200 characters still stand whole; 201 are cut, as every summary used to be.
    mount("#lang=en", withSummary(200));
    expect(text("#policy-halve_mp_pay .policy__summary")).toHaveLength(200);
    expect(query("#policy-halve_mp_pay .policy__summary").classList.contains("is-clamped")).toBe(false);
    act(() => root?.unmount());
    mount("#lang=de", withSummary(201));
    const summary = query("#policy-halve_mp_pay .policy__summary");
    expect(summary.classList.contains("is-clamped")).toBe(true);
    expand("#policy-halve_mp_pay");
    expect(summary.classList.contains("is-clamped")).toBe(false);
  });

  it("puts the explanation at the top of the opened card, in paragraphs, before the settings", () => {
    mount("#lang=en");
    expect(container.querySelector(`${BASIC} .policy__explanation`)).toBeNull();
    expand(BASIC);
    const panel = query(`${BASIC} .policy__panel`);
    const explanation = query(`${BASIC} .policy__explanation`);
    expect(panel.firstElementChild).toBe(explanation);
    expect([...explanation.querySelectorAll("p")].map((paragraph) => plain(paragraph.textContent))).toEqual([
      "The figure is the spending on the selected groups, less the fifth that stays as emergency aid.",
      "Choose the groups under the settings; each adds its share of the spending.",
    ]);
    expect(headings(BASIC)[0]).toBe("Settings");
    // The face keeps the summary alone.
    expect(text(`${BASIC} .policy__summary`)).toBe("The selected groups lose the benefit.");
    act(() => root?.unmount());
    mount("#lang=de");
    expand(BASIC);
    expect(text(`${BASIC} .policy__explanation p`)).toBe("Die Zahl sind die Ausgaben für die gewählten Gruppen, abzüglich des Fünftels, das als Nothilfe bleibt.");
    // A measure without one opens with its settings, as before.
    expand("#policy-cut_admin");
    expect(container.querySelector("#policy-cut_admin .policy__explanation")).toBeNull();
    expect(query("#policy-cut_admin .policy__panel").firstElementChild?.querySelector("h5")?.textContent).toBe("Einstellungen");
  });

  it("lists the limits of the calculation under their own heading after the catches, with their sources", () => {
    mount("#lang=en");
    expand(BASIC);
    expect(headings(BASIC).slice(-4)).toEqual(["The catch", "Limits of the calculation", "Where it shows in the budget", "Sources"]);
    const limits = [...container.querySelectorAll(`${BASIC} .limit`)];
    expect(limits.map((limit) => plain(limit.querySelector(".limit__text")?.textContent))).toEqual([
      "Recipients who leave the country are not counted.",
      "Administration costs stay as they are.",
    ]);
    expect(plain(limits[0].querySelector(".sources")?.textContent)).toContain("Statistical yearbook");
    expect(limits[1].querySelector(".sources")).toBeNull();
    // They are not catches: no severity, and the catches keep their own list.
    expect(container.querySelectorAll(`${BASIC} .catch`)).toHaveLength(2);
    expect(limits.every((limit) => limit.querySelector(".catch__severity") === null)).toBe(true);
    act(() => root?.unmount());
    mount("#lang=de");
    expand(BASIC);
    expect(headings(BASIC)).toContain("Grenzen der Rechnung");
    expect(text(`${BASIC} .limit__text`)).toBe("Empfänger, die das Land verlassen, sind nicht gerechnet.");
    // A measure without limits has no such section.
    expand("#policy-halve_mp_pay");
    expect(headings("#policy-halve_mp_pay")).not.toContain("Grenzen der Rechnung");
  });

  it("counts only the catches on the face, not the limits", () => {
    const pack = testlandCopy();
    const policy = pack.policies.find((candidate) => candidate.id === "halve_mp_pay")!;
    policy.limits = [
      { text: { en: "Pensions of former members are left out.", de: "Ruhegehälter früherer Abgeordneter sind nicht gerechnet." } },
      { text: { en: "Staff of the members stay.", de: "Die Mitarbeiter der Abgeordneten bleiben." } },
    ];
    mount("#lang=en", pack);
    expect(text("#policy-halve_mp_pay .policy__catches")).toBe("1 catch");
    act(() => root?.unmount());
    mount("#lang=de", pack);
    expect(text("#policy-halve_mp_pay .policy__catches")).toBe("1 Haken");
  });
});

describe("the line under a choice of groups", () => {
  const BASIC = "#policy-no_basic_income_non_citizens";
  const line = (): string => all(`${BASIC} .param--groups .param__note`)[0];

  it("says what the selection stands for, whatever the chips are", () => {
    mount("#lang=en");
    expand(BASIC);
    expect(line()).toBe("The selection accounts for 30.0% of spending in “Basic income support”.");
    act(() => query(`${BASIC} .chip[aria-pressed="false"]`).click());
    expect(line()).toBe("The selection accounts for 90.0% of spending in “Basic income support”.");
    act(() => root?.unmount());
    // Chips of levels of government read the same way: no "groups" in the sentence.
    const pack = testlandCopy();
    // Changed before anything reads the pack: the engine keeps an index of it once it has looked.
    const social = pack.budget.expenditure[0];
    if (!("children" in social)) throw new Error("exp.social has no children");
    const node = social.children[1];
    expect(node.id).toBe("exp.social.basic_income");
    node.breakdowns!.citizenship.groups = [
      { id: "central", label: { en: "Central government", de: "Zentralstaat" }, share: 0.3 },
      { id: "provinces", label: { en: "Provinces", de: "Provinzen" }, share: 0.7 },
    ];
    const policy = pack.policies.find((candidate) => candidate.id === "no_basic_income_non_citizens")!;
    (policy.params[0] as { default: string[] }).default = ["central"];
    mount("#lang=de", pack);
    expand(BASIC);
    expect(all(`${BASIC} .chip`)).toEqual(["ZentralstaatAnteil 30,0 %", "ProvinzenAnteil 70,0 %"]);
    expect(line()).toBe("Auf die Auswahl entfallen 30,0 % der Ausgaben im Posten „Grundsicherung“.");
    act(() => query(`${BASIC} .chip[aria-pressed="true"]`).click());
    expect(line()).toBe("Nichts ist ausgewählt. Diese Einstellung hat so keine Wirkung.");
  });
});

describe("the notes of the sources", () => {
  /** The note of a source in the list of all sources under "About the numbers". */
  const note = (id: string): string | null => container.querySelector(`#source-${id} .sources__note`)?.textContent ?? null;

  it("are in the language shown where the pack translates them, and as written where it does not", () => {
    mount("#lang=en");
    expect(note("tax_statistics")).toBe("Table 3, taxable income by bracket.");
    expect(note("wealth_survey")).toBe("The top of the distribution is extrapolated.");
    act(() => root?.unmount());
    mount("#lang=de");
    expect(note("tax_statistics")).toBe("Tabelle 3, zu versteuerndes Einkommen nach Stufen.");
    // A plain note is shown in every language, as before.
    expect(note("wealth_survey")).toBe("The top of the distribution is extrapolated.");
    // The title stays in the source's own language.
    expect(container.querySelector("#source-tax_statistics a")?.textContent).toContain("Income tax statistics");
  });

  it("fall back to English where the language shown is missing", () => {
    const pack = testlandCopy();
    pack.sources.tax_statistics.note = { en: "Table 3, taxable income by bracket." };
    mount("#lang=de", pack);
    expect(note("tax_statistics")).toBe("Table 3, taxable income by bracket.");
  });
});

describe("a measure with many effects", () => {
  const MANY = "#policy-many_cuts";
  /** Each group: its head as shown, and the items it lists. */
  const groups = (): { head: string; items: string[] }[] =>
    [...container.querySelectorAll(`${MANY} .effect-group`)].map((group) => ({
      head: plain(group.querySelector(".effect-group__head")?.textContent),
      items: [...group.querySelectorAll(".effects:not([hidden]) > .effect .effect__node")].map((node) => plain(node.textContent)),
    }));

  it("groups them by the setting that drives them, with what each group does to the balance, the largest first", () => {
    mount("#lang=en", testlandManyEffects().pack);
    expand(MANY);
    expect(groups()).toEqual([
      { head: "Staff cut+XTS 150 improves the balance", items: ["Education", "Family benefits", "Health"] },
      { head: "Pay cut+XTS 30 improves the balance", items: ["Other administration", "Parliament"] },
      { head: "Not tied to a setting−XTS 3 worsens the balance", items: ["Health"] },
    ]);
  });

  it("keeps the rest one step away, with how many and how much, and shows every one of them on request", () => {
    mount("#lang=en", testlandManyEffects().pack);
    expand(MANY);
    const more = query<HTMLButtonElement>(`${MANY} .effects__more`);
    expect(plain(more.textContent)).toBe("Show 2 more items (together +XTS 30 for the balance)");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const rest = query(`#${CSS.escape(more.getAttribute("aria-controls")!)}`);
    expect(rest.hidden).toBe(true);
    act(() => more.click());
    expect(rest.hidden).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(plain(more.textContent)).toBe("Show fewer items");
    expect(groups()[0].items).toEqual(["Education", "Family benefits", "Health", "Defence", "Other administration"]);
    // Every effect keeps its line, range and note there.
    expect(container.querySelectorAll(`${MANY} .effect`)).toHaveLength(8);
    act(() => more.click());
    expect(groups()[0].items).toHaveLength(3);
    act(() => root?.unmount());
    mount("#lang=de", testlandManyEffects().pack);
    expand(MANY);
    expect(text(`${MANY} .effects__more`)).toBe("2 weitere Posten zeigen (zusammen +30 XTS für den Saldo)");
  });

  it("follows the sliders in its amounts, not in its order", () => {
    mount("#lang=en&s=many_cuts.staff.1.pay.20", testlandManyEffects().pack);
    expand(MANY);
    expect(groups()[0]).toEqual({ head: "Staff cut+XTS 15 improves the balance", items: ["Education", "Family benefits", "Health"] });
    // 40 from other administration, and parliament's whole 10 (a cut of 20 there stops at zero).
    expect(groups()[1].head).toBe("Pay cut+XTS 50 improves the balance");
  });

  it("leaves a measure with few effects as it was: one list, in the pack's order", () => {
    mount("#lang=en");
    expand(INSURE);
    expect(container.querySelector(`${INSURE} .effect-group`)).toBeNull();
    expect(container.querySelector(`${INSURE} .effects__more`)).toBeNull();
  });
});

/**
 * Which side of the budget a measure acts on, and what it does there: in words on the card, not by
 * colour. Testland's revenue is 4,000, its spending 4,400, its population 100.
 */
describe("the two sides of the budget on the card", () => {
  const what = (card: string): string => text(`${card} .policy__what`);
  const tags = (card: string): string => text(`${card} .policy__topic`);
  const proportion = (card: string): string | null => {
    const line = container.querySelector(`${card} .policy__proportion`);
    return line ? plain(line.textContent) : null;
  };

  it("names the side after the topic, from the pack: revenue, spending, or both", () => {
    mount("#lang=en");
    // The dot is only for the eye; screen readers hear a comma.
    expect(tags("#policy-wealth_tax")).toBe("Taxes · , Revenue");
    expect(tags("#policy-family_bonus")).toBe("Social policy · , Spending");
    expect(tags(INSURE)).toBe("Pensions · , Revenue, spending");
    // Bound to the topic by a no-break space: where the line breaks, the side goes whole onto the next one.
    expect(query(`#policy-wealth_tax .policy__topic [aria-hidden="true"]`).textContent).toBe(" ·");
    expect(query(`#policy-wealth_tax .policy__side`).textContent).toBe("Revenue");
    act(() => root?.unmount());
    mount("#lang=de");
    expect(tags("#policy-wealth_tax")).toBe("Steuern · , Einnahmen");
    expect(tags("#policy-cut_admin")).toBe("Staat und Verwaltung · , Ausgaben");
    expect(tags(INSURE)).toBe("Rente · , Einnahmen, Ausgaben");
  });

  it("says under the figure which way the balance moves and what comes in or goes out", () => {
    const pack = testlandCopy();
    // A top rate below today's 40 %, so that the state takes in less.
    const top = pack.policies.find((candidate) => candidate.id === "raise_top_tax_rate")!.params[0] as { min: number };
    top.min = 30;
    mount("#lang=en&s=raise_top_tax_rate.top_rate.30", pack);
    expect(what("#policy-wealth_tax")).toBe("improves the balance: the state takes in more.");
    expect(what("#policy-raise_top_tax_rate")).toBe("worsens the balance: the state takes in less.");
    expect(what("#policy-cut_admin")).toBe("improves the balance: the state spends less.");
    expect(what("#policy-family_bonus")).toBe("worsens the balance: the state spends more.");
    // The direction keeps its colour class; the sentence is plain text after it.
    expect(query("#policy-cut_admin .policy__direction").className).toContain("policy__direction--improve");
    expect(text("#policy-cut_admin .policy__direction")).toBe("improves the balance");
    act(() => root?.unmount());
    mount("#lang=de&s=raise_top_tax_rate.top_rate.30", pack);
    expect(what("#policy-wealth_tax")).toBe("verbessert den Saldo: Der Staat nimmt mehr ein.");
    expect(what("#policy-raise_top_tax_rate")).toBe("verschlechtert den Saldo: Der Staat nimmt weniger ein.");
    expect(what("#policy-cut_admin")).toBe("verbessert den Saldo: Der Staat gibt weniger aus.");
    expect(what("#policy-family_bonus")).toBe("verschlechtert den Saldo: Der Staat gibt mehr aus.");
  });

  it("gives both amounts where both sides change, and no share of either side", () => {
    // Contributions of 100 in, 15 less income tax, the employer's part of 50 out: +35 for the balance.
    mount("#lang=en");
    expect(text(`${INSURE} .policy__amount`)).toBe("+XTS 35");
    expect(what(INSURE)).toBe("improves the balance: the state takes in XTS 85 more and spends XTS 50 more.");
    expect(proportion(INSURE)).not.toContain("of all");
    expect(proportion(INSURE)).toContain("per inhabitant");
    // A measure on one side keeps its share of that side.
    expect(proportion("#policy-cut_admin")).toMatch(/^[\d.]+% of all spending · /);
    act(() => root?.unmount());
    mount("#lang=de");
    expect(what(INSURE)).toBe("verbessert den Saldo: Der Staat nimmt 85 XTS mehr ein und gibt 50 XTS mehr aus.");
  });

  it("names only the side that changes, for a measure on both sides whose other side is zero at these settings", () => {
    const pack = testlandCopy();
    const insure = pack.policies.find((candidate) => candidate.id === "insure_civil_servants")!;
    // The employer's part, at nothing.
    (insure.effects[1] as { amount: unknown }).amount = 0;
    mount("#lang=en", pack);
    expect(tags(INSURE)).toBe("Pensions · , Revenue, spending");
    expect(what(INSURE)).toBe("improves the balance: the state takes in more.");
    expect(proportion(INSURE)).toMatch(/^[\d.]+% of all revenue · /);
  });

  it("speaks of the level shown, where one is: what it takes in and spends there", () => {
    // Pensions: three quarters social insurance, a quarter central; the part that falls back on basic
    // income is the centre's. A cut of 160 relieves social insurance by 120; at the centre 40 less
    // pension and 40 more basic income cancel out.
    mount("#lang=en&s=L.social_security");
    expect(what("#policy-cut_pensions")).toBe("relieves this level: it spends less.");
    act(() => root?.unmount());
    mount("#lang=en&s=L.central");
    expect(what("#policy-cut_pensions")).toBe("changes neither revenue nor spending at this level");
    // The provinces: half of the lower income tax, four fifths of the employer's part.
    act(() => root?.unmount());
    mount("#lang=de&s=L.state");
    expect(what(INSURE)).toMatch(/^belastet diese Ebene: Sie nimmt 7,5 XTS weniger ein und gibt 40 XTS mehr aus\.$/);
    // At one level both sides changing leave no share of either.
    expect(proportion(INSURE)).toBeNull();
    expect(what("#policy-cut_admin")).toBe("entlastet diese Ebene: Sie gibt weniger aus.");
  });

  it("says that neither total changes where a measure only moves money between items", () => {
    // All of the cut falls back on basic income: 160 less pension, 160 more basic income.
    mount("#lang=en&s=cut_pensions.fallback.100");
    expect(text("#policy-cut_pensions .policy__amount")).toBe("XTS 0");
    expect(what("#policy-cut_pensions")).toBe("changes neither revenue nor spending");
    expect(query("#policy-cut_pensions .policy__direction").className).toContain("policy__direction--neutral");
    // The cost shift says where the money went.
    expect(text("#policy-cut_pensions .policy__shift")).toContain("XTS 160 reappear as spending on “Basic income support”");
    act(() => root?.unmount());
    mount("#lang=de&s=cut_pensions.fallback.100");
    expect(what("#policy-cut_pensions")).toBe("ändert weder Einnahmen noch Ausgaben");
  });
});
