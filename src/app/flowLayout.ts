/**
 * The overview as a flow of money: where it comes from (the revenue areas, on the left), the
 * budget as a whole (one node in the middle) and where it goes (the spending areas, on the right).
 * A ribbon joins each area to the middle. The balance closes the gap: a deficit stands on the left,
 * beside the revenue it makes up for, a surplus on the right, so both sides add up to the middle.
 *
 * Everything here is arithmetic on the amounts of the bars (`segmentsOf`), the size of the box and
 * the widths of the label texts, so it can be tested without a browser.
 *
 * Heights are proportional to amounts, on one scale for both sides. Each node owns a band of its
 * column: at least as tall as the node plus a gap, its label and a tap target. The label stands
 * centred on its node, inside the band, so no two labels can overlap, and the band is what a
 * finger or a pointer hits. Labels stand on the inner side of their node, over the start of the
 * ribbons, which leaves the ribbons most of the width on a phone.
 *
 * Where the labels do not fit in the height the diagram may take, the smallest areas are folded
 * into "other areas", one more at a time, as far as the bars fold them and never further: past
 * that the diagram grows instead.
 */
import { findNode, type Side, type SimulationResult } from "../engine/index.ts";
import { segmentsOf, withFolded, type BudgetLayout, type ColorKey, type Segment } from "./budgetModel.ts";
import type { Ui } from "./ui.ts";

export type FlowColumn = "left" | "right";

/**
 * The node that makes both sides equal. For the whole state it is the balance; for a single level
 * the page shows no balance (payments between levels are not in the data), so it is only the
 * difference between the two sides.
 */
export type BalanceKind = "deficit" | "surplus" | "difference";

/** The three kinds of text in a label: the name, the amount, the change against the base year. */
export type FlowTextStyle = "name" | "value" | "delta";

export interface FlowTexts {
  /** The name of an area, or of the fold of the small ones. */
  name(segment: Segment): string;
  /** The name of the node that makes both sides equal. */
  balance(kind: BalanceKind): string;
  money(amount: number): string;
  /** The change against the base year as the legend of the bars shows it; undefined where nothing changed. */
  delta(segment: Segment): string | undefined;
  /** Width of a text in pixels, in the font of its style; a delta includes its triangle. */
  measure(text: string, style: FlowTextStyle): number;
}

/** The texts of the page's language, as the bars and their legend say them. */
export function flowTexts(ui: Ui, noise: number, measure: FlowTexts["measure"]): FlowTexts {
  return {
    name: (segment) =>
      segment.isFold
        ? ui.t.budget.other(segment.nodeIds.length)
        : ui.text(findNode(ui.pack, segment.nodeIds[0])?.label),
    balance: (kind) => ui.t.budget.flowBalance(kind),
    money: (amount) => ui.fmt.money(amount),
    delta: (segment) => (Math.abs(segment.delta) > noise ? ui.fmt.money(segment.delta, { signed: true }) : undefined),
    measure,
  };
}

export interface FlowSize {
  /** Width of the diagram. */
  width: number;
  /** Height of the middle node, which stands for the larger side's total. */
  scaleHeight: number;
  /** A column taller than this folds its smallest areas, as far as the bars fold them. */
  maxHeight: number;
  /** The least height of a node's band, its tap target: 44 on a touch screen. */
  minBand: number;
}

/** Fixed measures of the drawing, in pixels. The stylesheet must agree with LINE and PART_GAP. */
export const FLOW = {
  /** Width of a node at the side. */
  node: 10,
  /** Width of the middle node. */
  middle: 10,
  /** Room outside a side node, for the mark of the selected one. */
  outer: 6,
  /** Between a node and its label. */
  labelGap: 6,
  /** Between a label and the middle node. */
  clear: 8,
  /** Widest a label gets, so that the ribbons stay visible beside it on a wide screen. */
  labelMax: 210,
  /** Line height of the labels. */
  line: 16,
  /** Between the parts of a line: name, amount and change. */
  partGap: 5,
  /** The least gap between two nodes of a column. */
  nodeGap: 6,
  /** Above and below a label, inside its band. */
  labelPad: 3,
} as const;

export interface FlowPart {
  text: string;
  style: FlowTextStyle;
}

export interface FlowLine {
  parts: FlowPart[];
  width: number;
}

export interface FlowLabel {
  /** Left edge and top of the text block. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** "start": the text begins at x (left column); "end": it ends at x + width (right column). */
  align: "start" | "end";
  lines: FlowLine[];
}

export interface FlowNode {
  /** The segment's key, or "balance". */
  key: string;
  column: FlowColumn;
  /** The side whose column it stands in. */
  side: Side;
  /** The area, or the fold of the small ones, it stands for; none for the balance. */
  segment?: Segment;
  balance?: BalanceKind;
  color: ColorKey | BalanceKind;
  /** The amount its height stands for. */
  amount: number;
  /** The bar of the node. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The band of the column it owns, from top to bottom: room for its label and its tap target. */
  band: { top: number; bottom: number };
  /** The tap target: the node and its label, the full height of the band. */
  target: { x: number; width: number };
  label: FlowLabel;
  /** Where its ribbon meets the middle node. */
  inner: { top: number; height: number };
  /** The ribbon to the middle node as an SVG path; "" for a node without height. */
  ribbon: string;
}

