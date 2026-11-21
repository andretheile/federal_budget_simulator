// @vitest-environment jsdom
/**
 * The debt section for a pack like the US one: one level of government, fiscal years from October
 * named after the year they end in ("FY 2024", "Haushaltsjahr 2024"), its own budget accounts, and
 * an official plan in those accounts that the projection follows (testlandFiscal). Variants give the
 * plan balances without debt, as a budget that projects deficits but not debt, and leave out what
 * debt.json may leave out.
 *
 * Germany's rendered section is pinned elsewhere (DebtSection.test.tsx, PhaseIn.de.test.tsx) and was
 * compared word for word before and after these rules.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { coversState, planFollowing } from "../app/debtModel.ts";
import { comparablePlans, otherPlans, planFollowingOf } from "../app/debtPlans.ts";
import { createUi } from "../app/ui.ts";
import { testland, testlandFiscal } from "../engine/__fixtures__/testland.ts";
import { projectScenario, type CountryPack } from "../engine/index.ts";
import { debtBodyDe } from "../i18n/debt/body-de.ts";
import { debtBodyEn } from "../i18n/debt/body-en.ts";
import { debtModule } from "./DebtSection.tsx";

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  // jsdom lays nothing out; the charts draw once their frame has a width.
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) } as DOMRect;
  };
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  await debtModule.load();
}, 30_000);

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(hash: string, pack: CountryPack): void {
  window.history.replaceState(null, "", hash);
  root = createRoot(container);
  act(() => root.render(<Simulator pack={pack} />));
}

const plain = (value: string | null | undefined): string => (value ?? "").replace(/[  ]/g, " ");
const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const all = <T extends Element = HTMLElement>(selector: string): T[] => [...container.querySelectorAll<T>(selector)];
const text = (selector: string): string => plain(query(selector).textContent);
const section = (): string => plain(query("#debt").textContent);
const headings = (): string[] => all("#debt h3, #debt h4").map((heading) => plain(heading.textContent));

/** The fiscal fixture whose plan gives, for FY 2025 and FY 2026, a balance and interest but no debt. */
function byBalance(): CountryPack {
  const pack = testlandFiscal();
  pack.debt!.plans![0].points = [
    { year: 2025, balanceRatio: -0.04, interestRatio: 0.011, interestToRevenue: 0.028, growth: 0.03 },
    { year: 2026, balanceRatio: -0.035, interestRatio: 0.012, interestToRevenue: 0.03, growth: 0.04 },
  ];
  return pack;
}

/** The fiscal fixture with only what debt.json must have: no presets, references, comparisons, plans or `covers`. */
function minimal(): CountryPack {
  const pack = testlandFiscal();
  const debt = pack.debt!;
  debt.presets = [];
  debt.references = [];
  delete debt.comparisons;
  delete debt.plans;
  delete debt.follow;
  delete debt.covers;
  return pack;
}

describe("whose debt", () => {
  it("a pack of one level: the texts do not speak of the state, and the pack says whose budget it is", () => {
    mount("#lang=en", testlandFiscal());
    expect(coversState(testlandFiscal())).toBe(false);
    expect(coversState(testland)).toBe(true);
    expect(section()).not.toMatch(/the state|whole state/);
    expect(text(".debt__lead")).toMatch(/^At 4% interest on new debt, [\d.]+% of all revenue would go on interest in FY 2054; in FY 2024 it was [\d.]+%\. The debt would be \d+% of economic output \(GDP\); in FY 2024 it was \d+%\./);
    // The items the pack compares interest with are all spending on them, not the state's.
    expect(text(".debt__lead")).toMatch(/interest would cost more than all spending on Defence\.$/);
    expect(text(".dchart__subtitle")).toBe("as a share of all revenue");
    expect(text(".dparam__explain")).toMatch(/^The rate on new borrowing and on the loans that fall due and are replaced: 25(\.0)?% of the debt each year\./);
    expect(text(".debt__limits")).toContain("This calculation covers the central government's budget and its debt.");
    expect(section()).toContain("Each item keeps its share of economic output of FY 2024.");
    expect(section()).not.toContain("Amounts for");
  });

  it("speaks German without „der Staat“", () => {
    mount("#lang=de", testlandFiscal());
    expect(section()).not.toMatch(/der Staat|des Staates|ganzen Staat/);
    expect(text(".debt__lead")).toMatch(/^Bei 4 % Zins für neue Schulden flössen im Haushaltsjahr 2054 [\d,]+ % aller Einnahmen in Zinsen; im Haushaltsjahr 2024 waren es [\d,]+ %\. Die Schulden lägen dann bei \d+ % der Wirtschaftsleistung \(BIP\); im Haushaltsjahr 2024 waren es \d+ %\./);
    expect(text(".debt__lead")).toMatch(/mehr kosten als alle Ausgaben für Verteidigung\.$/);
    expect(text(".debt__limits")).toContain("Diese Rechnung gilt für den Haushalt des Zentralstaats und seine Schulden.");
  });

  it("without the pack's words, a pack of one level is named by its level", () => {
    mount("#lang=en", minimal());
    expect(text(".debt__limits")).toContain("This calculation covers the budget of one level of government, “Federal government”, and its debt.");
    mount("#lang=de", minimal());
    expect(text(".debt__limits")).toContain("Diese Rechnung gilt für den Haushalt einer einzigen Ebene, „Bund“, und ihre Schulden.");
  });
});

