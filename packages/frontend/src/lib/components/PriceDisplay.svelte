<!-- packages/frontend/src/lib/components/PriceDisplay.svelte -->
<!-- Live BTC price — always driven by SSE $price store. No simulator. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { price, entryPrice, phase } from '$lib/stores/game';
  import { PriceTween } from '$lib/utils/priceAnimation';

  export let el: HTMLElement | undefined = undefined;

  let dispPrice = 0;
  let prevPrice = 0;

  let tickText  = '';
  let tickClass = '';
  let tickKey   = 0;

  const tween = new PriceTween((v) => { dispPrice = v; });

  // React only when price meaningfully changed (avoids float-noise micro-updates from breaking animations)
  const MIN_CHANGE = 0.01;
  $: if ($price && Math.abs($price - prevPrice) >= MIN_CHANGE) {
    const diff = $price - prevPrice;

    // Tick indicator on every price change during active rounds
    if (prevPrice !== 0 && $phase !== 'idle') {
      tickText  = (diff > 0 ? '+' : '–') + '$' + fmt(Math.abs(Math.round(diff * 100) / 100));
      tickClass = diff > 0 ? 'tick-up' : 'tick-down';
      tickKey++;
    }

    if (prevPrice === 0) {
      dispPrice = $price; // snap on first price
    } else {
      tween.start(dispPrice, $price);
    }
    prevPrice = $price;
  }

  $: priceColor = (() => {
    if ($phase === 'idle') return '#fff';
    const diff = dispPrice - $entryPrice;
    return diff > 1 ? '#00ff88' : diff < -1 ? '#ff4466' : '#fff';
  })();

  $: priceFilter = $phase !== 'idle'
    ? `drop-shadow(0 0 18px ${priceColor}44)`
    : 'none';

  function fmt(n: number) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  onDestroy(() => tween.stop());
</script>

<div class="price-wrap">
  <span
    bind:this={el}
    class="price"
    style:color={priceColor}
    style:filter={priceFilter}
  >
    {dispPrice ? '$' + fmt(dispPrice) : '—'}
  </span>

  {#key tickKey}
    {#if tickText}
      <span class="tick {tickClass}">{tickText}</span>
    {/if}
  {/key}
</div>

<style>
  .price-wrap {
    position: relative;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
  }
  .price {
    font-size: clamp(32px, 9vw, 44px);
    font-weight: 500;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum";
    transition: color 0.4s ease, filter 0.4s ease;
  }
  .tick {
    position: absolute;
    inset: 0; top: 2px;
    text-align: center;
    font-size: 13px; font-weight: 700;
    letter-spacing: 0.05em;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    animation: tick-fly 0.9s ease-out forwards;
  }
  .tick-up   { color: #00ff88; }
  .tick-down { color: #ff4466; }
  @keyframes tick-fly {
    0%   { opacity: 1; transform: translateY(0); }
    70%  { opacity: 0.8; }
    100% { opacity: 0; transform: translateY(-22px); }
  }
</style>
