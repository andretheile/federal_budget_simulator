/**
 * The controls for a measure's settings: a slider for a number and a choice of groups. Used on the
 * card and in the curve editor (and, for its assumptions, by the debt projection).
 *
 * A number slider with a base-year value shows where that value is: a tick on the track and, right
 * under it, a label that is also a button back to it. The stretch between that tick and the knob is
 * filled in the colour of what this slider's move does to the balance (blue improves, hatched orange
 * worsens), and the value above says how far it is from the base year. A slider without a base-year
 * value is filled from its minimum, as before, or, where its range spans zero, from zero (a tick
 * marks it), so that neither end reads as the starting point. A slider that sets an assumption of
 * the calculation rather than a political choice says so and is drawn in grey. Where the baseline
 * is not the base year's value but, say, the end state of current law, the param names it
 * (baselineLabel), and that name stands wherever the base year would ("Geltendes Recht: 67 Jahre").
 *
 * Every value can be reached: dragging snaps to the base-year value and the default, a slider with
 * many positions moves in 1 % and 10 % steps by key, and the value above becomes a field to type in.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Direction } from "../app/policyModel.ts";
import { changeFromBase, onGrid, snapWhileDragging, typedValue, valueAfterKey } from "../app/sliderModel.ts";
import { useUi } from "../app/ui.ts";
import { findNode, type GroupsParam, type NumberParam } from "../engine/index.ts";
import { decimalsOf } from "../i18n/format.ts";
import type { SliderBase } from "../i18n/messages.ts";
import { Check } from "./icons.tsx";
import { QualityBadge } from "./primitives.tsx";

/** Where the label of the base-year value stands: right or left of its tick, on the scale's line or on a line of its own. */
interface BasePlace {
  side: "after" | "before";
  own: boolean;
}

