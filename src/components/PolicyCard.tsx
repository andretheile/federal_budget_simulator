/**
 * One measure. Collapsed it shows the label, a short summary, the switch and what the measure
 * would do on its own at its current settings, put in proportion. Expanded it adds the controls,
 * the estimate (range, data quality, who is affected), the split by level of government, the
 * catches, the budget items it changes and the sources.
 */
import { memo, useMemo, type ReactNode } from "react";
import { colorOf, layoutBudget } from "../app/budgetModel.ts";
import { curveSettings } from "../app/curveModel.ts";
import {
  bearers,
  directionOf,
  directionOfNode,
  effectByLevel,
  insightOf,
  movesBetweenLevels,
  noiseLevel,
  settingsOf,
  shiftOf,
  sortedCatches,
  sourcesOf,
  type Direction,
  type LevelEffect,
  type PolicyInsight,
} from "../app/policyModel.ts";
import { sliderDirection } from "../app/sliderModel.ts";
import { useUi, type Ui } from "../app/ui.ts";
import {
  findNode,
  resolveParams,
  simulatePolicy,
  type Catch,
  type CurvePoint,
  type LevelFilter,
  type LevelId,
  type NumberParam,
  type ParamValue,
  type ParamValues,
  type Policy,
  type PolicyResult,
  type PolicyState,
  type SimulationWarning,
  type Totals,
} from "../engine/index.ts";
import { CurveEntry } from "./CurvePreview.tsx";
import { BlockerIcon, ChevronDown, InfoIcon, ShiftIcon, WarningIcon } from "./icons.tsx";
import { GroupsControl, NumberControl } from "./ParamControls.tsx";
import { Delta, QualityBadge, SourceList, Switch } from "./primitives.tsx";

export interface PolicyCardProps {
  policy: Policy;
  /** The policy's entry in the scenario, if it has one. */
  state: PolicyState | undefined;
  /** Its result inside the current scenario, if it is switched on. */
  inScenario: PolicyResult | undefined;
  /** Ids of the measures that are switched on and applied before this one, joined by commas. */
  enabledBefore: string;
  level: LevelFilter;
  /** Base-year totals of the current view. */
  baseline: Totals;
  expanded: boolean;
  onToggle(id: string, enabled: boolean): void;
  onParam(id: string, param: string, value: ParamValue): void;
  onExpand(id: string, expanded: boolean): void;
  /** Show a budget item in the budget view. */
  onShowNode(nodeId: string): void;
  /** Open the editor for one of the measure's curve parameters. */
  onEditCurve(id: string, param: string): void;
  /** Names of the pack's collections the measure belongs to, shown as badges. */
  collections?: readonly string[];
  /** Said when the goal of the bar leaves this measure out: that it does not count, and why. */
  goalHint?: string;
}

const SEVERITY_ICON: Record<Catch["severity"], (props: { size?: number }) => ReactNode> = {
  blocker: BlockerIcon,
  major: WarningIcon,
  minor: InfoIcon,
};

function directionWord(ui: Ui, direction: Direction, level: LevelFilter): string {
  const { common } = ui.t;
  if (level === "all")
    return direction === "improve" ? common.improves : direction === "worsen" ? common.worsens : common.noEffect;
  return direction === "improve" ? common.relieves : direction === "worsen" ? common.burdens : common.noEffectLevel;
}

