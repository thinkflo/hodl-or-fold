<!-- packages/frontend/src/lib/components/CapacityScreen.svelte -->
<!-- Shown when the server returns 503 at capacity (POST /players) -->
<script lang="ts">
  export let activeUsers: number = 100;
  export let maxUsers: number    = 100;
</script>

<div class="capacity">
  <div class="icon">⚡</div>
  <h1>Game Full</h1>
  <p>
    {activeUsers} / {maxUsers} players active.<br>
    Check back in a few minutes.
  </p>
</div>

<style>
  .capacity {
    text-align: center;
    padding: 48px 24px;
    color: #555;
  }
  .icon {
    font-size: 48px;
    margin-bottom: 16px;
  }
  h1 {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 12px;
    letter-spacing: 0.05em;
  }
  p {
    font-size: 14px;
    line-height: 1.7;
    color: #555;
  }
</style>
