/**
 * Which side of the budget a measure acts on: what the state takes in (revenue), what it spends
 * (expenditure), or both. It is read from the pack, from the budget items that the measure's
 * effects and their shifts can touch, not from a result: a measure keeps its side whatever its
 * settings and whatever level of government is shown, because the side decides where its card
 * stands in the list.
 *
 * What a measure does to each side at its current settings is a different question, answered by
 * the engine's result on the card (policyModel.ts).
 */
import type { BudgetNode, CountryPack, Policy, Side } from "../engine/index.ts";
import { levelsOf } from "./policyModel.ts";

/** The side of the budget a measure acts on. */
export type PolicySide = Side | "both";

/** The sides in the order the list shows them: revenue, spending, both. */
export const POLICY_SIDES: readonly PolicySide[] = ["revenue", "expenditure", "both"];

const nodeSides = new WeakMap<CountryPack, Map<string, Side>>();

/** The side of the budget tree a node lies on, groups included; undefined for an id the pack does not have. */
export function sideOfNode(pack: CountryPack, id: string): Side | undefined {
  let sides = nodeSides.get(pack);
  if (!sides) {
    const found = new Map<string, Side>();
    const visit = (node: BudgetNode, side: Side): void => {
      if (!found.has(node.id)) found.set(node.id, side);
      if ("children" in node) for (const child of node.children) visit(child, side);
    };
    for (const node of pack.budget.revenue) visit(node, "revenue");
    for (const node of pack.budget.expenditure) visit(node, "expenditure");
    nodeSides.set(pack, (sides = found));
  }
  return sides.get(id);
}

/**
 * The side of a measure: that of every item its effects target and their shifts pass something on
 * to, whether or not the current settings change it. A shift counts because what it passes on is
 * part of the measure's result: higher contributions that lower the income tax change both sides.
 * Every effect of a pack that passed validation targets a node of the pack; ids it does not have
 * are left out, and a measure without any known item counts as spending.
 */
export function policySide(pack: CountryPack, policy: Policy): PolicySide {
  const sides = new Set<Side>();
  for (const effect of policy.effects) {
    for (const id of [effect.target, effect.shift?.to]) {
      const side = id === undefined ? undefined : sideOfNode(pack, id);
      if (side) sides.add(side);
    }
  }
  if (sides.size > 1) return "both";
  return sides.has("revenue") ? "revenue" : "expenditure";
}

const policySideMaps = new WeakMap<CountryPack, ReadonlyMap<string, PolicySide>>();

/** The side of every measure of the pack, by id; worked out once per pack. */
export function policySides(pack: CountryPack): ReadonlyMap<string, PolicySide> {
  let sides = policySideMaps.get(pack);
  if (!sides) {
    sides = new Map(pack.policies.map((policy) => [policy.id, policySide(pack, policy)]));
    policySideMaps.set(pack, sides);
  }
  return sides;
}

/**
 * Whose budget the pack shows, as the texts name it: the whole state's, or the central
 * government's alone (a pack with that one level, such as the US federal budget).
 */
export type BudgetHolder = "state" | "central";

export function budgetHolder(pack: CountryPack): BudgetHolder {
  const levels = levelsOf(pack);
  return levels.length === 1 && levels[0] === "central" ? "central" : "state";
}
