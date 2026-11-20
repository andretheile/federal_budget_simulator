/**
 * Which measures the list shows: all of them, or those of one collection of the pack (such as the
 * measures debated around one year's budget), and within that those of one topic. Measures that are
 * switched on stay in the scenario whether they are shown or not, so the list says how many of them
 * a filter hides.
 */
import type { CountryPack, Policy, PolicyCollection, PolicyTopic, Scenario } from "../engine/index.ts";

export interface ListView {
  /** The collection the list is narrowed to, if any. */
  collection?: PolicyCollection;
  /** The measures to choose from: all of the pack in its order, or the collection's in its order. */
  pool: Policy[];
  /** Topics among them, in the order they first appear, with how many measures each has. */
  topics: [PolicyTopic, number][];
  /** The topic that applies: null for all, or one that the pool has. */
  topic: PolicyTopic | null;
  /** The measures shown. */
  shown: Policy[];
  /** Measures that are switched on but not shown. */
  hidden: Policy[];
}

export function listView(
  pack: CountryPack,
  scenario: Scenario,
  collectionId: string | undefined,
  topic: PolicyTopic | null,
): ListView {
  const collection = collectionId === undefined ? undefined : pack.collections?.find((candidate) => candidate.id === collectionId);
  const byId = new Map(pack.policies.map((policy) => [policy.id, policy]));
  const pool = collection
    ? collection.policies.flatMap((id) => {
        const policy = byId.get(id);
        return policy ? [policy] : [];
      })
    : pack.policies;
  const counts = new Map<PolicyTopic, number>();
  for (const policy of pool) counts.set(policy.topic, (counts.get(policy.topic) ?? 0) + 1);
  const topics = [...counts];
  const active = topic !== null && counts.has(topic) ? topic : null;
  const shown = pool.filter((policy) => active === null || policy.topic === active);
  const visible = new Set(shown.map((policy) => policy.id));
  const hidden = pack.policies.filter((policy) => scenario.policies[policy.id]?.enabled === true && !visible.has(policy.id));
  return { collection, pool, topics, topic: active, shown, hidden };
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
