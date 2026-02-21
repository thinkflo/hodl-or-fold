<!-- packages/frontend/src/lib/components/GuessButtons.svelte -->
<!-- HODL / FOLD buttons. Calls onGuess() after the store has been updated
     so the parent can await tick() and measure the newly mounted entry slot. -->
<script lang="ts">
  import { submitGuess } from '$lib/stores/game';
  import type { Direction } from '$lib/types';

  // Called after submitGuess() resolves — phase is already 'guessing' at this point
  export let onGuess: () => void = () => {};

  let submitting = false;

  async function handleGuess(dir: Direction) {
    if (submitting) return;
    submitting = true;
    try {
      await submitGuess(dir);
      onGuess(); // parent awaits tick() then runs FLIP
    } catch (err) {
      console.error('Failed to submit guess:', err);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="actions">
  <button class="btn btn-up"   disabled={submitting} on:click={() => handleGuess('up')}>
    ▲ HODL
  </button>
  <button class="btn btn-down" disabled={submitting} on:click={() => handleGuess('down')}>
    ▼ FOLD
  </button>
</div>

<style>
  .actions { padding: 14px 20px 20px; display: flex; gap: 12px; }

  .btn {
    flex: 1; padding: 15px 8px; border-radius: 10px;
    font-family: inherit; font-size: 14px; font-weight: 700;
    letter-spacing: 0.05em; cursor: pointer; border: 1px solid;
    transition: background 0.2s, border-color 0.2s, transform 0.1s;
    -webkit-tap-highlight-color: transparent;
    user-select: none; touch-action: manipulation;
  }
  .btn:active      { transform: scale(0.97); }
  .btn:disabled    { opacity: 0.45; cursor: not-allowed; }

  .btn-up  { background: rgba(0,255,136,.08); border-color: rgba(0,255,136,.25); color: #00ff88; }
  .btn-up:hover:not(:disabled)  { background: rgba(0,255,136,.18); border-color: rgba(0,255,136,.5); }

  .btn-down { background: rgba(255,68,102,.08); border-color: rgba(255,68,102,.25); color: #ff4466; }
  .btn-down:hover:not(:disabled){ background: rgba(255,68,102,.18); border-color: rgba(255,68,102,.5); }
</style>
