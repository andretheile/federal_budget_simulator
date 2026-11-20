/**
 * Which legal page (imprint, privacy statement) is shown in place of the simulator, and moving
 * between the pages and the simulator.
 *
 * The page is part of the address (#...&p=imprint), so it works on any static host and can be
 * linked to. Unlike every other change of the address, opening a page or going back to the
 * simulator adds an entry to the browser's history, so that its back button returns.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { LegalPage, SiteConfig } from "../site/config.ts";
import { parseHash } from "./urlState.ts";

export interface LegalNavigation {
  /** The page shown, or undefined for the simulator. Always undefined without a site config. */
  page: LegalPage | undefined;
  /** Show what the address asks for after the browser moved through its history. */
  follow(page: LegalPage | undefined): void;
  /**
   * Handle a click on a link to a page, or with `page` undefined back to the simulator. The link's
   * href is the address of that state. `target` is the id of an element to show once back.
   */
  go(event: MouseEvent<HTMLAnchorElement>, page: LegalPage | undefined, target?: string): void;
}

export function useLegalPage(site: SiteConfig | null, hash: string): LegalNavigation {
  const [page, setPage] = useState<LegalPage | undefined>(() => (site ? parseHash(hash).page : undefined));
  const pageRef = useRef(page);
  pageRef.current = page;
  /** Where to go on the simulator after leaving a page; the top of the main content if nothing is asked for. */
  const target = useRef<string | undefined>(undefined);

  const follow = useCallback((next: LegalPage | undefined) => setPage(site ? next : undefined), [site]);

  const go = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, next: LegalPage | undefined, then?: string) => {
      // A new tab or window: the browser opens the link itself.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (next !== undefined && next === pageRef.current) {
        window.scrollTo?.(0, 0);
        return;
      }
      const href = event.currentTarget.getAttribute("href");
      try {
        window.history.pushState(window.history.state, "", href || `${window.location.pathname}${window.location.search}`);
      } catch {
        // Refused (Safari's limit on history calls): the address follows with the next write.
      }
      target.current = then;
      follow(next);
    },
    [follow],
  );

  // Back on the simulator: show the element asked for, or the top of the page with the focus on
  // the main content. (On a page, the page itself moves the focus to its heading.)
  const shown = useRef(page);
  useEffect(() => {
    const before = shown.current;
    shown.current = page;
    if (before === undefined || page !== undefined) return;
    const element = document.getElementById(target.current ?? "main");
    target.current = undefined;
    if (element && element.id !== "main") element.scrollIntoView?.({ block: "start" });
    else window.scrollTo?.(0, 0);
    element?.focus?.({ preventScroll: true });
  }, [page]);

  return { page, follow, go };
}
