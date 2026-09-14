import { describe, expect, it } from "vitest";
import {
  FIGURE_EXTRA_REM,
  lightboxStartScale,
  overlayDownIsBackdrop,
  previewLayout,
  PROSE_MEASURE_REM,
  shouldDismissOverlay,
} from "../../public/static/md-expand.mjs";

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

describe("markdown expand overlay dismiss", () => {
  const tap = {
    eventType: "pointerup",
    downOnEmptyStage: true,
    moved: false,
    pinched: false,
    pointersRemaining: 0,
  };

  it("closes on an empty-stage click", () => {
    expect(shouldDismissOverlay(tap)).toBe(true);
  });

  it("does not close when the down target was the diagram or table", () => {
    expect(shouldDismissOverlay({ ...tap, downOnEmptyStage: false })).toBe(false);
  });

  it("does not close after a pan", () => {
    expect(shouldDismissOverlay({ ...tap, moved: true })).toBe(false);
  });

  it("does not close after a pinch even if the last lift looks like a click", () => {
    expect(shouldDismissOverlay({ ...tap, pinched: true })).toBe(false);
    expect(shouldDismissOverlay({ ...tap, pointersRemaining: 1 })).toBe(false);
  });

  it("does not close on pointercancel", () => {
    expect(shouldDismissOverlay({ ...tap, eventType: "pointercancel" })).toBe(false);
  });

  it("treats the pan wrapper as empty backdrop, not diagram content", () => {
    const stage = {};
    const svg = {};
    const pan = {
      contains(node) {
        return node === pan || node === svg;
      },
    };
    expect(overlayDownIsBackdrop(stage, stage, pan)).toBe(true);
    expect(overlayDownIsBackdrop(pan, stage, pan)).toBe(true);
    expect(overlayDownIsBackdrop(svg, stage, pan)).toBe(false);
    expect(overlayDownIsBackdrop(null, stage, pan)).toBe(true);
  });
});
