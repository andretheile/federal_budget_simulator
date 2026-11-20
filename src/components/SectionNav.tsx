/**
 * Where the page has one column (phone and tablet), the measures, the budget and the debt section
 * lie one under the other, below a list of some thirty measures. This row in the band that floats
 * at the top of the window leads to each of them with one tap and says which one is in view.
 *
 * The address fragment holds the state of the page, so the entries do not follow their href (it
 * stays for opening in a new tab): they scroll the section's heading to just below the band as it
 * will be once it floats, smoothly unless the visitor asks for less motion, and move the focus to
 * the section, so keyboard and screen reader users arrive there too.
 *
 * The budget includes the waterfall below it ("What changes"); the debt section only exists for a
 * pack with debt data.
 */
import { useEffect, useState, type MouseEvent } from "react";
import { useUi } from "../app/ui.ts";
import { reducedMotion } from "../hooks/useAnimatedNumber.ts";
import { preloadDebt } from "./DebtSection.tsx";

/** The destinations: the section to jump to, and the parts of the page that count as being in it. */
export const SECTION_TARGETS = {
  measures: { id: "measures", parts: ["measures"] },
  budget: { id: "budget", parts: ["budget", "what-changed"] },
  debt: { id: "debt", parts: ["debt"] },
} as const;
export type SectionKey = keyof typeof SECTION_TARGETS;

/** Room between the band and the heading a jump lands on. */
const GAP = 14;

/**
 * The height of the band as it is while it floats. Where it is not floating yet (at the top of the
 * page), it is measured floating for a moment, before anything is drawn, so the jump lands right
 * the first time instead of correcting itself once the band has shrunk.
 */
export function floatingBandHeight(): number {
  const section = document.querySelector<HTMLElement>(".scoreboard");
  const band = section?.querySelector<HTMLElement>(".scoreboard__band");
  if (!section || !band) return 0;
  if (section.classList.contains("is-stuck")) return band.getBoundingClientRect().height;
  // Without transitions while measuring: where the visitor asks for less motion, every property
  // gets a very short one (base.css), and a size read at once would still be the old one.
  section.classList.add("is-measuring", "is-stuck");
  const height = band.getBoundingClientRect().height;
  section.classList.remove("is-stuck");
  void band.getBoundingClientRect();
  section.classList.remove("is-measuring");
  return height;
}

/** Scrolls a section's heading to just below the floating band and gives the section the focus. */
export function jumpToSection(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  const heading = target.querySelector("h2") ?? target;
  const top = heading.getBoundingClientRect().top + window.scrollY - floatingBandHeight() - GAP;
  window.scrollTo?.({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
  target.focus?.({ preventScroll: true });
  return true;
}

/** Which destination is in view: the one whose parts cross a line a little below the band. */
export function sectionInView(keys: readonly SectionKey[]): SectionKey | undefined {
  const band = document.querySelector(".scoreboard__band")?.getBoundingClientRect();
  const line = (band ? band.bottom : 0) + 48;
  return keys.find((key) =>
    SECTION_TARGETS[key].parts.some((id) => {
      const box = document.getElementById(id)?.getBoundingClientRect();
      return box !== undefined && box.top <= line && box.bottom > line;
    }),
  );
}

export function SectionNav({ measures = true, debt }: { measures?: boolean; debt: boolean }) {
  const { t } = useUi();
  // A pack without measures yet has no list to lead to; one destination alone needs no row.
  const keys = (["measures", "budget", "debt"] as const).filter((key) => (key === "measures" ? measures : key === "debt" ? debt : true));
  const [current, setCurrent] = useState<SectionKey | undefined>();
  const signature = keys.join(",");

  // Follows scrolling and changes of size, at most once a frame.
  useEffect(() => {
    const list = signature.split(",") as SectionKey[];
    let frame = 0;
    const update = (): void => {
      frame = 0;
      setCurrent(sectionInView(list));
    };
    const request = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    return () => {
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      cancelAnimationFrame(frame);
    };
  }, [signature]);

  const labels: Record<SectionKey, string> = { measures: t.nav.measures, budget: t.nav.budget, debt: t.nav.debt };
  const follow = (event: MouseEvent<HTMLAnchorElement>, key: SectionKey): void => {
    if (key === "debt") preloadDebt();
    if (jumpToSection(SECTION_TARGETS[key].id)) event.preventDefault();
    setCurrent(key);
  };

  if (keys.length < 2) return null;
  return (
    <nav className="sectionnav" aria-label={t.nav.label}>
      <ul className="sectionnav__list page">
        {keys.map((key) => (
          <li key={key}>
            <a
              href={`#${SECTION_TARGETS[key].id}`}
              className="sectionnav__link"
              aria-current={current === key ? "location" : undefined}
              onClick={(event) => follow(event, key)}
              onPointerEnter={key === "debt" ? preloadDebt : undefined}
              onFocus={key === "debt" ? preloadDebt : undefined}
            >
              {labels[key]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
