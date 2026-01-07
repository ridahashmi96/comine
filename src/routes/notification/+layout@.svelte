<script lang="ts">
  let { children } = $props();
</script>

<!-- Minimal layout for notification windows - no sidebar, no navigation -->
<div class="notification-root">
  {@render children()}
</div>

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(html, body) {
    background: transparent !important;
    overflow: hidden;
    font-family:
      'Jost',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      sans-serif;
    -webkit-font-smoothing: antialiased;
    color: white;
    height: 100%;
    width: 100%;
  }

  .notification-root {
    width: 100%;
    height: 100vh;
    background: transparent;
    padding: 2px;
  }
</style>
