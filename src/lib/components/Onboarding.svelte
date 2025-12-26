<script lang="ts">
  import { fade, fly, scale } from 'svelte/transition';
  import { portal } from '$lib/actions/portal';
  import { t, locale, locales, type Locale } from '$lib/i18n';
  import {
    settings,
    updateSettings,
    updateSetting,
    defaultSettings,
    type BackgroundType,
    type CloseBehavior,
    getSettings,
  } from '$lib/stores/settings';
  import { deps, type DependencyName } from '$lib/stores/deps';
  import { isAndroid } from '$lib/utils/android';
  import { open } from '@tauri-apps/plugin-dialog';
  import { convertFileSrc, invoke } from '@tauri-apps/api/core';
  import { readFile, stat } from '@tauri-apps/plugin-fs';
  import Modal from './Modal.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import Icon from './Icon.svelte';
  import Button from './Button.svelte';
  import Input from './Input.svelte';
  import Checkbox from './Checkbox.svelte';
  import Toggle from './Toggle.svelte';

  interface Props {
    open?: boolean;
    onclose?: () => void;
  }

  let { open: isOpen = $bindable(false), onclose }: Props = $props();

  let currentStep = $state(0);

  let initialized = $state(false);

  let selectedLanguage = $state<Locale>($locale as Locale);
  let downloadPath = $state('');
  let useAudioPath = $state(false);
  let audioPath = $state('');
  let startOnBoot = $state(false);
  let watchClipboard = $state(true);
  let autoUpdate = $state(true);
  let closeBehavior = $state<CloseBehavior>('tray');
  let convertToMp4 = $state(false);

  let accentColor = $state('#6366F1');
  let backgroundBlur = $state(20);
  let backgroundType = $state<BackgroundType>(isAndroid() ? 'animated' : 'acrylic');
  let backgroundVideo = $state('');
  let backgroundImage = $state('');
  let backgroundColor = $state('#1a1a2e');

  $effect(() => {
    if (!initialized && $settings) {
      selectedLanguage = ($locale as Locale) || ($settings.language as Locale) || 'en';
      downloadPath = $settings.downloadPath || '';
      useAudioPath = $settings.useAudioPath;
      audioPath = $settings.audioPath || '';
      startOnBoot = $settings.startOnBoot;
      watchClipboard = $settings.watchClipboard;
      autoUpdate = $settings.autoUpdate;
      closeBehavior = $settings.closeBehavior || 'tray';
      convertToMp4 = $settings.convertToMp4 ?? false;
      accentColor = $settings.accentColor || '#6366F1';
      backgroundBlur = $settings.backgroundBlur ?? 20;
      const settingsBgType = $settings.backgroundType || 'acrylic';
      backgroundType = isAndroid() && settingsBgType === 'acrylic' ? 'animated' : settingsBgType;
      backgroundVideo = $settings.backgroundVideo || '';
      backgroundImage = $settings.backgroundImage || '';
      backgroundColor = $settings.backgroundColor || '#1a1a2e';
      notificationsEnabled = $settings.notificationsEnabled;
      notificationPosition = $settings.notificationPosition || 'bottom-right';
      compactNotifications = $settings.compactNotifications;
      initialized = true;
    }
  });

  let previewMode = $state(false);

  let previewToggle1 = $state(true);
  let previewToggle2 = $state(false);
  let previewCheckbox1 = $state(true);
  let previewCheckbox2 = $state(true);
  let previewCheckbox3 = $state(true);
  let previewCheckbox4 = $state(true);
  let previewOptionsExpanded = $state(true);

  let notificationsEnabled = $state(true);
  let notificationPosition = $state<NotificationPosition>('bottom-right');
  let compactNotifications = $state(false);

  let showLargeFileWarning = $state(false);
  let pendingVideoFile = $state<{ path: string; mimeType: string; size: number } | null>(null);
  const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024;

  async function showTestNotification() {
    if (isAndroid()) return;
    try {
      const currentSettings = getSettings();
      await invoke('show_notification_window', {
        data: {
          title: $t('notification.mediaDetected'),
          body: 'Test Channel • 3:45',
          thumbnail: null,
          url: 'https://example.com/test',
          compact: compactNotifications,
          download_label: $t('notification.downloadButton'),
          dismiss_label: $t('notification.dismissButton'),
        },
        position: notificationPosition,
        monitor: currentSettings.notificationMonitor,
        offset: currentSettings.notificationOffset,
      });
    } catch (err) {
      console.error('Failed to show test notification:', err);
    }
  }

  type NotificationPosition =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';
  const notificationPositions: { id: NotificationPosition; labelKey: string }[] = [
    { id: 'top-left', labelKey: 'settings.notifications.positionTopLeft' },
    { id: 'top-center', labelKey: 'settings.notifications.positionTopCenter' },
    { id: 'top-right', labelKey: 'settings.notifications.positionTopRight' },
    { id: 'bottom-left', labelKey: 'settings.notifications.positionBottomLeft' },
    { id: 'bottom-center', labelKey: 'settings.notifications.positionBottomCenter' },
    { id: 'bottom-right', labelKey: 'settings.notifications.positionBottomRight' },
  ];

  const accentColors = [
    '#6366F1',
    '#8B5CF6',
    '#EC4899', // Pink
    '#EF4444', // Red
    '#F97316', // Orange
    '#EAB308', // Yellow
    '#22C55E', // Green
    '#14B8A6', // Teal
    '#0EA5E9', // Sky
    '#3B82F6', // Blue
  ];

  const allBackgroundTypes: {
    id: BackgroundType;
    icon: string;
    labelKey: string;
    recommended?: boolean;
  }[] = [
    { id: 'acrylic', icon: 'blur', labelKey: 'onboarding.appearance.bgAcrylic', recommended: true },
    { id: 'animated', icon: 'video', labelKey: 'onboarding.appearance.bgAnimated' },
    { id: 'solid', icon: 'square', labelKey: 'onboarding.appearance.bgSolid' },
    { id: 'image', icon: 'image', labelKey: 'onboarding.appearance.bgImage' },
  ];

  let backgroundTypes = $derived(
    isAndroid() ? allBackgroundTypes.filter((t) => t.id !== 'acrylic') : allBackgroundTypes
  );

  const steps = [
    { id: 'welcome', icon: 'home' as const },
    { id: 'folders', icon: 'folder' as const },
    { id: 'preferences', icon: 'settings' as const },
    { id: 'appearance', icon: 'tuning' as const },
    { id: 'notifications', icon: 'bell' as const },
    { id: 'dependencies', icon: 'download' as const },
    { id: 'ready', icon: 'check' as const },
  ];

  const activeSteps = $derived(
    isAndroid() ? steps.filter((s) => s.id !== 'dependencies' && s.id !== 'notifications') : steps
  );

  let isInstalling = $derived($deps.installingDeps.size > 0);
  let installStarted = $state(false);
  let installComplete = $state(false);

  let ytdlpInstalling = $derived($deps.installingDeps.has('ytdlp'));
  let ffmpegInstalling = $derived($deps.installingDeps.has('ffmpeg'));
  let quickjsInstalling = $derived($deps.installingDeps.has('quickjs'));
  let aria2Installing = $derived($deps.installingDeps.has('aria2'));

  let ytdlpProgress = $derived($deps.installProgressMap.get('ytdlp'));
  let ffmpegProgress = $derived($deps.installProgressMap.get('ffmpeg'));
  let quickjsProgress = $derived($deps.installProgressMap.get('quickjs'));
  let aria2Progress = $derived($deps.installProgressMap.get('aria2'));

  function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  }

  function formatStage(stage: string): string {
    switch (stage) {
      case 'downloading':
        return $t('onboarding.dependencies.downloading');
      case 'extracting':
        return $t('onboarding.dependencies.extracting');
      case 'verifying':
        return $t('onboarding.dependencies.verifying');
      case 'complete':
        return $t('onboarding.dependencies.complete');
      default:
        return stage;
    }
  }

  let ytdlpInstalled = $derived($deps.ytdlp?.installed ?? false);
  let ffmpegInstalled = $derived($deps.ffmpeg?.installed ?? false);
  let quickjsInstalled = $derived($deps.quickjs?.installed ?? false);
  let aria2Installed = $derived($deps.aria2?.installed ?? false);

  let totalDepsCount = 4;
  let installedDepsCount = $derived(
    (ytdlpInstalled ? 1 : 0) +
      (ffmpegInstalled ? 1 : 0) +
      (quickjsInstalled ? 1 : 0) +
      (aria2Installed ? 1 : 0)
  );
  let overallProgress = $derived(Math.round((installedDepsCount / totalDepsCount) * 100));

  let allSelectedDepsInstalled = $derived(
    ytdlpInstalled && ffmpegInstalled && quickjsInstalled && aria2Installed
  );

  function nextStep() {
    if (currentStep < activeSteps.length - 1) {
      currentStep++;
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      currentStep--;
    }
  }

  function handleLanguageChange(lang: Locale) {
    selectedLanguage = lang;
    locale.set(lang);
  }

  async function selectDownloadPath() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select download folder',
      });
      if (selected) {
        downloadPath = selected as string;
      }
    } catch (e) {
      console.error('Failed to select folder:', e);
    }
  }

  async function selectAudioPath() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select audio folder',
      });
      if (selected) {
        audioPath = selected as string;
      }
    } catch (e) {
      console.error('Failed to select folder:', e);
    }
  }

  function handleAccentChange(color: string) {
    accentColor = color;
    updateSetting('accentColor', color);
  }

  function handleBlurChange(value: number) {
    backgroundBlur = value;
    updateSetting('backgroundBlur', value);
  }

  function handleBackgroundTypeChange(type: BackgroundType) {
    backgroundType = type;
    updateSetting('backgroundType', type);
  }

  function handleBackgroundVideoChange(url: string) {
    backgroundVideo = url;
    updateSetting('backgroundVideo', url);
  }

  function handleBackgroundImageChange(url: string) {
    backgroundImage = url;
    updateSetting('backgroundImage', url);
  }

  function handleBackgroundColorChange(color: string) {
    backgroundColor = color;
    updateSetting('backgroundColor', color);
  }

  function handleNotificationsEnabledChange(enabled: boolean) {
    notificationsEnabled = enabled;
    updateSetting('notificationsEnabled', enabled);
  }

  async function handleNotificationPositionChange(position: NotificationPosition) {
    try {
      await invoke('close_all_notifications');
    } catch (err) {
      console.error('Failed to close notifications:', err);
    }
    notificationPosition = position;
    updateSetting('notificationPosition', position);
  }

  function handleCompactNotificationsChange(compact: boolean) {
    compactNotifications = compact;
    updateSetting('compactNotifications', compact);
  }

  async function filePathToUrl(path: string, mimeType: string): Promise<string> {
    if (isAndroid()) {
      try {
        const data = await readFile(path);
        const base64 = btoa(String.fromCharCode(...data));
        return `data:${mimeType};base64,${base64}`;
      } catch (e) {
        console.error('Failed to read file for data URL:', e);
        return convertFileSrc(path);
      }
    }
    return convertFileSrc(path);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function processVideoFile(filePath: string, mimeType: string) {
    const assetUrl = await filePathToUrl(filePath, mimeType);
    backgroundVideo = assetUrl;
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
    try {
      const result = await open({
        multiple: false,
        filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi'] }],
      });
      if (result) {
        const filePath = result as string;

        const fileStat = await stat(filePath);
        const fileSize = fileStat.size;

        const ext = filePath.split('.').pop()?.toLowerCase() || 'mp4';
        const mimeTypes: Record<string, string> = {
          mp4: 'video/mp4',
          webm: 'video/webm',
          mkv: 'video/x-matroska',
          mov: 'video/quicktime',
          avi: 'video/x-msvideo',
        };
        const mimeType = mimeTypes[ext] || 'video/mp4';

        if (fileSize > LARGE_FILE_THRESHOLD) {
          pendingVideoFile = { path: filePath, mimeType, size: fileSize };
          showLargeFileWarning = true;
          return;
        }

        await processVideoFile(filePath, mimeType);
      }
    } catch (e) {
      console.error('Failed to select video:', e);
    }
  }

  async function pickBackgroundImage() {
    try {
      const result = await open({
        multiple: false,
        filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
      });
      if (result) {
        const ext = (result as string).split('.').pop()?.toLowerCase() || 'png';
        const mimeTypes: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          webp: 'image/webp',
          bmp: 'image/bmp',
        };
        const mimeType = mimeTypes[ext] || 'image/png';

        const assetUrl = await filePathToUrl(result as string, mimeType);
        backgroundImage = assetUrl;
        handleBackgroundImageChange(assetUrl);
      }
    } catch (e) {
      console.error('Failed to select image:', e);
    }
  }

  async function installDependencies() {
    if (isAndroid() || installStarted) return;

    installStarted = true;

    if (!aria2Installed) {
      await deps.installAria2();
    }

    const remainingDeps: Promise<boolean>[] = [];

    if (!ytdlpInstalled) {
      remainingDeps.push(deps.installYtdlp());
    }
    if (!ffmpegInstalled) {
      remainingDeps.push(deps.installFfmpeg());
    }
    if (!quickjsInstalled) {
      remainingDeps.push(deps.installQuickjs());
    }

    await Promise.all(remainingDeps);

    installComplete = true;
  }

  async function finishOnboarding() {
    await updateSettings({
      language: selectedLanguage,
      downloadPath,
      useAudioPath,
      audioPath,
      startOnBoot,
      watchClipboard,
      autoUpdate,
      closeBehavior,
      convertToMp4,
      accentColor,
      backgroundBlur,
      backgroundType,
      backgroundVideo,
      backgroundImage,
      backgroundColor,
      onboardingCompleted: true,
      onboardingVersion: defaultSettings.onboardingVersion,
    });

    isOpen = false;
    onclose?.();
  }

  $effect(() => {
    if (
      isOpen &&
      !isAndroid() &&
      !installStarted &&
      $deps.hasCheckedAll &&
      !allSelectedDepsInstalled
    ) {
      installDependencies();
    }
  });
