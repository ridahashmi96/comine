<script lang="ts">
  import { settings } from '$lib/stores/settings';
  import { isAndroid } from '$lib/utils/android';
  import { onMount } from 'svelte';
  
  // System accent color (fetched from OS if available)
  let systemAccentColor = $state<string | null>(null);
  let onMobile = $state(false);
  
  // Computed accent color to use
  let effectiveAccent = $derived.by(() => {
    if ($settings.useSystemAccent && systemAccentColor) {
      return systemAccentColor;
    }
    return $settings.accentColor || '#6366F1';
  });
  
  // Generate lighter/darker variants
  let accentLight = $derived(adjustBrightness(effectiveAccent, 30));
  let accentDark = $derived(adjustBrightness(effectiveAccent, -20));
  let accentAlpha = $derived(hexToRgba(effectiveAccent, 0.2));
  let accentAlphaHover = $derived(hexToRgba(effectiveAccent, 0.3));
  
  onMount(() => {
    onMobile = isAndroid();
    
    // Try to get system accent color
    fetchSystemAccent();
  });
  
  async function fetchSystemAccent() {
    if (isAndroid()) {
      // Try to get Material You colors from Android
      try {
        const androidColors = await getAndroidMaterialColors();
        if (androidColors?.primary) {
          systemAccentColor = androidColors.primary;
          console.log('[AccentProvider] Got Android Material color:', systemAccentColor);
        }
      } catch (e) {
        console.log('[AccentProvider] Could not get Android colors:', e);
      }
    } else {
      // On desktop, we could potentially get Windows accent color
      // For now, we'll just use the user's preference
    }
  }
  
  // Get Material You colors from Android via JavaScript bridge
  async function getAndroidMaterialColors(): Promise<{ primary?: string; secondary?: string } | null> {
    return new Promise((resolve) => {
      // Check if Android bridge is available
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
  
  // Utility: Adjust hex color brightness
  function adjustBrightness(hex: string, percent: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
    return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
  }
  
  // Utility: Convert hex to rgba
  function hexToRgba(hex: string, alpha: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const R = (num >> 16) & 0xFF;
    const G = (num >> 8) & 0xFF;
    const B = num & 0xFF;
    return `rgba(${R}, ${G}, ${B}, ${alpha})`;
  }
  
  // Apply CSS variables when accent changes
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
