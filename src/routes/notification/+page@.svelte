<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke, convertFileSrc } from '@tauri-apps/api/core';
  import { load } from '@tauri-apps/plugin-store';
  import type { BackgroundType } from '$lib/stores/settings';

  const WINDOW_ID =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('window_id') || ''
      : '';

  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

  const title = params.get('title') || 'Media Detected';
  const body = params.get('body') || '';
  const thumbnail = params.get('thumbnail') || '';
  const mediaUrl = params.get('url') || '';
  const isCompact = params.get('compact') === '1';
  const downloadLabel = params.get('dl') || 'Download';
  const dismissLabel = params.get('dm') || 'Dismiss';
  const isPlaylist = params.get('is_playlist') === '1';
  const viewPlaylistLabel = 'View Playlist';

  const isYouTube = /youtube\.com|youtu\.be/i.test(mediaUrl);

  let isReady = $state(false);
  let isHovered = $state(false);
  let isDownloading = $state(false);
  let isDismissing = $state(false);
  let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  let fancyBackground = $state(false);
  let backgroundType = $state<BackgroundType>('solid');
  let backgroundColor = $state('#1a1a2e');
  let backgroundImage = $state('');
  let backgroundVideo = $state('');
  let backgroundBlur = $state(20);
  let accentColor = $state('#6366F1');

  let cornerDismiss = $state(false);

  let accentAlpha = $derived(accentColor + '66'); // 40% opacity
  let accentHover = $derived(adjustBrightness(accentColor, -10));

  function adjustBrightness(hex: string, percent: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + percent));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + percent));
    const b = Math.min(255, Math.max(0, (num & 0x0000ff) + percent));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }

  let titleEl = $state<HTMLDivElement | null>(null);
  let subtitleEl = $state<HTMLDivElement | null>(null);
  let needsMarquee = $state(false);
  let needsSubtitleMarquee = $state(false);

  function checkMarquee() {
    if (titleEl) {
      needsMarquee = titleEl.scrollWidth > titleEl.clientWidth;
    }
    if (subtitleEl) {
      needsSubtitleMarquee = subtitleEl.scrollWidth > subtitleEl.clientWidth;
    }
  }

  async function closeNotification() {
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    isDismissing = true;
    await new Promise((r) => setTimeout(r, 200));
    try {
      await invoke('close_notification_window', { windowId: WINDOW_ID });
    } catch (e) {
      console.error('Close failed:', e);
    }
  }

  async function handleDownload(mode: 'auto' | 'audio' = 'auto') {
    isDownloading = true;

    try {
      await invoke('notification_action', {
        windowId: WINDOW_ID,
        url: mediaUrl || null,
        metadata: {
          title: title !== 'Media Detected' ? title : null,
          thumbnail: thumbnail || null,
          uploader: body ? body.split(' • ')[0] : null,
          downloadMode: mode,
          isPlaylist: isPlaylist,
        },
      });
    } catch (e) {
      console.error('Action failed:', e);
      isDownloading = false;
    }
  }

  async function handleOpenTrackBuilder() {
    isDownloading = true;

    try {
      await invoke('notification_action', {
        windowId: WINDOW_ID,
        url: mediaUrl || null,
        metadata: {
          title: title !== 'Media Detected' ? title : null,
          thumbnail: thumbnail || null,
          uploader: body ? body.split(' • ')[0] : null,
          openTrackBuilder: true,
        },
      });
    } catch (e) {
      console.error('Action failed:', e);
      isDownloading = false;
    }
  }

  function scheduleAutoClose() {
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => {
      if (!isHovered) closeNotification();
      else scheduleAutoClose();
    }, 8000);
  }

  onMount(() => {
    (async () => {
      try {
        const store = await load('settings.json', { autoSave: false, defaults: {} });

        accentColor = (await store.get<string>('accentColor')) ?? '#6366F1';

        fancyBackground = (await store.get<boolean>('notificationFancyBackground')) ?? false;
        cornerDismiss = (await store.get<boolean>('notificationCornerDismiss')) ?? false;

        if (fancyBackground) {
          backgroundType = (await store.get<BackgroundType>('backgroundType')) ?? 'solid';
          backgroundColor = (await store.get<string>('backgroundColor')) ?? '#1a1a2e';
          backgroundImage = (await store.get<string>('backgroundImage')) ?? '';
          backgroundVideo = (await store.get<string>('backgroundVideo')) ?? '';
          backgroundBlur = (await store.get<number>('backgroundBlur')) ?? 20;
        }
      } catch (e) {
        console.error('Failed to load settings:', e);
      }

      await new Promise((r) => setTimeout(r, 30));
      isReady = true;

      checkMarquee();

      try {
        await invoke('reveal_notification_window', { windowId: WINDOW_ID });
      } catch (e) {
        console.error('Reveal failed:', e);
      }

      scheduleAutoClose();
    })();

    return () => {
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
    };
  });
