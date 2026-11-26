/**
 * Who pays: the revenue of the budget spread over the income groups of incidence.json and over the
 * payers outside them, today and with the measures of a simulation.
 *
 * Every revenue leaf has an entry in incidence.json (its own or its nearest ancestor's): `coverage`
 * of its amount is spread by the entry's profile (over the groups, and over payers where the
 * profile names some), the rest goes to the entry's payer. Today's
 * amounts are the base amounts spread that way. A change that a measure makes at a revenue node is
 * spread leaf by leaf, in this order:
 *   1. by the effect's (or shift's) own `incidence`: a profile, or a payer that takes all of it;
 *   2. for a `schedule` effect on a distribution that incidence.json names: computed from the
 *      distribution, split at the values that hold the groups' shares of its units, scaled to the
 *      effect's actual change;
 *   3. like the node's amount: coverage to the groups by the profile, the rest to the payer.
 * Rules 1 and 2 spread the whole change. A `schedule` effect with `incidenceAbove` is split first:
 * the change from the rates at or above its threshold goes by the profile or payer named there, the
 * rest by the rules above. `incidenceShare` takes a part of the change, set by a value that may follow
 * a param, for a profile or payer of its own, and the rest is spread as without it. A change that is
 * zero in all spreads nothing. Changes of spending are
 * never counted. As every change
 * lands somewhere and the simulation's changes add up to its result, the groups and payers add up
 * to the budget's revenue today and with the measures.
 *
 * `whoPays` expects a pack that passed validatePack, and a simulation of the whole budget (level
 * "all"). The pack's preparation is cached by object identity, like the simulation's.
 */
import { curveRate, curveTotal, scheduleBands, type RateCurve } from "./curve.ts";
import { valueAtShare } from "./distribution.ts";
import { evaluateValue, scheduleView, type EffectResult, type PolicyResult, type SimulationResult } from "./simulate.ts";
import type { BudgetNode, CountryPack, Distribution, Effect, IncidenceFile, Policy, ScheduleEffect } from "./types.ts";

/** An amount today and with the measures. */
export interface Amounts {
  today: number;
  reform: number;
}

export interface WhoPaysGroup {
  id: string;
  today: number;
  reform: number;
  /** reform - today */
  delta: number;
  /** Share of the scope's amount that the groups pay together, today. */
  shareToday: number;
  /** The same with the measures. */
  shareReform: number;
  /** Units in the group: the population's count times the group's share. */
  units: number;
  /** delta / units */
  deltaPerUnit: number;
  /** The group's share of all income (incidence.json income.shares). */
  incomeShare: number;
  /** `today` as a share of the group's income; only where incidence.json gives income.total. */
  rateToday?: number;
  /** `reform` as a share of the group's income; only with income.total. */
  rateReform?: number;
}

export interface WhoPaysPayer extends Amounts {
  id: string;
}

/** What the chart of one scope adds up. */
export interface WhoPaysScope {
  id: string;
  /** All revenue of the scope's nodes. */
  total: Amounts;
  /** The part of it spread over the groups: the sum of `groups`. */
  groupsTotal: Amounts;
  groups: WhoPaysGroup[];
  /** The rest of the scope, by payer in the order of incidence.json; payers with nothing in the scope are left out. */
  payers: WhoPaysPayer[];
}

/** One node of a statement line: an entry of incidence.json `nodes`, with what of it lands on the line. */
export interface WhoPaysItem extends Amounts {
  node: string;
}

/** A line of the statement of all revenue: the income groups together, or one payer. */
export interface WhoPaysLine extends Amounts {
  /** Absent for the line of the income groups. */
  payer?: string;
  /** The nodes the line consists of, in budget order; nodes with nothing on the line are left out. */
  items: WhoPaysItem[];
}

/** What one measure changes for whom. Amounts are changes per year, positive where somebody pays more. */
export interface MeasureWhoPays {
  policy: string;
  /** Change for each group, over all revenue, in group order. */
  groups: number[];
  /** Change for each payer that changes, over all revenue, by payer id. */
  payers: Record<string, number>;
  /** The same for each scope, by scope id. */
  scopes: Record<string, { groups: number[]; payers: Record<string, number> }>;
}

export interface WhoPays {
  /** In the order of incidence.json; the first is what the page opens with. */
  scopes: WhoPaysScope[];
  /** All revenue: equals the simulation's revenue today and with the measures. */
  statement: Amounts & { lines: WhoPaysLine[] };
  /** One entry per enabled measure, in the order of the simulation's policies. */
  measures: MeasureWhoPays[];
}

