<script lang="ts">
  import { onMount, onDestroy, type Snippet } from 'svelte';
  import { browser } from '$app/environment';
  import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { readText } from '@tauri-apps/plugin-clipboard-manager';
  import { attachLogger } from '@tauri-apps/plugin-log';
  import { invoke } from '@tauri-apps/api/core';
  import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Icon, { type IconName } from '$lib/components/Icon.svelte';
  import NavItem from '$lib/components/NavItem.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import BackgroundProvider from '$lib/components/BackgroundProvider.svelte';
  import AccentProvider from '$lib/components/AccentProvider.svelte';
  import { toast, updateToast, dismissToast } from '$lib/components/Toast.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n';
  import {
    initSettings,
    settings,
    settingsReady,
    type CloseBehavior,
    getSettings,
    getProxyConfig,
  } from '$lib/stores/settings';
  import { initHistory } from '$lib/stores/history';
  import { queue, activeDownloadsCount } from '$lib/stores/queue';
  import { deps } from '$lib/stores/deps';
  import { logs, type LogLevel } from '$lib/stores/logs';
  import { mediaCache } from '$lib/stores/mediaCache';
  import { viewStateCache, androidDataCache } from '$lib/stores/viewState';
  import { clearAllScrollPositions } from '$lib/stores/scroll';
  import { clearColorCache } from '$lib/utils/color';
  import {
    cleanUrl,
    isLikelyPlaylist,
    isLikelyChannel,
    isValidMediaUrl,
    getQuickThumbnail,
    isDirectFileUrl,
  } from '$lib/utils/format';
  import { detectBackendForUrl } from '$lib/utils/backend-detection';
  import {
    isAndroid,
    onShareIntent,
    setupAndroidLogHandler,
    cleanupAndroidCallbacks,
  } from '$lib/utils/android';
  import {
    startUpdateChecker,
    stopUpdateChecker,
    clearDismissedVersionIfUpdated,
  } from '$lib/stores/updates';
  import { navigation } from '$lib/stores/navigation';
  import NotificationPopup from '$lib/components/NotificationPopup.svelte';

  let { children }: { children: Snippet } = $props();

  // Derived state for download speed display
  let totalDownloadSpeed = $derived.by(() => {
    const items = $queue.items.filter(i => i.status === 'downloading' && i.speed);
    if (items.length === 0) return '';
    
    // Parse and sum all speeds (convert to bytes/s)
    let totalBytesPerSec = 0;
    for (const item of items) {
      const speed = item.speed.toLowerCase();
      const match = speed.match(/([\d.]+)\s*(k|m|g)?i?b?\/s?/i);
      if (match) {
        let value = parseFloat(match[1]);
        const unit = (match[2] || '').toLowerCase();
        if (unit === 'k') value *= 1024;
        else if (unit === 'm') value *= 1024 * 1024;
        else if (unit === 'g') value *= 1024 * 1024 * 1024;
        totalBytesPerSec += value;
      }
    }
    
    if (totalBytesPerSec === 0) return '';
    
    // Format back to human readable
    if (totalBytesPerSec >= 1024 * 1024 * 1024) {
      return `${(totalBytesPerSec / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
    } else if (totalBytesPerSec >= 1024 * 1024) {
      return `${(totalBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    } else if (totalBytesPerSec >= 1024) {
      return `${(totalBytesPerSec / 1024).toFixed(1)} KB/s`;
    }
    return `${Math.round(totalBytesPerSec)} B/s`;
  });

  let isDownloading = $derived($activeDownloadsCount > 0 && totalDownloadSpeed !== '');

  let isNotificationWindow = $derived(
    browser && window.location.pathname.startsWith('/notification')
  );

  let appWindow: TauriWindow | null = $state(null);

  let isMobile = $state(false);
  let windowWidth = $state(0);
  let lastClipboardText = $state('');
  let clipboardCheckInterval: ReturnType<typeof setInterval> | null = null;

  let hasShownTrayNotification = false;
  let isWindowHidden = $state(false);
  let depsToastId: number | null = null;

  let unlistenClose: UnlistenFn | null = null;
  let unlistenTrayDownload: UnlistenFn | null = null;
  let unlistenNotificationDownload: UnlistenFn | null = null;
  let unlistenNotificationStartDownload: UnlistenFn | null = null;
  let unlistenWindowShown: UnlistenFn | null = null;
  let detachLogger: (() => void) | null = null;
  let cleanupShareIntent: (() => void) | null = null;



  interface VideoInfo {
    title: string;
    uploader?: string;
    channel?: string;
    creator?: string;
    uploader_id?: string;
    thumbnail?: string;
    duration?: number;
    filesize?: number;
    ext?: string;
  }

  const MOBILE_BREAKPOINT = 480;
  const CLIPBOARD_CHECK_INTERVAL = 250;

  let cleanupResize: (() => void) | null = null;
  let cleanupKeyboard: (() => void) | null = null;

  function setupKeyboardShortcuts() {
    const pages = ['/', '/downloads', '/settings', '/info', '/logs'];

    const handleKeyDown = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      const isEditable =
        target.isContentEditable ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select';

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (!isEditable) {
          e.preventDefault();
          try {
            const text = await readText();
            if (text && isValidMediaUrl(text, $settings.clipboardPatterns || [])) {
              const url = cleanUrl(text);
              goto(`/?url=${encodeURIComponent(url)}`);
              toast.info(`📋 ${$t('clipboard.detected')}`);
            }
          } catch (err) {
            console.error('Clipboard read failed:', err);
          }
        }
        return;
      }

      if (isEditable) return;

      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const currentPath = $page.url.pathname;
        const currentIndex = pages.indexOf(currentPath);
        const idx = currentIndex === -1 ? 0 : currentIndex;

        if (e.shiftKey) {
          const prevIndex = idx === 0 ? pages.length - 1 : idx - 1;
          goto(pages[prevIndex]);
        } else {
          const nextIndex = idx === pages.length - 1 ? 0 : idx + 1;
          goto(pages[nextIndex]);
        }
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= pages.length) {
          e.preventDefault();
          goto(pages[num - 1]);
          return;
        }
      }

      switch (e.key.toLowerCase()) {
        case 'h':
        case 'n':
          e.preventDefault();
          goto('/');
          break;
        case 'd':
          e.preventDefault();
          goto('/downloads');
          break;
        case 's':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            goto('/settings');
          }
          break;
        case 'i':
          e.preventDefault();
          goto('/info');
          break;
        case 'l':
          e.preventDefault();
          goto('/logs');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    cleanupKeyboard = () => window.removeEventListener('keydown', handleKeyDown);
  }

  // Auto-install missing dependencies with live toast progress
  async function autoInstallDependencies() {
    // Wait a bit for deps.checkAll to complete
    await new Promise(r => setTimeout(r, 1000));

    const state = $deps;
    const missing: Array<{ name: string; key: 'ytdlp' | 'ffmpeg' | 'aria2' | 'quickjs' }> = [];

    if (!state.ytdlp?.installed) missing.push({ name: 'yt-dlp', key: 'ytdlp' });
    if (!state.ffmpeg?.installed) missing.push({ name: 'FFmpeg', key: 'ffmpeg' });
    if (!state.aria2?.installed) missing.push({ name: 'aria2', key: 'aria2' });
    if (!state.quickjs?.installed) missing.push({ name: 'QuickJS', key: 'quickjs' });

    if (missing.length === 0) return;

    logs.info('deps', `Auto-installing ${missing.length} missing dependencies...`);

    // Create a progress toast
    depsToastId = toast.progress(
      $t('deps.installing') || 'Installing components...',
      0,
      `0/${missing.length} ${$t('deps.components') || 'components'}`
    );

    let installed = 0;

    // Install aria2 first (other deps may need it)
    const aria2Idx = missing.findIndex(d => d.key === 'aria2');
    if (aria2Idx !== -1) {
      const aria2 = missing.splice(aria2Idx, 1)[0];
      updateToast(depsToastId, { 
        message: `${$t('deps.installing') || 'Installing'} ${aria2.name}...`,
        subMessage: `${installed}/${missing.length + 1} ${$t('deps.components') || 'components'}`
      });
      const success = await deps.installAria2();
      if (success) installed++;
      updateToast(depsToastId, { 
        progress: (installed / (missing.length + 1)) * 100,
        subMessage: `${installed}/${missing.length + 1} ${$t('deps.components') || 'components'}`
      });
    }

    // Install rest in parallel
    const results = await Promise.all(missing.map(async (dep, i) => {
      updateToast(depsToastId!, { 
        message: `${$t('deps.installing') || 'Installing'} ${dep.name}...`,
      });

      let success = false;
      switch (dep.key) {
        case 'ytdlp': success = await deps.installYtdlp(); break;
        case 'ffmpeg': success = await deps.installFfmpeg(); break;
        case 'quickjs': success = await deps.installQuickjs(); break;
      }

      if (success) {
        installed++;
        updateToast(depsToastId!, { 
          progress: (installed / (missing.length + (aria2Idx !== -1 ? 1 : 0))) * 100,
          subMessage: `${installed}/${missing.length + (aria2Idx !== -1 ? 1 : 0)} ${$t('deps.components') || 'components'}`
        });
      }

      return success;
    }));

    // Finish up
    if (depsToastId) {
      const allSuccess = results.every(Boolean) && (aria2Idx === -1 || installed > 0);
      if (allSuccess) {
        updateToast(depsToastId, { 
          type: 'success', 
          message: $t('deps.ready') || 'Components ready!',
          progress: 100 
        });
        setTimeout(() => {
          if (depsToastId) dismissToast(depsToastId);
          depsToastId = null;
        }, 3000);
      } else {
        updateToast(depsToastId, { 
          type: 'warning', 
          message: $t('deps.someError') || 'Some components failed to install',
          subMessage: $t('deps.checkSettings') || 'Check Settings → Dependencies' 
        });
        setTimeout(() => {
          if (depsToastId) dismissToast(depsToastId);
          depsToastId = null;
        }, 5000);
      }
    }
  }

  onMount(() => {
    if (window.location.pathname.startsWith('/notification')) {
      return;
    }

    appWindow = getCurrentWindow();

    initSettings();
    queue.init();

    setTimeout(async () => {
      await deps.checkAll();
      // Auto-install missing dependencies
      if (!isAndroid()) {
        autoInstallDependencies();
      }
    }, 1500);

    windowWidth = window.innerWidth;
    isMobile = windowWidth < MOBILE_BREAKPOINT;

    const handleResize = () => {
      windowWidth = window.innerWidth;
      isMobile = windowWidth < MOBILE_BREAKPOINT;
    };

    window.addEventListener('resize', handleResize);
    cleanupResize = () => window.removeEventListener('resize', handleResize);

    setupListeners();

    if (!isAndroid()) {
      setupKeyboardShortcuts();
    }

    setupLogForwarding();

    if (!isAndroid()) {
      startClipboardWatcher();
    }

    startUpdateChecker();
    clearDismissedVersionIfUpdated();

    if (isAndroid()) {
      cleanupShareIntent = onShareIntent(handleAndroidShareIntent);

      setupAndroidLogHandler((level, source, message) => {
        logs.log(level, source, message);
      });
      logs.info('system', 'Android log forwarding initialized');
    }
  });

  function levelNumberToLogLevel(level: number): LogLevel {
    switch (level) {
      case 1:
        return 'error';
      case 2:
        return 'warn';
      case 3:
        return 'info';
      case 4:
        return 'debug';
      case 5:
        return 'trace';
      default:
        return 'info';
    }
  }

  async function setupLogForwarding() {
    try {
      detachLogger = await attachLogger(({ level, message }) => {
        const levelStr = levelNumberToLogLevel(level);

        let source = 'rust';
        let msg = message;

        const timestampMatch = message.match(/^\[\d{4}-\d{2}-\d{2}\]\[\d{2}:\d{2}:\d{2}\]/);
        if (timestampMatch) {
          msg = message.substring(timestampMatch[0].length);

          const targetLevelMatch = msg.match(/^\[([^\]]+)\]\[([A-Z]+)\]\s*/);
          if (targetLevelMatch) {
            source = targetLevelMatch[1].split('::').pop()?.split(' ').pop() || 'rust';
            msg = msg.substring(targetLevelMatch[0].length);
          }
        } else {
          const colonIdx = message.indexOf('::');
          if (colonIdx > 0 && colonIdx < 40) {
            source = message.substring(0, colonIdx).split('_').pop() || 'rust';
            msg = message.substring(colonIdx + 2).trim();

            const levelMatch = msg.match(/^\[([A-Z]+)\]\s*/);
            if (levelMatch) {
              msg = msg.substring(levelMatch[0].length);
            }
          }
        }

        logs.log(levelStr, source, msg.trim());
      });
      logs.info('system', 'Backend log forwarding initialized');
    } catch (e) {
      console.error('Failed to attach logger:', e);
    }
  }

  async function setupListeners() {
    unlistenClose = await listen('close-requested', async () => {
      await handleCloseRequest();
    });

    unlistenTrayDownload = await listen('tray-download-clipboard', async () => {
      await downloadFromClipboard();
    });

    unlistenNotificationDownload = await listen<string>('notification-download', async (event) => {
      const url = cleanUrl(event.payload);
      if (url) {
        goto(`/?url=${encodeURIComponent(url)}`);
      }
    });

    interface NotificationPayload {
      url: string;
      metadata?: {
        title?: string | null;
        thumbnail?: string | null;
        uploader?: string | null;
        downloadMode?: 'auto' | 'audio' | 'mute';
        isPlaylist?: boolean | null;
        isChannel?: boolean | null;
        isFile?: boolean | null;
        openTrackBuilder?: boolean | null;
        fileInfo?: {
          filename: string;
          size: number;
          mimeType: string;
        } | null;
      } | null;
    }

    unlistenNotificationStartDownload = await listen<NotificationPayload>(
      'notification-start-download',
      async (event) => {
        const { url: rawUrl, metadata } = event.payload;
        const url = cleanUrl(rawUrl);
        const notificationDownloadMode = metadata?.downloadMode;
        const isPlaylistNotification = metadata?.isPlaylist === true;
        const isChannelNotification = metadata?.isChannel === true;
        const isFileNotification = metadata?.isFile === true;
        logs.info(
          'layout',
          `notification-start-download received: ${url}, isPlaylist: ${isPlaylistNotification}, isChannel: ${isChannelNotification}, isFile: ${isFileNotification}`
        );
        logs.debug(
          'layout',
          `Prefetched metadata: title=${metadata?.title}, uploader=${metadata?.uploader}, mode=${notificationDownloadMode}`
        );

        if (!url) return;

        if (isFileNotification && metadata?.fileInfo) {
          logs.info('layout', `Starting file download: ${metadata.fileInfo.filename}`);

          const queueId = queue.addFile({
            url: rawUrl,
            filename: metadata.fileInfo.filename,
            size: metadata.fileInfo.size,
            mimeType: metadata.fileInfo.mimeType,
          });

          if (queueId) {
            toast.success($t('notification.downloadStarted'));
          } else {
            toast.info($t('queue.alreadyInQueue') || 'Already in queue');
          }
          return;
        }

        if (isChannelNotification) {
          logs.info('layout', `Channel detected - showing window and opening channel view: ${url}`);

          if (appWindow) {
            try {
              await appWindow.show();
              await appWindow.setFocus();
            } catch (e) {
              logs.warn('layout', `Failed to show/focus window: ${e}`);
            }
          }

          if (metadata?.title || metadata?.thumbnail || metadata?.uploader) {
            mediaCache.setPreview(url, {
              title: metadata.title || undefined,
              thumbnail: metadata.thumbnail || undefined,
              author: metadata.uploader || undefined,
            });
          }

          navigation.openChannel(url, {
            title: metadata?.title || undefined,
            thumbnail: metadata?.thumbnail || undefined,
            author: metadata?.uploader || undefined,
          });
          await goto('/');
          toast.info($t('channel.notification.opening') || 'Opening channel...');
          return;
        }

        if (isPlaylistNotification) {
          logs.info(
            'layout',
            `Playlist detected - showing window and opening playlist view: ${url}`
          );

          if (appWindow) {
            try {
              await appWindow.show();
              await appWindow.setFocus();
            } catch (e) {
              logs.warn('layout', `Failed to show/focus window: ${e}`);
            }
          }

          if (metadata?.title || metadata?.thumbnail || metadata?.uploader) {
            mediaCache.setPreview(url, {
              title: metadata.title || undefined,
              thumbnail: metadata.thumbnail || undefined,
              author: metadata.uploader || undefined,
            });
          }

          navigation.openPlaylist(url, {
            title: metadata?.title || undefined,
            thumbnail: metadata?.thumbnail || undefined,
            author: metadata?.uploader || undefined,
          });
          await goto('/');
          toast.info($t('playlist.notification.openingModal'));
          return;
        }

        if (metadata?.openTrackBuilder) {
          logs.info('layout', `Opening Track Builder for: ${url}`);

          if (appWindow) {
            try {
              await appWindow.show();
              await appWindow.setFocus();
            } catch (e) {
              logs.warn('layout', `Failed to show/focus window: ${e}`);
            }
          }

          if (metadata?.title || metadata?.thumbnail || metadata?.uploader) {
            mediaCache.setPreview(url, {
              title: metadata.title || undefined,
              thumbnail: metadata.thumbnail || undefined,
              author: metadata.uploader || undefined,
            });
          }

          navigation.openVideo(url, {
            title: metadata?.title || undefined,
            thumbnail: metadata?.thumbnail || undefined,
            author: metadata?.uploader || undefined,
          });
          await goto('/');
          return;
        }

        if (!isAndroid()) {
          await deps.checkAll();
        }

        const currentSettings = getSettings();

        const queueId = queue.add(url, {
          ignoreMixes: currentSettings.ignoreMixes ?? true,
          videoQuality: currentSettings.defaultVideoQuality ?? 'max',
          downloadMode: notificationDownloadMode ?? currentSettings.defaultDownloadMode ?? 'auto',
          audioQuality: currentSettings.defaultAudioQuality ?? 'best',
          convertToMp4: currentSettings.convertToMp4 ?? false,
          remux: currentSettings.remux ?? true,
          clearMetadata: currentSettings.clearMetadata ?? false,
          dontShowInHistory: currentSettings.dontShowInHistory ?? false,
          useAria2: currentSettings.useAria2 ?? true,
          cookiesFromBrowser: currentSettings.cookiesFromBrowser ?? '',
          customCookies: currentSettings.customCookies ?? '',
          prefetchedInfo: metadata
            ? {
                title: metadata.title || undefined,
                thumbnail: metadata.thumbnail || undefined,
                author: metadata.uploader || undefined,
              }
            : undefined,
        });
        logs.info(
          'layout',
          `Added to queue: ${queueId ? queueId : 'failed (already in queue or deps missing)'}`
        );
        if (queueId) {
          toast.success($t('notification.downloadStarted'));
        }
      }
    );

    unlistenWindowShown = await listen('window-shown', () => {
      onWindowShown();
    });
  }

  onDestroy(() => {
    if (cleanupResize) {
      cleanupResize();
    }
    if (cleanupKeyboard) {
      cleanupKeyboard();
    }
    if (clipboardCheckInterval) {
      clearInterval(clipboardCheckInterval);
    }
    stopUpdateChecker();
    if (unlistenClose) {
      unlistenClose();
    }
    if (unlistenTrayDownload) {
      unlistenTrayDownload();
    }
    if (unlistenNotificationDownload) {
      unlistenNotificationDownload();
    }
    if (unlistenNotificationStartDownload) {
      unlistenNotificationStartDownload();
    }
    if (unlistenWindowShown) {
      unlistenWindowShown();
    }
    if (detachLogger) {
      detachLogger();
    }
    if (cleanupShareIntent) {
      cleanupShareIntent();
    }
    if (isAndroid()) {
      cleanupAndroidCallbacks();
    }
    queue.cleanup();
  });

  function handleAndroidShareIntent(rawUrl: string) {
    const url = cleanUrl(rawUrl);
    logs.info('layout', `Android share intent received: ${url}`);
    if (url) {
      goto(`/?url=${encodeURIComponent(url)}`);
      toast.info($t('clipboard.detected'));
    }
  }

  async function releaseMemoryOnHide() {
    logs.info('layout', 'Window hidden - flushing caches and releasing memory');

    await mediaCache.unload();

    viewStateCache.clear();
    androidDataCache.clear();
    clearAllScrollPositions();
    clearColorCache();
    logs.clearMemory();

    try {
      await invoke('clear_memory_caches');
    } catch (e) {
      logs.warn('layout', `Failed to clear Rust caches: ${e}`);
    }

    navigation.reset();

    logs.info('layout', 'Memory release complete');
  }

  async function onWindowShown() {
    logs.info('layout', 'Window restored - loading caches from disk');
    isWindowHidden = false;

    await mediaCache.load();

    deps.checkAll();
  }

  async function handleCloseRequest() {
    if (!appWindow) return;
    const behavior: CloseBehavior = $settings.closeBehavior || 'tray';

    switch (behavior) {
      case 'close':
        await appWindow.destroy();
        break;
      case 'minimize':
        await appWindow.minimize();
        break;
      case 'tray':
      default:
        if (!hasShownTrayNotification) {
          hasShownTrayNotification = true;
          try {
            const hasPermission = await isPermissionGranted();
            if (hasPermission) {
              sendNotification({
                title: 'Comine',
                body: $t('tray.hiddenToTray'),
              });
            }
          } catch (e) {
            console.warn('Failed to send tray notification:', e);
          }
        }

        isWindowHidden = true;
        await releaseMemoryOnHide();

        await appWindow.hide();
        break;
    }
  }

  function startClipboardWatcher() {
    clipboardCheckInterval = setInterval(async () => {
      if (!$settings.watchClipboard) return;

      try {
        const text = await readText();
        if (!text || text === lastClipboardText) return;

        lastClipboardText = text;
        logs.debug('layout', `Clipboard changed: ${text.substring(0, 100)}...`);

        if (isValidMediaUrl(text, $settings.clipboardPatterns || [])) {
          logs.debug('layout', `Media URL detected: ${text}`);
          await handleDetectedUrl(text);
          return;
        }

        const fileCheck = isDirectFileUrl(text);
        logs.debug(
          'layout',
          `Checking file URL: watchClipboardForFiles=${$settings.watchClipboardForFiles}, isDirectFileUrl=${fileCheck.isFile}`
        );
        if ($settings.watchClipboardForFiles && fileCheck.isFile) {
          logs.info('layout', `Direct file URL detected: ${fileCheck.filename}`);
          await handleDetectedFileUrl(text, fileCheck.filename);
        }
      } catch (err) {
        const errorStr = String(err);
        if (
          errorStr.includes('not available in the requested format') ||
          errorStr.includes('clipboard is empty')
        ) {
          return;
        }
        logs.error('layout', `Clipboard watcher error: ${err}`);
      }
    }, CLIPBOARD_CHECK_INTERVAL);
  }

  async function handleDetectedFileUrl(rawUrl: string, detectedFilename: string | null) {
    if (!appWindow) return;

    if (!$settings.fileDownloadNotifications) return;

    const isVisible = await appWindow.isVisible();
    const isFocused = await appWindow.isFocused();

    if (isVisible && isFocused) {
      toast.info(
        `📋 ${$t('clipboard.fileDetected') || 'File URL detected'}: ${detectedFilename || 'file'}`
      );
      return;
    }

    if (!$settings.notificationsEnabled) return;

    try {
      interface FileUrlInfo {
        isFile: boolean;
        filename: string;
        size: number;
        mimeType: string;
        supportsResume: boolean;
      }

      const fileInfo = await invoke<FileUrlInfo>('check_file_url', {
        url: rawUrl,
        proxyConfig: getProxyConfig(),
      });

      if (!fileInfo.filename && detectedFilename) {
        fileInfo.filename = detectedFilename;
      }

      if (!fileInfo.isFile) {
        logs.debug('layout', `URL is not a file: ${rawUrl}`);
        return;
      }

      logs.info('layout', `File URL detected: ${fileInfo.filename} (${fileInfo.size} bytes)`);

      const currentSettings = getSettings();

      await invoke('show_notification_window', {
        data: {
          title: fileInfo.filename,
          body: formatFileSize(fileInfo.size),
          thumbnail: null,
          url: rawUrl,
          compact: currentSettings.compactNotifications,
          download_label: $t('notification.downloadButton'),
          dismiss_label: $t('notification.dismissButton'),
          is_file: true,
          file_info: fileInfo,
        },
        position: currentSettings.notificationPosition,
        monitor: currentSettings.notificationMonitor,
        offset: currentSettings.notificationOffset,
      });
    } catch (err) {
      logs.warn('layout', `Failed to check file URL: ${err}`);
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return 'Unknown size';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  async function handleDetectedUrl(rawUrl: string) {
    const url = cleanUrl(rawUrl);

    if (!appWindow) return;
    const isVisible = await appWindow.isVisible();
    const isFocused = await appWindow.isFocused();

    if (isVisible && isFocused) {
      toast.info(`📋 ${$t('clipboard.detected')}`);
      goto(`/?url=${encodeURIComponent(url)}`);
      return;
    }

    if (!$settings.notificationsEnabled) {
      return;
    }

    const isChannel = isLikelyChannel(url);
    const isPlaylist = !isChannel && isLikelyPlaylist(url);

    try {
      const currentSettings = getSettings();

      if (isChannel && !isAndroid()) {
        interface ChannelInfo {
          is_playlist: boolean;
          id: string | null;
          title: string;
          channel?: string | null;
          uploader?: string | null;
          uploader_id?: string | null;
          thumbnail: string | null;
          total_count: number;
          channel_follower_count?: number | null;
        }
        const channelInfo = await invoke<ChannelInfo>('get_playlist_info', {
          url,
          offset: 0,
          limit: 1,
          cookiesFromBrowser: currentSettings.cookiesFromBrowser || null,
          customCookies: currentSettings.customCookies || null,
          proxyConfig: getProxyConfig(),
        });

        const channelName =
          channelInfo.channel || channelInfo.uploader || channelInfo.title || 'Channel';
        const handle = channelInfo.uploader_id ? `@${channelInfo.uploader_id}` : '';

        logs.info('layout', `Channel info: name=${channelName}, videos=${channelInfo.total_count}`);

        if (channelInfo.total_count > 0) {
          logs.info(
            'layout',
            `Showing channel notification: ${channelName} (${channelInfo.total_count} videos)`
          );

          mediaCache.setPreview(url, {
            title: channelName || undefined,
            thumbnail: channelInfo.thumbnail || undefined,
            author: handle || undefined,
          });

          await invoke('show_notification_window', {
            data: {
              title: channelName,
              body: `${channelInfo.total_count} videos${handle ? ` • ${handle}` : ''}`,
              thumbnail: channelInfo.thumbnail,
              url: url,
              compact: currentSettings.compactNotifications,
              download_label: $t('notification.downloadButton'),
              dismiss_label: $t('notification.dismissButton'),
              is_channel: true,
            },
            position: currentSettings.notificationPosition,
            monitor: currentSettings.notificationMonitor,
            offset: currentSettings.notificationOffset,
          });
          return;
        }
      }

      if (isPlaylist && !isAndroid()) {
        interface PlaylistInfo {
          is_playlist: boolean;
          id: string | null;
          title: string;
          uploader: string | null;
          thumbnail: string | null;
          total_count: number;
        }
        const playlistInfo = await invoke<PlaylistInfo>('get_playlist_info', {
          url,
          offset: 0,
          limit: 1,
          cookiesFromBrowser: currentSettings.cookiesFromBrowser || null,
          customCookies: currentSettings.customCookies || null,
          proxyConfig: getProxyConfig(),
        });
        logs.info(
          'layout',
          `Playlist info: is_playlist=${playlistInfo.is_playlist}, title=${playlistInfo.title}, count=${playlistInfo.total_count}`
        );

        if (playlistInfo.is_playlist && playlistInfo.total_count > 0) {
          logs.info(
            'layout',
            `Showing playlist notification: ${playlistInfo.title} (${playlistInfo.total_count} items}`
          );

          mediaCache.setPreview(url, {
            title: playlistInfo.title || undefined,
            thumbnail: playlistInfo.thumbnail || undefined,
            author: playlistInfo.uploader || undefined,
          });

          await invoke('show_notification_window', {
            data: {
              title: playlistInfo.title || $t('playlist.notification.detected'),
              body: `${playlistInfo.total_count} ${$t('playlist.videos')}`,
              thumbnail: null,
              url: url,
              compact: currentSettings.compactNotifications,
              download_label: $t('notification.downloadButton'),
              dismiss_label: $t('notification.dismissButton'),
              is_playlist: true,
            },
            position: currentSettings.notificationPosition,
            monitor: currentSettings.notificationMonitor,
            offset: currentSettings.notificationOffset,
          });
          return;
        }
      }
      
      const backend = detectBackendForUrl(url);
      const luxInstalled = backend === 'lux' && $deps.lux?.installed;
      const command = luxInstalled ? 'lux_get_video_info' : 'get_video_info';
      
      const videoInfo: VideoInfo = await invoke(command, {
        url,
        proxyConfig: getProxyConfig(),
      });

      const originalThumbnailUrl = videoInfo.thumbnail || getQuickThumbnail(url);

      let durationStr = '';
      if (videoInfo.duration) {
        const mins = Math.floor(videoInfo.duration / 60);
        const secs = Math.floor(videoInfo.duration % 60);
        durationStr = ` • ${mins}:${secs.toString().padStart(2, '0')}`;
      }

      const isTwitter = /(?:twitter\.com|x\.com)/i.test(url);
      const authorDisplay =
        isTwitter && videoInfo.uploader_id
          ? `@${videoInfo.uploader_id}`
          : videoInfo.uploader || videoInfo.channel || videoInfo.creator || '';

      mediaCache.setPreview(url, {
        title: videoInfo.title || undefined,
        thumbnail: originalThumbnailUrl || undefined,
        author: authorDisplay || undefined,
        duration: videoInfo.duration,
      });

      await invoke('show_notification_window', {
        data: {
          title: videoInfo.title || $t('notification.mediaDetected'),
          body: `${authorDisplay}${durationStr}`,
          thumbnail: originalThumbnailUrl,
          url: url,
          compact: currentSettings.compactNotifications,
          download_label: $t('notification.downloadButton'),
          dismiss_label: $t('notification.dismissButton'),
        },
        position: currentSettings.notificationPosition,
        monitor: currentSettings.notificationMonitor,
        offset: currentSettings.notificationOffset,
      });
    } catch (err) {
      console.error('Failed to get video info:', err);
      const currentSettings = getSettings();
      const quickThumbnail = getQuickThumbnail(url);
      await invoke('show_notification_window', {
        data: {
          title: $t('notification.mediaDetected'),
          body: $t('notification.clickToDownload'),
          thumbnail: quickThumbnail,
          url: url,
          compact: currentSettings.compactNotifications,
          download_label: $t('notification.downloadButton'),
          dismiss_label: $t('notification.dismissButton'),
        },
        position: currentSettings.notificationPosition,
        monitor: currentSettings.notificationMonitor,
        offset: currentSettings.notificationOffset,
      });
    }
  }

  async function downloadFromClipboard() {
    try {
      const text = await readText();
      if (text && isValidMediaUrl(text, $settings.clipboardPatterns || [])) {
        goto(`/?url=${encodeURIComponent(text)}`);
        if (appWindow) {
          await appWindow.show();
          await appWindow.setFocus();
        }
      } else {
        toast.warning($t('clipboard.noValidUrl'));
      }
    } catch (err) {
      toast.error($t('clipboard.error'));
    }
  }

  async function minimizeWindow() {
    if (appWindow) await appWindow.minimize();
  }

  async function maximizeWindow() {
    if (appWindow) await appWindow.toggleMaximize();
  }

  async function closeWindow() {
    if (appWindow) await appWindow.close();
  }

  interface NavItemConfig {
    path: string;
    icon: IconName;
    labelKey: string;
    badge?: number;
  }

  let mainNavItems = $derived<NavItemConfig[]>([
    { path: '/', icon: 'download2', labelKey: 'nav.download' },
    {
      path: '/downloads',
      icon: 'history',
      labelKey: 'nav.downloads',
      badge: $activeDownloadsCount > 0 ? $activeDownloadsCount : undefined,
    },
    { path: '/logs', icon: 'text', labelKey: 'nav.logs' },
    { path: '/settings', icon: 'settings', labelKey: 'nav.settings' },
  ]);

  const secondaryNavItems: NavItemConfig[] = [
    { path: '/info', icon: 'info', labelKey: 'nav.info' },
  ];

  let allNavItems = $derived<NavItemConfig[]>([...mainNavItems, ...secondaryNavItems]);

  let currentPath = $derived($page.url.pathname);
</script>

<!-- Notification windows get minimal rendering - no app shell -->
<!-- During SSR, browser is false, but we check currentPath which works on server too -->
{#if isNotificationWindow || currentPath.startsWith('/notification')}
  {@render children()}
{:else}
  <AccentProvider />
  <BackgroundProvider />
  <div class="app" class:mobile={isMobile}>
    <!-- Desktop titlebar (hidden on mobile) -->
    {#if !isMobile}
      <div class="titlebar" data-tauri-drag-region>
        <div class="titlebar-spacer"></div>
        <div class="titlebar-brand" data-tauri-drag-region>
          {#if isDownloading}
            <Icon name="download" size={13} />
            <span class="titlebar-speed">{totalDownloadSpeed}</span>
          {:else}
            <svg class="titlebar-icon" viewBox="0 0 1024 1024" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M300.29 223.05L612.418 0L844 298.937L799.054 760.396L472.441 1024L158 592.095L300.29 223.05ZM754.854 722.285C700.283 629.788 671.5 524.355 671.5 416.959V323.5L464.5 633.5L754.854 722.285Z"/>
            </svg>
            <span class="titlebar-text">comine</span>
          {/if}
        </div>
        <div class="window-controls" data-tauri-drag-region="false">
          <button class="titlebar-btn" onclick={minimizeWindow} use:tooltip={$t('window.minimize')}>
            <Icon name="minimize" size={16} />
          </button>
          <button class="titlebar-btn" onclick={maximizeWindow} use:tooltip={$t('window.maximize')}>
            <Icon name="maximize" size={12} />
          </button>
          <button
            class="titlebar-btn close-btn"
            onclick={closeWindow}
            use:tooltip={$t('window.close')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
    {/if}

    <div class="main-container">
      <!-- Desktop sidebar -->
      {#if !isMobile}
        <aside class="sidebar" data-tauri-drag-region>
          <nav class="sidebar-nav" data-tauri-drag-region>
            {#each allNavItems as item}
              <NavItem
                href={item.path}
                icon={item.icon}
                title={$t(item.labelKey)}
                active={currentPath === item.path}
                badge={item.badge}
              />
            {/each}
          </nav>

          <div class="sidebar-bottom" data-tauri-drag-region>
            <NavItem href="https://t.me/comineapp" icon="telegram" title="Telegram" external />
            <NavItem href="https://discord.gg/8sfk33Kr2A" icon="discord" title="Discord" external />
            <NavItem
              href="https://github.com/nichind/comine"
              icon="github"
              title="GitHub"
              external
            />
          </div>
        </aside>
      {/if}

      <main class="content-area">
        {@render children()}
      </main>
    </div>

    <!-- Mobile bottom bar -->
    {#if isMobile}
      <nav class="bottom-bar-container">
        <div class="bottom-bar" class:show-labels={$settings.showMobileNavLabels}>
          {#each allNavItems as item}
            {@const isActive = currentPath === item.path}
            <a 
              href={item.path} 
              class="bottom-bar-item" 
              class:active={isActive}
            >
              <div class="bottom-bar-icon" class:active={isActive}>
                <Icon name={item.icon} size={22} />
                {#if item.badge}
                  <span class="badge">{item.badge}</span>
                {/if}
              </div>
              {#if $settings.showMobileNavLabels}
                <span class="bottom-bar-label">{$t(item.labelKey)}</span>
              {/if}
            </a>
          {/each}
        </div>
      </nav>
    {/if}
  </div>

  <Toast />
  <NotificationPopup />
{/if}

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(body) {
    font-family:
      'Jost',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :global(h1) {
    font-family: 'Funnel Display', 'Jost', sans-serif;
    line-height: 1;
  }

  /* Subtle fade-in for page content */
  :global(.page) {
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Spotlight effect for buttons/cards */
  :global(.spotlight) {
    --spotlight-x: 50%;
    --spotlight-y: 50%;
    position: relative;
    overflow: hidden;
  }

  :global(.spotlight::before) {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(
      circle 150px at var(--spotlight-x) var(--spotlight-y),
      rgba(255, 255, 255, 0.15),
      transparent 60%
    );
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
  }

  :global(.spotlight:hover::before) {
    opacity: 1;
  }

  /* Border glow variant */
  :global(.spotlight-border) {
    --spotlight-x: 50%;
    --spotlight-y: 50%;
    position: relative;
  }

  :global(.spotlight-border::before) {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: radial-gradient(
      circle 100px at var(--spotlight-x) var(--spotlight-y),
      rgba(255, 255, 255, 0.5),
      transparent 50%
    );
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s;
  }

  :global(.spotlight-border:hover::before) {
    opacity: 1;
  }

  .app {
    background: rgba(19, 19, 19, 0.48);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    height: 100vh;
    width: 100vw;
    color: white;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }

  .app::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 12px;
    background: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 1) 0%,
      rgba(0, 0, 0, 0) 50%,
      rgba(0, 0, 0, 1) 100%
    );
    opacity: 0;
    pointer-events: none;
  }

  .titlebar {
    height: 30px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0;
    position: relative;
    z-index: 10;
    user-select: none;
    flex-shrink: 0;
  }

  .titlebar-spacer {
    width: 84px; /* Same width as window-controls to balance */
  }

  .titlebar-brand {
    display: flex;
    align-items: center;
    gap: 6px;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }

  @keyframes shimmer {
    0%, 100% {
      background-position: 200% center;
    }
    50% {
      background-position: -200% center;
    }
  }

  .titlebar-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    fill: rgba(255, 255, 255, 0.7);
    animation: icon-shimmer 3s ease-in-out infinite;
  }

  @keyframes icon-shimmer {
    0%, 40%, 60%, 100% {
      fill: rgba(255, 255, 255, 0.7);
    }
    50% {
      fill: rgba(255, 255, 255, 1);
    }
  }

  .titlebar-text {
    font-family: 'Funnel Display', 'Jost', sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.7) 0%,
      rgba(255, 255, 255, 0.7) 40%,
      rgba(255, 255, 255, 1) 50%,
      rgba(255, 255, 255, 0.7) 60%,
      rgba(255, 255, 255, 0.7) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 3s ease-in-out infinite;
  }

  .titlebar-speed {
    font-family: 'Jost', sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
    letter-spacing: 0.3px;
  }

  .titlebar-brand :global(svg:first-child:not(.titlebar-icon)) {
    color: var(--accent, #6366f1);
    animation: download-pulse 1.5s ease-in-out infinite;
  }

  @keyframes download-pulse {
    0%, 100% {
      opacity: 0.7;
    }
    50% {
      opacity: 1;
    }
  }

  .window-controls {
    display: flex;
    padding-right: 1px;
    gap: 0;
  }

  .titlebar-btn {
    width: 36px;
    height: 28px;
    border: none;
    background: transparent;
    color: #e1e1e1;
    cursor: pointer;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    padding: 0;
  }

  .titlebar-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .titlebar-btn.close-btn:hover {
    background: #ef4444;
    color: #ffffff;
  }

  .main-container {
    flex: 1;
    display: flex;
    position: relative;
    z-index: 1;
    overflow: hidden;
  }

  .sidebar {
    width: 56px;
    background: rgba(255, 255, 255, 0);
    border-right: 1px solid rgba(255, 255, 255, 0);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .sidebar-nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 0 0 8px;
    gap: 4px;
  }

  .sidebar-bottom {
    padding: 8px 0;
    border-top: 1px solid rgba(255, 255, 255, 0);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }

  /* Mobile floating bottom bar */
  .bottom-bar-container {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    padding: 12px;
    padding-bottom: max(12px, env(safe-area-inset-bottom, 12px));
    z-index: 100;
    pointer-events: none;
  }

  .bottom-bar {
    display: flex;
    justify-content: space-evenly;
    align-items: center;
    width: 92%;
    max-width: 420px;
    height: 64px;
    background: rgba(20, 20, 24, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 24px;
    padding: 0 8px;
    box-shadow: 
      0 8px 32px rgba(0, 0, 0, 0.4),
      0 2px 8px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    pointer-events: auto;
  }

  .bottom-bar.show-labels {
    height: 68px;
    padding: 0 4px;
  }

  .bottom-bar-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 8px 12px;
    color: rgba(255, 255, 255, 0.5);
    text-decoration: none;
    border-radius: 16px;
    transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    position: relative;
    min-width: 48px;
    -webkit-tap-highlight-color: transparent;
  }

  .bottom-bar-item:active {
    transform: scale(0.92);
    transition: transform 0.1s ease;
  }

  .bottom-bar-item:hover {
    color: rgba(255, 255, 255, 0.8);
  }

  .bottom-bar-item.active {
    color: #ffffff;
  }

  .bottom-bar-icon {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 32px;
    border-radius: 12px;
    transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .bottom-bar-icon.active {
    background: var(--accent, #6366f1);
    box-shadow: 
      0 4px 12px color-mix(in srgb, var(--accent, #6366f1) 40%, transparent),
      0 0 0 1px rgba(255, 255, 255, 0.1);
    transform: scale(1.05);
  }

  .bottom-bar-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.3px;
    opacity: 0.9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 64px;
    text-align: center;
    transition: opacity 0.2s ease;
  }

  .bottom-bar-item .badge {
    position: absolute;
    top: -2px;
    right: -2px;
    background: var(--accent, #6366f1);
    color: white;
    font-size: 9px;
    font-weight: 700;
    min-width: 16px;
    height: 16px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    border: 2px solid rgba(20, 20, 24, 0.9);
  }

  /* Mobile adjustments */
  .app.mobile {
    border-radius: 0;
    border: none;
  }

  .app.mobile .main-container {
    flex: 1;
    min-height: 0;
  }

  .app.mobile .content-area {
    padding: 0 0 0 8px;
    padding-top: env(safe-area-inset-top, 24px);
    /* No padding-bottom here - ScrollArea handles it with its own padding */
  }

  /* Mobile page padding */
  .app.mobile :global(.page) {
    padding: 0 !important;
    padding-bottom: 24px !important;
  }

  .app.mobile :global(.page h1) {
    font-size: 28px !important;
  }

  .app.mobile :global(.page-header) {
    padding-top: 8px;
  }

  /* Global scrollbar styles */
  :global(*::-webkit-scrollbar) {
    width: 6px;
    height: 6px;
  }

  :global(*::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(*::-webkit-scrollbar-thumb) {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  :global(*::-webkit-scrollbar-thumb:hover) {
    background: rgba(255, 255, 255, 0.25);
  }

  :global(*::-webkit-scrollbar-thumb:active) {
    background: rgba(255, 255, 255, 0.35);
  }

  :global(*::-webkit-scrollbar-corner) {
    background: transparent;
  }
</style>
