/**
 * Android platform utilities
 * Handles the bridge to the native youtubedl-android library
 */

// Type definitions for the Android JavaScript interface
interface AndroidYtDlp {
  isReady(): boolean;
  getVersion(): string;
  getVideoInfo(url: string, callbackName: string): void; // Async with callback
  getPlaylistInfo(url: string, callbackName: string): void; // Playlist info with entries
  download(url: string, format: string | null, callbackName: string): void;
  openFile(filePath: string): boolean;
  openFolder(filePath: string): boolean;
  pickFile(mimeTypes: string, callbackName: string): void; // File picker
  processYtmThumbnail(thumbnailUrl: string, callbackName: string): void; // YTM thumbnail cropping
}

// Extend window to include the Android interface
declare global {
  interface Window {
    AndroidYtDlp?: AndroidYtDlp;
    __YTDLP_READY__?: boolean;
    __androidLog?: (level: string, source: string, message: string) => void;
  }
}

// Log handler type for dependency injection
type LogHandler = (level: 'trace' | 'debug' | 'info' | 'warn' | 'error', source: string, message: string) => void;
let logHandler: LogHandler | null = null;

/**
 * Set up the Android log handler to forward logs to the logs store
 */
export function setupAndroidLogHandler(handler: LogHandler): void {
  logHandler = handler;
  if (typeof window !== 'undefined') {
    window.__androidLog = (level: string, source: string, message: string) => {
      const validLevel = ['trace', 'debug', 'info', 'warn', 'error'].includes(level) 
        ? level as 'trace' | 'debug' | 'info' | 'warn' | 'error'
        : 'debug';
      handler(validLevel, source, message);
    };
  }
}

/**
 * Check if running on Android
 */
export function isAndroid(): boolean {
  return typeof window !== 'undefined' && 'AndroidYtDlp' in window;
}

/**
 * Check if running on desktop (not Android)
 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !('AndroidYtDlp' in window);
}

/**
 * Check if the Android yt-dlp is ready
 */
export function isAndroidYtDlpReady(): boolean {
  if (!isAndroid()) return false;
  try {
    return window.AndroidYtDlp?.isReady() ?? false;
  } catch {
    return false;
  }
}

/**
 * Get the Android yt-dlp version
 */
export function getAndroidYtDlpVersion(): string | null {
  if (!isAndroid()) return null;
  try {
    return window.AndroidYtDlp?.getVersion() ?? null;
  } catch {
    return null;
  }
}

/**
 * Progress callback type
 */
export interface DownloadProgress {
  progress: number;
  etaSeconds: number;
  line: string;
}

/**
 * Download result type
 */
export interface DownloadResult {
  success: boolean;
  output?: string;
  exitCode?: number;
  error?: string;
  filePath?: string;
  fileSize?: number;
}

// Counter for generating unique callback names
let callbackCounter = 0;

/**
 * Download a video using the Android bridge
 * @returns Promise that resolves when download completes
 */
