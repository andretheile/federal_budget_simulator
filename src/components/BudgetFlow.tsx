/**
 * The overview as a flow of money: the revenue areas on the left, the budget in the middle, the
 * spending areas on the right, each joined to the middle by a ribbon as wide as its amount. The
 * balance closes the gap, hatched as in the bars: a deficit on the left, a surplus on the right.
 *
 * The drawing (ribbons and nodes) is one SVG for the eye only. What can be chosen is a button per
 * node over it, as tall as the node's band: the node with its label. Keyboard and screen readers
 * go down the left column, then the right one. The layout is worked out in app/flowLayout.ts.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  segmentKeyOf,
  selectionIn,
  selectionOfSegment,
  withFolded,
  type BudgetLayout,
  type Selection,
} from "../app/budgetModel.ts";
import { flowTexts, layoutFlow, type FlowNode, type FlowPart, type FlowTextStyle } from "../app/flowLayout.ts";
import { directionOfNode } from "../app/policyModel.ts";
import { useUi } from "../app/ui.ts";
import { findNode, type Side, type SimulationResult } from "../engine/index.ts";
import { textWidth, useElementWidth } from "../hooks/useElementWidth.ts";
import { useFontsLoaded } from "../hooks/useFontsLoaded.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import "../styles/budget-flow.css";
import { Delta } from "./primitives.tsx";

/** Must match `.flow__name`, `.flow__value` and `.flow__label .delta` in the stylesheet: labels are measured before they are drawn. */
const FAMILY = '"Public Sans Variable", system-ui, -apple-system, "Segoe UI", sans-serif';
const FONTS: Record<FlowTextStyle, string> = {
  name: `600 12.5px ${FAMILY}`,
  value: `400 12.5px ${FAMILY}`,
  delta: `650 12px ${FAMILY}`,
};
const FONT_LIST = Object.values(FONTS);
/** The triangle of a change and the gap after it (`.delta`). */
const TRIANGLE = 15;

/** Where the budget stays beside the measures (budget.css): the diagram must leave room for the list below it. */
const PINNED = "(min-width: 1080px) and (min-height: 720px)";
/**
 * What the window keeps for everything but the diagram where the budget stays beside the measures:
 * the scoreboard while it floats (about 190 px with a goal and measures switched on), then the
 * switch, the heads, the note and at least a few rows of the list. A fixed allowance, not the
 * scoreboard's current height, which changes while the page scrolls: the diagram should not refold then.
 */
const PINNED_OTHER = 590;