// ---------------------------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------------------------

interface LeafInfo {
  id: string;
  amount: number;
  /** The node entry's spread of one unit: groups first, then payers. Sums to 1. */
  spread: Float64Array;
  /** Id of the node entry the leaf takes its spread from. */
  item: string;
  /** Per scope: whether the leaf lies in it. */
  scopes: boolean[];
}

interface Prepared {
  file: IncidenceFile;
  groupCount: number;
  /** Groups, then payers: the length of every spread. */
  slots: number;
  payerSlot: Map<string, number>;
  /** Profile and payer ids -> the spread of a change they take whole. */
  own: Map<string, Float64Array>;
  /** Revenue leaves in budget order. */
  leaves: LeafInfo[];
  leaf: Map<string, LeafInfo>;
  /** Revenue node id -> its leaves. */
  nodeLeaves: Map<string, LeafInfo[]>;
  /** Item (node entry id) -> position in budget order. */
  itemOrder: Map<string, number>;
  policies: Map<string, Policy>;
}

const prepared = new WeakMap<CountryPack, Prepared>();

function prepare(pack: CountryPack, file: IncidenceFile): Prepared {
  const cached = prepared.get(pack);
  if (cached) return cached;
  const groupCount = file.groups.length;
  const payers = file.payers ?? [];
  const slots = groupCount + payers.length;
  const payerSlot = new Map(payers.map((payer, i) => [payer.id, groupCount + i]));

  const profileSpread = (id: string): Float64Array => {
    const out = new Float64Array(slots);
    const profile = file.profiles[id];
    for (let g = 0; g < groupCount; g++) out[g] = profile?.shares[g] ?? 0;
    for (const [payer, part] of Object.entries(profile?.payers ?? {})) {
      const slot = payerSlot.get(payer);
      if (slot !== undefined) out[slot] += part;
    }
    return out;
  };
  const own = new Map<string, Float64Array>();
  for (const id of Object.keys(file.profiles)) own.set(id, profileSpread(id));
  for (const [id, slot] of payerSlot) {
    const out = new Float64Array(slots);
    out[slot] = 1;
    own.set(id, out);
  }

  const entrySpread = new Map<string, Float64Array>();
  const spreadOf = (id: string): Float64Array => {
    let spread = entrySpread.get(id);
    if (spread) return spread;
    const entry = file.nodes[id];
    const coverage = entry.coverage ?? (entry.profile !== undefined ? 1 : 0);
    spread = new Float64Array(slots);
    if (entry.profile !== undefined) {
      const profile = own.get(entry.profile)!;
      for (let k = 0; k < slots; k++) spread[k] = coverage * profile[k];
    }
    const slot = entry.payer === undefined ? undefined : payerSlot.get(entry.payer);
    if (slot !== undefined) spread[slot] += 1 - coverage;
    entrySpread.set(id, spread);
    return spread;
  };

  const leaves: LeafInfo[] = [];
  const nodeLeaves = new Map<string, LeafInfo[]>();
  const itemOrder = new Map<string, number>();
  const visit = (node: BudgetNode, entry: string | undefined, scopes: boolean[]): LeafInfo[] => {
    const entryId = Object.hasOwn(file.nodes, node.id) ? node.id : entry;
    const inScopes = file.scopes.map((scope, s) => scopes[s] || scope.nodes.includes(node.id));
    let below: LeafInfo[];
    if ("children" in node) {
      below = node.children.flatMap((child) => visit(child, entryId, inScopes));
    } else {
      // Validation makes sure that every revenue leaf has an entry; one without spreads to nobody.
      const info: LeafInfo = {
        id: node.id,
        amount: node.amount,
        spread: entryId === undefined ? new Float64Array(slots) : spreadOf(entryId),
        item: entryId ?? node.id,
        scopes: inScopes,
      };
      if (!itemOrder.has(info.item)) itemOrder.set(info.item, itemOrder.size);
      leaves.push(info);
      below = [info];
    }
    nodeLeaves.set(node.id, below);
    return below;
  };
  for (const node of pack.budget.revenue) visit(node, undefined, file.scopes.map(() => false));

  const result: Prepared = {
    file,
    groupCount,
    slots,
    payerSlot,
    own,
    leaves,
    leaf: new Map(leaves.map((info) => [info.id, info])),
    nodeLeaves,
    itemOrder,
    policies: new Map(pack.policies.map((policy) => [policy.id, policy])),
  };
  prepared.set(pack, result);
  return result;
}

