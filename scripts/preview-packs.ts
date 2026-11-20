/**
 * Which country packs a build contains.
 *
 * A pack can mark itself as a preview in its country.json ("preview": true): it is being written
 * and must not go live yet. The development server and the tests use every pack, and mark the
 * previews as such. A production build leaves the previews out entirely, unless the environment
 * variable PREVIEW_PACKS=include asks for them, to look at a build before a release.
 *
 * The Vite plugin below writes the module src/packFiles.ts for the build: an import.meta.glob of
 * the pack files with one negative pattern per pack left out, so that not even a file name of a
 * left-out pack reaches the bundle, and the list of previews it contains. It also prints which
 * countries the build contains, in a line that starts with "Countries:", which deploy.sh repeats.
 *
 * A country.json that cannot be read cannot say whether it is a preview: a production build
 * leaves that pack out too, and says so.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

export interface PackChoice {
  /** Packs the build contains, sorted. */
  included: string[];
  /** Of those, the ones marked as a preview. */
  previews: string[];
  /** Packs left out because they are a preview (or their country.json could not be read). */
  left: { id: string; why: "preview" | "unreadable" }[];
}

/** The packs in a directory of packs, and whether each marks itself as a preview; null if its country.json cannot be read. */
export function readPacks(dir: string): { id: string; preview: boolean | null }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      let preview: boolean | null;
      try {
        const country: unknown = JSON.parse(readFileSync(join(dir, entry.name, "country.json"), "utf8"));
        preview = typeof country === "object" && country !== null && (country as { preview?: unknown }).preview === true;
      } catch {
        preview = null;
      }
      return { id: entry.name, preview };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * What a build contains. `withPreviews`: the development server, the tests, or a production build
 * with PREVIEW_PACKS=include.
 */
export function choosePacks(packs: { id: string; preview: boolean | null }[], withPreviews: boolean): PackChoice {
  const included: string[] = [];
  const previews: string[] = [];
  const left: PackChoice["left"] = [];
  for (const { id, preview } of packs) {
    if (preview === false || withPreviews) {
      included.push(id);
      if (preview !== false) previews.push(id);
    } else {
      left.push({ id, why: preview === null ? "unreadable" : "preview" });
    }
  }
  return { included, previews, left };
}

/** The line the build prints and deploy.sh repeats. It always starts with "Countries:". */
export function countriesLine(choice: PackChoice, withPreviews: boolean, build: boolean): string {
  const list = (ids: string[]): string => (ids.length ? ids.join(", ") : "none");
  const contained = `Countries: ${list(choice.included)}.`;
  if (!build) {
    return choice.previews.length ? `${contained} Previews, marked as such in the country switch: ${list(choice.previews)}.` : contained;
  }
  if (withPreviews) {
    return choice.previews.length
      ? `${contained} PREVIEW packs built in because PREVIEW_PACKS=include: ${list(choice.previews)}. Do not publish this build unless they are meant to go live.`
      : `${contained} PREVIEW_PACKS=include is set, but no pack is a preview.`;
  }
  const previews = choice.left.filter((entry) => entry.why === "preview").map((entry) => entry.id);
  const unreadable = choice.left.filter((entry) => entry.why === "unreadable").map((entry) => entry.id);
  const parts = [contained];
  if (previews.length) parts.push(`Left out as previews: ${list(previews)} (PREVIEW_PACKS=include builds them in).`);
  if (unreadable.length) parts.push(`Left out because their country.json cannot be read: ${list(unreadable)}.`);
  if (!previews.length && !unreadable.length) parts.push("No pack is left out.");
  return parts.join(" ");
}

/** The code of src/packFiles.ts for a build that contains the chosen packs. */
export function packFilesModule(choice: PackChoice): string {
  const patterns = ["/countries/*/**/*.json", ...choice.left.map(({ id }) => `!/countries/${id}/**`)];
  return [
    `export const packFiles = import.meta.glob(${JSON.stringify(patterns)}, { query: "?raw", import: "default" });`,
    `export const previewPacks = ${JSON.stringify(choice.previews)};`,
    "",
  ].join("\n");
}

/** Whether PREVIEW_PACKS asks for the previews; anything other than unset, "" or "include" is a mistake. */
export function previewsWanted(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  if (value === "include") return true;
  throw new Error(`PREVIEW_PACKS must be "include" or unset, not "${value}".`);
}

export function previewPacksPlugin(root: string, options: { quiet?: boolean } = {}): Plugin {
  const target = resolve(root, "src/packFiles.ts");
  const countries = resolve(root, "countries");
  let build = false;
  let withPreviews = true;
  let line = "";
  const choice = (): PackChoice => choosePacks(readPacks(countries), withPreviews);
  return {
    name: "preview-packs",
    enforce: "pre",
    configResolved(resolved) {
      build = resolved.command === "build";
      // The development server and the tests show every pack; a build only on request.
      withPreviews = !build || previewsWanted(process.env.PREVIEW_PACKS);
      line = countriesLine(choice(), withPreviews, build);
      if (!build && !options.quiet) console.log(`  ${line}\n`);
    },
    load(id) {
      if (id.split("?")[0] !== target) return null;
      return packFilesModule(choice());
    },
    closeBundle() {
      if (build) console.log(`${line}\n`);
    },
  };
}
