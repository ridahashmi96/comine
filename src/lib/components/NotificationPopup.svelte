<script lang="ts" module>
  import { writable } from 'svelte/store';

  export interface Notification {
    id: string;
    title: string;
    body: string;
    thumbnail?: string;
    url?: string;
    duration?: number;
    onAction?: () => void;
    actionLabel?: string;
  }

  type NotificationInput = Omit<Notification, 'id'>;

  const notificationsStore = writable<Notification[]>([]);
  const timeoutsMap = new Map<string, ReturnType<typeof setTimeout>>();

  export function show(notification: NotificationInput): string {
    const id = crypto.randomUUID();
    const notif: Notification = { id, ...notification };

    notificationsStore.update((n) => [...n, notif]);

    const duration = notification.duration ?? 8000;
    if (duration > 0) {
      const timeout = setTimeout(() => dismiss(id), duration);
      timeoutsMap.set(id, timeout);
    }

    return id;
  }

  export function dismiss(id: string) {
    const timeout = timeoutsMap.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutsMap.delete(id);
    }
    notificationsStore.update((n) => n.filter((notif) => notif.id !== id));
  }

  export function dismissAll() {
    timeoutsMap.forEach((t) => clearTimeout(t));
    timeoutsMap.clear();
    notificationsStore.set([]);
  }

  export { notificationsStore };
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';

  let notifications = $state<Notification[]>([]);

  const unsubscribe = notificationsStore.subscribe((value) => {
    notifications = value;
  });

  function handleAction(notif: Notification) {
    if (notif.onAction) {
      notif.onAction();
    }
    dismiss(notif.id);
  }

  onDestroy(() => {
    unsubscribe();
  });
</script>

<div class="notification-container">
  {#each notifications as notif (notif.id)}
    <div class="notification" in:fly={{ x: 320, duration: 300 }} out:fade={{ duration: 200 }}>
      <button class="close-btn" onclick={() => dismiss(notif.id)}>
        <Icon name="close" size={14} />
      </button>

      <div class="notification-content">
        {#if notif.thumbnail}
          <img src={notif.thumbnail} alt="" class="thumbnail" />
        {:else}
          <div class="icon-placeholder">
            <Icon name="download" size={24} />
          </div>
        {/if}

        <div class="text-content">
          <h4 class="title">{notif.title}</h4>
          <p class="body">{notif.body}</p>
        </div>
      </div>

      {#if notif.onAction}
        <div class="notification-actions">
          <Button size="sm" variant="primary" onclick={() => handleAction(notif)}>
            {notif.actionLabel || 'Download'}
          </Button>
          <Button size="sm" variant="ghost" onclick={() => dismiss(notif.id)}>Dismiss</Button>
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .notification-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 10000;
    display: flex;
    flex-direction: column-reverse;
    gap: 12px;
    max-width: 360px;
    pointer-events: none;
  }

  .notification {
    background: rgb(28, 28, 32);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 16px;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.4),
      0 2px 8px rgba(0, 0, 0, 0.2);
    pointer-events: all;
    position: relative;
    min-width: 300px;
    overflow: hidden;
    isolation: isolate;
    transform: translateZ(0);
  }

  .close-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .close-btn:hover {
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.1);
  }

  .notification-content {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .thumbnail {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .icon-placeholder {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    background: rgba(99, 102, 241, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(99, 102, 241, 0.9);
    flex-shrink: 0;
  }

  .text-content {
    flex: 1;
    min-width: 0;
    padding-right: 20px;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.95);
    margin: 0 0 4px 0;
    line-height: 1.3;
  }

  .body {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .notification-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
</style>
