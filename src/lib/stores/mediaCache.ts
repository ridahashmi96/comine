import { writable, derived, get } from 'svelte/store';

export interface MediaPreview {
  title?: string;
  thumbnail?: string;
  author?: string;
  duration?: number;
  entryCount?: number; // For playlists
  isPlaylist?: boolean;
  isMusic?: boolean;
}

export interface VideoInfo {
  title: string;
  author: string | null;
  thumbnail: string | null;
  duration: number | null;
  viewCount: number | null;
  likeCount: number | null;
  uploadDate: string | null;
  description: string | null;
  channelUrl: string | null;
  channelId: string | null;
}

export interface VideoFormat {
  formatId: string;
  ext: string;
  resolution: string | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  filesize: number | null;
  filesizeApprox: number | null;
  tbr: number | null;
  vbr: number | null;
  abr: number | null;
  asr: number | null;
  formatNote: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface PlaylistEntry {
  id: string;
  url: string;
  title: string;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
  isMusic: boolean;
}

export interface PlaylistInfo {
  isPlaylist: boolean;
  id: string | null;
  title: string;
  uploader: string | null;
  thumbnail: string | null;
  totalCount: number;
  entries: PlaylistEntry[];
  hasMore: boolean;
}

export interface ChannelEntry {
  id: string;
  url: string;
  title: string;
  duration: number | null;
  thumbnail: string | null;
  viewCount: number | null;
  uploadDate: string | null;
  isShort: boolean;
  isLive: boolean;
}

export interface ChannelInfo {
  id: string | null;
  name: string;
  handle: string | null;
  description: string | null;
  thumbnail: string | null;
  banner: string | null;
  subscriberCount: number | null;
  totalCount: number;
  entries: ChannelEntry[];
  hasMore: boolean;
}

export interface CacheEntry {
  url: string;
  type: 'video' | 'playlist' | 'channel' | 'unknown';

  preview: MediaPreview | null;
  videoInfo: VideoInfo | null;
  formats: VideoFormat[] | null;
  playlistInfo: PlaylistInfo | null;
  channelInfo: ChannelInfo | null;

  uiState: {
    scrollTop: number;
    selectedMode?: 'all' | 'some';
    selectedIds: string[];
    deselectedIds?: string[];
    perItemSettings: Record<string, any>;
    viewMode: 'list' | 'grid';
    searchQuery: string;
    selectedVideo: string;
    selectedAudio: string;
    channelTab?: 'videos' | 'shorts' | 'live';
  } | null;

  createdAt: number;
  lastAccessedAt: number;
  previewUpdatedAt: number | null;
  videoInfoUpdatedAt: number | null;
  formatsUpdatedAt: number | null;
  playlistInfoUpdatedAt: number | null;
  channelInfoUpdatedAt: number | null;
}

const CONFIG = {
  maxEntries: 100,
  maxUiStateEntries: 30,
  ttl: {
    preview: 60 * 60 * 1000,
    videoInfo: 30 * 60 * 1000,
    formats: 15 * 60 * 1000,
    playlistInfo: 30 * 60 * 1000,
    channelInfo: 30 * 60 * 1000,
    uiState: 60 * 60 * 1000,
  },

  debug: false,
};

class UnifiedMediaCache {
  private cache: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = [];
  private store = writable<Map<string, CacheEntry>>(this.cache);

  private uiStateCache: Map<string, { state: NonNullable<CacheEntry['uiState']>; updatedAt: number }> =
    new Map();
  private uiStateAccessOrder: string[] = [];

  private normalizeUrl(url: string): string {
    if (!url) return '';

    try {
      const parsed = new URL(url);

      if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
        if (parsed.hostname.includes('youtu.be')) {
          const videoId = parsed.pathname.slice(1);
          const playlistId = parsed.searchParams.get('list');
          if (playlistId) {
            return `youtube:playlist:${playlistId}`;
          }
          return `youtube:video:${videoId}`;
        }

        const videoId = parsed.searchParams.get('v');
        const playlistId = parsed.searchParams.get('list');

        if (parsed.pathname.includes('/playlist') && playlistId) {
          return `youtube:playlist:${playlistId}`;
        }

        if (videoId) {
          return `youtube:video:${videoId}`;
        }

        if (parsed.pathname.includes('/@') || parsed.pathname.includes('/channel/')) {
          const channelPart = parsed.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
          return `youtube:channel:${channelPart}`;
        }
      }

      parsed.hash = '';
      return parsed.toString();
    } catch {
      return url;
    }
  }

