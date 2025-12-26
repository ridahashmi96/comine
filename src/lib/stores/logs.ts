import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { browser } from '$app/environment';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogFilters {
  levels: Set<LogLevel>;
  search: string;
}

interface LogsState {
  entries: LogEntry[];
  filters: LogFilters;
  maxEntries: number;
}

const initialState: LogsState = {
  entries: [],
  filters: {
    levels: new Set(['trace', 'debug', 'info', 'warn', 'error']),
    search: '',
  },
  maxEntries: 2000,
};

let sessionLogFile: string | null = null;
let isInitializing = false;

async function initLogging() {
  if (!browser || isInitializing || sessionLogFile) return;

  isInitializing = true;
  try {
    sessionLogFile = await invoke<string>('get_log_file_path');
    console.log('Log file initialized:', sessionLogFile);

    const deleted = await invoke<number>('cleanup_old_logs', { keepSessions: 10 });
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} old log files`);
    }
  } catch (e) {
    console.warn('Failed to initialize file logging:', e);
  } finally {
    isInitializing = false;
  }
}

async function writeToFile(entry: LogEntry) {
  if (!sessionLogFile) return;

  try {
    const time = entry.timestamp.toISOString();
    const line = `[${time}] [${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}`;
    await invoke('append_log', { sessionFile: sessionLogFile, entry: line });
  } catch (e) {}
}

function createLogsStore() {
  const { subscribe, set, update } = writable<LogsState>(initialState);

  let idCounter = 0;

  if (browser) {
    initLogging();
  }

  return {
    subscribe,

    log(level: LogLevel, source: string, message: string) {
      const entry: LogEntry = {
        id: `log-${++idCounter}`,
        timestamp: new Date(),
        level,
        source,
        message,
      };

      update((state) => {
        const entries = [entry, ...state.entries].slice(0, state.maxEntries);
        return { ...state, entries };
      });

      writeToFile(entry);
    },

    trace(source: string, message: string) {
      this.log('trace', source, message);
    },
    debug(source: string, message: string) {
      this.log('debug', source, message);
    },
    info(source: string, message: string) {
      this.log('info', source, message);
    },
    warn(source: string, message: string) {
      this.log('warn', source, message);
    },
    error(source: string, message: string) {
      this.log('error', source, message);
    },

    toggleLevel(level: LogLevel) {
      update((state) => {
        const levels = new Set(state.filters.levels);
        if (levels.has(level)) {
          levels.delete(level);
        } else {
          levels.add(level);
        }
        return { ...state, filters: { ...state.filters, levels } };
      });
    },

    setSearch(search: string) {
      update((state) => ({
        ...state,
        filters: { ...state.filters, search },
      }));
    },

    clear() {
      update((state) => ({ ...state, entries: [] }));
    },

    getFiltered(): LogEntry[] {
      const state = get({ subscribe });
      return state.entries.filter((entry) => {
        if (!state.filters.levels.has(entry.level)) return false;

        if (state.filters.search) {
          const search = state.filters.search.toLowerCase();
          return (
            entry.message.toLowerCase().includes(search) ||
            entry.source.toLowerCase().includes(search)
          );
        }

        return true;
      });
    },

    exportAsText(): string {
      const state = get({ subscribe });
      return state.entries
        .map((entry) => {
          const time = entry.timestamp.toISOString();
          return `[${time}] [${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}`;
        })
        .join('\n');
    },

    async openLogsFolder(): Promise<void> {
      try {
        await invoke('open_logs_folder');
      } catch (e) {
        console.error('Failed to open logs folder:', e);
      }
    },

    async getLogsPath(): Promise<string | null> {
      try {
        return await invoke<string>('get_logs_folder_path');
      } catch (e) {
        console.error('Failed to get logs path:', e);
        return null;
      }
    },
  };
}

export const logs = createLogsStore();

export const filteredLogs = derived(logs, ($logs) => {
  return $logs.entries.filter((entry) => {
    if (!$logs.filters.levels.has(entry.level)) return false;

    if ($logs.filters.search) {
      const search = $logs.filters.search.toLowerCase();
      return (
        entry.message.toLowerCase().includes(search) || entry.source.toLowerCase().includes(search)
      );
    }

    return true;
  });
});

export const logStats = derived(logs, ($logs) => {
  const counts = {
    trace: 0,
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    total: $logs.entries.length,
  };

  for (const entry of $logs.entries) {
    counts[entry.level]++;
  }

  return counts;
});
