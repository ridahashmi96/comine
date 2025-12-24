import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { stat } from '@tauri-apps/plugin-fs';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { history } from './history';
import { logs } from './logs';
import { deps } from './deps';
import { settings, getSettings } from './settings';
import { toast } from '$lib/components/Toast.svelte';
import { translate } from '$lib/i18n';
import { isAndroid, downloadOnAndroid, getVideoInfoOnAndroid, waitForAndroidYtDlp, processYtmThumbnailOnAndroid, type DownloadProgress as AndroidProgress } from '$lib/utils/android';

export type DownloadStatus = 'pending' | 'paused' | 'fetching-info' | 'downloading' | 'processing' | 'completed' | 'failed';

export interface QueueItem {
  id: string;
  url: string;
  status: DownloadStatus;
  statusMessage: string; // Human-readable status (e.g., "Downloading video...", "Merging...")
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
  type: 'video' | 'audio' | 'image';
  priority: number;
  options?: Partial<DownloadOptions>;
  playlistId?: string;
  playlistTitle?: string;
  playlistIndex?: number;
  usePlaylistFolder?: boolean;
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
  cookiesFromBrowser: string; // 'chrome', 'firefox', 'edge', 'safari', 'opera', 'brave', 'custom', or empty
  customCookies: string; // Netscape format cookies text (used when cookiesFromBrowser is 'custom')
  prefetchedInfo?: PrefetchedInfo; // Pre-fetched metadata from notification popup
}

interface QueueState {
  items: QueueItem[];
  currentDownloadId: string | null; // Deprecated - kept for compatibility, use activeDownloadIds
  activeDownloadIds: string[]; // Track multiple concurrent downloads
  isPaused: boolean; // Global queue pause state
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
  
