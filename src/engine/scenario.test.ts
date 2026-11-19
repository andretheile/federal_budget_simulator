import { describe, expect, it } from "vitest";
import { testland, testlandCopy } from "./__fixtures__/testland.ts";
import { decodeNumber, decodeScenario, emptyScenario, encodeNumber, encodeScenario } from "./scenario.ts";
import { simulate, type Scenario } from "./simulate.ts";
import type { CountryPack, CurveParam, CurvePoint } from "./types.ts";

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
    if (schedule.type === "schedule" && "brackets" in schedule.reform) schedule.reform.brackets[0].rate = { param: "tax_rate", scale: 0.01 };
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

describe("curve params", () => {
  /** The fixture's curve param: x and y from 0 to 60, 1 to 6 points, default (10, 10), (30, 40). */
  const curveOn = (tariff: CurvePoint[], extra: Scenario["policies"] = {}): Scenario => ({
    policies: { ...extra, redraw_income_tax: { enabled: true, params: { tariff } } },
  });
  const decodedTariff = (text: string, pack: CountryPack = testland) => decodeScenario(text, pack).policies.redraw_income_tax?.params?.tariff;
  /** Testland with the curve param changed. */
  const withTariff = (change: (param: CurveParam) => void): CountryPack => {
    const pack = testlandCopy();
    change(pack.policies.find((policy) => policy.id === "redraw_income_tax")!.params[0] as CurveParam);
    return pack;
  };

  it("are written as x_y_x_y..., every coordinate in the dot-free number notation", () => {
    const steps = [{ x: 0, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 45 }, { x: 50, y: 55 }];
    expect(encodeScenario(curveOn(steps), testland)).toBe("redraw_income_tax.tariff.0_5_25_5_25_45_50_55");
    expect(encodeScenario(curveOn([{ x: 12.5, y: 23.97 }, { x: 40, y: 0.5 }]), testland)).toBe("redraw_income_tax.tariff.125e-1_2397e-2_40_5e-1");
    // A realistic tariff: large round numbers get shorter, not longer.
    const wide = withTariff((param) => {
      param.x.max = 2e6;
    });
    const tariff = [{ x: 12096, y: 14 }, { x: 68480, y: 42 }, { x: 277826, y: 42 }, { x: 277826, y: 45 }, { x: 1000000, y: 48 }];
    expect(encodeScenario(curveOn(tariff), wide)).toBe("redraw_income_tax.tariff.12096_14_68480_42_277826_42_277826_45_1e6_48");
  });

  it("are left out when the curve equals the default", () => {
    expect(encodeScenario(curveOn([{ x: 10, y: 10 }, { x: 30, y: 40 }]), testland)).toBe("redraw_income_tax");
    expect(encodeScenario({ policies: { redraw_income_tax: { enabled: true } } }, testland)).toBe("redraw_income_tax");
    // The same points in another order are the default too, because the simulation sorts them.
    expect(encodeScenario(curveOn([{ x: 30, y: 40 }, { x: 10, y: 10 }]), testland)).toBe("redraw_income_tax");
    // One coordinate off is not.
    expect(encodeScenario(curveOn([{ x: 10, y: 10 }, { x: 30, y: 41 }]), testland)).toBe("redraw_income_tax.tariff.10_10_30_41");
  });

  it("round-trip, together with everything else in a scenario", () => {
    const scenario: Scenario = {
      policies: {
        wealth_tax: { enabled: true, params: { rate: 1.5, threshold: 2000 } },
        no_basic_income_non_citizens: { enabled: true, params: { groups: ["eu", "non_eu"] } },
        redraw_income_tax: { enabled: true, params: { tariff: [{ x: 5, y: 12.5 }, { x: 20, y: 12.5 }, { x: 20, y: 30 }, { x: 45.5, y: 52 }] } },
      },
      level: "state",
    };
    const encoded = encodeScenario(scenario, testland);
    expect(encoded).toBe("no_basic_income_non_citizens.groups.eu-non_eu~wealth_tax.rate.15e-1.threshold.2e3~redraw_income_tax.tariff.5_125e-1_20_125e-1_20_30_455e-1_52~L.state");
    expect(encoded).toMatch(URL_SAFE);
    expect(encodeURIComponent(encoded)).toBe(encoded);
    const decoded = decodeScenario(encoded, testland);
    expect(decoded).toEqual(scenario);
    expect(encodeScenario(decoded, testland)).toBe(encoded);
    expect(simulate(testland, decoded)).toEqual(simulate(testland, scenario));
  });

  it("round-trip every coordinate exactly, steps and negative rates included", () => {
    const pack = withTariff((param) => {
      param.x.max = 1e7;
      param.y.min = -20;
      param.maxPoints = 12;
    });
    const curves: CurvePoint[][] = [
      [{ x: 0, y: -2.5 }, { x: 1e-3, y: 0 }, { x: 1 / 3, y: 1 / 7 }, { x: 99.99, y: 12.345678 }, { x: 99.99, y: -19.5 }, { x: 1234567.89, y: 59.999 }],
      [{ x: 0, y: 0 }],
      [{ x: 7, y: 7 }, { x: 7, y: 8 }, { x: 7, y: 9 }],
      Array.from({ length: 12 }, (_, i) => ({ x: i * 833333.25, y: (i * 4.9) % 60 })),
    ];
    for (const tariff of curves) {
      const encoded = encodeScenario(curveOn(tariff), pack);
      expect(encoded).toMatch(URL_SAFE);
      expect(decodedTariff(encoded, pack)).toEqual(tariff);
      expect(encodeScenario(decodeScenario(encoded, pack), pack)).toBe(encoded);
    }
  });

  it("write the curve the simulation would use: sorted and clamped", () => {
    const encoded = encodeScenario(curveOn([{ x: 99, y: 80 }, { x: 20, y: 30 }, { x: -5, y: 5 }]), testland);
    expect(encoded).toBe("redraw_income_tax.tariff.0_5_20_30_60_60");
    expect(decodedTariff(encoded)).toEqual([{ x: 0, y: 5 }, { x: 20, y: 30 }, { x: 60, y: 60 }]);
    // On the way in as well: a link from a pack with wider ranges is clamped to today's.
    expect(decodedTariff("redraw_income_tax.tariff.0_5_20_30_500_90")).toEqual([{ x: 0, y: 5 }, { x: 20, y: 30 }, { x: 60, y: 60 }]);
    expect(decodedTariff("redraw_income_tax.tariff.30_40_10_10_20_25")).toEqual([{ x: 10, y: 10 }, { x: 20, y: 25 }, { x: 30, y: 40 }]);
  });

  it("fall back to the default when the text cannot be read as a curve", () => {
    const malformed = ["10", "10_20_30", "a_b", "10_x", "10__20", "_10_20", "10_20_", "1.5_2", "10-20", "-", "", "__", "10_20_30_Infinity", "1e_2"];
    for (const text of malformed) {
      const decoded = decodeScenario(`redraw_income_tax.tariff.${text}`, testland);
      // The policy is on, the param is not set, so the simulation runs with the default curve.
      expect(decoded.policies.redraw_income_tax).toEqual({ enabled: true });
      expect(simulate(testland, decoded).delta.revenue).toBeCloseTo(125, 9);
    }
    // Other params of the same policy item are still read.
    expect(decodeScenario("wealth_tax.rate.abc.threshold.2e3~redraw_income_tax.tariff.zzz", testland)).toEqual({
      policies: { wealth_tax: { enabled: true, params: { threshold: 2000 } }, redraw_income_tax: { enabled: true } },
    });
  });

  it("fall back to the default when the number of points is not allowed", () => {
    // Seven points where the param allows six.
    expect(decodeScenario("redraw_income_tax.tariff.1_1_2_2_3_3_4_4_5_5_6_6_7_7", testland).policies.redraw_income_tax).toEqual({ enabled: true });
    expect(decodedTariff("redraw_income_tax.tariff.1_1_2_2_3_3_4_4_5_5_6_6")).toHaveLength(6);
    // No points at all, where at least one is needed.
    expect(decodeScenario("redraw_income_tax.tariff._", testland).policies.redraw_income_tax).toEqual({ enabled: true });
  });

  it("can carry a curve without points where the pack allows one", () => {
    const pack = withTariff((param) => {
      param.minPoints = 0;
    });
    const encoded = encodeScenario(curveOn([]), pack);
    expect(encoded).toBe("redraw_income_tax.tariff._");
    expect(encoded).toMatch(URL_SAFE);
    expect(decodeScenario(encoded, pack)).toEqual(curveOn([]));
    expect(simulate(pack, decodeScenario(encoded, pack)).nodes["rev.taxes.income"].reform).toBeCloseTo(0, 9);
  });

  it("survive a pack that changed the type of the param, in both directions", () => {
    // The link carries a curve; the pack now has a number param of that name.
    const numeric = testlandCopy();
    const policy = numeric.policies.find((candidate) => candidate.id === "redraw_income_tax")!;
    policy.params[0] = { id: "tariff", type: "number", label: { en: "Rate", de: "Satz" }, unit: "percent", min: 0, max: 60, step: 1, default: 25 };
    policy.effects = [{ type: "scale", target: "rev.taxes.income", factor: { param: "tariff", scale: 0.01, offset: 1 }, quality: "estimate" }];
    expect(decodeScenario("redraw_income_tax.tariff.0_5_25_45", numeric)).toEqual({ policies: { redraw_income_tax: { enabled: true } } });
    // The link carries a number or group ids; the pack has a curve param.
    expect(decodeScenario("redraw_income_tax.tariff.25", testland)).toEqual({ policies: { redraw_income_tax: { enabled: true } } });
    expect(decodeScenario("redraw_income_tax.tariff.eu-non_eu", testland)).toEqual({ policies: { redraw_income_tax: { enabled: true } } });
  });

  it("leave every link from before curves existed exactly as it was", () => {
    // Strings the encoder produced before this change, and what they have always decoded to.
    const old = "halve_mp_pay~cut_admin.cut.25~no_basic_income_non_citizens.groups.eu-non_eu~wealth_tax.rate.15e-1.threshold.2e3~defense_target~L.central";
    expect(decodeScenario(old, testland)).toEqual({
      policies: {
        halve_mp_pay: { enabled: true },
        cut_admin: { enabled: true, params: { cut: 25 } },
        no_basic_income_non_citizens: { enabled: true, params: { groups: ["eu", "non_eu"] } },
        wealth_tax: { enabled: true, params: { rate: 1.5, threshold: 2000 } },
        defense_target: { enabled: true },
      },
      level: "central",
    });
    expect(encodeScenario(decodeScenario(old, testland), testland)).toBe(old);
    for (const link of ["no_basic_income_non_citizens.groups.-", "wealth_tax.rate.5", "cut_admin.cut.0~no_basic_income_non_citizens.groups.citizens~wealth_tax.rate.5", "family_bonus.amount.7~L.social_security", ""]) {
      expect(encodeScenario(decodeScenario(link, testland), testland)).toBe(link);
    }
  });

  it("without a pack are recognised by their shape", () => {
    expect(encodeScenario(curveOn([{ x: 30, y: 40 }, { x: 10, y: 10 }]))).toBe("redraw_income_tax.tariff.30_40_10_10");
    expect(encodeScenario(curveOn([{ x: 10, y: 10 }, { x: 30, y: 40 }]))).toBe("redraw_income_tax.tariff.10_10_30_40");
  });
});

