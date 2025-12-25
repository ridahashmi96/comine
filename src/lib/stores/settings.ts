import { writable, get } from 'svelte/store';
import { load, type Store } from '@tauri-apps/plugin-store';

// Check if running on Android (safe for SSR)
function checkIsAndroid(): boolean {
  return typeof window !== 'undefined' && 'AndroidYtDlp' in window;
}

// Settings types
export type ProcessorId = 'auto' | 'cobalt' | 'yt-dlp' | 'lux';

export type VideoQuality = 'max' | '4k' | '1440p' | '1080p' | '720p' | '480p' | '360p' | '240p';
export type DownloadMode = 'auto' | 'audio' | 'mute';
export type AudioQuality = 'best' | '320' | '256' | '192' | '128' | '96';

export interface CustomPreset {
  id: string;
  label: string;
  videoQuality: VideoQuality;
  downloadMode: DownloadMode;
  audioQuality: AudioQuality;
  remux: boolean;
  convertToMp4: boolean;
  useHLS: boolean;
  clearMetadata: boolean;
  dontShowInHistory: boolean;
  useAria2: boolean;
  ignoreMixes: boolean;
  cookiesFromBrowser: string;
}

export type CloseBehavior = 'close' | 'minimize' | 'tray';
export type NotificationPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'top-center';
export type ToastPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'top-center';
export type NotificationMonitor = 'primary' | 'cursor';
export type BackgroundType = 'acrylic' | 'animated' | 'solid' | 'image';
export type ProxyMode = 'none' | 'system' | 'custom';

export interface AppSettings {
  // Onboarding
  onboardingCompleted: boolean;
  onboardingVersion: number; // Version of onboarding, bump to show again on major updates
  
  // General
  language: string;
  startOnBoot: boolean;
  watchClipboard: boolean;
  clipboardPatterns: string[]; // URL patterns to watch for
  statusPopup: boolean;
  
  // Notification settings
  notificationsEnabled: boolean;
  notificationPosition: NotificationPosition;
  notificationMonitor: NotificationMonitor;
  compactNotifications: boolean;
  notificationFancyBackground: boolean; // Use app background in notifications
  notificationOffset: number; // Offset from screen edge (taskbar height)
  notificationCornerDismiss: boolean; // Show corner X button instead of full dismiss button
  
  // Toast settings (in-app notifications)
  toastPosition: ToastPosition;
  
  // Window behavior
  closeBehavior: CloseBehavior;
  
  // Processing
  defaultProcessor: ProcessorId;
  
  // App
  autoUpdate: boolean;
  sendStats: boolean;
  acrylicBackground: boolean; // Legacy - kept for migration
  disableAnimations: boolean;
  
  // Background
  backgroundType: BackgroundType;
  backgroundColor: string; // Hex color for solid background
  backgroundImage: string; // URL or path for custom image
  backgroundVideo: string; // URL for animated background
  backgroundBlur: number; // Blur amount for video/image backgrounds (0-50)
  backgroundOpacity: number; // Opacity of background element (0-100, desktop only)
  
  // Accent color
  accentColor: string; // Hex color for accent (buttons, toggles, etc.)
  useSystemAccent: boolean; // Try to use system/OS accent color
  
  // Display
  sizeUnit: 'binary' | 'decimal'; // binary = KiB/MiB/GiB (1024), decimal = kB/MB/GB (1000)
  showHistoryStats: boolean; // Show statistics bar in downloads page
  
  // Downloads
  downloadPath: string; // Main download folder
  useAudioPath: boolean; // Use separate folder for audio
  audioPath: string; // Audio download folder (when useAudioPath is true)
  usePlaylistFolders: boolean; // Create subfolders for playlist downloads
  youtubeMusicAudioOnly: boolean; // Download audio only from YouTube Music links
  embedThumbnail: boolean; // Embed thumbnail in audio files
  concurrentDownloads: number; // Max number of parallel downloads (1-5)
  
  // Post-processing defaults
  convertToMp4: boolean; // Convert downloaded videos to mp4 (re-encode)
  remux: boolean; // Remux video to ensure compatibility
  
