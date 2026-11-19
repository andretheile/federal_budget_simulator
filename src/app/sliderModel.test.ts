import { describe, expect, it } from "vitest";
import { testland } from "../engine/__fixtures__/testland.ts";
import { resolveParams, type NumberParam } from "../engine/index.ts";
import { createFormatters } from "../i18n/format.ts";
import { noiseLevel } from "./policyModel.ts";
import {
  changeFromBase,
  keyStep,
  landmarks,
  onGrid,
  positions,
  sliderDirection,
  snapWhileDragging,
  typedValue,
  valueAfterKey,
} from "./sliderModel.ts";

/** A slider like the German petrol tax: 5,410 positions of a hundredth of a cent. */
const petrol: NumberParam = {
  id: "petrol",
  type: "number",
  label: { en: "Petrol" },
  unit: "count",
  min: 35.9,
  max: 90,
  step: 0.01,
  default: 51.41,
  baseline: 65.45,
};
/** A coarse one: 20 positions. */
const vat: NumberParam = { id: "standard", type: "number", label: { en: "VAT" }, unit: "percent", min: 15, max: 25, step: 0.5, default: 21, baseline: 19 };

describe("the grid of a slider", () => {
  it("counts its positions and puts any value inside the range and on a step", () => {
    expect(positions(petrol)).toBe(5410);
    expect(positions(vat)).toBe(20);
    expect(onGrid(65.4537, petrol)).toBe(65.45);
    expect(onGrid(0.1 + 0.2 + 40, petrol)).toBe(40.3);
    expect(onGrid(120, petrol)).toBe(90);
    expect(onGrid(-3, petrol)).toBe(35.9);
    expect(onGrid(19.3, vat)).toBe(19.5);
  });

  it("has the base-year value and the default as landmarks, where they lie on the scale", () => {
    expect(landmarks(petrol)).toEqual([65.45, 51.41]);
    expect(landmarks({ ...vat, baseline: undefined })).toEqual([21]);
    expect(landmarks({ ...vat, baseline: 30 })).toEqual([21]);
  });
});

describe("dragging", () => {
  it("snaps to the base-year value and to the default within 1 % of the range", () => {
    // 1 % of 54.1 is 0.541.
    expect(snapWhileDragging(65.0, petrol)).toBe(65.45);
    expect(snapWhileDragging(65.99, petrol)).toBe(65.45);
    expect(snapWhileDragging(66.0, petrol)).toBe(66.0);
    expect(snapWhileDragging(51.9, petrol)).toBe(51.41);
    expect(snapWhileDragging(58, petrol)).toBe(58);
    // The nearer of the two wins where both are close.
    const close = { ...vat, default: 20.5, baseline: 19.5, min: 0, max: 100, step: 0.1 };
    expect(snapWhileDragging(20.2, close)).toBe(20.5);
    expect(snapWhileDragging(19.8, close)).toBe(19.5);
  });
});

describe("the keys", () => {
  it("move 1 % of the range per arrow and 10 % per Page key on a slider with more than 200 positions", () => {
    expect(keyStep(petrol, false)).toBe(0.54);
    expect(keyStep(petrol, true)).toBeCloseTo(5.41, 9);
    expect(valueAfterKey("ArrowRight", 40, petrol)).toBe(40.54);
    expect(valueAfterKey("ArrowUp", 40, petrol)).toBe(40.54);
    expect(valueAfterKey("ArrowLeft", 40, petrol)).toBe(39.46);
    expect(valueAfterKey("PageUp", 40, petrol)).toBe(45.41);
    expect(valueAfterKey("PageDown", 40, petrol)).toBe(35.9);
    expect(valueAfterKey("ArrowRight", 89.9, petrol)).toBe(90);
  });

  it("stop at the base-year value and at the default on the way", () => {
    expect(valueAfterKey("ArrowRight", 65.2, petrol)).toBe(65.45);
    // From it, on past it.
    expect(valueAfterKey("ArrowRight", 65.45, petrol)).toBe(65.99);
    expect(valueAfterKey("PageDown", 60, petrol)).toBe(54.59);
    expect(valueAfterKey("PageDown", 54.59, petrol)).toBe(51.41);
    expect(valueAfterKey("PageUp", 51.41, petrol)).toBe(56.82);
  });

  it("are left to the browser on a slider with 200 positions or fewer, and for other keys", () => {
    expect(valueAfterKey("ArrowRight", 19, vat)).toBeNull();
    expect(valueAfterKey("Home", 40, petrol)).toBeNull();
    expect(valueAfterKey("a", 40, petrol)).toBeNull();
  });
});

describe("a typed value", () => {
  const de = createFormatters("de", "EUR");
  const en = createFormatters("en", "EUR");

  it("is read with either decimal mark, and put inside the range and on the grid", () => {
    expect(typedValue("65,45", petrol, de.parse)).toBe(65.45);
    expect(typedValue("65.45", petrol, en.parse)).toBe(65.45);
    expect(typedValue("51,414", petrol, de.parse)).toBe(51.41);
    expect(typedValue("200", petrol, de.parse)).toBe(90);
    expect(typedValue("19,3", vat, de.parse)).toBe(19.5);
  });

  it("is no value if it is no number", () => {
    expect(typedValue("", petrol, de.parse)).toBeNull();
    expect(typedValue("viel", petrol, de.parse)).toBeNull();
  });
});

describe("the change from the base year", () => {
  it("is the difference in the slider's own unit, without the noise of binary fractions", () => {
    expect(changeFromBase(51.41, petrol)).toBe(-14.04);
    expect(changeFromBase(21, vat)).toBe(2);
    expect(changeFromBase(65.45, petrol)).toBeNull();
    expect(changeFromBase(21, { ...vat, baseline: undefined })).toBeNull();
  });
});

describe("which way one slider pushes the balance", () => {
  const noise = noiseLevel({ revenue: 2_000, expenditure: 2_400, balance: -400 });
  const at = (id: string, values: Record<string, number>) => {
    const policy = testland.policies.find((candidate) => candidate.id === id)!;
    return { policy, params: resolveParams(testland, policy, values) };
  };

  it("worsens where more of it is spent, improves where more tax comes in, and is neutral at the base-year value", () => {
    const defence = at("defense_target", { share: 3 });
    const share = defence.policy.params[0] as NumberParam;
    expect(sliderDirection(testland, defence.policy, defence.params, share, "all", noise)).toBe("worsen");
    const lower = at("defense_target", { share: 1.5 });
    expect(sliderDirection(testland, lower.policy, lower.params, share, "all", noise)).toBe("improve");
    const base = at("defense_target", { share: 2 });
    expect(sliderDirection(testland, base.policy, base.params, share, "all", noise)).toBe("neutral");

    const top = at("raise_top_tax_rate", { top_rate: 50 });
    const rate = top.policy.params[0] as NumberParam;
    expect(sliderDirection(testland, top.policy, top.params, rate, "all", noise)).toBe("improve");
  });

  it("judges each slider of a measure on its own", () => {
    // The wealth tax: the rate (base 0) raises revenue; the threshold has no base-year value.
    const wealth = at("wealth_tax", { rate: 2, threshold: 1000 });
    const [rate, threshold] = wealth.policy.params as NumberParam[];
    expect(sliderDirection(testland, wealth.policy, wealth.params, rate, "all", noise)).toBe("improve");
    expect(sliderDirection(testland, wealth.policy, wealth.params, threshold, "all", noise)).toBe("neutral");
  });
});
