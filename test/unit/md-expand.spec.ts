import { describe, expect, it } from "vitest";
import { FIGURE_EXTRA_REM, lightboxStartScale, previewLayout, PROSE_MEASURE_REM } from "../../public/static/md-expand.mjs";

describe("markdown expand layout", () => {
  it("keeps a wide graph at the min height instead of a smear", () => {
    const r = previewLayout(3276, 400, 800, 200);
    expect(r.scale).toBe(0.5);
    expect(r.height).toBe(200);
    expect(r.clipped).toBe(true);
  });

  it("does not upscale a graph that already fits", () => {
    const r = previewLayout(400, 300, 800, 200);
    expect(r.scale).toBe(1);
    expect(r.height).toBe(300);
    expect(r.clipped).toBe(false);
  });

  it("fits the overlay start scale inside the stage without exceeding 1", () => {
    expect(lightboxStartScale(400, 300, 1200, 800, 280)).toBe(1);
    expect(lightboxStartScale(3276, 400, 1200, 800, 280)).toBe(0.7);
  });

  it("keeps figure width as prose plus a small extra", () => {
    expect(PROSE_MEASURE_REM).toBe(46);
    expect(FIGURE_EXTRA_REM).toBe(6);
  });
});
