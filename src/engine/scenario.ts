/**
 * Scenario <-> URL string.
 *
 * The string uses only RFC 3986 "unreserved" characters (a-z, 0-9, "_", "-", ".", "~" and the
 * upper-case marker "L"), so it can go into a query string or a fragment as it is.
 *
 *   scenario := item ("~" item)*
 *   item     := policyId ("." paramId "." value)*      an enabled policy and its non-default params
 *             | "L." levelId                            the level filter
 *   value    := number                                  for number params
 *             | groupId ("-" groupId)*  |  "-"          for groups params; "-" alone is the empty selection
 *             | number ("_" number)*    |  "_"          for curve params: x_y_x_y..., "_" alone is no points
 *   number   := ["-"] digits ["e" ["-"] digits]         integer mantissa and decimal exponent, so no "."
 *
 * Example: wealth_tax.rate.15e-1.threshold.2e6~halve_mp_pay~no_benefits.groups.non_eu-stateless~L.central
 * A curve: income_tax.tariff.12096_14_68480_42_277826_42_277826_45
 *
 * Ids are lower_snake_case, so they never contain a separator, and "L" can never be a policy id.
 * Numbers may contain "-" (sign, exponent), which is why the coordinates of a curve are joined
 * with "_" and not with the "-" that joins group ids.
 */
import { resolveCurve, resolveParams, type ParamValue, type ParamValues, type Scenario } from "./simulate.ts";
import type { CountryPack, CurvePoint, LevelId, Param, Policy } from "./types.ts";

const ITEM_SEPARATOR = "~";
const TOKEN_SEPARATOR = ".";
const GROUP_SEPARATOR = "-";
const POINT_SEPARATOR = "_";
const LEVEL_MARKER = "L";
const TOKEN = /^[a-z0-9_]+$/;
const NUMBER = /^-?\d+(?:e-?\d+)?$/;

/** A scenario with nothing switched on. */
export function emptyScenario(): Scenario {
  return { policies: {} };
}

/**
 * Shortest exact notation without a decimal point: 1.5 -> "15e-1", 2000000 -> "2e6", 42 -> "42".
 * Number() turns it back into the same double.
 */
export function encodeNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  const [mantissa, exponent] = Math.abs(n).toExponential().split("e");
  const point = mantissa.indexOf(".");
  const digits = mantissa.replace(".", "");
  const power = Number(exponent) - (point < 0 ? 0 : mantissa.length - point - 1);
  let body: string;
  if (power === 0) body = digits;
  else if (power > 0 && power <= 2) body = digits + "0".repeat(power);
  else body = `${digits}e${power}`;
  return (n < 0 ? "-" : "") + body;
}

/** Inverse of encodeNumber. NaN if the text is not in that notation. */
export function decodeNumber(text: string): number {
  return NUMBER.test(text) ? Number(text) : NaN;
}

/** A list of curve points, as opposed to a list of group ids. An empty list counts as group ids. */
function isCurve(value: string[] | CurvePoint[]): value is CurvePoint[] {
  return value.length > 0 && typeof value[0] === "object";
}

/** x_y_x_y...: every coordinate in the dot-free number notation. */
function encodeCurve(points: readonly CurvePoint[]): string {
  if (points.length === 0) return POINT_SEPARATOR;
  let text = "";
  for (const point of points) {
    if (text !== "") text += POINT_SEPARATOR;
    text += encodeNumber(point.x) + POINT_SEPARATOR + encodeNumber(point.y);
  }
  return text;
}

/** Inverse of encodeCurve. Undefined if the text is not a list of coordinate pairs. */
function decodeCurve(text: string): CurvePoint[] | undefined {
  if (text === POINT_SEPARATOR) return [];
  const numbers = text.split(POINT_SEPARATOR);
  const points: CurvePoint[] = [];
  for (let i = 0; i < numbers.length; i += 2) {
    const x = decodeNumber(numbers[i]);
    // An odd number of coordinates leaves the last y missing, which is not a number either.
    const y = decodeNumber(numbers[i + 1] ?? "");
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    points.push({ x, y });
  }
  return points;
}

function encodeValue(value: ParamValue): string {
  if (typeof value === "number") return encodeNumber(value);
  if (isCurve(value)) return encodeCurve(value);
  const ids = value.filter((id) => TOKEN.test(id));
  return ids.length === 0 ? GROUP_SEPARATOR : ids.join(GROUP_SEPARATOR);
}

function sameValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (isCurve(a) || isCurve(b)) {
      // Curves: the same points in the same order.
      const p = a as CurvePoint[];
      const q = b as CurvePoint[];
      return isCurve(a) && isCurve(b) && p.every((point, i) => point.x === q[i].x && point.y === q[i].y);
    }
    const sorted = [...(b as string[])].sort();
    return [...(a as string[])].sort().every((id, i) => id === sorted[i]);
  }
  return a === b;
}

