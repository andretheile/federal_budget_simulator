/**
 * Which measures the list shows on Testland. The collection "budget_debate" lists wealth_tax,
 * cut_admin and defense_target in that order, "savings" cut_admin and halve_mp_pay: cut_admin is in
 * both.
 */
import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import type { Scenario } from "../engine/index.ts";
import { collectionsByPolicy, listView } from "./listModel.ts";

const none: Scenario = { policies: {} };
const ids = (policies: { id: string }[]): string[] => policies.map((policy) => policy.id);

describe("the list of measures", () => {
  it("shows every measure in the pack's order without a filter", () => {
    const view = listView(testland, none, undefined, null);
    expect(ids(view.shown)).toEqual(ids(testland.policies));
    expect(view.collection).toBeUndefined();
    expect(view.hidden).toEqual([]);
  });

  it("narrows to a collection, in the collection's order, with the topics among its measures", () => {
    const view = listView(testland, none, "budget_debate", null);
    expect(view.collection?.id).toBe("budget_debate");
    expect(ids(view.shown)).toEqual(["wealth_tax", "cut_admin", "defense_target"]);
    expect(view.topics).toEqual([
      ["taxes", 1],
      ["state", 1],
      ["defense", 1],
    ]);
  });

  it("drops a topic the collection does not have, and an unknown collection", () => {
    expect(listView(testland, none, "budget_debate", "pensions").topic).toBeNull();
    expect(ids(listView(testland, none, "budget_debate", "pensions").shown)).toEqual(["wealth_tax", "cut_admin", "defense_target"]);
    expect(ids(listView(testland, none, "budget_debate", "taxes").shown)).toEqual(["wealth_tax"]);
    expect(ids(listView(testland, none, "no_such_collection", null).shown)).toEqual(ids(testland.policies));
  });

  it("counts the measures switched on that a filter hides, and only those", () => {
    const scenario: Scenario = {
      policies: { halve_mp_pay: { enabled: true }, cut_admin: { enabled: true }, cut_pensions: { enabled: false } },
    };
    expect(ids(listView(testland, scenario, "budget_debate", null).hidden)).toEqual(["halve_mp_pay"]);
    expect(ids(listView(testland, scenario, "savings", null).hidden)).toEqual([]);
    expect(ids(listView(testland, scenario, undefined, null).hidden)).toEqual([]);
    // The topic filter hides as well: both are about the state, the cut in pensions is off.
    expect(ids(listView(testland, scenario, undefined, "state").hidden)).toEqual([]);
    expect(ids(listView(testland, scenario, undefined, "taxes").hidden)).toEqual(["halve_mp_pay", "cut_admin"]);
    expect(ids(listView(testland, scenario, "budget_debate", "taxes").hidden)).toEqual(["halve_mp_pay", "cut_admin"]);
  });
});

describe("the badges of a measure", () => {
  it("name every collection it is in, in the pack's order of collections", () => {
    const badges = collectionsByPolicy(testland, (collection) => collection.label.en);
    expect(badges.get("cut_admin")).toEqual(["Budget debate", "Savings"]);
    expect(badges.get("wealth_tax")).toEqual(["Budget debate"]);
    expect(badges.get("halve_mp_pay")).toEqual(["Savings"]);
    expect(badges.get("cut_pensions")).toBeUndefined();
  });

  it("are none for a pack without collections", () => {
    const pack = testlandCopy();
    delete pack.collections;
    expect(collectionsByPolicy(pack, (collection) => collection.id).size).toBe(0);
    expect(listView(pack, none, "budget_debate", null).collection).toBeUndefined();
  });
});