  get(url: string): CacheEntry | null {
    const key = this.normalizeUrl(url);
    const entry = this.cache.get(key);

    if (!entry) {
      this.log('MISS', url);
      return null;
    }

    this.touchAccessOrder(key);

    entry.lastAccessedAt = Date.now();

    this.log('HIT', url, entry);
    return entry;
  }

  has(url: string): boolean {
    const key = this.normalizeUrl(url);
    return this.cache.has(key);
  }

  private getOrCreate(url: string, opts?: { notify?: boolean }): CacheEntry {
    const key = this.normalizeUrl(url);
    let entry = this.cache.get(key);
    const shouldNotify = opts?.notify ?? true;

    if (!entry) {
      entry = this.createEntry(url);
      this.cache.set(key, entry);
      this.touchAccessOrder(key);
      this.evictIfNeeded();
      if (shouldNotify) {
        this.notifyChange();
      }
    }

    return entry;
  }

  private createEntry(url: string): CacheEntry {
    return {
      url,
      type: this.detectType(url),
      preview: null,
      videoInfo: null,
      formats: null,
      playlistInfo: null,
      channelInfo: null,
      uiState: null,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      previewUpdatedAt: null,
      videoInfoUpdatedAt: null,
      formatsUpdatedAt: null,
      playlistInfoUpdatedAt: null,
      channelInfoUpdatedAt: null,
    };
  }

  private touchUiStateAccessOrder(key: string): void {
    const idx = this.uiStateAccessOrder.indexOf(key);
    if (idx !== -1) {
      this.uiStateAccessOrder.splice(idx, 1);
    }
    this.uiStateAccessOrder.push(key);
  }

  private evictUiStateIfNeeded(): void {
    while (this.uiStateCache.size > CONFIG.maxUiStateEntries && this.uiStateAccessOrder.length > 0) {
      const oldest = this.uiStateAccessOrder.shift()!;
      this.uiStateCache.delete(oldest);
      this.log('EVICT_UI_STATE', oldest);
    }
  }

  private detectType(url: string): 'video' | 'playlist' | 'channel' | 'unknown' {
    const lower = url.toLowerCase();

    if (
      lower.includes('/@') ||
      lower.includes('/channel/') ||
      lower.includes('/c/') ||
      lower.includes('/user/')
    ) {
      return 'channel';
    }

    if (
      lower.includes('/playlist') ||
      (lower.includes('list=') && !lower.includes('v=')) ||
      lower.includes('/albums/') ||
      lower.includes('/sets/')
    ) {
      return 'playlist';
    }

    if (
      lower.includes('youtube.com/watch') ||
      lower.includes('youtu.be/') ||
      lower.includes('youtube.com/shorts/') ||
      lower.includes('music.youtube.com/watch')
    ) {
      return 'video';
    }

    return 'unknown';
  }

  private setPreviewInternal(
    url: string,
    preview: MediaPreview,
    opts?: { notify?: boolean; log?: boolean }
  ): void {
    const shouldNotify = opts?.notify ?? true;
    const entry = this.getOrCreate(url, { notify: shouldNotify });

    entry.preview = {
      ...entry.preview,
      ...preview,
    };
    entry.previewUpdatedAt = Date.now();
    entry.lastAccessedAt = Date.now();

    if (preview.isPlaylist !== undefined) {
      entry.type = preview.isPlaylist ? 'playlist' : 'video';
    }

    if (opts?.log !== false) {
      this.log('SET_PREVIEW', url, preview);
    }
    if (shouldNotify) {
      this.notifyChange();
    }
  }

  setPreview(url: string, preview: MediaPreview): void {
    this.setPreviewInternal(url, preview);
  }

