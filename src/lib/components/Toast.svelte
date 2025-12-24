<script lang="ts" context="module">
  import { writable } from 'svelte/store';

  export type ToastType = 'success' | 'error' | 'warning' | 'info';

  export interface Toast {
    id: number;
    message: string;
    type: ToastType;
    duration: number;
  }

  let idCounter = 0;
  export const toasts = writable<Toast[]>([]);

  export function toast(message: string, type: ToastType = 'info', duration = 4000) {
    const id = ++idCounter;
    toasts.update(t => [...t, { id, message, type, duration }]);
    
    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration);
    }
    
    return id;
  }

  export function dismissToast(id: number) {
    toasts.update(t => t.filter(toast => toast.id !== id));
  }

  // Convenience methods
  toast.success = (msg: string, duration?: number) => toast(msg, 'success', duration);
  toast.error = (msg: string, duration?: number) => toast(msg, 'error', duration);
  toast.warning = (msg: string, duration?: number) => toast(msg, 'warning', duration);
  toast.info = (msg: string, duration?: number) => toast(msg, 'info', duration);
</script>

<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fly, fade } from 'svelte/transition';
  import Icon, { type IconName } from './Icon.svelte';
  import { settings, type ToastPosition } from '$lib/stores/settings';
  import { isAndroid } from '$lib/utils/android';

  const iconMap: Record<ToastType, IconName> = {
    success: 'check',
    error: 'cross_circle',
    warning: 'warning',
    info: 'info'
  };
  
  // Get effective position - default to top-right on mobile
  let position = $derived<ToastPosition>($settings.toastPosition || (isAndroid() ? 'top-right' : 'bottom-right'));
  
  // Compute fly direction based on position
  let flyY = $derived(position.startsWith('top') ? -20 : 20);
</script>

<div class="toast-container" class:top={position.startsWith('top')} class:bottom={position.startsWith('bottom')} class:left={position.includes('left')} class:right={position.includes('right')} class:center={position.includes('center')}>
  {#each $toasts as t (t.id)}
    <div 
      class="toast {t.type}"
      animate:flip={{ duration: 200 }}
      in:fly={{ y: flyY, duration: 200 }}
      out:fade={{ duration: 150 }}
    >
      <Icon name={iconMap[t.type]} size={18} />
      <span class="message">{t.message}</span>
      <button class="dismiss" onclick={() => dismissToast(t.id)}>
        <Icon name="cross" size={14} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 2000;
    pointer-events: none;
  }
  
  /* Position variants */
  .toast-container.bottom {
    bottom: 20px;
  }
  
  .toast-container.top {
    top: 20px;
  }
  
  .toast-container.right {
    right: 20px;
  }
  
  .toast-container.left {
    left: 20px;
  }
  
  .toast-container.center {
    left: 50%;
    transform: translateX(-50%);
  }
  
  /* On mobile, add extra bottom padding for nav bar */
  @media (max-width: 480px) {
    .toast-container.bottom {
      bottom: 80px; /* Above bottom nav bar */
    }
    
    .toast-container.top {
      top: calc(env(safe-area-inset-top, 24px) + 8px);
    }
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: rgba(25, 25, 25, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: white;
    font-size: 13px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
    max-width: 360px;
  }

  .toast.success {
    border-left: 3px solid #22C55E;
  }

  .toast.error {
    border-left: 3px solid #EF4444;
  }

  .toast.warning {
    border-left: 3px solid #F59E0B;
  }

  .toast.info {
    border-left: 3px solid var(--accent, #6366F1);
  }

  .message {
    flex: 1;
  }

  .dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s;
  }

  .dismiss:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
</style>
