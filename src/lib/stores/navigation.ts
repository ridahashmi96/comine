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

const MAX_STACK_DEPTH = 20;

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
      update((state) => {
        let newStack = [...state.stack, view];
        if (newStack.length > MAX_STACK_DEPTH) {
          newStack = [newStack[0], ...newStack.slice(-(MAX_STACK_DEPTH - 1))];
        }
        return { ...state, stack: newStack };
      });
    },

    pop(): boolean {
      let didPop = false;
      update((state) => {
        if (state.stack.length > 1) {
          didPop = true;
          return { ...state, stack: state.stack.slice(0, -1) };
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
      update((state) => {
        let newStack = [...state.stack, { type: 'video' as ViewType, url, cachedData }];
        if (newStack.length > MAX_STACK_DEPTH) {
          newStack = [newStack[0], ...newStack.slice(-(MAX_STACK_DEPTH - 1))];
        }
        return { ...state, stack: newStack };
      });
    },

    openPlaylist(url: string, cachedData?: ViewState['cachedData']) {
      update((state) => {
        let newStack = [...state.stack, { type: 'playlist' as ViewType, url, cachedData }];
        if (newStack.length > MAX_STACK_DEPTH) {
          newStack = [newStack[0], ...newStack.slice(-(MAX_STACK_DEPTH - 1))];
        }
        return { ...state, stack: newStack };
      });
    },

    openChannel(channelId: string, channelName?: string) {
      update((state) => {
        let newStack = [...state.stack, { type: 'channel' as ViewType, channelId, channelName }];
        if (newStack.length > MAX_STACK_DEPTH) {
          newStack = [newStack[0], ...newStack.slice(-(MAX_STACK_DEPTH - 1))];
        }
        return { ...state, stack: newStack };
      });
    },

    clearCachedData() {
      update((state) => ({
        ...state,
        stack: state.stack.map((view) => ({
          ...view,
          cachedData: undefined,
        })),
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