/**
 * Encode a scenario as a compact URL-safe string. Only enabled policies are written.
 *
 * With `pack`, params that equal their default are left out, values are normalised the way the
 * simulation would (clamped, unknown groups dropped) and policies appear in pack order, so equal
 * scenarios give equal strings. Without `pack` the defaults are unknown, so every param present
 * in the scenario is written.
 */
export function encodeScenario(scenario: Scenario, pack?: CountryPack): string {
  const items: string[] = [];
  const ids = pack ? pack.policies.map((policy) => policy.id) : Object.keys(scenario.policies);
  for (const id of ids) {
    const state = scenario.policies[id];
    if (!state || !state.enabled || !TOKEN.test(id)) continue;
    const policy = pack?.policies.find((candidate) => candidate.id === id);
    let item = id;
    if (pack && policy) {
      const resolved = resolveParams(pack, policy, state.params);
      const defaults = resolveParams(pack, policy);
      for (const param of policy.params) {
        const value = resolved[param.id];
        if (sameValue(value, defaults[param.id]) || !TOKEN.test(param.id)) continue;
        // The param's type decides the notation, so that a curve without points stays a curve.
        const text = param.type === "curve" ? encodeCurve(value as CurvePoint[]) : encodeValue(value);
        item += TOKEN_SEPARATOR + param.id + TOKEN_SEPARATOR + text;
      }
    } else {
      for (const [paramId, value] of Object.entries(state.params ?? {})) {
        if (TOKEN.test(paramId)) item += TOKEN_SEPARATOR + paramId + TOKEN_SEPARATOR + encodeValue(value);
      }
    }
    items.push(item);
  }
  if (scenario.level && scenario.level !== "all") items.push(LEVEL_MARKER + TOKEN_SEPARATOR + scenario.level);
  return items.join(ITEM_SEPARATOR);
}

/**
 * The value of one token, or undefined if the pack cannot use it: a number that is not one, a curve
 * that is not a list of points or has a number of points the param does not allow, a group
 * selection whose ids are all unknown (the empty selection, written "-", is a value). Undefined
 * means the token is ignored and leaves whatever an earlier token set.
 */
function decodeValue(pack: CountryPack, policy: Policy, param: Param, text: string): ParamValue | undefined {
  if (param.type === "number") {
    const n = decodeNumber(text);
    return Number.isFinite(n) ? n : undefined;
  }
  if (param.type === "curve") {
    const points = decodeCurve(text);
    // resolveCurve falls back to the default object itself for a list it cannot use.
    return points === undefined || resolveCurve(param, points) === param.default ? undefined : points;
  }
  const ids = text.split(GROUP_SEPARATOR).filter((id) => id !== "");
  if (ids.length === 0) return ids;
  const known = resolveParams(pack, policy, { [param.id]: ids })[param.id];
  return Array.isArray(known) && known.length > 0 ? ids : undefined;
}

/**
 * Decode a string written by encodeScenario against the current pack. Anything the pack does not
 * know (policy ids, param ids, group ids, levels) or cannot read is ignored, so links made for an
 * older version of the pack keep working. Values are normalised like in the simulation.
 *
 * Items for the same policy add up: a policy is on if any item names it, and each param takes the
 * last value in the string that can be read, whichever item it is in. A token that cannot be read
 * leaves what an earlier one set. encodeScenario writes each policy once, but a link may have been
 * edited by hand or written for an older pack.
 */
export function decodeScenario(encoded: string, pack: CountryPack): Scenario {
  const scenario = emptyScenario();
  let text = encoded.trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    // Not percent-encoded in a way we can undo; read it as it is.
  }
  /** What the items set, per policy, in the order the policies first appear. */
  const read = new Map<Policy, ParamValues>();
  for (const item of text.split(ITEM_SEPARATOR)) {
    const tokens = item.split(TOKEN_SEPARATOR);
    const head = tokens[0];
    if (head === LEVEL_MARKER) {
      const level = tokens[1];
      if (level !== undefined && Object.hasOwn(pack.country.levels, level)) scenario.level = level as LevelId;
      continue;
    }
    const policy = pack.policies.find((candidate) => candidate.id === head);
    if (!policy) continue;
    let given = read.get(policy);
    if (!given) read.set(policy, (given = {}));
    for (let i = 1; i + 1 < tokens.length; i += 2) {
      const param = policy.params.find((candidate) => candidate.id === tokens[i]);
      if (!param) continue;
      const value = decodeValue(pack, policy, param, tokens[i + 1]);
      if (value !== undefined) given[param.id] = value;
    }
  }
  for (const [policy, given] of read) {
    const resolved = resolveParams(pack, policy, given);
    const params: ParamValues = {};
    for (const param of policy.params) {
      if (!Object.hasOwn(given, param.id)) continue;
      // A curve that falls back to the default (wrong number of points) is left out like any other
      // value that cannot be read, instead of being pinned to today's default. decodeValue already
      // drops such a token; this guards the rule here as well.
      if (param.type === "curve" && resolved[param.id] === param.default) continue;
      params[param.id] = resolved[param.id];
    }
    scenario.policies[policy.id] = Object.keys(params).length > 0 ? { enabled: true, params } : { enabled: true };
  }
  return scenario;
}
