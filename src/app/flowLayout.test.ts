import { beforeAll, describe, expect, it } from "vitest";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import { simulate, type CountryPack, type Scenario, type Side } from "../engine/index.ts";
import { loadPack } from "../packs.ts";
import { layoutBudget, segmentsOf } from "./budgetModel.ts";
import {
  FLOW,
  flowTexts,
  labelLines,
  layoutFlow,
  type FlowLayout,
  type FlowNode,
  type FlowSize,
  type FlowTexts,
} from "./flowLayout.ts";
import { noiseLevel } from "./policyModel.ts";
import { createUi } from "./ui.ts";

/**
 * Widths as the site's font gives them, roughly: Public Sans at 12.5 px is about 6.5 px a
 * character in semibold and 6.1 px in regular. A delta carries its triangle and gap (15 px).
 */
const measure: FlowTexts["measure"] = (text, style) =>
  style === "name" ? text.length * 6.5 : style === "value" ? text.length * 6.1 : text.length * 6.3 + 15;

/** A phone (390 px less the gutters, touch) and the column beside the measures on a desktop. */
const PHONE: FlowSize = { width: 358, scaleHeight: 280, maxHeight: 520, minBand: 44 };
const DESKTOP: FlowSize = { width: 650, scaleHeight: 300, maxHeight: 420, minBand: 24 };

function flow(pack: CountryPack, size: FlowSize, scenario: Scenario = { policies: {} }, language = "de"): FlowLayout {
  const result = simulate(pack, scenario);
  const noise = noiseLevel(result.baseline);
  return layoutFlow({
    layout: layoutBudget(pack),
    result,
    noise,
    texts: flowTexts(createUi(pack, language), noise, measure),
    size,
  });
}

const column = (layout: FlowLayout, side: "left" | "right"): FlowNode[] =>
  layout.nodes.filter((node) => node.column === side);
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/** Everything that must hold for any layout: proportions, sums, bands, labels, targets. */
function checkLayout(layout: FlowLayout, minBand: number): void {
  const { middle } = layout;
  for (const side of ["left", "right"] as const) {
    const nodes = column(layout, side);
    // Both sides add up to the middle node, the balance included.
    expect(sum(nodes.map((node) => node.amount))).toBeCloseTo(middle.amount, 3);
    expect(sum(nodes.map((node) => node.height))).toBeCloseTo(middle.height, 6);
    // One scale for every node, and the ribbons fill the middle node from its top, in order.
    let inner = middle.y;
    for (const node of nodes) {
      expect(node.height).toBeCloseTo(node.amount * layout.scale, 6);
      expect(node.inner.top).toBeCloseTo(inner, 6);
      inner += node.inner.height;
    }
    expect(inner).toBeCloseTo(middle.y + middle.height, 6);
    // Bands follow each other without overlapping, each holds its node and its label, and each is a big enough target.
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      expect(node.band.bottom - node.band.top).toBeGreaterThanOrEqual(minBand - 1e-9);
      expect(node.y).toBeGreaterThanOrEqual(node.band.top - 1e-9);
      expect(node.y + node.height).toBeLessThanOrEqual(node.band.bottom + 1e-9);
      expect(node.label.y).toBeGreaterThanOrEqual(node.band.top - 1e-9);
      expect(node.label.y + node.label.height).toBeLessThanOrEqual(node.band.bottom + 1e-9);
      if (index > 0) expect(node.band.top).toBeGreaterThanOrEqual(nodes[index - 1].band.bottom - 1e-9);
      // Its label stays on its own side of the middle node, with room to spare, and inside the box.
      if (side === "left") expect(node.label.x + node.label.width).toBeLessThanOrEqual(middle.x - FLOW.clear + 1e-9);
      else expect(node.label.x).toBeGreaterThanOrEqual(middle.x + middle.width + FLOW.clear - 1e-9);
      expect(node.label.x).toBeGreaterThanOrEqual(0);
      expect(node.label.x + node.label.width).toBeLessThanOrEqual(layout.width + 1e-9);
      expect(node.target.x + node.target.width).toBeLessThanOrEqual(layout.width + 1e-9);
      expect(node.band.bottom).toBeLessThanOrEqual(layout.height + 1e-9);
    }
  }
  // No two labels overlap, on either side or across.
  const boxes = layout.nodes.map((node) => node.label);
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const apart =
        boxes[a].x + boxes[a].width <= boxes[b].x ||
        boxes[b].x + boxes[b].width <= boxes[a].x ||
        boxes[a].y + boxes[a].height <= boxes[b].y ||
        boxes[b].y + boxes[b].height <= boxes[a].y;
      expect(apart, `${layout.nodes[a].key} and ${layout.nodes[b].key}`).toBe(true);
    }
  }
}

