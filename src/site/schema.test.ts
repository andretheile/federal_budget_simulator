/**
 * The site config: what a valid file looks like, how a wrong one is reported, and the three
 * states a build can be in (no legal pages; legal pages, not indexed; legal pages, indexed).
 */
import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import exampleText from "../../site.config.example.json?raw";
import { pickNote, type SiteConfig } from "./config.ts";
import { applyNoscriptImprint, applyRobots, configProblems, parseSiteConfig, siteState, stateLine } from "./schema.ts";

const example = (): Record<string, unknown> => JSON.parse(exampleText) as Record<string, unknown>;

/** The example with a few changes applied, for a test of one field. */
function changed(change: (config: Record<string, any>) => void): Record<string, unknown> {
  const config = example();
  change(config);
  return config;
}

describe("a valid config", () => {
  it("is the committed example, with obviously made-up details", () => {
    const config = parseSiteConfig(exampleText, "site.config.example.json");
    expect(config.operator.name).toBe("Erika Mustermann");
    expect(config.operator.address).toEqual(["Musterstraße 1", "12345 Musterstadt"]);
    expect(config.operator.email).toMatch(/@example\.org$/);
    expect(configProblems(example())).toEqual([]);
  });

  it("needs only the operator, the hosting and the server log", () => {
    const minimal = {
      operator: { name: "Erika Mustermann", address: ["Musterstraße 1", "12345 Musterstadt"], email: "e@example.org" },
      hosting: { name: "Beispiel-Hosting GmbH", address: ["Serverweg 2", "12345 Musterstadt"], country: "DE" },
      serverLog: { fields: [] },
    };
    expect(configProblems(minimal)).toEqual([]);
    expect(siteState(parseSiteConfig(JSON.stringify(minimal), "minimal.json"))).toBe("noindex");
  });
});

describe("a config with mistakes", () => {
  it("names every wrong field, with what is wrong", () => {
    const problems = configProblems(
      changed((config) => {
        delete config.operator.email;
        config.operator.emial = "kontakt@example.org";
        config.operator.phone = "call me";
        config.hosting.address = [];
        config.indexable = "yes";
        config.serverLog.fields.push("cookies");
        config.privacy.updated = "18.11.2026";
      }),
    );
    expect(problems).toEqual([
      "indexable: must be true or false",
      "operator.email: is missing",
      'operator.phone: must be a phone number of digits, spaces and + ( ) / -, such as "+49 30 1234567"',
      'operator: unknown field "emial"',
      "hosting.address: needs at least one line",
      'serverLog.fields[5]: must be one of "time", "request", "status", "bytes", "referrer", "userAgent", "ipAddress"',
      "privacy.updated: must be a date written YYYY-MM-DD, such as 2026-11-18",
    ]);
  });

  it("asks for a transfer mechanism exactly for a country outside the EU and the EEA", () => {
    expect(configProblems(changed((config) => delete config.proxy.transfer))).toEqual([
      'proxy.transfer: is missing; it is required because US is outside the EU and the EEA: "dpf", "adequacy" or "scc"',
    ]);
    expect(configProblems(changed((config) => (config.hosting.transfer = "scc")))).toEqual([
      "hosting.transfer: is only for a country outside the EU and the EEA, and DE is inside; remove it",
    ]);
    expect(configProblems(changed((config) => (config.proxy.country = "CH")))).toEqual([
      'proxy.transfer: "dpf" (EU-US Data Privacy Framework) is only for "US"',
    ]);
    expect(configProblems(changed((config) => Object.assign(config.proxy, { country: "CH", transfer: "adequacy" })))).toEqual([]);
    expect(configProblems(changed((config) => (config.proxy.country = "us")))).toEqual([
      'proxy.country: must be a two-letter country code in capitals, such as "DE" or "US"',
    ]);
    expect(configProblems(changed((config) => (config.hosting.country = "XX")))).toEqual([
      "hosting.country: is not a known country code",
    ]);
  });

  it("wants to know how long log entries are kept, in one way", () => {
    expect(configProblems(changed((config) => delete config.serverLog.retention))).toEqual([
      'serverLog.retention: is missing: say how long log entries are kept, { "days": 14 } or { "maxMegabytes": 30 }',
    ]);
    expect(configProblems(changed((config) => (config.serverLog.retention = { days: 7, maxMegabytes: 30 })))).toEqual([
      'serverLog.retention: needs exactly one of "days" and "maxMegabytes"',
    ]);
    expect(configProblems(changed((config) => (config.serverLog.retention = { days: 7 })))).toEqual([]);
  });

  it("stops with a message that names the file", () => {
    expect(() => parseSiteConfig("{ \"operator\": ", "site.config.json")).toThrow(/^site\.config\.json is not valid JSON/);
    expect(() => parseSiteConfig("[]", "site.config.json")).toThrow(
      /^site\.config\.json is not a valid site config[\s\S]*\(top level\): Invalid input: expected object, received array/,
    );
  });
});

