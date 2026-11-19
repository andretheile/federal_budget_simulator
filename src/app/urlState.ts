/**
 * What a link remembers, kept in the fragment of the URL so nothing is sent to the server:
 *
 *   #c=de&lang=de&s=wealth_tax.rate.15e-1~mp_pay_cut~L.central&e=income_tax_schedule.schedule
 *
 *   c     country pack id (only written when the site has more than one pack)
 *   lang  language of the interface
 *   s     the scenario in the engine's own encoding (see engine/scenario.ts)
 *   d     assumptions of the debt projection that differ from their defaults (see app/debtLink.ts)
 *   e     the curve editor that is open: measure id and curve parameter id, joined by a dot
 *   p     a legal page that replaces the simulator: "imprint" or "privacy"; while it is set, e is ignored
 *
 * The scenario string only contains characters that are safe in a fragment, so the hash is
 * written by hand; URLSearchParams would percent-encode the "~".
 */
import { decodeScenario, emptyScenario, encodeScenario, type CountryPack, type DebtAssumptions, type Scenario } from "../engine/index.ts";
import { decodeDebtAssumptions, encodeDebtAssumptions } from "./debtLink.ts";
import { LEGAL_PAGES, type LegalPage } from "../site/config.ts";

export interface HashFields {
  country?: string;
  language?: string;
  /** Encoded scenario; "" or missing means nothing is switched on. */
  scenario?: string;
  /** Debt projection assumptions that differ from their defaults, e.g. "r5.1~y40". */
  debt?: string;
  /** The open curve editor as "measure.param". */
  editor?: string;
  /** The legal page that is shown instead of the simulator. */
  page?: LegalPage;
}

const KEYS = { country: "c", language: "lang", scenario: "s", debt: "d", editor: "e", page: "p" } as const;
const isLegalPage = (value: string): value is LegalPage => (LEGAL_PAGES as readonly string[]).includes(value);
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,35}$/;
const EDITOR = /^[a-z0-9_]{1,80}\.[a-z0-9_]{1,80}$/;
const DEBT = /^[a-z0-9.~-]{1,80}$/;

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Read the fragment of a URL ("#lang=de&s=..." or without the "#"). Unknown keys are ignored. */
export function parseHash(hash: string): HashFields {
  const out: HashFields = {};
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const pair of text.split("&")) {
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const key = pair.slice(0, at);
    const value = safeDecode(pair.slice(at + 1));
    if (key === KEYS.country && SAFE_TOKEN.test(value)) out.country = value.toLowerCase();
    else if (key === KEYS.language && SAFE_TOKEN.test(value)) out.language = value;
    else if (key === KEYS.scenario) out.scenario = value;
    else if (key === KEYS.debt && DEBT.test(value)) out.debt = value;
    else if (key === KEYS.editor && EDITOR.test(value)) out.editor = value;
    else if (key === KEYS.page && isLegalPage(value)) out.page = value;
  }
  return out;
}

/** The fragment for the given fields, with the leading "#"; "" if there is nothing to write. */
export function buildHash(fields: HashFields): string {
  const pairs: string[] = [];
  if (fields.country) pairs.push(`${KEYS.country}=${fields.country}`);
  if (fields.language) pairs.push(`${KEYS.language}=${fields.language}`);
  if (fields.scenario) pairs.push(`${KEYS.scenario}=${fields.scenario}`);
  if (fields.debt) pairs.push(`${KEYS.debt}=${fields.debt}`);
  if (fields.editor) pairs.push(`${KEYS.editor}=${fields.editor}`);
  if (fields.page) pairs.push(`${KEYS.page}=${fields.page}`);
  return pairs.length > 0 ? `#${pairs.join("&")}` : "";
}

export interface LinkState {
  scenario: Scenario;
  /** Assumptions of the debt projection; only those that differ from their defaults are written. */
  debt?: DebtAssumptions;
  language: string;
  /** Only needed when the site offers several countries. */
  country?: string;
  /** The open curve editor. */
  editor?: { policy: string; param: string };
  /** The legal page shown instead of the simulator; the editor is not written while it is set. */
  page?: LegalPage;
}

/** The fragment that reproduces a state. Equal scenarios give equal fragments. */
export function stateToHash(state: LinkState, pack: CountryPack): string {
  return buildHash({
    country: state.country,
    language: state.language,
    scenario: encodeScenario(state.scenario, pack),
    debt: state.debt && pack.debt ? encodeDebtAssumptions(pack.debt, state.debt) : undefined,
    editor: state.editor && !state.page ? `${state.editor.policy}.${state.editor.param}` : undefined,
    page: state.page,
  });
}

/**
 * The curve editor a fragment asks for, if the pack has that measure and it has that curve
 * parameter; anything else is ignored like an unknown measure. None while a legal page is asked for.
 */
export function editorFromHash(hash: string, pack: CountryPack): { policy: string; param: string } | undefined {
  const { editor: field, page } = parseHash(hash);
  if (!field || page) return undefined;
  const [policyId, paramId] = field.split(".");
  const policy = pack.policies.find((candidate) => candidate.id === policyId);
  const param = policy?.params.find((candidate) => candidate.id === paramId);
  return policy && param?.type === "curve" ? { policy: policyId, param: paramId } : undefined;
}

/** The assumptions of the debt projection a fragment describes; undefined for a pack without debt data. */
export function debtFromHash(hash: string, pack: CountryPack): DebtAssumptions | undefined {
  return pack.debt ? decodeDebtAssumptions(pack.debt, parseHash(hash).debt) : undefined;
}

/** The scenario a fragment describes for this pack; whatever the pack does not know is dropped. */
export function scenarioFromHash(hash: string, pack: CountryPack): Scenario {
  const encoded = parseHash(hash).scenario;
  return encoded ? decodeScenario(encoded, pack) : emptyScenario();
}

/** True if both scenarios lead to the same simulation. */
export function sameScenario(a: Scenario, b: Scenario, pack: CountryPack): boolean {
  return encodeScenario(a, pack) === encodeScenario(b, pack);
}
