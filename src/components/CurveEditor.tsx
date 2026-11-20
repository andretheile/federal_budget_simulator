/**
 * The curve editor: a sheet over the page, below the scoreboard, which stays in view so the
 * balance can be watched while the curve changes. It works for any curve parameter of any
 * measure; every label comes from the pack or the dictionary.
 *
 * This file is the sheet itself: its place on the page, the header with the measure's name, its
 * switch and the close button, and the keys that close it. It is part of the first load. What is
 * inside (CurveEditorBody.tsx: the chart, the tables, the readouts, with their styles) is a part of
 * its own that most visitors never need: it is loaded when an editor opens, and ahead of time when
 * a pointer or the keyboard focus reaches a button that opens one. Until it is there the sheet
 * stands with its header and says that the editor is loading; if it cannot be loaded (offline), it
 * says so and offers to try again.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { curveSettings, type CurveSetting } from "../app/curveModel.ts";
import { lazyModule } from "../app/lazy.ts";
import { useUi } from "../app/ui.ts";
import type { LevelFilter, ParamValue, Policy, PolicyResult, PolicyState, Totals } from "../engine/index.ts";
import { CloseIcon, ResetIcon } from "./icons.tsx";
import { Switch } from "./primitives.tsx";

export interface CurveEditorProps {
  policy: Policy;
  paramId: string;
  state: PolicyState | undefined;
  /** The measure's result inside the current scenario, if it is switched on. */
  inScenario: PolicyResult | undefined;
  level: LevelFilter;
  /** Base-year totals of the current view. */
  baseline: Totals;
  onToggle(id: string, enabled: boolean): void;
  /** Sets a parameter and switches the measure on. */
  onChange(id: string, param: string, value: ParamValue): void;
  onClose(): void;
}

/** Whether a curve parameter of this measure can be edited: it exists and a schedule uses it. */
export function editableCurve(policy: Policy | undefined, paramId: string): CurveSetting | undefined {
  return policy ? curveSettings(policy).find((setting) => setting.param.id === paramId) : undefined;
}

/** The inside of the editor, a part of the app of its own. */
export const editorModule = lazyModule(() => import("./CurveEditorBody.tsx"));

/** Starts loading the inside of the editor, so that it opens without a wait. */
export function preloadEditor(): void {
  editorModule.preload();
}

/**
 * Keeps the scoreboard in view above the sheet: the page is scrolled until the scoreboard sticks
 * to the top of the window, and does not scroll while the sheet is open. Afterwards the page goes
 * back to where it was.
 */
function useSheetPlacement(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const before = window.scrollY;
    const stick = (): void => {
      const sentinel = document.querySelector<HTMLElement>(".scoreboard-sentinel");
      if (!sentinel) return;
      // Just past the sentinel: the scoreboard then counts as stuck and takes its compact form on a phone.
      const top = sentinel.getBoundingClientRect().top + window.scrollY + 2;
      if (window.scrollY < top) window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
    };
    stick();
    root.classList.add("has-sheet");
    // The header above the scoreboard can still change height: web fonts arriving, a turned phone.
    let open = true;
    void document.fonts?.ready.then(() => open && stick());
    window.addEventListener("resize", stick);
    return () => {
      open = false;
      window.removeEventListener("resize", stick);
      root.classList.remove("has-sheet");
      window.scrollTo({ top: before, behavior: "instant" as ScrollBehavior });
    };
  }, []);
}

/** The inside of the editor: there at once if it has been loaded before, otherwise once it arrives. */
function useEditorModule() {
  const [module, setModule] = useState(() => editorModule.current());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (module) return;
    let alive = true;
    editorModule.load().then(
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
  const retry = (): void => {
    setFailed(false);
    setAttempt((count) => count + 1);
  };
  return { module, failed, retry };
}

export function CurveEditor(props: CurveEditorProps) {
  const setting = editableCurve(props.policy, props.paramId);
  useSheetPlacement();
  const { t, text } = useUi();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { onClose } = props;
  const body = useEditorModule();

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  // Escape closes the sheet wherever the focus is: Safari does not focus a button on a click, so
  // the focus can be on the page's body while the sheet is open. A field that uses Escape itself
  // (to drop what was typed) stops it on the way.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) close.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const Body = body.module?.EditorBody;
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="sheet__inner page">
        {/* The switch and the close button stand on the line of the topic; the title below has the
            whole width, so a long name never runs into them. */}
        <header className="sheet__head">
          <p className="policy__topic sheet__topic">
            {t.policies.topics[props.policy.topic]} · {t.curve.edit}
          </p>
          <h2 className="sheet__title" id={titleId} ref={heading} tabIndex={-1}>
            {text(props.policy.label)}
          </h2>
          {setting && <p className="sheet__subtitle">{text(setting.param.label)}</p>}
          <div className="sheet__tools">
            <Switch
              checked={props.state?.enabled === true}
              label={t.policies.switchOn(text(props.policy.label))}
              onChange={(next) => props.onToggle(props.policy.id, next)}
            />
            <button type="button" className="tool sheet__close" onClick={onClose}>
              <CloseIcon size={14} />
              <span className="sheet__close-text">{t.curve.close}</span>
            </button>
          </div>
        </header>
        {setting &&
          (Body ? (
            <Body {...props} setting={setting} />
          ) : body.failed ? (
            <div className="sheet__pending sheet__pending--failed" role="alert">
              <p>{t.curve.loadFailed}</p>
              <button
                type="button"
                className="tool"
                onClick={() => {
                  // The button goes away while the next attempt runs; the focus waits on the title.
                  heading.current?.focus({ preventScroll: true });
                  body.retry();
                }}
              >
                <ResetIcon size={14} />
                <span>{t.curve.retry}</span>
              </button>
            </div>
          ) : (
            <div className="sheet__pending" role="status">
              <p className="sheet__loading">{t.curve.loading}</p>
            </div>
          ))}
      </div>
    </div>
  );
}
