/**
 * The budget: revenue and spending as two stacked bars on one scale, so the gap between them is
 * the balance, and below them a list that breaks the selected category down into its items.
 *
 * Every mark shows the simulated value; today's value stays visible as a vertical line wherever
 * a measure has changed something.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  crumbsOf,
  layoutBudget,
  rowsOf,
  segmentKeyOf,
  segmentsOf,
  selectionOfSegment,
  type BudgetLayout,
  type Row,
  type Segment,
  type Selection,
} from "../app/budgetModel.ts";
import { directionOfNode, noiseLevel } from "../app/policyModel.ts";
import { useUi, type Ui } from "../app/ui.ts";
import { findNode, type LeafNode, type LevelId, type Side, type SimulationResult } from "../engine/index.ts";
import { reducedMotion } from "../hooks/useAnimatedNumber.ts";
import { clearTextWidths, textWidth, useElementWidth } from "../hooks/useElementWidth.ts";
import { ArrowLeft, ChevronRight, MinusIcon, PlusIcon } from "./icons.tsx";
import { Delta, QualityBadge, SourceList } from "./primitives.tsx";

/** Must match `.seg__name` and `.seg__value` in the stylesheet: labels are measured before they are drawn. */
const SEGMENT_FONT_FAMILY = '"Public Sans Variable", system-ui, -apple-system, "Segoe UI", sans-serif';
const SEGMENT_NAME_FONT = `600 12.5px ${SEGMENT_FONT_FAMILY}`;
const SEGMENT_VALUE_FONT = `400 12.5px ${SEGMENT_FONT_FAMILY}`;
const SEGMENT_PADDING = 16;
/** Kept free besides the padding, so a label never touches the edge of its block. */
const SEGMENT_SLACK = 4;
/** The gap between blocks, as in `.bar__track`. */
const SEGMENT_GAP = 2;
/** The space between a bar and the explanation floating above it. */
const TIP_GAP = 9;
const SIDES: readonly Side[] = ["revenue", "expenditure"];

const percentOf = (value: number, max: number): string => `${Math.max(0, Math.min(100, (value / max) * 100))}%`;

function segmentLabel(ui: Ui, segment: Segment): string {
  if (segment.isFold) return ui.t.budget.other(segment.nodeIds.length);
  return ui.text(findNode(ui.pack, segment.nodeIds[0])?.label);
}

/**
 * Counts up whenever a web font has finished loading. Label widths are measured on a canvas, and
 * until the font is there the canvas measures with the fallback font, so they must be redone.
 */
function useFontsLoaded(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts || typeof fonts.load !== "function") return;
    let alive = true;
    const remeasure = (): void => {
      if (!alive) return;
      clearTextWidths();
      setVersion((v) => v + 1);
    };
    // Ask for exactly the fonts the labels use; the page may not have needed them yet.
    void Promise.all([fonts.load(SEGMENT_NAME_FONT), fonts.load(SEGMENT_VALUE_FONT)]).then(remeasure, () => undefined);
    fonts.addEventListener?.("loadingdone", remeasure);
    return () => {
      alive = false;
      fonts.removeEventListener?.("loadingdone", remeasure);
    };
  }, []);
  return version;
}

export interface BudgetViewProps {
  result: SimulationResult;
  selection: Selection;
  onSelect(selection: Selection): void;
  /** A row to point out, e.g. after "show in the budget" on a policy card. */
  highlight?: string;
}

