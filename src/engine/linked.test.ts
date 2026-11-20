/**
 * The format additions of the measure audit: linked uncertainty (`uncertainty.basis`), shifts on
 * every kind of effect (knock-on effects), params marked as assumptions, and the warning for a
 * measure that is not zero at its base-year values.
 */
import { describe, expect, it } from "vitest";
import { testland, testlandCopy, testlandFiles } from "./__fixtures__/testland.ts";
import { simulate, simulatePolicy } from "./simulate.ts";
import type { CountryPack, Effect, LevelId } from "./types.ts";
import { validatePack } from "./validate.ts";

/** The raw files as plain JSON, to be broken on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests reach into arbitrary JSON
type Files = any;

const POLICY = "insure_civil_servants";
const indexOf = (id: string): number => testland.policies.findIndex((policy) => policy.id === id);

describe("uncertainty basis: effects that depend on one quantity vary together", () => {
  it("applies one multiplier to the group, the one worse for its sum, shift included", () => {
    const p = simulatePolicy(testland, POLICY)!;
    // +100 contributions, -15 income tax (30 % of the employees' 50), +50 employer's half.
    expect(p.delta.balance).toBeCloseTo(35, 9);
    // The group's sum is positive, so 0.8 is its bad end for every member; the shift's own
    // range (0.5 to 1.5) comes on top: 15 * 0.8 * 1.5 = 18 at the low end, 15 * 1.1 * 0.5 at the high end.
    const [contributions, employer] = p.effects;
    expect([contributions.low, contributions.high]).toEqual([80, expect.closeTo(110, 9)]);
    expect([employer.low, employer.high]).toEqual([40, expect.closeTo(55, 9)]);
    expect(contributions.shift?.low).toBeCloseTo(-18, 9);
    expect(contributions.shift?.high).toBeCloseTo(-8.25, 9);
    expect(p.low.balance).toBeCloseTo(22, 9);
    expect(p.high.balance).toBeCloseTo(46.75, 9);
  });

  it("has no range where the members cancel out", () => {
    // The state pays the whole contribution: +100 revenue, +100 spending, no employee half to deduct.
    const p = simulatePolicy(testland, POLICY, { employer_share: 100 })!;
    expect(p.delta.balance).toBeCloseTo(0, 9);
    expect(p.low.balance).toBeCloseTo(0, 9);
    expect(p.high.balance).toBeCloseTo(0, 9);
  });

  it("without a basis every effect is ordered on its own, as before", () => {
    const pack = testlandCopy();
    for (const effect of pack.policies[indexOf(POLICY)].effects) delete effect.uncertainty!.basis;
    const p = simulatePolicy(pack, POLICY, { employer_share: 100 })!;
    // Each effect takes its own bad end: 80 revenue against 110 spending, and the other way round.
    expect(p.low.balance).toBeCloseTo(-30, 9);
    expect(p.high.balance).toBeCloseTo(30, 9);
  });

  it("chooses the multiplier on the whole change, so the ranges of the levels add up", () => {
    const whole = simulatePolicy(testland, POLICY)!;
    const levels: LevelId[] = ["central", "state", "social_security"];
    const parts = levels.map((level) => simulatePolicy(testland, POLICY, undefined, level)!);
    for (const key of ["low", "delta", "high"] as const) {
      expect(parts.reduce((sum, part) => sum + part[key].balance, 0)).toBeCloseTo(whole[key].balance, 9);
    }
    // The states only pay (80 % of the employer's half, half of the lost tax), yet their low end is
    // the same case as the whole: wages 20 % lower, everything 0.8.
    const state = parts[1];
    expect(state.low.balance).toBeCloseTo(-0.8 * 40 - 0.8 * 1.5 * 7.5, 9);
  });

  it("keeps low <= high for every combination of signs and multipliers", () => {
    const pack = testlandCopy();
    const policy = pack.policies[indexOf(POLICY)];
    for (const low of [0.5, 1, 1.5]) {
      for (const high of [0.5, 1, 1.5]) {
        for (const effect of policy.effects) effect.uncertainty = { low, high, basis: "wages" };
        for (const share of [50, 75, 100]) {
          const p = simulatePolicy(pack, POLICY, { employer_share: share })!;
          expect(p.low.balance).toBeLessThanOrEqual(p.high.balance + 1e-9);
        }
      }
    }
  });
});

describe("shift on every kind of effect (knock-on effects)", () => {
  it("passes on a share of an `add` with the opposite sign, with the shift's own quality", () => {
    const p = simulatePolicy(testland, POLICY)!;
    expect(p.effects[0].shift).toMatchObject({ target: "rev.taxes.income", side: "revenue", quality: "estimate" });
    expect(p.effects[0].shift?.delta).toBeCloseTo(-15, 9);
    expect(p.delta.revenue).toBeCloseTo(85, 9);
  });

  it("follows a `schedule` and a `set`", () => {
    const pack = testlandCopy();
    // raise_top_tax_rate: +125 income tax; a fifth of it comes back as less social contributions.
    pack.policies[indexOf("raise_top_tax_rate")].effects[0].shift = { to: "rev.social_contributions", ratio: 0.2 };
    const schedule = simulatePolicy(pack, "raise_top_tax_rate")!;
    expect(schedule.effects[0].delta).toBeCloseTo(125, 9);
    expect(schedule.effects[0].shift?.delta).toBeCloseTo(-25, 9);
    // defense_target sets defence from 200 to 300; half of the extra 100 is saved on health.
    pack.policies[indexOf("defense_target")].effects[0].shift = { to: "exp.health", ratio: 0.5, quality: "derived" };
    const set = simulatePolicy(pack, "defense_target")!;
    expect(set.effects[0].shift).toMatchObject({ delta: -50, quality: "derived" });
    expect(set.delta.balance).toBeCloseTo(-50, 9);
  });

  it("is checked like any other shift, and its texts and sources like any others", () => {
    const files = testlandFiles() as Files;
    const shift = files.policies.policies[indexOf(POLICY)].effects[0].shift;
    shift.sources = ["nope"];
    delete shift.label.de;
    shift.to = "rev.social_contributions";
    const messages = (validatePack(files) as { errors: { path: string; message: string }[] }).errors.map((e) => `${e.path}: ${e.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/shift\.sources\[0\]: .*nope/),
        expect.stringMatching(/shift\.label: .*de/),
        expect.stringMatching(/shift\.to: .*own target/),
      ]),
    );
  });
});

describe("validation of the additions", () => {
  const at = `$.policies[${indexOf(POLICY)}]`;

  it("the fixture is valid without warnings", () => {
    expect(validatePack(testlandFiles())).toMatchObject({ ok: true, warnings: [] });
  });

  it("effects with one basis must state the same multipliers", () => {
    const files = testlandFiles() as Files;
    files.policies.policies[indexOf(POLICY)].effects[1].uncertainty = { low: 0.9, high: 1.1, basis: "wages" };
    const result = validatePack(files) as { ok: boolean; errors: { path: string; message: string }[] };
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { file: "policies.json", path: `${at}.effects[1].uncertainty`, message: expect.stringMatching(/basis "wages" must have the same low and high/) },
    ]);
  });

  it("a basis is an id, and only effects may have one", () => {
    const files = testlandFiles() as Files;
    files.policies.policies[indexOf(POLICY)].effects[1].uncertainty.basis = "Wages";
    expect(validatePack(files).ok).toBe(false);
    const again = testlandFiles() as Files;
    again.policies.policies[indexOf(POLICY)].effects[0].shift.uncertainty.basis = "wages";
    expect(validatePack(again).ok).toBe(false);
  });

  it("warns about a basis that ties nothing together", () => {
    const files = testlandFiles() as Files;
    files.policies.policies[indexOf("wealth_tax")].effects[0].uncertainty.basis = "alone";
    expect(validatePack(files).warnings).toEqual([
      {
        file: "policies.json",
        path: `$.policies[${indexOf("wealth_tax")}].effects[0].uncertainty.basis`,
        message: expect.stringMatching(/ties nothing together/),
      },
    ]);
    // An effect with a shift may have a basis of its own: it ties the shift to the effect.
    const shifted = testlandFiles() as Files;
    shifted.policies.policies[indexOf("cut_pensions")].effects[0].uncertainty.basis = "pensions";
    expect(validatePack(shifted)).toMatchObject({ ok: true, warnings: [] });
  });

  it("role: only \"assumption\", and an assumption has no base-year value", () => {
    const files = testlandFiles() as Files;
    const fallback = files.policies.policies[indexOf("cut_pensions")].params[1];
    expect(fallback.role).toBe("assumption");
    fallback.baseline = 0;
    expect(validatePack(files).warnings).toEqual([
      expect.objectContaining({ path: `$.policies[${indexOf("cut_pensions")}].params[1].baseline`, message: expect.stringMatching(/is an assumption/) }),
    ]);
    fallback.role = "lever";
    expect(validatePack(files).ok).toBe(false);
  });
});

describe("warning: a measure that is not zero at its base-year values", () => {
  const warningsOf = (mutate: (files: Files) => void) => {
    const files = testlandFiles() as Files;
    mutate(files);
    return validatePack(files).warnings;
  };

  it("fires when the params at their baselines still change the budget", () => {
    // Defence: the baseline says 2 % of GDP today, but the budget holds 200 = 2 %. Claim 2.5 % instead.
    const warnings = warningsOf((f) => (f.policies.policies[indexOf("defense_target")].params[0].baseline = 2.5));
    expect(warnings).toEqual([
      {
        file: "policies.json",
        path: `$.policies[${indexOf("defense_target")}]`,
        message: expect.stringMatching(/policy "defense_target" still changes the balance by -50/),
      },
    ]);
  });

  it("fires for an effect that does not depend on the params", () => {
    const extra: Effect = { type: "add", target: "exp.health", amount: 1, quality: "estimate" };
    const warnings = warningsOf((f) => f.policies.policies[indexOf("wealth_tax")].effects.push(extra));
    expect(warnings.map((w) => w.path)).toEqual([`$.policies[${indexOf("wealth_tax")}]`]);
  });

  it("does not fire for a measure without base-year values, nor for rounding noise", () => {
    // cut_admin has no baseline: a constant effect there is a choice, not a mistake.
    expect(warningsOf((f) => f.policies.policies[indexOf("cut_admin")].effects.push({ type: "add", target: "exp.health", amount: 1, quality: "estimate" }))).toEqual([]);
    // A thousandth of a currency unit is below the noise level.
    expect(warningsOf((f) => (f.policies.policies[indexOf("defense_target")].params[0].baseline = 2 + 1e-12))).toEqual([]);
  });

  it("checks the real pack figures in the same units as the card", () => {
    const pack: CountryPack = testlandCopy();
    const r = simulate(pack, { policies: { defense_target: { enabled: true, params: { share: 2 } } } });
    expect(r.delta.balance).toBe(0);
  });
});
