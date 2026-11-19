/**
 * All measures of the pack as cards, with a filter by topic.
 */
import { useEffect, useMemo, useState } from "react";
import { curveChanged, curveSettings } from "../app/curveModel.ts";
import { useUi } from "../app/ui.ts";
import type { CurvePoint, ParamValue, PolicyTopic, Scenario, SimulationResult } from "../engine/index.ts";
import { reducedMotion } from "../hooks/useAnimatedNumber.ts";
import { preloadEditor } from "./CurveEditor.tsx";
import { ChevronRight } from "./icons.tsx";
import { PolicyCard } from "./PolicyCard.tsx";

export interface PolicyListProps {
  scenario: Scenario;
  result: SimulationResult;
  expanded: ReadonlySet<string>;
  /** A measure to bring into view, e.g. after a click in the waterfall. A new nonce asks again. */
  reveal?: { id: string; nonce: number };
  onToggle(id: string, enabled: boolean): void;
  onParam(id: string, param: string, value: ParamValue): void;
  onExpand(id: string, expanded: boolean): void;
  onShowNode(nodeId: string): void;
  onEditCurve(id: string, param: string): void;
}

export function PolicyList({
  scenario,
  result,
  expanded,
  reveal,
  onToggle,
  onParam,
  onExpand,
  onShowNode,
  onEditCurve,
}: PolicyListProps) {
  const ui = useUi();
  const { pack, t } = ui;
  const [topic, setTopic] = useState<PolicyTopic | null>(null);

  // Topics in the order they first appear in the pack, with how many measures each has.
  const topics = useMemo(() => {
    const counts = new Map<PolicyTopic, number>();
    for (const policy of pack.policies) counts.set(policy.topic, (counts.get(policy.topic) ?? 0) + 1);
    return [...counts];
  }, [pack]);
  const active = topic !== null && topics.some(([id]) => id === topic) ? topic : null;
  const shown = pack.policies.filter((policy) => active === null || policy.topic === active);
  const results = useMemo(() => new Map(result.policies.map((entry) => [entry.id, entry])), [result.policies]);
  // The engine returns fresh objects on every run; keep the totals stable so cards that did not change do not re-render.
  const { revenue, expenditure, balance } = result.baseline;
  const baseline = useMemo(() => ({ revenue, expenditure, balance }), [revenue, expenditure, balance]);

  // Per measure: the measures switched on that are applied before it, as a stable string.
  const enabledBefore = useMemo(() => {
    const out = new Map<string, string>();
    const earlier: string[] = [];
    for (const policy of pack.policies) {
      out.set(policy.id, earlier.join(","));
      if (results.has(policy.id)) earlier.push(policy.id);
    }
    return out;
  }, [pack, results]);

  // Curves that differ from today's in a measure that is switched on: easy to miss in a long list,
  // for instance when a link brings them, so they are named above it.
  const changedCurves = useMemo(
    () =>
      pack.policies.flatMap((policy) => {
        const state = scenario.policies[policy.id];
        if (!state?.enabled) return [];
        const params = results.get(policy.id)?.params;
        return curveSettings(policy)
          .filter((setting) => params && curveChanged(setting, params[setting.param.id] as CurvePoint[]))
          .map((setting) => ({ policy, param: setting.param.id }));
      }),
    [pack, scenario, results],
  );

  useEffect(() => {
    if (!reveal) return;
    const policy = pack.policies.find((candidate) => candidate.id === reveal.id);
    if (!policy) return;
    // The card may be hidden by the topic filter.
    setTopic((current) => (current !== null && current !== policy.topic ? null : current));
    const frame = requestAnimationFrame(() => {
      document.getElementById(`policy-${reveal.id}`)?.scrollIntoView?.({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, pack]);

  return (
    <section className="policies" aria-labelledby="policies-title">
      <header className="section-head">
        <h2 id="policies-title">{t.policies.title}</h2>
        <p>{t.policies.intro}</p>
      </header>

      {changedCurves.length > 0 && (
        <div className="changed-curves" role="note">
          <p>{t.curve.changedTitle(changedCurves.length)}</p>
          <ul>
            {changedCurves.map(({ policy, param }) => (
              <li key={`${policy.id}.${param}`}>
                <button
                  type="button"
                  className="changed-curves__open"
                  onClick={() => onEditCurve(policy.id, param)}
                  onPointerEnter={preloadEditor}
                  onFocus={preloadEditor}
                >
                  {t.curve.show(ui.text(policy.label))}
                  <ChevronRight size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topics.length > 1 && (
        <div className="filter" role="group" aria-label={t.policies.topic}>
          <button type="button" className="filter__item" aria-pressed={active === null} onClick={() => setTopic(null)}>
            {t.policies.allTopics} <span className="filter__count">{pack.policies.length}</span>
          </button>
          {topics.map(([id, count]) => (
            <button
              key={id}
              type="button"
              className="filter__item"
              aria-pressed={active === id}
              onClick={() => setTopic(id)}
            >
              {t.policies.topics[id]} <span className="filter__count">{count}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="muted">{t.policies.none}</p>
      ) : (
        <ul className="policy-list">
          {shown.map((policy) => (
            <PolicyCard
              key={policy.id}
              enabledBefore={enabledBefore.get(policy.id) ?? ""}
              policy={policy}
              state={scenario.policies[policy.id]}
              inScenario={results.get(policy.id)}
              level={result.level}
              baseline={baseline}
              expanded={expanded.has(policy.id)}
              onToggle={onToggle}
              onParam={onParam}
              onExpand={onExpand}
              onShowNode={onShowNode}
              onEditCurve={onEditCurve}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
