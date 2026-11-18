import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "./__fixtures__/testland.ts";
import { decodeNumber, decodeScenario, emptyScenario, encodeNumber, encodeScenario } from "./scenario.ts";
import { simulate, type Scenario } from "./simulate.ts";

/** RFC 3986 unreserved characters: never percent-encoded, never a delimiter in a URL. */
const URL_SAFE = /^[A-Za-z0-9._~-]*$/;

const full: Scenario = {
  policies: {
    halve_mp_pay: { enabled: true },
    cut_admin: { enabled: true, params: { cut: 25 } },
    no_basic_income_non_citizens: { enabled: true, params: { groups: ["non_eu", "eu"] } },
    wealth_tax: { enabled: true, params: { rate: 1.5, threshold: 2000 } },
    raise_top_tax_rate: { enabled: false, params: { top_rate: 55 } },
    defense_target: { enabled: true, params: { share: 3 } },
  },
  level: "central",
};

describe("numbers", () => {
  it("are written without a decimal point and read back exactly", () => {
    const cases: [number, string][] = [
      [0, "0"],
      [42, "42"],
      [100, "100"],
      [1500, "1500"],
      [15000, "15e3"],
      [2000000, "2e6"],
      [1.5, "15e-1"],
      [0.25, "25e-2"],
      [-5, "-5"],
      [-0.5, "-5e-1"],
      [12345.678, "12345678e-3"],
      [1e21, "1e21"],
      [1e-7, "1e-7"],
    ];
    for (const [n, text] of cases) {
      expect(encodeNumber(n)).toBe(text);
      expect(decodeNumber(text)).toBe(n);
    }
  });

  it("round-trip every double", () => {
    const values = [0.1, 0.1 + 0.2, 1 / 3, Math.PI, 123456789.123, 5e-324, Number.MAX_VALUE, -Number.MIN_VALUE, 0.07, 99.99, 1e15 + 0.3];
    for (let i = 0; i < 200; i++) values.push((Math.sin(i) * 10) ** 7, i * 0.1, i / 7);
    for (const n of values) {
      const text = encodeNumber(n);
      expect(text).toMatch(/^-?\d+(e-?\d+)?$/);
      expect(decodeNumber(text)).toBe(n);
    }
  });

  it("reject anything that is not in the notation", () => {
    for (const text of ["", "abc", "1.5", "1e", "e5", "--1", "0x10", "Infinity", "1e+5", " 1"]) {
      expect(decodeNumber(text)).toBeNaN();
    }
  });
});

describe("encodeScenario", () => {
  it("writes enabled policies and the params that differ from their defaults", () => {
    expect(encodeScenario(full, testland)).toBe(
      "halve_mp_pay~cut_admin.cut.25~no_basic_income_non_citizens.groups.eu-non_eu~wealth_tax.rate.15e-1.threshold.2e3~defense_target~L.central",
    );
  });

  it("writes nothing for the empty scenario", () => {
    expect(encodeScenario(emptyScenario(), testland)).toBe("");
    expect(encodeScenario({ policies: { wealth_tax: { enabled: false, params: { rate: 3 } } }, level: "all" }, testland)).toBe("");
  });

  it("leaves out params that were set to their default value", () => {
    const scenario: Scenario = {
      policies: {
        wealth_tax: { enabled: true, params: { rate: 1, threshold: 1000 } },
        no_basic_income_non_citizens: { enabled: true, params: { groups: ["non_eu"] } },
      },
    };
    expect(encodeScenario(scenario, testland)).toBe("no_basic_income_non_citizens~wealth_tax");
  });

  it("writes the values the simulation would use: clamped, known groups only, pack order", () => {
    const scenario: Scenario = {
      policies: {
        wealth_tax: { enabled: true, params: { rate: 99 } },
        no_basic_income_non_citizens: { enabled: true, params: { groups: ["martians", "citizens"] } },
        cut_admin: { enabled: true, params: { cut: -3 } },
        no_such_policy: { enabled: true },
      },
    };
    expect(encodeScenario(scenario, testland)).toBe("cut_admin.cut.0~no_basic_income_non_citizens.groups.citizens~wealth_tax.rate.5");
  });

  it("writes an empty group selection", () => {
    const scenario: Scenario = { policies: { no_basic_income_non_citizens: { enabled: true, params: { groups: [] } } } };
    const encoded = encodeScenario(scenario, testland);
    expect(encoded).toBe("no_basic_income_non_citizens.groups.-");
    expect(decodeScenario(encoded, testland)).toEqual(scenario);
  });

  it("is URL-safe", () => {
    const encoded = encodeScenario(full, testland);
    expect(encoded).toMatch(URL_SAFE);
    expect(encodeURIComponent(encoded)).toBe(encoded);
    expect(new URL(`https://example.org/?s=${encoded}#${encoded}`).hash).toBe(`#${encoded}`);
    expect(new URL(`https://example.org/?s=${encoded}`).searchParams.get("s")).toBe(encoded);
  });

  it("without a pack writes every param it is given, in the given order", () => {
    expect(encodeScenario(full)).toBe(
      "halve_mp_pay~cut_admin.cut.25~no_basic_income_non_citizens.groups.non_eu-eu~wealth_tax.rate.15e-1.threshold.2e3~defense_target.share.3~L.central",
    );
    // The longer string means the same: explicit defaults are kept, the simulation does not change.
    expect(simulate(testland, decodeScenario(encodeScenario(full), testland))).toEqual(simulate(testland, full));
  });
});

