import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import { simulate } from "../engine/index.ts";
import {
  colorOf,
  crumbsOf,
  defaultSelection,
  layoutBudget,
  rowsOf,
  segmentKeyOf,
  segmentsOf,
  selectionShowing,
} from "./budgetModel.ts";

describe("budget layout", () => {
  const layout = layoutBudget(testland);
  const base = simulate(testland);

  it("orders categories by base-year amount and gives each side its own hues", () => {
    expect(layout.sides.revenue.order).toEqual(["rev.taxes", "rev.social_contributions", "rev.other"]);
    expect(layout.sides.revenue.order.map((id) => layout.colors.get(id))).toEqual([6, 7, 8]);
    expect(layout.sides.expenditure.order.slice(0, 3)).toEqual(["exp.social", "exp.education", "exp.health"]);
    expect(layout.colors.get("exp.social")).toBe(1);
  });

  it("folds the small categories into one neutral block", () => {
    // Six spending categories, five hues: the smallest one, interest, does not get a hue of its own.
    expect(layout.sides.expenditure.folded).toEqual(["exp.interest"]);
    const segments = segmentsOf(layout, base, "expenditure");
    expect(segments.map((segment) => segment.color)).toEqual([1, 2, 3, 4, 5, "other"]);
    // A single left-over category keeps its name instead of becoming "other (1)".
    expect(segments[5]).toMatchObject({ key: "exp.interest", isFold: false });
    expect(segments.reduce((sum, segment) => sum + segment.baseline, 0)).toBeCloseTo(base.baseline.expenditure, 9);
  });

  it("gives everything below a category the category's colour", () => {
    expect(colorOf(layout, "exp.social.pensions")).toBe(1);
    expect(colorOf(layout, "rev.taxes.wealth")).toBe(6);
  });

  it("keeps colours when a measure or the level filter changes the amounts", () => {
    const changed = simulate(testland, {
      policies: { defense_target: { enabled: true, params: { share: 5 } } },
      level: "central",
    });
    const before = segmentsOf(layout, base, "expenditure").map((segment) => [segment.key, segment.color]);
    const after = segmentsOf(layout, changed, "expenditure").map((segment) => [segment.key, segment.color]);
    expect(after).toEqual(before);
  });

  it("starts on the largest spending category that can be broken down", () => {
    expect(defaultSelection(testland, layout)).toEqual({ side: "expenditure", nodeId: "exp.social", fold: false });
  });

  it("lists the children of the selection, largest first, with what a measure changed", () => {
    const result = simulate(testland, { policies: { family_bonus: { enabled: true } } });
    const { rows, hidden } = rowsOf(testland, layout, result, {
      side: "expenditure",
      nodeId: "exp.social",
      fold: false,
    });
    expect(hidden).toBe(0);
    expect(rows.map((row) => row.id)).toEqual(["exp.social.pensions", "exp.social.basic_income", "exp.social.family"]);
    expect(rows[2]).toMatchObject({ baseline: 200, reform: 300, delta: 100, color: 1, isGroup: false });
  });

  it("hides items a single level has no part in, but keeps a real zero when all levels are shown", () => {
    const taxes = { side: "revenue" as const, nodeId: "rev.taxes", fold: false };
    expect(rowsOf(testland, layout, base, taxes).rows.map((row) => row.id)).toContain("rev.taxes.wealth");
    const central = simulate(testland, { policies: {}, level: "central" });
    const list = rowsOf(testland, layout, central, taxes);
    expect(list.rows.map((row) => row.id)).toEqual(["rev.taxes.income", "rev.taxes.vat"]);
    expect(list.hidden).toBe(1);
  });

  it("finds the list that shows a given item, and the block of the bar it belongs to", () => {
    expect(selectionShowing(layout, base, "exp.admin.parliament")).toEqual({
      side: "expenditure",
      nodeId: "exp.admin",
      fold: false,
    });
    expect(selectionShowing(layout, base, "exp.defense")).toEqual({ side: "expenditure", nodeId: null, fold: false });
    expect(segmentKeyOf(layout, { side: "expenditure", nodeId: "exp.admin", fold: false })).toBe("exp.admin");
    expect(segmentKeyOf(layout, { side: "revenue", nodeId: null, fold: false })).toBeUndefined();
  });

  it("builds the path from the side to the selection", () => {
    const crumbs = crumbsOf(layout, base, { side: "expenditure", nodeId: "exp.social", fold: false });
    expect(crumbs.map((crumb) => (crumb.kind === "node" ? crumb.id : crumb.kind))).toEqual(["side", "exp.social"]);
  });

  it("folds several small categories and routes the path through the fold", () => {
    const pack = testlandCopy();
    pack.budget.expenditure.push({
      id: "exp.culture",
      label: { en: "Culture", de: "Kultur" },
      children: [
        {
          id: "exp.culture.museums",
          label: { en: "Museums", de: "Museen" },
          amount: 20,
          levels: { state: 1 },
          quality: "official",
          sources: ["finance_ministry"],
        },
      ],
    });
    const folded = layoutBudget(pack);
    const result = simulate(pack);
    expect(folded.sides.expenditure.folded).toEqual(["exp.interest", "exp.culture"]);
    const segments = segmentsOf(folded, result, "expenditure");
    expect(segments[segments.length - 1]).toMatchObject({
      key: "other:expenditure",
      isFold: true,
      baseline: 120,
      color: "other",
    });
    expect(selectionShowing(folded, result, "exp.culture")).toEqual({ side: "expenditure", nodeId: null, fold: true });
    const crumbs = crumbsOf(folded, result, { side: "expenditure", nodeId: "exp.culture", fold: false });
    expect(crumbs.map((crumb) => crumb.kind)).toEqual(["side", "fold", "node"]);
    expect(
      rowsOf(pack, folded, result, { side: "expenditure", nodeId: null, fold: true }).rows.map((row) => row.id),
    ).toEqual(["exp.interest", "exp.culture"]);
  });
});
