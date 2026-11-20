/**
 * One chart of the debt projection: a value over the years, back to front the grid, the reference
 * values as thin horizontal lines with their names in the margin to the right, the range of the
 * measures' estimates as a band, the path without the measures as a thin grey line and the path
 * with them as the strong line. When the measures change nothing there is one strong line.
 *
 * An official plan of the country's own path, where the pack has one that describes the same thing
 * as the projection, is a path of its own: dashed, in a colour no other line has, with a diamond at
 * every year it gives a figure for, and named in the legend. Where the projection follows the plan,
 * the path without measures runs through the plan's figures: the plan is then its diamonds alone,
 * set on that line, and a dashed upright line marks the year after which the assumptions take over.
 *
 * The lines are SVG; on top of them lies one HTML element that is the control for the pointer and
 * the keyboard: a slider over the years. Pointing at the chart or moving the slider picks a year,
 * whose values the line above the chart reads out. Screen readers get the same text as the
 * slider's value. Both charts of the section share the year, so pointing at one shows it in both.
 */
import { useRef, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { bandPath, chartDomain, linePath, placeLabels, wrapLabel, yearAt, yearTicks } from "../app/debtChart.ts";
import { textWidth, useElementWidth } from "../hooks/useElementWidth.ts";

export interface ChartLine {
  key: string;
  label: string;
  /** One value per year. */
  values: readonly number[];
  /** The path the chart is about: drawn strong. The other is drawn thin and grey. */
  strong: boolean;
}

export interface ChartReference {
  key: string;
  /** Name in the margin; it is broken into lines where it is long. */
  label: string;
  /** The same, for a value above the top of the chart, with the value and an arrow. */
  offScaleLabel: string;
  value: number;
  /** A threshold (such as the EU's 60 %) is drawn dashed and darker than a country or a year. */
  threshold: boolean;
}

export interface ChartPlan {
  key: string;
  /** Name in the legend: the pack's label of the plan. */
  label: string;
  /** The plan's values, for the years it gives one, ascending. */
  points: readonly { year: number; value: number }[];
  /** The projection follows the plan, so its path runs through these points: diamonds only, no line of their own. */
  onPath?: boolean;
}

export interface DebtChartProps {
  title: string;
  subtitle: string;
  /** Controls next to the title, such as the choice of unit. */
  controls?: ReactNode;
  years: readonly number[];
  lines: readonly ChartLine[];
  /** The range of the estimates: two series, one value per year each. */
  band?: { from: readonly number[]; to: readonly number[]; label: string };
  references: readonly ChartReference[];
  /** Official plans to draw against the paths, each where it has values. */
  plans?: readonly ChartPlan[];
  /** A year to mark with an upright line and a short label, such as where a followed plan ends. */
  marker?: { year: number; label: string };
  /**
   * How far above everything else a reference may lie before it is marked at the top edge instead
   * of stretching the chart (see chartDomain); Infinity keeps all in the range. Default 1.5.
   */
  outlier?: number;
  /**
   * Every name that can stand in the margin of either chart. The margin is wide enough for the
   * longest word among them, and the same for both charts, so that their years line up.
   */
  marginLabels: readonly string[];
  referenceLabel: string;
  /** A tick label of the vertical axis. */
  tick(value: number): string;
  /** What is read out for a year: above the chart and as the slider's value. */
  readout(year: number): string;
  /** The year that is pointed at, shared with the other chart; null for none (then the last year is read out). */
  year: number | null;
  onYear(year: number | null): void;
  /** Name of the slider for screen readers. */
  controlLabel: string;
  /** Id of the text that explains the keys. */
  keysId: string;
  height: { narrow: number; wide: number };
}

const FONT = "500 11px 'Public Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const LINE = 12.5;

/** Width of a label; where nothing can be measured (no canvas), a fair guess. */
function measure(text: string): number {
  const width = textWidth(text, FONT);
  return Number.isFinite(width) ? width : text.length * 6.2;
}

/** A diamond around a point: the mark of an official plan's figures. */
function diamond(x: number, y: number, r: number): string {
  return `M${x.toFixed(1)},${(y - r).toFixed(1)}L${(x + r).toFixed(1)},${y.toFixed(1)}L${x.toFixed(1)},${(y + r).toFixed(1)}L${(x - r).toFixed(1)},${y.toFixed(1)}Z`;
}

export function DebtChart(props: DebtChartProps) {
  const { years, lines, band, references, year, onYear } = props;
  const plans = (props.plans ?? []).filter((plan) => plan.points.length > 0);
  const frame = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frame);
  const first = years[0];
  const last = years[years.length - 1];

  // --- geometry -------------------------------------------------------------------------------
  const narrow = width < 560;
  const height = narrow ? props.height.narrow : props.height.wide;
  // The margin for the names of the reference values. The same with or without them, so that the
  // two charts line up year for year and switching the unit does not move the plot. On a narrow
  // screen it grows to hold the longest word (a word too long even so breaks after a hyphen).
  const longestWord = Math.max(0, ...props.marginLabels.flatMap((label) => label.split(/[ -]+/)).map((word) => measure(`${word}-`)));
  const labelRoom = Math.round(Math.min(Math.max(64, width * 0.24, longestWord + 12), Math.max(150, width * 0.24), width * 0.36));
  const data = [
    ...lines.flatMap((line) => line.values),
    ...(band ? [...band.from, ...band.to] : []),
    ...plans.flatMap((plan) => plan.points.map((point) => point.value)),
  ];
  const top = 14;
  const bottom = 26;
  const plotH = height - top - bottom;
  const domain = chartDomain(data, references.map((reference) => reference.value), plotH, narrow ? 34 : 40, props.outlier);
  const left = Math.max(30, Math.ceil(Math.max(...domain.ticks.map((value) => measure(props.tick(value))))) + 10);
  const right = labelRoom + 6;
  const plotW = Math.max(1, width - left - right);
  const span = last - first || 1;
  const X = (y: number): number => left + ((y - first) / span) * plotW;
  const Y = (value: number): number => top + (1 - (value - domain.min) / (domain.max - domain.min)) * plotH;
  const plotRight = left + plotW;

  const ticks = yearTicks(first, last, plotW, narrow ? 44 : 56);

  // The reference values: their lines, and their names placed in the margin without overlapping.
  const marks = references.map((reference, index) => {
    const offScale = domain.offScale[index];
    // A little room to spare: browsers draw text a pixel or two wider than the canvas measures it.
    const lines = wrapLabel(offScale ? reference.offScaleLabel : reference.label, labelRoom - 13, measure);
    return { reference, offScale, lines, at: offScale ? top : Y(reference.value) };
  });
  const placed = placeLabels(
    marks.map((mark) => ({ y: mark.at, height: mark.lines.length * LINE })),
    0,
    height - bottom + 6,
    3,
  );

  const points = (values: readonly number[]): { x: number; y: number }[] => values.map((value, i) => ({ x: X(years[i]), y: Y(value) }));

  // --- the year control -----------------------------------------------------------------------
  const pointerDown = useRef(false);
  const shown = year ?? last;
  const yearFromEvent = (event: PointerEvent<HTMLDivElement>): number => {
    // The control covers the plot from its left to its right edge.
    const box = event.currentTarget.getBoundingClientRect();
    return yearAt(event.clientX - box.left, 0, box.width || plotW, first, last);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "mouse" || pointerDown.current) onYear(yearFromEvent(event));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    pointerDown.current = true;
    onYear(yearFromEvent(event));
  };
  const onPointerEnd = (): void => {
    pointerDown.current = false;
  };
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>): void => {
    pointerDown.current = false;
    // A finger lifts and the year stays, to be read; the mouse leaves and takes it along.
    if (event.pointerType === "mouse") onYear(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 };
    let next: number | undefined;
    if (event.key in steps) next = shown + steps[event.key];
    else if (event.key === "Home") next = first;
    else if (event.key === "End") next = last;
    if (next === undefined) return;
    event.preventDefault();
    onYear(Math.min(last, Math.max(first, next)));
  };
  const onFocus = (): void => {
    if (year === null) onYear(last);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    // Moving on to the other chart keeps the year.
    const next = event.relatedTarget as HTMLElement | null;
    if (!next?.dataset.debtChart) onYear(null);
  };

  const index = Math.min(years.length - 1, Math.max(0, shown - first));
  const strong = lines.find((line) => line.strong);

  return (
    <figure className="dchart">
      <figcaption className="dchart__head">
        <span className="dchart__title">
          <strong>{props.title}</strong> <span className="dchart__subtitle">{props.subtitle}</span>
        </span>
        {props.controls}
      </figcaption>
      <p className={`dchart__readout${year !== null ? " is-reading" : ""}`} aria-hidden="true">
        {props.readout(shown)}
      </p>
      <div className="dchart__frame" ref={frame} style={{ height }}>
        {width > 0 && (
          <svg className="dchart__svg" width={width} height={height} aria-hidden="true" focusable="false">
            <g className="dchart__grid">
              {domain.ticks.map((value) => (
                <g key={value}>
                  <line x1={left} x2={plotRight} y1={Y(value)} y2={Y(value)} className={value === 0 ? "is-zero" : undefined} />
                  <text x={left - 7} y={Y(value) + 4} textAnchor="end">
                    {props.tick(value)}
                  </text>
                </g>
              ))}
            </g>
            <g className="dchart__xaxis">
              {ticks.map((tick) => {
                const at = X(tick);
                const anchor = tick === first && ticks.length > 1 ? "start" : tick === last && ticks.length > 1 ? "end" : "middle";
                return (
                  <g key={tick}>
                    <line x1={at} x2={at} y1={top + plotH} y2={top + plotH + 5} />
                    <text x={at} y={top + plotH + 18} textAnchor={anchor}>
                      {tick}
                    </text>
                  </g>
                );
              })}
            </g>
            <g className="dchart__refs">
              {marks.map((mark, i) => {
                const y = placed[i];
                const lineTop = y - ((mark.lines.length - 1) * LINE) / 2;
                return (
                  <g key={mark.reference.key} className={mark.reference.threshold ? "is-threshold" : undefined} data-reference={mark.reference.key}>
                    {!mark.offScale && <line className="dchart__refline" x1={left} x2={plotRight} y1={mark.at} y2={mark.at} />}
                    <path className="dchart__leader" d={`M${plotRight},${mark.at.toFixed(1)}L${plotRight + 5},${y.toFixed(1)}L${plotRight + 8},${y.toFixed(1)}`} />
                    <text x={plotRight + 10} y={lineTop + 4}>
                      {mark.lines.map((text, k) => (
                        <tspan key={k} x={plotRight + 10} dy={k === 0 ? 0 : LINE}>
                          {text}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              })}
            </g>
            {band && (
              <path
                className="dchart__band"
                d={bandPath(
                  years.map(X),
                  band.from.map((value, i) => Y(Math.max(value, band.to[i]))),
                  band.from.map((value, i) => Y(Math.min(value, band.to[i]))),
                )}
              />
            )}
            {lines.map((line) => (
              <path key={line.key} className={`dchart__line${line.strong ? " is-strong" : ""}`} d={linePath(points(line.values))} />
            ))}
            {props.marker && props.marker.year > first && props.marker.year < last && (
              <g className="dchart__marker">
                <line x1={X(props.marker.year)} x2={X(props.marker.year)} y1={top} y2={top + plotH} />
                <text
                  x={X(props.marker.year) + (X(props.marker.year) > left + plotW * 0.7 ? -5 : 5)}
                  y={top + 10}
                  textAnchor={X(props.marker.year) > left + plotW * 0.7 ? "end" : "start"}
                >
                  {props.marker.label}
                </text>
              </g>
            )}
            {plans.map((plan) => (
              <g key={plan.key} className="dchart__plan" data-plan={plan.key}>
                {plan.points.length > 1 && !plan.onPath && (
                  <path className="dchart__plan-line" d={linePath(plan.points.map((point) => ({ x: X(point.year), y: Y(point.value) })))} />
                )}
                {plan.points.map((point) => (
                  <path key={point.year} className="dchart__plan-point" d={diamond(X(point.year), Y(point.value), 4.5)} />
                ))}
              </g>
            ))}
            {year !== null ? (
              <g className="dchart__cursor">
                <line x1={X(shown)} x2={X(shown)} y1={top} y2={top + plotH} />
                {lines.map((line) => (
                  <circle key={line.key} cx={X(shown)} cy={Y(line.values[index])} r={line.strong ? 4 : 3} className={line.strong ? "is-strong" : undefined} />
                ))}
              </g>
            ) : (
              strong && <circle className="dchart__end" cx={X(last)} cy={Y(strong.values[strong.values.length - 1])} r={3.5} />
            )}
          </svg>
        )}
        <div
          className="dchart__layer"
          data-debt-chart=""
          role="slider"
          tabIndex={0}
          aria-label={props.controlLabel}
          aria-valuemin={first}
          aria-valuemax={last}
          aria-valuenow={shown}
          aria-valuetext={props.readout(shown)}
          aria-describedby={props.keysId}
          style={{ left, width: plotW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={onPointerLeave}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </div>
      <ul className="dchart__legend">
        {lines.map((line) => (
          <li key={line.key} className={`dkey ${line.strong ? "dkey--strong" : "dkey--thin"}`}>
            {line.label}
          </li>
        ))}
        {band && <li className="dkey dkey--band">{band.label}</li>}
        {plans.map((plan) => (
          <li key={plan.key} className={`dkey dkey--plan${plan.onPath ? " is-on-path" : ""}`}>
            <svg className="dkey__plan" width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" focusable="false">
              {!plan.onPath && <path className="dchart__plan-line" d="M1,6H21" />}
              <path className="dchart__plan-point" d={diamond(11, 6, 4)} />
            </svg>
            {plan.label}
          </li>
        ))}
        {references.length > 0 && <li className="dkey dkey--ref">{props.referenceLabel}</li>}
      </ul>
    </figure>
  );
}
