/**
 * The site config this build was made with, or null if there was none. vite.config.ts replaces
 * __SITE_CONFIG__ with the checked contents of site.config.json (see ./config.ts).
 */
import type { SiteConfig } from "./config.ts";

declare const __SITE_CONFIG__: SiteConfig | null | undefined;

export const currentSite: SiteConfig | null = typeof __SITE_CONFIG__ === "undefined" ? null : (__SITE_CONFIG__ ?? null);
