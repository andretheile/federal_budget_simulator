/**
 * The application: loads a country pack, keeps the scenario and the language (both mirrored in
 * the URL), runs the simulation on every change and lays out the sections.
 *
 * Nothing in here or below knows a particular country. Which pack is shown comes from the URL,
 * from VITE_DEFAULT_COUNTRY, or is simply the first pack in /countries.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { defaultSelection, layoutBudget, sameSelection, selectionShowing, type Selection } from "./app/budgetModel.ts";
import { addressWriter, type AddressWriter } from "./app/addressWriter.ts";
import { createUi, UiContext } from "./app/ui.ts";
import {
  collectionFromHash,
  debtFromHash,
  editorFromHash,
  goalFromHash,
  parseHash,
  sameScenario,
  scenarioFromHash,
  stateToHash,
} from "./app/urlState.ts";
import { chosenGoal } from "./app/goalModel.ts";
import { sameDebtAssumptions } from "./app/debtLink.ts";
import { useDebtView } from "./app/debtModel.ts";
import { useLegalPage } from "./app/legalPage.ts";
import { About } from "./components/About.tsx";
import { BudgetView } from "./components/BudgetView.tsx";
import { DebtSection, DebtTeaser, preloadDebt } from "./components/DebtSection.tsx";
import { CurveEditor, editableCurve, preloadEditor } from "./components/CurveEditor.tsx";
import { GoalBar } from "./components/GoalBar.tsx";
import { Header } from "./components/Header.tsx";
import { LegalLinks, LegalPageView } from "./components/Legal.tsx";
import { ExternalIcon, WarningIcon } from "./components/icons.tsx";
import { PolicyList } from "./components/PolicyList.tsx";
import { Scoreboard } from "./components/Scoreboard.tsx";
import { SectionNav } from "./components/SectionNav.tsx";
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
import { isPreviewPack, listPackIds, loadPack } from "./packs.ts";
import type { LegalPage, SiteConfig } from "./site/config.ts";
import { currentSite } from "./site/current.ts";
import { REPOSITORY_URL } from "./site/project.ts";

const LANGUAGE_KEY = "budget-simulator:language";

/** Below this the page has one column (base.css, .workspace): the measures then come before the budget. */
export const ONE_COLUMN = "(max-width: 1079px)";

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
  // A link that opens a curve editor: its code is fetched alongside the country's data.
  if (parseHash(currentHash()).editor) preloadEditor();
  // A link with assumptions of the debt projection: that section's code too.
  if (parseHash(currentHash()).debt) preloadDebt();
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
  /** Whether a country was chosen after the page opened; the address then names it at once. */
  const [switched, setSwitched] = useState(false);
  const onCountry = useCallback((id: string) => {
    setSwitched(true);
    setCountry(id);
  }, []);
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
      previews={ids.filter(isPreviewPack)}
      onCountry={onCountry}
      countrySwitched={switched}
    />
  );
}

export interface SimulatorProps {
  pack: CountryPack;
  fallback?: Fallback;
  countries?: readonly string[];
  /** Of those, the packs that mark themselves as a preview and are in this build only on request. */
  previews?: readonly string[];
  onCountry?(id: string): void;
  /**
   * The country was chosen on the page, not by the address it was opened with: the address is
   * written at once, so that it names the country and a reload stays there.
   */
  countrySwitched?: boolean;
  /** The operator's details for imprint and privacy statement; without them there are no legal pages. Default: the build's. */
  site?: SiteConfig | null;
}

