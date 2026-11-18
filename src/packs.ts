/**
 * Loads country packs from /countries/<id>/ and validates them.
 *
 * The JSON files are bundled as raw text and parsed here, not by the bundler, so a pack with a
 * syntax error shows up as a validation error instead of breaking the build. Each file is its
 * own lazy chunk, so only the country that is opened gets downloaded.
 */
import { validatePackFiles, type ValidationResult } from "./engine/index.ts";

const loaders = import.meta.glob<string>("/countries/*/**/*.json", { query: "?raw", import: "default" });

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
