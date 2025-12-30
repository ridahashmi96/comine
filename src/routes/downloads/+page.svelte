<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { goto } from '$app/navigation';
  import { invoke } from '@tauri-apps/api/core';
  import { revealItemInDir, openUrl, openPath } from '@tauri-apps/plugin-opener';
  import { stat } from '@tauri-apps/plugin-fs';
  import { toast } from '$lib/components/Toast.svelte';
  import {
    history,
    playlistGroupedHistory,
    historyStats,
    formatDuration,
    isPlaylistGroup,
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
  import ScrollArea from '$lib/components/ScrollArea.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { extractDominantColor, generateColorVars, type RGB } from '$lib/utils/color';
  import { saveScrollPosition, getScrollPosition } from '$lib/stores/scroll';

  const ROUTE_PATH = '/downloads';

  let scrollAreaRef: ScrollArea | undefined = $state(undefined);

  beforeNavigate(() => {
    const pos = scrollAreaRef?.getScroll() ?? 0;
    saveScrollPosition(ROUTE_PATH, pos);
  });

  onMount(() => {
    const savedPosition = getScrollPosition(ROUTE_PATH);
    if (savedPosition > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollAreaRef?.restoreScroll(savedPosition);
        });
      });
    }
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

  let itemColors = $state<Map<string, RGB>>(new Map());

  async function extractItemColor(id: string, thumbnailUrl: string | undefined) {
    if (!$settings.thumbnailTheming || !thumbnailUrl || itemColors.has(id)) return;
    const color = await extractDominantColor(thumbnailUrl);
    if (color) {
      itemColors = new Map(itemColors).set(id, color);
    }
  }

  function getItemColorStyle(id: string): string {
    if (!$settings.thumbnailTheming) return '';
    const color = itemColors.get(id);
    if (!color) return '';
    return generateColorVars(color);
  }

  let collapsedPlaylists = $state<Set<string>>(new Set());

  let collapsedHistoryPlaylists = $state<Set<string>>(new Set());

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

    const items = history.getItems();
    const itemsToFix = items.filter(
      (item) =>
        item.duration === 0 && item.filePath && (item.type === 'video' || item.type === 'audio')
    );

    if (itemsToFix.length === 0) return;

    (async () => {
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
    </div>
  </div>

  <ScrollArea bind:this={scrollAreaRef}>
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
                    style="--progress: {displayProgress}%; {getItemColorStyle(download.id)}"
                  >
                    <div class="progress-bg"></div>
                    <div class="active-content">
                      {#if download.playlistIndex}
                        <span class="playlist-index">#{download.playlistIndex}</span>
                      {/if}
                      <div class="active-thumb">
                        {#if download.thumbnail}
                          <img
                            src={download.thumbnail}
                            alt=""
                            onload={() => extractItemColor(download.id, download.thumbnail)}
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
            style="--progress: {displayProgress}%; {getItemColorStyle(download.id)}"
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
                {#if download.thumbnail}
                  <img
                    src={download.thumbnail}
                    alt=""
                    onload={() => extractItemColor(download.id, download.thumbnail)}
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
    <div class="history-list" class:grid-view={viewMode === 'grid'}>
      {#if $playlistGroupedHistory.length === 0}
        <div class="empty-state">
          <Icon name="download" size={48} />
          <p>{$t('downloads.empty')}</p>
          <p class="empty-hint">{$t('downloads.startHint')}</p>
        </div>
      {:else}
        {#each $playlistGroupedHistory as group}
          <div class="date-group">
            <span class="date-label">{group.label}</span>

            {#if viewMode === 'grid'}
              <!-- Grid View - unified grid with all items inline -->
              <div class="grid-items">
                {#each group.items as item}
                  {#if isPlaylistGroup(item)}
                    <!-- Playlist items with playlist indicator -->
                    {@const playlistGroup = item as HistoryPlaylistGroup}
                    {#each playlistGroup.items as subItem, idx (subItem.id)}
                      {@const fileMissing = isFileMissing(subItem.id)}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div
                        class="grid-card"
                        class:playlist-card={true}
                        class:file-missing={fileMissing}
                        style={getItemColorStyle(subItem.id)}
                        onmouseenter={() => (hoveredItemId = subItem.id)}
                        onmouseleave={() => (hoveredItemId = null)}
                      >
                        <div class="card-thumbnail">
                          {#if subItem.thumbnail}
                            <img
                              src={subItem.thumbnail}
                              alt=""
                              onload={() => {
                                extractItemColor(subItem.id, subItem.thumbnail);
                                checkFileExists(subItem.id, subItem.filePath);
                              }}
                            />
                          {:else}
                            <div
                              class="card-thumb-placeholder"
                              use:tooltip={fileMissing ? $t('downloads.fileMissing') : ''}
                            >
                              <Icon name={getTypeIcon(subItem.type)} size={32} />
                            </div>
                            {(() => {
                              checkFileExists(subItem.id, subItem.filePath);
                              return '';
                            })()}
                          {/if}
                          {#if subItem.duration > 0}
                            <span class="duration-badge">{formatDuration(subItem.duration)}</span>
                          {/if}
                          <span class="type-badge">{subItem.extension.toUpperCase()}</span>
                          <!-- Playlist indicator badge -->
                          <div class="playlist-badge" use:tooltip={playlistGroup.playlistTitle}>
                            <Icon name="playlist" size={10} />
                            <span>{idx + 1}/{playlistGroup.items.length}</span>
                          </div>
                          <!-- Missing file indicator -->
                          {#if fileMissing}
                            <div
                              class="missing-file-overlay"
                              use:tooltip={$t('downloads.fileMissing')}
                            >
                              <Icon name="trash" size={24} />
                            </div>
                          {/if}
                          {#if hoveredItemId === subItem.id && !fileMissing}
                            <div class="card-overlay">
                              <button
                                class="play-overlay"
                                onclick={(e) => {
                                  e.stopPropagation();
                                  handlePlayFile(e, subItem.filePath);
                                }}
                                use:tooltip={$t('downloads.play')}
                              >
                                <Icon name="play" size={24} />
                              </button>
                              <div class="card-actions-bar">
                                <button
                                  class="card-action-btn"
                                  use:tooltip={$t('downloads.openFolder')}
                                  onclick={(e) => {
                                    e.stopPropagation();
                                    handleOpenFile(e, subItem.filePath);
                                  }}
                                >
                                  <Icon name="folder" size={14} />
                                </button>
                                <button
                                  class="card-action-btn"
                                  use:tooltip={$t('downloads.redownload')}
                                  onclick={(e) => {
                                    e.stopPropagation();
                                    handleRedownload(e, subItem.url);
                                  }}
                                >
                                  <Icon name="download" size={14} />
                                </button>
                                <button
                                  class="card-action-btn"
                                  use:tooltip={$t('downloads.openLink')}
                                  onclick={(e) => {
                                    e.stopPropagation();
                                    handleOpenLink(e, subItem.url);
                                  }}
                                >
                                  <Icon name="link" size={14} />
                                </button>
                                <button
                                  class="card-action-btn delete"
                                  use:tooltip={$t('downloads.delete')}
                                  onclick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(e, subItem.id);
                                  }}
                                >
                                  <Icon name="trash" size={14} />
                                </button>
                              </div>
                            </div>
                          {:else if hoveredItemId === subItem.id && fileMissing}
                            <div class="card-overlay missing">
                              <div class="card-actions-bar">
                                <button
                                  class="card-action-btn"
                                  use:tooltip={$t('downloads.redownload')}
                                  onclick={(e) => {
                                    e.stopPropagation();
                                    handleRedownload(e, subItem.url);
                                  }}
                                >
                                  <Icon name="download" size={14} />
                                </button>
                                <button
                                  class="card-action-btn"
                                  use:tooltip={$t('downloads.openLink')}
                                  onclick={(e) => {
                                    e.stopPropagation();
                                    handleOpenLink(e, subItem.url);
                                  }}
                                >
                                  <Icon name="link" size={14} />
                                </button>
                                <button
                                  class="card-action-btn delete"
                                  use:tooltip={$t('downloads.delete')}
                                  onclick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(e, subItem.id);
                                  }}
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
                            onclick={(e) => handleOpenVideoView(e, subItem)}
                            title={$t('downloads.openInApp')}>{subItem.title}</span
                          >
                          <div class="card-meta">
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <span
                              class="card-author clickable"
                              onclick={(e) => handleOpenChannelView(e, subItem)}
                              title={$t('downloads.openAuthor')}>{subItem.author}</span
                            >
                            <span class="card-size">{formatFileSize(subItem.size)}</span>
                          </div>
                        </div>
                      </div>
                    {/each}
                  {:else}
                    <!-- Single Item in Grid -->
                    {@const singleItem = item as HistoryItem}
                    {@const fileMissing = isFileMissing(singleItem.id)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                      class="grid-card"
                      class:file-missing={fileMissing}
                      style={getItemColorStyle(singleItem.id)}
                      onmouseenter={() => (hoveredItemId = singleItem.id)}
                      onmouseleave={() => (hoveredItemId = null)}
                    >
                      <div class="card-thumbnail">
                        {#if singleItem.thumbnail}
                          <img
                            src={singleItem.thumbnail}
                            alt=""
                            onload={() => {
                              extractItemColor(singleItem.id, singleItem.thumbnail);
                              checkFileExists(singleItem.id, singleItem.filePath);
                            }}
                          />
                        {:else}
                          <div class="card-thumb-placeholder">
                            <Icon name={getTypeIcon(singleItem.type)} size={32} />
                          </div>
                          {(() => {
                            checkFileExists(singleItem.id, singleItem.filePath);
                            return '';
                          })()}
                        {/if}
                        {#if singleItem.duration > 0}
                          <span class="duration-badge">{formatDuration(singleItem.duration)}</span>
                        {/if}
                        <span class="type-badge">{singleItem.extension.toUpperCase()}</span>
                        <!-- Missing file indicator -->
                        {#if fileMissing}
                          <div
                            class="missing-file-overlay"
                            use:tooltip={$t('downloads.fileMissing')}
                          >
                            <Icon name="trash" size={24} />
                          </div>
                        {/if}
                        {#if hoveredItemId === singleItem.id && !fileMissing}
                          <div class="card-overlay">
                            <button
                              class="play-overlay"
                              onclick={(e) => handlePlayFile(e, singleItem.filePath)}
                              use:tooltip={$t('downloads.play')}
                            >
                              <Icon name="play" size={24} />
                            </button>
                            <div class="card-actions-bar">
                              <button
                                class="card-action-btn"
                                use:tooltip={$t('downloads.openFolder')}
                                onclick={(e) => handleOpenFile(e, singleItem.filePath)}
                              >
                                <Icon name="folder" size={14} />
                              </button>
                              <button
                                class="card-action-btn"
                                use:tooltip={$t('downloads.redownload')}
                                onclick={(e) => handleRedownload(e, singleItem.url)}
                              >
                                <Icon name="download" size={14} />
                              </button>
                              <button
                                class="card-action-btn"
                                use:tooltip={$t('downloads.openLink')}
                                onclick={(e) => handleOpenLink(e, singleItem.url)}
                              >
                                <Icon name="link" size={14} />
                              </button>
                              <button
                                class="card-action-btn delete"
                                use:tooltip={$t('downloads.delete')}
                                onclick={(e) => handleDelete(e, singleItem.id)}
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </div>
                          </div>
                        {:else if hoveredItemId === singleItem.id && fileMissing}
                          <div class="card-overlay missing">
                            <div class="card-actions-bar">
                              <button
                                class="card-action-btn"
                                use:tooltip={$t('downloads.redownload')}
                                onclick={(e) => handleRedownload(e, singleItem.url)}
                              >
                                <Icon name="download" size={14} />
                              </button>
                              <button
                                class="card-action-btn"
                                use:tooltip={$t('downloads.openLink')}
                                onclick={(e) => handleOpenLink(e, singleItem.url)}
                              >
                                <Icon name="link" size={14} />
                              </button>
                              <button
                                class="card-action-btn delete"
                                use:tooltip={$t('downloads.delete')}
                                onclick={(e) => handleDelete(e, singleItem.id)}
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
                          onclick={(e) => handleOpenVideoView(e, singleItem)}
                          title={$t('downloads.openInApp')}>{singleItem.title}</span
                        >
                        <div class="card-meta">
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <span
                            class="card-author clickable"
                            onclick={(e) => handleOpenChannelView(e, singleItem)}
                            title={$t('downloads.openAuthor')}>{singleItem.author}</span
                          >
                          <span class="card-size">{formatFileSize(singleItem.size)}</span>
                        </div>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {:else}
              <!-- List View -->
              {#each group.items as item}
                {#if isPlaylistGroup(item)}
                  <!-- Playlist Group in List - matches queue style -->
                  {@const playlistGroup = item as HistoryPlaylistGroup}
                  {@const isExpanded = !collapsedHistoryPlaylists.has(playlistGroup.playlistId)}
                  {@const playlistThumb = playlistGroup.items[0]?.thumbnail}
                  <div class="playlist-group" class:collapsed={!isExpanded}>
                    <!-- Playlist Header Row - grid layout matching history-item columns -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                      class="playlist-header-row"
                      onclick={() => toggleHistoryPlaylistExpanded(playlistGroup.playlistId)}
                    >
                      <div class="col-thumb">
                        <div class="playlist-thumb">
                          {#if playlistThumb}
                            <img src={playlistThumb} alt="" />
                          {:else}
                            <Icon name="playlist" size={16} />
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

                    <!-- Playlist Items (collapsible) -->
                    {#if isExpanded}
                      <div class="playlist-items">
                        {#each playlistGroup.items as subItem (subItem.id)}
                          {@const fileMissing = isFileMissing(subItem.id)}
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <div
                            class="history-item playlist-child"
                            class:file-missing={fileMissing}
                            style={getItemColorStyle(subItem.id)}
                            onmouseenter={() => (hoveredItemId = subItem.id)}
                            onmouseleave={() => (hoveredItemId = null)}
                          >
                            <div class="col-thumb">
                              {#if subItem.thumbnail}
                                <img
                                  src={subItem.thumbnail}
                                  alt=""
                                  class="thumbnail"
                                  onload={() => {
                                    extractItemColor(subItem.id, subItem.thumbnail);
                                    checkFileExists(subItem.id, subItem.filePath);
                                  }}
                                />
                              {:else}
                                <div class="thumbnail-placeholder">
                                  <Icon name={getTypeIcon(subItem.type)} size={20} />
                                </div>
                                {(() => {
                                  checkFileExists(subItem.id, subItem.filePath);
                                  return '';
                                })()}
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
                            <div class="col-size">
                              {formatFileSize(subItem.size)}
                            </div>
                            <div class="col-length">
                              {formatDuration(subItem.duration)}
                            </div>
                            <button
                              class="open-file-btn"
                              use:tooltip={$t('downloads.openFolder')}
                              onclick={(e) => handleOpenFile(e, subItem.filePath)}
                            >
                              <Icon name="folder" size={16} />
                            </button>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {:else}
                  <!-- Single Item in List -->
                  {@const singleItem = item as HistoryItem}
                  {@const fileMissing = isFileMissing(singleItem.id)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="history-item"
                    class:file-missing={fileMissing}
                    style={getItemColorStyle(singleItem.id)}
                    onmouseenter={() => (hoveredItemId = singleItem.id)}
                    onmouseleave={() => (hoveredItemId = null)}
                  >
                    <div class="col-thumb">
                      {#if singleItem.thumbnail}
                        <img
                          src={singleItem.thumbnail}
                          alt=""
                          class="thumbnail"
                          onload={() => {
                            extractItemColor(singleItem.id, singleItem.thumbnail);
                            checkFileExists(singleItem.id, singleItem.filePath);
                          }}
                        />
                      {:else}
                        <div class="thumbnail-placeholder">
                          <Icon name={getTypeIcon(singleItem.type)} size={20} />
                        </div>
                        {(() => {
                          checkFileExists(singleItem.id, singleItem.filePath);
                          return '';
                        })()}
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
                    <div class="col-size">
                      {formatFileSize(singleItem.size)}
                    </div>
                    <div class="col-length">
                      {formatDuration(singleItem.duration)}
                    </div>
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
            {/if}
          </div>
        {/each}

        <p class="end-message">{$t('downloads.endMessage')}</p>

        <!-- Statistics Bar -->
        {#if $settings.showHistoryStats && $historyStats.totalDownloads > 0}
          <div class="stats-bar">
            <div class="stat-item">
              <span class="stat-value">{$historyStats.totalDownloads}</span>
              <span class="stat-label">{$t('downloads.stats.totalDownloads')}</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-value">{formatFileSize($historyStats.totalSize)}</span>
              <span class="stat-label">{$t('downloads.stats.totalSize')}</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-value">{formatDuration($historyStats.totalDuration)}</span>
              <span class="stat-label">{$t('downloads.stats.totalDuration')}</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-value">{$historyStats.mostCommonFormat.toUpperCase()}</span>
              <span class="stat-label">{$t('downloads.stats.mostCommon')}</span>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </ScrollArea>
</div>

<style>
  .page {
    padding: 0 14px 0 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
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
    color: var(--accent, rgba(99, 102, 241, 1));
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

  /* History playlist header - grid layout for columns */
  .history-list .playlist-header-row {
    display: grid;
    grid-template-columns: 60px 1fr 120px 50px 70px 60px 32px;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: none;
    width: 100%;
    cursor: pointer;
    color: white;
    text-align: left;
  }

  .history-list .playlist-header-row:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .playlist-header-row .item-title {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .playlist-thumb {
    width: 48px;
    height: 36px;
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.5);
  }

  .playlist-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
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

  /* Playlist child items use same grid as regular history items */
  .playlist-items .history-item.playlist-child {
    border-radius: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .playlist-items .history-item.playlist-child:last-child {
    border-bottom: none;
  }

  .playlist-item {
    border-radius: 0;
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .playlist-item:last-child {
    border-bottom: none;
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

  .date-group {
    margin-bottom: 8px;
  }

  .date-label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    padding: 12px 12px 8px;
  }

  .history-item {
    display: grid;
    grid-template-columns: 60px 1fr 120px 50px 70px 60px 32px;
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
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
    color: var(--accent, #6366f1);
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
    color: var(--accent, #6366f1);
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

  /* Grid View */
  .history-list.grid-view .date-group {
    margin-bottom: 20px;
  }

  .history-list.grid-view .date-label {
    margin-bottom: 12px;
  }

  .grid-items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
    padding: 0;
  }

  .grid-card {
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

  /* Playlist indicator badge */
  .playlist-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    color: rgba(255, 255, 255, 0.9);
    font-size: 9px;
    font-weight: 600;
    padding: 3px 6px;
    border-radius: 4px;
  }

  .playlist-badge :global(svg) {
    opacity: 0.8;
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
    color: var(--accent, #6366f1);
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
    color: var(--accent, #6366f1);
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

    .playlist-thumb {
      width: 40px;
      height: 30px;
    }

    .stats-bar {
      flex-wrap: wrap;
      gap: 16px;
    }

    .stat-divider {
      display: none;
    }

    .stat-item {
      flex: 1 1 40%;
      min-width: 80px;
    }

    /* Grid view on mobile */
    .grid-items {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 10px;
    }
  }

  /* Statistics Bar */
  .stats-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
    padding: 20px;
    margin: 12px 0 24px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .stat-value {
    font-size: 18px;
    font-weight: 700;
    color: var(--accent, rgba(99, 102, 241, 1));
  }

  .stat-label {
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .stat-divider {
    width: 1px;
    height: 32px;
    background: rgba(255, 255, 255, 0.1);
  }
</style>