export function downloadOnAndroid(
  url: string,
  format: string = 'best',
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    if (!isAndroid() || !window.AndroidYtDlp) {
      reject(new Error('Android yt-dlp bridge not available'));
      return;
    }

    if (!isAndroidYtDlpReady()) {
      reject(new Error('Android yt-dlp is initializing, please wait...'));
      return;
    }

    const callbackName = `ytdlp_cb_${++callbackCounter}`;
    let hasCompleted = false;
    
    // Set up timeout to prevent hanging
    const timeout = setTimeout(() => {
      if (!hasCompleted) {
        hasCompleted = true;
        cleanup();
        logHandler?.('error', 'Android', 'Download timeout - no response from Android bridge');
        reject(new Error('Download timeout - no response from Android bridge'));
      }
    }, 300000); // 5 minute timeout
    
    const cleanup = () => {
      clearTimeout(timeout);
      delete (window as unknown as Record<string, unknown>)[`${callbackName}_progress`];
      delete (window as unknown as Record<string, unknown>)[callbackName];
    };
    
    // Track max progress to prevent flickering when yt-dlp switches stages
    // (e.g., download video -> download audio -> merge)
    let maxProgress = 0;
    
    // Set up progress callback
    (window as unknown as Record<string, unknown>)[`${callbackName}_progress`] = (json: string) => {
      try {
        const data = JSON.parse(json);
        // youtubedl-android reports -1 for indeterminate progress
        let progressValue = typeof data.progress === 'number' ? data.progress : 0;
        
        // Never decrease progress - this prevents flickering when stages change
        // Each stage (video download, audio download, merge) starts at 0%
        if (progressValue >= 0 && progressValue > maxProgress) {
          maxProgress = progressValue;
        }
        // Use the max progress seen, unless we're at 100% (stage complete)
        // or progress is -1 (indeterminate)
        const effectiveProgress = progressValue < 0 ? progressValue : Math.max(progressValue, maxProgress);
        
        onProgress?.({
          progress: effectiveProgress,
          etaSeconds: data.eta || 0,
          line: data.line || '',
        });
      } catch (e) {
        logHandler?.('warn', 'Android', `Failed to parse progress: ${e}`);
      }
    };
    
    // Set up completion callback
    (window as unknown as Record<string, unknown>)[callbackName] = (json: string) => {
      if (hasCompleted) return;
      hasCompleted = true;
      
      logHandler?.('debug', 'Android', `Download callback received: ${json.substring(0, 200)}...`);
      cleanup();
      
      try {
        const data = JSON.parse(json);
        if (data.error) {
          logHandler?.('error', 'Android', `Download error: ${data.error}`);
          reject(new Error(data.error));
        } else {
          logHandler?.('info', 'Android', `Download completed: success=${data.success}, filePath=${data.filePath}, fileSize=${data.fileSize}`);
          resolve({
            success: data.success || false,
            output: data.output,
            exitCode: data.exitCode,
            filePath: data.filePath || undefined,
            fileSize: data.fileSize || undefined,
          });
        }
      } catch (e) {
        logHandler?.('error', 'Android', `Failed to parse download result: ${e}, raw: ${json.substring(0, 100)}`);
        reject(new Error(`Failed to parse result: ${e}`));
      }
    };

    try {
      logHandler?.('info', 'Android', `Starting download via bridge: ${url}`);
      window.AndroidYtDlp.download(url, format || null, callbackName);
    } catch (error) {
      hasCompleted = true;
      cleanup();
      logHandler?.('error', 'Android', `Failed to call download: ${error}`);
      reject(error);
    }
  });
}

/**
 * Get video info from Android bridge (async)
 */
export function getVideoInfoOnAndroid(url: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    if (!isAndroid() || !window.AndroidYtDlp) {
      resolve(null);
      return;
    }

    if (!isAndroidYtDlpReady()) {
      reject(new Error('Android yt-dlp is initializing, please wait...'));
      return;
    }

    const callbackName = `ytdlp_info_cb_${++callbackCounter}`;
    let hasCompleted = false;
    
    // Timeout for info fetch (60 seconds should be enough)
    const timeout = setTimeout(() => {
      if (!hasCompleted) {
        hasCompleted = true;
        delete (window as unknown as Record<string, unknown>)[callbackName];
        logHandler?.('warn', 'Android', 'Video info fetch timeout');
        reject(new Error('Video info fetch timeout'));
      }
    }, 60000);
    
    // Set up completion callback
    (window as unknown as Record<string, unknown>)[callbackName] = (json: string) => {
      if (hasCompleted) return;
      hasCompleted = true;
      clearTimeout(timeout);
      
      // Clean up callback
      delete (window as unknown as Record<string, unknown>)[callbackName];
      
      try {
        const data = JSON.parse(json);
        if (data.error) {
          logHandler?.('warn', 'Android', `Failed to get video info: ${data.error}`);
          reject(new Error(data.error));
        } else {
          logHandler?.('info', 'Android', `Got video info: ${data.title}`);
          resolve(data);
        }
      } catch (e) {
        logHandler?.('error', 'Android', `Failed to parse video info: ${e}, raw: ${json.substring(0, 100)}`);
        reject(new Error(`Failed to parse video info: ${e}`));
      }
    };

    try {
      logHandler?.('debug', 'Android', `Fetching video info for: ${url}`);
      window.AndroidYtDlp.getVideoInfo(url, callbackName);
    } catch (error) {
      hasCompleted = true;
      clearTimeout(timeout);
      delete (window as unknown as Record<string, unknown>)[callbackName];
      logHandler?.('error', 'Android', `Failed to call getVideoInfo: ${error}`);
      reject(error);
    }
  });
}

