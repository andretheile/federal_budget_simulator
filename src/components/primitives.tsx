/**
 * Small building blocks shared by the sections: a signed change, a data-quality label, an on/off
 * switch, an animated number and a list of sources.
 */
import type { ReactNode } from "react";
import type { Direction } from "../app/policyModel.ts";
import { useUi, type Ui } from "../app/ui.ts";
import type { LocalizedText, Quality, SourceId } from "../engine/index.ts";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber.ts";
import { Check, ExternalIcon, TriangleDown, TriangleUp } from "./icons.tsx";

/**
 * A change, readable without colour: the triangle and the sign say whether the number went up or
 * down, the colour (and, where there is room, `children`) says what that does to the balance.
 */
export function Delta({
  amount,
  direction,
  text,
  animate,
  children,
  className = "",
}: {
  /** The signed number. It picks the triangle, and is what glides if `animate` is given. */
  amount: number;
  direction: Direction;
  /** The formatted number, with its sign. */
  text: string;
  /** Formats the number while it glides to a new value; without it the text changes at once. */
  animate?(value: number): string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={`delta delta--${direction} ${className}`}>
      {direction !== "neutral" && (amount > 0 ? <TriangleUp size={11} /> : <TriangleDown size={11} />)}
      {animate ? (
        <AnimatedNumber className="delta__value" value={amount} format={animate} />
      ) : (
        <span className="delta__value">{text}</span>
      )}
      {children}
    </span>
  );
}

const QUALITY_LEVEL: Record<Quality, number> = { official: 3, derived: 2, estimate: 1 };

/** The quality label with a three-step mark, so the order of the labels is visible without colour. */
export function QualityBadge({ quality }: { quality: Quality }) {
  const { t } = useUi();
  return (
    <span className="quality" title={t.about.qualityMeaning[quality]}>
      <span className="quality__mark" aria-hidden="true">
        {[1, 2, 3].map((step) => (
          <span key={step} className={step <= QUALITY_LEVEL[quality] ? "is-on" : undefined} />
        ))}
      </span>
      {t.about.quality[quality]}
    </span>
  );
}

export function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  /** Accessible name. */
  label: string;
  onChange(next: boolean): void;
}) {
  const { t } = useUi();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch__text" aria-hidden="true">
        {checked ? t.policies.on : t.policies.off}
      </span>
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb">{checked && <Check size={12} />}</span>
      </span>
    </button>
  );
}

/**
 * A number that glides to its new value. Screen readers get the final value at once from a
 * hidden copy; the moving digits are hidden from them.
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format(value: number): string;
  className?: string;
}) {
  const shown = useAnimatedNumber(value);
  return (
    <span className={className}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="visually-hidden" data-final-value="">
        {format(value)}
      </span>
    </span>
  );
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * A source's note in the language shown. A plain string is shown as it is, in every language: the
 * notes of a pack that has not translated them yet. A localized one is in the language shown, or
 * else in English.
 */
export function noteText(ui: Ui, note: string | LocalizedText): string {
  return typeof note === "string" ? note : ui.text(note);
}

/** Sources by id, as links that open in a new tab. Ids the pack does not know are skipped. Titles stay in the source's own language. */
export function SourceList({ ids, detailed = false }: { ids: readonly SourceId[]; detailed?: boolean }) {
  const ui = useUi();
  const { pack, t, fmt } = ui;
  const known = ids.filter((id) => pack.sources[id]);
  if (known.length === 0) return null;
  return (
    <ul className={`sources${detailed ? " sources--detailed" : ""}`}>
      {known.map((id) => {
        const source = pack.sources[id];
        return (
          <li key={id} id={detailed ? `source-${id}` : undefined}>
            {isWebUrl(source.url) ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
                <ExternalIcon size={12} />
                <span className="visually-hidden"> ({t.common.externalLink})</span>
              </a>
            ) : (
              <span>{source.title}</span>
            )}
            <span className="sources__meta">
              {" "}
              {source.publisher}
              {source.year !== undefined && ` ${source.year}`}
              {detailed && `, ${t.about.accessed(fmt.date(source.accessed))}`}
            </span>
            {detailed && source.note && <span className="sources__note">{noteText(ui, source.note)}</span>}
          </li>
        );
      })}
    </ul>
  );
}