/** The height of the window, kept up to date. */
function useWindowHeight(): number {
  const [height, setHeight] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  useEffect(() => {
    const update = (): void => setHeight(window.innerHeight);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return height;
}

/**
 * How tall the diagram may be. Beside the measures it shares the window with the scoreboard and
 * the list, so it takes what they leave. Elsewhere the page scrolls, and it may take most of a
 * phone's screen, whatever the window's height at the moment: on a phone that changes while the
 * browser's bars come and go, and the diagram should not refold then. A column of labels that
 * needs more room folds its smallest areas first.
 */
function heights(windowHeight: number, pinned: boolean): { scaleHeight: number; maxHeight: number } {
  if (!pinned) return { maxHeight: 560, scaleHeight: 300 };
  const maxHeight = Math.max(240, Math.min(480, windowHeight - PINNED_OTHER));
  return { maxHeight, scaleHeight: Math.min(300, Math.round(maxHeight * 0.66)) };
}

export interface BudgetFlowProps {
  /** The layout of the bars: colours, order, and the most the flow folds. */
  layout: BudgetLayout;
  result: SimulationResult;
  noise: number;
  selection: Selection;
  onSelect(selection: Selection): void;
  /** Which categories the flow folds into "other areas", whenever that changes. */
  onFolds(folded: Record<Side, string[]>): void;
}

export function BudgetFlow({ layout, result, noise, selection, onSelect, onFolds }: BudgetFlowProps) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const box = useRef<HTMLDivElement>(null);
  // Until the box has been measured (and in a test without layout), a usual width.
  const width = useElementWidth(box) || 640;
  const fonts = useFontsLoaded(FONT_LIST);
  const coarse = useMediaQuery("(pointer: coarse)");
  const pinned = useMediaQuery(PINNED);
  const windowHeight = useWindowHeight();
  const { scaleHeight, maxHeight } = heights(windowHeight, pinned);

  const flow = useMemo(
    () =>
      layoutFlow({
        layout,
        result,
        noise,
        texts: flowTexts(
          ui,
          noise,
          (text, style) => textWidth(text, FONTS[style]) + (style === "delta" ? TRIANGLE : 0),
        ),
        size: { width, scaleHeight, maxHeight, minBand: coarse ? 44 : 24 },
      }),
    // `fonts` is a dependency on purpose: the widths change when the web font arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, result, noise, ui, width, scaleHeight, maxHeight, coarse, fonts],
  );

  const foldKey = `${flow.folded.revenue.join(",")}|${flow.folded.expenditure.join(",")}`;
  useLayoutEffect(() => {
    onFolds(flow.folded);
    // Only when the folds change, not on every new layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldKey, onFolds]);

  const view = useMemo(() => withFolded(layout, flow.folded), [layout, flow.folded]);
  const shown = selectionIn(view, selection);
  const selectedKey = segmentKeyOf(view, shown);
  const wholeSide = shown.nodeId === null && !shown.fold ? shown.side : undefined;
  /** The node under the pointer or the keyboard focus: its ribbon stands out. */
  const [active, setActive] = useState<string | null>(null);

  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hatch = `flow-hatch-${id}`;
  const balanceKind = flow.balance?.kind;

  const head = (side: Side): ReactNode => {
    const total = result.reform[side];
    const delta = total - result.baseline[side];
    return (
      <h3 className={`flow__head flow__head--${side}`}>
        <button
          type="button"
          className="bar__side"
          aria-pressed={wholeSide === side}
          onClick={() => onSelect({ side, nodeId: null, fold: false })}
        >
          {t.common[side]}
        </button>
        <span className="bar__total">{fmt.money(total)}</span>
        {Math.abs(delta) > noise && (
          <Delta
            className="bar__delta"
            amount={delta}
            direction={directionOfNode(side, delta, noise)}
            text={fmt.money(delta, { signed: true })}
          />
        )}
      </h3>
    );
  };

  const part = (node: FlowNode, piece: FlowPart, index: number): ReactNode => {
    if (piece.style === "delta" && node.segment) {
      const delta = node.segment.delta;
      return (
        <Delta key={index} amount={delta} direction={directionOfNode(node.side, delta, noise)} text={piece.text} />
      );
    }
    return (
      <span key={index} className={piece.style === "name" ? "flow__name" : "flow__value"}>
        {piece.text}
      </span>
    );
  };

  const label = (node: FlowNode): ReactNode => (
    <span
      className="flow__label"
      style={{
        width: node.label.width + 2,
        marginLeft: node.label.align === "start" ? node.label.x - node.target.x : undefined,
        marginRight:
          node.label.align === "end" ? node.target.x + node.target.width - node.label.x - node.label.width : undefined,
      }}
    >
      {node.label.lines.map((line, index) => (
        <span key={index} className="flow__line">
          {line.parts.map((piece, at) => part(node, piece, at))}
        </span>
      ))}
    </span>
  );

  const place = (node: FlowNode) => ({
    left: node.target.x,
    top: node.band.top,
    width: node.target.width,
    height: node.band.bottom - node.band.top,
  });

  const nodeElement = (node: FlowNode): ReactNode => {
    const segment = node.segment;
    if (!segment) {
      // The balance: nothing to break down, so it is text, not a button. Screen readers get it as one
      // phrase; the parts of the drawn label stand apart by a margin, not a space.
      return (
        <p
          key={node.key}
          className={`flow__node flow__node--${node.column} flow__balance flow__balance--${node.balance}`}
          style={place(node)}
        >
          <span aria-hidden="true">{label(node)}</span>
          <span className="visually-hidden">{`${t.budget.flowBalance(node.balance ?? "difference")} ${fmt.money(node.amount)}`}</span>
        </p>
      );
    }
    const side = node.side;
    const total = result.reform[side];
    const name = segment.isFold
      ? t.budget.other(segment.nodeIds.length)
      : ui.text(findNode(pack, segment.nodeIds[0])?.label);
    const changed = Math.abs(segment.delta) > noise;
    const accessible = [
      name,
      fmt.money(segment.reform),
      t.budget.shareOf(side, fmt.share(total > 0 ? segment.reform / total : 0)),
      ...(changed ? [`${fmt.money(segment.delta, { signed: true })} ${t.scoreboard.vsBase(ui.period)}`] : []),
    ].join(", ");
    return (
      <button
        key={node.key}
        type="button"
        className={`flow__node flow__node--${node.column}${node.key === active ? " is-active" : ""}`}
        style={place(node)}
        aria-pressed={node.key === selectedKey}
        aria-label={accessible}
        onClick={() => onSelect(selectionOfSegment(pack, segment))}
        onPointerEnter={() => setActive(node.key)}
        onPointerLeave={() => setActive((current) => (current === node.key ? null : current))}
        onFocus={() => setActive(node.key)}
        onBlur={() => setActive((current) => (current === node.key ? null : current))}
      >
        {label(node)}
      </button>
    );
  };

  const left = flow.nodes.filter((node) => node.column === "left");
  const right = flow.nodes.filter((node) => node.column === "right");
  const selectedNode = flow.nodes.find((node) => node.segment && node.key === selectedKey);

  return (
    <div className="flow" ref={box}>
      <div className="flow__grid" role="group" aria-label={t.budget.flowLabel}>
        <svg
          className={`flow__svg${balanceKind ? ` flow__svg--${balanceKind}` : ""}`}
          width={flow.width}
          height={flow.height}
          viewBox={`0 0 ${flow.width} ${flow.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <pattern id={hatch} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
              <rect className="flow__hatch" x="0" y="0" width="1" height="5" />
            </pattern>
          </defs>
          {flow.nodes.map((node) =>
            node.ribbon ? (
              <path
                key={`ribbon-${node.key}`}
                className={`flow__ribbon ${node.segment ? `cat-${node.color}` : "flow__ribbon--balance"}${
                  node.key === active || node.key === selectedKey ? " is-strong" : ""
                }`}
                d={node.ribbon}
                // The balance is hatched; a style, as the stylesheet fills the other ribbons with their colour.
                style={node.segment ? undefined : { fill: `url(#${hatch})` }}
              />
            ) : null,
          )}
          <rect
            className="flow__middle"
            x={flow.middle.x}
            y={flow.middle.y}
            width={flow.middle.width}
            height={flow.middle.height}
            rx="2"
          />
          {flow.nodes.map((node) =>
            node.segment ? (
              <rect
                key={`node-${node.key}`}
                className={`flow__bar cat-${node.color}`}
                x={node.x}
                y={node.y}
                width={node.width}
                height={Math.max(node.height, 1)}
                rx="2"
              />
            ) : (
              <g key="node-balance" className="flow__gap">
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  fill={`url(#${hatch})`}
                  className="flow__gap-fill"
                />
                <rect
                  x={node.x + 0.5}
                  y={node.y + 0.5}
                  width={node.width - 1}
                  height={Math.max(node.height - 1, 0)}
                  rx="2"
                  className="flow__gap-line"
                />
              </g>
            ),
          )}
          {/* The selected node, marked beside it on the outside: not by colour alone. */}
          {selectedNode && (
            <rect
              className="flow__mark"
              x={selectedNode.column === "left" ? 0 : flow.width - 3}
              y={selectedNode.y + selectedNode.height / 2 - Math.max(selectedNode.height, 14) / 2}
              width="3"
              height={Math.max(selectedNode.height, 14)}
              rx="1.5"
            />
          )}
        </svg>
        {head("revenue")}
        <div className="flow__nodes" style={{ height: flow.height }}>
          {left.map(nodeElement)}
        </div>
        <p className="flow__head flow__head--middle">
          <span className="flow__middle-name">{t.budget.flowMiddle}</span>{" "}
          <span className="bar__total">{fmt.money(flow.middle.amount)}</span>
        </p>
        {head("expenditure")}
        <div className="flow__nodes" style={{ height: flow.height }}>
          {right.map(nodeElement)}
        </div>
      </div>
      <p className="flow__note">{t.budget.flowNote}</p>
    </div>
  );
}
