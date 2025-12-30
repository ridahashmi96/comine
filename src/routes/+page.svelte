<script lang="ts">
  import { onMount } from 'svelte';
  import { readText } from '@tauri-apps/plugin-clipboard-manager';
  import { invoke } from '@tauri-apps/api/core';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { deps } from '$lib/stores/deps';
  import { queue, activeDownloadsCount } from '$lib/stores/queue';
  import { logs } from '$lib/stores/logs';
  import { navigation, currentView, previousView, canGoBack } from '$lib/stores/navigation';
  import { toast } from '$lib/components/Toast.svelte';
  import SetupBanner from '$lib/components/SetupBanner.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import Input from '$lib/components/Input.svelte';
  import SettingButton from '$lib/components/SettingButton.svelte';
  import OptionModal from '$lib/components/OptionModal.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Divider from '$lib/components/Divider.svelte';
  import PlaylistModal from '$lib/components/PlaylistModal.svelte';
  import PlaylistBuilder, {
    type PlaylistSelection,
    type SelectedEntry,
    type EntrySettings,
    type PlaylistEntry,
  } from '$lib/components/PlaylistBuilder.svelte';
  import TrackBuilder from '$lib/components/TrackBuilder.svelte';
  import ChannelBuilder, { type ChannelSelection } from '$lib/components/ChannelBuilder.svelte';
  import { type ChannelEntry } from '$lib/stores/mediaCache';
  import ViewStack, { type ViewInstance } from '$lib/components/ViewStack.svelte';
  import type { IconName } from '$lib/components/Icon.svelte';

  interface TrackSelection {
    formatString: string;
    downloadMode: 'auto' | 'audio' | 'mute';
    title?: string;
    author?: string;
    thumbnail?: string;
    duration?: number;
  }
  import { isAndroid, isAndroidYtDlpReady, getPlaylistInfoOnAndroid } from '$lib/utils/android';
  import {
    settings,
    settingsReady,
    updateSetting,
    updateSettings,
    type CustomPreset,
    type VideoQuality,
    type DownloadMode,
    type AudioQuality,
    getProxyConfig,
  } from '$lib/stores/settings';
  import {
    cleanUrl,
    isLikelyPlaylist,
    isLikelyChannel,
    isValidMediaUrl,
    isDirectFileUrl,
  } from '$lib/utils/format';

  let url = $state('');
  let status = $state('');
  let androidReady = $state(false);

  let lastYtmAutoSwitchUrl = $state('');
  let trackSelection = $state<TrackSelection | null>(null);

  // Check if URL is a supported site for format/track selection
  function checkIsYouTubeUrl(urlStr: string): boolean {
    if (!urlStr.trim()) return false;
    const u = urlStr.toLowerCase();
    return u.includes('youtube.com') || u.includes('youtu.be');
  }

  function checkIsPlaylistUrl(urlStr: string): boolean {
    if (!urlStr.trim()) return false;
    return checkIsYouTubeUrl(urlStr) && isLikelyPlaylist(urlStr.trim());
  }

  function checkIsChannelUrl(urlStr: string): boolean {
    if (!urlStr.trim()) return false;
    return checkIsYouTubeUrl(urlStr) && isLikelyChannel(urlStr.trim());
  }

  // Derived state for current URL detection
  let isYouTubeUrl = $derived(checkIsYouTubeUrl(url));
  let isPlaylistUrl = $derived(checkIsPlaylistUrl(url));
  let isChannelUrl = $derived(checkIsChannelUrl(url));

  // Check for URL params on mount
  $effect(() => {
    const urlParam = $page.url.searchParams.get('url');
    const openPlaylist = $page.url.searchParams.get('openPlaylist') === '1';
    const openChannel = $page.url.searchParams.get('openChannel') === '1';
    const openFormat = $page.url.searchParams.get('openFormat') === '1';

    if (urlParam) {
      url = urlParam;
      if (openFormat) {
        navigation.openVideo(urlParam);
      } else if (openPlaylist) {
        navigation.openPlaylist(urlParam);
      } else if (openChannel) {
        navigation.openChannel(urlParam);
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  });

  $effect(() => {
    if ($settings.youtubeMusicAudioOnly && url && /music\.youtube\.com/i.test(url)) {
      if (url !== lastYtmAutoSwitchUrl && downloadMode !== 'audio') {
        downloadMode = 'audio';
        if (selectedPreset !== 'music') {
          selectedPreset = 'music';
        }
        lastYtmAutoSwitchUrl = url;
      }
    }
    if (!url.trim()) {
      lastYtmAutoSwitchUrl = '';
    }
  });

  let canDownload = $derived(isAndroid() ? androidReady : $deps.ytdlp?.installed);

  let isDownloading = $derived($activeDownloadsCount > 0);

  let optionsExpanded = $state(true);

  let selectedPreset = $state($settings.selectedPreset ?? 'best');
  let videoQuality = $state<VideoQuality>($settings.defaultVideoQuality ?? 'max');
  let downloadMode = $state<DownloadMode>($settings.defaultDownloadMode ?? 'auto');
  let audioQuality = $state<AudioQuality>($settings.defaultAudioQuality ?? 'best');
  let convertToMp4 = $state($settings.convertToMp4 ?? false);
  let remux = $state($settings.remux ?? true);
  let useHLS = $state($settings.useHLS ?? true);
  let clearMetadata = $state($settings.clearMetadata ?? false);
  let dontShowInHistory = $state($settings.dontShowInHistory ?? false);
  let useAria2 = $state($settings.useAria2 ?? false);
  let ignoreMixes = $state($settings.ignoreMixes ?? true);
  let cookiesFromBrowser = $state($settings.cookiesFromBrowser ?? '');
  let customCookies = $state($settings.customCookies ?? '');

  let settingsInitialized = false;
  $effect(() => {
    if ($settingsReady && $settings && !settingsInitialized) {
      selectedPreset = $settings.selectedPreset ?? 'best';
      videoQuality = $settings.defaultVideoQuality ?? 'max';
      downloadMode = $settings.defaultDownloadMode ?? 'auto';
      audioQuality = $settings.defaultAudioQuality ?? 'best';
      convertToMp4 = $settings.convertToMp4 ?? false;
      remux = $settings.remux ?? true;
      useHLS = $settings.useHLS ?? true;
      clearMetadata = $settings.clearMetadata ?? false;
      dontShowInHistory = $settings.dontShowInHistory ?? false;
      useAria2 = $settings.useAria2 ?? false;
      ignoreMixes = $settings.ignoreMixes ?? true;
      cookiesFromBrowser = $settings.cookiesFromBrowser ?? '';
      customCookies = $settings.customCookies ?? '';
      settingsInitialized = true;
    }
  });

  function saveSettings() {
    updateSettings({
      selectedPreset,
      defaultVideoQuality: videoQuality,
      defaultDownloadMode: downloadMode,
      defaultAudioQuality: audioQuality,
      convertToMp4,
      remux,
      useHLS,
      clearMetadata,
      dontShowInHistory,
      useAria2,
      ignoreMixes,
      cookiesFromBrowser,
      customCookies,
    });
  }

  let videoQualityModalOpen = $state(false);
  let downloadModeModalOpen = $state(false);
  let audioQualityModalOpen = $state(false);
  let cookiesModalOpen = $state(false);
  let customCookiesModalOpen = $state(false);
  let customCookiesInput = $state('');

  let createPresetModalOpen = $state(false);
  let newPresetName = $state('');

  const browserOptions = [
    { value: '', label: $t('download.options.noCookies') },
    { value: 'chrome', label: 'Chrome' },
    { value: 'firefox', label: 'Firefox' },
    { value: 'edge', label: 'Edge' },
    { value: 'brave', label: 'Brave' },
    { value: 'opera', label: 'Opera' },
    { value: 'vivaldi', label: 'Vivaldi' },
    { value: 'safari', label: 'Safari' },
    { value: 'custom', label: $t('download.options.customCookies') },
  ];

  const videoQualityOptions: { value: VideoQuality; label: string }[] = [
    { value: 'max', label: $t('download.quality.max') },
    { value: '4k', label: '4K' },
    { value: '1440p', label: '1440p' },
    { value: '1080p', label: '1080p' },
    { value: '720p', label: '720p' },
    { value: '480p', label: '480p' },
    { value: '360p', label: '360p' },
    { value: '240p', label: '240p' },
  ];

  const downloadModeOptions: { value: DownloadMode; label: string }[] = [
    { value: 'auto', label: $t('download.mode.auto') },
    { value: 'audio', label: $t('download.mode.audio') },
    { value: 'mute', label: $t('download.mode.mute') },
  ];

  const audioQualityOptions: { value: AudioQuality; label: string }[] = [
    { value: 'best', label: $t('download.audio.best') },
    { value: '320', label: '320 kbps' },
    { value: '256', label: '256 kbps' },
    { value: '192', label: '192 kbps' },
    { value: '128', label: '128 kbps' },
    { value: '96', label: '96 kbps' },
  ];

  const builtInPresets: { id: string; label: string; icon: IconName }[] = [
    { id: 'best', label: $t('download.options.bestVideo'), icon: 'video' },
    { id: 'music', label: $t('download.options.music'), icon: 'music' },
    { id: 'small', label: $t('download.options.smallVideo'), icon: 'weight' },
  ];

  let allPresets = $derived([
    ...builtInPresets,
    ...($settings.customPresets ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      icon: 'star' as IconName,
    })),
  ]);

  function applyPreset(preset: string) {
    selectedPreset = preset;

    const customPreset = $settings.customPresets?.find((p) => p.id === preset);
    if (customPreset) {
      videoQuality = customPreset.videoQuality;
      downloadMode = customPreset.downloadMode;
      audioQuality = customPreset.audioQuality;
      remux = customPreset.remux;
      convertToMp4 = customPreset.convertToMp4;
      useHLS = customPreset.useHLS;
      clearMetadata = customPreset.clearMetadata;
      dontShowInHistory = customPreset.dontShowInHistory;
      useAria2 = customPreset.useAria2;
      ignoreMixes = customPreset.ignoreMixes;
      cookiesFromBrowser = customPreset.cookiesFromBrowser;
      saveSettings();
      return;
    }

    switch (preset) {
      case 'best':
        videoQuality = 'max';
        downloadMode = 'auto';
        audioQuality = 'best';
        break;
      case 'small':
        videoQuality = '480p';
        downloadMode = 'auto';
        audioQuality = '192';
        break;
      case 'music':
        videoQuality = 'max';
        downloadMode = 'audio';
        audioQuality = 'best';
        break;
    }
    saveSettings();
  }

  function createCustomPreset() {
    if (!newPresetName.trim()) {
      toast.error($t('download.options.presetNameRequired'));
      return;
    }

    const id = `custom-${Date.now()}`;
    const newPreset: CustomPreset = {
      id,
      label: newPresetName.trim(),
      videoQuality,
      downloadMode,
      audioQuality,
      remux,
      convertToMp4,
      useHLS,
      clearMetadata,
      dontShowInHistory,
      useAria2,
      ignoreMixes,
      cookiesFromBrowser,
    };

    const updatedPresets = [...($settings.customPresets ?? []), newPreset];
    updateSetting('customPresets', updatedPresets);

    selectedPreset = id;
    newPresetName = '';
    createPresetModalOpen = false;
    toast.success($t('download.options.presetCreated'));
  }

  function deletePreset(presetId: string) {
    const updatedPresets = ($settings.customPresets ?? []).filter((p) => p.id !== presetId);
    updateSetting('customPresets', updatedPresets);

    if (selectedPreset === presetId) {
      selectedPreset = 'custom';
    }
    toast.info($t('download.options.presetDeleted'));
  }

  function getLabel(options: { value: string; label: string }[], value: string): string {
    return options.find((o) => o.value === value)?.label ?? value;
  }

  function handleCheckboxChange(key: keyof typeof $settings, value: boolean) {
    switch (key) {
      case 'convertToMp4':
        convertToMp4 = value;
        break;
      case 'remux':
        remux = value;
        break;
      case 'useHLS':
        useHLS = value;
        break;
      case 'clearMetadata':
        clearMetadata = value;
        break;
      case 'dontShowInHistory':
        dontShowInHistory = value;
        break;
      case 'useAria2':
        useAria2 = value;
        break;
      case 'ignoreMixes':
        ignoreMixes = value;
        break;
    }
    selectedPreset = 'custom';
    saveSettings();
  }

  function handleOptionChange(type: 'video' | 'audio' | 'mode', value: string) {
    switch (type) {
      case 'video':
        videoQuality = value as VideoQuality;
        break;
      case 'audio':
        audioQuality = value as AudioQuality;
        break;
      case 'mode':
        downloadMode = value as DownloadMode;
        break;
    }
    selectedPreset = 'custom';
    saveSettings();
  }

  onMount(async () => {
    if (isAndroid()) {
      const checkReady = () => {
        androidReady = isAndroidYtDlpReady();
        if (!androidReady) {
          setTimeout(checkReady, 500);
        }
      };
      checkReady();

      if (!url.trim()) {
        try {
          const clipboardText = await readText();
          if (clipboardText && isValidMediaUrl(clipboardText, $settings.clipboardPatterns || [])) {
            url = cleanUrl(clipboardText);
            toast.info(`📋 ${$t('clipboard.detected')}`);
          }
        } catch (err) {}
      }
    }
  });

  function handleBack() {
    navigation.pop();
    url = '';
  }

  let backLabel = $derived(() => {
    const prev = $previousView;
    if (!prev) return undefined;

    switch (prev.type) {
      case 'home':
        return $t('nav.download');
      case 'playlist':
        const title = prev.cachedData?.title;
        if (title) {
          return title.length > 20 ? title.slice(0, 20) + '…' : title;
        }
        return $t('playlist.title');
      case 'video':
        return prev.cachedData?.title?.slice(0, 20) + '…' || $t('download.tracks.title');
      case 'channel':
        const channelName = prev.cachedData?.title;
        if (channelName) {
          return channelName.length > 20 ? channelName.slice(0, 20) + '…' : channelName;
        }
        return $t('channel.title');
      default:
        return undefined;
    }
  });

  function handleVideoDownload(selection: TrackSelection) {
    const downloadUrl = $currentView.url;
    if (!downloadUrl) return;

    logs.info('download', `Using custom tracks: ${selection.formatString}`);
    const queueId = queue.add(downloadUrl, {
      videoQuality: selection.formatString,
      downloadMode: selection.downloadMode,
      audioQuality: 'best',
      convertToMp4,
      remux,
      useHLS,
      clearMetadata,
      dontShowInHistory,
      useAria2,
      ignoreMixes,
      cookiesFromBrowser,
      customCookies,
      prefetchedInfo: {
        title: selection.title,
        author: selection.author,
        thumbnail: selection.thumbnail,
        duration: selection.duration,
      },
    });

    if (queueId) {
      logs.info('download', `Added to queue with ID: ${queueId}`);
    }
    toast.info($t('downloads.active'));
    navigation.pop();
    url = '';
  }

  function handlePlaylistDownload(selection: PlaylistSelection) {
    logs.info(
      'playlist',
      `Downloading ${selection.entries.length} items from playlist: ${selection.playlistInfo.title}`
    );

    const globalOptions = {
      videoQuality,
      audioQuality,
      convertToMp4,
      remux,
      useHLS,
      clearMetadata,
      dontShowInHistory,
      useAria2,
      ignoreMixes,
      cookiesFromBrowser,
      customCookies,
    };

    const queueEntries = selection.entries.map((e) => ({
      url: e.entry.url,
      title: e.entry.title,
      thumbnail: e.entry.thumbnail ?? undefined,
      author: e.entry.uploader ?? undefined,
      duration: e.entry.duration ?? undefined,
      downloadMode: e.settings.downloadMode,
    }));

    queue.addPlaylist(
      queueEntries,
      {
        playlistId: selection.playlistInfo.id,
        playlistTitle: selection.playlistInfo.title,
        usePlaylistFolder: selection.playlistInfo.usePlaylistFolder,
      },
      globalOptions
    );

    toast.success(
      $t('playlist.notification.downloadStarted').replace(
        '{count}',
        selection.entries.length.toString()
      )
    );
    navigation.goHome();
    url = '';
  }

  function handleOpenPlaylistItem(entry: PlaylistEntry) {
    navigation.openVideo(entry.url, {
      title: entry.title,
      thumbnail: entry.thumbnail ?? undefined,
      author: entry.uploader ?? undefined,
      duration: entry.duration ?? undefined,
    });
  }

  function handleChannelDownload(selection: ChannelSelection) {
    logs.info(
      'channel',
      `Downloading ${selection.entries.length} items from channel: ${selection.channelInfo.name}`
    );

    const globalOptions = {
      videoQuality,
      audioQuality,
      convertToMp4,
      remux,
      useHLS,
      clearMetadata,
      dontShowInHistory,
      useAria2,
      ignoreMixes,
      cookiesFromBrowser,
      customCookies,
    };

    const queueEntries = selection.entries.map((e) => ({
      url: e.entry.url,
      title: e.entry.title,
      thumbnail: e.entry.thumbnail ?? undefined,
      author: selection.channelInfo.name,
      duration: e.entry.duration ?? undefined,
      downloadMode: e.settings.downloadMode,
    }));

    queue.addPlaylist(
      queueEntries,
      {
        playlistId: selection.channelInfo.id,
        playlistTitle: selection.channelInfo.name,
        usePlaylistFolder: selection.channelInfo.useChannelFolder,
      },
      globalOptions
    );

    toast.success(
      $t('playlist.notification.downloadStarted').replace(
        '{count}',
        selection.entries.length.toString()
      )
    );
    navigation.goHome();
    url = '';
  }

  function handleOpenChannelItem(entry: ChannelEntry) {
    navigation.openVideo(entry.url, {
      title: entry.title,
      thumbnail: entry.thumbnail ?? undefined,
      duration: entry.duration ?? undefined,
    });
  }

  function handleOpenChannelFromVideo(
    channelUrl: string,
    previewData?: { name?: string; thumbnail?: string }
  ) {
    navigation.openChannel(channelUrl, {
      title: previewData?.name, // Channel name stored as title in MediaPreview
      thumbnail: previewData?.thumbnail,
    });
  }

  async function quickDownload() {
    if (!url.trim()) {
      status = `⚠️ ${$t('download.placeholder')}`;
      return;
    }

    const downloadUrl = url.trim();
    logs.info('download', `Quick download: ${downloadUrl}`);

    // Check for direct file download
    const fileCheck = isDirectFileUrl(downloadUrl);
    if (fileCheck.isFile) {
      logs.info('download', `Direct file URL detected: ${fileCheck.filename}`);
      queue.addFile({
        url: downloadUrl,
        filename: fileCheck.filename || 'download',
      });
      toast.info($t('downloads.active'));
      url = '';
      return;
    }

    if (isAndroid()) {
      if (!androidReady) {
        status = '⚠️ yt-dlp is initializing, please wait...';
        return;
      }
    } else {
      if (!$deps.ytdlp?.installed) {
        status = '⚠️ Please install yt-dlp first';
        return;
      }
    }

    // Add to queue with current settings
    const queueId = queue.add(downloadUrl, {
      videoQuality,
      downloadMode: downloadMode as 'auto' | 'audio' | 'mute',
      audioQuality,
      convertToMp4,
      remux,
      useHLS,
      clearMetadata,
      dontShowInHistory,
      useAria2,
      ignoreMixes,
      cookiesFromBrowser,
      customCookies,
    });

    if (queueId) {
      logs.info('download', `Added to queue with ID: ${queueId}`);
      toast.info($t('downloads.active'));
    }
    url = '';
  }

  function openAdvancedView() {
    if (!url.trim()) return;

    if (isChannelUrl) {
      navigation.openChannel(url.trim());
    } else if (isPlaylistUrl) {
      navigation.openPlaylist(url.trim());
    } else if (isYouTubeUrl) {
      navigation.openVideo(url.trim());
    }
  }
