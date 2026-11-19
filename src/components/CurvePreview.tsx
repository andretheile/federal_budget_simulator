/**
 * On a measure's card: a small picture of a rate curve against today's, a line that says whether
 * it was changed, and the way into the editor. The picture is not interactive and uses the same
 * horizontal scale as the editor, so the two look alike.
 */
import { useMemo } from "react";
import { curveChanged, curveOutline, matchingPreset, todayForDrawing, topRate, type CurveSetting } from "../app/curveModel.ts";
import { chooseScale, toFraction, type XScale } from "../app/curveScale.ts";
import { useUi } from "../app/ui.ts";
import type { CurvePoint, Distribution } from "../engine/index.ts";
import { decimalsIn } from "../i18n/format.ts";
import { preloadEditor } from "./CurveEditor.tsx";
import { ChevronRight } from "./icons.tsx";

const WIDTH = 240;
const HEIGHT = 56;

/** An SVG path through values on the given scales. */
function pathOf(points: readonly CurvePoint[], scale: XScale, y: (value: number) => number, width: number): string {
  return points.map((point, i) => `${i === 0 ? "M" : "L"}${(toFraction(scale, point.x) * width).toFixed(1)},${y(point.y).toFixed(1)}`).join("");
}

export function CurvePreview({
  setting,
  points,
  distribution,
  className = "",
}: {
  setting: CurveSetting;
  points: readonly CurvePoint[];
  distribution: Distribution | undefined;
  className?: string;
}) {
  const { param } = setting;
  const scale = useMemo(() => chooseScale(distribution, param.x.min, param.x.max), [distribution, param]);
  const today = useMemo(() => todayForDrawing(setting), [setting]);
  const breaks = scale.knee === null ? [] : [scale.knee];
  const span = param.y.max - param.y.min || 1;
  // A little room at the top and bottom, so a line at the edge is not cut in half.
  const y = (value: number): number => 3 + (1 - (value - param.y.min) / span) * (HEIGHT - 6);
  return (
    <svg
      className={`curve-preview ${className}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {scale.knee !== null && (
        <rect
          className="curve-preview__band"
          x={toFraction(scale, scale.knee) * WIDTH}
          y={0}
          width={(1 - toFraction(scale, scale.knee)) * WIDTH}
          height={HEIGHT}
        />
      )}
      <line className="curve-preview__axis" x1={0} x2={WIDTH} y1={y(param.y.min)} y2={y(param.y.min)} />
      {today && (
        <path className="curve-preview__today" d={pathOf(curveOutline(today, param.x.min, param.x.max, breaks), scale, y, WIDTH)} />
      )}
      <path className="curve-preview__line" d={pathOf(curveOutline(points, param.x.min, param.x.max, breaks), scale, y, WIDTH)} />
    </svg>
  );
}

/** The block on the card: preview, what it shows in words, and the button that opens the editor. */
export function CurveEntry({
  policyLabel,
  setting,
  points,
  onEdit,
}: {
  policyLabel: string;
  setting: CurveSetting;
  points: readonly CurvePoint[];
  onEdit(): void;
}) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const distribution = pack.distributions[setting.effect.distribution];
  const changed = curveChanged(setting, points);
  const preset = matchingPreset(points, setting.param);
  const top = topRate(points);
  const rate = (value: number): string => fmt.percent(value / 100, { digits: decimalsIn(value) });
  return (
    <div className={`policy__curve${changed ? " is-changed" : ""}`}>
      <p className="policy__caption">{t.curve.section}</p>
      <div className="policy__curve-body">
        <CurvePreview setting={setting} points={points} distribution={distribution} />
        <div className="policy__curve-text">
          <p className="policy__curve-state">
            <span className={`curve-state${changed ? " curve-state--changed" : ""}`}>
              {changed ? t.curve.changed : t.curve.asBase(pack.country.baseYear)}
            </span>
            {top && <span>{t.curve.topRate(rate(top.rate), fmt.exactMoney(top.from))}</span>}
          </p>
          {preset && changed && <p className="policy__curve-preset">{t.curve.preset(ui.text(preset.label))}</p>}
          {/* The editor is a part of the app of its own: a pointer or the focus on the button starts loading it. */}
          <button type="button" className="policy__edit" onClick={onEdit} onPointerEnter={preloadEditor} onFocus={preloadEditor}>
            {t.curve.edit}
            <span className="visually-hidden">: {policyLabel}</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
