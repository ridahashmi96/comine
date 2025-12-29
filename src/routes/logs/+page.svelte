<script lang="ts">
  import { t } from '$lib/i18n';
  import { logs, filteredLogs, logStats, type LogLevel } from '$lib/stores/logs';
  import { onMount, onDestroy } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { save } from '@tauri-apps/plugin-dialog';
  import { writeTextFile } from '@tauri-apps/plugin-fs';
  import Modal from '$lib/components/Modal.svelte';
  import Button from '$lib/components/Button.svelte';
  import { saveScrollPosition, getScrollPosition } from '$lib/stores/scroll';

  const ROUTE_PATH = '/logs';

  let searchQuery = $state('');
  let logContainer: HTMLElement | null = null;
  let autoScroll = $state(true);
  let isMobile = $state(false);
  let isDesktop = $state(false);

  beforeNavigate(() => {
    const pos = logContainer?.scrollTop ?? 0;
    saveScrollPosition(ROUTE_PATH, pos);
  });

  let showCopyModal = $state(false);
  let copyContentLength = $state(0);

  let activeFilters = $state<Set<LogLevel>>(new Set(['trace', 'debug', 'info', 'warn', 'error']));

  let resizeHandler: (() => void) | null = null;

  onMount(async () => {
    isMobile = window.innerWidth < 768;
    resizeHandler = () => {
      isMobile = window.innerWidth < 768;
    };
    window.addEventListener('resize', resizeHandler);

    const ua = navigator.userAgent.toLowerCase();
    isDesktop = !ua.includes('android') && !ua.includes('iphone') && !ua.includes('ipad');

    logs.info('system', 'Log viewer opened');

    const savedPosition = getScrollPosition(ROUTE_PATH);
    if (savedPosition > 0 && logContainer) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (logContainer) {
            logContainer.scrollTop = savedPosition;
            autoScroll = false;
          }
        });
      });
    }
  });

  onDestroy(() => {
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
  });

  function toggleFilter(level: LogLevel) {
    const newFilters = new Set(activeFilters);
    if (newFilters.has(level)) {
      newFilters.delete(level);
    } else {
      newFilters.add(level);
    }
    activeFilters = newFilters;
    logs.toggleLevel(level);
  }

  function handleSearchChange(e: Event) {
    const target = e.target as HTMLInputElement;
    searchQuery = target.value;
    logs.setSearch(searchQuery);
  }

  function clearLogs() {
    logs.clear();
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function promptCopyLogs() {
    const text = logs.exportAsText();
    copyContentLength = text.length;
    showCopyModal = true;
  }

  async function confirmCopyLogs() {
    const text = logs.exportAsText();
    await navigator.clipboard.writeText(text);
    logs.info('system', 'Logs copied to clipboard');
    showCopyModal = false;
  }

  async function openLogsFolder() {
    await logs.openLogsFolder();
    logs.info('system', 'Opened logs folder');
  }

  async function downloadLogs() {
    const text = logs.exportAsText();
    const defaultName = `comine-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;

    try {
      const filePath = await save({
        defaultPath: defaultName,
        filters: [
          {
            name: 'Text Files',
            extensions: ['txt', 'log'],
          },
        ],
      });

      if (filePath) {
        await writeTextFile(filePath, text);
        logs.info('system', `Logs saved to ${filePath}`);
      }
    } catch (e) {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      logs.warn('system', 'Used fallback download method');
    }
  }

  function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function getLevelShort(level: LogLevel): string {
    switch (level) {
      case 'trace':
        return 'TRC';
      case 'debug':
        return 'DBG';
      case 'info':
        return 'INF';
      case 'warn':
        return 'WRN';
      case 'error':
        return 'ERR';
    }
  }

  function handleScroll() {
    if (!logContainer) return;
    const isAtTop = logContainer.scrollTop <= 10;
    if (isAtTop && !autoScroll) {
      autoScroll = true;
    } else if (!isAtTop && autoScroll) {
      autoScroll = false;
    }
  }

  $effect(() => {
    if (autoScroll && logContainer && $filteredLogs.length > 0) {
      logContainer.scrollTop = 0;
    }
  });
</script>

<div class="logs-page">
  <div class="log-container" bind:this={logContainer} onscroll={handleScroll}>
    {#if $filteredLogs.length === 0}
      <div class="empty-state">
        <div class="empty-icon">
          <Icon name="documents" size={56} />
        </div>
        <p class="empty-title">No logs yet</p>
        <span class="empty-hint">Logs will appear here as the app runs</span>
      </div>
    {:else}
      <div class="log-list">
        {#each $filteredLogs as entry (entry.id)}
          {#if isMobile}
            <div class="log-entry mobile {entry.level}">
              <div class="log-header">
                <span class="log-time">{formatTime(entry.timestamp)}</span>
                <span class="log-level-badge {entry.level}">{getLevelShort(entry.level)}</span>
                <span class="log-source">{entry.source}</span>
              </div>
              <div class="log-message">{entry.message}</div>
            </div>
          {:else}
            <div class="log-entry {entry.level}">
              <span class="log-time">{formatTime(entry.timestamp)}</span>
              <span class="log-level-badge {entry.level}">{getLevelShort(entry.level)}</span>
              <span class="log-source">{entry.source}</span>
              <span class="log-message">{entry.message}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Floating toolbar -->
  <div class="floating-toolbar">
    <div class="toolbar-content">
      <div class="search-box">
        <Icon name="search" size={14} />
        <input
          type="text"
          placeholder="Search logs..."
          value={searchQuery}
          oninput={handleSearchChange}
        />
        {#if searchQuery}
          <button
            class="clear-search"
            onclick={() => {
              searchQuery = '';
              logs.setSearch('');
            }}
          >
            <Icon name="close" size={12} />
          </button>
        {/if}
      </div>

      <div class="filter-chips">
        <button
          class="chip info"
          class:active={activeFilters.has('info')}
          onclick={() => toggleFilter('info')}
          use:tooltip={'Toggle info logs'}
        >
          INF
          {#if $logStats.info > 0}<span class="chip-count">{$logStats.info}</span>{/if}
        </button>
        <button
          class="chip debug"
          class:active={activeFilters.has('debug')}
          onclick={() => toggleFilter('debug')}
          use:tooltip={'Toggle debug logs'}
        >
          DBG
          {#if $logStats.debug > 0}<span class="chip-count">{$logStats.debug}</span>{/if}
        </button>
        <button
          class="chip warn"
          class:active={activeFilters.has('warn')}
          onclick={() => toggleFilter('warn')}
          use:tooltip={'Toggle warning logs'}
        >
          WRN
          {#if $logStats.warn > 0}<span class="chip-count">{$logStats.warn}</span>{/if}
        </button>
        <button
          class="chip error"
          class:active={activeFilters.has('error')}
          onclick={() => toggleFilter('error')}
          use:tooltip={'Toggle error logs'}
        >
          ERR
          {#if $logStats.error > 0}<span class="chip-count">{$logStats.error}</span>{/if}
        </button>
      </div>

      <div class="toolbar-actions">
        {#if isDesktop}
          <button class="action-btn" onclick={openLogsFolder} use:tooltip={$t('logs.openFolder')}>
            <Icon name="folder" size={16} />
          </button>
        {/if}
        <button class="action-btn" onclick={promptCopyLogs} use:tooltip={'Copy to clipboard'}>
          <Icon name="copy" size={16} />
        </button>
        <button class="action-btn" onclick={downloadLogs} use:tooltip={'Download logs'}>
          <Icon name="download" size={16} />
        </button>
        <button
          class="action-btn"
          onclick={() => (autoScroll = !autoScroll)}
          class:active={autoScroll}
          use:tooltip={'Auto-scroll'}
        >
          <Icon name="sort" size={16} />
        </button>
        <button class="action-btn danger" onclick={clearLogs} use:tooltip={'Clear all logs'}>
          <Icon name="trash" size={16} />
        </button>
      </div>
    </div>
  </div>

  <!-- Log count indicator -->
  <div class="log-counter">
    <span class="counter-text">{$filteredLogs.length}</span>
    <span class="counter-label">logs</span>
  </div>
</div>

<!-- Copy confirmation modal -->
<Modal bind:open={showCopyModal} title={$t('logs.copyConfirmTitle')}>
  <div class="copy-confirm-content">
    <div class="warning-icon">
      <Icon name="warning" size={32} />
    </div>
    <p class="copy-warning-text">{$t('logs.copyConfirmMessage')}</p>
    <div class="copy-size-info">
      <span class="size-label">{$t('logs.contentSize')}:</span>
      <span class="size-value">{formatBytes(copyContentLength)}</span>
      <span class="size-chars">({copyContentLength.toLocaleString()} {$t('logs.characters')})</span>
    </div>
    <p class="copy-hint">{$t('logs.copyHint')}</p>
  </div>
  {#snippet actions()}
    <div class="modal-actions">
      <Button variant="ghost" onclick={() => (showCopyModal = false)}>
        {$t('common.cancel')}
      </Button>
      <Button variant="primary" onclick={confirmCopyLogs}>
        <Icon name="copy" size={16} />
        {$t('logs.copyAnyway')}
      </Button>
    </div>
  {/snippet}
</Modal>

<style>
  .logs-page {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* Match other pages: left padding for content */
    padding-left: 16px;
  }

  .log-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.25) 100%);
    font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace;
    font-size: 12px;
    padding-bottom: 80px;
    padding-right: 6px;
    margin-right: 4px;
    margin-bottom: 4px;
    mask-image: linear-gradient(to bottom, black, black 0px, black calc(100% - 90px), transparent);
    -webkit-mask-image: linear-gradient(
      to bottom,
      black,
      black 0px,
      black calc(100% - 90px),
      transparent
    );
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 300px;
    color: rgba(255, 255, 255, 0.3);
    gap: 16px;
    padding: 40px;
  }

  .empty-icon {
    opacity: 0.4;
  }

  .empty-title {
    font-size: 18px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    font-family: inherit;
  }

  .empty-hint {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.35);
  }

  .log-list {
    padding: 8px 12px;
  }

  /* Desktop log entry */
  .log-entry {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 4px;
    line-height: 1.5;
    transition: background 0.1s;
  }

  .log-entry:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  /* Mobile log entry */
  .log-entry.mobile {
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    margin-bottom: 2px;
    border-left: 3px solid transparent;
  }

  .log-entry.mobile.info {
    border-left-color: rgba(34, 197, 94, 0.5);
  }
  .log-entry.mobile.debug {
    border-left-color: rgba(99, 102, 241, 0.5);
  }
  .log-entry.mobile.warn {
    border-left-color: rgba(251, 191, 36, 0.5);
  }
  .log-entry.mobile.error {
    border-left-color: rgba(239, 68, 68, 0.5);
  }
  .log-entry.mobile.trace {
    border-left-color: rgba(156, 163, 175, 0.5);
  }

  .log-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }

  .log-time {
    color: rgba(255, 255, 255, 0.35);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .log-level-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .log-level-badge.info {
    color: rgba(34, 197, 94, 1);
    background: rgba(34, 197, 94, 0.15);
  }
  .log-level-badge.debug {
    color: rgba(99, 102, 241, 1);
    background: rgba(99, 102, 241, 0.15);
  }
  .log-level-badge.warn {
    color: rgba(251, 191, 36, 1);
    background: rgba(251, 191, 36, 0.15);
  }
  .log-level-badge.error {
    color: rgba(239, 68, 68, 1);
    background: rgba(239, 68, 68, 0.15);
  }
  .log-level-badge.trace {
    color: rgba(156, 163, 175, 0.9);
    background: rgba(156, 163, 175, 0.15);
  }

  .log-source {
    color: rgba(255, 255, 255, 0.5);
    font-size: 11px;
    flex-shrink: 0;
  }

  .log-source::before {
    content: '›';
    margin-right: 4px;
    opacity: 0.5;
  }

  .log-message {
    color: rgba(255, 255, 255, 0.85);
    flex: 1;
    word-break: break-word;
    white-space: pre-wrap;
  }

  .log-entry.mobile .log-message {
    font-size: 12px;
    line-height: 1.6;
    padding-left: 2px;
  }

  .log-entry.error .log-message {
    color: rgba(239, 68, 68, 0.95);
  }
  .log-entry.warn .log-message {
    color: rgba(251, 191, 36, 0.95);
  }

  /* Floating toolbar - clean inline style */
  .floating-toolbar {
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    z-index: 100;
  }

  .toolbar-content {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgb(35, 35, 40);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    padding: 6px 10px;
    min-width: 120px;
    color: rgba(255, 255, 255, 0.6);
  }

  .search-box:focus-within {
    border-color: rgba(255, 255, 255, 0.35);
    background: rgb(40, 40, 45);
  }

  .search-box input {
    background: transparent;
    border: none;
    outline: none;
    color: rgba(255, 255, 255, 0.9);
    font-size: 12px;
    width: 100%;
    font-family: inherit;
  }

  .search-box input::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  .clear-search {
    background: transparent;
    border: none;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.4);
  }

  .clear-search:hover {
    color: rgba(255, 255, 255, 0.7);
  }

  .filter-chips {
    display: flex;
    gap: 4px;
  }

  .chip {
    font-size: 10px;
    font-weight: 600;
    padding: 5px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgb(35, 35, 40);
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .chip:hover {
    background: rgb(50, 50, 55);
    color: rgba(255, 255, 255, 0.85);
  }

  .chip.active.info {
    background: rgb(20, 60, 40);
    border-color: rgb(34, 197, 94);
    color: rgb(34, 197, 94);
  }
  .chip.active.debug {
    background: rgb(35, 35, 70);
    border-color: rgb(99, 102, 241);
    color: rgb(129, 132, 255);
  }
  .chip.active.warn {
    background: rgb(60, 50, 20);
    border-color: rgb(251, 191, 36);
    color: rgb(251, 191, 36);
  }
  .chip.active.error {
    background: rgb(60, 25, 25);
    border-color: rgb(239, 68, 68);
    color: rgb(255, 100, 100);
  }

  .chip-count {
    font-size: 9px;
    opacity: 0.8;
  }

  .toolbar-actions {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }

  .action-btn {
    width: 30px;
    height: 30px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgb(35, 35, 40);
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .action-btn:hover {
    background: rgb(55, 55, 60);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.3);
  }

  .action-btn.active {
    background: rgb(35, 35, 70);
    border-color: rgb(99, 102, 241);
    color: rgb(129, 132, 255);
  }

  .action-btn.danger:hover {
    background: rgb(60, 25, 25);
    border-color: rgb(239, 68, 68);
    color: rgb(255, 100, 100);
  }

  /* Log counter */
  .log-counter {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgb(35, 35, 40);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    padding: 4px 8px;
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .counter-text {
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    font-variant-numeric: tabular-nums;
  }

  .counter-label {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Copy confirmation modal */
  .copy-confirm-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
    text-align: center;
  }

  .warning-icon {
    color: rgba(251, 191, 36, 1);
    background: rgba(251, 191, 36, 0.15);
    padding: 12px;
    border-radius: 50%;
  }

  .copy-warning-text {
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
  }

  .copy-size-info {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }

  .size-label {
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
  }

  .size-value {
    color: rgba(251, 191, 36, 1);
    font-size: 16px;
    font-weight: 600;
  }

  .size-chars {
    color: rgba(255, 255, 255, 0.5);
    font-size: 11px;
  }

  .copy-hint {
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    margin: 0;
  }

  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  /* Mobile adjustments */
  @media (max-width: 768px) {
    .toolbar-content {
      gap: 4px;
    }

    .search-box {
      min-width: 80px;
      flex: 1;
      order: 0;
    }

    .toolbar-actions {
      order: 1;
    }

    .filter-chips {
      order: 2;
      width: 100%;
    }

    .log-container {
      padding-bottom: 90px;
    }
  }
</style>