  setVideoInfo(url: string, info: VideoInfo): void {
    const entry = this.getOrCreate(url);

    entry.videoInfo = info;
    entry.videoInfoUpdatedAt = Date.now();
    entry.lastAccessedAt = Date.now();
    entry.type = 'video';

    entry.preview = {
      ...entry.preview,
      title: info.title,
      thumbnail: info.thumbnail ?? entry.preview?.thumbnail,
      author: info.author ?? entry.preview?.author,
      duration: info.duration ?? entry.preview?.duration,
      isPlaylist: false,
    };
    entry.previewUpdatedAt = Date.now();

    this.log('SET_VIDEO_INFO', url, info);
    this.notifyChange();
  }

  setFormats(url: string, formats: VideoFormat[]): void {
    const entry = this.getOrCreate(url);

    entry.formats = formats;
    entry.formatsUpdatedAt = Date.now();
    entry.lastAccessedAt = Date.now();

    this.log('SET_FORMATS', url, `${formats.length} formats`);
    this.notifyChange();
  }

  setPlaylistInfo(url: string, info: PlaylistInfo): void {
    const entry = this.getOrCreate(url);

    entry.playlistInfo = info;
    entry.playlistInfoUpdatedAt = Date.now();
    entry.lastAccessedAt = Date.now();
    entry.type = 'playlist';

    entry.preview = {
      ...entry.preview,
      title: info.title,
      thumbnail: info.thumbnail ?? entry.preview?.thumbnail,
      author: info.uploader ?? entry.preview?.author,
      entryCount: info.totalCount,
      isPlaylist: true,
    };
    entry.previewUpdatedAt = Date.now();

    this.log('SET_PLAYLIST_INFO', url, `${info.totalCount} entries`);
    this.notifyChange();
  }

  setChannelInfo(url: string, info: ChannelInfo): void {
    const entry = this.getOrCreate(url);

    entry.channelInfo = info;
    entry.channelInfoUpdatedAt = Date.now();
    entry.lastAccessedAt = Date.now();
    entry.type = 'channel';

    entry.preview = {
      ...entry.preview,
      title: info.name,
      thumbnail: info.thumbnail ?? entry.preview?.thumbnail,
      author: info.handle ?? entry.preview?.author,
      entryCount: info.totalCount,
      isPlaylist: false,
    };
    entry.previewUpdatedAt = Date.now();

    this.log('SET_CHANNEL_INFO', url, `${info.totalCount} videos`);
    this.notifyChange();
  }

  setUIState(url: string, state: Partial<NonNullable<CacheEntry['uiState']>>): void {
    const key = this.normalizeUrl(url);
    const entry = this.getOrCreate(url);

    const existing = this.getUIState(url);
    const base: NonNullable<CacheEntry['uiState']> = {
      scrollTop: 0,
      selectedMode: 'some',
      selectedIds: [],
      deselectedIds: [],
      perItemSettings: {},
      viewMode: 'list',
      searchQuery: '',
      selectedVideo: 'best',
      selectedAudio: 'best',
    };

    const nextState: NonNullable<CacheEntry['uiState']> = {
      ...base,
      ...(existing ?? {}),
      ...state,
    };

    this.uiStateCache.set(key, { state: nextState, updatedAt: Date.now() });
    this.touchUiStateAccessOrder(key);
    this.evictUiStateIfNeeded();
    entry.lastAccessedAt = Date.now();

    this.log('SET_UI_STATE', url, state);
    this.notifyChange();
  }

  getPreview(url: string): MediaPreview | null {
    const entry = this.get(url);
    if (!entry?.preview) return null;

    if (entry.previewUpdatedAt && Date.now() - entry.previewUpdatedAt > CONFIG.ttl.preview) {
      return null;
    }

    return entry.preview;
  }

  getVideoInfo(url: string): VideoInfo | null {
    const entry = this.get(url);
    if (!entry?.videoInfo) return null;

    if (entry.videoInfoUpdatedAt && Date.now() - entry.videoInfoUpdatedAt > CONFIG.ttl.videoInfo) {
      return null;
    }

    return entry.videoInfo;
  }

