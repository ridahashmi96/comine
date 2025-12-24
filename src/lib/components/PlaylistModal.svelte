<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { invoke } from '@tauri-apps/api/core';
  import { portal } from '$lib/actions/portal';
  import { t } from '$lib/i18n';
  import { settings, type VideoQuality, type DownloadMode, type AudioQuality } from '$lib/stores/settings';
  import { isAndroid, getPlaylistInfoOnAndroid, type PlaylistInfo as AndroidPlaylistInfo } from '$lib/utils/android';
  import Icon from './Icon.svelte';
  import Checkbox from './Checkbox.svelte';
  import Select from './Select.svelte';
  import Input from './Input.svelte';
  import Chip from './Chip.svelte';

  interface PlaylistEntry {
    id: string;
    url: string;
    title: string;
    duration: number | null;
    thumbnail: string | null;
    uploader: string | null;
    is_music: boolean;
  }

  interface PlaylistInfo {
    is_playlist: boolean;
    id: string | null;
    title: string;
    uploader: string | null;
    thumbnail: string | null;
    total_count: number;
    entries: PlaylistEntry[];
    has_more: boolean;
  }

  interface EntrySettings {
    videoQuality: VideoQuality;
    downloadMode: DownloadMode;
  }

  interface Props {
    open?: boolean;
    url?: string;
    cookiesFromBrowser?: string;
    customCookies?: string;
    defaultDownloadMode?: DownloadMode;
    onclose?: () => void;
    ondownload?: (entries: SelectedEntry[], playlistInfo: { id: string; title: string; usePlaylistFolder: boolean }) => void;
  }

  export interface SelectedEntry {
    entry: PlaylistEntry;
    settings: EntrySettings;
  }

  let { 
    open = $bindable(false),
    url = '',
    cookiesFromBrowser = '',
    customCookies = '',
    defaultDownloadMode = 'auto',
    onclose,
    ondownload
  }: Props = $props();

  // Playlist data
  let playlistInfo = $state<PlaylistInfo | null>(null);
  let loading = $state(false);
  let loadingMore = $state(false);
  let loadingAll = $state(false);
  let loadingStatus = $state<string>('');
  let error = $state<string | null>(null);
  
  // Selection state - use array for better Svelte reactivity with Set operations
  let selectedIdsArray = $state<string[]>([]);
  let selectedIds = $derived(new Set(selectedIdsArray));
  let perItemSettings = $state<Map<string, EntrySettings>>(new Map());
  
  // Search
  let searchQuery = $state('');
  
  // Download order
  type DownloadOrder = 'queue' | 'reverse' | 'shuffle';
  let downloadOrder = $state<DownloadOrder>('queue');
  
  // Playlist folder option (initialized from settings, can be overridden per-download)
  let usePlaylistFolder = $state(true);
  
  // Global settings (defaults from props or settings store)
  let globalVideoQuality = $state<VideoQuality>($settings.defaultVideoQuality ?? 'max');
  // Reactive initial download mode from prop
  let globalDownloadMode = $derived(defaultDownloadMode ?? $settings.defaultDownloadMode ?? 'auto');
  // Mutable override for when user changes in modal
  let downloadModeOverride = $state<DownloadMode | null>(null);
  let effectiveDownloadMode = $derived(downloadModeOverride ?? globalDownloadMode);
  
  // Infinite scroll (bind: refs don't need $state)
  let scrollContainer: HTMLDivElement;
  let sentinel: HTMLDivElement;
  
  // Filtered entries based on search
  let filteredEntries = $derived(
    playlistInfo?.entries.filter(e => 
      !searchQuery || 
      e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.uploader?.toLowerCase().includes(searchQuery.toLowerCase())
    ) ?? []
  );
  
  // Selection counts
  let selectedCount = $derived(selectedIds.size);
  let allSelected = $derived(
    filteredEntries.length > 0 && 
    filteredEntries.every(e => selectedIds.has(e.id))
  );
  let someSelected = $derived(selectedCount > 0 && !allSelected);

  // Reset override when modal opens with new URL
  $effect(() => {
    if (open && url) {
      downloadModeOverride = null;
      usePlaylistFolder = $settings.usePlaylistFolders ?? true;
      loadPlaylist();
    }
  });

  // Setup intersection observer for infinite scroll
  $effect(() => {
    if (!sentinel || !playlistInfo?.has_more) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && playlistInfo?.has_more) {
          loadMoreEntries();
        }
      },
      { rootMargin: '200px' }
    );
    
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  async function loadPlaylist() {
    loading = true;
    error = null;
    playlistInfo = null;
    selectedIdsArray = [];
    perItemSettings = new Map();
    loadingStatus = $t('playlist.loading');
    
    try {
      let info: PlaylistInfo;
      
      if (isAndroid()) {
        // Android: Use native bridge - returns all entries at once
        loadingStatus = $t('playlist.fetchingEntries');
        info = await getPlaylistInfoOnAndroid(url) as PlaylistInfo;
      } else {
        // Desktop: Use Rust backend - fetch entries in batches
        // Fetch first batch quickly, then load more in background
        loadingStatus = $t('playlist.fetchingInfo');
        console.log('[PlaylistModal] Invoking get_playlist_info...');
        info = await invoke<PlaylistInfo>('get_playlist_info', {
          url,
          offset: 0,
          limit: 100, // Smaller initial batch for faster response
          cookiesFromBrowser: cookiesFromBrowser || null,
          customCookies: customCookies || null
        });
        console.log('[PlaylistModal] First batch returned, entries:', info?.entries?.length, 'has_more:', info?.has_more);
        
        // Load remaining entries if there are more
        while (info.has_more && info.total_count > 0) {
          const currentOffset = info.entries.length;
          loadingStatus = $t('playlist.loadingEntries').replace('{loaded}', String(currentOffset)).replace('{total}', String(info.total_count));
          
          console.log('[PlaylistModal] Fetching more entries at offset:', currentOffset);
          const moreInfo = await invoke<PlaylistInfo>('get_playlist_info', {
            url,
            offset: currentOffset,
            limit: 100,
            cookiesFromBrowser: cookiesFromBrowser || null,
            customCookies: customCookies || null
          });
          console.log('[PlaylistModal] Got more entries:', moreInfo?.entries?.length, 'has_more:', moreInfo?.has_more);
          
          info = {
            ...info,
            entries: [...info.entries, ...moreInfo.entries],
            has_more: moreInfo.has_more
          };
        }
        console.log('[PlaylistModal] Loop complete, total entries:', info.entries.length);
      }
      
      playlistInfo = info;
      console.log('[PlaylistModal] Loaded playlist with', info.entries.length, 'entries');
      
      // Auto-select all entries initially
      selectedIdsArray = info.entries.map(e => e.id);
      console.log('[PlaylistModal] Selected', selectedIdsArray.length, 'entries');
      
      // Set suggested mode for music entries
      const newSettings = new Map<string, EntrySettings>();
      info.entries.forEach(e => {
        if (e.is_music) {
          newSettings.set(e.id, {
            videoQuality: globalVideoQuality,
            downloadMode: 'audio'
          });
        }
      });
      perItemSettings = newSettings;
      console.log('[PlaylistModal] Set per-item settings for', newSettings.size, 'music entries');
      console.log('[PlaylistModal] SUCCESS - About to set loading=false');
      
    } catch (e) {
      console.error('[PlaylistModal] ERROR:', e);
      error = String(e);
    } finally {
      console.log('[PlaylistModal] Finally block - setting loading=false');
      loading = false;
      loadingStatus = '';
    }
  }

  async function loadMoreEntries() {
    // On Android, we get all entries at once, so no need to load more
    if (isAndroid()) return;
    
    if (!playlistInfo || loadingMore || !playlistInfo.has_more) return;
    
    loadingMore = true;
    
    try {
      const info = await invoke<PlaylistInfo>('get_playlist_info', {
        url,
        offset: playlistInfo.entries.length,
        limit: 200, // Load in larger batches
        cookiesFromBrowser: cookiesFromBrowser || null,
        customCookies: customCookies || null
      });
      
      // Merge new entries
      playlistInfo = {
        ...playlistInfo,
        entries: [...playlistInfo.entries, ...info.entries],
        has_more: info.has_more
      };
      
      // Auto-select new entries too
      selectedIdsArray = [...selectedIdsArray, ...info.entries.map(e => e.id)];
      
      // Set suggested mode for music entries
      info.entries.forEach(e => {
        if (e.is_music && !perItemSettings.has(e.id)) {
          perItemSettings.set(e.id, {
            videoQuality: globalVideoQuality,
            downloadMode: 'audio'
          });
        }
      });
      perItemSettings = perItemSettings;
      
    } catch (e) {
      console.error('Failed to load more entries:', e);
    } finally {
      loadingMore = false;
    }
  }

  async function toggleSelectAll() {
    // If there are more entries to load and we're selecting all, load them first
    if (!allSelected && playlistInfo?.has_more && !loadingAll) {
      loadingAll = true;
      try {
        while (playlistInfo.has_more) {
          await loadMoreEntries();
        }
      } finally {
        loadingAll = false;
      }
    }
    
    if (allSelected) {
      // Deselect all filtered
      const filteredIds = new Set(filteredEntries.map(e => e.id));
      selectedIdsArray = selectedIdsArray.filter(id => !filteredIds.has(id));
    } else {
      // Select all filtered (now includes all loaded entries)
      const currentSet = new Set(selectedIdsArray);
      const newIds = filteredEntries.filter(e => !currentSet.has(e.id)).map(e => e.id);
      selectedIdsArray = [...selectedIdsArray, ...newIds];
    }
  }

  function toggleEntry(id: string) {
    if (selectedIds.has(id)) {
      selectedIdsArray = selectedIdsArray.filter(i => i !== id);
    } else {
      selectedIdsArray = [...selectedIdsArray, id];
    }
  }

  function getEntrySettings(entry: PlaylistEntry): EntrySettings {
    return perItemSettings.get(entry.id) ?? {
      videoQuality: globalVideoQuality,
      downloadMode: entry.is_music ? 'audio' : effectiveDownloadMode
    };
  }

  function setEntrySettings(id: string, settings: Partial<EntrySettings>) {
    const current = perItemSettings.get(id) ?? {
      videoQuality: globalVideoQuality,
      downloadMode: effectiveDownloadMode
    };
    perItemSettings.set(id, { ...current, ...settings });
    perItemSettings = perItemSettings;
  }

  function formatDuration(seconds: number | null): string {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hrs}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function handleDownload() {
    if (!playlistInfo) return;
    
    // Get selected entries with their settings
    let entries = playlistInfo.entries
      .filter(e => selectedIds.has(e.id))
      .map(e => ({
        entry: e,
        settings: getEntrySettings(e)
      }));
    
    // Apply download order
    switch (downloadOrder) {
      case 'reverse':
        entries = entries.reverse();
        break;
      case 'shuffle':
        entries = entries.sort(() => Math.random() - 0.5);
        break;
      // 'queue' - keep original order
    }
    
    ondownload?.(entries, {
      id: playlistInfo?.id ?? '',
      title: playlistInfo?.title ?? 'Playlist',
      usePlaylistFolder
    });
    close();
  }

  function close() {
    open = false;
    onclose?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  // Quality/mode options for selects
  const videoQualityOptions = [
    { value: 'max', label: $t('download.quality.max') },
    { value: '4k', label: '4K' },
    { value: '1440p', label: '1440p' },
    { value: '1080p', label: '1080p' },
    { value: '720p', label: '720p' },
    { value: '480p', label: '480p' },
  ];
  
  const downloadModeOptions = [
    { value: 'auto', label: $t('download.mode.auto') },
    { value: 'audio', label: $t('download.mode.audio') },
    { value: 'mute', label: $t('download.mode.mute') },
  ];
  
  const downloadOrderOptions = [
    { value: 'queue', label: $t('playlist.order.queue') },
    { value: 'reverse', label: $t('playlist.order.reverse') },
    { value: 'shuffle', label: $t('playlist.order.shuffle') },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div use:portal>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div 
      class="modal-backdrop" 
      transition:fade={{ duration: 150 }}
      onclick={handleBackdropClick}
      onkeydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="playlist-modal" transition:scale={{ duration: 150, start: 0.95 }}>
        <!-- Header -->
        <div class="modal-header">
          <h2>{$t('playlist.title')}</h2>
          <button class="close-btn" onclick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>
        
        {#if loading}
          <div class="loading-state">
            <div class="spinner"></div>
            <p>{loadingStatus || $t('playlist.loading')}</p>
          </div>
        {:else if error}
          <div class="error-state">
            <Icon name="warning" size={32} />
            <p>{error}</p>
            <button class="retry-btn" onclick={loadPlaylist}>
              {$t('common.retry')}
            </button>
          </div>
        {:else if playlistInfo}
          <!-- Playlist Info Header -->
          <div class="playlist-header">
            {#if playlistInfo.thumbnail}
              <img src={playlistInfo.thumbnail} alt="" class="playlist-thumb" />
            {:else}
              <div class="playlist-thumb placeholder">
                <Icon name="playlist" size={24} />
              </div>
            {/if}
            <div class="playlist-info">
              <h3 class="playlist-title">{playlistInfo.title}</h3>
              <p class="playlist-meta">
                {#if playlistInfo.uploader}
                  <span>{playlistInfo.uploader}</span>
                  <span class="dot">•</span>
                {/if}
                <span>{playlistInfo.total_count} {$t('playlist.videos')}</span>
              </p>
            </div>
          </div>
          
          <!-- Controls Bar -->
          <div class="controls-bar">
            <!-- Search -->
            <div class="search-wrapper">
              <Icon name="search" size={16} />
              <input 
                type="text" 
                bind:value={searchQuery}
                placeholder={$t('playlist.search')}
                class="search-input"
              />
              {#if searchQuery}
                <button class="search-clear" onclick={() => searchQuery = ''}>
                  <Icon name="close" size={14} />
                </button>
              {/if}
            </div>
            
            <!-- Select All -->
            <button class="select-all-btn" onclick={toggleSelectAll} disabled={loadingAll}>
              {#if loadingAll}
                <div class="spinner small"></div>
                <span>{$t('playlist.loadingAll')}</span>
              {:else}
                <Checkbox checked={allSelected} disabled />
                <span>{allSelected ? $t('playlist.deselectAll') : $t('playlist.selectAll')} ({playlistInfo?.total_count ?? 0})</span>
              {/if}
            </button>
          </div>
          
          <!-- Global Settings -->
          <div class="global-settings">
            <div class="setting-item">
              <span class="setting-label">{$t('download.options.videoQuality')}</span>
              <Select
                bind:value={globalVideoQuality}
                options={videoQualityOptions}
              />
            </div>
            <div class="setting-item">
              <span class="setting-label">{$t('download.options.downloadMode')}</span>
              <Select
                value={effectiveDownloadMode}
                options={downloadModeOptions}
                onchange={(val) => downloadModeOverride = val as DownloadMode}
              />
            </div>
            <div class="setting-item">
              <span class="setting-label">{$t('playlist.downloadOrder')}</span>
              <Select
                bind:value={downloadOrder}
                options={downloadOrderOptions}
              />
            </div>
            <div class="setting-item checkbox-setting">
              <Checkbox 
                checked={usePlaylistFolder} 
                label={$t('playlist.createFolder')} 
                onchange={(v: boolean) => usePlaylistFolder = v}
              />
            </div>
          </div>
          
          <!-- Entries List -->
          <div class="entries-container" bind:this={scrollContainer}>
            {#if filteredEntries.length === 0}
              <div class="empty-state">
                <Icon name="search" size={24} />
                <p>{$t('playlist.noResults')}</p>
              </div>
            {:else}
              {#each filteredEntries as entry, idx (entry.id + '-' + idx)}
                {@const entrySettings = getEntrySettings(entry)}
                {@const isSelected = selectedIds.has(entry.id)}
                <div class="entry-row" class:selected={isSelected}>
                  <button class="entry-select" onclick={() => toggleEntry(entry.id)}>
                    <Checkbox checked={isSelected} />
                  </button>
                  
                  <div class="entry-thumb-wrapper">
                    {#if entry.thumbnail}
                      <img src={entry.thumbnail} alt="" class="entry-thumb" />
                    {:else}
                      <div class="entry-thumb placeholder">
                        <Icon name="video" size={16} />
                      </div>
                    {/if}
                    <span class="entry-duration">{formatDuration(entry.duration)}</span>
                  </div>
                  
                  <div class="entry-info">
                    <p class="entry-title" title={entry.title}>{entry.title}</p>
                    <p class="entry-author">{entry.uploader ?? ''}</p>
                    {#if entry.is_music}
                      <span class="music-badge" title={$t('playlist.suggestedAudio')}>
                        <Icon name="music" size={10} />
                        {$t('playlist.music')}
                      </span>
                    {/if}
                  </div>
                  
                  <!-- Per-item settings (compact) -->
                  <div class="entry-settings">
                    <Select
                      value={entrySettings.downloadMode}
                      options={[
                        { value: 'auto', label: $t('download.mode.auto') },
                        { value: 'audio', label: $t('download.mode.audio') },
                        { value: 'mute', label: $t('download.mode.mute') }
                      ]}
                      disabled={!isSelected}
                      onchange={(val) => setEntrySettings(entry.id, { downloadMode: val as DownloadMode })}
                    />
                  </div>
                </div>
              {/each}
              
              <!-- Infinite scroll sentinel -->
              {#if playlistInfo.has_more}
                <div class="load-more-sentinel" bind:this={sentinel}>
                  {#if loadingMore}
                    <div class="loading-more">
                      <div class="spinner small"></div>
                      <span>{$t('playlist.loadingMore')}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}
          </div>
          
          <!-- Footer Actions -->
          <div class="modal-footer">
            <button class="btn secondary" onclick={close}>
              {$t('common.cancel')}
            </button>
            <button 
              class="btn primary" 
              onclick={handleDownload}
              disabled={selectedCount === 0}
            >
              <Icon name="download" size={16} />
              {$t('playlist.downloadSelected')} ({selectedCount})
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
    overflow-y: auto;
  }

  .playlist-modal {
    background: rgba(22, 22, 26, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    width: 100%;
    max-width: 700px;
    max-height: min(85vh, 800px);
    min-height: 400px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: white;
    margin: 0;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.05);
    border: none;
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.15s;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  /* Loading & Error States */
  .loading-state, .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: rgba(255, 255, 255, 0.6);
    gap: 16px;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--accent, #6366F1);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .spinner.small {
    width: 20px;
    height: 20px;
    border-width: 2px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .retry-btn {
    padding: 8px 16px;
    background: var(--accent, #6366F1);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .retry-btn:hover {
    filter: brightness(1.1);
  }

  /* Playlist Header */
  .playlist-header {
    display: flex;
    gap: 16px;
    padding: 16px 20px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .playlist-thumb {
    width: 80px;
    height: 80px;
    border-radius: 8px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .playlist-thumb.placeholder {
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.3);
  }

  .playlist-info {
    flex: 1;
    min-width: 0;
  }

  .playlist-title {
    font-size: 16px;
    font-weight: 600;
    color: white;
    margin: 0 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .playlist-meta {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
  }

  .playlist-meta .dot {
    margin: 0 6px;
  }

  /* Controls Bar */
  .controls-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .search-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
  }

  .search-wrapper :global(svg) {
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: white;
    font-size: 14px;
  }

  .search-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }

  .select-all-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .select-all-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
  }
  
  .select-all-btn:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  /* Global Settings */
  .global-settings {
    display: flex;
    gap: 12px;
    padding: 12px 20px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .setting-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 100px;
  }

  .setting-label {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .setting-item :global(.select-trigger) {
    padding: 6px 10px;
    font-size: 13px;
    min-height: 32px;
  }

  .setting-item.checkbox-setting {
    display: flex;
    align-items: center;
    min-width: auto;
  }

  /* Entries Container */
  .entries-container {
    flex: 1 1 auto;
    overflow-y: auto;
    min-height: 150px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: rgba(255, 255, 255, 0.4);
    gap: 8px;
  }

  /* Entry Row */
  .entry-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition: background 0.15s;
  }

  .entry-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .entry-row.selected {
    background: rgba(99, 102, 241, 0.08);
  }

  .entry-select {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
  }

  .entry-thumb-wrapper {
    position: relative;
    flex-shrink: 0;
  }

  .entry-thumb {
    width: 64px;
    height: 36px;
    border-radius: 4px;
    object-fit: cover;
  }

  .entry-thumb.placeholder {
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.3);
  }

  .entry-duration {
    position: absolute;
    bottom: 2px;
    right: 2px;
    padding: 1px 4px;
    background: rgba(0, 0, 0, 0.8);
    border-radius: 3px;
    font-size: 10px;
    color: white;
    font-variant-numeric: tabular-nums;
  }

  .entry-info {
    flex: 1;
    min-width: 0;
  }

  .entry-title {
    font-size: 13px;
    color: white;
    margin: 0 0 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-author {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .music-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-top: 4px;
    padding: 2px 6px;
    background: rgba(99, 102, 241, 0.2);
    border-radius: 4px;
    font-size: 10px;
    color: var(--accent, #6366F1);
  }

  .entry-settings {
    flex-shrink: 0;
    min-width: 90px;
  }

  .entry-settings :global(.select-trigger) {
    padding: 4px 8px;
    font-size: 12px;
    min-height: 28px;
  }

  .entry-settings :global(.select-trigger:disabled) {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Load More */
  .load-more-sentinel {
    padding: 20px;
  }

  .loading-more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
  }

  /* Footer */
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn.secondary {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
  }

  .btn.secondary:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .btn.primary {
    background: var(--accent, #6366F1);
    color: white;
  }

  .btn.primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Responsive */
  @media (max-width: 600px) {
    .playlist-modal {
      max-height: 95vh;
    }

    .playlist-header {
      padding: 12px 16px;
    }

    .playlist-thumb {
      width: 60px;
      height: 60px;
    }

    .controls-bar {
      flex-direction: column;
      padding: 12px 16px;
    }

    .search-wrapper {
      width: 100%;
    }

    .select-all-btn {
      width: 100%;
      justify-content: center;
    }

    .global-settings {
      padding: 12px 16px;
    }

    .entry-row {
      padding: 10px 16px;
    }

    .entry-thumb {
      width: 48px;
      height: 27px;
    }

    .modal-footer {
      padding: 12px 16px;
    }

    .btn {
      padding: 10px 16px;
    }
  }
</style>
