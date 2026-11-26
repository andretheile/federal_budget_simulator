/**
 * What the section "Who pays", the strip on a measure's card and the line near the top show, from
 * the engine's whoPays: pure functions, so the components stay thin.
 *
 * The chart of a scope covers the part of its revenue that is spread over the income groups; the
 * rest of the scope is with payers outside them (companies, the state, ...), which the statement
 * of all revenue lists line by line.
 */
import type {
  CountryPack,
  IncidenceFile,
  IncidenceScope,
  LocalizedText,
  MeasureWhoPays,
  PolicyResult,
  WhoPays,
  WhoPaysLine,
  WhoPaysScope,
} from "../engine/index.ts";

/** Shares that differ by less than this are the same share: a twentieth of a percentage point. */
export const SHARE_NOISE = 0.0005;

/** The scope with this id, or the pack's first; undefined for a pack without incidence.json. */
export function scopeOf(pack: CountryPack, id?: string): IncidenceScope | undefined {
  const scopes = pack.incidence?.scopes;
  if (!scopes) return undefined;
  return scopes.find((scope) => scope.id === id) ?? scopes[0];
}

/** One income group in the chart of a scope. */
export interface ChartRow {
  id: string;
  label: LocalizedText;
  /** Lowest income of the group, in the ranking's concept and year (incidence.json population.year). */
  from?: number;
  shareToday: number;
  shareReform: number;
  /** shareReform - shareToday, as a fraction (0.006 is 0.6 points). */
  change: number;
  incomeShare: number;
  today: number;
  reform: number;
  delta: number;
  deltaPerUnit: number;
  rateToday?: number;
  rateReform?: number;
}

export interface Chart {
  scope: IncidenceScope;
  result: WhoPaysScope;
  rows: ChartRow[];
  /** The right end of the common scale of bars and marks: the largest share, rounded up to a tenth. */
  max: number;
  /** Whether the measures moved any group's share by more than SHARE_NOISE. */
  changed: boolean;
}

export function chartOf(pack: CountryPack, who: WhoPays, scopeId?: string): Chart | undefined {
  const scope = scopeOf(pack, scopeId);
  const file = pack.incidence;
  const result = scope && who.scopes.find((entry) => entry.id === scope.id);
  if (!scope || !file || !result) return undefined;
  const rows = result.groups.map((group, g): ChartRow => {
    const row: ChartRow = {
      id: group.id,
      label: file.groups[g].label,
      shareToday: group.shareToday,
      shareReform: group.shareReform,
      change: group.shareReform - group.shareToday,
      incomeShare: group.incomeShare,
      today: group.today,
      reform: group.reform,
      delta: group.delta,
      deltaPerUnit: group.deltaPerUnit,
    };
    if (file.groups[g].from !== undefined) row.from = file.groups[g].from;
    if (group.rateToday !== undefined) row.rateToday = group.rateToday;
    if (group.rateReform !== undefined) row.rateReform = group.rateReform;
    return row;
  });
  const largest = Math.max(...rows.flatMap((row) => [row.shareToday, row.shareReform, row.incomeShare]), 0.1);
  return {
    scope,
    result,
    rows,
    max: Math.min(1, Math.ceil(largest * 10 - 1e-9) / 10),
    changed: rows.some((row) => Math.abs(row.change) > SHARE_NOISE),
  };
}

/** The group whose share moved most, for the line near the top. Undefined if none moved. */
export function largestChange(chart: Chart): ChartRow | undefined {
  if (!chart.changed) return undefined;
  return chart.rows.reduce((a, b) => (Math.abs(b.change) > Math.abs(a.change) ? b : a));
}

/** A payer's change, by id, with its label. */
export interface PayerChange {
  id: string;
  label: LocalizedText;
  change: number;
}

/** What one measure changes for whom, for its card and the curve editor. */
export interface Strip {
  /** Per group in group order: the change in all and per unit of the population. */
  groups: { id: string; label: LocalizedText; change: number; perUnit: number }[];
  /** Payers outside the groups whose amount changes, in the order of incidence.json. */
  payers: PayerChange[];
  /** The largest change per unit, either way: the scale of the strip's columns. */
  maxPerUnit: number;
  /** Whether any group's amount changes. */
  spread: boolean;
  /** The pack's sentences on who pays the parts that are not spread (incidenceNote), each once. */
  notes: LocalizedText[];
}

function payerChanges(file: IncidenceFile, payers: Record<string, number>, noise: number): PayerChange[] {
  return (file.payers ?? []).flatMap((payer) => {
    const change = payers[payer.id] ?? 0;
    return Math.abs(change) > noise ? [{ id: payer.id, label: payer.label, change }] : [];
  });
}

/**
 * A measure's own change by group, over all revenue, from its result for the whole budget, and its
 * sentences on who pays what is not spread. Undefined for a pack without incidence.json, or for a
 * measure that changes no revenue (changes of spending are never counted), unless `always`: then a
 * strip of zeros, with every sentence of the measure, for a place that must not change its height.
 */
export function stripOf(
  pack: CountryPack,
  measure: MeasureWhoPays | undefined,
  result: PolicyResult,
  noise: number,
  always = false,
): Strip | undefined {
  const file = pack.incidence;
  if (!file || !measure) return undefined;
  const count = file.population.count;
  const groups = file.groups.map((group, g) => {
    const change = Math.abs(measure.groups[g]) > noise ? measure.groups[g] : 0;
    return { id: group.id, label: group.label, change, perUnit: change / (count * group.share) };
  });
  const payers = payerChanges(file, measure.payers, noise);
  const spread = groups.some((group) => group.change !== 0);
  if (!spread && payers.length === 0 && !always) return undefined;
  return {
    groups,
    payers,
    maxPerUnit: Math.max(...groups.map((group) => Math.abs(group.perUnit)), 0),
    spread,
    notes: notesOf(pack, result, noise, always),
  };
}

