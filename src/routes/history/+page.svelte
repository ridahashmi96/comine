<script lang="ts">
  import { t } from '$lib/i18n';
  import { goto, beforeNavigate } from '$app/navigation';
  import { revealItemInDir, openUrl, openPath } from '@tauri-apps/plugin-opener';
  import {
    history,
    playlistGroupedHistory,
    formatDuration,
    isPlaylistGroup,
    type FilterType,
    type HistoryItem,
    type HistoryPlaylistGroup,
  } from '$lib/stores/history';
  import { settings, updateSetting } from '$lib/stores/settings';
  import Icon from '$lib/components/Icon.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import Divider from '$lib/components/Divider.svelte';
  import ScrollArea from '$lib/components/ScrollArea.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { isAndroid, openFileOnAndroid, openFolderOnAndroid } from '$lib/utils/android';
  import { toast } from '$lib/components/Toast.svelte';
  import { onMount } from 'svelte';
  import { saveScrollPosition, getScrollPosition } from '$lib/stores/scroll';

  const ROUTE_PATH = '/history';

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
  let viewMode = $derived($settings.historyViewMode);
  let hoveredItemId = $state<string | null>(null);

  let expandedPlaylists = $state<Set<string>>(new Set());

  function togglePlaylistExpanded(playlistId: string) {
    if (expandedPlaylists.has(playlistId)) {
      expandedPlaylists = new Set([...expandedPlaylists].filter((id) => id !== playlistId));
    } else {
      expandedPlaylists = new Set([...expandedPlaylists, playlistId]);
    }
  }

  $effect(() => {
    history.setSearch(searchQuery);
  });

  function setFilter(filter: FilterType) {
    activeFilter = filter;
    history.setFilter(filter);
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

  async function handleOpenFile(e: MouseEvent, filePath: string) {
    e.stopPropagation();
    if (!filePath) {
      toast.error('File path not available for this item');
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
      toast.error('Failed to open file location');
    }
  }

  async function handlePlayFile(e: MouseEvent, filePath: string) {
    e.stopPropagation();
    if (!filePath) {
      toast.error('File path not available for this item');
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
      toast.error('Failed to play file');
    }
  }

  function getTypeIcon(type: string): 'video' | 'music' | 'image' {
    switch (type) {
      case 'video':
        return 'video';
      case 'audio':
        return 'music';
      case 'image':
        return 'image';
      default:
        return 'video';
    }
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>{$t('history.title')}</h1>
    <p class="subtitle">{$t('history.subtitle')}</p>
  </div>

  <Divider my={24} />

  <!-- Search Bar -->
  <div class="search-bar">
    <Icon name="search" size={18} />
    <input
      type="text"
      placeholder="Search by title, author, date, file extension, etc."
      bind:value={searchQuery}
    />
  </div>

  <!-- Toolbar -->
  <div class="toolbar">
    <!-- Filter Chips -->
    <div class="filters">
      <Chip selected={activeFilter === 'all'} icon="date" onclick={() => setFilter('all')}>
        All
      </Chip>
      <Chip selected={activeFilter === 'video'} icon="video" onclick={() => setFilter('video')}>
        Video
      </Chip>
      <Chip selected={activeFilter === 'audio'} icon="music" onclick={() => setFilter('audio')}>
        Music
      </Chip>
      <Chip selected={activeFilter === 'image'} icon="image" onclick={() => setFilter('image')}>
        Image
      </Chip>
    </div>

    <!-- View Toggle -->
    <div class="view-toggle">
      <button
        class="view-btn"
        class:active={viewMode === 'list'}
        onclick={() => updateSetting('historyViewMode', 'list')}
        title="List view"
      >
        <Icon name="checklist" size={18} />
      </button>
      <button
        class="view-btn"
        class:active={viewMode === 'grid'}
        onclick={() => updateSetting('historyViewMode', 'grid')}
        title="Grid view"
      >
        <Icon name="gallery" size={18} />
      </button>
    </div>
  </div>

  <!-- Table Header (list view only) -->
  {#if viewMode === 'list'}
    <div class="table-header">
      <span></span>
      <span>Title</span>
      <span></span>
      <span>Ext</span>
      <span>Size</span>
      <span>Length</span>
      <span></span>
    </div>
  {/if}

  <!-- History List -->
  <ScrollArea bind:this={scrollAreaRef}>
    <div class="history-list" class:grid-view={viewMode === 'grid'}>
      {#if $playlistGroupedHistory.length === 0}
        <div class="empty-state">
          <Icon name="history" size={48} />
          <p>{$t('history.empty')}</p>
          <p class="empty-hint">Downloaded files will appear here</p>
        </div>
      {:else}
        {#each $playlistGroupedHistory as group}
          <div class="date-group">
            <span class="date-label">{group.label}</span>

            {#if viewMode === 'grid'}
              <!-- Grid View -->
              <div class="grid-items">
                {#each group.items as item}
                  {#if isPlaylistGroup(item)}
                    <!-- Playlist Group Card -->
                    {@const playlistGroup = item as HistoryPlaylistGroup}
                    {@const isExpanded = expandedPlaylists.has(playlistGroup.playlistId)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div class="playlist-group-card" class:expanded={isExpanded}>
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <div
                        class="playlist-header"
                        onclick={() => togglePlaylistExpanded(playlistGroup.playlistId)}
                      >
                        <div class="playlist-thumbnail">
                          {#if playlistGroup.items[0]?.thumbnail}
                            <img src={playlistGroup.items[0].thumbnail} alt="" />
                            <!-- Stacked effect -->
                            <div class="stack-effect"></div>
                          {:else}
                            <div class="playlist-thumb-placeholder">
                              <Icon name="playlist" size={32} />
                            </div>
                          {/if}
                          <span class="playlist-count">{playlistGroup.items.length} items</span>
                        </div>
                        <div class="playlist-info">
                          <span class="playlist-title">{playlistGroup.playlistTitle}</span>
                          <span class="playlist-meta">
                            {formatFileSize(playlistGroup.totalSize)} • {formatDuration(
                              playlistGroup.totalDuration
                            )}
                          </span>
                        </div>
                        <Icon name={isExpanded ? 'chevron_up' : 'chevron_down'} size={20} />
                      </div>

                      {#if isExpanded}
                        <div class="playlist-items-grid">
                          {#each playlistGroup.items as subItem (subItem.id)}
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                              class="grid-card nested"
                              onmouseenter={() => (hoveredItemId = subItem.id)}
                              onmouseleave={() => (hoveredItemId = null)}
                            >
                              <div class="card-thumbnail">
                                {#if subItem.thumbnail}
                                  <img src={subItem.thumbnail} alt="" />
                                {:else}
                                  <div class="card-thumb-placeholder">
                                    <Icon name={getTypeIcon(subItem.type)} size={24} />
                                  </div>
                                {/if}
                                {#if subItem.duration > 0}
                                  <span class="duration-badge"
                                    >{formatDuration(subItem.duration)}</span
                                  >
                                {/if}
                                {#if hoveredItemId === subItem.id}
                                  <div class="card-overlay">
                                    <div class="card-actions">
                                      <button
                                        class="card-action-btn primary"
                                        title="Open file"
                                        onclick={(e) => handleOpenFile(e, subItem.filePath)}
                                      >
                                        <Icon name="folder" size={18} />
                                      </button>
                                    </div>
                                  </div>
                                {/if}
                              </div>
                              <div class="card-info compact">
                                <span class="card-title">{subItem.title}</span>
                              </div>
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {:else}
                    <!-- Single Item Card -->
                    {@const singleItem = item as HistoryItem}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                      class="grid-card"
                      onmouseenter={() => (hoveredItemId = singleItem.id)}
                      onmouseleave={() => (hoveredItemId = null)}
                    >
                      <div class="card-thumbnail">
                        {#if singleItem.thumbnail}
                          <img src={singleItem.thumbnail} alt="" />
                        {:else}
                          <div class="card-thumb-placeholder">
                            <Icon name={getTypeIcon(singleItem.type)} size={32} />
                          </div>
                        {/if}

                        {#if singleItem.duration > 0}
                          <span class="duration-badge">{formatDuration(singleItem.duration)}</span>
                        {/if}

                        <span class="type-badge">{singleItem.extension.toUpperCase()}</span>

                        {#if hoveredItemId === singleItem.id}
                          <div class="card-overlay">
                            <div class="card-actions">
                              <button
                                class="card-action-btn primary"
                                title="Open file"
                                onclick={(e) => handleOpenFile(e, singleItem.filePath)}
                              >
                                <Icon name="folder" size={20} />
                              </button>
                              <button
                                class="card-action-btn"
                                title="Download again"
                                onclick={(e) => handleRedownload(e, singleItem.url)}
                              >
                                <Icon name="download" size={18} />
                              </button>
                              <button
                                class="card-action-btn"
                                title="Open link"
                                onclick={(e) => handleOpenLink(e, singleItem.url)}
                              >
                                <Icon name="link" size={18} />
                              </button>
                              <button
                                class="card-action-btn delete"
                                title="Delete"
                                onclick={(e) => handleDelete(e, singleItem.id)}
                              >
                                <Icon name="trash" size={18} />
                              </button>
                            </div>
                          </div>
                        {/if}
                      </div>

                      <div class="card-info">
                        <span class="card-title">{singleItem.title}</span>
                        <span class="card-author">{singleItem.author}</span>
                        <span class="card-size">{formatFileSize(singleItem.size)}</span>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {:else}
              <!-- List View -->
              {#each group.items as item}
                {#if isPlaylistGroup(item)}
                  <!-- Playlist Group Row -->
                  {@const playlistGroup = item as HistoryPlaylistGroup}
                  {@const isExpanded = expandedPlaylists.has(playlistGroup.playlistId)}
                  <div class="playlist-group" class:expanded={isExpanded}>
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                      class="playlist-row"
                      onclick={() => togglePlaylistExpanded(playlistGroup.playlistId)}
                    >
                      <!-- Thumbnail with stack -->
                      <div class="col-thumb playlist-thumb">
                        {#if playlistGroup.items[0]?.thumbnail}
                          <img src={playlistGroup.items[0].thumbnail} alt="" class="thumbnail" />
                          <div class="thumb-stack"></div>
                        {:else}
                          <div class="thumbnail-placeholder">
                            <Icon name="playlist" size={20} />
                          </div>
                        {/if}
                      </div>

                      <!-- Metadata -->
                      <div class="col-metadata">
                        <span class="item-title playlist-title-text"
                          >{playlistGroup.playlistTitle}</span
                        >
                        <span class="item-author"
                          >{playlistGroup.items.length} items from playlist</span
                        >
                      </div>

                      <!-- Expand button -->
                      <div class="col-expand">
                        <Icon name={isExpanded ? 'chevron_up' : 'chevron_down'} size={18} />
                      </div>

                      <!-- Extension (mixed) -->
                      <div class="col-ext">
                        <span class="ext-badge">PLAYLIST</span>
                      </div>

                      <!-- Total Size -->
                      <div class="col-size">
                        {formatFileSize(playlistGroup.totalSize)}
                      </div>

                      <!-- Total Length -->
                      <div class="col-length">
                        {formatDuration(playlistGroup.totalDuration)}
                      </div>

                      <!-- Open folder (first item) -->
                      <button
                        class="open-file-btn"
                        title="Open folder"
                        onclick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(e, playlistGroup.items[0]?.filePath);
                        }}
                      >
                        <Icon name="folder" size={16} />
                      </button>
                    </div>

                    {#if isExpanded}
                      <div class="playlist-children">
                        {#each playlistGroup.items as subItem (subItem.id)}
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <div
                            class="history-item nested"
                            onmouseenter={() => (hoveredItemId = subItem.id)}
                            onmouseleave={() => (hoveredItemId = null)}
                          >
                            <div class="col-thumb">
                              {#if subItem.thumbnail}
                                <img src={subItem.thumbnail} alt="" class="thumbnail" />
                              {:else}
                                <div class="thumbnail-placeholder">
                                  <Icon name={getTypeIcon(subItem.type)} size={20} />
                                </div>
                              {/if}
                            </div>

                            <div class="col-metadata">
                              <span class="item-title">{subItem.title}</span>
                              <span class="item-author">{subItem.author}</span>
                            </div>

                            <div class="col-actions">
                              {#if hoveredItemId === subItem.id}
                                <div class="action-buttons">
                                  <button
                                    class="action-btn"
                                    title="Download again"
                                    onclick={(e) => handleRedownload(e, subItem.url)}
                                  >
                                    <Icon name="download" size={16} />
                                  </button>
                                </div>
                                <div class="action-buttons secondary">
                                  <button
                                    class="action-btn"
                                    title="Open original link"
                                    onclick={(e) => handleOpenLink(e, subItem.url)}
                                  >
                                    <Icon name="link" size={16} />
                                  </button>
                                  <button
                                    class="action-btn delete"
                                    title="Delete from history"
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
                              title="Open file location"
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
                  <!-- Single Item Row -->
                  {@const singleItem = item as HistoryItem}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="history-item"
                    onmouseenter={() => (hoveredItemId = singleItem.id)}
                    onmouseleave={() => (hoveredItemId = null)}
                  >
                    <div class="col-thumb">
                      {#if singleItem.thumbnail}
                        <img src={singleItem.thumbnail} alt="" class="thumbnail" />
                      {:else}
                        <div class="thumbnail-placeholder">
                          <Icon name={getTypeIcon(singleItem.type)} size={20} />
                        </div>
                      {/if}
                    </div>

                    <div class="col-metadata">
                      <span class="item-title">{singleItem.title}</span>
                      <span class="item-author">{singleItem.author}</span>
                    </div>

                    <div class="col-actions">
                      {#if hoveredItemId === singleItem.id}
                        <div class="action-buttons">
                          <button
                            class="action-btn"
                            title="Download again"
                            onclick={(e) => handleRedownload(e, singleItem.url)}
                          >
                            <Icon name="download" size={16} />
                          </button>
                          <button class="action-btn expand" title="More options">
                            <Icon name="chevron_down" size={16} />
                          </button>
                        </div>
                        <div class="action-buttons secondary">
                          <button
                            class="action-btn"
                            title="Open original link"
                            onclick={(e) => handleOpenLink(e, singleItem.url)}
                          >
                            <Icon name="link" size={16} />
                          </button>
                          <button
                            class="action-btn delete"
                            title="Delete from history"
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
                      title="Open file location"
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

        <p class="end-message">That's everything you downloaded so far!</p>
      {/if}
    </div>
  </ScrollArea>
</div>

<style>
  .page {
    padding: 0 0 0 16px;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .page-header {
    margin-bottom: 16px;
  }

  h1 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 6px;
  }

  .subtitle {
    color: rgba(255, 255, 255, 0.6);
    font-size: 14px;
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

  /* Table Header */
  .table-header {
    display: grid;
    grid-template-columns: 60px 1fr 120px 50px 70px 60px 32px;
    gap: 12px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.4);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
    background: rgba(255, 255, 255, 0.04);
  }

  /* Thumbnail */
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

  .item-author {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    text-align: right;
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
    margin-bottom: 24px;
  }

  .grid-items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 16px;
    padding: 0 4px;
  }

  .grid-card {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 12px;
    overflow: hidden;
    transition: all 0.2s;
    cursor: pointer;
  }

  .grid-card:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: translateY(-2px);
  }

  .card-thumbnail {
    position: relative;
    aspect-ratio: 16 / 9;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }

  .card-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .card-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.3);
  }

  .duration-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.75);
    color: white;
    font-size: 11px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .type-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(99, 102, 241, 0.9);
    color: white;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .card-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .card-actions {
    display: flex;
    gap: 8px;
  }

  .card-action-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.15);
    border: none;
    border-radius: 50%;
    color: white;
    cursor: pointer;
    transition: all 0.15s;
  }

  .card-action-btn:hover {
    background: rgba(255, 255, 255, 0.25);
    transform: scale(1.1);
  }

  .card-action-btn.primary {
    width: 48px;
    height: 48px;
    background: rgba(99, 102, 241, 0.9);
  }

  .card-action-btn.primary:hover {
    background: rgba(99, 102, 241, 1);
  }

  .card-action-btn.delete:hover {
    background: rgba(239, 68, 68, 0.8);
  }

  .card-info {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .card-title {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.95);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-author {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-size {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 4px;
  }

  /* Mobile */
  @media (max-width: 700px) {
    .table-header {
      display: none;
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
  }

  /* Playlist Group Styles */
  .playlist-group {
    margin-bottom: 4px;
    border-radius: 10px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid transparent;
    transition: all 0.2s;
  }

  .playlist-group:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.06);
  }

  .playlist-group.expanded {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .playlist-row {
    display: grid;
    grid-template-columns: 60px 1fr 32px 50px 70px 60px 32px;
    gap: 12px;
    align-items: center;
    padding: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .playlist-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .playlist-thumb {
    position: relative;
  }

  .thumb-stack {
    position: absolute;
    top: 2px;
    left: 4px;
    right: -4px;
    bottom: -2px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    z-index: -1;
  }

  .playlist-title-text {
    color: var(--accent, rgb(99, 102, 241)) !important;
    font-weight: 600 !important;
  }

  .col-expand {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.4);
  }

  .playlist-children {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding: 4px 0 4px 16px;
    background: rgba(0, 0, 0, 0.15);
  }

  .history-item.nested {
    opacity: 0.9;
    padding-left: 20px;
    border-left: 2px solid rgba(255, 255, 255, 0.1);
    margin-left: 8px;
  }

  .history-item.nested:hover {
    border-left-color: var(--accent, rgb(99, 102, 241));
  }

  /* Grid View Playlist Styles */
  .playlist-group-card {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    grid-column: span 2;
  }

  .playlist-group-card.expanded {
    grid-column: 1 / -1;
  }

  .playlist-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .playlist-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .playlist-thumbnail {
    position: relative;
    width: 80px;
    height: 60px;
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .playlist-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .stack-effect {
    position: absolute;
    top: 4px;
    left: 4px;
    right: -4px;
    bottom: -4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    z-index: -1;
  }

  .playlist-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.4);
  }

  .playlist-count {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .playlist-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .playlist-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--accent, rgb(99, 102, 241));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .playlist-meta {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .playlist-header :global(svg) {
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .playlist-items-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.15);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .grid-card.nested {
    background: rgba(255, 255, 255, 0.04);
  }

  .grid-card.nested .card-thumbnail {
    aspect-ratio: 16 / 9;
  }

  .card-info.compact {
    padding: 8px;
  }

  .card-info.compact .card-title {
    font-size: 12px;
  }
</style>
