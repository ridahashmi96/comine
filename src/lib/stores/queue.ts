import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { stat } from '@tauri-apps/plugin-fs';
import { load, Store } from '@tauri-apps/plugin-store';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { history } from './history';
import { logs } from './logs';
import { deps } from './deps';
import { settings, getSettings, getProxyConfig } from './settings';
import { toast } from '$lib/components/Toast.svelte';
import { translate } from '$lib/i18n';
import {
  isAndroid,
  downloadOnAndroid,
  getVideoInfoOnAndroid,
  waitForAndroidYtDlp,
  type DownloadProgress as AndroidProgress,
} from '$lib/utils/android';

export type DownloadStatus =
  | 'pending'
  | 'paused'
  | 'fetching-info'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed';

export type QueueItemSource = 'ytdlp' | 'file';

export interface QueueItem {
  id: string;
  url: string;
  status: DownloadStatus;
  statusMessage: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number;
  filesize: number;
  extension: string;
  filePath: string;
  progress: number;
  speed: string;
  eta: string;
  error?: string;
  addedAt: number;
  type: 'video' | 'audio' | 'image' | 'file';
  priority: number;
  options?: Partial<DownloadOptions>;
  playlistId?: string;
  playlistTitle?: string;
  playlistIndex?: number;
  usePlaylistFolder?: boolean;
  source: QueueItemSource;
  mimeType?: string;
  totalBytes?: number;
  downloadedBytes?: number;
}

export interface PrefetchedInfo {
  title?: string;
  thumbnail?: string;
  author?: string;
  duration?: number;
}

export interface DownloadOptions {
  videoQuality: string;
  downloadMode: 'auto' | 'audio' | 'mute';
  audioQuality: string;
  convertToMp4: boolean;
  remux: boolean;
  useHLS: boolean;
  clearMetadata: boolean;
  dontShowInHistory: boolean;
  useAria2: boolean;
  ignoreMixes: boolean;
  cookiesFromBrowser: string;
  customCookies: string;
  prefetchedInfo?: PrefetchedInfo;
}

interface QueueState {
  items: QueueItem[];
  currentDownloadId: string | null;
  activeDownloadIds: string[];
  isPaused: boolean;
}

let queueStore: Store | null = null;
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

function serializeQueueItems(items: QueueItem[]): QueueItem[] {
  return items
    .filter(
      (item) => item.status === 'pending' || item.status === 'paused' || item.status === 'failed'
    )
    .map((item) => ({
      ...item,
      status:
        item.status === 'downloading' || item.status === 'processing'
          ? ('pending' as DownloadStatus)
          : item.status,
      statusMessage:
        item.status === 'failed' ? item.statusMessage : translate('downloads.status.queued'),
      progress: 0,
      speed: '',
      eta: '',
    }));
}

async function loadQueue(): Promise<QueueItem[]> {
  try {
    queueStore = await load('queue.json', { autoSave: false, defaults: {} });
    const items = await queueStore.get<QueueItem[]>('items');
    if (items && Array.isArray(items)) {
      logs.info('queue', `Loaded ${items.length} queued items from storage`);
      return items;
    }
  } catch (error) {
    logs.error('queue', `Failed to load queue from storage: ${error}`);
  }
  return [];
}

function saveQueue(items: QueueItem[]) {
  if (!queueStore) return;

  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  saveDebounceTimer = setTimeout(async () => {
    try {
      const serialized = serializeQueueItems(items);
      await queueStore!.set('items', serialized);
      await queueStore!.save();
      logs.debug('queue', `Saved ${serialized.length} queue items to storage`);
    } catch (error) {
      logs.error('queue', `Failed to save queue: ${error}`);
    }
  }, SAVE_DEBOUNCE_MS);
}

