/**
 * The body of the debt section, loaded only when the section comes near the window (or a link asks
 * for it): the two charts, the assumptions with their presets, when interest overtakes budget items
 * and reaches the reference values, what the calculation leaves out, the table and the sources.
 * The section's frame with its heading and opening sentence is in DebtSection.tsx and part of the
 * first load.
 *
 *   - Interest leads: as a share of all revenue by default, which is what a budget feels; as a
 *     share of GDP on request, which is how other countries' figures are given, and then they are
 *     drawn in the chart.
 *   - Debt as a share of GDP, with the threshold and the other countries.
 *   - The path without the measures thin and grey, the one with them strong, the range of the
 *     estimates as a band; one strong line when the measures change nothing.
 *   - An official plan that describes the same thing as the projection (the pack's whole budget in
 *     the projection's accounts) drawn against it in every chart it has figures for; where the
 *     projection follows it, the year it ends is marked. Its debt lies on the path the projection
 *     follows it by; its interest never does (the path's interest is the model's), so it is drawn
 *     beside the path as figures of its own. Plans of another scope or in other accounts are never
 *     drawn: they stand apart, with their scope said in words, as a small table.
 *   - Years are the pack's: their names in words ("FY 2030"), plain numbers on the axes and in the
 *     table's rows, with a line that says what a year is where they are not calendar years.
 */
import { useId, useMemo, useState } from "react";
import { defaultDebtAssumptions, sameDebtAssumptions } from "../app/debtLink.ts";
import {
  coversState,
  interestComparisons,
  interestToRevenue,
  lastOf,
  planFollowing,
  recordAt,
  recordsOf,
  referenceRows,
  tableYears,
  type ComparisonRow,
  type Crossing,
  type DebtView,
  type ReferenceReach,
} from "../app/debtModel.ts";
import { comparablePlans, otherPlans, planAgainstDefaults, planFields, planFollowingOf, planSeries, type PlanMeasure } from "../app/debtPlans.ts";
import { paragraphs } from "../app/paragraphs.ts";
import { useUi } from "../app/ui.ts";
import {
  applyDebtPreset,
  calendarYears,
  DEBT_ASSUMPTION_IDS,
  debtAssumptionParam,
  defaultFollow,
  followablePlans,
  LEVEL_IDS,
  presetApplies,
  projectionAccounts,
  resolveDebtAssumptions,
  yearEnd,
  yearStart,
  type DebtAssumptions,
  type DebtPath,
  type DebtPlan,
  type DebtReference,
  type DebtYear,
} from "../engine/index.ts";
import { debtBodyMessages } from "../i18n/debt/body.ts";
import { decimalsIn } from "../i18n/format.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import debtStyles from "../styles/debt-body.css?inline";
import { DebtChart, type ChartLine, type ChartPlan, type ChartReference } from "./DebtChart.tsx";
import { Check, ResetIcon } from "./icons.tsx";
import { NumberControl } from "./ParamControls.tsx";
import { QualityBadge, SourceList } from "./primitives.tsx";

// The styles travel with the code, as the curve editor's do: they arrive together, or fail
// together and come with the next attempt.
if (typeof document !== "undefined" && !document.querySelector("style[data-debt-section]")) {
  const style = document.createElement("style");
  style.dataset.debtSection = "";
  style.textContent = debtStyles;
  document.head.appendChild(style);
}

export interface DebtBodyProps {
  view: DebtView;
  assumptions: DebtAssumptions;
  onAssumptions(next: DebtAssumptions): void;
  /** What the calculation is and where it starts from (DebtSection.tsx): said under the charts. */
  intro?: string;
}

type Unit = "revenue" | "gdp";
type Measure = "interestToRevenue" | "interestRatio" | "debtRatio";

const series = (path: Pick<DebtPath, "start" | "years">, measure: Measure): number[] => recordsOf(path).map((record) => record[measure]);