export interface FlowLayout {
  width: number;
  height: number;
  /** Pixels per unit of currency, the same on both sides. */
  scale: number;
  middle: { x: number; y: number; width: number; height: number; amount: number };
  /** Left column top to bottom, then the right column: the order of the keyboard. */
  nodes: FlowNode[];
  /** The categories folded into "other areas" on each side, a suffix of the layout's order. */
  folded: Record<Side, string[]>;
  balance?: { kind: BalanceKind; column: FlowColumn; amount: number };
  /** The height each column needs. */
  columns: Record<FlowColumn, number>;
}

export interface FlowInput {
  /** The layout of the bars: colours, order, and the most the flow may fold. */
  layout: BudgetLayout;
  result: SimulationResult;
  /** Amounts up to this are nothing; see `noiseLevel`. */
  noise: number;
  texts: FlowTexts;
  size: FlowSize;
}

const COLUMN_OF: Record<Side, FlowColumn> = { revenue: "left", expenditure: "right" };
const SIDE_OF: Record<FlowColumn, Side> = { left: "revenue", right: "expenditure" };

/** One decimal is plenty for a path, and keeps it short. */
const r = (value: number): number => Math.round(value * 10) / 10;

/**
 * A word too wide for a line is broken with a hyphen. A joint after a linking "s" (Sozialversicherungs-
 * beiträge) or an existing hyphen is preferred where one fits; otherwise the longest piece that fits.
 */
function breakWord(word: string, style: FlowTextStyle, max: number, measure: FlowTexts["measure"]): string[] {
  const pieces: string[] = [];
  let rest = word;
  while (measure(rest, style) > max && rest.length >= 8) {
    let longest = -1;
    let joint = -1;
    for (let at = rest.length - 3; at >= 3; at--) {
      const head = rest.slice(0, at);
      if (measure(head.endsWith("-") ? head : `${head}-`, style) > max) continue;
      if (longest < 0) longest = at;
      if (at >= rest.length * 0.4 && /(?:ungs|heits|keits|schafts|ions|täts|-)$/.test(head)) {
        joint = at;
        break;
      }
    }
    const at = joint > 0 ? joint : longest;
    if (at < 0) break;
    const head = rest.slice(0, at);
    pieces.push(head.endsWith("-") ? head : `${head}-`);
    rest = rest.slice(at);
  }
  pieces.push(rest);
  return pieces;
}

/** Name, amount and change of a node as lines of at most `max` pixels: the amount and the change follow the name where they fit. */
export function labelLines(
  name: string,
  value: string,
  delta: string | undefined,
  max: number,
  measure: FlowTexts["measure"],
): FlowLine[] {
  const width = (text: string, style: FlowTextStyle): number => Math.min(measure(text, style), max);
  const lines: FlowLine[] = [];
  let line = "";
  const flush = (): void => {
    if (line) lines.push({ parts: [{ text: line, style: "name" }], width: width(line, "name") });
    line = "";
  };
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, "name") <= max) {
      line = candidate;
      continue;
    }
    flush();
    const pieces = breakWord(word, "name", max, measure);
    for (const piece of pieces.slice(0, -1))
      lines.push({ parts: [{ text: piece, style: "name" }], width: width(piece, "name") });
    line = pieces[pieces.length - 1];
  }
  flush();
  const append = (text: string, style: FlowTextStyle): void => {
    const w = width(text, style);
    const last = lines[lines.length - 1];
    if (last && last.width + FLOW.partGap + w <= max) {
      last.parts.push({ text, style });
      last.width += FLOW.partGap + w;
    } else lines.push({ parts: [{ text, style }], width: w });
  };
  append(value, "value");
  if (delta !== undefined) append(delta, "delta");
  return lines;
}

interface Planned {
  key: string;
  side: Side;
  segment?: Segment;
  balance?: BalanceKind;
  color: ColorKey | BalanceKind;
  amount: number;
  height: number;
  lines: FlowLine[];
  band: number;
}

interface ColumnPlan {
  nodes: Planned[];
  height: number;
  folded: string[];
}

