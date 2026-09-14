/** Public Markdown mermaid + wide-table expand. No mermaid re-parse on open. */

export const PREVIEW_MIN_HEIGHT = 200;
export const LIGHTBOX_MIN_HEIGHT = 280;
export const LIGHTBOX_PAD = 48;
export const LIGHTBOX_MIN_SCALE = 0.15;
export const LIGHTBOX_MAX_SCALE = 8;
/** Matches `--measure-md` (46rem) and `--md-figure` (`measure-md + 6rem`). */
export const PROSE_MEASURE_REM = 46;
export const FIGURE_EXTRA_REM = 6;

/**
 * @param {number} iw
 * @param {number} ih
 * @param {number} boxW
 * @param {number} minH
 * @returns {{ scale: number, height: number, clipped: boolean }}
 */
export function previewLayout(iw, ih, boxW, minH) {
  const width = Math.max(0, boxW);
  if (!(iw > 0 && ih > 0 && width > 0)) {
    return { scale: 1, height: Math.max(0, minH), clipped: false };
  }
  let scale = Math.min(1, width / iw);
  let height = ih * scale;
  if (height < minH && ih >= minH) {
    scale = minH / ih;
    height = minH;
  } else if (height < minH) {
    height = minH;
  }
  const clipped = iw * scale > width + 1 || ih * scale > height + 1;
  return { scale, height, clipped };
}

/**
 * @param {number} iw
 * @param {number} ih
 * @param {number} vw
 * @param {number} vh
 * @param {number} minH
 * @param {number} [pad]
 */
export function lightboxStartScale(iw, ih, vw, vh, minH, pad = LIGHTBOX_PAD) {
  if (!(iw > 0 && ih > 0)) return 1;
  const availW = Math.max(120, vw - pad);
  const availH = Math.max(120, vh - pad);
  let scale = Math.min(1, availW / iw, availH / ih);
  if (ih * scale < minH) scale = Math.max(scale, minH / ih);
  return Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, scale));
}

/**
 * @param {SVGSVGElement} svg
 * @returns {{ w: number, h: number }}
 */
export function svgIntrinsicSize(svg) {
  const vb = svg.viewBox?.baseVal;
  let w = parseLength(svg.getAttribute("width"));
  let h = parseLength(svg.getAttribute("height"));
  if (!(w > 0) && vb && vb.width > 0) w = vb.width;
  if (!(h > 0) && vb && vb.height > 0) h = vb.height;
  if (!(w > 0 && h > 0)) {
    try {
      const box = svg.getBBox();
      if (box.width > 0 && box.height > 0) {
        w = box.width;
        h = box.height;
      }
    } catch {
      /* SVG not rendered */
    }
  }
  if (!(w > 0 && h > 0)) {
    const rect = svg.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
  }
  return { w, h };
}

/** @param {string | null} value */
function parseLength(value) {
  if (!value || value.endsWith("%")) return NaN;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/** @param {ParentNode} [root] */
export function mountMarkdownExpand(root = document) {
  const article = root.querySelector?.(".en-md");
  if (!article || !("querySelectorAll" in article)) return;
  for (const pre of article.querySelectorAll("pre.mermaid")) {
    try {
      wrapDiagram(pre);
    } catch {
      /* keep remaining figures */
    }
  }
  for (const table of article.querySelectorAll(":scope > table")) {
    try {
      wrapWideTable(table, article);
    } catch {
      /* keep remaining tables */
    }
  }
  observeExpandLayout(article);
}

/** @type {WeakSet<Element>} */
const expandObserved = new WeakSet();

/** @param {Element} article */
function observeExpandLayout(article) {
  if (typeof ResizeObserver !== "function" || expandObserved.has(article)) return;
  expandObserved.add(article);
  const relayout = () => {
    for (const pre of article.querySelectorAll(".en-md-diagram pre.mermaid")) layoutPreview(pre);
    for (const table of article.querySelectorAll(":scope > table")) wrapWideTable(table, article);
  };
  new ResizeObserver(relayout).observe(article);
}

/** @param {HTMLElement} pre */
function wrapDiagram(pre) {
  if (pre.closest(".en-md-figure")) {
    layoutPreview(pre);
    return;
  }
  const svg = pre.querySelector("svg");
  if (!svg) return;

  const figure = document.createElement("figure");
  figure.className = "en-md-figure en-md-diagram";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "en-md-diagram-open";
  open.setAttribute("aria-label", "Expand diagram");

  const preview = document.createElement("div");
  preview.className = "en-md-diagram-preview";
  const scale = document.createElement("div");
  scale.className = "en-md-diagram-scale";
  const hint = document.createElement("span");
  hint.className = "en-md-expand-hint";
  hint.textContent = "Expand";

  const parent = pre.parentNode;
  if (!parent) return;
  parent.insertBefore(figure, pre);
  scale.append(pre);
  preview.append(scale);
  open.append(preview, hint);
  figure.append(open);
  open.addEventListener("click", () => openExpand({ kind: "diagram", source: svg, label: "Expanded diagram" }));
  layoutPreview(pre);
}

/**
 * @param {HTMLTableElement} table
 * @param {Element} article
 */
function wrapWideTable(table, article) {
  if (table.closest(".en-md-figure")) return;
  table.style.width = "max-content";
  table.style.maxWidth = "none";
  const natural = table.scrollWidth;
  const prose = Math.min(article.clientWidth, remPx(PROSE_MEASURE_REM));
  if (natural <= prose + 8) {
    table.style.width = "";
    table.style.maxWidth = "";
    return;
  }

  const figure = document.createElement("figure");
  figure.className = "en-md-figure en-md-table";
  const preview = document.createElement("div");
  preview.className = "en-md-table-preview";

  const parent = table.parentNode;
  if (!parent) return;
  parent.insertBefore(figure, table);
  preview.append(table);
  figure.append(preview);
  table.style.width = "max-content";
  table.style.maxWidth = "none";

  if (table.scrollWidth > preview.clientWidth + 8) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "en-md-expand-hint en-md-expand-hint--btn";
    open.setAttribute("aria-label", "Expand table");
    open.textContent = "Expand";
    figure.append(open);
    open.addEventListener("click", () => openExpand({ kind: "table", source: table, label: "Expanded table" }));
  }
}