/** The values that cut a distribution into the groups' shares of its units, from its lowest value on. */
const edgeCache = new WeakMap<Distribution, Map<IncidenceFile, number[]>>();

function groupEdges(dist: Distribution, file: IncidenceFile): number[] {
  let byFile = edgeCache.get(dist);
  if (!byFile) edgeCache.set(dist, (byFile = new Map()));
  let edges = byFile.get(file);
  if (!edges) {
    edges = [dist.bins[0].from];
    let below = 0;
    for (let g = 0; g < file.groups.length - 1; g++) {
      below += file.groups[g].share;
      edges.push(valueAtShare(dist, below));
    }
    byFile.set(file, edges);
  }
  return edges;
}

// ---------------------------------------------------------------------------------------------
// Spreading the changes of one measure
// ---------------------------------------------------------------------------------------------

/** Receives one leaf's part of a change, spread over the slots. */
type Sink = (leaf: LeafInfo, amounts: Float64Array) => void;

/** The leaves a change at `node` fell on, with their changes. */
function leafChanges(prep: Prepared, node: string, delta: number, recorded: Record<string, number> | undefined): [LeafInfo, number][] {
  if (recorded) {
    const out: [LeafInfo, number][] = [];
    for (const [id, change] of Object.entries(recorded)) {
      const info = prep.leaf.get(id);
      if (info) out.push([info, change]);
    }
    return out;
  }
  const below = prep.nodeLeaves.get(node);
  if (!below || delta === 0) return [];
  // A leaf, or a group with a single leaf: the simulation records leaves only for larger groups.
  return below.length === 1 ? [[below[0], delta]] : [];
}

/**
 * What a `schedule` effect on a named distribution changes for each group: the change of the units
 * in each group's part of the distribution, times what a unit of the model's change is at the target.
 * Undefined if it cannot be worked out, so that the change is spread like the node's amount.
 */
function computedGroups(pack: CountryPack, prep: Prepared, effect: ScheduleEffect, result: EffectResult, policy: PolicyResult): number[] | undefined {
  const dist = pack.distributions[effect.distribution];
  const scale = result.model?.scale;
  if (!dist || scale === undefined) return undefined;
  const view = scheduleView(pack, effect, policy.params);
  const bands = scheduleBands(dist, view.reform, view.baseline, groupEdges(dist, prep.file));
  const groups = new Array<number>(prep.groupCount).fill(0);
  let sum = 0;
  for (let g = 0; g < prep.groupCount; g++) {
    groups[g] = scale * (bands[g]?.delta ?? 0);
    sum += groups[g];
  }
  // Cut off at zero, the effect changed less than the model says: scale the groups to what it changed.
  const delta = result.delta;
  if (Math.abs(sum - delta) > 1e-9 * Math.max(Math.abs(sum), Math.abs(delta), 1)) {
    if (sum === 0) return undefined;
    for (let g = 0; g < prep.groupCount; g++) groups[g] *= delta / sum;
  }
  return groups;
}

/**
 * A part of a change and how it is spread: by a fixed spread (a profile or a payer named on the
 * effect), as amounts per group worked out from a distribution, or like the amount of each leaf
 * the change fell on (its entry in incidence.json).
 */
type Part = { total: number; spread: Float64Array } | { groups: number[] } | { total: number; node: true };

/**
 * Spreads the parts of a change over the leaves it fell on, in proportion to the leaves' changes
 * (by their amounts where the change is zero in all), and hands each leaf's amounts to the sink.
 */
function spreadParts(prep: Prepared, changes: readonly [LeafInfo, number][], parts: readonly Part[], total: number, sink: Sink): void {
  let baseSum = 0;
  if (total === 0) for (const [leaf] of changes) baseSum += leaf.amount;
  for (const [leaf, change] of changes) {
    const weight = total !== 0 ? change / total : baseSum > 0 ? leaf.amount / baseSum : 1 / changes.length;
    const amounts = new Float64Array(prep.slots);
    for (const part of parts) {
      if ("groups" in part) {
        for (let g = 0; g < prep.groupCount; g++) amounts[g] += part.groups[g] * weight;
        continue;
      }
      const spread = "spread" in part ? part.spread : leaf.spread;
      // The whole change: the leaf's own change, without a round trip through the weight.
      const amount = part.total === total ? change : part.total * weight;
      for (let k = 0; k < prep.slots; k++) amounts[k] += amount * spread[k];
    }
    sink(leaf, amounts);
  }
}

