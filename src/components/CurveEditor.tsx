/**
 * The curve editor: a sheet over the page, below the scoreboard, which stays in view so the
 * balance can be watched while the curve changes. It works for any curve parameter of any
 * measure; every label comes from the pack or the dictionary.
 *
 *   - the chart: drag, add and remove points (CurveChart);
 *   - presets from the pack, today's curve, one step of undo;
 *   - what the curve does, live: the effect on the balance with its range, who pays more or less,
 *     what the pack's examples pay today and after, the top rate;
 *   - a table of the points with number fields, which does everything the chart does;
 *   - the measure's other settings, and one sentence on how the figure is calculated.
 *
 * Every change made here switches the measure on, so the scoreboard shows it at once.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  addPoint,
  beginChange,
  canAdd,
  canRemove,
  curveSettings,
  matchingPreset,
  movePoint,
  NO_UNDO,
  pointLimits,
  recordChange,
  removePoint,
  sameCurve,
  samePoints,
  sameWithin,
  stepFrom,
  suggestedX,
  todayForDrawing,
  todayPoints,
  topRate,
  type CurveSetting,
  type UndoState,
} from "../app/curveModel.ts";
import { chooseScale } from "../app/curveScale.ts";
import { insightOf, noiseLevel, type Direction } from "../app/policyModel.ts";
import { useUi, type Ui } from "../app/ui.ts";
import {
  curveOwed,
  findNode,
  payMoreOrLess,
  resolveParams,
  scheduleView,
  simulate,
  simulatePolicy,
  type CountryPack,
  type CurvePoint,
  type LevelFilter,
  type ParamValue,
  type Policy,
  type PolicyResult,
  type PolicyState,
  type Totals,
} from "../engine/index.ts";
import { decimalsIn } from "../i18n/format.ts";
import { CurveChart } from "./CurveChart.tsx";
import { CloseIcon, MinusIcon, PlusIcon, ResetIcon } from "./icons.tsx";
import { GroupsControl, NumberControl } from "./ParamControls.tsx";
import { Delta, SourceList, Switch } from "./primitives.tsx";

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

/** Base-year amounts of every node for the whole state, per pack. */
const baseAmounts = new WeakMap<CountryPack, Record<string, number>>();
function baseAmount(pack: CountryPack, nodeId: string): number {
  let amounts = baseAmounts.get(pack);
  if (!amounts) {
    const nodes = simulate(pack).nodes;
    amounts = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, node.baseline]));
    baseAmounts.set(pack, amounts);
  }
  return amounts[nodeId] ?? 0;
}

