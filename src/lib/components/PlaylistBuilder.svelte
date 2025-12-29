<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { t } from '$lib/i18n';
  import { tooltip } from '$lib/actions/tooltip';
  import { settings, type DownloadMode, getProxyConfig } from '$lib/stores/settings';
  import { isAndroid, getPlaylistInfoOnAndroid } from '$lib/utils/android';
  import { formatDuration, formatSize } from '$lib/utils/format';
  import Icon from './Icon.svelte';
  import Checkbox from './Checkbox.svelte';
  import Select from './Select.svelte';
  import MediaGrid, {
    type ViewMode,
    type MediaItemData,
    type MediaItemSettings,
  } from './MediaGrid.svelte';
  import { viewStateCache, type PlaylistViewState } from '$lib/stores/viewState';

  const CACHE_TTL = 10 * 60 * 1000;

  function getTotalDuration(entries: PlaylistEntry[] | undefined): number | null {
    if (!entries || entries.length === 0) return null;
    let total = 0;
    let hasAny = false;
    for (const e of entries) {
      if (e.duration) {
        total += e.duration;
        hasAny = true;
      }
    }
    return hasAny ? total : null;
  }

  export interface PlaylistEntry {
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

  export interface EntrySettings {
    downloadMode: DownloadMode;
    skipSponsors?: boolean;
    skipIntros?: boolean;
    embedChapters?: boolean;
    embedThumbnail?: boolean;
    embedMetadata?: boolean;
    embedSubs?: boolean;
    subLangs?: string;
  }

  export interface PlaylistSelection {
    entries: SelectedEntry[];
    playlistInfo: { id: string; title: string; usePlaylistFolder: boolean };
  }

  export interface SelectedEntry {
    entry: PlaylistEntry;
    settings: EntrySettings;
  }

  interface Props {
    url: string;
    cookiesFromBrowser?: string;
    customCookies?: string;
    defaultDownloadMode?: DownloadMode;
    ondownload?: (selection: PlaylistSelection) => void;
    onback?: () => void;
    onopenitem?: (entry: PlaylistEntry) => void;
    showHeader?: boolean;
    backLabel?: string;
  }

  let {
    url,
    cookiesFromBrowser = '',
    customCookies = '',
    defaultDownloadMode = 'auto',
    ondownload,
    onback,
    onopenitem,
    showHeader = false,
    backLabel,
  }: Props = $props();

  function getInitialState() {
    const cached = viewStateCache.get<PlaylistViewState>('playlist', url);
    if (cached && cached.playlistInfo && Date.now() - cached.timestamp < CACHE_TTL) {
      const selectedIdsSet = new Set(cached.selectedIds);
      return {
        playlistInfo: cached.playlistInfo,
        selectedIdsArray: [...cached.selectedIds],
        selectedIdsSet: selectedIdsSet,
        perItemSettingsObj: cached.perItemSettings,
        scrollTop: cached.scrollTop,
        viewMode: cached.viewMode,
        searchQuery: cached.searchQuery,
        loading: false,
        lastLoadedUrl: url,
        fromCache: true,
      };
    }
    return {
      playlistInfo: null,
      selectedIdsArray: [] as string[],
      selectedIdsSet: null as Set<string> | null,
      perItemSettingsObj: {} as Record<string, MediaItemSettings>,
      scrollTop: 0,
      viewMode: 'list' as const,
      searchQuery: '',
      loading: true,
      lastLoadedUrl: '',
      fromCache: false,
    };
  }

  const initialState = getInitialState();
  let playlistInfo = $state<PlaylistInfo | null>(initialState.playlistInfo);
  let loading = $state(initialState.loading);
  let error = $state<string | null>(null);
  let lastLoadedUrl = $state(initialState.lastLoadedUrl);

  let selectedIdsArray = $state<string[]>(initialState.selectedIdsArray);
  let lastSelectedArrayRef: string[] | null = null;
  let cachedSelectedSet: Set<string> =
    initialState.selectedIdsSet ?? new Set(initialState.selectedIdsArray);
  let selectedIds = $derived.by(() => {
    if (selectedIdsArray === lastSelectedArrayRef) {
      return cachedSelectedSet;
    }
    lastSelectedArrayRef = selectedIdsArray;
    cachedSelectedSet = new Set(selectedIdsArray);
    return cachedSelectedSet;
  });

  let perItemSettingsObj = $state<Record<string, MediaItemSettings>>(
    initialState.perItemSettingsObj
  );

  let currentScrollTop = $state(initialState.scrollTop);

  let searchQuery = $state(initialState.searchQuery);
  let showEntries = $state(true);
  let viewMode = $state<ViewMode>(initialState.viewMode);
  let showMoreOptions = $state(false);

  type DownloadOrder = 'queue' | 'reverse' | 'shuffle';
  let downloadOrder = $state<DownloadOrder>('queue');
  let usePlaylistFolder = $state(true);

  let globalVideoQuality = $state($settings.defaultVideoQuality ?? 'max');
  let globalAudioQuality = $state($settings.defaultAudioQuality ?? 'best');

  const videoQualityOptions = [
    { value: 'max', label: $t('download.quality.best') },
    { value: '4k', label: '4K (2160p)' },
    { value: '1440p', label: '1440p' },
    { value: '1080p', label: '1080p' },
    { value: '720p', label: '720p' },
    { value: '480p', label: '480p' },
    { value: '360p', label: '360p' },
  ];

  const audioQualityOptions = [
    { value: 'best', label: $t('download.quality.best') },
    { value: '320', label: '320 kbps' },
    { value: '256', label: '256 kbps' },
    { value: '192', label: '192 kbps' },
    { value: '128', label: '128 kbps' },
  ];

  let globalSkipSponsors = $state(true);
  let globalSkipIntros = $state(false);
  let globalEmbedChapters = $state(true);
  let globalEmbedThumbnail = $state(true);
  let globalEmbedMetadata = $state(true);
  let globalEmbedSubs = $state(false);
  let globalSubLangs = $state('en');

  let isYouTubeMusicUrl = $derived(url.toLowerCase().includes('music.youtube.com'));
  let bulkMode = $state<DownloadMode | null>(null);

  function applyModeToAll(mode: DownloadMode) {
    bulkMode = mode;
    const updated: Record<string, MediaItemSettings> = {};
    for (const e of playlistInfo?.entries ?? []) {
      const current = perItemSettingsObj[e.id] ?? getDefaultSettings(e.is_music);
      updated[e.id] = { ...current, downloadMode: mode };
    }
    perItemSettingsObj = updated;
  }

  let searchQueryDebounced = $state('');
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (!searchQuery) {
      searchQueryDebounced = '';
      return;
    }
    searchDebounceTimer = setTimeout(() => {
      searchQueryDebounced = searchQuery;
    }, 150);
  });

  // Use entries directly, filter only when searching
  let filteredEntries = $derived.by(() => {
    const entries = playlistInfo?.entries ?? [];
    if (!searchQueryDebounced) return entries;
    const q = searchQueryDebounced.toLowerCase();
    return entries.filter(
      (e) => e.title.toLowerCase().includes(q) || e.uploader?.toLowerCase().includes(q)
    );
  });

  let lastEntriesRef: PlaylistEntry[] | null = null;
  let computedMediaItems: MediaItemData[] = [];

  let mediaItems = $derived.by<MediaItemData[]>(() => {
    if (filteredEntries === lastEntriesRef && computedMediaItems.length > 0) {
      return computedMediaItems;
    }

    lastEntriesRef = filteredEntries;
    computedMediaItems = filteredEntries.map((e) => ({
      id: e.id,
      title: e.title,
      thumbnail: e.thumbnail,
      duration: e.duration,
      author: e.uploader,
      isMusic: e.is_music,
    }));
    return computedMediaItems;
  });

  let selectedCount = $derived(selectedIds.size);
  let allSelected = $derived.by(() => {
    if (filteredEntries.length === 0) return false;
    if (filteredEntries.length > 100) {
      const filteredSet = new Set(filteredEntries.map((e) => e.id));
      let matchCount = 0;
      for (const id of selectedIdsArray) {
        if (filteredSet.has(id)) matchCount++;
      }
      return matchCount === filteredEntries.length;
    }
    return filteredEntries.every((e) => selectedIds.has(e.id));
  });

  let estimatedSizeDebounced = $state<string | null>(null);
  let sizeCalcTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const _ = [
      selectedIds.size,
      Object.keys(perItemSettingsObj).length,
      playlistInfo?.entries.length,
    ];

    if (sizeCalcTimer) clearTimeout(sizeCalcTimer);
    sizeCalcTimer = setTimeout(() => {
      estimatedSizeDebounced = calculateEstimatedSize();
    }, 200);
  });

  function calculateEstimatedSize(): string | null {
    if (!playlistInfo || selectedIds.size === 0) return null;

    let totalSeconds = 0;
    let audioSeconds = 0;
    let videoSeconds = 0;

    for (const entry of playlistInfo.entries) {
      if (!selectedIds.has(entry.id) || !entry.duration) continue;

      const settings = perItemSettingsObj[entry.id];
      const mode = settings?.downloadMode ?? (isYouTubeMusicUrl ? 'audio' : 'auto');

      if (mode === 'audio') {
        audioSeconds += entry.duration;
      } else {
        videoSeconds += entry.duration;
      }
      totalSeconds += entry.duration;
    }

    if (totalSeconds === 0) return null;

    const audioBytes = audioSeconds * 16 * 1024; // 128kbps
    const videoBytes = videoSeconds * 312 * 1024; // ~2.5Mbps for 720p

    const totalBytes = audioBytes + videoBytes;
    return totalBytes > 0 ? formatSize(totalBytes) : null;
  }

  let estimatedSize = $derived(() => estimatedSizeDebounced);

  function getDefaultSettings(isMusic: boolean): EntrySettings {
    const mode: DownloadMode = isYouTubeMusicUrl ? 'audio' : 'auto';
    return {
      downloadMode: mode,
      skipSponsors: globalSkipSponsors,
      skipIntros: globalSkipIntros,
      embedChapters: globalEmbedChapters,
      embedThumbnail: globalEmbedThumbnail,
      embedMetadata: globalEmbedMetadata,
      embedSubs: globalEmbedSubs,
      subLangs: globalSubLangs,
    };
  }

  function getEntrySettings(entry: PlaylistEntry): EntrySettings {
    const stored = perItemSettingsObj[entry.id];
    const mode = stored?.downloadMode ?? (isYouTubeMusicUrl ? 'audio' : 'auto');
    return {
      downloadMode: mode,
      skipSponsors: globalSkipSponsors,
      skipIntros: globalSkipIntros,
      embedChapters: globalEmbedChapters,
      embedThumbnail: globalEmbedThumbnail,
      embedMetadata: globalEmbedMetadata,
      embedSubs: globalEmbedSubs,
      subLangs: globalSubLangs,
    };
  }

  function handleOpenItem(mediaItem: MediaItemData) {
    const entry = playlistInfo?.entries.find((e) => e.id === mediaItem.id);
    if (entry && onopenitem) {
      onopenitem(entry);
    }
  }

  function saveToCache() {
    if (playlistInfo && url) {
      viewStateCache.set<PlaylistViewState>({
        type: 'playlist',
        url,
        playlistInfo,
        selectedIds: [...selectedIdsArray],
        perItemSettings: { ...perItemSettingsObj },
        scrollTop: currentScrollTop,
        viewMode,
        searchQuery,
        timestamp: Date.now(),
      });
    }
  }

  $effect(() => {
    // Only load if URL changed and we don't already have data (from initial cache load)
    if (url && url !== lastLoadedUrl && !playlistInfo) {
      loadPlaylist();
    }
  });

  $effect(() => {
    return () => {
      saveToCache();
    };
  });

  async function loadPlaylist() {
    loading = true;
    error = null;
    playlistInfo = null;
    selectedIdsArray = [];
    perItemSettingsObj = {};
    lastLoadedUrl = url;
    usePlaylistFolder = $settings.usePlaylistFolders ?? true;

    try {
      let info: PlaylistInfo;

      if (isAndroid()) {
        info = (await getPlaylistInfoOnAndroid(url)) as PlaylistInfo;
      } else {
        info = await invoke<PlaylistInfo>('get_playlist_info', {
          url,
          offset: 0,
          limit: 100,
          cookiesFromBrowser: cookiesFromBrowser || null,
          customCookies: customCookies || null,
          proxyConfig: getProxyConfig(),
        });

        while (info.has_more && info.total_count > 0) {
          const currentOffset = info.entries.length;
          const moreInfo = await invoke<PlaylistInfo>('get_playlist_info', {
            url,
            offset: currentOffset,
            limit: 100,
            cookiesFromBrowser: cookiesFromBrowser || null,
            customCookies: customCookies || null,
            proxyConfig: getProxyConfig(),
          });

          info = {
            ...info,
            entries: [...info.entries, ...moreInfo.entries],
            has_more: moreInfo.has_more,
          };
        }
      }

      playlistInfo = info;

      const seen = new Set<string>();
      const uniqueEntries = info.entries.filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      playlistInfo = { ...info, entries: uniqueEntries, total_count: uniqueEntries.length };

      selectedIdsArray = uniqueEntries.map((e) => e.id);

      const newSettings: Record<string, MediaItemSettings> = {};
      for (const e of uniqueEntries) {
        newSettings[e.id] = getDefaultSettings(e.is_music);
      }
      perItemSettingsObj = newSettings;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function toggleSelectAll() {
    if (allSelected) {
      const filteredIds = new Set(filteredEntries.map((e) => e.id));
      selectedIdsArray = selectedIdsArray.filter((id) => !filteredIds.has(id));
    } else {
      const currentSet = new Set(selectedIdsArray);
      const newIds = filteredEntries.filter((e) => !currentSet.has(e.id)).map((e) => e.id);
      selectedIdsArray = [...selectedIdsArray, ...newIds];
    }
  }

  function toggleEntry(id: string) {
    if (selectedIds.has(id)) {
      selectedIdsArray = selectedIdsArray.filter((i) => i !== id);
    } else {
      selectedIdsArray = [...selectedIdsArray, id];
    }
  }

  function updateEntrySettings(id: string, newSettings: Partial<MediaItemSettings>) {
    const entry = playlistInfo?.entries.find((e) => e.id === id);
    const current = perItemSettingsObj[id] ?? getDefaultSettings(entry?.is_music ?? false);
    const updated = { ...current, ...newSettings } as MediaItemSettings;
    perItemSettingsObj = { ...perItemSettingsObj, [id]: updated };
  }

  const downloadOrderOptions = [
    { value: 'queue', label: $t('playlist.order.queue') },
    { value: 'reverse', label: $t('playlist.order.reverse') },
    { value: 'shuffle', label: $t('playlist.order.shuffle') },
  ];

  function handleDownload() {
    if (!playlistInfo || selectedCount === 0) return;

    let entries = playlistInfo.entries
      .filter((e) => selectedIds.has(e.id))
      .map((e) => ({
        entry: e,
        settings: getEntrySettings(e),
      }));

    switch (downloadOrder) {
      case 'reverse':
        entries = entries.reverse();
        break;
      case 'shuffle':
        entries = entries.sort(() => Math.random() - 0.5);
        break;
    }

    const selection: PlaylistSelection = {
      entries,
      playlistInfo: {
        id: playlistInfo?.id ?? '',
        title: playlistInfo?.title ?? 'Playlist',
        usePlaylistFolder,
      },
    };

    ondownload?.(selection);
  }
</script>

<div class="playlist-builder" class:full-bleed={showHeader}>
  {#if showHeader}
    <div class="view-header">
      <button class="back-btn" onclick={onback}>
        <Icon name="alt_arrow_rigth" size={16} class="rotate-180" />
        <span>{backLabel || $t('common.back')}</span>
      </button>
      <div class="header-badge playlist">
        <Icon name="playlist" size={12} />
        <span>Playlist</span>
      </div>
      <div class="header-spacer"></div>
      {#if estimatedSize()}
        <span class="size-estimate">~{estimatedSize()}</span>
      {/if}
      <button
        class="header-download-btn"
        onclick={handleDownload}
        disabled={loading || selectedCount === 0}
      >
        <Icon name="download" size={16} />
        <span>{$t('common.download')} {selectedCount > 0 ? `(${selectedCount})` : ''}</span>
      </button>
    </div>
  {:else}
    <div class="yt-badge">
      <Icon name="playlist" size={14} />
      <span>YouTube Playlist</span>
    </div>
  {/if}

  <div class="card">
    {#if error}
      <div class="error-state">
        <Icon name="warning" size={18} />
        <span>{error}</span>
        <button class="retry-btn" onclick={loadPlaylist}>
          <Icon name="restart" size={14} />
        </button>
      </div>
    {:else}
      <div class="main-row">
        <div class="left">
          {#if loading}
            <div class="thumb skeleton"></div>
          {:else if playlistInfo?.thumbnail}
            <img src={playlistInfo.thumbnail} alt="" class="thumb" />
          {:else}
            <div class="thumb empty"><Icon name="playlist" size={showHeader ? 32 : 20} /></div>
          {/if}
          <div class="info">
            {#if loading}
              <div class="title-skel skeleton"></div>
              <div class="meta-skel skeleton"></div>
            {:else if playlistInfo}
              <span class="title">{playlistInfo.title}</span>
              <span class="meta">
                {#if playlistInfo.uploader}<span class="author"
                    ><Icon name="user" size={12} />{playlistInfo.uploader}</span
                  >{/if}
                <span class="meta-item"
                  ><Icon name="video" size={12} />{playlistInfo.total_count}
                  {$t('playlist.videos')}</span
                >
                {#if getTotalDuration(playlistInfo.entries)}<span class="meta-item"
                    ><Icon name="clock" size={12} />{formatDuration(
                      getTotalDuration(playlistInfo.entries)!
                    )}</span
                  >{/if}
              </span>
            {/if}
          </div>
        </div>

        <div class="right">
          <div class="mode-selector">
            <button
              class="mode-btn"
              class:active={bulkMode === 'auto' || (!bulkMode && !isYouTubeMusicUrl)}
              onclick={() => applyModeToAll('auto')}
              disabled={loading}
            >
              <Icon name="download" size={14} />
              <span>Auto</span>
            </button>
            <button
              class="mode-btn"
              class:active={bulkMode === 'audio' || (!bulkMode && isYouTubeMusicUrl)}
              onclick={() => applyModeToAll('audio')}
              disabled={loading}
            >
              <Icon name="music" size={14} />
              <span>Audio</span>
            </button>
            <button
              class="mode-btn"
              class:active={bulkMode === 'mute'}
              onclick={() => applyModeToAll('mute')}
              disabled={loading}
            >
              <Icon name="video2" size={14} />
              <span>No Audio</span>
            </button>
          </div>
        </div>
      </div>

      <div class="extras-row">
        <Checkbox
          checked={usePlaylistFolder}
          label={$t('playlist.createFolder')}
          disabled={loading}
          onchange={(v: boolean) => (usePlaylistFolder = v)}
        />
        <div class="spacer"></div>
        <button
          class="more-btn"
          class:active={showMoreOptions}
          onclick={() => (showMoreOptions = !showMoreOptions)}
        >
          <Icon name={showMoreOptions ? 'chevron_up' : 'chevron_down'} size={14} />
          <span>More</span>
        </button>
        <button
          class="entries-toggle"
          onclick={() => (showEntries = !showEntries)}
          disabled={loading}
        >
          <span class="selected-badge">{selectedCount}/{playlistInfo?.total_count ?? 0}</span>
          <Icon name={showEntries ? 'chevron_up' : 'chevron_down'} size={14} />
          <span>videos</span>
        </button>
      </div>

      {#if showMoreOptions}
        <div class="more-options">
          <div class="options-row">
            <div class="option-group compact">
              <span class="group-label">{$t('download.videoQuality')}</span>
              <Select
                bind:value={globalVideoQuality}
                options={videoQualityOptions}
                disabled={loading}
              />
            </div>
            <div class="option-group compact">
              <span class="group-label">{$t('download.audioQuality')}</span>
              <Select
                bind:value={globalAudioQuality}
                options={audioQualityOptions}
                disabled={loading}
              />
            </div>
            <div class="option-group compact">
              <span class="group-label">{$t('playlist.downloadOrder')}</span>
              <Select
                bind:value={downloadOrder}
                options={downloadOrderOptions}
                disabled={loading}
              />
            </div>
          </div>

          <div class="options-row">
            <div class="option-group">
              <span class="group-label">
                <span>SponsorBlock</span>
              </span>
              <div class="option-grid">
                <Checkbox
                  bind:checked={globalSkipSponsors}
                  label={$t('download.tracks.skipSponsors')}
                />
                <Checkbox
                  bind:checked={globalSkipIntros}
                  label={$t('download.tracks.skipIntros')}
                />
              </div>
            </div>

            <div class="option-group">
              <span class="group-label">{$t('download.tracks.embedOptions')}</span>
              <div class="option-grid">
                <Checkbox
                  bind:checked={globalEmbedChapters}
                  label={$t('download.tracks.embedChapters')}
                />
                <Checkbox
                  bind:checked={globalEmbedThumbnail}
                  label={$t('download.tracks.embedThumbnail')}
                />
                <Checkbox
                  bind:checked={globalEmbedMetadata}
                  label={$t('download.tracks.embedMetadata')}
                />
              </div>
            </div>

            <div class="option-group">
              <span class="group-label">{$t('download.tracks.subtitles')}</span>
              <div class="subs-row">
                <Checkbox bind:checked={globalEmbedSubs} label={$t('download.tracks.embedSubs')} />
                {#if globalEmbedSubs}
                  <input
                    type="text"
                    class="lang-input"
                    bind:value={globalSubLangs}
                    placeholder="en"
                  />
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/if}

      {#if showEntries && playlistInfo}
        <div class="entries-panel">
          <div class="entries-toolbar">
            <div class="search-box">
              <Icon name="search" size={14} />
              <input type="text" bind:value={searchQuery} placeholder={$t('playlist.search')} />
              {#if searchQuery}
                <button class="clear-btn" onclick={() => (searchQuery = '')}>
                  <Icon name="close" size={12} />
                </button>
              {/if}
            </div>

            <div class="toolbar-right">
              <div class="view-toggle">
                <button
                  class="view-btn"
                  class:active={viewMode === 'list'}
                  onclick={() => (viewMode = 'list')}
                  use:tooltip={$t('downloads.views.list')}
                >
                  <Icon name="checklist" size={16} />
                </button>
                <button
                  class="view-btn"
                  class:active={viewMode === 'grid'}
                  onclick={() => (viewMode = 'grid')}
                  use:tooltip={$t('downloads.views.grid')}
                >
                  <Icon name="gallery" size={16} />
                </button>
              </div>

              <button class="select-all-btn" onclick={toggleSelectAll}>
                <Checkbox checked={allSelected} disabled />
                <span>{allSelected ? $t('playlist.deselectAll') : $t('playlist.selectAll')}</span>
              </button>
            </div>
          </div>

          <div class="entries-container">
            <MediaGrid
              items={mediaItems}
              {selectedIds}
              {viewMode}
              perItemSettings={perItemSettingsObj}
              {loading}
              initialScrollTop={currentScrollTop}
              ontoggle={toggleEntry}
              onupdatesettings={updateEntrySettings}
              onopenitem={onopenitem ? handleOpenItem : undefined}
              onscroll={(pos) => {
                currentScrollTop = pos;
              }}
            />
          </div>
        </div>
      {/if}

      {#if !showHeader && ondownload}
        <div class="footer-actions">
          {#if estimatedSize()}
            <span class="size-estimate">~{estimatedSize()}</span>
          {/if}
          <button
            class="download-btn footer-download"
            onclick={handleDownload}
            disabled={loading || selectedCount === 0}
          >
            <Icon name="download" size={18} />
            <span
              >{$t('common.download')}
              {selectedCount > 0 ? `(${selectedCount} ${$t('playlist.videos')})` : ''}</span
            >
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .playlist-builder {
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: fadeIn 0.2s ease-out;
  }

  .playlist-builder.full-bleed {
    margin: 0 -8px 0 -16px;
    padding: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .playlist-builder.full-bleed .view-header {
    position: sticky;
    top: 0;
    z-index: 10;
    margin: 0;
    padding: 10px 16px 10px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .playlist-builder.full-bleed .card {
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0 16px 16px 16px;
    flex: 1;
    overflow-y: auto;
  }

  .playlist-builder.full-bleed .yt-badge {
    display: none;
  }

  .playlist-builder.full-bleed .entries-container {
    max-height: none;
    border-radius: 0;
    background: transparent;
    margin: 0 -16px;
    padding: 6px 16px 16px 16px;
  }

  /* View header with back and download buttons */
  .view-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    flex-wrap: wrap;
    min-width: 0;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    min-width: 0;
    flex-shrink: 1;
  }

  .back-btn span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }

  .back-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
  }

  .header-badge {
    display: none; /* Hide on mobile, show via media query */
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    background: rgba(255, 0, 0, 0.12);
    border-radius: 6px;
    color: #ff6b6b;
    font-size: 11px;
    font-weight: 600;
  }

  @media (min-width: 400px) {
    .header-badge {
      display: inline-flex;
    }
  }

  .header-badge.playlist {
    background: rgba(255, 165, 0, 0.12);
    color: #ffa500;
  }

  .header-spacer {
    flex: 1;
    min-width: 8px;
  }

  .size-estimate {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    font-weight: 500;
    flex-shrink: 0;
  }

  .header-download-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    color: white;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .header-download-btn span {
    display: none;
  }

  @media (min-width: 360px) {
    .header-download-btn span {
      display: inline;
    }
  }

  .header-download-btn:hover:not(:disabled) {
    background: var(--accent, #6366f1);
    border-color: var(--accent, #6366f1);
  }

  .header-download-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .download-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--accent, #6366f1);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .download-btn:hover:not(:disabled) {
    background: var(--accent-hover, #5558e3);
    transform: translateY(-1px);
  }

  .download-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Footer actions */
  .footer-actions {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    justify-content: flex-end;
  }

  .footer-download {
    padding: 12px 24px;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .yt-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: rgba(255, 0, 0, 0.15);
    border-radius: 6px;
    color: #ff6b6b;
    font-size: 12px;
    font-weight: 600;
    width: fit-content;
  }

  .card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 12px;
  }

  .error-state {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    color: rgba(239, 68, 68, 0.9);
  }

  .retry-btn {
    margin-left: auto;
    padding: 6px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }

  .retry-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .main-row {
    display: flex;
    gap: 14px;
    padding: 4px 0;
  }

  .playlist-builder.full-bleed .main-row {
    gap: 16px;
    padding: 12px 0;
  }

  .left {
    display: flex;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .thumb {
    width: 72px;
    height: 72px;
    border-radius: 8px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.04);
  }

  .playlist-builder.full-bleed .thumb {
    width: 120px;
    height: 120px;
    border-radius: 10px;
  }

  .thumb.empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.2);
  }

  .info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  .playlist-builder.full-bleed .info {
    gap: 6px;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.3;
  }

  .playlist-builder.full-bleed .title {
    font-size: 16px;
    line-height: 1.35;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.45);
  }

  .playlist-builder.full-bleed .meta {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }

  .meta .author,
  .meta .meta-item {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .meta .author {
    font-weight: 500;
    color: rgba(255, 255, 255, 0.6);
  }

  .meta .author::after {
    content: '•';
    margin-left: 5px;
    color: rgba(255, 255, 255, 0.3);
  }

  .meta .meta-item::after {
    content: '•';
    margin-left: 5px;
    color: rgba(255, 255, 255, 0.3);
  }

  .meta .meta-item:last-child::after {
    display: none;
  }

  .playlist-builder.full-bleed .meta .author {
    color: rgba(255, 255, 255, 0.7);
  }

  .right {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    align-items: center;
  }

  /* Mode selector in main row */
  .mode-selector {
    display: flex;
    gap: 2px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 8px;
    padding: 3px;
  }

  .mode-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .mode-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
  }

  .mode-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mode-btn.active {
    background: var(--accent, #6366f1);
    color: white;
  }

  /* Extras row */
  .extras-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .spacer {
    flex: 1;
  }

  .entries-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .entries-toggle:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .entries-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .selected-badge {
    padding: 2px 6px;
    background: var(--accent, #6366f1);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    color: white;
  }

  /* Entries panel */
  .entries-panel {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .entries-toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    align-items: center;
  }

  .search-box {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
  }

  .search-box :global(svg) {
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .search-box input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: white;
    font-size: 12px;
    min-width: 0;
  }

  .search-box input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }

  /* View toggle */
  .view-toggle {
    display: flex;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 3px;
    gap: 2px;
  }

  .view-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 4px;
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

  .select-all-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .select-all-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* Entries container */
  .entries-container {
    max-height: 400px;
    overflow-y: auto;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.2);
    padding: 6px;
  }

  /* More options */
  .more-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .more-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
  }

  .more-btn.active {
    color: var(--accent, #6366f1);
    border-color: var(--accent, #6366f1);
    background: rgba(99, 102, 241, 0.1);
  }

  .more-options {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 8px;
    margin-top: 10px;
  }

  .options-row {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 120px;
  }

  .option-group.compact {
    min-width: 100px;
  }

  .group-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.4);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 500;
  }

  .option-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
  }

  .subs-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .lang-input {
    flex: 1;
    max-width: 200px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: white;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }

  .lang-input::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  .lang-input:focus {
    border-color: var(--accent, #6366f1);
  }

  .lang-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Skeleton */
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

  .title-skel {
    height: 14px;
    width: 90%;
  }

  .meta-skel {
    height: 10px;
    width: 50%;
  }

  /* Mobile */
  @media (max-width: 560px) {
    .main-row {
      flex-direction: column;
      gap: 12px;
    }

    .thumb {
      width: 64px;
      height: 64px;
    }

    .right {
      width: 100%;
    }

    .mode-selector {
      width: 100%;
      justify-content: center;
    }

    .mode-btn {
      flex: 1;
      justify-content: center;
    }

    .extras-row {
      flex-wrap: wrap;
      gap: 6px;
    }

    .entries-toolbar {
      flex-wrap: wrap;
    }

    .search-box {
      width: 100%;
      order: 1;
    }

    .view-toggle {
      order: 2;
    }

    .select-all-btn {
      order: 3;
      flex: 1;
      justify-content: center;
    }

    .entries-container {
      max-height: 300px;
    }

    .playlist-builder.full-bleed .entries-container {
      max-height: none;
    }
  }

  /* Utility classes */
  :global(.rotate-180) {
    transform: rotate(180deg);
  }
</style>
