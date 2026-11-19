/**
 * The inside of the goal's details dialog, loaded when it is first opened: what the goal is, its
 * amount, level and data quality, for a goal of one level what the measures switched on do at each
 * level, what it leaves out and why, the pack's note on the figure (long, so set in paragraphs),
 * and the sources. The dialog's frame is in GoalBar.tsx.
 */
import { useMemo } from "react";
import { paragraphs } from "../app/paragraphs.ts";
import type { GoalView } from "../app/goalModel.ts";
import { directionOf, noiseLevel } from "../app/policyModel.ts";
import { useUi } from "../app/ui.ts";
import { LEVEL_IDS, simulate, type Goal, type LevelFilter, type Scenario } from "../engine/index.ts";
import detailStyles from "../styles/goal-details.css?inline";
import { asSentence, exclusionsOf, excludedName } from "./GoalBar.tsx";
import { Delta, QualityBadge, SourceList } from "./primitives.tsx";

// The styles travel with the code, as the debt section's do.
if (typeof document !== "undefined" && !document.querySelector("style[data-goal-details]")) {
  const style = document.createElement("style");
  style.dataset.goalDetails = "";
  style.textContent = detailStyles;
  document.head.appendChild(style);
}

function capitalized(text: string, language: string): string {
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
}

export function GoalDetails({ goal, view, scenario }: { goal: Goal; view: GoalView; scenario: Scenario }) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  // For a goal of one level, with measures switched on: each level's change, and the whole state's.
  const levels = useMemo(() => {
    if (goal.level === undefined || view.state === "none") return [];
    const at = (level: LevelFilter) => {
      const result = simulate(pack, { ...scenario, level });
      const change = result.reform.balance - result.baseline.balance;
      return { level, change, direction: directionOf(change, noiseLevel(result.baseline)) };
    };
    return [...LEVEL_IDS.filter((level) => pack.country.levels[level]).map(at), at("all")];
  }, [goal.level, view.state, pack, scenario]);
  const exclusions = exclusionsOf(goal);
  const amountOf = (entry: { node?: string; policy?: string }): number | undefined =>
    view.excluded.find((change) => (entry.policy !== undefined ? change.policy === entry.policy : change.node === entry.node))?.improvement;

  return (
    <div className="goaldetails">
      <p className="goaldetails__description">{ui.text(goal.description)}</p>

      <dl className="facts goaldetails__facts">
        <div>
          <dt>{t.goal.amount}</dt>
          <dd>{t.goal.amountValue(fmt.money(goal.amount), goal.year)}</dd>
        </div>
        <div>
          <dt>{t.goal.levelFact}</dt>
          <dd>{goal.level ? ui.levelName(goal.level) : t.goal.wholeStateName}</dd>
        </div>
        <div>
          <dt>{t.policies.qualityFact}</dt>
          <dd>
            <QualityBadge quality={goal.quality} />
          </dd>
        </div>
      </dl>

      {levels.length > 0 && (
        <section className="goaldetails__section">
          <h3>{t.goal.levelsTitle}</h3>
          <p className="goaldetails__hint">{t.goal.levelsNote}</p>
          <ul className="goaldetails__levels">
            {levels.map(({ level, change, direction }) => (
              <li key={level} className={`${level === goal.level ? "is-goal" : ""}${level === "all" ? " is-total" : ""}`}>
                <span>{level === "all" ? t.goal.wholeStateName : ui.levelName(level)}</span>
                {direction === "neutral" ? (
                  <span className="muted">{t.common.unchanged}</span>
                ) : (
                  <Delta amount={change} direction={direction} text={fmt.money(change, { signed: true })}>
                    {level !== "all" && <span className="goaldetails__word">{direction === "improve" ? t.scoreboard.relief : t.scoreboard.burden}</span>}
                  </Delta>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {exclusions.length > 0 && (
        <section className="goaldetails__section">
          <h3>{t.goal.excludedTitle}</h3>
          <ul className="goaldetails__excluded">
            {exclusions.map((entry) => {
              const amount = amountOf(entry);
              return (
                <li key={entry.policy ?? entry.node}>
                  <p>
                    <strong>{capitalized(excludedName(ui, entry), ui.language)}</strong>
                    {amount !== undefined && <span className="goaldetails__amount"> {fmt.money(amount, { signed: true })}</span>}
                  </p>
                  {entry.reason && <p>{asSentence(ui.text(entry.reason), ui.language)}</p>}
                  {entry.sources && <SourceList ids={entry.sources} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="goaldetails__section">
        <h3>{t.goal.noteTitle}</h3>
        <div className="goaldetails__note">
          {paragraphs(ui.text(goal.note)).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </section>

      <section className="goaldetails__section">
        <h3>{t.common.sources}</h3>
        <SourceList ids={goal.sources} />
      </section>
    </div>
  );
}
