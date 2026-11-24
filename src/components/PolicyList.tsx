/**
 * All measures of the pack as cards, with a filter by collection (the pack's named groups of
 * measures, such as those of one year's budget debate) and one by topic. A measure that belongs to
 * a collection carries a badge with its name. Measures that are switched on keep counting when a
 * filter hides them; the list says how many that are and shows them all again with one click.
 *
 * The cards stand in sections by the side of the budget their measures act on: revenue, spending,
 * both (app/sideModel.ts), each with a heading, how many measures it has and how many are on, and
 * a line on what they change. Where there is more than one, a line of links above them leads to
 * each, so a phone reaches the spending without scrolling past every tax.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { curveChanged, curveSettings } from "../app/curveModel.ts";
import { collectionsByPolicy, listView } from "../app/listModel.ts";
import { budgetHolder, type PolicySide } from "../app/sideModel.ts";
import { useUi } from "../app/ui.ts";
import type { CurvePoint, Goal, ParamValue, Policy, PolicyTopic, Scenario, SimulationResult } from "../engine/index.ts";
import { reducedMotion } from "../hooks/useAnimatedNumber.ts";
import { preloadEditor } from "./CurveEditor.tsx";
import { asSentence, exclusionsOf, shortReason } from "./GoalBar.tsx";
import { ArrowDown, ChevronRight, InfoIcon } from "./icons.tsx";
import { PolicyCard, type GoalHint } from "./PolicyCard.tsx";
import { SourceList } from "./primitives.tsx";
import { jumpToSection } from "./SectionNav.tsx";

/** The element id of a section of the list. */
function sideSectionId(side: PolicySide): string {
  return `measures-${side}`;
}

/**
 * Leads to a section of the list: its heading just below the floating band, the focus on the
 * section. The address holds the state of the page, so the link does not follow its href.
 */
function followSide(event: MouseEvent<HTMLAnchorElement>, side: PolicySide): void {
  event.preventDefault();
  jumpToSection(sideSectionId(side));
}

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
  /** The collection the list is narrowed to, if any; part of the address. */
  collection?: string;
  onCollection(id: string | undefined): void;
  /** The goal the bar under the scoreboard measures against: a measure it leaves out says so. */
  goal?: Goal;
}

/**
 * Marks a row that scrolls sideways with data-start and data-end where there is more to see, so
 * the styles can fade that edge. Follows scrolling and changes of size, of the row and of its content.
 */
