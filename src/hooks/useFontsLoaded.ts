import { useEffect, useState } from "react";
import { clearTextWidths } from "./useElementWidth.ts";

/**
 * Counts up whenever a web font has finished loading. Label widths are measured on a canvas, and
 * until the font is there the canvas measures with the fallback font, so they must be redone.
 * `fonts` are the CSS fonts the labels use, asked for at once: the page may not have needed them yet.
 */
export function useFontsLoaded(fonts: readonly string[]): number {
  const [version, setVersion] = useState(0);
  const key = fonts.join("|");
  useEffect(() => {
    const faces = typeof document === "undefined" ? undefined : document.fonts;
    if (!faces || typeof faces.load !== "function") return;
    let alive = true;
    const remeasure = (): void => {
      if (!alive) return;
      clearTextWidths();
      setVersion((v) => v + 1);
    };
    void Promise.all(key.split("|").map((font) => faces.load(font))).then(remeasure, () => undefined);
    faces.addEventListener?.("loadingdone", remeasure);
    return () => {
      alive = false;
      faces.removeEventListener?.("loadingdone", remeasure);
    };
  }, [key]);
  return version;
}
