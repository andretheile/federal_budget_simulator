import { useEffect, useRef, useState } from "react";

/** True if the visitor asked for reduced motion, or if there is no way to ask (no media queries). */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : true;
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Follows `target` smoothly: returns a value that glides from where it currently is to the new
 * target. A new target while gliding starts from the value on screen, so dragging a slider never
 * makes the number jump. Without animation frames, or if the visitor asked for reduced motion,
 * it returns the target right away.
 */
export function useAnimatedNumber(target: number, duration = 380): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    if (
      reducedMotion() ||
      typeof requestAnimationFrame !== "function" ||
      !Number.isFinite(from) ||
      !Number.isFinite(target)
    ) {
      current.current = target;
      setShown(target);
      return;
    }
    let frame = 0;
    let start: number | undefined;
    const step = (now: number): void => {
      start ??= now;
      const t = Math.min(1, (now - start) / duration);
      const value = t >= 1 ? target : from + (target - from) * easeOutCubic(t);
      current.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return shown;
}