  getFormats(url: string): VideoFormat[] | null {
    const entry = this.get(url);
    if (!entry?.formats) return null;

    if (entry.formatsUpdatedAt && Date.now() - entry.formatsUpdatedAt > CONFIG.ttl.formats) {
      return null;
    }

    return entry.formats;
  }

  getPlaylistInfo(url: string): PlaylistInfo | null {
    const entry = this.get(url);
    if (!entry?.playlistInfo) return null;

    if (
      entry.playlistInfoUpdatedAt &&
      Date.now() - entry.playlistInfoUpdatedAt > CONFIG.ttl.playlistInfo
    ) {
      return null;
    }

    return entry.playlistInfo;
  }

  getChannelInfo(url: string): ChannelInfo | null {
    const entry = this.get(url);
    if (!entry?.channelInfo) return null;

    if (
      entry.channelInfoUpdatedAt &&
      Date.now() - entry.channelInfoUpdatedAt > CONFIG.ttl.channelInfo
    ) {
      return null;
    }

    return entry.channelInfo;
  }

  getUIState(url: string): CacheEntry['uiState'] | null {
    const key = this.normalizeUrl(url);
    const entry = this.uiStateCache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.updatedAt > CONFIG.ttl.uiState) {
      this.uiStateCache.delete(key);
      this.uiStateAccessOrder = this.uiStateAccessOrder.filter((k) => k !== key);
      return null;
    }

    this.touchUiStateAccessOrder(key);
    return entry.state;
  }

  hasAnyData(url: string): boolean {
    const entry = this.get(url);
    if (!entry) return false;

    return !!(
      entry.preview ||
      entry.videoInfo ||
      entry.formats ||
      entry.playlistInfo ||
      entry.channelInfo
    );
  }

  getBestPreview(url: string): MediaPreview | null {
    const entry = this.get(url);
    if (!entry) return null;

    const preview: MediaPreview = {};

    if (entry.videoInfo) {
      preview.title = entry.videoInfo.title;
      preview.thumbnail = entry.videoInfo.thumbnail ?? undefined;
      preview.author = entry.videoInfo.author ?? undefined;
      preview.duration = entry.videoInfo.duration ?? undefined;
      preview.isPlaylist = false;
    }

    if (entry.channelInfo) {
      preview.title = entry.channelInfo.name;
      preview.thumbnail = entry.channelInfo.thumbnail ?? undefined;
      preview.author = entry.channelInfo.handle ?? undefined;
      preview.entryCount = entry.channelInfo.totalCount;
      preview.isPlaylist = false;
    }

    if (entry.playlistInfo) {
      preview.title = entry.playlistInfo.title;
      preview.thumbnail = entry.playlistInfo.thumbnail ?? undefined;
      preview.author = entry.playlistInfo.uploader ?? undefined;
      preview.entryCount = entry.playlistInfo.totalCount;
      preview.isPlaylist = true;
    }

    if (entry.preview) {
      if (!preview.title && entry.preview.title) preview.title = entry.preview.title;
      if (!preview.thumbnail && entry.preview.thumbnail)
        preview.thumbnail = entry.preview.thumbnail;
      if (!preview.author && entry.preview.author) preview.author = entry.preview.author;
      if (!preview.duration && entry.preview.duration) preview.duration = entry.preview.duration;
      if (entry.preview.isMusic !== undefined) preview.isMusic = entry.preview.isMusic;
    }

    return Object.keys(preview).length > 0 ? preview : null;
  }

  private touchAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  private evictIfNeeded(): void {
    while (this.cache.size > CONFIG.maxEntries && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift()!;
      this.cache.delete(oldest);
      this.log('EVICT', oldest);
    }
  }

  delete(url: string): void {
    const key = this.normalizeUrl(url);
    this.cache.delete(key);
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.uiStateCache.delete(key);
    this.uiStateAccessOrder = this.uiStateAccessOrder.filter((k) => k !== key);
    this.log('DELETE', url);
    this.notifyChange();
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.uiStateCache.clear();
    this.uiStateAccessOrder = [];
    this.log('CLEAR', 'all');
    this.notifyChange();
  }

  clearStale(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    const uiStateKeysToDelete: string[] = [];
    for (const [key, entry] of this.uiStateCache) {
      if (now - entry.updatedAt > CONFIG.ttl.uiState) {
        uiStateKeysToDelete.push(key);
      }
    }

    for (const key of uiStateKeysToDelete) {
      this.uiStateCache.delete(key);
      this.uiStateAccessOrder = this.uiStateAccessOrder.filter((k) => k !== key);
    }

    for (const [key, entry] of this.cache) {
      const previewStale =
        !entry.previewUpdatedAt || now - entry.previewUpdatedAt > CONFIG.ttl.preview;
      const videoInfoStale =
        !entry.videoInfoUpdatedAt || now - entry.videoInfoUpdatedAt > CONFIG.ttl.videoInfo;
      const formatsStale =
        !entry.formatsUpdatedAt || now - entry.formatsUpdatedAt > CONFIG.ttl.formats;
      const playlistInfoStale =
        !entry.playlistInfoUpdatedAt || now - entry.playlistInfoUpdatedAt > CONFIG.ttl.playlistInfo;
      const channelInfoStale =
        !entry.channelInfoUpdatedAt || now - entry.channelInfoUpdatedAt > CONFIG.ttl.channelInfo;

      if (previewStale && videoInfoStale && formatsStale && playlistInfoStale && channelInfoStale) {
        if (!this.uiStateCache.has(key)) keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
    }

    if (keysToDelete.length > 0) {
      this.log('CLEAR_STALE', `${keysToDelete.length} entries`);
      this.notifyChange();
    }
  }

  getStats(): {
    size: number;
    maxSize: number;
    videos: number;
    playlists: number;
    channels: number;
    withUIState: number;
  } {
    let videos = 0;
    let playlists = 0;
    let channels = 0;
    let withUIState = 0;

    for (const entry of this.cache.values()) {
      if (entry.type === 'video') videos++;
      if (entry.type === 'playlist') playlists++;
      if (entry.type === 'channel') channels++;
    }

    withUIState = this.uiStateCache.size;

    return {
      size: this.cache.size,
      maxSize: CONFIG.maxEntries,
      videos,
      playlists,
      channels,
      withUIState,
    };
  }

  subscribe = this.store.subscribe;

  private notifyChange(): void {
    this.store.set(this.cache);
  }

  private log(action: string, url: string, data?: any): void {
    if (CONFIG.debug) {
      console.log(`[MediaCache] ${action}: ${url}`, data ?? '');
    }
  }
}