/**
 * A measure's sentences on who pays (incidenceNote), each once: of every effect and shift whose
 * change at a revenue node is more than noise, or of all of them with `always`. With a scope, only
 * those whose node lies in it, so that the list under a scope's chart says nothing about a part the
 * chart does not show; the card and the curve editor, which show all revenue, give none.
 */
export function notesOf(pack: CountryPack, result: PolicyResult, noise: number, always = false, scopeId?: string): LocalizedText[] {
  const scope = scopeId === undefined ? undefined : scopeOf(pack, scopeId);
  const inside = (node: string | undefined): boolean =>
    node !== undefined && (!scope || scope.nodes.some((root) => node === root || node.startsWith(`${root}.`)));
  const policy = pack.policies.find((entry) => entry.id === result.id);
  const notes: LocalizedText[] = [];
  const seen = new Set<string>();
  for (const effect of result.effects) {
    const definition = policy?.effects[effect.index];
    const candidates: [LocalizedText | undefined, boolean, string | undefined][] = [
      [definition?.incidenceNote, always || (effect.side === "revenue" && Math.abs(effect.delta) > noise), effect.target],
      [definition?.shift?.incidenceNote, always || (effect.shift?.side === "revenue" && Math.abs(effect.shift.delta) > noise), effect.shift?.target],
    ];
    for (const [note, changed, node] of candidates) {
      if (!note || !changed || !inside(node)) continue;
      const key = JSON.stringify(note);
      if (!seen.has(key)) notes.push(note);
      seen.add(key);
    }
  }
  return notes;
}

/**
 * Whether a measure's change of revenue is spread over the income groups, at least in part: some
 * effect or shift on a revenue node names no payer of its own and lands on a node whose entry has a
 * profile, or names a profile. The curve editor keeps its table of the groups for such a measure.
 */
export function spreadable(pack: CountryPack, policyId: string): boolean {
  const file = pack.incidence;
  const policy = pack.policies.find((entry) => entry.id === policyId);
  if (!file || !policy) return false;
  const payers = new Set((file.payers ?? []).map((payer) => payer.id));
  const entryOf = (node: string): { profile?: string } | undefined => {
    for (let id = node; id.includes("."); id = id.slice(0, id.lastIndexOf("."))) if (Object.hasOwn(file.nodes, id)) return file.nodes[id];
    return undefined;
  };
  const spreads = (node: string | undefined, incidence: string | undefined): boolean =>
    node !== undefined && node.startsWith("rev.") && (incidence !== undefined ? !payers.has(incidence) : entryOf(node)?.profile !== undefined);
  return policy.effects.some(
    (effect) =>
      spreads(effect.target, effect.incidence) ||
      spreads(effect.shift?.to, effect.shift?.incidence) ||
      (effect.type === "schedule" && effect.incidenceAbove !== undefined && spreads(effect.target, effect.incidenceAbove.incidence)),
  );
}

/** Under the chart of a scope: the enabled measures that change it, spread over the groups or with payers. */
export interface MeasureList {
  /** Measures whose change in the scope is spread over the groups, at least in part. */
  counted: string[];
  /** Measures whose change in the scope lands, at least in part, with payers outside the groups. */
  outside: { policy: string; payers: PayerChange[] }[];
}

export function measuresOf(pack: CountryPack, who: WhoPays, scopeId: string, noise: number): MeasureList {
  const file = pack.incidence;
  const out: MeasureList = { counted: [], outside: [] };
  if (!file) return out;
  for (const measure of who.measures) {
    const scope = measure.scopes[scopeId];
    if (!scope) continue;
    if (scope.groups.some((change) => Math.abs(change) > noise)) out.counted.push(measure.policy);
    const payers = payerChanges(file, scope.payers, noise);
    if (payers.length > 0) out.outside.push({ policy: measure.policy, payers });
  }
  return out;
}

/** A line of the statement of all revenue, with its label and whether the chart covers part of it. */
export interface StatementLine extends WhoPaysLine {
  label?: LocalizedText;
  note?: LocalizedText;
}

export function statementOf(pack: CountryPack, who: WhoPays): StatementLine[] {
  const payers = pack.incidence?.payers ?? [];
  return who.statement.lines
    .filter((line) => line.payer === undefined || line.today !== 0 || line.reform !== 0)
    .map((line) => {
      const payer = payers.find((entry) => entry.id === line.payer);
      return payer ? { ...line, label: payer.label, ...(payer.note ? { note: payer.note } : {}) } : line;
    });
}

/**
 * The sources behind a scope's chart: of the population and the income shares, and of every
 * profile that spreads a node of the scope. A measure's own profile is cited on its card.
 */
export function sourcesOf(pack: CountryPack, scopeId: string): string[] {
  const file = pack.incidence;
  const scope = scopeOf(pack, scopeId);
  if (!file || !scope) return [];
  const ids = new Set<string>([...file.population.sources, ...file.income.sources]);
  const inside = (node: string): boolean => scope.nodes.some((root) => node === root || node.startsWith(`${root}.`));
  for (const [node, entry] of Object.entries(file.nodes)) {
    if (entry.profile && inside(node)) for (const id of file.profiles[entry.profile]?.sources ?? []) ids.add(id);
  }
  return [...ids];
}