describe("the pack's years", () => {
  it("are named in words, and the end of the base year is a date", () => {
    expect(createUi(testlandFiscal(), "en").yearName(2030)).toBe("FY 2030");
    expect(createUi(testlandFiscal(), "de").yearName(2030)).toBe("Haushaltsjahr 2030");
    expect(createUi(testland, "en").yearName(2030)).toBe(2030);
    mount("#lang=en", testlandFiscal());
    expect(all(".dfig__what").map((label) => plain(label.textContent))).toEqual(["Interest in FY 2054", "Debt in FY 2054"]);
    expect(text(".debt-teaser a")).toBe("Where does this lead? Debt and interest to FY 2054");
    expect(text(".debt-teaser__figure")).toMatch(/^Interest in FY 2054: [\d.]+% of all revenue \(FY 2024: [\d.]+%\)$/);
    expect(text(".debt__timing p")).toBe("Measures that are switched on act in this calculation from FY 2026.");
    expect(text(".debt__why summary")).toBe("Why from FY 2026?");
    expect(text(".dchart__readout")).toMatch(/^FY 2054: /);
    expect(text(".debt__basis dt")).toBe("Debt at the end of FY 2024 (30 September 2024)");
    expect(all(".debt__basis dt").map((term) => plain(term.textContent))).toContain("Interest in FY 2024");
    // The options of the starting point.
    expect(all(".dstart__label").map((label) => plain(label.textContent))).toEqual(["Official plan to FY 2026default", "Continue the FY 2024 budget"]);
  });

  it("stay numbers on the axes and in the table, which say what a year is", () => {
    mount("#lang=en", testlandFiscal());
    expect(text(".debt__years")).toBe("The years are fiscal years, as in the budget: FY 2024 runs from 1 October 2023 to 30 September 2024.");
    expect(all(".dchart__xaxis text").map((tick) => tick.textContent)[0]).toBe("2024");
    expect(text(".debt__table thead th")).toBe("FY");
    expect(text(".debt__table tbody th")).toBe("2024");
    expect(text(".dplan__table thead th")).toBe("FY");
    mount("#lang=de", testlandFiscal());
    expect(text(".debt__years")).toBe("Die Jahre sind Haushaltsjahre wie im Haushalt: Haushaltsjahr 2024 reicht vom 1. Oktober 2023 bis zum 30. September 2024.");
    expect(text(".debt__table thead th")).toBe("Haushaltsjahr");
    expect(all(".dstart__label").map((label) => plain(label.textContent))).toEqual(["Amtliche Planung bis Haushaltsjahr 2026Vorgabe", "Haushalt fortschreiben wie im Haushaltsjahr 2024"]);
    expect(text(".debt__basis dt")).toBe("Schulden am 30. September 2024 (Ende Haushaltsjahr 2024)");
  });

  it("name when measures act, in the section and on the cards: a year that begins on the day by its name, any other day by its month", () => {
    mount("#lang=en&s=cut_admin~wealth_tax", testlandFiscal());
    expect(all(".debt__later li").map((item) => plain(item.textContent))).toEqual(["Cut administration: from FY 2026, in full from FY 2030", "Wealth tax: from January 2026"]);
    expect(text("#policy-cut_admin .policy__timing > span:not(.policy__stand-in)")).toBe(
      "The figure is the full effect; in the projection of debt and interest from FY 2026, in full from FY 2030.",
    );
    expect(text("#policy-wealth_tax .policy__timing > span:not(.policy__stand-in)")).toBe("The figure is the full effect; in the projection of debt and interest from January 2026.");
    mount("#lang=de&s=cut_admin", testlandFiscal());
    expect(text(".debt__later li")).toBe("Verwaltung kürzen: ab Haushaltsjahr 2026, voll ab Haushaltsjahr 2030");
  });

  it("leave a calendar-year pack as it was", () => {
    mount("#lang=en", testland);
    expect(container.querySelector(".debt__years")).toBeNull();
    expect(all(".dfig__what").map((label) => plain(label.textContent))).toEqual(["Interest in 2054", "Debt in 2054"]);
    expect(text(".debt__table thead th")).toBe("Year");
    expect(text(".debt__basis dt")).toBe("Debt at the end of 2024");
  });
});