export function layoutFlow({ layout, result, noise, texts, size }: FlowInput): FlowLayout {
  const width = Math.max(0, size.width);
  const revenue = result.reform.revenue;
  const spending = result.reform.expenditure;
  const difference = revenue - spending;
  const balance =
    Math.abs(difference) <= noise
      ? undefined
      : {
          kind: (result.level !== "all" ? "difference" : difference < 0 ? "deficit" : "surplus") as BalanceKind,
          column: (difference < 0 ? "left" : "right") as FlowColumn,
          amount: Math.abs(difference),
        };
  const total = Math.max(revenue, spending, 0);
  const scale = total > 0 ? size.scaleHeight / total : 0;

  const middleX = (width - FLOW.middle) / 2;
  const inset = FLOW.outer + FLOW.node + FLOW.labelGap;
  const labelMax = Math.max(40, Math.min(FLOW.labelMax, middleX - FLOW.clear - inset));

  const plan = (side: Side, folded: string[]): ColumnPlan => {
    const column = COLUMN_OF[side];
    const folds: Record<Side, readonly string[]> = {
      revenue: layout.sides.revenue.folded,
      expenditure: layout.sides.expenditure.folded,
    };
    folds[side] = folded;
    // The same blocks as the bars, from the same amounts; only the fold may be smaller.
    const segments = segmentsOf(withFolded(layout, folds), result, side).filter(
      (segment) => segment.reform > noise || segment.baseline > noise,
    );
    const nodes: Planned[] = segments.map((segment) => {
      const amount = Math.max(0, segment.reform);
      return {
        key: segment.key,
        side,
        segment,
        color: segment.color,
        amount,
        height: amount * scale,
        lines: labelLines(
          texts.name(segment),
          texts.money(segment.reform),
          texts.delta(segment),
          labelMax,
          texts.measure,
        ),
        band: 0,
      };
    });
    if (balance && balance.column === column) {
      nodes.push({
        key: "balance",
        side,
        balance: balance.kind,
        color: balance.kind,
        amount: balance.amount,
        height: balance.amount * scale,
        lines: labelLines(texts.balance(balance.kind), texts.money(balance.amount), undefined, labelMax, texts.measure),
        band: 0,
      });
    }
    for (const node of nodes) {
      node.band = Math.max(node.height + FLOW.nodeGap, node.lines.length * FLOW.line + 2 * FLOW.labelPad, size.minBand);
    }
    return { nodes, height: nodes.reduce((sum, node) => sum + node.band, 0), folded };
  };

  const choose = (side: Side): ColumnPlan => {
    const { order, folded: most } = layout.sides[side];
    // Fold nothing, then the smallest two, three, ... up to what the bars fold. One area alone is
    // never folded: it keeps its name, as in the bars.
    const counts = [0];
    for (let count = 2; count <= most.length; count++) counts.push(count);
    for (const count of counts) {
      const candidate = plan(side, order.slice(order.length - count));
      if (candidate.height <= size.maxHeight) return candidate;
    }
    return plan(side, most.length > 1 ? [...most] : []);
  };

  const columns: Record<FlowColumn, ColumnPlan> = { left: choose("revenue"), right: choose("expenditure") };
  const middleHeight = total * scale;
  const height = Math.max(columns.left.height, columns.right.height, middleHeight);
  const middle = {
    x: middleX,
    y: (height - middleHeight) / 2,
    width: FLOW.middle,
    height: middleHeight,
    amount: total,
  };

  const nodes: FlowNode[] = [];
  for (const column of ["left", "right"] as const) {
    const planned = columns[column];
    let top = (height - planned.height) / 2;
    let inner = middle.y;
    for (const node of planned.nodes) {
      const y = top + (node.band - node.height) / 2;
      const x = column === "left" ? FLOW.outer : width - FLOW.outer - FLOW.node;
      const labelWidth = Math.max(0, ...node.lines.map((line) => line.width));
      const labelHeight = node.lines.length * FLOW.line;
      const labelX = column === "left" ? x + FLOW.node + FLOW.labelGap : x - FLOW.labelGap - labelWidth;
      const targetX = column === "left" ? 0 : labelX - FLOW.labelGap / 2;
      const targetEnd = column === "left" ? labelX + labelWidth + FLOW.labelGap / 2 : width;
      // The ribbon: from the inner edge of the node to the middle node, a cubic curve whose
      // control points lie halfway, so that it leaves and arrives level.
      const [x0, x1] = column === "left" ? [x + FLOW.node, middle.x] : [middle.x + middle.width, x];
      const [ya, yb] = column === "left" ? [y, inner] : [inner, y];
      const h = node.height;
      const xm = (x0 + x1) / 2;
      const ribbon =
        h > 0
          ? `M${r(x0)},${r(ya)}C${r(xm)},${r(ya)} ${r(xm)},${r(yb)} ${r(x1)},${r(yb)}` +
            `L${r(x1)},${r(yb + h)}C${r(xm)},${r(yb + h)} ${r(xm)},${r(ya + h)} ${r(x0)},${r(ya + h)}Z`
          : "";
      nodes.push({
        key: node.key,
        column,
        side: SIDE_OF[column],
        segment: node.segment,
        balance: node.balance,
        color: node.color,
        amount: node.amount,
        x,
        y,
        width: FLOW.node,
        height: h,
        band: { top, bottom: top + node.band },
        target: { x: targetX, width: targetEnd - targetX },
        label: {
          x: labelX,
          y: top + (node.band - labelHeight) / 2,
          width: labelWidth,
          height: labelHeight,
          align: column === "left" ? "start" : "end",
          lines: node.lines,
        },
        inner: { top: inner, height: h },
        ribbon,
      });
      top += node.band;
      inner += h;
    }
  }

  return {
    width,
    height,
    scale,
    middle,
    nodes,
    folded: { revenue: columns.left.folded, expenditure: columns.right.folded },
    balance,
    columns: { left: columns.left.height, right: columns.right.height },
  };
}
