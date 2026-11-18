import { describe, expect, it } from "vitest";
import { curveAffected, curveAverageRate, curveOwed, curveRate, curveTotal, payMoreOrLess, scheduleBands, type ScheduleBand } from "./curve.ts";
import { resolveParams, scheduleView, simulate, type ParamValue, type Scenario } from "./simulate.ts";
import type {
  CurveParam,
  CurvePoint,
  Distribution,
  DistributionBin,
  Effect,
  GroupNode,
  LeafNode,
  LevelId,
  LocalizedText,
  Policy,
  ScheduleEffect,
} from "./types.ts";
import { validatePack } from "./validate.ts";

/**
 * A synthetic pack of realistic size: 300 leaves in 375 nodes, 15 policies with 20 effects
 * (four of them with a shift, one with a 12-point curve param), 3 distributions of 40 bins each
 * with a Pareto tail.
 */
const t = (en: string): LocalizedText => ({ en });
const LEVELS: LevelId[] = ["central", "state", "local", "social_security"];
const AGES = ["a", "b", "c", "d", "e", "f"];

function leaf(id: string, n: number): LeafNode {
  const node: LeafNode = {
    id,
    label: t(id),
    amount: (1 + (n % 17)) * 1.37e9,
    levels: { [LEVELS[n % 4]]: 0.75, [LEVELS[(n + 1) % 4]]: 0.25 },
    quality: "official",
    sources: ["s"],
  };
  if (n % 5 === 0) {
    node.breakdowns = {
      age: {
        label: t("age"),
        basis: "spending",
        groups: AGES.map((age, i) => ({ id: age, label: t(age), share: [0.3, 0.25, 0.2, 0.15, 0.05, 0.05][i] })),
        quality: "estimate",
        sources: ["s"],
      },
    };
  }
  return node;
}

function side(prefix: "rev" | "exp", groups: number): GroupNode[] {
  let n = 0;
  return Array.from({ length: groups }, (_, g): GroupNode => ({
    id: `${prefix}.g${g}`,
    label: t(`group ${g}`),
    children: Array.from({ length: 4 }, (_, s): GroupNode => ({
      id: `${prefix}.g${g}.s${s}`,
      label: t(`subgroup ${s}`),
      children: Array.from({ length: 5 }, (_, l) => leaf(`${prefix}.g${g}.s${s}.l${l}`, n++)),
    })),
  }));
}

function distribution(id: string, scale: number): Distribution {
  const bins: DistributionBin[] = [];
  let from = 0;
  for (let i = 0; i < 40; i++) {
    const to = from + scale * (1 + i * 0.5);
    bins.push({ from, to, count: 1e6 * Math.exp(-i / 9), mean: from + (to - from) * 0.42 });
    from = to;
  }
  return { id, label: t(id), variable: t("x"), unit: t("units"), year: 2024, bins, tail: { from, count: 5e4, alpha: 1.6 }, quality: "estimate", sources: ["s"] };
}

const percent = (id: string, def: number, max = 100) =>
  ({ id, type: "number", label: t(id), unit: "percent", min: 0, max, step: 0.1, default: def }) as const;
const currency = (id: string, def: number, max: number) =>
  ({ id, type: "number", label: t(id), unit: "currency", min: 0, max, step: 1, default: def }) as const;

function policy(id: string, rest: Pick<Policy, "params" | "effects">): Policy {
  return { id, label: t(id), summary: t(id), topic: "other", catches: [], sources: [], ...rest };
}

/** A 12-point tariff that changes with `i`, the way a curve changes while a point is dragged. */
function tariffAt(i: number): CurvePoint[] {
  return Array.from({ length: 12 }, (_, k) => ({
    x: k < 6 ? 8000 + k * 9000 + ((i * 37) % 4000) : 60000 + (k - 6) * 70000 + ((i * 53) % 30000),
    y: Math.min(60, 10 + k * 3.5 + ((i * 7 + k * 3) % 5)),
  }));
}

const BASELINE_BRACKETS = [10000, 20000, 40000, 80000, 160000, 320000].map((from, k) => ({ from, rate: 0.1 + k * 0.06 }));

