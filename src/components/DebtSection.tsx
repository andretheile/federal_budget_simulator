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
import { debtHeadline, interestComparisons, type DebtHeadline, type DebtView } from "../app/debtModel.ts";
import { lazyModule } from "../app/lazy.ts";
import { useUi, type Ui } from "../app/ui.ts";
import type { DebtAssumptions, LevelFilter } from "../engine/index.ts";
import { decimalsIn } from "../i18n/format.ts";
import type { DebtLeadText } from "../i18n/debt/messages.ts";
import "../styles/debt.css";
import { ChevronDown, ResetIcon } from "./icons.tsx";

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
    year: headline.year,
    baseYear: headline.baseYear,
    rate: fmt.percent(headline.marketRate / 100, { digits: decimalsIn(headline.marketRate, 2) }),
    interest: share(Math.abs(headline.interest)),
    negative: headline.interest < 0 && share(headline.interest) !== share(0),
    interestWithout: headline.interestWithout === undefined ? undefined : share(headline.interestWithout),
    range: headline.interestRange && rangeLow !== rangeHigh ? ui.t.common.range(rangeLow, rangeHigh) : undefined,
    interestToday: share(headline.interestToday),
    debt: ratio(headline.debt),
    debtWithout: headline.debtWithout === undefined ? undefined : ratio(headline.debtWithout),
    debtToday: ratio(headline.debtToday),
    paidOff: headline.paidOff,
    overtakes: headline.overtakes && { label: ui.text(headline.overtakes.label), since: headline.overtakes.since },
  };
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
        <span>{t.debt.teaserLink(headline.year)}</span>
        <ChevronDown size={14} />
      </a>{" "}
      <span className="debt-teaser__figure">
        {t.debt.teaserFigure(
          headline.year,
          share(headline.interest),
          headline.interestWithout === undefined ? undefined : share(headline.interestWithout),
          headline.baseYear,
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
  /** The level the budget view is filtered to; the projection is for the whole state all the same. */
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
  const lead = t.debt.lead(leadText(ui, headline));
  // The calculation follows an official plan in its years (a preset or the address chose it).
  const plan = view.projection.followed && ui.pack.debt?.plans?.find((candidate) => candidate.id === view.projection.followed?.plan);
  const followed = plan && view.projection.followed ? { label: ui.text(plan.label), until: view.projection.followed.until } : undefined;

  // After the visitor changes an assumption, screen readers hear the new result once the slider rests.
  const [announced, setAnnounced] = useState("");
  const share = (fraction: number): string => fmt.percent(fraction, { digits: 1 });
  const announcement = t.debt.announce(
    headline.year,
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
        <p>{t.debt.intro(headline.baseYear)}</p>
      </header>
      <p className="debt__lead">{lead}</p>
      {level !== "all" && <p className="debt__level">{t.debt.wholeState(ui.levelName(level))}</p>}
      {followed && <p className="debt__level debt__following">{t.debt.following(followed.label, followed.until)}</p>}
      <p className="visually-hidden" aria-live="polite">
        {announced}
      </p>
      {Body ? (
        <Body view={view} assumptions={assumptions} onAssumptions={onAssumptions} />
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
    </section>
  );
}
