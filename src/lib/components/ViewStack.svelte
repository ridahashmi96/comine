<script lang="ts" module>
  export interface ViewInstance {
    id: string;
    type: 'home' | 'video' | 'playlist' | 'channel';
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
    mountedAt: number;
  }
</script>

<script lang="ts">
  import { navigation, type ViewState } from '$lib/stores/navigation';
  import { untrack } from 'svelte';

  interface Props {
    maxAliveViews?: number;
    children: import('svelte').Snippet<
      [
        {
          views: ViewInstance[];
          currentId: string;
          isActive: (id: string) => boolean;
        },
      ]
    >;
  }

  let { maxAliveViews = 5, children }: Props = $props();

  function getViewId(view: ViewState, index: number): string {
    if (view.type === 'home') return 'home-0';
    if (view.url) return `${view.type}-${view.url}`;
    if (view.channelId) return `channel-${view.channelId}`;
    return `${view.type}-${index}-${Date.now()}`;
  }

  function getInitialViews(): ViewInstance[] {
    const stack = navigation.getStack?.() ?? [{ type: 'home' }];
    return stack.map((view, i) => ({
      id: getViewId(view, i),
      type: view.type,
      url: view.url,
      channelId: view.channelId,
      channelName: view.channelName,
      cachedData: view.cachedData,
      mountedAt: Date.now(),
    }));
  }

  const initialViews = getInitialViews();
  let mountedViews = $state<ViewInstance[]>(initialViews);
  let currentViewId = $state<string>(initialViews[initialViews.length - 1]?.id ?? 'home-0');

  $effect(() => {
    const stack = $navigation.stack;

    untrack(() => {
      const newMounted: ViewInstance[] = [];
      const existingById = new Map(mountedViews.map((v) => [v.id, v]));

      for (let i = 0; i < stack.length; i++) {
        const view = stack[i];
        const id = getViewId(view, i);

        const existing = existingById.get(id);
        if (existing) {
          newMounted.push(existing);
        } else {
          newMounted.push({
            id,
            type: view.type,
            url: view.url,
            channelId: view.channelId,
            channelName: view.channelName,
            cachedData: view.cachedData,
            mountedAt: Date.now(),
          });
        }
      }

      const currentView = stack[stack.length - 1];
      currentViewId = getViewId(currentView, stack.length - 1);

      if (newMounted.length > maxAliveViews) {
        const toKeep = newMounted.filter((v, idx) => {
          if (v.type === 'home') return true;
          if (v.id === currentViewId) return true;
          return idx >= newMounted.length - maxAliveViews;
        });
        mountedViews = toKeep;
      } else {
        mountedViews = newMounted;
      }
    });
  });

  function isActive(id: string): boolean {
    return id === currentViewId;
  }
</script>

{@render children({ views: mountedViews, currentId: currentViewId, isActive })}
