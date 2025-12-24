<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    children?: any;
    class?: string;
    maskSize?: number;
  }

  let { 
    children, 
    class: className = '',
    maskSize = 25
  }: Props = $props();

  let scrollContainer: HTMLDivElement;
  let maskStyle = $state('');

  function updateScrollState() {
    if (!scrollContainer) return;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const maxScroll = scrollHeight - clientHeight;
    
    if (maxScroll <= 0) {
      // No scrolling needed, no mask
      maskStyle = '';
      return;
    }
    
    const topProgress = Math.min(scrollTop / maskSize, 1);
    const bottomProgress = Math.min((maxScroll - scrollTop) / maskSize, 1);
    
    // Create gradient mask: fade at top if scrolled, fade at bottom if more content
    const topFade = topProgress > 0 ? `transparent, black ${maskSize * topProgress}px` : 'black, black 0px';
    const bottomFade = bottomProgress > 0 ? `black calc(100% - ${maskSize * bottomProgress}px), transparent` : 'black 100%, black 100%';
    
    maskStyle = `mask-image: linear-gradient(to bottom, ${topFade}, ${bottomFade}); -webkit-mask-image: linear-gradient(to bottom, ${topFade}, ${bottomFade});`;
  }

  onMount(() => {
    setTimeout(updateScrollState, 100);
    
    const resizeObserver = new ResizeObserver(() => {
      updateScrollState();
    });
    
    resizeObserver.observe(scrollContainer);
    
    return () => {
      resizeObserver.disconnect();
    };
  });
</script>

<div class="scroll-area-wrapper {className}">
  <div 
    class="scroll-area"
    bind:this={scrollContainer}
    onscroll={updateScrollState}
    style={maskStyle}
  >
    {@render children?.()}
  </div>
</div>

<style>
  .scroll-area-wrapper {
    position: relative;
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .scroll-area {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin-right: 4px;
    margin-bottom: 4px;
    padding-right: 0;
  }

  /* Mobile: add padding so scrollbar doesn't touch content */
  @media (max-width: 480px) {
    .scroll-area {
      padding-right: 4px;
    }
  }
</style>
