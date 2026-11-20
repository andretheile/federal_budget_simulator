/**
 * The goal bar: a row of the scoreboard's band, so it stays in view with it while the visitor
 * scrolls the measures. It says what the goal is (the gap in a financial plan, say), how far the
 * measures switched on close it, and what remains: as a bar and in words. Only what reaches the
 * goal's level of government counts, whatever level the page shows; the bar says so in one phrase.
 *
 * The figures come from one more simulation at the goal's level. While a control is dragged it
 * runs at a lower priority than the scoreboard (useDeferredValue); when the page already shows the
 * goal's level, the page's own simulation is used and there is none.
 *
 * From a tablet on, the words keep the room of the longest they can become (invisible stand-ins, as
 * the scoreboard does while the curve editor is open), so the band does not change its height when
 * a figure gets longer or the state changes. A phone keeps two lines for them. The room lies in an
 * element of its own (goalbar__room) that also holds the rows below the words, so whatever it keeps
 * to spare ends up under the last row instead of between the state and its qualifiers. While the
 * band floats, the words have one line (see goal.css). While the editor is open the bar has no
 * controls: the sheet is a modal dialog, and the band above it only reports, in one line.
 *
 * For a goal of one level, the bar also says how much the other levels are burdened at the same
 * time, when they are: a row of its own under the state, and a short form in the one line of the
 * floating bar on a phone and of the bar above the editor, so that "closed" never stands there
 * without it.
 *
 * The description, the long note and the sources are in a dialog of their own, loaded when it is
 * first opened (GoalDetails.tsx), and ahead of time when a pointer or the focus reaches its button.
 */
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { goalView, type ExcludedChange, type GoalView } from "../app/goalModel.ts";
import { lazyModule } from "../app/lazy.ts";
import { useUi, type Ui } from "../app/ui.ts";
import { findNode, goalLevel, simulate, type Goal, type GoalExclusion, type Scenario, type SimulationResult } from "../engine/index.ts";
import { Check, CloseIcon, InfoIcon, ResetIcon, TriangleDown } from "./icons.tsx";
import { standIn, widest } from "./Scoreboard.tsx";

/** The inside of the details dialog, a part of the app of its own. */
export const goalDetailsModule = lazyModule(() => import("./GoalDetails.tsx"));

/** Starts loading the details, so that the dialog opens without a wait. */
export function preloadGoalDetails(): void {
  goalDetailsModule.preload();
}

/** What a goal leaves out (goals.json `excluded`): budget items and measures, each with the pack's reason. */
export function exclusionsOf(goal: Goal): GoalExclusion[] {
  return goal.excluded ?? [];
}

/** The goal's entry for an excluded change, matched by its node or measure. */
export function exclusionFor(goal: Goal, change: ExcludedChange): GoalExclusion | undefined {
  return exclusionsOf(goal).find((entry) =>
    change.policy !== undefined ? entry.policy === change.policy : change.node !== undefined && entry.node === change.node,
  );
}

/** A text of the pack as a sentence: a capital at the start, a full stop at the end. */
export function asSentence(text: string, language: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const capital = trimmed.charAt(0).toLocaleUpperCase(language) + trimmed.slice(1);
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}

/** What an excluded change (or the goal's entry for it) is, in words: the budget item's name or the measure's. */
export function excludedName(ui: Ui, change: Pick<ExcludedChange, "node" | "policy">): string {
  const { pack, t } = ui;
  if (change.policy !== undefined) {
    const policy = pack.policies.find((candidate) => candidate.id === change.policy);
    return t.goal.excludedPolicy(ui.text(policy?.label) || change.policy);
  }
  const node = change.node === undefined ? undefined : findNode(pack, change.node);
  return t.goal.excludedItem(ui.text(node?.label) || (change.node ?? ""));
}

export interface GoalBarProps {
  goal: Goal;
  /** The scenario; it is simulated once more at the goal's level unless `result` is already there. */
  scenario: Scenario;
  /** What the page shows. */
  result: SimulationResult;
  onGoal(id: string): void;
  /** The curve editor is open below the band: no controls, only the report. */
  steady: boolean;
}

