import { describe, expect, it } from "vitest";
import { testland } from "../engine/__fixtures__/testland.ts";
import { curveTotal, simulatePolicy, type CurveParam, type CurvePoint, type ScheduleEffect } from "../engine/index.ts";
import {
  addPoint,
  beginChange,
  canAdd,
  canRemove,
  curveChanged,
  curveOutline,
  curveSettings,
  dragPoint,
  matchingPreset,
  movePoint,
  NO_UNDO,
  nudgePoint,
  recordChange,
  removePoint,
  sameCurve,
  sameWithin,
  snap,
  stepFrom,
  suggestedX,
  todayForDrawing,
  todayPoints,
  topRate,
  xBounds,
} from "./curveModel.ts";

const p = (...pairs: [number, number][]): CurvePoint[] => pairs.map(([x, y]) => ({ x, y }));

/** Shaped like the German income tax tariff: a wide x range, a fine y step, up to 12 points. */
const tariff: CurveParam = {
  id: "schedule",
  type: "curve",
  label: { en: "Marginal tax rate" },
  x: { unit: "currency", min: 0, max: 1_000_000, step: 100 },
  y: { unit: "percent", min: 0, max: 80, step: 0.5 },
  default: p([11784, 14], [17005, 23.97], [66760, 42], [277825, 42], [277825, 45]),
  minPoints: 1,
  maxPoints: 7,
};
const today = tariff.default;

const fixture = testland.policies.find((policy) => policy.id === "redraw_income_tax")!;
const fixtureParam = fixture.params[0] as CurveParam;
const fixtureEffect = fixture.effects[0] as ScheduleEffect;

