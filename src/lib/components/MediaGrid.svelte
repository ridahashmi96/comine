<script lang="ts">
  import { t } from '$lib/i18n';
  import { tooltip } from '$lib/actions/tooltip';
  import { formatDuration } from '$lib/utils/format';
  import Icon, { type IconName } from './Icon.svelte';
  import Checkbox from './Checkbox.svelte';

  export type ViewMode = 'list' | 'grid';

  export interface MediaItemData {
    id: string;
    title: string;
    thumbnail: string | null;
    duration: number | null;
    author: string | null;
    isMusic?: boolean;
  }

  export interface MediaItemSettings {
    downloadMode: 'auto' | 'audio' | 'mute';
    skipSponsors?: boolean;
    skipIntros?: boolean;
    embedChapters?: boolean;
    embedThumbnail?: boolean;
    embedMetadata?: boolean;
    embedSubs?: boolean;
    subLangs?: string;
  }

  const DEFAULT_SETTINGS: MediaItemSettings = {
    downloadMode: 'auto',
    skipSponsors: true,
    skipIntros: false,
    embedChapters: true,
    embedThumbnail: true,
    embedMetadata: true,
    embedSubs: false,
    subLangs: 'en',
  };

  interface Props {
    items: MediaItemData[];
    selectedIds: Set<string>;
    viewMode?: ViewMode;
    perItemSettings: Map<string, MediaItemSettings> | Record<string, MediaItemSettings>;
    loading?: boolean;
    initialScrollTop?: number;
    ontoggle?: (id: string) => void;
    onupdatesettings?: (id: string, settings: Partial<MediaItemSettings>) => void;
    onopenitem?: (item: MediaItemData) => void;
    onscroll?: (scrollTop: number) => void;
  }

  let {
    items,
    selectedIds,
    viewMode = 'list',
    perItemSettings,
    loading = false,
    initialScrollTop = 0,
    ontoggle,
    onupdatesettings,
    onopenitem,
    onscroll,
  }: Props = $props();

  let hoveredItemId = $state<string | null>(null);

  const ITEM_HEIGHT = 56;
  const GRID_ITEM_HEIGHT = 180;
  const BUFFER_COUNT = 5; // Reduced buffer for faster switching

  let containerEl: HTMLDivElement | null = $state(null);
  let scrollTop = $state(initialScrollTop);
  let containerHeight = $state(600);
  let lastViewMode = $state(viewMode);

  function bindContainer(el: HTMLDivElement) {
    containerEl = el;
    // Restore scroll immediately, synchronously
    if (el && initialScrollTop > 0) {
      el.scrollTop = initialScrollTop;
    }
  }

  $effect(() => {
    if (viewMode !== lastViewMode && containerEl && items.length > 50) {
      const oldItemHeight = lastViewMode === 'list' ? ITEM_HEIGHT : GRID_ITEM_HEIGHT;
      const oldItemsPerRow = lastViewMode === 'grid' ? 3 : 1;
      const newItemHeight = viewMode === 'list' ? ITEM_HEIGHT : GRID_ITEM_HEIGHT;
      const newItemsPerRow = viewMode === 'grid' ? 3 : 1;

      const oldRow = Math.floor(scrollTop / oldItemHeight);
      const topItemIndex = oldRow * oldItemsPerRow;

      const newRow = Math.floor(topItemIndex / newItemsPerRow);
      const newScrollTop = newRow * newItemHeight;

      requestAnimationFrame(() => {
        if (containerEl) {
          containerEl.scrollTop = newScrollTop;
          scrollTop = newScrollTop;
        }
      });

      lastViewMode = viewMode;
    }
  });

  let scrollRAF: number | null = null;
  function handleScroll(e: Event) {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      const target = e.target as HTMLDivElement;
      scrollTop = target.scrollTop;
      onscroll?.(scrollTop);
      scrollRAF = null;
    });
  }

  let itemHeight = $derived(viewMode === 'list' ? ITEM_HEIGHT : GRID_ITEM_HEIGHT);
  let itemsPerRow = $derived(viewMode === 'grid' ? 3 : 1);

  let visibleRange = $derived.by(() => {
    if (items.length <= 50) return { startIdx: 0, endIdx: items.length };

    const startRow = Math.floor(scrollTop / itemHeight);
    const visibleRows = Math.ceil(containerHeight / itemHeight) + 1;

    const startIdx = Math.max(0, (startRow - BUFFER_COUNT) * itemsPerRow);
    const endIdx = Math.min(items.length, (startRow + visibleRows + BUFFER_COUNT) * itemsPerRow);

    return { startIdx, endIdx };
  });

  let visibleItems = $derived(
    items.length <= 50 ? items : items.slice(visibleRange.startIdx, visibleRange.endIdx)
  );

  let totalHeight = $derived.by(() => {
    if (items.length <= 50) return 'auto';
    const rows = Math.ceil(items.length / itemsPerRow);
    return `${rows * itemHeight}px`;
  });

  let offsetTop = $derived.by(() => {
    if (items.length <= 50) return 0;
    const startRow = Math.floor(visibleRange.startIdx / itemsPerRow);
    return startRow * itemHeight;
  });

  function getSettings(id: string): MediaItemSettings {
    if (perItemSettings instanceof Map) {
      return perItemSettings.get(id) ?? DEFAULT_SETTINGS;
    }
    return perItemSettings[id] ?? DEFAULT_SETTINGS;
  }

  const MODE_ICONS: Record<string, IconName> = { audio: 'music', mute: 'video', auto: 'download' };
  const MODE_LABELS_KEYS: Record<string, string> = {
    audio: 'download.mode.audio',
    mute: 'download.mode.mute',
    auto: 'download.mode.auto',
  };

  function getModeIcon(mode: string): IconName {
    return MODE_ICONS[mode] ?? 'download';
  }

  function getModeLabel(mode: string): string {
    return $t(MODE_LABELS_KEYS[mode] ?? 'download.mode.auto');
  }

  const MODES: Array<'auto' | 'audio' | 'mute'> = ['auto', 'audio', 'mute'];

  function cycleMode(id: string) {
    const current = getSettings(id).downloadMode;
    const nextIndex = (MODES.indexOf(current) + 1) % 3;
    onupdatesettings?.(id, { downloadMode: MODES[nextIndex] });
  }
