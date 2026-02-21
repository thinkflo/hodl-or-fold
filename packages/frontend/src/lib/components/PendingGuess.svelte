<!-- packages/frontend/src/lib/components/PendingGuess.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    phase, secondsLeft, direction, entryPrice,
    price as livePrice, standing, roundStartMs,
  } from '$lib/stores/game';
  import { PriceTween, resizeCanvas } from '$lib/utils/priceAnimation';

  export let entryPriceEl: HTMLElement | undefined = undefined;

  const ROUND_SECS = 60;
  const RING_R     = 46;
  const RING_CIRC  = 2 * Math.PI * RING_R;

  // ── Canvas state ──────────────────────────────────────────────────────────
  let canvas:     HTMLCanvasElement;
  let rafId:      number | null = null;
  let roundStart  = performance.now();
  /** Entry price locked at round start so the chart never shows "entry" as the 60s price. */
  let chartEntry  = 0;
  /** Committed price per second (immutable in price space); Y is recomputed from current scale each frame. */
  let history:    number[] = [];
  let dispPrice   = 0;
  let smoothMin   = 0;
  let smoothMax   = 0;
  let frozen      = false;

  const tween = new PriceTween((v) => { dispPrice = v; });

  let moveText  = '';
  let moveColor = '#888';

  const fmt    = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtAbs = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  $: ringColor = $secondsLeft > 30 ? '#00ff88' : $secondsLeft > 10 ? '#ffcc00' : '#ff4466';
  $: ringDash  = `${(RING_CIRC * ($secondsLeft / ROUND_SECS)).toFixed(2)} ${RING_CIRC}`;

  $: standingText = $phase === 'waiting'    ? '⏳ Waiting for price to move…'
                  : $standing === 'winning' ? '✓ Currently winning'
                  : $standing === 'losing'  ? '✗ Currently losing'
                  : '— Price at entry';
  $: standingColor = $standing === 'winning' ? '#00ff88'
                   : $standing === 'losing'  ? '#ff4466' : '#555';

  let prevLive = 0;
  $: if ($livePrice && $livePrice !== prevLive && !frozen) {
    if (prevLive === 0) {
      dispPrice = $livePrice;
    } else {
      tween.start(dispPrice, $livePrice);
    }
    prevLive = $livePrice;

    if ($entryPrice) {
      const diff = Math.round(($livePrice - $entryPrice) * 100) / 100; // round to avoid float noise
      if (Math.abs(diff) >= 0.01) {
        moveColor = diff > 0 ? '#00ff88' : '#ff4466';
        moveText  = (diff > 0 ? '▲ $' : '▼ $') + fmtAbs(diff) + (diff > 0 ? ' above' : ' below') + ' entry';
      } else {
        moveText = '';
      }
    }
  }

  $: if ($phase === 'resolved' && !frozen) {
    frozen = true;
    tween.stop();
  }

  function chartColor(): string {
    const entry = chartEntry || $entryPrice;
    if (!entry) return '#888888';
    const diff = Math.round((dispPrice - entry) * 100) / 100;
    return diff >= 0.01 ? '#00ff88' : diff <= -0.01 ? '#ff4466' : '#888888';
  }

  function draw(now: number): void {
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (parent && canvas.width === 0) {
      resizeCanvas(canvas);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) return;

    const ep  = chartEntry; // fixed at round start so entry line never becomes "price at 60s"
    const col = chartColor();
    const dpr = devicePixelRatio;
    const pl  = 10 * dpr; const pt = 10 * dpr; const pb = 8 * dpr;
    const cw  = canvas.width - pl - 10 * dpr;
    const ch  = canvas.height - pt - pb;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!chartEntry || dispPrice === 0) return;

    // Use server round start when available (e.g. after refresh) so chart position and backfill are correct
    const elapsed = $roundStartMs
      ? (Date.now() - $roundStartMs) / 1000
      : (now - roundStart) / 1000;
    const elapsedClamped = Math.min(elapsed, ROUND_SECS);

    // Minimal Y scale ($0.10), expand-only as price moves
    const allPrices = history.length ? [...history, dispPrice, ep] : [dispPrice, ep]; // ep = chartEntry
    const padding = 0.05; // ±5¢ so axis starts tight
    const tMin = Math.min(...allPrices) - padding;
    const tMax = Math.max(...allPrices) + padding;
    if (tMin < smoothMin) smoothMin = tMin;
    if (tMax > smoothMax) smoothMax = tMax;
    const dataRange = smoothMax - smoothMin || 1;
    const minRange = 0.10; // $0.10 minimum scale, then auto-grow
    const range = Math.max(dataRange, minRange);
    const drawMin = (smoothMin + smoothMax) / 2 - range / 2;
    const drawMax = drawMin + range;

    const tipX = pl + (Math.min(elapsedClamped, ROUND_SECS) / ROUND_SECS) * cw;
    const toX  = (i: number) => pl + (i / ROUND_SECS) * cw;
    const toY  = (p: number) => pt + ch - ((p - drawMin) / range) * ch;

    // One point per elapsed second; store price only so line reacts to scale changes.
    // After refresh we have no real history: backfill with entry price so the segment 0..now
    // is flat at entry and the tip shows current price (so the move is visible).
    const targetCount = Math.floor(elapsedClamped);
    const isBackfilling = history.length === 0 && targetCount > 0;
    const priceForNewPoint = isBackfilling ? chartEntry : dispPrice;
    while (history.length < targetCount) {
      history = [...history, priceForNewPoint];
    }

    // Y from current scale every frame so the line moves with the scale
    const pts: [number, number][] = [
      [toX(0), toY(ep)],
      ...history.map((price, i) => [toX(i + 1), toY(price)] as [number, number]),
      [tipX, toY(dispPrice)],
    ];

    // Grid
    const rawStep   = range / 4;
    const mag       = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const step      = Math.ceil(rawStep / mag) * mag || 100;
    const firstLine = Math.ceil(smoothMin / step) * step;

    ctx.save();
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    ctx.lineWidth = dpr;
    for (let p = firstLine; p <= smoothMax; p += step) {
      if (Math.abs(p - ep) < step * 0.05) continue;
      const y = toY(p);
      if (y < pt - 2 || y > pt + ch + 2) continue;
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(pl, y);
      ctx.lineTo(pl + cw, y);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.font = `${9 * dpr}px Inter, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), pl + cw - 2 * dpr, y);
    }
    ctx.restore();

    // Entry line
    const ey = toY(ep);
    ctx.save();
    ctx.strokeStyle = '#ffcc00';
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(pl, ey);
    ctx.lineTo(pl + cw, ey);
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffcc00';
    ctx.font = `bold ${9 * dpr}px Inter, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('ENTRY', pl + cw - 2 * dpr, ey - 7 * dpr);
    ctx.restore();

    if (pts.length < 2) return;

    function spline(): void {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[i];
        const c = pts[i + 1];
        const d = pts[Math.min(pts.length - 1, i + 2)];
        ctx.bezierCurveTo(
          b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6,
          c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6,
          c[0], c[1]
        );
      }
    }

    const last = pts[pts.length - 1];

    ctx.save();
    spline();
    ctx.lineTo(last[0], pt + ch);
    ctx.lineTo(pts[0][0], pt + ch);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pt, 0, pt + ch);
    grad.addColorStop(0, col + '28');
    grad.addColorStop(1, col + '00');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.save();
    spline();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur = 6 * dpr;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 10 * dpr;
    ctx.beginPath();
    ctx.arc(last[0], last[1], 4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function rafLoop(now: number): void {
    draw(now);
    if (!frozen) rafId = requestAnimationFrame(rafLoop);
    else draw(performance.now());
  }

  onMount(() => {
    // Lock entry for the whole round so it never becomes "price at 60s"
    chartEntry = $entryPrice || 0;
    const ep   = chartEntry || $livePrice || 94000;
    smoothMin  = ep - 0.05;
    smoothMax  = ep + 0.05;
    dispPrice  = $livePrice || ep;
    prevLive   = 0;
    frozen     = false;
    history    = [];
    roundStart = performance.now();

    requestAnimationFrame(() => {
      resizeCanvas(canvas);
      rafId = requestAnimationFrame(rafLoop);
    });

    const onResize = () => resizeCanvas(canvas);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    tween.stop();
  });
</script>

<!-- Chart -->
<div class="chart-section">
  {#if $entryPrice}
    <span class="entry-label">ENTRY · ${fmt($entryPrice)}</span>
  {/if}
  <canvas bind:this={canvas} class="chart-canvas"></canvas>
</div>

<!-- Status row — hidden when resolved -->
{#if $phase !== 'resolved'}
  <div class="game-status">
    <div class="ring-wrap">
      <svg width="112" height="112" viewBox="0 0 112 112" style="transform:rotate(-90deg)">
        <circle cx="56" cy="56" r={RING_R} fill="none" stroke="rgba(255,255,255,.06)" stroke-width="6"/>
        <circle
          cx="56" cy="56" r={RING_R}
          fill="none" stroke={ringColor} stroke-width="6" stroke-linecap="round"
          stroke-dasharray={ringDash}
          style="filter:drop-shadow(0 0 8px {ringColor}88);
                 transition:stroke-dasharray .95s cubic-bezier(.4,0,.2,1),stroke .5s ease"
        />
      </svg>
      <div class="ring-center">
        {#if $phase === 'waiting'}
          <div class="waiting-label">WAITING<br>FOR MOVE</div>
        {:else}
          <div class="countdown" style:color={$secondsLeft <= 10 ? '#ff4466' : '#fff'}>
            {$secondsLeft}
          </div>
        {/if}
      </div>
    </div>

    <div class="status-right">
      <div class="label-micro">ENTRY</div>
      <div class="entry-price" bind:this={entryPriceEl}>
        {$entryPrice ? '$' + fmt($entryPrice) : '—'}
      </div>
      <div class="label-micro">YOUR CALL</div>
      <div class="direction" style:color={$direction === 'up' ? '#00ff88' : '#ff4466'}>
        {$direction === 'up' ? '▲ HODL' : '▼ FOLD'}
      </div>
      <div class="standing" style:color={standingColor}>{standingText}</div>
      {#if moveText}
        <div class="move-size" style:color={moveColor}>{moveText}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .chart-section {
    padding: 28px 0 10px;
    border-bottom: 1px solid rgba(255,255,255,.05);
    position: relative;
    min-height: 160px;
  }
  .entry-label {
    position: absolute; top: 10px; left: 14px;
    font-size: 10px; color: #ffcc00;
    letter-spacing: 0.15em; opacity: 0.7;
  }
  .chart-canvas { display: block; width: 100%; height: 130px; }

  .game-status {
    padding: 24px 20px;
    display: flex; align-items: center; gap: 20px;
    border-bottom: 1px solid rgba(255,255,255,.05);
  }
  .ring-wrap { position: relative; flex-shrink: 0; width: 112px; height: 112px; }
  .ring-center {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .countdown {
    font-size: 42px; font-weight: 700; line-height: 1;
    font-variant-numeric: tabular-nums; text-align: center;
    transition: color 0.5s;
  }
  .waiting-label {
    font-size: 9px; color: #555; text-align: center;
    letter-spacing: 0.1em; line-height: 1.6;
  }
  .status-right { flex: 1; min-width: 0; }
  .label-micro  { font-size: 9px; color: #444; letter-spacing: 0.2em; margin-bottom: 3px; }
  .entry-price  {
    font-size: 20px; font-weight: 500;
    letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
    color: #fff; margin-bottom: 10px;
  }
  .direction {
    font-size: 20px; font-weight: 700;
    letter-spacing: 0.05em; margin-bottom: 10px;
  }
  .standing  { font-size: 11px; letter-spacing: 0.08em; transition: color 0.6s; }
  .move-size { font-size: 13px; margin-top: 6px; font-variant-numeric: tabular-nums; }
</style>