describe("the grid", () => {
  it("snaps to min + k * step inside the axis", () => {
    expect(snap(66_749, tariff.x)).toBe(66_700);
    expect(snap(66_751, tariff.x)).toBe(66_800);
    expect(snap(-50, tariff.x)).toBe(0);
    expect(snap(2e6, tariff.x)).toBe(1_000_000);
    expect(snap(23.97, tariff.y)).toBe(24);
    expect(snap(0.1 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snap(7, { min: 1, max: 10, step: 2 })).toBe(7);
    expect(snap(8, { min: 1, max: 10, step: 2 })).toBe(9);
  });

  it("steps from a value off the grid to the next grid value in that direction", () => {
    expect(stepFrom(23.97, tariff.y, 1)).toBe(24);
    expect(stepFrom(23.97, tariff.y, -1)).toBe(23.5);
    expect(stepFrom(24, tariff.y, 1)).toBe(24.5);
    expect(stepFrom(24, tariff.y, -1, 10)).toBe(19);
    expect(stepFrom(79.8, tariff.y, 1, 10)).toBe(80);
    expect(stepFrom(0.2, tariff.y, -1)).toBe(0);
  });
});

describe("moving a point", () => {
  it("cannot pass its neighbours, but may meet one and form a step", () => {
    expect(xBounds(today, 2, tariff.x)).toEqual([17005, 277825]);
    expect(xBounds(today, 0, tariff.x)).toEqual([0, 17005]);
    expect(xBounds(today, 4, tariff.x)).toEqual([277825, 1_000_000]);
    // The two points of a step: the first can only go left, the second only right.
    expect(xBounds(today, 3, tariff.x)).toEqual([66760, 277825]);

    const pastRight = movePoint(today, 2, { x: 400_000 }, tariff);
    expect(pastRight[2]).toEqual({ x: 277825, y: 42 });
    const pastLeft = movePoint(today, 2, { x: 5_000 }, tariff);
    expect(pastLeft[2]).toEqual({ x: 17005, y: 42 });
    // Meeting the left neighbour makes a step from 23.97 % to 42 % there.
    expect(pastLeft.slice(1, 3)).toEqual(p([17005, 23.97], [17005, 42]));
  });

  it("stays inside the ranges and leaves the list alone", () => {
    const before = today.map((point) => ({ ...point }));
    expect(movePoint(today, 4, { x: 2e6, y: 95 }, tariff)[4]).toEqual({ x: 1_000_000, y: 80 });
    expect(movePoint(today, 0, { x: -10, y: -3 }, tariff)[0]).toEqual({ x: 0, y: 0 });
    expect(today).toEqual(before);
  });

  it("returns the same list when a move changes nothing", () => {
    expect(movePoint(today, 2, { x: 66760, y: 42 }, tariff)).toBe(today);
    // Pushing against a neighbour that is already met.
    expect(movePoint(today, 4, { x: 100 }, tariff)).toBe(today);
    expect(movePoint(today, 9, { x: 100 }, tariff)).toBe(today);
  });

  it("by arrow keys moves one grid step, or ten with the modifier", () => {
    expect(nudgePoint(today, 1, "y", 1, false, tariff)[1]).toEqual({ x: 17005, y: 24 });
    expect(nudgePoint(today, 1, "y", -1, true, tariff)[1]).toEqual({ x: 17005, y: 19 });
    expect(nudgePoint(today, 1, "x", 1, false, tariff)[1]).toEqual({ x: 17100, y: 23.97 });
    // From 17,005, off the grid, the first of the ten steps goes to 17,000.
    expect(nudgePoint(today, 1, "x", -1, true, tariff)[1]).toEqual({ x: 16_100, y: 23.97 });
    // A step point cannot be pushed past its partner.
    expect(nudgePoint(today, 3, "x", 1, false, tariff)).toBe(today);
  });

  it("by dragging snaps what moved and keeps what did not", () => {
    // Moved 40 px to the right and 1 px down: x snaps, the rate keeps the pack's 23.97 %.
    const sideways = dragPoint(today, 1, today[1], { x: 21_234, y: 23.81 }, { x: 40, y: 1 }, tariff);
    expect(sideways[1]).toEqual({ x: 21_200, y: 23.97 });
    const both = dragPoint(today, 1, today[1], { x: 21_234, y: 31.3 }, { x: 40, y: -60 }, tariff);
    expect(both[1]).toEqual({ x: 21_200, y: 31.5 });
    // Clamped like any other move.
    expect(dragPoint(today, 1, today[1], { x: 90_000, y: 31.3 }, { x: 400, y: -60 }, tariff)[1]).toEqual({ x: 66760, y: 31.5 });
  });
});

describe("adding a point", () => {
  const unchanged = (before: readonly CurvePoint[], after: readonly CurvePoint[]): boolean =>
    sameCurve({ points: before }, { points: after });

  it("puts it on the curve, so the curve does not change", () => {
    const added = addPoint(today, 40_000, tariff)!;
    expect(added.index).toBe(2);
    expect(added.points[2].x).toBe(40_000);
    expect(added.points[2].y).toBeCloseTo(23.97 + (18.03 * (40_000 - 17005)) / (66760 - 17005), 12);
    expect(unchanged(today, added.points)).toBe(true);
    // On the top rate, above the last point.
    const top = addPoint(today, 500_049, tariff)!;
    expect(top.points[top.index]).toEqual({ x: 500_000, y: 45 });
    expect(unchanged(today, top.points)).toBe(true);
  });

  it("below the first point keeps the jump with a second point at rate 0", () => {
    const below = addPoint(today, 5_000, tariff)!;
    expect(below.points.slice(0, 3)).toEqual(p([5_000, 0], [11784, 0], [11784, 14]));
    expect(below.index).toBe(0);
    expect(unchanged(today, below.points)).toBe(true);
    // One point is enough where the first rate is 0 already.
    const zero = addPoint(p([10, 0], [30, 40]), 4, fixtureParam)!;
    expect(zero.points).toEqual(p([4, 0], [10, 0], [30, 40]));
    // Two are needed and only one is left: nothing is added.
    const six = p([10, 10], [20, 20], [30, 30], [40, 40], [50, 50]);
    expect(addPoint(six, 5, fixtureParam)).toBeNull();
    expect(addPoint(six, 45, fixtureParam)?.points).toHaveLength(6);
  });

  it("at a step goes after it, where the later rate applies", () => {
    // In the fixture (step 1) the point (30, 40) is already there.
    expect(addPoint(p([10, 20], [30, 20], [30, 40]), 30, fixtureParam)).toBeNull();
    expect(addPoint(p([10, 20], [30, 20], [30, 40]), 20, fixtureParam)?.points).toEqual(p([10, 20], [20, 20], [30, 20], [30, 40]));
    // With a step of 100 euros the pack's 277,825 is off the grid: a click there lands on 277,800, below the step.
    expect(addPoint(today, 277_825, tariff)!.points.slice(3)).toEqual(p([277_800, 42], [277825, 42], [277825, 45]));
    const nearby = addPoint(today, 277_900, tariff)!;
    expect(nearby.points.slice(3)).toEqual(p([277825, 42], [277825, 45], [277900, 45]));
  });

  it("respects the most points a curve may have", () => {
    const full = addPoint(addPoint(today, 30_000, tariff)!.points, 50_000, tariff)!.points;
    expect(full).toHaveLength(7);
    expect(canAdd(full, tariff)).toBe(false);
    expect(addPoint(full, 100_000, tariff)).toBeNull();
  });

  it("without a place on the chart goes into a gap", () => {
    expect(suggestedX(today, tariff, 2)).toBe(172_300);
    expect(suggestedX(today, tariff, 4)).toBe(638_900);
    // The widest gap of the whole range: above the last point.
    expect(suggestedX(today, tariff)).toBe(638_900);
    expect(suggestedX(p([10, 10], [30, 40]), fixtureParam)).toBe(45);
  });
});

describe("removing a point", () => {
  it("removes it, down to the fewest points allowed", () => {
    expect(removePoint(today, 1, tariff)).toEqual(p([11784, 14], [66760, 42], [277825, 42], [277825, 45]));
    const one = p([10, 25]);
    expect(canRemove(one, tariff)).toBe(false);
    expect(removePoint(one, 0, tariff)).toBe(one);
    expect(removePoint(today, 7, tariff)).toBe(today);
    expect(canRemove(one, { ...tariff, minPoints: 0 })).toBe(true);
  });
});

describe("presets and today's curve", () => {
  it("a curve equal to a preset is recognised as that preset", () => {
    expect(matchingPreset(p([10, 25]), fixtureParam)?.id).toBe("flat_tax");
    expect(matchingPreset(p([10, 25.5]), fixtureParam)).toBeUndefined();
  });

  it("today's curve comes from the effect's calibration baseline, and costs exactly nothing", () => {
    const points = todayPoints(fixtureParam, fixtureEffect)!;
    expect(points).toEqual(p([10, 20], [30, 20], [30, 40]));
    const result = simulatePolicy(testland, "redraw_income_tax", { tariff: points })!;
    expect(result.delta.balance).toBe(0);
  });

  it("from brackets or another scale, converted into the parameter's units", () => {
    const brackets: ScheduleEffect = { ...fixtureEffect, baseline: { brackets: [{ from: 10, rate: 0.2 }, { from: 30, rate: 0.45 }] } };
    const withoutCopy = { ...fixtureParam, baseline: undefined };
    expect(todayPoints(withoutCopy, brackets)).toEqual(p([10, 20], [30, 20], [30, 45]));
    // The param's own copy is used only where it shows the same curve.
    expect(todayPoints(fixtureParam, brackets)).toEqual(p([10, 20], [30, 20], [30, 45]));
    const fractions: ScheduleEffect = { ...fixtureEffect, baseline: { points: p([10, 0.2], [30, 0.2], [30, 0.4]) } };
    expect(todayPoints(withoutCopy, fractions)).toEqual(p([10, 20], [30, 20], [30, 40]));
    expect(curveTotal(testland.distributions.income, { points: todayPoints(withoutCopy, fractions)!, scale: 0.01 })).toBeCloseTo(120, 9);
  });

  it("is not offered where there is none, or where it does not fit the parameter", () => {
    expect(todayPoints(fixtureParam, { ...fixtureEffect, baseline: undefined })).toBeNull();
    expect(todayPoints({ ...fixtureParam, maxPoints: 2 }, fixtureEffect)).toBeNull();
    expect(todayPoints({ ...fixtureParam, x: { ...fixtureParam.x, max: 25 } }, fixtureEffect)).toBeNull();
  });
});

describe("one step of undo", () => {
  it("goes back to the curve before the last change", () => {
    let state = NO_UNDO;
    const first = p([10, 10], [30, 40]);
    const second = p([10, 15], [30, 40]);
    state = recordChange(beginChange(state, first));
    expect(state.undo).toBe(first);
    // A drag: many moves, one change.
    state = beginChange(state, second);
    state = recordChange(state);
    state = recordChange(state);
    expect(state.undo).toBe(second);
  });

  it("is left alone by a gesture that changed nothing", () => {
    const first = p([10, 10], [30, 40]);
    const state = recordChange(beginChange(NO_UNDO, first));
    const idle = beginChange(state, p([10, 15], [30, 40]));
    expect(idle.undo).toBe(first);
  });
});

describe("what a chart and a card need to know about a curve", () => {
  it("finds the effect a curve parameter feeds, with its scale", () => {
    const [setting] = curveSettings(fixture);
    expect(setting.param.id).toBe("tariff");
    expect(setting.effect).toBe(fixtureEffect);
    expect(setting.scale).toBe(0.01);
    expect(curveSettings(testland.policies.find((policy) => policy.id === "cut_admin")!)).toEqual([]);
  });

  it("draws today's curve from the effect's baseline, in the parameter's units", () => {
    const [setting] = curveSettings(fixture);
    expect(todayForDrawing(setting)).toEqual(p([10, 20], [30, 20], [30, 40]));
    const brackets = { ...setting, effect: { ...fixtureEffect, baseline: { brackets: [{ from: 10, rate: 0.25 }] } } };
    expect(todayForDrawing(brackets)).toEqual(p([10, 25]));
    expect(todayForDrawing({ ...setting, effect: { ...fixtureEffect, baseline: undefined } })).toBeUndefined();
  });

  it("knows the top rate and whether the curve differs from today's", () => {
    const [setting] = curveSettings(fixture);
    expect(topRate(today)).toEqual({ rate: 45, from: 277825 });
    expect(topRate([])).toBeNull();
    expect(curveChanged(setting, p([10, 20], [30, 20], [30, 40]))).toBe(false);
    // The same curve written differently is not a change.
    expect(curveChanged(setting, p([10, 20], [20, 20], [30, 20], [30, 40]))).toBe(false);
    expect(curveChanged(setting, setting.param.default)).toBe(true);
    // Without a baseline the default is what "unchanged" means.
    const absolute = { ...setting, effect: { ...fixtureEffect, baseline: undefined } };
    expect(curveChanged(absolute, setting.param.default)).toBe(false);
  });

  it("outlines the curve from edge to edge, bending only at the knee of the scale", () => {
    expect(curveOutline(p([10, 20], [30, 20], [30, 40]), 0, 60)).toEqual(p([0, 0], [10, 0], [10, 20], [30, 20], [30, 40], [60, 40]));
    // A ramp across the knee at 25 gets a point there.
    expect(curveOutline(p([10, 10], [30, 40]), 0, 60, [25])).toEqual(p([0, 0], [10, 0], [10, 10], [25, 32.5], [30, 40], [60, 40]));
    // A first point at the left edge needs no zero line before it.
    expect(curveOutline(p([0, 18.6], [90_600, 18.6], [90_600, 0]), 0, 300_000)).toEqual(
      p([0, 0], [0, 18.6], [90_600, 18.6], [90_600, 0], [300_000, 0]),
    );
    // Clipped to the range.
    expect(curveOutline(p([10, 10], [80, 80]), 0, 60)).toEqual(p([0, 0], [10, 0], [10, 10], [60, 60]));
    expect(curveOutline([], 0, 60)).toEqual(p([0, 0], [60, 0]));
  });
});

describe("who counts as paying the same", () => {
  it("is anyone within one currency unit a year, or less where the amounts are small", () => {
    // Testland's incomes average 18: a ten-thousandth of that, rounded down to a power of ten.
    expect(sameWithin(testland.distributions.income)).toBe(0.001);
    const large = { ...testland.distributions.income, bins: testland.distributions.income.bins.map((bin) => ({ ...bin, from: bin.from * 1e4, to: bin.to * 1e4, mean: bin.mean * 1e4 })) };
    expect(sameWithin(large)).toBe(1);
  });
});