  async function sendDownloadNotification(type: 'started' | 'completed' | 'failed', title: string, body?: string) {
    const currentSettings = getSettings();
    if (!currentSettings.notificationsEnabled) return;
    
    const hasPermission = await ensureNotificationPermission();
    if (!hasPermission) return;
    
    try {
      const icons: Record<string, string> = {
        started: '⬇️',
        completed: '✅',
        failed: '❌'
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
            const item = state.items.find(i => i.url === url);
            const needsTitleFallback = item && (item.title === url || item.title.startsWith('http'));
            
            if (needsTitleFallback) {
              logs.info('queue', `Using title from destination as fallback: "${titleFromPath}"`);
              update(state => ({
                ...state,
                items: state.items.map(i =>
                  i.url === url ? { ...i, title: titleFromPath.slice(0, 200) } : i
                )
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
        const item = state.items.find(i => i.url === url);
        const isAudio = item?.options?.downloadMode === 'audio';
        statusMessage = isAudio 
          ? translate('downloads.status.downloadingAudio')
          : translate('downloads.status.downloading');
      }
      
      const match = message.match(/^\s+(\d+\.?\d*)%\s+(\S*)\s*(.*)/);
      if (match && !message.includes('[debug]') && !message.includes('[info]')) {
        const rawProgress = parseFloat(match[1]);
        
        // Sanity check - progress should be 0-100
        if (rawProgress < 0 || rawProgress > 100) {
          return; // Invalid progress, skip
        }
        
        let speed = match[2] || '';
        let eta = match[3] || '';
        
        // Filter out "NA", "Unknown", "N/A" values that yt-dlp outputs when data isn't available
        if (speed.toLowerCase() === 'na' || speed.toLowerCase() === 'unknown' || speed === 'N/A' || speed === '~') {
          speed = '';
        }
        if (eta.toLowerCase() === 'na' || eta.toLowerCase() === 'unknown' || eta === 'N/A' || eta === '~') {
          eta = '';
        }
        
        // Get the current max progress for this URL
        const currentMax = maxProgressMap.get(url) || 0;
        
        // When download hits 100%, it means streams are done and post-processing begins
        // Jump to 95% to indicate processing phase (FFmpeg merge/remux)
        // For downloads <100%, cap at 90% to reserve 10% for post-processing
        let cappedProgress: number;
        let newStatus: DownloadStatus = 'downloading';
        let newStatusMessage = statusMessage;
        
        if (rawProgress >= 99.9) {
          // Download complete, entering post-processing phase
          cappedProgress = 95;
          newStatus = 'processing';
          newStatusMessage = translate('downloads.status.processing');
          speed = ''; // Clear speed during processing
          eta = ''; // Clear ETA during processing
          logs.debug('queue', `Download at ${rawProgress}%, entering processing phase`);
        } else {
          // Still downloading - cap at 90%
          cappedProgress = Math.min(rawProgress * 0.9, 90);
        }
        
        // Only update max if we're going up
        const progress = Math.max(cappedProgress, currentMax);
        if (cappedProgress > currentMax) {
          maxProgressMap.set(url, cappedProgress);
        }
        
        // Keep previous speed/eta if new ones are empty (prevents flickering)
        const state = get({ subscribe });
        const currentItem = state.items.find(i => i.url === url);
        
        update(state => ({
          ...state,
          items: state.items.map(item => 
            item.url === url 
              ? { 
                  ...item, 
                  progress, 
                  speed: speed || (newStatus === 'processing' ? '' : (currentItem?.speed || '')), 
                  eta: eta || (newStatus === 'processing' ? '' : (currentItem?.eta || '')), 
                  status: newStatus,
                  statusMessage: newStatusMessage || item.statusMessage
                }
              : item
          )
        }));
      } else if (isPostProcessing) {
        // During post-processing (FFmpeg), show progress from 90% to 99%
        // We'll stay at 95% during processing, and 100% only on completion
        const currentMax = maxProgressMap.get(url) || 0;
        const postProcessProgress = Math.max(95, currentMax);
        maxProgressMap.set(url, postProcessProgress);
        
        update(state => ({
          ...state,
          items: state.items.map(item =>
            item.url === url
              ? { 
                  ...item, 
                  progress: postProcessProgress,
                  speed: '', // Clear speed during processing
                  eta: '', // Clear ETA during processing
                  status: 'processing' as DownloadStatus,
                  statusMessage: statusMessage || item.statusMessage
                }
              : item
          )
        }));
      } else {
        // Update the status and message without changing progress
        update(state => ({
          ...state,
          items: state.items.map(item =>
            item.url === url
              ? { 
                  ...item, 
                  statusMessage: statusMessage || item.statusMessage
                }
              : item
          )
        }));
      }
    });
    
    // Listen for file path events
    unlistenFilePath = await listen<{ url: string; file_path: string }>('download-file-path', async (event) => {
      const { url, file_path } = event.payload;
      logs.info('queue', `Received file path event: ${file_path}`);
      console.log('Received file path for', url, ':', file_path);
      
      // Extract extension from file path
      const extension = file_path.split('.').pop()?.toLowerCase() || 'mp4';
      
      // Try to get file size
      let filesize = 0;
      try {
        const fileStat = await stat(file_path);
        filesize = fileStat.size;
        console.log('File size:', filesize);
      } catch (err) {
        console.warn('Could not get file size:', err);
      }
      
      update(state => ({
        ...state,
        items: state.items.map(item =>
          item.url === url
            ? { ...item, filePath: file_path, extension, filesize }
            : item
        )
      }));
    });
  }

  // Process next item(s) in queue - supports concurrent downloads
  async function processQueue() {
    const state = get({ subscribe });
    
    // Don't process if queue is paused
    if (state.isPaused) {
      logs.debug('queue', 'Queue is paused, skipping processing');
      return;
    }
    
    // Get concurrent download limit from settings (default 2)
    const currentSettings = getSettings();
    const maxConcurrent = currentSettings.concurrentDownloads ?? 2;
    
    // Count currently active downloads
    const activeCount = state.activeDownloadIds.length;
    
    // Check if we can start more downloads
    if (activeCount >= maxConcurrent) {
      logs.trace('queue', `Already at max concurrent downloads (${activeCount}/${maxConcurrent})`);
      return;
    }
    
    // Find pending items (not paused individually), sort by priority (higher first), then by addedAt
    const pendingItems = state.items
      .filter(item => item.status === 'pending')
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.addedAt - b.addedAt; // Earlier first if same priority
      });
    
    // Calculate how many new downloads we can start
    const slotsAvailable = maxConcurrent - activeCount;
    const itemsToStart = pendingItems.slice(0, slotsAvailable);
    
    if (itemsToStart.length === 0) {
      return;
    }
    
    logs.info('queue', `Starting ${itemsToStart.length} download(s), ${activeCount} already active, max ${maxConcurrent}`);
    
    // Start each download concurrently (don't await - let them run in parallel)
    for (const pendingItem of itemsToStart) {
      processDownload(pendingItem);
    }
  }
  
  // Process a single download item
  async function processDownload(pendingItem: QueueItem) {
    const itemId = pendingItem.id;
    const url = pendingItem.url;
    
    logs.info('queue', `Starting download: ${url}`);
    logs.debug('queue', `Download options: mode=${pendingItem.options?.downloadMode}, quality=${pendingItem.options?.videoQuality}, cookies=${pendingItem.options?.cookiesFromBrowser || 'none'}`);
    
    // Reset max progress tracking for this URL
    maxProgressMap.delete(url);

    // Update status to downloading and add to active downloads
    update(state => ({
      ...state,
      currentDownloadId: itemId, // Keep for backwards compatibility
      activeDownloadIds: [...state.activeDownloadIds, itemId],
      items: state.items.map(item =>
        item.id === itemId ? { 
          ...item, 
          status: 'downloading' as DownloadStatus,
          statusMessage: translate('downloads.status.starting')
        } : item
      )
    }));
    
    // Send notification that download started
    sendDownloadNotification(
      'started',
      translate('notifications.downloadStarted'),
      pendingItem.title || url
    );

    // Promise to track YTM thumbnail processing (if needed)
    let ytmThumbnailPromise: Promise<void> | null = null;
    
    try {
      // Only fetch video info if we don't have prefetched metadata
      const hasPrefetchedInfo = pendingItem.options?.prefetchedInfo?.title;
      if (!hasPrefetchedInfo) {
        // Fetch video info in parallel - store the promise to await before saving to history
        const infoPromise = fetchVideoInfo(itemId, url, pendingItem.options?.cookiesFromBrowser, pendingItem.options?.customCookies);
        videoInfoPromises.set(itemId, infoPromise);
      } else {
        console.log('Skipping video info fetch - using prefetched metadata');
        
        // For YouTube Music with prefetched info, we still need to process the thumbnail
        // The notification had the original URL, but we need to crop it for embedding
        const isYouTubeMusic = /music\.youtube\.com/i.test(url);
        const currentThumbnail = pendingItem.thumbnail;
        if (isYouTubeMusic && currentThumbnail && !currentThumbnail.startsWith('data:image/')) {
          logs.info('queue', 'YouTube Music with prefetched info - processing thumbnail for cropping');
          // Process thumbnail - store promise so we can wait for it before download
          ytmThumbnailPromise = (async () => {
            try {
              let processedThumbnail: string;
              if (isAndroid()) {
                processedThumbnail = await processYtmThumbnailOnAndroid(currentThumbnail);
              } else {
                processedThumbnail = await invoke<string>('process_ytm_thumbnail', { 
                  thumbnailUrl: currentThumbnail 
                });
              }
              if (processedThumbnail !== currentThumbnail) {
                logs.info('queue', 'Thumbnail cropped to 1:1 square for YTM');
                // Update the queue item with cropped thumbnail
                update(state => ({
                  ...state,
                  items: state.items.map(item =>
                    item.id === itemId ? { ...item, thumbnail: processedThumbnail } : item
                  )
                }));
              }
            } catch (e) {
              logs.warn('queue', `Failed to process YTM thumbnail: ${e}`);
            }
          })();
        }
      }

      let filePath = '';
      let filesize = 0;
      let extension = pendingItem.options?.downloadMode === 'audio' ? 'mp3' : 'mp4';

      // Use Android bridge or desktop invoke based on platform
      if (isAndroid()) {
        // Wait for Android yt-dlp to be ready
        await waitForAndroidYtDlp();
        
        // Build format string for Android
        // Keep it simple for Android - complex format strings can cause issues
        const downloadMode = pendingItem.options?.downloadMode ?? 'auto';
        
        let format = 'best';
        if (downloadMode === 'audio') {
          // Prefer m4a (AAC, widely supported), fall back to any audio format
          // We can only use audio-only streams on Android (no ffprobe for extraction)
          format = 'bestaudio[ext=m4a]/bestaudio';
        } else if (downloadMode === 'mute') {
          format = 'bestvideo';
        }
        // For 'auto' mode, just use 'best' and let --merge-output-format handle merging
        
        console.log('Starting Android download:', url, 'format:', format);
        logs.info('queue', `Starting Android download: ${url} (format: ${format})`);
        
        // Download using Android bridge with progress updates
        // Note: The android.ts already implements non-decreasing progress internally
        const result = await downloadOnAndroid(url, format, (progress: AndroidProgress) => {
          // youtubedl-android reports -1 for indeterminate progress, clamp to 0
          const progressValue = Math.max(0, progress.progress);
          
          // Also track on our side for consistency
          const currentMax = maxProgressMap.get(url) || 0;
          const effectiveProgress = Math.max(progressValue, currentMax);
          if (progressValue > currentMax) {
            maxProgressMap.set(url, progressValue);
          }
          
          update(state => ({
            ...state,
            items: state.items.map(item =>
              item.url === url
                ? { 
                    ...item, 
                    progress: effectiveProgress, 
                    eta: progress.etaSeconds > 0 ? `${progress.etaSeconds}s` : '',
                    status: 'downloading' as DownloadStatus
                  }
                : item
            )
          }));
        });
        
        console.log('Android download result:', result);
        logs.info('queue', `Android download result: success=${result.success}, exitCode=${result.exitCode}, filePath=${result.filePath}`);
        
        // Get file path and size from the result
        if (result.filePath) {
          filePath = result.filePath;
          // Extract extension from actual file
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
        // Desktop: use Tauri invoke
        // Determine which download path to use based on settings and download mode
        const currentSettings = getSettings();
        const isAudioDownload = pendingItem.options?.downloadMode === 'audio';
        let downloadPath = currentSettings.downloadPath || '';
        
        // Use separate audio path if enabled and this is an audio download
        if (isAudioDownload && currentSettings.useAudioPath && currentSettings.audioPath) {
          downloadPath = currentSettings.audioPath;
        }
        
        // Determine playlist title to pass to backend for subfolder creation
        // Pass playlist title if usePlaylistFolder is enabled (per-download flag takes precedence)
        const playlistTitle = (pendingItem.playlistTitle && pendingItem.usePlaylistFolder !== false)
          ? pendingItem.playlistTitle
          : null;
        
        // For YTM audio downloads with thumbnail embedding:
        // We need the cropped thumbnail BEFORE starting download so backend can embed it
        // Wait for thumbnail processing first if we're going to embed
        
        // Get the current thumbnail - check if already cropped
        let currentItem = get({ subscribe }).items.find(i => i.id === itemId);
        let croppedThumbnailData = currentItem?.thumbnail?.startsWith('data:image/') 
          ? currentItem.thumbnail 
          : null;
        
        // If thumbnail is being processed and we need to embed it, wait for processing first
        if (ytmThumbnailPromise && isAudioDownload && currentSettings.embedThumbnail && !croppedThumbnailData) {
          logs.info('queue', 'Waiting for YTM thumbnail processing before download...');
          try {
            await ytmThumbnailPromise;
            // Get the updated cropped thumbnail
            currentItem = get({ subscribe }).items.find(i => i.id === itemId);
            croppedThumbnailData = currentItem?.thumbnail?.startsWith('data:image/') 
              ? currentItem.thumbnail 
              : null;
            if (croppedThumbnailData) {
              logs.info('queue', 'Got cropped thumbnail, starting download with it');
            }
          } catch (e) {
            logs.warn('queue', `Thumbnail processing failed, continuing without crop: ${e}`);
          }
        }
        
        // Start download with cropped thumbnail if available
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
          // Pass cropped thumbnail - backend will embed it post-download
          croppedThumbnailData: croppedThumbnailData,
          // Pass playlist title for subfolder creation (backend handles path creation)
          playlistTitle: playlistTitle,
        });
        
        logs.info('queue', `Invoking download_video: downloadMode=${pendingItem.options?.downloadMode}, isAudioDownload=${isAudioDownload}, downloadPath=${downloadPath}, playlistTitle=${playlistTitle}`);
        logs.debug('queue', `Full invoke params: videoQuality=${pendingItem.options?.videoQuality ?? 'max'}, remux=${pendingItem.options?.remux ?? true}, convertToMp4=${pendingItem.options?.convertToMp4 ?? false}`);
        
        // Wait for download to complete
        logs.debug('queue', 'Awaiting download_video invoke...');
        const result = await downloadPromise;
        logs.info('queue', `download_video returned: ${result?.slice(0, 100) || 'null'}`);
        
        // Check if result is a file path (starts with drive letter or /)
        const isFilePath = result && (result.match(/^[A-Z]:\\/) || result.startsWith('/'));
        filePath = isFilePath ? result : '';
        
        logs.debug('queue', `extractedPath=${filePath?.slice(0, 80) || 'none'}`);

        // Get file stats (size, extension) if we have a path
        if (filePath) {
          // Extract extension from actual file
          extension = filePath.split('.').pop()?.toLowerCase() || extension;
          
          // Get file size
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
          logs.warn('queue', 'No file path returned from download_video - download may have failed silently');
        }
      }

      // Update item with file path and stats before marking complete
      update(state => ({
        ...state,
        items: state.items.map(item =>
          item.id === itemId 
            ? { ...item, filePath, extension, filesize }
            : item
        )
      }));

      // Mark as completed
      logs.info('queue', `Download completed: ${url}`);
      logs.debug('queue', `File details: path=${filePath}, size=${filesize}, ext=${extension}`);
      
      update(state => ({
        ...state,
        currentDownloadId: state.activeDownloadIds.length <= 1 ? null : state.activeDownloadIds.find(id => id !== itemId) ?? null,
        activeDownloadIds: state.activeDownloadIds.filter(id => id !== itemId),
        items: state.items.map(item =>
          item.id === itemId 
            ? { ...item, status: 'completed' as DownloadStatus, progress: 100 }
            : item
        )
      }));

      // Wait for video info to be fetched before saving to history (ensures duration is captured)
      const infoPromise = videoInfoPromises.get(itemId);
      if (infoPromise) {
        try {
          await infoPromise;
        } catch {
          // Video info fetch failed, continue with what we have
        }
        videoInfoPromises.delete(itemId);
      }

      // Add to history (with fresh data - now includes duration from video info)
      const completedItem = get({ subscribe }).items.find(i => i.id === itemId);
      if (completedItem) {
        logs.debug('queue', `Saving to history: title=${completedItem.title}, duration=${completedItem.duration}, size=${completedItem.filesize}, playlist=${completedItem.playlistTitle || 'none'}`);
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
          // Include playlist info if present
          playlistId: completedItem.playlistId,
          playlistTitle: completedItem.playlistTitle,
          playlistIndex: completedItem.playlistIndex,
        });
        
        // Send system notification for completed download
        sendDownloadNotification(
          'completed',
          translate('notifications.downloadComplete'),
          completedItem.title || 'Download finished'
        );
      }

