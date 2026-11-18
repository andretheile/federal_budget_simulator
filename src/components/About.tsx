/**
 * About the numbers: that these are static first-year estimates, the pack's own method note, what
 * the quality labels mean, the reference values used for ratios, and every source of the pack.
 */
import { useUi } from "../app/ui.ts";
import type { IndicatorId } from "../i18n/messages.ts";
import type { Indicator, Quality } from "../engine/index.ts";
import { QualityBadge, SourceList } from "./primitives.tsx";

const QUALITIES: readonly Quality[] = ["official", "derived", "estimate"];
const INDICATORS: readonly IndicatorId[] = ["gdp", "population", "households", "grossDebt"];
const MONEY_INDICATORS: ReadonlySet<IndicatorId> = new Set<IndicatorId>(["gdp", "grossDebt"]);

export function About() {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const methodology = ui.text(pack.country.methodology).trim();
  const paragraphs = methodology ? methodology.split(/\n\s*\n|\n/).filter((paragraph) => paragraph.trim() !== "") : [];
  const indicators = INDICATORS.flatMap((id) => {
    const indicator: Indicator | undefined = pack.country.indicators[id];
    return indicator ? [{ id, indicator }] : [];
  });
  const sourceIds = Object.keys(pack.sources);

  return (
    <section className="about" aria-labelledby="about-title" id="about">
      <header className="section-head">
        <h2 id="about-title">{t.about.title}</h2>
        <p className="about__lead">{t.about.staticNote}</p>
      </header>

      <div className="about__grid">
        <div className="about__method">
          <h3>{t.about.methodology}</h3>
          {paragraphs.length > 0 ? (
            <div className="about__text">
              {paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          ) : (
            <p className="muted">{t.about.noMethodology}</p>
          )}
        </div>

        <div className="about__side">
          <h3>{t.about.qualityTitle}</h3>
          <dl className="quality-key">
            {QUALITIES.map((quality) => (
              <div key={quality}>
                <dt>
                  <QualityBadge quality={quality} />
                </dt>
                <dd>{t.about.qualityMeaning[quality]}</dd>
              </div>
            ))}
          </dl>

          <h3>{t.about.indicators}</h3>
          <dl className="facts">
            {indicators.map(({ id, indicator }) => (
              <div key={id}>
                <dt>{t.about.indicator[id]}</dt>
                <dd>
                  {MONEY_INDICATORS.has(id) ? fmt.money(indicator.value) : fmt.count(indicator.value)}
                  <span className="muted">
                    {" "}
                    · {indicator.year ?? pack.country.baseYear} · <QualityBadge quality={indicator.quality} />
                  </span>
                  <SourceList ids={indicator.sources} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <details className="about__sources">
        <summary>{t.about.sourcesTitle(sourceIds.length)}</summary>
        <SourceList ids={sourceIds} detailed />
      </details>
    </section>
  );
}
