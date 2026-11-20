/**
 * How the budget tree is laid out on screen: which top-level category gets which colour, which
 * small ones are folded into "other", and what is listed for a selection.
 *
 * Colours belong to categories, not to ranks or to what happens to be visible: they are assigned
 * once per pack from the unfiltered base-year amounts, so neither a policy nor the level filter
 * ever repaints a category, and everything below a category wears its colour.
 */
import {
  findNode,
  simulate,
  type BudgetNode,
  type CountryPack,
  type Side,
  type SimulationResult,
} from "../engine/index.ts";

/** 1 to 8 are the categorical colours of the stylesheet (--cat-1 ...), "other" is the neutral grey. */
export type ColorKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | "other";

/** Spending gets five hues and revenue three; together they are the eight validated slots. */
const SLOTS: Record<Side, ColorKey[]> = {
  expenditure: [1, 2, 3, 4, 5],
  revenue: [6, 7, 8],
};

/** A category below this share of its side does not get a hue of its own. */
const OWN_COLOR_FROM = 0.035;

export interface SideLayout {
  /** Top-level node ids, largest base-year amount first. */
  order: string[];
  /** The ids at the end of `order` that share the "other" colour. */
  folded: string[];
}

export interface BudgetLayout {
  /** Top-level node id -> colour. */
  colors: Map<string, ColorKey>;
  /** Every node id -> the id of the top-level category it belongs to. */
  top: Map<string, string>;
  sides: Record<Side, SideLayout>;
}

const layouts = new WeakMap<CountryPack, BudgetLayout>();

export function layoutBudget(pack: CountryPack): BudgetLayout {
  const cached = layouts.get(pack);
  if (cached) return cached;
  const base = simulate(pack);
  const colors = new Map<string, ColorKey>();
  const side = (nodes: BudgetNode[], which: Side): SideLayout => {
    const amount = (node: BudgetNode): number => base.nodes[node.id]?.baseline ?? 0;
    const total = nodes.reduce((sum, node) => sum + amount(node), 0);
    // Array.prototype.sort is stable, so equal amounts keep the order of the pack.
    const order = [...nodes].sort((a, b) => amount(b) - amount(a)).map((node) => node.id);
    const slots = SLOTS[which];
    let own = 0;
    while (
      own < order.length &&
      own < slots.length &&
      (own === 0 || (total > 0 && (base.nodes[order[own]]?.baseline ?? 0) / total >= OWN_COLOR_FROM))
    ) {
      own++;
    }
    // One left-over category takes a free hue instead of becoming an "other" group of one.
    if (order.length - own === 1 && own < slots.length) own++;
    order.forEach((id, index) => colors.set(id, index < own ? slots[index] : "other"));
    return { order, folded: order.slice(own) };
  };
  const top = new Map<string, string>();
  const mark = (node: BudgetNode, root: string): void => {
    top.set(node.id, root);
    if ("children" in node) for (const child of node.children) mark(child, root);
  };
  for (const node of [...pack.budget.revenue, ...pack.budget.expenditure]) mark(node, node.id);
  const layout: BudgetLayout = {
    colors,
    top,
    sides: { expenditure: side(pack.budget.expenditure, "expenditure"), revenue: side(pack.budget.revenue, "revenue") },
  };
  layouts.set(pack, layout);
  return layout;
}

/** The top-level category a node belongs to. */
export function topLevelOf(layout: BudgetLayout, id: string): string {
  return layout.top.get(id) ?? id;
}

/** The colour a node wears: that of its top-level category. */
export function colorOf(layout: BudgetLayout, id: string): ColorKey {
  return layout.colors.get(topLevelOf(layout, id)) ?? "other";
}

/** One block of a stacked bar: a top-level category, or the fold of the small ones. */
export interface Segment {
  /** Node id, or "other:revenue" / "other:expenditure" for the fold. */
  key: string;
  side: Side;
  nodeIds: string[];
  color: ColorKey;
  isFold: boolean;
  baseline: number;
  reform: number;
  delta: number;
}

export function foldKey(side: Side): string {
  return `other:${side}`;
}

export function segmentsOf(layout: BudgetLayout, result: SimulationResult, side: Side): Segment[] {
  const { order, folded } = layout.sides[side];
  const sum = (ids: string[], field: "baseline" | "reform" | "delta"): number =>
    ids.reduce((total, id) => total + (result.nodes[id]?.[field] ?? 0), 0);
  const segment = (key: string, nodeIds: string[], color: ColorKey, isFold: boolean): Segment => ({
    key,
    side,
    nodeIds,
    color,
    isFold,
    baseline: sum(nodeIds, "baseline"),
    reform: sum(nodeIds, "reform"),
    delta: sum(nodeIds, "delta"),
  });
  const out = order
    .filter((id) => !folded.includes(id))
    .map((id) => segment(id, [id], layout.colors.get(id) ?? "other", false));
  if (folded.length === 1) out.push(segment(folded[0], folded, "other", false));
  else if (folded.length > 1) out.push(segment(foldKey(side), folded, "other", true));
  return out;
}

