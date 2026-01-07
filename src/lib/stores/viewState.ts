import type { MediaItemSettings } from '$lib/components/MediaGrid.svelte';
import { isAndroid } from '$lib/utils/android';

export interface CachedPlaylistInfo {
  is_playlist: boolean;
  id: string | null;
  title: string;
  uploader: string | null;
  thumbnail: string | null;
  total_count: number;
  entries: Array<{
    id: string;
    url: string;
    title: string;
    duration: number | null;
    thumbnail: string | null;
    uploader: string | null;
    is_music: boolean;
  }>;
  has_more: boolean;
}

export interface CachedVideoInfo {
  title: string;
  author: string | null;
  thumbnail: string | null;
  duration: number | null;
  view_count: number | null;
  like_count: number | null;
  upload_date: string | null;
  description: string | null;
  formats: Array<{
    format_id: string;
    ext: string;
    resolution: string | null;
    fps: number | null;
    vcodec: string | null;
    acodec: string | null;
    abr: number | null;
    filesize: number | null;
    filesize_approx: number | null;
    has_video: boolean;
    has_audio: boolean;
  }>;
}

export interface PlaylistViewState {
  type: 'playlist';
  url: string;
  selectedIds: string[];
  perItemSettings: Record<string, Partial<MediaItemSettings>>;
  scrollTop: number;
  viewMode: 'list' | 'grid';
  searchQuery: string;
  timestamp: number;
}

export interface VideoViewState {
  type: 'video';
  url: string;
  selectedVideo: string;
  selectedAudio: string;
  scrollTop: number;
  timestamp: number;
}

export type ViewState = PlaylistViewState | VideoViewState;

const MAX_CACHE_SIZE = 50;
const CACHE_TTL = 30 * 60 * 1000;

class ViewStateCache {
  private cache = new Map<string, ViewState>();
  private accessOrder: string[] = [];

  private getKey(type: string, url: string): string {
    return `${type}:${url}`;
  }

  get<T extends ViewState>(type: T['type'], url: string): T | null {
    const key = this.getKey(type, url);
    const state = this.cache.get(key) as T | undefined;

    if (!state) return null;

    if (Date.now() - state.timestamp > CACHE_TTL) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      return null;
    }

    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);

    return state;
  }

  set<T extends ViewState>(state: T): void {
    const key = this.getKey(state.type, state.url);

    this.cache.set(key, { ...state, timestamp: Date.now() });

    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);

    while (this.cache.size > MAX_CACHE_SIZE && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift()!;
      this.cache.delete(oldest);
    }
  }

  update<T extends ViewState>(
    type: T['type'],
    url: string,
    updates: Partial<Omit<T, 'type' | 'url' | 'timestamp'>>
  ): void {
    const existing = this.get<T>(type, url);
    if (existing) {
      this.set({ ...existing, ...updates } as T);
    }
  }

  has(type: ViewState['type'], url: string): boolean {
    return this.get(type, url) !== null;
  }

  delete(type: string, url: string): void {
    const key = this.getKey(type, url);
    this.cache.delete(key);
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: [...this.cache.keys()],
    };
  }
}

// Export singleton instance
export const viewStateCache = new ViewStateCache();

export function createPlaylistState(url: string): PlaylistViewState {
  return {
    type: 'playlist',
    url,
    selectedIds: [],
    perItemSettings: {},
    scrollTop: 0,
    viewMode: 'list',
    searchQuery: '',
    timestamp: Date.now(),
  };
}

export function createVideoState(url: string): VideoViewState {
  return {
    type: 'video',
    url,
    selectedVideo: 'best',
    selectedAudio: 'best',
    scrollTop: 0,
    timestamp: Date.now(),
  };
}

export function getPlaylistState(url: string): PlaylistViewState {
  return viewStateCache.get<PlaylistViewState>('playlist', url) ?? createPlaylistState(url);
}

export function getVideoState(url: string): VideoViewState {
  return viewStateCache.get<VideoViewState>('video', url) ?? createVideoState(url);
}

export function savePlaylistState(state: PlaylistViewState): void {
  viewStateCache.set(state);
}

export function saveVideoState(state: VideoViewState): void {
  viewStateCache.set(state);
}

class AndroidDataCache {
  private playlistCache = new Map<string, { data: CachedPlaylistInfo; timestamp: number }>();
  private videoCache = new Map<string, { data: CachedVideoInfo; timestamp: number }>();
  private readonly MAX_PLAYLISTS = 5;
  private readonly MAX_VIDEOS = 10;
  private readonly TTL = 10 * 60 * 1000;

  getPlaylist(url: string): CachedPlaylistInfo | null {
    const entry = this.playlistCache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.TTL) {
      this.playlistCache.delete(url);
      return null;
    }
    return entry.data;
  }

  setPlaylist(url: string, data: CachedPlaylistInfo): void {
    if (this.playlistCache.size >= this.MAX_PLAYLISTS) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.playlistCache) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) this.playlistCache.delete(oldestKey);
    }
    this.playlistCache.set(url, { data, timestamp: Date.now() });
  }

  getVideo(url: string): CachedVideoInfo | null {
    const entry = this.videoCache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.TTL) {
      this.videoCache.delete(url);
      return null;
    }
    return entry.data;
  }

  setVideo(url: string, data: CachedVideoInfo): void {
    if (this.videoCache.size >= this.MAX_VIDEOS) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.videoCache) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) this.videoCache.delete(oldestKey);
    }
    this.videoCache.set(url, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.playlistCache.clear();
    this.videoCache.clear();
  }
}

export const androidDataCache = new AndroidDataCache();

export function clearAllFrontendCaches(): void {
  viewStateCache.clear();
  androidDataCache.clear();
  console.log('[viewState] Cleared all frontend caches');
}