/** @param {number} rem */
function remPx(rem) {
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return rem * (Number.isFinite(root) && root > 0 ? root : 16);
}

/** @param {HTMLElement} pre */
function layoutPreview(pre) {
  const svg = pre.querySelector("svg");
  const preview = pre.closest(".en-md-diagram-preview");
  const scaleBox = pre.closest(".en-md-diagram-scale");
  const open = pre.closest(".en-md-diagram-open");
  if (!svg || !preview || !scaleBox || !open) return;
  const { w, h } = svgIntrinsicSize(svg);
  const minH = previewMinHeight(preview);
  const { scale, height, clipped } = previewLayout(w, h, preview.clientWidth, minH);
  scaleBox.style.width = `${w}px`;
  scaleBox.style.height = `${h}px`;
  scaleBox.style.transform = `scale(${scale})`;
  preview.style.height = `${height}px`;
  open.classList.toggle("en-md-diagram-open--clipped", clipped);
}

/** @param {HTMLElement} preview */
function previewMinHeight(preview) {
  const n = Number.parseFloat(getComputedStyle(preview).minHeight);
  return Number.isFinite(n) && n > 0 ? n : PREVIEW_MIN_HEIGHT;
}

/**
 * @param {{ kind: "diagram" | "table", source: Element, label: string }} spec
 */
function openExpand(spec) {
  const dialog = ensureExpand();
  const stage = dialog.querySelector(".en-md-expand-stage");
  const pan = dialog.querySelector(".en-md-expand-pan");
  if (!stage || !pan) return;
  dialog._energonRestore?.();
  dialog._energonRestore = null;
  dialog.setAttribute("aria-label", spec.label);
  pan.replaceChildren();

  let w = 0;
  let h = 0;
  /** @type {HTMLElement | null} */
  let diagramPre = null;
  if (spec.kind === "diagram" && spec.source instanceof SVGSVGElement) {
    diagramPre = spec.source.closest("pre.mermaid");
    const home = spec.source.parentNode;
    const next = spec.source.nextSibling;
    const { w: iw, h: ih } = svgIntrinsicSize(spec.source);
    w = iw;
    h = ih;
    spec.source.style.width = `${iw}px`;
    spec.source.style.height = `${ih}px`;
    spec.source.style.maxWidth = "none";
    spec.source.removeAttribute("width");
    spec.source.removeAttribute("height");
    pan.append(spec.source);
    dialog._energonRestore = () => {
      spec.source.style.width = "";
      spec.source.style.height = "";
      spec.source.style.maxWidth = "";
      if (home) home.insertBefore(spec.source, next);
      if (diagramPre) layoutPreview(diagramPre);
    };
  } else if (spec.kind === "table") {
    const shell = document.createElement("div");
    shell.className = "en-md";
    shell.append(spec.source.cloneNode(true));
    pan.append(shell);
  }
  dialog.showModal();
  if (spec.kind === "table") {
    const boxed = pan.firstElementChild;
    w = Math.max(boxed?.scrollWidth ?? 0, pan.scrollWidth);
    h = Math.max(boxed?.scrollHeight ?? 0, pan.scrollHeight);
  }
  const scale = lightboxStartScale(w, h, stage.clientWidth, stage.clientHeight, LIGHTBOX_MIN_HEIGHT);
  const x = (stage.clientWidth - w * scale) / 2;
  const y = (stage.clientHeight - h * scale) / 2;
  dialog._energonPan?.set(scale, x, y);
}

