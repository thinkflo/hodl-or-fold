<!-- packages/frontend/src/routes/+page.svelte -->
<!-- Single-screen arcade game. Four phases: idle → guessing → waiting → resolved -->
<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import {
    phase, score, resolution, price, direction,
    initGame, resetGame, connectPriceFeed, submitGuess,
  } from '$lib/stores/game';
  import { flipPrice } from '$lib/utils/priceAnimation';
  import PriceDisplay   from '$lib/components/PriceDisplay.svelte';
  import PendingGuess   from '$lib/components/PendingGuess.svelte';
  import CapacityScreen from '$lib/components/CapacityScreen.svelte';

  export let data: import('./$types').PageData;

  // DOM refs for FLIP animation
  let priceEl:      HTMLElement | undefined;
  let entryPriceEl: HTMLElement | undefined;

  let disconnectFeed: (() => void) | null = null;
  let submitting = false;

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── HODL/FOLD click ───────────────────────────────────────────────────────
  // 1. Disable buttons immediately
  // 2. Submit to server (locks entry price server-side)
  // 3. await tick() so PendingGuess is mounted and entryPriceEl has layout
  // 4. Run FLIP animation
  async function handleGuess(dir: 'up' | 'down') {
    if (submitting || $phase !== 'idle') return;
    submitting = true;
    try {
      await submitGuess(dir);      // phase → 'guessing', entryPrice set
      await tick();                // DOM updated — PendingGuess now mounted
      runFlipIn();
    } catch (e) {
      console.error('Failed to submit guess:', e);
    } finally {
      submitting = false;
    }
  }

  function runFlipIn() {
    if (!priceEl || !entryPriceEl) return;
    const text = priceEl.textContent ?? '';
    flipPrice(priceEl, entryPriceEl, text, () => {
      if (priceEl)      priceEl.style.opacity      = '1';
      if (entryPriceEl) entryPriceEl.style.opacity = '1';
    });
  }

  // ── Play Again ────────────────────────────────────────────────────────────
  // Measure entry slot BEFORE resetGame() unmounts PendingGuess, then FLIP back.
  async function handleReset() {
    if (entryPriceEl && priceEl) {
      const fromEl = entryPriceEl;
      const text   = fromEl.textContent ?? '';
      resetGame();               // phase → 'idle', PendingGuess unmounts
      await tick();              // DOM updated — priceEl back at large position
      flipPrice(fromEl, priceEl, text, () => {
        if (priceEl) priceEl.style.opacity = '1';
      });
    } else {
      resetGame();
    }
  }

  onMount(() => {
    // Connect price feed first so price is live before anything else
    disconnectFeed = connectPriceFeed();
    // Then restore session state (may set phase to guessing/waiting)
    if (data.player) {
      initGame(data.player);
    }
  });

  onDestroy(() => disconnectFeed?.());
</script>

<svelte:head>
  <title>Hodl or Fold</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet" />
</svelte:head>

