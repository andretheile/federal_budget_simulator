/**
 * The chart of the curve editor. Back to front: the distribution as a muted histogram (area =
 * number of units, which stays true on a compressed scale), the grid, the pack's examples as
 * numbered guides, today's marginal and average rate as thin grey lines, the edited curve's
 * average rate dashed and its marginal rate as the strong line with a handle on every point.
 *
 * The lines are SVG; the handles are HTML elements on top of it, so that each one is a real
 * focusable control with a name and a value, and so that touch-action reliably keeps the page
 * from scrolling while a finger drags one. All pointer input goes through the layer that holds
 * the handles: a press near a handle grabs the nearest one, a click or tap near the curve adds a
 * point there, a click elsewhere clears the selection.
 *
 * On a touch screen, points that lie too close together for a finger (the two points of a step)
 * each get a tab with their value, set apart from the crowd (curveTabs.ts). A press on a tab grabs
 * exactly that point. With a mouse there are no tabs: the pointer is precise enough.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { curveOutline, dragPoint, nudgePoint, rateAt, snap, type CurveSetting } from "../app/curveModel.ts";
import { fromFraction, linearTicks, toFraction, xTicks, type XScale } from "../app/curveScale.ts";
import { tabPlaces } from "../app/curveTabs.ts";
import { useUi } from "../app/ui.ts";
import { curveAverageRate, unitsAbove, type CurvePoint, type Distribution } from "../engine/index.ts";
import { useElementWidth } from "../hooks/useElementWidth.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { decimalsIn } from "../i18n/format.ts";

export interface CurveChartProps {
  setting: CurveSetting;
  points: readonly CurvePoint[];
  /** Today's curve in the parameter's units, if there is one. */
  today: readonly CurvePoint[] | undefined;
  distribution: Distribution;
  scale: XScale;
  selected: number | null;
  /** Ask for the handle with this index to get the keyboard focus; a new nonce asks again. */
  focus?: { index: number; nonce: number };
  /** Id of the text that explains the keys, for every handle. */
  keysId: string;
  onSelect(index: number | null): void;
  /** A gesture begins that may change the curve (for undo). */
  onBegin(): void;
  onChange(points: readonly CurvePoint[]): void;
  onAdd(x: number): void;
  onRemove(index: number): void;
}

interface Drag {
  index: number;
  pointerId: number;
  start: CurvePoint;
  /** The handle's position in the chart when the drag began. */
  from: { x: number; y: number };
  /**
   * The pointer's position in the window when the drag began. The point follows the pointer's own
   * movement, measured in the window: if the chart itself moves meanwhile (the scoreboard above
   * the sheet grows when the measure switches on), the curve does not change by itself.
   */
  origin: { x: number; y: number };
}

/** Pixels around a handle that grab it, by kind of pointer. */
const GRAB = { mouse: 12, other: 24 };
/** Pixels around the curve where a click or tap adds a point. */
const NEAR = { mouse: 8, other: 16 };
/** How far from the edges of the chart the centre of a tab stays. */
const TAB_MARGIN = { x: 24, y: 14 };