/** A curve with a rate of zero below `from`: what the units owe on the slice of their value at or above it. */
function onlyFrom(curve: RateCurve, from: number): RateCurve {
  const points = curve.points;
  if (points.length === 0 || from <= points[0].x) return curve;
  const scale = curve.scale ?? 1;
  return { points: [{ x: from, y: curveRate(curve, from) / scale }, ...points.filter((point) => point.x > from)], scale: curve.scale };
}

/**
 * incidenceAbove: the change of a schedule effect from the rates at or above `from`, and the rest,
 * scaled to the effect's actual change like the whole; for a named distribution also the rest per
 * group. Undefined if the effect has no model to split.
 */
function splitAbove(
  pack: CountryPack,
  prep: Prepared,
  effect: ScheduleEffect,
  result: EffectResult,
  policy: PolicyResult,
  from: number,
): { above: number; rest: number; restGroups?: number[] } | undefined {
  const dist = pack.distributions[effect.distribution];
  const model = result.model;
  if (!dist || !model) return undefined;
  const view = scheduleView(pack, effect, policy.params);
  const reformAbove = onlyFrom(view.reform, from);
  const baselineAbove = view.baseline ? onlyFrom(view.baseline, from) : undefined;
  const modelAbove = curveTotal(dist, reformAbove) - (baselineAbove ? curveTotal(dist, baselineAbove) : 0);
  const modelAll = model.reform - (model.baseline ?? 0);
  let above = model.scale * modelAbove;
  let rest = model.scale * (modelAll - modelAbove);
  let restGroups: number[] | undefined;
  if (prep.file.distributions?.[effect.distribution]) {
    const edges = groupEdges(dist, prep.file);
    const whole = scheduleBands(dist, view.reform, view.baseline, edges);
    const upper = scheduleBands(dist, reformAbove, baselineAbove, edges);
    restGroups = Array.from({ length: prep.groupCount }, (_, g) => model.scale * ((whole[g]?.delta ?? 0) - (upper[g]?.delta ?? 0)));
  }
  // Cut off at zero, the effect changed less than the model says: both parts shrink alike.
  const sum = above + rest;
  const delta = result.delta;
  if (Math.abs(sum - delta) > 1e-9 * Math.max(Math.abs(sum), Math.abs(delta), 1)) {
    if (sum === 0) return undefined;
    const factor = delta / sum;
    above *= factor;
    rest *= factor;
    restGroups = restGroups?.map((value) => value * factor);
  }
  return restGroups ? { above, rest, restGroups } : { above, rest };
}

/** How an effect's change at a revenue node is spread: a part by `incidenceShare`, the rest by the order of the contract. */
function effectParts(pack: CountryPack, prep: Prepared, effect: Effect, result: EffectResult, policy: PolicyResult): Part[] {
  const parts = usualParts(pack, prep, effect, result, policy);
  const named = effect.incidenceShare;
  const spread = named ? prep.own.get(named.incidence) : undefined;
  if (!named || !spread) return parts;
  const raw = evaluateValue(named.share, policy.params, pack.country.indicators);
  const share = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  const rest = 1 - share;
  const scaled = parts.map((part): Part => ("groups" in part ? { groups: part.groups.map((value) => value * rest) } : { ...part, total: part.total * rest }));
  return [{ total: result.delta * share, spread }, ...scaled];
}

/** How an effect's change is spread without `incidenceShare`, in the order of the contract. */
function usualParts(pack: CountryPack, prep: Prepared, effect: Effect, result: EffectResult, policy: PolicyResult): Part[] {
  const own = effect.incidence === undefined ? undefined : prep.own.get(effect.incidence);
  const named = effect.type === "schedule" && prep.file.distributions?.[effect.distribution] !== undefined;
  if (effect.type === "schedule" && effect.incidenceAbove) {
    const upper = prep.own.get(effect.incidenceAbove.incidence);
    const split = upper ? splitAbove(pack, prep, effect, result, policy, effect.incidenceAbove.from) : undefined;
    if (upper && split) {
      const rest: Part = own ? { total: split.rest, spread: own } : split.restGroups ? { groups: split.restGroups } : { total: split.rest, node: true };
      return [{ total: split.above, spread: upper }, rest];
    }
  }
  if (own) return [{ total: result.delta, spread: own }];
  if (named && effect.type === "schedule") {
    const groups = computedGroups(pack, prep, effect, result, policy);
    if (groups) return [{ groups }];
  }
  return [{ total: result.delta, node: true }];
}