describe("the list in alphabetical order (as the page shows it)", () => {
  const order = (language: "en" | "de") => ({
    language,
    label: (policy: { label: { en: string; de?: string } }) => policy.label[language] ?? policy.label.en,
    topic: (topic: string) => topic,
  });

  it("sorts the measures by their labels in the language shown, and leaves the pack's order alone", () => {
    const before = ids(testland.policies);
    const en = listView(testland, none, undefined, null, order("en"));
    expect(en.shown.map((policy) => policy.label.en)).toEqual([...en.shown.map((policy) => policy.label.en)].sort((a, b) => a.localeCompare(b, "en")));
    expect(ids(en.shown).slice(0, 3)).toEqual(["insure_civil_servants", "cut_admin", "cut_pensions"]);
    // German labels give another order: "Abgeordnetendiäten halbieren" first, "Verwaltung kürzen" last.
    const de = listView(testland, none, undefined, null, order("de"));
    expect(ids(de.shown)).toEqual([
      "halve_mp_pay", // Abgeordnetendiäten halbieren
      "insure_civil_servants", // Beamte zahlen in die Sozialversicherung ein
      "redraw_income_tax", // Einkommensteuertarif neu zeichnen
      "family_bonus", // Familienbonus
      "no_basic_income_non_citizens", // Keine Grundsicherung für Ausländer
      "cut_pensions", // Renten kürzen
      "raise_top_tax_rate", // Spitzensteuersatz anheben
      "wealth_tax", // Vermögensteuer
      "defense_target", // Verteidigungsausgaben-Ziel
      "cut_admin", // Verwaltung kürzen
    ]);
    // The engine's order is the pack's, untouched.
    expect(ids(testland.policies)).toEqual(before);
  });

  it("does not change with what is switched on or how a setting is", () => {
    const off = ids(listView(testland, none, undefined, null, order("en")).shown);
    const on: Scenario = {
      policies: Object.fromEntries(testland.policies.map((policy) => [policy.id, { enabled: true, params: { cut: 30, share: 4 } }])),
    };
    expect(ids(listView(testland, on, undefined, null, order("en")).shown)).toEqual(off);
  });

  it("sorts a collection's measures too, and the topics, with \"other\" last", () => {
    const view = listView(testland, none, "budget_debate", null, order("en"));
    expect(ids(view.shown)).toEqual(["cut_admin", "defense_target", "wealth_tax"]);
    expect(view.topics.map(([id]) => id)).toEqual(["defense", "state", "taxes"]);
    const pack = testlandCopy();
    pack.policies[0].topic = "other";
    const topics = listView(pack, none, undefined, null, order("en")).topics.map(([id]) => id);
    expect(topics.at(-1)).toBe("other");
    expect(topics.slice(0, -1)).toEqual([...topics.slice(0, -1)].sort());
  });
});

describe("the list in sections by the side of the budget", () => {
  const order = {
    language: "en",
    label: (policy: { label: { en: string } }) => policy.label.en,
    topic: (topic: string) => topic,
  };
  const sections = (view: ReturnType<typeof listView>): [string, string[], number][] =>
    view.sections.map((section) => [section.side, ids(section.policies), section.on]);

  it("puts revenue first, then spending, then both, alphabetical within each", () => {
    expect(sections(listView(testland, none, undefined, null, order))).toEqual([
      ["revenue", ["raise_top_tax_rate", "redraw_income_tax", "wealth_tax"], 0],
      ["expenditure", ["cut_admin", "cut_pensions", "defense_target", "family_bonus", "halve_mp_pay", "no_basic_income_non_citizens"], 0],
      ["both", ["insure_civil_servants"], 0],
    ]);
  });

  it("holds the same measures as are shown, each once", () => {
    const view = listView(testland, none, "budget_debate", null, order);
    expect(view.sections.flatMap((section) => ids(section.policies)).sort()).toEqual(ids(view.shown).sort());
  });

  it("counts the measures switched on in each section", () => {
    const scenario: Scenario = {
      policies: { wealth_tax: { enabled: true }, cut_admin: { enabled: true }, halve_mp_pay: { enabled: true }, cut_pensions: { enabled: false } },
    };
    expect(listView(testland, scenario, undefined, null, order).sections.map((section) => [section.side, section.on])).toEqual([
      ["revenue", 1],
      ["expenditure", 2],
      ["both", 0],
    ]);
  });

  it("leaves out a section without a measure under the filters, and keeps a single one", () => {
    // The debate's measures: a tax, a cut and the defence target; nothing on both sides.
    expect(sections(listView(testland, none, "budget_debate", null, order))).toEqual([
      ["revenue", ["wealth_tax"], 0],
      ["expenditure", ["cut_admin", "defense_target"], 0],
    ]);
    // Pensions: a cut (spending) and the insurance of civil servants (both).
    expect(sections(listView(testland, none, undefined, "pensions", order)).map(([side, policies]) => [side, policies])).toEqual([
      ["expenditure", ["cut_pensions"]],
      ["both", ["insure_civil_servants"]],
    ]);
    expect(sections(listView(testland, none, undefined, "taxes", order)).map(([side]) => side)).toEqual(["revenue"]);
  });

  it("does not change with the settings or the level shown: a card keeps its place", () => {
    const before = sections(listView(testland, none, undefined, null, order));
    const moved: Scenario = {
      level: "state",
      policies: {
        cut_pensions: { enabled: false, params: { cut: 0, fallback: 0 } },
        insure_civil_servants: { enabled: false, params: { employer_share: 100 } },
      },
    };
    expect(sections(listView(testland, moved, undefined, null, order))).toEqual(before);
  });

  it("are none where no measure is shown", () => {
    const pack = testlandCopy();
    pack.policies = [];
    expect(listView(pack, none, undefined, null, order).sections).toEqual([]);
  });
});
