// @vitest-environment jsdom
/**
 * The parts of the row of sections that depend on where things are on the screen, with the boxes
 * given by hand (jsdom lays nothing out): which section is in view, and how tall the band is while
 * it floats, measured without leaving a trace.
 */
import { afterEach, describe, expect, it } from "vitest";
import { floatingBandHeight, sectionInView } from "./SectionNav.tsx";

/** Gives an element a box: top and height in the window. */
function place(element: Element, top: number, height: number): void {
  element.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 390, width: 390, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the section in view", () => {
  /** A band 164 px tall at the top, and the sections one under the other from the given tops. */
  function page(tops: Record<string, [number, number]>): void {
    document.body.innerHTML = `<section class="scoreboard"><div class="scoreboard__band"></div></section>
      <section id="measures"></section><section id="budget"></section><section id="what-changed"></section>
      <section id="debt"></section><section id="about"></section>`;
    place(document.querySelector(".scoreboard__band")!, 0, 164);
    for (const [id, [top, height]] of Object.entries(tops)) place(document.getElementById(id)!, top, height);
  }
  const all = ["measures", "budget", "debt"] as const;

  it("is the one that crosses a line a little below the band", () => {
    page({ measures: [-5000, 6000], budget: [1000, 900], "what-changed": [1900, 600], debt: [2500, 4000], about: [6500, 900] });
    expect(sectionInView(all)).toBe("measures");
    page({ measures: [-6000, 6000], budget: [100, 900], "what-changed": [1000, 600], debt: [1600, 4000], about: [5600, 900] });
    expect(sectionInView(all)).toBe("budget");
  });

  it("counts the waterfall as part of the budget, and nothing below the debt section", () => {
    page({ measures: [-7000, 6000], budget: [-1000, 900], "what-changed": [-100, 600], debt: [500, 4000], about: [4500, 900] });
    expect(sectionInView(all)).toBe("budget");
    page({ measures: [-12000, 6000], budget: [-6000, 900], "what-changed": [-5100, 600], debt: [-4500, 4000], about: [-500, 900] });
    expect(sectionInView(all)).toBeUndefined();
  });

  it("only knows the sections it is given (a pack without debt data)", () => {
    page({ measures: [-9000, 6000], budget: [-3000, 900], "what-changed": [-2100, 600], debt: [100, 4000], about: [4100, 900] });
    expect(sectionInView(["measures", "budget"])).toBeUndefined();
    expect(sectionInView(all)).toBe("debt");
  });
});

describe("the height of the band while it floats", () => {
  function band(stuckHeight: number, height: number): HTMLElement {
    document.body.innerHTML = `<section class="scoreboard"><div class="scoreboard__band"></div></section>`;
    const section = document.querySelector<HTMLElement>(".scoreboard")!;
    const element = section.querySelector<HTMLElement>(".scoreboard__band")!;
    element.getBoundingClientRect = () => {
      // Transitions must be off whenever the floating size is read.
      if (section.classList.contains("is-stuck") && !section.classList.contains("is-measuring") && !section.dataset.real) throw new Error("measured with transitions");
      const h = section.classList.contains("is-stuck") ? stuckHeight : height;
      return { top: 0, bottom: h, height: h, left: 0, right: 390, width: 390, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    return section;
  }

  it("is measured floating for a moment where the band is not floating yet, and leaves no trace", () => {
    const section = band(164, 349);
    expect(floatingBandHeight()).toBe(164);
    expect(section.className).toBe("scoreboard");
  });

  it("is simply its height where it floats already", () => {
    const section = band(164, 349);
    section.dataset.real = "1";
    section.classList.add("is-stuck");
    expect(floatingBandHeight()).toBe(164);
    expect(section.className).toBe("scoreboard is-stuck");
  });
});
