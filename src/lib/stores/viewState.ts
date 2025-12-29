import type { MediaItemSettings } from '$lib/components/MediaGrid.svelte';

export interface PlaylistViewState {
  type: 'playlist';
  url: string;
  // Loaded data
  playlistInfo: {
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
  } | null;
  // User selections
  selectedIds: string[];
  perItemSettings: Record<string, MediaItemSettings>;
  // UI state
  scrollTop: number;
  viewMode: 'list' | 'grid';
  searchQuery: string;
  // Metadata
  timestamp: number;
}

export interface VideoViewState {
  type: 'video';
  url: string;
  // Loaded data
  info: {
    title: string;
    author: string;
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
  } | null;
  // User selections
  selectedVideo: string;
  selectedAudio: string;
  // UI state
  scrollTop: number;
  // Metadata
  timestamp: number;
}

export type ViewState = PlaylistViewState | VideoViewState;

const MAX_CACHE_SIZE = 10;
const CACHE_TTL = 10 * 60 * 1000;

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

  has(type: string, url: string): boolean {
    return this.get(type as any, url) !== null;
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
    playlistInfo: null,
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
    info: null,
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