</script>

<!-- Fancy Background -->
{#if fancyBackground}
  <div class="notification-background" style="--accent: {accentColor};">
    {#if backgroundType === 'animated' && backgroundVideo}
      <video
        class="bg-video"
        style="filter: blur({backgroundBlur}px) brightness(0.4) saturate(1.2);"
        src={backgroundVideo}
        autoplay
        loop
        muted
        playsinline
      ></video>
      <div class="bg-overlay"></div>
    {:else if backgroundType === 'image' && backgroundImage}
      <div
        class="bg-image"
        style="background-image: url('{backgroundImage}'); filter: blur({backgroundBlur}px) brightness(0.4) saturate(1.2);"
      ></div>
      <div class="bg-overlay"></div>
    {:else if backgroundType === 'solid'}
      <div class="bg-solid" style="background-color: {backgroundColor}"></div>
    {/if}
  </div>
{/if}

{#if isCompact}
  <!-- Compact single-row layout with icon buttons -->
  <div
    class="notification compact"
    class:fancy={fancyBackground}
    style="--accent: {accentColor}; --accent-hover: {accentHover}; --accent-alpha: {accentAlpha};"
    role="alert"
    onmouseenter={() => (isHovered = true)}
    onmouseleave={() => {
      isHovered = false;
      scheduleAutoClose();
    }}
  >
    <!-- Corner dismiss X (always shown in compact mode) -->
    <button class="close-corner" onclick={closeNotification} aria-label="Close">
      <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
        <path
          d="M6 18L18 6M6 6l12 12"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    {#if thumbnail}
      <img src={thumbnail} alt="" class="thumb-compact" />
    {:else}
      <div class="thumb-compact placeholder">
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path
            d="M12 3V16M12 16L16 11.625M12 16L8 11.625"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    {/if}

    <div class="text-compact">
      <div class="title" class:marquee={needsMarquee} bind:this={titleEl}>
        <span>{title}</span>
        {#if needsMarquee}<span>{title}</span>{/if}
      </div>
    </div>

    <div class="actions-compact">
      {#if isPlaylist}
        <!-- Playlist: Single View Playlist button -->
        <button
          class="icon-btn download playlist"
          class:downloading={isDownloading}
          onclick={() => handleDownload('auto')}
          title={viewPlaylistLabel}
          disabled={isDownloading}
        >
          {#if isDownloading}
            <svg class="spinner" viewBox="0 0 24 24" width="18" height="18">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-dasharray="31.4 31.4"
                stroke-linecap="round"
              />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path
                d="M4 6H20M4 10H20M4 14H14M4 18H14"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
              <circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="2" />
            </svg>
          {/if}
        </button>
      {:else if isYouTube}
        <!-- YouTube: Show Download and Track Builder buttons -->
        <button
          class="icon-btn download youtube"
          class:downloading={isDownloading}
          onclick={() => handleDownload('auto')}
          title="Download"
          disabled={isDownloading}
        >
          {#if isDownloading}
            <svg class="spinner" viewBox="0 0 24 24" width="16" height="16">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-dasharray="31.4 31.4"
                stroke-linecap="round"
              />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path
                d="M12 3V16M12 16L16 11.625M12 16L8 11.625"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M3 15C3 17.828 3 19.243 3.879 20.121C4.757 21 6.172 21 9 21H15C17.828 21 19.243 21 20.121 20.121C21 19.243 21 17.828 21 15"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          {/if}
        </button>
        <button
          class="icon-btn track-builder"
          onclick={handleOpenTrackBuilder}
          title="Track Builder"
          disabled={isDownloading}
        >
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path
              d="M12 5V19M5 12H19"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      {:else}
        <!-- Normal: Single download button -->
        <button
          class="icon-btn download"
          class:downloading={isDownloading}
          onclick={() => handleDownload('auto')}
          title={downloadLabel}
          disabled={isDownloading}
        >
          {#if isDownloading}
            <svg class="spinner" viewBox="0 0 24 24" width="18" height="18">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-dasharray="31.4 31.4"
                stroke-linecap="round"
              />
            </svg>
          {:else}
            <svg class="download-icon" viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path
                d="M12 3V16M12 16L16 11.625M12 16L8 11.625"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M3 15C3 17.828 3 19.243 3.879 20.121C4.757 21 6.172 21 9 21H15C17.828 21 19.243 21 20.121 20.121C21 19.243 21 17.828 21 15"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          {/if}
        </button>
      {/if}
    </div>
  </div>
{:else}
  <!-- Full notification layout -->
  <div
    class="notification"
    class:fancy={fancyBackground}
    style="--accent: {accentColor}; --accent-hover: {accentHover}; --accent-alpha: {accentAlpha};"
    role="alert"
    onmouseenter={() => (isHovered = true)}
    onmouseleave={() => {
      isHovered = false;
      scheduleAutoClose();
    }}
  >
    <button class="close-x" onclick={closeNotification} aria-label="Close">✕</button>

    <div class="content">
      {#if thumbnail}
        <img src={thumbnail} alt="" class="thumb" />
      {:else}
        <div class="thumb placeholder">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
            <path
              d="M12 3V16M12 16L16 11.625M12 16L8 11.625"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              opacity="0.5"
              d="M3 15C3 17.828 3 19.243 3.879 20.121C4.757 21 6.172 21 9 21H15C17.828 21 19.243 21 20.121 20.121C21 19.243 21 17.828 21 15"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      {/if}

      <div class="text">
        <div class="title" class:marquee={needsMarquee} bind:this={titleEl}>
          <span>{title}</span>
          {#if needsMarquee}<span>{title}</span>{/if}
        </div>
        {#if body}
          <div class="subtitle" class:marquee={needsSubtitleMarquee} bind:this={subtitleEl}>
            <span>{body}</span>
            {#if needsSubtitleMarquee}<span>{body}</span>{/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="actions">
      {#if isPlaylist}
        <!-- Playlist: Single View Playlist button -->
        <button
          class="btn download playlist"
          class:downloading={isDownloading}
          class:full-width={true}
          onclick={() => handleDownload('auto')}
          disabled={isDownloading}
        >
          {#if isDownloading}
            <svg class="spinner" viewBox="0 0 24 24" width="14" height="14">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-dasharray="31.4 31.4"
                stroke-linecap="round"
              />
            </svg>
            Opening...
          {:else}
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path
                d="M4 6H20M4 10H20M4 14H14M4 18H14"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
              <circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="2" />
            </svg>
            {viewPlaylistLabel}
          {/if}
        </button>
      {:else if isYouTube}
        <!-- YouTube: Show Download and Track Builder buttons -->
        <button
          class="btn download"
          class:downloading={isDownloading}
          onclick={() => handleDownload('auto')}
          disabled={isDownloading}
        >
          {#if isDownloading}
            <svg class="spinner" viewBox="0 0 24 24" width="14" height="14">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-dasharray="31.4 31.4"
                stroke-linecap="round"
              />
            </svg>
            Starting...
          {:else}
            Download
          {/if}
        </button>
        <button class="btn track-builder" onclick={handleOpenTrackBuilder} disabled={isDownloading}>
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
            <path
              d="M12 5V19M5 12H19"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
          Options
        </button>
      {:else}
        <!-- Normal: Download button and optional dismiss button -->
        <button
          class="btn download"
          class:downloading={isDownloading}
          class:full-width={cornerDismiss}
          onclick={() => handleDownload('auto')}
          disabled={isDownloading}
        >
          {#if isDownloading}
            <svg class="spinner" viewBox="0 0 24 24" width="14" height="14">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-dasharray="31.4 31.4"
                stroke-linecap="round"
              />
            </svg>
            Starting...
          {:else}
            {downloadLabel}
          {/if}
        </button>
        {#if !cornerDismiss}
          <button class="btn dismiss" onclick={closeNotification}>{dismissLabel}</button>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  :global(html) {
    background: transparent !important;
  }
  :global(body) {
    background: transparent !important;
    font-family: 'Jost', system-ui, sans-serif;
    color: white;
    overflow: hidden;
    padding: 0;
  }

  /* Fancy background container */
  .notification-background {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .bg-video {
    position: absolute;
    top: 50%;
    left: 50%;
    min-width: 100%;
    min-height: 100%;
    width: auto;
    height: auto;
    transform: translate(-50%, -50%) scale(1.2);
    object-fit: cover;
  }

  .bg-image {
    position: absolute;
    inset: -20px;
    background-size: cover;
    background-position: center;
  }

  .bg-solid {
    position: absolute;
    inset: 0;
  }

  .bg-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.4) 100%);
  }

  .notification {
    background: #1a1a1e;
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    position: relative;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    z-index: 1;
  }

  .notification.fancy {
    background: rgba(26, 26, 30, 0.75);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .close-x {
    position: absolute;
    top: 8px;
    right: 10px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    z-index: 1;
  }
  .close-x:hover {
    color: white;
    background: rgba(255, 255, 255, 0.1);
  }

  /* Corner dismiss for compact mode */
  .close-corner {
    position: absolute;
    top: 2px;
    right: 2px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    width: 16px;
    height: 16px;
  }
  .close-corner:hover {
    color: white;
    background: rgba(255, 255, 255, 0.2);
  }

  .content {
    display: flex;
    gap: 10px;
    align-items: center;
    padding-right: 24px;
  }

  .thumb {
    width: 40px;
    height: 40px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .thumb.placeholder {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.2));
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent, #6366f1);
  }

  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title.marquee {
    display: flex;
    gap: 3em;
    animation: marquee 6s linear infinite;
    text-overflow: clip;
    overflow: visible;
    width: max-content;
  }
  .title.marquee span {
    flex-shrink: 0;
  }

  @keyframes marquee {
    0% {
      transform: translateX(0);
    }
    100% {
      transform: translateX(-50%);
    }
  }

  .subtitle {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .subtitle.marquee {
    display: flex;
    gap: 3em;
    animation: marquee 8s linear infinite;
    text-overflow: clip;
    overflow: visible;
    width: max-content;
  }
  .subtitle.marquee span {
    flex-shrink: 0;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    flex: 1;
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .btn.download {
    background: var(--accent, #6366f1);
    color: white;
  }
  .btn.download:hover:not(:disabled) {
    background: var(--accent-hover, #5558e3);
    transform: scale(1.02);
  }
  .btn.download:active:not(:disabled) {
    transform: scale(0.98);
  }
  .btn.download.downloading {
    background: var(--accent-hover, #4f46e5);
    cursor: default;
  }
  .btn.download:disabled {
    opacity: 0.9;
  }
  .btn.download.full-width {
    flex: 1;
  }
  .btn.dismiss {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
  }
  .btn.dismiss:hover {
    background: rgba(255, 255, 255, 0.12);
    color: white;
  }
  .btn.track-builder {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.9);
  }
  .btn.track-builder:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
    color: white;
  }

  .btn .spinner {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /* Compact mode styles */
  .notification.compact {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    padding-top: 6px; /* Slightly less top padding since X is absolute */
    position: relative; /* Ensure X button positions relative to this */
  }

  .thumb-compact {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .thumb-compact.placeholder {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.2));
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent, #6366f1);
  }

  .text-compact {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .text-compact .title {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .text-compact .title.marquee {
    display: flex;
    gap: 3em;
    animation: marquee 6s linear infinite;
    text-overflow: clip;
    overflow: visible;
    width: max-content;
  }
  .text-compact .title.marquee span {
    flex-shrink: 0;
  }

  .actions-compact {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  .icon-btn.download {
    background: var(--accent, #6366f1);
    color: white;
  }
  .icon-btn.download:hover:not(:disabled) {
    background: var(--accent-hover, #5558e3);
    transform: scale(1.08);
  }
  .icon-btn.download:active:not(:disabled) {
    transform: scale(0.95);
  }
  .icon-btn.download.downloading {
    background: var(--accent-hover, #4f46e5);
    cursor: default;
  }
  .icon-btn.download:disabled {
    opacity: 0.9;
  }
  .icon-btn.download .spinner {
    animation: spin 0.8s linear infinite;
  }
  .icon-btn.download .download-icon {
    transition: transform 0.15s ease;
  }

  /* Track builder button */
  .icon-btn.track-builder,
  .icon-btn.download.youtube {
    width: 28px;
    height: 28px;
  }
  .icon-btn.track-builder {
    background: rgba(255, 255, 255, 0.12);
    color: white;
  }
  .icon-btn.track-builder:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.08);
  }

  /* Playlist button - slightly larger */
  .icon-btn.playlist {
    width: 32px;
    height: 32px;
  }
</style>
