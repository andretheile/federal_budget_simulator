/**
 * Masthead: what this is, for which country and year, and the controls that apply to the whole
 * page: level of government, language, share and reset.
 */
import { useEffect, useRef, useState } from "react";
import { levelsOf } from "../app/policyModel.ts";
import { useUi } from "../app/ui.ts";
import type { LevelFilter } from "../engine/index.ts";
import { Check, LinkIcon, ResetIcon } from "./icons.tsx";

export interface HeaderProps {
  level: LevelFilter;
  onLevel(level: LevelFilter): void;
  languages: readonly string[];
  onLanguage(language: string): void;
  /** Copies the link; resolves to whether it worked. */
  onShare(): Promise<boolean>;
  onReset(): void;
  canReset: boolean;
  /** Ids of all country packs; the switch is only shown if there is more than one. */
  countries: readonly string[];
  onCountry?(id: string): void;
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
  onShare,
  onReset,
  canReset,
  countries,
  onCountry,
}: HeaderProps) {
  const ui = useUi();
  const { pack, t, fmt, language } = ui;
  const levels = levelsOf(pack);
  const [shared, setShared] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const share = async (): Promise<void> => {
    const ok = await onShare();
    setShared(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShared(null), ok ? 2500 : 6000);
  };

  const options: { id: LevelFilter; name: string }[] = [
    { id: "all", name: t.header.allLevels },
    ...levels.map((id) => ({ id, name: ui.levelName(id) })),
  ];

  return (
    <header className="masthead">
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

          <button type="button" className="tool" onClick={() => void share()} title={t.header.shareHint}>
            {shared === "copied" ? <Check size={15} /> : <LinkIcon size={15} />}
            <span>{shared === "copied" ? t.header.copied : t.header.share}</span>
          </button>
          <button type="button" className="tool" onClick={onReset} disabled={!canReset} title={t.header.resetHint}>
            <ResetIcon size={15} />
            <span>{t.header.reset}</span>
          </button>
        </div>
      </div>

      <div className="page masthead__lower">
        <p className="masthead__tagline">{t.app.tagline}</p>
        {levels.length > 1 && (
          <>
            <fieldset className="levelbar">
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

      {/* Success is shown on the button itself; only a failure needs a visible message. Both are announced. */}
      <p className={`masthead__status${shared === "failed" ? " is-visible" : ""}`} role="status">
        {shared === "copied" ? t.header.copied : shared === "failed" ? t.header.copyFailed : ""}
      </p>
    </header>
  );
}
