// @vitest-environment jsdom
/**
 * Imprint and privacy statement: there only with a site config, reached from the footer, in place
 * of the simulator, written from the config, and left again without losing the scenario.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Simulator } from "../App.tsx";
import { testland } from "../engine/__fixtures__/testland.ts";
import exampleText from "../../site.config.example.json?raw";
import type { SiteConfig } from "../site/config.ts";
import { REPOSITORY_URL } from "../site/project.ts";
import { parseSiteConfig } from "../site/schema.ts";

const example = parseSiteConfig(exampleText, "site.config.example.json");

let container: HTMLDivElement;
let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  const items = new Map<string, string>();
  const storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => void items.delete(key),
    setItem: (key: string, value: string) => void items.set(key, String(value)),
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

function mount(hash: string, site: SiteConfig | null): void {
  window.history.replaceState(null, "", hash || "/");
  root = createRoot(container);
  act(() => root!.render(<Simulator pack={testland} site={site} />));
}

const query = <T extends Element = HTMLElement>(selector: string): T => {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
/** Text as read, with the narrow and normal no-break spaces of number formats made plain. */
const text = (selector: string): string => (query(selector).textContent ?? "").replace(/[  ]/g, " ");
const footerLinks = (): HTMLAnchorElement[] => [...container.querySelectorAll<HTMLAnchorElement>(".footer__links a")];
const footerLink = (name: string): HTMLAnchorElement => {
  const link = footerLinks().find((candidate) => candidate.textContent === name);
  if (!link) throw new Error(`no footer link "${name}"`);
  return link;
};
const click = (element: HTMLElement): void => act(() => element.click());
/** What the browser does when it moves through its history to another address of the page. */
const historyTo = (address: string): void =>
  act(() => {
    window.history.replaceState(null, "", address);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

describe("without a site config", () => {
  it("has no legal pages and no links to them, and drops p= from the address", () => {
    mount("#lang=de&s=halve_mp_pay&p=imprint", null);
    // Testland has debt data, so the footer also leads to the debt projection. The link to the
    // source code tells a screen reader that it opens a new tab.
    expect(footerLinks().map((link) => link.textContent)).toEqual([
      "Schulden und Zinsen",
      "Über die Zahlen",
      "Quelltext auf GitHub (öffnet in neuem Tab)",
    ]);
    expect(container.querySelector(".legal")).toBeNull();
    expect(container.querySelector(".workspace")).not.toBeNull();
    expect(window.location.hash).toBe("#lang=de&s=halve_mp_pay");
  });
});

describe("with a site config", () => {
  it("links to both pages from the footer, with the scenario in the address", () => {
    mount("#lang=de&s=halve_mp_pay", example);
    expect(footerLinks().map((link) => link.textContent)).toEqual([
      "Schulden und Zinsen",
      "Über die Zahlen",
      "Quelltext auf GitHub (öffnet in neuem Tab)",
      "Impressum",
      "Datenschutz",
    ]);
    expect(footerLink("Impressum").getAttribute("href")).toBe("#lang=de&s=halve_mp_pay&p=imprint");
    expect(footerLink("Datenschutz").getAttribute("href")).toBe("#lang=de&s=halve_mp_pay&p=privacy");
  });

  it("opens a page in place of the simulator and goes back to the same scenario", () => {
    mount("#lang=de&s=halve_mp_pay", example);
    const entries = window.history.length;
    click(footerLink("Impressum"));

    // The page replaces the workspace and the scoreboard; header and footer stay.
    expect(text(".legal h2")).toBe("Impressum");
    expect(container.querySelector(".workspace")).toBeNull();
    expect(container.querySelector(".scoreboard")).toBeNull();
    expect(container.querySelector(".masthead")).not.toBeNull();
    expect(footerLink("Impressum").getAttribute("aria-current")).toBe("page");
    expect(document.title).toBe("Impressum – Haushaltssimulator");
    expect(document.activeElement).toBe(query(".legal h2"));
    // A new history entry, so the browser's back button returns to the simulator.
    expect(window.location.hash).toBe("#lang=de&s=halve_mp_pay&p=imprint");
    expect(window.history.length).toBe(entries + 1);

    // From one page to the other.
    click(footerLink("Datenschutz"));
    expect(text(".legal h2")).toBe("Datenschutzerklärung");
    expect(document.title).toBe("Datenschutzerklärung – Haushaltssimulator");

    const back = query<HTMLAnchorElement>(".legal__back a");
    expect(back.getAttribute("href")).toBe("#lang=de&s=halve_mp_pay");
    click(back);
    expect(container.querySelector(".legal")).toBeNull();
    expect(query('#policy-halve_mp_pay [role="switch"]').getAttribute("aria-checked")).toBe("true");
    expect(window.location.hash).toBe("#lang=de&s=halve_mp_pay");
    expect(document.title).toBe("Haushaltssimulator: Testland 2024");
    expect(document.activeElement).toBe(query("main"));
  });

  it("keeps only the name and the language switch in the header, which act on a page too", () => {
    mount("#lang=de&s=halve_mp_pay", example);
    const tools = (): string[] => [...container.querySelectorAll(".masthead .tool")].map((tool) => tool.textContent ?? "");
    expect(container.querySelector(".masthead .levelbar")).not.toBeNull();
    expect(tools()).toEqual(["Teilen", "Zurücksetzen"]);
    click(footerLink("Impressum"));
    // Level filter, sharing and reset act on the simulator, which is not shown.
    expect(container.querySelector(".masthead .levelbar")).toBeNull();
    expect(container.querySelector(".masthead .levelselect")).toBeNull();
    expect(tools()).toEqual([]);
    expect(text(".masthead__name")).toBe("Haushaltssimulator");
    // The language switch works on the page, and the way back is there.
    click(query('.langs button[lang="en"]'));
    expect(text(".legal h2")).toBe("Legal notice");
    expect(container.querySelector(".legal__back a")).not.toBeNull();
    click(query(".legal__back a"));
    expect(container.querySelector(".masthead .levelbar")).not.toBeNull();
    expect(tools()).toHaveLength(2);
  });

  it("follows the browser's back and forward buttons, also to the bare address", () => {
    mount("", example);
    click(query('.footer__links a[href$="&p=privacy"]'));
    expect(container.querySelector(".legal")).not.toBeNull();
    historyTo("/");
    expect(container.querySelector(".legal")).toBeNull();
    historyTo("#lang=de&p=imprint");
    expect(text(".legal h2")).toBe("Impressum");
    historyTo("#lang=de");
    expect(container.querySelector(".legal")).toBeNull();
  });

  it("leads from “About the numbers” on a page back to the simulator", () => {
    mount("#lang=en&p=privacy", example);
    expect(footerLink("About the numbers").getAttribute("href")).toBe("#lang=en");
    click(footerLink("About the numbers"));
    expect(container.querySelector(".legal")).toBeNull();
    expect(container.querySelector("#about")).not.toBeNull();
  });

  it("ignores a curve editor in the address while a page is shown", () => {
    mount("#lang=en&e=redraw_income_tax.tariff&p=privacy", example);
    expect(text(".legal h2")).toBe("Privacy policy");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(window.location.hash).toBe("#lang=en&p=privacy");
  });
});

describe("the link to the source code", () => {
  const name = { de: "Quelltext auf GitHub (öffnet in neuem Tab)", en: "Source code on GitHub (opens in a new tab)" };
  it.each([
    { language: "de", where: "without a site config", hash: "#lang=de", site: null },
    { language: "en", where: "without a site config", hash: "#lang=en", site: null },
    { language: "de", where: "with a site config", hash: "#lang=de", site: example },
    { language: "en", where: "with a site config", hash: "#lang=en", site: example },
    { language: "de", where: "on a legal page", hash: "#lang=de&p=imprint", site: example },
    { language: "en", where: "on a legal page", hash: "#lang=en&p=privacy", site: example },
  ] as const)("is in the footer, in $language, $where, and opens in a new tab", ({ language, hash, site }) => {
    mount(hash, site);
    expect(container.querySelector(".legal") !== null).toBe(hash.includes("&p="));
    const link = footerLink(name[language]);
    expect(link.getAttribute("href")).toBe(REPOSITORY_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // After "About the numbers", before the legal pages.
    const names = footerLinks().map((candidate) => candidate.textContent);
    expect(names.indexOf(name[language])).toBe(names.indexOf(language === "de" ? "Über die Zahlen" : "About the numbers") + 1);
  });
});

describe("the imprint", () => {
  it("shows the operator, the contact and the person responsible for the content", () => {
    mount("#lang=de&p=imprint", example);
    const page = text(".legal");
    expect(page).toContain("Angaben gemäß § 5 DDG");
    expect(text(".legal section:nth-of-type(1) .legal__lines")).toBe("Erika MustermannMusterstraße 112345 Musterstadt");
    expect(query<HTMLAnchorElement>('.legal a[href^="mailto:"]').getAttribute("href")).toBe("mailto:kontakt@example.org");
    expect(query<HTMLAnchorElement>('.legal a[href^="tel:"]').getAttribute("href")).toBe("tel:+49301234567");
    expect(page).toContain("Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV");
    expect(text(".legal section:nth-of-type(3) .legal__lines")).toBe("Max MustermannMusterstraße 112345 Musterstadt");
    expect(page).toContain("Umsatzsteuer-Identifikationsnummer");
  });

  it("names the operator as responsible for the content when nobody else is given", () => {
    mount("#lang=en&p=imprint", { ...example, contentResponsible: undefined, imprint: undefined });
    expect(text(".legal h2")).toBe("Legal notice");
    expect(text(".legal section:nth-of-type(3) .legal__lines")).toBe("Erika MustermannMusterstraße 112345 Musterstadt");
    expect(container.querySelector(".legal__addition")).toBeNull();
  });

  it("gives name and contact, and no empty line, when the operator has no postal address", () => {
    const { address: _, ...nameOnly } = example.operator;
    const site: SiteConfig = { ...example, operator: nameOnly, contentResponsible: undefined, imprint: undefined };
    for (const language of ["de", "en"]) {
      mount(`#lang=${language}&p=imprint`, site);
      const names = [...container.querySelectorAll(".legal__body section:not(:nth-of-type(2)) .legal__lines")];
      expect(names.map((lines) => [...lines.children].map((line) => line.textContent))).toEqual([["Erika Mustermann"], ["Erika Mustermann"]]);
      expect(query<HTMLAnchorElement>('.legal a[href^="mailto:"]').getAttribute("href")).toBe("mailto:kontakt@example.org");
      expect([...container.querySelectorAll(".legal__body :is(p, span, h3)")].filter((element) => element.textContent?.trim() === "")).toEqual([]);
      act(() => root?.unmount());
      root = undefined;
    }
  });

  describe("cites § 5 DDG and § 18 Abs. 2 MStV in a heading only above a postal address", () => {
    const headings = (): string[] => [...container.querySelectorAll(".legal__body h3")].map((heading) => heading.textContent ?? "");
    const { address: _operatorAddress, ...operatorNameOnly } = example.operator;
    const { address: _responsibleAddress, ...responsibleNameOnly } = example.contentResponsible!;
    const cited = {
      de: { provider: "Angaben gemäß § 5 DDG", responsible: "Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV" },
      en: {
        provider: "Information pursuant to § 5 DDG (German Digital Services Act)",
        responsible: "Responsible for the content pursuant to § 18 (2) MStV (German Interstate Media Treaty)",
      },
    };
    const plain = {
      de: { provider: "Anbieter dieser Website", responsible: "Verantwortlich für den Inhalt" },
      en: { provider: "Provider of this website", responsible: "Responsible for the content" },
    };
    const contact = { de: "Kontakt", en: "Contact" };
    const cases = [
      { state: "both with an address", site: { ...example, imprint: undefined }, provider: cited, responsible: cited },
      {
        state: "the operator, who is also responsible for the content, without one",
        site: { ...example, operator: operatorNameOnly, contentResponsible: undefined, imprint: undefined },
        provider: plain,
        responsible: plain,
      },
      {
        state: "the operator without one, the person responsible for the content with one",
        site: { ...example, operator: operatorNameOnly, imprint: undefined },
        provider: plain,
        responsible: cited,
      },
      {
        state: "the operator with one, the person responsible for the content without one",
        site: { ...example, contentResponsible: responsibleNameOnly, imprint: undefined },
        provider: cited,
        responsible: plain,
      },
    ];
    for (const { state, site, provider, responsible } of cases) {
      it.each(["de", "en"] as const)(`${state}, in %s`, (language) => {
        mount(`#lang=${language}&p=imprint`, site);
        expect(headings()).toEqual([provider[language].provider, contact[language], responsible[language].responsible]);
      });
    }
  });
});

describe("the privacy statement", () => {
  it("describes the app, the hosting, the proxy, the legal basis and the rights, from the config", () => {
    mount("#lang=de&p=privacy", example);
    const page = text(".legal");
    // The app, as the code behaves.
    expect(page).toContain("Diese Anwendung rechnet vollständig in Ihrem Browser.");
    expect(page).toContain("Die Schaltfläche „Teilen“ kopiert die Adresse");
    expect(page).toContain("Die Anwendung setzt keine Cookies.");
    expect(page).toContain("Eintrag „budget-simulator:language“");
    // The link to the source code in the footer: nothing goes to GitHub before it is followed.
    expect(page).toContain(
      "Die Fußzeile verlinkt auf den Quelltext der Anwendung bei GitHub: Bevor Sie diesem Link folgen, wird nichts an GitHub übertragen; danach gelten die Datenschutzbestimmungen von GitHub.",
    );
    // Hosting and the server log, from the config.
    expect(page).toContain("Die Website liegt auf einem Server von Beispiel-Hosting GmbH, Serverweg 2, 12345 Musterstadt, Deutschland.");
    expect(page).toContain("Standort des Servers: Deutschland.");
    expect(page).toContain(
      "Ins Protokoll schreibt der Server zu jedem Abruf: Zeitpunkt, angefragte Adresse, Statuscode der Antwort, Größe der Antwort und die Seite, von der Sie kamen (Referrer).",
    );
    expect(page).toContain("Er speichert Ihre IP-Adresse und Ihre Browserkennung nicht und damit keine personenbezogenen Daten.");
    expect(page).toContain("Es ist auf 30 MB begrenzt");
    // The proxy, a transfer to the US, error reports.
    expect(page).toContain("Auslieferung über Example CDN, Inc.");
    expect(page).toContain("außerhalb der EU und des EWR verarbeitet werden (Vereinigte Staaten).");
    expect(page).toContain("EU-US Data Privacy Framework");
    expect(page).toContain("(Network Error Logging)");
    expect(query<HTMLAnchorElement>('.legal a[href="https://cdn.example.com/privacy"]').rel).toBe("noopener noreferrer");
    // Legal basis, rights, contact, the operator's own paragraphs, the date.
    expect(page).toContain("Art. 6 Abs. 1 lit. f DSGVO");
    expect(page).toContain("(Art. 15 bis 20 DSGVO)");
    expect(page).toContain("Widerspruchsrecht:");
    expect(page).toContain("(Art. 77 DSGVO)");
    expect(page).toContain("genügt eine E-Mail an kontakt@example.org.");
    expect(container.querySelectorAll(".legal__addition p")).toHaveLength(2);
    expect(text(".legal__updated")).toBe("Stand: 18.11.2026");
  });

  it("is there in English", () => {
    mount("#lang=en&p=privacy", example);
    const page = text(".legal");
    expect(document.title).toBe("Privacy policy – Budget Simulator");
    expect(page).toContain("The application sets no cookies.");
    expect(page).toContain(
      "The footer links to the application’s source code on GitHub: nothing is sent to GitHub before you follow that link, and after that GitHub’s own privacy terms apply.",
    );
    expect(page).toContain("Server location: Germany.");
    expect(page).toContain("outside the EU and the EEA (United States).");
    expect(page).toContain("A blank line starts a new paragraph.");
    expect(text(".legal__updated")).toBe("Last updated: 18 Nov 2026");
  });

  it("says so when the server logs addresses, and leaves out a proxy that is not there", () => {
    const logsAddresses: SiteConfig = {
      ...example,
      proxy: undefined,
      serverLog: { fields: ["time", "ipAddress", "request"], retention: { days: 14 } },
      privacy: undefined,
    };
    mount("#lang=de&p=privacy", logsAddresses);
    const page = text(".legal");
    expect(page).toContain("Ins Protokoll schreibt der Server zu jedem Abruf: Zeitpunkt, IP-Adresse und angefragte Adresse.");
    expect(page).not.toContain("keine personenbezogenen Daten");
    expect(page).toContain("Jeder Eintrag wird nach 14 Tagen gelöscht.");
    expect(page).not.toContain("Auslieferung über");
    expect(container.querySelector(".legal__updated")).toBeNull();
  });

  it("names the controller by name and e-mail when the operator has no postal address", () => {
    const { address: _, ...nameOnly } = example.operator;
    mount("#lang=de&p=privacy", { ...example, operator: nameOnly });
    const controller = query(".legal__body section:first-of-type");
    expect([...controller.querySelectorAll(".legal__lines span")].map((line) => line.textContent)).toEqual([
      "Erika Mustermann",
      "E-Mail: kontakt@example.org",
      "Telefon: +49 30 1234567",
    ]);
    expect([...container.querySelectorAll(".legal__body :is(p, span, h3)")].filter((element) => element.textContent?.trim() === "")).toEqual([]);
  });
});