/**
 * What the other levels bear at the same time, for a goal of one level: a sentence for the row of
 * its own, and the short form that stands in the one line of the compact bar.
 */
export function othersWords(ui: Ui, view: GoalView): { sentence: string; short: string } | undefined {
  if (!(view.othersBurden > 0)) return undefined;
  const { t, fmt } = ui;
  return { sentence: t.goal.othersBurden(fmt.money(view.othersBurden)), short: t.goal.othersShort(fmt.money(-view.othersBurden, { signed: true })) };
}

/** The words for the state of a goal: one sentence, then what qualifies it (the range, the cautious end). */
export function goalWords(ui: Ui, view: GoalView): { main: string; extras: string[] } {
  const { t, fmt } = ui;
  const money = (value: number): string => fmt.money(value);
  const signed = (value: number): string => fmt.money(value, { signed: true });
  const range = view.range ? `${t.scoreboard.rangeLabel} ${t.common.range(signed(view.range[0]), signed(view.range[1]))}` : undefined;
  switch (view.state) {
    case "none":
      return { main: t.goal.none(money(view.needed)), extras: [t.goal.noneWhy] };
    case "unchanged":
      // Something did change at the level when anything left out is not zero, but it does not count.
      return { main: t.goal.unchanged(money(view.needed)), extras: [view.excluded.length > 0 ? t.goal.uncountedWhy : t.goal.unchangedWhy] };
    case "partial":
      return { main: t.goal.partial(money(view.improvement), money(view.remaining)), extras: range ? [range] : [] };
    case "burden":
      return { main: t.goal.burden(money(view.growth), money(view.needed + view.growth)), extras: range ? [range] : [] };
    case "closed": {
      const extras = money(view.surplus) === money(0) ? [] : [t.goal.surplus(money(view.surplus))];
      // The range is on the bar; in words, what matters is whether it holds at the cautious end too.
      if (range) extras.push(view.closedCautious ? t.goal.cautiousAlso : t.goal.cautiousMissing(money(view.remainingCautious)));
      return { main: t.goal.closedBy(money(view.improvement)), extras };
    }
  }
}