function spreadPolicy(pack: CountryPack, prep: Prepared, policy: PolicyResult, sink: Sink): void {
  const definition = prep.policies.get(policy.id);
  if (!definition) return;
  for (const result of policy.effects) {
    const effect = definition.effects[result.index];
    if (result.side === "revenue") {
      const changes = leafChanges(prep, result.target, result.delta, result.leaves);
      spreadParts(prep, changes, effectParts(pack, prep, effect, result, policy), result.delta, sink);
    }
    const shift = result.shift;
    if (shift && shift.side === "revenue") {
      const changes = leafChanges(prep, shift.target, shift.delta, shift.leaves);
      const own = effect.shift?.incidence === undefined ? undefined : prep.own.get(effect.shift.incidence);
      spreadParts(prep, changes, [own ? { total: shift.delta, spread: own } : { total: shift.delta, node: true }], shift.delta, sink);
    }
  }
}

function emptyMeasure(prep: Prepared, id: string): { measure: MeasureWhoPays; whole: Float64Array; scopes: Float64Array[] } {
  return {
    measure: { policy: id, groups: [], payers: {}, scopes: {} },
    whole: new Float64Array(prep.slots),
    scopes: prep.file.scopes.map(() => new Float64Array(prep.slots)),
  };
}

/** Change for each group, and for each payer that changes, from a spread over the slots. */
function split(prep: Prepared, amounts: Float64Array): { groups: number[]; payers: Record<string, number> } {
  const groups = Array.from(amounts.subarray(0, prep.groupCount));
  const payers: Record<string, number> = {};
  for (const [id, slot] of prep.payerSlot) if (amounts[slot] !== 0) payers[id] = amounts[slot];
  return { groups, payers };
}

function finishMeasure(prep: Prepared, built: ReturnType<typeof emptyMeasure>): MeasureWhoPays {
  const whole = split(prep, built.whole);
  built.measure.groups = whole.groups;
  built.measure.payers = whole.payers;
  prep.file.scopes.forEach((scope, s) => (built.measure.scopes[scope.id] = split(prep, built.scopes[s])));
  return built.measure;
}

/**
 * What one measure changes for whom, from its result: a policy of a simulation of the whole budget
 * (level "all"), on its own (simulatePolicy) or together with others. Undefined for a pack without
 * incidence.json.
 */
export function measureWhoPays(pack: CountryPack, policy: PolicyResult): MeasureWhoPays | undefined {
  const file = pack.incidence;
  if (!file) return undefined;
  const prep = prepare(pack, file);
  const built = emptyMeasure(prep, policy.id);
  spreadPolicy(pack, prep, policy, (leaf, amounts) => {
    for (let k = 0; k < prep.slots; k++) built.whole[k] += amounts[k];
    leaf.scopes.forEach((inside, s) => {
      if (inside) for (let k = 0; k < prep.slots; k++) built.scopes[s][k] += amounts[k];
    });
  });
  return finishMeasure(prep, built);
}

// ---------------------------------------------------------------------------------------------
// The whole picture
// ---------------------------------------------------------------------------------------------

/**
 * Who pays the revenue of a simulation of the whole budget, today and with its measures: per scope
 * the income groups and the payers, the statement of all revenue, and what each measure changes.
 * Undefined for a pack without incidence.json. Throws for a simulation filtered to one level.
 */