      toast.success(translate('download.success'));
      
      // Remove from queue after a delay
      setTimeout(() => {
        update(state => ({
          ...state,
          items: state.items.filter(item => item.id !== itemId)
        }));
      }, 3000);

    } catch (error) {
      // Check if this was a cancelled download - don't show error
      if (cancelledIds.has(itemId)) {
        cancelledIds.delete(itemId);
        console.log('Download was cancelled, skipping error handling');
        return;
      }
      
      console.error('Download failed:', error);
      logs.error('queue', `Download failed for ${url}: ${error}`);
      
      // Log additional debug info
      const failedItem = get({ subscribe }).items.find(i => i.id === itemId);
      if (failedItem) {
        logs.debug('queue', `Failed item state: status=${failedItem.status}, progress=${failedItem.progress}, statusMessage=${failedItem.statusMessage}`);
      }
      
      update(state => ({
        ...state,
        currentDownloadId: state.activeDownloadIds.length <= 1 ? null : state.activeDownloadIds.find(id => id !== itemId) ?? null,
        activeDownloadIds: state.activeDownloadIds.filter(id => id !== itemId),
        items: state.items.map(item =>
          item.id === itemId 
            ? { ...item, status: 'failed' as DownloadStatus, error: String(error) }
            : item
        )
      }));
      
      // Send system notification for failed download
      sendDownloadNotification(
        'failed',
        translate('notifications.downloadFailed'),
        failedItem?.title || String(error)
      );

      toast.error(`${translate('download.error')}: ${error}`);
    } finally {
      // Clean up max progress tracking for this URL
      maxProgressMap.delete(url);
      // Process next item(s) - more slots may be available now
      processQueue();
    }
  }

  // Fetch video info in background with retry logic
  async function fetchVideoInfo(itemId: string, url: string, cookiesFromBrowser?: string, customCookies?: string) {
    logs.debug('queue', `Fetching video info for: ${url}`);
    
    // Retry configuration for unreliable network/API calls
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
          logs.debug('queue', `Android video info: title=${info.title}, uploader_id=${info.uploader_id}, duration=${info.duration}`);
        } else {
          info = await invoke<VideoInfo>('get_video_info', { 
            url, 
            cookiesFromBrowser: cookiesFromBrowser ?? '',
            customCookies: customCookies ?? '',
          });
          logs.debug('queue', `Desktop video info (attempt ${attempt}): title=${info.title}, uploader=${info.uploader}, uploader_id=${info.uploader_id}`);
        }
        
        // Check if this is a YouTube Music URL and process thumbnail
        const isYouTubeMusic = /music\.youtube\.com/i.test(url);
        if (isYouTubeMusic && info.thumbnail) {
          logs.info('queue', 'YouTube Music detected, processing thumbnail for 1:1 crop');
          try {
            let processedThumbnail: string;
            if (isAndroid()) {
              processedThumbnail = await processYtmThumbnailOnAndroid(info.thumbnail);
            } else {
              processedThumbnail = await invoke<string>('process_ytm_thumbnail', { 
                thumbnailUrl: info.thumbnail 
              });
            }
            if (processedThumbnail !== info.thumbnail) {
              logs.info('queue', 'Thumbnail cropped to 1:1 square');
              info.thumbnail = processedThumbnail;
            }
          } catch (e) {
            logs.warn('queue', `Failed to process YTM thumbnail: ${e}`);
          }
        }
        
        // For author: use @username only for Twitter/X, otherwise use display name
        const isTwitter = /(?:twitter\.com|x\.com)/i.test(url);
        const authorDisplay = isTwitter && info.uploader_id
          ? `@${info.uploader_id}` 
          : (info.uploader || info.channel || info.creator || '');
        
        // Clean title - remove yt-dlp format suffixes like ".fhls-2170", ".f123"
        let cleanTitle = (info.title || '').replace(/\.f(?:hls-?)?\d+$/i, '').trim();
        cleanTitle = cleanTitle.replace(/(\.f\d+)+$/i, '').trim();
        
        update(state => ({
          ...state,
          items: state.items.map(item =>
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
          )
        }));
        
        // Success - exit retry loop
        return;
        
      } catch (error) {
        lastError = error;
        logs.warn('queue', `Video info fetch attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${error}`);
        
        if (attempt < MAX_RETRIES) {
          // Wait before retrying with exponential backoff
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }
      }
    }
    
    // All retries failed
    logs.warn('queue', `All ${MAX_RETRIES} attempts to fetch video info failed for ${url}: ${lastError}`);
    console.warn('Failed to fetch video info after retries:', lastError);
  }

  return {
    subscribe,

    // Initialize the store (call this on app start)
    async init() {
      await setupListener();
    },

    // Add a new download to the queue
    add(url: string, options?: Partial<DownloadOptions>, playlistInfo?: { playlistId: string; playlistTitle: string; playlistIndex?: number; usePlaylistFolder?: boolean }): string | null {
      // On desktop, check if required dependencies are installed before adding to queue
      if (!isAndroid()) {
        const depsState = get(deps);
        const ytdlpInstalled = depsState.ytdlp?.installed ?? false;
        const ffmpegInstalled = depsState.ffmpeg?.installed ?? false;
        
        if (!ytdlpInstalled || !ffmpegInstalled) {
          logs.warn('queue', `Missing dependencies: yt-dlp=${ytdlpInstalled}, ffmpeg=${ffmpegInstalled}`);
          
          // Show appropriate error message
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
      
      // Check if URL is already in queue (not completed/failed)
      const state = get({ subscribe });
      const existingItem = state.items.find(item => 
        item.url === url && 
        item.status !== 'completed' && 
        item.status !== 'failed'
      );
      if (existingItem) {
        console.log('URL already in queue:', url);
        return null; // Already queued
      }
      
      // Auto-detect YouTube Music URLs and set audio-only mode if setting is enabled
      const currentSettings = getSettings();
      let finalOptions: Partial<DownloadOptions> = { ...options };
      
      // Check if this is a YouTube Music URL
      const isYouTubeMusic = /music\.youtube\.com/i.test(url);
      logs.info('queue', `Add queue: isYouTubeMusic=${isYouTubeMusic}, setting=${currentSettings.youtubeMusicAudioOnly}, existingMode=${options?.downloadMode}`);
      
      if (isYouTubeMusic && currentSettings.youtubeMusicAudioOnly && !options?.downloadMode) {
        // Auto-set to audio-only for YouTube Music links
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
        title: prefetched?.title || url, // Use prefetched or fallback to URL
        author: prefetched?.author || '',
        thumbnail: prefetched?.thumbnail || '',
        duration: prefetched?.duration || 0,
        filesize: 0,
        // Determine expected extension based on download mode
        // Audio mode = m4a (on Android) or mp3 (desktop), video = mp4
        extension: finalOptions?.downloadMode === 'audio' ? 'm4a' : 'mp4',
        filePath: '',
        progress: 0,
        speed: '',
        eta: '',
        addedAt: Date.now(),
        type: finalOptions?.downloadMode === 'audio' ? 'audio' : 'video',
        priority: 0, // Default priority
        options: finalOptions, // Store options with item
        // Playlist grouping (if provided)
        playlistId: playlistInfo?.playlistId,
        playlistTitle: playlistInfo?.playlistTitle,
        playlistIndex: playlistInfo?.playlistIndex,
        usePlaylistFolder: playlistInfo?.usePlaylistFolder,
      };

      update(state => ({
        ...state,
        items: [...state.items, newItem]
      }));

      // Start processing
      processQueue();

      return id;
    },

    // Add multiple items from a playlist
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
      // Apply order to entries
      let orderedEntries = [...entries];
      switch (order) {
        case 'reverse':
          orderedEntries = orderedEntries.reverse();
          break;
        case 'shuffle':
          orderedEntries = orderedEntries.sort(() => Math.random() - 0.5);
          break;
        // 'queue' keeps original order
      }
      
      const addedIds: string[] = [];
      
      orderedEntries.forEach((entry, index) => {
        // Merge global options with per-entry overrides
        const entryOptions: Partial<DownloadOptions> = {
          ...globalOptions,
          downloadMode: entry.downloadMode ?? globalOptions?.downloadMode,
          videoQuality: entry.videoQuality ?? globalOptions?.videoQuality,
          prefetchedInfo: {
            title: entry.title,
            thumbnail: entry.thumbnail,
            author: entry.author,
            duration: entry.duration,
          }
        };
        
        const id = this.add(entry.url, entryOptions, {
          playlistId: playlistInfo.playlistId,
          playlistTitle: playlistInfo.playlistTitle,
          playlistIndex: index + 1,
          usePlaylistFolder: playlistInfo.usePlaylistFolder
        });
        
        if (id) {
          addedIds.push(id);
        }
      });
      
      logs.info('queue', `Added ${addedIds.length}/${entries.length} items from playlist "${playlistInfo.playlistTitle}"`);
      
      return addedIds;
    },

    // Cancel a download
    async cancel(id: string) {
      const state = get({ subscribe });
      const item = state.items.find(i => i.id === id);
      
      // Mark as cancelled before removing so error handler knows to ignore
      cancelledIds.add(id);
      
      if (item && (item.status === 'downloading' || item.status === 'processing')) {
        // Cancel the running process in the backend
        try {
          await invoke('cancel_download', { url: item.url });
          console.log('Download cancelled:', item.url);
        } catch (err) {
          console.warn('Failed to cancel download:', err);
        }
      }
      
      // Remove from queue and activeDownloadIds
      update(state => ({
        ...state,
        items: state.items.filter(item => item.id !== id),
        activeDownloadIds: state.activeDownloadIds.filter(activeId => activeId !== id),
        currentDownloadId: state.currentDownloadId === id ? null : state.currentDownloadId
      }));
      
      // Show cancelled toast
      toast.info('Download cancelled');
      
      // Process next item(s) - a slot opened up
      processQueue();
    },

    // Retry a failed download
    retry(id: string) {
      update(state => ({
        ...state,
        items: state.items.map(item =>
          item.id === id 
            ? { ...item, status: 'pending' as DownloadStatus, error: undefined, progress: 0 }
            : item
        )
      }));
      processQueue();
    },

    // Clear completed/failed items
    clearFinished() {
      update(state => ({
        ...state,
        items: state.items.filter(item => 
          item.status !== 'completed' && item.status !== 'failed'
        )
      }));
    },

    // Clear all items
    clearAll() {
      update(state => ({
        ...state,
        items: [],
        activeDownloadIds: [],
        currentDownloadId: null
      }));
    },

    // Pause the entire queue
    pause() {
      update(state => ({ ...state, isPaused: true }));
    },

    // Resume the queue
    resume() {
      update(state => ({ ...state, isPaused: false }));
      processQueue();
    },

    // Toggle pause state
    togglePause() {
      const state = get({ subscribe });
      if (state.isPaused) {
        update(s => ({ ...s, isPaused: false }));
        processQueue();
      } else {
        update(s => ({ ...s, isPaused: true }));
      }
    },

    // Pause a specific item (move to paused status)
    pauseItem(id: string) {
      update(state => ({
        ...state,
        items: state.items.map(item =>
          item.id === id && item.status === 'pending'
            ? { ...item, status: 'paused' as DownloadStatus }
            : item
        )
      }));
    },

    // Resume a specific paused item
    resumeItem(id: string) {
      update(state => ({
        ...state,
        items: state.items.map(item =>
          item.id === id && item.status === 'paused'
            ? { ...item, status: 'pending' as DownloadStatus }
            : item
        )
      }));
      processQueue();
    },

    // Move item up in priority
    moveUp(id: string) {
      update(state => ({
        ...state,
        items: state.items.map(item =>
          item.id === id ? { ...item, priority: item.priority + 1 } : item
        )
      }));
    },

    // Move item down in priority
    moveDown(id: string) {
      update(state => ({
        ...state,
        items: state.items.map(item =>
          item.id === id ? { ...item, priority: Math.max(0, item.priority - 1) } : item
        )
      }));
    },

    // Move item to top (highest priority)
    moveToTop(id: string) {
      const state = get({ subscribe });
      const maxPriority = Math.max(...state.items.map(i => i.priority), 0);
      update(s => ({
        ...s,
        items: s.items.map(item =>
          item.id === id ? { ...item, priority: maxPriority + 1 } : item
        )
      }));
    },

    // Cancel all items in a playlist
    cancelPlaylist(playlistId: string) {
      const state = get({ subscribe });
      const playlistItems = state.items.filter(i => i.playlistId === playlistId);
      
      // Cancel each item
      playlistItems.forEach(item => {
        cancelledIds.add(item.id);
        if (item.status === 'downloading' || item.status === 'processing') {
          invoke('cancel_download', { url: item.url }).catch(console.warn);
        }
      });
      
      // Remove all playlist items and from activeDownloadIds
      const playlistItemIds = new Set(playlistItems.map(i => i.id));
      update(state => ({
        ...state,
        items: state.items.filter(item => item.playlistId !== playlistId),
        activeDownloadIds: state.activeDownloadIds.filter(id => !playlistItemIds.has(id)),
        currentDownloadId: playlistItems.some(i => i.id === state.currentDownloadId) 
          ? null 
          : state.currentDownloadId
      }));
      
      toast.info('Playlist downloads cancelled');
      processQueue();
    },

    // Pause all pending items in a playlist
    pausePlaylist(playlistId: string) {
      update(state => ({
        ...state,
        items: state.items.map(item =>
          item.playlistId === playlistId && item.status === 'pending'
            ? { ...item, status: 'paused' as DownloadStatus }
            : item
        )
      }));
    },

    // Resume all paused items in a playlist
    resumePlaylist(playlistId: string) {
      update(state => ({
        ...state,
        items: state.items.map(item =>
          item.playlistId === playlistId && item.status === 'paused'
            ? { ...item, status: 'pending' as DownloadStatus }
            : item
        )
      }));
      processQueue();
    },

    // Get playlist progress info
    getPlaylistProgress(playlistId: string): { completed: number; total: number; failed: number } {
      const state = get({ subscribe });
      const items = state.items.filter(i => i.playlistId === playlistId);
      return {
        completed: items.filter(i => i.status === 'completed').length,
        failed: items.filter(i => i.status === 'failed').length,
        total: items.length
      };
    },
  };
}

