/**
 * What changed: a waterfall from today's balance through every measure that is switched on to the
 * simulated balance. Rows are horizontal so long measure names stay readable on a phone; all bars
 * share one scale, so the size of a measure against the deficit is what the eye compares.
 *
 * For a single level of government there is no balance to start from: the chart then starts at
 * "as today" and ends at the total change for that level.
 */
import { directionOf, noiseLevel } from "../app/policyModel.ts";
import { useUi } from "../app/ui.ts";
import type { SimulationResult } from "../engine/index.ts";
import { BlockerIcon } from "./icons.tsx";
import { Delta } from "./primitives.tsx";

interface Step {
  key: string;
  label: string;
  kind: "anchor" | "step";
  /** The bar runs from `from` to `to` on the balance scale. */
  from: number;
  to: number;
  /** Ends of the range of the estimate, on the same scale. */
  low: number;
  high: number;
  policyId?: string;
  blocker?: boolean;
}

export function Waterfall({ result, onShowPolicy }: { result: SimulationResult; onShowPolicy(id: string): void }) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const noise = noiseLevel(result.baseline);
  const singleLevel = result.level !== "all";
  const start = singleLevel ? 0 : result.baseline.balance;
  const signed = (value: number): string => fmt.money(value, { signed: true });

  const steps: Step[] = [];
  if (!singleLevel)
    steps.push({ key: "today", label: t.common.baseYear(ui.period), kind: "anchor", from: 0, to: start, low: start, high: start });
  let running = start;
  for (const entry of result.policies) {
    const policy = pack.policies.find((candidate) => candidate.id === entry.id);
    steps.push({
      key: entry.id,
      label: ui.text(policy?.label) || entry.id,
      kind: "step",
      from: running,
      to: running + entry.delta.balance,
      low: running + entry.low.balance,
      high: running + entry.high.balance,
      policyId: entry.id,
      blocker: policy?.catches.some((item) => item.severity === "blocker"),
    });
    running += entry.delta.balance;
  }
  const empty = result.policies.length === 0;
  if (!empty) {
    steps.push({
      key: "result",
      label: singleLevel ? t.waterfall.totalChange : t.common.simulated,
      kind: "anchor",
      from: 0,
      to: running,
      low: start + result.deltaLow.balance,
      high: start + result.deltaHigh.balance,
    });
  }

  const values = steps.flatMap((step) => [step.from, step.to, step.low, step.high]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const at = (value: number): number => ((value - min) / span) * 100;
  const zeroAt = at(0);
  // The label of the zero line stands to the left of the line when that is in the right half, and
  // to its right when the line is at the left edge, where a centred label would stick out of the plot.
  const zeroSide = zeroAt > 50 ? " is-left" : zeroAt < 15 ? " is-right" : "";

  return (
    <section className="waterfall" aria-labelledby="waterfall-title" id="what-changed">
      <header className="section-head">
        <h2 id="waterfall-title">{t.waterfall.title}</h2>
        <p>{singleLevel ? t.waterfall.introLevel : t.waterfall.intro(ui.period)}</p>
      </header>

      {steps.length > 0 && (
        <ol className="wf">
          {steps.map((step, index) => {
            const delta = step.to - step.from;
            const amount = step.kind === "anchor" ? step.to : delta;
            const direction = directionOf(delta, noise);
            const hasRange = Math.abs(step.high - step.low) > noise;
            const next = steps[index + 1];
            const previous = steps[index - 1];
            return (
              <li key={step.key} className={`wf__row wf__row--${step.kind}`}>
                <span className="wf__label">
                  {step.policyId ? (
                    <button type="button" className="wf__link" onClick={() => onShowPolicy(step.policyId!)}>
                      {step.label}
                    </button>
                  ) : (
                    <strong>{step.label}</strong>
                  )}
                  {step.blocker && (
                    <span className="catch-tag catch-tag--blocker catch-tag--small">
                      <BlockerIcon size={11} />
                      {t.policies.severity.blocker}
                    </span>
                  )}
                </span>
                <span className="wf__plot" aria-hidden="true">
                  <span className="wf__zero" style={{ left: `${zeroAt}%` }} />
                  <span
                    className={`wf__bar wf__bar--${step.kind === "anchor" ? "anchor" : direction}`}
                    style={{
                      left: `${at(Math.min(step.from, step.to))}%`,
                      width: `${(Math.abs(delta) / span) * 100}%`,
                    }}
                  />
                  {hasRange && (
                    <span
                      className="wf__whisker"
                      style={{
                        left: `${at(Math.min(step.low, step.high))}%`,
                        width: `${(Math.abs(step.high - step.low) / span) * 100}%`,
                      }}
                    />
                  )}
                  {/* Connectors: down from the previous row's end into this bar, and from this bar's end down to the next row. */}
                  {previous && step.kind === "step" && (
                    <span className="wf__connector wf__connector--in" style={{ left: `${at(step.from)}%` }} />
                  )}
                  {previous && step.kind === "anchor" && (
                    <span className="wf__connector wf__connector--in" style={{ left: `${at(step.to)}%` }} />
                  )}
                  {next && <span className="wf__connector wf__connector--out" style={{ left: `${at(step.to)}%` }} />}
                </span>
                <span className="wf__value">
                  {step.kind === "anchor" ? (
                    <strong>{signed(amount)}</strong>
                  ) : (
                    <Delta amount={amount} direction={direction} text={signed(amount)} />
                  )}
                  {hasRange && (
                    <span className="wf__range">
                      {step.kind === "anchor"
                        ? t.common.range(signed(step.low), signed(step.high))
                        : t.common.range(signed(step.low - step.from), signed(step.high - step.from))}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
          <li className="wf__row wf__row--axis" aria-hidden="true">
            <span className="wf__label" />
            <span className="wf__plot">
              <span className="wf__zero" style={{ left: `${zeroAt}%` }} />
              <span className={`wf__zero-label${zeroSide}`} style={{ left: `${zeroAt}%` }}>
                {singleLevel ? t.waterfall.zeroLevel(ui.period) : t.waterfall.zero}
              </span>
            </span>
            <span className="wf__value" />
          </li>
        </ol>
      )}

      {empty ? (
        <p className="waterfall__empty">{t.waterfall.empty}</p>
      ) : (
        <p className="waterfall__notes">
          {steps.some((step) => Math.abs(step.high - step.low) > noise) && `${t.waterfall.rangeNote} `}
          {result.policies.length > 1 && t.waterfall.orderNote}
        </p>
      )}
    </section>
  );
}