function policies(): Policy[] {
  const out: Policy[] = [];
  // 1 calibrated schedule whose reform is a 12-point curve param
  const tariff: CurveParam = {
    id: "tariff",
    type: "curve",
    label: t("tariff"),
    x: { unit: "currency", min: 0, max: 600000, step: 100 },
    y: { unit: "percent", min: 0, max: 60, step: 0.1 },
    default: tariffAt(0),
  };
  out.push(
    policy("curve_0", {
      params: [tariff],
      effects: [
        {
          type: "schedule",
          target: "rev.g0",
          distribution: "d0",
          baseline: { brackets: BASELINE_BRACKETS },
          reform: { curve: { param: "tariff", scale: 0.01 } },
          yield: 0.85,
          quality: "estimate",
          uncertainty: { low: 0.6, high: 1.1 },
        },
      ],
    }),
  );
  // 2 calibrated schedules with six brackets, two of them moved by params
  for (let i = 1; i < 3; i++) {
    out.push(
      policy(`calibrated_${i}`, {
        params: [percent("top", 48, 80), currency("start", 60000, 500000)],
        effects: [
          {
            type: "schedule",
            target: `rev.g${i}`,
            distribution: `d${i}`,
            baseline: { brackets: BASELINE_BRACKETS },
            reform: {
              brackets: [
                { from: 10000, rate: 0.1 },
                { from: 20000, rate: 0.16 },
                { from: 40000, rate: 0.22 },
                { from: { param: "start" }, rate: 0.3 },
                { from: { param: "start", scale: 2 }, rate: 0.36 },
                { from: { param: "start", scale: 5, offset: 1 }, rate: { param: "top", scale: 0.01 } },
              ],
            },
            yield: 0.85,
            quality: "estimate",
            uncertainty: { low: 0.6, high: 1.1 },
          },
        ],
      }),
    );
  }
  // 2 absolute schedules
  for (let i = 0; i < 2; i++) {
    out.push(
      policy(`absolute_${i}`, {
        params: [percent("rate", 1, 10), currency("allowance", 150000, 2000000)],
        effects: [
          {
            type: "schedule",
            target: `rev.g4.s${i}.l0`,
            distribution: "d2",
            reform: { brackets: [{ from: { param: "allowance" }, rate: { param: "rate", scale: 0.01 } }, { from: { param: "allowance", scale: 10, offset: 1 }, rate: { param: "rate", scale: 0.02 } }] },
            quality: "estimate",
          },
        ],
      }),
    );
  }
  // 4 cuts of whole top-level groups (20 leaves each), each with a second effect
  for (let i = 0; i < 4; i++) {
    out.push(
      policy(`cut_${i}`, {
        params: [percent("cut", 5, 50)],
        effects: [
          {
            type: "scale",
            target: `exp.g${i}`,
            factor: { param: "cut", scale: -0.01, offset: 1 },
            quality: "estimate",
            // part of every cut reappears in a group of five leaves elsewhere
            shift: { to: `exp.g${9 - i}.s1`, ratio: 0.3, uncertainty: { low: 0.5, high: 1.5 } },
          },
          { type: "add", target: `exp.g${i}.s0`, amount: { param: "cut", scale: 1e6 }, quality: "estimate", uncertainty: { low: 0.5, high: 2 } },
        ],
      }),
    );
  }
  // 3 exclusions, one of them on two nodes
  for (let i = 0; i < 3; i++) {
    const target = `exp.g${4 + i}.s0.l0`; // leaves 80, 100, 120: all have the breakdown
    const effects: Effect[] = [
      { type: "excludeGroups", target, breakdown: "age", groups: { param: "who" }, retained: 0.1, quality: "estimate" },
    ];
    if (i === 0) effects.push({ type: "excludeGroups", target: "exp.g4.s1.l0", breakdown: "age", groups: ["a"], quality: "estimate" });
    out.push(
      policy(`exclude_${i}`, {
        params: [{ id: "who", type: "groups", label: t("who"), node: target, breakdown: "age", default: ["e", "f"] }],
        effects,
      }),
    );
  }
  // 3 direct changes
  out.push(policy("add_group", { params: [currency("amount", 2e9, 1e11)], effects: [{ type: "add", target: "exp.g8", amount: { param: "amount" }, quality: "estimate" }] }));
  out.push(policy("set_gdp", { params: [percent("share", 2, 5)], effects: [{ type: "set", target: "exp.g9.s3.l4", amount: { param: "share", scale: 0.01, times: "gdp" }, quality: "official" }] }));
  out.push(policy("per_head", { params: [currency("amount", 100, 1000)], effects: [{ type: "add", target: "exp.g9.s0", amount: { param: "amount", times: "population" }, quality: "derived" }] }));
  return out;
}

function bigPack() {
  const result = validatePack({
    country: {
      id: "zz",
      name: t("Bigland"),
      currency: "XTS",
      locales: ["en"],
      baseYear: 2024,
      levels: Object.fromEntries(LEVELS.map((level) => [level, { name: t(level) }])),
      indicators: {
        gdp: { value: 4e12, quality: "official", sources: ["s"] },
        population: { value: 8e7, quality: "official", sources: ["s"] },
      },
    },
    budget: { revenue: side("rev", 5), expenditure: side("exp", 10) },
    policies: { policies: policies() },
    sources: { s: { title: "s", publisher: "s", url: "https://example.org", accessed: "2025-01-01" } },
    distributions: { d0: distribution("d0", 2500), d1: distribution("d1", 4000), d2: distribution("d2", 20000) },
  });
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join("\n"));
  return result.pack;
}