/** Joins names the way the language does: "a, b and c". */
function listOf(language: string, items: string[]): string {
  try {
    return new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/** A reason up to this length stands on the bar itself; a longer one, or several, are in the details. */
const SHORT_REASON = 90;

/**
 * The line about what the goal leaves out, if anything left out is not zero: what it is and its
 * amount. With one entry and a short reason the reason follows; otherwise the reasons are one
 * click away, in the details.
 */
export function excludedWords(ui: Ui, goal: Goal, view: GoalView): { line: string; reason?: string } | undefined {
  if (view.excluded.length === 0) return undefined;
  const { t, fmt } = ui;
  const named = view.excluded.map((change) => ({ change, name: excludedName(ui, change), amount: fmt.money(change.improvement, { signed: true }) }));
  if (named.length === 1) {
    const [{ change, name, amount }] = named;
    const reason = exclusionFor(goal, change)?.reason;
    const text = reason ? asSentence(ui.text(reason), ui.language) : "";
    return { line: t.goal.excludedOne(name, amount), reason: text && text.length <= SHORT_REASON ? text : undefined };
  }
  return { line: t.goal.excludedMany(listOf(ui.language, named.map(({ name, amount }) => t.goal.excludedPart(name, amount)))) };
}

/**
 * The sentence and its qualifiers, with the tag of the closed state in front, and what the other
 * levels bear in its short form: that is shown only where the bar has one line (see goal.css).
 */
function Status({ closed, main, extras, others }: { closed: boolean; main: string; extras: readonly string[]; others?: string }) {
  const { t } = useUi();
  return (
    <>
      {closed && (
        <span className="goalbar__tag">
          <Check size={12} />
          {t.goal.closed}
        </span>
      )}
      <span className="goalbar__main">{main}</span>
      {extras.map((extra) => (
        <span key={extra} className="goalbar__extra">
          {extra}
        </span>
      ))}
      {others && (
        <span className="goalbar__others-chip">
          <TriangleDown size={10} />
          {others}
        </span>
      )}
    </>
  );
}

export function GoalBar({ goal, scenario, result, onGoal, steady }: GoalBarProps) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const level = goalLevel(goal);
  const own = result.level === level;
  // The extra simulation follows the scenario at a lower priority than the scoreboard.
  const deferred = useDeferredValue(scenario);
  const simulated = useMemo(() => (own ? undefined : simulate(pack, { ...deferred, level })), [own, pack, deferred, level]);
  const goalResult = own ? result : simulated!;
  // For a goal of one level, the same scenario for the whole state: what the other levels bear.
  const base = own ? scenario : deferred;
  const whole = useMemo(() => (goal.level === undefined ? undefined : simulate(pack, { ...base, level: "all" })), [goal.level, pack, base]);
  const view = useMemo(() => goalView(goal, goalResult, whole), [goal, goalResult, whole]);
  const words = goalWords(ui, view);
  const others = othersWords(ui, view);
  const excluded = excludedWords(ui, goal, view);
  const goals = pack.goals?.goals ?? [];
  const label = ui.text(goal.label);
  const pickerId = useId();
  const levelPhrase = goal.level ? t.goal.level(ui.levelName(goal.level)) : t.goal.wholeState;
  // Whose budget the goal is about, beside its label: the band above it shows all levels together.
  const scope = goal.level ? ui.levelName(goal.level) : t.goal.wholeStateName;
  // "Ziel · Bund" as seen; a screen reader hears it as one phrase ("Ziel, gemessen auf der Ebene „Bund“").
  const labelParts = (
    <>
      <span className="goalbar__label-full" aria-hidden="true">
        {t.goal.label}
      </span>
      <span className="goalbar__label-year" aria-hidden="true">
        {t.goal.labelYear(goal.year)}
      </span>
      <span className="goalbar__scope" aria-hidden="true">
        {scope}
      </span>
      <span className="visually-hidden">{t.goal.scopedLabel(goal.level ? ui.levelName(goal.level) : undefined)}</span>
    </>
  );
  // What the bar shows, in words: the state, what the other levels bear meanwhile, the qualifiers.
  const valueText = [words.main, ...(others ? [others.sentence] : []), ...words.extras].join(" ");

  // The room of the longest words the bar can show: every state, with figures of the widest digits.
  const { revenue, expenditure } = goalResult.baseline;
  const needed = goal.amount;
  const standIns = useMemo(() => {
    const amount = widest(fmt.money(-standIn(Math.max(needed * 10, Math.max(revenue, expenditure) / 10))));
    const signedAmount = widest(fmt.money(standIn(Math.max(needed * 10, Math.max(revenue, expenditure) / 10)), { signed: true }));
    const range = `${t.scoreboard.rangeLabel} ${t.common.range(signedAmount, signedAmount)}`;
    // Where the bar has one line, what the other levels bear stands in it as well.
    const others = t.goal.othersShort(signedAmount);
    const variants: { closed: boolean; main: string; extras: string[]; others?: string }[] = [
      { closed: false, main: t.goal.none(amount), extras: [t.goal.noneWhy] },
      { closed: false, main: t.goal.unchanged(amount), extras: [t.goal.unchangedWhy] },
      { closed: false, main: t.goal.unchanged(amount), extras: [t.goal.uncountedWhy] },
      { closed: false, main: t.goal.partial(amount, amount), extras: [range] },
      { closed: true, main: t.goal.closedBy(amount), extras: [t.goal.surplus(amount), t.goal.cautiousMissing(amount)] },
      { closed: true, main: t.goal.closedBy(amount), extras: [t.goal.surplus(amount), t.goal.cautiousAlso] },
      { closed: false, main: t.goal.burden(amount, amount), extras: [range] },
    ].map((variant) => ({ ...variant, others }));
    return variants.map((variant, index) => (
      <span key={index} className="goalbar__line goalbar__stand-in" aria-hidden="true">
        <Status {...variant} />
      </span>
    ));
  }, [fmt, t, needed, revenue, expenditure]);

  // Screen readers hear the new state once the visitor has stopped moving a control, after the scoreboard.
  const announcement = t.goal.announce(label, valueText);
  const [announced, setAnnounced] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => setAnnounced(announcement), 1000);
    return () => clearTimeout(timer);
  }, [announcement]);

  // --- the details ---
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const openDetails = (event: { currentTarget: HTMLButtonElement }): void => {
    // The focus goes back to the button that opened the dialog.
    opener.current = event.currentTarget;
    preloadGoalDetails();
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
    opener.current?.focus({ preventScroll: true });
  };

  const { bar } = view;
  return (
    <div className={`goalbar goalbar--${view.state}${steady ? " goalbar--steady" : ""}${others ? " has-others" : ""}`} data-goal={goal.id}>
      <div className="goalbar__inner page">
        <div className="goalbar__head">
          {goals.length > 1 && !steady ? (
            <>
              <label className="goalbar__label" htmlFor={pickerId}>
                {labelParts}
              </label>
              <span className="goalbar__picker">
                <select id={pickerId} value={goal.id} onChange={(event) => onGoal(event.target.value)}>
                  {goals.map((option) => (
                    <option key={option.id} value={option.id}>
                      {ui.text(option.label)}
                    </option>
                  ))}
                </select>
              </span>
            </>
          ) : (
            <>
              <span className="goalbar__label">{labelParts}</span>
              <span className="goalbar__name">{label}</span>
            </>
          )}
          {!steady && (
            <button
              type="button"
              className="goalbar__more"
              aria-haspopup="dialog"
              onClick={openDetails}
              onPointerEnter={preloadGoalDetails}
              onFocus={preloadGoalDetails}
            >
              <InfoIcon size={14} />
              <span className="goalbar__more-text">{t.goal.details}</span>
              <span className="visually-hidden">: {label}</span>
            </button>
          )}
        </div>

        <div
          className="goalbar__track"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={bar.value}
          aria-valuetext={valueText}
        >
          {bar.fill && (
            <span
              className={`goalbar__fill goalbar__fill--${bar.fill.direction}`}
              style={{ left: `${bar.fill.from}%`, width: `${bar.fill.to - bar.fill.from}%` }}
            />
          )}
          {bar.range && (
            <span className="goalbar__range" style={{ left: `${bar.range.from}%`, width: `${bar.range.to - bar.range.from}%` }} />
          )}
          {bar.zero > 0.5 && <span className="goalbar__zero" style={{ left: `${bar.zero}%` }} />}
          <span className={`goalbar__goal${view.state === "closed" ? " is-met" : ""}`} style={{ left: `${bar.goal}%` }} />
        </div>

        {/* What the bar shows, in words. Screen readers have it as the bar's value. */}
        <p className="goalbar__status" aria-hidden="true">
          <span className="goalbar__line">
            <Status closed={view.state === "closed"} main={words.main} extras={words.extras} others={others?.short} />
          </span>
        </p>

        {/* Said beside the state, not as its cause: what the other levels bear in the same scenario. */}
        {others && (
          <p className="goalbar__others" aria-hidden="true">
            <TriangleDown size={11} />
            <span>{others.sentence}</span>
          </p>
        )}

        <p className="goalbar__level">{levelPhrase}</p>
        {excluded && (
          <p className="goalbar__excluded">
            {excluded.line}
            {excluded.reason ? (
              ` ${excluded.reason}`
            ) : !steady ? (
              <>
                {" "}
                <button type="button" className="goalbar__why" onClick={openDetails} onPointerEnter={preloadGoalDetails} onFocus={preloadGoalDetails}>
                  {t.goal.why}
                </button>
              </>
            ) : null}
          </p>
        )}

        {/*
          The room the words keep (see goal.css): the longest they can become, and below it the same
          rows as on the bar. Where the bar has its rows one under the other, this spans them all and
          an empty last row takes what is left, so any room to spare lies at the bottom of the bar,
          not between the state and the lines that belong to it. Nobody but the layout sees it.
        */}
        <div className="goalbar__room" aria-hidden="true">
          <p className="goalbar__status">
            {standIns}
            <span className="goalbar__two-lines" />
          </p>
          {others && (
            <p className="goalbar__others">
              <TriangleDown size={11} />
              <span>{others.sentence}</span>
            </p>
          )}
          <p className="goalbar__level">{levelPhrase}</p>
          {excluded && (
            <p className="goalbar__excluded">
              {excluded.line}
              {excluded.reason ? (
                ` ${excluded.reason}`
              ) : !steady ? (
                <>
                  {" "}
                  <span className="goalbar__why">{t.goal.why}</span>
                </>
              ) : null}
            </p>
          )}
        </div>
      </div>
      <p className="visually-hidden" role="status">
        {announced}
      </p>
      {open && <GoalDialog goal={goal} view={view} scenario={base} onClose={close} />}
    </div>
  );
}