export function NumberControl({
  id,
  param,
  value,
  onChange,
  direction,
}: {
  id: string;
  param: NumberParam;
  value: number;
  onChange(value: number): void;
  /**
   * What the move from the base-year value to `value` does to the balance, for this slider alone.
   * It colours the stretch between the two; without it the stretch is grey.
   */
  direction?: Direction;
}) {
  const ui = useUi();
  const { t, fmt } = ui;
  // What the baseline is called wherever it is shown: the base year, or its own name where it is not
  // the base year's value ("Geltendes Recht" for a limit the law already raises later).
  // A named baseline is quoted in the texts; otherwise the base year as the pack names it ("FY 2025").
  const baseName: SliderBase = param.baselineLabel ? { named: ui.text(param.baselineLabel) } : ui.period;
  const span = param.max - param.min || 1;
  const at = (amount: number): number => Math.max(0, Math.min(1, (amount - param.min) / span));
  const base = param.baseline;
  const hasBase = base !== undefined;
  const baseOnScale = hasBase && base >= param.min && base <= param.max;
  const assumption = param.role === "assumption";
  const baseId = `${id}-base`;
  const label = ui.text(param.label);
  const valueText = fmt.param(param, value);
  const change = changeFromBase(value, param);
  const digits = decimalsOf(param.step);
  // Years drop the decimals of a whole change, as their value does ("70 Jahre (+3)", "67,5 Jahre (+0,5)").
  const changeDigits = change === null ? 0 : param.unit === "years" ? decimalsOf(change) : Math.max(digits, decimalsOf(change));
  const changeText = change === null ? null : fmt.number(change, { signed: true, digits: changeDigits });
  const shownDirection: Direction = change === null ? "neutral" : (direction ?? "neutral");
  const baseText = hasBase ? fmt.param(param, base) : "";
  const atMin = baseOnScale && base === param.min;
  const atMax = baseOnScale && base === param.max;
  const baseAt = baseOnScale ? at(base) : 0;

  // --- the fill: from the base-year tick to the knob; without one from zero where the range spans
  // it, otherwise from the minimum ----------------------------------------------------------------
  const zeroAt = !baseOnScale && param.min < 0 && param.max > 0 ? at(0) : null;
  const origin = baseOnScale ? baseAt : zeroAt;
  const from = origin === null ? 0 : Math.min(origin, at(value));
  const to = origin === null ? at(value) : Math.max(origin, at(value));
  const fill = assumption ? "assumption" : baseOnScale ? (change === null ? "none" : shownDirection) : "plain";

  // --- dragging snaps to the base-year value and the default -------------------------------------
  const dragging = useRef(false);
  useEffect(() => {
    const release = (): void => {
      dragging.current = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);
  const set = (next: number): void => {
    if (next !== value) onChange(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const next = valueAfterKey(event.key, value, param);
    if (next === null) return;
    event.preventDefault();
    set(next);
  };

  // --- typing a value ------------------------------------------------------------------------------
  const [typing, setTyping] = useState(false);
  const reading = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!typing && returnFocus.current) {
      returnFocus.current = false;
      reading.current?.focus();
    }
  }, [typing]);
  // The unit beside the field: the value 0 in the unit, without the number. A whole number of years
  // is written without decimals ("0 Jahre"), every other unit with those of its step ("0,0 %").
  const zero = fmt.param(param, 0);
  const zeroDigits = fmt.number(0, { digits });
  const unit = (zero.includes(zeroDigits) ? zero.replace(zeroDigits, "") : zero.replace(fmt.number(0), "")).trim();

  // --- where the base-year label goes --------------------------------------------------------------
  const scale = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<BasePlace>({ side: baseAt < 0.5 ? "after" : "before", own: false });
  useLayoutEffect(() => {
    const element = scale.current;
    if (!element || !baseOnScale || atMin || atMax) return;
    const measure = (): void => {
      const box = element.getBoundingClientRect();
      const [low, high] = [...element.querySelectorAll<HTMLElement>(".param__end")].map((end) => end.getBoundingClientRect());
      const label = element.querySelector<HTMLElement>(".param__base");
      if (!low || !high || !label || !(box.width > 0)) return;
      const width = label.getBoundingClientRect().width;
      const knob = 22;
      const x = knob / 2 + baseAt * (box.width - knob);
      const lowEnd = low.right - box.left + 8;
      const highStart = high.left - box.left - 8;
      const fits = (side: BasePlace["side"]): boolean =>
        side === "after" ? x - 1 >= lowEnd && x - 1 + width <= highStart : x + 1 - width >= lowEnd && x + 1 <= highStart;
      const preferred: BasePlace["side"] = baseAt < 0.5 ? "after" : "before";
      const other: BasePlace["side"] = preferred === "after" ? "before" : "after";
      const next: BasePlace = fits(preferred)
        ? { side: preferred, own: false }
        : fits(other)
          ? { side: other, own: false }
          : { side: x - 1 + width <= box.width ? "after" : "before", own: true };
      setPlace((current) => (current.side === next.side && current.own === next.own ? current : next));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [baseOnScale, atMin, atMax, baseAt, baseText, fmt]);

  const toBase = (): void => {
    if (hasBase) set(onGrid(base, param));
  };
  const baseButton = (text: string, className: string) => (
    <button
      type="button"
      className={`${className}${value === base ? " is-current" : ""}`}
      onClick={toBase}
      aria-label={t.policies.toBaseValue(baseText, baseName)}
    >
      {text}
    </button>
  );

  const directionWord =
    shownDirection === "improve" ? t.common.improves : shownDirection === "worsen" ? t.common.worsens : null;
  const spoken = [
    valueText,
    changeText ? t.policies.changeFromBase(changeText, baseName) : null,
    changeText && directionWord && !assumption ? directionWord : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className={`param${assumption ? " param--assumption" : ""}`}
      style={{ ["--at" as string]: at(value), ["--base" as string]: baseAt, ["--from" as string]: from, ["--to" as string]: to }}
    >
      <div className="param__head">
        <label htmlFor={id}>
          {assumption && <span className="param__tag">{t.policies.assumption}</span>}
          {label}
        </label>
        {typing ? (
          <ValueField
            param={param}
            value={value}
            label={t.policies.valueField(label)}
            unit={unit}
            onDone={(next, keepFocus) => {
              returnFocus.current = keepFocus;
              setTyping(false);
              if (next !== null) set(next);
            }}
          />
        ) : (
          <button
            ref={reading}
            type="button"
            className="param__reading"
            onClick={() => setTyping(true)}
            aria-label={t.policies.typeValue(label, valueText)}
          >
            <span className="param__value">{valueText}</span>
            {changeText && <span className={`param__change param__change--${shownDirection}`}> ({changeText})</span>}
          </button>
        )}
      </div>
      <div className={`param__slider param__slider--${fill}${origin === null ? " is-from-start" : ""}`}>
        <span className="param__track" aria-hidden="true" />
        <span className="param__fill" aria-hidden="true" />
        <input
          id={id}
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          aria-valuetext={spoken}
          aria-describedby={hasBase ? baseId : undefined}
          onPointerDown={() => {
            dragging.current = true;
          }}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            const raw = Number(event.target.value);
            set(dragging.current ? snapWhileDragging(raw, param) : raw);
          }}
        />
        {baseOnScale && <span className="param__baseline" aria-hidden="true" />}
        {zeroAt !== null && <span className="param__zero" aria-hidden="true" style={{ ["--zero" as string]: zeroAt }} />}
      </div>
      <div className={`param__scale${place.own ? " has-own-line" : ""}`} ref={scale}>
        {atMin ? (
          baseButton(t.policies.baseAtEnd(fmt.param(param, param.min), baseName), "param__end param__end--min param__end--base")
        ) : (
          <span className="param__end param__end--min" aria-hidden="true">
            {fmt.param(param, param.min)}
          </span>
        )}
        {baseOnScale && !atMin && !atMax && baseButton(t.policies.baseValue(baseText, baseName), `param__base param__base--${place.side}`)}
        {atMax ? (
          baseButton(t.policies.baseAtEnd(fmt.param(param, param.max), baseName), "param__end param__end--max param__end--base")
        ) : (
          <span className="param__end param__end--max" aria-hidden="true">
            {fmt.param(param, param.max)}
          </span>
        )}
      </div>
      {hasBase && !baseOnScale && (
        <p className="param__note muted" aria-hidden="true">
          {t.policies.baseValue(baseText, baseName)}
        </p>
      )}
      {/* What the slider says about the base year to screen readers; the label under the tick is a button. */}
      {hasBase && (
        <span id={baseId} className="visually-hidden">
          {t.policies.baseValue(baseText, baseName)}
        </span>
      )}
    </div>
  );
}

