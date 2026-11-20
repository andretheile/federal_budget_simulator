/**
 * Preview packs: which packs a build contains, what it says about them, and, on two real
 * production builds of this repository, that a preview pack's files are not in a plain build and
 * are in a build with PREVIEW_PACKS=include.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { choosePacks, countriesLine, packFilesModule, previewsWanted, readPacks } from "./preview-packs.ts";

const root = resolve(import.meta.dirname, "..");
const packs = [
  { id: "de", preview: false },
  { id: "us", preview: true },
  { id: "xx", preview: null },
];

describe("the packs a build contains", () => {
  it("leaves previews and unreadable packs out of a production build, and says so", () => {
    const choice = choosePacks(packs, false);
    expect(choice).toEqual({
      included: ["de"],
      previews: [],
      left: [
        { id: "us", why: "preview" },
        { id: "xx", why: "unreadable" },
      ],
    });
    expect(countriesLine(choice, false, true)).toBe(
      "Countries: de. Left out as previews: us (PREVIEW_PACKS=include builds them in). Left out because their country.json cannot be read: xx.",
    );
    // One negative pattern per pack left out: not even a file name of it reaches the bundle.
    expect(packFilesModule(choice)).toContain('["/countries/*/**/*.json","!/countries/us/**","!/countries/xx/**"]');
    expect(packFilesModule(choice)).toContain("export const previewPacks = [];");
  });

  it("contains every pack on request, on the development server and in tests, with the previews marked", () => {
    const choice = choosePacks(packs, true);
    expect(choice.included).toEqual(["de", "us", "xx"]);
    expect(choice.previews).toEqual(["us", "xx"]);
    expect(countriesLine(choice, true, true)).toMatch(/^Countries: de, us, xx\. PREVIEW packs built in because PREVIEW_PACKS=include: us, xx\./);
    expect(countriesLine(choice, true, false)).toBe("Countries: de, us, xx. Previews, marked as such in the country switch: us, xx.");
    expect(packFilesModule(choice)).toContain('import.meta.glob(["/countries/*/**/*.json"]');
  });

  it("says when nothing is left out", () => {
    expect(countriesLine(choosePacks([{ id: "de", preview: false }], false), false, true)).toBe("Countries: de. No pack is left out.");
  });

  it("takes PREVIEW_PACKS=include, or nothing, and refuses anything else", () => {
    expect(previewsWanted(undefined)).toBe(false);
    expect(previewsWanted("")).toBe(false);
    expect(previewsWanted("include")).toBe(true);
    expect(() => previewsWanted("yes")).toThrow(/PREVIEW_PACKS must be "include" or unset/);
  });

  it("reads the mark from each pack's country.json in this repository", () => {
    const found = readPacks(join(root, "countries"));
    expect(found.find((pack) => pack.id === "de")?.preview).toBe(false);
    // The US pack is not public yet: it marks itself as a preview.
    expect(found.find((pack) => pack.id === "us")?.preview).toBe(true);
  });
});

/** Everything a build wrote, as one text. */
function written(dir: string): string {
  let out = "";
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    out += statSync(path).isDirectory() ? written(path) : readFileSync(path, "utf8");
  }
  return out;
}

/** Source ids only a pack has: words of its files that no other pack contains. */
function ownSourceIds(id: string, others: string[]): string[] {
  const read = (pack: string): string[] => Object.keys(JSON.parse(readFileSync(join(root, "countries", pack, "sources.json"), "utf8")));
  const elsewhere = new Set(others.flatMap(read));
  return read(id).filter((source) => !elsewhere.has(source));
}

describe("a production build of this repository", { timeout: 180_000 }, () => {
  const all = readPacks(join(root, "countries"));
  const previews = all.filter((pack) => pack.preview === true).map((pack) => pack.id);
  const live = all.filter((pack) => pack.preview === false).map((pack) => pack.id);

  async function buildInto(withPreviews: boolean): Promise<string> {
    const out = mkdtempSync(join(tmpdir(), "budget-build-"));
    const before = process.env.PREVIEW_PACKS;
    if (withPreviews) process.env.PREVIEW_PACKS = "include";
    else delete process.env.PREVIEW_PACKS;
    try {
      await build({ root, configFile: join(root, "vite.config.ts"), mode: "production", logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
      return written(out);
    } finally {
      if (before === undefined) delete process.env.PREVIEW_PACKS;
      else process.env.PREVIEW_PACKS = before;
      rmSync(out, { recursive: true, force: true });
    }
  }

  it("leaves the preview packs out entirely, and keeps the others", async () => {
    expect(previews).toContain("us");
    const text = await buildInto(false);
    for (const id of previews) {
      expect(text).not.toContain(`/countries/${id}/`);
      for (const source of ownSourceIds(id, live)) expect(text).not.toContain(source);
    }
    for (const id of live) expect(text).toContain(`/countries/${id}/`);
  });

  it("contains them when PREVIEW_PACKS=include asks for them", async () => {
    const text = await buildInto(true);
    for (const id of previews) {
      expect(text).toContain(`/countries/${id}/`);
      const own = ownSourceIds(id, live);
      expect(own.length).toBeGreaterThan(0);
      for (const source of own) expect(text).toContain(source);
    }
  });
});
