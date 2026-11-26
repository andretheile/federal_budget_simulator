/**
 * Who pays: the section under the budget, the strip on a measure's card and in the curve editor,
 * and the line near the top that leads to the section. The figures come from app/whoPaysModel.ts.
 *
 * Colour on this page means the direction of the budget balance and nothing else. A group paying
 * more is neither good nor bad, so everything here is in neutral ink, in steps, with signs and
 * words ("zahlt mehr"). The rows are a list with every figure as text; the bars are decoration.
 */
import type { MouseEvent } from "react";
import { noiseLevel } from "../app/policyModel.ts";
import { useUi, type Ui } from "../app/ui.ts";
import {
  chartOf,
  measuresOf,
  notesOf,
  sourcesOf,
  statementOf,
  stripOf,
  largestChange,
  type Chart,
  type PayerChange,
  type Strip,
} from "../app/whoPaysModel.ts";
import { findNode, measureWhoPays, type CountryPack, type PolicyResult, type SimulationResult, type WhoPays } from "../engine/index.ts";
import { ArrowDown } from "./icons.tsx";
import { QualityBadge, SourceList } from "./primitives.tsx";
import { jumpToSection } from "./SectionNav.tsx";

/**
 * A node of the statement by its name, with the name of the tax it belongs to where it is a part of
 * one: "Mehrwertsteuer: Lebensmittel und Leitungswasser" rather than "Lebensmittel und Leitungswasser".
 */
function itemLabel(ui: Ui, id: string): string {
  const own = ui.text(findNode(ui.pack, id)?.label);
  const segments = id.split(".");
  if (segments.length < 5) return own;
  return `${ui.text(findNode(ui.pack, segments.slice(0, 4).join("."))?.label)}: ${own}`;
}

const percentOf = (value: number, max: number): string => `${Math.max(0, Math.min(100, (value / max) * 100))}%`;

/** How an amount per unit is written after it, in the pack's words or a generic one. */
function perUnitOf(ui: Ui): string {
  const given = ui.pack.incidence?.population.perUnit;
  return given ? ui.text(given) : ui.language.startsWith("de") ? "je Einheit" : "per unit";
}

/** An amount per unit, without sign, to the whole currency unit: "5.630 €", "weniger als 1 €". */
function perUnitMoney(ui: Ui, value: number): string {
  const amount = Math.abs(value);
  return amount < 1 ? ui.t.common.lessThan(ui.fmt.money(1)) : ui.fmt.money(Math.round(amount));
}

function payerList(ui: Ui, payers: readonly PayerChange[]): string {
  return payers.map((payer) => ui.t.whoPays.payerChange(ui.text(payer.label), ui.fmt.money(Math.abs(payer.change)), payer.change > 0)).join(", ");
}

// ---------------------------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------------------------

export interface WhoPaysSectionProps {
  who: WhoPays;
  /** The simulation of the whole budget the figures are from. */
  whole: SimulationResult;
  /** The scope shown; undefined for the pack's first. */
  scope: string | undefined;
  onScope(scope: string | undefined): void;
}