/**
 * Playlist entry type matching the Android/Rust PlaylistEntry struct
 */
export interface PlaylistEntry {
  id: string;
  url: string;
  title: string;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
  is_music: boolean;
}

/**
 * Playlist info result type matching the Android/Rust PlaylistInfo struct
 */
export interface PlaylistInfo {
  is_playlist: boolean;
  id: string | null;
  title: string;
  uploader: string | null;
  thumbnail: string | null;
  total_count: number;
  entries: PlaylistEntry[];
  has_more: boolean;
}

/**
 * Get playlist info from Android bridge (async)
 */
export function getPlaylistInfoOnAndroid(url: string): Promise<PlaylistInfo> {
  return new Promise((resolve, reject) => {
    if (!isAndroid() || !window.AndroidYtDlp) {
      reject(new Error('Android yt-dlp bridge not available'));
      return;
    }

    if (!isAndroidYtDlpReady()) {
      reject(new Error('Android yt-dlp is initializing, please wait...'));
      return;
    }

    const callbackName = `ytdlp_playlist_cb_${++callbackCounter}`;
    let hasCompleted = false;
    
    // Timeout for playlist info fetch (120 seconds for large playlists)
    const timeout = setTimeout(() => {
      if (!hasCompleted) {
        hasCompleted = true;
        delete (window as unknown as Record<string, unknown>)[callbackName];
        logHandler?.('warn', 'Android', 'Playlist info fetch timeout');
        reject(new Error('Playlist info fetch timeout'));
      }
    }, 120000);
    
    // Set up completion callback
    (window as unknown as Record<string, unknown>)[callbackName] = (json: string) => {
      if (hasCompleted) return;
      hasCompleted = true;
      clearTimeout(timeout);
      
      // Clean up callback
      delete (window as unknown as Record<string, unknown>)[callbackName];
      
      try {
        const data = JSON.parse(json);
        if (data.error) {
          logHandler?.('warn', 'Android', `Failed to get playlist info: ${data.error}`);
          reject(new Error(data.error));
        } else {
          logHandler?.('info', 'Android', `Got playlist info: ${data.title} with ${data.total_count} entries`);
          resolve(data as PlaylistInfo);
        }
      } catch (e) {
        logHandler?.('error', 'Android', `Failed to parse playlist info: ${e}, raw: ${json.substring(0, 100)}`);
        reject(new Error(`Failed to parse playlist info: ${e}`));
      }
    };

    try {
      logHandler?.('debug', 'Android', `Fetching playlist info for: ${url}`);
      window.AndroidYtDlp.getPlaylistInfo(url, callbackName);
    } catch (error) {
      hasCompleted = true;
      clearTimeout(timeout);
      delete (window as unknown as Record<string, unknown>)[callbackName];
      logHandler?.('error', 'Android', `Failed to call getPlaylistInfo: ${error}`);
      reject(error);
    }
  });
}

/**
 * Wait for Android yt-dlp to be ready
 */
export function waitForAndroidYtDlp(): Promise<void> {
  return new Promise((resolve) => {
    if (isAndroidYtDlpReady()) {
      resolve();
      return;
    }
    
    // Listen for the ready event from MainActivity
    const handler = () => {
      window.removeEventListener('ytdlp-ready', handler);
      resolve();
    };
    window.addEventListener('ytdlp-ready', handler);
    
    // Also poll in case the event was missed
    const interval = setInterval(() => {
      if (isAndroidYtDlpReady()) {
        clearInterval(interval);
        window.removeEventListener('ytdlp-ready', handler);
        resolve();
      }
    }, 500);
    
    // Timeout after 30 seconds
    setTimeout(() => {
      clearInterval(interval);
      window.removeEventListener('ytdlp-ready', handler);
      resolve(); // Resolve anyway, let the actual call fail
    }, 30000);
  });
}

/**
 * Share intent event detail type
 */
export interface ShareIntentEvent {
  url: string;
}

/**
 * Listen for share intent events from Android
 * @param callback Function to call when a URL is shared to the app
 * @returns Cleanup function to remove the listener
 */
