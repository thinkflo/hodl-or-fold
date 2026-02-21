// packages/frontend/src/lib/utils/priceAnimation.ts
// Price animation utilities — tween, FLIP, and canvas resize for the custom chart.
//
// The tween is a class so each consumer owns its own RAF loop without
// fighting over a module-level singleton.

// ── Tween ─────────────────────────────────────────────────────────────────────

const TWEEN_MS = 800;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
const lerp      = (a: number, b: number, t: number) => a + (b - a) * t;

export class PriceTween {
  private from      = 0;
  private to        = 0;
  private startTime = 0;
  private rafId:    number | null = null;
  private onUpdate: (v: number) => void;

  constructor(onUpdate: (v: number) => void) {
    this.onUpdate = onUpdate;
  }

  start(from: number, to: number): void {
    this.from      = from;
    this.to        = to;
    this.startTime = performance.now();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.step);
  }

  private step = (now: number): void => {
    const t = Math.min((now - this.startTime) / TWEEN_MS, 1);
    this.onUpdate(lerp(this.from, this.to, easeInOut(t)));
    if (t < 1) this.rafId = requestAnimationFrame(this.step);
    else        this.rafId = null;
  };

  stop(): void {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }
}

// ── FLIP price animation ──────────────────────────────────────────────────────

const FLIP_MS     = 420;
const FLIP_EASING = 'cubic-bezier(.4,0,.2,1)';

/**
 * Animates a price value flying from sourceEl's screen position to targetEl's.
 * Both real elements are hidden during flight; a fixed-position clone performs
 * the transition. Call AFTER the UI has switched so targetEl has its final layout.
 */
export function flipPrice(
  sourceEl:  HTMLElement,
  targetEl:  HTMLElement,
  priceText: string,
  onLand:    () => void
): void {
  const fromRect = sourceEl.getBoundingClientRect();
  const fromSize = parseFloat(getComputedStyle(sourceEl).fontSize);
  const toRect   = targetEl.getBoundingClientRect();
  const toSize   = parseFloat(getComputedStyle(targetEl).fontSize);

  // Hide real elements while clone is in flight
  sourceEl.style.opacity = '0';
  targetEl.style.opacity = '0';

  const clone = document.createElement('span');
  clone.textContent = priceText;
  clone.style.cssText = `
    position: fixed;
    z-index: 999;
    pointer-events: none;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum";
    font-weight: 500;
    white-space: nowrap;
    color: #fff;
    left: ${fromRect.left}px;
    top: ${fromRect.top}px;
    font-size: ${fromSize}px;
    transition:
      left      ${FLIP_MS}ms ${FLIP_EASING},
      top       ${FLIP_MS}ms ${FLIP_EASING},
      font-size ${FLIP_MS}ms ${FLIP_EASING};
  `;
  document.body.appendChild(clone);

  // Force layout then start the transition
  clone.getBoundingClientRect();
  clone.style.left     = `${toRect.left}px`;
  clone.style.top      = `${toRect.top}px`;
  clone.style.fontSize = `${toSize}px`;

  setTimeout(() => {
    clone.remove();
    onLand();
  }, FLIP_MS + 20);
}

export function resizeCanvas(canvas: HTMLCanvasElement): void {
  const parent = canvas.parentElement;
  const w = parent ? parent.clientWidth : canvas.offsetWidth;
  canvas.width  = Math.round(w * devicePixelRatio);
  canvas.height = Math.round(130 * devicePixelRatio);
  canvas.style.width  = w + 'px';
  canvas.style.height = '130px';
}