</script>

<div class="page">
  <ViewStack>
    {#snippet children({ views, currentId, isActive })}
      {#each views as view (view.id)}
        {#key view.id}
          {@const active = isActive(view.id)}
          <div class="view-container" class:active>
            {#if view.type === 'home'}
              <!-- HOME VIEW -->
              <div class="page-header">
                <h1>{$t('app.name')}</h1>
                <p class="subtitle">{$t('download.subtitle')}</p>
              </div>

              <Divider my={20} />

              <div class="page-content">
                <SetupBanner />

                <!-- URL Input -->
                <div class="url-input-wrapper">
                  <Icon name="link" size={18} />
                  {#if url.trim() && canDownload && (isYouTubeUrl || isPlaylistUrl || isChannelUrl)}
                    <button
                      class="input-badge"
                      class:playlist={isPlaylistUrl}
                      class:channel={isChannelUrl}
                      onclick={openAdvancedView}
                    >
                      <Icon
                        name={isChannelUrl ? 'user' : isPlaylistUrl ? 'playlist' : 'play'}
                        size={12}
                      />
                      <span
                        >{isChannelUrl ? 'Channel' : isPlaylistUrl ? 'Playlist' : 'YouTube'}</span
                      >
                    </button>
                  {/if}
                  <input
                    bind:value={url}
                    placeholder={$t('download.placeholder')}
                    class="url-input"
                    disabled={!canDownload}
                  />
                  {#if url.trim() && canDownload && (isYouTubeUrl || isPlaylistUrl || isChannelUrl)}
                    <button
                      class="customize-btn"
                      onclick={openAdvancedView}
                      title={$t('download.customizeDownload')}
                    >
                      <Icon name="alt_arrow_rigth" size={18} />
                    </button>
                  {/if}
                  <button
                    class="download-btn"
                    onclick={quickDownload}
                    disabled={!canDownload || !url.trim()}
                  >
                    <Icon name="download" size={20} />
                  </button>
                </div>

                <!-- Options Section -->
                <div class="options-section">
                  <button
                    class="options-header"
                    onclick={() => (optionsExpanded = !optionsExpanded)}
                  >
                    <span class="options-title">
                      <Icon name="settings" size={18} />
                      {$t('download.options.title')}
                    </span>
                    <Icon name={optionsExpanded ? 'chevron_up' : 'chevron_down'} size={20} />
                  </button>

                  {#if optionsExpanded}
                    <div class="options-content">
                      <!-- Presets -->
                      <div class="options-group">
                        <span class="group-label">{$t('download.options.presets')}</span>
                        <div class="presets-row">
                          {#each allPresets as preset}
                            <Chip
                              selected={selectedPreset === preset.id}
                              icon={preset.icon}
                              onclick={() => applyPreset(preset.id)}
                            >
                              {preset.label}
                              {#if preset.id.startsWith('custom-')}
                                <button
                                  class="preset-delete"
                                  onclick={(e) => {
                                    e.stopPropagation();
                                    deletePreset(preset.id);
                                  }}
                                  title={$t('common.delete')}
                                >
                                  <Icon name="close" size={12} />
                                </button>
                              {/if}
                            </Chip>
                          {/each}
                          <Chip icon="add" onclick={() => (createPresetModalOpen = true)}
                            >{$t('download.options.createNew')}</Chip
                          >
                        </div>
                      </div>

                      <!-- Settings Row -->
                      <div class="settings-row">
                        <SettingButton
                          label={$t('download.options.videoQuality')}
                          value={getLabel(videoQualityOptions, videoQuality)}
                          onclick={() => (videoQualityModalOpen = true)}
                        />
                        <SettingButton
                          label={$t('download.options.downloadMode')}
                          value={getLabel(downloadModeOptions, downloadMode)}
                          onclick={() => (downloadModeModalOpen = true)}
                        />
                        <SettingButton
                          label={$t('download.options.audioQuality')}
                          value={getLabel(audioQualityOptions, audioQuality)}
                          onclick={() => (audioQualityModalOpen = true)}
                        />
                        <SettingButton
                          label={$t('download.options.cookies')}
                          value={cookiesFromBrowser
                            ? getLabel(browserOptions, cookiesFromBrowser)
                            : $t('download.options.noCookies')}
                          onclick={() => (cookiesModalOpen = true)}
                        />
                      </div>

                      <!-- Checkboxes -->
                      <div class="checkbox-groups">
                        <div class="checkbox-group">
                          <span class="group-label">{$t('download.options.postProcessing')}</span>
                          <Checkbox
                            checked={convertToMp4}
                            label={$t('download.options.convertToMp4')}
                            onchange={(val) => handleCheckboxChange('convertToMp4', val)}
                          />
                          <Checkbox
                            checked={remux}
                            label={$t('download.options.remux')}
                            onchange={(val) => handleCheckboxChange('remux', val)}
                          />
                        </div>

                        <div class="checkbox-group">
                          <span class="group-label">{$t('download.options.other')}</span>
                          <Checkbox
                            checked={ignoreMixes}
                            label={$t('download.options.ignoreMixes')}
                            onchange={(val) => handleCheckboxChange('ignoreMixes', val)}
                          />
                          <Checkbox
                            checked={useHLS}
                            label={$t('download.options.useHLS')}
                            onchange={(val) => handleCheckboxChange('useHLS', val)}
                          />
                          <Checkbox
                            checked={clearMetadata}
                            label={$t('download.options.clearMetadata')}
                            onchange={(val) => handleCheckboxChange('clearMetadata', val)}
                          />
                          <Checkbox
                            checked={dontShowInHistory}
                            label={$t('download.options.dontShowInHistory')}
                            onchange={(val) => handleCheckboxChange('dontShowInHistory', val)}
                          />
                          <Checkbox
                            checked={useAria2}
                            label={$t('download.options.useAria2')}
                            onchange={(val) => handleCheckboxChange('useAria2', val)}
                          />
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>

                {#if status}
                  <p class="status">{status}</p>
                {/if}
              </div>
            {:else if view.type === 'video'}
              <!-- VIDEO VIEW -->
              <TrackBuilder
                url={view.url ?? ''}
                {cookiesFromBrowser}
                {customCookies}
                showHeader={true}
                onback={handleBack}
                ondownload={handleVideoDownload}
                onopenchannel={handleOpenChannelFromVideo}
                backLabel={backLabel()}
                prefetchedInfo={view.cachedData}
              />
            {:else if view.type === 'playlist'}
              <!-- PLAYLIST VIEW -->
              <PlaylistBuilder
                url={view.url ?? ''}
                {cookiesFromBrowser}
                {customCookies}
                defaultDownloadMode={downloadMode}
                showHeader={true}
                onback={handleBack}
                ondownload={handlePlaylistDownload}
                onopenitem={handleOpenPlaylistItem}
                backLabel={backLabel()}
                prefetchedInfo={view.cachedData}
              />
            {:else if view.type === 'channel'}
              <!-- CHANNEL VIEW -->
              <ChannelBuilder
                url={view.url ?? ''}
                {cookiesFromBrowser}
                {customCookies}
                showHeader={true}
                onback={handleBack}
                ondownload={handleChannelDownload}
                onopenitem={handleOpenChannelItem}
                backLabel={backLabel()}
                prefetchedInfo={view.cachedData}
              />
            {/if}
          </div>
        {/key}
      {/each}
    {/snippet}
  </ViewStack>
</div>

<!-- Modals -->
<OptionModal
  bind:open={videoQualityModalOpen}
  title={$t('download.options.videoQuality')}
  options={videoQualityOptions}
  bind:value={videoQuality}
  columns={4}
  onselect={(val) => handleOptionChange('video', val)}
/>

<OptionModal
  bind:open={downloadModeModalOpen}
  title={$t('download.options.downloadMode')}
  options={downloadModeOptions}
  bind:value={downloadMode}
  columns={3}
  onselect={(val) => handleOptionChange('mode', val)}
/>

<OptionModal
  bind:open={audioQualityModalOpen}
  title={$t('download.options.audioQuality')}
  options={audioQualityOptions}
  bind:value={audioQuality}
  columns={4}
  onselect={(val) => handleOptionChange('audio', val)}
/>

<OptionModal
  bind:open={cookiesModalOpen}
  title={$t('download.options.cookies')}
  description={$t('download.options.cookiesDescription')}
  options={browserOptions}
  bind:value={cookiesFromBrowser}
  columns={3}
  onselect={(val) => {
    cookiesFromBrowser = val;
    saveSettings();
    if (val === 'custom') {
      customCookiesInput = customCookies;
      customCookiesModalOpen = true;
    }
  }}
/>

<!-- Custom Cookies Modal -->
<Modal bind:open={customCookiesModalOpen} title={$t('download.options.customCookies')}>
  <p class="modal-desc">{$t('download.options.customCookiesDescription')}</p>
  <textarea
    class="cookies-textarea"
    bind:value={customCookiesInput}
    placeholder={$t('download.options.customCookiesPlaceholder')}
    rows="10"
  ></textarea>

  {#snippet actions()}
    <button class="modal-btn" onclick={() => (customCookiesModalOpen = false)}>
      {$t('common.cancel')}
    </button>
    <button
      class="modal-btn primary"
      onclick={() => {
        customCookies = customCookiesInput;
        saveSettings();
        customCookiesModalOpen = false;
      }}
    >
      {$t('common.save')}
    </button>
  {/snippet}
</Modal>

<!-- Create Preset Modal -->
<Modal bind:open={createPresetModalOpen} title={$t('download.options.createPreset')}>
  <p class="modal-desc">{$t('download.options.createPresetDescription')}</p>
  <Input bind:value={newPresetName} placeholder={$t('download.options.presetNamePlaceholder')} />

  <div class="preset-summary">
    <span class="summary-label">{$t('download.options.currentSettings')}:</span>
    <div class="summary-items">
      <span class="summary-item">{getLabel(videoQualityOptions, videoQuality)}</span>
      <span class="summary-item">{getLabel(downloadModeOptions, downloadMode)}</span>
      <span class="summary-item">{getLabel(audioQualityOptions, audioQuality)}</span>
      {#if remux}<span class="summary-item">Remux</span>{/if}
      {#if convertToMp4}<span class="summary-item">MP4</span>{/if}
    </div>
  </div>

  {#snippet actions()}
    <button
      class="modal-btn"
      onclick={() => {
        createPresetModalOpen = false;
        newPresetName = '';
      }}
    >
      {$t('common.cancel')}
    </button>
    <button class="modal-btn primary" onclick={createCustomPreset} disabled={!newPresetName.trim()}>
      {$t('common.create')}
    </button>
  {/snippet}
</Modal>

<style>
  .page {
    padding: 0;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .view-container {
    position: absolute;
    inset: 0;
    height: 100%;
    width: 100%;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 0 6px 16px 16px;
    margin-right: 4px;
    margin-bottom: 4px;
    mask-image: linear-gradient(to bottom, black, black 0px, black calc(100% - 25px), transparent);
    -webkit-mask-image: linear-gradient(
      to bottom,
      black,
      black 0px,
      black calc(100% - 25px),
      transparent
    );
    &:not(.active) * {
      transition: none !important;
      animation: none !important;
    }
  }

  .view-container.active {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    z-index: 1;
  }

  .page-header {
    margin-bottom: 0;
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

  .page-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* URL Input */
  .url-input-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 4px 4px 16px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    transition: all 0.2s;
  }

  .url-input-wrapper:focus-within {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--accent-alpha, rgba(99, 102, 241, 0.4));
  }

  .url-input-wrapper > :global(svg) {
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .url-input {
    flex: 1;
    padding: 8px 0;
    font-size: 14px;
    background: transparent;
    border: none;
    color: white;
    outline: none;
  }

  .url-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .download-btn {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 10px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .download-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .download-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
    color: white;
  }

  /* Options Section */
  .options-section {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    overflow: hidden;
  }

  .options-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 14px 16px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    transition: all 0.15s;
  }

  .options-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .options-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 600;
  }

  .options-content {
    padding: 0 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .options-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .group-label {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .presets-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .settings-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .checkbox-groups {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Status */
  .status {
    padding: 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 14px;
  }

  /* Custom Cookies Modal */
  .modal-desc {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
    margin: 0 0 12px 0;
    line-height: 1.5;
  }

  .cookies-textarea {
    width: 100%;
    min-width: 400px;
    padding: 12px;
    font-family: monospace;
    font-size: 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.9);
    resize: vertical;
  }

  .cookies-textarea::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  .cookies-textarea:focus {
    outline: none;
    border-color: var(--accent-alpha-hover, rgba(99, 102, 241, 0.5));
  }

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

  .modal-btn.primary {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.2));
    border-color: var(--accent-alpha-hover, rgba(99, 102, 241, 0.3));
    color: var(--accent, rgba(129, 140, 248, 1));
  }

  .modal-btn.primary:hover {
    background: var(--accent-alpha-hover, rgba(99, 102, 241, 0.3));
  }

  @media (max-width: 600px) {
    .checkbox-groups {
      grid-template-columns: 1fr;
      gap: 16px;
    }
  }

  /* Preset delete button */
  .preset-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-left: 6px;
    padding: 0;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.15s;
  }

  .preset-delete:hover {
    background: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  /* Preset summary in create modal */
  .preset-summary {
    margin-top: 16px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
  }

  .summary-label {
    display: block;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 8px;
  }

  .summary-items {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .summary-item {
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
  }

  .input-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(255, 0, 0, 0.15);
    color: #ff6666;
    border: none;
    border-radius: 6px;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
    white-space: nowrap;
    cursor: pointer;
    max-width: 80px;
    overflow: hidden;
    animation: badge-expand 0.25s ease-out forwards;
    transition:
      background 0.15s ease,
      transform 0.1s ease;
  }

  .input-badge:hover {
    background: rgba(255, 0, 0, 0.25);
    transform: scale(1.02);
  }

  @keyframes badge-expand {
    from {
      max-width: 0;
      padding: 4px 0;
      opacity: 0;
    }
    to {
      max-width: 80px;
      padding: 4px 8px;
      opacity: 1;
    }
  }

  .input-badge.playlist {
    background: rgba(255, 165, 0, 0.15);
    color: #ffaa44;
  }

  .input-badge.playlist:hover {
    background: rgba(255, 165, 0, 0.25);
  }

  .input-badge.channel {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .input-badge.channel:hover {
    background: rgba(239, 68, 68, 0.25);
  }

  .customize-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-alpha, rgba(99, 102, 241, 0.15));
    color: var(--accent, rgb(99, 102, 241));
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .customize-btn:hover {
    background: var(--accent-alpha, rgba(99, 102, 241, 0.25));
    color: var(--accent, rgb(99, 102, 241));
  }

  .coming-soon {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 64px;
    text-align: center;
    color: rgba(255, 255, 255, 0.6);
  }

  .coming-soon h2 {
    margin: 0;
    color: rgba(255, 255, 255, 0.9);
  }

  .coming-soon p {
    margin: 0;
  }

  .coming-soon .back-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    padding: 10px 20px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .coming-soon .back-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  :global(.rotate-180) {
    transform: rotate(180deg);
  }
</style>