describe("plans in the budget's own accounts", () => {
  it("are drawn against the projection where they cover the whole budget in its accounts; others stand apart, named truly", () => {
    const pack = testlandFiscal();
    expect(comparablePlans(pack).map((plan) => plan.id)).toEqual(["ministry_projection"]);
    expect(otherPlans(pack).map((plan) => plan.id)).toEqual(["central_budget_interest"]);
    mount("#lang=en", pack);
    expect(text(".dplan--apart .dplan__scope")).toBe(
      "Covers only the level “Federal government” and is counted in cash. The calculation above describes the whole budget in the budget's own accounts. These figures cannot be compared with it, so they are not in the charts.",
    );
    // The plan the projection follows is on the path in the debt chart.
    expect(all(".dchart")[1].querySelector(".dchart__plan-line")).toBeNull();
    expect(all(".dchart")[1].querySelectorAll(".dchart__plan-point").length).toBeGreaterThan(0);
  });

  it("are named truly in all three kinds of accounts, in both languages", () => {
    expect(debtBodyEn.planScope(null, "budget", false)).toBe("Covers the whole budget, in the budget's own accounts.");
    expect(debtBodyEn.planScope(null, "national_accounts", true)).toBe("Covers the whole state, in national accounts.");
    expect(debtBodyEn.planScope("Central government", "cash", true)).toBe("Covers only the level “Central government” and is counted in cash.");
    expect(debtBodyEn.planNotComparable("national_accounts", true)).toMatch(/^The calculation above describes the whole state in national accounts\./);
    expect(debtBodyEn.planNotComparable("cash", false)).toMatch(/^The calculation above describes the whole budget in cash\./);
    expect(debtBodyDe.planScope(null, "budget", false)).toBe("Gilt für den ganzen Haushalt, in der Abgrenzung des Haushalts selbst.");
    expect(debtBodyDe.planNotComparable("budget", false)).toMatch(/^Die Rechnung oben beschreibt den ganzen Haushalt in der Abgrenzung des Haushalts selbst\./);
    expect(debtBodyDe.planNotComparable("national_accounts", true)).toMatch(
      /^Die Rechnung oben beschreibt den ganzen Staat in der Abgrenzung der Volkswirtschaftlichen Gesamtrechnungen\./,
    );
  });
});