export function BudgetView({ result, selection, onSelect, highlight }: BudgetViewProps) {
  const ui = useUi();
  const { pack, t } = ui;
  const layout = useMemo(() => layoutBudget(pack), [pack]);
  const noise = noiseLevel(result.baseline);
  const max =
    Math.max(result.reform.revenue, result.reform.expenditure, result.baseline.revenue, result.baseline.expenditure) ||
    1;
  const balance = result.reform.balance;
  // A single level has no meaningful balance (payments between levels are not in the data), so
  // the space between its two bars is not labelled as a deficit or surplus.
  const singleLevel = result.level !== "all";
  const gapKind = singleLevel ? null : balance < -noise ? "deficit" : balance > noise ? "surplus" : null;
  const selectedKey = segmentKeyOf(layout, selection);

  return (
    <section className="budget" id="budget" aria-labelledby="budget-title" tabIndex={-1}>
      <header className="section-head">
        <h2 id="budget-title">{t.budget.title(pack.country.baseYear)}</h2>
        <p>
          {result.level === "all" ? t.budget.intro : t.budget.introLevel(ui.levelName(result.level))} {t.budget.hint}
        </p>
      </header>

      {/* The bars and the list below them: on a wide screen this part stays next to the measures. */}
      <div className="budget__pin">
        <div className="bars">
          {SIDES.map((side) => {
            const shorter = gapKind === "deficit" ? "revenue" : "expenditure";
            const other = side === "revenue" ? "expenditure" : "revenue";
            return (
              <StackedBar
                key={side}
                side={side}
                layout={layout}
                result={result}
                max={max}
                noise={noise}
                selectedKey={selection.side === side ? selectedKey : undefined}
                wholeSideSelected={selection.side === side && !selection.nodeId && !selection.fold}
                gap={
                  gapKind && side === shorter
                    ? { kind: gapKind, to: result.reform[other], amount: Math.abs(balance) }
                    : undefined
                }
                onSelect={onSelect}
              />
            );
          })}
        </div>

        <DetailList
          layout={layout}
          result={result}
          selection={selection}
          onSelect={onSelect}
          highlight={highlight}
          noise={noise}
        />
      </div>
    </section>
  );
}

interface StackedBarProps {
  side: Side;
  layout: BudgetLayout;
  result: SimulationResult;
  /** Amount at the right edge of the common scale. */
  max: number;
  noise: number;
  selectedKey: string | undefined;
  wholeSideSelected: boolean;
  /** The space between the end of this bar and the end of the other one. */
  gap?: { kind: "deficit" | "surplus"; to: number; amount: number };
  onSelect(selection: Selection): void;
}