describe("the flow of the budget on Testland", () => {
  it("puts the revenue left, the spending right and the deficit under the revenue, so both sides add up", () => {
    const layout = flow(testland, DESKTOP);
    checkLayout(layout, DESKTOP.minBand);
    expect(column(layout, "left").map((node) => node.key)).toEqual([
      "rev.taxes",
      "rev.social_contributions",
      "rev.other",
      "balance",
    ]);
    expect(column(layout, "right").map((node) => node.key)).toEqual([
      "exp.social",
      "exp.education",
      "exp.health",
      "exp.admin",
      "exp.defense",
      "exp.interest",
    ]);
    expect(layout.balance).toEqual({ kind: "deficit", column: "left", amount: 400 });
    expect(layout.middle.amount).toBe(4400);
    expect(layout.middle.height).toBeCloseTo(DESKTOP.scaleHeight, 9);
    // Colours are those of the bars.
    const bars = segmentsOf(layoutBudget(testland), simulate(testland), "expenditure");
    expect(column(layout, "right").map((node) => node.color)).toEqual(bars.map((segment) => segment.color));
    expect(column(layout, "left").at(-1)?.color).toBe("deficit");
  });

  it("puts a surplus on the right, under the spending", () => {
    const pack = testlandCopy();
    const other = pack.budget.revenue.find((node) => node.id === "rev.other");
    if (!other || "children" in other) throw new Error("rev.other is a leaf");
    other.amount = 1000;
    const layout = flow(pack, PHONE);
    checkLayout(layout, PHONE.minBand);
    expect(layout.balance).toEqual({ kind: "surplus", column: "right", amount: 300 });
    expect(column(layout, "right").at(-1)?.key).toBe("balance");
    expect(column(layout, "left").every((node) => node.key !== "balance")).toBe(true);
    expect(layout.middle.amount).toBe(4700);
  });

  it("shows the scenario: amounts and changes as the bars have them", () => {
    const layout = flow(testland, DESKTOP, { policies: { family_bonus: { enabled: true } } }, "en");
    checkLayout(layout, DESKTOP.minBand);
    const social = layout.nodes.find((node) => node.key === "exp.social");
    expect(social?.amount).toBe(2300);
    const parts = social?.label.lines.flatMap((line) => line.parts) ?? [];
    expect(parts.map((part) => part.style)).toEqual(["name", "name", "value", "delta"].slice(4 - parts.length));
    expect(parts.find((part) => part.style === "delta")?.text.replace(/\s/g, " ")).toBe("+XTS 100");
    // The deficit grows by the same 100.
    expect(layout.balance?.amount).toBe(500);
  });

  it("draws nothing for a balanced budget", () => {
    const pack = testlandCopy();
    const other = pack.budget.revenue.find((node) => node.id === "rev.other");
    if (!other || "children" in other) throw new Error("rev.other is a leaf");
    other.amount = 700;
    const layout = flow(pack, DESKTOP);
    expect(layout.balance).toBeUndefined();
    expect(layout.nodes.some((node) => node.key === "balance")).toBe(false);
    checkLayout(layout, DESKTOP.minBand);
  });

  it("calls the gap of a single level a difference, not a balance", () => {
    const layout = flow(testland, DESKTOP, { policies: {}, level: "central" });
    checkLayout(layout, DESKTOP.minBand);
    expect(layout.balance?.kind).toBe("difference");
  });

  it("copes with a box of no width and with texts that cannot be measured", () => {
    const result = simulate(testland);
    const noise = noiseLevel(result.baseline);
    const layout = layoutFlow({
      layout: layoutBudget(testland),
      result,
      noise,
      texts: flowTexts(createUi(testland, "en"), noise, () => Infinity),
      size: { width: 0, scaleHeight: 300, maxHeight: 400, minBand: 24 },
    });
    expect(layout.nodes.length).toBe(10);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.label.width)).toBe(true);
      expect(Number.isFinite(node.band.bottom)).toBe(true);
    }
  });
});

describe("labels", () => {
  it("put amount and change after the name where they fit, and on lines of their own where not", () => {
    expect(
      labelLines("Taxes", "€1,007.1bn", undefined, 200, measure).map((line) => line.parts.map((part) => part.text)),
    ).toEqual([["Taxes", "€1,007.1bn"]]);
    const lines = labelLines(
      "Allgemeine Verwaltung, Schulden und Internationales",
      "277,9 Mrd. €",
      "+1,0 Mrd. €",
      145,
      measure,
    );
    expect(lines.map((line) => line.parts.map((part) => part.text))).toEqual([
      ["Allgemeine Verwaltung,"],
      ["Schulden und"],
      ["Internationales"],
      ["277,9 Mrd. €"],
      ["+1,0 Mrd. €"],
    ]);
    expect(lines.map((line) => line.parts.map((part) => part.style))).toEqual([
      ["name"],
      ["name"],
      ["name"],
      ["value"],
      ["delta"],
    ]);
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(145);
  });

  it("break a word too long for the line at a joint where they can", () => {
    const lines = labelLines("Sozialversicherungsbeiträge", "1.748,3 Mrd. $", undefined, 145, measure);
    expect(lines.map((line) => line.parts.map((part) => part.text))).toEqual([
      ["Sozialversicherungs-"],
      ["beiträge", "1.748,3 Mrd. $"],
    ]);
    const plain = labelLines("Donaudampfschifffahrtsgesellschaft", "1 €", undefined, 100, measure);
    for (const line of plain) expect(line.width).toBeLessThanOrEqual(100);
    expect(
      plain
        .flatMap((line) => line.parts.filter((part) => part.style === "name").map((part) => part.text))
        .join("")
        .replace(/-/g, ""),
    ).toBe("Donaudampfschifffahrtsgesellschaft");
  });
});