<main>
  <div class="app">
    {#if data.isFull}
      <CapacityScreen activeUsers={data.activeUsers ?? 100} maxUsers={data.maxUsers ?? 100} />
    {:else}

      <div class="top-label">BITCOIN · LIVE</div>

      <!-- Live price — always visible, always driven by SSE -->
      <PriceDisplay bind:el={priceEl} />

      <div class="card">

        <!-- Chart + ring panel — shown for guessing/waiting/resolved -->
        {#if $phase !== 'idle'}
          <PendingGuess bind:entryPriceEl />
        {/if}

        <!-- Resolution result -->
        {#if $phase === 'resolved' && $resolution}
          {@const r = $resolution}
          <div class="resolution">
            <span class="result-emoji pop">{r.outcome === 'correct' ? '🚀' : '📉'}</span>
            <div
              class="result-word"
              style:color={r.outcome === 'correct' ? '#00ff88' : '#ff4466'}
              style:filter="drop-shadow(0 0 16px {r.outcome === 'correct' ? '#00ff8888' : '#ff446688'})"
            >
              {r.outcome === 'correct' ? 'YOU WON' : 'YOU LOST'}
            </div>
            <div class="result-detail">
              BTC moved {r.finalPrice > r.entryPrice ? '▲ up' : '▼ down'} to ${fmt(r.finalPrice)}
            </div>
            <div class="result-call">
              You called {r.direction === 'up' ? '▲ HODL' : '▼ FOLD'}
            </div>
          </div>
        {/if}

        <!-- Idle prompt -->
        {#if $phase === 'idle'}
          <div class="idle-section">
            <div class="idle-cta">Will BTC rise or fall?</div>
            <div class="idle-sub">Make your call. 60 seconds.</div>
          </div>
        {/if}
        <div class="actions">
          {#if $phase === 'idle'}
            <button
              class="btn btn-up"
              disabled={submitting}
              on:click={() => handleGuess('up')}
            >
              <span class="btn-label">▲ HODL</span>
              <span class="btn-hint">Price goes up</span>
            </button>
            <button
              class="btn btn-down"
              disabled={submitting}
              on:click={() => handleGuess('down')}
            >
              <span class="btn-label">▼ FOLD</span>
              <span class="btn-hint">Price goes down</span>
            </button>
          {:else if $phase === 'resolved'}
            <button class="btn btn-reset" on:click={handleReset}>
              <span class="btn-label">PLAY AGAIN</span>
              <span class="btn-hint">Double or nothing</span>
            </button>
          {:else}
            <div class="in-progress">
              You called
              <span style:color={$direction === 'up' ? '#00ff88' : '#ff4466'}>
                {$direction === 'up' ? '▲ HODL' : '▼ FOLD'}
              </span>
              — watching the market…
            </div>
          {/if}
        </div>

      </div>

      <!-- Score — always visible (0 for new users) -->
      <div class="score-badge">
        SCORE <span class:positive={$score > 0} class:negative={$score < 0}>{$score}</span>
      </div>

      <div class="footer">
        HODL OR FOLD · BTC PRICE PREDICTION
      </div>

    {/if}
  </div>
</main>

<style>
  :global(*, *::before, *::after) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) {
    min-height: 100svh;
    background: #0a0a0c;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Inter', sans-serif;
    padding: 20px;
    color: #fff;
  }

  main  { width: 100%; }
  .app  { width: 100%; max-width: 420px; margin: 0 auto; }

  .top-label {
    font-size: 10px; letter-spacing: 0.3em; color: #444;
    text-align: center; margin: 8px auto;
  }

  .card {
    background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.07);
    border-radius: 16px;
    overflow: hidden;
  }

  /* ── Resolution ──────────────────────────────────────────────────────────── */
  .resolution {
    padding: 32px 24px;
    text-align: center;
    border-bottom: 1px solid rgba(255,255,255,.05);
  }
  .result-emoji {
    font-size: 52px; display: block; margin-bottom: 8px;
  }
  .pop { animation: pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  @keyframes pop {
    0%  { transform: scale(0.4); opacity: 0; }
    65% { transform: scale(1.15); }
    100%{ transform: scale(1); opacity: 1; }
  }
  .result-word {
    font-size: 28px; font-weight: 700;
    letter-spacing: 0.05em; margin-bottom: 8px;
  }
  .result-detail { font-size: 13px; color: #555; letter-spacing: 0.08em; }
  .result-call   { font-size: 12px; color: #333; margin-top: 4px; }

  /* ── Idle ────────────────────────────────────────────────────────────────── */
  .idle-section { padding: 24px 24px 8px; text-align: center; }
  .idle-cta {
    font-size: 20px; font-weight: 600; color: #ccc;
    letter-spacing: -0.01em;
  }
  .idle-sub {
    font-size: 13px; color: #555; margin-top: 6px;
    letter-spacing: 0.05em;
  }

  /* ── Actions ─────────────────────────────────────────────────────────────── */
  .actions {
    padding: 16px 20px 22px;
    display: flex;
    gap: 12px;
  }
  .btn {
    flex: 1; padding: 20px 8px; border-radius: 12px;
    font-family: inherit; font-weight: 700;
    letter-spacing: 0.05em; cursor: pointer; border: 1.5px solid;
    transition: background 0.2s, border-color 0.2s, box-shadow 0.3s, transform 0.1s;
    -webkit-tap-highlight-color: transparent;
    user-select: none; touch-action: manipulation;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .btn:active { transform: scale(0.97); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-label { font-size: 18px; }
  .btn-hint  { font-size: 10px; font-weight: 400; opacity: 0.5; letter-spacing: 0.08em; }

  .btn-up {
    background: rgba(0,255,136,.12); border-color: rgba(0,255,136,.4); color: #00ff88;
    animation: pulse-up 2.5s ease-in-out infinite;
  }
  .btn-up:hover:not(:disabled) {
    background: rgba(0,255,136,.22); border-color: rgba(0,255,136,.6);
    box-shadow: 0 0 24px rgba(0,255,136,.2);
  }
  .btn-down {
    background: rgba(255,68,102,.12); border-color: rgba(255,68,102,.4); color: #ff4466;
    animation: pulse-down 2.5s ease-in-out infinite;
  }
  .btn-down:hover:not(:disabled) {
    background: rgba(255,68,102,.22); border-color: rgba(255,68,102,.6);
    box-shadow: 0 0 24px rgba(255,68,102,.2);
  }

  @keyframes pulse-up {
    0%, 100% { box-shadow: 0 0 0 rgba(0,255,136,0); }
    50%      { box-shadow: 0 0 18px rgba(0,255,136,.15); }
  }
  @keyframes pulse-down {
    0%, 100% { box-shadow: 0 0 0 rgba(255,68,102,0); }
    50%      { box-shadow: 0 0 18px rgba(255,68,102,.15); }
  }

  .btn-reset {
    background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.2); color: #ddd;
    animation: pulse-reset 2s ease-in-out infinite;
  }
  .btn-reset:hover {
    background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.35); color: #fff;
    box-shadow: 0 0 20px rgba(255,255,255,.1);
  }
  @keyframes pulse-reset {
    0%, 100% { box-shadow: 0 0 0 rgba(255,255,255,0); }
    50%      { box-shadow: 0 0 14px rgba(255,255,255,.08); }
  }

  .in-progress {
    flex: 1; padding: 15px 8px; text-align: center;
    color: #666; font-size: 12px; letter-spacing: 0.06em;
  }

  /* ── Score ───────────────────────────────────────────────────────────────── */
  .score-badge {
    text-align: center; margin-top: 16px;
    font-size: 12px; color: #555; letter-spacing: 0.2em;
  }
  .score-badge span {
    display: block; margin-top: 2px;
    font-size: 22px; font-weight: 700; color: #fff;
    letter-spacing: -0.02em;
  }
  .score-badge .positive { color: #00ff88; filter: drop-shadow(0 0 8px rgba(0,255,136,.3)); }
  .score-badge .negative { color: #ff4466; filter: drop-shadow(0 0 8px rgba(255,68,102,.3)); }

  .footer {
    text-align: center; margin-top: 18px;
    font-size: 10px; color: #1e1e1e; letter-spacing: 0.2em;
  }
</style>
