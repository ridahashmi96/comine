import { writable, get } from 'svelte/store';
import { settings } from './settings';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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
  progress: number;
  info: UpdateInfo | null;
  lastCheck: number;
  error: string | null;
}

const defaultState: UpdateState = {
  available: false,
  checking: false,
  downloading: false,
  progress: 0,
  info: null,
  lastCheck: 0,
  error: null,
};

export const updateState = writable<UpdateState>(defaultState);

let checkInterval: ReturnType<typeof setInterval> | null = null;

export function shouldAllowPreReleases(): boolean {
  const s = get(settings);
  if (s.allowPreReleases) return true;
  return GIT_BRANCH !== 'main' && GIT_BRANCH !== 'master' && GIT_BRANCH !== 'unknown';
}

export async function checkForUpdates(manual = false): Promise<UpdateInfo | null> {
  const s = get(settings);
  if (!manual && !s.autoUpdate) return null;

  updateState.update((state) => ({ ...state, checking: true, error: null }));

  try {
    if (isAndroid()) {
      return await checkForUpdatesAndroid();
    } else {
      return await checkForUpdatesDesktop();
    }
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

  if (l.pre && !r.pre) return true;
  if (!l.pre && r.pre) return false;

  return false;
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
  const updateFn = android?.downloadAndInstallUpdate;

  if (updateFn) {
    return new Promise((resolve, reject) => {
      const callbackName = `__update_callback_${Date.now()}`;
      const progressCallbackName = `${callbackName}_progress`;

      // Progress callback
      (window as unknown as Record<string, unknown>)[progressCallbackName] = (json: string) => {
        try {
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
        // Cleanup callbacks
        delete (window as unknown as Record<string, unknown>)[callbackName];
        delete (window as unknown as Record<string, unknown>)[progressCallbackName];

        try {
          const data = JSON.parse(json) as { type: string; success: boolean; error?: string };
          updateState.update((s) => ({ ...s, downloading: false }));

          if (data.success) {
            resolve();
          } else {
            reject(new Error(data.error || 'Update failed'));
          }
        } catch (e) {
          updateState.update((s) => ({ ...s, downloading: false }));
          reject(e);
        }
      };

      // Start the download with callback name
      updateFn(downloadUrl, callbackName);
    });
  } else {
    // Fallback: open URL in browser for manual download
    const opener = await import('@tauri-apps/plugin-opener');
    await opener.openUrl(downloadUrl);
    updateState.update((s) => ({ ...s, downloading: false }));
  }
}

interface AndroidUpdater {
  downloadAndInstallUpdate?: (url: string, callbackName: string) => void;
}

export function startUpdateChecker(): void {
  if (checkInterval) return;

  const check = () => {
    const s = get(settings);
    if (s.autoUpdate) {
      checkForUpdates();
    }
  };

  setTimeout(check, 5000);

  checkInterval = setInterval(check, 60 * 60 * 1000);
}

export function stopUpdateChecker(): void {
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
