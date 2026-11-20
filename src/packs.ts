/**
 * Loads country packs from /countries/<id>/ and validates them.
 *
 * The JSON files are bundled as raw text and parsed here, not by the bundler, so a pack with a
 * syntax error shows up as a validation error instead of breaking the build. Each file is its
 * own lazy chunk, so only the country that is opened gets downloaded. Which packs a build
 * contains is decided in packFiles.ts.
 */
import { validatePackFiles, type ValidationResult } from "./engine/index.ts";
import { packFiles, previewPacks } from "./packFiles.ts";

/**
 * The packs this build contains (see packFiles.ts): a production build leaves out the packs that
 * mark themselves as a preview, so an address that names one is treated as an unknown country.
 */
const loaders = packFiles;

/** Country id -> path inside the pack directory -> loader of the file's text. */
const packs = new Map<string, Map<string, () => Promise<string>>>();
for (const [path, load] of Object.entries(loaders)) {
  const match = /^\/countries\/([^/]+)\/(.+)$/.exec(path);
  if (!match) continue;
  const [, id, file] = match;
  let files = packs.get(id);
  if (!files) packs.set(id, (files = new Map()));
  files.set(file, load);
}

const loaded = new Map<string, Promise<ValidationResult>>();

/** Ids of all country packs that exist in /countries, valid or not. */
export function listPackIds(): string[] {
  return [...packs.keys()].sort();
}

export function hasPack(id: string): boolean {
  return packs.has(id);
}

/** Whether a pack of this build marks itself as a preview: not live yet, shown as such. */
export function isPreviewPack(id: string): boolean {
  return previewPacks.includes(id);
}

/**
 * Load and validate one country pack. Resolves to `{ ok: true, pack }` or to the list of
 * validation errors; a pack that does not exist is reported as an error too. Never rejects for
 * bad data.
 */
export function loadPack(id: string): Promise<ValidationResult> {
  let result = loaded.get(id);
  if (!result) {
    result = read(id);
    loaded.set(id, result);
  }
  return result;
}

async function read(id: string): Promise<ValidationResult> {
  const files = packs.get(id);
  if (!files) {
    return {
      ok: false,
      errors: [{ file: "", path: "$", message: `there is no country pack "${id}"` }],
      warnings: [],
    };
  }
  const texts: Record<string, string> = {};
  await Promise.all([...files].map(async ([file, load]) => void (texts[file] = await load())));
  return validatePackFiles(texts, id);
}
