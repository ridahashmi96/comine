import { writable, get } from 'svelte/store';
import { settings, updateSetting } from './settings';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  show as showNotification,
  dismiss as dismissNotification,
} from '$lib/components/NotificationPopup.svelte';
import { toast } from '$lib/components/Toast.svelte';
import { t } from '$lib/i18n';

declare const __GIT_BRANCH__: string;
declare const __APP_VERSION__: string;

const GIT_BRANCH = typeof __GIT_BRANCH__ !== 'undefined' ? __GIT_BRANCH__ : 'unknown';
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

function isAndroid(): boolean {
  return typeof window !== 'undefined' && 'AndroidYtDlp' in window;
}

export interface UpdateInfo {
  version: string;
  notes: string;
  pubDate: string;
  downloadUrl: string;
  isPreRelease: boolean;
}

export interface UpdateState {
  available: boolean;
  checking: boolean;
  downloading: boolean;
  installTriggered: boolean;
  progress: number;
  info: UpdateInfo | null;
  lastCheck: number;
  error: string | null;
}

const defaultState: UpdateState = {
  available: false,
  checking: false,
  downloading: false,
  installTriggered: false,
  progress: 0,
  info: null,
  lastCheck: 0,
  error: null,
};

export const updateState = writable<UpdateState>(defaultState);

let checkInterval: ReturnType<typeof setInterval> | null = null;
let activeUpdateNotificationId: string | null = null;

export function shouldAllowPreReleases(): boolean {
  const s = get(settings);
  if (s.allowPreReleases) return true;
  return GIT_BRANCH !== 'main' && GIT_BRANCH !== 'master' && GIT_BRANCH !== 'unknown';
}

export async function checkForUpdates(manual = false): Promise<UpdateInfo | null> {
  const s = get(settings);
  if (!manual && !s.autoUpdate) return null;

  updateState.update((state) => ({
    ...state,
    checking: true,
    error: null,
    installTriggered: false,
  }));

  try {
    let info: UpdateInfo | null;
    if (isAndroid()) {
      info = await checkForUpdatesAndroid();
    } else {
      info = await checkForUpdatesDesktop();
    }

    if (info && !manual) {
      showUpdateNotificationIfNeeded(info);
    }

    return info;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[Updates] Check failed:', error);
    updateState.update((state) => ({ ...state, checking: false, error }));
    return null;
  }
}

async function checkForUpdatesDesktop(): Promise<UpdateInfo | null> {
  const allowPre = shouldAllowPreReleases();

  const result = await invoke<{
    available: boolean;
    version: string | null;
    body: string | null;
    date: string | null;
  }>('check_for_update', { allowPrerelease: allowPre });

  updateState.update((state) => ({
    ...state,
    checking: false,
    lastCheck: Date.now(),
  }));

  if (!result.available || !result.version) {
    updateState.update((state) => ({ ...state, available: false, info: null }));
    return null;
  }

  const info: UpdateInfo = {
    version: result.version,
    notes: result.body || '',
    pubDate: result.date || '',
    downloadUrl: '',
    isPreRelease: result.version.includes('-'),
  };

  updateState.update((state) => ({ ...state, available: true, info }));
  return info;
}

async function checkForUpdatesAndroid(): Promise<UpdateInfo | null> {
  const allowPre = shouldAllowPreReleases();
  const url = allowPre
    ? 'https://api.github.com/repos/nichind/comine/releases'
    : 'https://api.github.com/repos/nichind/comine/releases/latest';

  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json();

  let release: {
    tag_name: string;
    body: string;
    published_at: string;
    prerelease: boolean;
    assets: { name: string; browser_download_url: string }[];
  };

  if (Array.isArray(data)) {
    const suitable = data.find((r: { prerelease: boolean }) => allowPre || !r.prerelease);
    if (!suitable) {
      updateState.update((state) => ({
        ...state,
        checking: false,
        available: false,
        info: null,
        lastCheck: Date.now(),
      }));
      return null;
    }
    release = suitable;
  } else {
    release = data;
  }

  const version = release.tag_name.replace(/^v/, '');

  if (!isNewerVersion(version, APP_VERSION)) {
    updateState.update((state) => ({
      ...state,
      checking: false,
      available: false,
      info: null,
      lastCheck: Date.now(),
    }));
    return null;
  }

  const apkAsset = release.assets.find(
    (a: { name: string }) => a.name.endsWith('.apk') && a.name.includes('arm64')
  );

  const info: UpdateInfo = {
    version,
    notes: release.body || '',
    pubDate: release.published_at,
    downloadUrl: apkAsset?.browser_download_url || '',
    isPreRelease: release.prerelease,
  };

  updateState.update((state) => ({
    ...state,
    checking: false,
    available: true,
    info,
    lastCheck: Date.now(),
  }));

  return info;
}

