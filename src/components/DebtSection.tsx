/**
 * The debt and interest projection on the page: where the balance of the scenario leads over the
 * coming decades. Shown only for a pack with debt data.
 *
 * This file is the part of the first load: the section with its heading and the sentence that
 * states the result, which needs nothing but the engine, and the line near the top of the page that
 * leads here (DebtTeaser). The charts, the assumptions, the lists and the table (DebtBody.tsx, with
 * their styles) are a part of their own: loaded when the section comes near the window, at once
 * when the address carries assumptions of its own, and ahead of time when a pointer or the focus
 * reaches a link to the section. Until then the section shows its sentence and says that the rest
 * is loading; if it cannot be loaded, it says so and offers to try again.
 */
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { defaultDebtAssumptions, sameDebtAssumptions } from "../app/debtLink.ts";
import { coversState, debtHeadline, interestComparisons, planFollowing, type DebtHeadline, type DebtView } from "../app/debtModel.ts";
import { lazyModule } from "../app/lazy.ts";
import { useUi, type Ui } from "../app/ui.ts";
import type { DebtAssumptions, LevelFilter } from "../engine/index.ts";
import { decimalsIn } from "../i18n/format.ts";
import type { DebtLeadText } from "../i18n/debt/messages.ts";
import { blocks } from "../app/paragraphs.ts";
import { allEndedBy, anyEnding, endedBy, laterPhases, notInFullBy, phaseWords } from "../app/phaseModel.ts";
import "../styles/debt.css";
import { ArrowDown, ResetIcon } from "./icons.tsx";
import { SourceList } from "./primitives.tsx";

/** The charts, assumptions and lists of the section, a part of the app of its own. */
export const debtModule = lazyModule(() => import("./DebtBody.tsx"));

/** Starts loading the body of the section, so that it is there when the visitor arrives. */
export function preloadDebt(): void {
  debtModule.preload();
}

/** How far below the window the section may still be when its code is fetched. */
const AHEAD = "1600px 0px";

/** The facts of the opening sentence in the visitor's language. */
export function leadText(ui: Ui, headline: DebtHeadline): DebtLeadText {
  const { fmt } = ui;
  const share = (fraction: number): string => fmt.percent(fraction, { digits: 1 });
  const ratio = (fraction: number): string => fmt.percent(fraction, { digits: 0 });
  const rangeLow = headline.interestRange ? share(headline.interestRange[0]) : "";
  const rangeHigh = headline.interestRange ? share(headline.interestRange[1]) : "";
  return {
    year: ui.yearName(headline.year),
    baseYear: ui.yearName(headline.baseYear),
    state: coversState(ui.pack),
    rate: fmt.percent(headline.marketRate / 100, { digits: decimalsIn(headline.marketRate, 2) }),
    interest: share(Math.abs(headline.interest)),
    negative: headline.interest < 0 && share(headline.interest) !== share(0),
    interestWithout: headline.interestWithout === undefined ? undefined : share(headline.interestWithout),
    range: headline.interestRange && rangeLow !== rangeHigh ? ui.t.common.range(rangeLow, rangeHigh) : undefined,
    interestToday: share(headline.interestToday),
    debt: ratio(headline.debt),
    debtWithout: headline.debtWithout === undefined ? undefined : ratio(headline.debtWithout),
    debtToday: ratio(headline.debtToday),
    paidOff: headline.paidOff === undefined ? undefined : ui.yearName(headline.paidOff),
    overtakes: headline.overtakes && {
      label: ui.text(headline.overtakes.label),
      since: ui.yearName(headline.overtakes.since),
      already: headline.overtakes.since === headline.baseYear,
    },
  };
}

/**
 * The two figures that open the section: interest as a share of revenue and debt as a share of GDP
 * in the last year, the same values the sentence below states, each labelled with its year and its
 * condition (with the measures switched on or none, at which rate on new debt) and with the value
 * without the measures, the range of the estimates and the base year's value beside it.
 *
 * Interest received instead of paid, or the debt paid off, are said in the sentence only: there is
 * then no figure that would read the same way, and the sentence stands alone at its larger size.
 */