</script>

{#if viewMode === 'list'}
  <div
    class="list-view"
    class:virtualized={items.length > 50}
    use:bindContainer
    onscroll={handleScroll}
    bind:clientHeight={containerHeight}
  >
    {#if loading}
      {#each Array(5) as _, i (i)}
        <div class="list-item skeleton-item">
          <div class="skeleton thumb-skel"></div>
          <div class="skeleton-info">
            <div class="skeleton title-skel"></div>
            <div class="skeleton meta-skel"></div>
          </div>
        </div>
      {/each}
    {:else if items.length === 0}
      <div class="empty-state">
        <Icon name="search" size={24} />
        <span>{$t('playlist.noResults')}</span>
      </div>
    {:else}
      <div class="virtual-spacer" style="height: {totalHeight}; position: relative;">
        <div class="virtual-content" style="transform: translateY({offsetTop}px);">
          {#each visibleItems as item (item.id)}
            {@const isSelected = selectedIds.has(item.id)}
            {@const settings = getSettings(item.id)}
            {@const isHovered = hoveredItemId === item.id}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="list-item"
              class:selected={isSelected}
              onmouseenter={() => (hoveredItemId = item.id)}
              onmouseleave={() => (hoveredItemId = null)}
              onclick={() => ontoggle?.(item.id)}
            >
              <div class="item-check">
                <Checkbox checked={isSelected} />
              </div>
              <div class="item-thumb">
                {#if item.thumbnail}
                  <img src={item.thumbnail} alt="" loading="lazy" />
                {:else}
                  <div class="thumb-placeholder">
                    <Icon name="video" size={16} />
                  </div>
                {/if}
                {#if item.duration}
                  <span class="duration-badge">{formatDuration(item.duration)}</span>
                {/if}
                {#if isHovered && onopenitem}
                  <button
                    class="thumb-open-btn"
                    onclick={(e) => {
                      e.stopPropagation();
                      onopenitem(item);
                    }}
                  >
                    <Icon name="maximize" size={12} />
                  </button>
                {/if}
              </div>
              <div class="item-info">
                <span class="item-title" title={item.title}>{item.title}</span>
                <span class="item-author">{item.author ?? ''}</span>
              </div>
              <button
                class="mode-badge"
                class:audio={settings.downloadMode === 'audio'}
                class:mute={settings.downloadMode === 'mute'}
                onclick={(e) => {
                  e.stopPropagation();
                  cycleMode(item.id);
                }}
                use:tooltip={getModeLabel(settings.downloadMode)}
              >
                <Icon name={getModeIcon(settings.downloadMode)} size={12} />
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{:else}
  <div
    class="grid-view"
    class:virtualized={items.length > 50}
    use:bindContainer
    onscroll={handleScroll}
    bind:clientHeight={containerHeight}
  >
    {#if loading}
      {#each Array(6) as _, i (i)}
        <div class="grid-card skeleton-card">
          <div class="skeleton card-thumb-skel"></div>
          <div class="card-info">
            <div class="skeleton title-skel"></div>
            <div class="skeleton meta-skel"></div>
          </div>
        </div>
      {/each}
    {:else if items.length === 0}
      <div class="empty-state grid-empty">
        <Icon name="search" size={24} />
        <span>{$t('playlist.noResults')}</span>
      </div>
    {:else}
      <div class="virtual-spacer-grid" style="min-height: {totalHeight};">
        <div class="virtual-content-grid" style="transform: translateY({offsetTop}px);">
          {#each visibleItems as item (item.id)}
            {@const isSelected = selectedIds.has(item.id)}
            {@const settings = getSettings(item.id)}
            {@const isHovered = hoveredItemId === item.id}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="grid-card"
              class:selected={isSelected}
              onmouseenter={() => (hoveredItemId = item.id)}
              onmouseleave={() => (hoveredItemId = null)}
              onclick={() => ontoggle?.(item.id)}
            >
              <div class="card-thumb">
                {#if item.thumbnail}
                  <img src={item.thumbnail} alt="" loading="lazy" />
                {:else}
                  <div class="card-thumb-placeholder">
                    <Icon name="video" size={28} />
                  </div>
                {/if}
                <div class="card-check">
                  <Checkbox checked={isSelected} />
                </div>
                {#if item.duration}
                  <span class="duration-badge">{formatDuration(item.duration)}</span>
                {/if}
                <button
                  class="mode-indicator"
                  class:audio={settings.downloadMode === 'audio'}
                  class:mute={settings.downloadMode === 'mute'}
                  class:hidden={isHovered}
                  onclick={(e) => {
                    e.stopPropagation();
                    cycleMode(item.id);
                  }}
                  use:tooltip={getModeLabel(settings.downloadMode)}
                >
                  <Icon name={getModeIcon(settings.downloadMode)} size={10} />
                </button>
                {#if isHovered}
                  <button
                    class="mode-center"
                    class:audio={settings.downloadMode === 'audio'}
                    class:mute={settings.downloadMode === 'mute'}
                    onclick={(e) => {
                      e.stopPropagation();
                      cycleMode(item.id);
                    }}
                  >
                    <Icon name={getModeIcon(settings.downloadMode)} size={14} />
                    <span
                      >{settings.downloadMode === 'auto'
                        ? 'Auto'
                        : settings.downloadMode === 'audio'
                          ? 'Audio'
                          : 'No Audio'}</span
                    >
                  </button>
                {/if}
                {#if isHovered && onopenitem}
                  <button
                    class="card-open-btn"
                    onclick={(e) => {
                      e.stopPropagation();
                      onopenitem(item);
                    }}
                    use:tooltip={$t('playlist.openItem')}
                  >
                    <Icon name="link2" size={12} />
                  </button>
                {/if}
              </div>
              <div class="card-info">
                <span class="card-title" title={item.title}>{item.title}</span>
                <span class="card-author">{item.author ?? ''}</span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* ===== List View ===== */
  .list-view {
    display: flex;
    flex-direction: column;
    contain: layout style;
  }

  .list-view.virtualized {
    overflow-y: auto;
    max-height: 100%;
    will-change: scroll-position;
  }

  .virtual-spacer {
    width: 100%;
    contain: strict;
  }

  .virtual-content {
    display: flex;
    flex-direction: column;
    will-change: transform;
  }

  .list-item {
    display: grid;
    grid-template-columns: auto 56px 1fr auto;
    gap: 10px;
    align-items: center;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    user-select: none;
    contain: layout style;
  }

  .list-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .list-item.selected {
    background: rgba(99, 102, 241, 0.08);
  }

  .list-item.selected:hover {
    background: rgba(99, 102, 241, 0.12);
  }

  .item-check {
    display: flex;
    pointer-events: none;
  }

  /* Thumbnail */
  .item-thumb {
    position: relative;
    width: 56px;
    height: 32px;
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .item-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.3);
  }

  .duration-badge {
    position: absolute;
    bottom: 2px;
    right: 2px;
    padding: 1px 4px;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 3px;
    font-size: 9px;
    color: white;
    font-variant-numeric: tabular-nums;
  }

  /* Info */
  .item-info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .item-title {
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-author {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.45);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Open button on thumbnail (list view) */
  .thumb-open-btn {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    transition: background 0.15s;
  }

  .thumb-open-btn:hover {
    background: rgba(99, 102, 241, 0.8);
  }

  /* Mode badge */
  .mode-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .mode-badge:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .mode-badge:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .mode-badge.audio {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.3);
    color: var(--accent, #6366f1);
  }

  .mode-badge.mute {
    background: rgba(251, 191, 36, 0.15);
    border-color: rgba(251, 191, 36, 0.3);
    color: #fbbf24;
  }

  /* ===== Grid View ===== */
  .grid-view {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
    contain: layout style;
  }

  .grid-view.virtualized {
    display: block;
    overflow-y: auto;
    max-height: 100%;
    will-change: scroll-position;
  }

  .virtual-spacer-grid {
    width: 100%;
  }

  .virtual-content-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
    contain: layout style;
  }

  .grid-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    overflow: hidden;
    transition:
      transform 0.2s,
      background 0.2s,
      border-color 0.2s;
    cursor: pointer;
    user-select: none;
    contain: layout style paint;
  }

  .grid-card:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
    transform: translateY(-2px);
  }

  .grid-card.selected {
    border-color: rgba(99, 102, 241, 0.4);
    background: rgba(99, 102, 241, 0.08);
  }

  /* Card thumbnail */
  .card-thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    background: rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .card-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
  }

  .grid-card:hover .card-thumb img {
    transform: scale(1.05);
  }

  .card-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.2);
  }

  .card-check {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 5;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 4px;
    padding: 3px;
    pointer-events: none;
    display: flex;
  }

  .card-thumb .duration-badge {
    bottom: 6px;
    right: 6px;
    padding: 2px 5px;
    font-size: 10px;
    border-radius: 4px;
  }

  /* Mode indicator badge */
  .mode-indicator {
    position: absolute;
    bottom: 6px;
    left: 6px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.15s;
  }

  .mode-indicator:hover {
    background: rgba(0, 0, 0, 0.85);
    transform: scale(1.1);
  }

  .mode-indicator.audio {
    background: rgba(99, 102, 241, 0.85);
    color: white;
  }

  .mode-indicator.mute {
    background: rgba(251, 191, 36, 0.85);
    color: #1a1a1a;
  }

  .mode-indicator.hidden {
    opacity: 0;
    pointer-events: none;
  }

  /* Centered mode button (on hover) */
  .mode-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: white;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    animation: fadeIn 0.1s ease-out;
    z-index: 10;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.9);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  .mode-center:hover {
    background: rgba(0, 0, 0, 0.9);
    border-color: rgba(255, 255, 255, 0.3);
    transform: translate(-50%, -50%) scale(1.05);
  }

  .mode-center.audio {
    background: rgba(99, 102, 241, 0.9);
    border-color: rgba(99, 102, 241, 0.5);
  }

  .mode-center.mute {
    background: rgba(251, 191, 36, 0.9);
    border-color: rgba(251, 191, 36, 0.5);
    color: #1a1a1a;
  }

  /* Open item button (grid view) - top-right corner */
  .card-open-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: 5px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.15s;
  }

  .card-open-btn:hover {
    background: var(--accent, #6366f1);
    color: white;
  }

  /* Card info */
  .card-info {
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .card-title {
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.3;
  }

  .card-author {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ===== Empty & Skeleton ===== */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
  }

  .grid-empty {
    grid-column: 1 / -1;
  }

  .skeleton-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
  }

  .skeleton {
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.08) 50%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 4px;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .thumb-skel {
    width: 56px;
    height: 32px;
    flex-shrink: 0;
  }

  .skeleton-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .title-skel {
    height: 12px;
    width: 70%;
  }

  .meta-skel {
    height: 10px;
    width: 40%;
  }

  .skeleton-card {
    overflow: hidden;
  }

  .card-thumb-skel {
    aspect-ratio: 16 / 9;
    border-radius: 0;
  }

  .skeleton-card .card-info {
    padding: 10px;
  }

  .skeleton-card .title-skel {
    width: 85%;
  }

  .skeleton-card .meta-skel {
    width: 50%;
  }

  /* ===== Mobile ===== */
  @media (max-width: 560px) {
    .grid-view {
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 8px;
    }

    .list-item {
      grid-template-columns: auto 48px 1fr auto;
      gap: 8px;
      padding: 6px 8px;
    }

    .item-thumb {
      width: 48px;
      height: 27px;
    }

    .item-title {
      font-size: 11px;
    }

    .mode-badge {
      width: 24px;
      height: 24px;
    }
  }
</style>