export function onShareIntent(callback: (url: string) => void): () => void {
  if (!isAndroid()) {
    return () => {}; // No-op on desktop
  }
  
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<ShareIntentEvent>;
    const url = customEvent.detail?.url;
    if (url) {
      callback(url);
    }
  };
  
  window.addEventListener('share-intent', handler);
  return () => window.removeEventListener('share-intent', handler);
}

/**
 * Open a file on Android using the default app
 */
export function openFileOnAndroid(filePath: string): boolean {
  if (!isAndroid() || !window.AndroidYtDlp) {
    return false;
  }
  try {
    return window.AndroidYtDlp.openFile(filePath);
  } catch (e) {
    console.error('Failed to open file on Android:', e);
    return false;
  }
}

/**
 * Open the folder containing a file on Android
 */
export function openFolderOnAndroid(filePath: string): boolean {
  if (!isAndroid() || !window.AndroidYtDlp) {
    return false;
  }
  try {
    return window.AndroidYtDlp.openFolder(filePath);
  } catch (e) {
    console.error('Failed to open folder on Android:', e);
    return false;
  }
}

/**
 * Pick a file on Android using the system file picker
 * @param mimeTypes Comma-separated MIME types (e.g., "video/*" or "image/*")
 * @returns Promise that resolves with the content:// URI or null if cancelled
 */
export function pickFileOnAndroid(mimeTypes: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isAndroid() || !window.AndroidYtDlp) {
      resolve(null);
      return;
    }

    const callbackName = `file_pick_cb_${++callbackCounter}`;
    
    // Timeout for file picker (5 minutes - user interaction)
    const timeout = setTimeout(() => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      resolve(null);
    }, 300000);
    
    // Set up completion callback
    (window as unknown as Record<string, unknown>)[callbackName] = (uri: string | null) => {
      clearTimeout(timeout);
      delete (window as unknown as Record<string, unknown>)[callbackName];
      resolve(uri || null);
    };

    try {
      window.AndroidYtDlp.pickFile(mimeTypes, callbackName);
    } catch (error) {
      clearTimeout(timeout);
      delete (window as unknown as Record<string, unknown>)[callbackName];
      console.error('Failed to open file picker on Android:', error);
      resolve(null);
    }
  });
}

/**
 * Process a YouTube Music thumbnail on Android - detect letterboxing and crop to 1:1
 * @param thumbnailUrl URL of the thumbnail to process
 * @returns Promise that resolves with the processed thumbnail URL (base64 data URI if cropped, original URL if not)
 */
export function processYtmThumbnailOnAndroid(thumbnailUrl: string): Promise<string> {
  return new Promise((resolve) => {
    if (!isAndroid() || !window.AndroidYtDlp) {
      resolve(thumbnailUrl);
      return;
    }

    const callbackName = `thumb_process_cb_${++callbackCounter}`;
    
    // Timeout for thumbnail processing (30 seconds)
    const timeout = setTimeout(() => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      logHandler?.('warn', 'Android', 'Thumbnail processing timeout');
      resolve(thumbnailUrl); // Return original on timeout
    }, 30000);
    
    // Set up completion callback
    (window as unknown as Record<string, unknown>)[callbackName] = (json: string) => {
      clearTimeout(timeout);
      delete (window as unknown as Record<string, unknown>)[callbackName];
      
      try {
        const data = JSON.parse(json);
        const resultUrl = data.url || thumbnailUrl;
        if (resultUrl !== thumbnailUrl) {
          logHandler?.('info', 'Android', 'Thumbnail cropped successfully');
        }
        resolve(resultUrl);
      } catch (e) {
        logHandler?.('error', 'Android', `Failed to parse thumbnail result: ${e}`);
        resolve(thumbnailUrl);
      }
    };

    try {
      logHandler?.('debug', 'Android', `Processing YTM thumbnail: ${thumbnailUrl}`);
      window.AndroidYtDlp.processYtmThumbnail(thumbnailUrl, callbackName);
    } catch (error) {
      clearTimeout(timeout);
      delete (window as unknown as Record<string, unknown>)[callbackName];
      logHandler?.('error', 'Android', `Failed to call processYtmThumbnail: ${error}`);
      resolve(thumbnailUrl);
    }
  });
}