  // Main page download settings (persisted)
  defaultVideoQuality: VideoQuality;
  defaultDownloadMode: DownloadMode;
  defaultAudioQuality: AudioQuality;
  selectedPreset: string;
  useHLS: boolean;
  clearMetadata: boolean;
  dontShowInHistory: boolean;
  useAria2: boolean;
  ignoreMixes: boolean;
  cookiesFromBrowser: string;
  customCookies: string;
  sponsorBlock: boolean; // Enable SponsorBlock
  chapters: boolean; // Embed chapters
  embedSubtitles: boolean; // Embed subtitles
  writeThumbnails: boolean; // Write thumbnails to disk
  
  // Visual theming
  thumbnailTheming: boolean; // Use thumbnail colors for progress bars and hover effects
  
  // Proxy settings
  proxyMode: ProxyMode; // 'none' = no proxy, 'system' = auto-detect system proxy, 'custom' = use custom URL
  customProxyUrl: string; // Custom proxy URL (http://host:port, socks5://host:port, etc.)
  proxyFallback: boolean; // When custom proxy fails, fall back to system/no proxy
  
  // aria2 settings
  aria2Connections: number; // Connections per server (1-16)
  aria2Splits: number; // Number of splits (1-16)
  aria2MinSplitSize: string; // Minimum split size (e.g. '1M', '5M', '20M')
  
  // Speed limits (0 = unlimited)
  downloadSpeedLimit: number; // Global download speed limit in bytes/sec (0 = unlimited)
  
  // File download manager
  watchClipboardForFiles: boolean; // Detect direct file URLs in clipboard
  fileDownloadNotifications: boolean; // Show notifications for file URLs
  
  // Custom presets
  customPresets: CustomPreset[];
}

// Default settings
export const defaultSettings: AppSettings = {
  // Onboarding
  onboardingCompleted: false,
  onboardingVersion: 1, // Current onboarding version
  
  language: 'en',
  startOnBoot: false,
  watchClipboard: true,
  clipboardPatterns: [
    'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
    'twitter.com', 'x.com', 'instagram.com', 'tiktok.com',
    'reddit.com', 'twitch.tv', 'soundcloud.com', 'spotify.com'
  ],
  statusPopup: false,
  
  notificationsEnabled: true,
  notificationPosition: 'bottom-right',
  notificationMonitor: 'primary',
  compactNotifications: false,
  notificationFancyBackground: false,
  notificationOffset: 48, // Default taskbar height
  notificationCornerDismiss: false, // Default to full dismiss button
  
  // Toast position (in-app - default top-right on mobile, bottom-right on desktop)
  toastPosition: 'bottom-right',
  
  closeBehavior: 'tray',
  
  defaultProcessor: 'auto',
  
  autoUpdate: true,
  sendStats: false,
  acrylicBackground: true, // Legacy
  disableAnimations: false,
  
  // Background settings (desktop defaults - Android overrides in initSettings)
  backgroundType: 'acrylic',
  backgroundColor: '#1a1a2e',
  backgroundImage: '',
  backgroundVideo: 'https://nichind.dev/assets/video/atri.mp4',
  backgroundBlur: 20,
  backgroundOpacity: 100, // 100% opacity by default
  
  // Accent color
  accentColor: '#6366F1', // Default indigo
  useSystemAccent: false, // Default off, Android will override
  
  sizeUnit: 'binary',
  showHistoryStats: false,
  
  downloadPath: '',
  useAudioPath: false,
  audioPath: '',
  usePlaylistFolders: true, // Default to create folders for playlists
  youtubeMusicAudioOnly: true,
  embedThumbnail: true,
  concurrentDownloads: 2, // Default 2 parallel downloads
  convertToMp4: false, // Default off - remuxing (copy) is faster and usually sufficient
  remux: true, // Remux by default for compatibility
  
  // Main page download settings
  defaultVideoQuality: 'max',
  defaultDownloadMode: 'auto',
  defaultAudioQuality: 'best',
  selectedPreset: 'custom',
  useHLS: true,
  clearMetadata: false,
  dontShowInHistory: false,
  useAria2: false,
  ignoreMixes: true,
  cookiesFromBrowser: '',
  customCookies: '',
  sponsorBlock: false,
  chapters: true,
  embedSubtitles: false,
  writeThumbnails: false,
  
  // Visual theming
  thumbnailTheming: true, // Use colors from thumbnails
  
  // Proxy settings
  proxyMode: 'system', // Default to system proxy detection
  customProxyUrl: '',
  proxyFallback: true, // Default to fallback enabled
  
  // aria2 settings
  aria2Connections: 16, // Max connections per server
  aria2Splits: 16, // Split downloads into 16 parts
  aria2MinSplitSize: '1M', // Min 1MB per split
  
  // Speed limits
  downloadSpeedLimit: 0, // Unlimited by default
  
  // File download manager
  watchClipboardForFiles: true, // Detect file URLs
  fileDownloadNotifications: true, // Show notifications
  
  // Custom presets
  customPresets: []
};