/**
 * The value as a field to type in: the number in the language of the page, either decimal mark
 * accepted. Enter or leaving the field sets it (inside the range, on the grid); Escape keeps the
 * value as it was.
 */
function ValueField({
  param,
  value,
  label,
  unit,
  onDone,
}: {
  param: NumberParam;
  value: number;
  label: string;
  unit: string;
  /** The new value (null: none), and whether the focus should go back to the value. */
  onDone(next: number | null, keepFocus: boolean): void;
}) {
  const { fmt } = useUi();
  const [text, setText] = useState(() => fmt.number(value, { digits: decimalsOf(param.step) }));
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const finish = (commit: boolean, keepFocus: boolean): void => {
    if (done.current) return;
    done.current = true;
    onDone(commit ? typedValue(text, param, fmt.parse) : null, keepFocus);
  };
  return (
    <span className="param__field">
      <input
        ref={field}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => finish(true, false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true, true);
          } else if (event.key === "Escape") {
            // Only the field: the sheet of the curve editor would close on an Escape that gets through.
            event.preventDefault();
            finish(false, true);
          }
        }}
      />
      {unit && <span aria-hidden="true">{unit}</span>}
    </span>
  );
}

export function GroupsControl({
  param,
  value,
  onChange,
}: {
  param: GroupsParam;
  value: string[];
  onChange(value: string[]): void;
}) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const node = findNode(pack, param.node);
  const breakdown = node?.breakdowns?.[param.breakdown];
  if (!node || !breakdown) return null;
  const total = breakdown.groups.reduce((sum, group) => sum + group.share, 0) || 1;
  const selected = new Set(value);
  const share = breakdown.groups.reduce((sum, group) => sum + (selected.has(group.id) ? group.share / total : 0), 0);
  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(breakdown.groups.filter((group) => next.has(group.id)).map((group) => group.id));
  };
  return (
    <fieldset className="param param--groups">
      <legend>{ui.text(param.label)}</legend>
      <div className="chips">
        {breakdown.groups.map((group) => {
          const on = selected.has(group.id);
          return (
            <button key={group.id} type="button" className="chip" aria-pressed={on} onClick={() => toggle(group.id)}>
              <span className="chip__box" aria-hidden="true">
                {on && <Check size={12} />}
              </span>
              <span className="chip__label">{ui.text(group.label)}</span>
              <span className="chip__share">
                <span className="visually-hidden">{t.policies.groupShare} </span>
                {fmt.share(group.share / total)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="param__note">
        {selected.size === 0
          ? t.policies.noGroups
          : t.policies.selectedShare(fmt.share(share), breakdown.basis, ui.text(node.label))}
      </p>
      <p className="param__note muted">
        {ui.text(breakdown.label)} · <QualityBadge quality={breakdown.quality} />
        {breakdown.note && ` · ${ui.text(breakdown.note)}`}
      </p>
    </fieldset>
  );
}
