/**
 * Tabs for points that lie too close together for a finger. Where a curve has a step, two points
 * share an amount and differ by a few percentage points: on a phone their handles are a few pixels
 * apart, and a finger covers both. On a touch screen each such point then gets a tab: a small
 * label with its value, set apart from the crowd along the line from the crowd's middle through
 * the point (for a step: one tab above, one below), and joined to its point by a thin line. A tab
 * is grabbed like the handle itself; it moves with its point.
 *
 * Pure geometry in the pixels of the chart.
 */
export interface Spot {
  x: number;
  y: number;
}

export interface TabPlace extends Spot {
  /** Index of the point the tab belongs to. */
  index: number;
  /** Indexes of the points it was crowded with, itself included, in order. */
  group: number[];
}

/** Closer than this (in pixels), two handles cannot be told apart by a finger. */
export const CROWDED = 30;
/** How far a tab stands from its point, centre to centre. */
export const TAB_DISTANCE = 32;

export interface TabOptions {
  crowded?: number;
  distance?: number;
  /** Points to keep together as one crowd although they are no longer close: the crowd whose tab is being dragged. */
  keep?: readonly number[];
  /** The area the tabs must stay inside, and how far from its edges their centres stay. */
  bounds?: { width: number; height: number; marginX: number; marginY: number };
}

/** The crowds among the spots: groups of at least two, each spot closer than `crowded` to another of its group. */
export function crowds(spots: readonly Spot[], crowded = CROWDED, keep: readonly number[] = []): number[][] {
  const parent = spots.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < spots.length; i++)
    for (let j = i + 1; j < spots.length; j++)
      if (Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) < crowded) join(i, j);
  const kept = keep.filter((index) => index >= 0 && index < spots.length);
  for (let k = 1; k < kept.length; k++) join(kept[0], kept[k]);
  const groups = new Map<number, number[]>();
  spots.forEach((_, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  });
  return [...groups.values()].filter((group) => group.length > 1).sort((a, b) => a[0] - b[0]);
}

/**
 * Where the tabs go. Each crowded point gets one, `distance` away from it, in the direction from
 * the middle of its crowd through the point. A point in the very middle (the middle one of three
 * in a column, or points on top of each other) goes sideways, or, if all coincide, they fan out
 * from straight up, the later point first.
 */
export function tabPlaces(spots: readonly Spot[], options: TabOptions = {}): TabPlace[] {
  const { crowded = CROWDED, distance = TAB_DISTANCE, keep = [], bounds } = options;
  const out: TabPlace[] = [];
  for (const group of crowds(spots, crowded, keep)) {
    const middle = {
      x: group.reduce((sum, index) => sum + spots[index].x, 0) / group.length,
      y: group.reduce((sum, index) => sum + spots[index].y, 0) / group.length,
    };
    const first = spots[group[0]];
    const last = spots[group[group.length - 1]];
    const axis = { x: last.x - first.x, y: last.y - first.y };
    const axisLength = Math.hypot(axis.x, axis.y);
    group.forEach((index, rank) => {
      const spot = spots[index];
      let dx = spot.x - middle.x;
      let dy = spot.y - middle.y;
      let length = Math.hypot(dx, dy);
      if (length < 0.5) {
        if (axisLength >= 0.5) {
          // Across the crowd's line, to the right of it on screen.
          dx = -axis.y / axisLength;
          dy = axis.x / axisLength;
          if (dx < 0 || (dx === 0 && dy > 0)) {
            dx = -dx;
            dy = -dy;
          }
        } else {
          // All on one spot: fanned out from straight up, the last point (the higher one of a step) first.
          const angle = -Math.PI / 2 + ((group.length - 1 - rank) * 2 * Math.PI) / group.length;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
        }
        length = 1;
      }
      let x = spot.x + (dx / length) * distance;
      let y = spot.y + (dy / length) * distance;
      if (bounds) {
        x = Math.min(bounds.width - bounds.marginX, Math.max(bounds.marginX, x));
        y = Math.min(bounds.height - bounds.marginY, Math.max(bounds.marginY, y));
      }
      out.push({ index, group, x, y });
    });
  }
  return out;
}
