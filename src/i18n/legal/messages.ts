/**
 * Texts of the legal pages: the imprint and the privacy statement. The operator's details come
 * from the site config (src/site/config.ts); everything said in words is here, once per language.
 *
 * The privacy statement describes this code. Before changing what the app stores or sends,
 * change the sentences here that describe it.
 */
import type { LogField } from "../../site/config.ts";

export interface LegalMessages {
  /** Footer link to the imprint and its heading. */
  imprint: string;
  /** Footer link to the privacy statement. */
  privacy: string;
  /** Heading of the privacy statement. */
  privacyTitle: string;
  /** Title of the browser tab on a legal page. */
  documentTitle(page: string, app: string): string;
  back: string;
  email: string;
  phone: string;

  // --- imprint ---
  /**
   * Headings above the operator and the person responsible for the content. The ones that cite a
   * provision are used only with a postal address, which the provision asks for; without one the
   * plain headings stand in (see Party in src/site/config.ts).
   */
  imprintBasis: string;
  imprintProvider: string;
  contact: string;
  contentResponsible: string;
  contentResponsiblePlain: string;

  // --- privacy statement ---
  controllerTitle: string;
  controller: string;
  appTitle: string;
  appLocal: string;
  /** `share` is the label of the Share button. */
  appFragment(share: string): string;
  /** `key` is the name of the localStorage entry. */
  appStorage(key: string): string;
  appNoThirdParty: string;
  appLinks: string;
  /** The footer's link to the source code on GitHub: nothing goes there before it is followed. */
  appRepository: string;
  hostingTitle: string;
  hosting(name: string, address: string): string;
  location(country: string): string;
  processor(name: string): string;
  received: string;
  /** `fields` is the list of what is logged, already joined. */
  logged(fields: string): string;
  notLogged: {
    /** Neither IP address nor user agent is logged. */
    personal: string;
    /** No IP address, but the user agent. */
    ip: string;
  };
  noLog: string;
  logPurpose: string;
  logField: Record<LogField, string>;
  retentionDays(days: number): string;
  retentionSize(megabytes: string): string;
  proxyTitle(name: string): string;
  proxy(name: string, address: string): string;
  proxyData(name: string): string;
  /** Data may be processed outside the EU and the EEA; `country` is the country's name. */
  abroad(country: string): string;
  region(country: string): string;
  transfer: {
    dpf(name: string): string;
    adequacy: string;
    scc: string;
  };
  networkErrors(name: string): string;
  providerPolicy(name: string): string;
  basisTitle: string;
  basis: string;
  rightsTitle: string;
  rights: string;
  objectionLabel: string;
  objection: string;
  complaint: string;
  /** Followed by the operator's e-mail address as a link, then a full stop. */
  contactRights: string;
  moreTitle: string;
  updated(date: string): string;
}
