import type { LegalMessages } from "./messages.ts";

export const legalDe: LegalMessages = {
  imprint: "Impressum",
  privacy: "Datenschutz",
  privacyTitle: "Datenschutzerklärung",
  documentTitle: (page, app) => `${page} – ${app}`,
  back: "Zurück zum Simulator",
  email: "E-Mail",
  phone: "Telefon",

  imprintBasis: "Angaben gemäß § 5 DDG",
  imprintProvider: "Anbieter dieser Website",
  contact: "Kontakt",
  contentResponsible: "Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV",
  contentResponsiblePlain: "Verantwortlich für den Inhalt",

  controllerTitle: "Verantwortlich",
  controller: "Verantwortlich für die Verarbeitung personenbezogener Daten auf dieser Website ist:",
  appTitle: "Die Anwendung",
  appLocal:
    "Diese Anwendung rechnet vollständig in Ihrem Browser. Welche Maßnahmen Sie einschalten und wie Sie sie einstellen, wird nicht an den Server übertragen.",
  appFragment: (share) =>
    `Ihre Einstellungen stehen in der Adresse der Seite hinter dem Zeichen „#“. Diesen Teil der Adresse schicken Browser nicht an den Server. Die Schaltfläche „${share}“ kopiert die Adresse in Ihre Zwischenablage; übertragen wird dabei nichts.`,
  appStorage: (key) =>
    `Die Anwendung setzt keine Cookies. Nur wenn Sie selbst eine Sprache wählen, speichert sie diese Wahl im lokalen Speicher Ihres Browsers (Local Storage, Eintrag „${key}“), damit die Seite beim nächsten Besuch in dieser Sprache erscheint. Der Eintrag verlässt Ihr Gerät nicht und bleibt dort, bis Sie ihn in Ihrem Browser löschen. Rechtsgrundlage ist § 25 Abs. 2 Nr. 2 TDDDG: Das Speichern ist für die Funktion, die Sie gewählt haben, unbedingt erforderlich.`,
  appNoThirdParty:
    "Programmcode, Daten und Schriften lädt die Anwendung von dieser Website selbst, nicht von anderen Anbietern. Sie enthält keine Werkzeuge zur Reichweitenmessung oder zum Tracking.",
  appLinks:
    "Die Quellenangaben verlinken auf Seiten anderer Anbieter. Erst wenn Sie einen solchen Link öffnen, ruft Ihr Browser die fremde Seite auf; für sie gilt deren Datenschutzerklärung. Von welcher Seite Sie kommen, wird dabei nicht mitgeschickt.",
  appRepository:
    "Die Fußzeile verlinkt auf den Quelltext der Anwendung bei GitHub: Bevor Sie diesem Link folgen, wird nichts an GitHub übertragen; danach gelten die Datenschutzbestimmungen von GitHub.",
  hostingTitle: "Hosting und Protokolle des Servers",
  hosting: (name, address) => `Die Website liegt auf einem Server von ${name}, ${address}.`,
  location: (country) => `Standort des Servers: ${country}.`,
  processor: (name) => `${name} verarbeitet die Daten als Auftragsverarbeiter (Art. 28 DSGVO).`,
  received:
    "Bei jedem Abruf erhält der Server Ihre IP-Adresse und die Angaben, die Ihr Browser mitschickt, etwa die angefragte Adresse und die Browserkennung (User-Agent). Er braucht sie, um die Seite auszuliefern.",
  logged: (fields) => `Ins Protokoll schreibt der Server zu jedem Abruf: ${fields}.`,
  notLogged: {
    personal: "Er speichert Ihre IP-Adresse und Ihre Browserkennung nicht und damit keine personenbezogenen Daten.",
    ip: "Er speichert Ihre IP-Adresse nicht.",
  },
  noLog: "Ein Protokoll der Abrufe führt der Server nicht.",
  logPurpose: "Das Protokoll dient dazu, Fehler zu finden und den Betrieb zu überwachen.",
  logField: {
    time: "Zeitpunkt",
    request: "angefragte Adresse",
    status: "Statuscode der Antwort",
    bytes: "Größe der Antwort",
    referrer: "die Seite, von der Sie kamen (Referrer)",
    userAgent: "Browserkennung (User-Agent)",
    ipAddress: "IP-Adresse",
  },
  retentionDays: (days) =>
    days === 1 ? "Jeder Eintrag wird nach einem Tag gelöscht." : `Jeder Eintrag wird nach ${days} Tagen gelöscht.`,
  retentionSize: (size) => `Es ist auf ${size} MB begrenzt; ist die Grenze erreicht, werden die ältesten Einträge gelöscht.`,
  proxyTitle: (name) => `Auslieferung über ${name}`,
  proxy: (name, address) =>
    `Alle Abrufe dieser Website laufen über das Netzwerk von ${name}, ${address}. Der Dienst leitet sie an den Server weiter, hält Dateien zwischengespeichert bereit und wehrt Angriffe ab.`,
  proxyData: (name) =>
    `Dafür verarbeitet ${name} Ihre IP-Adresse und die Angaben, die Ihr Browser mit jedem Abruf mitschickt, als Auftragsverarbeiter (Art. 28 DSGVO).`,
  abroad: (country) => `Die Daten können dabei auch außerhalb der EU und des EWR verarbeitet werden (${country}).`,
  region: (country) => `Ort der Verarbeitung: ${country}.`,
  transfer: {
    dpf: (name) =>
      `${name} ist nach dem EU-US Data Privacy Framework zertifiziert. Für Übermittlungen an zertifizierte Unternehmen hat die EU-Kommission ein angemessenes Datenschutzniveau festgestellt (Art. 45 DSGVO).`,
    adequacy: "Für dieses Land hat die EU-Kommission ein angemessenes Datenschutzniveau festgestellt (Art. 45 DSGVO).",
    scc: "Grundlage der Übermittlung sind Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO).",
  },
  networkErrors: (name) =>
    `Außerdem bittet ${name} Ihren Browser, Verbindungsfehler zu melden (Network Error Logging). Browser, die das unterstützen, schicken nach einem fehlgeschlagenen Abruf einen kurzen Bericht an ${name}: die angefragte Adresse, die Seite, von der Sie kamen, die Art des Fehlers und die Browserkennung. Dabei erhält ${name} auch Ihre IP-Adresse.`,
  providerPolicy: (name) => `Näheres zur Datenverarbeitung bei ${name}:`,
  basisTitle: "Rechtsgrundlage",
  basis:
    "Die Verarbeitung beim Ausliefern der Seite, wie oben beschrieben, beruht auf Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse besteht darin, die Website sicher und zuverlässig bereitzustellen. Ohne diese Verarbeitung lässt sich die Seite nicht abrufen. Eine automatisierte Entscheidungsfindung findet nicht statt.",
  rightsTitle: "Ihre Rechte",
  rights:
    "Sie haben das Recht auf Auskunft über die Daten, die Sie betreffen, auf Berichtigung, Löschung und Einschränkung der Verarbeitung sowie auf Datenübertragbarkeit (Art. 15 bis 20 DSGVO).",
  objectionLabel: "Widerspruchsrecht:",
  objection:
    "Sie können der Verarbeitung, die auf Art. 6 Abs. 1 lit. f DSGVO beruht, jederzeit widersprechen, wenn sich die Gründe dafür aus Ihrer besonderen Situation ergeben (Art. 21 DSGVO).",
  complaint:
    "Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, insbesondere in dem EU-Mitgliedstaat, in dem Sie leben oder arbeiten oder in dem der mutmaßliche Verstoß geschah (Art. 77 DSGVO).",
  contactRights: "Um Ihre Rechte auszuüben, und bei Fragen zum Datenschutz genügt eine E-Mail an",
  moreTitle: "Weitere Hinweise",
  updated: (date) => `Stand: ${date}`,
};
