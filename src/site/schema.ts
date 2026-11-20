/**
 * Checking a site config (see ./config.ts), and the three states a build can be in. Used by
 * vite.config.ts and the tests; the app gets the config already checked and does not load this.
 *
 * Objects are strict: an unknown key is an error, so that a misspelt field is not dropped silently.
 */
import { z } from "zod";
import { EEA, LOG_FIELDS, TRANSFERS, type SiteConfig, type Transfer } from "./config.ts";

// --- schema ---------------------------------------------------------------------------------

const text = z.string().trim().min(1, "must not be empty");
const lines = z.array(text, "must be a list of lines").min(1, "needs at least one line").max(8, "has more than 8 lines");

const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const countryCode = z.string().superRefine((code, ctx) => {
  if (!/^[A-Z]{2}$/.test(code)) {
    ctx.addIssue({ code: "custom", message: 'must be a two-letter country code in capitals, such as "DE" or "US"' });
  } else if (regionNames.of(code) === undefined) {
    ctx.addIssue({ code: "custom", message: "is not a known country code" });
  }
});

const email = z.string().regex(/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[A-Za-z]{2,}$/, "must be an e-mail address, such as name@example.org");
const phone = z.string().regex(/^\+?[0-9][0-9 ()/-]{3,28}[0-9]$/, 'must be a phone number of digits, spaces and + ( ) / -, such as "+49 30 1234567"');
const httpsUrl = z.string().regex(/^https:\/\/[^\s/]+\.[^\s]+$/, "must be an https:// address");
const isoDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}, "must be a date written YYYY-MM-DD, such as 2026-11-18");

const note = z
  .record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'must be a language code such as "de" or "en"'), text)
  .refine((value) => Object.keys(value).length > 0, 'needs at least one language, such as { "de": "…" }');

const party = { name: text, address: lines };
const provider = {
  ...party,
  country: countryCode,
  transfer: z.enum(TRANSFERS, 'must be "dpf", "adequacy" or "scc"').optional(),
  privacyPolicy: httpsUrl.optional(),
};

/** A transfer mechanism exactly where the GDPR asks for one: for a country outside the EU and the EEA. */
function checkTransfer(entry: { country: string; transfer?: Transfer }, ctx: z.RefinementCtx): void {
  // An unknown code is reported by itself; nothing can be said about a transfer there.
  if (!countryCode.safeParse(entry.country).success) return;
  const inside = EEA.has(entry.country);
  if (!inside && entry.transfer === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["transfer"],
      message: `is missing; it is required because ${entry.country} is outside the EU and the EEA: "dpf", "adequacy" or "scc"`,
    });
  }
  if (inside && entry.transfer !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["transfer"],
      message: `is only for a country outside the EU and the EEA, and ${entry.country} is inside; remove it`,
    });
  }
  if (entry.transfer === "dpf" && entry.country !== "US") {
    ctx.addIssue({ code: "custom", path: ["transfer"], message: '"dpf" (EU-US Data Privacy Framework) is only for "US"' });
  }
}

const retention = z
  .strictObject({
    days: z.number().int("must be a whole number").min(1, "must be at least 1").optional(),
    maxMegabytes: z.number().positive("must be more than 0").optional(),
  })
  .refine((value) => (value.days === undefined) !== (value.maxMegabytes === undefined), 'needs exactly one of "days" and "maxMegabytes"');

const flag = z.boolean("must be true or false");

// Rules that join two fields sit on the object that holds both, so they are checked even while
// other parts of the file still have problems.
const schema = z.strictObject({
  indexable: flag.optional(),
  operator: z.strictObject({ ...party, email, phone: phone.optional() }),
  contentResponsible: z.strictObject(party).optional(),
  hosting: z.strictObject(provider).superRefine(checkTransfer),
  proxy: z
    .strictObject({ ...provider, networkErrorReports: flag.optional() })
    .superRefine(checkTransfer)
    .optional(),
  serverLog: z
    .strictObject({
      fields: z
        .array(z.enum(LOG_FIELDS, `must be one of ${LOG_FIELDS.map((field) => `"${field}"`).join(", ")}`))
        .refine((fields) => new Set(fields).size === fields.length, "names a field twice"),
      retention: retention.optional(),
    })
    .superRefine((log, ctx) => {
      if (log.fields.length > 0 && log.retention === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["retention"],
          message: 'is missing: say how long log entries are kept, { "days": 14 } or { "maxMegabytes": 30 }',
        });
      }
    }),
  imprint: z.strictObject({ addition: note.optional() }).optional(),
  privacy: z.strictObject({ updated: isoDate.optional(), addition: note.optional() }).optional(),
});

export const siteConfigSchema: z.ZodType<SiteConfig> = schema;

