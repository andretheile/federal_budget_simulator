/**
 * The application: loads a country pack, keeps the scenario and the language (both mirrored in
 * the URL), runs the simulation on every change and lays out the sections.
 *
 * Nothing in here or below knows a particular country. Which pack is shown comes from the URL,
 * from VITE_DEFAULT_COUNTRY, or is simply the first pack in /countries.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { defaultSelection, layoutBudget, sameSelection, selectionShowing, type Selection } from "./app/budgetModel.ts";
import { createUi, UiContext } from "./app/ui.ts";
import { parseHash, sameScenario, scenarioFromHash, stateToHash } from "./app/urlState.ts";
import { About } from "./components/About.tsx";
import { BudgetView } from "./components/BudgetView.tsx";
import { Header } from "./components/Header.tsx";
import { WarningIcon } from "./components/icons.tsx";
import { PolicyList } from "./components/PolicyList.tsx";
import { Scoreboard } from "./components/Scoreboard.tsx";
import { Waterfall } from "./components/Waterfall.tsx";
import {
  emptyScenario,
  encodeScenario,
  formatIssue,
  simulate,
  type CountryPack,
  type LevelFilter,
  type ParamValue,
  type Scenario,
  type ValidationIssue,
} from "./engine/index.ts";
import { useMediaQuery } from "./hooks/useMediaQuery.ts";
import { languagesOf, messagesFor, pickLanguage } from "./i18n/index.ts";
import { listPackIds, loadPack } from "./packs.ts";

const LANGUAGE_KEY = "budget-simulator:language";

/** Why the page shows the test fixture instead of a real country. */
export interface Fallback {
  /** "invalid": the wanted pack did not validate. "missing": there is no pack. "requested": asked for with ?fixture. */
  reason: "invalid" | "missing" | "requested";
  /** The pack that was wanted, if any. */
  packId?: string;
  errors: ValidationIssue[];
}

interface Loaded {
  pack: CountryPack;
  fallback?: Fallback;
}

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

function storedLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

function initialCountry(ids: readonly string[]): string | undefined {
  const fromUrl = parseHash(currentHash()).country;
  if (fromUrl && ids.includes(fromUrl)) return fromUrl;
  const configured: unknown = import.meta.env?.VITE_DEFAULT_COUNTRY;
  if (typeof configured === "string" && ids.includes(configured)) return configured;
  return ids[0];
}

/** In development, "?fixture" in the address shows the test fixture on purpose, to check the fallback. */
function fixtureRequested(): boolean {
  return (
    import.meta.env?.DEV === true &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("fixture")
  );
}

async function load(id: string | undefined): Promise<Loaded> {
  const requested = fixtureRequested();
  const result = id === undefined || requested ? undefined : await loadPack(id);
  if (result?.ok) return { pack: result.pack };
  // Development fallback: a made-up country, announced by a notice nobody can miss.
  const { testland } = await import("./engine/__fixtures__/testland.ts");
  const reason = requested ? "requested" : result ? "invalid" : "missing";
  return { pack: testland, fallback: { reason, packId: id, errors: result && !result.ok ? result.errors : [] } };
}

export function App() {
  const ids = useMemo(() => listPackIds(), []);
  const [country, setCountry] = useState(() => initialCountry(ids));
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load(country).then((value) => {
      if (!cancelled) setLoaded(value);
    });
    return () => {
      cancelled = true;
    };
  }, [country]);

  if (!loaded) {
    return (
      <p className="loading" role="status">
        {messagesFor(browserLanguages()[0] ?? "en").app.loading}
      </p>
    );
  }
  return (
    <Simulator
      key={`${loaded.pack.country.id}:${loaded.fallback ? "fallback" : "pack"}`}
      pack={loaded.pack}
      fallback={loaded.fallback}
      countries={ids}
      onCountry={setCountry}
    />
  );
}

export interface SimulatorProps {
  pack: CountryPack;
  fallback?: Fallback;
  countries?: readonly string[];
  onCountry?(id: string): void;
}

