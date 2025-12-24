<script lang="ts">
  import { spotlight } from '$lib/actions/spotlight';

  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    children?: any;
    iconLeft?: any;
    iconRight?: any;
  }

  let { 
    variant = 'primary', 
    size = 'md', 
    disabled = false,
    onclick,
    children,
    iconLeft,
    iconRight
  }: Props = $props();
</script>

<button 
  class="btn {variant} {size}" 
  {disabled}
  onclick={onclick}
  use:spotlight
>
  {#if iconLeft}
    <span class="icon-left">
      {@render iconLeft()}
    </span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
  {#if iconRight}
    <span class="icon-right">
      {@render iconRight()}
    </span>
  {/if}
</button>

<style>
  .btn {
    /* Add your Figma styles here */
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .primary {
    background: var(--accent, #6366F1);
    color: white;
  }

  .secondary {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .ghost {
    background: transparent;
    color: white;
  }

  .sm {
    padding: 6px 12px;
    font-size: 13px;
    gap: 6px;
  }

  .md {
    padding: 8px 16px;
    font-size: 14px;
    gap: 8px;
  }

  .lg {
    padding: 12px 24px;
    font-size: 16px;
    gap: 10px;
  }

  .icon-left,
  .icon-right {
    display: inline-flex;
    align-items: center;
  }

  .icon-left :global(svg),
  .icon-right :global(svg) {
    width: 18px;
    height: 18px;
  }
</style>