function useScrollEdges(ref: RefObject<HTMLElement | null>, present: boolean): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (): void => {
      const rest = element.scrollWidth - element.clientWidth - element.scrollLeft;
      element.dataset.start = String(element.scrollLeft > 1);
      element.dataset.end = String(rest > 1);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : undefined;
    observer?.observe(element);
    const mutations = typeof MutationObserver === "function" ? new MutationObserver(update) : undefined;
    mutations?.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      element.removeEventListener("scroll", update);
      observer?.disconnect();
      mutations?.disconnect();
    };
  }, [ref, present]);
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
  collection: collectionId,
  onCollection,
  goal,
}: PolicyListProps) {
  const ui = useUi();
  const { pack, t } = ui;
  const [topic, setTopic] = useState<PolicyTopic | null>(null);

  // The measures of the chosen collection (or all), and among them the topics with their counts.
  // Alphabetical in the language shown; the engine applies the measures in the pack's order all the same.
  const order = useMemo(
    () => ({ language: ui.language, label: (policy: Policy) => ui.text(policy.label), topic: (id: PolicyTopic) => t.policies.topics[id] }),
    [ui, t],
  );
  const view = listView(pack, scenario, collectionId, topic, order);
  const { topics, topic: active, shown, sections, hidden, collection } = view;
  const holder = budgetHolder(pack);
  const collections = pack.collections ?? [];
  // Per measure, the names of its collections: the same arrays on every render, so cards stay memoized.
  const badges = useMemo(() => collectionsByPolicy(pack, (entry) => ui.text(entry.label)), [pack, ui]);
  // Per measure the goal leaves out: the hint on its card, with the short reason on the face (the
  // goal bar's rule) and the full one in the details.
  const goalHints = useMemo(() => {
    const out = new Map<string, GoalHint>();
    if (!goal) return out;
    for (const entry of exclusionsOf(goal)) {
      if (entry.policy === undefined) continue;
      const short = shortReason(ui, entry);
      out.set(entry.policy, {
        statement: t.goal.cardExcluded(ui.text(goal.label)),
        reason: short.text,
        more: short.more,
        full: asSentence(ui.text(entry.reason), ui.language),
        sources: entry.sources,
      });
    }
    return out;
  }, [goal, ui, t]);
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

  // Only a new request to reveal a card moves the filters, not a change of the filter itself.
  const collectionNow = useRef({ id: collectionId, set: onCollection });
  collectionNow.current = { id: collectionId, set: onCollection };
  useEffect(() => {
    if (!reveal) return;
    const policy = pack.policies.find((candidate) => candidate.id === reveal.id);
    if (!policy) return;
    // The card may be hidden by the topic filter, or by the collection.
    setTopic((current) => (current !== null && current !== policy.topic ? null : current));
    const { id: chosen, set } = collectionNow.current;
    if (chosen !== undefined && !pack.collections?.find((entry) => entry.id === chosen)?.policies.includes(policy.id)) set(undefined);
    const frame = requestAnimationFrame(() => {
      document.getElementById(`policy-${reveal.id}`)?.scrollIntoView?.({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, pack]);

  // On a phone the topics are one row that scrolls sideways (policies.css): the chosen one is
  // brought into view, and the row says on which side there is more.
  const topicRow = useRef<HTMLDivElement>(null);
  useScrollEdges(topicRow, topics.length > 1);
  const topicCount = topics.length;
  useEffect(() => {
    const row = topicRow.current;
    const chosen = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !chosen || row.scrollWidth <= row.clientWidth + 1) return;
    const padding = parseFloat(getComputedStyle(row).scrollPaddingInlineStart) || 0;
    const start = chosen.offsetLeft - padding;
    const end = chosen.offsetLeft + chosen.offsetWidth + padding - row.clientWidth;
    const left = start < row.scrollLeft ? start : end > row.scrollLeft ? end : row.scrollLeft;
    if (left !== row.scrollLeft) row.scrollTo?.({ left, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [active, topicCount, collectionId]);

  const showAll = (): void => {
    setTopic(null);
    onCollection(undefined);
  };

  return (
    <section className="policies" id="measures" aria-labelledby="policies-title" tabIndex={-1}>
      <header className="section-head">
        <h2 id="policies-title">{t.policies.title}</h2>
        {pack.policies.length > 0 && <p>{t.policies.intro}</p>}
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

      {collections.length > 0 && (
        <div className="collections" role="group" aria-label={t.policies.collectionFilter}>
          <button type="button" className="collections__item" aria-pressed={collection === undefined} onClick={() => onCollection(undefined)}>
            <span className="collections__name">{t.policies.allMeasures}</span>
            <span className="collections__count">{pack.policies.length}</span>
          </button>
          {collections.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="collections__item"
              aria-pressed={collection?.id === entry.id}
              title={ui.text(entry.label)}
              onClick={() => onCollection(entry.id)}
            >
              <span className="collections__name">{ui.text(entry.label)}</span>
              <span className="collections__count">{new Set(entry.policies).size}</span>
            </button>
          ))}
        </div>
      )}

      {collection && (collection.description || (collection.sources?.length ?? 0) > 0) && (
        <div className="collection-note">
          {collection.description && <p>{ui.text(collection.description)}</p>}
          {collection.sources && collection.sources.length > 0 && (
            <details className="collection-note__sources">
              <summary>{t.about.sourcesTitle(collection.sources.length)}</summary>
              <SourceList ids={collection.sources} />
            </details>
          )}
        </div>
      )}

      {topics.length > 1 && (
        <div className="filter" role="group" aria-label={t.policies.topic} ref={topicRow}>
          <button type="button" className="filter__item" aria-pressed={active === null} onClick={() => setTopic(null)}>
            {t.policies.allTopics} <span className="filter__count">{view.pool.length}</span>
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

      {hidden.length > 0 && (
        <p className="hidden-on" role="note">
          <InfoIcon size={14} />
          <span>{t.policies.hiddenOn(hidden.length)}</span>
          <button type="button" className="hidden-on__show" onClick={showAll}>
            {t.policies.showAll}
          </button>
        </p>
      )}

      {shown.length === 0 ? (
        <p className="muted">{pack.policies.length === 0 ? t.policies.noneInPack : t.policies.none}</p>
      ) : (
        <>
          {/* Where there is more than one section: to each with one tap, with how many measures it has. */}
          {sections.length > 1 && (
            <nav className="sidelinks" aria-label={t.policies.sideLinks}>
              <ul>
                {sections.map((section) => (
                  <li key={section.side}>
                    <a href={`#${sideSectionId(section.side)}`} className="sidelinks__link" onClick={(event) => followSide(event, section.side)}>
                      <span>{t.policies.sideTitle[section.side]}</span>
                      <span className="sidelinks__count" aria-hidden="true">
                        {section.policies.length}
                      </span>
                      <span className="visually-hidden">, {t.policies.sideCount(section.policies.length, 0)}</span>
                      <ArrowDown size={13} />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          {sections.map((section) => {
            const id = sideSectionId(section.side);
            return (
              <section key={section.side} className="policy-side" id={id} aria-labelledby={`${id}-title`} tabIndex={-1}>
                <header className="policy-side__head">
                  <h3 className="policy-side__title" id={`${id}-title`}>
                    <span>{t.policies.sideTitle[section.side]}</span>
                    <span className="visually-hidden">, </span>
                    <span className="policy-side__count">{t.policies.sideCount(section.policies.length, section.on)}</span>
                  </h3>
                  <p className="policy-side__intro">{t.policies.sideIntro(section.side, holder)}</p>
                </header>
                <ul className="policy-list">
                  {section.policies.map((policy) => (
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
                      collections={badges.get(policy.id)}
                      goalHint={goalHints.get(policy.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}
