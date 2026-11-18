/**
 * The controls for a measure's settings: a slider for a number and a choice of groups. Used on the
 * card and in the curve editor.
 */
import { useUi } from "../app/ui.ts";
import { findNode, type GroupsParam, type NumberParam } from "../engine/index.ts";
import { Check } from "./icons.tsx";
import { QualityBadge } from "./primitives.tsx";

export function NumberControl({
  id,
  param,
  value,
  onChange,
}: {
  id: string;
  param: NumberParam;
  value: number;
  onChange(value: number): void;
}) {
  const ui = useUi();
  const { t, fmt } = ui;
  const span = param.max - param.min || 1;
  const at = (amount: number): number => Math.max(0, Math.min(1, (amount - param.min) / span));
  const hasBaseline = param.baseline !== undefined;
  const baselineOnScale = hasBaseline && param.baseline! >= param.min && param.baseline! <= param.max;
  const todayId = `${id}-today`;
  return (
    <div className="param">
      <div className="param__head">
        <label htmlFor={id}>{ui.text(param.label)}</label>
        <output htmlFor={id} className="param__value">
          {fmt.param(param, value)}
        </output>
      </div>
      <div
        className="param__slider"
        style={{ ["--at" as string]: at(value), ["--base" as string]: at(param.baseline ?? param.min) }}
      >
        <input
          id={id}
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          aria-valuetext={fmt.param(param, value)}
          aria-describedby={hasBaseline ? todayId : undefined}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {baselineOnScale && <span className="param__baseline" aria-hidden="true" />}
      </div>
      <div className="param__scale">
        <span aria-hidden="true">{fmt.param(param, param.min)}</span>
        {hasBaseline && (
          <span id={todayId} className="param__today">
            {t.policies.todayValue(fmt.param(param, param.baseline!))}
          </span>
        )}
        <span aria-hidden="true">{fmt.param(param, param.max)}</span>
      </div>
    </div>
  );
}

export function GroupsControl({
  param,
  value,
  onChange,
}: {
  param: GroupsParam;
  value: string[];
  onChange(value: string[]): void;
}) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const node = findNode(pack, param.node);
  const breakdown = node?.breakdowns?.[param.breakdown];
  if (!node || !breakdown) return null;
  const total = breakdown.groups.reduce((sum, group) => sum + group.share, 0) || 1;
  const selected = new Set(value);
  const share = breakdown.groups.reduce((sum, group) => sum + (selected.has(group.id) ? group.share / total : 0), 0);
  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(breakdown.groups.filter((group) => next.has(group.id)).map((group) => group.id));
  };
  return (
    <fieldset className="param param--groups">
      <legend>{ui.text(param.label)}</legend>
      <div className="chips">
        {breakdown.groups.map((group) => {
          const on = selected.has(group.id);
          return (
            <button key={group.id} type="button" className="chip" aria-pressed={on} onClick={() => toggle(group.id)}>
              <span className="chip__box" aria-hidden="true">
                {on && <Check size={12} />}
              </span>
              <span className="chip__label">{ui.text(group.label)}</span>
              <span className="chip__share">
                <span className="visually-hidden">{t.policies.groupShare} </span>
                {fmt.share(group.share / total)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="param__note">
        {selected.size === 0
          ? t.policies.noGroups
          : t.policies.selectedShare(fmt.share(share), breakdown.basis, ui.text(node.label))}
      </p>
      <p className="param__note muted">
        {ui.text(breakdown.label)} · <QualityBadge quality={breakdown.quality} />
        {breakdown.note && ` · ${ui.text(breakdown.note)}`}
      </p>
    </fieldset>
  );
}
