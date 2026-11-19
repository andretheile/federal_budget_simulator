/**
 * The result that stays in view while scrolling.
 *
 * All levels of government together: the balance as the dominant number, in words (deficit or
 * surplus), its change against today, the range, revenue and spending, and the balance per GDP
 * and per inhabitant.
 *
 * A single level: payments between levels are not part of the data, so that level's revenue minus
 * its spending is not its deficit. The headline is then the change against today, with revenue
 * and spending of the level beside it and a note why no balance is shown.
 *
 * Steady: while the curve editor lies right below the scoreboard, the scoreboard must not change
 * its height, or the editor would jump. Its height follows from how its lines wrap, and that
 * depends on the figures: a "1" is narrower than an "8", "Überschuss" is longer than "Defizit",
 * the change line gains a count and a range when the first measure is switched on, and wider
 * figures beside it leave it less room. So in steady mode the figures have digits of equal width
 * (which also keeps them from jittering while a point is dragged), every figure keeps the room of
 * the widest it could become (as many digits as the budget's size allows) and the change line the
 * room of its fullest form: invisible stand-ins stacked under what is shown. How the lines wrap
 * then depends on the width of the window alone, not on the figures.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { directionOf, directionOfNode, noiseLevel } from "../app/policyModel.ts";
import { useUi } from "../app/ui.ts";
import { perCapita, shareOfGdp, type SimulationResult } from "../engine/index.ts";
import { AnimatedNumber, Delta } from "./primitives.tsx";

/** The text with every digit replaced by the widest one: "−119,1 Mrd. €" -> "−888,8 Mrd. €". */
export function widest(text: string, digit = "8"): string {
  return text.replace(/\d/g, digit);
}

/**
 * The largest amount, with eights for digits, that has as many digits as amounts of this size can
 * have: for a balance of −119 billion beside revenue of 2,028 billion, −888.8 billion. A tenth of
 * the larger side is taken into account, so a balance near zero still leaves room for a large change.
 */
export function standIn(reference: number): number {
  const digits = Math.max(1, Math.ceil(Math.log10(Math.abs(reference) + 1)));
  return -(10 ** digits) * 0.8888;
}

/**
 * What is shown, stacked over invisible stand-ins: the box is as large as the largest of them.
 * The stand-ins stay the same while a point is dragged; kept as the same elements, React does not
 * look at them again on every move.
 */
function Slot({ steady, standIns, children }: { steady: boolean; standIns: readonly ReactNode[]; children: ReactNode }) {
  const covers = useMemo(
    () =>
      standIns.map((node, index) => (
        <span key={index} className="slot__stand-in" aria-hidden="true">
          {node}
        </span>
      )),
    [standIns],
  );
  if (!steady) return children;
  return (
    <span className="slot">
      {children}
      {covers}
    </span>
  );
}

export interface ScoreboardProps {
  result: SimulationResult;
  /**
   * The measure whose curve editor is open below the scoreboard, if any: the scoreboard is then
   * steady. The page behind the editor is out of reach, so the only measure that can be switched
   * on or off meanwhile is this one.
   */
  editing?: string;
}

