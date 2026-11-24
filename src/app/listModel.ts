/**
 * Which measures the list shows: all of them, or those of one collection of the pack (such as the
 * measures debated around one year's budget), and within that those of one topic. Measures that are
 * switched on stay in the scenario whether they are shown or not, so the list says how many of them
 * a filter hides.
 *
 * The measures shown stand in up to three sections by the side of the budget they act on (sideModel.ts):
 * revenue, spending, both; a section without a measure under the filters is left out. Within a
 * section the list is in alphabetical order of the measures' labels in the language shown, and the
 * topics are too, with "other" last. That is the order for reading only: the engine applies the
 * measures in the pack's order, which the waterfall shows, and nothing here changes it.
 */
import type { CountryPack, Policy, PolicyCollection, PolicyTopic, Scenario } from "../engine/index.ts";
import { alphabetical } from "./collation.ts";
import { POLICY_SIDES, policySides, type PolicySide } from "./sideModel.ts";

/** How the list names what it sorts: in the language shown. */
export interface ListOrder {
  language: string;
  /** A measure's label. */
  label(policy: Policy): string;
  /** A topic's name, as its chip shows it. */
  topic(topic: PolicyTopic): string;
}

export interface ListView {
  /** The collection the list is narrowed to, if any. */
  collection?: PolicyCollection;
  /** The measures to choose from: all of the pack, or the collection's; alphabetical with an order. */
  pool: Policy[];
  /**
   * Topics among them, with how many measures each has: alphabetical with an order, "other" last;
   * otherwise in the order they first appear.
   */
  topics: [PolicyTopic, number][];
  /** The topic that applies: null for all, or one that the pool has. */
  topic: PolicyTopic | null;
  /** The measures shown, in the order of the pool. */
  shown: Policy[];
  /**
   * The same by the side they act on, as the list shows them: revenue, spending, both, each in the
   * order of the pool; only sides that have a measure shown.
   */
  sections: ListSection[];
  /** Measures that are switched on but not shown. */
  hidden: Policy[];
}

/** One section of the list: the measures shown that act on one side of the budget. */
export interface ListSection {
  side: PolicySide;
  /** In the list's order. */
  policies: Policy[];
  /** How many of them are switched on. */
  on: number;
}

export function listView(
  pack: CountryPack,
  scenario: Scenario,
  collectionId: string | undefined,
  topic: PolicyTopic | null,
  /** Alphabetical order in the language shown; without it, the pack's order (and the collection's). */
  order?: ListOrder,
): ListView {
  const collection = collectionId === undefined ? undefined : pack.collections?.find((candidate) => candidate.id === collectionId);
  const byId = new Map(pack.policies.map((policy) => [policy.id, policy]));
  const chosen = collection
    ? collection.policies.flatMap((id) => {
        const policy = byId.get(id);
        return policy ? [policy] : [];
      })
    : pack.policies;
  const pool = order ? alphabetical(chosen, order.label, order.language) : chosen;
  const counts = new Map<PolicyTopic, number>();
  for (const policy of pool) counts.set(policy.topic, (counts.get(policy.topic) ?? 0) + 1);
  const named = order ? alphabetical([...counts], ([id]) => order.topic(id), order.language) : [...counts];
  // "Other" is a remainder, not a topic to look for by name: it comes last.
  const topics = order ? [...named.filter(([id]) => id !== "other"), ...named.filter(([id]) => id === "other")] : named;
  const active = topic !== null && counts.has(topic) ? topic : null;
  const shown = pool.filter((policy) => active === null || policy.topic === active);
  const visible = new Set(shown.map((policy) => policy.id));
  const isOn = (policy: Policy): boolean => scenario.policies[policy.id]?.enabled === true;
  const hidden = pack.policies.filter((policy) => isOn(policy) && !visible.has(policy.id));
  const sides = policySides(pack);
  const sections = POLICY_SIDES.flatMap((side): ListSection[] => {
    const policies = shown.filter((policy) => sides.get(policy.id) === side);
    return policies.length > 0 ? [{ side, policies, on: policies.filter(isOn).length }] : [];
  });
  return { collection, pool, topics, topic: active, shown, sections, hidden };
}

/** For each measure, the labels of the collections it belongs to, in the pack's order of collections. */
export function collectionsByPolicy<T>(pack: CountryPack, label: (collection: PolicyCollection) => T): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const collection of pack.collections ?? []) {
    const name = label(collection);
    for (const id of new Set(collection.policies)) out.set(id, [...(out.get(id) ?? []), name]);
  }
  return out;
}