/** The first letter in upper case, for a name that starts a line of a list. */
function capitalized(text: string, language: string): string {
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
}

export function DebtBody({ view, assumptions, onAssumptions, intro }: DebtBodyProps) {
  const ui = useUi();
  const { pack, t, fmt, language } = ui;
  // The section's own texts, which came with this code.
  const d = debtBodyMessages(language);
  const debt = pack.debt!;
  const { projection, twoPaths, hasRange, measuresOn } = view;
  const { baseline, reform, reformLow, reformHigh, baseYear } = projection;
  const lastYear = lastOf(reform).year;
  const id = useId();
  const keysId = `${id}-keys`;
  const [unit, setUnit] = useState<Unit>("revenue");
  const [year, setYear] = useState<number | null>(null);
  /** A phone: the table puts its figures under one another instead of side by side. */
  const narrow = useMediaQuery("(max-width: 719px)");
  const comparisons = useMemo(() => interestComparisons(pack, view), [pack, view]);
  const references = useMemo(() => referenceRows(pack, view), [pack, view]);
  const years = recordsOf(baseline).map((record) => record.year);
  // A year picked before the horizon was shortened is no longer there.
  const shownYear = year !== null && year <= lastYear ? year : null;

  // Whose budget: "the state" where the pack has several levels (see i18n/debt/messages.ts).
  const state = coversState(pack);
  // The pack's years: their names in words; where they are not calendar years, the word for them
  // ("FY", "Haushaltsjahr") heads the table's column of years, which keeps plain numbers.
  const calendar = calendarYears(pack);
  const name = ui.yearName;
  const yearWord = calendar ? d.year : String(name(baseYear)).replace(String(baseYear), "").trim() || d.year;
  const pct = (fraction: number, digits = 1): string => fmt.percent(fraction, { digits });
  const tick = (fraction: number): string => fmt.percent(fraction, { digits: decimalsIn(fraction * 100, 1) });
  const range = (a: number, b: number): string => t.common.range(pct(Math.min(a, b)), pct(Math.max(a, b)));
  /** A reference value as the source gives it: 60 %, 123.3 %. */
  const referenceValue = (fraction: number): string => fmt.percent(fraction, { digits: decimalsIn(fraction * 100, 1) });

  // --- the charts -----------------------------------------------------------------------------
  const linesFor = (measure: Measure): ChartLine[] =>
    twoPaths
      ? [
          { key: "baseline", label: d.legend.without, values: series(baseline, measure), strong: false },
          { key: "reform", label: d.legend.with, values: series(reform, measure), strong: true },
        ]
      : [{ key: "reform", label: measuresOn ? d.legend.same : d.legend.without, values: series(reform, measure), strong: true }];
  const bandFor = (measure: Measure) =>
    hasRange ? { from: series(reformLow, measure), to: series(reformHigh, measure), label: d.legend.range } : undefined;

  /** The name of a reference in the chart's margin: a country by its name, the country's own past by name and year. */
  const shortName = (reference: DebtReference): string =>
    reference.kind === "history" && reference.year !== undefined
      ? d.referenceName(ui.text(pack.country.name), name(reference.year))
      : ui.text(reference.label);
  /** The references in a chart: interest as a share of revenue (where a reference gives revenue) or of GDP, or debt. */
  const chartReferences = (field: "interestToRevenue" | "interestRatio" | "debtRatio"): ChartReference[] =>
    debt.references.flatMap((reference) => {
      const value = field === "interestToRevenue" ? interestToRevenue(reference) : reference[field];
      if (value === undefined) return [];
      const name = shortName(reference);
      const shown = field === "interestToRevenue" ? pct(value) : referenceValue(value);
      return [{ key: reference.id, label: name, offScaleLabel: d.offScale(name, shown), value, threshold: reference.kind === "threshold" }];
    });

  // --- official plans ---------------------------------------------------------------------------
  const comparable = useMemo(() => comparablePlans(pack), [pack]);
  const others = useMemo(() => otherPlans(pack), [pack]);
  const followed = projection.followed;
  const by = planFollowing(projection, pack) ?? "debt";
  // A plan the projection follows: the path without measures meets its debt, so the plan's debt is
  // drawn as its diamonds on that path, up to where it is followed. Its interest is not on the path,
  // whose interest is the model's at the assumed rates: it is drawn as a dashed line of its own,
  // like a plan that is not followed (Germany's plan gives no interest, so nothing changes there).
  const plansFor = (measure: PlanMeasure): ChartPlan[] =>
    comparable.map((plan) => {
      const onPath = followed?.plan === plan.id && measure === "debtRatio";
      const points = planSeries(plan, measure, baseYear, onPath ? followed.until : lastYear);
      return { key: plan.id, label: ui.text(plan.label), points, onPath };
    });
  /** A plan's ratio as the source gives it: 78.25 %, 62.8 %. */
  const planRatio = (fraction: number): string => fmt.percent(fraction, { digits: decimalsIn(fraction * 100, 2) });
  const marker = followed ? { year: followed.until, label: d.continued(name(followed.until + 1), by) } : undefined;
  const defaults = useMemo(() => defaultDebtAssumptions(debt), [debt]);

  const readoutFor =
    (measure: Measure, amount: "interest" | "debt") =>
    (at: number): string => {
      const record = (path: Pick<DebtPath, "start" | "years">): DebtYear => recordAt(path, at) ?? lastOf(path);
      const spread = hasRange ? ` (${range(record(reformLow)[measure], record(reformHigh)[measure])})` : "";
      const parts = twoPaths
        ? [
            d.readoutPart(d.legend.without, pct(record(baseline)[measure])),
            d.readoutPart(d.legend.with, `${pct(record(reform)[measure])}${spread}`),
          ]
        : [`${d.withAmount(pct(record(reform)[measure]), fmt.money(record(reform)[amount]))}${spread}`];
      // What an official plan gives for the year pointed at.
      for (const plan of comparable) {
        const value = plan.points.find((point) => point.year === at)?.[measure];
        if (value !== undefined) parts.push(d.planPart(planRatio(value)));
      }
      return d.readout(name(at), parts);
    };

  const marginLabels = [...chartReferences("interestRatio"), ...chartReferences("debtRatio")].flatMap((reference) => [reference.label, reference.offScaleLabel]);
  const interestMeasure: Measure = unit === "revenue" ? "interestToRevenue" : "interestRatio";
  // Other countries' interest in the same unit as the chart: as a share of their revenue, or of their GDP.
  const interestReferences = chartReferences(interestMeasure);

  // --- the starting point: each plan that can be followed, and the base year's budget ---------------
  const packStart = defaultFollow(debt) ?? null;
  const currentStart = typeof assumptions.follow === "string" ? assumptions.follow : assumptions.follow === null ? null : packStart;
  const followable = followablePlans(debt);
  const starts = [
    ...followable.map((plan) => {
      const until = plan.points[plan.points.length - 1].year;
      return {
        key: plan.id,
        follow: plan.id as string | null,
        // With one plan, a short name and its last year; with several, their own names.
        label: followable.length === 1 ? d.startPlan(name(until)) : ui.text(plan.label),
        note: d.startPlanNote(ui.text(plan.label), name(until), planFollowingOf(plan, baseYear)),
      };
    }),
    { key: "base", follow: null as string | null, label: d.startBase(name(baseYear)), note: d.startBaseNote(name(baseYear)) },
  ].map((start) => ({ ...start, chosen: start.follow === currentStart, isDefault: start.follow === packStart }));

  // --- assumptions ----------------------------------------------------------------------------
  const set = (key: (typeof DEBT_ASSUMPTION_IDS)[number], value: number): void =>
    onAssumptions(resolveDebtAssumptions(debt, { ...assumptions, [key]: value }));
  const applied = debt.presets.filter((preset) => presetApplies(preset, assumptions));
  const atDefaults = sameDebtAssumptions(assumptions, defaultDebtAssumptions(debt));
  const refinanced = pct(projection.refinancingShare);
  const end = lastOf(reform);
  const summary = t.debt.announce(name(lastYear), pct(end.interestToRevenue), twoPaths ? pct(lastOf(baseline).interestToRevenue) : undefined);

  // --- texts for the lists --------------------------------------------------------------------
  const crossingText = (crossing: Crossing): string =>
    crossing.first === null
      ? d.crossing.never(name(lastYear))
      : crossing.drop !== null && !crossing.atEnd
        ? d.crossing.between({ first: name(crossing.first), lastAbove: name(crossing.drop - 1), drop: name(crossing.drop), fromBase: crossing.first === baseYear })
        : crossing.first === baseYear
          ? d.crossing.already(name(baseYear))
          : d.crossing.since(name(crossing.first));
  const reachYear = (value: number | null): string =>
    value === null ? d.reach.never(name(lastYear)) : value === baseYear ? d.reach.already(name(baseYear)) : d.reach.year(name(value));
  const reachText = (reach: ReferenceReach): string => {
    const withText = reachYear(reach.with);
    const withoutText = reachYear(reach.without);
    return twoPaths && withText !== withoutText ? d.bothPaths(withText, withoutText) : withoutText;
  };
  const comparisonWhen = (row: ComparisonRow): string => {
    const withText = crossingText(row.with);
    const withoutText = crossingText(row.without);
    return measuresOn && withText !== withoutText ? d.bothPaths(withText, withoutText) : withoutText;
  };
  const levels = LEVEL_IDS.filter((level) => pack.country.levels[level]).map((level) => ui.levelName(level));
  // Whose budget and debt: in the pack's words where it gives them, else the levels, or the one level.
  const covers = debt.covers ? d.covers(ui.text(debt.covers)) : levels.length > 1 ? d.levelsNote(d.list(levels)) : levels.length === 1 ? d.oneLevel(levels[0]) : undefined;
  const horizonParam = debtAssumptionParam(debt, "horizon");
  const maturity = debt.refinancing.averageMaturity;
  // Where the share is one divided by the average time to maturity (to the third decimal), the two
  // are one fact; otherwise (a share set as its note says) the time stands on a line of its own.
  const shareFromMaturity = maturity !== undefined && Math.abs(debt.refinancing.share - 1 / maturity) < 0.0005;
  const maturityText = maturity === undefined ? undefined : fmt.param({ ...horizonParam, step: 0.01, unitLabel: undefined }, maturity);
  const gdp = pack.country.indicators.gdp.value;

  return (
    <div className="debt__body">
      <div className="debt__grid">
        <div className="debt__main">
          <DebtChart
            title={d.interestTitle}
            subtitle={unit === "revenue" ? d.interestOfRevenue(state) : d.interestOfGdp}
            controls={
              <div className="dunit" role="group" aria-label={d.unitLabel}>
                {(["revenue", "gdp"] as const).map((option) => (
                  <button key={option} type="button" aria-pressed={unit === option} onClick={() => setUnit(option)}>
                    {option === "revenue" ? d.unitRevenue : d.unitGdp}
                  </button>
                ))}
              </div>
            }
            years={years}
            lines={linesFor(interestMeasure)}
            band={bandFor(interestMeasure)}
            references={interestReferences}
            plans={plansFor(interestMeasure)}
            marker={marker}
            // The other countries are what this chart is compared with: all of them stay in range.
            outlier={Infinity}
            marginLabels={marginLabels}
            referenceLabel={d.legend.reference}
            tick={tick}
            readout={readoutFor(interestMeasure, "interest")}
            year={shownYear}
            onYear={setYear}
            controlLabel={d.chartControl(d.interestTitle)}
            keysId={keysId}
            height={{ narrow: 230, wide: 290 }}
          />
          <DebtChart
            title={d.debtTitle}
            subtitle={d.debtOfGdp}
            years={years}
            lines={linesFor("debtRatio")}
            band={bandFor("debtRatio")}
            references={chartReferences("debtRatio")}
            plans={plansFor("debtRatio")}
            marker={marker}
            marginLabels={marginLabels}
            referenceLabel={d.legend.reference}
            tick={tick}
            readout={readoutFor("debtRatio", "debt")}
            year={shownYear}
            onYear={setYear}
            controlLabel={d.chartControl(d.debtTitle)}
            keysId={keysId}
            height={{ narrow: 220, wide: 260 }}
          />
          <p id={keysId} className="visually-hidden">
            {d.keys}
          </p>
          {!calendar && (
            <p className="debt__note debt__years">{d.yearsNote(name(baseYear), fmt.dateLong(yearStart(pack, baseYear)), fmt.dateLong(yearEnd(pack, baseYear)))}</p>
          )}
          {intro && <p className="debt__intro">{intro}</p>}

          {(comparable.length > 0 || others.length > 0) && (
            <section className="debt__block dplans" aria-labelledby={`${id}-plans`}>
              <h3 id={`${id}-plans`}>{d.plansTitle}</h3>
              {comparable.map((plan) => {
                const against = planAgainstDefaults(pack, plan, view.whole, defaults);
                const isFollowed = followed?.plan === plan.id;
                return (
                  <div key={plan.id} className="dplan">
                    <h4 className="dplan__name">{ui.text(plan.label)}</h4>
                    {against && (
                      <p className="dplan__intro">
                        {d.plansIntro({
                          baseYear: name(baseYear),
                          year: name(against.year),
                          plan: planRatio(against.plan),
                          model: pct(against.model),
                          followed: isFollowed,
                        })}
                      </p>
                    )}
                    <p className="debt__note">{d.planInChart(isFollowed, isFollowed ? by : planFollowingOf(plan, baseYear))}</p>
                    <PlanFigures plan={plan} ratio={planRatio} yearWord={yearWord} />
                    <PlanMore plan={plan} label={d.planMore} />
                  </div>
                );
              })}
              {others.map((plan) => (
                <div key={plan.id} className="dplan dplan--apart">
                  <h4 className="dplan__name">{ui.text(plan.label)}</h4>
                  <p className="dplan__scope">
                    <strong>{d.planScope(plan.scope === "all" ? null : ui.levelName(plan.scope), plan.accounts, state)}</strong>{" "}
                    {d.planNotComparable(projectionAccounts(debt), state)}
                  </p>
                  <PlanFigures plan={plan} ratio={planRatio} yearWord={yearWord} />
                  <PlanMore plan={plan} label={d.planMore} />
                </div>
              ))}
            </section>
          )}

          {comparisons.length > 0 && (
            <section className="debt__block" aria-labelledby={`${id}-comparisons`}>
              <h3 id={`${id}-comparisons`}>{d.comparisonsTitle}</h3>
              <ul className="dcmp">
                {comparisons.map((row) => (
                  <li key={row.node} className="dcmp__row">
                    <span className="dcmp__name">{capitalized(ui.text(row.label), language)}</span>
                    <strong className="dcmp__when">{comparisonWhen(row)}</strong>
                    <span className="dcmp__amount">
                      {d.itemToday(name(baseYear), fmt.money(row.amount), pct(row.share))}
                      {measuresOn && Math.abs(row.amountWith - row.amount) > Math.abs(row.amount) * 1e-6 && (
                        <>
                          <br />
                          {d.itemWith(fmt.money(row.amountWith), pct(row.shareWith))}
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="debt__note">{d.comparisonsNote(name(baseYear), state)}</p>
            </section>
          )}

          {references.length > 0 && (
            <section className="debt__block" aria-labelledby={`${id}-references`}>
              <h3 id={`${id}-references`}>{d.referencesTitle}</h3>
              <p className="debt__note">{d.referencesNote}</p>
              <ul className="dref">
                {references.map(({ reference, interestRevenue, interest, debt: debtReach }) => (
                  <li key={reference.id} className="dref__row">
                    <span className="dref__name">
                      {reference.kind === "country" ? d.referenceName(ui.text(reference.label), reference.year) : ui.text(reference.label)}
                    </span>
                    <span className="dref__values">
                      {interestRevenue && (
                        <span>
                          {d.referenceInterestRevenue(pct(interestRevenue.value))}: <strong>{reachText(interestRevenue)}</strong>
                        </span>
                      )}
                      {interest && (
                        <span>
                          {d.referenceInterest(referenceValue(interest.value))}: <strong>{reachText(interest)}</strong>
                        </span>
                      )}
                      {debtReach && (
                        <span>
                          {d.referenceDebt(referenceValue(debtReach.value))}: <strong>{reachText(debtReach)}</strong>
                        </span>
                      )}
                    </span>
                    {reference.note && <span className="dref__note">{ui.text(reference.note)}</span>}
                  </li>
                ))}
              </ul>
              {/* Most references share their sources; each is listed once, below the list. */}
              <div className="dref__sources">
                <h4 className="dpanel__label">{t.common.sources}</h4>
                <SourceList ids={[...new Set(references.flatMap(({ reference }) => reference.sources))]} />
              </div>
            </section>
          )}
        </div>

        <section className="dpanel" aria-labelledby={`${id}-assumptions`}>
          <h3 id={`${id}-assumptions`}>{d.assumptions}</h3>
          <p className="dpanel__result" aria-hidden="true">
            {summary}
          </p>
          {starts.length > 1 && (
            // Where the calculation starts from: one of two, a choice of its own above the presets.
            <fieldset className="dstart">
              <legend className="dpanel__label">{d.startTitle}</legend>
              <div className="dstart__list">
                {starts.map((start) => (
                  <label key={start.key} className={`dstart__option${start.chosen ? " is-chosen" : ""}`}>
                    <input
                      type="radio"
                      name={`${id}-start`}
                      checked={start.chosen}
                      onChange={() => onAssumptions(resolveDebtAssumptions(debt, { ...assumptions, follow: start.follow }))}
                    />
                    <span className="dstart__label">
                      {start.label}
                      {start.isDefault && <span className="dstart__default">{d.startDefault}</span>}
                    </span>
                    <span className="dstart__note">{start.note}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {debt.presets.length > 0 && (
            <div className="dpresets" role="group" aria-labelledby={`${id}-presets`}>
              <h4 id={`${id}-presets`} className="dpanel__label">
                {d.presets}
              </h4>
              <ul className="dpresets__list">
                {debt.presets.map((preset) => {
                  const chosen = presetApplies(preset, assumptions);
                  return (
                    <li key={preset.id}>
                      <button
                        type="button"
                        className="dpreset"
                        aria-pressed={chosen}
                        onClick={() => onAssumptions(applyDebtPreset(debt, assumptions, preset))}
                      >
                        <span>{ui.text(preset.label)}</span>
                        {/* The chosen one carries a tick: a shape, not only the darker edge. */}
                        {chosen && <Check size={15} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {applied.map((preset) => (
                <div key={preset.id} className="dpresets__note">
                  <p>
                    <strong>{d.presetChosen(ui.text(preset.label))}</strong>
                    {preset.note && ` ${ui.text(preset.note)}`}
                  </p>
                  {preset.sources && <SourceList ids={preset.sources} />}
                </div>
              ))}
            </div>
          )}
          {debt.assumptions.map((param) => (
            <div key={param.id} className="dparam">
              <NumberControl id={`${id}-${param.id}`} param={param} value={assumptions[param.id]} onChange={(value) => set(param.id, value)} />
              <p className="dparam__explain">{d.explain[param.id](refinanced, state)}</p>
              {(param.note || (param.sources?.length ?? 0) > 0) && (
                <details className="dparam__more">
                  <summary>{d.whereFrom}</summary>
                  {param.note && <p>{ui.text(param.note)}</p>}
                  {param.sources && <SourceList ids={param.sources} />}
                </details>
              )}
            </div>
          ))}
          <button
            type="button"
            className="debt__reset"
            aria-disabled={atDefaults}
            title={d.resetHint}
            onClick={() => {
              if (!atDefaults) onAssumptions(defaultDebtAssumptions(debt));
            }}
          >
            <ResetIcon size={14} />
            <span>{d.reset}</span>
          </button>
        </section>
      </div>

      <section className="debt__limits" aria-labelledby={`${id}-limits`}>
        <h3 id={`${id}-limits`}>{d.limitsTitle}</h3>
        <p>{ui.text(debt.note)}</p>
        {covers && <p>{covers}</p>}
      </section>

      <details className="debt__table">
        <summary>{d.tableTitle}</summary>
        {narrow ? (
          // On a phone: three columns, each cell with its figures one under the other; with the
          // measures, each year has a row without and a row with them.
          <table className="debt__compact">
            <caption className="visually-hidden">{d.tableCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{twoPaths ? <span className="visually-hidden">{d.path}</span> : yearWord}</th>
                <th scope="col">{d.interestAmount}</th>
                <th scope="col">{d.debtAmount}</th>
              </tr>
            </thead>
            {tableYears(baseYear, projection.assumptions.horizon).map((at) => {
              const cells = (path: Pick<DebtPath, "start" | "years">) => {
                const record = recordAt(path, at) ?? lastOf(path);
                return (
                  <>
                    <td>
                      <span>{d.ofRevenue(pct(record.interestToRevenue))}</span>
                      <span>{t.units.ofGdp(pct(record.interestRatio))}</span>
                      <span>{fmt.money(record.interest)}</span>
                    </td>
                    <td>
                      <span>{t.units.ofGdp(pct(record.debtRatio))}</span>
                      <span>{fmt.money(record.debt)}</span>
                    </td>
                  </>
                );
              };
              return twoPaths ? (
                <tbody key={at}>
                  <tr className="is-year">
                    <th scope="rowgroup" colSpan={3}>
                      {name(at)}
                    </th>
                  </tr>
                  <tr>
                    <th scope="row">{d.without}</th>
                    {cells(baseline)}
                  </tr>
                  <tr>
                    <th scope="row">{d.with}</th>
                    {cells(reform)}
                  </tr>
                </tbody>
              ) : (
                <tbody key={at}>
                  <tr>
                    <th scope="row">{at}</th>
                    {cells(reform)}
                  </tr>
                </tbody>
              );
            })}
          </table>
        ) : (
          <div className="debt__scroll" role="region" aria-label={d.tableCaption} tabIndex={0}>
            <table>
              <caption className="visually-hidden">{d.tableCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{yearWord}</th>
                  {twoPaths && <th scope="col">{d.path}</th>}
                  <th scope="col">{d.interestShareRevenue}</th>
                  <th scope="col">{d.interestShareGdp}</th>
                  <th scope="col">{d.interestAmount}</th>
                  <th scope="col">{d.debtShareGdp}</th>
                  <th scope="col">{d.debtAmount}</th>
                </tr>
              </thead>
              {tableYears(baseYear, projection.assumptions.horizon).map((at) => {
                const cells = (path: Pick<DebtPath, "start" | "years">) => {
                  const record = recordAt(path, at) ?? lastOf(path);
                  return (
                    <>
                      <td>{pct(record.interestToRevenue)}</td>
                      <td>{pct(record.interestRatio)}</td>
                      <td>{fmt.money(record.interest)}</td>
                      <td>{pct(record.debtRatio)}</td>
                      <td>{fmt.money(record.debt)}</td>
                    </>
                  );
                };
                return twoPaths ? (
                  <tbody key={at}>
                    <tr>
                      <th scope="rowgroup" rowSpan={2}>
                        {at}
                      </th>
                      <th scope="row">{d.without}</th>
                      {cells(baseline)}
                    </tr>
                    <tr>
                      <th scope="row">{d.with}</th>
                      {cells(reform)}
                    </tr>
                  </tbody>
                ) : (
                  <tbody key={at}>
                    <tr>
                      <th scope="row">{at}</th>
                      {cells(reform)}
                    </tr>
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
        <p className="debt__note">{d.tableNote}</p>
      </details>

      <section className="debt__basis" aria-labelledby={`${id}-basis`}>
        <h3 id={`${id}-basis`}>{d.basisTitle}</h3>
        <dl className="facts">
          <div>
            <dt>{d.stock(name(baseYear), calendar ? undefined : fmt.dateLong(yearEnd(pack, baseYear)))}</dt>
            <dd>
              {d.stockValue(fmt.money(debt.stock.value), pct(debt.stock.value / gdp))}
              <span className="muted"> · </span>
              <QualityBadge quality={debt.stock.quality} />
              {debt.stock.note && <span className="facts__sub">{ui.text(debt.stock.note)}</span>}
              <SourceList ids={debt.stock.sources} />
            </dd>
          </div>
          <div>
            <dt>{d.interest(name(baseYear))}</dt>
            <dd>
              {d.interestValue(fmt.money(debt.interest.value), pct(debt.interest.value / gdp, 2))}
              <span className="muted"> · </span>
              <QualityBadge quality={debt.interest.quality} />
              {debt.interest.note && <span className="facts__sub">{ui.text(debt.interest.note)}</span>}
              <SourceList ids={debt.interest.sources} />
            </dd>
          </div>
          <div>
            <dt>{d.refinancing}</dt>
            <dd>
              {d.refinancingValue(refinanced, shareFromMaturity ? maturityText : undefined)}
              <span className="muted"> · </span>
              <QualityBadge quality={debt.refinancing.quality} />
              {debt.refinancing.note && <span className="facts__sub">{ui.text(debt.refinancing.note)}</span>}
              <SourceList ids={debt.refinancing.sources} />
            </dd>
          </div>
          {!shareFromMaturity && maturityText !== undefined && (
            <div>
              <dt>{d.maturity}</dt>
              <dd>{maturityText}</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}

/** A plan's figures as a small table: a row per year, a column per figure it gives. */
function PlanFigures({ plan, ratio, yearWord }: { plan: DebtPlan; ratio(fraction: number): string; yearWord: string }) {
  const ui = useUi();
  const { fmt, language } = ui;
  const d = debtBodyMessages(language);
  const fields = planFields(plan);
  return (
    <table className="dplan__table">
      <caption className="visually-hidden">{d.planCaption(ui.text(plan.label))}</caption>
      <thead>
        <tr>
          <th scope="col">{yearWord}</th>
          {fields.map((field) => (
            <th key={field} scope="col">
              {d.planFields[field]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {plan.points.map((point) => (
          <tr key={point.year}>
            <th scope="row">{point.year}</th>
            {fields.map((field) => {
              const value = point[field];
              return <td key={field}>{value === undefined ? "–" : field === "interest" ? fmt.money(value) : ratio(value)}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A plan's note, quality and sources, one click away: the note is long. */
function PlanMore({ plan, label }: { plan: DebtPlan; label: string }) {
  const ui = useUi();
  return (
    <details className="dparam__more dplan__more">
      <summary>{label}</summary>
      <div className="dplan__note">
        {paragraphs(ui.text(plan.note)).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <p className="dplan__quality">
        <QualityBadge quality={plan.quality} />
      </p>
      <SourceList ids={plan.sources} />
    </details>
  );
}
