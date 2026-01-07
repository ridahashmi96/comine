<script lang="ts" generics="T">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    items: T[];
    estimatedItemHeight: number;
    overscan?: number;
    containerClass?: string;
    onscroll?: () => void;
    getKey?: (item: T, index: number) => string | number;
    children: Snippet<[T, number]>;
  }

  let {
    items,
    estimatedItemHeight,
    overscan = 5,
    containerClass = '',
    onscroll,
    getKey,
    children
  }: Props = $props();

  let container: HTMLElement | null = $state(null);
  let innerContainer: HTMLElement | null = $state(null);
  let scrollTop = $state(0);
  let containerHeight = $state(0);
  let renderTrigger = $state(0);

  // Use a stable height cache keyed by item identity, not index
  const heightCache = new Map<string | number, number>();
  let lastItemCount = 0;

  function getItemKey(item: T, index: number): string | number {
    if (getKey) return getKey(item, index);
    // Fallback: use the item's id if it has one, otherwise use index
    if (item && typeof item === 'object' && 'id' in item) {
      return (item as { id: string | number }).id;
    }
    return index;
  }

  function getItemHeight(index: number): number {
    if (index < 0 || index >= items.length) return estimatedItemHeight;
    const key = getItemKey(items[index], index);
    return heightCache.get(key) ?? estimatedItemHeight;
  }

  function getOffsetForIndex(index: number): number {
    let offset = 0;
    for (let i = 0; i < index && i < items.length; i++) {
      offset += getItemHeight(i);
    }
    return offset;
  }

  function getTotalHeight(): number {
    let height = 0;
    for (let i = 0; i < items.length; i++) {
      height += getItemHeight(i);
    }
    return height;
  }

  function calculateVisibleRange(): { start: number; end: number } {
    const totalItems = items.length;
    if (totalItems === 0 || containerHeight === 0) {
      return { start: 0, end: 0 };
    }

    // Find start index
    let start = 0;
    let accumulatedHeight = 0;
    while (start < totalItems && accumulatedHeight + getItemHeight(start) < scrollTop) {
      accumulatedHeight += getItemHeight(start);
      start++;
    }
    start = Math.max(0, start - overscan);

    // Find end index
    let end = start;
    let visibleHeight = 0;
    const targetHeight = containerHeight + overscan * estimatedItemHeight * 2;
    while (end < totalItems && visibleHeight < targetHeight) {
      visibleHeight += getItemHeight(end);
      end++;
    }
    end = Math.min(totalItems, end + overscan);

    return { start, end };
  }

  // Compute derived values
  let visibleRange = $derived.by(() => {
    // Depend on renderTrigger to allow manual re-renders
    void renderTrigger;
    void items.length;
    void scrollTop;
    void containerHeight;
    return calculateVisibleRange();
  });

  let visibleItems = $derived.by(() => {
    const { start, end } = visibleRange;
    return items.slice(start, end).map((item, i) => ({
      item,
      index: start + i,
      key: getItemKey(item, start + i)
    }));
  });

  let totalHeight = $derived.by(() => {
    void renderTrigger;
    void items.length;
    return getTotalHeight();
  });

  let topPadding = $derived.by(() => {
    void renderTrigger;
    return getOffsetForIndex(visibleRange.start);
  });

  function handleScroll() {
    if (container) {
      scrollTop = container.scrollTop;
    }
    onscroll?.();
  }

  // Measure items without triggering reactive updates during render
  function measureItems() {
    if (!innerContainer) return;

    const itemElements = innerContainer.querySelectorAll('[data-virtual-key]');
    let hasChanges = false;

    itemElements.forEach((el) => {
      const key = el.getAttribute('data-virtual-key');
      if (key === null) return;
      
      const rect = el.getBoundingClientRect();
      const height = rect.height;
      
      if (height > 0) {
        const existingHeight = heightCache.get(key);
        // Only update if height changed significantly (more than 1px)
        if (existingHeight === undefined || Math.abs(existingHeight - height) > 1) {
          heightCache.set(key, height);
          hasChanges = true;
        }
      }
    });

    // Only trigger re-render if heights actually changed
    if (hasChanges) {
      renderTrigger++;
    }
  }

  // Schedule measurement after paint to avoid layout thrashing
  let measureScheduled = false;
  function scheduleMeasurement() {
    if (measureScheduled) return;
    measureScheduled = true;
    requestAnimationFrame(() => {
      measureScheduled = false;
      measureItems();
    });
  }

  // Measure when visible items change
  $effect(() => {
    if (visibleItems.length > 0) {
      tick().then(scheduleMeasurement);
    }
  });

  // Clean up stale cache entries when items are cleared
  $effect(() => {
    const currentCount = items.length;
    if (currentCount === 0) {
      heightCache.clear();
    } else if (Math.abs(currentCount - lastItemCount) > 100) {
      // Prune old entries if item count changed dramatically
      const currentKeys = new Set<string | number>();
      for (let i = 0; i < items.length; i++) {
        currentKeys.add(getItemKey(items[i], i));
      }
      for (const key of heightCache.keys()) {
        if (!currentKeys.has(key)) {
          heightCache.delete(key);
        }
      }
    }
    lastItemCount = currentCount;
  });

  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    if (container) {
      containerHeight = container.clientHeight;

      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === container) {
            containerHeight = entry.contentRect.height;
          }
        }
        scheduleMeasurement();
      });
      resizeObserver.observe(container);
    }
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
  });

  export function scrollToTop() {
    if (container) {
      container.scrollTop = 0;
    }
  }

  export function scrollToBottom() {
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  export function getScrollTop(): number {
    return container?.scrollTop ?? 0;
  }

  export function setScrollTop(value: number) {
    if (container) {
      container.scrollTop = value;
    }
  }

  export function refresh() {
    renderTrigger++;
  }
</script>

<div class="virtual-list {containerClass}" bind:this={container} onscroll={handleScroll}>
  <div 
    class="virtual-list-inner" 
    style="height: {totalHeight}px; padding-top: {topPadding}px;" 
    bind:this={innerContainer}
  >
    {#each visibleItems as { item, index, key } (key)}
      <div class="virtual-list-item" data-virtual-key={key}>
        {@render children(item, index)}
      </div>
    {/each}
  </div>
</div>

<style>
  .virtual-list {
    overflow-y: auto;
    overflow-x: hidden;
    height: 100%;
    will-change: scroll-position;
  }

  .virtual-list-inner {
    position: relative;
    box-sizing: border-box;
    contain: layout style;
  }

  .virtual-list-item {
    box-sizing: border-box;
    contain: layout style;
  }
</style>
