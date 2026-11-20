/**
 * Masthead: what this is, for which country and year, and the controls that apply to the whole
 * page: level of government, language, share and reset.
 */
import { useEffect, useRef, useState } from "react";
import { levelsOf } from "../app/policyModel.ts";
import { useUi } from "../app/ui.ts";
import type { LevelFilter } from "../engine/index.ts";
import { Check, CloseIcon, LinkIcon, ResetIcon } from "./icons.tsx";

export interface HeaderProps {
  level: LevelFilter;
  onLevel(level: LevelFilter): void;
  languages: readonly string[];
  onLanguage(language: string): void;
  /** The address of exactly this scenario. */
  link: string;
  /** Copies the link; resolves to whether it worked. */
  onShare(): Promise<boolean>;
  onReset(): void;
  canReset: boolean;
  /** Ids of all country packs; the switch is only shown if there is more than one. */
  countries: readonly string[];
  onCountry?(id: string): void;
  /** Out of reach while a sheet lies over the page. */
  inert?: boolean;
  /**
   * An imprint or privacy page is shown instead of the simulator: the header keeps the name and the
   * language switch; the level filter, sharing and reset act on the simulator and are left out.
   */
  legal?: boolean;
}

function countryName(id: string, language: string): string {
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(id.toUpperCase()) ?? id.toUpperCase();
  } catch {
    return id.toUpperCase();
  }
}

export function Header({
  level,
  onLevel,
  languages,
  onLanguage,
  link,
  onShare,
  onReset,
  canReset,
  countries,
  onCountry,
  inert = false,
  legal = false,
}: HeaderProps) {
  const ui = useUi();
  const { pack, t, fmt, language } = ui;
  const levels = levelsOf(pack);
  const [shared, setShared] = useState<"copied" | "failed" | null>(null);
  /**
   * Whether the level bar is being worked with the arrow keys. Safari moves the focus from option
   * to option then without treating it as keyboard focus, so the outline needs this to stay.
   */
  const [arrowKeys, setArrowKeys] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const shareButton = useRef<HTMLButtonElement>(null);
  const linkField = useRef<HTMLInputElement>(null);

  const share = async (): Promise<void> => {
    const ok = await onShare();
    setShared(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    // "Copied" goes away by itself. The link shown when copying failed stays until the visitor closes it.
    if (ok) timer.current = setTimeout(() => setShared(null), 2500);
  };

  // Copying failed: put the link under the visitor's hands, focused and selected.
  useEffect(() => {
    if (shared !== "failed") return;
    linkField.current?.focus();
    linkField.current?.select();
  }, [shared]);

  const closeLink = (): void => {
    setShared(null);
    shareButton.current?.focus();
  };

  const options: { id: LevelFilter; name: string }[] = [
    { id: "all", name: t.header.allLevels },
    ...levels.map((id) => ({ id, name: ui.levelName(id) })),
  ];

  return (
    <header className="masthead" inert={inert}>
      <div className="page masthead__inner">
        <div className="masthead__brand">
          <h1 className="masthead__name">{t.app.name}</h1>
          <p className="masthead__country">{t.app.countryYear(ui.text(pack.country.name), pack.country.baseYear)}</p>
        </div>

        <div className="masthead__tools">
          {countries.length > 1 && onCountry && (
            <label className="select">
              <span className="visually-hidden">{t.header.country}</span>
              <select value={pack.country.id} onChange={(event) => onCountry(event.target.value)}>
                {countries.map((id) => (
                  <option key={id} value={id}>
                    {countryName(id, language)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {languages.length > 1 && (
            <div className="langs" role="group" aria-label={t.header.language}>
              {languages.map((code) => (
                <button
                  key={code}
                  type="button"
                  lang={code}
                  aria-pressed={code === language}
                  title={fmt.languageName(code)}
                  onClick={() => onLanguage(code)}
                >
                  {code.toUpperCase()}
                  <span className="visually-hidden"> {fmt.languageName(code)}</span>
                </button>
              ))}
            </div>
          )}

          {!legal && (
            <>
              <button
                ref={shareButton}
                type="button"
                className="tool"
                onClick={() => void share()}
                title={t.header.shareHint}
              >
                {shared === "copied" ? <Check size={15} /> : <LinkIcon size={15} />}
                <span>{shared === "copied" ? t.header.copied : t.header.share}</span>
              </button>
              <button type="button" className="tool" onClick={onReset} disabled={!canReset} title={t.header.resetHint}>
                <ResetIcon size={15} />
                <span>{t.header.reset}</span>
              </button>
            </>
          )}

          {/* The browser would not copy: say so and hand over the link itself, until the visitor closes this. */}
          {shared === "failed" && (
            <div
              className="sharebox"
              onKeyDown={(event) => {
                if (event.key === "Escape") closeLink();
              }}
            >
              <p>{t.header.copyFailed}</p>
              <div className="sharebox__row">
                <input
                  ref={linkField}
                  type="text"
                  readOnly
                  value={link}
                  aria-label={t.header.linkField}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="sharebox__close"
                  onClick={closeLink}
                  aria-label={t.header.close}
                  title={t.header.close}
                >
                  <CloseIcon size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="page masthead__lower">
        <p className="masthead__tagline">{t.app.tagline}</p>
        {levels.length > 1 && !legal && (
          <>
            <fieldset
              className={`levelbar${arrowKeys ? " is-keyboard" : ""}`}
              onKeyDown={(event) => {
                if (event.key.startsWith("Arrow")) setArrowKeys(true);
              }}
              onPointerDown={() => setArrowKeys(false)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setArrowKeys(false);
              }}
            >
              <legend>{t.header.level}</legend>
              <div className="levelbar__options">
                {options.map((option) => (
                  <label key={option.id} className="levelbar__option">
                    <input
                      type="radio"
                      name="level"
                      value={option.id}
                      checked={level === option.id}
                      onChange={() => onLevel(option.id)}
                    />
                    <span>{option.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="select levelselect">
              <span>{t.header.level}</span>
              <select value={level} onChange={(event) => onLevel(event.target.value as LevelFilter)}>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      {/* For screen readers. What is seen: success on the button itself, a failure in the box with the link. */}
      <p className="masthead__status" role="status">
        {shared === "copied" ? t.header.copied : shared === "failed" ? t.header.copyFailed : ""}
      </p>
    </header>
  );
}