function pathOf(points: readonly { x: number; y: number }[]): string {
  let d = "";
  for (let i = 0; i < points.length; i++) d += `${i === 0 ? "M" : "L"}${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
  return d;
}

/** Distance from a point to a line segment, in pixels. */
function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The histogram as pieces of the x range with the units in each: the distribution's own bins,
 * cut at the edges of the range and at the knee, and the Pareto tail in a few pieces of its own.
 */
function histogramPieces(dist: Distribution, scale: XScale): { from: number; to: number; units: number }[] {
  const { min, max, knee } = scale;
  const edges = new Set<number>([min, max]);
  if (knee !== null) edges.add(knee);
  for (const bin of dist.bins) {
    if (bin.from > min && bin.from < max) edges.add(bin.from);
    if (bin.to > min && bin.to < max) edges.add(bin.to);
  }
  if (dist.tail && dist.tail.from < max) {
    const start = Math.max(min, dist.tail.from);
    for (let k = 1; k < 12; k++) edges.add(start * (max / start) ** (k / 12));
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const out: { from: number; to: number; units: number }[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const units = unitsAbove(dist, sorted[i]) - unitsAbove(dist, sorted[i + 1]);
    out.push({ from: sorted[i], to: sorted[i + 1], units: Math.max(0, units) });
  }
  return out;
}

export function CurveChart({
  setting,
  points,
  today,
  distribution,
  scale,
  selected,
  focus,
  keysId,
  onSelect,
  onBegin,
  onChange,
  onAdd,
  onRemove,
}: CurveChartProps) {
  const ui = useUi();
  const { t, fmt } = ui;
  const { param } = setting;
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const handles = useRef<(HTMLDivElement | null)[]>([]);
  const width = useElementWidth(frame);
  const [hover, setHover] = useState<number | null>(null);
  // Tabs for crowded points: on a touch screen, or once a finger has been used on this chart.
  const coarse = useMediaQuery("(pointer: coarse)");
  const [touched, setTouched] = useState(false);
  /** The crowd whose tab is being dragged: it keeps its tabs until the finger lifts, however far apart it gets. */
  const [held, setHeld] = useState<readonly number[] | null>(null);

  // --- geometry -------------------------------------------------------------------------------
  const narrow = width < 560;
  const height = narrow ? 290 : Math.round(Math.min(430, Math.max(320, width * 0.44)));
  const margin = { top: 30, right: narrow ? 14 : 20, bottom: 26, left: narrow ? 40 : 48 };
  const plotW = Math.max(1, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const ySpan = param.y.max - param.y.min || 1;
  const X = (value: number): number => margin.left + toFraction(scale, value) * plotW;
  const Y = (value: number): number => margin.top + (1 - (Math.min(param.y.max, Math.max(param.y.min, value)) - param.y.min) / ySpan) * plotH;
  const valueAtX = (px: number): number => fromFraction(scale, (px - margin.left) / plotW);
  const valueAtY = (py: number): number => param.y.min + (1 - (py - margin.top) / plotH) * ySpan;
  const breaks = scale.knee === null ? [] : [scale.knee];

  // The latest values for the pointer handlers, which outlive a render while a drag goes on.
  const latest = useRef<readonly CurvePoint[]>(points);
  latest.current = points;
  const geometry = useRef({ X, Y, valueAtX, valueAtY });
  geometry.current = { X, Y, valueAtX, valueAtY };

  const rate = (value: number, digits?: number): string =>
    fmt.percent(value / 100, { digits: digits ?? decimalsIn(value) });

  // --- layers that only change with the size or the pack --------------------------------------
  const histogram = useMemo(() => {
    if (!(width > 0)) return "";
    const pieces = histogramPieces(distribution, scale).map((piece) => {
      const left = margin.left + toFraction(scale, piece.from) * plotW;
      const right = margin.left + toFraction(scale, piece.to) * plotW;
      return { left, right, density: right > left ? piece.units / (right - left) : 0 };
    });
    const peak = Math.max(...pieces.map((piece) => piece.density), 0);
    if (!(peak > 0)) return "";
    const base = margin.top + plotH;
    const top = (density: number): number => base - (density / peak) * plotH * 0.55;
    let d = `M${margin.left.toFixed(1)},${base}`;
    for (const piece of pieces) d += `L${piece.left.toFixed(1)},${top(piece.density).toFixed(1)}L${piece.right.toFixed(1)},${top(piece.density).toFixed(1)}`;
    return `${d}L${(margin.left + plotW).toFixed(1)},${base}Z`;
    // The margins, plotW and plotH all follow from the width.
  }, [distribution, scale, width]);

  /** The average rate along the x axis, sampled every two pixels: what is owed divided by the amount. */
  const average = (curve: readonly CurvePoint[]): string => {
    const out: { x: number; y: number }[] = [];
    for (let px = 0; px <= plotW; px += 2) {
      const value = valueAtX(margin.left + px);
      out.push({ x: margin.left + px, y: Y(curveAverageRate({ points: curve }, value)) });
    }
    return pathOf(out);
  };
  const todayPaths = useMemo(() => {
    if (!today || !(width > 0)) return null;
    return {
      marginal: pathOf(curveOutline(today, param.x.min, param.x.max, breaks).map((p) => ({ x: X(p.x), y: Y(p.y) }))),
      average: average(today),
    };
    // The mapping follows from the width, the scale and the parameter's ranges.
  }, [today, width, scale, param]);

  const outline = curveOutline(points, param.x.min, param.x.max, breaks).map((p) => ({ x: X(p.x), y: Y(p.y) }));
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  const tabs =
    (coarse || touched) && width > 0
      ? tabPlaces(
          points.map((point) => ({ x: X(point.x), y: Y(point.y) })),
          { keep: held ?? [], bounds: { width, height, marginX: TAB_MARGIN.x, marginY: TAB_MARGIN.y } },
        )
      : [];
  /** A tab says the rate of its point; where its crowd shares one rate, the amount. */
  const tabLabel = (index: number, group: readonly number[]): string => {
    const point = points[index];
    const sameRate = group.some((other) => other !== index && points[other]?.y === point.y);
    return sameRate ? fmt.money(point.x, { trim: true }) : rate(point.y);
  };

  const yTicks = linearTicks(param.y.min, param.y.max, plotH, narrow ? 34 : 40);
  const ticks = xTicks(scale, plotW, narrow ? 76 : 86);
  const kneeX = scale.knee !== null ? X(scale.knee) : null;

  // --- pointer --------------------------------------------------------------------------------
  const drag = useRef<Drag | null>(null);
  const pointerKind = useRef<"mouse" | "other">("mouse");
  const swallowClick = useRef(false);

  const local = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = layer.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const nearestHandle = (at: { x: number; y: number }, radius: number): number => {
    const { X: toX, Y: toY } = geometry.current;
    let best = -1;
    let distance = radius;
    latest.current.forEach((point, index) => {
      const d = Math.hypot(toX(point.x) - at.x, toY(point.y) - at.y);
      if (d <= distance) {
        best = index;
        distance = d;
      }
    });
    return best;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    pointerKind.current = event.pointerType === "mouse" ? "mouse" : "other";
    swallowClick.current = false;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.pointerType !== "mouse" && !touched) setTouched(true);
    const at = local(event);
    // A tab names its point: no guessing which of the crowd was meant.
    const tab = (event.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    let index = tab ? Number(tab.dataset.tab) : nearestHandle(at, GRAB[pointerKind.current]);
    const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-handle]");
    if (index < 0 && handle) index = Number(handle.dataset.handle);
    if (index < 0 || !latest.current[index]) return;
    if (tab) setHeld(tabs.find((candidate) => candidate.index === index)?.group ?? null);
    // The press belongs to the handle: no text selection, no click, no scrolling.
    event.preventDefault();
    swallowClick.current = true;
    const point = latest.current[index];
    drag.current = {
      index,
      pointerId: event.pointerId,
      start: point,
      from: { x: geometry.current.X(point.x), y: geometry.current.Y(point.y) },
      origin: { x: event.clientX, y: event.clientY },
    };
    try {
      layer.current?.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone; the drag simply ends with it.
    }
    handles.current[index]?.focus({ preventScroll: true });
    onSelect(index);
    onBegin();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current && event.pointerId === current.pointerId) {
      const moved = { x: event.clientX - current.origin.x, y: event.clientY - current.origin.y };
      const target = {
        x: geometry.current.valueAtX(current.from.x + moved.x),
        y: geometry.current.valueAtY(current.from.y + moved.y),
      };
      const next = dragPoint(latest.current, current.index, current.start, target, moved, param);
      if (next !== latest.current) {
        latest.current = next;
        onChange(next);
      }
      return;
    }
    if (event.pointerType === "mouse") {
      const at = local(event);
      const inside = at.x >= margin.left && at.x <= margin.left + plotW && at.y >= margin.top - 6 && at.y <= margin.top + plotH + 6;
      setHover(inside ? valueAtX(at.x) : null);
    }
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current && event.pointerId === drag.current.pointerId) {
      drag.current = null;
      setHeld(null);
      try {
        layer.current?.releasePointerCapture(event.pointerId);
      } catch {
        // Released already.
      }
    }
  };

  const onClick = (event: { clientX: number; clientY: number }): void => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    const at = local(event);
    const line = outlineRef.current;
    let distance = Infinity;
    for (let i = 0; i + 1 < line.length; i++) distance = Math.min(distance, distanceToSegment(at, line[i], line[i + 1]));
    const inside = at.x >= margin.left - 2 && at.x <= margin.left + plotW + 2;
    if (inside && distance <= NEAR[pointerKind.current]) onAdd(valueAtX(at.x));
    else onSelect(null);
  };

  // --- keyboard -------------------------------------------------------------------------------
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
    const large = event.shiftKey;
    const moves: Record<string, ["x" | "y", 1 | -1, boolean]> = {
      ArrowUp: ["y", 1, large],
      ArrowDown: ["y", -1, large],
      ArrowRight: ["x", 1, large],
      ArrowLeft: ["x", -1, large],
      PageUp: ["y", 1, true],
      PageDown: ["y", -1, true],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      onBegin();
      const next = nudgePoint(latest.current, index, move[0], move[1], move[2], param);
      if (next !== latest.current) {
        latest.current = next;
        onChange(next);
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove(index);
    }
  };

  useEffect(() => {
    if (focus) handles.current[focus.index]?.focus({ preventScroll: false });
  }, [focus]);

  // --- what the pointer is over, or the point in hand ------------------------------------------
  // A finger covers the handle it drags, so the values of the selected point are written above.
  let readout = t.curve.hint;
  const averages = (at: number): [string, string | null] => [
    rate(curveAverageRate({ points }, at), 1),
    today ? rate(curveAverageRate({ points: today }, at), 1) : null,
  ];
  if (hover !== null) {
    const at = snap(hover, param.x);
    readout = t.curve.hover(fmt.exactMoney(at), rate(rateAt(points, at), 1), today ? rate(rateAt(today, at), 1) : null, ...averages(at), ui.period);
  } else if (selected !== null && points[selected]) {
    const point = points[selected];
    readout = t.curve.point(t.curve.pointName(selected + 1, points.length), fmt.exactMoney(point.x), rate(point.y), ...averages(point.x), ui.period);
  }

  const examples = param.examples ?? [];
  const count = points.length;

  return (
    <figure className="cchart">
      <p className={`cchart__readout${hover !== null || selected !== null ? " is-reading" : ""}`} aria-hidden="true">
        {readout}
      </p>
      <div className="cchart__frame" ref={frame} style={{ height }}>
        {width > 0 && (
          <svg className="cchart__svg" width={width} height={height} aria-hidden="true" focusable="false">
            {kneeX !== null && (
              <g className="cchart__band">
                <rect x={kneeX} y={margin.top} width={margin.left + plotW - kneeX} height={plotH} />
                <text x={margin.left + plotW - 6} y={margin.top + plotH - 8} textAnchor="end">
                  {t.curve.compressed}
                </text>
              </g>
            )}
            <path className="cchart__histogram" d={histogram} />
            <g className="cchart__grid">
              {yTicks.map((value) => (
                <g key={value}>
                  <line x1={margin.left} x2={margin.left + plotW} y1={Y(value)} y2={Y(value)} className={value === param.y.min ? "is-base" : undefined} />
                  <text x={margin.left - 7} y={Y(value) + 4} textAnchor="end">
                    {rate(value)}
                  </text>
                </g>
              ))}
              <text className="cchart__ytitle" x={0} y={12}>
                {t.curve.axisRate}
              </text>
            </g>
            <g className="cchart__xaxis">
              {ticks.map((value) => {
                const at = X(value);
                const anchor = at > margin.left + plotW - 30 ? "end" : at < margin.left + 30 ? "start" : "middle";
                return (
                  <g key={value}>
                    <line x1={at} x2={at} y1={margin.top + plotH} y2={margin.top + plotH + 5} />
                    <text x={anchor === "end" ? Math.min(at + 4, width) : at} y={margin.top + plotH + 18} textAnchor={anchor}>
                      {fmt.money(value, { trim: true })}
                    </text>
                  </g>
                );
              })}
              {kneeX !== null && (
                <path className="cchart__break" d={`M${kneeX - 5},${margin.top + plotH + 6}l4,-12M${kneeX + 1},${margin.top + plotH + 6}l4,-12`} />
              )}
            </g>
            <g className="cchart__examples">
              {examples.map((example, index) => {
                const at = X(example.x);
                return (
                  <g key={index}>
                    <line x1={at} x2={at} y1={margin.top} y2={margin.top + plotH} />
                    <circle cx={Math.min(at, margin.left + plotW - 2)} cy={margin.top - 12} r={8} />
                    <text x={Math.min(at, margin.left + plotW - 2)} y={margin.top - 8} textAnchor="middle">
                      {index + 1}
                    </text>
                  </g>
                );
              })}
            </g>
            {todayPaths && (
              <g className="cchart__today">
                <path className="cchart__average" d={todayPaths.average} />
                <path d={todayPaths.marginal} />
              </g>
            )}
            <path className="cchart__average cchart__average--reform" d={average(points)} />
            <path className="cchart__line" d={pathOf(outline)} />
            {tabs.length > 0 && (
              <g className="cchart__stems">
                {tabs.map((tab) => (
                  <line key={tab.index} x1={X(points[tab.index].x)} y1={Y(points[tab.index].y)} x2={tab.x} y2={tab.y} />
                ))}
              </g>
            )}
            {hover !== null && (
              <g className="cchart__hover">
                <line x1={X(hover)} x2={X(hover)} y1={margin.top} y2={margin.top + plotH} />
                <circle cx={X(hover)} cy={Y(rateAt(points, hover))} r={3.5} />
              </g>
            )}
          </svg>
        )}
        <div
          ref={layer}
          className="cchart__layer"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onPointerLeave={() => setHover(null)}
          onClick={onClick}
        >
          {width > 0 &&
            points.map((point, index) => (
              <div
                key={index}
                ref={(element) => {
                  handles.current[index] = element;
                }}
                data-handle={index}
                role="slider"
                tabIndex={0}
                aria-roledescription={t.curve.pointRole}
                aria-label={t.curve.pointName(index + 1, count)}
                aria-valuemin={param.y.min}
                aria-valuemax={param.y.max}
                aria-valuenow={point.y}
                aria-valuetext={`${fmt.exactMoney(point.x)}, ${rate(point.y)}`}
                aria-describedby={keysId}
                className={`cchart__handle${selected === index ? " is-selected" : ""}`}
                style={{ left: X(point.x), top: Y(point.y) }}
                onFocus={() => onSelect(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
              />
            ))}
          {/* For the finger only; the handles above are the controls for the keyboard and screen readers. */}
          {tabs.map((tab) => (
            <div
              key={`tab-${tab.index}`}
              data-tab={tab.index}
              className={`cchart__tab${selected === tab.index ? " is-selected" : ""}`}
              style={{ left: tab.x, top: tab.y }}
              aria-hidden="true"
            >
              <span>{tabLabel(tab.index, tab.group)}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