// --- reading --------------------------------------------------------------------------------

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out === "" ? String(key) : `.${String(key)}`;
  }
  return out || "(top level)";
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let value = root;
  for (const key of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<PropertyKey, unknown>)[key];
  }
  return value;
}

/** One line per problem, each naming the field: "operator.email: must be an e-mail address …". */
export function configProblems(raw: unknown): string[] {
  const result = schema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = formatPath(issue.path);
    if (issue.code === "unrecognized_keys") {
      const names = issue.keys.map((key) => `"${key}"`).join(", ");
      return `${path}: unknown field${issue.keys.length > 1 ? "s" : ""} ${names}`;
    }
    if (issue.code === "invalid_type" && valueAt(raw, issue.path) === undefined) return `${path}: is missing`;
    if (issue.code === "invalid_key") return `${path}: "${String(issue.path.at(-1))}" is not a language code such as "de" or "en"`;
    return `${path}: ${issue.message}`;
  });
}

/**
 * Parse and check the text of a config file. Throws an Error whose message names the file and
 * every field that is wrong, so that a build with a broken config stops and says why.
 */
export function parseSiteConfig(source: string, fileName: string): SiteConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new Error(`${fileName} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const problems = configProblems(raw);
  if (problems.length > 0) {
    throw new Error(
      `${fileName} is not a valid site config (see site.config.example.json and the README):\n` +
        problems.map((problem) => `  ${problem}`).join("\n"),
    );
  }
  return schema.parse(raw);
}

// --- the three states of a build ------------------------------------------------------------

/** "none": no config, no legal pages. "noindex": legal pages, not indexed. "indexable": both. */
export type SiteState = "none" | "noindex" | "indexable";

export function siteState(config: SiteConfig | null): SiteState {
  if (!config) return "none";
  return config.indexable === true ? "indexable" : "noindex";
}

/** The line the build prints, and deploy.sh repeats before it uploads. It always starts with "Legal pages:". */
export function stateLine(state: SiteState, source: string | null): string {
  switch (state) {
    case "none":
      return "Legal pages: NONE. No site config (site.config.json or SITE_CONFIG), so the site has no imprint and no privacy statement and asks search engines not to index it.";
    case "noindex":
      return `Legal pages: included, from ${source}. Search engines are asked not to index the site ("indexable" is not true in the config).`;
    case "indexable":
      return `Legal pages: included, from ${source}. The site may be indexed by search engines ("indexable": true).`;
  }
}

const ROBOTS_COMMENT = /^[ \t]*<!-- robots:.*-->[ \t]*\r?\n/m;
const ROBOTS_META = /^[ \t]*<meta name="robots" content="noindex"\s*\/?>[ \t]*\r?\n/m;

/**
 * index.html as the build should ship it: with its "noindex" tag, or without it (and without the
 * comment above it) for an indexable site. Throws if index.html does not look as expected, rather
 * than publish a site whose indexing is not what the config says.
 */
export function applyRobots(html: string, indexable: boolean): string {
  if (!ROBOTS_META.test(html)) {
    throw new Error('index.html has no <meta name="robots" content="noindex" /> line; the build cannot control indexing.');
  }
  if (!indexable) return html;
  const out = html.replace(ROBOTS_COMMENT, "").replace(ROBOTS_META, "");
  if (/name=["']robots["']/i.test(out)) throw new Error("index.html still has a robots tag after removing the noindex line.");
  return out;
}

// --- the imprint for visitors without JavaScript ---------------------------------------------

const NOSCRIPT_END = /<\/noscript\s*>/;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/**
 * index.html with the operator's name, address and contact in its <noscript> block, so that a
 * visitor without JavaScript, who sees none of the app's pages, still finds the imprint. Short,
 * with German and English headings. Without a config the page is returned as it is. Throws if
 * index.html has no <noscript> block to put it in.
 */
export function applyNoscriptImprint(html: string, config: SiteConfig | null): string {
  if (!config) return html;
  const end = NOSCRIPT_END.exec(html);
  if (!end) throw new Error("index.html has no <noscript> block; the build cannot add the imprint for visitors without JavaScript.");
  const { operator } = config;
  const email = escapeHtml(operator.email);
  const lines = [operator.name, ...operator.address].map(escapeHtml).join("<br />");
  const contact = [`<a href="mailto:${email}">${email}</a>`, ...(operator.phone ? [escapeHtml(operator.phone)] : [])].join(", ");
  const block =
    `<section class="noscript-imprint"><h2>Impressum <span lang="en">/ Legal notice</span></h2>` +
    `<p>${lines}</p><p>Kontakt <span lang="en">/ Contact</span>: ${contact}</p></section>`;
  return html.slice(0, end.index) + block + html.slice(end.index);
}
