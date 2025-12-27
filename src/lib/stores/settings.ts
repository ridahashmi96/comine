import { writable, get } from 'svelte/store';
import { load, type Store } from '@tauri-apps/plugin-store';

function checkIsAndroid(): boolean {
  return typeof window !== 'undefined' && 'AndroidYtDlp' in window;
}

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
export type NotificationPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'
  | 'bottom-center'
  | 'top-center';
export type ToastPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'
  | 'bottom-center'
  | 'top-center';
export type NotificationMonitor = 'primary' | 'cursor';
export type BackgroundType = 'acrylic' | 'animated' | 'solid' | 'image';
export type ProxyMode = 'none' | 'system' | 'custom';

export interface AppSettings {
  onboardingCompleted: boolean;
  onboardingVersion: number;

  language: string;
  startOnBoot: boolean;
  watchClipboard: boolean;
  clipboardPatterns: string[];
  statusPopup: boolean;

  notificationsEnabled: boolean;
  notificationPosition: NotificationPosition;
  notificationMonitor: NotificationMonitor;
  compactNotifications: boolean;
  notificationFancyBackground: boolean;
  notificationOffset: number;
  notificationCornerDismiss: boolean;

  toastPosition: ToastPosition;

  closeBehavior: CloseBehavior;

  defaultProcessor: ProcessorId;

  autoUpdate: boolean;
  allowPreReleases: boolean;
  sendStats: boolean;
  acrylicBackground: boolean;
  disableAnimations: boolean;

  backgroundType: BackgroundType;
  backgroundColor: string;
  backgroundImage: string;
  backgroundVideo: string;
  backgroundBlur: number;
  backgroundOpacity: number;

  accentColor: string;
  useSystemAccent: boolean;

  sizeUnit: 'binary' | 'decimal';
  showHistoryStats: boolean;

  downloadPath: string;
  useAudioPath: boolean;
  audioPath: string;
  usePlaylistFolders: boolean;
  youtubeMusicAudioOnly: boolean;
  embedThumbnail: boolean;
  concurrentDownloads: number;

  convertToMp4: boolean;
  remux: boolean;

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
  sponsorBlock: boolean;
  chapters: boolean;
  embedSubtitles: boolean;
  writeThumbnails: boolean;

  thumbnailTheming: boolean;

  proxyMode: ProxyMode;
  customProxyUrl: string;
  proxyFallback: boolean;

  dismissedUpdateVersion: string;

  aria2Connections: number;
  aria2Splits: number;
  aria2MinSplitSize: string;

  downloadSpeedLimit: number;

  watchClipboardForFiles: boolean;
  fileDownloadNotifications: boolean;

  customPresets: CustomPreset[];
}

export const defaultSettings: AppSettings = {
  onboardingCompleted: false,
  onboardingVersion: 1,

  language: 'en',
  startOnBoot: false,
  watchClipboard: true,
  clipboardPatterns: [
    'youtube.com',
    'youtu.be',
    'vimeo.com',
    'dailymotion.com',
    'twitter.com',
    'x.com',
    'instagram.com',
    'tiktok.com',
    'reddit.com',
    'twitch.tv',
    'soundcloud.com',
    'spotify.com',
  ],
  statusPopup: false,

  notificationsEnabled: true,
  notificationPosition: 'bottom-right',
  notificationMonitor: 'primary',
  compactNotifications: false,
  notificationFancyBackground: false,
  notificationOffset: 48,
  notificationCornerDismiss: false,

  toastPosition: 'bottom-right',

  closeBehavior: 'tray',

  defaultProcessor: 'auto',

  autoUpdate: true,
  allowPreReleases: false,
  sendStats: false,
  acrylicBackground: true,
  disableAnimations: false,

  backgroundType: 'acrylic',
  backgroundColor: '#1a1a2e',
  backgroundImage: '',
  backgroundVideo: 'https://nichind.dev/assets/video/atri.mp4',
  backgroundBlur: 20,
  backgroundOpacity: 100,

  accentColor: '#6366F1',
  useSystemAccent: false,

  sizeUnit: 'binary',
  showHistoryStats: false,

  downloadPath: '',
  useAudioPath: false,
  audioPath: '',
  usePlaylistFolders: true,
  youtubeMusicAudioOnly: true,
  embedThumbnail: true,
  concurrentDownloads: 2,
  convertToMp4: false,
  remux: true,

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

  thumbnailTheming: true,

  proxyMode: 'system',
  customProxyUrl: '',
  proxyFallback: true,

  dismissedUpdateVersion: '',

  aria2Connections: 16,
  aria2Splits: 16,
  aria2MinSplitSize: '1M',

  downloadSpeedLimit: 0,

  watchClipboardForFiles: true,
  fileDownloadNotifications: true,

  customPresets: [],
};

let store: Store | null = null;

export const settings = writable<AppSettings>(defaultSettings);

export const settingsReady = writable(false);

export async function initSettings(): Promise<void> {
  try {
    store = await load('settings.json', {
      autoSave: true,
      defaults: defaultSettings as unknown as Record<string, unknown>,
    });

    const keys = Object.keys(defaultSettings) as (keyof AppSettings)[];
    const values = await Promise.all(keys.map((key) => store!.get(key)));

    const loaded: AppSettings = { ...defaultSettings };
    keys.forEach((key, index) => {
      const value = values[index];
      if (value !== null && value !== undefined) {
        (loaded as unknown as Record<string, unknown>)[key] = value;
      }
    });

    if (checkIsAndroid()) {
      if (
        values[keys.indexOf('toastPosition')] === null ||
        values[keys.indexOf('toastPosition')] === undefined
      ) {
        loaded.toastPosition = 'top-right';
      }
      if (
        values[keys.indexOf('backgroundType')] === null ||
        values[keys.indexOf('backgroundType')] === undefined
      ) {
        loaded.backgroundType = 'animated';
      }
      if (
        values[keys.indexOf('backgroundBlur')] === null ||
        values[keys.indexOf('backgroundBlur')] === undefined
      ) {
        loaded.backgroundBlur = 14;
      }
      if (
        values[keys.indexOf('useSystemAccent')] === null ||
        values[keys.indexOf('useSystemAccent')] === undefined
      ) {
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

    settings.update((s) => ({ ...s, [key]: value }));
  } catch (error) {
    console.error(`[Settings] Failed to update ${key}:`, error);
  }
}

export async function updateSettings(updates: Partial<AppSettings>): Promise<void> {
  if (!store) {
    console.warn('[Settings] Store not initialized');
    return;
  }

  try {
    await Promise.all(Object.entries(updates).map(([key, value]) => store!.set(key, value)));
    await store.save();

    settings.update((s) => ({ ...s, ...updates }));
  } catch (error) {
    console.error('[Settings] Failed to update settings:', error);
  }
}

export async function resetSettings(): Promise<void> {
  if (!store) {
    console.warn('[Settings] Store not initialized');
    return;
  }

  try {
    await store.clear();
    await Promise.all(
      Object.entries(defaultSettings).map(([key, value]) => store!.set(key, value))
    );
    await store.save();

    settings.set(defaultSettings);
  } catch (error) {
    console.error('[Settings] Failed to reset settings:', error);
  }
}

export function getSettings(): AppSettings {
  return get(settings);
}

export interface ProxyConfig {
  mode: ProxyMode;
  customUrl: string;
  fallback: boolean;
}

export function getProxyConfig(): ProxyConfig {
  const s = getSettings();
  return {
    mode: s.proxyMode,
    customUrl: s.customProxyUrl,
    fallback: s.proxyFallback,
  };
}
