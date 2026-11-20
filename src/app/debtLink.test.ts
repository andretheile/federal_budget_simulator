import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "../engine/__fixtures__/testland.ts";
import { decodeDebtAssumptions, defaultDebtAssumptions, encodeDebtAssumptions, sameDebtAssumptions } from "./debtLink.ts";

// Testland's defaults: market rate 4 %, growth 3 %, 30 years, no drift.
const debt = testland.debt!;
const defaults = defaultDebtAssumptions(debt);

describe("the debt assumptions in the address", () => {
  it("writes nothing for the defaults", () => {
    expect(defaults).toEqual({ market_rate: 4, growth: 3, horizon: 30, drift: 0 });
    expect(encodeDebtAssumptions(debt, defaults)).toBe("");
  });

  it("writes only what differs from the default, as a letter and a number", () => {
    expect(encodeDebtAssumptions(debt, { ...defaults, market_rate: 5.1 })).toBe("r5.1");
    expect(encodeDebtAssumptions(debt, { market_rate: 0, growth: 2.5, horizon: 40, drift: -0.07 })).toBe("r0~g2.5~y40~p-0.07");
    // Floating-point dust from adding steps is not written.
    expect(encodeDebtAssumptions(debt, { ...defaults, growth: 0.1 + 0.2 })).toBe("g0.3");
  });

  it("reads back what it wrote", () => {
    for (const values of [
      { ...defaults, market_rate: 5.1 },
      { market_rate: -1, growth: 8, horizon: 1, drift: 0.5 },
      { market_rate: 0, growth: 2.5, horizon: 40, drift: -0.07 },
    ]) {
      expect(decodeDebtAssumptions(debt, encodeDebtAssumptions(debt, values))).toEqual(values);
    }
  });

  it("takes the default for what is missing, clamps to the range and puts values on the slider's steps", () => {
    expect(decodeDebtAssumptions(debt, undefined)).toEqual(defaults);
    expect(decodeDebtAssumptions(debt, "")).toEqual(defaults);
    expect(decodeDebtAssumptions(debt, "r99~g-50")).toEqual({ ...defaults, market_rate: 10, growth: -2 });
    expect(decodeDebtAssumptions(debt, "r5.123~y12.6~p-0.071")).toEqual({ ...defaults, market_rate: 5.1, horizon: 13, drift: -0.07 });
  });

  it("ignores what it does not know", () => {
    expect(decodeDebtAssumptions(debt, "x7~r~r5x~gabc~y40")).toEqual({ ...defaults, horizon: 40 });
  });

  it("compares assumptions up to floating-point dust", () => {
    expect(sameDebtAssumptions(defaults, { ...defaults })).toBe(true);
    expect(sameDebtAssumptions(defaults, { ...defaults, growth: 3 + 1e-12 })).toBe(true);
    expect(sameDebtAssumptions(defaults, { ...defaults, growth: 3.1 })).toBe(false);
    expect(sameDebtAssumptions(undefined, undefined)).toBe(true);
    expect(sameDebtAssumptions(defaults, undefined)).toBe(false);
  });
});

describe("following an official plan", () => {
  it("is written as f and the plan's id, after the numbers, and read back", () => {
    const following = { ...defaults, follow: "ministry_projection" };
    expect(encodeDebtAssumptions(debt, following)).toBe("fministry_projection");
    expect(encodeDebtAssumptions(debt, { ...following, market_rate: 5.1 })).toBe("r5.1~fministry_projection");
    expect(decodeDebtAssumptions(debt, "r5.1~fministry_projection")).toEqual({ ...defaults, market_rate: 5.1, follow: "ministry_projection" });
    expect(decodeDebtAssumptions(debt, "fministry_projection~r5.1")).toEqual({ ...defaults, market_rate: 5.1, follow: "ministry_projection" });
  });

  it("drops a plan the pack does not have, and one that cannot be followed (the cash plan)", () => {
    expect(decodeDebtAssumptions(debt, "fno_such_plan~y40")).toEqual({ ...defaults, horizon: 40 });
    expect(decodeDebtAssumptions(debt, "fcentral_budget_interest")).toEqual(defaults);
    expect(decodeDebtAssumptions(debt, "f")).toEqual(defaults);
  });

  it("keeps links from before plans could be followed: they follow none", () => {
    expect(decodeDebtAssumptions(debt, "r8~y40")).toEqual({ ...defaults, market_rate: 8, horizon: 40 });
    expect(decodeDebtAssumptions(debt, "r8~y40").follow).toBeUndefined();
  });

  it("counts in the comparison", () => {
    expect(sameDebtAssumptions(defaults, { ...defaults, follow: "ministry_projection" })).toBe(false);
    expect(sameDebtAssumptions({ ...defaults, follow: "ministry_projection" }, { ...defaults, follow: "ministry_projection" })).toBe(true);
    expect(sameDebtAssumptions(defaults, { ...defaults, follow: undefined })).toBe(true);
  });
});

describe("the starting path in the address, for a pack that starts from a plan", () => {
  const pack = testlandCopy();
  pack.debt!.follow = "ministry_projection";
  const following = pack.debt!;
  const start = defaultDebtAssumptions(following);

  it("writes nothing for the pack's own starting path, and b for the base year's budget", () => {
    expect(start).toEqual({ ...defaults, follow: "ministry_projection" });
    expect(encodeDebtAssumptions(following, start)).toBe("");
    expect(encodeDebtAssumptions(following, { ...start, follow: null })).toBe("b");
    expect(encodeDebtAssumptions(following, { ...start, market_rate: 8, follow: null })).toBe("r8~b");
    expect(encodeDebtAssumptions(following, { ...start, market_rate: 8 })).toBe("r8");
  });

  it("reads them back", () => {
    expect(decodeDebtAssumptions(following, "")).toEqual(start);
    expect(decodeDebtAssumptions(following, "b")).toEqual({ ...defaults, follow: null });
    expect(decodeDebtAssumptions(following, "r8~b")).toEqual({ ...defaults, market_rate: 8, follow: null });
    expect(sameDebtAssumptions(decodeDebtAssumptions(following, "b"), start)).toBe(false);
  });

  it("takes the old forms: no plan named is the pack's starting path; the pack's own plan named is the same", () => {
    expect(decodeDebtAssumptions(following, "r8~y40")).toEqual({ ...start, market_rate: 8, horizon: 40 });
    expect(decodeDebtAssumptions(following, "fministry_projection")).toEqual(start);
    expect(encodeDebtAssumptions(following, decodeDebtAssumptions(following, "fministry_projection"))).toBe("");
    // A plan that is not there, or cannot be followed: the pack's starting path.
    expect(decodeDebtAssumptions(following, "fno_such")).toEqual(start);
    expect(decodeDebtAssumptions(following, "fcentral_budget_interest")).toEqual(start);
  });

  it("for a pack that names no plan, b is its own starting path and writes nothing", () => {
    expect(decodeDebtAssumptions(debt, "b")).toEqual(defaults);
    expect(encodeDebtAssumptions(debt, { ...defaults, follow: null })).toBe("");
  });
});