function StackedBar({
  side,
  layout,
  result,
  max,
  noise,
  selectedKey,
  wholeSideSelected,
  gap,
  onSelect,
}: StackedBarProps) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const plot = useRef<HTMLDivElement>(null);
  const plotWidth = useElementWidth(plot);
  const fonts = useFontsLoaded();
  /**
   * The block whose explanation is shown. `held` means a tap opened it: a finger cannot hover, so
   * the explanation then stays until the next press somewhere else instead of until a pointer leaves.
   */
  const [shown, setShown] = useState<{ key: string; held: boolean } | null>(null);
  const active = shown?.key ?? null;
  const bar = useRef<HTMLDivElement>(null);
  /** The kind of pointer that last went down on a block or a legend entry of this bar. */
  const pointer = useRef("mouse");

  // While an explanation is open: a press anywhere but on a block or legend entry of this bar
  // closes it, and so does Escape.
  useEffect(() => {
    if (active === null) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !bar.current?.contains(target) || !target.closest(".seg, .legend__item")) setShown(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setShown(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);

  /** A mouse or pen shows the explanation of a block by hovering. A finger cannot hover; see `choose`. */
  const hover = (key: string) => ({
    onPointerDown: (event: ReactPointerEvent): void => {
      pointer.current = event.pointerType;
    },
    onPointerEnter: (event: ReactPointerEvent): void => {
      if (event.pointerType !== "touch") setShown({ key, held: false });
    },
    onPointerLeave: (event: ReactPointerEvent): void => {
      if (event.pointerType !== "touch") setShown((current) => (current?.key === key && !current.held ? null : current));
    },
  });
  /** Keyboard focus on a legend entry shows the explanation of its block for as long as the focus is there. */
  const focus = (key: string) => ({
    onFocus: (): void => setShown((current) => (current?.key === key ? current : { key, held: false })),
    onBlur: (): void => setShown((current) => (current?.key === key ? null : current)),
  });
  /** Open a block in the list below. A tap also shows its explanation, which a mouse gets by hovering. */
  const choose = (segment: Segment): void => {
    onSelect(selectionOfSegment(pack, segment));
    if (pointer.current !== "mouse") setShown({ key: segment.key, held: true });
  };

  const total = result.reform[side];
  const baseline = result.baseline[side];
  const delta = total - baseline;
  const changed = Math.abs(delta) > noise;
  const segments = segmentsOf(layout, result, side).filter(
    (segment) => segment.reform > noise || segment.baseline > noise,
  );

  // What fits inside each block: name and amount, the amount alone, or nothing. A label that
  // would be crossed by the line for today's total is left out as well.
  const labels = useMemo(() => {
    const out = new Map<string, { name?: string; value?: string }>();
    const inner = (plotWidth * total) / max - SEGMENT_GAP * (segments.length - 1);
    const todayAt = changed ? (plotWidth * baseline) / max : -1;
    let left = 0;
    for (const segment of segments) {
      const width = total > 0 ? (inner * segment.reform) / total : 0;
      const name = segmentLabel(ui, segment);
      const value = fmt.money(segment.reform);
      const valueWidth = textWidth(value, SEGMENT_VALUE_FONT) + SEGMENT_PADDING + SEGMENT_SLACK;
      const nameWidth = textWidth(name, SEGMENT_NAME_FONT) + SEGMENT_PADDING + SEGMENT_SLACK;
      const crossed = (labelWidth: number): boolean => todayAt > left && todayAt < left + labelWidth;
      if (Math.max(nameWidth, valueWidth) <= width && !crossed(Math.max(nameWidth, valueWidth)))
        out.set(segment.key, { name, value });
      else if (valueWidth <= width && !crossed(valueWidth)) out.set(segment.key, { value });
      left += width + SEGMENT_GAP;
    }
    return out;
    // `fonts` is a dependency on purpose: the widths change when the web font arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments.map((s) => `${s.key}:${s.reform}`).join("|"), plotWidth, max, total, baseline, changed, ui, fonts]);

  let offset = 0;
  const positions = new Map<string, number>();
  for (const segment of segments) {
    positions.set(segment.key, (offset + segment.reform / 2) / max);
    offset += segment.reform;
  }
  const activeSegment = segments.find((segment) => segment.key === active);
  const activeAt = activeSegment ? (positions.get(activeSegment.key) ?? 0) : 0;

  return (
    <div className={`bar bar--${side}`} ref={bar}>
      <div className="bar__head">
        <h3 className="bar__title">
          <button
            type="button"
            className="bar__side"
            aria-pressed={wholeSideSelected}
            onClick={() => onSelect({ side, nodeId: null, fold: false })}
          >
            {t.common[side]}
          </button>
          <span className="bar__total">{fmt.money(total)}</span>
          {changed && (
            <Delta
              className="bar__delta"
              amount={delta}
              direction={directionOfNode(side, delta, noise)}
              text={fmt.money(delta, { signed: true })}
            />
          )}
        </h3>
        {gap && (
          <p className={`bar__gap-label bar__gap-label--${gap.kind}`}>
            {t.budget.gap(gap.kind, fmt.money(gap.amount))}
          </p>
        )}
      </div>

      <div className="bar__plot" ref={plot}>
        <div className="bar__track" style={{ width: percentOf(total, max) }} aria-hidden="true">
          {segments.map((segment) => {
            const label = labels.get(segment.key);
            return (
              <div
                key={segment.key}
                className={`seg cat-${segment.color}${segment.key === selectedKey ? " is-selected" : ""}${segment.key === active ? " is-active" : ""}`}
                style={{ flexGrow: Math.max(segment.reform, 0) }}
                onClick={() => choose(segment)}
                {...hover(segment.key)}
              >
                {label?.name && <span className="seg__name">{label.name}</span>}
                {label?.value && <span className="seg__value">{label.value}</span>}
              </div>
            );
          })}
        </div>
        {gap && (
          <div
            className={`bar__gap bar__gap--${gap.kind}`}
            style={{ left: percentOf(total, max), width: percentOf(gap.to - total, max) }}
            aria-hidden="true"
          />
        )}
        {changed && (
          <div className="bar__today" style={{ left: percentOf(baseline, max) }} aria-hidden="true">
            <span className={baseline / max > 0.5 ? "is-left" : undefined}>
              {t.budget.baseMark(fmt.money(baseline), pack.country.baseYear)}
            </span>
          </div>
        )}
        {activeSegment && (
          <Tip plot={plot} at={activeAt}>
            <span className="tip__value">{fmt.money(activeSegment.reform)}</span>
            <span className="tip__label">
              <span className={`swatch cat-${activeSegment.color}`} aria-hidden="true" />
              {segmentLabel(ui, activeSegment)}
            </span>
            <span className="tip__meta">
              {t.budget.shareOf(side, fmt.share(total > 0 ? activeSegment.reform / total : 0))}
            </span>
            {Math.abs(activeSegment.delta) > noise && (
              <span className="tip__meta">
                <Delta
                  amount={activeSegment.delta}
                  direction={directionOfNode(side, activeSegment.delta, noise)}
                  text={fmt.money(activeSegment.delta, { signed: true })}
                />{" "}
                {t.scoreboard.vsBase(pack.country.baseYear)}
              </span>
            )}
          </Tip>
        )}
      </div>

      <ul className="legend">
        {segments.map((segment) => {
          const name = segmentLabel(ui, segment);
          const segmentChanged = Math.abs(segment.delta) > noise;
          return (
            <li key={segment.key}>
              <button
                type="button"
                className={`legend__item${segment.key === active ? " is-active" : ""}`}
                aria-pressed={segment.key === selectedKey}
                onClick={() => choose(segment)}
                {...hover(segment.key)}
                {...focus(segment.key)}
              >
                <span className={`swatch cat-${segment.color}`} aria-hidden="true" />
                <span className="legend__name">{name}</span>
                <span className="visually-hidden">
                  {" "}
                  {fmt.money(segment.reform)},{" "}
                  {t.budget.shareOf(side, fmt.share(total > 0 ? segment.reform / total : 0))}
                </span>
                {segmentChanged && (
                  <Delta
                    className="legend__delta"
                    amount={segment.delta}
                    direction={directionOfNode(side, segment.delta, noise)}
                    text={fmt.money(segment.delta, { signed: true })}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The explanation of one block, floating above its bar: amount, name, share and change. It is drawn
 * in a layer of its own above the page, so neither the scoreboard nor a scrolling list can cut it
 * off, and it follows its bar when the page moves. While that spot of the bar is out of sight
 * (scrolled away, or under the scoreboard), there is nothing to point at and the tip is hidden.
 *
 * Nor does it cover the scoreboard: where the scoreboard leaves no room above the bar (the bar
 * just below it while the page scrolls, or held right under it beside the measures), the tip
 * stands below the bar instead.
 *
 * It is for the eye only: screen readers get the same figures from the legend entry of the block.
 */
function Tip({ plot, at, children }: { plot: RefObject<HTMLDivElement | null>; at: number; children: ReactNode }) {
  const [place, setPlace] = useState<{ below: boolean; style: CSSProperties } | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const update = useRef<() => void>(() => undefined);
  const end = at > 0.5;

  useLayoutEffect(() => {
    const element = plot.current;
    if (!element) return;
    const same = (a: typeof place, b: typeof place): boolean =>
      a === b ||
      (a !== null &&
        b !== null &&
        a.below === b.below &&
        a.style.top === b.style.top &&
        a.style.left === b.style.left &&
        a.style.right === b.style.right &&
        a.style.maxWidth === b.style.maxWidth);
    const set = (next: typeof place): void => setPlace((current) => (same(current, next) ? current : next));
    update.current = (): void => {
      const box = element.getBoundingClientRect();
      const x = box.left + at * box.width;
      const onTop =
        typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, box.top + 1) : element;
      if (!onTop || !element.contains(onTop)) {
        set(null);
        return;
      }
      // Until the tip is drawn its height is not known; a usual one is assumed, and checked once it is there.
      const height = tip.current?.offsetHeight || 80;
      const scoreboard = document.querySelector(".scoreboard__band")?.getBoundingClientRect();
      const below = scoreboard !== undefined && box.top - TIP_GAP - height < scoreboard.bottom + 2;
      set({
        below,
        style: {
          top: below ? box.bottom + TIP_GAP : box.top - TIP_GAP,
          maxWidth: Math.max(box.width / 2, 170),
          ...(end ? { right: document.documentElement.clientWidth - x } : { left: x }),
        },
      });
    };
    const onChange = (): void => update.current();
    onChange();
    window.addEventListener("scroll", onChange, { capture: true, passive: true });
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, { capture: true });
      window.removeEventListener("resize", onChange);
    };
  }, [plot, at, end]);

  // Drawn, the tip has its real height: whether it fits above the bar is checked again.
  useLayoutEffect(() => update.current());

  if (!place) return null;
  return createPortal(
    <div
      ref={tip}
      className={`tip${end ? " tip--end" : ""}${place.below ? " tip--below" : ""}`}
      style={place.style}
      aria-hidden="true"
    >
      {children}
    </div>,
    document.body,
  );
}

interface DetailListProps {
  layout: BudgetLayout;
  result: SimulationResult;
  selection: Selection;
  onSelect(selection: Selection): void;
  highlight?: string;
  noise: number;
}

function DetailList({ layout, result, selection, onSelect, highlight, noise }: DetailListProps) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const { side } = selection;
  const crumbs = crumbsOf(layout, result, selection);
  const current = crumbs[crumbs.length - 1];
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined;
  const { rows, hidden } = rowsOf(pack, layout, result, selection);
  const max = Math.max(...rows.map((row) => Math.max(row.baseline, row.reform)), 0) || 1;
  const anyChanged = rows.some((row) => Math.abs(row.delta) > noise);

  const crumbLabel = (crumb: (typeof crumbs)[number]): string =>
    crumb.kind === "side"
      ? t.common[crumb.side]
      : crumb.kind === "fold"
        ? t.budget.other(crumb.count)
        : ui.text(findNode(pack, crumb.id)?.label);

  // Totals of what the list adds up to.
  const here =
    current.kind === "node"
      ? result.nodes[current.id]
      : current.kind === "fold"
        ? layout.sides[side].folded.reduce(
            (sum, id) => ({
              baseline: sum.baseline + (result.nodes[id]?.baseline ?? 0),
              reform: sum.reform + (result.nodes[id]?.reform ?? 0),
              delta: sum.delta + (result.nodes[id]?.delta ?? 0),
            }),
            { baseline: 0, reform: 0, delta: 0 },
          )
        : {
            baseline: result.baseline[side],
            reform: result.reform[side],
            delta: result.reform[side] - result.baseline[side],
          };
  const sideTotal = result.reform[side];
  const node = current.kind === "node" ? findNode(pack, current.id) : undefined;
  const title = crumbLabel(current);

  return (
    <div className="detail">
      {/* Where the list is and what it adds up to. Beside the measures, where height is scarce,
          the two share a line when there is room. */}
      <div className="detail__top">
        <nav className="crumbs" aria-label={t.budget.path}>
          {parent && (
            <button
              type="button"
              className="crumbs__up"
              onClick={() => onSelect(parent.selection)}
              aria-label={t.budget.up}
              title={t.budget.up}
            >
              <ArrowLeft />
            </button>
          )}
          <ol>
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <li key={crumb.kind === "node" ? crumb.id : crumb.kind} aria-current={last ? "location" : undefined}>
                  {last ? (
                    <h3 className="detail__title">{crumbLabel(crumb)}</h3>
                  ) : (
                    <button type="button" onClick={() => onSelect(crumb.selection)}>
                      {crumbLabel(crumb)}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        <p className="detail__total">
          <strong>{fmt.money(here?.reform ?? 0)}</strong>
          {current.kind !== "side" && sideTotal > 0 && (
            <span className="muted"> · {t.budget.shareOf(side, fmt.share((here?.reform ?? 0) / sideTotal))}</span>
          )}
          {here && Math.abs(here.delta) > noise && (
            <>
              {" · "}
              <Delta
                amount={here.delta}
                direction={directionOfNode(side, here.delta, noise)}
                text={fmt.money(here.delta, { signed: true })}
              />{" "}
              <span className="muted">{t.scoreboard.vsBase(pack.country.baseYear)}</span>
            </>
          )}
        </p>
      </div>
      {node?.description && <p className="detail__description">{ui.text(node.description)}</p>}

      {rows.length === 0 ? (
        <p className="muted">{t.budget.noItems}</p>
      ) : (
        <ul className="rows" aria-label={t.budget.listCaption(title)}>
          {rows.map((row) => (
            <DetailRow
              key={row.id}
              row={row}
              side={side}
              max={max}
              noise={noise}
              highlighted={highlight === row.id}
              level={result.level}
              onDrill={() => onSelect({ side, nodeId: row.id, fold: false })}
            />
          ))}
        </ul>
      )}
      {anyChanged && <p className="detail__key">{t.budget.key(pack.country.baseYear)}</p>}
      {hidden > 0 && <p className="detail__key">{t.budget.hiddenZero(hidden)}</p>}
    </div>
  );
}

interface DetailRowProps {
  row: Row;
  side: Side;
  max: number;
  noise: number;
  highlighted: boolean;
  level: SimulationResult["level"];
  onDrill(): void;
}

function DetailRow({ row, side, max, noise, highlighted, level, onDrill }: DetailRowProps) {
  const ui = useUi();
  const { t, fmt } = ui;
  const [open, setOpen] = useState(false);
  const element = useRef<HTMLLIElement>(null);
  const label = ui.text(row.node.label);
  const changed = Math.abs(row.delta) > noise;
  const lower = Math.min(row.baseline, row.reform);
  const detailsId = `item-${row.id.replace(/[^a-z0-9]+/gi, "-")}`;

  useEffect(() => {
    if (highlighted) element.current?.scrollIntoView?.({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [highlighted]);

  const bar = (
    <span className="row__bar" aria-hidden="true">
      <span className="row__fill" style={{ width: percentOf(row.reform, max) }} />
      {changed && row.reform < row.baseline && (
        <span
          className="row__ghost"
          style={{ left: percentOf(lower, max), width: percentOf(row.baseline - lower, max) }}
        />
      )}
      {changed && <span className="row__tick" style={{ left: percentOf(row.baseline, max) }} />}
    </span>
  );

  const content = (
    <>
      <span className="row__label">{label}</span>
      <span className="row__value">{fmt.money(row.reform)}</span>
      {bar}
      <span className="row__change">
        {changed && (
          <>
            <Delta
              amount={row.delta}
              direction={directionOfNode(side, row.delta, noise)}
              text={fmt.money(row.delta, { signed: true })}
            />
            <span className="row__today"> {t.budget.baseMark(fmt.money(row.baseline), ui.pack.country.baseYear)}</span>
          </>
        )}
      </span>
    </>
  );

  return (
    <li
      ref={element}
      className={`row cat-${row.color}${changed ? " is-changed" : ""}${highlighted ? " is-highlighted" : ""}`}
    >
      {row.isGroup ? (
        <button type="button" className="row__main" onClick={onDrill}>
          {content}
          <span className="visually-hidden">, {t.budget.breakDown}</span>
          <span className="row__icon">
            <ChevronRight />
          </span>
        </button>
      ) : (
        <>
          <button
            type="button"
            className="row__main"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((value) => !value)}
          >
            {content}
            <span className="visually-hidden">, {t.common.details}</span>
            <span className="row__icon">{open ? <MinusIcon /> : <PlusIcon />}</span>
          </button>
          <div id={detailsId} className="row__details" hidden={!open}>
            {open && <LeafDetails leaf={row.node as LeafNode} level={level} />}
          </div>
        </>
      )}
    </li>
  );
}

function LeafDetails({ leaf, level }: { leaf: LeafNode; level: SimulationResult["level"] }) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const levels = (Object.entries(leaf.levels) as [LevelId, number][])
    .filter(([, share]) => share > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <>
      {leaf.description && <p>{ui.text(leaf.description)}</p>}
      {leaf.note && <p className="muted">{ui.text(leaf.note)}</p>}
      <dl className="facts facts--inline">
        <div>
          <dt>{t.budget.quality}</dt>
          <dd>
            <QualityBadge quality={leaf.quality} />
            {leaf.year !== undefined && leaf.year !== pack.country.baseYear && (
              <span className="muted"> · {t.budget.figureFor(leaf.year)}</span>
            )}
          </dd>
        </div>
        {levels.length > 0 && (
          <div>
            <dt>{t.budget.levels}</dt>
            <dd>
              {levels.map(([id, share], index) => (
                <span key={id} className={level === id ? "is-current" : undefined}>
                  {index > 0 && " · "}
                  {ui.levelName(id)} {fmt.share(share)}
                </span>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt>{t.common.sources}</dt>
          <dd>
            <SourceList ids={leaf.sources} />
          </dd>
        </div>
      </dl>
    </>
  );
}
