<script lang="ts">
  import { t, locale, setLocale, locales, type Locale } from '$lib/i18n';
  import {
    settings,
    updateSetting,
    settingsReady,
    defaultSettings,
    resetSettings,
    type NotificationPosition,
    type NotificationMonitor,
    type BackgroundType,
    type ToastPosition,
    type ProxyMode,
  } from '$lib/stores/settings';
  import { history } from '$lib/stores/history';
  import { deps } from '$lib/stores/deps';
  import { onMount } from 'svelte';
  import { save, open } from '@tauri-apps/plugin-dialog';
  import { convertFileSrc, invoke } from '@tauri-apps/api/core';
  import { writeTextFile, readTextFile, readFile, stat } from '@tauri-apps/plugin-fs';
  import Divider from '$lib/components/Divider.svelte';
  import Input from '$lib/components/Input.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import Select from '$lib/components/Select.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Button from '$lib/components/Button.svelte';
  import { toast } from '$lib/components/Toast.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { isAndroid, isDesktop } from '$lib/utils/android';

  let searchQuery = $state('');

  let onAndroid = $state(false);
  let onDesktop = $state(true);

  let backgroundVideoInput = $state('');
  let backgroundImageInput = $state('');

  let customProxyInput = $state('');
  let proxyValidationError = $state<string | null>(null);
  let systemProxyStatus = $state<string | null>(null);
  let detectingSystemProxy = $state(false);
  let currentIp = $state<string | null>(null);
  let checkingIp = $state(false);
  let ipProxyUsed = $state(false);

  onMount(() => {
    onAndroid = isAndroid();
    onDesktop = isDesktop();

    backgroundVideoInput = $settings.backgroundVideo || '';
    backgroundImageInput = $settings.backgroundImage || '';

    customProxyInput = $settings.customProxyUrl || '';

    if (onDesktop) {
      detectSystemProxy();
    }

    if (onDesktop) {
      deps.checkAll();
    }
  });

  const settingItems = {
    language: { section: 'general', keywords: ['language', 'язык', 'idioma', 'locale'] },
    startOnBoot: {
      section: 'general',
      keywords: ['start', 'boot', 'startup', 'autostart', 'запуск'],
    },
    watchClipboard: { section: 'general', keywords: ['clipboard', 'watch', 'paste', 'буфер'] },
    statusPopup: { section: 'general', keywords: ['status', 'popup', 'notification', 'статус'] },
    notificationsEnabled: {
      section: 'notifications',
      keywords: ['notification', 'popup', 'alert', 'уведомление'],
    },
    notificationPosition: {
      section: 'notifications',
      keywords: ['position', 'corner', 'location', 'позиция'],
    },
    notificationMonitor: {
      section: 'notifications',
      keywords: ['monitor', 'screen', 'display', 'монитор'],
    },
    compactNotifications: {
      section: 'notifications',
      keywords: ['compact', 'small', 'mini', 'icon', 'компактный'],
    },
    notificationFancyBackground: {
      section: 'notifications',
      keywords: ['fancy', 'background', 'blur', 'transparent', 'glass', 'фон', 'прозрачный'],
    },
    defaultProcessor: {
      section: 'processing',
      keywords: ['processor', 'backend', 'cobalt', 'yt-dlp', 'lux', 'auto', 'download'],
    },
    downloadPath: {
      section: 'downloads',
      keywords: ['download', 'path', 'folder', 'directory', 'save', 'location', 'путь', 'папка'],
    },
    useAudioPath: {
      section: 'downloads',
      keywords: ['audio', 'music', 'separate', 'folder', 'path', 'аудио', 'музыка'],
    },
    usePlaylistFolders: {
      section: 'downloads',
      keywords: ['playlist', 'folder', 'subfolder', 'organize', 'плейлист', 'папка'],
    },
    youtubeMusicAudioOnly: {
      section: 'downloads',
      keywords: ['youtube', 'music', 'audio', 'only', 'аудио', 'музыка'],
    },
    embedThumbnail: {
      section: 'downloads',
      keywords: ['thumbnail', 'cover', 'art', 'image', 'embed', 'audio', 'обложка', 'миниатюра'],
    },
    concurrentDownloads: {
      section: 'downloads',
      keywords: [
        'concurrent',
        'parallel',
        'simultaneous',
        'downloads',
        'speed',
        'multiple',
        'queue',
        'параллельные',
        'одновременные',
      ],
    },
    watchClipboardForFiles: {
      section: 'downloads',
      keywords: ['clipboard', 'file', 'detect', 'direct', 'url', 'буфер', 'файл'],
    },
    fileDownloadNotifications: {
      section: 'downloads',
      keywords: ['notification', 'file', 'download', 'alert', 'уведомление', 'файл'],
    },
    aria2Connections: {
      section: 'downloads',
      keywords: ['aria2', 'connections', 'parallel', 'speed', 'соединения'],
    },
    aria2Splits: {
      section: 'downloads',
      keywords: ['aria2', 'splits', 'chunks', 'pieces', 'части'],
    },
    downloadSpeedLimit: {
      section: 'downloads',
      keywords: ['speed', 'limit', 'throttle', 'bandwidth', 'скорость', 'лимит'],
    },
    autoUpdate: { section: 'app', keywords: ['update', 'auto', 'automatic', 'обновление'] },
    sendStats: {
      section: 'app',
      keywords: ['stats', 'statistics', 'analytics', 'telemetry', 'статистика'],
    },
    background: {
      section: 'app',
      keywords: [
        'background',
        'acrylic',
        'blur',
        'transparency',
        'video',
        'animated',
        'solid',
        'color',
        'image',
        'фон',
      ],
    },
    accentColor: {
      section: 'app',
      keywords: ['accent', 'color', 'theme', 'buttons', 'highlight', 'акцент', 'цвет', 'тема'],
    },
    toastPosition: {
      section: 'app',
      keywords: [
        'toast',
        'position',
        'corner',
        'location',
        'in-app',
        'notification',
        'внутри',
        'позиция',
      ],
    },
    disableAnimations: {
      section: 'app',
      keywords: ['animation', 'disable', 'motion', 'reduce', 'анимация'],
    },
    sizeUnit: {
      section: 'app',
      keywords: ['size', 'unit', 'kb', 'mb', 'binary', 'decimal', 'bytes', 'размер'],
    },
    showHistoryStats: {
      section: 'app',
      keywords: ['history', 'stats', 'statistics', 'downloads', 'статистика', 'история'],
    },
    thumbnailTheming: {
      section: 'app',
      keywords: [
        'thumbnail',
        'color',
        'theming',
        'progress',
        'dynamic',
        'миниатюра',
        'цвет',
        'тема',
      ],
    },
    ytdlp: {
      section: 'deps',
      keywords: ['yt-dlp', 'ytdlp', 'dependency', 'download', 'зависимость'],
    },
    proxy: {
      section: 'network',
      keywords: ['proxy', 'network', 'http', 'socks', 'vpn', 'прокси', 'сеть'],
    },
  };

  function matchesSearch(settingKey: string): boolean {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const item = settingItems[settingKey as keyof typeof settingItems];
    if (!item) return true;
    return (
      item.keywords.some((kw) => kw.includes(query)) ||
      $t(`settings.${item.section}.${settingKey === 'language' ? 'language' : settingKey}`)
        .toLowerCase()
        .includes(query)
    );
  }

  function sectionHasMatches(section: string): boolean {
    if (!searchQuery.trim()) return true;
    return Object.entries(settingItems)
      .filter(([_, item]) => item.section === section)
      .some(([key, _]) => matchesSearch(key));
  }

  const languageOptions = locales.map((l) => ({
    value: l.code,
    label: l.nativeName,
  }));

  function handleLanguageChange(value: string) {
    setLocale(value as Locale);
    updateSetting('language', value);
  }

  function handleStartOnBootChange(checked: boolean) {
    updateSetting('startOnBoot', checked);
  }

  function handleWatchClipboardChange(checked: boolean) {
    updateSetting('watchClipboard', checked);
  }

  function handleStatusPopupChange(checked: boolean) {
    updateSetting('statusPopup', checked);
  }

  function handleAutoUpdateChange(checked: boolean) {
    updateSetting('autoUpdate', checked);
  }

  function handleSendStatsChange(checked: boolean) {
    updateSetting('sendStats', checked);
  }

  function handleBackgroundTypeChange(value: string) {
    updateSetting('backgroundType', value as BackgroundType);
  }

  function handleBackgroundColorChange(value: string) {
    updateSetting('backgroundColor', value);
  }

  function handleBackgroundImageChange(value: string) {
    updateSetting('backgroundImage', value);
  }

  function handleBackgroundVideoChange(value: string) {
    updateSetting('backgroundVideo', value);
  }

  function handleBackgroundBlurChange(value: number) {
    updateSetting('backgroundBlur', value);
  }

  function handleBackgroundOpacityChange(value: number) {
    updateSetting('backgroundOpacity', value);
  }

  function handleAccentColorChange(value: string) {
    updateSetting('accentColor', value);
  }

  function handleUseSystemAccentChange(checked: boolean) {
    updateSetting('useSystemAccent', checked);
  }

  async function filePathToUrl(filePath: string, mimeType: string): Promise<string> {
    if (isAndroid()) {
      const fileData = await readFile(filePath);
      const base64 = btoa(String.fromCharCode(...fileData));
      return `data:${mimeType};base64,${base64}`;
    } else {
      return convertFileSrc(filePath);
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function processVideoFile(filePath: string, mimeType: string) {
    const assetUrl = await filePathToUrl(filePath, mimeType);
    backgroundVideoInput = assetUrl;
    handleBackgroundVideoChange(assetUrl);
  }

  async function confirmLargeFile() {
    if (pendingVideoFile) {
      await processVideoFile(pendingVideoFile.path, pendingVideoFile.mimeType);
      pendingVideoFile = null;
    }
    showLargeFileWarning = false;
  }

  function cancelLargeFile() {
    pendingVideoFile = null;
    showLargeFileWarning = false;
  }

  async function pickBackgroundVideo() {
    const result = await open({
      multiple: false,
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi'] }],
    });
    if (result) {
      const filePath = result as string;

      const fileStat = await stat(filePath);
      const fileSize = fileStat.size;

      const ext = filePath.split('.').pop()?.toLowerCase() || 'mp4';
      const mimeType =
        ext === 'webm'
          ? 'video/webm'
          : ext === 'mkv'
            ? 'video/x-matroska'
            : ext === 'mov'
              ? 'video/quicktime'
              : ext === 'avi'
                ? 'video/x-msvideo'
                : 'video/mp4';

      if (fileSize > LARGE_FILE_THRESHOLD) {
        pendingVideoFile = { path: filePath, mimeType, size: fileSize };
        showLargeFileWarning = true;
        return;
      }

      await processVideoFile(filePath, mimeType);
    }
  }

  async function pickBackgroundImage() {
    const result = await open({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
    });
    if (result) {
      const filePath = result as string;
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
      const mimeType =
        ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'webp'
              ? 'image/webp'
              : ext === 'bmp'
                ? 'image/bmp'
                : 'image/png';
      const assetUrl = await filePathToUrl(filePath, mimeType);
      backgroundImageInput = assetUrl;
      handleBackgroundImageChange(assetUrl);
    }
  }

  async function pickDownloadPath() {
    const result = await open({
      multiple: false,
      directory: true,
    });
    if (result) {
      updateSetting('downloadPath', result as string);
    }
  }

  async function pickAudioPath() {
    const result = await open({
      multiple: false,
      directory: true,
    });
    if (result) {
      updateSetting('audioPath', result as string);
    }
  }

  function handleDisableAnimationsChange(checked: boolean) {
    updateSetting('disableAnimations', checked);
  }

  function handleSizeUnitChange(value: string) {
    updateSetting('sizeUnit', value as 'binary' | 'decimal');
  }

  function handleCloseBehaviorChange(value: string) {
    updateSetting('closeBehavior', value as 'close' | 'minimize' | 'tray');
  }

  function handleNotificationsEnabledChange(checked: boolean) {
    updateSetting('notificationsEnabled', checked);
  }

  async function handleNotificationPositionChange(value: string) {
    try {
      await invoke('close_all_notifications');
    } catch (err) {
      console.error('Failed to close notifications:', err);
    }
    updateSetting('notificationPosition', value as NotificationPosition);
  }

  function handleNotificationMonitorChange(value: string) {
    updateSetting('notificationMonitor', value as NotificationMonitor);
  }

  function handleToastPositionChange(value: string) {
    updateSetting('toastPosition', value as ToastPosition);
  }

  let backgroundTypeOptions = $derived([
    ...(onDesktop ? [{ value: 'acrylic', label: $t('settings.app.backgroundAcrylic') }] : []),
    { value: 'animated', label: $t('settings.app.backgroundAnimated') },
    { value: 'solid', label: $t('settings.app.backgroundSolid') },
    { value: 'image', label: $t('settings.app.backgroundImage') },
  ]);

  let sizeUnitOptions = $derived([
    { value: 'binary', label: $t('settings.app.sizeUnitBinary') },
    { value: 'decimal', label: $t('settings.app.sizeUnitDecimal') },
  ]);

  let closeBehaviorOptions = $derived([
    { value: 'tray', label: $t('settings.general.closeBehaviorTray') },
    { value: 'minimize', label: $t('settings.general.closeBehaviorMinimize') },
    { value: 'close', label: $t('settings.general.closeBehaviorClose') },
  ]);

  let notificationPositionOptions = $derived([
    { value: 'bottom-right', label: $t('settings.notifications.positionBottomRight') },
    { value: 'bottom-left', label: $t('settings.notifications.positionBottomLeft') },
    { value: 'bottom-center', label: $t('settings.notifications.positionBottomCenter') },
    { value: 'top-right', label: $t('settings.notifications.positionTopRight') },
    { value: 'top-left', label: $t('settings.notifications.positionTopLeft') },
    { value: 'top-center', label: $t('settings.notifications.positionTopCenter') },
  ]);

  let toastPositionOptions = $derived([
    { value: 'bottom-right', label: $t('settings.notifications.positionBottomRight') },
    { value: 'bottom-left', label: $t('settings.notifications.positionBottomLeft') },
    { value: 'bottom-center', label: $t('settings.notifications.positionBottomCenter') },
    { value: 'top-right', label: $t('settings.notifications.positionTopRight') },
    { value: 'top-left', label: $t('settings.notifications.positionTopLeft') },
    { value: 'top-center', label: $t('settings.notifications.positionTopCenter') },
  ]);

  let notificationMonitorOptions = $derived([
    { value: 'primary', label: $t('settings.notifications.monitorPrimary') },
    { value: 'cursor', label: $t('settings.notifications.monitorCursor') },
  ]);

  let proxyModeOptions = $derived([
    { value: 'none', label: $t('settings.network.proxyModeNone') },
    { value: 'system', label: $t('settings.network.proxyModeSystem') },
    { value: 'custom', label: $t('settings.network.proxyModeCustom') },
  ]);

  let showResetModal = $state(false);
  let showClearHistoryModal = $state(false);
  let importMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

  let showLargeFileWarning = $state(false);
  let pendingVideoFile = $state<{ path: string; mimeType: string; size: number } | null>(null);
  const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024;

  async function handleResetSettings() {
    await resetSettings();
    setLocale(defaultSettings.language as Locale);
    showResetModal = false;
  }

  async function handleRestartOnboarding() {
    await updateSetting('onboardingCompleted', false);
  }

  function handleClearHistory() {
    history.clear();
    showClearHistoryModal = false;
  }

  async function handleExportHistory() {
    const items = history.getItems();
    if (items.length === 0) {
      importMessage = { type: 'error', text: $t('settings.data.noHistoryToExport') };
      setTimeout(() => (importMessage = null), 3000);
      return;
    }

    try {
      const filePath = await save({
        defaultPath: `comine-history-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (filePath) {
        const data = history.exportData();
        await writeTextFile(filePath, data);
        importMessage = { type: 'success', text: $t('settings.data.exportSuccess') };
        setTimeout(() => (importMessage = null), 3000);
      }
    } catch (err) {
      console.error('Export failed:', err);
      importMessage = { type: 'error', text: $t('settings.data.exportError') };
      setTimeout(() => (importMessage = null), 3000);
    }
  }

  async function handleImportHistory() {
    try {
      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      });

      if (filePath && typeof filePath === 'string') {
        const text = await readTextFile(filePath);
        const success = history.importData(text);
        if (success) {
          importMessage = { type: 'success', text: $t('settings.data.importSuccess') };
        } else {
          importMessage = { type: 'error', text: $t('settings.data.importError') };
        }
        setTimeout(() => (importMessage = null), 3000);
      }
    } catch (err) {
      console.error('Import failed:', err);
      importMessage = { type: 'error', text: $t('settings.data.importError') };
      setTimeout(() => (importMessage = null), 3000);
    }
  }

  function undoLanguage() {
    setLocale(defaultSettings.language as Locale);
    updateSetting('language', defaultSettings.language);
  }

  let clearingCache = $state(false);

  async function handleClearCache() {
    if (!onDesktop) return;
    clearingCache = true;
    try {
      const deleted = await invoke<number>('clear_cache');
      if (deleted > 0) {
        toast.success($t('settings.data.clearCacheSuccess'));
      } else {
        toast.info($t('settings.data.clearCacheEmpty'));
      }
    } catch (err) {
      console.error('Failed to clear cache:', err);
    } finally {
      clearingCache = false;
    }
  }

  function handleProxyModeChange(value: string) {
    updateSetting('proxyMode', value as ProxyMode);
  }

  function handleProxyFallbackChange(checked: boolean) {
    updateSetting('proxyFallback', checked);
  }

  function validateProxyUrl(url: string): boolean {
    if (!url.trim()) return true;

    const proxyRegex =
      /^(https?|socks5?):\/\/([a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(:\d{1,5})?(\/.*)?$/;
    return proxyRegex.test(url.trim());
  }

  function handleCustomProxyInput(value: string) {
    customProxyInput = value;

    if (!value.trim()) {
      proxyValidationError = null;
      updateSetting('customProxyUrl', '');
      return;
    }

    if (validateProxyUrl(value)) {
      proxyValidationError = null;
      updateSetting('customProxyUrl', value.trim());
    } else {
      proxyValidationError = $t('settings.network.proxyInvalid');
    }
  }

  async function detectSystemProxy() {
    if (!onDesktop) return;

    detectingSystemProxy = true;
    systemProxyStatus = null;

    try {
      const result = await invoke<{ url: string; source: string; description: string }>(
        'detect_system_proxy'
      );
      if (result?.url && result.url.length > 0) {
        systemProxyStatus = `${result.url} (${result.source})`;
      } else {
        systemProxyStatus = $t('settings.network.noSystemProxy');
      }
    } catch (err) {
      console.error('Failed to detect system proxy:', err);
      systemProxyStatus = $t('settings.network.noSystemProxy');
    } finally {
      detectingSystemProxy = false;
    }
  }

  async function checkIp() {
    checkingIp = true;
    currentIp = null;

    try {
      const result = await invoke<{ ip: string; proxyUsed: boolean; proxySource: string }>(
        'check_ip',
        {
          proxyConfig: {
            mode: $settings.proxyMode,
            customUrl: $settings.customProxyUrl,
            fallback: $settings.proxyFallback,
          },
        }
      );
      currentIp = result.ip;
      ipProxyUsed = result.proxyUsed;
    } catch (err) {
      console.error('Failed to check IP:', err);
      currentIp = $t('settings.network.ipCheckFailed');
    } finally {
      checkingIp = false;
    }
  }
</script>

<div class="page">
  <div class="page-header">
    <h1>{$t('settings.title')}</h1>
    <p class="subtitle">{$t('settings.subtitle')}</p>
  </div>

  <!-- Search Bar (matching downloads page style) -->
  <div class="search-bar">
    <Icon name="search" size={18} />
    <input type="text" placeholder={$t('settings.search.placeholder')} bind:value={searchQuery} />
  </div>

  <div class="settings-content">
    <!-- General Section -->
    {#if sectionHasMatches('general')}
      <section class="settings-section">
        <h2 class="section-title">{$t('settings.general.title')}</h2>

        <!-- Language Selector -->
        {#if matchesSearch('language')}
          <div class="setting-item">
            <div class="setting-row">
              <span class="setting-label">{$t('settings.general.language')}</span>
              <div class="setting-controls">
                {#if $locale !== defaultSettings.language}
                  <button
                    class="undo-btn"
                    onclick={undoLanguage}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <div style="width: 200px;">
                  <Select
                    options={languageOptions}
                    value={$locale}
                    onchange={handleLanguageChange}
                  />
                </div>
              </div>
            </div>
          </div>
        {/if}

        {#if matchesSearch('startOnBoot') && onDesktop}
          <div class="setting-item">
            <div class="setting-with-undo">
              <Checkbox
                checked={$settings.startOnBoot}
                label={$t('settings.general.startOnBoot')}
                onchange={handleStartOnBootChange}
              />
              <button
                class="undo-btn"
                class:hidden={$settings.startOnBoot === defaultSettings.startOnBoot}
                onclick={() => updateSetting('startOnBoot', defaultSettings.startOnBoot)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('watchClipboard') && onDesktop}
          <div class="setting-item">
            <div class="setting-with-info">
              <Checkbox
                checked={$settings.watchClipboard}
                label={$t('settings.general.watchClipboard')}
                onchange={handleWatchClipboardChange}
              />
              <button class="info-btn" use:tooltip={$t('settings.general.watchClipboardTooltip')}>
                <Icon name="info" size={18} />
              </button>
              <button
                class="undo-btn"
                class:hidden={$settings.watchClipboard === defaultSettings.watchClipboard}
                onclick={() => updateSetting('watchClipboard', defaultSettings.watchClipboard)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('statusPopup') && onDesktop}
          <div class="setting-item">
            <div class="setting-with-undo">
              <Checkbox
                checked={$settings.statusPopup}
                label={$t('settings.general.statusPopup')}
                onchange={handleStatusPopupChange}
              />
              <button
                class="undo-btn"
                class:hidden={$settings.statusPopup === defaultSettings.statusPopup}
                onclick={() => updateSetting('statusPopup', defaultSettings.statusPopup)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        <!-- Close behavior (desktop only) -->
        {#if onDesktop}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.general.closeBehavior')}</span>
                <span class="setting-description"
                  >{$t('settings.general.closeBehaviorDescription')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.closeBehavior !== defaultSettings.closeBehavior}
                  <button
                    class="undo-btn"
                    onclick={() => updateSetting('closeBehavior', defaultSettings.closeBehavior)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <div style="width: 220px;">
                  <Select
                    options={closeBehaviorOptions}
                    value={$settings.closeBehavior}
                    onchange={handleCloseBehaviorChange}
                  />
                </div>
              </div>
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <!-- Notifications Section (desktop only - Android uses system notifications) -->
    {#if sectionHasMatches('notifications') && onDesktop}
      <section class="settings-section">
        <h2 class="section-title">{$t('settings.notifications.title')}</h2>

        {#if matchesSearch('notificationsEnabled')}
          <div class="setting-item">
            <div class="setting-with-info">
              <Checkbox
                checked={$settings.notificationsEnabled}
                label={$t('settings.notifications.enabled')}
                onchange={handleNotificationsEnabledChange}
              />
              <button class="info-btn" use:tooltip={$t('settings.notifications.enabledTooltip')}>
                <Icon name="info" size={18} />
              </button>
              <button
                class="undo-btn"
                class:hidden={$settings.notificationsEnabled ===
                  defaultSettings.notificationsEnabled}
                onclick={() =>
                  updateSetting('notificationsEnabled', defaultSettings.notificationsEnabled)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('notificationPosition')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.notifications.position')}</span>
                <span class="setting-description"
                  >{$t('settings.notifications.positionDescription')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.notificationPosition !== defaultSettings.notificationPosition}
                  <button
                    class="undo-btn"
                    onclick={() =>
                      updateSetting('notificationPosition', defaultSettings.notificationPosition)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <div style="width: 180px;">
                  <Select
                    options={notificationPositionOptions}
                    value={$settings.notificationPosition}
                    onchange={handleNotificationPositionChange}
                  />
                </div>
              </div>
            </div>
          </div>
        {/if}

        {#if matchesSearch('notificationMonitor')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.notifications.monitor')}</span>
                <span class="setting-description"
                  >{$t('settings.notifications.monitorDescription')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.notificationMonitor !== defaultSettings.notificationMonitor}
                  <button
                    class="undo-btn"
                    onclick={() =>
                      updateSetting('notificationMonitor', defaultSettings.notificationMonitor)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <div style="width: 180px;">
                  <Select
                    options={notificationMonitorOptions}
                    value={$settings.notificationMonitor}
                    onchange={handleNotificationMonitorChange}
                  />
                </div>
              </div>
            </div>
          </div>
        {/if}

        {#if matchesSearch('compactNotifications')}
          <div class="setting-item">
            <div class="setting-with-info">
              <Checkbox
                checked={$settings.compactNotifications}
                label={$t('settings.notifications.compact')}
                onchange={(checked: boolean) => updateSetting('compactNotifications', checked)}
              />
              <button class="info-btn" use:tooltip={$t('settings.notifications.compactTooltip')}>
                <Icon name="info" size={18} />
              </button>
              <button
                class="undo-btn"
                class:hidden={$settings.compactNotifications ===
                  defaultSettings.compactNotifications}
                onclick={() =>
                  updateSetting('compactNotifications', defaultSettings.compactNotifications)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('notificationFancyBackground')}
          <div class="setting-item">
            <div class="setting-with-info">
              <Checkbox
                checked={$settings.notificationFancyBackground}
                label={$t('settings.notifications.fancyBackground')}
                onchange={(checked: boolean) =>
                  updateSetting('notificationFancyBackground', checked)}
              />
              <button
                class="info-btn"
                use:tooltip={$t('settings.notifications.fancyBackgroundTooltip')}
              >
                <Icon name="info" size={18} />
              </button>
              <button
                class="undo-btn"
                class:hidden={$settings.notificationFancyBackground ===
                  defaultSettings.notificationFancyBackground}
                onclick={() =>
                  updateSetting(
                    'notificationFancyBackground',
                    defaultSettings.notificationFancyBackground
                  )}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        <!-- Corner dismiss toggle -->
        <div class="setting-item">
          <div class="setting-with-info">
            <Checkbox
              checked={$settings.notificationCornerDismiss}
              label={$t('settings.notifications.cornerDismiss')}
              onchange={(checked: boolean) => updateSetting('notificationCornerDismiss', checked)}
            />
            <button
              class="info-btn"
              use:tooltip={$t('settings.notifications.cornerDismissTooltip')}
            >
              <Icon name="info" size={18} />
            </button>
            <button
              class="undo-btn"
              class:hidden={$settings.notificationCornerDismiss ===
                defaultSettings.notificationCornerDismiss}
              onclick={() =>
                updateSetting(
                  'notificationCornerDismiss',
                  defaultSettings.notificationCornerDismiss
                )}
              use:tooltip={$t('settings.app.resetToDefault')}
            >
              <Icon name="undo" size={18} />
            </button>
          </div>
        </div>

        <!-- Notification offset slider -->
        <div class="setting-item">
          <div class="setting-row">
            <div class="setting-label-group">
              <span class="setting-label">{$t('settings.notifications.offset')}</span>
              <span class="setting-description"
                >{$t('settings.notifications.offsetDescription')}</span
              >
            </div>
            <div class="slider-with-value">
              {#if $settings.notificationOffset !== defaultSettings.notificationOffset}
                <button
                  class="undo-btn"
                  onclick={() =>
                    updateSetting('notificationOffset', defaultSettings.notificationOffset)}
                  use:tooltip={$t('settings.app.resetToDefault')}
                >
                  <Icon name="undo" size={14} />
                </button>
              {/if}
              <input
                type="range"
                class="blur-slider"
                min="0"
                max="200"
                step="4"
                value={$settings.notificationOffset}
                oninput={(e) =>
                  updateSetting(
                    'notificationOffset',
                    parseInt((e.target as HTMLInputElement).value)
                  )}
              />
              <span class="slider-value">{$settings.notificationOffset}px</span>
            </div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Processing Section -->
    {#if sectionHasMatches('processing')}
      <section class="settings-section">
        <h3 class="section-title">{$t('settings.processing.title')}</h3>

        {#if matchesSearch('defaultProcessor')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.processing.defaultProcessor')}</span>
                <span class="setting-description"
                  >{$t('settings.processing.defaultProcessorDescription')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.defaultProcessor !== defaultSettings.defaultProcessor}
                  <button
                    class="undo-btn"
                    onclick={() =>
                      updateSetting('defaultProcessor', defaultSettings.defaultProcessor)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <div style="width: 180px;">
                  <Select
                    value={$settings.defaultProcessor}
                    onchange={(val) => updateSetting('defaultProcessor', val as any)}
                    options={[
                      { value: 'auto', label: $t('settings.processing.auto') },
                      { value: 'cobalt', label: 'cobalt' },
                      { value: 'yt-dlp', label: 'yt-dlp' },
                      { value: 'lux', label: 'lux' },
                    ]}
                  />
                </div>
              </div>
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <!-- Downloads Section -->
    {#if sectionHasMatches('downloads')}
      <section class="settings-section">
        <h3 class="section-title">{$t('settings.downloads.title')}</h3>

        {#if matchesSearch('downloadPath')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.downloads.downloadPath')}</span>
                <span class="setting-description"
                  >{$t('settings.downloads.downloadPathDescription')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.downloadPath !== defaultSettings.downloadPath}
                  <button
                    class="undo-btn"
                    onclick={() => updateSetting('downloadPath', defaultSettings.downloadPath)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <button class="path-btn" onclick={pickDownloadPath}>
                  <Icon name="folder" size={16} />
                  <span class="path-text"
                    >{$settings.downloadPath || $t('settings.downloads.defaultPath')}</span
                  >
                </button>
              </div>
            </div>
          </div>
        {/if}

        {#if matchesSearch('useAudioPath')}
          <div class="setting-item">
            <div class="setting-with-info">
              <Checkbox
                checked={$settings.useAudioPath}
                label={$t('settings.downloads.useAudioPath')}
                onchange={(checked: boolean) => updateSetting('useAudioPath', checked)}
              />
              <button class="info-btn" use:tooltip={$t('settings.downloads.useAudioPathTooltip')}>
                <Icon name="info" size={18} />
              </button>
              <button
                class="undo-btn"
                class:hidden={$settings.useAudioPath === defaultSettings.useAudioPath}
                onclick={() => updateSetting('useAudioPath', defaultSettings.useAudioPath)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>

            {#if $settings.useAudioPath}
              <div class="setting-sub-row">
                <div class="setting-label-group">
                  <span class="setting-label">{$t('settings.downloads.audioPath')}</span>
                </div>
                <div class="setting-controls">
                  <button class="path-btn" onclick={pickAudioPath}>
                    <Icon name="folder" size={16} />
                    <span class="path-text"
                      >{$settings.audioPath || $t('settings.downloads.defaultPath')}</span
                    >
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if matchesSearch('usePlaylistFolders')}
          <div class="setting-item">
            <div class="setting-with-info">
              <Checkbox
                checked={$settings.usePlaylistFolders}
                label={$t('settings.downloads.usePlaylistFolders')}
                onchange={(checked: boolean) => updateSetting('usePlaylistFolders', checked)}
              />
              <button
                class="info-btn"
                use:tooltip={$t('settings.downloads.usePlaylistFoldersTooltip')}
              >
                <Icon name="info" size={18} />
              </button>
              <button
                class="undo-btn"
                class:hidden={$settings.usePlaylistFolders === defaultSettings.usePlaylistFolders}
                onclick={() =>
                  updateSetting('usePlaylistFolders', defaultSettings.usePlaylistFolders)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('youtubeMusicAudioOnly')}
          <div class="setting-item">
            <div class="setting-with-info">
              <Checkbox
                checked={$settings.youtubeMusicAudioOnly}
                label={$t('settings.downloads.youtubeMusicAudioOnly')}
                onchange={(checked: boolean) => updateSetting('youtubeMusicAudioOnly', checked)}
              />
              <button
                class="info-btn"
                use:tooltip={$t('settings.downloads.youtubeMusicAudioOnlyTooltip')}
              >
                <Icon name="info" size={18} />
              </button>
              <button
                class="undo-btn"
                class:hidden={$settings.youtubeMusicAudioOnly ===
                  defaultSettings.youtubeMusicAudioOnly}
                onclick={() =>
                  updateSetting('youtubeMusicAudioOnly', defaultSettings.youtubeMusicAudioOnly)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('embedThumbnail')}
          <div class="setting-item">
            <div class="setting-with-info">
              <Checkbox
                checked={$settings.embedThumbnail}
                label={$t('settings.downloads.embedThumbnail')}
                onchange={(checked: boolean) => updateSetting('embedThumbnail', checked)}
              />
              <button class="info-btn" use:tooltip={$t('settings.downloads.embedThumbnailTooltip')}>
                <Icon name="info" size={18} />
              </button>
              <button
                class="undo-btn"
                class:hidden={$settings.embedThumbnail === defaultSettings.embedThumbnail}
                onclick={() => updateSetting('embedThumbnail', defaultSettings.embedThumbnail)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('concurrentDownloads')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.downloads.concurrentDownloads')}</span>
                <span class="setting-description"
                  >{$t('settings.downloads.concurrentDownloadsDescription')}</span
                >
              </div>
              <div class="slider-with-value">
                {#if $settings.concurrentDownloads !== defaultSettings.concurrentDownloads}
                  <button
                    class="undo-btn"
                    onclick={() =>
                      updateSetting('concurrentDownloads', defaultSettings.concurrentDownloads)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <input
                  type="range"
                  class="blur-slider"
                  min="1"
                  max="5"
                  step="1"
                  value={$settings.concurrentDownloads}
                  oninput={(e) =>
                    updateSetting(
                      'concurrentDownloads',
                      parseInt((e.target as HTMLInputElement).value)
                    )}
                />
                <span class="slider-value">{$settings.concurrentDownloads}</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- Watch Clipboard for File URLs -->
        {#if matchesSearch('watchClipboardForFiles')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.downloads.watchClipboardForFiles')}</span>
                <span class="setting-description"
                  >{$t('settings.downloads.watchClipboardForFilesTooltip')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.watchClipboardForFiles !== defaultSettings.watchClipboardForFiles}
                  <button
                    class="undo-btn"
                    onclick={() =>
                      updateSetting(
                        'watchClipboardForFiles',
                        defaultSettings.watchClipboardForFiles
                      )}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <Toggle
                  checked={$settings.watchClipboardForFiles}
                  onchange={(checked) => updateSetting('watchClipboardForFiles', checked)}
                />
              </div>
            </div>
          </div>
        {/if}

        <!-- File Download Notifications -->
        {#if matchesSearch('fileDownloadNotifications')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label"
                  >{$t('settings.downloads.fileDownloadNotifications')}</span
                >
                <span class="setting-description"
                  >{$t('settings.downloads.fileDownloadNotificationsTooltip')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.fileDownloadNotifications !== defaultSettings.fileDownloadNotifications}
                  <button
                    class="undo-btn"
                    onclick={() =>
                      updateSetting(
                        'fileDownloadNotifications',
                        defaultSettings.fileDownloadNotifications
                      )}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <Toggle
                  checked={$settings.fileDownloadNotifications}
                  onchange={(checked) => updateSetting('fileDownloadNotifications', checked)}
                />
              </div>
            </div>
          </div>
        {/if}

        <!-- Aria2 Connections -->
        {#if matchesSearch('aria2Connections')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.downloads.aria2Connections')}</span>
                <span class="setting-description"
                  >{$t('settings.downloads.aria2ConnectionsDescription')}</span
                >
              </div>
              <div class="slider-with-value">
                {#if $settings.aria2Connections !== defaultSettings.aria2Connections}
                  <button
                    class="undo-btn"
                    onclick={() =>
                      updateSetting('aria2Connections', defaultSettings.aria2Connections)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <input
                  type="range"
                  class="blur-slider"
                  min="1"
                  max="16"
                  step="1"
                  value={$settings.aria2Connections}
                  oninput={(e) =>
                    updateSetting(
                      'aria2Connections',
                      parseInt((e.target as HTMLInputElement).value)
                    )}
                />
                <span class="slider-value">{$settings.aria2Connections}</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- Aria2 Splits -->
        {#if matchesSearch('aria2Splits')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.downloads.aria2Splits')}</span>
                <span class="setting-description"
                  >{$t('settings.downloads.aria2SplitsDescription')}</span
                >
              </div>
              <div class="slider-with-value">
                {#if $settings.aria2Splits !== defaultSettings.aria2Splits}
                  <button
                    class="undo-btn"
                    onclick={() => updateSetting('aria2Splits', defaultSettings.aria2Splits)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <input
                  type="range"
                  class="blur-slider"
                  min="1"
                  max="16"
                  step="1"
                  value={$settings.aria2Splits}
                  oninput={(e) =>
                    updateSetting('aria2Splits', parseInt((e.target as HTMLInputElement).value))}
                />
                <span class="slider-value">{$settings.aria2Splits}</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- Download Speed Limit -->
        {#if matchesSearch('downloadSpeedLimit')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.downloads.downloadSpeedLimit')}</span>
                <span class="setting-description"
                  >{$t('settings.downloads.downloadSpeedLimitDescription')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.downloadSpeedLimit !== defaultSettings.downloadSpeedLimit}
                  <button
                    class="undo-btn"
                    onclick={() =>
                      updateSetting('downloadSpeedLimit', defaultSettings.downloadSpeedLimit)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <div class="slider-with-value">
                  <input
                    type="range"
                    class="blur-slider"
                    min="0"
                    max="100"
                    step="1"
                    value={$settings.downloadSpeedLimit}
                    oninput={(e) =>
                      updateSetting(
                        'downloadSpeedLimit',
                        parseInt((e.target as HTMLInputElement).value)
                      )}
                  />
                  <span class="slider-value speed-limit-value"
                    >{$settings.downloadSpeedLimit === 0
                      ? $t('settings.downloads.unlimited')
                      : `${$settings.downloadSpeedLimit} ${$settings.sizeUnit === 'binary' ? 'MiB/s' : 'MB/s'}`}</span
                  >
                </div>
              </div>
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <!-- Network Section (proxy settings) -->
    {#if sectionHasMatches('network')}
      <section class="settings-section">
        <h3 class="section-title">{$t('settings.network.title')}</h3>

        {#if matchesSearch('proxy')}
          <!-- Proxy Mode -->
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.network.proxyMode')}</span>
                <span class="setting-description"
                  >{$t('settings.network.proxyModeDescription')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.proxyMode !== defaultSettings.proxyMode}
                  <button
                    class="undo-btn"
                    onclick={() => updateSetting('proxyMode', defaultSettings.proxyMode)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <div style="width: 180px;">
                  <Select
                    options={proxyModeOptions}
                    value={$settings.proxyMode}
                    onchange={handleProxyModeChange}
                  />
                </div>
              </div>
            </div>

            <!-- System proxy status (shown when mode is 'system') -->
            {#if $settings.proxyMode === 'system' && onDesktop}
              <div class="setting-sub-row proxy-status">
                <div class="proxy-status-content">
                  {#if detectingSystemProxy}
                    <span class="proxy-detecting">
                      <span class="btn-spinner"></span>
                      {$t('settings.network.detectingProxy')}
                    </span>
                  {:else if systemProxyStatus}
                    <span class="proxy-detected">
                      <Icon name="check" size={14} />
                      {systemProxyStatus}
                    </span>
                  {:else}
                    <span class="proxy-none">
                      <Icon name="warning" size={14} />
                      {$t('settings.network.noSystemProxy')}
                    </span>
                  {/if}
                </div>
                <button
                  class="dep-btn"
                  onclick={detectSystemProxy}
                  use:tooltip={$t('settings.network.recheckProxy')}
                >
                  <Icon name="undo" size={14} />
                </button>
              </div>
            {/if}

            <!-- Custom proxy URL (shown when mode is 'custom') -->
            {#if $settings.proxyMode === 'custom'}
              <div class="setting-sub-row">
                <div class="setting-label-group">
                  <span class="setting-label">{$t('settings.network.customProxyUrl')}</span>
                  <span class="setting-description"
                    >{$t('settings.network.customProxyUrlDescription')}</span
                  >
                </div>
                <div class="proxy-input-group">
                  {#if $settings.customProxyUrl !== defaultSettings.customProxyUrl}
                    <button
                      class="undo-btn"
                      onclick={() => {
                        customProxyInput = defaultSettings.customProxyUrl;
                        handleCustomProxyInput(defaultSettings.customProxyUrl);
                      }}
                      use:tooltip={$t('settings.app.resetToDefault')}
                    >
                      <Icon name="undo" size={14} />
                    </button>
                  {/if}
                  <div class="proxy-input-wrapper" class:error={proxyValidationError}>
                    <Input
                      value={customProxyInput}
                      oninput={(e) => handleCustomProxyInput((e.target as HTMLInputElement).value)}
                      placeholder={$t('settings.network.customProxyUrlPlaceholder')}
                    />
                  </div>
                </div>
              </div>

              {#if proxyValidationError}
                <div class="setting-sub-row proxy-error">
                  <span class="error-text">
                    <Icon name="warning" size={14} />
                    {proxyValidationError}
                  </span>
                  <span class="error-hint">{$t('settings.network.proxyValidFormats')}</span>
                </div>
              {/if}

              <!-- Fallback option -->
              <div class="setting-sub-row">
                <div class="setting-with-info">
                  <Checkbox
                    checked={$settings.proxyFallback}
                    label={$t('settings.network.proxyFallback')}
                    onchange={handleProxyFallbackChange}
                  />
                  <button
                    class="info-btn"
                    use:tooltip={$t('settings.network.proxyFallbackTooltip')}
                  >
                    <Icon name="info" size={18} />
                  </button>
                  <button
                    class="undo-btn"
                    class:hidden={$settings.proxyFallback === defaultSettings.proxyFallback}
                    onclick={() => updateSetting('proxyFallback', defaultSettings.proxyFallback)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={18} />
                  </button>
                </div>
              </div>
            {/if}
          </div>

          <!-- IP Check (shown when proxy is not 'none') -->
          {#if $settings.proxyMode !== 'none' && onDesktop}
            <div class="setting-item">
              <div class="setting-row">
                <div class="setting-label-group">
                  <span class="setting-label">{$t('settings.network.checkIp')}</span>
                  <span class="setting-description"
                    >{$t('settings.network.checkIpDescription')}</span
                  >
                </div>
                <div class="setting-controls">
                  <button class="dep-btn" onclick={checkIp} disabled={checkingIp}>
                    {#if checkingIp}
                      <span class="btn-spinner"></span>
                    {:else}
                      <Icon name="globe" size={14} />
                    {/if}
                    {$t('settings.network.checkIpBtn')}
                  </button>
                </div>
              </div>

              {#if currentIp}
                <div class="setting-sub-row ip-result">
                  <div class="ip-result-content">
                    <span class="ip-address">{currentIp}</span>
                    {#if ipProxyUsed}
                      <span class="ip-badge proxy">
                        <Icon name="check" size={12} />
                        {$t('settings.network.proxyActive')}
                      </span>
                    {:else}
                      <span class="ip-badge direct">
                        <Icon name="warning" size={12} />
                        {$t('settings.network.directConnection')}
                      </span>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </section>
    {/if}

    <!-- App Section -->
    {#if sectionHasMatches('app')}
      <section class="settings-section">
        <h3 class="section-title">{$t('settings.app.title')}</h3>

        {#if matchesSearch('autoUpdate')}
          <div class="setting-item">
            <div class="setting-with-undo">
              <Checkbox
                checked={$settings.autoUpdate}
                label={$t('settings.app.autoUpdate')}
                onchange={handleAutoUpdateChange}
              />
              <button
                class="undo-btn"
                class:hidden={$settings.autoUpdate === defaultSettings.autoUpdate}
                onclick={() => updateSetting('autoUpdate', defaultSettings.autoUpdate)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('sendStats')}
          <div class="setting-item">
            <div class="setting-with-info">
              <Checkbox
                checked={$settings.sendStats}
                label={$t('settings.app.sendStats')}
                onchange={handleSendStatsChange}
              />
              <button class="info-btn" use:tooltip={$t('settings.app.sendStatsTooltip')}>
                <Icon name="info" size={18} />
              </button>
              <button
                class="undo-btn"
                class:hidden={$settings.sendStats === defaultSettings.sendStats}
                onclick={() => updateSetting('sendStats', defaultSettings.sendStats)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('background')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.app.background')}</span>
                <span class="setting-description">{$t('settings.app.backgroundDescription')}</span>
              </div>
              <div class="setting-control-group">
                <button
                  class="undo-btn"
                  class:hidden={$settings.backgroundType === defaultSettings.backgroundType}
                  onclick={() => updateSetting('backgroundType', defaultSettings.backgroundType)}
                  use:tooltip={$t('settings.app.resetToDefault')}
                >
                  <Icon name="undo" size={18} />
                </button>
                <Select
                  options={backgroundTypeOptions}
                  value={$settings.backgroundType}
                  onchange={handleBackgroundTypeChange}
                />
              </div>
            </div>

            {#if $settings.backgroundType === 'solid'}
              <div class="setting-sub-row">
                <div class="setting-label-group">
                  <span class="setting-label">{$t('settings.app.backgroundColor')}</span>
                </div>
                <div class="setting-control-group">
                  <input
                    type="color"
                    class="color-picker"
                    value={$settings.backgroundColor}
                    oninput={(e) => handleBackgroundColorChange(e.currentTarget.value)}
                  />
                  <input
                    type="text"
                    class="color-text-input"
                    value={$settings.backgroundColor}
                    oninput={(e) => handleBackgroundColorChange(e.currentTarget.value)}
                    placeholder="#1a1a2e"
                  />
                </div>
              </div>
            {/if}

            {#if $settings.backgroundType === 'animated'}
              <div class="setting-sub-row">
                <div class="setting-label-group">
                  <span class="setting-label">{$t('settings.app.backgroundVideoUrl')}</span>
                  <span class="setting-description"
                    >{$t('settings.app.backgroundVideoUrlDescription')}</span
                  >
                </div>
                <div class="input-with-actions">
                  {#if $settings.backgroundVideo !== defaultSettings.backgroundVideo}
                    <button
                      class="undo-btn"
                      onclick={() => {
                        backgroundVideoInput = defaultSettings.backgroundVideo;
                        handleBackgroundVideoChange(defaultSettings.backgroundVideo);
                      }}
                      use:tooltip={$t('settings.app.resetToDefault')}
                    >
                      <Icon name="undo" size={16} />
                    </button>
                  {/if}
                  <Input
                    bind:value={backgroundVideoInput}
                    oninput={() => handleBackgroundVideoChange(backgroundVideoInput)}
                    placeholder="https://... or C:\path\to\video.mp4"
                  />
                  <button
                    class="picker-btn"
                    onclick={pickBackgroundVideo}
                    use:tooltip={$t('settings.general.browse')}
                  >
                    <Icon name="folder" size={16} />
                  </button>
                </div>
              </div>
            {/if}

            {#if $settings.backgroundType === 'image'}
              <div class="setting-sub-row">
                <div class="setting-label-group">
                  <span class="setting-label">{$t('settings.app.backgroundImageUrl')}</span>
                  <span class="setting-description"
                    >{$t('settings.app.backgroundImageUrlDescription')}</span
                  >
                </div>
                <div class="input-with-actions">
                  {#if $settings.backgroundImage !== defaultSettings.backgroundImage}
                    <button
                      class="undo-btn"
                      onclick={() => {
                        backgroundImageInput = defaultSettings.backgroundImage;
                        handleBackgroundImageChange(defaultSettings.backgroundImage);
                      }}
                      use:tooltip={$t('settings.app.resetToDefault')}
                    >
                      <Icon name="undo" size={16} />
                    </button>
                  {/if}
                  <Input
                    bind:value={backgroundImageInput}
                    oninput={() => handleBackgroundImageChange(backgroundImageInput)}
                    placeholder="https://... or C:\path\to\image.jpg"
                  />
                  <button
                    class="picker-btn"
                    onclick={pickBackgroundImage}
                    use:tooltip={$t('settings.general.browse')}
                  >
                    <Icon name="folder" size={16} />
                  </button>
                </div>
              </div>
            {/if}

            {#if $settings.backgroundType === 'animated' || $settings.backgroundType === 'image'}
              <div class="setting-sub-row">
                <div class="setting-label-group">
                  <span class="setting-label">{$t('settings.app.backgroundBlur')}</span>
                  <span class="setting-description"
                    >{$t('settings.app.backgroundBlurDescription')}</span
                  >
                </div>
                <div class="slider-with-value">
                  <input
                    type="range"
                    class="blur-slider"
                    min="0"
                    max="50"
                    step="1"
                    value={$settings.backgroundBlur}
                    oninput={(e) =>
                      handleBackgroundBlurChange(parseInt((e.target as HTMLInputElement).value))}
                  />
                  <span class="slider-value">{$settings.backgroundBlur}px</span>
                </div>
              </div>
            {/if}

            {#if !isAndroid()}
              <div class="setting-sub-row">
                <div class="setting-label-group">
                  <span class="setting-label">{$t('settings.app.backgroundOpacity')}</span>
                  <span class="setting-description"
                    >{$t('settings.app.backgroundOpacityDescription')}</span
                  >
                </div>
                <div class="slider-with-value">
                  <input
                    type="range"
                    class="blur-slider"
                    min="0"
                    max="100"
                    step="1"
                    value={$settings.backgroundOpacity}
                    oninput={(e) =>
                      handleBackgroundOpacityChange(parseInt((e.target as HTMLInputElement).value))}
                  />
                  <span class="slider-value">{$settings.backgroundOpacity}%</span>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if matchesSearch('accentColor')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.app.accentColor')}</span>
                <span class="setting-description">{$t('settings.app.accentColorDescription')}</span>
              </div>
              <div class="setting-control-group">
                {#if $settings.accentColor !== defaultSettings.accentColor}
                  <button
                    class="undo-btn"
                    onclick={() => updateSetting('accentColor', defaultSettings.accentColor)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={18} />
                  </button>
                {/if}
                <div class="color-picker-group">
                  <!-- Preset color swatches -->
                  <div class="color-presets">
                    {#each ['#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#0EA5E9', '#3B82F6'] as color}
                      <button
                        type="button"
                        class="color-swatch"
                        class:active={$settings.accentColor.toUpperCase() === color.toUpperCase()}
                        style="background: {color}"
                        disabled={$settings.useSystemAccent}
                        onclick={() => handleAccentColorChange(color)}
                        use:tooltip={color}
                      />
                    {/each}
                  </div>
                  <input
                    type="color"
                    class="color-picker"
                    value={$settings.accentColor}
                    disabled={$settings.useSystemAccent}
                    oninput={(e) => handleAccentColorChange((e.target as HTMLInputElement).value)}
                  />
                  <input
                    type="text"
                    class="color-text-input"
                    value={$settings.accentColor}
                    disabled={$settings.useSystemAccent}
                    oninput={(e) =>
                      handleAccentColorChange((e.currentTarget as HTMLInputElement).value)}
                    placeholder="#6366F1"
                  />
                </div>
              </div>
            </div>

            <div class="setting-sub-row">
              <Checkbox
                checked={$settings.useSystemAccent}
                label={$t('settings.app.useSystemAccent')}
                onchange={handleUseSystemAccentChange}
              />
              <span class="setting-hint">{$t('settings.app.useSystemAccentDescription')}</span>
            </div>
          </div>
        {/if}

        {#if matchesSearch('disableAnimations')}
          <div class="setting-item">
            <div class="setting-with-undo">
              <Checkbox
                checked={$settings.disableAnimations}
                label={$t('settings.app.disableAnimations')}
                onchange={handleDisableAnimationsChange}
              />
              <button
                class="undo-btn"
                class:hidden={$settings.disableAnimations === defaultSettings.disableAnimations}
                onclick={() =>
                  updateSetting('disableAnimations', defaultSettings.disableAnimations)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('toastPosition')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.notifications.toastPosition')}</span>
                <span class="setting-description"
                  >{$t('settings.notifications.toastPositionDescription')}</span
                >
              </div>
              <div class="setting-controls">
                {#if $settings.toastPosition !== defaultSettings.toastPosition}
                  <button
                    class="undo-btn"
                    onclick={() => updateSetting('toastPosition', defaultSettings.toastPosition)}
                    use:tooltip={$t('settings.app.resetToDefault')}
                  >
                    <Icon name="undo" size={14} />
                  </button>
                {/if}
                <div style="width: 180px;">
                  <Select
                    options={toastPositionOptions}
                    value={$settings.toastPosition}
                    onchange={handleToastPositionChange}
                  />
                </div>
              </div>
            </div>
          </div>
        {/if}

        {#if matchesSearch('sizeUnit')}
          <div class="setting-item">
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-label">{$t('settings.app.sizeUnit')}</span>
                <span class="setting-description">{$t('settings.app.sizeUnitDescription')}</span>
              </div>
              <div class="setting-control-group">
                <button
                  class="undo-btn"
                  class:hidden={$settings.sizeUnit === defaultSettings.sizeUnit}
                  onclick={() => updateSetting('sizeUnit', defaultSettings.sizeUnit)}
                  use:tooltip={$t('settings.app.resetToDefault')}
                >
                  <Icon name="undo" size={18} />
                </button>
                <Select
                  options={sizeUnitOptions}
                  value={$settings.sizeUnit}
                  onchange={handleSizeUnitChange}
                />
              </div>
            </div>
          </div>
        {/if}

        {#if matchesSearch('showHistoryStats')}
          <div class="setting-item">
            <div class="setting-with-undo">
              <Checkbox
                checked={$settings.showHistoryStats}
                label={$t('settings.app.showHistoryStats')}
                onchange={() => {
                  updateSetting('showHistoryStats', !$settings.showHistoryStats);
                }}
              />
              <button
                class="undo-btn"
                class:hidden={$settings.showHistoryStats === defaultSettings.showHistoryStats}
                onclick={() => updateSetting('showHistoryStats', defaultSettings.showHistoryStats)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
          </div>
        {/if}

        {#if matchesSearch('thumbnailTheming')}
          <div class="setting-item">
            <div class="setting-with-undo">
              <Checkbox
                checked={$settings.thumbnailTheming}
                label={$t('settings.app.thumbnailTheming')}
                onchange={() => {
                  updateSetting('thumbnailTheming', !$settings.thumbnailTheming);
                }}
              />
              <button
                class="undo-btn"
                class:hidden={$settings.thumbnailTheming === defaultSettings.thumbnailTheming}
                onclick={() => updateSetting('thumbnailTheming', defaultSettings.thumbnailTheming)}
                use:tooltip={$t('settings.app.resetToDefault')}
              >
                <Icon name="undo" size={18} />
              </button>
            </div>
            <span class="setting-description">{$t('settings.app.thumbnailThemingDescription')}</span
            >
          </div>
        {/if}
      </section>
    {/if}

    <!-- Dependencies Section (desktop only - Android uses bundled youtubedl-android) -->
    {#if sectionHasMatches('deps') && onDesktop}
      <section class="settings-section">
        <h3 class="section-title">{$t('settings.deps.title')}</h3>

        {#if matchesSearch('ytdlp')}
          <div class="setting-item">
            <div class="dep-item">
              <div class="dep-info">
                <span class="dep-name">yt-dlp</span>
                <span class="dep-badge required">{$t('settings.deps.required')}</span>
                {#if $deps.checking === 'ytdlp'}
                  <span class="dep-status checking">{$t('settings.deps.checking')}</span>
                {:else if $deps.ytdlp?.installed}
                  <span class="dep-status installed">v{$deps.ytdlp.version}</span>
                {:else}
                  <span class="dep-status not-installed">{$t('settings.deps.notInstalled')}</span>
                {/if}
              </div>
              <div class="dep-actions">
                {#if $deps.installing === 'ytdlp'}
                  <button class="dep-btn" disabled>
                    <span class="btn-spinner"></span>
                    {$t('settings.deps.installing')}
                  </button>
                {:else if $deps.ytdlp?.installed}
                  <button class="dep-btn danger" onclick={() => deps.uninstallYtdlp()}>
                    {$t('settings.deps.uninstall')}
                  </button>
                  <button class="dep-btn" onclick={() => deps.installYtdlp()}>
                    {$t('settings.deps.reinstall')}
                  </button>
                {:else}
                  <button class="dep-btn primary" onclick={() => deps.installYtdlp()}>
                    {$t('settings.deps.install')}
                  </button>
                {/if}
              </div>
            </div>
            <p class="dep-description">{$t('settings.deps.ytdlpDescription')}</p>
            {#if $deps.installing === 'ytdlp' && $deps.installProgress}
              <div class="dep-progress">
                <div
                  class="dep-progress-bar"
                  style="width: {$deps.installProgress.progress}%"
                ></div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- ffmpeg -->
        <div class="setting-item">
          <div class="dep-item">
            <div class="dep-info">
              <span class="dep-name">ffmpeg</span>
              {#if $deps.checking === 'ffmpeg'}
                <span class="dep-status checking">{$t('settings.deps.checking')}</span>
              {:else if $deps.ffmpeg?.installed}
                <span class="dep-status installed">v{$deps.ffmpeg.version}</span>
              {:else}
                <span class="dep-status not-installed">{$t('settings.deps.notInstalled')}</span>
              {/if}
            </div>
            <div class="dep-actions">
              {#if $deps.installing === 'ffmpeg'}
                <button class="dep-btn" disabled>
                  <span class="btn-spinner"></span>
                  {$t('settings.deps.installing')}
                </button>
              {:else if $deps.ffmpeg?.installed}
                <button class="dep-btn danger" onclick={() => deps.uninstallFfmpeg()}>
                  {$t('settings.deps.uninstall')}
                </button>
                <button class="dep-btn" onclick={() => deps.installFfmpeg()}>
                  {$t('settings.deps.reinstall')}
                </button>
              {:else}
                <button class="dep-btn primary" onclick={() => deps.installFfmpeg()}>
                  {$t('settings.deps.install')}
                </button>
              {/if}
            </div>
          </div>
          <p class="dep-description">{$t('settings.deps.ffmpegDescription')}</p>
          {#if $deps.installing === 'ffmpeg' && $deps.installProgress}
            <div class="dep-progress">
              <div class="dep-progress-bar" style="width: {$deps.installProgress.progress}%"></div>
            </div>
          {/if}
        </div>

        <!-- aria2 -->
        <div class="setting-item">
          <div class="dep-item">
            <div class="dep-info">
              <span class="dep-name">aria2</span>
              {#if $deps.checking === 'aria2'}
                <span class="dep-status checking">{$t('settings.deps.checking')}</span>
              {:else if $deps.aria2?.installed}
                <span class="dep-status installed">v{$deps.aria2.version}</span>
              {:else}
                <span class="dep-status not-installed">{$t('settings.deps.notInstalled')}</span>
              {/if}
            </div>
            <div class="dep-actions">
              {#if $deps.installing === 'aria2'}
                <button class="dep-btn" disabled>
                  <span class="btn-spinner"></span>
                  {$t('settings.deps.installing')}
                </button>
              {:else if $deps.aria2?.installed}
                <button class="dep-btn danger" onclick={() => deps.uninstallAria2()}>
                  {$t('settings.deps.uninstall')}
                </button>
                <button class="dep-btn" onclick={() => deps.installAria2()}>
                  {$t('settings.deps.reinstall')}
                </button>
              {:else}
                <button class="dep-btn primary" onclick={() => deps.installAria2()}>
                  {$t('settings.deps.install')}
                </button>
              {/if}
            </div>
          </div>
          <p class="dep-description">{$t('settings.deps.aria2Description')}</p>
          {#if $deps.installing === 'aria2' && $deps.installProgress}
            <div class="dep-progress">
              <div class="dep-progress-bar" style="width: {$deps.installProgress.progress}%"></div>
            </div>
          {/if}
        </div>

        <!-- deno (JavaScript runtime for yt-dlp) -->
        <div class="setting-item">
          <div class="dep-item">
            <div class="dep-info">
              <span class="dep-name">deno</span>
              {#if $deps.checking === 'deno'}
                <span class="dep-status checking">{$t('settings.deps.checking')}</span>
              {:else if $deps.deno?.installed}
                <span class="dep-status installed">v{$deps.deno.version}</span>
              {:else}
                <span class="dep-status not-installed">{$t('settings.deps.notInstalled')}</span>
              {/if}
            </div>
            <div class="dep-actions">
              {#if $deps.installing === 'deno'}
                <button class="dep-btn" disabled>
                  <span class="btn-spinner"></span>
                  {$t('settings.deps.installing')}
                </button>
              {:else if $deps.deno?.installed}
                <button class="dep-btn danger" onclick={() => deps.uninstallDeno()}>
                  {$t('settings.deps.uninstall')}
                </button>
                <button class="dep-btn" onclick={() => deps.installDeno()}>
                  {$t('settings.deps.reinstall')}
                </button>
              {:else}
                <button class="dep-btn primary" onclick={() => deps.installDeno()}>
                  {$t('settings.deps.install')}
                </button>
              {/if}
            </div>
          </div>
          <p class="dep-description">{$t('settings.deps.denoDescription')}</p>
          {#if $deps.installing === 'deno' && $deps.installProgress}
            <div class="dep-progress">
              <div class="dep-progress-bar" style="width: {$deps.installProgress.progress}%"></div>
            </div>
          {/if}
        </div>

        <!-- quickjs (Lightweight JavaScript runtime for yt-dlp PO tokens) -->
        <div class="setting-item">
          <div class="dep-item">
            <div class="dep-info">
              <span class="dep-name">quickjs</span>
              {#if $deps.checking === 'quickjs'}
                <span class="dep-status checking">{$t('settings.deps.checking')}</span>
              {:else if $deps.quickjs?.installed}
                <span class="dep-status installed">{$t('settings.deps.installed')}</span>
              {:else}
                <span class="dep-status not-installed">{$t('settings.deps.notInstalled')}</span>
              {/if}
            </div>
            <div class="dep-actions">
              {#if $deps.installingDeps.has('quickjs')}
                <button class="dep-btn" disabled>
                  <span class="btn-spinner"></span>
                  {$t('settings.deps.installing')}
                </button>
              {:else if $deps.quickjs?.installed}
                <button class="dep-btn danger" onclick={() => deps.uninstallQuickjs()}>
                  {$t('settings.deps.uninstall')}
                </button>
                <button class="dep-btn" onclick={() => deps.installQuickjs()}>
                  {$t('settings.deps.reinstall')}
                </button>
              {:else}
                <button class="dep-btn primary" onclick={() => deps.installQuickjs()}>
                  {$t('settings.deps.install')}
                </button>
              {/if}
            </div>
          </div>
          <p class="dep-description">{$t('settings.deps.quickjsDescription')}</p>
          {#if $deps.installingDeps.has('quickjs') && $deps.installProgressMap.get('quickjs')}
            <div class="dep-progress">
              <div
                class="dep-progress-bar"
                style="width: {$deps.installProgressMap.get('quickjs')?.progress ?? 0}%"
              ></div>
            </div>
          {/if}
        </div>

        {#if $deps.error}
          <p class="dep-error">{$deps.error}</p>
        {/if}
      </section>
    {/if}

    <!-- Data Section -->
    {#if !searchQuery.trim() || 'data reset clear export import история сброс очистить экспорт импорт'.includes(searchQuery.toLowerCase())}
      <section class="settings-section">
        <h3 class="section-title">{$t('settings.data.title')}</h3>

        <!-- Reset Settings -->
        <div class="setting-item">
          <div class="data-item">
            <div class="data-info">
              <span class="data-label">{$t('settings.data.resetSettings')}</span>
              <span class="data-description">{$t('settings.data.resetSettingsDescription')}</span>
            </div>
            <button class="data-btn danger" onclick={() => (showResetModal = true)}>
              <Icon name="undo" size={16} />
              {$t('settings.data.resetSettings')}
            </button>
          </div>
        </div>

        <!-- Restart Onboarding -->
        <div class="setting-item">
          <div class="data-item">
            <div class="data-info">
              <span class="data-label">{$t('onboarding.restart')}</span>
              <span class="data-description">{$t('onboarding.welcome.description')}</span>
            </div>
            <button class="data-btn" onclick={handleRestartOnboarding}>
              <Icon name="settings" size={16} />
              {$t('onboarding.restart')}
            </button>
          </div>
        </div>

        <!-- Clear History -->
        <div class="setting-item">
          <div class="data-item">
            <div class="data-info">
              <span class="data-label">{$t('settings.data.clearHistory')}</span>
              <span class="data-description">{$t('settings.data.clearHistoryDescription')}</span>
            </div>
            <button class="data-btn danger" onclick={() => (showClearHistoryModal = true)}>
              <Icon name="trash" size={16} />
              {$t('settings.data.clearHistory')}
            </button>
          </div>
        </div>

        <!-- Clear Cache -->
        {#if onDesktop}
          <div class="setting-item">
            <div class="data-item">
              <div class="data-info">
                <span class="data-label">{$t('settings.data.clearCache')}</span>
                <span class="data-description">{$t('settings.data.clearCacheDescription')}</span>
              </div>
              <button class="data-btn" onclick={handleClearCache} disabled={clearingCache}>
                {#if clearingCache}
                  <span class="btn-spinner"></span>
                {:else}
                  <Icon name="trash" size={16} />
                {/if}
                {$t('settings.data.clearCache')}
              </button>
            </div>
          </div>
        {/if}

        <!-- Export History -->
        <div class="setting-item">
          <div class="data-item">
            <div class="data-info">
              <span class="data-label">{$t('settings.data.exportHistory')}</span>
              <span class="data-description">{$t('settings.data.exportHistoryDescription')}</span>
            </div>
            <button class="data-btn" onclick={handleExportHistory}>
              <Icon name="download" size={16} />
              {$t('settings.data.exportHistory')}
            </button>
          </div>
        </div>

        <!-- Import History -->
        <div class="setting-item">
          <div class="data-item">
            <div class="data-info">
              <span class="data-label">{$t('settings.data.importHistory')}</span>
              <span class="data-description">{$t('settings.data.importHistoryDescription')}</span>
            </div>
            <button class="data-btn" onclick={handleImportHistory}>
              <Icon name="move_to_folder" size={16} />
              {$t('settings.data.importHistory')}
            </button>
          </div>
        </div>

        <!-- Import Message -->
        {#if importMessage}
          <p
            class="import-message"
            class:success={importMessage.type === 'success'}
            class:error={importMessage.type === 'error'}
          >
            {importMessage.text}
          </p>
        {/if}
      </section>
    {/if}

    <!-- No results -->
    {#if searchQuery.trim() && !sectionHasMatches('general') && !sectionHasMatches('processing') && !sectionHasMatches('app') && !sectionHasMatches('deps') && !'data reset clear export import история сброс очистить экспорт импорт'.includes(searchQuery.toLowerCase())}
      <div class="no-results">
        <Icon name="search" size={32} />
        <p>{$t('settings.noResults')} "{searchQuery}"</p>
      </div>
    {/if}
  </div>
</div>

<!-- Reset Settings Modal -->
<Modal bind:open={showResetModal} title={$t('settings.data.resetSettings')}>
  <p>{$t('settings.data.resetSettingsConfirm')}</p>

  {#snippet actions()}
    <button class="modal-btn" onclick={() => (showResetModal = false)}>
      {$t('common.cancel')}
    </button>
    <button class="modal-btn danger" onclick={handleResetSettings}>
      {$t('settings.data.resetSettings')}
    </button>
  {/snippet}
</Modal>

<!-- Clear History Modal -->
<Modal bind:open={showClearHistoryModal} title={$t('settings.data.clearHistory')}>
  <p>{$t('settings.data.clearHistoryConfirm')}</p>

  {#snippet actions()}
    <button class="modal-btn" onclick={() => (showClearHistoryModal = false)}>
      {$t('common.cancel')}
    </button>
    <button class="modal-btn danger" onclick={handleClearHistory}>
      {$t('settings.data.clearHistory')}
    </button>
  {/snippet}
</Modal>

<!-- Large File Warning Modal -->
<Modal bind:open={showLargeFileWarning} title={$t('settings.app.largeFileWarningTitle')}>
  <div class="large-file-warning">
    <div class="warning-icon-large">
      <Icon name="warning" size={32} />
    </div>
    <p class="warning-text">{$t('settings.app.largeFileWarningMessage')}</p>
    {#if pendingVideoFile}
      <div class="file-size-info">
        <span class="size-label">{$t('settings.app.fileSize')}:</span>
        <span class="size-value">{formatFileSize(pendingVideoFile.size)}</span>
      </div>
    {/if}
    {#if isAndroid()}
      <p class="warning-hint">{$t('settings.app.largeFileWarningAndroid')}</p>
    {:else}
      <p class="warning-hint">{$t('settings.app.largeFileWarningDesktop')}</p>
    {/if}
  </div>
  {#snippet actions()}
    <div class="warning-modal-actions">
      <Button variant="ghost" onclick={cancelLargeFile}>
        {$t('common.cancel')}
      </Button>
      <Button variant="primary" onclick={confirmLargeFile}>
        {$t('settings.app.useAnyway')}
      </Button>
    </div>
  {/snippet}
</Modal>

<style>
  .page {
    padding: 0 8px 16px 16px;
    display: flex;
    flex-direction: column;
  }

  .page-header {
    margin-bottom: 16px;
  }

  h1 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 6px;
  }

  .subtitle {
    color: rgba(255, 255, 255, 0.6);
    font-size: 14px;
  }

  /* Search Bar */
  .search-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    margin-bottom: 16px;
  }

  .search-bar :global(svg) {
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .search-bar input {
    flex: 1;
    background: transparent;
    border: none;
    color: white;
    font-size: 14px;
    outline: none;
  }

  .search-bar input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    gap: 32px;
    margin-top: 24px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-title {
    font-size: 17px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    margin-bottom: 4px;
  }

  .setting-item {
    padding-left: 4px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .setting-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .setting-label {
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    font-weight: 400;
  }

  .setting-with-info,
  .setting-with-undo {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .info-btn,
  .undo-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.15s;
    flex-shrink: 0;
    width: 26px;
    height: 26px;
  }

  .info-btn {
    color: rgba(255, 255, 255, 0.5);
  }

  .info-btn:hover {
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.08);
  }

  .undo-btn {
    color: rgba(99, 102, 241, 0.7);
  }

  .undo-btn:hover {
    color: rgba(99, 102, 241, 1);
    background: rgba(99, 102, 241, 0.15);
  }

  .undo-btn.hidden {
    visibility: hidden;
    pointer-events: none;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
  }

  .setting-label-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setting-label {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.9);
  }

  .setting-description {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .setting-control-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .setting-sub-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 12px;
    padding-left: 16px;
    border-left: 2px solid var(--accent-alpha, rgba(99, 102, 241, 0.3));
  }

  .setting-hint {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-left: 8px;
  }

  .input-with-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 300px;
  }

  .input-with-actions :global(.input-wrapper) {
    flex: 1;
  }

  .picker-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .picker-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: white;
  }

  .path-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.15s;
    max-width: 280px;
  }

  .path-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: white;
  }

  .path-text {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
  }

  .color-picker-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .color-presets {
    display: flex;
    gap: 4px;
  }

  .color-swatch {
    width: 24px;
    height: 24px;
    border: 2px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
  }

  .color-swatch:hover:not(:disabled) {
    transform: scale(1.1);
  }

  .color-swatch.active {
    border-color: white;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.3);
  }

  .color-swatch:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .color-picker {
    width: 40px;
    height: 32px;
    padding: 2px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    cursor: pointer;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding: 2px;
  }

  .color-picker::-webkit-color-swatch {
    border: none;
    border-radius: 4px;
  }

  .color-picker:disabled,
  .color-text-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .color-text-input {
    width: 90px;
    padding: 6px 10px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: white;
    outline: none;
    transition: all 0.2s;
  }

  .color-text-input:focus {
    border-color: rgba(99, 102, 241, 0.5);
  }

  .slider-with-value {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 180px;
  }

  .blur-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .blur-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--accent, #6366f1);
    border-radius: 50%;
    cursor: pointer;
    transition:
      background 0.15s,
      transform 0.15s;
  }

  .blur-slider::-webkit-slider-thumb:hover {
    background: #818cf8;
    transform: scale(1.1);
  }

  .blur-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--accent, #6366f1);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition:
      background 0.15s,
      transform 0.15s;
  }

  .blur-slider::-moz-range-thumb:hover {
    background: #818cf8;
    transform: scale(1.1);
  }

  .slider-value {
    font-size: 13px;
    font-family: 'JetBrains Mono', monospace;
    color: rgba(255, 255, 255, 0.7);
    min-width: 40px;
    text-align: right;
  }

  .slider-value.speed-limit-value {
    min-width: 80px;
  }

  .no-results {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 24px;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
  }

  .no-results p {
    font-size: 14px;
  }

  /* Dependency items */
  .dep-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .dep-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .dep-name {
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
  }

  .dep-badge {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .dep-badge.required {
    color: rgba(251, 191, 36, 0.9);
    background: rgba(251, 191, 36, 0.15);
  }

  .dep-badge.optional {
    color: rgba(156, 163, 175, 0.9);
    background: rgba(156, 163, 175, 0.15);
  }

  .dep-badge.recommended {
    color: rgba(59, 130, 246, 0.9);
    background: rgba(59, 130, 246, 0.15);
  }

  .dep-description {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 4px;
    margin-left: 0;
  }

  .dep-status {
    font-size: 13px;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .dep-status.checking {
    color: rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.05);
  }

  .dep-status.installed {
    color: rgba(34, 197, 94, 0.9);
    background: rgba(34, 197, 94, 0.15);
  }

  .dep-status.not-installed {
    color: rgba(239, 68, 68, 0.9);
    background: rgba(239, 68, 68, 0.15);
  }

  .dep-actions {
    display: flex;
    gap: 8px;
  }

  .dep-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.15s;
  }

  .dep-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  .dep-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .dep-btn.primary {
    background: rgba(99, 102, 241, 0.2);
    border-color: rgba(99, 102, 241, 0.3);
    color: rgba(99, 102, 241, 0.9);
  }

  .dep-btn.primary:hover:not(:disabled) {
    background: rgba(99, 102, 241, 0.3);
  }

  .dep-btn.danger {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.2);
    color: rgba(239, 68, 68, 0.8);
  }

  .dep-btn.danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: rgba(99, 102, 241, 0.8);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .dep-progress {
    margin-top: 8px;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .dep-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, rgba(99, 102, 241, 0.8), rgba(139, 92, 246, 0.8));
    transition: width 0.3s ease;
  }

  .dep-error {
    margin-top: 8px;
    font-size: 13px;
    color: rgba(239, 68, 68, 0.9);
  }

  /* Data Section */
  .data-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0;
  }

  .data-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .data-label {
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
  }

  .data-description {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }

  .data-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .data-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .data-btn.danger {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.25);
    color: rgba(239, 68, 68, 0.9);
  }

  .data-btn.danger:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.4);
  }

  .import-message {
    font-size: 13px;
    padding: 8px 12px;
    border-radius: 6px;
    margin-top: 8px;
  }

  .import-message.success {
    background: rgba(34, 197, 94, 0.15);
    color: rgba(34, 197, 94, 0.9);
  }

  .import-message.error {
    background: rgba(239, 68, 68, 0.15);
    color: rgba(239, 68, 68, 0.9);
  }

  /* Modal buttons */
  .modal-btn {
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.15s;
  }

  .modal-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .modal-btn.danger {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.3);
    color: rgba(239, 68, 68, 0.9);
  }

  .modal-btn.danger:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  /* Large file warning modal */
  .large-file-warning {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
    text-align: center;
  }

  .warning-icon-large {
    color: rgba(251, 191, 36, 1);
    background: rgba(251, 191, 36, 0.15);
    padding: 16px;
    border-radius: 50%;
  }

  .warning-text {
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
  }

  .file-size-info {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 16px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }

  .file-size-info .size-label {
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
  }

  .file-size-info .size-value {
    color: rgba(251, 191, 36, 1);
    font-size: 16px;
    font-weight: 600;
  }

  .warning-hint {
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    margin: 0;
    max-width: 300px;
  }

  .warning-modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .proxy-status-content {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }

  .proxy-detecting {
    display: flex;
    align-items: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
  }

  .proxy-detected {
    display: flex;
    align-items: center;
    gap: 6px;
    color: rgba(34, 197, 94, 0.9);
    font-size: 13px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }

  .proxy-none {
    display: flex;
    align-items: center;
    gap: 6px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
  }

  .proxy-input-group {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 320px;
  }

  .proxy-input-wrapper {
    flex: 1;
  }

  .proxy-input-wrapper.error :global(.input-wrapper) {
    border-color: rgba(239, 68, 68, 0.5);
  }

  .proxy-input-wrapper.error :global(.input-wrapper:focus-within) {
    border-color: rgba(239, 68, 68, 0.8);
    box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.1);
  }

  .proxy-error {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 4px;
  }

  .proxy-error .error-text {
    display: flex;
    align-items: center;
    gap: 6px;
    color: rgba(239, 68, 68, 0.9);
    font-size: 13px;
  }

  .proxy-error .error-hint {
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
    margin-left: 20px;
  }

  .ip-result-content {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .ip-address {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.05);
    padding: 4px 10px;
    border-radius: 4px;
  }

  .ip-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 4px;
  }

  .ip-badge.proxy {
    background: rgba(34, 197, 94, 0.15);
    color: rgba(34, 197, 94, 0.9);
  }

  .ip-badge.direct {
    background: rgba(251, 191, 36, 0.15);
    color: rgba(251, 191, 36, 0.9);
  }

  /* Mobile responsive styles */
  @media (max-width: 700px) {
    .page {
      padding: 0 12px 16px 12px;
    }

    h1 {
      font-size: 24px;
    }

    .setting-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }

    .setting-controls {
      width: 100%;
    }

    .setting-controls > div[style*='width'] {
      width: 100% !important;
    }

    .setting-control-group {
      width: 100%;
      flex-wrap: wrap;
    }

    .setting-control-group :global(.select-trigger) {
      flex: 1;
    }

    .slider-with-value {
      min-width: unset;
      width: 100%;
    }

    .input-with-actions {
      min-width: unset;
      width: 100%;
    }

    .setting-sub-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }

    .color-picker-group {
      width: 100%;
      flex-wrap: wrap;
    }

    .color-presets {
      flex-wrap: wrap;
      justify-content: flex-start;
    }

    .path-btn {
      max-width: 100%;
      width: 100%;
    }

    .path-text {
      max-width: calc(100% - 40px);
    }

    /* Dependency items on mobile */
    .dep-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }

    .dep-info {
      flex-wrap: wrap;
    }

    .dep-actions {
      width: 100%;
      justify-content: flex-start;
    }

    /* Data section on mobile */
    .data-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }

    .data-btn {
      width: 100%;
      justify-content: center;
    }

    /* Proxy section on mobile */
    .proxy-input-group {
      min-width: unset;
      width: 100%;
    }
  }
</style>
