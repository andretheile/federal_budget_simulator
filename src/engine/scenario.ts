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
 *   number   := ["-"] digits ["e" ["-"] digits]         integer mantissa and decimal exponent, so no "."
 *
 * Example: wealth_tax.rate.15e-1.threshold.2e6~halve_mp_pay~no_benefits.groups.non_eu-stateless~L.central
 *
 * Ids are lower_snake_case, so they never contain a separator, and "L" can never be a policy id.
 */
import { resolveParams, type ParamValue, type ParamValues, type Scenario } from "./simulate.ts";
import type { CountryPack, LevelId, Param } from "./types.ts";

const ITEM_SEPARATOR = "~";
const TOKEN_SEPARATOR = ".";
const GROUP_SEPARATOR = "-";
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

function encodeValue(value: ParamValue): string {
  if (typeof value === "number") return encodeNumber(value);
  const ids = value.filter((id) => TOKEN.test(id));
  return ids.length === 0 ? GROUP_SEPARATOR : ids.join(GROUP_SEPARATOR);
}

function sameValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sorted = [...b].sort();
    return [...a].sort().every((id, i) => id === sorted[i]);
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
    let values: ParamValues;
    if (pack && policy) {
      const resolved = resolveParams(pack, policy, state.params);
      const defaults = resolveParams(pack, policy);
      values = {};
      for (const param of policy.params) {
        if (!sameValue(resolved[param.id], defaults[param.id])) values[param.id] = resolved[param.id];
      }
    } else {
      values = state.params ?? {};
    }
    let item = id;
    for (const [paramId, value] of Object.entries(values)) {
      if (TOKEN.test(paramId)) item += TOKEN_SEPARATOR + paramId + TOKEN_SEPARATOR + encodeValue(value);
    }
    items.push(item);
  }
  if (scenario.level && scenario.level !== "all") items.push(LEVEL_MARKER + TOKEN_SEPARATOR + scenario.level);
  return items.join(ITEM_SEPARATOR);
}

function decodeValue(param: Param, text: string): ParamValue | undefined {
  if (param.type === "number") {
    const n = decodeNumber(text);
    return Number.isFinite(n) ? n : undefined;
  }
  return text.split(GROUP_SEPARATOR).filter((id) => id !== "");
}

/**
 * Decode a string written by encodeScenario against the current pack. Anything the pack does not
 * know (policy ids, param ids, group ids, levels) or cannot read is ignored, so links made for an
 * older version of the pack keep working. Values are normalised like in the simulation.
 */
export function decodeScenario(encoded: string, pack: CountryPack): Scenario {
  const scenario = emptyScenario();
  let text = encoded.trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    // Not percent-encoded in a way we can undo; read it as it is.
  }
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
    const given: ParamValues = {};
    for (let i = 1; i + 1 < tokens.length; i += 2) {
      const param = policy.params.find((candidate) => candidate.id === tokens[i]);
      if (!param) continue;
      const value = decodeValue(param, tokens[i + 1]);
      if (value !== undefined) given[param.id] = value;
    }
    const resolved = resolveParams(pack, policy, given);
    const params: ParamValues = {};
    for (const id of Object.keys(given)) params[id] = resolved[id];
    scenario.policies[policy.id] = Object.keys(params).length > 0 ? { enabled: true, params } : { enabled: true };
  }
  return scenario;
}