export const mediaCache = new UnifiedMediaCache();

export function getCacheEntry(url: string) {
  return derived(mediaCache, ($cache) => {
    return mediaCache.get(url);
  });
}

export function getCachedPreview(url: string) {
  return derived(mediaCache, () => {
    return mediaCache.getBestPreview(url);
  });
}

export function convertBackendVideoInfo(backend: {
  title: string;
  uploader?: string | null;
  channel?: string | null;
  creator?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
  channel_url?: string | null;
  channel_id?: string | null;
}): VideoInfo {
  return {
    title: backend.title,
    author: backend.uploader ?? backend.channel ?? backend.creator ?? null,
    thumbnail: backend.thumbnail ?? null,
    duration: backend.duration ?? null,
    viewCount: null,
    likeCount: null,
    uploadDate: null,
    description: null,
    channelUrl: backend.channel_url ?? null,
    channelId: backend.channel_id ?? null,
  };
}

export function convertBackendFormats(backend: {
  title: string;
  author?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
  formats: Array<{
    format_id: string;
    ext: string;
    resolution?: string | null;
    fps?: number | null;
    vcodec?: string | null;
    acodec?: string | null;
    filesize?: number | null;
    filesize_approx?: number | null;
    tbr?: number | null;
    vbr?: number | null;
    abr?: number | null;
    asr?: number | null;
    format_note?: string | null;
    has_video: boolean;
    has_audio: boolean;
  }>;
  view_count?: number | null;
  like_count?: number | null;
  description?: string | null;
  upload_date?: string | null;
  channel_url?: string | null;
  channel_id?: string | null;
}): { info: VideoInfo; formats: VideoFormat[] } {
  return {
    info: {
      title: backend.title,
      author: backend.author ?? null,
      thumbnail: backend.thumbnail ?? null,
      duration: backend.duration ?? null,
      viewCount: backend.view_count ?? null,
      likeCount: backend.like_count ?? null,
      uploadDate: backend.upload_date ?? null,
      description: backend.description ?? null,
      channelUrl: backend.channel_url ?? null,
      channelId: backend.channel_id ?? null,
    },
    formats: backend.formats.map((f) => ({
      formatId: f.format_id,
      ext: f.ext,
      resolution: f.resolution ?? null,
      fps: f.fps ?? null,
      vcodec: f.vcodec ?? null,
      acodec: f.acodec ?? null,
      filesize: f.filesize ?? null,
      filesizeApprox: f.filesize_approx ?? null,
      tbr: f.tbr ?? null,
      vbr: f.vbr ?? null,
      abr: f.abr ?? null,
      asr: f.asr ?? null,
      formatNote: f.format_note ?? null,
      hasVideo: f.has_video,
      hasAudio: f.has_audio,
    })),
  };
}