describe("performance", () => {
  const pack = bigPack();

  /** Everything switched on, with params that change from call to call like sliders being dragged. */
  const scenario = (i: number): Scenario => {
    const policies: Scenario["policies"] = {};
    for (const p of pack.policies) {
      const params: Record<string, ParamValue> = {};
      for (const param of p.params) {
        if (param.type === "number") params[param.id] = param.min + ((i * 7 + param.id.length) % 100) * 0.01 * (param.max - param.min);
        else if (param.type === "curve") params[param.id] = tariffAt(i);
        else params[param.id] = AGES.filter((_, k) => (i + k) % 3 === 0);
      }
      policies[p.id] = { enabled: true, params };
    }
    return { policies, level: i % 5 === 0 ? LEVELS[i % 4] : "all" };
  };

  it("the synthetic pack has the intended size", () => {
    const result = simulate(pack, scenario(1));
    expect(Object.keys(result.nodes)).toHaveLength(375);
    expect(Object.values(result.nodes).filter((node) => node.isLeaf)).toHaveLength(300);
    expect(result.policies).toHaveLength(15);
    expect(Object.values(pack.distributions).map((d) => d.bins.length)).toEqual([40, 40, 40]);
    // The run is not trivial: every policy moves the budget.
    for (const p of result.policies) expect(p.delta.balance).not.toBe(0);
    expect(result.policies.flatMap((p) => p.effects).filter((e) => e.shift && e.shift.delta !== 0)).toHaveLength(4);
    expect(result.reform.balance - result.baseline.balance).toBeCloseTo(result.delta.balance, 0);
  });

  it("simulates in well under 5 ms on average", () => {
    const scenarios = Array.from({ length: 100 }, (_, i) => scenario(i));
    for (let i = 0; i < 300; i++) simulate(pack, scenarios[i % scenarios.length]); // warm-up
    const runs = 3000;
    let checksum = 0;
    const start = performance.now();
    for (let i = 0; i < runs; i++) checksum += simulate(pack, scenarios[i % scenarios.length]).reform.balance;
    const average = (performance.now() - start) / runs;
    console.info(`simulate: ${(average * 1000).toFixed(1)} µs on average over ${runs} runs (375 nodes, 15 policies, 3 x 40 bins)`);
    expect(Number.isFinite(checksum)).toBe(true);
    expect(average).toBeLessThan(1);
  });

  it("the curve helpers are fast enough to redraw on every pointer move", () => {
    // Everything a tariff editor shows for one frame: both curves, the model totals, the histogram
    // behind the curve, who pays more or less, the affected units, and 200 samples each of the
    // marginal rate, the average rate and what a unit owes for the lines on screen.
    const curvePolicy = pack.policies.find((p) => p.id === "curve_0")!;
    const effect = curvePolicy.effects[0] as ScheduleEffect;
    const curves = Array.from({ length: 100 }, (_, i) => tariffAt(i));
    const bands: ScheduleBand[] = [];
    let checksum = 0;
    const frame = (i: number): void => {
      const params = resolveParams(pack, curvePolicy, { tariff: curves[i % curves.length] });
      const view = scheduleView(pack, effect, params);
      checksum += curveTotal(view.distribution, view.reform) + curveTotal(view.distribution, view.baseline!);
      checksum += scheduleBands(view.distribution, view.reform, view.baseline, undefined, bands).length;
      checksum += payMoreOrLess(view.distribution, view.reform, view.baseline).more;
      checksum += curveAffected(view.distribution, view.reform, view.baseline).units;
      for (let k = 0; k < 200; k++) {
        const v = k * 3000;
        checksum += curveRate(view.reform, v) + curveAverageRate(view.reform, v) + curveOwed(view.baseline!, v);
      }
    };
    for (let i = 0; i < 300; i++) frame(i); // warm-up
    const runs = 3000;
    const start = performance.now();
    for (let i = 0; i < runs; i++) frame(i);
    const average = (performance.now() - start) / runs;
    console.info(`curve helpers: ${(average * 1000).toFixed(1)} µs per frame on average over ${runs} frames (40 bins and a tail, 12-point curve, 11-point baseline)`);
    expect(Number.isFinite(checksum)).toBe(true);
    expect(bands).toHaveLength(41);
    expect(average).toBeLessThan(0.3);
  });
});
