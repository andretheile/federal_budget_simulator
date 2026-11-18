import { useLayoutEffect, useState, type RefObject } from "react";

/** The rendered width of an element in CSS pixels, kept up to date; 0 until it is known. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (): void => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

let canvas: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/**
 * Width of a text in the given CSS font, measured on a canvas. Where there is no canvas the
 * answer is Infinity, so callers that ask "does it fit?" leave the label out rather than clip it.
 */
export function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  if (canvas === undefined) {
    try {
      canvas = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      canvas = null;
    }
  }
  if (!canvas) return Infinity;
  canvas.font = font;
  const width = canvas.measureText(text).width;
  widths.set(key, width);
  return width;
}

/** Forget measured widths, e.g. after a web font has finished loading. */
export function clearTextWidths(): void {
  widths.clear();
}
