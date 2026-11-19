import { describe, expect, it } from "vitest";
import { bandPath, chartDomain, linePath, placeLabels, wrapLabel, yearAt, yearTicks } from "./debtChart.ts";

describe("the vertical range", () => {
  it("runs from 0 to a round value with a little room above the data and the references", () => {
    const domain = chartDomain([0.614, 0.9, 1.273], [0.6, 1.1263, 1.2327, 1.3425], 220, 40);
    expect(domain.min).toBe(0);
    expect(domain.max).toBeGreaterThan(1.3425);
    expect(domain.max).toBeLessThanOrEqual(1.6);
    expect(domain.ticks[0]).toBe(0);
    expect(domain.ticks[domain.ticks.length - 1]).toBe(domain.max);
    expect(domain.offScale).toEqual([false, false, false, false]);
  });

  it("marks a reference far above everything else as lying above the chart", () => {
    // Japan's debt (214 % of GDP) against a projection that ends at 127 % and Italy at 134 %.
    const domain = chartDomain([0.614, 1.273], [0.6, 1.3425, 2.1359], 220, 40);
    expect(domain.offScale).toEqual([false, false, true]);
    expect(domain.max).toBeLessThan(2.1359);
    // A chart whose references are the point keeps them all.
    expect(chartDomain([0.614, 1.273], [0.6, 1.3425, 2.1359], 220, 40, Infinity).offScale).toEqual([false, false, false]);
    // With US rates the projection gets near Japan, which then belongs in the chart.
    expect(chartDomain([0.614, 1.79], [0.6, 1.3425, 2.1359], 220, 40).offScale).toEqual([false, false, false]);
  });

  it("goes below 0 for negative values", () => {
    const domain = chartDomain([-0.004, 0.01], [], 200, 40);
    expect(domain.min).toBeLessThan(0);
    expect(domain.ticks).toContain(0);
  });

  it("copes with nothing but zeros", () => {
    const domain = chartDomain([0, 0], [], 200, 40);
    expect(domain.max).toBeGreaterThan(domain.min);
  });
});

describe("the years", () => {
  it("label the first and the last year and round years between them that keep their distance", () => {
    expect(yearTicks(2024, 2054, 600, 56)).toEqual([2024, 2030, 2035, 2040, 2045, 2050, 2054]);
    const narrow = yearTicks(2024, 2054, 200, 44);
    expect(narrow[0]).toBe(2024);
    expect(narrow[narrow.length - 1]).toBe(2054);
    for (let i = 1; i < narrow.length; i++) expect((narrow[i] - narrow[i - 1]) * (200 / 30)).toBeGreaterThanOrEqual(44);
    expect(yearTicks(2024, 2025, 300, 44)).toEqual([2024, 2025]);
    expect(yearTicks(2024, 2025, 30, 44)).toEqual([2024]);
  });

  it("the year under a pointer is the nearest one, inside the range", () => {
    expect(yearAt(0, 0, 300, 2024, 2054)).toBe(2024);
    expect(yearAt(300, 0, 300, 2024, 2054)).toBe(2054);
    expect(yearAt(152, 0, 300, 2024, 2054)).toBe(2039);
    expect(yearAt(-50, 0, 300, 2024, 2054)).toBe(2024);
    expect(yearAt(999, 0, 300, 2024, 2054)).toBe(2054);
  });
});

describe("the labels of the reference values", () => {
  const measure = (text: string): number => text.length * 6;

  it("are broken at spaces into lines that fit, at most three", () => {
    expect(wrapLabel("USA", 80, measure)).toEqual(["USA"]);
    expect(wrapLabel("EU-Referenzwert für die Staatsschulden", 96, measure)).toEqual(["EU-Referenzwert", "für die", "Staatsschulden"]);
    expect(wrapLabel("one two three four five six seven", 30, measure)).toEqual(["one", "two", "three …"]);
    // A compound too wide for a line breaks after its hyphen.
    expect(wrapLabel("EU-Referenzwert für die Staatsschulden", 84, measure)).toEqual(["EU-", "Referenzwert", "für die …"]);
    expect(wrapLabel("EU-Referenzwert für", 100, measure)).toEqual(["EU-Referenzwert", "für"]);
  });

  it("move as little as they can so that none overlaps the next, and stay inside", () => {
    const items = [
      { y: 100, height: 12 },
      { y: 104, height: 12 },
      { y: 50, height: 25 },
      { y: 198, height: 12 },
    ];
    const at = placeLabels(items, 0, 200, 2);
    const boxes = items.map((item, i) => ({ top: at[i] - item.height / 2, bottom: at[i] + item.height / 2 })).sort((a, b) => a.top - b.top);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].top - boxes[i - 1].bottom).toBeGreaterThanOrEqual(2 - 1e-9);
    for (const box of boxes) {
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(200);
    }
    // One that has room stays where it is.
    expect(at[2]).toBe(50);
  });
});

describe("paths", () => {
  it("draw a line and a closed band", () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 2.25, y: 3 }])).toBe("M0.0,1.0L2.3,3.0");
    expect(bandPath([0, 10], [1, 2], [5, 6])).toBe("M0.0,1.0L10.0,2.0L10.0,6.0L0.0,5.0Z");
    expect(bandPath([], [], [])).toBe("");
  });
});