function createQueueStore() {
  const { subscribe, set, update } = writable<QueueState>({
    items: [],
    currentDownloadId: null,
    activeDownloadIds: [],
    isPaused: false,
  });

  let unlisten: UnlistenFn | null = null;
  let unlistenFilePath: UnlistenFn | null = null;
  let notificationPermission: boolean | null = null;

  const maxProgressMap = new Map<string, number>();

  const videoInfoPromises = new Map<string, Promise<void>>();

  const cancelledIds = new Set<string>();

  // Aggressive cleanup of orphaned Map entries (every 30 seconds)
  const CLEANUP_INTERVAL_MS = 30 * 1000;
  let cleanupInterval: ReturnType<typeof setInterval> | null = null;

  function cleanupMaps() {
    const state = get({ subscribe });
    const activeUrls = new Set(state.items.map((i) => i.url));
    const activeIds = new Set(state.items.map((i) => i.id));

    // Clean up maxProgressMap for URLs no longer in queue
    let cleanedProgress = 0;
    maxProgressMap.forEach((_, url) => {
      if (!activeUrls.has(url)) {
        maxProgressMap.delete(url);
        cleanedProgress++;
      }
    });

    // Clean up videoInfoPromises for items no longer in queue
    let cleanedPromises = 0;
    videoInfoPromises.forEach((_, id) => {
      if (!activeIds.has(id)) {
        videoInfoPromises.delete(id);
        cleanedPromises++;
      }
    });

    // Clean up cancelledIds for items no longer referenced
    let cleanedCancelled = 0;
    cancelledIds.forEach((id) => {
      if (!activeIds.has(id)) {
        cancelledIds.delete(id);
        cleanedCancelled++;
      }
    });

    if (cleanedProgress + cleanedPromises + cleanedCancelled > 0) {
      logs.debug(
        'queue',
        `Cleaned up ${cleanedProgress} progress entries, ${cleanedPromises} promises, ${cleanedCancelled} cancelled IDs`
      );
    }
  }

  function startCleanupInterval() {
    if (cleanupInterval) return;
    cleanupInterval = setInterval(cleanupMaps, CLEANUP_INTERVAL_MS);
  }

  async function ensureNotificationPermission(): Promise<boolean> {
    if (notificationPermission !== null) return notificationPermission;

    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === 'granted';
      }
      notificationPermission = granted;
      return granted;
    } catch {
      notificationPermission = false;
      return false;
    }
  }

  async function sendDownloadNotification(
    type: 'started' | 'completed' | 'failed',
    title: string,
    body?: string
  ) {
    if (isAndroid()) return;

    const currentSettings = getSettings();
    if (!currentSettings.notificationsEnabled) return;

    const hasPermission = await ensureNotificationPermission();
    if (!hasPermission) return;

    try {
      const icons: Record<string, string> = {
        started: '⬇️',
        completed: '✅',
        failed: '❌',
      };

      sendNotification({
        title: `${icons[type]} ${title}`,
        body: body || '',
      });
    } catch (e) {
      console.warn('Failed to send notification:', e);
    }
  }

  async function setupListener() {
    if (unlisten) return;

    logs.debug('queue', 'Setting up download progress listener');

    unlisten = await listen<{ url: string; message: string }>('download-progress', (event) => {
      const { url, message } = event.payload;

      logs.trace('progress', `[${url.slice(0, 50)}...] ${message}`);
      let statusMessage = '';
      let isPostProcessing = false;

      if (message.includes('[download]') && message.includes('Destination')) {
        statusMessage = translate('downloads.status.starting');
        const destMatch = message.match(/Destination:\s*(.+)/);
        if (destMatch) {
          const destPath = destMatch[1].trim();
          const filename = destPath.split(/[/\\]/).pop() || '';
          let titleFromPath = filename.replace(/\.[^.]+$/, '').trim();
          titleFromPath = titleFromPath.replace(/\.f(?:hls-?)?\d+$/i, '').trim();
          titleFromPath = titleFromPath.replace(/(\.f\d+)+$/i, '').trim();

          if (titleFromPath && titleFromPath.length > 3) {
            const state = get({ subscribe });
            const item = state.items.find((i) => i.url === url);
            const needsTitleFallback =
              item && (item.title === url || item.title.startsWith('http'));

            if (needsTitleFallback) {
              logs.info('queue', `Using title from destination as fallback: "${titleFromPath}"`);
              update((state) => ({
                ...state,
                items: state.items.map((i) =>
                  i.url === url ? { ...i, title: titleFromPath.slice(0, 200) } : i
                ),
              }));
            }
          }
        }
      } else if (message.includes('[Merger]') || message.includes('Merging')) {
        statusMessage = translate('downloads.status.merging');
        isPostProcessing = true;
      } else if (message.includes('[ExtractAudio]')) {
        statusMessage = translate('downloads.status.extractingAudio');
        isPostProcessing = true;
      } else if (message.includes('[EmbedThumbnail]')) {
        statusMessage = translate('downloads.status.embeddingThumbnail');
        isPostProcessing = true;
      } else if (message.includes('[Metadata]') || message.includes('[Mutagen]')) {
        statusMessage = translate('downloads.status.writingMetadata');
        isPostProcessing = true;
      } else if (message.includes('[ffmpeg]')) {
        statusMessage = translate('downloads.status.processing');
        isPostProcessing = true;
      } else if (message.includes('%')) {
        const state = get({ subscribe });
        const item = state.items.find((i) => i.url === url);
        const isAudio = item?.options?.downloadMode === 'audio';
        statusMessage = isAudio
          ? translate('downloads.status.downloadingAudio')
          : translate('downloads.status.downloading');
      }

      const match = message.match(/^\s+(\d+\.?\d*)%\s+(\S*)\s*(.*)/);
      if (match && !message.includes('[debug]') && !message.includes('[info]')) {
        const rawProgress = parseFloat(match[1]);

        if (rawProgress < 0 || rawProgress > 100) {
          return;
        }

        let speed = match[2] || '';
        let eta = match[3] || '';

        if (
          speed.toLowerCase() === 'na' ||
          speed.toLowerCase() === 'unknown' ||
          speed === 'N/A' ||
          speed === '~'
        ) {
          speed = '';
        }
        if (
          eta.toLowerCase() === 'na' ||
          eta.toLowerCase() === 'unknown' ||
          eta === 'N/A' ||
          eta === '~'
        ) {
          eta = '';
        }

        const currentMax = maxProgressMap.get(url) || 0;

        let cappedProgress: number;
        let newStatus: DownloadStatus = 'downloading';
        let newStatusMessage = statusMessage;

        if (rawProgress >= 99.9) {
          cappedProgress = 95;
          newStatus = 'processing';
          newStatusMessage = translate('downloads.status.processing');
          speed = '';
          eta = '';
          logs.debug('queue', `Download at ${rawProgress}%, entering processing phase`);
        } else {
          cappedProgress = Math.min(rawProgress * 0.9, 90);
        }

        const progress = Math.max(cappedProgress, currentMax);
        if (cappedProgress > currentMax) {
          maxProgressMap.set(url, cappedProgress);
        }

        const state = get({ subscribe });
        const currentItem = state.items.find((i) => i.url === url);

        update((state) => ({
          ...state,
          items: state.items.map((item) =>
            item.url === url
              ? {
                  ...item,
                  progress,
                  speed: speed || (newStatus === 'processing' ? '' : currentItem?.speed || ''),
                  eta: eta || (newStatus === 'processing' ? '' : currentItem?.eta || ''),
                  status: newStatus,
                  statusMessage: newStatusMessage || item.statusMessage,
                }
              : item
          ),
        }));
      } else if (isPostProcessing) {
        const currentMax = maxProgressMap.get(url) || 0;
        const postProcessProgress = Math.max(95, currentMax);
        maxProgressMap.set(url, postProcessProgress);

        update((state) => ({
          ...state,
          items: state.items.map((item) =>
            item.url === url
              ? {
                  ...item,
                  progress: postProcessProgress,
                  speed: '',
                  eta: '',
                  status: 'processing' as DownloadStatus,
                  statusMessage: statusMessage || item.statusMessage,
                }
              : item
          ),
        }));
      } else {
        update((state) => ({
          ...state,
          items: state.items.map((item) =>
            item.url === url
              ? {
                  ...item,
                  statusMessage: statusMessage || item.statusMessage,
                }
              : item
          ),
        }));
      }
    });

    unlistenFilePath = await listen<{ url: string; file_path: string }>(
      'download-file-path',
      async (event) => {
        const { url, file_path } = event.payload;
        logs.info('queue', `Received file path event: ${file_path}`);
        console.log('Received file path for', url, ':', file_path);

        const extension = file_path.split('.').pop()?.toLowerCase() || 'mp4';

        let filesize = 0;
        try {
          const fileStat = await stat(file_path);
          filesize = fileStat.size;
          console.log('File size:', filesize);
        } catch (err) {
          console.warn('Could not get file size:', err);
        }

        update((state) => ({
          ...state,
          items: state.items.map((item) =>
            item.url === url ? { ...item, filePath: file_path, extension, filesize } : item
          ),
        }));
      }
    );
  }

  async function processQueue() {
    const state = get({ subscribe });

    if (state.isPaused) {
      logs.debug('queue', 'Queue is paused, skipping processing');
      return;
    }

    const currentSettings = getSettings();
    const maxConcurrent = currentSettings.concurrentDownloads ?? 2;

    const activeCount = state.activeDownloadIds.length;

    if (activeCount >= maxConcurrent) {
      logs.trace('queue', `Already at max concurrent downloads (${activeCount}/${maxConcurrent})`);
      return;
    }

    const pendingItems = state.items
      .filter((item) => item.status === 'pending')
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.addedAt - b.addedAt;
      });

    const slotsAvailable = maxConcurrent - activeCount;
    const itemsToStart = pendingItems.slice(0, slotsAvailable);

    if (itemsToStart.length === 0) {
      return;
    }

    logs.info(
      'queue',
      `Starting ${itemsToStart.length} download(s), ${activeCount} already active, max ${maxConcurrent}`
    );

    for (const pendingItem of itemsToStart) {
      processDownload(pendingItem);
    }
  }

  async function processFileDownload(pendingItem: QueueItem) {
    const itemId = pendingItem.id;
    const url = pendingItem.url;

    logs.info('queue', `Starting file download: ${pendingItem.title} from ${url}`);

    maxProgressMap.delete(url);

    update((state) => ({
      ...state,
      currentDownloadId: itemId,
      activeDownloadIds: [...state.activeDownloadIds, itemId],
      items: state.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status: 'downloading' as DownloadStatus,
              statusMessage: translate('downloads.status.downloading'),
            }
          : item
      ),
    }));

    sendDownloadNotification(
      'started',
      translate('notifications.downloadStarted'),
      pendingItem.title || url
    );

    try {
      const currentSettings = getSettings();
      const proxyConfig = getProxyConfig();

      const result = await invoke<string>('download_file', {
        url: url,
        filename: pendingItem.title,
        downloadPath: currentSettings.downloadPath || '',
        proxyConfig: proxyConfig,
        connections: currentSettings.aria2Connections,
        speedLimit: currentSettings.downloadSpeedLimit,
      });

      const filePath = result;
      const extension = filePath.split('.').pop()?.toLowerCase() || pendingItem.extension;

      let filesize = pendingItem.totalBytes || 0;
      try {
        const fileStat = await stat(filePath);
        filesize = fileStat.size;
      } catch (err) {
        logs.warn('queue', `Could not get file size: ${err}`);
      }

      logs.info('queue', `File download completed: ${filePath}`);

      update((state) => {
        const newItems = state.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                status: 'completed' as DownloadStatus,
                progress: 100,
                filePath,
                extension,
                filesize,
              }
            : item
        );
        saveQueue(newItems);
        return {
          ...state,
          currentDownloadId:
            state.activeDownloadIds.length <= 1
              ? null
              : (state.activeDownloadIds.find((id) => id !== itemId) ?? null),
          activeDownloadIds: state.activeDownloadIds.filter((id) => id !== itemId),
          items: newItems,
        };
      });

      history.add({
        url: url,
        title: pendingItem.title || 'Downloaded file',
        author: new URL(url).hostname,
        thumbnail: '',
        extension: extension,
        size: filesize,
        duration: 0,
        filePath: filePath,
        type: 'file' as const,
      });

      sendDownloadNotification(
        'completed',
        translate('notifications.downloadComplete'),
        pendingItem.title || 'Download finished'
      );

      toast.success(translate('download.success'));

      setTimeout(() => {
        update((state) => ({
          ...state,
          items: state.items.filter((item) => item.id !== itemId),
        }));
      }, 3000);
    } catch (error) {
      if (cancelledIds.has(itemId)) {
        cancelledIds.delete(itemId);
        return;
      }

      logs.error('queue', `File download failed: ${error}`);

      update((state) => ({
        ...state,
        currentDownloadId:
          state.activeDownloadIds.length <= 1
            ? null
            : (state.activeDownloadIds.find((id) => id !== itemId) ?? null),
        activeDownloadIds: state.activeDownloadIds.filter((id) => id !== itemId),
        items: state.items.map((item) =>
          item.id === itemId
            ? { ...item, status: 'failed' as DownloadStatus, error: String(error) }
            : item
        ),
      }));

      sendDownloadNotification(
        'failed',
        translate('notifications.downloadFailed'),
        pendingItem.title || String(error)
      );

      toast.error(`${translate('download.error')}: ${error}`);
    } finally {
      maxProgressMap.delete(url);
      processQueue();
    }
  }

  async function processDownload(pendingItem: QueueItem) {
    if (pendingItem.source === 'file') {
      return processFileDownload(pendingItem);
    }

    const itemId = pendingItem.id;
    const url = pendingItem.url;

    logs.info('queue', `Starting download: ${url}`);
    logs.debug(
      'queue',
      `Download options: mode=${pendingItem.options?.downloadMode}, quality=${pendingItem.options?.videoQuality}, cookies=${pendingItem.options?.cookiesFromBrowser || 'none'}`
    );

    maxProgressMap.delete(url);

    update((state) => ({
      ...state,
      currentDownloadId: itemId,
      activeDownloadIds: [...state.activeDownloadIds, itemId],
      items: state.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status: 'downloading' as DownloadStatus,
              statusMessage: translate('downloads.status.starting'),
            }
          : item
      ),
    }));

    sendDownloadNotification(
      'started',
      translate('notifications.downloadStarted'),
      pendingItem.title || url
    );

    try {
      const hasPrefetchedInfo = pendingItem.options?.prefetchedInfo?.title;
      if (!hasPrefetchedInfo) {
        const infoPromise = fetchVideoInfo(
          itemId,
          url,
          pendingItem.options?.cookiesFromBrowser,
          pendingItem.options?.customCookies
        );
        videoInfoPromises.set(itemId, infoPromise);
      }

      let filePath = '';
      let filesize = 0;
      let extension = pendingItem.options?.downloadMode === 'audio' ? 'mp3' : 'mp4';

      if (isAndroid()) {
        await waitForAndroidYtDlp();

        const downloadMode = pendingItem.options?.downloadMode ?? 'auto';
        const videoQuality = pendingItem.options?.videoQuality ?? '';

        // Check if videoQuality is a raw format ID (from format modal)
        const isRawFormat =
          videoQuality &&
          (/^\d/.test(videoQuality) ||
            videoQuality.includes('+') ||
            videoQuality.startsWith('best'));

        let format = 'best';
        if (isRawFormat) {
          format = videoQuality;
        } else if (downloadMode === 'audio') {
          format = 'bestaudio[ext=m4a]/bestaudio';
        } else if (downloadMode === 'mute') {
          format = 'bestvideo';
        }

        const isAudioOnly = downloadMode === 'audio';

        const playlistFolder =
          pendingItem.playlistTitle && pendingItem.usePlaylistFolder !== false
            ? pendingItem.playlistTitle
            : null;

        console.log(
          'Starting Android download:',
          url,
          'format:',
          format,
          'playlistFolder:',
          playlistFolder
        );
        logs.info(
          'queue',
          `Starting Android download: ${url} (format: ${format}, isAudioOnly: ${isAudioOnly}${playlistFolder ? `, folder: ${playlistFolder}` : ''})`
        );

        const result = await downloadOnAndroid(
          url,
          format,
          (progress: AndroidProgress) => {
            const progressValue = Math.max(0, progress.progress);

            const currentMax = maxProgressMap.get(url) || 0;
            const effectiveProgress = Math.max(progressValue, currentMax);
            if (progressValue > currentMax) {
              maxProgressMap.set(url, progressValue);
            }

            update((state) => ({
              ...state,
              items: state.items.map((item) =>
                item.url === url
                  ? {
                      ...item,
                      progress: effectiveProgress,
                      eta: progress.etaSeconds > 0 ? `${progress.etaSeconds}s` : '',
                      status: 'downloading' as DownloadStatus,
                    }
                  : item
              ),
            }));
          },
          playlistFolder,
          isAudioOnly
        );

        console.log('Android download result:', result);
        logs.info(
          'queue',
          `Android download result: success=${result.success}, exitCode=${result.exitCode}, filePath=${result.filePath}`
        );

        if (result.filePath) {
          filePath = result.filePath;
          extension = filePath.split('.').pop()?.toLowerCase() || extension;
        }
        if (result.fileSize) {
          filesize = result.fileSize;
        }

        if (!result.success) {
          logs.error('queue', `Android download failed: ${result.error || 'Unknown error'}`);
          throw new Error(result.error || 'Download failed');
        }
      } else {
        const currentSettings = getSettings();
        const isAudioDownload = pendingItem.options?.downloadMode === 'audio';
        let downloadPath = currentSettings.downloadPath || '';

        if (isAudioDownload && currentSettings.useAudioPath && currentSettings.audioPath) {
          downloadPath = currentSettings.audioPath;
        }

        const playlistTitle =
          pendingItem.playlistTitle && pendingItem.usePlaylistFolder !== false
            ? pendingItem.playlistTitle
            : null;

        const proxyConfig = getProxyConfig();

        const downloadPromise = invoke<string>('download_video', {
          url: url,
          videoQuality: pendingItem.options?.videoQuality ?? 'max',
          downloadMode: pendingItem.options?.downloadMode ?? 'auto',
          audioQuality: pendingItem.options?.audioQuality ?? 'best',
          convertToMp4: pendingItem.options?.convertToMp4 ?? false,
          remux: pendingItem.options?.remux ?? true,
          clearMetadata: pendingItem.options?.clearMetadata ?? false,
          useAria2: pendingItem.options?.useAria2 ?? false,
          noPlaylist: pendingItem.options?.ignoreMixes ?? true,
          cookiesFromBrowser: pendingItem.options?.cookiesFromBrowser ?? '',
          customCookies: pendingItem.options?.customCookies ?? '',
          downloadPath: downloadPath,
          embedThumbnail: isAudioDownload && currentSettings.embedThumbnail,
          thumbnailUrlForEmbed: pendingItem.thumbnail || '',
          playlistTitle: playlistTitle,
          proxyConfig: proxyConfig,
          sponsorBlock: currentSettings.sponsorBlock,
          chapters: currentSettings.chapters,
          embedSubtitles: currentSettings.embedSubtitles,
          downloadSpeedLimit: currentSettings.downloadSpeedLimit,
        });

        logs.info(
          'queue',
          `Invoking download_video: downloadMode=${pendingItem.options?.downloadMode}, isAudioDownload=${isAudioDownload}, downloadPath=${downloadPath}, playlistTitle=${playlistTitle}`
        );
        logs.debug(
          'queue',
          `Full invoke params: videoQuality=${pendingItem.options?.videoQuality ?? 'max'}, remux=${pendingItem.options?.remux ?? true}, convertToMp4=${pendingItem.options?.convertToMp4 ?? false}`
        );

        logs.debug('queue', 'Awaiting download_video invoke...');
        const result = await downloadPromise;
        logs.info('queue', `download_video returned: ${result?.slice(0, 100) || 'null'}`);

        const isFilePath = result && (result.match(/^[A-Z]:\\/) || result.startsWith('/'));
        filePath = isFilePath ? result : '';

        logs.debug('queue', `extractedPath=${filePath?.slice(0, 80) || 'none'}`);

        if (filePath) {
          extension = filePath.split('.').pop()?.toLowerCase() || extension;

          try {
            const fileStat = await stat(filePath);
            filesize = fileStat.size;
            logs.debug('queue', `File stats retrieved: size=${filesize}, ext=${extension}`);
            console.log('File stats:', { filePath, extension, filesize });
          } catch (err) {
            logs.warn('queue', `Could not get file size: ${err}`);
            console.warn('Could not get file size:', err);
          }
        } else {
          logs.warn(
            'queue',
            'No file path returned from download_video - download may have failed silently'
          );
        }
      }

      update((state) => ({
        ...state,
        items: state.items.map((item) =>
          item.id === itemId ? { ...item, filePath, extension, filesize } : item
        ),
      }));

      logs.info('queue', `Download completed: ${url}`);
      logs.debug('queue', `File details: path=${filePath}, size=${filesize}, ext=${extension}`);

      update((state) => {
        const newItems = state.items.map((item) =>
          item.id === itemId
            ? { ...item, status: 'completed' as DownloadStatus, progress: 100 }
            : item
        );
        saveQueue(newItems);
        return {
          ...state,
          currentDownloadId:
            state.activeDownloadIds.length <= 1
              ? null
              : (state.activeDownloadIds.find((id) => id !== itemId) ?? null),
          activeDownloadIds: state.activeDownloadIds.filter((id) => id !== itemId),
          items: newItems,
        };
      });

      const infoPromise = videoInfoPromises.get(itemId);
      if (infoPromise) {
        try {
          await infoPromise;
        } catch {}
        videoInfoPromises.delete(itemId);
      }

      const completedItem = get({ subscribe }).items.find((i) => i.id === itemId);
      if (completedItem) {
        logs.debug(
          'queue',
          `Saving to history: title=${completedItem.title}, duration=${completedItem.duration}, size=${completedItem.filesize}, playlist=${completedItem.playlistTitle || 'none'}`
        );
        history.add({
          url: completedItem.url,
          title: completedItem.title || 'Downloaded video',
          author: completedItem.author || 'Unknown',
          thumbnail: completedItem.thumbnail || '',
          extension: completedItem.extension,
          size: completedItem.filesize,
          duration: completedItem.duration || 0,
          filePath: completedItem.filePath || '',
          type: completedItem.type,
          playlistId: completedItem.playlistId,
          playlistTitle: completedItem.playlistTitle,
          playlistIndex: completedItem.playlistIndex,
        });

        sendDownloadNotification(
          'completed',
          translate('notifications.downloadComplete'),
          completedItem.title || 'Download finished'
        );
      }

      toast.success(translate('download.success'));

      setTimeout(() => {
        update((state) => ({
          ...state,
          items: state.items.filter((item) => item.id !== itemId),
        }));
      }, 3000);
    } catch (error) {
      if (cancelledIds.has(itemId)) {
        cancelledIds.delete(itemId);
        console.log('Download was cancelled, skipping error handling');
        return;
      }

      console.error('Download failed:', error);
      logs.error('queue', `Download failed for ${url}: ${error}`);

      const failedItem = get({ subscribe }).items.find((i) => i.id === itemId);
      if (failedItem) {
        logs.debug(
          'queue',
          `Failed item state: status=${failedItem.status}, progress=${failedItem.progress}, statusMessage=${failedItem.statusMessage}`
        );
      }

      update((state) => ({
        ...state,
        currentDownloadId:
          state.activeDownloadIds.length <= 1
            ? null
            : (state.activeDownloadIds.find((id) => id !== itemId) ?? null),
        activeDownloadIds: state.activeDownloadIds.filter((id) => id !== itemId),
        items: state.items.map((item) =>
          item.id === itemId
            ? { ...item, status: 'failed' as DownloadStatus, error: String(error) }
            : item
        ),
      }));

      sendDownloadNotification(
        'failed',
        translate('notifications.downloadFailed'),
        failedItem?.title || String(error)
      );

      toast.error(`${translate('download.error')}: ${error}`);
    } finally {
      maxProgressMap.delete(url);
      processQueue();
    }
  }

  async function fetchVideoInfo(
    itemId: string,
    url: string,
    cookiesFromBrowser?: string,
    customCookies?: string
  ) {
    logs.debug('queue', `Fetching video info for: ${url}`);

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

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

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        let info: VideoInfo;

        if (isAndroid()) {
          await waitForAndroidYtDlp();
          const androidInfo = await getVideoInfoOnAndroid(url);
          if (!androidInfo) {
            throw new Error('Failed to get video info from Android');
          }
          info = {
            title: String(androidInfo.title || ''),
            uploader: String(androidInfo.uploader || ''),
            uploader_id: String(androidInfo.uploader_id || ''),
            channel: String(androidInfo.channel || ''),
            thumbnail: String(androidInfo.thumbnail || ''),
            duration: Number(androidInfo.duration || 0),
            ext: String(androidInfo.ext || ''),
          };
          logs.debug(
            'queue',
            `Android video info: title=${info.title}, uploader_id=${info.uploader_id}, duration=${info.duration}`
          );
        } else {
          const proxyConfig = getProxyConfig();
          info = await invoke<VideoInfo>('get_video_info', {
            url,
            cookiesFromBrowser: cookiesFromBrowser ?? '',
            customCookies: customCookies ?? '',
            proxyConfig: proxyConfig,
          });
          logs.debug(
            'queue',
            `Desktop video info (attempt ${attempt}): title=${info.title}, uploader=${info.uploader}, uploader_id=${info.uploader_id}`
          );
        }

        const isTwitter = /(?:twitter\.com|x\.com)/i.test(url);
        const authorDisplay =
          isTwitter && info.uploader_id
            ? `@${info.uploader_id}`
            : info.uploader || info.channel || info.creator || '';

        let cleanTitle = (info.title || '').replace(/\.f(?:hls-?)?\d+$/i, '').trim();
        cleanTitle = cleanTitle.replace(/(\.f\d+)+$/i, '').trim();

        update((state) => ({
          ...state,
          items: state.items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  title: cleanTitle.slice(0, 200) || item.title,
                  author: authorDisplay || item.author,
                  thumbnail: info.thumbnail || item.thumbnail,
                  duration: info.duration || item.duration,
                  filesize: info.filesize || item.filesize,
                  extension: info.ext || item.extension,
                }
              : item
          ),
        }));

        return;
      } catch (error) {
        lastError = error;
        logs.warn(
          'queue',
          `Video info fetch attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${error}`
        );

        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }
      }
    }

    logs.warn(
      'queue',
      `All ${MAX_RETRIES} attempts to fetch video info failed for ${url}: ${lastError}`
    );
    console.warn('Failed to fetch video info after retries:', lastError);
  }

  return {
    subscribe,

    async init() {
      await setupListener();
      startCleanupInterval();

      const persistedItems = await loadQueue();
      if (persistedItems.length > 0) {
        const validItems = persistedItems.filter(
          (item) =>
            item.status === 'pending' || item.status === 'paused' || item.status === 'failed'
        );

        const resetItems = validItems.map((item) => ({
          ...item,
          status:
            item.status === 'downloading' ||
            item.status === 'processing' ||
            item.status === 'fetching-info'
              ? ('pending' as DownloadStatus)
              : item.status,
          progress: item.status === 'failed' ? item.progress : 0,
          speed: '',
          eta: '',
        }));

        if (resetItems.length > 0) {
          update((state) => ({
            ...state,
            items: [...resetItems, ...state.items],
          }));
          logs.info('queue', `Restored ${resetItems.length} queue items from storage`);

          saveQueue(resetItems);

          processQueue();
        } else {
          logs.info('queue', 'No valid queue items to restore');
        }
      }
    },

    add(
      url: string,
      options?: Partial<DownloadOptions>,
      playlistInfo?: {
        playlistId: string;
        playlistTitle: string;
        playlistIndex?: number;
        usePlaylistFolder?: boolean;
      }
    ): string | null {
      if (!isAndroid()) {
        const depsState = get(deps);
        const ytdlpInstalled = depsState.ytdlp?.installed ?? false;
        const ffmpegInstalled = depsState.ffmpeg?.installed ?? false;

        if (!ytdlpInstalled || !ffmpegInstalled) {
          logs.warn(
            'queue',
            `Missing dependencies: yt-dlp=${ytdlpInstalled}, ffmpeg=${ffmpegInstalled}`
          );

          if (!ytdlpInstalled && !ffmpegInstalled) {
            toast.error(translate('settings.deps.missingBoth'));
          } else if (!ytdlpInstalled) {
            toast.error(translate('settings.deps.missingYtdlp'));
          } else {
            toast.error(translate('settings.deps.missingFfmpeg'));
          }

          return null;
        }
      }

      const state = get({ subscribe });
      const existingItem = state.items.find(
        (item) => item.url === url && item.status !== 'completed' && item.status !== 'failed'
      );
      if (existingItem) {
        console.log('URL already in queue:', url);
        return null;
      }

      const currentSettings = getSettings();
      let finalOptions: Partial<DownloadOptions> = { ...options };

      const isYouTubeMusic = /music\.youtube\.com/i.test(url);
      logs.info(
        'queue',
        `Add queue: isYouTubeMusic=${isYouTubeMusic}, setting=${currentSettings.youtubeMusicAudioOnly}, existingMode=${options?.downloadMode}`
      );

      if (isYouTubeMusic && currentSettings.youtubeMusicAudioOnly && !options?.downloadMode) {
        finalOptions.downloadMode = 'audio';
        logs.info('queue', `YouTube Music detected - set downloadMode to audio`);
      }

      logs.info('queue', `Final downloadMode: ${finalOptions.downloadMode}`);

      const id = crypto.randomUUID();
      const prefetched = finalOptions?.prefetchedInfo;

      const newItem: QueueItem = {
        id,
        url,
        status: 'pending',
        statusMessage: translate('downloads.status.queued'),
        title: prefetched?.title || url,
        author: prefetched?.author || '',
        thumbnail: prefetched?.thumbnail || '',
        duration: prefetched?.duration || 0,
        filesize: 0,
        extension: finalOptions?.downloadMode === 'audio' ? 'm4a' : 'mp4',
        filePath: '',
        progress: 0,
        speed: '',
        eta: '',
        addedAt: Date.now(),
        type: finalOptions?.downloadMode === 'audio' ? 'audio' : 'video',
        priority: 0,
        options: finalOptions,
        playlistId: playlistInfo?.playlistId,
        playlistTitle: playlistInfo?.playlistTitle,
        playlistIndex: playlistInfo?.playlistIndex,
        usePlaylistFolder: playlistInfo?.usePlaylistFolder,
        source: 'ytdlp',
      };

      update((state) => {
        const newItems = [...state.items, newItem];
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });

      processQueue();

      return id;
    },

    addFile(fileInfo: {
      url: string;
      filename: string;
      size?: number;
      mimeType?: string;
    }): string | null {
      const state = get({ subscribe });
      const existingItem = state.items.find(
        (item) =>
          item.url === fileInfo.url && item.status !== 'completed' && item.status !== 'failed'
      );
      if (existingItem) {
        console.log('URL already in queue:', fileInfo.url);
        return null;
      }

      const id = crypto.randomUUID();

      const extension = fileInfo.filename.split('.').pop()?.toLowerCase() || 'bin';

      const newItem: QueueItem = {
        id,
        url: fileInfo.url,
        status: 'pending',
        statusMessage: translate('downloads.status.queued'),
        title: fileInfo.filename,
        author: new URL(fileInfo.url).hostname,
        thumbnail: '',
        duration: 0,
        filesize: fileInfo.size || 0,
        extension,
        filePath: '',
        progress: 0,
        speed: '',
        eta: '',
        addedAt: Date.now(),
        type: 'file',
        priority: 0,
        source: 'file',
        mimeType: fileInfo.mimeType,
        totalBytes: fileInfo.size,
        downloadedBytes: 0,
      };

      update((state) => {
        const newItems = [...state.items, newItem];
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });

      processQueue();

      logs.info(
        'queue',
        `Added file download: ${fileInfo.filename} (${fileInfo.size || 'unknown size'})`
      );

      return id;
    },

    addPlaylist(
      entries: Array<{
        url: string;
        title?: string;
        thumbnail?: string;
        author?: string;
        duration?: number;
        downloadMode?: 'auto' | 'audio' | 'mute';
        videoQuality?: string;
      }>,
      playlistInfo: {
        playlistId: string;
        playlistTitle: string;
        usePlaylistFolder?: boolean;
      },
      globalOptions?: Partial<DownloadOptions>,
      order: 'queue' | 'reverse' | 'shuffle' = 'queue'
    ): string[] {
      let orderedEntries = [...entries];
      switch (order) {
        case 'reverse':
          orderedEntries = orderedEntries.reverse();
          break;
        case 'shuffle':
          orderedEntries = orderedEntries.sort(() => Math.random() - 0.5);
          break;
      }

      const addedIds: string[] = [];

      orderedEntries.forEach((entry, index) => {
        const entryOptions: Partial<DownloadOptions> = {
          ...globalOptions,
          downloadMode: entry.downloadMode ?? globalOptions?.downloadMode,
          videoQuality: entry.videoQuality ?? globalOptions?.videoQuality,
          prefetchedInfo: {
            title: entry.title,
            thumbnail: entry.thumbnail,
            author: entry.author,
            duration: entry.duration,
          },
        };

        const id = this.add(entry.url, entryOptions, {
          playlistId: playlistInfo.playlistId,
          playlistTitle: playlistInfo.playlistTitle,
          playlistIndex: index + 1,
          usePlaylistFolder: playlistInfo.usePlaylistFolder,
        });

        if (id) {
          addedIds.push(id);
        }
      });

      logs.info(
        'queue',
        `Added ${addedIds.length}/${entries.length} items from playlist "${playlistInfo.playlistTitle}"`
      );

      return addedIds;
    },

    async cancel(id: string) {
      const state = get({ subscribe });
      const item = state.items.find((i) => i.id === id);

      cancelledIds.add(id);

      if (item && (item.status === 'downloading' || item.status === 'processing')) {
        try {
          await invoke('cancel_download', { url: item.url });
          console.log('Download cancelled:', item.url);
        } catch (err) {
          console.warn('Failed to cancel download:', err);
        }
      }

      update((state) => {
        const newItems = state.items.filter((item) => item.id !== id);
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
          activeDownloadIds: state.activeDownloadIds.filter((activeId) => activeId !== id),
          currentDownloadId: state.currentDownloadId === id ? null : state.currentDownloadId,
        };
      });

      toast.info('Download cancelled');

      processQueue();
    },

    retry(id: string) {
      update((state) => {
        const newItems = state.items.map((item) =>
          item.id === id
            ? { ...item, status: 'pending' as DownloadStatus, error: undefined, progress: 0 }
            : item
        );
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });
      processQueue();
    },

    clearFinished() {
      update((state) => {
        const newItems = state.items.filter(
          (item) => item.status !== 'completed' && item.status !== 'failed'
        );
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });
    },

    clearAll() {
      update((state) => {
        saveQueue([]);
        return {
          ...state,
          items: [],
          activeDownloadIds: [],
          currentDownloadId: null,
        };
      });
    },

    pause() {
      update((state) => ({ ...state, isPaused: true }));
    },

    resume() {
      update((state) => ({ ...state, isPaused: false }));
      processQueue();
    },

    togglePause() {
      const state = get({ subscribe });
      if (state.isPaused) {
        update((s) => ({ ...s, isPaused: false }));
        processQueue();
      } else {
        update((s) => ({ ...s, isPaused: true }));
      }
    },

    pauseItem(id: string) {
      update((state) => {
        const newItems = state.items.map((item) =>
          item.id === id && item.status === 'pending'
            ? { ...item, status: 'paused' as DownloadStatus }
            : item
        );
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });
    },

    resumeItem(id: string) {
      update((state) => {
        const newItems = state.items.map((item) =>
          item.id === id && item.status === 'paused'
            ? { ...item, status: 'pending' as DownloadStatus }
            : item
        );
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });
      processQueue();
    },

    moveUp(id: string) {
      update((state) => {
        const newItems = state.items.map((item) =>
          item.id === id ? { ...item, priority: item.priority + 1 } : item
        );
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });
    },

    moveDown(id: string) {
      update((state) => {
        const newItems = state.items.map((item) =>
          item.id === id ? { ...item, priority: Math.max(0, item.priority - 1) } : item
        );
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });
    },

    moveToTop(id: string) {
      const state = get({ subscribe });
      const maxPriority = Math.max(...state.items.map((i) => i.priority), 0);
      update((s) => {
        const newItems = s.items.map((item) =>
          item.id === id ? { ...item, priority: maxPriority + 1 } : item
        );
        saveQueue(newItems);
        return {
          ...s,
          items: newItems,
        };
      });
    },

    cleanup() {
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
      }
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
      if (unlistenFilePath) {
        unlistenFilePath();
        unlistenFilePath = null;
      }
      maxProgressMap.clear();
      videoInfoPromises.clear();
      cancelledIds.clear();
    },

    cancelPlaylist(playlistId: string) {
      const state = get({ subscribe });
      const playlistItems = state.items.filter((i) => i.playlistId === playlistId);

      playlistItems.forEach((item) => {
        cancelledIds.add(item.id);
        if (item.status === 'downloading' || item.status === 'processing') {
          invoke('cancel_download', { url: item.url }).catch(console.warn);
        }
      });

      const playlistItemIds = new Set(playlistItems.map((i) => i.id));
      update((state) => {
        const newItems = state.items.filter((item) => item.playlistId !== playlistId);
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
          activeDownloadIds: state.activeDownloadIds.filter((id) => !playlistItemIds.has(id)),
          currentDownloadId: playlistItems.some((i) => i.id === state.currentDownloadId)
            ? null
            : state.currentDownloadId,
        };
      });

      toast.info('Playlist downloads cancelled');
      processQueue();
    },

    pausePlaylist(playlistId: string) {
      update((state) => {
        const newItems = state.items.map((item) =>
          item.playlistId === playlistId && item.status === 'pending'
            ? { ...item, status: 'paused' as DownloadStatus }
            : item
        );
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });
    },

    resumePlaylist(playlistId: string) {
      update((state) => {
        const newItems = state.items.map((item) =>
          item.playlistId === playlistId && item.status === 'paused'
            ? { ...item, status: 'pending' as DownloadStatus }
            : item
        );
        saveQueue(newItems);
        return {
          ...state,
          items: newItems,
        };
      });
      processQueue();
    },

    getPlaylistProgress(playlistId: string): { completed: number; total: number; failed: number } {
      const state = get({ subscribe });
      const items = state.items.filter((i) => i.playlistId === playlistId);
      return {
        completed: items.filter((i) => i.status === 'completed').length,
        failed: items.filter((i) => i.status === 'failed').length,
        total: items.length,
      };
    },
  };
}