export function DebtFigures({
  facts,
  measuresOn,
  partial = false,
  ended = false,
}: {
  facts: DebtLeadText;
  measuresOn: boolean;
  /** A switched-on measure has not started, or is not yet in full, in the last year. */
  partial?: boolean;
  /** A switched-on measure has ended before the last year (a one-off, or one that acts for a number of years); "all": every one has. */
  ended?: boolean | "all";
}) {
  const { t } = useUi();
  const f = t.debt.figures;
  if (facts.paidOff !== undefined) return null;
  // A measure that starts later or builds up may not be in full by the last year: the label says so.
  const measures = !measuresOn
    ? f.noMeasures
    : ended
      ? f.withMeasuresEnded(facts.year, partial, ended === "all")
      : partial
        ? f.withMeasuresBy(facts.year)
        : f.withMeasures;
  const condition = `${measures}, ${f.rate(facts.rate)}`;
  const tile = (key: string, what: string, value: string, unit: string, notes: (string | false | undefined)[]) => (
    <div key={key} className={`dfig dfig--${key}`}>
      <dt className="dfig__label">
        <span className="dfig__what">{what}</span>
        <span className="dfig__condition">{condition}</span>
      </dt>
      <dd className="dfig__figure">
        <span className="dfig__value">{value}</span> <span className="dfig__unit">{unit}</span>
      </dd>
      <dd className="dfig__notes">
        {notes
          .filter((note): note is string => Boolean(note))
          .map((note) => (
            <span key={note}>{note}</span>
          ))}
      </dd>
    </div>
  );
  return (
    <dl className="debt__figures">
      {!facts.negative &&
        tile("interest", f.interest(facts.year), facts.interest, f.interestUnit, [
          facts.range && f.range(facts.range),
          facts.interestWithout !== undefined && f.without(facts.interestWithout),
          f.inYear(facts.baseYear, facts.interestToday),
        ])}
      {tile("debt", f.debt(facts.year), facts.debt, f.debtUnit, [
        facts.debtWithout !== undefined && f.without(facts.debtWithout),
        f.inYear(facts.baseYear, facts.debtToday),
      ])}
    </dl>
  );
}

/**
 * When the measures act in this calculation: from the pack's first year (its reason one click away),
 * and, for switched-on measures that start later or build up, which and when. A pack's year and
 * dates are the measures' own; nothing is written here.
 */