describe("several items for the same policy", () => {
  const decoded = (text: string) => decodeScenario(text, testland).policies;

  it("add up: a param the pack does not know leaves the valid ones of an earlier item (the reported case)", () => {
    expect(decoded("cut_admin.cut.20~cut_admin.nope.3")).toEqual({ cut_admin: { enabled: true, params: { cut: 20 } } });
  });

  it("two valid tokens for the same measure in two items both count", () => {
    expect(decoded("wealth_tax.rate.2~wealth_tax.threshold.2e3")).toEqual({ wealth_tax: { enabled: true, params: { rate: 2, threshold: 2000 } } });
  });

  it("of two readable values for the same param the later one wins, in one item or in two", () => {
    expect(decoded("cut_admin.cut.20~cut_admin.cut.30")).toEqual({ cut_admin: { enabled: true, params: { cut: 30 } } });
    expect(decoded("cut_admin.cut.20.cut.30")).toEqual({ cut_admin: { enabled: true, params: { cut: 30 } } });
  });

  it("a valid token after an invalid one counts, and an unreadable value does not replace a valid one", () => {
    expect(decoded("cut_admin.nope.3~cut_admin.cut.20")).toEqual({ cut_admin: { enabled: true, params: { cut: 20 } } });
    expect(decoded("wealth_tax.rate.abc~wealth_tax.rate.2")).toEqual({ wealth_tax: { enabled: true, params: { rate: 2 } } });
    expect(decoded("wealth_tax.rate.2~wealth_tax.rate.abc")).toEqual({ wealth_tax: { enabled: true, params: { rate: 2 } } });
    expect(decoded("wealth_tax.rate.2.rate.abc")).toEqual({ wealth_tax: { enabled: true, params: { rate: 2 } } });
  });

  it("an unknown measure between valid ones changes nothing", () => {
    expect(decoded("cut_admin.cut.20~abolished_policy.rate.5~cut_admin~halve_mp_pay")).toEqual({
      cut_admin: { enabled: true, params: { cut: 20 } },
      halve_mp_pay: { enabled: true },
    });
  });

  it("an item that only switches a measure on keeps the params of another item, before or after it", () => {
    expect(decoded("cut_admin~cut_admin.cut.20")).toEqual({ cut_admin: { enabled: true, params: { cut: 20 } } });
    expect(decoded("cut_admin.cut.20~cut_admin")).toEqual({ cut_admin: { enabled: true, params: { cut: 20 } } });
  });

  it("curves: an unreadable curve or one with a number of points the param does not allow leaves a valid one", () => {
    const valid = "redraw_income_tax.tariff.10_20_40_50";
    const expected = { redraw_income_tax: { enabled: true, params: { tariff: [{ x: 10, y: 20 }, { x: 40, y: 50 }] } } };
    // Seven points, where the param allows at most six.
    const tooMany = "redraw_income_tax.tariff.1_1_2_2_3_3_4_4_5_5_6_6_7_7";
    expect(decoded(`${valid}~${tooMany}`)).toEqual(expected);
    expect(decoded(`${tooMany}~${valid}`)).toEqual(expected);
    expect(decoded(`${valid}~redraw_income_tax.tariff.zzz`)).toEqual(expected);
    expect(decoded(`${valid}~redraw_income_tax.tariff.1_2_3`)).toEqual(expected);
    // Two valid curves: the later one wins.
    expect(decoded(`${valid}~redraw_income_tax.tariff.5_5`).redraw_income_tax.params?.tariff).toEqual([{ x: 5, y: 5 }]);
  });

  it("groups: a selection whose groups are all unknown leaves an earlier one; the empty selection is a value", () => {
    const id = "no_basic_income_non_citizens";
    expect(decoded(`${id}.groups.eu~${id}.groups.martians`)).toEqual({ [id]: { enabled: true, params: { groups: ["eu"] } } });
    expect(decoded(`${id}.groups.eu~${id}.groups.-`)).toEqual({ [id]: { enabled: true, params: { groups: [] } } });
    // On its own a selection of unknown groups is ignored like any unreadable value, so the default applies.
    expect(decoded(`${id}.groups.martians`)).toEqual({ [id]: { enabled: true } });
    // Known and unknown groups in one token: the known ones count.
    expect(decoded(`${id}.groups.martians-eu`)).toEqual({ [id]: { enabled: true, params: { groups: ["eu"] } } });
  });

  it("levels: the last level the pack has wins", () => {
    expect(decodeScenario("L.state~L.municipal", testland).level).toBe("state");
    expect(decodeScenario("L.state~L.central", testland).level).toBe("central");
  });
});
