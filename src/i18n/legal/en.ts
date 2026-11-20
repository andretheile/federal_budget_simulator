import type { LegalMessages } from "./messages.ts";

export const legalEn: LegalMessages = {
  imprint: "Legal notice",
  privacy: "Privacy",
  privacyTitle: "Privacy policy",
  documentTitle: (page, app) => `${page} – ${app}`,
  back: "Back to the simulator",
  email: "Email",
  phone: "Phone",

  imprintBasis: "Information pursuant to § 5 DDG (German Digital Services Act)",
  imprintProvider: "Provider of this website",
  contact: "Contact",
  contentResponsible: "Responsible for the content pursuant to § 18 (2) MStV (German Interstate Media Treaty)",
  contentResponsiblePlain: "Responsible for the content",

  controllerTitle: "Controller",
  controller: "The controller responsible for processing personal data on this website is:",
  appTitle: "The application",
  appLocal:
    "This application does all its calculations in your browser. Which measures you switch on and how you set them is not sent to the server.",
  appFragment: (share) =>
    `Your settings are kept in the address of the page, after the “#” sign. Browsers do not send this part of the address to the server. The “${share}” button copies the address to your clipboard; nothing is transmitted.`,
  appStorage: (key) =>
    `The application sets no cookies. Only if you choose a language yourself does it store that choice in your browser’s local storage (entry “${key}”), so that the page appears in that language on your next visit. The entry does not leave your device and stays there until you delete it in your browser. The legal basis is § 25 (2) no. 2 TDDDG (German Telecommunications Digital Services Data Protection Act): storing it is strictly necessary for the function you chose.`,
  appNoThirdParty:
    "The application loads its code, data and fonts from this website itself, not from other providers. It contains no analytics or tracking tools.",
  appLinks:
    "The source references link to pages of other providers. Only when you open such a link does your browser load the other page, and that page’s privacy policy applies. The page you came from is not sent along.",
  appRepository:
    "The footer links to the application’s source code on GitHub: nothing is sent to GitHub before you follow that link, and after that GitHub’s own privacy terms apply.",
  hostingTitle: "Hosting and server logs",
  hosting: (name, address) => `The website is hosted on a server of ${name}, ${address}.`,
  location: (country) => `Server location: ${country}.`,
  processor: (name) => `${name} processes the data as a processor (Art. 28 GDPR).`,
  received:
    "With every request the server receives your IP address and the information your browser sends along, such as the requested address and the browser identification (user agent). It needs them to deliver the page.",
  logged: (fields) => `For each request the server writes to its log: ${fields}.`,
  notLogged: {
    personal: "It does not store your IP address or your browser identification, and so no personal data.",
    ip: "It does not store your IP address.",
  },
  noLog: "The server keeps no log of requests.",
  logPurpose: "The log is used to find errors and to monitor operation.",
  logField: {
    time: "time",
    request: "requested address",
    status: "status code of the response",
    bytes: "size of the response",
    referrer: "the page you came from (referrer)",
    userAgent: "browser identification (user agent)",
    ipAddress: "IP address",
  },
  retentionDays: (days) => (days === 1 ? "Each entry is deleted after one day." : `Each entry is deleted after ${days} days.`),
  retentionSize: (size) => `It is limited to ${size} MB; when the limit is reached, the oldest entries are deleted.`,
  proxyTitle: (name) => `Delivery through ${name}`,
  proxy: (name, address) =>
    `All requests to this website pass through the network of ${name}, ${address}. The service forwards them to the server, keeps copies of files ready and fends off attacks.`,
  proxyData: (name) =>
    `To do so, ${name} processes your IP address and the information your browser sends with each request, as a processor (Art. 28 GDPR).`,
  abroad: (country) => `The data may also be processed outside the EU and the EEA (${country}).`,
  region: (country) => `Place of processing: ${country}.`,
  transfer: {
    dpf: (name) =>
      `${name} is certified under the EU-U.S. Data Privacy Framework. For transfers to certified companies the EU Commission has found an adequate level of data protection (Art. 45 GDPR).`,
    adequacy: "For this country the EU Commission has found an adequate level of data protection (Art. 45 GDPR).",
    scc: "The transfer is based on standard contractual clauses of the EU Commission (Art. 46 (2) (c) GDPR).",
  },
  networkErrors: (name) =>
    `${name} also asks your browser to report connection errors (Network Error Logging). Browsers that support this send a short report to ${name} after a failed request: the requested address, the page you came from, the type of error and the browser identification. ${name} also receives your IP address in the process.`,
  providerPolicy: (name) => `More on data processing by ${name}:`,
  basisTitle: "Legal basis",
  basis:
    "The processing involved in delivering the page, as described above, is based on Art. 6 (1) (f) GDPR. The legitimate interest is to provide the website securely and reliably. Without this processing the page cannot be accessed. There is no automated decision-making.",
  rightsTitle: "Your rights",
  rights:
    "You have the right of access to the data concerning you, to rectification, erasure and restriction of processing, and to data portability (Art. 15 to 20 GDPR).",
  objectionLabel: "Right to object:",
  objection:
    "You may object at any time to processing based on Art. 6 (1) (f) GDPR on grounds relating to your particular situation (Art. 21 GDPR).",
  complaint:
    "You may also lodge a complaint with a data protection supervisory authority, in particular in the EU member state where you live or work or where the alleged infringement took place (Art. 77 GDPR).",
  contactRights: "To exercise your rights, or with any question about data protection, write to",
  moreTitle: "Further information",
  updated: (date) => `Last updated: ${date}`,
};