describe("folding", () => {
  it("shows every area on its own where the labels fit, and folds as the bars do where nothing else fits", () => {
    const roomy = flow(testland, { ...DESKTOP, maxHeight: 2000 });
    expect(roomy.folded).toEqual({ revenue: [], expenditure: [] });
    // Testland's bars fold a single area, which keeps its name: there is nothing to fold.
    const tight = flow(testland, { ...DESKTOP, maxHeight: 10 });
    expect(tight.folded).toEqual({ revenue: [], expenditure: [] });
    expect(tight.nodes.some((node) => node.segment?.isFold)).toBe(false);
  });
});

describe("the flow of the real packs", () => {
  const packs: Record<string, CountryPack> = {};
  beforeAll(async () => {
    for (const id of ["de", "us"]) {
      const result = await loadPack(id);
      if (!result.ok) throw new Error(`countries/${id} does not validate`);
      packs[id] = result.pack;
    }
  });

  const scenarios: Record<string, Scenario> = {
    de: {
      policies: {
        corporate_tax_rate: { enabled: true },
        child_benefit_amount: { enabled: true },
        building_subsidy_cut: { enabled: true },
      },
    },
    us: { policies: { foreign_aid_cut: { enabled: true }, corporate_tax_rate: { enabled: true } } },
  };

  for (const id of ["de", "us"]) {
    for (const [name, size] of [
      ["a phone", PHONE],
      ["a desktop", DESKTOP],
    ] as const) {
      for (const language of ["de", "en"]) {
        it(`${id}: labels do not overlap on ${name} (${language}), without and with measures`, () => {
          const pack = packs[id];
          for (const scenario of [{ policies: {} }, scenarios[id]]) {
            const layout = flow(pack, size, scenario, language);
            checkLayout(layout, size.minBand);
            expect(layout.balance?.kind).toBe("deficit");
            // The flow folds at most what the bars fold, and only the smallest areas.
            for (const side of ["revenue", "expenditure"] as Side[]) {
              const bars = layoutBudget(pack).sides[side];
              expect(bars.folded.slice(bars.folded.length - layout.folded[side].length)).toEqual(layout.folded[side]);
            }
            // A column only grows past the height it may take where it folds as much as the bars.
            for (const side of ["left", "right"] as const) {
              const which: Side = side === "left" ? "revenue" : "expenditure";
              if (layout.columns[side] > size.maxHeight)
                expect(layout.folded[which]).toEqual(layoutBudget(pack).sides[which].folded);
            }
          }
        });
      }
    }
  }

  it("de: shows more areas on their own than the bars where there is room", () => {
    const pack = packs.de;
    const bars = layoutBudget(pack).sides.expenditure.folded.length;
    const desktop = flow(pack, DESKTOP);
    expect(desktop.folded.expenditure.length).toBeLessThan(bars);
    const roomy = flow(pack, { ...DESKTOP, maxHeight: 2000 });
    expect(roomy.folded.expenditure).toEqual([]);
    expect(column(roomy, "right")).toHaveLength(11);
  });

  it("de: a level of government whose revenue exceeds its spending has the difference on the right", () => {
    // The states: revenue 510.8 bn, spending 436.0 bn. Payments between levels are netted out, so it is no surplus.
    const layout = flow(packs.de, PHONE, { policies: {}, level: "state" });
    checkLayout(layout, PHONE.minBand);
    expect(layout.balance?.kind).toBe("difference");
    expect(layout.balance?.column).toBe("right");
    expect(column(layout, "right").at(-1)?.key).toBe("balance");
    const municipalities = flow(packs.de, DESKTOP, { policies: {}, level: "local" });
    checkLayout(municipalities, DESKTOP.minBand);
    expect(municipalities.balance).toMatchObject({ kind: "difference", column: "left" });
  });

  it("every level of the German pack and the US pack lay out without overlaps on both widths", () => {
    for (const level of ["central", "state", "local", "social_security"] as const) {
      for (const size of [PHONE, DESKTOP]) checkLayout(flow(packs.de, size, { policies: {}, level }), size.minBand);
    }
  });
});