export function Scoreboard({ result, editing }: ScoreboardProps) {
  const steady = editing !== undefined;
  const { pack, t, fmt, levelName } = useUi();
  const band = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const stuckNow = useRef(stuck);
  stuckNow.current = stuck;
  /** Height of the band when it is in its place; the section keeps it while the band floats. */
  const [reserved, setReserved] = useState<number>();

  const noise = noiseLevel(result.baseline);
  const singleLevel = result.level !== "all";
  const balance = result.reform.balance;
  const direction = directionOf(balance - result.baseline.balance, noise);
  // A change within floating-point noise is no change, and is written as a plain zero.
  const change = direction === "neutral" ? 0 : balance - result.baseline.balance;
  const enabled = result.policies.length;
  const signedMoney = (value: number): string => fmt.money(value, { signed: true });

  const low = singleLevel ? result.deltaLow.balance : result.reformLow.balance;
  const high = singleLevel ? result.deltaHigh.balance : result.reformHigh.balance;
  const hasRange = Math.abs(high - low) > noise;
  const range = t.common.range(signedMoney(low), signedMoney(high));

  const balanceState = balance < -noise ? "deficit" : balance > noise ? "surplus" : "balanced";
  const levelState = direction === "improve" ? "relief" : direction === "worsen" ? "burden" : "unchanged";
  const state = singleLevel ? levelState : balanceState;
  const stateWord = singleLevel ? t.scoreboard[levelState] : t.common[balanceState];

  // Other sections stick below the scoreboard and need to know how tall it is.
  useLayoutEffect(() => {
    const element = band.current;
    if (!element) return;
    const publish = (): void => {
      const height = element.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--scoreboard-height", `${Math.round(height)}px`);
      if (!stuckNow.current) setReserved(height);
    };
    publish();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A shadow once the scoreboard has left its place and floats over the content.
  useEffect(() => {
    const element = sentinel.current;
    if (!element || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Tell screen readers the new result once the visitor has stopped moving a control.
  const directionWord =
    t.common[direction === "improve" ? "improves" : direction === "worsen" ? "worsens" : "noEffect"];
  const announcement = singleLevel
    ? t.scoreboard.announceLevel(
        levelName(result.level as Exclude<typeof result.level, "all">),
        signedMoney(change),
        stateWord,
        pack.country.baseYear,
      )
    : t.scoreboard.announce(
        signedMoney(balance),
        stateWord,
        enabled === 0 ? t.scoreboard.asBase(pack.country.baseYear) : `${signedMoney(change)} ${t.scoreboard.vsBase(pack.country.baseYear)}, ${directionWord}.`,
      );
  const [announced, setAnnounced] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => setAnnounced(announcement), 700);
    return () => clearTimeout(timer);
  }, [announcement]);

  const sides = (["revenue", "expenditure"] as const).map((side) => {
    const delta = result.reform[side] - result.baseline[side];
    return { side, value: result.reform[side], delta, direction: directionOfNode(side, delta, noise) };
  });

  // --- the stand-ins of steady mode --------------------------------------------------------------
  // At most the measures switched on besides the edited one, and that one.
  const mostMeasures = result.policies.filter((entry) => entry.id !== editing).length + 1;
  // They depend on today's figures only, not on what changes while a point is dragged.
  const { revenue: baseRevenue, expenditure: baseExpenditure, balance: baseBalance } = result.baseline;
  const standIns = useMemo(() => {
    const largerSide = Math.max(baseRevenue, baseExpenditure);
    const balance = standIn(Math.max(Math.abs(baseBalance), largerSide / 10));
    const money = widest(fmt.money(balance, { signed: true }));
    return {
      money,
      side: widest(fmt.money(-standIn(largerSide))),
      ofGdp: widest(t.scoreboard.ofGdp(fmt.percent(shareOfGdp(pack, balance), { signed: true }))),
      perInhabitant: widest(t.scoreboard.perInhabitant(fmt.money(perCapita(pack, balance), { signed: true }))),
      count: widest(t.scoreboard.measuresOn(mostMeasures)),
      range: `${t.scoreboard.rangeLabel} ${t.common.range(money, money)}`,
    };
  }, [baseRevenue, baseExpenditure, baseBalance, fmt, t, pack, mostMeasures]);
  // The same elements on every render, so that React skips them while a point is dragged.
  const covers = useMemo(() => {
    const stateWords = singleLevel
      ? (["relief", "burden", "unchanged"] as const).map((key) => ({ key, word: t.scoreboard[key] }))
      : (["deficit", "surplus", "balanced"] as const).map((key) => ({ key, word: t.common[key] }));
    return {
      number: [<span className="scoreboard__number">{standIns.money}</span>],
      state: stateWords
        .filter(({ key }) => key !== state)
        .map(({ key, word }) => <span className={`state state--${key}`}>{word}</span>),
      side: [<span className="scoreboard__amount">{standIns.side}</span>],
      ofGdp: [standIns.ofGdp],
      perInhabitant: [standIns.perInhabitant],
      // The room of the fullest change line (a change and a range of the widest figures, and as
      // many measures as can be on), and of the line for none.
      change: (
        <>
          <p className="scoreboard__change slot__stand-in" aria-hidden="true">
            {!singleLevel && (
              <span>
                <Delta amount={-1} direction="worsen" text={standIns.money} /> {t.scoreboard.vsBase(pack.country.baseYear)}
              </span>
            )}
            <span className="scoreboard__count">{standIns.count}</span>
            <span className="scoreboard__range">{standIns.range}</span>
            {singleLevel && <span className="scoreboard__note">{t.scoreboard.noLevelBalance}</span>}
          </p>
          {!singleLevel && mostMeasures === 1 && (
            <p className="scoreboard__change slot__stand-in" aria-hidden="true">
              <span className="muted">{t.scoreboard.asBase(pack.country.baseYear)}</span>
            </p>
          )}
        </>
      ),
    };
  }, [standIns, singleLevel, state, t, mostMeasures]);

  const extras = enabled > 0 && (
    <>
      <span className="scoreboard__count">{t.scoreboard.measuresOn(enabled)}</span>
      {hasRange && (
        <span className="scoreboard__range">
          {t.scoreboard.rangeLabel} {range}
        </span>
      )}
    </>
  );

  return (
    <>
      <div ref={sentinel} className="scoreboard-sentinel" aria-hidden="true" />
      {/* The section keeps its full height in the page; only the band inside it shrinks on a phone
          once it floats, so nothing below jumps. */}
      <section
        className={`scoreboard${stuck ? " is-stuck" : ""}${singleLevel ? " scoreboard--level" : ""}${steady ? " scoreboard--steady" : ""}`}
        style={reserved ? { minHeight: reserved } : undefined}
        aria-label={t.scoreboard.label}
      >
        <div ref={band} className="scoreboard__band">
          <div className="scoreboard__inner page">
            <div className="scoreboard__main">
              <p className="scoreboard__label">
                {singleLevel
                  ? t.scoreboard.levelLabel(levelName(result.level as Exclude<typeof result.level, "all">), pack.country.baseYear)
                  : t.scoreboard.balanceLabel(pack.country.baseYear)}
              </p>
              <p className="scoreboard__hero">
                <Slot steady={steady} standIns={covers.number}>
                  <AnimatedNumber
                    className="scoreboard__number"
                    value={singleLevel ? change : balance}
                    format={signedMoney}
                  />
                </Slot>
                <Slot steady={steady} standIns={covers.state}>
                  <span className={`state state--${state}`} data-testid="balance-state">
                    {stateWord}
                  </span>
                </Slot>
              </p>
              <div className={steady ? "scoreboard__changes" : undefined}>
                {singleLevel ? (
                  <p className="scoreboard__change">
                    {extras}
                    <span className="scoreboard__note">{t.scoreboard.noLevelBalance}</span>
                  </p>
                ) : (
                  <p className="scoreboard__change">
                    {enabled === 0 ? (
                      <span className="muted">{t.scoreboard.asBase(pack.country.baseYear)}</span>
                    ) : (
                      <>
                        <span>
                          <Delta amount={change} direction={direction} text={signedMoney(change)} animate={signedMoney} />{" "}
                          {t.scoreboard.vsBase(pack.country.baseYear)}
                        </span>
                        {extras}
                      </>
                    )}
                  </p>
                )}
                {steady && covers.change}
              </div>
            </div>

            <dl className="scoreboard__sides">
              {sides.map(({ side, value, delta, direction: sideDirection }) => (
                <div key={side} className="scoreboard__side">
                  <dt>{t.common[side]}</dt>
                  <dd>
                    <Slot steady={steady} standIns={covers.side}>
                      <AnimatedNumber className="scoreboard__amount" value={value} format={(v) => fmt.money(v)} />
                    </Slot>
                    {sideDirection !== "neutral" && (
                      <Delta
                        className="scoreboard__side-delta"
                        amount={delta}
                        direction={sideDirection}
                        text={signedMoney(delta)}
                        animate={signedMoney}
                      />
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {!singleLevel && (
              <ul className="scoreboard__ratios">
                <li>
                  <Slot
                    steady={steady}
                    standIns={covers.ofGdp}
                  >
                    <AnimatedNumber
                      value={balance}
                      format={(value) => t.scoreboard.ofGdp(fmt.percent(shareOfGdp(pack, value), { signed: true }))}
                    />
                  </Slot>
                </li>
                <li>
                  <Slot
                    steady={steady}
                    standIns={covers.perInhabitant}
                  >
                    <AnimatedNumber
                      value={balance}
                      format={(value) => t.scoreboard.perInhabitant(signedMoney(perCapita(pack, value)))}
                    />
                  </Slot>
                </li>
              </ul>
            )}
          </div>
        </div>
        <p className="visually-hidden" role="status">
          {announced}
        </p>
      </section>
    </>
  );
}
