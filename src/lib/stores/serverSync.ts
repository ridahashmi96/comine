/**
 * Server Sync Module
 * 
 * This module synchronizes the queue and history data with the Rust backend
 * so that the local HTTP server can serve this data to the browser extension.
 */

import { invoke } from '@tauri-apps/api/core';
import { queue, type QueueItem } from './queue';
import { history, type HistoryItem } from './history';
import { get } from 'svelte/store';

// Flag to check if we're on desktop (where the server exists)
const isDesktop = typeof window !== 'undefined' && 
  !navigator.userAgent.includes('Android') && 
  !navigator.userAgent.includes('Mobile');

// Debounce timers
let queueDebounce: ReturnType<typeof setTimeout> | null = null;
let historyDebounce: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 300;

/**
 * Convert a QueueItem to the format expected by Rust
 */
function serializeQueueItem(item: QueueItem) {
  return {
    id: item.id,
    url: item.url,
    status: item.status,
    statusMessage: item.statusMessage || '',
    title: item.title || '',
    author: item.author || '',
    thumbnail: item.thumbnail || '',
    duration: item.duration || 0,
    progress: item.progress || 0,
    speed: item.speed || '',
    eta: item.eta || '',
    error: item.error || null,
    filePath: item.filePath || '',
    addedAt: item.addedAt || Date.now(),
  };
}

/**
 * Convert a HistoryItem to the format expected by Rust
 */
function serializeHistoryItem(item: HistoryItem) {
  return {
    id: item.id,
    url: item.url,
    title: item.title || '',
    author: item.author || '',
    thumbnail: item.thumbnail || '',
    duration: item.duration || 0,
    filePath: item.filePath || '',
    completedAt: item.downloadedAt || Date.now(),
  };
}

/**
 * Push queue items to Rust server state
 */
async function pushQueueToServer(items: QueueItem[]) {
  if (!isDesktop) return;
  
  try {
    const serialized = items.map(serializeQueueItem);
    await invoke('push_queue_status', { items: serialized });
  } catch (e) {
    // Silently fail - server might not be running
    console.debug('[ServerSync] Failed to push queue:', e);
  }
}

/**
 * Push history items to Rust server state
 */
async function pushHistoryToServer(items: HistoryItem[]) {
  if (!isDesktop) return;
  
  try {
    // Only send the most recent 50 items to keep payload small
    const recent = items.slice(0, 50);
    const serialized = recent.map(serializeHistoryItem);
    await invoke('push_history_status', { items: serialized });
  } catch (e) {
    // Silently fail - server might not be running
    console.debug('[ServerSync] Failed to push history:', e);
  }
}

/**
 * Set up subscribers to sync data with the Rust server
 */
export function setupServerSync() {
  if (!isDesktop) return;

  // Subscribe to queue changes
  queue.subscribe(state => {
    if (queueDebounce) {
      clearTimeout(queueDebounce);
    }
    queueDebounce = setTimeout(() => {
      pushQueueToServer(state.items);
    }, DEBOUNCE_MS);
  });

  // Subscribe to history changes
  history.subscribe(state => {
    if (historyDebounce) {
      clearTimeout(historyDebounce);
    }
    historyDebounce = setTimeout(() => {
      pushHistoryToServer(state.items);
    }, DEBOUNCE_MS);
  });

  // Do an initial push
  const queueState = get(queue);
  const historyState = get(history);
  pushQueueToServer(queueState.items);
  pushHistoryToServer(historyState.items);

  console.log('[ServerSync] Server sync initialized');
}

/**
 * Force an immediate sync (useful after major changes)
 */
export async function forceSync() {
  if (!isDesktop) return;
  
  const queueState = get(queue);
  const historyState = get(history);
  await Promise.all([
    pushQueueToServer(queueState.items),
    pushHistoryToServer(historyState.items),
  ]);
}