export function convertBackendPlaylistInfo(backend: {
  is_playlist: boolean;
  id?: string | null;
  title: string;
  uploader?: string | null;
  thumbnail?: string | null;
  total_count: number;
  entries: Array<{
    id: string;
    url: string;
    title: string;
    duration?: number | null;
    thumbnail?: string | null;
    uploader?: string | null;
    is_music: boolean;
  }>;
  has_more: boolean;
}): PlaylistInfo {
  return {
    isPlaylist: backend.is_playlist,
    id: backend.id ?? null,
    title: backend.title,
    uploader: backend.uploader ?? null,
    thumbnail: backend.thumbnail ?? null,
    totalCount: backend.total_count,
    entries: backend.entries.map((e) => ({
      id: e.id,
      url: e.url,
      title: e.title,
      duration: e.duration ?? null,
      thumbnail: e.thumbnail ?? null,
      uploader: e.uploader ?? null,
      isMusic: e.is_music,
    })),
    hasMore: backend.has_more,
  };
}

export function convertBackendChannelInfo(backend: {
  id?: string | null;
  title?: string | null;
  channel?: string | null;
  uploader?: string | null;
  uploader_id?: string | null;
  channel_id?: string | null;
  description?: string | null;
  thumbnail?: string | null;
  thumbnails?: Array<{ url?: string }> | null;
  channel_follower_count?: number | null;
  entries?: Array<{
    id: string;
    url?: string;
    title?: string;
    duration?: number | null;
    thumbnail?: string | null;
    thumbnails?: Array<{ url?: string }> | null;
    view_count?: number | null;
    upload_date?: string | null;
    original_url?: string | null;
  }>;
  playlist_count?: number | null;
}): ChannelInfo {
  const entries = backend.entries ?? [];
  const name = backend.channel ?? backend.uploader ?? backend.title ?? 'Unknown Channel';
  const handle = backend.uploader_id ?? null;
  const thumbnail = backend.thumbnail ?? backend.thumbnails?.[0]?.url ?? null;

  return {
    id: backend.channel_id ?? backend.id ?? null,
    name,
    handle,
    description: backend.description ?? null,
    thumbnail,
    banner: null,
    subscriberCount: backend.channel_follower_count ?? null,
    totalCount: backend.playlist_count ?? entries.length,
    entries: entries.map((e) => {
      const videoUrl =
        e.url ?? e.original_url ?? (e.id ? `https://www.youtube.com/watch?v=${e.id}` : '');
      const isShort = videoUrl.includes('/shorts/') || (e.duration != null && e.duration < 61);
      const isLive = e.duration === null && e.view_count != null;

      return {
        id: e.id,
        url: videoUrl,
        title: e.title ?? 'Untitled',
        duration: e.duration ?? null,
        thumbnail: e.thumbnail ?? e.thumbnails?.[0]?.url ?? null,
        viewCount: e.view_count ?? null,
        uploadDate: e.upload_date ?? null,
        isShort,
        isLive,
      };
    }),
    hasMore: false,
  };
}
