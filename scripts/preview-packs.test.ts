/**
 * Preview packs: which packs a build contains, what it says about them, and, on real production
 * builds, that a preview pack's files are not in a plain build and are in a build with
 * PREVIEW_PACKS=include.
 *
 * No shipped pack has to be a preview for this: the builds run on a temporary copy of this
 * repository (app, scripts and the shipped packs) with one more pack made for the test, which marks
 * itself as a preview. Nothing is written into the repository's own countries/.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { choosePacks, countriesLine, packFilesModule, previewsWanted, readPacks } from "./preview-packs.ts";

const root = resolve(import.meta.dirname, "..");
const packs = [
  { id: "de", preview: false },
  { id: "pv", preview: true },
  { id: "xx", preview: null },
];

describe("the packs a build contains", () => {
  it("leaves previews and unreadable packs out of a production build, and says so", () => {
    const choice = choosePacks(packs, false);
    expect(choice).toEqual({
      included: ["de"],
      previews: [],
      left: [
        { id: "pv", why: "preview" },
        { id: "xx", why: "unreadable" },
      ],
    });
    expect(countriesLine(choice, false, true)).toBe(
      "Countries: de. Left out as previews: pv (PREVIEW_PACKS=include builds them in). Left out because their country.json cannot be read: xx.",
    );
    // One negative pattern per pack left out: not even a file name of it reaches the bundle.
    expect(packFilesModule(choice)).toContain('["/countries/*/**/*.json","!/countries/pv/**","!/countries/xx/**"]');
    expect(packFilesModule(choice)).toContain("export const previewPacks = [];");
  });

  it("contains every pack on request, on the development server and in tests, with the previews marked", () => {
    const choice = choosePacks(packs, true);
    expect(choice.included).toEqual(["de", "pv", "xx"]);
    expect(choice.previews).toEqual(["pv", "xx"]);
    expect(countriesLine(choice, true, true)).toMatch(/^Countries: de, pv, xx\. PREVIEW packs built in because PREVIEW_PACKS=include: pv, xx\./);
    expect(countriesLine(choice, true, false)).toBe("Countries: de, pv, xx. Previews, marked as such in the country switch: pv, xx.");
    expect(packFilesModule(choice)).toContain('import.meta.glob(["/countries/*/**/*.json"]');
  });

  it("says no more than the countries when no pack is a preview", () => {
    const live = [
      { id: "de", preview: false },
      { id: "us", preview: false },
    ];
    expect(countriesLine(choosePacks(live, false), false, true)).toBe("Countries: de, us.");
    expect(countriesLine(choosePacks(live, false), false, false)).toBe("Countries: de, us.");
    expect(countriesLine(choosePacks(live, true), true, true)).toBe("Countries: de, us. PREVIEW_PACKS=include is set, but no pack is a preview.");
  });

  it("takes PREVIEW_PACKS=include, or nothing, and refuses anything else", () => {
    expect(previewsWanted(undefined)).toBe(false);
    expect(previewsWanted("")).toBe(false);
    expect(previewsWanted("include")).toBe(true);
    expect(() => previewsWanted("yes")).toThrow(/PREVIEW_PACKS must be "include" or unset/);
  });

  it("reads the mark from each pack's country.json, and a country.json that cannot be read as unknown", () => {
    const dir = mkdtempSync(join(tmpdir(), "budget-packs-"));
    try {
      const pack = (id: string, text: string): void => {
        mkdirSync(join(dir, id));
        writeFileSync(join(dir, id, "country.json"), text);
      };
      pack("aa", JSON.stringify({ id: "aa" }));
      pack("bb", JSON.stringify({ id: "bb", preview: true }));
      pack("cc", "{ not json");
      expect(readPacks(dir)).toEqual([
        { id: "aa", preview: false },
        { id: "bb", preview: true },
        { id: "cc", preview: null },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

/** The pack made for the test: its id, and a word that only its files contain. */
const PREVIEW_ID = "pv";
const MARKER = "preview_pack_marker_7f3a";

describe("a production build", { timeout: 180_000 }, () => {
  let copy = "";
  const shipped = readPacks(join(root, "countries"))
    .filter((pack) => pack.preview === false)
    .map((pack) => pack.id);

  beforeAll(() => {
    // The app as it is, its packs, and one pack under construction.
    copy = mkdtempSync(join(tmpdir(), "budget-repo-"));
    for (const entry of ["index.html", "vite.config.ts", "package.json", "tsconfig.json", "src", "scripts", "public", "countries"]) {
      if (existsSync(join(root, entry))) cpSync(join(root, entry), join(copy, entry), { recursive: true });
    }
    symlinkSync(join(root, "node_modules"), join(copy, "node_modules"), "dir");
    const dir = join(copy, "countries", PREVIEW_ID);
    expect(existsSync(dir)).toBe(false);
    mkdirSync(dir);
    writeFileSync(join(dir, "country.json"), JSON.stringify({ id: PREVIEW_ID, preview: true, name: { en: MARKER } }));
    writeFileSync(join(dir, "sources.json"), JSON.stringify({ [`${MARKER}_source`]: { title: MARKER } }));
  });

  afterAll(() => {
    if (copy) rmSync(copy, { recursive: true, force: true });
  });

  async function buildInto(withPreviews: boolean): Promise<string> {
    const out = mkdtempSync(join(tmpdir(), "budget-build-"));
    const before = process.env.PREVIEW_PACKS;
    if (withPreviews) process.env.PREVIEW_PACKS = "include";
    else delete process.env.PREVIEW_PACKS;
    try {
      await build({ root: copy, configFile: join(copy, "vite.config.ts"), mode: "production", logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
      return written(out);
    } finally {
      if (before === undefined) delete process.env.PREVIEW_PACKS;
      else process.env.PREVIEW_PACKS = before;
      rmSync(out, { recursive: true, force: true });
    }
  }

  it("leaves a preview pack out entirely, and keeps the others", async () => {
    const text = await buildInto(false);
    expect(text).not.toContain(`/countries/${PREVIEW_ID}/`);
    expect(text).not.toContain(MARKER);
    for (const id of shipped) expect(text).toContain(`/countries/${id}/`);
  });

  it("contains it when PREVIEW_PACKS=include asks for it", async () => {
    const text = await buildInto(true);
    expect(text).toContain(`/countries/${PREVIEW_ID}/`);
    expect(text).toContain(MARKER);
    for (const id of shipped) expect(text).toContain(`/countries/${id}/`);
  });
});
