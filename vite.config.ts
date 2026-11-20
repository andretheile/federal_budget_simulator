import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { previewPacksPlugin } from "./scripts/preview-packs.ts";
import type { SiteConfig } from "./src/site/config.ts";
import { applyNoscriptImprint, applyRobots, parseSiteConfig, siteState, stateLine } from "./src/site/schema.ts";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Stop with a message that says it all; Vite prints the stack, and a trace into this file would only bury it. */
function fail(message: string): never {
  const error = new Error(message);
  error.stack = `Error: ${message}`;
  throw error;
}

/**
 * The operator's details for the legal pages: site.config.json in the repository root, or the
 * file the environment variable SITE_CONFIG names. No file: no legal pages. A file that does not
 * validate stops the build (and the dev server) with a message that names every wrong field.
 */
function loadSiteConfig(): { config: SiteConfig | null; source: string | null } {
  const wanted = process.env.SITE_CONFIG;
  const path = wanted ? resolve(wanted) : resolve(root, "site.config.json");
  if (!existsSync(path)) {
    if (wanted) fail(`SITE_CONFIG is set to ${wanted}, but there is no file ${path}.`);
    return { config: null, source: null };
  }
  const shown = path.startsWith(root) ? relative(root, path) : path;
  try {
    return { config: parseSiteConfig(readFileSync(path, "utf8"), shown), source: shown };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Removes the "noindex" tag from index.html for an indexable site, puts the operator's details into
 * its <noscript> block when there is a config, and says which state the build is in (and whether
 * the imprint lacks a postal address).
 */
function siteConfigPlugin(config: SiteConfig | null, source: string | null, quiet: boolean): Plugin {
  const indexable = siteState(config) === "indexable";
  const line = stateLine(config, source);
  let command: "build" | "serve" = "serve";
  return {
    name: "site-config",
    configResolved(resolved) {
      command = resolved.command;
      if (command === "serve" && !quiet) console.log(`\n  ${line}\n`);
    },
    transformIndexHtml(html) {
      return applyNoscriptImprint(applyRobots(html, indexable), config);
    },
    closeBundle() {
      if (command === "build") console.log(`\n${line}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  // The tests do not depend on the operator's file: they pass their own config where they need one.
  const testing = mode === "test" || process.env.VITEST !== undefined;
  const site = testing ? { config: null, source: null } : loadSiteConfig();
  return {
    // Which country packs the build contains: preview packs only on request (scripts/preview-packs.ts).
    plugins: [previewPacksPlugin(root, { quiet: testing }), react(), siteConfigPlugin(site.config, site.source, testing)],
    define: { __SITE_CONFIG__: JSON.stringify(site.config) },
    optimizeDeps: { entries: ["index.html"] },
    // Local Python environments (the pipeline's, leftovers) are large and never part of the app.
    server: { watch: { ignored: ["**/venv/**"] } },
    test: {
      environment: "node",
      projects: [
        { extends: true, test: { name: "app", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] } },
        // Real production builds (scripts/preview-packs.test.ts) take every core for a moment: they
        // run after all other tests, never beside the engine's timing tests.
        { extends: true, test: { name: "builds", include: ["scripts/**/*.test.ts"], sequence: { groupOrder: 1 } } },
      ],
    },
  };
});
