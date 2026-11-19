/**
 * The assumptions of the debt projection in the address: only those that differ from their
 * defaults, each as a letter and a number, joined by "~", and the official plan the projection
 * follows, if any, as "f" and the plan's id:
 *
 *   d=r5.1~g3~y40~p-0.07     market rate 5.1 %, growth 3 %, 40 years, drift -0.07 points a year
 *   d=g3~fgov_projection     growth 3 %, following the plan "gov_projection" in its years
 *
 * Every character is safe in a fragment, so the field needs no escaping. A value that is not a
 * number is ignored, one outside its range is clamped, and every value is put on its slider's
 * steps, so a link always reproduces a state the sliders can show. A plan the pack does not have,
 * or one that cannot be followed, is dropped (resolveDebtAssumptions). Links from before plans
 * could be followed have no "f" and follow none, as they did then.
 */
import { DEBT_ASSUMPTION_IDS, debtAssumptionParam, resolveDebtAssumptions } from "../engine/index.ts";
import type { DebtAssumptionId, DebtAssumptions, DebtFile } from "../engine/index.ts";

const LETTERS: Readonly<Record<DebtAssumptionId, string>> = { market_rate: "r", growth: "g", horizon: "y", drift: "p" };
const TOKEN = /^([a-z])(-?\d+(?:\.\d+)?)$/;
/** The plan the projection follows: "f" and an id of the pack's format (lower_snake_case). */
const FOLLOW = /^f([a-z0-9]+(?:_[a-z0-9]+)*)$/;

/** Number of decimals of a step: 0.1 -> 1, 0.01 -> 2, 1 -> 0. */
function decimals(step: number): number {
  for (let digits = 0; digits <= 6; digits++) {
    if (Math.abs(step * 10 ** digits - Math.round(step * 10 ** digits)) < 1e-9) return digits;
  }
  return 6;
}

/** A value on its param's steps, counted from the minimum, without floating-point dust. */
function onStep(debt: DebtFile, id: DebtAssumptionId, value: number): number {
  const param = debtAssumptionParam(debt, id);
  if (!(param.step > 0)) return value;
  const stepped = param.min + Math.round((value - param.min) / param.step) * param.step;
  return Number(stepped.toFixed(decimals(param.step)));
}

/** Whether two sets of assumptions are the same, up to floating-point dust, and follow the same plan (or none). */
export function sameDebtAssumptions(a: DebtAssumptions | undefined, b: DebtAssumptions | undefined): boolean {
  if (!a || !b) return a === b;
  return DEBT_ASSUMPTION_IDS.every((id) => Math.abs(a[id] - b[id]) < 1e-9) && (a.follow ?? null) === (b.follow ?? null);
}

/** The assumptions that differ from their defaults, for the address; "" if none does. */
export function encodeDebtAssumptions(debt: DebtFile, values: DebtAssumptions): string {
  const tokens: string[] = [];
  for (const id of DEBT_ASSUMPTION_IDS) {
    const value = values[id];
    if (!Number.isFinite(value) || Math.abs(value - debtAssumptionParam(debt, id).default) < 1e-9) continue;
    tokens.push(`${LETTERS[id]}${String(Number(value.toFixed(6)))}`);
  }
  if (values.follow !== undefined && FOLLOW.test(`f${values.follow}`)) tokens.push(`f${values.follow}`);
  return tokens.join("~");
}

/** The assumptions an address field describes: what it leaves out takes the default. */
export function decodeDebtAssumptions(debt: DebtFile, text: string | undefined): DebtAssumptions {
  const given: Partial<DebtAssumptions> = {};
  for (const token of (text ?? "").split("~")) {
    const follow = FOLLOW.exec(token);
    if (follow) {
      given.follow = follow[1];
      continue;
    }
    const match = TOKEN.exec(token);
    if (!match) continue;
    const id = DEBT_ASSUMPTION_IDS.find((candidate) => LETTERS[candidate] === match[1]);
    if (id) given[id] = Number(match[2]);
  }
  const resolved = resolveDebtAssumptions(debt, given);
  for (const id of DEBT_ASSUMPTION_IDS) resolved[id] = onStep(debt, id, resolved[id]);
  // Putting a value on its steps can carry it past an end of the range that is not a step itself.
  return resolveDebtAssumptions(debt, resolved);
}

/** The default assumptions of a pack. They follow no plan. */
export function defaultDebtAssumptions(debt: DebtFile): DebtAssumptions {
  return resolveDebtAssumptions(debt);
}