function listOf(ui: Ui, items: string[]): string {
  try {
    return new Intl.ListFormat(ui.language, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

export const PolicyCard = memo(function PolicyCard({
  policy,
  state,
  inScenario,
  enabledBefore,
  level,
  baseline,
  expanded,
  onToggle,
  onParam,
  onExpand,
  onShowNode,
  onEditCurve,
  collections,
  goalHint,
}: PolicyCardProps) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const enabled = state?.enabled === true;
  const given = state?.params;
  const params = useMemo(() => resolveParams(pack, policy, given), [pack, policy, given]);
  const alone = useMemo(() => simulatePolicy(pack, policy.id, params, level), [pack, policy.id, params, level]);
  const levels = useMemo(() => effectByLevel(pack, policy.id, params), [pack, policy.id, params]);
  // The same measure with no level filter: cost shifts are named with their full amounts.
  const whole = useMemo(
    () => (level === "all" ? alone : simulatePolicy(pack, policy.id, params, "all")),
    [pack, policy.id, params, level, alone],
  );
  if (!alone || !whole) return null;

  const noise = noiseLevel(baseline);
  const insight = insightOf(pack, alone, baseline);
  // Within floating-point noise an effect is zero, and is written as a plain zero.
  const balanceShown = insight.direction === "neutral" ? 0 : insight.balance;
  const label = ui.text(policy.label);
  const titleId = `policy-${policy.id}-title`;
  const panelId = `policy-${policy.id}-panel`;
  const signed = (value: number): string => fmt.money(value, { signed: true });
  const combined =
    inScenario &&
    Math.abs(inScenario.delta.balance - alone.delta.balance) > Math.max(noise, Math.abs(alone.delta.balance) * 0.005);
  const warnings = warningLines(ui, enabled && inScenario ? inScenario.warnings : alone.warnings, enabledBefore);
  const catches = sortedCatches(policy);
  const settingCount = settingsOf(policy).length;
  const shifts = whole.effects.flatMap((effect) => {
    const shift = shiftOf(effect);
    return shift && Math.abs(shift.delta) > noise ? [{ effect, shift }] : [];
  });
  // Several effects may shift to the same item; the card names each receiving item once.
  const shiftTargets = [...new Set(shifts.map(({ shift }) => shift.target))].map((target) => {
    const parts = shifts.filter(({ shift }) => shift.target === target);
    const amount = parts.reduce((sum, { shift }) => sum + shift.delta, 0);
    const side = parts[0].shift.side;
    // The pack's words for what is passed on, if all parts that land here say the same.
    const labels = [...new Set(parts.map(({ effect }) => policy.effects[effect.index]?.shift?.label).map((label) => (label ? ui.text(label) : "")))];
    return {
      target,
      amount,
      side,
      heading: labels.length === 1 && labels[0] ? labels[0] : undefined,
      effects: parts.map(({ effect }) => effect.index),
    };
  });
  const showLevels = levels.length > 1 && (shifts.length > 0 || movesBetweenLevels(levels, noise));
  const curves = curveSettings(policy);

  return (
    <li className={`policy${enabled ? " is-on" : ""}${expanded ? " is-open" : ""}`} id={`policy-${policy.id}`}>
      <article aria-labelledby={titleId}>
        <div className="policy__top">
          <p className="policy__tags">
            <span className="policy__topic">{t.policies.topics[policy.topic]}</span>
            {collections && collections.length > 0 && (
              <>
                <span className="visually-hidden">. {t.policies.partOf}: </span>
                {collections.map((name) => (
                  <span key={name} className="policy__badge" title={name}>
                    {name}
                  </span>
                ))}
              </>
            )}
          </p>
          <Switch checked={enabled} label={t.policies.switchOn(label)} onChange={(next) => onToggle(policy.id, next)} />
        </div>
        <h3 className="policy__title" id={titleId} onClick={() => onExpand(policy.id, !expanded)}>
          {label}
        </h3>
        <p className={`policy__summary${expanded ? "" : " is-clamped"}`}>{ui.text(policy.summary)}</p>

        <div className="policy__impact">
          <p className="policy__caption">
            {level === "all" ? t.policies.alone : t.policies.aloneLevel(ui.levelName(level))}
          </p>
          <p className="policy__figure">
            <Delta
              className="policy__amount"
              amount={balanceShown}
              direction={insight.direction}
              text={signed(balanceShown)}
            />
            <span className="policy__per">{t.common.perYear}</span>
            <span className={`policy__direction policy__direction--${insight.direction}`}>
              {directionWord(ui, insight.direction, level)}
            </span>
          </p>
          {level === "all" && insight.shareOfDeficit !== null && insight.direction !== "neutral" && (
            <Meter insight={insight} share={insight.shareOfDeficit} />
          )}
          {insight.direction !== "neutral" && (
            <p className="policy__proportion">
              {level === "all"
                ? `${t.policies.ofAll(insight.side, fmt.share(insight.shareOfSide))} · ${t.policies.perInhabitant(fmt.money(insight.perInhabitant))}`
                : t.policies.ofLevel(insight.side, fmt.share(insight.shareOfSide))}
            </p>
          )}
          {goalHint && (
            <p className="policy__goal">
              <InfoIcon size={13} />
              <span>{goalHint}</span>
            </p>
          )}
          {/* The reason is written out, not left to a tooltip: a finger or a keyboard would never see that. */}
          {combined && inScenario && (
            <p className="policy__combined">
              {t.policies.combined(signed(inScenario.delta.balance))}{" "}
              <span className="policy__combined-why">{t.policies.combinedHint}</span>
            </p>
          )}
        </div>

        {curves.map((setting) => (
          <CurveEntry
            key={setting.param.id}
            policyLabel={label}
            setting={setting}
            points={params[setting.param.id] as CurvePoint[]}
            onEdit={() => onEditCurve(policy.id, setting.param.id)}
          />
        ))}

        {shiftTargets.map(({ target, amount, side, heading, effects }) => (
          <p key={target} className="policy__shift">
            <ShiftIcon size={14} />
            <span>
              {/* The pack's own words stand on a line of their own; the generic heading leads into the sentence. */}
              {heading ? (
                <strong className="policy__shift-label">{heading}</strong>
              ) : (
                <>
                  <strong>{shiftHeading(ui, side, amount)}:</strong>{" "}
                </>
              )}
              {t.policies.shiftLine(fmt.money(Math.abs(amount)), ui.text(findNode(pack, target)?.label), side, amount > 0)}
              {levelNames(ui, shiftBearers(levels, effects))}
            </span>
          </p>
        ))}

        {showLevels && !expanded && <LevelSplit levels={levels} noise={noise} current={level} compact />}

        {warnings.length > 0 && (
          <ul className="policy__warnings">
            {warnings.map((warning) => (
              <li key={`${warning.text}|${warning.item ?? ""}`}>
                <WarningIcon size={14} />
                <span>
                  {warning.text}
                  {warning.item && <span className="muted"> {t.policies.warningItem(warning.item)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="policy__foot">
          <CatchSummary catches={catches} />
          <button
            type="button"
            className="policy__more"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => onExpand(policy.id, !expanded)}
          >
            {settingCount > 0 ? `${t.policies.settingCount(settingCount)} · ${t.common.details}` : t.common.details}
            <span className="visually-hidden">: {label}</span>
            <ChevronDown size={14} />
          </button>
        </div>

        <div id={panelId} className="policy__panel" hidden={!expanded}>
          {expanded && (
            <PolicyDetails
              policy={policy}
              params={params}
              alone={alone}
              whole={whole}
              insight={insight}
              levels={levels}
              level={level}
              enabled={enabled}
              noise={noise}
              catches={catches}
              onParam={onParam}
              onShowNode={onShowNode}
            />
          )}
        </div>
      </article>
    </li>
  );
});

/**
 * A warning of the engine in plain language. "Already excluded" names the measures that got
 * there first: those applied earlier that exclude groups from the same budget item.
 */
function warningText(ui: Ui, warning: SimulationWarning, enabledBefore: string): string {
  const { pack, t } = ui;
  if (warning.code === "repeated_exclusion") {
    const earlier = new Set(enabledBefore.split(","));
    const names = pack.policies
      .filter(
        (policy) =>
          earlier.has(policy.id) &&
          policy.effects.some((effect) => effect.type === "excludeGroups" && effect.target === warning.node),
      )
      .map((policy) => t.common.quote(ui.text(policy.label)));
    if (names.length > 0) return t.policies.alreadyExcludedBy(listOf(ui, names));
  }
  if (warning.code === "empty_group") return t.policies.warnings.empty_group(pack.country.baseYear);
  return t.policies.warnings[warning.code];
}

/** The engine's warnings as lines for the card; what would read the same is said once. */
function warningLines(ui: Ui, warnings: SimulationWarning[], enabledBefore: string): { text: string; item?: string }[] {
  const seen = new Set<string>();
  const lines: { text: string; item?: string }[] = [];
  for (const warning of warnings) {
    const text = warningText(ui, warning, enabledBefore);
    // "Already excluded" is about the selected groups, whichever budget item it was noticed on.
    const node = warning.code === "repeated_exclusion" || !warning.node ? undefined : findNode(ui.pack, warning.node);
    const item = node ? ui.text(node.label) : undefined;
    const key = `${text}|${item ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ text, item });
  }
  return lines;
}

/** The generic heading of a passed-on part: a cost that reappears is a cost shift, anything else a knock-on effect. */
function shiftHeading(ui: Ui, side: "revenue" | "expenditure", amount: number): string {
  return side === "expenditure" && amount > 0 ? ui.t.policies.shift : ui.t.policies.knockOn;
}

/** The levels of government at which the shifted part of the given effects arrives. */
function shiftBearers(levels: LevelEffect[], effectIndexes: number[]): LevelId[] {
  return bearers(
    levels.map((entry) => ({
      level: entry.level,
      amount: entry.result.effects
        .filter((candidate) => effectIndexes.includes(candidate.index))
        .reduce((sum, effect) => sum + (shiftOf(effect)?.delta ?? 0), 0),
    })),
  );
}

/** The levels of government that carry the direct part of an effect. */
function effectBearers(levels: LevelEffect[], effectIndex: number): LevelId[] {
  return bearers(
    levels.map((entry) => ({
      level: entry.level,
      amount: entry.result.effects.find((candidate) => candidate.index === effectIndex)?.delta ?? 0,
    })),
  );
}

function levelNames(ui: Ui, ids: LevelId[]): string {
  return ids.length > 0
    ? ` (${listOf(
        ui,
        ids.map((id) => ui.levelName(id)),
      )})`
    : "";
}

/** The size of a measure against the base year's deficit, as a thin meter with the share in words. */
function Meter({ insight, share }: { insight: PolicyInsight; share: number }) {
  const { pack, t, fmt } = useUi();
  const text = t.policies.ofDeficit(fmt.share(share), pack.country.baseYear);
  return (
    <div className={`meter meter--${insight.direction}${share > 1 ? " is-over" : ""}`}>
      <span className="meter__track" role="img" aria-label={t.policies.meterLabel(fmt.share(share), pack.country.baseYear)}>
        <span className="meter__fill" style={{ width: `${Math.min(1, share) * 100}%` }} />
      </span>
      <span className="meter__text" aria-hidden="true">
        {text}
      </span>
    </div>
  );
}

/** What the measure does to each level of government: who is relieved and who pays. */
function LevelSplit({
  levels,
  noise,
  current,
  compact = false,
}: {
  levels: LevelEffect[];
  noise: number;
  current: LevelFilter;
  compact?: boolean;
}) {
  const ui = useUi();
  const { t, fmt } = ui;
  const shown = compact ? levels.filter((entry) => Math.abs(entry.net) > noise) : levels;
  if (shown.length === 0) return null;
  return (
    <div className={`levels${compact ? " levels--compact" : ""}`}>
      <p className="levels__title">{t.policies.byLevel}</p>
      <ul>
        {shown.map((entry) => {
          const direction = directionOf(entry.net, noise);
          return (
            <li key={entry.level} className={entry.level === current ? "is-current" : undefined}>
              <span className="levels__name">{ui.levelName(entry.level)}</span>
              {direction === "neutral" ? (
                <span className="muted">{t.common.unchanged}</span>
              ) : (
                <Delta amount={entry.net} direction={direction} text={fmt.money(entry.net, { signed: true })}>
                  {!compact && (
                    <span className="levels__word">
                      {direction === "improve" ? t.scoreboard.relief : t.scoreboard.burden}
                    </span>
                  )}
                </Delta>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** On the collapsed card: the most severe catch by name, and how many more there are. */
function CatchSummary({ catches }: { catches: Catch[] }) {
  const { t } = useUi();
  if (catches.length === 0) return <p className="policy__catches muted">{t.policies.noCatches}</p>;
  const worst = catches[0];
  const WorstIcon = SEVERITY_ICON[worst.severity];
  const blockers = catches.filter((item) => item.severity === "blocker");
  if (blockers.length === 0) {
    return (
      <p className="policy__catches">
        <span className="catch-tag catch-tag--plain">{t.policies.catchCount(catches.length)}</span>
      </p>
    );
  }
  const kinds = [...new Set(blockers.map((item) => t.policies.kind[item.kind]))].join(", ");
  const rest = catches.length - blockers.length;
  return (
    <p className="policy__catches">
      <span className="catch-tag catch-tag--blocker">
        <WorstIcon size={13} />
        {blockers.length > 1 ? `${blockers.length} × ` : ""}
        {t.policies.severity.blocker}: {kinds}
      </span>
      {rest > 0 && <span className="muted">+ {t.policies.moreCatches(rest)}</span>}
    </p>
  );
}

interface PolicyDetailsProps {
  policy: Policy;
  params: ParamValues;
  alone: PolicyResult;
  /** The measure on its own with no level filter. */
  whole: PolicyResult;
  insight: PolicyInsight;
  levels: LevelEffect[];
  level: LevelFilter;
  enabled: boolean;
  noise: number;
  catches: Catch[];
  onParam(id: string, param: string, value: ParamValue): void;
  onShowNode(nodeId: string): void;
}

function PolicyDetails({
  policy,
  params,
  alone,
  whole,
  insight,
  levels,
  level,
  enabled,
  noise,
  catches,
  onParam,
  onShowNode,
}: PolicyDetailsProps) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const layout = layoutBudget(pack);
  const signed = (value: number): string => fmt.money(value, { signed: true });
  const affected = alone.effects.flatMap((effect) => {
    const definition = policy.effects[effect.index];
    if (!effect.affected || effect.affected.threshold === null || definition?.type !== "schedule") return [];
    const distribution = pack.distributions[definition.distribution];
    return distribution ? [{ index: effect.index, units: effect.affected, distribution }] : [];
  });
  /** A threshold is written like the setting it comes from, if it comes from one. */
  const thresholdText = (threshold: number): string => {
    const source = policy.params.find(
      (param): param is NumberParam => param.type === "number" && params[param.id] === threshold,
    );
    return source ? fmt.param(source, threshold) : fmt.number(threshold);
  };
  const sources = sourcesOf(policy);
  /**
   * The range of an amount on a budget item, smaller number first. The engine orders the two ends
   * by what they do to the balance, which for spending is the other way round.
   */
  const amountRange = (a: number, b: number): string => t.common.range(signed(Math.min(a, b)), signed(Math.max(a, b)));

  return (
    <>
      {settingsOf(policy).length > 0 && (
        <section className="policy__section">
          <h4>{t.policies.settings}</h4>
          {!enabled && <p className="policy__hint">{t.policies.previewHint}</p>}
          {/* A kind of parameter without a control here is left at its default and shows nothing. */}
          {policy.params.map((param) =>
            param.type === "number" ? (
              <NumberControl
                key={param.id}
                id={`${policy.id}-${param.id}`}
                param={param}
                value={params[param.id] as number}
                direction={sliderDirection(pack, policy, params, param, level, noise, alone.delta.balance)}
                onChange={(value) => onParam(policy.id, param.id, value)}
              />
            ) : param.type === "groups" ? (
              <GroupsControl
                key={param.id}
                param={param}
                value={params[param.id] as string[]}
                onChange={(value) => onParam(policy.id, param.id, value)}
              />
            ) : null,
          )}
        </section>
      )}

      <section className="policy__section">
        <h4>{t.policies.facts}</h4>
        <dl className="facts">
          <div>
            <dt>{t.policies.rangeFact}</dt>
            <dd>
              {insight.hasRange ? (
                <>
                  {t.common.range(signed(insight.low), signed(insight.high))} {t.common.perYear}
                  <RangeGlyph low={insight.low} value={insight.balance} high={insight.high} />
                </>
              ) : (
                <span className="muted">{t.policies.singleValue}</span>
              )}
            </dd>
          </div>
          {insight.quality && (
            <div>
              <dt>{t.policies.qualityFact}</dt>
              <dd>
                <QualityBadge quality={insight.quality} />
                <span className="muted"> {t.about.qualityMeaning[insight.quality]}</span>
              </dd>
            </div>
          )}
          {affected.map(({ index, units, distribution }) => (
            <div key={index}>
              <dt>{t.policies.affected}</dt>
              <dd>
                {t.policies.affectedValue(fmt.count(units.units), ui.text(distribution.unit), fmt.share(units.share))}
                <span className="facts__sub">
                  {t.policies.threshold(
                    capitalize(ui.text(distribution.variable), ui.language),
                    thresholdText(units.threshold ?? 0),
                  )}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        {levels.length > 1 && <LevelSplit levels={levels} noise={noise} current={level} />}
      </section>

      <section className="policy__section">
        <h4>{t.policies.catches}</h4>
        {catches.length === 0 ? (
          <p className="muted">{t.policies.noCatches}</p>
        ) : (
          <ul className="catches">
            {catches.map((item, index) => {
              const SeverityIcon = SEVERITY_ICON[item.severity];
              return (
                <li key={index} className={`catch catch--${item.severity}`}>
                  <p className="catch__head">
                    <span className="catch__severity">
                      <SeverityIcon size={14} />
                      {t.policies.severity[item.severity]}
                    </span>
                    <span className="catch__kind">{t.policies.kind[item.kind]}</span>
                  </p>
                  <p className="catch__text">{ui.text(item.text)}</p>
                  {item.sources && <SourceList ids={item.sources} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="policy__section">
        <h4>{t.policies.effects}</h4>
        <ul className="effects">
          {whole.effects.map((effect) => {
            const definition = policy.effects[effect.index];
            const node = findNode(pack, effect.target);
            const name = ui.text(node?.label);
            const shift = shiftOf(effect);
            const shiftNode = shift ? findNode(pack, shift.target) : undefined;
            const hasRange = Math.abs(effect.high - effect.low) > noise;
            // Tied to the measure's other effects: its two ends are the measure's, not its own worst and best case.
            const linked = definition?.uncertainty?.basis !== undefined;
            const ends = (low: number, high: number): string =>
              linked ? t.policies.linkedRange(signed(low), signed(high)) : amountRange(low, high);
            const zeroed = (amount: number): number => (Math.abs(amount) <= noise ? 0 : amount);
            return (
              <li key={effect.index} className="effect">
                <button
                  type="button"
                  className="effect__node"
                  onClick={() => onShowNode(effect.target)}
                  aria-label={t.policies.showInBudget(name)}
                >
                  <span className={`swatch cat-${colorOf(layout, effect.target)}`} aria-hidden="true" />
                  <span>{name}</span>
                </button>
                <p className="effect__line">
                  <Delta
                    amount={zeroed(effect.delta)}
                    direction={directionOfNode(effect.side, effect.delta, noise)}
                    text={signed(zeroed(effect.delta))}
                  />{" "}
                  <span className="muted">
                    {t.policies.effectSide(effect.side)}
                    {levelNames(ui, effectBearers(levels, effect.index))}
                    {hasRange && ` · ${ends(effect.low, effect.high)}`}
                    {effect.clamped && ` · ${t.policies.clampedNote}`}
                  </span>{" "}
                  <QualityBadge quality={effect.quality} />
                </p>
                {shift && Math.abs(shift.delta) > noise && shiftNode && (
                  <div className="effect__shift">
                    <p className="effect__shift-title">
                      <ShiftIcon size={14} />
                      {definition?.shift?.label ? ui.text(definition.shift.label) : shiftHeading(ui, shift.side, shift.delta)}
                    </p>
                    <button
                      type="button"
                      className="effect__node"
                      onClick={() => onShowNode(shift.target)}
                      aria-label={t.policies.showInBudget(ui.text(shiftNode.label))}
                    >
                      <span className={`swatch cat-${colorOf(layout, shift.target)}`} aria-hidden="true" />
                      <span>{ui.text(shiftNode.label)}</span>
                    </button>
                    <p className="effect__line">
                      <Delta
                        amount={shift.delta}
                        direction={directionOfNode(shift.side, shift.delta, noise)}
                        text={signed(shift.delta)}
                      />{" "}
                      <span className="muted">
                        {t.policies.effectSide(shift.side)}
                        {levelNames(ui, shiftBearers(levels, [effect.index]))}
                        {Math.abs(shift.high - shift.low) > noise && ` · ${ends(shift.low, shift.high)}`}
                        {shift.clamped && ` · ${t.policies.clampedNote}`}
                      </span>{" "}
                      <QualityBadge quality={shift.quality} />
                    </p>
                    {definition?.shift?.note && <p className="effect__note">{ui.text(definition.shift.note)}</p>}
                    {definition?.shift?.sources && <SourceList ids={definition.shift.sources} />}
                  </div>
                )}
                {definition?.note && <p className="effect__note">{ui.text(definition.note)}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      {sources.length > 0 && (
        <section className="policy__section">
          <h4>{t.common.sources}</h4>
          <SourceList ids={sources} />
        </section>
      )}
    </>
  );
}

function capitalize(text: string, language: string): string {
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
}

/** Where the estimate lies in its range, on a line that also shows zero. */
function RangeGlyph({ low, value, high }: { low: number; value: number; high: number }) {
  const min = Math.min(0, low, value, high);
  const max = Math.max(0, low, value, high);
  const span = max - min || 1;
  const at = (amount: number): string => `${((amount - min) / span) * 100}%`;
  return (
    <span className="range" aria-hidden="true">
      <span className="range__zero" style={{ left: at(0) }} />
      <span
        className="range__line"
        style={{ left: at(Math.min(low, high)), width: `${(Math.abs(high - low) / span) * 100}%` }}
      />
      <span className="range__dot" style={{ left: at(value) }} />
    </span>
  );
}
