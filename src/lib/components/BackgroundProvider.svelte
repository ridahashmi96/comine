<script lang="ts">
  import { settings, type BackgroundType } from '$lib/stores/settings';
  import { isAndroid } from '$lib/utils/android';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';

  let onDesktop = $state(false);

  let effectiveBackgroundType = $derived.by(() => {
    const type = $settings.backgroundType;
    if (type === 'acrylic' && !onDesktop) {
      return $settings.backgroundVideo ? 'animated' : 'solid';
    }
    return type;
  });

  let accentStyle = $derived($settings.accentStyle || 'solid');
  
  let secondaryColor = $derived.by(() => {
    const hex = ($settings.backgroundColor || '#1a1a2e').replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    const accentHex = ($settings.accentColor || '#6366F1').replace('#', '');
    const ar = parseInt(accentHex.substring(0, 2), 16);
    const ag = parseInt(accentHex.substring(2, 4), 16);
    const ab = parseInt(accentHex.substring(4, 6), 16);
    
    const r2 = Math.round(r * 0.85 + ar * 0.15);
    const g2 = Math.round(g * 0.85 + ag * 0.15);
    const b2 = Math.round(b * 0.85 + ab * 0.15);
    
    return `#${((1 << 24) | (r2 << 16) | (g2 << 8) | b2).toString(16).slice(1)}`;
  });

  let videoEl: HTMLVideoElement | null = $state(null);

  onMount(() => {
    onDesktop = !isAndroid();

    if (onDesktop) {
      updateAcrylicEffect();
    }
  });

  $effect(() => {
    if (onDesktop) {
      updateAcrylicEffect();
    }
  });

  async function updateAcrylicEffect() {
    try {
      const shouldEnableAcrylic = $settings.backgroundType === 'acrylic';
      await invoke('set_acrylic', { enable: shouldEnableAcrylic });
    } catch (e) {
      console.error('Failed to set acrylic effect:', e);
    }
  }
</script>

<div class="background-provider" data-type={effectiveBackgroundType} data-accent-style={accentStyle}>
  {#if effectiveBackgroundType === 'animated' && $settings.backgroundVideo}
    {@const videoSrc = $settings.backgroundVideo}
    {@const opacity = onDesktop ? $settings.backgroundOpacity / 100 : 1}
    <video
      bind:this={videoEl}
      class="background-video"
      style="filter: blur({$settings.backgroundBlur}px) brightness(0.4) saturate(1.2); opacity: {opacity};"
      src={videoSrc}
      autoplay
      loop
      muted
      playsinline
      onerror={(e) => console.error('Video load error:', e)}
    ></video>
    <div class="video-overlay"></div>
  {:else if effectiveBackgroundType === 'image' && $settings.backgroundImage}
    {@const imageSrc = $settings.backgroundImage}
    {@const opacity = onDesktop ? $settings.backgroundOpacity / 100 : 1}
    <div
      class="background-image"
      style="background-image: url('{imageSrc}'); filter: blur({$settings.backgroundBlur}px) brightness(0.4) saturate(1.2); opacity: {opacity};"
    ></div>
    <div class="image-overlay"></div>
  {:else if effectiveBackgroundType === 'solid'}
    {@const opacity = onDesktop ? $settings.backgroundOpacity / 100 : 1}
    {@const bgColor = $settings.backgroundColor || '#1a1a2e'}
    {#if accentStyle === 'gradient'}
      <div
        class="background-solid background-gradient"
        style="--bg-primary: {bgColor}; --bg-secondary: {secondaryColor}; opacity: {opacity};"
      ></div>
    {:else if accentStyle === 'glow'}
      <div
        class="background-solid background-glow"
        style="--bg-primary: {bgColor}; --accent: {$settings.accentColor}; opacity: {opacity};"
      >
        <div class="glow-orb"></div>
      </div>
    {:else}
      <div
        class="background-solid"
        style="background-color: {bgColor}; opacity: {opacity};"
      ></div>
    {/if}
  {/if}
</div>

<style>
  .background-provider {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
  }

  .background-video {
    position: absolute;
    top: 50%;
    left: 50%;
    min-width: 100%;
    min-height: 100%;
    width: auto;
    height: auto;
    transform: translate(-50%, -50%);
    object-fit: cover;
  }

  .video-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.3) 0%,
      rgba(0, 0, 0, 0.5) 50%,
      rgba(0, 0, 0, 0.7) 100%
    );
  }

  .background-image {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
  }

  .image-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.3) 0%,
      rgba(0, 0, 0, 0.5) 50%,
      rgba(0, 0, 0, 0.7) 100%
    );
  }

  .background-solid {
    position: absolute;
    inset: 0;
  }

  .background-gradient {
    background: linear-gradient(
      145deg,
      var(--bg-primary) 0%,
      var(--bg-secondary) 50%,
      var(--bg-primary) 100%
    );
    background-size: 200% 200%;
  }

  .background-glow {
    background: var(--bg-primary);
    overflow: hidden;
  }

  .glow-orb {
    position: absolute;
    width: 50%;
    height: 50%;
    top: -10%;
    right: -10%;
    background: var(--accent);
    border-radius: 50%;
    filter: blur(120px);
    opacity: 0.08;
    pointer-events: none;
  }
</style>
