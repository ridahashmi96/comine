<script lang="ts">
  import { settings, type BackgroundType } from '$lib/stores/settings';
  import { isAndroid } from '$lib/utils/android';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  
  // Track if we're on desktop (for acrylic support)
  let onDesktop = $state(false);
  
  // Derived background type - fallback to animated on Android if acrylic is selected
  let effectiveBackgroundType = $derived.by(() => {
    const type = $settings.backgroundType;
    if (type === 'acrylic' && !onDesktop) {
      // Fallback on mobile - use animated if video is set, otherwise solid
      return $settings.backgroundVideo ? 'animated' : 'solid';
    }
    return type;
  });
  
  // Video element for animated background
  let videoEl: HTMLVideoElement | null = $state(null);
  
  onMount(() => {
    onDesktop = !isAndroid();
    
    // Apply acrylic effect on desktop when that type is selected
    if (onDesktop) {
      updateAcrylicEffect();
    }
  });
  
  // Watch for background type changes and update acrylic
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

<div class="background-provider" data-type={effectiveBackgroundType}>
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
    <div 
      class="background-solid"
      style="background-color: {$settings.backgroundColor}; opacity: {opacity};"
    ></div>
  {/if}
  <!-- Acrylic type uses window transparency, no element needed -->
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
</style>