function directionWord(ui: Ui, direction: Direction, level: LevelFilter): string {
  const { common } = ui.t;
  if (level === "all") return direction === "improve" ? common.improves : direction === "worsen" ? common.worsens : common.noEffect;
  return direction === "improve" ? common.relieves : direction === "worsen" ? common.burdens : common.noEffectLevel;
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

export function CurveEditor(props: CurveEditorProps) {
  const setting = editableCurve(props.policy, props.paramId);
  useSheetPlacement();
  const { t, text } = useUi();
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { onClose } = props;

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

  return (
    <div
      ref={sheet}
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="sheet__inner page">
        <header className="sheet__head">
          <div className="sheet__titles">
            <p className="policy__topic">
              {t.policies.topics[props.policy.topic]} · {t.curve.edit}
            </p>
            <h2 className="sheet__title" id={titleId} ref={heading} tabIndex={-1}>
              {text(props.policy.label)}
            </h2>
            {setting && <p className="sheet__subtitle">{text(setting.param.label)}</p>}
          </div>
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
        {setting && <EditorBody {...props} setting={setting} />}
      </div>
    </div>
  );
}

function EditorBody({
  policy,
  setting,
  state,
  inScenario,
  level,
  baseline,
  onChange: setParam,
}: CurveEditorProps & { setting: CurveSetting }) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const { param, effect } = setting;
  const keysId = useId();
  const enabled = state?.enabled === true;
  const given = state?.params;
  const params = useMemo(() => resolveParams(pack, policy, given), [pack, policy, given]);
  const points = params[param.id] as CurvePoint[];
  const view = scheduleView(pack, effect, params);
  const distribution = view.distribution;
  const scale = useMemo(() => chooseScale(distribution, param.x.min, param.x.max), [distribution, param]);
  const today = useMemo(() => todayForDrawing(setting), [setting]);
  const todayValue = useMemo(() => todayPoints(param, effect), [param, effect]);
  const alone = useMemo(() => simulatePolicy(pack, policy.id, params, level), [pack, policy.id, params, level]);
  const whole = useMemo(
    () => (level === "all" ? alone : simulatePolicy(pack, policy.id, params, "all")),
    [pack, policy.id, params, level, alone],
  );
  // view.reform wraps `points`; view.baseline is the same object for as long as the pack is.
  const reform = view.reform;
  const todayCurve = view.baseline;
  const tolerance = useMemo(() => sameWithin(distribution), [distribution]);
  const pay = useMemo(
    () => payMoreOrLess(distribution, { points, scale: reform.scale }, todayCurve, tolerance),
    [distribution, points, reform.scale, todayCurve, tolerance],
  );

  const [undo, setUndo] = useState<UndoState>(NO_UNDO);
  const [selected, setSelected] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ index: number; nonce: number }>();
  const [status, setStatus] = useState("");
  const latest = useRef<readonly CurvePoint[]>(points);
  latest.current = points;

  const rate = (value: number, digits?: number): string => fmt.percent(value / 100, { digits: digits ?? decimalsIn(value) });

  // --- changing the curve ---------------------------------------------------------------------
  const begin = (): void => {
    // Read now: React may run the updater only after the change that follows has replaced it.
    const before = latest.current;
    setUndo((current) => beginChange(current, before));
  };
  const change = (next: readonly CurvePoint[]): void => {
    if (samePoints(next, latest.current)) return;
    latest.current = next;
    setUndo(recordChange);
    setParam(policy.id, param.id, next as CurvePoint[]);
  };
  const apply = (next: readonly CurvePoint[]): void => {
    begin();
    change(next);
  };
  const focusHandle = (index: number): void => setFocus((current) => ({ index, nonce: (current?.nonce ?? 0) + 1 }));

  /** Adds a point on the curve; returns its index. From the chart the new handle takes the focus. */
  const add = (x: number, fromChart = true): number | null => {
    const added = addPoint(latest.current, x, param);
    if (!added) {
      if (!canAdd(latest.current, param)) setStatus(t.curve.tooMany(pointLimits(param).max));
      return null;
    }
    apply(added.points);
    setSelected(added.index);
    if (fromChart) focusHandle(added.index);
    setStatus(t.curve.added(t.curve.pointName(added.index + 1, added.points.length)));
    return added.index;
  };

  /** Removes a point; returns the index of the neighbour that is selected now. From the chart that handle takes the focus. */
  const remove = (index: number, fromChart = true): number | null => {
    if (!canRemove(latest.current, param)) {
      setStatus(t.curve.tooFew(pointLimits(param).min));
      return null;
    }
    const name = t.curve.pointName(index + 1, latest.current.length);
    const next = removePoint(latest.current, index, param);
    apply(next);
    const neighbour = Math.min(index, next.length - 1);
    setSelected(neighbour >= 0 ? neighbour : null);
    if (neighbour >= 0 && fromChart) focusHandle(neighbour);
    setStatus(t.curve.removed(name));
    return neighbour >= 0 ? neighbour : null;
  };

  const undoLast = (): void => {
    if (!undo.undo) return;
    const previous = undo.undo;
    latest.current = previous;
    setUndo(NO_UNDO);
    setParam(policy.id, param.id, previous as CurvePoint[]);
    setSelected(null);
  };

  // Ctrl+Z / Cmd+Z anywhere in the editor except in a text field, where it undoes the typing.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const field = event.target instanceof HTMLInputElement && event.target.type !== "range";
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && !field && undo.undo) {
      event.preventDefault();
      undoLast();
    }
  };

  // Tell screen readers the effect once the curve has stopped changing.
  const insight = alone ? insightOf(pack, alone, baseline) : null;
  const effectText = insight ? `${t.curve.effect}: ${fmt.money(insight.balance, { signed: true })} ${t.common.perYear}` : "";
  const [announced, setAnnounced] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => setAnnounced(effectText), 800);
    return () => clearTimeout(timer);
  }, [effectText]);

  if (!alone || !whole || !insight) return null;

  // --- what the curve does --------------------------------------------------------------------
  const noise = noiseLevel(baseline);
  const signed = (value: number): string => fmt.money(value, { signed: true });
  const combined =
    inScenario && Math.abs(inScenario.delta.balance - alone.delta.balance) > Math.max(noise, Math.abs(alone.delta.balance) * 0.005);
  const preset = matchingPreset(points, param);
  const top = topRate(points);
  const topToday = today ? topRate(today) : null;
  const isToday = todayValue ? sameCurve({ points }, { points: todayValue }) : samePoints(points, param.default);
  const effectIndex = policy.effects.indexOf(effect);
  const model = whole.effects.find((entry) => entry.index === effectIndex)?.model;
  const node = findNode(pack, effect.target);
  const others = policy.params.filter((candidate) => candidate.id !== param.id);
  const unit = ui.text(distribution.unit);
  const payRows = [
    { key: "more", label: t.curve.payMore, units: pay.more, share: pay.moreShare },
    { key: "less", label: t.curve.payLess, units: pay.less, share: pay.lessShare },
    { key: "same", label: t.curve.paySame, units: pay.same, share: pay.sameShare },
  ];

  return (
    <div className="editor" onKeyDown={onKeyDown}>
      <div className="editor__grid">
        <div className="editor__main">
          <p className="editor__explain">{t.curve.explain(fmt.currencyName)}</p>
          <CurveChart
            setting={setting}
            points={points}
            today={today}
            distribution={distribution}
            scale={scale}
            selected={selected}
            focus={focus}
            keysId={keysId}
            onSelect={setSelected}
            onBegin={begin}
            onChange={change}
            onAdd={(x) => void add(x)}
            onRemove={(index) => void remove(index)}
          />
          <p id={keysId} className="visually-hidden">
            {t.curve.keys}
          </p>
          <p className="cchart__axis-title">{ui.text(distribution.label)}</p>
          <ul className="cchart__legend">
            <li className="key key--line">{t.curve.legend.reform}</li>
            <li className="key key--average">{t.curve.legend.average}</li>
            {today && <li className="key key--today">{t.curve.legend.today}</li>}
            <li className="key key--area">{t.curve.legend.distribution}</li>
            {(param.examples?.length ?? 0) > 0 && <li className="key key--example">{t.curve.legend.examples}</li>}
          </ul>
          {scale.knee !== null && (
            <p className="cchart__scale-note">{t.curve.scaleNote(fmt.money(scale.knee, { trim: true }), fmt.money(scale.max, { trim: true }))}</p>
          )}

          <div className="editor__toolbar">
            <button type="button" className="tool" disabled={isToday} onClick={() => apply(todayValue ?? param.default)}>
              <ResetIcon size={14} />
              <span>{todayValue ? t.curve.toToday : t.curve.toDefault}</span>
            </button>
            <button type="button" className="tool" disabled={!undo.undo} onClick={undoLast}>
              <UndoIcon />
              <span>{t.curve.undo}</span>
            </button>
            <button
              type="button"
              className="tool"
              disabled={selected === null || !canRemove(points, param)}
              onClick={() => selected !== null && remove(selected)}
            >
              <MinusIcon size={14} />
              <span>{t.curve.remove}</span>
            </button>
          </div>
          <p className="visually-hidden" role="status">
            {status}
          </p>
        </div>

        <aside className="editor__side">
          {!enabled && <p className="editor__off">{t.curve.offHint}</p>}
          <section className="editor__block">
            <h3 className="editor__label">{level === "all" ? t.policies.alone : t.policies.aloneLevel(ui.levelName(level))}</h3>
            <p className="policy__figure">
              <Delta className="policy__amount" amount={insight.balance} direction={insight.direction} text={signed(insight.balance)} />
              <span className="policy__per">{t.common.perYear}</span>
              <span className={`policy__direction policy__direction--${insight.direction}`}>
                {directionWord(ui, insight.direction, level)}
              </span>
            </p>
            {insight.hasRange && (
              <p className="editor__range">
                {t.policies.rangeFact} {t.common.range(signed(insight.low), signed(insight.high))}
              </p>
            )}
            {combined && inScenario && <p className="policy__combined">{t.policies.combined(signed(inScenario.delta.balance))}</p>}
            <p className="visually-hidden" role="status">
              {announced}
            </p>
          </section>

          <section className="editor__block">
            <h3 className="editor__label">{t.curve.pay}</h3>
            <dl className="pay">
              {payRows.map((row) => (
                <div key={row.key} className={`pay__row pay__row--${row.key}`}>
                  <dt>{row.label}</dt>
                  <dd>
                    <span className="pay__bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(1, Math.max(0, row.share)) * 100}%` }} />
                    </span>
                    <span className="pay__value">
                      {fmt.count(row.units)} <span className="muted">({fmt.share(row.share)})</span>
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="editor__note">{t.curve.counted(unit, fmt.smallMoney(tolerance))}</p>
          </section>

          {top && (
            <section className="editor__block">
              <h3 className="editor__label">{t.curve.top}</h3>
              <p className="editor__top">
                <strong>{rate(top.rate)}</strong> {t.curve.from(fmt.exactMoney(top.from))}
                {topToday && <span className="muted"> · {t.curve.topToday(rate(topToday.rate), fmt.exactMoney(topToday.from))}</span>}
              </p>
              <p className="editor__note">{t.curve.topNote}</p>
            </section>
          )}
        </aside>

        {(param.presets?.length ?? 0) > 0 && (
          <section className="editor__block editor__presets">
            <h3 className="editor__label">{t.curve.presets}</h3>
            <ul className="presets">
              {param.presets!.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="preset"
                    aria-pressed={preset?.id === candidate.id}
                    onClick={() => apply(candidate.points)}
                  >
                    <span className="preset__label">{ui.text(candidate.label)}</span>
                    {candidate.note && <span className="preset__note">{ui.text(candidate.note)}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {preset?.sources && preset.sources.length > 0 && (
              <div className="presets__sources">
                <p className="editor__note">{t.curve.presetSources}</p>
                <SourceList ids={preset.sources} />
              </div>
            )}
          </section>
        )}
      </div>

      <div className="editor__more">
        {(param.examples?.length ?? 0) > 0 && (
          <section className="editor__section">
            <h3>{t.curve.examples}</h3>
            <table className="examples">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">#</span>
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">{ui.text(distribution.label)}</span>
                  </th>
                  <th scope="col">{t.curve.exampleToday}</th>
                  <th scope="col">{t.curve.exampleAfter}</th>
                  <th scope="col">{t.curve.exampleChange}</th>
                </tr>
              </thead>
              <tbody>
                {param.examples!.map((example, index) => {
                  const before = view.baseline ? curveOwed(view.baseline, example.x) : 0;
                  const after = curveOwed(view.reform, example.x);
                  const average = (owed: number): string => fmt.percent(example.x > 0 ? owed / example.x : 0, { digits: 1 });
                  const difference = after - before;
                  return (
                    <tr key={index}>
                      <td className="examples__marker">
                        <span>{index + 1}</span>
                      </td>
                      <th scope="row">
                        <span className="examples__amount">{fmt.exactMoney(example.x)}</span>
                        <span className="examples__label">{ui.text(example.label)}</span>
                      </th>
                      <td data-label={t.curve.exampleToday}>{t.curve.owes(fmt.exactMoney(before), average(before))}</td>
                      <td data-label={t.curve.exampleAfter}>{t.curve.owes(fmt.exactMoney(after), average(after))}</td>
                      <td data-label={t.curve.exampleChange} className="examples__change">
                        {Math.abs(difference) < 0.5 ? (
                          <span className="muted">{t.common.unchanged}</span>
                        ) : (
                          fmt.exactMoney(difference, { signed: true })
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="editor__note">{t.curve.examplesNote}</p>
          </section>
        )}

        <PointsTable
          setting={setting}
          points={points}
          selected={selected}
          onSelect={setSelected}
          onApply={apply}
          onAdd={(x) => add(x, false)}
          onRemove={(index) => remove(index, false)}
          onStatus={setStatus}
        />

        {others.length > 0 && (
          <section className="editor__section">
            <h3>{t.curve.otherSettings}</h3>
            {others.map((other) =>
              other.type === "number" ? (
                <NumberControl
                  key={other.id}
                  id={`editor-${policy.id}-${other.id}`}
                  param={other}
                  value={params[other.id] as number}
                  onChange={(value) => setParam(policy.id, other.id, value)}
                />
              ) : other.type === "groups" ? (
                <GroupsControl
                  key={other.id}
                  param={other}
                  value={params[other.id] as string[]}
                  onChange={(value) => setParam(policy.id, other.id, value)}
                />
              ) : null,
            )}
          </section>
        )}

        {model && node && (
          <section className="editor__section">
            <h3>{t.curve.model}</h3>
            <p className="editor__model">
              {model.baseline !== undefined
                ? t.curve.modelCalibrated(
                    ui.text(distribution.label),
                    fmt.money(model.reform),
                    fmt.money(model.baseline),
                    fmt.percent(model.baseline > 0 ? model.reform / model.baseline - 1 : 0, { signed: true, digits: 1 }),
                    ui.text(node.label),
                    fmt.money(baseAmount(pack, effect.target)),
                  )
                : t.curve.modelAbsolute(ui.text(distribution.label), fmt.money(model.reform), ui.text(node.label))}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function UndoIcon() {
  return (
    <svg className="icon" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5.5 3.5 2.5 6.5l3 3" />
      <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
    </svg>
  );
}

/**
 * The points as a table: number fields for each coordinate, a button to remove a point, and a
 * field to add one at a given amount. Fields take what is typed in the language of the page and
 * apply it on Enter or when the focus leaves; the arrow keys step along the grid.
 */
function PointsTable({
  setting,
  points,
  selected,
  onSelect,
  onApply,
  onAdd,
  onRemove,
  onStatus,
}: {
  setting: CurveSetting;
  points: readonly CurvePoint[];
  selected: number | null;
  onSelect(index: number | null): void;
  onApply(next: readonly CurvePoint[]): void;
  /** Returns the index of the new point, or null. */
  onAdd(x: number): number | null;
  /** Returns the index of the point selected afterwards, or null. */
  onRemove(index: number): number | null;
  onStatus(message: string): void;
}) {
  const ui = useUi();
  const { t, fmt } = ui;
  const { param } = setting;
  const removable = canRemove(points, param);
  const [addAt, setAddAt] = useState<string>("");
  const titleId = useId();
  const fieldId = useId();
  const body = useRef<HTMLTableSectionElement>(null);
  /** After adding or removing from here, the focus stays in the table: on this row's first field, or its remove button. */
  const [focusRow, setFocusRow] = useState<{ index: number; on: "field" | "remove"; nonce: number }>();
  useEffect(() => {
    if (!focusRow) return;
    const row = body.current?.rows[focusRow.index];
    const target = focusRow.on === "field" ? row?.querySelector("input") : row?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    (target ?? body.current?.closest("section")?.querySelector<HTMLInputElement>(".points__add input"))?.focus();
  }, [focusRow]);

  const set = (index: number, along: "x" | "y", value: number): void => {
    const next = movePoint(points, index, { [along]: value }, param);
    const landed = next[index]?.[along];
    if (landed !== undefined && landed !== value) {
      onStatus(t.curve.clampedTo(along === "x" ? fmt.exactMoney(landed) : fmt.percent(landed / 100, { digits: decimalsIn(landed) })));
    }
    onApply(next);
  };

  const suggestion = suggestedX(points, param, selected ?? undefined);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const typed = addAt.trim() === "" ? suggestion : fmt.parse(addAt);
    if (!Number.isFinite(typed)) return;
    const index = onAdd(typed);
    setAddAt("");
    if (index !== null) setFocusRow((current) => ({ index, on: "field", nonce: (current?.nonce ?? 0) + 1 }));
  };

  return (
    <section className="editor__section">
      <h3 id={titleId}>{t.curve.points}</h3>
      <table className="points" aria-labelledby={titleId}>
        <thead>
          <tr>
            <th scope="col">{t.curve.pointColumn}</th>
            <th scope="col">{t.curve.amountColumn(fmt.currencySymbol)}</th>
            <th scope="col">{t.curve.rateColumn}</th>
            <th scope="col">
              <span className="visually-hidden">{t.curve.remove}</span>
            </th>
          </tr>
        </thead>
        <tbody ref={body}>
          {points.map((point, index) => (
            <tr key={index} className={selected === index ? "is-selected" : undefined}>
              <th scope="row">{index + 1}</th>
              <td>
                <NumberField
                  value={point.x}
                  digits={0}
                  label={t.curve.amountField(index + 1, fmt.currencySymbol)}
                  onFocus={() => onSelect(index)}
                  onCommit={(value) => set(index, "x", value)}
                  onStep={(direction, large) => set(index, "x", stepFrom(point.x, param.x, direction, large ? 10 : 1))}
                />
              </td>
              <td>
                <NumberField
                  value={point.y}
                  digits={decimalsIn(point.y)}
                  label={t.curve.rateField(index + 1)}
                  onFocus={() => onSelect(index)}
                  onCommit={(value) => set(index, "y", value)}
                  onStep={(direction, large) => set(index, "y", stepFrom(point.y, param.y, direction, large ? 10 : 1))}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="points__remove"
                  disabled={!removable}
                  aria-label={t.curve.removeNamed(index + 1)}
                  onClick={() => {
                    const next = onRemove(index);
                    if (next !== null) setFocusRow((current) => ({ index: next, on: "remove", nonce: (current?.nonce ?? 0) + 1 }));
                  }}
                >
                  <MinusIcon size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="points__add" onSubmit={submit}>
        <label htmlFor={fieldId}>{t.curve.addAt}</label>
        <span className="points__field">
          <input
            id={fieldId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={addAt}
            placeholder={fmt.number(suggestion)}
            onChange={(event) => setAddAt(event.target.value)}
          />
          <span aria-hidden="true">{fmt.currencySymbol}</span>
        </span>
        <button type="submit" className="tool" disabled={!canAdd(points, param)}>
          <PlusIcon size={14} />
          <span>{t.curve.add}</span>
        </button>
      </form>
      <p className="editor__note">{t.curve.addNote}</p>
    </section>
  );
}

function NumberField({
  value,
  digits,
  label,
  onFocus,
  onCommit,
  onStep,
}: {
  value: number;
  digits: number;
  label: string;
  onFocus(): void;
  onCommit(value: number): void;
  onStep(direction: 1 | -1, large: boolean): void;
}) {
  const { fmt } = useUi();
  const shown = fmt.number(value, { digits });
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const parsed = fmt.parse(draft);
    setDraft(null);
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
  };
  return (
    <input
      className="points__input"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      value={draft ?? shown}
      onFocus={onFocus}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape" && draft !== null) {
          event.preventDefault();
          setDraft(null);
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          setDraft(null);
          onStep(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
        }
      }}
    />
  );
}
