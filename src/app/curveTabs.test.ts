import { describe, expect, it } from "vitest";
import { crowds, tabPlaces } from "./curveTabs.ts";

describe("points a finger cannot tell apart", () => {
  it("are found in crowds of two or more, points far apart are left alone", () => {
    // The German tariff on a phone: the step at 277,825 is 9 px tall; the other points are far apart.
    const spots = [
      { x: 81, y: 494 },
      { x: 92, y: 465 },
      { x: 198, y: 412 },
      { x: 287, y: 412 },
      { x: 287, y: 403 },
    ];
    expect(crowds(spots)).toEqual([[3, 4]]);
    // A threshold of its own: the first two points are 31 px apart.
    expect(crowds(spots, 32)).toEqual([
      [0, 1],
      [3, 4],
    ]);
    // A chain is one crowd, even where its ends are further apart than the threshold.
    expect(crowds([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 0, y: 40 }])).toEqual([[0, 1, 2]]);
    expect(crowds([{ x: 0, y: 0 }])).toEqual([]);
  });

  it("are kept together while one of them is dragged, though they have moved apart", () => {
    const spots = [
      { x: 0, y: 0 },
      { x: 0, y: 200 },
      { x: 100, y: 100 },
    ];
    expect(crowds(spots)).toEqual([]);
    expect(crowds(spots, 30, [0, 1])).toEqual([[0, 1]]);
  });
});

describe("the tabs of a crowd", () => {
  it("stand above and below a step, the higher rate above", () => {
    // Screen y grows downwards: point 4 (45 %) is above point 3 (42 %).
    const tabs = tabPlaces([
      { x: 198, y: 412 },
      { x: 287, y: 412 },
      { x: 287, y: 403 },
    ]);
    expect(tabs.map(({ index, x, y }) => ({ index, x, y }))).toEqual([
      { index: 1, x: 287, y: 412 + 32 },
      { index: 2, x: 287, y: 403 - 32 },
    ]);
    // Two tabs far enough apart for a finger: more than a 44 px target between their centres.
    expect(Math.abs(tabs[0].y - tabs[1].y)).toBeGreaterThan(44);
    expect(tabs[0].group).toEqual([1, 2]);
  });

  it("go along the line through the crowd, and sideways for the point in its middle", () => {
    const pair = tabPlaces([
      { x: 100, y: 100 },
      { x: 112, y: 116 },
    ]);
    // 3-4-5: the direction from the middle is (0.6, 0.8).
    expect(pair[0].x).toBeCloseTo(100 - 0.6 * 32, 5);
    expect(pair[0].y).toBeCloseTo(100 - 0.8 * 32, 5);
    expect(pair[1].x).toBeCloseTo(112 + 0.6 * 32, 5);
    expect(pair[1].y).toBeCloseTo(116 + 0.8 * 32, 5);

    const column = tabPlaces([
      { x: 50, y: 100 },
      { x: 50, y: 90 },
      { x: 50, y: 80 },
    ]);
    expect(column.map(({ x, y }) => [x, y])).toEqual([
      [50, 132],
      [82, 90],
      [50, 48],
    ]);
  });

  it("fan out from straight up when the points lie on top of each other", () => {
    const tabs = tabPlaces([
      { x: 50, y: 50 },
      { x: 50, y: 50 },
    ]);
    expect(tabs[1].x).toBeCloseTo(50, 5);
    expect(tabs[1].y).toBeCloseTo(18, 5);
    expect(tabs[0].x).toBeCloseTo(50, 5);
    expect(tabs[0].y).toBeCloseTo(82, 5);
  });

  it("stay inside the chart", () => {
    const tabs = tabPlaces(
      [
        { x: 300, y: 10 },
        { x: 300, y: 18 },
      ],
      { bounds: { width: 310, height: 290, marginX: 24, marginY: 14 } },
    );
    for (const tab of tabs) {
      expect(tab.x).toBeLessThanOrEqual(310 - 24);
      expect(tab.y).toBeGreaterThanOrEqual(14);
    }
  });
});