export function Simulator({ pack, fallback, countries = [], onCountry }: SimulatorProps) {
  const languages = useMemo(() => languagesOf(pack.country.locales), [pack]);
  const [language, setLanguage] = useState(() =>
    pickLanguage(pack.country.locales, {
      url: parseHash(currentHash()).language,
      stored: storedLanguage(),
      browser: browserLanguages(),
    }),
  );
  const [scenario, setScenario] = useState<Scenario>(() => scenarioFromHash(currentHash(), pack));
  const ui = useMemo(() => createUi(pack, language), [pack, language]);
  const { t } = ui;
  const result = useMemo(() => simulate(pack, scenario), [pack, scenario]);
  const layout = useMemo(() => layoutBudget(pack), [pack]);

  const [selection, setSelection] = useState<Selection>(() => defaultSelection(pack, layout));
  const [highlight, setHighlight] = useState<string>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [reveal, setReveal] = useState<{ id: string; nonce: number }>();
  const phone = useMediaQuery("(max-width: 719px)");

  // --- the URL mirrors scenario and language ---------------------------------------------------
  const showsCountry = !fallback && countries.length > 1;
  const hash = stateToHash({ scenario, language, country: showsCountry ? pack.country.id : undefined }, pack);
  const hashRef = useRef(hash);
  hashRef.current = hash;
  const initialHash = useRef(hash);
  // A bare address stays bare until the visitor changes something; a link is kept in sync from the start.
  const dirty = useRef(currentHash() !== "");
  useEffect(() => {
    if (!dirty.current && hash === initialHash.current) return;
    dirty.current = true;
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, "", hash);
  }, [hash]);

  useEffect(() => {
    const onHashChange = (): void => {
      const fields = parseHash(window.location.hash);
      // Not one of ours (an in-page anchor, say): put the state back and leave it at that.
      if (fields.country === undefined && fields.language === undefined && fields.scenario === undefined) {
        if (window.location.hash !== "" && dirty.current)
          window.history.replaceState(window.history.state, "", hashRef.current);
        return;
      }
      if (fields.country && fields.country !== pack.country.id && countries.includes(fields.country)) {
        onCountry?.(fields.country);
        return;
      }
      const next = scenarioFromHash(window.location.hash, pack);
      setScenario((current) => (sameScenario(current, next, pack) ? current : next));
      if (fields.language) setLanguage(pickLanguage(pack.country.locales, { url: fields.language }));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pack, countries, onCountry]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t.app.title(ui.text(pack.country.name), pack.country.baseYear);
  }, [language, t, ui, pack]);

  // --- what the visitor can do -----------------------------------------------------------------
  const onToggle = useCallback((id: string, enabled: boolean) => {
    setScenario((current) => ({
      ...current,
      policies: { ...current.policies, [id]: { ...current.policies[id], enabled } },
    }));
  }, []);

  const onParam = useCallback((id: string, param: string, value: ParamValue) => {
    setScenario((current) => {
      const previous = current.policies[id] ?? { enabled: false };
      return {
        ...current,
        policies: { ...current.policies, [id]: { ...previous, params: { ...previous.params, [param]: value } } },
      };
    });
  }, []);

  const onLevel = useCallback((level: LevelFilter) => {
    setScenario((current) => ({ ...current, level }));
  }, []);

  const onReset = useCallback(() => setScenario(emptyScenario()), []);

  const onLanguage = useCallback((next: string) => {
    setLanguage(next);
    // Remember an explicit choice, and nothing else, on this device. No cookie is involved.
    try {
      window.localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // Storage is unavailable (private mode, blocked): the link still carries the language.
    }
    dirty.current = true;
  }, []);

  const onShare = useCallback(async (): Promise<boolean> => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${hashRef.current}`;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return copyWithSelection(url);
    }
  }, []);

  const onExpand = useCallback((id: string, open: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  const resultRef = useRef(result);
  resultRef.current = result;
  const onShowNode = useCallback(
    (nodeId: string) => {
      const next = selectionShowing(layout, resultRef.current, nodeId);
      if (!next) return;
      setSelection((current) => (sameSelection(current, next) ? current : next));
      setHighlight(nodeId);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlight(undefined), 2600);
    },
    [layout],
  );

  const onSelect = useCallback((next: Selection) => {
    setHighlight(undefined);
    setSelection(next);
  }, []);

  const onShowPolicy = useCallback(
    (id: string) => {
      onExpand(id, true);
      setReveal((current) => ({ id, nonce: (current?.nonce ?? 0) + 1 }));
    },
    [onExpand],
  );

  // Anything to undo: a measure switched on, a setting moved (also on a measure that is off), or a level chosen.
  const canReset = encodeScenario(scenario, pack) !== "" || Object.keys(scenario.policies).length > 0;

  const budget = (
    <BudgetView key="budget" result={result} selection={selection} onSelect={onSelect} highlight={highlight} />
  );
  const policies = (
    <PolicyList
      key="policies"
      scenario={scenario}
      result={result}
      expanded={expanded}
      reveal={reveal}
      onToggle={onToggle}
      onParam={onParam}
      onExpand={onExpand}
      onShowNode={onShowNode}
    />
  );

  return (
    <UiContext value={ui}>
      <a className="skip-link" href="#main" onClick={(event) => jumpTo(event, "main")}>
        {t.app.skipToContent}
      </a>
      {fallback && (
        <aside className="dev-notice" role="note">
          <div className="page">
            <p>
              <WarningIcon size={15} />
              <strong>{t.dev.badge}.</strong>{" "}
              {fallback.reason === "invalid" && fallback.packId
                ? `${t.dev.invalid(fallback.packId)} `
                : fallback.reason === "missing"
                  ? `${t.dev.noPack} `
                  : ""}
              {t.dev.fixture}
            </p>
            {fallback.errors.length > 0 && (
              <details>
                <summary>{t.dev.errors(fallback.errors.length)}</summary>
                <ul>
                  {fallback.errors.slice(0, 30).map((issue, index) => (
                    <li key={index}>{formatIssue(issue)}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </aside>
      )}
      <Header
        level={result.level}
        onLevel={onLevel}
        languages={languages}
        onLanguage={onLanguage}
        onShare={onShare}
        onReset={onReset}
        canReset={canReset}
        countries={fallback ? [] : countries}
        onCountry={onCountry}
      />
      <Scoreboard result={result} />
      <main id="main" className="page" tabIndex={-1}>
        {/* On a phone the measures come first: they are what the visitor acts on. The order in the
            document follows the order on screen, so keyboard and screen reader agree with the eye. */}
        <div className="workspace">{phone ? [policies, budget] : [budget, policies]}</div>
        <Waterfall result={result} onShowPolicy={onShowPolicy} />
        <About />
      </main>
      <footer className="footer">
        <div className="page">
          <p>{t.about.licence}</p>
          <p>
            <a href="#about" onClick={(event) => jumpTo(event, "about")}>
              {t.about.title}
            </a>
          </p>
        </div>
      </footer>
    </UiContext>
  );
}

/**
 * Follow an in-page link without touching the fragment of the URL, which holds the scenario.
 */
function jumpTo(event: MouseEvent<HTMLAnchorElement>, id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView?.({ block: "start" });
  target.focus?.({ preventScroll: true });
}

/** Copy for browsers without the asynchronous clipboard (or without permission to use it). */
function copyWithSelection(text: string): boolean {
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}
