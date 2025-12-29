import { writable, derived } from 'svelte/store';

export type ViewType = 'home' | 'video' | 'playlist' | 'channel';

export interface ViewState {
  type: ViewType;
  url?: string;
  channelId?: string;
  channelName?: string;
  cachedData?: {
    title?: string;
    thumbnail?: string;
    author?: string;
    duration?: number;
    entryCount?: number;
  };
}

interface NavigationState {
  stack: ViewState[];
}

function createNavigationStore() {
  const { subscribe, set, update } = writable<NavigationState>({
    stack: [{ type: 'home' }],
  });

  let currentState: NavigationState = { stack: [{ type: 'home' }] };

  subscribe((state) => {
    currentState = state;
  });

  return {
    subscribe,

    getStack(): ViewState[] {
      return currentState.stack;
    },

    push(view: ViewState) {
      update((state) => ({
        ...state,
        stack: [...state.stack, view],
      }));
    },

    pop(): boolean {
      let didPop = false;
      update((state) => {
        if (state.stack.length > 1) {
          didPop = true;
          return {
            ...state,
            stack: state.stack.slice(0, -1),
          };
        }
        return state;
      });
      return didPop;
    },

    replace(view: ViewState) {
      update((state) => ({
        ...state,
        stack: [...state.stack.slice(0, -1), view],
      }));
    },

    reset() {
      set({ stack: [{ type: 'home' }] });
    },

    goHome() {
      set({ stack: [{ type: 'home' }] });
    },

    openVideo(url: string, cachedData?: ViewState['cachedData']) {
      update((state) => ({
        ...state,
        stack: [...state.stack, { type: 'video', url, cachedData }],
      }));
    },

    openPlaylist(url: string, cachedData?: ViewState['cachedData']) {
      update((state) => ({
        ...state,
        stack: [...state.stack, { type: 'playlist', url, cachedData }],
      }));
    },

    openChannel(channelId: string, channelName?: string) {
      update((state) => ({
        ...state,
        stack: [...state.stack, { type: 'channel', channelId, channelName }],
      }));
    },
  };
}

export const navigation = createNavigationStore();

export const currentView = derived(navigation, ($nav) => {
  return $nav.stack[$nav.stack.length - 1] || { type: 'home' as ViewType };
});

export const previousView = derived(navigation, ($nav) => {
  if ($nav.stack.length < 2) return null;
  return $nav.stack[$nav.stack.length - 2];
});

export const canGoBack = derived(navigation, ($nav) => {
  return $nav.stack.length > 1;
});

export const stackDepth = derived(navigation, ($nav) => {
  return $nav.stack.length;
});
