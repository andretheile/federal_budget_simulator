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
 */
import { useId, useMemo, useState } from "react";
import { defaultDebtAssumptions, sameDebtAssumptions } from "../app/debtLink.ts";
import {
  interestComparisons,
  interestToRevenue,
  lastOf,
  recordAt,
  recordsOf,
  referenceRows,
  tableYears,
  type ComparisonRow,
  type Crossing,
  type DebtView,
  type ReferenceReach,
} from "../app/debtModel.ts";
import { useUi } from "../app/ui.ts";
import {
  applyDebtPreset,
  DEBT_ASSUMPTION_IDS,
  debtAssumptionParam,
  LEVEL_IDS,
  presetApplies,
  resolveDebtAssumptions,
  type DebtAssumptions,
  type DebtPath,
  type DebtReference,
  type DebtYear,
} from "../engine/index.ts";
import { debtBodyMessages } from "../i18n/debt/body.ts";
import { decimalsIn } from "../i18n/format.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import debtStyles from "../styles/debt-body.css?inline";
import { DebtChart, type ChartLine, type ChartReference } from "./DebtChart.tsx";
import { ResetIcon } from "./icons.tsx";
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
}

type Unit = "revenue" | "gdp";
type Measure = "interestToRevenue" | "interestRatio" | "debtRatio";

const series = (path: Pick<DebtPath, "start" | "years">, measure: Measure): number[] => recordsOf(path).map((record) => record[measure]);

/** The first letter in upper case, for a name that starts a line of a list. */
function capitalized(text: string, language: string): string {
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
}

export function DebtBody({ view, assumptions, onAssumptions }: DebtBodyProps) {
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
      ? d.referenceName(ui.text(pack.country.name), reference.year)
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
      return d.readout(at, parts);
    };

  const marginLabels = [...chartReferences("interestRatio"), ...chartReferences("debtRatio")].flatMap((reference) => [reference.label, reference.offScaleLabel]);
  const interestMeasure: Measure = unit === "revenue" ? "interestToRevenue" : "interestRatio";
  // Other countries' interest in the same unit as the chart: as a share of their revenue, or of their GDP.
  const interestReferences = chartReferences(interestMeasure);

  // --- assumptions ----------------------------------------------------------------------------
  const set = (key: (typeof DEBT_ASSUMPTION_IDS)[number], value: number): void =>
    onAssumptions(resolveDebtAssumptions(debt, { ...assumptions, [key]: value }));
  const applied = debt.presets.filter((preset) => presetApplies(preset, assumptions));
  const atDefaults = sameDebtAssumptions(assumptions, defaultDebtAssumptions(debt));
  const refinanced = pct(projection.refinancingShare);
  const end = lastOf(reform);
  const summary = t.debt.announce(lastYear, pct(end.interestToRevenue), twoPaths ? pct(lastOf(baseline).interestToRevenue) : undefined);

  // --- texts for the lists --------------------------------------------------------------------
  const crossingText = (crossing: Crossing): string =>
    crossing.first === null
      ? d.crossing.never(lastYear)
      : crossing.drop !== null && !crossing.atEnd
        ? d.crossing.between(crossing.first, crossing.drop, baseYear)
        : crossing.first === baseYear
          ? d.crossing.already(baseYear)
          : d.crossing.since(crossing.first);
  const reachYear = (value: number | null): string =>
    value === null ? d.reach.never(lastYear) : value === baseYear ? d.reach.already(baseYear) : d.reach.year(value);
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
  const horizonParam = debtAssumptionParam(debt, "horizon");
  const maturity = debt.refinancing.averageMaturity;
  const gdp = pack.country.indicators.gdp.value;

  return (
    <div className="debt__body">
      <div className="debt__grid">
        <div className="debt__main">
          <DebtChart
            title={d.interestTitle}
            subtitle={unit === "revenue" ? d.interestOfRevenue : d.interestOfGdp}
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

          {comparisons.length > 0 && (
            <section className="debt__block" aria-labelledby={`${id}-comparisons`}>
              <h3 id={`${id}-comparisons`}>{d.comparisonsTitle}</h3>
              <ul className="dcmp">
                {comparisons.map((row) => (
                  <li key={row.node} className="dcmp__row">
                    <span className="dcmp__name">{capitalized(ui.text(row.label), language)}</span>
                    <strong className="dcmp__when">{comparisonWhen(row)}</strong>
                    <span className="dcmp__amount">
                      {d.itemToday(baseYear, fmt.money(row.amount), pct(row.share))}
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
              <p className="debt__note">{d.comparisonsNote}</p>
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
          {debt.presets.length > 0 && (
            <div className="dpresets" role="group" aria-labelledby={`${id}-presets`}>
              <h4 id={`${id}-presets`} className="dpanel__label">
                {d.presets}
              </h4>
              <ul className="dpresets__list">
                {debt.presets.map((preset) => (
                  <li key={preset.id}>
                    <button
                      type="button"
                      className="dpreset"
                      aria-pressed={presetApplies(preset, assumptions)}
                      onClick={() => onAssumptions(applyDebtPreset(debt, assumptions, preset))}
                    >
                      {ui.text(preset.label)}
                    </button>
                  </li>
                ))}
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
              <p className="dparam__explain">{d.explain[param.id](refinanced)}</p>
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
        {levels.length > 1 && <p>{d.levelsNote(d.list(levels))}</p>}
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
                <th scope="col">{twoPaths ? <span className="visually-hidden">{d.path}</span> : d.year}</th>
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
                      {at}
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
                  <th scope="col">{d.year}</th>
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
            <dt>{d.stock(baseYear)}</dt>
            <dd>
              {d.stockValue(fmt.money(debt.stock.value), pct(debt.stock.value / gdp))}
              <span className="muted"> · </span>
              <QualityBadge quality={debt.stock.quality} />
              {debt.stock.note && <span className="facts__sub">{ui.text(debt.stock.note)}</span>}
              <SourceList ids={debt.stock.sources} />
            </dd>
          </div>
          <div>
            <dt>{d.interest(baseYear)}</dt>
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
              {d.refinancingValue(
                refinanced,
                maturity === undefined ? undefined : fmt.param({ ...horizonParam, step: 0.01, unitLabel: undefined }, maturity),
              )}
              <span className="muted"> · </span>
              <QualityBadge quality={debt.refinancing.quality} />
              {debt.refinancing.note && <span className="facts__sub">{ui.text(debt.refinancing.note)}</span>}
              <SourceList ids={debt.refinancing.sources} />
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