function isNewerVersion(remote: string, local: string): boolean {
  const parseVersion = (v: string) => {
    const [version, pre] = v.split('-');
    const parts = version.split('.').map(Number);
    return { parts, pre: pre || null };
  };

  const r = parseVersion(remote);
  const l = parseVersion(local);

  for (let i = 0; i < Math.max(r.parts.length, l.parts.length); i++) {
    const rv = r.parts[i] || 0;
    const lv = l.parts[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }

  // Same base version - compare pre-release status
  // 1.0.0 > 1.0.0-beta (stable is newer than pre-release of same version)
  if (l.pre && !r.pre) return true;
  // 1.0.0-beta.2 > 1.0.0-beta.1 (compare pre-release strings)
  if (l.pre && r.pre) return r.pre > l.pre;
  // 1.0.0-beta > 1.0.0 would be handled by allowPreReleases setting
  // at the API level, not here

  return false;
}

function showUpdateNotificationIfNeeded(info: UpdateInfo): void {
  const s = get(settings);

  if (s.dismissedUpdateVersion === info.version) {
    return;
  }

  if (activeUpdateNotificationId) {
    dismissNotification(activeUpdateNotificationId);
  }

  const translate = get(t);
  const bodyKey = info.isPreRelease
    ? 'updates.notificationBodyPreRelease'
    : 'updates.notificationBody';

  activeUpdateNotificationId = showNotification({
    title: translate('updates.notificationTitle'),
    body: translate(bodyKey, { version: info.version }),
    duration: 0,
    actionLabel: translate('updates.installNow'),
    onAction: () => {
      activeUpdateNotificationId = null;
      downloadAndInstall();
    },
  });
}

export async function dismissUpdateNotification(version: string): Promise<void> {
  if (activeUpdateNotificationId) {
    dismissNotification(activeUpdateNotificationId);
    activeUpdateNotificationId = null;
  }
  await updateSetting('dismissedUpdateVersion', version);
}

export async function downloadAndInstall(): Promise<void> {
  const state = get(updateState);
  if (!state.available || !state.info) return;

  updateState.update((s) => ({ ...s, downloading: true, progress: 0, error: null }));

  try {
    if (isAndroid()) {
      await downloadAndInstallAndroid(state.info);
    } else {
      await downloadAndInstallDesktop();
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[Updates] Install failed:', error);
    updateState.update((s) => ({ ...s, downloading: false, error }));
    toast.error(`Update failed: ${error}`);
  }
}

async function downloadAndInstallDesktop(): Promise<void> {
  const allowPre = shouldAllowPreReleases();

  let contentLength = 0;
  let downloaded = 0;
  let unlisten: UnlistenFn | null = null;

  try {
    unlisten = await listen<{ event: string; contentLength?: number; chunkLength?: number }>(
      'update-download-progress',
      (event) => {
        const data = event.payload;
        if (data.event === 'started' && data.contentLength) {
          contentLength = data.contentLength;
          downloaded = 0;
          updateState.update((s) => ({ ...s, progress: 0 }));
        } else if (data.event === 'progress' && data.chunkLength) {
          downloaded += data.chunkLength;
          const progress = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0;
          updateState.update((s) => ({ ...s, progress }));
        } else if (data.event === 'finished') {
          updateState.update((s) => ({ ...s, progress: 100 }));
        }
      }
    );

    await invoke('download_and_install_update', { allowPrerelease: allowPre });
  } finally {
    if (unlisten) {
      unlisten();
    }
  }
}

async function downloadAndInstallAndroid(info: UpdateInfo): Promise<void> {
  if (!info.downloadUrl) {
    throw new Error('No download URL available');
  }

  const downloadUrl = info.downloadUrl;
  const android = (window as unknown as { AndroidYtDlp: AndroidUpdater }).AndroidYtDlp;

  if (android?.downloadAndInstallUpdate) {
    return new Promise((resolve, reject) => {
      const callbackName = `__update_callback_${Date.now()}`;
      const progressCallbackName = `${callbackName}_progress`;

      console.log('[Updates] Starting Android update download:', downloadUrl);
      console.log('[Updates] Callback name:', callbackName);

      // Progress callback
      (window as unknown as Record<string, unknown>)[progressCallbackName] = (json: string) => {
        try {
          console.log('[Updates] Progress callback received:', json);
          const data = JSON.parse(json) as {
            type: string;
            downloaded: number;
            total: number;
            progress: number;
            stage: string;
          };
          updateState.update((s) => ({
            ...s,
            progress: data.progress,
          }));
        } catch (e) {
          console.error('[Updates] Failed to parse progress:', e);
        }
      };

      // Completion callback
      (window as unknown as Record<string, unknown>)[callbackName] = (json: string) => {
        console.log('[Updates] Completion callback received:', json);
        // Cleanup callbacks
        delete (window as unknown as Record<string, unknown>)[callbackName];
        delete (window as unknown as Record<string, unknown>)[progressCallbackName];

        try {
          const data = JSON.parse(json) as { type: string; success: boolean; error?: string };

          if (data.success) {
            updateState.update((s) => ({ ...s, downloading: false, installTriggered: true }));
            resolve();
          } else {
            updateState.update((s) => ({ ...s, downloading: false }));
            reject(new Error(data.error || 'Update failed'));
          }
        } catch (e) {
          updateState.update((s) => ({ ...s, downloading: false }));
          reject(e);
        }
      };

      try {
        android.downloadAndInstallUpdate!(downloadUrl, callbackName);
        console.log('[Updates] Called android.downloadAndInstallUpdate successfully');
      } catch (e) {
        console.error('[Updates] Failed to call downloadAndInstallUpdate:', e);
        delete (window as unknown as Record<string, unknown>)[callbackName];
        delete (window as unknown as Record<string, unknown>)[progressCallbackName];
        reject(e);
      }
    });
  } else {
    console.log('[Updates] Android update method not available, falling back to browser');
    // Fallback: open URL in browser for manual download
    const opener = await import('@tauri-apps/plugin-opener');
    await opener.openUrl(downloadUrl);
    updateState.update((s) => ({ ...s, downloading: false }));
  }
}

interface AndroidUpdater {
  downloadAndInstallUpdate?: (url: string, callbackName: string) => void;
}

let initialCheckTimeout: ReturnType<typeof setTimeout> | null = null;

export function startUpdateChecker(): void {
  if (checkInterval) return;

  const check = () => {
    const s = get(settings);
    if (s.autoUpdate) {
      checkForUpdates();
    }
  };

  initialCheckTimeout = setTimeout(check, 5000);
  checkInterval = setInterval(check, 60 * 60 * 1000);
}

export function stopUpdateChecker(): void {
  if (initialCheckTimeout) {
    clearTimeout(initialCheckTimeout);
    initialCheckTimeout = null;
  }
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

export function getCurrentVersion(): string {
  return APP_VERSION;
}

export function getCurrentBranch(): string {
  return GIT_BRANCH;
}

export async function clearDismissedVersionIfUpdated(): Promise<void> {
  const s = get(settings);
  if (s.dismissedUpdateVersion && s.dismissedUpdateVersion !== APP_VERSION) {
    await updateSetting('dismissedUpdateVersion', '');
  }
}
