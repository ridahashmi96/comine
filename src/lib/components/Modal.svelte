<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { portal } from '$lib/actions/portal';
  import Icon from './Icon.svelte';

  interface Props {
    open?: boolean;
    title?: string;
    onclose?: () => void;
    children?: any;
    actions?: any;
  }

  let { open = $bindable(false), title = '', onclose, children, actions }: Props = $props();

  function close() {
    open = false;
    onclose?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div use:portal>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="modal-backdrop"
      transition:fade={{ duration: 150 }}
      onclick={handleBackdropClick}
      onkeydown={(e) => e.key === 'Escape' && close()}
      role="dialog"
      aria-modal="true"
      tabindex="0"
    >
      <div class="modal" transition:scale={{ duration: 150, start: 0.95 }}>
        <div class="modal-header">
          <h2>{title}</h2>
          <button class="close-btn" onclick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div class="modal-content">
          {@render children?.()}
        </div>

        {#if actions}
          <div class="modal-actions">
            {@render actions()}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
  }

  .modal {
    background: rgba(25, 25, 25, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    min-width: 320px;
    max-width: min(600px, 90vw);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .modal-header h2 {
    font-size: 15px;
    font-weight: 600;
    color: white;
    margin: 0;
  }

  .close-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.15s;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .modal-content {
    padding: 14px 16px;
    overflow-x: hidden;
    overflow-y: auto;
    color: rgba(255, 255, 255, 0.8);
    font-size: 14px;
    line-height: 1.5;
  }

  .modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
</style>