export const queue = createQueueStore();

// Derived store for queue paused state
export const isQueuePaused = derived(queue, ($queue) => $queue.isPaused);

// Derived store for active (non-completed) downloads count
export const activeDownloadsCount = derived(queue, ($queue) => 
  $queue.items.filter(item => 
    item.status !== 'completed' && item.status !== 'failed'
  ).length
);

// Derived store for pending downloads count
export const pendingDownloadsCount = derived(queue, ($queue) => 
  $queue.items.filter(item => 
    item.status === 'pending' || item.status === 'paused'
  ).length
);

// Derived store for active downloads (for Downloads page)
export const activeDownloads = derived(queue, ($queue) =>
  $queue.items.filter(item => 
    item.status !== 'completed' && item.status !== 'failed'
  )
);

// Playlist group info for UI
export interface PlaylistGroup {
  playlistId: string;
  playlistTitle: string;
  items: QueueItem[];
  completed: number;
  failed: number;
  total: number;
  isExpanded: boolean;
}

// Derived store for grouped downloads (playlists grouped together, singles separate)
export const groupedDownloads = derived(queue, ($queue) => {
  const activeItems = $queue.items.filter(item => 
    item.status !== 'completed' && item.status !== 'failed'
  );
  
  // Group items by playlistId
  const playlistMap = new Map<string, QueueItem[]>();
  const singles: QueueItem[] = [];
  
  activeItems.forEach(item => {
    if (item.playlistId) {
      const existing = playlistMap.get(item.playlistId) || [];
      existing.push(item);
      playlistMap.set(item.playlistId, existing);
    } else {
      singles.push(item);
    }
  });
  
  // Convert to array of groups
  const groups: PlaylistGroup[] = [];
  
  playlistMap.forEach((items, playlistId) => {
    // Sort by playlistIndex within each group
    items.sort((a, b) => (a.playlistIndex || 0) - (b.playlistIndex || 0));
    
    groups.push({
      playlistId,
      playlistTitle: items[0]?.playlistTitle || 'Playlist',
      items,
      completed: items.filter(i => i.status === 'completed').length,
      failed: items.filter(i => i.status === 'failed').length,
      total: items.length,
      isExpanded: true, // Default expanded
    });
  });
  
  return { groups, singles };
});