</script>

{#if isOpen}
  <div use:portal>
    {#if previewMode}
      <!-- Preview Mode Overlay - click to exit -->
      <button
        class="preview-mode-overlay"
        onclick={() => (previewMode = false)}
        transition:fade={{ duration: 200 }}
      >
        <div class="preview-exit-hint">
          <Icon name="eye_line_duotone" size={20} />
          <span>{$t('onboarding.appearance.exitPreview')}</span>
        </div>
      </button>
    {:else}
      <div class="onboarding-backdrop" transition:fade={{ duration: 200 }}>
        <div class="onboarding-container" transition:scale={{ duration: 250, start: 0.95 }}>
          <!-- Progress dots -->
          <div class="progress-dots">
            {#each activeSteps as step, i}
              <button
                class="dot"
                class:active={i === currentStep}
                class:completed={i < currentStep}
                onclick={() => {
                  if (i < currentStep) currentStep = i;
                }}
                disabled={i > currentStep}
              >
                {#if i < currentStep}
                  <Icon name="check" size={12} />
                {/if}
              </button>
            {/each}
          </div>

          <!-- Content area - fixed height to prevent flickering -->
          <div class="content-wrapper">
            {#key currentStep}
              <div
                class="step-content"
                in:fly={{ x: 20, duration: 200, delay: 50 }}
                out:fade={{ duration: 100 }}
              >
                <!-- Step: Welcome + Language -->
                {#if activeSteps[currentStep]?.id === 'welcome'}
                  <div class="step welcome-step">
                    <div class="welcome-header">
                      <div class="logo-container">
                        <img src="/icon.png" alt="Comine" class="logo-icon" />
                        <!-- <span class="logo-text">ネ</span> -->
                      </div>
                      <h1>{$t('onboarding.welcome.title')}</h1>
                      <p class="subtitle">{$t('onboarding.welcome.subtitle')}</p>
                    </div>

                    <div class="language-section">
                      <span class="section-label">{$t('onboarding.language.title')}</span>
                      <div class="language-grid">
                        {#each locales as lang}
                          <button
                            class="language-option"
                            class:selected={selectedLanguage === lang.code}
                            onclick={() => handleLanguageChange(lang.code)}
                          >
                            <span class="lang-native">{lang.nativeName}</span>
                            <span class="lang-english">{lang.name}</span>
                            {#if selectedLanguage === lang.code}
                              <Icon name="check" size={18} />
                            {/if}
                          </button>
                        {/each}
                      </div>
                    </div>
                  </div>

                  <!-- Step: Folders -->
                {:else if activeSteps[currentStep]?.id === 'folders'}
                  <div class="step">
                    <div class="step-icon">
                      <Icon name="folder" size={32} />
                    </div>
                    <h2>{$t('onboarding.folders.title')}</h2>
                    <p class="description">{$t('onboarding.folders.description')}</p>

                    <div class="folder-settings">
                      <div class="folder-item">
                        <span class="folder-label">{$t('onboarding.folders.downloadPath')}</span>
                        <div class="folder-input">
                          <input
                            type="text"
                            bind:value={downloadPath}
                            placeholder={$t('onboarding.folders.defaultPath')}
                            readonly
                          />
                          <button class="browse-btn" onclick={selectDownloadPath}>
                            <Icon name="folder" size={18} />
                          </button>
                        </div>
                      </div>

                      <div class="folder-toggle">
                        <Checkbox
                          bind:checked={useAudioPath}
                          label={$t('onboarding.folders.useAudioPath')}
                        />
                      </div>

                      <div class="folder-toggle">
                        <Checkbox
                          bind:checked={convertToMp4}
                          label={$t('download.options.convertToMp4')}
                        />
                      </div>

                      {#if useAudioPath}
                        <div class="folder-item" transition:fade={{ duration: 150 }}>
                          <span class="folder-label">{$t('onboarding.folders.audioPath')}</span>
                          <div class="folder-input">
                            <input
                              type="text"
                              bind:value={audioPath}
                              placeholder={$t('onboarding.folders.selectFolder')}
                              readonly
                            />
                            <button class="browse-btn" onclick={selectAudioPath}>
                              <Icon name="folder" size={18} />
                            </button>
                          </div>
                        </div>
                      {/if}
                    </div>
                  </div>

                  <!-- Step: Preferences -->
                {:else if activeSteps[currentStep]?.id === 'preferences'}
                  <div class="step">
                    <div class="step-icon">
                      <Icon name="settings" size={32} />
                    </div>
                    <h2>{$t('onboarding.preferences.title')}</h2>
                    <p class="description">{$t('onboarding.preferences.description')}</p>

                    <div class="preferences-list">
                      {#if !isAndroid()}
                        <div class="preference-item">
                          <div class="preference-info">
                            <span class="preference-label"
                              >{$t('onboarding.preferences.startOnBoot')}</span
                            >
                            <span class="preference-desc"
                              >{$t('onboarding.preferences.startOnBootDesc')}</span
                            >
                          </div>
                          <Toggle bind:checked={startOnBoot} />
                        </div>
                      {/if}

                      <div class="preference-item">
                        <div class="preference-info">
                          <span class="preference-label"
                            >{$t('onboarding.preferences.watchClipboard')}</span
                          >
                          <span class="preference-desc"
                            >{$t('onboarding.preferences.watchClipboardDesc')}</span
                          >
                        </div>
                        <Toggle bind:checked={watchClipboard} />
                      </div>

                      <div class="preference-item">
                        <div class="preference-info">
                          <span class="preference-label"
                            >{$t('onboarding.preferences.autoUpdate')}</span
                          >
                          <span class="preference-desc"
                            >{$t('onboarding.preferences.autoUpdateDesc')}</span
                          >
                        </div>
                        <Toggle bind:checked={autoUpdate} />
                      </div>

                      {#if !isAndroid()}
                        <div class="preference-item close-behavior-item">
                          <div class="preference-info">
                            <span class="preference-label"
                              >{$t('settings.general.closeBehavior')}</span
                            >
                            <span class="preference-desc"
                              >{$t('settings.general.closeBehaviorDescription')}</span
                            >
                          </div>
                          <div class="close-behavior-options">
                            <button
                              type="button"
                              class="close-option"
                              class:selected={closeBehavior === 'tray'}
                              onclick={() => (closeBehavior = 'tray')}
                            >
                              <Icon name="bell" size={16} />
                              <span>{$t('settings.general.closeBehaviorTray')}</span>
                            </button>
                            <button
                              type="button"
                              class="close-option"
                              class:selected={closeBehavior === 'minimize'}
                              onclick={() => (closeBehavior = 'minimize')}
                            >
                              <Icon name="minimize" size={16} />
                              <span>{$t('settings.general.closeBehaviorMinimize')}</span>
                            </button>
                            <button
                              type="button"
                              class="close-option"
                              class:selected={closeBehavior === 'close'}
                              onclick={() => (closeBehavior = 'close')}
                            >
                              <Icon name="close" size={16} />
                              <span>{$t('settings.general.closeBehaviorClose')}</span>
                            </button>
                          </div>
                        </div>
                      {/if}
                    </div>
                  </div>

                  <!-- Step: Appearance -->
                {:else if activeSteps[currentStep]?.id === 'appearance'}
                  <div class="step appearance-step">
                    <div class="appearance-content">
                      <!-- Left: 3D Preview with real app layout -->
                      <div class="preview-container">
                        <div class="app-preview">
                          <div
                            class="preview-window"
                            class:bg-acrylic={backgroundType === 'acrylic'}
                            class:bg-solid={backgroundType === 'solid'}
                            style="--preview-accent: {accentColor}; --preview-blur: {backgroundBlur}px; --preview-solid-color: {backgroundColor};"
                          >
                            <!-- Background layer -->
                            {#if backgroundType === 'animated' && backgroundVideo}
                              <video
                                class="preview-bg-video"
                                src={backgroundVideo}
                                autoplay
                                loop
                                muted
                                playsinline
                              ></video>
                              <div class="preview-blur-overlay"></div>
                            {:else if backgroundType === 'image' && backgroundImage}
                              <div
                                class="preview-bg-image"
                                style="background-image: url({backgroundImage})"
                              ></div>
                              <div class="preview-blur-overlay"></div>
                            {:else if backgroundType === 'acrylic'}
                              <!-- Acrylic effect with topography background -->
                              <div class="preview-acrylic-bg">
                                <img
                                  src="https://nichind.dev/assets/img/topography.webp"
                                  alt=""
                                  class="preview-topography"
                                />
                              </div>
                              <div class="preview-acrylic-overlay"></div>
                            {:else if backgroundType === 'solid'}
                              <div class="preview-solid-bg"></div>
                            {/if}

                            <!-- Titlebar - matches real app -->
                            <div class="preview-titlebar">
                              <div class="preview-titlebar-spacer"></div>
                              <div class="preview-titlebar-text">comine</div>
                              <div class="preview-window-controls">
                                <div class="preview-titlebar-btn">
                                  <Icon name="minimize" size={8} />
                                </div>
                                <div class="preview-titlebar-btn">
                                  <Icon name="maximize" size={6} />
                                </div>
                                <div class="preview-titlebar-btn close">
                                  <Icon name="close" size={8} />
                                </div>
                              </div>
                            </div>

                            <!-- App content -->
                            <div class="preview-app">
                              <!-- Sidebar - matches real app layout -->
                              <div class="preview-sidebar">
                                <div class="preview-sidebar-nav">
                                  <div class="preview-nav-item active">
                                    <Icon name="download2" size={14} />
                                  </div>
                                  <div class="preview-nav-item">
                                    <Icon name="history" size={14} />
                                  </div>
                                  <div class="preview-nav-item">
                                    <Icon name="text" size={14} />
                                  </div>
                                  <div class="preview-nav-item">
                                    <Icon name="settings" size={14} />
                                  </div>
                                </div>
                                <div class="preview-sidebar-bottom">
                                  <div class="preview-nav-item external">
                                    <Icon name="discord" size={14} />
                                  </div>
                                  <div class="preview-nav-item external">
                                    <Icon name="github" size={14} />
                                  </div>
                                </div>
                              </div>

                              <!-- Main content area - matches real +page.svelte -->
                              <div class="preview-main">
                                <!-- Page header -->
                                <div class="preview-page-header">
                                  <div class="preview-title">Comine</div>
                                  <div class="preview-subtitle">{$t('download.subtitle')}</div>
                                </div>

                                <!-- URL Input wrapper - matches real .url-input-wrapper -->
                                <div class="preview-url-wrapper">
                                  <Icon name="link" size={10} />
                                  <span class="preview-url-placeholder"
                                    >{$t('download.placeholder')}</span
                                  >
                                  <div
                                    class="preview-download-btn"
                                    style="background: var(--preview-accent, #6366F1);"
                                  >
                                    <Icon name="download" size={10} />
                                  </div>
                                </div>

                                <!-- Options Section - matches real .options-section -->
                                <div class="preview-options-section">
                                  <!-- Options header -->
                                  <button
                                    class="preview-options-header"
                                    onclick={() =>
                                      (previewOptionsExpanded = !previewOptionsExpanded)}
                                  >
                                    <span class="preview-options-title">
                                      <Icon name="settings" size={10} />
                                      <span>{$t('download.options.title')}</span>
                                    </span>
                                    <Icon
                                      name={previewOptionsExpanded ? 'chevron_up' : 'chevron_down'}
                                      size={10}
                                    />
                                  </button>

                                  {#if previewOptionsExpanded}
                                    <div class="preview-options-content">
                                      <!-- Presets -->
                                      <div class="preview-options-group">
                                        <span class="preview-group-label"
                                          >{$t('download.options.presets')}</span
                                        >
                                        <div class="preview-presets-row">
                                          <div
                                            class="preview-chip selected"
                                            style="--chip-accent: var(--preview-accent, #6366F1);"
                                          >
                                            <Icon name="settings" size={8} />
                                            <span>{$t('download.options.custom')}</span>
                                          </div>
                                          <div class="preview-chip">
                                            <Icon name="video" size={8} />
                                            <span>{$t('download.options.bestVideo')}</span>
                                          </div>
                                          <div class="preview-chip">
                                            <Icon name="music" size={8} />
                                            <span>{$t('download.options.music')}</span>
                                          </div>
                                        </div>
                                      </div>

                                      <!-- Settings Row -->
                                      <div class="preview-settings-row">
                                        <button
                                          class="preview-setting-btn"
                                          onclick={() => (previewToggle1 = !previewToggle1)}
                                        >
                                          <span class="preview-setting-label"
                                            >{$t('download.options.videoQuality')}</span
                                          >
                                          <span
                                            class="preview-setting-value"
                                            style="color: var(--preview-accent, #6366F1);"
                                            >{$t('download.quality.max')}</span
                                          >
                                        </button>
                                        <button class="preview-setting-btn">
                                          <span class="preview-setting-label"
                                            >{$t('download.options.downloadMode')}</span
                                          >
                                          <span
                                            class="preview-setting-value"
                                            style="color: var(--preview-accent, #6366F1);"
                                            >{$t('download.mode.auto')}</span
                                          >
                                        </button>
                                        <button class="preview-setting-btn">
                                          <span class="preview-setting-label"
                                            >{$t('download.options.audioQuality')}</span
                                          >
                                          <span
                                            class="preview-setting-value"
                                            style="color: var(--preview-accent, #6366F1);"
                                            >{$t('download.audio.best')}</span
                                          >
                                        </button>
                                      </div>

                                      <!-- Checkboxes in two columns -->
                                      <div class="preview-checkbox-groups">
                                        <div class="preview-checkbox-group">
                                          <span class="preview-group-label"
                                            >{$t('download.options.postProcessing')}</span
                                          >
                                          <button
                                            class="preview-checkbox-row"
                                            onclick={() => (previewCheckbox1 = !previewCheckbox1)}
                                          >
                                            <div
                                              class="preview-checkbox"
                                              class:checked={previewCheckbox1}
                                              style="--checkbox-accent: var(--preview-accent, #6366F1);"
                                            >
                                              {#if previewCheckbox1}<Icon
                                                  name="check"
                                                  size={7}
                                                />{/if}
                                            </div>
                                            <span>{$t('download.options.convertToMp4')}</span>
                                          </button>
                                          <button
                                            class="preview-checkbox-row"
                                            onclick={() => (previewCheckbox2 = !previewCheckbox2)}
                                          >
                                            <div
                                              class="preview-checkbox"
                                              class:checked={previewCheckbox2}
                                              style="--checkbox-accent: var(--preview-accent, #6366F1);"
                                            >
                                              {#if previewCheckbox2}<Icon
                                                  name="check"
                                                  size={7}
                                                />{/if}
                                            </div>
                                            <span>{$t('download.options.remux')}</span>
                                          </button>
                                        </div>
                                        <div class="preview-checkbox-group">
                                          <span class="preview-group-label"
                                            >{$t('download.options.other')}</span
                                          >
                                          <button
                                            class="preview-checkbox-row"
                                            onclick={() => (previewCheckbox3 = !previewCheckbox3)}
                                          >
                                            <div
                                              class="preview-checkbox"
                                              class:checked={previewCheckbox3}
                                              style="--checkbox-accent: var(--preview-accent, #6366F1);"
                                            >
                                              {#if previewCheckbox3}<Icon
                                                  name="check"
                                                  size={7}
                                                />{/if}
                                            </div>
                                            <span>{$t('download.options.useHLS')}</span>
                                          </button>
                                          <button
                                            class="preview-checkbox-row"
                                            onclick={() => (previewCheckbox4 = !previewCheckbox4)}
                                          >
                                            <div
                                              class="preview-checkbox"
                                              class:checked={previewCheckbox4}
                                              style="--checkbox-accent: var(--preview-accent, #6366F1);"
                                            >
                                              {#if previewCheckbox4}<Icon
                                                  name="check"
                                                  size={7}
                                                />{/if}
                                            </div>
                                            <span>{$t('download.options.ignoreMixes')}</span>
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  {/if}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <!-- Preview Button moved here -->
                        <button class="preview-app-button" onclick={() => (previewMode = true)}>
                          <Icon name="eye_line_duotone" size={16} />
                          <span>{$t('onboarding.appearance.previewApp')}</span>
                        </button>
                      </div>

                      <!-- Right: Controls -->
                      <div class="appearance-controls">
                        <h2>{$t('onboarding.appearance.title')}</h2>
                        <p class="description">{$t('onboarding.appearance.description')}</p>

                        <!-- Background Type -->
                        <div class="appearance-group">
                          <span class="appearance-label"
                            >{$t('onboarding.appearance.backgroundType')}</span
                          >
                          <div class="bg-type-grid">
                            {#each backgroundTypes as bgType}
                              <button
                                class="bg-type-option"
                                class:selected={backgroundType === bgType.id}
                                class:recommended={bgType.recommended}
                                onclick={() => handleBackgroundTypeChange(bgType.id)}
                              >
                                {#if bgType.recommended}
                                  <div class="recommended-star">
                                    <Icon name="star" size={10} />
                                  </div>
                                {/if}
                                <Icon name={bgType.icon as any} size={18} />
                                <span>{$t(bgType.labelKey)}</span>
                              </button>
                            {/each}
                          </div>
                        </div>

                        <!-- Solid color picker -->
                        {#if backgroundType === 'solid'}
                          <div class="appearance-group">
                            <span class="appearance-label"
                              >{$t('settings.app.backgroundColor')}</span
                            >
                            <div class="color-input-row">
                              <input
                                type="color"
                                class="color-picker"
                                value={backgroundColor}
                                oninput={(e) => handleBackgroundColorChange(e.currentTarget.value)}
                              />
                              <input
                                type="text"
                                class="color-text-input"
                                value={backgroundColor}
                                oninput={(e) => handleBackgroundColorChange(e.currentTarget.value)}
                                placeholder="#1a1a2e"
                              />
                            </div>
                          </div>
                        {/if}

                        <!-- Video URL input with file picker -->
                        {#if backgroundType === 'animated'}
                          <div class="appearance-group">
                            <span class="appearance-label"
                              >{$t('settings.app.backgroundVideoUrl')}</span
                            >
                            <div class="input-with-actions">
                              {#if backgroundVideo}
                                <button
                                  class="action-btn undo"
                                  onclick={() => {
                                    backgroundVideo = '';
                                    handleBackgroundVideoChange('');
                                  }}
                                  use:tooltip={'Clear'}
                                >
                                  <Icon name="undo" size={14} />
                                </button>
                              {/if}
                              <Input
                                bind:value={backgroundVideo}
                                placeholder="https://... or select file"
                                oninput={(e) =>
                                  handleBackgroundVideoChange((e.target as HTMLInputElement).value)}
                              />
                              <button
                                class="action-btn picker"
                                onclick={pickBackgroundVideo}
                                use:tooltip={$t('settings.general.browse')}
                              >
                                <Icon name="folder" size={14} />
                              </button>
                            </div>
                          </div>
                        {/if}

                        <!-- Image URL input with file picker -->
                        {#if backgroundType === 'image'}
                          <div class="appearance-group">
                            <span class="appearance-label"
                              >{$t('settings.app.backgroundImageUrl')}</span
                            >
                            <div class="input-with-actions">
                              {#if backgroundImage}
                                <button
                                  class="action-btn undo"
                                  onclick={() => {
                                    backgroundImage = '';
                                    handleBackgroundImageChange('');
                                  }}
                                  use:tooltip={'Clear'}
                                >
                                  <Icon name="undo" size={14} />
                                </button>
                              {/if}
                              <Input
                                bind:value={backgroundImage}
                                placeholder="https://... or select file"
                                oninput={(e) =>
                                  handleBackgroundImageChange((e.target as HTMLInputElement).value)}
                              />
                              <button
                                class="action-btn picker"
                                onclick={pickBackgroundImage}
                                use:tooltip={$t('settings.general.browse')}
                              >
                                <Icon name="folder" size={14} />
                              </button>
                            </div>
                          </div>
                        {/if}

                        <!-- Accent Color -->
                        <div class="appearance-group">
                          <span class="appearance-label"
                            >{$t('onboarding.appearance.accentColor')}</span
                          >
                          <div class="color-grid">
                            {#each accentColors as color}
                              <button
                                class="color-swatch"
                                class:selected={accentColor.toUpperCase() === color.toUpperCase()}
                                style="background: {color}"
                                onclick={() => handleAccentChange(color)}
                                title={color}
                              ></button>
                            {/each}
                          </div>
                        </div>

                        <!-- Background Blur (only for video/image) -->
                        {#if backgroundType === 'animated' || backgroundType === 'image'}
                          <div class="appearance-group">
                            <div class="slider-header">
                              <span class="appearance-label"
                                >{$t('onboarding.appearance.backgroundBlur')}</span
                              >
                              <span class="slider-value">{backgroundBlur}px</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="50"
                              bind:value={backgroundBlur}
                              oninput={(e) =>
                                handleBlurChange(parseInt((e.target as HTMLInputElement).value))}
                              class="slider"
                            />
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>

                  <!-- Step: Notifications (Desktop only) -->
                {:else if activeSteps[currentStep]?.id === 'notifications'}
                  <div class="step notifications-step">
                    <div class="notifications-content">
                      <!-- Left: Desktop Preview -->
                      <div class="desktop-preview-container">
                        <div class="desktop-preview">
                          <!-- Desktop screen -->
                          <div class="desktop-screen">
                            <!-- Wallpaper -->
                            <div class="desktop-wallpaper"></div>

                            <!-- Window mockups -->
                            <div class="desktop-window main-window">
                              <div class="window-titlebar">
                                <div class="window-dots">
                                  <span></span><span></span><span></span>
                                </div>
                              </div>
                              <div class="window-content"></div>
                            </div>
                            <div class="desktop-window side-window">
                              <div class="window-titlebar">
                                <div class="window-dots">
                                  <span></span><span></span><span></span>
                                </div>
                              </div>
                              <div class="window-content"></div>
                            </div>

                            <!-- Notification position indicator (simple box) -->
                            <div
                              class="notification-indicator"
                              class:top-left={notificationPosition === 'top-left'}
                              class:top-center={notificationPosition === 'top-center'}
                              class:top-right={notificationPosition === 'top-right'}
                              class:bottom-left={notificationPosition === 'bottom-left'}
                              class:bottom-center={notificationPosition === 'bottom-center'}
                              class:bottom-right={notificationPosition === 'bottom-right'}
                            ></div>

                            <!-- Taskbar -->
                            <div class="desktop-taskbar">
                              <div class="taskbar-icons">
                                <span></span><span></span><span></span><span></span>
                              </div>
                            </div>
                          </div>

                          <!-- Desktop stand -->
                          <div class="desktop-stand">
                            <div class="stand-neck"></div>
                            <div class="stand-base"></div>
                          </div>
                        </div>

                        <!-- Actual notification preview below monitor -->
                        {#if compactNotifications}
                          <!-- Compact: single row with icon buttons -->
                          <div class="notification-actual-preview compact">
                            <div class="notif-thumb-compact">
                              <Icon name="download" size={14} />
                            </div>
                            <div class="notif-title-compact">
                              {$t('notification.mediaDetected')}
                            </div>
                            <div class="notif-icon-buttons">
                              <button class="notif-icon-btn primary">
                                <Icon name="download" size={14} />
                              </button>
                              <button class="notif-icon-btn ghost">
                                <Icon name="close" size={12} />
                              </button>
                            </div>
                          </div>
                        {:else}
                          <!-- Full: vertical layout with text -->
                          <div class="notification-actual-preview">
                            <div class="notif-close-x">✕</div>
                            <div class="notif-content">
                              <div class="notif-thumb">
                                <Icon name="download" size={16} />
                              </div>
                              <div class="notif-text-content">
                                <div class="notif-title">{$t('notification.mediaDetected')}</div>
                                <div class="notif-body">Channel name • 3:45</div>
                              </div>
                            </div>
                            <div class="notif-buttons">
                              <button class="notif-btn primary"
                                >{$t('notification.downloadButton')}</button
                              >
                              <button class="notif-btn ghost"
                                >{$t('notification.dismissButton')}</button
                              >
                            </div>
                          </div>
                        {/if}

                        <!-- Test notification button -->
                        <button
                          class="test-notification-btn"
                          onclick={showTestNotification}
                          disabled={!notificationsEnabled}
                        >
                          <Icon name="bell" size={14} />
                          <span>{$t('onboarding.notifications.testButton')}</span>
                        </button>
                      </div>

                      <!-- Right: Controls -->
                      <div class="notifications-controls">
                        <h2>{$t('onboarding.notifications.title')}</h2>
                        <p class="description">{$t('onboarding.notifications.description')}</p>

                        <!-- Warning if clipboard watching is disabled -->
                        {#if !watchClipboard}
                          <div class="notification-warning">
                            <Icon name="warning" size={14} />
                            <span>{$t('onboarding.notifications.clipboardWarning')}</span>
                          </div>
                        {/if}

                        <!-- Enable notifications -->
                        <div class="notification-group">
                          <button
                            class="toggle-row"
                            onclick={() => handleNotificationsEnabledChange(!notificationsEnabled)}
                          >
                            <div class="toggle-info">
                              <span class="toggle-label"
                                >{$t('settings.notifications.enabled')}</span
                              >
                            </div>
                            <div class="toggle-visual" class:checked={notificationsEnabled}>
                              <span class="toggle-slider"></span>
                            </div>
                          </button>
                        </div>

                        {#if notificationsEnabled}
                          <!-- Position selector -->
                          <div class="notification-group">
                            <span class="notification-label"
                              >{$t('settings.notifications.position')}</span
                            >
                            <div class="position-grid">
                              {#each notificationPositions as pos}
                                <button
                                  class="position-option"
                                  class:selected={notificationPosition === pos.id}
                                  onclick={() => handleNotificationPositionChange(pos.id)}
                                  title={$t(
                                    `settings.notifications.position${pos.id
                                      .split('-')
                                      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                                      .join('')}`
                                  )}
                                >
                                  <div
                                    class="position-icon"
                                    class:top-left={pos.id === 'top-left'}
                                    class:top-center={pos.id === 'top-center'}
                                    class:top-right={pos.id === 'top-right'}
                                    class:bottom-left={pos.id === 'bottom-left'}
                                    class:bottom-center={pos.id === 'bottom-center'}
                                    class:bottom-right={pos.id === 'bottom-right'}
                                  >
                                    <div class="position-dot"></div>
                                  </div>
                                </button>
                              {/each}
                            </div>
                          </div>

                          <!-- Compact mode -->
                          <div class="notification-group">
                            <button
                              class="toggle-row"
                              onclick={() =>
                                handleCompactNotificationsChange(!compactNotifications)}
                            >
                              <div class="toggle-info">
                                <span class="toggle-label"
                                  >{$t('settings.notifications.compact')}</span
                                >
                                <span class="toggle-description"
                                  >{$t('settings.notifications.compactTooltip')}</span
                                >
                              </div>
                              <div class="toggle-visual" class:checked={compactNotifications}>
                                <span class="toggle-slider"></span>
                              </div>
                            </button>
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>

                  <!-- Step: Dependencies (Desktop only) -->
                {:else if activeSteps[currentStep]?.id === 'dependencies'}
                  <div class="step">
                    <div
                      class="step-icon"
                      class:pulse={isInstalling}
                      class:complete={allSelectedDepsInstalled}
                    >
                      {#if allSelectedDepsInstalled}
                        <Icon name="check" size={32} />
                      {:else if isInstalling}
                        <div class="spinner"></div>
                      {:else}
                        <Icon name="download" size={32} />
                      {/if}
                    </div>
                    <h2>{$t('onboarding.dependencies.title')}</h2>
                    <p class="description">{$t('onboarding.dependencies.description')}</p>

                    <div class="deps-status">
                      <!-- Error display at top -->
                      {#if $deps.error}
                        <div class="deps-error">
                          <Icon name="warning" size={20} />
                          <span class="error-msg">{$deps.error}</span>
                          <button
                            class="retry-btn"
                            onclick={() => {
                              deps.clearError();
                              installStarted = false;
                              installDependencies();
                            }}
                          >
                            {$t('common.retry')}
                          </button>
                        </div>
                      {/if}

                      <!-- Overall progress bar -->
                      <div class="overall-progress">
                        <div class="progress-bar-container large">
                          <div
                            class="progress-bar"
                            class:error={$deps.error}
                            style="width: {allSelectedDepsInstalled && !$deps.error
                              ? 100
                              : overallProgress}%"
                          ></div>
                        </div>
                        <div class="progress-label">
                          {#if $deps.error}
                            <Icon name="warning" size={14} />
                            <span>{$t('onboarding.dependencies.failed')}</span>
                          {:else if allSelectedDepsInstalled}
                            <Icon name="check" size={14} />
                            <span>{$t('onboarding.dependencies.complete')}</span>
                          {:else if isInstalling}
                            <span
                              >{$t('onboarding.dependencies.installing')} ({installedDepsCount}/{totalDepsCount})</span
                            >
                          {:else}
                            <span>{installedDepsCount} / {totalDepsCount}</span>
                          {/if}
                        </div>
                      </div>

                      <!-- Deps list -->
                      <div class="deps-compact-list">
                        <div
                          class="dep-compact"
                          class:installed={ytdlpInstalled}
                          class:installing={ytdlpInstalling}
                        >
                          <div class="dep-status-icon">
                            {#if ytdlpInstalled}
                              <Icon name="check" size={14} />
                            {:else if ytdlpInstalling}
                              <div class="spinner tiny"></div>
                            {:else}
                              <span class="pending-dot"></span>
                            {/if}
                          </div>
                          <span class="dep-name">yt-dlp</span>
                          {#if ytdlpInstalling && ytdlpProgress}
                            <span class="dep-progress">
                              {formatStage(ytdlpProgress.stage)}
                              {ytdlpProgress.progress}%
                              {#if ytdlpProgress.speed > 0}
                                • {formatSpeed(ytdlpProgress.speed)}
                              {/if}
                            </span>
                          {/if}
                        </div>
                        <div
                          class="dep-compact"
                          class:installed={ffmpegInstalled}
                          class:installing={ffmpegInstalling}
                        >
                          <div class="dep-status-icon">
                            {#if ffmpegInstalled}
                              <Icon name="check" size={14} />
                            {:else if ffmpegInstalling}
                              <div class="spinner tiny"></div>
                            {:else}
                              <span class="pending-dot"></span>
                            {/if}
                          </div>
                          <span class="dep-name">ffmpeg</span>
                          {#if ffmpegInstalling && ffmpegProgress}
                            <span class="dep-progress">
                              {formatStage(ffmpegProgress.stage)}
                              {ffmpegProgress.progress}%
                              {#if ffmpegProgress.speed > 0}
                                • {formatSpeed(ffmpegProgress.speed)}
                              {/if}
                            </span>
                          {/if}
                        </div>
                        <div
                          class="dep-compact"
                          class:installed={quickjsInstalled}
                          class:installing={quickjsInstalling}
                        >
                          <div class="dep-status-icon">
                            {#if quickjsInstalled}
                              <Icon name="check" size={14} />
                            {:else if quickjsInstalling}
                              <div class="spinner tiny"></div>
                            {:else}
                              <span class="pending-dot"></span>
                            {/if}
                          </div>
                          <span class="dep-name">quickjs</span>
                          {#if quickjsInstalling && quickjsProgress}
                            <span class="dep-progress">
                              {formatStage(quickjsProgress.stage)}
                              {quickjsProgress.progress}%
                              {#if quickjsProgress.speed > 0}
                                • {formatSpeed(quickjsProgress.speed)}
                              {/if}
                            </span>
                          {/if}
                        </div>
                        <div
                          class="dep-compact"
                          class:installed={aria2Installed}
                          class:installing={aria2Installing}
                        >
                          <div class="dep-status-icon">
                            {#if aria2Installed}
                              <Icon name="check" size={14} />
                            {:else if aria2Installing}
                              <div class="spinner tiny"></div>
                            {:else}
                              <span class="pending-dot"></span>
                            {/if}
                          </div>
                          <span class="dep-name">aria2</span>
                          {#if aria2Installing && aria2Progress}
                            <span class="dep-progress">
                              {formatStage(aria2Progress.stage)}
                              {aria2Progress.progress}%
                              {#if aria2Progress.speed > 0}
                                • {formatSpeed(aria2Progress.speed)}
                              {/if}
                            </span>
                          {/if}
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Step: Ready -->
                {:else if activeSteps[currentStep]?.id === 'ready'}
                  <div class="step ready-step">
                    <div class="ready-icon">
                      <Icon name="check" size={48} />
                    </div>
                    <h2>{$t('onboarding.ready.title')}</h2>
                    <p class="description">{$t('onboarding.ready.description')}</p>

                    <div class="ready-summary">
                      <div class="summary-item">
                        <Icon name="globe" size={18} />
                        <span>{locales.find((l) => l.code === selectedLanguage)?.nativeName}</span>
                      </div>
                      {#if downloadPath}
                        <div class="summary-item">
                          <Icon name="folder" size={18} />
                          <span class="path">{downloadPath}</span>
                        </div>
                      {/if}
                      <div class="summary-item">
                        <div class="color-preview" style="background: {accentColor}"></div>
                        <span>{$t('onboarding.appearance.accentColor')}</span>
                      </div>
                      {#if !isAndroid() && allSelectedDepsInstalled}
                        <div class="summary-item">
                          <Icon name="check" size={18} />
                          <span>{$t('onboarding.ready.depsInstalled')}</span>
                        </div>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/key}
          </div>

          <!-- Navigation buttons -->
          <div class="nav-buttons">
            {#if currentStep > 0}
              <Button variant="ghost" onclick={prevStep}>
                {$t('onboarding.back')}
              </Button>
            {:else}
              <div></div>
            {/if}

            {#if currentStep < activeSteps.length - 1}
              <Button
                variant="primary"
                onclick={nextStep}
                disabled={activeSteps[currentStep]?.id === 'dependencies' &&
                  isInstalling &&
                  !allSelectedDepsInstalled}
              >
                {#if activeSteps[currentStep]?.id === 'dependencies' && isInstalling}
                  {$t('onboarding.dependencies.installing')}
                {:else}
                  {$t('onboarding.next')}
                {/if}
                <Icon name="arrow_right" size={18} />
              </Button>
            {:else}
              <Button variant="primary" onclick={finishOnboarding}>
                {$t('onboarding.finish')}
                <Icon name="check" size={18} />
              </Button>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Large File Warning Modal -->
  <Modal bind:open={showLargeFileWarning} title={$t('onboarding.appearance.largeFileWarningTitle')}>
    <div class="large-file-warning">
      <div class="warning-icon-large">
        <Icon name="warning" size={32} />
      </div>
      <p class="warning-text">{$t('onboarding.appearance.largeFileWarningMessage')}</p>
      {#if pendingVideoFile}
        <div class="file-size-info">
          <span class="size-label">{$t('onboarding.appearance.fileSize')}:</span>
          <span class="size-value">{formatFileSize(pendingVideoFile.size)}</span>
        </div>
      {/if}
      {#if isAndroid()}
        <p class="warning-hint">{$t('onboarding.appearance.largeFileWarningAndroid')}</p>
      {:else}
        <p class="warning-hint">{$t('onboarding.appearance.largeFileWarningDesktop')}</p>
      {/if}
    </div>
    {#snippet actions()}
      <div class="warning-actions">
        <Button variant="ghost" onclick={cancelLargeFile}>
          {$t('common.cancel')}
        </Button>
        <Button variant="primary" onclick={confirmLargeFile}>
          {$t('onboarding.appearance.useAnyway')}
        </Button>
      </div>
    {/snippet}
  </Modal>
{/if}

<style>
  .preview-mode-overlay {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 10000;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 32px;
    cursor: pointer;
    border: none;
  }

  .preview-exit-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: rgba(20, 20, 25, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    backdrop-filter: blur(20px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    transition: all 0.2s;
  }

  .preview-mode-overlay:hover .preview-exit-hint {
    background: rgba(30, 30, 35, 0.95);
    border-color: rgba(255, 255, 255, 0.25);
    transform: translateY(-2px);
  }

  .onboarding-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 24px;
  }

  .onboarding-container {
    width: 100%;
    max-width: 580px;
    background: rgba(20, 20, 25, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  }

  /* Progress dots */
  .progress-dots {
    display: flex;
    justify-content: center;
    gap: 12px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .dot:disabled {
    cursor: default;
  }

  .dot.active {
    width: 24px;
    border-radius: 12px;
    background: var(--accent, #6366f1);
  }

  .dot.completed {
    background: var(--accent, #6366f1);
  }

  .dot.completed :global(svg) {
    color: white;
  }

  /* Content area - fixed height to prevent flickering */
  .content-wrapper {
    height: 400px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .step-content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
    padding: 4px;
  }

  .step-icon {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-alpha, rgba(99, 102, 241, 0.15));
    border-radius: 16px;
    color: var(--accent, #6366f1);
    transition: all 0.3s;
  }

  .step-icon.pulse {
    animation: pulse 2s ease-in-out infinite;
  }

  .step-icon.complete {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

  @keyframes pulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.05);
      opacity: 0.8;
    }
  }

  /* Welcome step with language */
  .welcome-step {
    gap: 16px !important;
  }

  .welcome-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .welcome-step .logo-container {
    margin-bottom: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .logo-icon {
    width: 80px;
    height: 80px;
    border-radius: 20px;
    object-fit: contain;
  }

  .logo-text {
    font-size: 42px;
    font-weight: 700;
    background: linear-gradient(135deg, #fff 0%, rgba(255, 255, 255, 0.7) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -2px;
  }

  .language-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .section-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.4);
  }

  h1 {
    font-size: 22px;
    font-weight: 600;
    color: white;
    margin: 0;
  }

  h2 {
    font-size: 20px;
    font-weight: 600;
    color: white;
    margin: 0;
  }

  .subtitle {
    font-size: 15px;
    color: rgba(255, 255, 255, 0.6);
    margin: 0;
  }

  .description {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.5;
    margin: 0;
    max-width: 400px;
  }

  /* Language grid */
  .language-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-width: 300px;
  }

  .language-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
  }

  .language-option:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .language-option.selected {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.15));
    border-color: var(--accent, #6366f1);
  }

  .language-option .lang-native {
    font-size: 14px;
    font-weight: 500;
    color: white;
    flex: 1;
  }

  .language-option .lang-english {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
  }

  .language-option :global(svg) {
    color: var(--accent, #6366f1);
  }

  /* Folder settings */
  .folder-settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    text-align: left;
    margin-top: 8px;
  }

  .folder-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .folder-label {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.7);
  }

  .folder-input {
    display: flex;
    gap: 8px;
  }

  .folder-input input {
    flex: 1;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    color: white;
    font-size: 13px;
    outline: none;
  }

  .folder-input input::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  .browse-btn {
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s;
  }

  .browse-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .folder-toggle {
    padding: 8px 0;
  }

  /* Preferences */
  .preferences-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    margin-top: 8px;
  }

  .preference-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    gap: 16px;
  }

  .preference-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    flex: 1;
  }

  .preference-label {
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
  }

  .preference-desc {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Close behavior options */
  .close-behavior-item {
    flex-direction: column;
    align-items: stretch !important;
    gap: 12px;
  }

  .close-behavior-options {
    display: flex;
    gap: 8px;
  }

  .close-option {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .close-option:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.8);
  }

  .close-option.selected {
    background: rgba(var(--accent-rgb, 99, 102, 241), 0.15);
    border-color: var(--accent, #6366f1);
    color: var(--accent, #6366f1);
  }

  .close-option :global(svg) {
    opacity: 0.7;
  }

  .close-option.selected :global(svg) {
    opacity: 1;
  }

  /* Appearance step with 3D preview */
  .appearance-step {
    padding: 0 !important;
  }

  .appearance-content {
    display: flex;
    gap: 20px;
    width: 100%;
    align-items: flex-start;
  }

  .preview-container {
    flex-shrink: 0;
    perspective: 1200px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }

  .app-preview {
    transform: rotateY(18deg) rotateX(3deg);
    transform-style: preserve-3d;
    transition: transform 0.4s ease;
  }

  .app-preview:hover {
    transform: rotateY(10deg) rotateX(2deg) scale(1.02);
  }

  .preview-window {
    width: 200px;
    height: 120px;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05);
    position: relative;
    background: rgba(19, 19, 19, 0.95);
    display: flex;
    flex-direction: column;
  }

  .preview-window.bg-acrylic {
    background: transparent;
  }

  .preview-window.bg-solid {
    background: var(--preview-solid-color, #1a1a2e);
  }

  .preview-acrylic-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    z-index: 0;
  }

  .preview-topography {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.15;
  }

  .preview-acrylic-overlay {
    position: absolute;
    inset: 0;
    background: rgba(19, 19, 19, 0.7);
    backdrop-filter: blur(40px) saturate(1.2);
    z-index: 1;
  }

  .preview-solid-bg {
    position: absolute;
    inset: 0;
    background: var(--preview-solid-color, #1a1a2e);
    z-index: 0;
  }

  .preview-bg-video,
  .preview-bg-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: 0;
  }

  .preview-bg-image {
    background-size: cover;
    background-position: center;
  }

  .preview-blur-overlay {
    position: absolute;
    inset: 0;
    backdrop-filter: blur(var(--preview-blur, 20px));
    background: rgba(0, 0, 0, 0.3);
    z-index: 1;
  }

  /* Titlebar - matches real app */
  .preview-titlebar {
    position: relative;
    z-index: 3;
    height: 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0;
    flex-shrink: 0;
  }

  .preview-titlebar-spacer {
    width: 42px; /* Balance with window controls */
  }

  .preview-titlebar-text {
    font-family: 'Funnel Display', 'Jost', sans-serif;
    font-size: 7px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    letter-spacing: 0.3px;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }

  .preview-window-controls {
    display: flex;
    padding-right: 1px;
    gap: 0;
  }

  .preview-titlebar-btn {
    width: 18px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.7);
    border-radius: 3px;
    transition: all 0.15s;
  }

  .preview-titlebar-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
  }

  .preview-titlebar-btn.close:hover {
    background: #ef4444;
    color: white;
  }

  .preview-app {
    position: relative;
    z-index: 2;
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .preview-sidebar {
    width: 20px;
    background: transparent;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .preview-sidebar-nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 0 0 4px;
    gap: 2px;
  }

  .preview-sidebar-bottom {
    padding: 4px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .preview-nav-item {
    width: 20px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.5);
    border-radius: 0 4px 4px 0;
    border-left: 2px solid transparent;
    transition: all 0.15s;
  }

  .preview-nav-item :global(svg) {
    height: 8px;
  }

  .preview-nav-item:hover {
    color: rgba(255, 255, 255, 0.8);
  }

  .preview-nav-item.active {
    color: white;
    background: rgba(255, 255, 255, 0.15);
    border-left-color: rgba(255, 255, 255, 0.15);
  }

  .preview-nav-item.external {
    color: rgba(255, 255, 255, 0.4);
  }

  .preview-main {
    flex: 1;
    padding: 0 4px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
  }

  /* Page header - matches real .page-header */
  .preview-page-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .preview-title {
    text-align: start;
    font-size: 13px;
    font-weight: 700;
    font-family: 'Funnel Display', 'Jost', sans-serif;
    color: white;
  }

  .preview-subtitle {
    text-align: start;
    font-size: 7px;
    color: rgba(255, 255, 255, 0.6);
  }

  /* URL Input wrapper - matches real .url-input-wrapper */
  .preview-url-wrapper {
    height: 16px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 2px 2px 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
  }

  .preview-url-wrapper > :global(svg) {
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .preview-url-placeholder {
    text-align: start;
    flex: 1;
    font-size: 5px;
    color: rgba(255, 255, 255, 0.4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preview-download-btn {
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    color: white;
    flex-shrink: 0;
  }

  .preview-download-btn :global(svg) {
    width: 6px;
    height: 6px;
  }

  /* Options section - matches real .options-section */
  .preview-options-section {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    overflow: hidden;
  }

  .preview-options-header {
    display: none;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    font: inherit;
  }

  .preview-options-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .preview-options-title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 8px;
    font-weight: 600;
  }

  .preview-options-content {
    display: none !important;
    padding: 0 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .preview-options-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .preview-group-label {
    font-size: 6px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .preview-presets-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .preview-chip {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px 6px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    font-size: 6px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s;
  }

  .preview-chip:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .preview-chip.selected {
    background: rgba(99, 102, 241, 0.15);
    background: color-mix(in srgb, var(--chip-accent, #6366f1) 15%, transparent);
    border-color: var(--chip-accent, #6366f1);
    color: var(--chip-accent, #6366f1);
  }

  .preview-settings-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .preview-setting-btn {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: all 0.15s;
  }

  .preview-setting-btn:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .preview-setting-label {
    font-size: 5px;
    color: rgba(255, 255, 255, 0.5);
  }

  .preview-setting-value {
    font-size: 6px;
    font-weight: 500;
  }

  .preview-checkbox-groups {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .preview-checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .preview-checkbox-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 6px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    user-select: none;
    padding: 0;
    background: transparent;
    border: none;
    font: inherit;
    text-align: left;
    transition: color 0.15s;
  }

  .preview-checkbox-row:hover {
    color: rgba(255, 255, 255, 0.9);
  }

  .preview-checkbox {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .preview-checkbox.checked {
    background: var(--checkbox-accent, #6366f1);
    border-color: var(--checkbox-accent, #6366f1);
    color: white;
  }

  .appearance-controls {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: left;
    min-width: 0;
  }

  .appearance-controls h2 {
    margin-bottom: 0;
    font-size: 18px;
  }

  .appearance-controls .description {
    margin-bottom: 2px;
    font-size: 13px;
  }

  .preview-app-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    margin-top: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .preview-app-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .appearance-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .appearance-label {
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-align: left;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* Background type selector */
  .bg-type-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }

  .bg-type-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
  }

  .bg-type-option:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .bg-type-option.selected {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.15));
    border-color: var(--accent, #6366f1);
    color: white;
  }

  .bg-type-option :global(svg) {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .bg-type-option.selected :global(svg) {
    opacity: 1;
    color: var(--accent, #6366f1);
  }

  .bg-type-option.recommended {
    position: relative;
  }

  .recommended-star {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    border-radius: 50%;
    color: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  .color-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .color-swatch {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 2px solid transparent;
    cursor: pointer;
    transition: all 0.15s;
  }

  .color-swatch:hover {
    transform: scale(1.15);
  }

  .color-swatch.selected {
    border-color: white;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
  }

  /* Input with actions (undo, file picker) */
  .input-with-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .input-with-actions :global(.input-wrapper) {
    flex: 1;
  }

  .action-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .action-btn.undo:hover {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  /* Color input row (picker + text) */
  .color-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .color-picker {
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    background: transparent;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-picker::-webkit-color-swatch {
    border: 2px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
  }

  .color-text-input {
    flex: 1;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: white;
    font-size: 13px;
    font-family: monospace;
    outline: none;
  }

  .color-text-input:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .slider-value {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
    font-family: monospace;
  }

  .slider {
    padding-right: 1px;
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    outline: none;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent, #6366f1);
    cursor: pointer;
    transition: transform 0.15s;
  }

  .slider::-webkit-slider-thumb:hover {
    transform: scale(1.1);
  }

  /* Notifications step with desktop preview */
  .notifications-step {
    padding: 0 !important;
  }

  .notifications-content {
    display: flex;
    gap: 24px;
    width: 100%;
    align-items: flex-start;
  }

  .desktop-preview-container {
    flex-direction: column;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
  }

  .desktop-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .desktop-screen {
    width: 180px;
    height: 120px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%);
    border-radius: 6px;
    border: 2px solid #333;
    position: relative;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .desktop-wallpaper {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 30% 70%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
      radial-gradient(ellipse at 70% 30%, rgba(139, 92, 246, 0.1) 0%, transparent 50%);
  }

  .desktop-window {
    position: absolute;
    background: rgba(30, 30, 40, 0.9);
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .desktop-window.main-window {
    width: 80px;
    height: 50px;
    left: 20px;
    top: 20px;
  }

  .desktop-window.side-window {
    width: 50px;
    height: 40px;
    right: 20px;
    top: 30px;
  }

  .window-titlebar {
    height: 8px;
    background: rgba(50, 50, 60, 0.9);
    display: flex;
    align-items: center;
    padding: 0 4px;
  }

  .window-dots {
    display: flex;
    gap: 2px;
  }

  .window-dots span {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
  }

  .window-content {
    flex: 1;
    background: rgba(40, 40, 50, 0.5);
  }

  /* Simple notification indicator in desktop */
  .notification-indicator {
    position: absolute;
    width: 28px;
    height: 12px;
    background: var(--accent, #6366f1);
    border-radius: 3px;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
  }

  .notification-indicator.top-left {
    top: 6px;
    left: 6px;
  }

  .notification-indicator.top-center {
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
  }

  .notification-indicator.top-right {
    top: 6px;
    right: 6px;
  }

  .notification-indicator.bottom-left {
    bottom: 16px;
    left: 6px;
  }

  .notification-indicator.bottom-center {
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
  }

  .notification-indicator.bottom-right {
    bottom: 16px;
    right: 6px;
  }

  /* Actual notification preview below monitor */
  .notification-actual-preview {
    margin-top: 12px;
    background: #1a1a1e;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    padding: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    position: relative;
    width: 180px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .notification-actual-preview.compact {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    width: 180px;
  }

  /* Full notification styles */
  .notif-close-x {
    position: absolute;
    top: 6px;
    right: 8px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 10px;
    cursor: default;
  }

  .notif-content {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-right: 16px;
  }

  .notif-thumb {
    width: 32px;
    height: 32px;
    border-radius: 5px;
    background: rgba(99, 102, 241, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent, #6366f1);
    flex-shrink: 0;
  }

  .notif-text-content {
    flex: 1;
    min-width: 0;
  }

  .notif-title {
    text-align: start;
    font-size: 10px;
    font-weight: 600;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notif-body {
    text-align: start;
    font-size: 9px;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notif-buttons {
    display: flex;
    gap: 6px;
  }

  .notif-btn {
    flex: 1;
    padding: 5px 10px;
    border: none;
    border-radius: 5px;
    font-size: 10px;
    font-weight: 500;
    cursor: default;
    font-family: inherit;
  }

  .notif-btn.primary {
    background: var(--accent, #6366f1);
    color: white;
  }

  .notif-btn.ghost {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
  }

  /* Compact notification styles */
  .notif-thumb-compact {
    width: 26px;
    height: 26px;
    border-radius: 5px;
    background: rgba(99, 102, 241, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent, #6366f1);
    flex-shrink: 0;
  }

  .notif-title-compact {
    flex: 1;
    font-size: 10px;
    font-weight: 600;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .notif-icon-buttons {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .notif-icon-btn {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 5px;
    cursor: default;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .notif-icon-btn.primary {
    background: var(--accent, #6366f1);
    color: white;
  }

  .notif-icon-btn.ghost {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.6);
  }

  .desktop-taskbar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 10px;
    background: rgba(20, 20, 30, 0.95);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .taskbar-icons {
    display: flex;
    gap: 4px;
  }

  .taskbar-icons span {
    width: 6px;
    height: 6px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }

  .desktop-stand {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .stand-neck {
    width: 16px;
    height: 12px;
    background: linear-gradient(to bottom, #444, #333);
    border-radius: 0 0 2px 2px;
  }

  .stand-base {
    width: 50px;
    height: 6px;
    background: linear-gradient(to bottom, #555, #333);
    border-radius: 0 0 4px 4px;
  }

  .notifications-controls {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .notifications-controls h2 {
    text-align: start;
    margin-bottom: 0;
    font-size: 18px;
  }

  .notifications-controls .description {
    text-align: start;
    margin-bottom: 4px;
    font-size: 13px;
  }

  .notification-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .notification-label {
    text-align: start;
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .notification-warning {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.3);
    border-radius: 8px;
    color: #eab308;
    font-size: 11px;
    line-height: 1.4;
  }

  .notification-warning :global(svg) {
    flex-shrink: 0;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;
    font: inherit;
    color: inherit;
    text-align: left;
  }

  .toggle-row:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .toggle-visual {
    position: relative;
    width: 44px;
    height: 24px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .toggle-visual.checked {
    background: var(--accent, #6366f1);
  }

  .toggle-slider {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    transition: all 0.2s;
  }

  .toggle-visual.checked .toggle-slider {
    transform: translateX(20px);
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .toggle-label {
    font-size: 13px;
    font-weight: 500;
    color: white;
  }

  .toggle-description {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }

  .position-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .position-option {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .position-option:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .position-option.selected {
    background: rgba(var(--accent-rgb, 99, 102, 241), 0.15);
    border-color: var(--accent, #6366f1);
  }

  .position-icon {
    width: 28px;
    height: 18px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    position: relative;
    flex-shrink: 0;
  }

  .position-dot {
    position: absolute;
    width: 8px;
    height: 4px;
    background: var(--accent, #6366f1);
    border-radius: 1px;
  }

  .position-icon.top-left .position-dot {
    top: 2px;
    left: 2px;
  }

  .position-icon.top-center .position-dot {
    top: 2px;
    left: 50%;
    transform: translateX(-50%);
  }

  .position-icon.top-right .position-dot {
    top: 2px;
    right: 2px;
  }

  .position-icon.bottom-left .position-dot {
    bottom: 2px;
    left: 2px;
  }

  .position-icon.bottom-center .position-dot {
    bottom: 2px;
    left: 50%;
    transform: translateX(-50%);
  }

  .position-icon.bottom-right .position-dot {
    bottom: 2px;
    right: 2px;
  }

  /* Dependencies - compact style */
  .deps-status {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    margin-top: 8px;
  }

  .overall-progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .progress-bar-container {
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-bar-container.large {
    height: 8px;
    border-radius: 4px;
  }

  .progress-bar {
    height: 100%;
    background: var(--accent, #6366f1);
    border-radius: inherit;
    transition: width 0.4s ease;
  }

  .progress-bar.error {
    background: #ef4444;
  }

  .progress-label {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
  }

  .progress-label :global(svg) {
    color: #22c55e;
  }

  .deps-error + .overall-progress .progress-label :global(svg) {
    color: #ef4444;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--accent, #6366f1);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .spinner.tiny {
    width: 12px;
    height: 12px;
    border-width: 2px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .deps-error {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 10px;
    color: #ef4444;
  }

  .deps-error .error-msg {
    flex: 1;
    font-size: 12px;
    text-align: left;
  }

  .retry-btn {
    padding: 6px 12px;
    background: rgba(239, 68, 68, 0.2);
    border: none;
    border-radius: 6px;
    color: #ef4444;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .retry-btn:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  .deps-compact-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }

  .dep-compact {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    transition: all 0.2s;
  }

  .dep-compact.installed {
    background: rgba(34, 197, 94, 0.1);
    border-color: rgba(34, 197, 94, 0.2);
  }

  .dep-compact.installing {
    background: rgba(99, 102, 241, 0.1);
    border-color: rgba(99, 102, 241, 0.25);
  }

  .dep-progress {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
    margin-left: auto;
    white-space: nowrap;
  }

  .dep-compact .dep-name {
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
  }

  .dep-compact.installed .dep-name {
    color: #22c55e;
  }

  .dep-status-icon {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .dep-compact.installed .dep-status-icon {
    color: #22c55e;
  }

  .pending-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.25);
  }

  /* Ready step */
  .ready-step .ready-icon {
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(34, 197, 94, 0.1));
    border-radius: 50%;
    color: #22c55e;
    margin-bottom: 8px;
  }

  .ready-summary {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    width: 100%;
    max-width: 320px;
  }

  .summary-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
  }

  .summary-item :global(svg) {
    color: var(--accent, #6366f1);
    flex-shrink: 0;
  }

  .summary-item .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .color-preview {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  /* Navigation buttons */
  .nav-buttons {
    display: flex;
    justify-content: space-between;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* Preview container should include the button */
  .preview-container {
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .preview-container .preview-app-button {
    margin-top: 0;
  }

  /* Test notification button */
  .test-notification-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    margin-top: 8px;
    background: var(--accent-alpha, rgba(99, 102, 241, 0.15));
    border: 1px solid var(--accent, #6366f1);
    border-radius: 8px;
    color: var(--accent, #6366f1);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;
  }

  .test-notification-btn:hover:not(:disabled) {
    background: var(--accent-alpha-hover, rgba(99, 102, 241, 0.25));
  }

  .test-notification-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @media (max-width: 580px) {
    .onboarding-container {
      padding: 24px 20px;
      max-width: 100%;
      max-height: 92vh;
      border-radius: 16px;
    }

    .content-wrapper {
      height: 520px;
    }

    .logo-text {
      font-size: 36px;
    }

    h1 {
      font-size: 20px;
    }

    h2 {
      font-size: 18px;
    }

    .appearance-content {
      flex-direction: column;
      align-items: center;
    }

    .preview-container {
      padding: 8px;
    }

    .app-preview {
      transform: rotateY(-8deg) rotateX(5deg) scale(0.9);
    }

    .appearance-controls {
      text-align: center;
    }

    .appearance-label {
      text-align: center;
    }

    .color-grid {
      justify-content: center;
    }

    .bg-type-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .notifications-content {
      flex-direction: column;
      align-items: center;
    }

    .desktop-preview-container {
      padding: 4px;
    }

    .notifications-controls {
      text-align: center;
    }

    .notification-label {
      text-align: center;
    }

    .position-grid {
      grid-template-columns: repeat(3, 1fr);
    }

    .toggle-row {
      text-align: left;
    }
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

  .warning-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