/** The module of the details: there at once if it has been loaded before, otherwise once it arrives. */
function useDetailsModule() {
  const [module, setModule] = useState(() => goalDetailsModule.current());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (module) return;
    let alive = true;
    goalDetailsModule.load().then(
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
  }, [module, attempt]);
  return {
    module,
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((count) => count + 1);
    },
  };
}

/**
 * The dialog with the goal's description, the note and the sources: a modal dialog of the browser,
 * which keeps the focus inside, closes with Escape and gives the page back as it was.
 */
function GoalDialog({ goal, view, scenario, onClose }: { goal: Goal; view: GoalView; scenario: Scenario; onClose(): void }) {
  const ui = useUi();
  const { t } = ui;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const body = useDetailsModule();
  const done = useRef(onClose);
  done.current = onClose;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) {
      try {
        element.showModal();
      } catch {
        // A browser without modal dialogs (or a test environment): shown in place all the same.
        element.setAttribute("open", "");
      }
    }
    // Escape, the close button and the backdrop all end in the dialog's own "close".
    const onCloseEvent = (): void => done.current();
    element.addEventListener("close", onCloseEvent);
    return () => element.removeEventListener("close", onCloseEvent);
  }, []);

  const shut = (): void => {
    const element = dialog.current;
    if (element && typeof element.close === "function" && element.open) element.close();
    else done.current();
  };

  const Body = body.module?.GoalDetails;
  let content: ReactNode;
  if (Body) content = <Body goal={goal} view={view} scenario={scenario} />;
  else if (body.failed)
    content = (
      <div className="goaldialog__pending is-failed" role="alert">
        <p>{t.goal.loadFailed}</p>
        <button type="button" className="goaldialog__button" onClick={body.retry}>
          <ResetIcon size={14} />
          <span>{t.goal.retry}</span>
        </button>
      </div>
    );
  else
    content = (
      <p className="goaldialog__pending" role="status">
        <span className="goaldialog__loading">{t.goal.loading}</span>
      </p>
    );

  return (
    <dialog
      ref={dialog}
      className="goaldialog"
      aria-labelledby={titleId}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself; the content lies in the frame inside it.
        if (event.target === event.currentTarget) shut();
      }}
    >
      <div className="goaldialog__frame">
        <header className="goaldialog__head">
          <p className="goaldialog__kicker">{t.goal.label}</p>
          <h2 id={titleId} className="goaldialog__title">
            {ui.text(goal.label)}
          </h2>
          <button type="button" className="goaldialog__close" onClick={shut}>
            <CloseIcon size={14} />
            <span className="visually-hidden">{t.header.close}</span>
          </button>
        </header>
        {content}
      </div>
    </dialog>
  );
}