export const queue = createQueueStore();

export const isQueuePaused = derived(queue, ($queue) => $queue.isPaused);

export const activeDownloadsCount = derived(
  queue,
  ($queue) =>
    $queue.items.filter((item) => item.status !== 'completed' && item.status !== 'failed').length
);

export const pendingDownloadsCount = derived(
  queue,
  ($queue) =>
    $queue.items.filter((item) => item.status === 'pending' || item.status === 'paused').length
);

export const activeDownloads = derived(queue, ($queue) =>
  $queue.items.filter((item) => item.status !== 'completed' && item.status !== 'failed')
);

export interface PlaylistGroup {
  playlistId: string;
  playlistTitle: string;
  items: QueueItem[];
  completed: number;
  failed: number;
  total: number;
  isExpanded: boolean;
}

export const groupedDownloads = derived(queue, ($queue) => {
  const activeItems = $queue.items.filter(
    (item) => item.status !== 'completed' && item.status !== 'failed'
  );

  const playlistMap = new Map<string, QueueItem[]>();
  const singles: QueueItem[] = [];

  activeItems.forEach((item) => {
    if (item.playlistId) {
      const existing = playlistMap.get(item.playlistId) || [];
      existing.push(item);
      playlistMap.set(item.playlistId, existing);
    } else {
      singles.push(item);
    }
  });

  const groups: PlaylistGroup[] = [];

  playlistMap.forEach((items, playlistId) => {
    items.sort((a, b) => (a.playlistIndex || 0) - (b.playlistIndex || 0));

    groups.push({
      playlistId,
      playlistTitle: items[0]?.playlistTitle || 'Playlist',
      items,
      completed: items.filter((i) => i.status === 'completed').length,
      failed: items.filter((i) => i.status === 'failed').length,
      total: items.length,
      isExpanded: true,
    });
  });

  return { groups, singles };
});
