<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { goto } from '$app/navigation';
  import { invoke, convertFileSrc } from '@tauri-apps/api/core';
  import { revealItemInDir, openUrl, openPath } from '@tauri-apps/plugin-opener';
  import { stat } from '@tauri-apps/plugin-fs';
  import { toast } from '$lib/components/Toast.svelte';
  import {
    history,
    playlistGroupedHistory,
    historyStats,
    formatDuration,
    isPlaylistGroup,
    refreshDateGroups,
    type FilterType,
    type SortType,
    type HistoryItem,
    type HistoryPlaylistGroup,
  } from '$lib/stores/history';
  import { isAndroid, openFileOnAndroid, openFolderOnAndroid } from '$lib/utils/android';
  import { settings, updateSetting } from '$lib/stores/settings';
  import {
    activeDownloads as queueActiveDownloads,
    queue,
    isQueuePaused,
    pendingDownloadsCount,
    groupedDownloads,
  } from '$lib/stores/queue';
  import { navigation } from '$lib/stores/navigation';
  import { isLikelyPlaylist, isLikelyChannel } from '$lib/utils/format';
  import Icon from '$lib/components/Icon.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import Divider from '$lib/components/Divider.svelte';
  import Select from '$lib/components/Select.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import {
    extractDominantColor,
    generateColorVars,
    getCachedColor,
    getCachedColorAsync,
    type RGB,
  } from '$lib/utils/color';
  import { saveScrollPosition, getScrollPosition } from '$lib/stores/scroll';

  const ROUTE_PATH = '/downloads';
  const ITEM_HEIGHT = 56;
  const DATE_HEADER_HEIGHT = 44;
  const PLAYLIST_HEADER_HEIGHT = 60;
  const BUFFER_COUNT = 5;
  const GRID_MIN_COL_WIDTH = 160;
  const GRID_GAP = 10;
  const GRID_CARD_INFO_HEIGHT = 64;

  type FlatRowType =
    | { kind: 'date'; label: string }
    | { kind: 'single'; item: HistoryItem; dateLabel: string }
    | { kind: 'playlist'; group: HistoryPlaylistGroup; dateLabel: string }
    | {
        kind: 'playlist-child';
        item: HistoryItem;
        playlistId: string;
        isLast: boolean;
        dateLabel: string;
      };

  let containerEl: HTMLDivElement | null = $state(null);
  let scrollTop = $state(0);
  let containerHeight = $state(600);
  let containerWidth = $state(800);
  let maskStyle = $state('');
  const MASK_SIZE = 25;

  beforeNavigate(() => {
    saveScrollPosition(ROUTE_PATH, scrollTop);
    thumbnailSrcCache.clear();
    thumbnailCacheOrder = [];
    playlistThumbnailCache.clear();
    playlistCacheOrder = [];
  });

  function updateMaskStyle() {
    if (!containerEl) return;
    const { scrollTop: st, scrollHeight, clientHeight } = containerEl;
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 0) {
      maskStyle = '';
      return;
    }
    const topProgress = Math.min(st / MASK_SIZE, 1);
    const topFade =
      topProgress > 0 ? `transparent, black ${MASK_SIZE * topProgress}px` : 'black, black 0px';

    const bottomProgress = Math.min((maxScroll - st) / MASK_SIZE, 1);
    const bottomFade =
      bottomProgress > 0
        ? `black calc(100% - ${MASK_SIZE * bottomProgress}px), transparent`
        : 'black 100%, black 100%';
    maskStyle = `mask-image: linear-gradient(to bottom, ${topFade}, ${bottomFade}); -webkit-mask-image: linear-gradient(to bottom, ${topFade}, ${bottomFade});`;
  }

  function getGridItemsPerRow(width: number): number {
    if (!Number.isFinite(width) || width <= 0) return 1;
    return Math.max(1, Math.floor((width + GRID_GAP) / (GRID_MIN_COL_WIDTH + GRID_GAP)));
  }

  function getGridRowHeight(width: number, perRow: number): number {
    if (!Number.isFinite(width) || width <= 0 || perRow <= 0) return 220;
    const cardWidth = (width - GRID_GAP * Math.max(0, perRow - 1)) / perRow;
    const thumbHeight = (cardWidth * 9) / 16;
    return Math.max(180, Math.round(thumbHeight + GRID_CARD_INFO_HEIGHT + GRID_GAP));
  }

  onMount(() => {
    history.init();

    const savedPosition = getScrollPosition(ROUTE_PATH);
    if (savedPosition > 0 && containerEl) {
      containerEl.scrollTop = savedPosition;
      scrollTop = savedPosition;
    }
    setTimeout(updateMaskStyle, 50);

    const resizeObserver = new ResizeObserver(updateMaskStyle);
    if (containerEl) resizeObserver.observe(containerEl);

    const cleanupInterval = setInterval(() => {
      if (failedThumbnails.size > MAX_FAILED_THUMBNAILS) {
        failedThumbnails = new Set();
      }
      if (missingFiles.size > 100) {
        missingFiles = new Set();
      }
    }, 60000);

    // Refresh date groups when page becomes visible (handles day change while app was backgrounded)
    let lastRefreshDate = new Date().toDateString();
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        const currentDate = new Date().toDateString();
        if (currentDate !== lastRefreshDate) {
          lastRefreshDate = currentDate;
          refreshDateGroups();
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      resizeObserver.disconnect();
      clearInterval(cleanupInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (scrollRAF) {
        cancelAnimationFrame(scrollRAF);
        scrollRAF = null;
      }
      thumbnailSrcCache.clear();
      thumbnailCacheOrder = [];
      playlistThumbnailCache.clear();
      playlistCacheOrder = [];
    };
  });

  let missingFiles = $state<Set<string>>(new Set());

  async function checkFileExists(id: string, filePath: string | undefined) {
    if (!filePath || missingFiles.has(id)) return;
    try {
      await stat(filePath);
      if (missingFiles.has(id)) {
        const next = new Set(missingFiles);
        next.delete(id);
        missingFiles = next;
      }
    } catch {
      missingFiles = new Set(missingFiles).add(id);
    }
  }

  function isFileMissing(id: string): boolean {
    return missingFiles.has(id);
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const sizeUnit = $settings.sizeUnit;
    const k = sizeUnit === 'binary' ? 1024 : 1000;
    const sizes = sizeUnit === 'binary' ? ['B', 'KiB', 'MiB', 'GiB'] : ['B', 'kB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  let searchQuery = $state('');
  let activeFilter = $state<FilterType>('all');
  let sortType = $state<SortType>('date');
  let viewMode = $derived($settings.downloadsViewMode);
  let hoveredItemId = $state<string | null>(null);
  let showStatsPanel = $state(false);

  // Derived type counts for stats panel
  let typeCounts = $derived.by(() => {
    const items = $history.items;
    const counts = { video: 0, audio: 0, image: 0, file: 0 };
    for (const item of items) {
      if (item.type in counts) {
        counts[item.type as keyof typeof counts]++;
      }
    }
    return counts;
  });

  // Top formats for stats
  let topFormats = $derived.by(() => {
    const formatCounts = $historyStats.formatCounts;
    return Object.entries(formatCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  });

  const MAX_COLOR_CACHE = 200;
  let itemColors = $state<Map<string, RGB>>(new Map());
  let colorAccessOrder = $state<string[]>([]);

  async function extractItemColor(id: string, thumbnailUrl: string | undefined) {
    if (!$settings.thumbnailTheming || !thumbnailUrl) return;
    if (itemColors.has(thumbnailUrl)) return;

    const cachedColor = await getCachedColorAsync(thumbnailUrl);
    if (cachedColor) {
      if (itemColors.size >= MAX_COLOR_CACHE) {
        const oldest = colorAccessOrder.shift();
        if (oldest) {
          const next = new Map(itemColors);
          next.delete(oldest);
          itemColors = next;
        }
      }
      itemColors = new Map(itemColors).set(thumbnailUrl, cachedColor);
      colorAccessOrder = [...colorAccessOrder, thumbnailUrl];
      return;
    }

    const color = await extractDominantColor(thumbnailUrl);
    if (color) {
      if (itemColors.size >= MAX_COLOR_CACHE) {
        const oldest = colorAccessOrder.shift();
        if (oldest) {
          const next = new Map(itemColors);
          next.delete(oldest);
          itemColors = next;
        }
      }
      itemColors = new Map(itemColors).set(thumbnailUrl, color);
      colorAccessOrder = [...colorAccessOrder, thumbnailUrl];
    }
  }

  const MAX_THUMBNAIL_CACHE = 300;
  const thumbnailSrcCache = new Map<string, string>();
  let thumbnailCacheOrder: string[] = [];
  const MAX_FAILED_THUMBNAILS = 100;
  let failedThumbnails = $state(new Set<string>());

  function getThumbnailSrc(thumbnail: string | undefined): string | undefined {
    if (!thumbnail) return undefined;

    if (thumbnailSrcCache.has(thumbnail)) {
      return thumbnailSrcCache.get(thumbnail);
    }

    let result: string;
    if (thumbnail.match(/^[A-Z]:\\/i) || thumbnail.startsWith('/')) {
      result = convertFileSrc(thumbnail);
    } else {
      result = thumbnail;
    }

    if (thumbnailSrcCache.size >= MAX_THUMBNAIL_CACHE) {
      const oldest = thumbnailCacheOrder.shift();
      if (oldest) thumbnailSrcCache.delete(oldest);
    }

    thumbnailSrcCache.set(thumbnail, result);
    thumbnailCacheOrder.push(thumbnail);
    return result;
  }

  function getItemColorStyle(thumbnailUrl: string | undefined): string {
    if (!$settings.thumbnailTheming || !thumbnailUrl) return '';
    const color = itemColors.get(thumbnailUrl) || getCachedColor(thumbnailUrl);
    if (!color) return '';
    return generateColorVars(color);
  }

  let collapsedPlaylists = $state<Set<string>>(new Set());
  let collapsedHistoryPlaylists = $state<Set<string>>(new Set());

  const MAX_PLAYLIST_THUMB_CACHE = 50;
  const playlistThumbnailCache = new Map<string, string[]>();
  let playlistCacheOrder: string[] = [];

  function getPlaylistGridThumbs(playlistId: string, items: { thumbnail?: string }[]): string[] {
    if (playlistThumbnailCache.has(playlistId)) {
      return playlistThumbnailCache.get(playlistId)!;
    }

    const thumbs = items
      .filter((i) => i.thumbnail)
      .slice(0, 4)
      .map((i) => getThumbnailSrc(i.thumbnail!) || i.thumbnail!);

    if (playlistThumbnailCache.size >= MAX_PLAYLIST_THUMB_CACHE) {
      const oldest = playlistCacheOrder.shift();
      if (oldest) playlistThumbnailCache.delete(oldest);
    }

    playlistThumbnailCache.set(playlistId, thumbs);
    playlistCacheOrder.push(playlistId);
    return thumbs;
  }

  function togglePlaylistExpanded(playlistId: string) {
    const next = new Set(collapsedPlaylists);
    if (next.has(playlistId)) {
      next.delete(playlistId);
    } else {
      next.add(playlistId);
    }
    collapsedPlaylists = next;
  }

  function toggleHistoryPlaylistExpanded(playlistId: string) {
    const next = new Set(collapsedHistoryPlaylists);
    if (next.has(playlistId)) {
      next.delete(playlistId);
    } else {
      next.add(playlistId);
    }
    collapsedHistoryPlaylists = next;
  }

  function handlePlaylistKeydown(event: KeyboardEvent, playlistId: string, isHistory: boolean) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isHistory) {
        toggleHistoryPlaylistExpanded(playlistId);
      } else {
        togglePlaylistExpanded(playlistId);
      }
    }
  }

  let flatRows = $derived.by<FlatRowType[]>(() => {
    const rows: FlatRowType[] = [];
    for (const group of $playlistGroupedHistory) {
      const dateLabel = group.label;
      rows.push({ kind: 'date', label: dateLabel });
      for (const item of group.items) {
        if (isPlaylistGroup(item)) {
          const pg = item as HistoryPlaylistGroup;
          rows.push({ kind: 'playlist', group: pg, dateLabel });
          if (!collapsedHistoryPlaylists.has(pg.playlistId)) {
            const childCount = pg.items.length;
            pg.items.forEach((child, idx) => {
              rows.push({
                kind: 'playlist-child',
                item: child,
                playlistId: pg.playlistId,
                isLast: idx === childCount - 1,
                dateLabel,
              });
            });
          }
        } else {
          rows.push({ kind: 'single', item: item as HistoryItem, dateLabel });
        }
      }
    }
    return rows;
  });

  let flatGridItems = $derived.by(() => {
    const items: Array<HistoryItem> = [];
    for (const group of $playlistGroupedHistory) {
      for (const item of group.items) {
        if (isPlaylistGroup(item)) {
          const pg = item as HistoryPlaylistGroup;
          items.push(...pg.items);
        } else {
          items.push(item as HistoryItem);
        }
      }
    }
    return items;
  });

  let gridItemsPerRow = $derived(getGridItemsPerRow(containerWidth));
  let gridRowHeight = $derived(getGridRowHeight(containerWidth, gridItemsPerRow));

  let gridVisibleRange = $derived.by(() => {
    if (viewMode !== 'grid' || flatGridItems.length <= 30) {
      return { startIdx: 0, endIdx: flatGridItems.length };
    }

    const startRow = Math.floor(scrollTop / gridRowHeight);
    const visibleRows = Math.ceil(containerHeight / gridRowHeight) + 1;

    const startIdx = Math.max(0, (startRow - BUFFER_COUNT) * gridItemsPerRow);
    const endIdx = Math.min(
      flatGridItems.length,
      (startRow + visibleRows + BUFFER_COUNT) * gridItemsPerRow
    );

    return { startIdx, endIdx };
  });

  let visibleGridItems = $derived(
    viewMode !== 'grid' || flatGridItems.length <= 30
      ? flatGridItems
      : flatGridItems.slice(gridVisibleRange.startIdx, gridVisibleRange.endIdx)
  );

  let gridTotalHeight = $derived.by(() => {
    if (viewMode !== 'grid' || flatGridItems.length <= 30) return 'auto';
    const rows = Math.ceil(flatGridItems.length / gridItemsPerRow);
    return `${rows * gridRowHeight}px`;
  });

  let gridOffsetTop = $derived.by(() => {
    if (viewMode !== 'grid' || flatGridItems.length <= 30) return 0;
    const startRow = Math.floor(gridVisibleRange.startIdx / gridItemsPerRow);
    return startRow * gridRowHeight;
  });

  function getRowHeight(row: FlatRowType): number {
    switch (row.kind) {
      case 'date':
        return DATE_HEADER_HEIGHT;
      case 'playlist':
        return PLAYLIST_HEADER_HEIGHT;
      default:
        return ITEM_HEIGHT;
    }
  }

  let rowOffsets = $derived.by(() => {
    const offsets: number[] = [];
    let y = 0;
    for (const row of flatRows) {
      offsets.push(y);
      y += getRowHeight(row);
    }
    return offsets;
  });

  let totalHeight = $derived(
    flatRows.length > 0
      ? rowOffsets[flatRows.length - 1] + getRowHeight(flatRows[flatRows.length - 1])
      : 0
  );

  let visibleRange = $derived.by(() => {
    if (flatRows.length <= 30) return { startIdx: 0, endIdx: flatRows.length };

    const viewTop = scrollTop;
    const viewBottom = scrollTop + containerHeight;

    let startIdx = 0;
    for (let i = 0; i < rowOffsets.length; i++) {
      if (rowOffsets[i] + getRowHeight(flatRows[i]) >= viewTop - BUFFER_COUNT * ITEM_HEIGHT) {
        startIdx = i;
        break;
      }
    }

    let endIdx = flatRows.length;
    for (let i = startIdx; i < rowOffsets.length; i++) {
      if (rowOffsets[i] > viewBottom + BUFFER_COUNT * ITEM_HEIGHT) {
        endIdx = i;
        break;
      }
    }

    return { startIdx: Math.max(0, startIdx), endIdx: Math.min(flatRows.length, endIdx) };
  });

  let visibleRows = $derived(flatRows.slice(visibleRange.startIdx, visibleRange.endIdx));
  let offsetTop = $derived(visibleRange.startIdx > 0 ? rowOffsets[visibleRange.startIdx] : 0);

  let scrollRAF: number | null = null;
  function handleScroll(e: Event) {
    updateMaskStyle();
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      scrollTop = (e.target as HTMLDivElement).scrollTop;
      scrollRAF = null;
    });
  }

  let activeDownloads = $derived(
    $queueActiveDownloads.filter((item) => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(query) ||
        item.author.toLowerCase().includes(query) ||
        item.url.toLowerCase().includes(query)
      );
    })
  );

  let filteredGroupedDownloads = $derived(() => {
    const { groups, singles } = $groupedDownloads;
    if (!searchQuery.trim()) return { groups, singles };

    const query = searchQuery.toLowerCase();
    const matchesSearch = (item: (typeof singles)[0]) =>
      item.title.toLowerCase().includes(query) ||
      item.author.toLowerCase().includes(query) ||
      item.url.toLowerCase().includes(query);

    return {
      groups: groups
        .map((g) => ({
          ...g,
          items: g.items.filter(matchesSearch),
        }))
        .filter((g) => g.items.length > 0),
      singles: singles.filter(matchesSearch),
    };
  });

  $effect(() => {
    history.setSearch(searchQuery);
  });

  $effect(() => {
    history.setSort(sortType);
  });

  function setFilter(filter: FilterType) {
    activeFilter = filter;
    history.setFilter(filter);
  }

  function setSort(sort: SortType) {
    sortType = sort;
    history.setSort(sort);
  }

  function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation();
    history.remove(id);
  }

  async function handleOpenLink(e: MouseEvent, url: string) {
    e.stopPropagation();
    try {
      await openUrl(url);
    } catch (err) {
      console.error('Failed to open URL:', err);
    }
  }

  function handleRedownload(e: MouseEvent, url: string) {
    e.stopPropagation();
    goto(`/?url=${encodeURIComponent(url)}`);
  }

  function handleOpenVideoView(e: MouseEvent, item: HistoryItem) {
    e.stopPropagation();
    if (!item.url) return;

    const isYouTube = /youtube\.com|youtu\.be/i.test(item.url);
    if (!isYouTube) {
      goto(`/?url=${encodeURIComponent(item.url)}`);
      return;
    }

    navigation.openVideo(item.url, {
      title: item.title,
      thumbnail: item.thumbnail,
      author: item.author,
    });
    goto('/');
  }

  function handleOpenChannelView(e: MouseEvent, item: HistoryItem) {
    e.stopPropagation();
    if (!item.author || !item.url) return;

    const isYouTube = /youtube\.com|youtu\.be/i.test(item.url);
    if (!isYouTube) return;

    const channelSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(item.author)}&sp=EgIQAg%253D%253D`;

    navigation.openVideo(item.url, {
      title: item.title,
      thumbnail: item.thumbnail,
      author: item.author,
    });
    goto('/');
  }

  async function handleOpenFile(e: MouseEvent, filePath: string) {
    e.stopPropagation();
    if (!filePath) {
      console.warn('No file path provided for this item');
      toast.error($t('downloads.noFilePath'));
      return;
    }
    try {
      if (isAndroid()) {
        const success = openFolderOnAndroid(filePath);
        if (!success) {
          toast.error('Could not open folder');
        }
      } else {
        await revealItemInDir(filePath);
      }
    } catch (err) {
      console.error('Failed to open file location:', err);
      toast.error(`Failed to open folder: ${err}`);
    }
  }

  async function handlePlayFile(e: MouseEvent, filePath: string) {
    e.stopPropagation();
    if (!filePath) {
      console.warn('No file path provided for this item');
      toast.error($t('downloads.noFilePath'));
      return;
    }
    try {
      if (isAndroid()) {
        const success = openFileOnAndroid(filePath);
        if (!success) {
          toast.error('Could not open file');
        }
      } else {
        await openPath(filePath);
      }
    } catch (err) {
      console.error('Failed to play file:', err);
      toast.error(`Failed to play file: ${err}`);
    }
  }

  function getTypeIcon(type: string): 'video' | 'music' | 'image' | 'file_text' | 'download' {
    switch (type) {
      case 'video':
        return 'video';
      case 'audio':
        return 'music';
      case 'image':
        return 'image';
      case 'file':
        return 'file_text';
      default:
        return 'download';
    }
  }

  onMount(() => {
    if (isAndroid()) return;

    (async () => {
      const items = await history.getItems();
      const itemsToFix = items.filter(
        (item) =>
          item.duration === 0 && item.filePath && (item.type === 'video' || item.type === 'audio')
      );

      if (itemsToFix.length === 0) return;

      for (const item of itemsToFix) {
        try {
          const duration = await invoke<number>('get_media_duration', { filePath: item.filePath });
          if (duration > 0) {
            history.updateDuration(item.id, Math.floor(duration));
          }
        } catch (err) {}
      }
    })();
  });
</script>

<div class="page">
  <div class="search-bar">
    <Icon name="search" size={18} />
    <input type="text" placeholder={$t('downloads.searchPlaceholder')} bind:value={searchQuery} />
  </div>

  <div class="toolbar">
    <div class="filters">
      <Chip selected={activeFilter === 'all'} icon="date" onclick={() => setFilter('all')}>
        {$t('downloads.filters.all')}
      </Chip>
      <Chip selected={activeFilter === 'video'} icon="video" onclick={() => setFilter('video')}>
        {$t('downloads.filters.video')}
      </Chip>
      <Chip selected={activeFilter === 'audio'} icon="music" onclick={() => setFilter('audio')}>
        {$t('downloads.filters.audio')}
      </Chip>
      <Chip selected={activeFilter === 'image'} icon="image" onclick={() => setFilter('image')}>
        {$t('downloads.filters.image')}
      </Chip>
      <Chip selected={activeFilter === 'file'} icon="file_text" onclick={() => setFilter('file')}>
        {$t('downloads.filters.file')}
      </Chip>
    </div>

    <div class="controls-right">
      <div class="sort-control">
        <span class="sort-label">{$t('downloads.sort.label')}:</span>
        <Select
          bind:value={sortType}
          options={[
            { value: 'date', label: $t('downloads.sort.date') },
            { value: 'name', label: $t('downloads.sort.name') },
            { value: 'size', label: $t('downloads.sort.size') },
          ]}
          onchange={(v) => setSort(v as SortType)}
        />
      </div>

      <div class="view-toggle">
        <button
          class="view-btn"
          class:active={viewMode === 'list'}
          onclick={() => updateSetting('downloadsViewMode', 'list')}
          use:tooltip={$t('downloads.views.list')}
        >
          <Icon name="checklist" size={18} />
        </button>
        <button
          class="view-btn"
          class:active={viewMode === 'grid'}
          onclick={() => updateSetting('downloadsViewMode', 'grid')}
          use:tooltip={$t('downloads.views.grid')}
        >
          <Icon name="gallery" size={18} />
        </button>
      </div>

      {#if $settings.showHistoryStats && $historyStats.totalDownloads > 0}
        <button
          class="stats-toggle-btn"
          class:active={showStatsPanel}
          onclick={() => (showStatsPanel = !showStatsPanel)}
          use:tooltip={$t('downloads.stats.toggle')}
        >
          <Icon name="stats" size={18} />
        </button>
      {/if}
    </div>
  </div>

  <!-- Collapsible Statistics Panel -->
  {#if $settings.showHistoryStats && showStatsPanel && $historyStats.totalDownloads > 0}
    <div class="stats-panel">
      <div class="stats-grid">
        <div class="stat-card">
          <Icon name="download" size={20} />
          <div class="stat-content">
            <span class="stat-value">{$historyStats.totalDownloads}</span>
            <span class="stat-label">{$t('downloads.stats.totalDownloads')}</span>
          </div>
        </div>
        <div class="stat-card">
          <Icon name="file_text" size={20} />
          <div class="stat-content">
            <span class="stat-value">{formatFileSize($historyStats.totalSize)}</span>
            <span class="stat-label">{$t('downloads.stats.totalSize')}</span>
          </div>
        </div>
        <div class="stat-card">
          <Icon name="clock" size={20} />
          <div class="stat-content">
            <span class="stat-value">{formatDuration($historyStats.totalDuration)}</span>
            <span class="stat-label">{$t('downloads.stats.totalDuration')}</span>
          </div>
        </div>
      </div>

      <div class="stats-breakdown">
        <div class="breakdown-section">
          <span class="breakdown-title">{$t('downloads.stats.byType')}</span>
          <div class="breakdown-items">
            {#if typeCounts.video > 0}
              <span class="breakdown-item"
                ><Icon name="video" size={14} />
                {typeCounts.video}
                {$t('downloads.filters.video')}</span
              >
            {/if}
            {#if typeCounts.audio > 0}
              <span class="breakdown-item"
                ><Icon name="music" size={14} />
                {typeCounts.audio}
                {$t('downloads.filters.audio')}</span
              >
            {/if}
            {#if typeCounts.image > 0}
              <span class="breakdown-item"
                ><Icon name="image" size={14} />
                {typeCounts.image}
                {$t('downloads.filters.image')}</span
              >
            {/if}
            {#if typeCounts.file > 0}
              <span class="breakdown-item"
                ><Icon name="file_text" size={14} />
                {typeCounts.file}
                {$t('downloads.filters.file')}</span
              >
            {/if}
          </div>
        </div>

        {#if topFormats.length > 0}
          <div class="breakdown-section">
            <span class="breakdown-title">{$t('downloads.stats.topFormats')}</span>
            <div class="breakdown-items format-items">
              {#each topFormats as [format, count]}
                <span class="format-badge"
                  >{format.toUpperCase()} <span class="format-count">{count}</span></span
                >
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div
    class="scroll-container"
    bind:this={containerEl}
    bind:clientHeight={containerHeight}
    bind:clientWidth={containerWidth}
    onscroll={handleScroll}
    style={maskStyle}
  >
    {#if activeDownloads.length > 0}
      {@const grouped = filteredGroupedDownloads()}
      <div class="section-header">
        <Icon name="queue" size={18} />
        <span>{$t('downloads.active')}</span>
        <span class="count-badge">{activeDownloads.length}</span>

        <div class="queue-controls">
          <button
            class="queue-btn"
            class:paused={$isQueuePaused}
            onclick={() => queue.togglePause()}
            use:tooltip={$isQueuePaused
              ? $t('downloads.queue.resume')
              : $t('downloads.queue.pause')}
          >
            <Icon name={$isQueuePaused ? 'play' : 'pause'} size={14} />
          </button>
          <button
            class="queue-btn clear"
            onclick={() => queue.clearFinished()}
            use:tooltip={$t('downloads.queue.clearFinished')}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>

      {#if $isQueuePaused}
        <div class="queue-paused-banner">
          <Icon name="pause" size={16} />
          <span>{$t('downloads.queue.pausedMessage')}</span>
          <button onclick={() => queue.resume()}>{$t('downloads.queue.resumeBtn')}</button>
        </div>
      {/if}

      <div class="active-downloads">
        <!-- Playlist Groups -->
        {#each grouped.groups as group (group.playlistId)}
          {@const isExpanded = !collapsedPlaylists.has(group.playlistId)}
          {@const completedCount = group.items.filter((i) => i.status === 'completed').length}
          {@const failedCount = group.items.filter((i) => i.status === 'failed').length}
          {@const activeCount = group.items.length - completedCount - failedCount}

          <div class="playlist-group" class:collapsed={!isExpanded}>
            <!-- Playlist Header Row -->
            <div class="playlist-header-row">
              <button
                class="playlist-header"
                onclick={() => togglePlaylistExpanded(group.playlistId)}
              >
                <span class="expand-icon" class:expanded={isExpanded}>
                  <Icon name="chevron_down" size={16} />
                </span>
                <Icon name="playlist" size={18} />
                <span class="playlist-title">{group.playlistTitle}</span>
                <span class="playlist-progress">
                  {completedCount}/{group.items.length}
                  {#if failedCount > 0}
                    <span class="failed-count">({failedCount} failed)</span>
                  {/if}
                </span>
              </button>

              <!-- Playlist Controls (separate from header button) -->
              <div class="playlist-controls">
                <button
                  class="playlist-ctrl-btn"
                  onclick={() => queue.pausePlaylist(group.playlistId)}
                  use:tooltip={$t('downloads.queue.pauseAll')}
                >
                  <Icon name="pause" size={12} />
                </button>
                <button
                  class="playlist-ctrl-btn play"
                  onclick={() => queue.resumePlaylist(group.playlistId)}
                  use:tooltip={$t('downloads.queue.resumeAll')}
                >
                  <Icon name="play" size={12} />
                </button>
                <button
                  class="playlist-ctrl-btn cancel"
                  onclick={() => queue.cancelPlaylist(group.playlistId)}
                  use:tooltip={$t('downloads.queue.cancelAll')}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            </div>

            <!-- Playlist Items (collapsible) -->
            {#if isExpanded}
              <div class="playlist-items">
                {#each group.items as download (download.id)}
                  {@const displayProgress = Math.max(0, Math.round(download.progress))}
                  {@const isPending = download.status === 'pending' || download.status === 'paused'}
                  <div
                    class="active-item playlist-item"
                    class:paused={download.status === 'paused'}
                    style="--progress: {displayProgress}%; {getItemColorStyle(download.thumbnail)}"
                  >
                    <div class="progress-bg"></div>
                    <div class="active-content">
                      {#if download.playlistIndex}
                        <span class="playlist-index">#{download.playlistIndex}</span>
                      {/if}
                      <div class="active-thumb">
                        {#if download.thumbnail && !failedThumbnails.has(download.id)}
                          {@const thumbSrc = getThumbnailSrc(download.thumbnail)}
                          <img
                            src={thumbSrc}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onload={() => extractItemColor(download.id, thumbSrc)}
                            onerror={() => {
                              failedThumbnails = new Set([...failedThumbnails, download.id]);
                            }}
                          />
                        {:else}
                          <div class="thumb-placeholder">
                            <Icon name={getTypeIcon(download.type)} size={20} />
                          </div>
                        {/if}
                        {#if download.status === 'downloading' || download.status === 'processing' || download.status === 'fetching-info'}
                          <div class="spinner-overlay">
                            <div class="spinner"></div>
                          </div>
                        {/if}
                        {#if download.status === 'paused'}
                          <div class="paused-overlay">
                            <Icon name="pause" size={14} />
                          </div>
                        {/if}
                      </div>
                      <div class="active-info">
                        <span class="active-title">{download.title}</span>
                        <span class="active-meta">
                          {#if download.status === 'paused'}
                            <span class="status-paused">{$t('downloads.queue.paused')}</span>
                          {:else if download.status === 'pending'}
                            <span class="status-pending">{$t('downloads.queue.waiting')}</span>
                          {:else}
                            <span class="status-message"
                              >{download.statusMessage || $t('downloads.status.downloading')}</span
                            >
                            {#if download.speed && download.status === 'downloading' && !['na', 'unknown', 'n/a', '~'].includes(download.speed.toLowerCase())}
                              <span class="status-speed">• {download.speed}</span>
                            {/if}
                            {#if download.eta && download.status === 'downloading' && !['na', 'unknown', 'n/a', '~'].includes(download.eta.toLowerCase())}
                              <span>• {download.eta}</span>
                            {/if}
                          {/if}
                        </span>
                      </div>
                      <span class="active-progress">{displayProgress}%</span>
                      <div class="item-controls">
                        {#if isPending}
                          <button
                            class="item-ctrl-btn"
                            onclick={() => queue.moveToTop(download.id)}
                            use:tooltip={$t('downloads.queue.moveToTop')}
                          >
                            <Icon name="chevron_up" size={14} />
                          </button>
                          {#if download.status === 'paused'}
                            <button
                              class="item-ctrl-btn play"
                              onclick={() => queue.resumeItem(download.id)}
                              use:tooltip={$t('downloads.queue.resumeItem')}
                            >
                              <Icon name="play" size={14} />
                            </button>
                          {:else}
                            <button
                              class="item-ctrl-btn"
                              onclick={() => queue.pauseItem(download.id)}
                              use:tooltip={$t('downloads.queue.pauseItem')}
                            >
                              <Icon name="pause" size={14} />
                            </button>
                          {/if}
                        {/if}
                      </div>
                      <button
                        class="cancel-btn"
                        onclick={(e) => {
                          e.stopPropagation();
                          queue.cancel(download.id);
                        }}
                        use:tooltip={$t('common.cancel')}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}

        <!-- Single Downloads (no playlist) -->
        {#each grouped.singles as download (download.id)}
          {@const displayProgress = Math.max(0, Math.round(download.progress))}
          {@const isPending = download.status === 'pending' || download.status === 'paused'}
          <div
            class="active-item"
            class:paused={download.status === 'paused'}
            style="--progress: {displayProgress}%; {getItemColorStyle(download.thumbnail)}"
          >
            <!-- Progress gradient background -->
            <div class="progress-bg"></div>

            <!-- Content -->
            <div class="active-content">
              <!-- Priority badge for pending items -->
              {#if isPending && download.priority > 0}
                <span class="priority-badge">#{download.priority}</span>
              {/if}

              <!-- Thumbnail or spinner -->
              <div class="active-thumb">
                {#if download.thumbnail && !failedThumbnails.has(download.id)}
                  {@const thumbSrc = getThumbnailSrc(download.thumbnail)}
                  <img
                    src={thumbSrc}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onload={() => extractItemColor(download.id, thumbSrc)}
                    onerror={() => {
                      failedThumbnails = new Set([...failedThumbnails, download.id]);
                    }}
                  />
                {:else}
                  <div class="thumb-placeholder">
                    <Icon name={getTypeIcon(download.type)} size={20} />
                  </div>
                {/if}
                <!-- Spinner overlay (only for active downloads) -->
                {#if download.status === 'downloading' || download.status === 'processing' || download.status === 'fetching-info'}
                  <div class="spinner-overlay">
                    <div class="spinner"></div>
                  </div>
                {/if}

                <!-- Paused indicator -->
                {#if download.status === 'paused'}
                  <div class="paused-overlay">
                    <Icon name="pause" size={14} />
                  </div>
                {/if}
              </div>

              <!-- Info -->
              <div class="active-info">
                <span class="active-title">{download.title}</span>
                <span class="active-meta">
                  {#if download.status === 'paused'}
                    <span class="status-paused">{$t('downloads.queue.paused')}</span>
                  {:else if download.status === 'pending'}
                    <span class="status-pending">{$t('downloads.queue.waiting')}</span>
                  {:else}
                    <!-- Show current stage/status message -->
                    <span class="status-message"
                      >{download.statusMessage || $t('downloads.status.downloading')}</span
                    >
                    {#if download.speed && download.status === 'downloading' && !['na', 'unknown', 'n/a', '~'].includes(download.speed.toLowerCase())}
                      <span class="status-speed">• {download.speed}</span>
                    {/if}
                    {#if download.eta && download.status === 'downloading' && !['na', 'unknown', 'n/a', '~'].includes(download.eta.toLowerCase())}
                      <span>• {download.eta}</span>
                    {/if}
                  {/if}
                </span>
              </div>

              <!-- Progress -->
              <span class="active-progress">{displayProgress}%</span>

              <!-- Item controls -->
              <div class="item-controls">
                {#if isPending}
                  <!-- Priority controls for pending items -->
                  <button
                    class="item-ctrl-btn"
                    onclick={() => queue.moveToTop(download.id)}
                    use:tooltip={$t('downloads.queue.moveToTop')}
                  >
                    <Icon name="chevron_up" size={14} />
                  </button>
                  {#if download.status === 'paused'}
                    <button
                      class="item-ctrl-btn play"
                      onclick={() => queue.resumeItem(download.id)}
                      use:tooltip={$t('downloads.queue.resumeItem')}
                    >
                      <Icon name="play" size={14} />
                    </button>
                  {:else}
                    <button
                      class="item-ctrl-btn"
                      onclick={() => queue.pauseItem(download.id)}
                      use:tooltip={$t('downloads.queue.pauseItem')}
                    >
                      <Icon name="pause" size={14} />
                    </button>
                  {/if}
                {/if}
              </div>

              <!-- Cancel button -->
              <button
                class="cancel-btn"
                onclick={(e) => {
                  e.stopPropagation();
                  queue.cancel(download.id);
                }}
                use:tooltip={$t('common.cancel')}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>
        {/each}
      </div>

      <Divider my={12} />
    {/if}

    <!-- History List -->
    {#if viewMode === 'list'}
      <div class="history-list">
        {#if flatRows.length === 0}
          <div class="empty-state">
            <Icon name="download" size={48} />
            <p>{$t('downloads.empty')}</p>
            <p class="empty-hint">{$t('downloads.startHint')}</p>
          </div>
        {:else}
          <div class="virtual-spacer" style="height: {totalHeight}px;">
            <div class="virtual-content" style="transform: translateY({offsetTop}px);">
              {#each visibleRows as row (row.kind === 'date' ? `date-${row.label}` : row.kind === 'playlist' ? `pl-${row.dateLabel}-${row.group.playlistId}` : row.kind === 'playlist-child' ? `plc-${row.dateLabel}-${row.item.id}` : `s-${row.dateLabel}-${row.item.id}`)}
                {#if row.kind === 'date'}
                  <div class="date-header" style="height: {DATE_HEADER_HEIGHT}px;">
                    <span class="date-label">{row.label}</span>
                  </div>
                {:else if row.kind === 'playlist'}
                  {@const playlistGroup = row.group}
                  {@const isExpanded = !collapsedHistoryPlaylists.has(playlistGroup.playlistId)}
                  {@const gridThumbs = getPlaylistGridThumbs(
                    playlistGroup.playlistId,
                    playlistGroup.items
                  )}
                  <div
                    class="playlist-header-row"
                    class:expanded={isExpanded}
                    style="height: {PLAYLIST_HEADER_HEIGHT}px;"
                    role="button"
                    tabindex="0"
                    aria-expanded={isExpanded}
                    aria-label="{playlistGroup.playlistTitle} - {playlistGroup.items.length} items"
                    onclick={() => toggleHistoryPlaylistExpanded(playlistGroup.playlistId)}
                    onkeydown={(e) => handlePlaylistKeydown(e, playlistGroup.playlistId, true)}
                  >
                    <div class="col-thumb">
                      <div class="playlist-thumb-grid" class:single={gridThumbs.length <= 1}>
                        {#if gridThumbs.length === 0}
                          <div class="grid-placeholder"><Icon name="playlist" size={16} /></div>
                        {:else if gridThumbs.length === 1}
                          <img src={gridThumbs[0]} alt="" />
                        {:else}
                          {#each gridThumbs as thumb}
                            <img src={thumb} alt="" />
                          {/each}
                          {#if gridThumbs.length < 4}
                            {#each Array(4 - gridThumbs.length) as _}
                              <div class="grid-empty"></div>
                            {/each}
                          {/if}
                        {/if}
                      </div>
                    </div>
                    <div class="col-metadata">
                      <span class="item-title">
                        <span class="expand-icon" class:expanded={isExpanded}>
                          <Icon name="chevron_down" size={14} />
                        </span>
                        {playlistGroup.playlistTitle}
                      </span>
                      <span class="item-author">{playlistGroup.items.length} items</span>
                    </div>
                    <div class="col-actions"></div>
                    <div class="col-ext"></div>
                    <div class="col-size">{formatFileSize(playlistGroup.totalSize)}</div>
                    <div class="col-length">{formatDuration(playlistGroup.totalDuration)}</div>
                    <button
                      class="open-file-btn"
                      onclick={(e) => {
                        e.stopPropagation();
                        handleOpenFile(e, playlistGroup.items[0]?.filePath);
                      }}
                      use:tooltip={$t('downloads.openFolder')}
                    >
                      <Icon name="folder" size={16} />
                    </button>
                  </div>
                {:else if row.kind === 'playlist-child'}
                  {@const subItem = row.item}
                  {@const fileMissing = isFileMissing(subItem.id)}
                  {@const isLastChild = row.isLast}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="history-item playlist-child"
                    class:last-child={isLastChild}
                    style="height: {ITEM_HEIGHT}px; {getItemColorStyle(subItem.thumbnail)}"
                    class:file-missing={fileMissing}
                    onmouseenter={() => (hoveredItemId = subItem.id)}
                    onmouseleave={() => (hoveredItemId = null)}
                  >
                    <div class="col-thumb">
                      {#if subItem.thumbnail && !failedThumbnails.has(subItem.id)}
                        {@const thumbSrc = getThumbnailSrc(subItem.thumbnail)}
                        <img
                          src={thumbSrc}
                          alt=""
                          class="thumbnail"
                          loading="lazy"
                          decoding="async"
                          onload={() => {
                            extractItemColor(subItem.id, thumbSrc);
                            checkFileExists(subItem.id, subItem.filePath);
                          }}
                          onerror={() => {
                            failedThumbnails = new Set([...failedThumbnails, subItem.id]);
                          }}
                        />
                      {:else}
                        <div class="thumbnail-placeholder">
                          <Icon name={getTypeIcon(subItem.type)} size={20} />
                        </div>
                      {/if}
                      {#if fileMissing}
                        <div
                          class="thumb-missing-indicator"
                          use:tooltip={$t('downloads.fileMissing')}
                        >
                          <Icon name="trash" size={12} />
                        </div>
                      {:else if hoveredItemId === subItem.id}
                        <button
                          class="thumb-play-overlay"
                          onclick={(e) => handlePlayFile(e, subItem.filePath)}
                          use:tooltip={$t('downloads.play')}
                        >
                          <Icon name="play" size={16} />
                        </button>
                      {/if}
                    </div>
                    <div class="col-metadata">
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="item-title clickable"
                        onclick={(e) => handleOpenVideoView(e, subItem)}
                        title={$t('downloads.openInApp')}>{subItem.title}</span
                      >
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="item-author clickable"
                        onclick={(e) => handleOpenChannelView(e, subItem)}
                        title={$t('downloads.openAuthor')}>{subItem.author}</span
                      >
                    </div>
                    <div class="col-actions">
                      {#if hoveredItemId === subItem.id}
                        <div class="action-buttons">
                          <button
                            class="action-btn"
                            use:tooltip={$t('downloads.redownload')}
                            onclick={(e) => handleRedownload(e, subItem.url)}
                          >
                            <Icon name="download" size={16} />
                          </button>
                        </div>
                        <div class="action-buttons secondary">
                          <button
                            class="action-btn"
                            use:tooltip={$t('downloads.openLink')}
                            onclick={(e) => handleOpenLink(e, subItem.url)}
                          >
                            <Icon name="link" size={16} />
                          </button>
                          <button
                            class="action-btn delete"
                            use:tooltip={$t('downloads.delete')}
                            onclick={(e) => handleDelete(e, subItem.id)}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      {/if}
                    </div>
                    <div class="col-ext">
                      <span class="ext-badge">{subItem.extension.toUpperCase()}</span>
                    </div>
                    <div class="col-size">{formatFileSize(subItem.size)}</div>
                    <div class="col-length">{formatDuration(subItem.duration)}</div>
                    <button
                      class="open-file-btn"
                      use:tooltip={$t('downloads.openFolder')}
                      onclick={(e) => handleOpenFile(e, subItem.filePath)}
                    >
                      <Icon name="folder" size={16} />
                    </button>
                  </div>
                {:else}
                  {@const singleItem = row.item}
                  {@const fileMissing = isFileMissing(singleItem.id)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="history-item"
                    style="height: {ITEM_HEIGHT}px; {getItemColorStyle(singleItem.thumbnail)}"
                    class:file-missing={fileMissing}
                    onmouseenter={() => (hoveredItemId = singleItem.id)}
                    onmouseleave={() => (hoveredItemId = null)}
                  >
                    <div class="col-thumb">
                      {#if singleItem.thumbnail && !failedThumbnails.has(singleItem.id)}
                        {@const thumbSrc = getThumbnailSrc(singleItem.thumbnail)}
                        <img
                          src={thumbSrc}
                          alt=""
                          class="thumbnail"
                          loading="lazy"
                          decoding="async"
                          onload={() => {
                            extractItemColor(singleItem.id, thumbSrc);
                            checkFileExists(singleItem.id, singleItem.filePath);
                          }}
                          onerror={() => {
                            failedThumbnails = new Set([...failedThumbnails, singleItem.id]);
                          }}
                        />
                      {:else}
                        <div class="thumbnail-placeholder">
                          <Icon name={getTypeIcon(singleItem.type)} size={20} />
                        </div>
                      {/if}
                      {#if fileMissing}
                        <div
                          class="thumb-missing-indicator"
                          use:tooltip={$t('downloads.fileMissing')}
                        >
                          <Icon name="trash" size={12} />
                        </div>
                      {:else if hoveredItemId === singleItem.id}
                        <button
                          class="thumb-play-overlay"
                          onclick={(e) => handlePlayFile(e, singleItem.filePath)}
                          use:tooltip={$t('downloads.play')}
                        >
                          <Icon name="play" size={16} />
                        </button>
                      {/if}
                    </div>
                    <div class="col-metadata">
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="item-title clickable"
                        onclick={(e) => handleOpenVideoView(e, singleItem)}
                        title={$t('downloads.openInApp')}>{singleItem.title}</span
                      >
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="item-author clickable"
                        onclick={(e) => handleOpenChannelView(e, singleItem)}
                        title={$t('downloads.openAuthor')}>{singleItem.author}</span
                      >
                    </div>
                    <div class="col-actions">
                      {#if hoveredItemId === singleItem.id}
                        <div class="action-buttons">
                          <button
                            class="action-btn"
                            use:tooltip={$t('downloads.redownload')}
                            onclick={(e) => handleRedownload(e, singleItem.url)}
                          >
                            <Icon name="download" size={16} />
                          </button>
                          <button
                            class="action-btn expand"
                            use:tooltip={$t('downloads.moreOptions')}
                          >
                            <Icon name="chevron_down" size={16} />
                          </button>
                        </div>
                        <div class="action-buttons secondary">
                          <button
                            class="action-btn"
                            use:tooltip={$t('downloads.openLink')}
                            onclick={(e) => handleOpenLink(e, singleItem.url)}
                          >
                            <Icon name="link" size={16} />
                          </button>
                          <button
                            class="action-btn delete"
                            use:tooltip={$t('downloads.delete')}
                            onclick={(e) => handleDelete(e, singleItem.id)}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      {/if}
                    </div>
                    <div class="col-ext">
                      <span class="ext-badge">{singleItem.extension.toUpperCase()}</span>
                    </div>
                    <div class="col-size">{formatFileSize(singleItem.size)}</div>
                    <div class="col-length">{formatDuration(singleItem.duration)}</div>
                    <button
                      class="open-file-btn"
                      use:tooltip={$t('downloads.openFolder')}
                      onclick={(e) => handleOpenFile(e, singleItem.filePath)}
                    >
                      <Icon name="folder" size={16} />
                    </button>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
          <p class="end-message">{$t('downloads.endMessage')}</p>
        {/if}
      </div>
    {:else}
      <div class="history-list grid-view" class:virtualized={flatGridItems.length > 30}>
        {#if flatGridItems.length === 0}
          <div class="empty-state">
            <Icon name="download" size={48} />
            <p>{$t('downloads.empty')}</p>
            <p class="empty-hint">{$t('downloads.startHint')}</p>
          </div>
        {:else}
          <div class="virtual-spacer-grid" style="height: {gridTotalHeight}; position: relative;">
            <div class="virtual-content-grid" style="transform: translateY({gridOffsetTop}px);">
              {#each visibleGridItems as item (item.id)}
                {@const fileMissing = isFileMissing(item.id)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="grid-card"
                  class:file-missing={fileMissing}
                  style={getItemColorStyle(item.thumbnail)}
                  onmouseenter={() => (hoveredItemId = item.id)}
                  onmouseleave={() => (hoveredItemId = null)}
                >
                  <div class="card-thumbnail">
                    {#if item.thumbnail && !failedThumbnails.has(item.id)}
                      {@const thumbSrc = getThumbnailSrc(item.thumbnail)}
                      <img
                        src={thumbSrc}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        fetchpriority="low"
                        onload={() => {
                          extractItemColor(item.id, thumbSrc);
                          checkFileExists(item.id, item.filePath);
                        }}
                        onerror={() => {
                          failedThumbnails = new Set([...failedThumbnails, item.id]);
                        }}
                      />
                    {:else}
                      <div class="card-thumb-placeholder">
                        <Icon name={getTypeIcon(item.type)} size={32} />
                      </div>
                    {/if}
                    {#if item.duration > 0}
                      <span class="duration-badge">{formatDuration(item.duration)}</span>
                    {/if}
                    <span class="type-badge">{item.extension.toUpperCase()}</span>
                    {#if fileMissing}
                      <div class="missing-file-overlay" use:tooltip={$t('downloads.fileMissing')}>
                        <Icon name="trash" size={24} />
                      </div>
                    {/if}
                    {#if hoveredItemId === item.id && !fileMissing}
                      <div class="card-overlay">
                        <button
                          class="play-overlay"
                          onclick={(e) => handlePlayFile(e, item.filePath)}
                          use:tooltip={$t('downloads.play')}
                        >
                          <Icon name="play" size={24} />
                        </button>
                        <div class="card-actions-bar">
                          <button
                            class="card-action-btn"
                            use:tooltip={$t('downloads.openFolder')}
                            onclick={(e) => handleOpenFile(e, item.filePath)}
                          >
                            <Icon name="folder" size={14} />
                          </button>
                          <button
                            class="card-action-btn"
                            use:tooltip={$t('downloads.redownload')}
                            onclick={(e) => handleRedownload(e, item.url)}
                          >
                            <Icon name="download" size={14} />
                          </button>
                          <button
                            class="card-action-btn"
                            use:tooltip={$t('downloads.openLink')}
                            onclick={(e) => handleOpenLink(e, item.url)}
                          >
                            <Icon name="link" size={14} />
                          </button>
                          <button
                            class="card-action-btn delete"
                            use:tooltip={$t('downloads.delete')}
                            onclick={(e) => handleDelete(e, item.id)}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </div>
                    {:else if hoveredItemId === item.id && fileMissing}
                      <div class="card-overlay missing">
                        <div class="card-actions-bar">
                          <button
                            class="card-action-btn"
                            use:tooltip={$t('downloads.redownload')}
                            onclick={(e) => handleRedownload(e, item.url)}
                          >
                            <Icon name="download" size={14} />
                          </button>
                          <button
                            class="card-action-btn"
                            use:tooltip={$t('downloads.openLink')}
                            onclick={(e) => handleOpenLink(e, item.url)}
                          >
                            <Icon name="link" size={14} />
                          </button>
                          <button
                            class="card-action-btn delete"
                            use:tooltip={$t('downloads.delete')}
                            onclick={(e) => handleDelete(e, item.id)}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </div>
                    {/if}
                  </div>
                  <div class="card-info">
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <span
                      class="card-title clickable"
                      onclick={(e) => handleOpenVideoView(e, item)}
                      title={$t('downloads.openInApp')}
                    >
                      {item.title}
                    </span>
                    <div class="card-meta">
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="card-author clickable"
                        onclick={(e) => handleOpenChannelView(e, item)}
                        title={$t('downloads.openAuthor')}
                      >
                        {item.author}
                      </span>
                      <span class="card-size">{formatFileSize(item.size)}</span>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
          <p class="end-message">{$t('downloads.endMessage')}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .page {
    padding: 0 8px 0 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .scroll-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    margin-right: 4px;
    margin-bottom: 4px;
    padding-right: 6px;
  }

  :global(.app.mobile) .scroll-container {
    padding-bottom: 120px; /* Space for floating nav bar */
  }

  /* Active Downloads Section */
  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 12px;
  }

  .count-badge {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.4));
    color: white;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .queue-controls {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }

  .queue-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.15s;
  }

  .queue-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: white;
  }

  .queue-btn.paused {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.3));
    color: var(--accent, rgba(99, 102, 241, 1));
  }

  .queue-btn.clear:hover {
    background: rgba(239, 68, 68, 0.2);
    color: rgb(239, 68, 68);
  }

  .queue-paused-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: 8px;
    margin-bottom: 12px;
    font-size: 13px;
    color: rgba(251, 191, 36, 0.9);
  }

  .queue-paused-banner button {
    margin-left: auto;
    padding: 4px 12px;
    background: rgba(251, 191, 36, 0.2);
    border: 1px solid rgba(251, 191, 36, 0.4);
    border-radius: 6px;
    color: rgba(251, 191, 36, 1);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .queue-paused-banner button:hover {
    background: rgba(251, 191, 36, 0.3);
  }

  .active-downloads {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .active-item {
    position: relative;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    overflow: hidden;
  }

  .active-item.paused {
    opacity: 0.7;
  }

  .priority-badge {
    position: absolute;
    top: 4px;
    left: 4px;
    background: var(--accent, rgba(99, 102, 241, 0.8));
    color: white;
    font-size: 9px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 4px;
    z-index: 2;
  }

  /* Progress gradient background */
  .progress-bg {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      var(--item-color-alpha, var(--accent-alpha, rgba(99, 102, 241, 0.25))) 0%,
      var(--item-color-alpha-light, var(--accent-alpha-light, rgba(99, 102, 241, 0.15)))
        calc(var(--progress) - 5%),
      var(--item-color-alpha-lighter, var(--accent-alpha-lighter, rgba(99, 102, 241, 0.08)))
        var(--progress),
      transparent calc(var(--progress) + 2%)
    );
    pointer-events: none;
    transition: all 0.3s ease;
  }

  .active-content {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    z-index: 1;
  }

  .active-thumb {
    position: relative;
    width: 48px;
    height: 36px;
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.08);
  }

  .active-thumb img {
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
    color: rgba(255, 255, 255, 0.4);
  }

  /* Spinner overlay on thumbnail */
  .spinner-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
  }

  .paused-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    color: rgba(251, 191, 36, 0.9);
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: var(--accent, rgba(99, 102, 241, 1));
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .active-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .active-title {
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .active-meta {
    display: flex;
    gap: 8px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .status-paused {
    color: rgba(251, 191, 36, 0.9);
  }

  .status-pending {
    color: rgba(255, 255, 255, 0.4);
  }

  .status-message {
    color: rgba(255, 255, 255, 0.7);
  }

  .status-speed {
    color: rgba(255, 255, 255, 0.5);
  }

  .active-progress {
    font-size: 14px;
    font-weight: 600;
    color: var(--item-color, var(--accent, rgba(99, 102, 241, 1)));
    min-width: 45px;
    text-align: right;
  }

  .item-controls {
    display: flex;
    gap: 4px;
    margin-left: 8px;
  }

  .item-ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s;
  }

  .item-ctrl-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: white;
  }

  .item-ctrl-btn.play {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.3));
    color: var(--accent, rgba(99, 102, 241, 1));
  }

  .item-ctrl-btn.play:hover {
    background: var(--accent-alpha-hover, rgba(99, 102, 241, 0.5));
  }

  .cancel-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: rgba(239, 68, 68, 0.15);
    border-radius: 6px;
    cursor: pointer;
    color: rgba(239, 68, 68, 0.8);
    transition: all 0.15s ease;
    margin-left: 8px;
  }

  .cancel-btn:hover {
    background: rgba(239, 68, 68, 0.3);
    color: rgba(239, 68, 68, 1);
  }

  /* Playlist Group Styles */
  .playlist-group {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    overflow: hidden;
  }

  .playlist-group.collapsed {
    background: rgba(255, 255, 255, 0.03);
  }

  /* Queue playlist header - flexbox layout */
  .active-downloads .playlist-header-row {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.04);
    width: 100%;
    color: white;
  }

  .active-downloads .playlist-header-row:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .playlist-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 0;
    text-align: left;
    font-size: 13px;
  }

  .playlist-header .playlist-title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .playlist-header .playlist-progress {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-left: auto;
    padding-right: 12px;
  }

  .playlist-header .playlist-progress .failed-count {
    color: rgb(239, 68, 68);
  }

  .playlist-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* History playlist header - same as history-item */
  .history-list .playlist-header-row {
    display: grid;
    grid-template-columns: 60px 1fr 120px 50px 70px 60px 32px;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border: none;
    width: 100%;
    cursor: pointer;
    color: white;
    text-align: left;
    border-radius: 8px;
    transition: background 0.15s;
  }

  .history-list .playlist-header-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  /* Keyboard focus state for accessibility */
  .history-list .playlist-header-row:focus {
    outline: 2px solid rgba(59, 130, 246, 0.6);
    outline-offset: 2px;
    background: rgba(255, 255, 255, 0.04);
  }

  .history-list .playlist-header-row:focus:not(:focus-visible) {
    outline: none;
  }

  /* When expanded, remove bottom radius and show background */
  .history-list .playlist-header-row.expanded {
    border-radius: 8px 8px 0 0;
    background: rgba(255, 255, 255, 0.04);
  }

  .playlist-header-row .item-title {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .playlist-thumb-grid {
    width: 48px;
    height: 36px;
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 1px;
    background: rgba(0, 0, 0, 0.3);
  }

  .playlist-thumb-grid.single {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .playlist-thumb-grid.single img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .playlist-thumb-grid img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 2px;
  }

  .playlist-thumb-grid .grid-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.5);
    grid-column: 1 / -1;
    grid-row: 1 / -1;
  }

  .playlist-thumb-grid .grid-empty {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
  }

  .expand-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s;
    transform: rotate(-90deg);
  }

  .expand-icon.expanded {
    transform: rotate(0deg);
  }

  .playlist-ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s;
  }

  .playlist-ctrl-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: white;
  }

  .playlist-ctrl-btn.play {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.2));
    color: var(--accent, rgba(99, 102, 241, 1));
  }

  .playlist-ctrl-btn.play:hover {
    background: var(--accent-alpha-hover, rgba(99, 102, 241, 0.4));
  }

  .playlist-ctrl-btn.cancel:hover {
    background: rgba(239, 68, 68, 0.2);
    color: rgb(239, 68, 68);
  }

  .playlist-items {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .playlist-item {
    border-radius: 0;
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .playlist-item:last-child {
    border-bottom: none;
  }

  /* Playlist child items in history view - same layout, subtle background to show grouping */
  .history-item.playlist-child {
    border-radius: 0;
    background: rgba(255, 255, 255, 0.02);
  }

  .history-item.playlist-child:hover {
    background: var(--item-color-hover, rgba(255, 255, 255, 0.06));
  }

  /* Last child gets bottom rounded corners */
  .history-item.playlist-child.last-child {
    border-radius: 0 0 8px 8px;
  }

  .playlist-index {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.4);
    min-width: 28px;
    text-align: center;
  }

  /* Search Bar */
  .search-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    margin-bottom: 16px;
  }

  .search-bar :global(svg) {
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .search-bar input {
    flex: 1;
    background: transparent;
    border: none;
    color: white;
    font-size: 14px;
    outline: none;
  }

  .search-bar input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    gap: 16px;
  }

  /* Filters */
  .filters {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* Controls Right (Sort + View) */
  .controls-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* Sort Control */
  .sort-control {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sort-label {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  .sort-control :global(.select-trigger) {
    padding: 6px 10px;
    font-size: 13px;
    min-width: 100px;
  }

  /* View Toggle */
  .view-toggle {
    display: flex;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 4px;
    gap: 2px;
  }

  .view-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    transition: all 0.15s;
  }

  .view-btn:hover {
    color: rgba(255, 255, 255, 0.7);
    background: rgba(255, 255, 255, 0.06);
  }

  .view-btn.active {
    background: rgba(255, 255, 255, 0.12);
    color: white;
  }

  /* History List */
  .history-list {
    padding-bottom: 16px;
  }

  .virtual-spacer {
    position: relative;
    width: 100%;
  }

  .virtual-content {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }

  .date-header {
    display: flex;
    align-items: center;
    padding: 12px 12px 8px;
  }

  .date-label {
    display: block;
    font-size: 12px;
    font-weight: 325;
    color: rgba(255, 255, 255, 0.6);
    padding: 12px 0 8px;
  }

  .history-item {
    display: grid;
    grid-template-columns: 60px 1fr 120px 50px 70px 60px 32px;
    gap: 12px;
    align-items: center;
    padding: 0 12px;
    border-radius: 8px;
    transition: background 0.15s;
  }

  .history-item:hover {
    background: var(--item-color-hover, rgba(255, 255, 255, 0.04));
  }

  /* Thumbnail */
  .col-thumb {
    position: relative;
    width: 48px;
    height: 36px;
  }

  .thumbnail {
    width: 48px;
    height: 36px;
    object-fit: cover;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
  }

  .thumbnail-placeholder {
    width: 48px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.4);
  }

  .thumb-play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    border: none;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    animation: fadeIn 0.15s ease;
  }

  .thumb-play-overlay:hover {
    background: rgba(0, 0, 0, 0.75);
  }

  /* Metadata */
  .col-metadata {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .item-title {
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.95);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-title.clickable {
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .item-title.clickable:hover {
    color: var(--item-color, var(--accent, #6366f1));
  }

  .item-author {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-author.clickable {
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .item-author.clickable:hover {
    color: var(--item-color, var(--accent, #6366f1));
  }

  /* Actions */
  .col-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  .action-buttons {
    display: flex;
    align-items: center;
    gap: 2px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 4px;
  }

  .action-buttons.secondary {
    background: rgba(255, 255, 255, 0.06);
  }

  .action-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .action-btn.delete:hover {
    background: rgba(239, 68, 68, 0.2);
    color: rgb(239, 68, 68);
  }

  .action-btn.expand {
    color: rgba(255, 255, 255, 0.4);
  }

  /* Extension Badge */
  .col-ext {
    text-align: center;
  }

  .ext-badge {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
  }

  /* Size & Length */
  .col-size,
  .col-length {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
    text-align: center;
  }

  /* Open File Button */
  .open-file-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s;
  }

  .open-file-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.25);
    color: rgba(255, 255, 255, 0.8);
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 80px 20px;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
  }

  /* In grid view, make empty state span the entire width */
  .history-list.grid-view .empty-state {
    grid-column: 1 / -1;
    min-height: 300px;
  }

  .empty-hint {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.3);
  }

  /* End Message */
  .end-message {
    text-align: center;
    padding: 24px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Grid virtualization styles */
  .history-list.grid-view:not(.virtualized) {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
  }

  .history-list.grid-view:not(.virtualized) .virtual-spacer-grid,
  .history-list.grid-view:not(.virtualized) .virtual-content-grid {
    display: contents;
  }

  .history-list.grid-view.virtualized {
    display: block;
    contain: layout style;
  }

  .virtual-spacer-grid {
    width: 100%;
    contain: strict;
  }

  .virtual-content-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
    contain: layout style;
    will-change: transform;
  }

  .grid-card {
    display: flex;
    flex-direction: column;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    overflow: hidden;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .grid-card:hover {
    background: var(--item-color-hover, rgba(255, 255, 255, 0.06));
    border-color: rgba(255, 255, 255, 0.1);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }

  .card-thumbnail {
    position: relative;
    aspect-ratio: 16 / 9;
    background: rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .card-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s ease;
  }

  .grid-card:hover .card-thumbnail img {
    transform: scale(1.05);
  }

  .card-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.05) 0%,
      rgba(255, 255, 255, 0.02) 100%
    );
    color: rgba(255, 255, 255, 0.25);
  }

  .duration-badge {
    position: absolute;
    bottom: 6px;
    right: 6px;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
    color: white;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 5px;
    border-radius: 4px;
    letter-spacing: 0.3px;
  }

  .type-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    background: var(--item-color, var(--accent, rgba(99, 102, 241, 0.9)));
    color: white;
    font-size: 9px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 4px;
    letter-spacing: 0.3px;
  }

  .play-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 42px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--item-color, var(--accent, rgba(99, 102, 241, 1)));
    border: none;
    border-radius: 50%;
    color: white;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 10;
  }

  .play-overlay:hover {
    transform: translate(-50%, -50%) scale(1.1);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  }

  .card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.1) 0%,
      rgba(0, 0, 0, 0.4) 50%,
      rgba(0, 0, 0, 0.85) 100%
    );
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    animation: fadeIn 0.15s ease;
  }

  .card-actions-bar {
    display: flex;
    gap: 3px;
    padding: 8px;
    width: 100%;
    justify-content: center;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .card-action-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(4px);
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .card-action-btn:hover {
    background: rgba(255, 255, 255, 0.25);
    transform: scale(1.05);
  }

  .card-action-btn.delete:hover {
    background: rgba(239, 68, 68, 0.85);
  }

  .card-info {
    padding: 10px 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .card-title {
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.95);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  .card-title.clickable {
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .card-title.clickable:hover {
    color: var(--item-color, var(--accent, #6366f1));
  }

  .card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .card-author {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.45);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .card-author.clickable {
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .card-author.clickable:hover {
    color: var(--item-color, var(--accent, #6366f1));
  }

  .card-size {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.35);
    flex-shrink: 0;
  }

  /* Missing file indicator - Grid View */
  .grid-card.file-missing {
    opacity: 0.75;
  }

  .grid-card.file-missing .card-thumbnail img {
    filter: grayscale(0.3) brightness(0.9);
  }

  .missing-file-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(239, 68, 68, 0.7);
    border-radius: 50%;
    color: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    z-index: 5;
  }

  .card-overlay.missing {
    justify-content: center;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.6) 100%);
  }

  /* Missing file indicator - List View */
  .history-item.file-missing {
    opacity: 0.65;
  }

  .history-item.file-missing .thumbnail {
    filter: grayscale(0.3) brightness(0.85);
  }

  .thumb-missing-indicator {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(239, 68, 68, 0.5);
    border-radius: 4px;
    color: white;
  }

  /* Mobile */
  @media (max-width: 700px) {
    .page {
      padding: 0 12px 0 12px;
    }

    /* Toolbar - stack into two rows */
    .toolbar {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }

    /* Filters row - full width, horizontal scroll */
    .filters {
      width: 100%;
      overflow-x: auto;
      flex-wrap: nowrap;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      -ms-overflow-style: none;
      padding-bottom: 2px;
    }

    .filters::-webkit-scrollbar {
      display: none;
    }

    /* Controls row - sort and view side by side */
    .controls-right {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      gap: 10px;
    }

    .sort-control {
      flex: 1;
    }

    .sort-control :global(.select-trigger) {
      width: 100%;
    }

    .history-item {
      grid-template-columns: 48px 1fr auto;
      gap: 10px;
    }

    .col-actions,
    .col-ext,
    .col-size,
    .col-length,
    .open-file-btn {
      display: none;
    }

    .history-item:hover .col-actions {
      display: flex;
      position: absolute;
      right: 12px;
    }

    /* History playlist header row on mobile */
    .history-list .playlist-header-row {
      grid-template-columns: 48px 1fr auto;
      gap: 10px;
    }

    .history-list .playlist-header-row .col-ext,
    .history-list .playlist-header-row .col-size,
    .history-list .playlist-header-row .col-length,
    .history-list .playlist-header-row .col-actions {
      display: none;
    }

    .history-list .playlist-header-row .open-file-btn {
      display: flex;
    }

    .playlist-thumb-grid {
      width: 40px;
      height: 30px;
    }
  }

  /* Stats Toggle Button */
  .stats-toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .stats-toggle-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.9);
  }

  .stats-toggle-btn.active {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.2));
    border-color: var(--accent, rgba(99, 102, 241, 0.5));
    color: var(--accent, #6366f1);
  }

  /* Stats Panel */
  .stats-panel {
    margin: 0 0 16px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    animation: slideDown 0.2s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }

  .stat-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 8px;
  }

  .stat-card :global(svg) {
    color: var(--accent, #6366f1);
    opacity: 0.8;
  }

  .stat-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat-content .stat-value {
    font-size: 16px;
  }

  .stat-content .stat-label {
    font-size: 10px;
  }

  .stats-breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .breakdown-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .breakdown-title {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .breakdown-items {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .breakdown-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
  }

  .breakdown-item :global(svg) {
    opacity: 0.6;
  }

  .format-items {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .format-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.8);
  }

  .format-count {
    color: var(--accent, #6366f1);
    font-weight: 700;
  }
</style>