export function whoPays(pack: CountryPack, result: SimulationResult): WhoPays | undefined {
  const file = pack.incidence;
  if (!file) return undefined;
  if (result.level !== "all") throw new Error(`whoPays needs a simulation of the whole budget (level "all"), not of level "${result.level}".`);
  const prep = prepare(pack, file);
  const { slots, groupCount } = prep;
  const scopeCount = file.scopes.length;

  // Per scope and per item (line by slot): today and with the measures.
  const scopeToday = Array.from({ length: scopeCount }, () => new Float64Array(slots));
  const scopeReform = Array.from({ length: scopeCount }, () => new Float64Array(slots));
  const scopeTotal = Array.from({ length: scopeCount }, () => ({ today: 0, reform: 0 }));
  const itemToday = new Map<string, Float64Array>();
  const itemReform = new Map<string, Float64Array>();
  const item = (map: Map<string, Float64Array>, id: string): Float64Array => {
    let row = map.get(id);
    if (!row) map.set(id, (row = new Float64Array(slots)));
    return row;
  };

  for (const leaf of prep.leaves) {
    if (leaf.amount === 0) continue;
    const today = item(itemToday, leaf.item);
    const reform = item(itemReform, leaf.item);
    for (let k = 0; k < slots; k++) {
      const part = leaf.amount * leaf.spread[k];
      today[k] += part;
      reform[k] += part;
    }
    leaf.scopes.forEach((inside, s) => {
      if (!inside) return;
      scopeTotal[s].today += leaf.amount;
      for (let k = 0; k < slots; k++) {
        scopeToday[s][k] += leaf.amount * leaf.spread[k];
        scopeReform[s][k] += leaf.amount * leaf.spread[k];
      }
    });
  }

  const measures: MeasureWhoPays[] = [];
  for (const policy of result.policies) {
    const built = emptyMeasure(prep, policy.id);
    spreadPolicy(pack, prep, policy, (leaf, amounts) => {
      const reform = item(itemReform, leaf.item);
      if (!itemToday.has(leaf.item)) item(itemToday, leaf.item);
      let change = 0;
      for (let k = 0; k < slots; k++) {
        reform[k] += amounts[k];
        built.whole[k] += amounts[k];
        change += amounts[k];
      }
      leaf.scopes.forEach((inside, s) => {
        if (!inside) return;
        scopeTotal[s].reform += change;
        for (let k = 0; k < slots; k++) {
          scopeReform[s][k] += amounts[k];
          built.scopes[s][k] += amounts[k];
        }
      });
    });
    measures.push(finishMeasure(prep, built));
  }

  const count = file.population.count;
  const total = file.income.total;
  const scopes = file.scopes.map((scope, s): WhoPaysScope => {
    let today = 0;
    let reform = 0;
    for (let g = 0; g < groupCount; g++) {
      today += scopeToday[s][g];
      reform += scopeReform[s][g];
    }
    const groups = file.groups.map((group, g): WhoPaysGroup => {
      const units = count * group.share;
      const incomeShare = file.income.shares[g];
      const out: WhoPaysGroup = {
        id: group.id,
        today: scopeToday[s][g],
        reform: scopeReform[s][g],
        delta: scopeReform[s][g] - scopeToday[s][g],
        shareToday: today > 0 ? scopeToday[s][g] / today : 0,
        shareReform: reform > 0 ? scopeReform[s][g] / reform : 0,
        units,
        deltaPerUnit: units > 0 ? (scopeReform[s][g] - scopeToday[s][g]) / units : 0,
        incomeShare,
      };
      if (total !== undefined && incomeShare > 0) {
        out.rateToday = scopeToday[s][g] / (total * incomeShare);
        out.rateReform = scopeReform[s][g] / (total * incomeShare);
      }
      return out;
    });
    const payers: WhoPaysPayer[] = [];
    for (const [id, slot] of prep.payerSlot) {
      const amounts = { id, today: scopeToday[s][slot], reform: scopeReform[s][slot] };
      if (amounts.today !== 0 || amounts.reform !== 0) payers.push(amounts);
    }
    scopeTotal[s].reform += scopeTotal[s].today;
    return { id: scope.id, total: scopeTotal[s], groupsTotal: { today, reform }, groups, payers };
  });

  // The statement: the groups' line, then one line per payer.
  const ordered = [...itemToday.keys()].sort((a, b) => (prep.itemOrder.get(a) ?? 0) - (prep.itemOrder.get(b) ?? 0));
  const line = (from: number, to: number, payer?: string): WhoPaysLine => {
    const items: WhoPaysItem[] = [];
    let today = 0;
    let reform = 0;
    for (const id of ordered) {
      let a = 0;
      let b = 0;
      for (let k = from; k < to; k++) {
        a += itemToday.get(id)![k];
        b += itemReform.get(id)![k];
      }
      if (a === 0 && b === 0) continue;
      items.push({ node: id, today: a, reform: b });
      today += a;
      reform += b;
    }
    return payer === undefined ? { today, reform, items } : { payer, today, reform, items };
  };
  const lines = [line(0, groupCount)];
  for (const [id, slot] of prep.payerSlot) lines.push(line(slot, slot + 1, id));
  let today = 0;
  let reform = 0;
  for (const entry of lines) {
    today += entry.today;
    reform += entry.reform;
  }
  return { scopes, statement: { today, reform, lines }, measures };
}