export function Simulator({ pack, fallback, countries = [], previews = [], onCountry, countrySwitched = false, site = currentSite }: SimulatorProps) {
  const languages = useMemo(() => languagesOf(pack.country.locales), [pack]);
  const [language, setLanguage] = useState(() =>
    pickLanguage(pack.country.locales, {
      url: parseHash(currentHash()).language,
      stored: storedLanguage(),
      browser: browserLanguages(),
    }),
  );
  const [scenario, setScenario] = useState<Scenario>(() => scenarioFromHash(currentHash(), pack));
  /** Assumptions of the debt projection, undefined for a pack without debt data. Part of the link as well. */
  const [debtAssumptions, setDebtAssumptions] = useState(() => debtFromHash(currentHash(), pack));
  /** The goal the bar under the scoreboard measures against; undefined for the pack's default. In the link when it is not. */
  const [goalId, setGoalId] = useState(() => goalFromHash(currentHash(), pack));
  const goal = chosenGoal(pack, goalId);
  /** The collection the list of measures is narrowed to, if any. In the link as well. */
  const [collection, setCollection] = useState(() => collectionFromHash(currentHash(), pack));
  const ui = useMemo(() => createUi(pack, language), [pack, language]);
  const { t } = ui;
  const result = useMemo(() => simulate(pack, scenario), [pack, scenario]);
  const layout = useMemo(() => layoutBudget(pack), [pack]);

  const [selection, setSelection] = useState<Selection>(() => defaultSelection(pack, layout));
  const [highlight, setHighlight] = useState<string>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [reveal, setReveal] = useState<{ id: string; nonce: number }>();
  /** One column (phone and tablet): the measures come first. */
  const oneColumn = useMediaQuery(ONE_COLUMN);
  /** The curve editor that is open, if any. It is part of the link, so a shared link opens it too. */
  const [editor, setEditor] = useState(() => editorFromHash(currentHash(), pack));
  const editorPolicy = editor ? pack.policies.find((policy) => policy.id === editor.policy) : undefined;
  // Open only for a curve that a schedule of the measure actually uses.
  const editing = editor !== undefined && editableCurve(editorPolicy, editor.param) !== undefined;

  /** Imprint or privacy statement in place of the simulator (#...&p=imprint); none without a site config. */
  const { page: legalPage, follow: followLegal, go: goLegal } = useLegalPage(site, currentHash());

  // --- the URL mirrors scenario and language ---------------------------------------------------
  const showsCountry = !fallback && countries.length > 1;
  const hash = stateToHash(
    {
      scenario,
      debt: debtAssumptions,
      goal: goalId,
      collection,
      language,
      country: showsCountry ? pack.country.id : undefined,
      editor,
      page: legalPage,
    },
    pack,
  );
  /** The address of a legal page, or of the simulator, with this scenario. */
  const legalHref = (page: LegalPage | undefined): string =>
    stateToHash(
      { scenario, debt: debtAssumptions, goal: goalId, collection, language, country: showsCountry ? pack.country.id : undefined, page },
      pack,
    ) || "#";
  const hashRef = useRef(hash);
  hashRef.current = hash;
  /** The address of exactly this scenario, whether or not the address bar shows it yet. */
  const link =
    typeof window === "undefined"
      ? hash
      : `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
  const linkRef = useRef(link);
  linkRef.current = link;
  const initialHash = useRef(hash);
  // A bare address stays bare until the visitor changes something; a link is kept in sync from the
  // start, and so is the address after the visitor switched to another country.
  const dirty = useRef(currentHash() !== "" || countrySwitched);
  // Writes draw on a budget, so that Safari, which allows replaceState about 100 times in ten
  // seconds, never refuses while a point of a curve is dragged (see addressWriter.ts).
  const writer = useRef<AddressWriter | null>(null);
  writer.current ??= addressWriter({
    isCurrent: () => window.location.hash === hashRef.current,
    write: () => {
      try {
        window.history.replaceState(window.history.state, "", hashRef.current);
      } catch {
        // Refused all the same: the next change tries again, and Share copies the link anyway.
      }
    },
  });
  useEffect(() => {
    if (!dirty.current && hash === initialHash.current) return;
    dirty.current = true;
    writer.current?.request();
  }, [hash]);
  useEffect(() => () => writer.current?.dispose(), []);

  useEffect(() => {
    const onHashChange = (): void => {
      const fields = parseHash(window.location.hash);
      // Back to the bare address through the browser's history: the simulator, not a legal page.
      if (window.location.hash === "") followLegal(undefined);
      // Not one of ours (an in-page anchor, say): put the state back and leave it at that.
      if (
        fields.country === undefined &&
        fields.language === undefined &&
        fields.scenario === undefined &&
        fields.editor === undefined &&
        fields.debt === undefined &&
        fields.goal === undefined &&
        fields.collection === undefined &&
        fields.page === undefined
      ) {
        if (window.location.hash !== "" && dirty.current) {
          try {
            window.history.replaceState(window.history.state, "", hashRef.current);
          } catch {
            // See above: the browser may refuse for a while.
          }
        }
        return;
      }
      if (fields.country && fields.country !== pack.country.id && countries.includes(fields.country)) {
        onCountry?.(fields.country);
        return;
      }
      const next = scenarioFromHash(window.location.hash, pack);
      setScenario((current) => (sameScenario(current, next, pack) ? current : next));
      if (fields.language) setLanguage(pickLanguage(pack.country.locales, { url: fields.language }));
      const wanted = editorFromHash(window.location.hash, pack);
      setEditor((current) =>
        current?.policy === wanted?.policy && current?.param === wanted?.param ? current : wanted,
      );
      const wantedDebt = debtFromHash(window.location.hash, pack);
      setDebtAssumptions((current) => (sameDebtAssumptions(current, wantedDebt) ? current : wantedDebt));
      setGoalId(goalFromHash(window.location.hash, pack));
      setCollection(collectionFromHash(window.location.hash, pack));
      followLegal(fields.page);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pack, countries, onCountry, followLegal]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = legalPage
      ? t.legal.documentTitle(legalPage === "imprint" ? t.legal.imprint : t.legal.privacyTitle, t.app.name)
      : t.app.title(ui.text(pack.country.name), ui.period);
  }, [language, t, ui, pack, legalPage]);

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

  /** A change made in the curve editor: it sets the value and switches the measure on, so the scoreboard shows it. */
  const onEditorParam = useCallback((id: string, param: string, value: ParamValue) => {
    setScenario((current) => {
      const previous = current.policies[id] ?? { enabled: false };
      return {
        ...current,
        policies: {
          ...current.policies,
          [id]: { ...previous, enabled: true, params: { ...previous.params, [param]: value } },
        },
      };
    });
  }, []);

  /** Where the keyboard focus was when the editor opened; it goes back there when it closes. */
  const opener = useRef<HTMLElement | null>(null);
  /** Whether the editor was opened on this page (and the page went back to where it was), not by the link. */
  const openedHere = useRef(false);
  const onEditCurve = useCallback((id: string, param: string) => {
    // Safari does not focus a button that is clicked; the focus is then on the body, or on the
    // nearest focusable container (main, tabIndex -1). Only a control counts as the opener.
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active.tabIndex >= 0 ? active : null;
    openedHere.current = true;
    setEditor({ policy: id, param });
  }, []);
  const closedPolicy = useRef<string | undefined>(undefined);
  const onCloseEditor = useCallback(() => {
    closedPolicy.current = editor?.policy;
    setEditor(undefined);
  }, [editor]);
  useEffect(() => {
    if (editing || closedPolicy.current === undefined) return;
    const element = opener.current;
    const card = document.querySelector<HTMLElement>(`#policy-${closedPolicy.current} .policy__edit`);
    closedPolicy.current = undefined;
    opener.current = null;
    if (element && element.isConnected) element.focus({ preventScroll: true });
    // The button that opened it is gone or never had the focus: the card's button, where the page
    // is back at. Opened by a link: the card's button, brought into view.
    else card?.focus({ preventScroll: openedHere.current });
    openedHere.current = false;
  }, [editing]);

  const onLevel = useCallback((level: LevelFilter) => {
    setScenario((current) => ({ ...current, level }));
  }, []);

  const onReset = useCallback(() => setScenario(emptyScenario()), []);

  const onGoal = useCallback((id: string) => setGoalId(id === pack.goals?.default ? undefined : id), [pack]);

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
    const url = linkRef.current;
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

  // While the curve editor lies over the page, the page behind it follows at a lower priority: the
  // scoreboard and the editor update on every move of a point, the hidden page when there is time.
  const deferredResult = useDeferredValue(result);
  const deferredScenario = useDeferredValue(scenario);
  const pageResult = editing ? deferredResult : result;
  const pageScenario = editing ? deferredScenario : scenario;
  /** Where the scenario leads over the coming decades; for the whole state, whatever the level shown. */
  const debt = useDebtView(pack, pageScenario, pageResult, debtAssumptions);

  const budget = (
    <BudgetView key="budget" result={pageResult} selection={selection} onSelect={onSelect} highlight={highlight} />
  );
  const policies = (
    <PolicyList
      key="policies"
      scenario={pageScenario}
      result={pageResult}
      expanded={expanded}
      reveal={reveal}
      onToggle={onToggle}
      onParam={onParam}
      onExpand={onExpand}
      onShowNode={onShowNode}
      onEditCurve={onEditCurve}
      collection={collection}
      onCollection={setCollection}
      goal={goal}
    />
  );

  return (
    <UiContext value={ui}>
      <a className="skip-link" href="#main" onClick={(event) => jumpTo(event, "main")}>
        {t.app.skipToContent}
      </a>
      {/* A pack that is not live yet, in a view that includes previews (development, or a build with PREVIEW_PACKS=include). */}
      {!fallback && previews.includes(pack.country.id) && (
        <aside className="dev-notice dev-notice--preview" role="note" inert={editing}>
          <div className="page">
            <p>
              <WarningIcon size={15} />
              <span>{t.dev.preview}</span>
            </p>
          </div>
        </aside>
      )}
      {fallback && (
        <aside className="dev-notice" role="note" inert={editing}>
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
        link={link}
        onShare={onShare}
        onReset={onReset}
        canReset={canReset}
        countries={fallback ? [] : countries}
        previews={previews}
        onCountry={onCountry}
        inert={editing}
        legal={legalPage !== undefined}
      />
      {!legalPage && (
        <Scoreboard result={result} editing={editing ? editor?.policy : undefined}>
          {goal && <GoalBar goal={goal} scenario={scenario} result={result} onGoal={onGoal} steady={editing} />}
          {/* One column: the sections lie one under the other, below the whole list of measures. A row
              in the band leads to each; not while the curve editor lies over the page. */}
          {oneColumn && !editing && (
            <SectionNav measures={pack.policies.length > 0} debt={debt !== undefined && debtAssumptions !== undefined} />
          )}
        </Scoreboard>
      )}
      {editing && editor && editorPolicy && (
        <CurveEditor
          key={`${editor.policy}.${editor.param}`}
          policy={editorPolicy}
          paramId={editor.param}
          state={scenario.policies[editor.policy]}
          inScenario={result.policies.find((entry) => entry.id === editor.policy)}
          level={result.level}
          baseline={result.baseline}
          onToggle={onToggle}
          onChange={onEditorParam}
          onClose={onCloseEditor}
        />
      )}
      <main id="main" className="page" tabIndex={-1} inert={editing}>
        {legalPage && site ? (
          <LegalPageView
            page={legalPage}
            site={site}
            backHref={legalHref(undefined)}
            onBack={(event) => goLegal(event, undefined)}
            languageKey={LANGUAGE_KEY}
          />
        ) : (
          <>
            {/* Where the page has one column (phone and tablet) the measures come first: they are what
                the visitor acts on, and the first of them should be on the first screen. The row of
                sections in the band leads to the budget and the debt section from anywhere, so the
                line that leads to the debt section is only needed beside the two columns. The order in
                the document follows the order on screen, so keyboard and screen reader agree with the eye. */}
            {!oneColumn && <DebtTeaser view={debt} />}
            {/* A pack without measures yet: the budget is what there is, so it comes first on one column too. */}
            <div className="workspace">{oneColumn && pack.policies.length > 0 ? [policies, budget] : [budget, policies]}</div>
            {/* A pack without measures has nothing to switch on, so there is no change to show. */}
            {pack.policies.length > 0 && <Waterfall result={pageResult} onShowPolicy={onShowPolicy} />}
            {debt && debtAssumptions && (
              <DebtSection view={debt} assumptions={debtAssumptions} onAssumptions={setDebtAssumptions} level={pageResult.level} />
            )}
            <About />
          </>
        )}
      </main>
      <footer className="footer" inert={editing}>
        <div className="page">
          <p>{t.about.licence}</p>
          <p className="footer__links">
            {debt && (
              <a
                href={legalPage ? legalHref(undefined) : "#debt"}
                onClick={(event) => (legalPage ? goLegal(event, undefined, "debt") : jumpTo(event, "debt"))}
                onPointerEnter={preloadDebt}
                onFocus={preloadDebt}
              >
                {t.debt.footerLink}
              </a>
            )}
            {/* On a legal page "About the numbers" leads back to the simulator, to that section. */}
            <a
              href={legalPage ? legalHref(undefined) : "#about"}
              onClick={(event) => (legalPage ? goLegal(event, undefined, "about") : jumpTo(event, "about"))}
            >
              {t.about.title}
            </a>
            <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
              {t.about.sourceCode}
              <ExternalIcon size={12} />
              <span className="visually-hidden"> ({t.common.externalLink})</span>
            </a>
            {site && <LegalLinks current={legalPage} hrefFor={legalHref} onOpen={goLegal} />}
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

/**
 * Copy for browsers without the asynchronous clipboard (or without permission to use it): select
 * the text in a field nobody sees and ask for the selection to be copied. Whatever happens, the
 * field is taken away again and the keyboard focus goes back to where it was.
 */
function copyWithSelection(text: string): boolean {
  const focused = document.activeElement;
  const field = document.createElement("textarea");
  try {
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    if (focused instanceof HTMLElement && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }
}
