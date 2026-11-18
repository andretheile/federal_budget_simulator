import { describe, expect, it } from "vitest";
import { testland } from "../engine/__fixtures__/testland.ts";
import { emptyScenario, simulate, type Scenario } from "../engine/index.ts";
import { buildHash, editorFromHash, parseHash, sameScenario, scenarioFromHash, stateToHash } from "./urlState.ts";

describe("hash fields", () => {
  it("round-trips country, language and scenario", () => {
    const fields = { country: "de", language: "de", scenario: "wealth_tax.rate.15e-1~mp_pay_cut~L.central" };
    const hash = buildHash(fields);
    expect(hash).toBe("#c=de&lang=de&s=wealth_tax.rate.15e-1~mp_pay_cut~L.central");
    expect(parseHash(hash)).toEqual(fields);
  });

  it("writes nothing for nothing, and leaves empty fields out", () => {
    expect(buildHash({})).toBe("");
    expect(buildHash({ language: "en", scenario: "" })).toBe("#lang=en");
  });

  it("reads with or without the leading #, percent-encoded or not, and ignores what it does not know", () => {
    expect(parseHash("lang=en&s=a~b")).toEqual({ language: "en", scenario: "a~b" });
    expect(parseHash("#lang=en&s=a%7Eb&utm_source=x&junk")).toEqual({ language: "en", scenario: "a~b" });
    expect(parseHash("")).toEqual({});
    expect(parseHash("#about")).toEqual({});
  });

  it("drops a language or country that could not be one", () => {
    expect(parseHash("#lang=<script>&c=../etc")).toEqual({});
  });

  it("carries the open curve editor as measure and parameter, and nothing that could not be that", () => {
    const fields = { language: "de", scenario: "income_tax_schedule", editor: "income_tax_schedule.schedule" };
    expect(buildHash(fields)).toBe("#lang=de&s=income_tax_schedule&e=income_tax_schedule.schedule");
    expect(parseHash(buildHash(fields))).toEqual(fields);
    for (const bad of ["income_tax_schedule", "a.b.c", "A.b", "a.<b>", ".b", "a."]) expect(parseHash(`#e=${bad}`)).toEqual({});
  });
});

describe("link state", () => {
  const scenario: Scenario = {
    policies: {
      wealth_tax: { enabled: true, params: { rate: 1.5, threshold: 2000 } },
      no_basic_income_non_citizens: { enabled: true, params: { groups: ["eu", "non_eu"] } },
      halve_mp_pay: { enabled: true },
      cut_admin: { enabled: false, params: { cut: 30 } },
    },
    level: "central",
  };

  it("reproduces a scenario and its language from the link", () => {
    const hash = stateToHash({ scenario, language: "de" }, testland);
    expect(parseHash(hash).language).toBe("de");
    const restored = scenarioFromHash(hash, testland);
    expect(sameScenario(restored, scenario, testland)).toBe(true);
    expect(restored.level).toBe("central");
    expect(restored.policies.wealth_tax).toEqual({ enabled: true, params: { rate: 1.5, threshold: 2000 } });
    expect(restored.policies.no_basic_income_non_citizens?.params).toEqual({ groups: ["eu", "non_eu"] });
    // What is switched off is not part of a link.
    expect(restored.policies.cut_admin).toBeUndefined();
    // And the restored scenario simulates to the same result.
    expect(simulate(testland, restored).reform).toEqual(simulate(testland, scenario).reform);
  });

  it("gives the same link for the same scenario, whatever the order it was built in", () => {
    const reordered: Scenario = {
      level: "central",
      policies: {
        halve_mp_pay: { enabled: true },
        no_basic_income_non_citizens: { enabled: true, params: { groups: ["non_eu", "eu"] } },
        wealth_tax: { enabled: true, params: { threshold: 2000, rate: 1.5 } },
      },
    };
    expect(stateToHash({ scenario: reordered, language: "de" }, testland)).toBe(
      stateToHash({ scenario, language: "de" }, testland),
    );
  });

  it("keeps the language when nothing is switched on", () => {
    const hash = stateToHash({ scenario: emptyScenario(), language: "en" }, testland);
    expect(hash).toBe("#lang=en");
    expect(scenarioFromHash(hash, testland)).toEqual(emptyScenario());
  });

  it("includes the country only when asked to", () => {
    expect(stateToHash({ scenario: emptyScenario(), language: "de", country: "xx" }, testland)).toBe("#c=xx&lang=de");
  });

  it("opens the curve editor the link names, if the pack has it", () => {
    const editor = { policy: "redraw_income_tax", param: "tariff" };
    const hash = stateToHash({ scenario: emptyScenario(), language: "en", editor }, testland);
    expect(hash).toBe("#lang=en&e=redraw_income_tax.tariff");
    expect(editorFromHash(hash, testland)).toEqual(editor);
    // Not a curve parameter, not a parameter of that measure, not a measure.
    expect(editorFromHash("#e=cut_admin.cut", testland)).toBeUndefined();
    expect(editorFromHash("#e=redraw_income_tax.cut", testland)).toBeUndefined();
    expect(editorFromHash("#e=no_such.tariff", testland)).toBeUndefined();
    expect(editorFromHash("#lang=en", testland)).toBeUndefined();
  });

  it("ignores what the pack does not know", () => {
    const restored = scenarioFromHash("#lang=de&s=no_such_policy~halve_mp_pay~L.moon", testland);
    expect(Object.keys(restored.policies)).toEqual(["halve_mp_pay"]);
    expect(restored.level).toBeUndefined();
  });
});
