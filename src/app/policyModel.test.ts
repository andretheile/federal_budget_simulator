import { describe, expect, it } from "vitest";
import { testland } from "../engine/__fixtures__/testland.ts";
import type { Param, Policy } from "../engine/index.ts";
import { settingsOf } from "./policyModel.ts";

const policy = (id: string): Policy => {
  const found = testland.policies.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`the fixture has no policy ${id}`);
  return found;
};

describe("the settings of a measure", () => {
  it("are its sliders and its choices of groups", () => {
    expect(settingsOf(policy("cut_admin")).map((param) => param.type)).toEqual(["number"]);
    expect(settingsOf(policy("no_basic_income_non_citizens")).map((param) => param.type)).toEqual(["groups"]);
    expect(settingsOf(policy("halve_mp_pay"))).toEqual([]);
  });

  it("leave out a kind of parameter the card has no control for", () => {
    // What a newer pack may carry: a kind of parameter this interface does not know.
    const unknown = { id: "curve", type: "curve", label: { en: "Rate curve" }, default: [] } as unknown as Param;
    const known = policy("cut_admin");
    expect(settingsOf({ ...known, params: [unknown, ...known.params] })).toEqual(known.params);
    expect(settingsOf({ ...known, params: [unknown] })).toEqual([]);
  });
});