/** What the detail list shows: the children of `nodeId`, the folded categories, or all top-level categories of a side. */
export interface Selection {
  side: Side;
  nodeId: string | null;
  fold: boolean;
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return a.side === b.side && a.nodeId === b.nodeId && a.fold === b.fold;
}

function childrenOf(pack: CountryPack, id: string): BudgetNode[] {
  const node = findNode(pack, id);
  return node && "children" in node ? node.children : [];
}

export function hasChildren(pack: CountryPack, id: string): boolean {
  return childrenOf(pack, id).length > 0;
}

/** Start on the largest spending category that can be broken down. */
export function defaultSelection(pack: CountryPack, layout: BudgetLayout): Selection {
  const first = layout.sides.expenditure.order.find((id) => hasChildren(pack, id));
  return { side: "expenditure", nodeId: first ?? null, fold: false };
}

/** The selection a segment of the stacked bar stands for. */
export function selectionOfSegment(pack: CountryPack, segment: Segment): Selection {
  if (segment.isFold) return { side: segment.side, nodeId: null, fold: true };
  const id = segment.nodeIds[0];
  // A top-level leaf cannot be broken down; show it in the list of its side instead.
  return { side: segment.side, nodeId: hasChildren(pack, id) ? id : null, fold: false };
}

/** The selection whose list contains the given node as a row. */
export function selectionShowing(layout: BudgetLayout, result: SimulationResult, id: string): Selection | undefined {
  const node = result.nodes[id];
  if (!node) return undefined;
  if (node.parent) return { side: node.side, nodeId: node.parent, fold: false };
  const folded = layout.sides[node.side].folded;
  return { side: node.side, nodeId: null, fold: folded.length > 1 && folded.includes(id) };
}

/** The key of the stacked-bar segment a selection lies in; undefined for the list of a whole side. */
export function segmentKeyOf(layout: BudgetLayout, selection: Selection): string | undefined {
  if (selection.fold) return foldKey(selection.side);
  if (!selection.nodeId) return undefined;
  const top = topLevelOf(layout, selection.nodeId);
  const folded = layout.sides[selection.side].folded;
  return folded.length > 1 && folded.includes(top) ? foldKey(selection.side) : top;
}

export interface Row {
  id: string;
  node: BudgetNode;
  color: ColorKey;
  isGroup: boolean;
  baseline: number;
  reform: number;
  delta: number;
}

export interface RowList {
  rows: Row[];
  /** Rows left out because the selected level of government has no part in them. */
  hidden: number;
}

/** The rows of the detail list for a selection, largest base-year amount first. */
export function rowsOf(
  pack: CountryPack,
  layout: BudgetLayout,
  result: SimulationResult,
  selection: Selection,
): RowList {
  let nodes: BudgetNode[];
  if (selection.nodeId) nodes = childrenOf(pack, selection.nodeId);
  else {
    const top = selection.side === "revenue" ? pack.budget.revenue : pack.budget.expenditure;
    const { order, folded } = layout.sides[selection.side];
    nodes = top.filter((node) => !selection.fold || folded.includes(node.id));
    nodes = [...nodes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  const all: Row[] = nodes.map((node) => {
    const values = result.nodes[node.id];
    return {
      id: node.id,
      node,
      color: colorOf(layout, node.id),
      isGroup: "children" in node,
      baseline: values?.baseline ?? 0,
      reform: values?.reform ?? 0,
      delta: values?.delta ?? 0,
    };
  });
  // Under a level filter, an item the level has no part in is noise. Without a filter a zero is
  // information (a tax that is not levied) and stays.
  const rows = result.level === "all" ? all : all.filter((row) => row.baseline !== 0 || row.reform !== 0);
  rows.sort((a, b) => b.baseline - a.baseline);
  return { rows, hidden: all.length - rows.length };
}

export type Crumb =
  | { kind: "side"; side: Side; selection: Selection }
  | { kind: "fold"; side: Side; count: number; selection: Selection }
  | { kind: "node"; id: string; selection: Selection };

/** The path from the side down to the selected node; the last crumb is where the list is. */
export function crumbsOf(layout: BudgetLayout, result: SimulationResult, selection: Selection): Crumb[] {
  const { side } = selection;
  const crumbs: Crumb[] = [{ kind: "side", side, selection: { side, nodeId: null, fold: false } }];
  const folded = layout.sides[side].folded;
  const fold: Crumb = { kind: "fold", side, count: folded.length, selection: { side, nodeId: null, fold: true } };
  if (selection.fold) crumbs.push(fold);
  if (selection.nodeId) {
    const chain: string[] = [];
    for (let id: string | null = selection.nodeId; id; id = result.nodes[id]?.parent ?? null) chain.unshift(id);
    if (folded.length > 1 && chain[0] !== undefined && folded.includes(chain[0])) crumbs.push(fold);
    for (const id of chain) crumbs.push({ kind: "node", id, selection: { side, nodeId: id, fold: false } });
  }
  return crumbs;
}
