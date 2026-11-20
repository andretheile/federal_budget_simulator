/**
 * The files of the country packs, and which of them are previews.
 *
 * This is what the module says without the build's packs plugin (scripts/preview-packs.ts), which
 * replaces it with the same exports for the packs the build contains: every pack on the
 * development server and in tests; in a production build only the packs that are not marked as a
 * preview in their country.json, unless PREVIEW_PACKS=include asks for them too. A pack left out is
 * not in the bundle at all, not even its file names.
 */

/** Path below / ("/countries/de/budget.json") -> loader of the file's raw text. */
export const packFiles: Record<string, () => Promise<string>> = import.meta.glob<string>("/countries/*/**/*.json", {
  query: "?raw",
  import: "default",
});

/** Ids of the packs in this build that mark themselves as a preview. */
export const previewPacks: readonly string[] = [];
