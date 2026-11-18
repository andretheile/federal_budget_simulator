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
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { directionOf, directionOfNode, noiseLevel } from "../app/policyModel.ts";
import { useUi } from "../app/ui.ts";
import { perCapita, shareOfGdp, type SimulationResult } from "../engine/index.ts";
import { AnimatedNumber, Delta } from "./primitives.tsx";

export function Scoreboard({ result }: { result: SimulationResult }) {
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
  const change = balance - result.baseline.balance;
  const direction = directionOf(change, noise);
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
      )
    : t.scoreboard.announce(
        signedMoney(balance),
        stateWord,
        enabled === 0 ? t.scoreboard.asToday : `${signedMoney(change)} ${t.scoreboard.vsToday}, ${directionWord}.`,
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
        className={`scoreboard${stuck ? " is-stuck" : ""}${singleLevel ? " scoreboard--level" : ""}`}
        style={reserved ? { minHeight: reserved } : undefined}
        aria-label={t.scoreboard.label}
      >
        <div ref={band} className="scoreboard__band">
          <div className="scoreboard__inner page">
            <div className="scoreboard__main">
              <p className="scoreboard__label">
                {singleLevel
                  ? t.scoreboard.levelLabel(levelName(result.level as Exclude<typeof result.level, "all">))
                  : t.scoreboard.balanceLabel(pack.country.baseYear)}
              </p>
              <p className="scoreboard__hero">
                <AnimatedNumber
                  className="scoreboard__number"
                  value={singleLevel ? change : balance}
                  format={signedMoney}
                />
                <span className={`state state--${state}`} data-testid="balance-state">
                  {stateWord}
                </span>
              </p>
              {singleLevel ? (
                <p className="scoreboard__change">
                  {extras}
                  <span className="scoreboard__note">{t.scoreboard.noLevelBalance}</span>
                </p>
              ) : (
                <p className="scoreboard__change">
                  {enabled === 0 ? (
                    <span className="muted">{t.scoreboard.asToday}</span>
                  ) : (
                    <>
                      <span>
                        <Delta amount={change} direction={direction} text={signedMoney(change)} animate={signedMoney} />{" "}
                        {t.scoreboard.vsToday}
                      </span>
                      {extras}
                    </>
                  )}
                </p>
              )}
            </div>

            <dl className="scoreboard__sides">
              {sides.map(({ side, value, delta, direction: sideDirection }) => (
                <div key={side} className="scoreboard__side">
                  <dt>{t.common[side]}</dt>
                  <dd>
                    <AnimatedNumber className="scoreboard__amount" value={value} format={(v) => fmt.money(v)} />
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
                  <AnimatedNumber
                    value={balance}
                    format={(value) => t.scoreboard.ofGdp(fmt.percent(shareOfGdp(pack, value), { signed: true }))}
                  />
                </li>
                <li>
                  <AnimatedNumber
                    value={balance}
                    format={(value) => t.scoreboard.perInhabitant(signedMoney(perCapita(pack, value)))}
                  />
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
