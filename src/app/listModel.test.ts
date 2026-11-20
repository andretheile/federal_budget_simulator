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