describe("following a plan by its budget before interest", () => {
  it("says so: the budget before interest follows the plan, interest and debt come from the assumptions", () => {
    const pack = byBalance();
    const projection = projectScenario(pack)!;
    expect(projection.followed?.balanceYears).toEqual([2025, 2026]);
    expect(planFollowing(projection, pack)).toBe("balance");
    expect(planFollowingOf(pack.debt!.plans![0], 2024)).toBe("balance");
    expect(planFollowingOf(testlandFiscal().debt!.plans![0], 2024)).toBe("debt");
    mount("#lang=en", pack);
    expect(text(".debt__intro")).toBe(
      "Up to FY 2026, the budget before interest follows the official plan “Ministry projection”, and so does growth where the plan gives it; interest and debt come from the assumptions. After that, the budget before interest keeps the share of economic output it has in FY 2026, and growth too comes from the assumptions.",
    );
    expect(text(".dstart__option.is-chosen .dstart__note")).toBe(
      "Up to FY 2026, the budget before interest and growth follow the official plan “Ministry projection”, with what had been decided by the time it was made; interest and debt come from the assumptions, and after that everything does.",
    );
    expect(text(".dplan .debt__note")).toMatch(/^The path without measures takes its budget before interest; its interest is the model's, at the assumed rates\./);
    mount("#lang=de", pack);
    expect(text(".debt__intro")).toMatch(/^Bis Haushaltsjahr 2026 folgt der Haushalt ohne Zinsen der amtlichen Planung „Projektion des Ministeriums“, das Wachstum ebenso, wo sie es angibt; Zinsen und Schulden ergeben sich aus den Annahmen\. Danach behält der Haushalt ohne Zinsen den Anteil an der Wirtschaftsleistung, den er im Haushaltsjahr 2026 hat/);
  });

  it("draws the plan's interest beside the path, not on it, and gives it no debt", () => {
    mount("#lang=en", byBalance());
    const [interest, debt] = all(".dchart");
    // The plan's own interest: a dashed line with diamonds, in the legend as a line of its own.
    expect(interest.querySelector(".dchart__plan-line")).not.toBeNull();
    expect(interest.querySelectorAll(".dchart__svg .dchart__plan-point")).toHaveLength(2);
    expect(interest.querySelector(".dkey--plan.is-on-path")).toBeNull();
    // No debt figures: nothing of the plan in the debt chart.
    expect(debt.querySelector(".dchart__plan")).toBeNull();
    // The line where the plan ends does not claim that the years before it were the plan's alone.
    expect(plain(interest.querySelector(".dchart__marker text")?.textContent)).toBe("from FY 2027 without the plan");
    // Continuing the base year's budget, the plan is drawn in the interest chart only, and says so.
    mount("#lang=en&d=b", byBalance());
    expect(text(".dplan .debt__note")).toBe("Drawn in the interest chart as a dashed line, with diamonds at the years it gives figures for; it gives no debt.");
  });

  it("a plan with debt in some years and only a balance in others: says which it takes where", () => {
    const pack = testlandFiscal();
    pack.debt!.plans![0].points = [
      { year: 2025, debtRatio: 0.52, balanceRatio: -0.04 },
      { year: 2026, balanceRatio: -0.035, interestRatio: 0.012, interestToRevenue: 0.03, growth: 0.04 },
    ];
    expect(planFollowing(projectScenario(pack)!, pack)).toBe("mixed");
    mount("#lang=en", pack);
    expect(text(".debt__intro")).toBe(
      "Up to FY 2026, the calculation follows the official plan “Ministry projection”: its debt in the years it gives one, otherwise its budget before interest, with interest and debt from the assumptions; growth follows the plan where it gives it. After that, the budget before interest keeps the share of economic output it has in FY 2026, and the assumptions apply.",
    );
    // Its debt on the path in the debt chart, its interest beside the path in the interest chart.
    const [interest, debt] = all(".dchart");
    expect(debt.querySelector(".dkey--plan.is-on-path")).not.toBeNull();
    expect(debt.querySelectorAll(".dchart__svg .dchart__plan-point")).toHaveLength(1);
    expect(interest.querySelector(".dkey--plan.is-on-path")).toBeNull();
    expect(interest.querySelectorAll(".dchart__svg .dchart__plan-point")).toHaveLength(1);
  });

  it("a plan followed by its debt keeps its words", () => {
    mount("#lang=en", testlandFiscal());
    expect(text(".debt__intro")).toBe(
      "Up to FY 2026, debt and growth follow the official plan “Ministry projection”. After that, the budget before interest keeps the share of economic output it has in FY 2026, and the assumptions apply.",
    );
    expect(plain(all(".dchart")[0].querySelector(".dchart__marker text")?.textContent)).toBe("from FY 2027 by the assumptions");
  });
});

describe("what a pack leaves out", () => {
  it("leaves no heading, separator or sentence about it", () => {
    mount("#lang=en", minimal());
    expect(headings()).toEqual(["Assumptions", "What the calculation assumes and what it leaves out", "Where the figures come from"]);
    expect(container.querySelector(".dstart")).toBeNull();
    expect(container.querySelector(".dpresets")).toBeNull();
    expect(container.querySelector(".dkey--ref")).toBeNull();
    expect(container.querySelector(".dchart__marker")).toBeNull();
    // No compared item: the lead says nothing about one.
    expect(text(".debt__lead")).not.toMatch(/spending on/);
    expect(text(".debt__intro")).toBe("This is how debt and interest would develop if the budget of FY 2024 kept its size relative to the economy.");
  });
});

describe("the pack's notes", () => {
  it("keep the paragraphs the pack gives them with blank lines, and a block without one whole", () => {
    const pack = testlandFiscal();
    pack.debt!.note = { en: "First part of the note.\n\nSecond part.", de: "Erster Teil.\n\nZweiter Teil." };
    pack.debt!.measuresFrom!.note = { en: "Why this year.\n\nAnd more.", de: "Warum.\n\nUnd mehr." };
    pack.debt!.assumptions[0].note = { en: "Where the rate comes from.\n\nA second thought.", de: "Woher.\n\nNoch etwas." };
    mount("#lang=en", pack);
    expect(all(".debt__limits p").map((paragraph) => plain(paragraph.textContent)).slice(0, 2)).toEqual(["First part of the note.", "Second part."]);
    expect(all(".debt__why p").map((paragraph) => plain(paragraph.textContent))).toEqual(["Why this year.", "And more."]);
    expect(all(".dparam__more")[0].querySelectorAll("p")).toHaveLength(2);
    // The fixture's own note has no blank line: one paragraph, followed by whose budget it is.
    mount("#lang=en", testlandFiscal());
    expect(all(".debt__limits p")).toHaveLength(2);
  });
});

describe("the values to compare with", () => {
  it("are said to be of earlier years where they are all of the country's own past", () => {
    const pack = testlandFiscal();
    pack.debt!.references = pack.debt!.references.filter((reference) => reference.kind === "history");
    mount("#lang=en", pack);
    expect(all("#debt .debt__block .debt__note").map((note) => plain(note.textContent))).toContain("Figures of earlier years, and when the calculation reaches them.");
    mount("#lang=de", pack);
    expect(all("#debt .debt__block .debt__note").map((note) => plain(note.textContent))).toContain("Werte früherer Jahre, und wann die Rechnung sie erreicht.");
    // Other countries and earlier years, as in the fixture: as before.
    mount("#lang=en", testlandFiscal());
    expect(all("#debt .debt__block .debt__note").map((note) => plain(note.textContent))).toContain(
      "Figures of other countries and earlier years, and when the calculation reaches them.",
    );
  });
});

describe("the share refinanced each year", () => {
  it("is one fact with the time to maturity where it is one divided by it, and stands apart from it where it is set otherwise", () => {
    mount("#lang=en", testlandFiscal());
    const rows = (): string[] => all(".debt__basis .facts > div").map((row) => plain(row.querySelector("dt")?.textContent));
    expect(rows()).toEqual(["Debt at the end of FY 2024 (30 September 2024)", "Interest in FY 2024", "Refinanced every year"]);
    expect(text(".debt__basis .facts > div:nth-child(3) dd")).toMatch(/^25(\.0)?% of the debt; the loans have 4(\.00)? years left to run on average/);
    // A share calibrated to an official sensitivity, as the US pack's: the time to maturity on a line of its own.
    const pack = testlandFiscal();
    pack.debt!.refinancing.share = 0.3;
    mount("#lang=en", pack);
    expect(rows()).toEqual(["Debt at the end of FY 2024 (30 September 2024)", "Interest in FY 2024", "Refinanced every year", "Average time to maturity"]);
    expect(text(".debt__basis .facts > div:nth-child(3) dd")).toMatch(/^30(\.0)?% of the debt ·/);
    expect(text(".debt__basis .facts > div:nth-child(4) dd")).toMatch(/^4(\.00)? years$/);
  });
});