describe("the three states of a build", () => {
  const config = parseSiteConfig(exampleText, "site.config.example.json");
  const indexable: SiteConfig = { ...config, indexable: true };

  it("tells them apart by the config and its indexable flag", () => {
    expect(siteState(null)).toBe("none");
    expect(siteState(config)).toBe("noindex");
    expect(siteState({ ...config, indexable: false })).toBe("noindex");
    expect(siteState(indexable)).toBe("indexable");
  });

  it("says which one in a line that starts the same way each time", () => {
    expect(stateLine("none", null)).toMatch(/^Legal pages: NONE\. .*no imprint and no privacy statement/);
    expect(stateLine("noindex", "site.config.json")).toMatch(/^Legal pages: included, from site\.config\.json\. Search engines are asked not to index/);
    expect(stateLine("indexable", "/srv/site.json")).toMatch(/^Legal pages: included, from \/srv\/site\.json\. The site may be indexed/);
  });

  it("keeps the noindex tag in index.html unless the site is indexable", () => {
    const tag = '<meta name="robots" content="noindex" />';
    expect(indexHtml).toContain(tag);
    expect(applyRobots(indexHtml, false)).toBe(indexHtml);
    const open = applyRobots(indexHtml, true);
    expect(open).not.toContain("robots");
    // Only those two lines go.
    expect(open.split("\n").length).toBe(indexHtml.split("\n").length - 2);
  });

  it("refuses an index.html whose robots tag it cannot find", () => {
    const without = indexHtml.replace(/^.*name="robots".*\n/m, "");
    expect(() => applyRobots(without, false)).toThrow(/no <meta name="robots"/);
    expect(() => applyRobots(without, true)).toThrow(/no <meta name="robots"/);
  });

  it("adds nothing for visitors without JavaScript when there is no config", () => {
    expect(applyNoscriptImprint(indexHtml, null)).toBe(indexHtml);
  });

  it("puts the operator's name, address and contact into the <noscript> block when there is one", () => {
    const html = applyNoscriptImprint(indexHtml, config);
    const noscript = /<noscript[\s\S]*?<\/noscript\s*>/.exec(html)![0];
    // The notice that the page needs JavaScript stays, and the imprint follows it, inside the block.
    expect(noscript).toContain("needs JavaScript");
    expect(noscript).toContain("<h2>Impressum <span lang=\"en\">/ Legal notice</span></h2>");
    expect(noscript).toContain("<p>Erika Mustermann<br />Musterstraße 1<br />12345 Musterstadt</p>");
    expect(noscript).toContain('<a href="mailto:kontakt@example.org">kontakt@example.org</a>, +49 30 1234567');
    // Nothing else of the page changes.
    expect(html.replace(/<section class="noscript-imprint">[\s\S]*?<\/section>/, "")).toBe(indexHtml);
    // With the robots tag removed as well, for an indexable site.
    expect(applyNoscriptImprint(applyRobots(indexHtml, true), indexable)).toContain("Erika Mustermann");
  });

  it("writes the operator's details as text, and leaves out a phone number that is not given", () => {
    const odd: SiteConfig = {
      ...config,
      operator: { name: 'A & B <GmbH> "quoted"', address: ["Weg 1"], email: "a&b@example.org" },
    };
    const html = applyNoscriptImprint(indexHtml, odd);
    expect(html).toContain("A &amp; B &lt;GmbH&gt; &quot;quoted&quot;<br />Weg 1");
    expect(html).toContain('<a href="mailto:a&amp;b@example.org">a&amp;b@example.org</a></p>');
    expect(html).not.toContain("<GmbH>");
  });

  it("refuses an index.html without a <noscript> block when there is a config", () => {
    const without = indexHtml.replace(/<noscript[\s\S]*?<\/noscript\s*>/, "");
    expect(() => applyNoscriptImprint(without, config)).toThrow(/no <noscript> block/);
    expect(applyNoscriptImprint(without, null)).toBe(without);
  });
});

describe("the operator's own paragraphs", () => {
  it("come in the language of the page, else its base language, else English, else the first one given", () => {
    const note = { de: "Deutsch", en: "English" };
    expect(pickNote(note, "de")).toBe("Deutsch");
    expect(pickNote(note, "de-AT")).toBe("Deutsch");
    expect(pickNote(note, "fr")).toBe("English");
    expect(pickNote({ de: "Nur Deutsch" }, "en")).toBe("Nur Deutsch");
    expect(pickNote(undefined, "en")).toBeUndefined();
  });
});
