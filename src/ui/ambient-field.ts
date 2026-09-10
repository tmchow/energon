/* The ambient field: the marketing intro's particles, drifting behind the top of every Energon page.
   Charge follows the pointer; on drag-over the field flies behind the drop frame and wanders there. */

type Particle = {
  fx: number; fy: number; ph: number; dx: number; dy: number; rise: number; sp: number;
  sprite: HTMLCanvasElement; sz: number;
  ox: number; oy: number; vx: number; vy: number; heat: number;
  gx: number; gy: number; tx: number; ty: number; inside: boolean;
};

export type AmbientField = { destroy(): void };

const gatherListeners = new Set<(frame: HTMLElement | null) => void>();
let gatherFrame: HTMLElement | null = null;

/** Pages call this with the element the field should fly behind, or null to let it go. */
export function setGatherFrame(frame: HTMLElement | null): void {
  gatherFrame = frame;
  for (const fn of gatherListeners) fn(frame);
}

function sprite(color: string, r: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = r * 4;
  const g = c.getContext('2d')!, grd = g.createRadialGradient(r * 2, r * 2, 0, r * 2, r * 2, r * 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, color); grd.addColorStop(1, 'rgba(122,77,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, r * 4, r * 4); return c;
}

function numberVar(name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

export function mountAmbientField(host: HTMLElement, canvas: HTMLCanvasElement): AmbientField | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const density = Math.round(numberVar('--field-density', 130) * (coarse ? 0.65 : 1));
  const alphaBase = numberVar('--field-alpha', 0.5);
  const S1 = sprite('rgba(201,176,255,.95)', 4), S2 = sprite('rgba(176,140,255,.9)', 7), S3 = sprite('rgba(243,236,255,1)', 11);
  let W = 0, H = 0, hostDocLeft = 0, hostDocTop = 0;

  const P: Particle[] = [];
  for (let j = 0; j < density; j++) {
    const q = Math.random();
    P.push({ fx: Math.random(), fy: Math.random(), ph: Math.random() * 6.283, dx: 14 + Math.random() * 22, dy: 8 + Math.random() * 14, rise: 3 + Math.random() * 5, sp: 0.7 + Math.random() * 0.6,
      sprite: q < 0.07 ? S3 : q < 0.5 ? S2 : S1, sz: q < 0.07 ? 14 : q < 0.5 ? 9 : 5.5,
      ox: 0, oy: 0, vx: 0, vy: 0, heat: 0, gx: 0, gy: 0, tx: 0, ty: 0, inside: false });
  }
  function ambient(a: Particle, now: number): [number, number] {
    const t = now / 1000 * a.sp;
    let y = a.fy * H - (now / 1000) * a.rise; y = ((y % H) + H) % H;
    return [a.fx * W + Math.sin(t * 0.9 + a.ph) * a.dx + Math.sin(t * 0.37) * 6, y + Math.cos(t * 0.7 + a.ph) * a.dy];
  }
  function size() {
    const b = host.getBoundingClientRect(); W = b.width; H = b.height; hostDocLeft = b.left + scrollX; hostDocTop = b.top + scrollY;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let px = -9999, py = -9999, pointerUntil = 0;
  // Pointer math uses the host offset cached by size(); a layout read on every pointermove is too costly.
  function setPointer(x: number, y: number, hold: number) {
    px = x + scrollX - hostDocLeft; py = y + scrollY - hostDocTop; pointerUntil = performance.now() + hold;
  }
  const onMove = (e: PointerEvent) => { if (e.pointerType !== 'touch') setPointer(e.clientX, e.clientY, 120); };
  const onDown = (e: PointerEvent) => setPointer(e.clientX, e.clientY, 1400);
  const onTouch = (e: TouchEvent) => { const t = e.touches[0]; if (t) setPointer(t.clientX, t.clientY, 400); };
  const onLeave = () => { pointerUntil = 0; };

  let fr: DOMRect | null = null, gathering = false;
  function gather(frame: HTMLElement) {
    if (gathering) return;
    const now = performance.now(), b = host.getBoundingClientRect();
    for (const a of P) { const q = ambient(a, now); a.gx = q[0] + a.ox + b.left; a.gy = q[1] + a.oy + b.top; a.ox = a.oy = 0; a.inside = false; }
    gathering = true; host.classList.add('en-ambient--gathering'); size();
    fr = frame.getBoundingClientRect();
    for (const a of P) { a.tx = fr.left + 8 + Math.random() * (fr.width - 16); a.ty = fr.top + 8 + Math.random() * (fr.height - 16); }
    start();
  }
  function release() {
    if (!gathering) return;
    gathering = false; host.classList.remove('en-ambient--gathering'); size();
    const t = performance.now(), r = host.getBoundingClientRect();
    for (const a of P) { const q = ambient(a, t); a.ox = a.gx + a.ox - r.left - q[0]; a.oy = a.gy + a.oy - r.top - q[1]; a.vx = a.vy = 0; }
  }

  let raf = 0, inView = true, shown = !document.hidden;
  const R = coarse ? 150 : 190;
  const NO_FORCE = { fx: 0, fy: 0, target: 0 };
  function force(a: Particle, x: number, y: number, now: number): { fx: number; fy: number; target: number } {
    if (gathering && fr) {
      // Fly behind the frame, then keep wandering there: the target itself drifts, clamped inside the box.
      const tt = now / 1000 * a.sp;
      const mx = Math.max(fr.left + 6, Math.min(fr.right - 6, a.tx + Math.sin(tt * 0.9 + a.ph) * a.dx * 1.4));
      const my = Math.max(fr.top + 6, Math.min(fr.bottom - 6, a.ty + Math.cos(tt * 0.7 + a.ph) * a.dy * 1.4));
      const k = a.inside ? 0.012 : 0.0035;
      return { fx: (mx - x) * k, fy: (my - y) * k, target: 1 };
    }
    if (now >= pointerUntil) return NO_FORCE;
    const ddx = px - x, ddy = py - y, d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d >= R) return NO_FORCE;
    const k = 1 - d / R, s = 0.03 * k * k;
    return { fx: ddx / (d + 1) * s * R * 0.1, fy: ddy / (d + 1) * s * R * 0.1, target: k };
  }
  function frame(now: number) {
    raf = 0;
    if (!inView || !shown) { ctx!.clearRect(0, 0, W, H); return; }
    ctx!.clearRect(0, 0, W, H); ctx!.globalCompositeOperation = 'lighter';
    for (const a of P) {
      const base = gathering ? [a.gx, a.gy] : ambient(a, now), x = base[0] + a.ox, y = base[1] + a.oy;
      const { fx, fy, target } = force(a, x, y, now);
      const damp = gathering ? 0.93 : 0.86;
      a.vx = (a.vx + fx) * damp; a.vy = (a.vy + fy) * damp;
      a.ox = (a.ox + a.vx) * (gathering ? 1 : 0.965); a.oy = (a.oy + a.vy) * (gathering ? 1 : 0.965);
      if (gathering && fr) {
        const nx = base[0] + a.ox, ny = base[1] + a.oy;
        if (nx > fr.left && nx < fr.right && ny > fr.top && ny < fr.bottom) a.inside = true;
        if (a.inside) { a.ox = Math.max(fr.left + 4, Math.min(fr.right - 4, nx)) - base[0]; a.oy = Math.max(fr.top + 4, Math.min(fr.bottom - 4, ny)) - base[1]; }
      }
      a.heat += (target - a.heat) * (target > a.heat ? 0.18 : 0.04);
      const sz = a.sz * (1 + a.heat * 0.6), al = alphaBase * (0.65 + 0.35 * Math.sin(now / 900 + a.ph)) + a.heat * 0.55;
      ctx!.globalAlpha = Math.min(1, al);
      ctx!.drawImage(a.sprite, x - sz / 2, y - sz / 2, sz, sz);
    }
    ctx!.globalAlpha = 1; ctx!.globalCompositeOperation = 'source-over';
    raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf && inView && shown) raf = requestAnimationFrame(frame); }

  size();
  if (reduce) {
    // Reduced motion: one still frame of faint points, no loop, no pointer response, no gather.
    const drawStill = () => {
      ctx.globalCompositeOperation = 'lighter';
      for (const a of P) { const b = ambient(a, 0); ctx.globalAlpha = alphaBase * 0.36; ctx.drawImage(a.sprite, b[0] - a.sz / 2, b[1] - a.sz / 2, a.sz, a.sz); }
    };
    const onResizeStill = () => { size(); drawStill(); };
    drawStill();
    addEventListener('resize', onResizeStill);
    return { destroy() { removeEventListener('resize', onResizeStill); } };
  }

  const onResize = () => { if (!gathering) size(); };
  const onVisibility = () => { shown = !document.hidden; start(); };
  const io = new IntersectionObserver(es => { inView = es[0].isIntersecting; start(); }, { threshold: 0 });
  io.observe(host);
  addEventListener('resize', onResize);
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });
  addEventListener('touchmove', onTouch, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  document.addEventListener('visibilitychange', onVisibility);
  const onGather = (frame: HTMLElement | null) => { if (frame) gather(frame); else release(); };
  gatherListeners.add(onGather);
  if (gatherFrame) gather(gatherFrame);
  start();

  return {
    destroy() {
      gatherListeners.delete(onGather);
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      removeEventListener('resize', onResize);
      removeEventListener('pointermove', onMove); removeEventListener('pointerdown', onDown); removeEventListener('touchmove', onTouch);
      document.removeEventListener('pointerleave', onLeave); document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
