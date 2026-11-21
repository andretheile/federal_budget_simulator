/**
 * The budget items a measure changes, for the details of its card, when there are many of them: a
 * measure built from the budget's items one by one can have dozens (the US cut of the federal
 * workforce has 44). The effects are grouped by the setting that drives them, each group with what
 * it does to the balance; in each group the largest are shown and the rest are one step away, with
 * their sum. A measure with few effects keeps its list as it is.
 *
 * "Largest" is judged at the measure's default settings, so the order and the split between shown
 * and further items stay put while a slider moves; the amounts follow the slider.
 */
import type { Effect, EffectResult, Policy } from "../engine/index.ts";

/** With more effects than this, the details group them and show the largest first. */
export const MANY_EFFECTS = 6;

/** How many effects a group shows at first: fewer where several groups share the room. */
const SHOWN_ALONE = 5;
const SHOWN_GROUPED = 3;

/** The params an effect depends on, wherever it names one (a value, the groups, a curve, its shift). */
export function paramsOfEffect(effect: Effect): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === "note" || key === "label" || key === "sources") continue;
      if (key === "param" && typeof inner === "string") found.add(inner);
      else visit(inner);
    }
  };
  visit(effect);
  return [...found].sort();
}

/** What an effect and its shift do to the balance: more revenue or less spending is positive. */
export function balanceOfEffect(effect: EffectResult): number {
  const own = effect.side === "revenue" ? effect.delta : -effect.delta;
  const shift = effect.shift && Number.isFinite(effect.shift.delta) ? effect.shift : undefined;
  return own + (shift ? (shift.side === "revenue" ? shift.delta : -shift.delta) : 0);
}

export interface EffectGroup {
  /** A key that stays the same while the settings change. */
  key: string;
  /** The params that drive the group's effects, in the order of the measure's settings; empty for effects tied to none. */
  params: string[];
  /** The effects shown at first, the largest at default settings first. */
  shown: EffectResult[];
  /** The further effects, one step away, in the same order. */
  rest: EffectResult[];
  /** What all the group's effects do to the balance at the current settings. */
  balance: number;
  /** What the further ones do to it. */
  restBalance: number;
}

/**
 * The effects of a measure in groups, or undefined where it has few (MANY_EFFECTS at most), so that
 * its list stays as it is. `current` are the effects at the settings shown, `atDefaults` the same
 * measure at its default settings, by which the effects are ordered; ties keep the pack's order.
 */
export function effectGroups(policy: Policy, current: readonly EffectResult[], atDefaults: readonly EffectResult[]): EffectGroup[] | undefined {
  if (policy.effects.length <= MANY_EFFECTS) return undefined;
  const order = policy.params.map((param) => param.id);
  const rank = (params: string[]): number => {
    const positions = params.map((id) => order.indexOf(id)).filter((position) => position >= 0);
    return positions.length > 0 ? Math.min(...positions) : order.length;
  };
  const size = new Map(atDefaults.map((effect) => [effect.index, Math.abs(balanceOfEffect(effect))]));
  const byKey = new Map<string, { params: string[]; effects: EffectResult[] }>();
  for (const effect of current) {
    const definition = policy.effects[effect.index];
    const params = definition ? paramsOfEffect(definition).sort((a, b) => order.indexOf(a) - order.indexOf(b)) : [];
    const key = params.join("+");
    const group = byKey.get(key) ?? { params, effects: [] };
    group.effects.push(effect);
    byKey.set(key, group);
  }
  const groups = [...byKey.entries()].sort(([, a], [, b]) => rank(a.params) - rank(b.params));
  const limit = groups.length > 1 ? SHOWN_GROUPED : SHOWN_ALONE;
  return groups.map(([key, { params, effects }]) => {
    const sorted = [...effects].sort((a, b) => (size.get(b.index) ?? 0) - (size.get(a.index) ?? 0));
    // A single further item is shown rather than put behind a button of its own.
    const shownCount = sorted.length <= limit + 1 ? sorted.length : limit;
    const shown = sorted.slice(0, shownCount);
    const rest = sorted.slice(shownCount);
    const sum = (list: readonly EffectResult[]): number => list.reduce((total, effect) => total + balanceOfEffect(effect), 0);
    return { key, params, shown, rest, balance: sum(sorted), restBalance: sum(rest) };
  });
}
