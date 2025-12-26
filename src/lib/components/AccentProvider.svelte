<script lang="ts">
  import { settings } from '$lib/stores/settings';
  import { isAndroid } from '$lib/utils/android';
  import { onMount } from 'svelte';

  let systemAccentColor = $state<string | null>(null);
  let onMobile = $state(false);

  let effectiveAccent = $derived.by(() => {
    if ($settings.useSystemAccent && systemAccentColor) {
      return systemAccentColor;
    }
    return $settings.accentColor || '#6366F1';
  });

  let accentLight = $derived(adjustBrightness(effectiveAccent, 30));
  let accentDark = $derived(adjustBrightness(effectiveAccent, -20));
  let accentAlpha = $derived(hexToRgba(effectiveAccent, 0.2));
  let accentAlphaHover = $derived(hexToRgba(effectiveAccent, 0.3));

  onMount(() => {
    onMobile = isAndroid();
    fetchSystemAccent();
  });

  async function fetchSystemAccent() {
    if (isAndroid()) {
      try {
        const androidColors = await getAndroidMaterialColors();
        if (androidColors?.primary) {
          systemAccentColor = androidColors.primary;
          console.log('[AccentProvider] Got Android Material color:', systemAccentColor);
        }
      } catch (e) {
        console.log('[AccentProvider] Could not get Android colors:', e);
      }
    }
  }

  async function getAndroidMaterialColors(): Promise<{
    primary?: string;
    secondary?: string;
  } | null> {
    return new Promise((resolve) => {
      if (typeof window !== 'undefined' && (window as any).AndroidColors) {
        try {
          const colors = (window as any).AndroidColors.getMaterialColors();
          if (colors) {
            const parsed = JSON.parse(colors);
            resolve(parsed);
            return;
          }
        } catch (e) {
          console.error('Failed to parse Android colors:', e);
        }
      }
      resolve(null);
    });
  }

  function adjustBrightness(hex: string, percent: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
    return `#${((1 << 24) | (R << 16) | (G << 8) | B).toString(16).slice(1)}`;
  }

  function hexToRgba(hex: string, alpha: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const R = (num >> 16) & 0xff;
    const G = (num >> 8) & 0xff;
    const B = num & 0xff;
    return `rgba(${R}, ${G}, ${B}, ${alpha})`;
  }

  $effect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--accent', effectiveAccent);
      document.documentElement.style.setProperty('--accent-light', accentLight);
      document.documentElement.style.setProperty('--accent-dark', accentDark);
      document.documentElement.style.setProperty('--accent-alpha', accentAlpha);
      document.documentElement.style.setProperty('--accent-alpha-hover', accentAlphaHover);
    }
  });
</script>

<!-- This component only sets CSS variables, no visual output -->
