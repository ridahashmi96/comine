import { writable, derived, get } from 'svelte/store';
import { settings } from './settings';
import { translate, locale } from '$lib/i18n';

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  author: string;
  thumbnail: string;
  extension: string;
  size: number; // bytes
  duration: number; // seconds
  filePath: string;
  downloadedAt: number; // timestamp
  type: 'video' | 'audio' | 'image';
  // Playlist grouping (optional)
  playlistId?: string;
  playlistTitle?: string;
  playlistIndex?: number;
}

export type FilterType = 'all' | 'video' | 'audio' | 'image';
export type SortType = 'date' | 'name' | 'size';

interface HistoryState {
  items: HistoryItem[];
  searchQuery: string;
  filter: FilterType;
  sort: SortType;
}

const STORAGE_KEY = 'comine_history';

function loadFromStorage(): HistoryItem[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveToStorage(items: HistoryItem[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Failed to save history:', e);
  }
}

function createHistoryStore() {
  const { subscribe, set, update } = writable<HistoryState>({
    items: [],
    searchQuery: '',
    filter: 'all',
    sort: 'date',
  });

  // Load history on init
  if (typeof window !== 'undefined') {
    const items = loadFromStorage();
    update(state => ({ ...state, items }));
  }

  return {
    subscribe,
    
    // Add a new item to history
    add(item: Omit<HistoryItem, 'id' | 'downloadedAt'>) {
      const newItem: HistoryItem = {
        ...item,
        id: crypto.randomUUID(),
        downloadedAt: Date.now(),
      };
      
      update(state => {
        const items = [newItem, ...state.items];
        saveToStorage(items);
        return { ...state, items };
      });
      
      return newItem;
    },
    
    // Remove an item by ID
    remove(id: string) {
      update(state => {
        const items = state.items.filter(item => item.id !== id);
        saveToStorage(items);
        return { ...state, items };
      });
    },
    
    // Clear all history
    clear() {
      update(state => {
        saveToStorage([]);
        return { ...state, items: [] };
      });
    },
    
    // Set search query
    setSearch(query: string) {
      update(state => ({ ...state, searchQuery: query }));
    },
    
    // Set filter type
    setFilter(filter: FilterType) {
      update(state => ({ ...state, filter }));
    },
    
    // Set sort type
    setSort(sort: SortType) {
      update(state => ({ ...state, sort }));
    },
    
    // Export history as JSON
    exportData(): string {
      const state = get({ subscribe });
      return JSON.stringify(state.items, null, 2);
    },
    
    // Import history from JSON
    importData(jsonData: string): boolean {
      try {
        const items = JSON.parse(jsonData) as HistoryItem[];
        if (!Array.isArray(items)) {
          throw new Error('Invalid data format');
        }
        // Validate items have required fields
        for (const item of items) {
          if (!item.id || !item.url || !item.title) {
            throw new Error('Invalid item structure');
          }
        }
        update(state => {
          saveToStorage(items);
          return { ...state, items };
        });
        return true;
      } catch (e) {
        console.error('Failed to import history:', e);
        return false;
      }
    },
    
    // Get raw items for export
    getItems(): HistoryItem[] {
      return get({ subscribe }).items;
    },
    
    // Update an item's duration (for fixing 0:00 durations from file metadata)
    updateDuration(id: string, duration: number) {
      update(state => {
        const items = state.items.map(item => 
          item.id === id ? { ...item, duration } : item
        );
        saveToStorage(items);
        return { ...state, items };
      });
    },
  };
}

export const history = createHistoryStore();

// Derived store for filtered and sorted items
export const filteredHistory = derived(history, ($history) => {
  let items = [...$history.items];
  
  // Apply search filter
  if ($history.searchQuery) {
    const query = $history.searchQuery.toLowerCase();
    items = items.filter(item => 
      item.title.toLowerCase().includes(query) ||
      item.author.toLowerCase().includes(query) ||
      item.extension.toLowerCase().includes(query)
    );
  }
  
  // Apply type filter
  if ($history.filter !== 'all') {
    items = items.filter(item => item.type === $history.filter);
  }
  
  // Apply sorting
  switch ($history.sort) {
    case 'date':
      items.sort((a, b) => b.downloadedAt - a.downloadedAt);
      break;
    case 'name':
      items.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'size':
      items.sort((a, b) => b.size - a.size);
      break;
  }
  
  return items;
});

// Derived store for grouped by date (reactive to locale changes)
export const groupedHistory = derived([filteredHistory, locale], ([$items, _locale]) => {
  const groups: { label: string; items: HistoryItem[] }[] = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const thisWeek = today - 7 * 86400000;
  const thisMonth = today - 30 * 86400000;
  
  const todayItems: HistoryItem[] = [];
  const yesterdayItems: HistoryItem[] = [];
  const thisWeekItems: HistoryItem[] = [];
  const thisMonthItems: HistoryItem[] = [];
  const olderItems: HistoryItem[] = [];
  
  for (const item of $items) {
    if (item.downloadedAt >= today) {
      todayItems.push(item);
    } else if (item.downloadedAt >= yesterday) {
      yesterdayItems.push(item);
    } else if (item.downloadedAt >= thisWeek) {
      thisWeekItems.push(item);
    } else if (item.downloadedAt >= thisMonth) {
      thisMonthItems.push(item);
    } else {
      olderItems.push(item);
    }
  }
  
  if (todayItems.length) groups.push({ label: translate('downloads.dateGroups.today'), items: todayItems });
  if (yesterdayItems.length) groups.push({ label: translate('downloads.dateGroups.yesterday'), items: yesterdayItems });
  if (thisWeekItems.length) groups.push({ label: translate('downloads.dateGroups.thisWeek'), items: thisWeekItems });
  if (thisMonthItems.length) groups.push({ label: translate('downloads.dateGroups.thisMonth'), items: thisMonthItems });
  if (olderItems.length) groups.push({ label: translate('downloads.dateGroups.older'), items: olderItems });
  
  return groups;
});

// Playlist group info for history UI
export interface HistoryPlaylistGroup {
  playlistId: string;
  playlistTitle: string;
  items: HistoryItem[];
  totalSize: number;
  totalDuration: number;
  downloadedAt: number; // Most recent download
  isExpanded: boolean;
}

// Derived store for playlist-grouped history (within each date group)
export const playlistGroupedHistory = derived([filteredHistory, locale, history], ([$items, _locale, $history]) => {
  const groups: { label: string; items: (HistoryItem | HistoryPlaylistGroup)[] }[] = [];
  const sortType = $history.sort;
  
  // For non-date sorting, don't group by date - just show all items
  if (sortType !== 'date') {
    const playlistMap = new Map<string, HistoryItem[]>();
    const singles: HistoryItem[] = [];
    
    for (const item of $items) {
      if (item.playlistId) {
        const existing = playlistMap.get(item.playlistId) || [];
        existing.push(item);
        playlistMap.set(item.playlistId, existing);
      } else {
        singles.push(item);
      }
    }
    
    const groupedItems: (HistoryItem | HistoryPlaylistGroup)[] = [];
    
    // Add playlist groups
    playlistMap.forEach((items, playlistId) => {
      items.sort((a, b) => (a.playlistIndex || 0) - (b.playlistIndex || 0));
      
      const totalSize = items.reduce((sum, i) => sum + (i.size || 0), 0);
      const totalDuration = items.reduce((sum, i) => sum + (i.duration || 0), 0);
      const downloadedAt = Math.max(...items.map(i => i.downloadedAt));
      
      groupedItems.push({
        playlistId,
        playlistTitle: items[0]?.playlistTitle || 'Playlist',
        items,
        totalSize,
        totalDuration,
        downloadedAt,
        isExpanded: false,
      });
    });
    
    groupedItems.push(...singles);
    
    // Sort based on user's sort choice
    if (sortType === 'name') {
      groupedItems.sort((a, b) => {
        const aName = 'playlistTitle' in a ? (a.playlistTitle || '') : a.title;
        const bName = 'playlistTitle' in b ? (b.playlistTitle || '') : b.title;
        return aName.localeCompare(bName);
      });
    } else if (sortType === 'size') {
      groupedItems.sort((a, b) => {
        const aSize = 'totalSize' in a ? a.totalSize : a.size;
        const bSize = 'totalSize' in b ? b.totalSize : b.size;
        return bSize - aSize;
      });
    }
    
    if (groupedItems.length > 0) {
      groups.push({ label: sortType === 'name' ? translate('downloads.sortedBy.name') : translate('downloads.sortedBy.size'), items: groupedItems });
    }
    
    return groups;
  }
  
  // Date-based grouping (original logic)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const thisWeek = today - 7 * 86400000;
  const thisMonth = today - 30 * 86400000;
  
  // Group items by date first
  const dateGroups: { label: string; items: HistoryItem[]; startTime: number }[] = [
    { label: translate('downloads.dateGroups.today'), items: [], startTime: today },
    { label: translate('downloads.dateGroups.yesterday'), items: [], startTime: yesterday },
    { label: translate('downloads.dateGroups.thisWeek'), items: [], startTime: thisWeek },
    { label: translate('downloads.dateGroups.thisMonth'), items: [], startTime: thisMonth },
    { label: translate('downloads.dateGroups.older'), items: [], startTime: 0 },
  ];
  
  for (const item of $items) {
    if (item.downloadedAt >= today) {
      dateGroups[0].items.push(item);
    } else if (item.downloadedAt >= yesterday) {
      dateGroups[1].items.push(item);
    } else if (item.downloadedAt >= thisWeek) {
      dateGroups[2].items.push(item);
    } else if (item.downloadedAt >= thisMonth) {
      dateGroups[3].items.push(item);
    } else {
      dateGroups[4].items.push(item);
    }
  }
  
  // Within each date group, group by playlist
  for (const dateGroup of dateGroups) {
    if (dateGroup.items.length === 0) continue;
    
    const playlistMap = new Map<string, HistoryItem[]>();
    const singles: HistoryItem[] = [];
    
    for (const item of dateGroup.items) {
      if (item.playlistId) {
        const existing = playlistMap.get(item.playlistId) || [];
        existing.push(item);
        playlistMap.set(item.playlistId, existing);
      } else {
        singles.push(item);
      }
    }
    
    // Convert playlists to groups and mix with singles
    const groupedItems: (HistoryItem | HistoryPlaylistGroup)[] = [];
    
    // Add playlist groups
    playlistMap.forEach((items, playlistId) => {
      // Sort by playlistIndex within each group
      items.sort((a, b) => (a.playlistIndex || 0) - (b.playlistIndex || 0));
      
      const totalSize = items.reduce((sum, i) => sum + (i.size || 0), 0);
      const totalDuration = items.reduce((sum, i) => sum + (i.duration || 0), 0);
      const downloadedAt = Math.max(...items.map(i => i.downloadedAt));
      
      groupedItems.push({
        playlistId,
        playlistTitle: items[0]?.playlistTitle || 'Playlist',
        items,
        totalSize,
        totalDuration,
        downloadedAt,
        isExpanded: false,
      });
    });
    
    // Add singles
    groupedItems.push(...singles);
    
    // Sort by downloadedAt (most recent first)
    groupedItems.sort((a, b) => {
      const aTime = 'downloadedAt' in a ? a.downloadedAt : (a as HistoryPlaylistGroup).downloadedAt;
      const bTime = 'downloadedAt' in b ? b.downloadedAt : (b as HistoryPlaylistGroup).downloadedAt;
      return bTime - aTime;
    });
    
    groups.push({ label: dateGroup.label, items: groupedItems });
  }
  
  return groups;
});

// Helper to check if an item is a playlist group
export function isPlaylistGroup(item: HistoryItem | HistoryPlaylistGroup): item is HistoryPlaylistGroup {
  return 'playlistId' in item && 'items' in item && Array.isArray((item as HistoryPlaylistGroup).items);
}

// Statistics derived store
export const historyStats = derived(history, ($history) => {
  const items = $history.items;
  const totalDownloads = items.length;
  const totalSize = items.reduce((sum: number, item: HistoryItem) => sum + (item.size || 0), 0);
  const totalDuration = items.reduce((sum: number, item: HistoryItem) => sum + (item.duration || 0), 0);
  
  // Count by extension
  const formatCounts: Record<string, number> = {};
  for (const item of items) {
    const ext = item.extension || 'unknown';
    formatCounts[ext] = (formatCounts[ext] || 0) + 1;
  }
  
  // Most common format
  const mostCommonFormat = Object.entries(formatCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
  
  return {
    totalDownloads,
    totalSize,
    totalDuration,
    formatCounts,
    mostCommonFormat
  };
});

// Helper to format file size (respects sizeUnit setting)
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  // Get current sizeUnit setting
  let sizeUnit: 'binary' | 'decimal' = 'binary';
  settings.subscribe(s => sizeUnit = s.sizeUnit)();
  
  const k = sizeUnit === 'binary' ? 1024 : 1000;
  const sizes = sizeUnit === 'binary' 
    ? ['B', 'KiB', 'MiB', 'GiB'] 
    : ['B', 'kB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper to format duration
export function formatDuration(seconds: number): string {
  if (seconds === 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