describe("decodeScenario", () => {
  it("round-trips", () => {
    const decoded = decodeScenario(encodeScenario(full, testland), testland);
    expect(decoded).toEqual({
      policies: {
        halve_mp_pay: { enabled: true },
        cut_admin: { enabled: true, params: { cut: 25 } },
        no_basic_income_non_citizens: { enabled: true, params: { groups: ["eu", "non_eu"] } },
        wealth_tax: { enabled: true, params: { rate: 1.5, threshold: 2000 } },
        defense_target: { enabled: true },
      },
      level: "central",
    });
    // Same string again, and the same simulation as the scenario it came from.
    expect(encodeScenario(decoded, testland)).toBe(encodeScenario(full, testland));
    expect(simulate(testland, decoded)).toEqual(simulate(testland, full));
  });

  it("round-trips every single policy at non-default values", () => {
    const scenarios: Scenario[] = [
      { policies: { cut_admin: { enabled: true, params: { cut: 0 } } } },
      { policies: { wealth_tax: { enabled: true, params: { rate: 0.1, threshold: 4900 } } }, level: "state" },
      { policies: { raise_top_tax_rate: { enabled: true, params: { top_rate: 47 } } }, level: "social_security" },
      { policies: { defense_target: { enabled: true, params: { share: 2.3 } } } },
      { policies: { family_bonus: { enabled: true, params: { amount: 7 } }, halve_mp_pay: { enabled: true } } },
      { policies: { no_basic_income_non_citizens: { enabled: true, params: { groups: ["citizens", "eu", "non_eu"] } } } },
    ];
    for (const scenario of scenarios) {
      const encoded = encodeScenario(scenario, testland);
      expect(encoded).toMatch(URL_SAFE);
      const decoded = decodeScenario(encoded, testland);
      expect(simulate(testland, decoded)).toEqual(simulate(testland, scenario));
      expect(encodeScenario(decoded, testland)).toBe(encoded);
    }
  });

  it("reads the empty string as the empty scenario", () => {
    expect(decodeScenario("", testland)).toEqual({ policies: {} });
    expect(decodeScenario("   ", testland)).toEqual({ policies: {} });
  });

  it("ignores policies the pack does not know", () => {
    expect(decodeScenario("abolished_policy.rate.5~halve_mp_pay~another_one", testland)).toEqual({
      policies: { halve_mp_pay: { enabled: true } },
    });
  });

  it("ignores params the pack does not know and keeps the rest", () => {
    expect(decodeScenario("wealth_tax.exemption.5e5.rate.2.old_flag.1", testland)).toEqual({
      policies: { wealth_tax: { enabled: true, params: { rate: 2 } } },
    });
  });

  it("ignores groups and levels the pack does not know", () => {
    expect(decodeScenario("no_basic_income_non_citizens.groups.stateless-eu-martians~L.municipal", testland)).toEqual({
      policies: { no_basic_income_non_citizens: { enabled: true, params: { groups: ["eu"] } } },
    });
    // "local" is a valid level id, but Testland has no local level.
    expect(decodeScenario("L.local", testland).level).toBeUndefined();
    expect(decodeScenario("L.state", testland).level).toBe("state");
  });

  it("survives a pack update: links made for the old pack still load", () => {
    const link = encodeScenario(full, testland);
    const updated = testlandCopy();
    // The new pack dropped a policy, renamed a param, narrowed a range and removed a breakdown group.
    updated.policies = updated.policies.filter((policy) => policy.id !== "halve_mp_pay");
    const wealthTax = updated.policies.find((policy) => policy.id === "wealth_tax")!;
    wealthTax.params[0].id = "tax_rate";
    const schedule = wealthTax.effects[0];
    if (schedule.type === "schedule") schedule.reform.brackets[0].rate = { param: "tax_rate", scale: 0.01 };
    const cut = updated.policies.find((policy) => policy.id === "cut_admin")!.params[0];
    if (cut.type === "number") cut.max = 20;
    const social = updated.budget.expenditure[0];
    if ("children" in social) {
      const groups = social.children[1].breakdowns!.citizenship.groups;
      groups.splice(1, 1); // "eu" is gone
      groups[0].share = 0.7;
    }

    expect(decodeScenario(link, updated)).toEqual({
      policies: {
        cut_admin: { enabled: true, params: { cut: 20 } },
        no_basic_income_non_citizens: { enabled: true, params: { groups: ["non_eu"] } },
        wealth_tax: { enabled: true, params: { threshold: 2000 } },
        defense_target: { enabled: true },
      },
      level: "central",
    });
  });

  it("clamps numbers to the current range", () => {
    expect(decodeScenario("wealth_tax.rate.99.threshold.-5", testland).policies.wealth_tax.params).toEqual({ rate: 5, threshold: 0 });
  });

  it("does not choke on garbage", () => {
    const garbage = ["~~~", "...", "wealth_tax.", "wealth_tax.rate", "wealth_tax.rate.", "wealth_tax.rate.abc", "L", "L.", "%%%", "wealth_tax.rate.1.5", "<script>", "a=b&c=d", "äöü"];
    for (const text of garbage) {
      const decoded = decodeScenario(text, testland);
      expect(() => simulate(testland, decoded)).not.toThrow();
      for (const state of Object.values(decoded.policies)) expect(state.enabled).toBe(true);
    }
    // A value that cannot be read falls back to the default.
    expect(decodeScenario("wealth_tax.rate.abc.threshold.2e3", testland)).toEqual({
      policies: { wealth_tax: { enabled: true, params: { threshold: 2000 } } },
    });
    expect(decodeScenario("~~~", testland)).toEqual({ policies: {} });
  });

  it("accepts a string that was percent-encoded on the way", () => {
    const encoded = encodeScenario(full, testland);
    // URLSearchParams encodes "~" although it does not have to.
    const viaForm = new URLSearchParams({ s: encoded }).toString().slice(2);
    expect(viaForm).toContain("%7E");
    expect(decodeScenario(viaForm, testland)).toEqual(decodeScenario(encoded, testland));
  });
});
