<script lang="ts">
  import { deps, type DependencyName } from '$lib/stores/deps';
  import { t } from '$lib/i18n';
  import { formatSize, formatSpeed, calculateETA } from '$lib/utils/format';
  import { isAndroid, isAndroidYtDlpReady } from '$lib/utils/android';
  import Icon from './Icon.svelte';

  let { onComplete }: { onComplete?: () => void } = $props();

  interface DepInfo {
    id: DependencyName;
    name: string;
    description: string;
    required: boolean;
  }

  const dependencies: DepInfo[] = [
    { id: 'ytdlp', name: 'yt-dlp', description: 'Core downloader engine', required: true },
    { id: 'ffmpeg', name: 'FFmpeg', description: 'Video/audio processing', required: false },
    { id: 'aria2', name: 'aria2', description: 'Fast parallel downloads', required: false },
  ];

  async function install(depId: DependencyName) {
    let success = false;
    switch (depId) {
      case 'ytdlp':
        success = await deps.installYtdlp();
        break;
      case 'ffmpeg':
        success = await deps.installFfmpeg();
        break;
      case 'aria2':
        success = await deps.installAria2();
        break;
    }
    if (success && onComplete && deps.isReady()) {
      onComplete();
    }
  }

  function getStatus(depId: DependencyName) {
    switch (depId) {
      case 'ytdlp':
        return $deps.ytdlp;
      case 'ffmpeg':
        return $deps.ffmpeg;
      case 'aria2':
        return $deps.aria2;
    }
  }

  let hasRequiredMissing = $derived(isAndroid() ? false : !$deps.ytdlp?.installed);

  let progressInfo = $derived.by(() => {
    const p = $deps.installProgress;
    if (!p || p.total === 0) return null;

    return {
      downloaded: formatSize(p.downloaded),
      total: formatSize(p.total),
      speed: formatSpeed(p.speed),
      eta: calculateETA(p.downloaded, p.total, p.speed),
      percent: p.progress,
    };
  });
</script>

{#if hasRequiredMissing || $deps.installing}
  <div class="setup-banner">
    <div class="setup-content">
      {#if $deps.installing}
        <div class="setup-progress">
          <div class="progress-header">
            <Icon name="download" size={20} />
            <span>{$deps.installProgress?.message ?? 'Installing...'}</span>
          </div>
          {#if progressInfo}
            <div class="progress-bar-container">
              <div class="progress-bar" style="width: {progressInfo.percent}%"></div>
            </div>
            <div class="progress-details">
              <span class="progress-size">{progressInfo.downloaded} / {progressInfo.total}</span>
              <span class="progress-speed">{progressInfo.speed}</span>
              <span class="progress-eta">ETA: {progressInfo.eta}</span>
            </div>
          {:else if $deps.installProgress?.stage === 'fetching'}
            <div class="progress-text">Fetching latest release info...</div>
          {:else if $deps.installProgress?.stage === 'extracting'}
            <div class="progress-text">Extracting files...</div>
          {/if}
        </div>
      {:else if $deps.error}
        <div class="setup-error">
          <Icon name="close" size={20} />
          <div class="error-content">
            <span class="error-title">Installation failed</span>
            <span class="error-message">{$deps.error}</span>
          </div>
          <button class="retry-btn" onclick={() => deps.clearError()}> Dismiss </button>
        </div>
      {:else}
        <div class="setup-prompt">
          <div class="prompt-header">
            <div class="prompt-icon">
              <Icon name="download" size={24} />
            </div>
            <div class="prompt-content">
              <h3>Setup Required</h3>
              <p>Install the required dependencies to start downloading.</p>
            </div>
          </div>

          <div class="deps-list">
            {#each dependencies as dep}
              {@const status = getStatus(dep.id)}
              <div class="dep-item" class:installed={status?.installed}>
                <div class="dep-info">
                  <span class="dep-name">
                    {dep.name}
                    {#if dep.required}
                      <span class="required-badge">Required</span>
                    {/if}
                  </span>
                  <span class="dep-description">{dep.description}</span>
                  {#if status?.version}
                    <span class="dep-version">v{status.version}</span>
                  {/if}
                </div>
                <div class="dep-action">
                  {#if status?.installed}
                    <Icon name="check" size={20} />
                  {:else if $deps.checking === dep.id}
                    <div class="spinner small"></div>
                  {:else}
                    <button
                      class="install-btn small"
                      onclick={() => install(dep.id)}
                      disabled={$deps.installing !== null}
                    >
                      Install
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .setup-banner {
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.1));
    border: 1px solid rgba(99, 102, 241, 0.3);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
  }

  .setup-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: rgba(99, 102, 241, 0.8);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .spinner.small {
    width: 16px;
    height: 16px;
    border-width: 2px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .setup-progress {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .progress-header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.9);
    font-weight: 500;
  }

  .progress-bar-container {
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, rgba(99, 102, 241, 0.8), rgba(139, 92, 246, 0.8));
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }

  .progress-details {
    display: flex;
    gap: 16px;
    font-size: 13px;
    font-family: 'Consolas', 'Monaco', monospace;
  }

  .progress-size {
    color: rgba(255, 255, 255, 0.7);
  }

  .progress-speed {
    color: rgba(99, 102, 241, 0.9);
  }

  .progress-eta {
    color: rgba(255, 255, 255, 0.5);
  }

  .setup-error {
    display: flex;
    align-items: center;
    gap: 12px;
    color: rgba(239, 68, 68, 0.9);
  }

  .error-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .error-title {
    font-weight: 500;
  }

  .error-message {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }

  .retry-btn {
    padding: 8px 16px;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    color: rgba(239, 68, 68, 0.9);
    cursor: pointer;
    font-weight: 500;
    transition: all 0.15s;
  }

  .retry-btn:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  .setup-prompt {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .prompt-header {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .prompt-icon {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(99, 102, 241, 0.2);
    border-radius: 12px;
    color: rgba(99, 102, 241, 0.9);
    flex-shrink: 0;
  }

  .prompt-content {
    flex: 1;
  }

  .prompt-content h3 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 4px;
    color: rgba(255, 255, 255, 0.95);
  }

  .prompt-content p {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.4;
  }

  .deps-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .dep-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .dep-item.installed {
    border-color: rgba(34, 197, 94, 0.3);
    background: rgba(34, 197, 94, 0.1);
  }

  .dep-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dep-name {
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .required-badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 2px 6px;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 4px;
    color: rgba(239, 68, 68, 0.9);
  }

  .dep-description {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .dep-version {
    font-size: 11px;
    color: rgba(34, 197, 94, 0.8);
    font-family: 'Consolas', 'Monaco', monospace;
  }

  .dep-action {
    display: flex;
    align-items: center;
    color: rgba(34, 197, 94, 0.9);
  }

  .install-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: rgba(99, 102, 241, 0.8);
    border: none;
    border-radius: 8px;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .install-btn.small {
    padding: 8px 14px;
    font-size: 13px;
  }

  .install-btn:hover:not(:disabled) {
    background: rgba(99, 102, 241, 1);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
  }

  .install-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