function ensureExpand() {
  let dialog = document.getElementById("en-md-expand");
  if (dialog instanceof HTMLDialogElement) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "en-md-expand";
  dialog.className = "en-md-expand";
  dialog.setAttribute("aria-label", "Expanded view");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "en-btn en-btn--sm en-md-expand-close";
  close.textContent = "Close";

  const stage = document.createElement("div");
  stage.className = "en-md-expand-stage";
  const pan = document.createElement("div");
  pan.className = "en-md-expand-pan";
  stage.append(pan);
  dialog.append(close, stage);
  document.body.append(dialog);

  const dismiss = () => dialog.close();
  close.addEventListener("click", dismiss);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener("close", () => {
    dialog._energonRestore?.();
    dialog._energonRestore = null;
    pan.replaceChildren();
  });
  dialog._energonPan = attachPanZoom(stage, pan, dismiss);
  return dialog;
}

/**
 * Empty-stage click closes the overlay. `setPointerCapture` retargets
 * `pointerup` at the stage, so this uses the pointerdown target instead.
 * The pan wrapper is a transform host and may fill the stage; only SVG/table
 * descendants count as content.
 *
 * @param {{
 *   eventType: string,
 *   downOnEmptyStage: boolean,
 *   moved: boolean,
 *   pinched: boolean,
 *   pointersRemaining: number,
 * }} gesture
 */
export function shouldDismissOverlay(gesture) {
  return (
    gesture.eventType === "pointerup" &&
    gesture.downOnEmptyStage &&
    !gesture.moved &&
    !gesture.pinched &&
    gesture.pointersRemaining === 0
  );
}

/**
 * @param {EventTarget | null} target
 * @param {Element} stage
 * @param {Element} pan
 */
export function overlayDownIsBackdrop(target, stage, pan) {
  if (target == null) return true;
  if (target === stage || target === pan) return true;
  if (typeof pan.contains !== "function") return true;
  return !pan.contains(target);
}

/**
 * @param {HTMLElement} stage
 * @param {HTMLElement} pan
 * @param {() => void} onBackdrop
 */
function attachPanZoom(stage, pan, onBackdrop) {
  const pointers = new Map();
  let scale = 1;
  let x = 0;
  let y = 0;
  let pinchDist = 0;
  let pinchScale = 1;
  let moved = false;
  let pinched = false;
  let downOnEmptyStage = false;
  let dragOffX = 0;
  let dragOffY = 0;

  const apply = () => {
    pan.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };

  const set = (nextScale, nx, ny) => {
    scale = nextScale;
    x = nx;
    y = ny;
    apply();
  };

  const zoomAt = (clientX, clientY, factor) => {
    const rect = stage.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const px = (cx - x) / scale;
    const py = (cy - y) / scale;
    scale = Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, scale * factor));
    x = cx - px * scale;
    y = cy - py * scale;
    apply();
  };

  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false },
  );

  stage.addEventListener("pointerdown", (event) => {
    if (event.button && event.button !== 0) return;
    if (pointers.size === 0) {
      moved = false;
      pinched = false;
      downOnEmptyStage = overlayDownIsBackdrop(event.target, stage, pan);
    } else {
      pinched = true;
    }
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      dragOffX = x - event.clientX;
      dragOffY = y - event.clientY;
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      pinchScale = scale;
    }
  });

  stage.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    const prev = pointers.get(event.pointerId);
    if (Math.hypot(event.clientX - prev.x, event.clientY - prev.y) > 4) moved = true;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinchScale * dist) / pinchDist / scale);
      return;
    }
    if (pointers.size === 1) {
      x = event.clientX + dragOffX;
      y = event.clientY + dragOffY;
      apply();
    }
  });

  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 1) {
      const remain = [...pointers.values()][0];
      dragOffX = x - remain.x;
      dragOffY = y - remain.y;
    }
    if (
      shouldDismissOverlay({
        eventType: event.type,
        downOnEmptyStage,
        moved,
        pinched,
        pointersRemaining: pointers.size,
      })
    ) {
      onBackdrop();
    }
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  stage.addEventListener("lostpointercapture", (event) => pointers.delete(event.pointerId));

  return { set };
}
