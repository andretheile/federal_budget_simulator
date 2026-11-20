/**
 * The operator's details for the imprint and the privacy statement: who runs this instance of the
 * app, where it is hosted, what the server logs. They are not part of the source. vite.config.ts
 * reads them from site.config.json in the repository root (or from the file SITE_CONFIG names),
 * checks them with the schema in ./schema.ts and hands them to the app as a compile-time constant.
 *
 * Without a config the site has no legal pages and asks search engines not to index it. With one,
 * the pages exist; the site may be indexed only if the config also says "indexable": true.
 *
 * The shape of the config and what the pages need of it. Pure TypeScript without DOM or Node APIs,
 * and without the validator, which only the build needs.
 */
/** The two legal pages, by the id they have in the address (#...&p=imprint). */
export const LEGAL_PAGES = ["imprint", "privacy"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

/** What an access log line can hold. Only "ipAddress" and "userAgent" relate to a person. */
export const LOG_FIELDS = ["time", "request", "status", "bytes", "referrer", "userAgent", "ipAddress"] as const;
export type LogField = (typeof LOG_FIELDS)[number];

/**
 * How data may go to a country outside the EU and the EEA:
 *   dpf       the recipient is certified under the EU-US Data Privacy Framework (US only)
 *   adequacy  the EU Commission has found the country's level of protection adequate
 *   scc       standard contractual clauses of the EU Commission
 */
export const TRANSFERS = ["dpf", "adequacy", "scc"] as const;
export type Transfer = (typeof TRANSFERS)[number];

/** Free text in several languages, keyed by language code: { "de": "…", "en": "…" }. */
export type LocalizedNote = Record<string, string>;

export interface Party {
  name: string;
  /** Postal address, one entry per line. */
  address: string[];
}

export interface Operator extends Party {
  email: string;
  phone?: string;
}

/** A company that processes the visitors' data for the operator: the hoster, a proxy or CDN. */
export interface Provider extends Party {
  /** ISO 3166-1 alpha-2 code of the country where the provider processes the data (hosting: where the server is). */
  country: string;
  /** Required for a country outside the EU and the EEA, not allowed for one inside. */
  transfer?: Transfer;
  /** The provider's own privacy policy (https). */
  privacyPolicy?: string;
}

export interface Proxy extends Provider {
  /** The proxy asks browsers to report failed requests to it (Network Error Logging, the NEL header). */
  networkErrorReports?: boolean;
}

export interface Retention {
  /** Entries are deleted after this many days … */
  days?: number;
  /** … or the log is limited to this size and the oldest entries are deleted. Exactly one of the two. */
  maxMegabytes?: number;
}

export interface ServerLog {
  /** What the server writes for each request. Empty: the server keeps no access log. */
  fields: LogField[];
  /** How long entries are kept. Required when fields are logged. */
  retention?: Retention;
}

export interface SiteConfig {
  /** Let search engines index the site. Default false: the "noindex" tag stays. */
  indexable?: boolean;
  /** Who runs the site: imprint (§ 5 DDG) and controller in the privacy statement. */
  operator: Operator;
  /** Person responsible for the content under § 18 Abs. 2 MStV. Default: the operator. */
  contentResponsible?: Party;
  /** Where the site is hosted. */
  hosting: Provider;
  /** A proxy or CDN in front of the server, such as Cloudflare. */
  proxy?: Proxy;
  /** The server's access log. */
  serverLog: ServerLog;
  imprint?: { addition?: LocalizedNote };
  privacy?: {
    /** "Stand": the date the operator last checked the statement, YYYY-MM-DD. */
    updated?: string;
    /** Paragraphs added at the end, per language. A blank line starts a new paragraph. */
    addition?: LocalizedNote;
  };
}

/** The EU member states and the other EEA countries (Iceland, Liechtenstein, Norway). */
export const EEA: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU",
  "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "IS", "LI", "NO",
]);

// --- for the pages --------------------------------------------------------------------------

/** A note in the wanted language: the language, its base ("de" for "de-AT"), English, or the first one given. */
export function pickNote(value: LocalizedNote | undefined, language: string): string | undefined {
  if (!value) return undefined;
  const base = language.toLowerCase().split(/[-_]/)[0] ?? "";
  return value[language] ?? value[base] ?? value.en ?? Object.values(value)[0];
}