export function DebtTiming({ view, horizonEnd }: { view: DebtView; horizonEnd: number }) {
  const ui = useUi();
  const { t, pack } = ui;
  const year = ui.yearName(view.projection.measuresFrom);
  const reason = pack.debt?.measuresFrom;
  const later = laterPhases(view.projection.phases);
  return (
    <div className="debt__timing">
      <p>{t.debt.timing.from(year, view.measuresOn)}</p>
      {reason && (
        <details className="debt__why">
          <summary>{t.debt.timing.why(year)}</summary>
          {blocks(ui.text(reason.note)).map((block, index) => (
            <p key={index}>{block}</p>
          ))}
          {reason.sources && reason.sources.length > 0 && <SourceList ids={reason.sources} />}
        </details>
      )}
      {later.length > 0 && (
        <>
          <p className="debt__later-title">{t.debt.timing.laterTitle(anyEnding(later))}</p>
          <ul className="debt__later">
            {later.map((phase) => {
              const policy = pack.policies.find((candidate) => candidate.id === phase.policy);
              return (
                <li key={phase.policy}>
                  <span className="debt__later-name">{ui.text(policy?.label) || phase.policy}:</span>{" "}
                  {t.debt.timing.when(phaseWords(phase, ui, horizonEnd))}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** Follow an in-page link without touching the fragment of the address, which holds the state. */
function jumpToSection(event: MouseEvent<HTMLAnchorElement>): void {
  preloadDebt();
  const target = document.getElementById("debt");
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView?.({ block: "start" });
  target.focus?.({ preventScroll: true });
}

/** The line near the top of the page that says where the scenario leads and links to the section. */
export function DebtTeaser({ view }: { view: DebtView | undefined }) {
  const ui = useUi();
  const { t, fmt } = ui;
  if (!view) return null;
  const headline = debtHeadline(view);
  const share = (fraction: number): string => fmt.percent(fraction, { digits: 1 });
  return (
    <p className="debt-teaser">
      <a href="#debt" onClick={jumpToSection} onPointerEnter={preloadDebt} onFocus={preloadDebt}>
        <span>{t.debt.teaserLink(ui.yearName(headline.year))}</span>
        <ArrowDown size={14} />
      </a>{" "}
      <span className="debt-teaser__figure">
        {t.debt.teaserFigure(
          ui.yearName(headline.year),
          share(headline.interest),
          headline.interestWithout === undefined ? undefined : share(headline.interestWithout),
          ui.yearName(headline.baseYear),
          share(headline.interestToday),
        )}
      </span>
    </p>
  );
}

export interface DebtSectionProps {
  view: DebtView;
  assumptions: DebtAssumptions;
  onAssumptions(next: DebtAssumptions): void;
  /** The level the budget view is filtered to; the projection is for the whole budget all the same. */
  level: LevelFilter;
  /** Load the body at once, e.g. because the address carries assumptions. */
  eager?: boolean;
}

/** The body: there at once if it has been loaded before, otherwise once it is wanted and has arrived. */
function useBody(section: RefObject<HTMLElement | null>, eager: boolean) {
  const [module, setModule] = useState(() => debtModule.current());
  const [wanted, setWanted] = useState(eager);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Wanted once the section comes within reach of the window. Without IntersectionObserver the
  // placeholder offers a button instead.
  useEffect(() => {
    if (module || wanted) return;
    const element = section.current;
    if (!element || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setWanted(true);
    }, { rootMargin: AHEAD });
    observer.observe(element);
    return () => observer.disconnect();
  }, [module, wanted, section]);
  useEffect(() => {
    if (module || !wanted) return;
    let alive = true;
    debtModule.load().then(
      (loaded) => {
        if (alive) setModule(loaded);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [module, wanted, attempt]);
  return {
    module,
    wanted,
    failed,
    want: () => setWanted(true),
    retry: () => {
      setFailed(false);
      setAttempt((count) => count + 1);
    },
  };
}

export function DebtSection({ view, assumptions, onAssumptions, level, eager = false }: DebtSectionProps) {
  const ui = useUi();
  const { t, fmt } = ui;
  const section = useRef<HTMLElement>(null);
  // Assumptions of their own, from a link: the visitor came for this section, so its code comes at once.
  const body = useBody(section, eager || !sameDebtAssumptions(assumptions, defaultDebtAssumptions(ui.pack.debt!)));
  const headline = debtHeadline(view, interestComparisons(ui.pack, view));
  const facts = leadText(ui, headline);
  const lead = t.debt.lead(facts);
  const figures = facts.paidOff === undefined;
  // Where the calculation starts from: an official plan it follows in its years (its debt, or its
  // budget before interest where it gives no debt), or the base year's budget.
  const plan = view.projection.followed && ui.pack.debt?.plans?.find((candidate) => candidate.id === view.projection.followed?.plan);
  const by = planFollowing(view.projection, ui.pack);
  const followed =
    plan && view.projection.followed && by ? { label: ui.text(plan.label), until: ui.yearName(view.projection.followed.until), by } : undefined;
  const intro = t.debt.intro({ baseYear: ui.yearName(headline.baseYear), plan: followed });

  // After the visitor changes an assumption, screen readers hear the new result once the slider rests.
  const [announced, setAnnounced] = useState("");
  const share = (fraction: number): string => fmt.percent(fraction, { digits: 1 });
  const announcement = t.debt.announce(
    ui.yearName(headline.year),
    share(headline.interest),
    headline.interestWithout === undefined ? undefined : share(headline.interestWithout),
  );
  const latest = useRef(announcement);
  latest.current = announcement;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => setAnnounced(latest.current), 700);
    return () => clearTimeout(timer);
  }, [assumptions]);

  const Body = body.module?.DebtBody;
  return (
    <section className="debt" id="debt" aria-labelledby="debt-title" ref={section} tabIndex={-1}>
      <header className="section-head">
        <h2 id="debt-title">{t.debt.title}</h2>
        {/* Before any figure: what kind of calculation this is. */}
        <p className="debt__caveat">{t.debt.caveat}</p>
      </header>
      {/* The result, as two figures with their labels, then the sentence that says it in full. Where
          the calculation starts from follows under the charts. */}
      <DebtFigures
        facts={facts}
        measuresOn={view.measuresOn}
        partial={notInFullBy(view.projection.phases, headline.year)}
        ended={allEndedBy(view.projection.phases, headline.year) ? "all" : endedBy(view.projection.phases, headline.year)}
      />
      <p className={`debt__lead${figures ? "" : " debt__lead--alone"}`}>{lead}</p>
      <DebtTiming view={view} horizonEnd={headline.year} />
      {level !== "all" && <p className="debt__level">{t.debt.wholeState(ui.levelName(level))}</p>}
      <p className="visually-hidden" aria-live="polite">
        {announced}
      </p>
      {Body ? (
        <Body view={view} assumptions={assumptions} onAssumptions={onAssumptions} intro={intro} />
      ) : (
        <div className={`debt__pending${body.failed ? " is-failed" : ""}`} role="status">
          {body.failed ? (
            <>
              <p>{t.debt.loadFailed}</p>
              <button type="button" className="debt__button" onClick={body.retry}>
                <ResetIcon size={14} />
                <span>{t.debt.retry}</span>
              </button>
            </>
          ) : body.wanted ? (
            <p className="debt__loading">{t.debt.loading}</p>
          ) : (
            <button type="button" className="debt__button" onClick={body.want} onPointerEnter={preloadDebt} onFocus={preloadDebt}>
              {t.debt.show}
            </button>
          )}
        </div>
      )}
      {!Body && <p className="debt__intro">{intro}</p>}
    </section>
  );
}