export function WhoPaysSection({ who, whole, scope: scopeId, onScope }: WhoPaysSectionProps) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const file = pack.incidence;
  const chart = chartOf(pack, who, scopeId);
  if (!file || !chart) return null;
  const noise = noiseLevel(whole.baseline);
  const scopeLabel = ui.text(chart.scope.label);
  const share = (fraction: number): string => fmt.percent(fraction, { digits: 1 });
  const perUnit = perUnitOf(ui);
  const top = chart.rows[chart.rows.length - 1];
  const bottom = chart.rows[0];
  const paysOf = (row: Chart["rows"][number]): string =>
    Math.abs(row.change) > 0.0005 ? t.whoPays.instead(share(row.shareReform), share(row.shareToday)) : share(row.shareReform);
  // The line of changes under each row, once the measures change what a group pays or its share.
  const anyChange = chart.rows.some((row) => Math.abs(row.delta) > noise || Math.abs(row.change) > 0.0005);
  const outside = chart.result.payers.reduce((sum, payer) => sum + payer.reform, 0);
  const measures = measuresOf(pack, who, chart.scope.id, noise);
  const label = (id: string): string => ui.text(pack.policies.find((policy) => policy.id === id)?.label);
  const lines = statementOf(pack, who);
  const statementChanged = Math.abs(who.statement.reform - who.statement.today) > noise;
  const hasFrom = chart.rows.some((row) => row.from !== undefined);

  return (
    <section className="whopays" id="who-pays" aria-labelledby="who-pays-title" tabIndex={-1}>
      <header className="section-head">
        <h2 id="who-pays-title">{t.whoPays.title}</h2>
        <p>{t.whoPays.intro}</p>
      </header>

      {file.scopes.length > 1 && (
        <div className="whopays__scopes" role="group" aria-label={t.whoPays.scopes}>
          {file.scopes.map((option, index) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === chart.scope.id}
              onClick={() => onScope(index === 0 ? undefined : option.id)}
            >
              {ui.text(option.label)}
            </button>
          ))}
        </div>
      )}

      <div className="whopays__body">
        <div className="whopays__chart">
          {/* Every share below is a share of the part that can be spread, which this sentence names first. */}
          <p className="whopays__headline">
            {t.whoPays.headline(
              scopeLabel,
              fmt.money(chart.result.groupsTotal.reform),
              fmt.money(chart.result.total.reform),
              ui.text(top.label),
              paysOf(top),
              share(top.incomeShare),
              ui.text(bottom.label),
              paysOf(bottom),
              share(bottom.incomeShare),
            )}{" "}
            {/* The shares are estimates of studies, not counts: said beside them, as elsewhere on the page. */}
            <span className="whopays__quality">
              <span className="visually-hidden">{t.whoPays.quality}: </span>
              <QualityBadge quality={file.population.quality} />
            </span>
          </p>

          <ol className="wp-rows" aria-label={t.whoPays.listLabel(scopeLabel)}>
            {chart.rows.map((row) => {
              const moved = Math.abs(row.change) > 0.0005;
              const paid = Math.abs(row.delta) > noise;
              return (
                <li key={row.id} className={`wp-row${moved ? " is-moved" : ""}`}>
                  <p className="wp-row__name">
                    <strong>{ui.text(row.label)}</strong>
                    {row.from !== undefined && <span className="wp-row__from"> {t.whoPays.from(fmt.money(row.from))}</span>}
                  </p>
                  <div className="wp-row__plot" aria-hidden="true">
                    <div className="wp-row__bar" style={{ width: percentOf(row.shareReform, chart.max) }} />
                    {moved && <div className="wp-row__today" style={{ left: percentOf(row.shareToday, chart.max) }} />}
                    <div className="wp-row__income" style={{ left: percentOf(row.incomeShare, chart.max) }} />
                  </div>
                  <p className="wp-row__text">
                    <span>{moved ? t.whoPays.paysChanged(share(row.shareReform), share(row.shareToday)) : t.whoPays.pays(share(row.shareReform))}</span>
                    <span className="wp-row__sep" aria-hidden="true"> · </span>
                    <span>{t.whoPays.has(share(row.incomeShare))}</span>
                    {row.rateReform !== undefined && (
                      <>
                        <span className="wp-row__sep" aria-hidden="true"> · </span>
                        <span>{t.whoPays.ofIncome(share(row.rateReform))}</span>
                      </>
                    )}
                  </p>
                  {anyChange && (
                    <p className="wp-row__change">
                      {moved && (
                        <>
                          <span className="wp-row__points">{t.whoPays.points(fmt.number(row.change * 100, { digits: 1, signed: true }))}</span>
                          <span className="wp-row__sep" aria-hidden="true"> · </span>
                        </>
                      )}
                      <span>{paid ? t.whoPays.perUnitChange(perUnitMoney(ui, row.deltaPerUnit), row.delta > 0, perUnit) : t.whoPays.same}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="wp-axis" aria-hidden="true">
            <span>{fmt.percent(0, { digits: 0 })}</span>
            <span>{fmt.percent(chart.max, { digits: 0 })}</span>
          </div>
          <p className="whopays__key">{t.whoPays.key(ui.period)}</p>
          {hasFrom && <p className="whopays__ranking">{t.whoPays.ranking(ui.text(file.population.ranking))}</p>}
          {outside > noise && <p className="whopays__outside">{t.whoPays.outside(fmt.money(outside))}</p>}

          {(measures.counted.length > 0 || measures.outside.length > 0) && (
            <div className="whopays__measures">
              {measures.counted.length > 0 && <p>{t.whoPays.counted(measures.counted.map(label).join(", "))}</p>}
              {measures.outside.length > 0 && (
                <>
                  <p>{t.whoPays.notCounted}</p>
                  <ul>
                    {measures.outside.map((entry) => {
                      const result = whole.policies.find((policy) => policy.id === entry.policy);
                      // Only the sentences of the parts this scope shows.
                      const notes = result ? notesOf(pack, result, noise, false, chart.scope.id) : [];
                      return (
                        <li key={entry.policy}>
                          {t.whoPays.outsideMeasure(label(entry.policy), payerList(ui, entry.payers))}
                          {notes.map((note) => (
                            <span key={ui.text(note)} className="whopays__note"> {ui.text(note)}</span>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        <div className="whopays__statement">
          <h3>{t.whoPays.statementTitle}</h3>
          <p className="whopays__statement-intro">{t.whoPays.statementIntro(fmt.money(who.statement.reform))}</p>
          <ul className="wp-lines">
            {lines.map((line) => {
              const name = line.label ? ui.text(line.label) : t.whoPays.groupsLine;
              const changed = Math.abs(line.reform - line.today) > noise;
              return (
                <li key={line.payer ?? "groups"} className={`wp-line${line.payer ? "" : " wp-line--groups"}`}>
                  <details>
                    <summary>
                      <span className="wp-line__name">{name}</span>
                      <span className="wp-line__amount">{fmt.money(line.reform)}</span>
                      {changed && <span className="wp-line__today">{t.whoPays.today(fmt.money(line.today), ui.period)}</span>}
                      <span className="visually-hidden">, {t.whoPays.itemsOf(name)}</span>
                    </summary>
                    <ul className="wp-items">
                      {line.items.map((item) => (
                        <li key={item.node}>
                          <span>{itemLabel(ui, item.node)}</span>
                          <span className="wp-items__amount">
                            {fmt.money(item.reform)}
                            {Math.abs(item.reform - item.today) > noise && <span className="muted"> ({t.whoPays.today(fmt.money(item.today), ui.period)})</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {line.note && <p className="wp-line__note">{ui.text(line.note)}</p>}
                  </details>
                  {!line.payer && <p className="wp-line__covers">{t.whoPays.chartCovers(scopeLabel, fmt.money(chart.result.groupsTotal.reform))}</p>}
                </li>
              );
            })}
            <li className="wp-line wp-line--total">
              <span className="wp-line__name">{t.whoPays.total}</span>
              <span className="wp-line__amount">{fmt.money(who.statement.reform)}</span>
              {statementChanged && <span className="wp-line__today">{t.whoPays.today(fmt.money(who.statement.today), ui.period)}</span>}
            </li>
          </ul>
        </div>
      </div>

      <details className="whopays__method">
        <summary>{t.whoPays.methodTitle}</summary>
        {chart.scope.note && <p>{ui.text(chart.scope.note)}</p>}
        <p>{ui.text(file.note)}</p>
        {file.population.note && <p>{ui.text(file.population.note)}</p>}
        {file.income.note && <p>{ui.text(file.income.note)}</p>}
        {Object.entries(file.distributions ?? {}).map(([id, entry]) => (
          <p key={id}>{t.whoPays.computed(ui.text(entry.note))}</p>
        ))}
        <h3 className="whopays__sources-title">{t.whoPays.sources}</h3>
        <SourceList ids={sourcesOf(pack, chart.scope.id)} />
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The line near the top
// ---------------------------------------------------------------------------------------------

export function WhoPaysTeaser({ who, scope }: { who: WhoPays; scope: string | undefined }) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const chart = chartOf(pack, who, scope);
  if (!chart) return null;
  const share = (fraction: number): string => fmt.percent(fraction, { digits: 1 });
  const scopeLabel = ui.text(chart.scope.label);
  const moved = largestChange(chart);
  const top = chart.rows[chart.rows.length - 1];
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (jumpToSection("who-pays")) event.preventDefault();
  };
  return (
    <p className="debt-teaser whopays-teaser">
      <a href="#who-pays" onClick={follow}>
        <span>{t.whoPays.teaserLink}</span>
        <ArrowDown size={14} />
      </a>{" "}
      <span className="debt-teaser__figure">
        {moved
          ? t.whoPays.teaserChanged(ui.text(moved.label), share(moved.shareReform), share(moved.shareToday), scopeLabel)
          : t.whoPays.teaserToday(ui.text(top.label), share(top.shareToday), scopeLabel)}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// The strip of one measure
// ---------------------------------------------------------------------------------------------

/** What one measure changes for whom, from its result for the whole budget; undefined if it changes no revenue. */
export function stripFor(pack: CountryPack, whole: PolicyResult | undefined, noise: number, always = false): Strip | undefined {
  if (!whole || !pack.incidence) return undefined;
  return stripOf(pack, measureWhoPays(pack, whole), whole, noise, always);
}

/**
 * The strip: on a card's face a line of columns, one per group, with the first and the last group's
 * change in words; in the details and the curve editor a table with every group.
 */
export function WhoPaysStrip({ strip, compact = false, table = false }: { strip: Strip; compact?: boolean; table?: boolean }) {
  const ui = useUi();
  const { t, fmt } = ui;
  const perUnit = perUnitOf(ui);
  const change = (value: number): string =>
    value === 0 ? fmt.money(0) : `${perUnitMoney(ui, value)} ${value > 0 ? t.whoPays.stripMore : t.whoPays.stripLess}`;
  const scale = strip.maxPerUnit > 0 ? strip.maxPerUnit : 1;
  const first = strip.groups[0];
  const last = strip.groups[strip.groups.length - 1];

  return (
    <div className={`wp-strip${compact ? " wp-strip--compact" : ""}`}>
      {strip.spread && compact && (
        <>
          <p className="wp-strip__title">{t.whoPays.stripTitle(perUnit)}</p>
          <div className="wp-strip__cols" aria-hidden="true">
            {strip.groups.map((group) => (
              <span key={group.id} className="wp-strip__col">
                {group.perUnit !== 0 && (
                  <span
                    className={`wp-strip__fill${group.perUnit < 0 ? " is-less" : ""}`}
                    style={{ height: `${Math.max(4, (Math.abs(group.perUnit) / scale) * 50)}%` }}
                  />
                )}
              </span>
            ))}
          </div>
          <p className="wp-strip__line">
            {t.whoPays.stripLine(ui.text(first.label), change(first.perUnit), ui.text(last.label), change(last.perUnit))}
          </p>
        </>
      )}
      {(strip.spread || table) && !compact && (
        <table className="wp-table">
          {/* The heading above the table says what it is; the caption names it for screen readers. */}
          <caption className="visually-hidden">{t.whoPays.stripTitle(perUnit)}</caption>
          <thead>
            <tr>
              <th scope="col">{t.whoPays.columnGroup}</th>
              <th scope="col">{t.whoPays.columnPerUnit(perUnit)}</th>
              <th scope="col">{t.whoPays.columnTotal}</th>
            </tr>
          </thead>
          <tbody>
            {strip.groups.map((group) => (
              <tr key={group.id}>
                <th scope="row">{ui.text(group.label)}</th>
                <td>
                  <span className="wp-table__bar" aria-hidden="true">
                    <span
                      className={group.perUnit < 0 ? "is-less" : undefined}
                      style={{ width: `${(Math.abs(group.perUnit) / scale) * 100}%` }}
                    />
                  </span>
                  <span className="wp-table__value">{change(group.perUnit)}</span>
                </td>
                <td className="wp-table__total">{fmt.money(group.change, { signed: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {strip.payers.length > 0 && (
        <p className="wp-strip__payers">
          {t.whoPays.stripOutside} {payerList(ui, strip.payers)}.
        </p>
      )}
      {!strip.spread && !table && strip.payers.length === 0 && <p className="wp-strip__payers">{t.whoPays.stripNone}</p>}
      {(!compact || !strip.spread) &&
        strip.notes.map((note) => (
          <p key={ui.text(note)} className="wp-strip__note">
            {ui.text(note)}
          </p>
        ))}
    </div>
  );
}

