/**
 * The legal pages, imprint and privacy statement, and the links to them in the footer. They show
 * the operator's details from the site config (src/site/config.ts) in the words of the dictionary
 * (src/i18n/legal/). Each page replaces the simulator; header and footer stay.
 */
import { useEffect, useRef, type MouseEvent } from "react";
import { useUi } from "../app/ui.ts";
import { intlLocale } from "../i18n/index.ts";
import {
  EEA,
  LEGAL_PAGES,
  pickNote,
  type LegalPage,
  type Operator,
  type Party,
  type Provider,
  type SiteConfig,
} from "../site/config.ts";
import { ArrowLeft, ExternalIcon } from "./icons.tsx";
import "../styles/legal.css";

export interface LegalPageViewProps {
  page: LegalPage;
  site: SiteConfig;
  /** The address of the simulator with the same scenario. */
  backHref: string;
  onBack(event: MouseEvent<HTMLAnchorElement>): void;
  /** Name of the localStorage entry that holds the chosen language; the privacy statement names it. */
  languageKey: string;
}

export function LegalPageView({ page, site, backHref, onBack, languageKey }: LegalPageViewProps) {
  const { t } = useUi();
  const heading = useRef<HTMLHeadingElement>(null);

  // A new page starts at the top, with the keyboard and screen reader focus on its heading.
  useEffect(() => {
    window.scrollTo?.(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [page]);

  return (
    <article className="legal" aria-labelledby="legal-title">
      <p className="legal__back">
        <a href={backHref} onClick={onBack}>
          <ArrowLeft size={14} />
          {t.legal.back}
        </a>
      </p>
      <header className="section-head">
        <h2 id="legal-title" ref={heading} tabIndex={-1}>
          {page === "imprint" ? t.legal.imprint : t.legal.privacyTitle}
        </h2>
      </header>
      {page === "imprint" ? <Imprint site={site} /> : <Privacy site={site} languageKey={languageKey} />}
    </article>
  );
}

export interface LegalLinksProps {
  /** The page shown, if any; its link is marked as the current page. */
  current?: LegalPage;
  /** The address of a page with the current scenario. */
  hrefFor(page: LegalPage): string;
  onOpen(event: MouseEvent<HTMLAnchorElement>, page: LegalPage): void;
}

/** The links to both pages, for the footer. */
export function LegalLinks({ current, hrefFor, onOpen }: LegalLinksProps) {
  const { t } = useUi();
  return (
    <>
      {LEGAL_PAGES.map((page) => (
        <a
          key={page}
          href={hrefFor(page)}
          aria-current={current === page ? "page" : undefined}
          onClick={(event) => onOpen(event, page)}
        >
          {page === "imprint" ? t.legal.imprint : t.legal.privacy}
        </a>
      ))}
    </>
  );
}

// --- imprint ---------------------------------------------------------------------------------

function Imprint({ site }: { site: SiteConfig }) {
  const { t, language } = useUi();
  const addition = paragraphs(pickNote(site.imprint?.addition, language));
  const responsible = site.contentResponsible ?? site.operator;
  // § 5 DDG and § 18 MStV ask for a postal address; a heading cites them only above one.
  return (
    <div className="legal__body">
      <section>
        <h3>{site.operator.address ? t.legal.imprintBasis : t.legal.imprintProvider}</h3>
        <Address party={site.operator} />
      </section>
      <section>
        <h3>{t.legal.contact}</h3>
        <Contact operator={site.operator} />
      </section>
      <section>
        <h3>{responsible.address ? t.legal.contentResponsible : t.legal.contentResponsiblePlain}</h3>
        <Address party={responsible} />
      </section>
      {addition.length > 0 && (
        <section className="legal__addition">
          {addition.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>
      )}
    </div>
  );
}

// --- privacy statement -------------------------------------------------------------------------

function Privacy({ site, languageKey }: { site: SiteConfig; languageKey: string }) {
  const { t, language, fmt } = useUi();
  const l = t.legal;
  const locale = intlLocale(language);
  const country = (code: string): string => countryName(code, locale);
  const { hosting, proxy, operator, serverLog } = site;
  const { fields, retention } = serverLog;
  const list = new Intl.ListFormat(locale, { type: "conjunction" }).format(fields.map((field) => l.logField[field]));

  /** For a country outside the EU and the EEA: on what basis the data may go there. */
  const transfer = (provider: Provider): string => {
    if (EEA.has(provider.country) || !provider.transfer) return "";
    return provider.transfer === "dpf" ? l.transfer.dpf(provider.name) : l.transfer[provider.transfer];
  };

  const log =
    fields.length === 0
      ? [l.noLog]
      : [
          l.logged(list),
          fields.includes("ipAddress")
            ? ""
            : fields.includes("userAgent")
              ? l.notLogged.ip
              : l.notLogged.personal,
          l.logPurpose,
          retention?.days !== undefined
            ? l.retentionDays(retention.days)
            : retention?.maxMegabytes !== undefined
              ? l.retentionSize(new Intl.NumberFormat(locale).format(retention.maxMegabytes))
              : "",
        ];
  const addition = paragraphs(pickNote(site.privacy?.addition, language));

  return (
    <div className="legal__body">
      <section>
        <h3>{l.controllerTitle}</h3>
        <p>{l.controller}</p>
        <Address party={operator} />
        <Contact operator={operator} />
      </section>

      <section>
        <h3>{l.appTitle}</h3>
        <p>{l.appLocal}</p>
        <p>{l.appFragment(t.header.share)}</p>
        <p>{l.appStorage(languageKey)}</p>
        <p>{l.appNoThirdParty}</p>
        <p>{l.appLinks}</p>
        <p>{l.appRepository}</p>
      </section>

      <section>
        <h3>{l.hostingTitle}</h3>
        <p>
          {sentences(
            l.hosting(hosting.name, hosting.address.join(", ")),
            l.location(country(hosting.country)),
            transfer(hosting),
            l.processor(hosting.name),
          )}
        </p>
        <PolicyLink provider={hosting} />
        <p>{l.received}</p>
        <p>{sentences(...log)}</p>
      </section>

      {proxy && (
        <section>
          <h3>{l.proxyTitle(proxy.name)}</h3>
          <p>
            {sentences(
              l.proxy(proxy.name, proxy.address.join(", ")),
              l.proxyData(proxy.name),
              EEA.has(proxy.country) ? l.region(country(proxy.country)) : l.abroad(country(proxy.country)),
              transfer(proxy),
            )}
          </p>
          {proxy.networkErrorReports && <p>{l.networkErrors(proxy.name)}</p>}
          <PolicyLink provider={proxy} />
        </section>
      )}

      <section>
        <h3>{l.basisTitle}</h3>
        <p>{l.basis}</p>
      </section>

      <section>
        <h3>{l.rightsTitle}</h3>
        <p>{l.rights}</p>
        <p>
          <strong>{l.objectionLabel}</strong> {l.objection}
        </p>
        <p>{l.complaint}</p>
        <p>
          {l.contactRights} <a href={`mailto:${operator.email}`}>{operator.email}</a>.
        </p>
      </section>

      {addition.length > 0 && (
        <section className="legal__addition">
          <h3>{l.moreTitle}</h3>
          {addition.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>
      )}

      {site.privacy?.updated && <p className="legal__updated">{l.updated(fmt.date(site.privacy.updated))}</p>}
    </div>
  );
}

// --- pieces ----------------------------------------------------------------------------------

/** Name and postal address, one line each; just the name where the config gives no address. */
function Address({ party }: { party: Party }) {
  return (
    <p className="legal__lines">
      {[party.name, ...(party.address ?? [])].map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </p>
  );
}

function Contact({ operator }: { operator: Operator }) {
  const { t } = useUi();
  return (
    <p className="legal__lines">
      <span>
        {t.legal.email}: <a href={`mailto:${operator.email}`}>{operator.email}</a>
      </span>
      {operator.phone && (
        <span>
          {t.legal.phone}: <a href={`tel:${operator.phone.replace(/[^+0-9]/g, "")}`}>{operator.phone}</a>
        </span>
      )}
    </p>
  );
}

function PolicyLink({ provider }: { provider: Provider }) {
  const { t } = useUi();
  if (!provider.privacyPolicy) return null;
  return (
    <p>
      {t.legal.providerPolicy(provider.name)}{" "}
      <a className="legal__url" href={provider.privacyPolicy} target="_blank" rel="noopener noreferrer">
        {provider.privacyPolicy}
        <ExternalIcon size={12} />
        <span className="visually-hidden"> ({t.common.externalLink})</span>
      </a>
    </p>
  );
}

/** Sentences of one paragraph, empty ones left out. */
function sentences(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

/** Free text from the config: a blank line starts a new paragraph. */
function paragraphs(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