// Store instance
let store: Store | null = null;

// Svelte store for reactive updates
export const settings = writable<AppSettings>(defaultSettings);

// Track if store is initialized
export const settingsReady = writable(false);

// Initialize the store
export async function initSettings(): Promise<void> {
  try {
    store = await load('settings.json', { autoSave: true, defaults: defaultSettings as unknown as Record<string, unknown> });
    
    // Load all settings in parallel for better performance
    const keys = Object.keys(defaultSettings) as (keyof AppSettings)[];
    const values = await Promise.all(keys.map(key => store!.get(key)));
    
    // Build loaded settings object with defaults and Android overrides
    const loaded: AppSettings = { ...defaultSettings };
    keys.forEach((key, index) => {
      const value = values[index];
      if (value !== null && value !== undefined) {
        // Safe assignment using type assertion
        (loaded as unknown as Record<string, unknown>)[key] = value;
      }
    });
    
    // Apply Android-specific default overrides
    if (checkIsAndroid()) {
      if (values[keys.indexOf('toastPosition')] === null || values[keys.indexOf('toastPosition')] === undefined) {
        loaded.toastPosition = 'top-right';
      }
      if (values[keys.indexOf('backgroundType')] === null || values[keys.indexOf('backgroundType')] === undefined) {
        loaded.backgroundType = 'animated';
      }
      if (values[keys.indexOf('backgroundBlur')] === null || values[keys.indexOf('backgroundBlur')] === undefined) {
        loaded.backgroundBlur = 14;
      }
      if (values[keys.indexOf('useSystemAccent')] === null || values[keys.indexOf('useSystemAccent')] === undefined) {
        loaded.useSystemAccent = true;
      }
    }
    
    settings.set(loaded);
    settingsReady.set(true);
  } catch (error) {
    console.error('[Settings] Failed to load settings:', error);
    settingsReady.set(true);
  }
}

// Update a single setting
export async function updateSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  if (!store) {
    console.warn('[Settings] Store not initialized');
    return;
  }
  
  try {
    await store.set(key, value);
    await store.save();
    
    settings.update(s => ({ ...s, [key]: value }));
  } catch (error) {
    console.error(`[Settings] Failed to update ${key}:`, error);
  }
}

// Update multiple settings at once (batched for performance)
export async function updateSettings(updates: Partial<AppSettings>): Promise<void> {
  if (!store) {
    console.warn('[Settings] Store not initialized');
    return;
  }
  
  try {
    // Set all values in parallel for better performance
    await Promise.all(
      Object.entries(updates).map(([key, value]) => store!.set(key, value))
    );
    await store.save();
    
    settings.update(s => ({ ...s, ...updates }));
  } catch (error) {
    console.error('[Settings] Failed to update settings:', error);
  }
}

// Reset to defaults
export async function resetSettings(): Promise<void> {
  if (!store) {
    console.warn('[Settings] Store not initialized');
    return;
  }
  
  try {
    await store.clear();
    // Set all defaults in parallel for better performance
    await Promise.all(
      Object.entries(defaultSettings).map(([key, value]) => store!.set(key, value))
    );
    await store.save();
    
    settings.set(defaultSettings);
  } catch (error) {
    console.error('[Settings] Failed to reset settings:', error);
  }
}

// Get current settings value (non-reactive)
export function getSettings(): AppSettings {
  return get(settings);
}

// Proxy config interface for backend commands
export interface ProxyConfig {
  mode: ProxyMode;
  customUrl: string;
  fallback: boolean;
}

// Get proxy config from settings for backend commands
export function getProxyConfig(): ProxyConfig {
  const s = getSettings();
  return {
    mode: s.proxyMode,
    customUrl: s.customProxyUrl,
    fallback: s.proxyFallback
  };
}
