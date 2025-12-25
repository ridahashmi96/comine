<script lang="ts">
  import { onMount } from 'svelte';
  import { readText } from '@tauri-apps/plugin-clipboard-manager';
  import { invoke } from '@tauri-apps/api/core';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { deps } from '$lib/stores/deps';
  import { queue, activeDownloadsCount } from '$lib/stores/queue';
  import { logs } from '$lib/stores/logs';
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
  import PlaylistModal, { type SelectedEntry } from '$lib/components/PlaylistModal.svelte';
  import type { IconName } from '$lib/components/Icon.svelte';
  import { isAndroid, isAndroidYtDlpReady, getPlaylistInfoOnAndroid } from '$lib/utils/android';
  import { settings, settingsReady, updateSetting, updateSettings, type CustomPreset, type VideoQuality, type DownloadMode, type AudioQuality, getProxyConfig } from '$lib/stores/settings';
  import { cleanUrl, isLikelyPlaylist, isValidMediaUrl, isDirectFileUrl } from '$lib/utils/format';

  let url = $state("");
  let status = $state("");
  let androidReady = $state(false);
  
  // Playlist modal state
  let playlistModalOpen = $state(false);
  let playlistUrl = $state('');
  let checkingPlaylist = $state(false);
  let pendingPlaylistCheck = $state(false);
  let processedPlaylistUrl = $state(''); // Track which URL was already opened in modal
  
  // React to URL query param changes (from Ctrl+V navigation or notification)
  $effect(() => {
    const urlParam = $page.url.searchParams.get('url');
    const openPlaylist = $page.url.searchParams.get('openPlaylist') === '1';
    if (urlParam && urlParam !== url) {
      url = urlParam;
      // If openPlaylist flag is set, open the modal immediately (don't wait for playlist check)
      // But only if we haven't already processed this URL
      if (openPlaylist && urlParam !== processedPlaylistUrl) {
        playlistUrl = urlParam;
        processedPlaylistUrl = urlParam; // Mark as processed to prevent double-open
        playlistModalOpen = true; // Open modal instantly - it will show loading state
      }
      // Clean the URL from address bar
      window.history.replaceState({}, '', window.location.pathname);
    }
  });
  
  // Auto-check for playlist when pendingPlaylistCheck is set
  $effect(() => {
    if (pendingPlaylistCheck && url && canDownload && !checkingPlaylist) {
      pendingPlaylistCheck = false;
      autoCheckPlaylist();
    }
  });
  
  // Auto-check if URL is a playlist and open modal
  async function autoCheckPlaylist() {
    if (!url.trim()) return;
    
    const downloadUrl = url.trim();
    
    // Check if it's a direct file URL
    const fileCheck = isDirectFileUrl(downloadUrl);
    if (fileCheck.isFile) {
      logs.info('download', `Direct file URL detected: ${fileCheck.filename}`);
      queue.addFile({
        url: downloadUrl,
        filename: fileCheck.filename || 'download'
      });
      toast.info($t('downloads.active'));
      url = '';
      return;
    }
    
    checkingPlaylist = true;
    
    try {
      let info: { is_playlist: boolean; total_count: number };
      
      if (isAndroid()) {
        // Android: Use native bridge
        logs.info('download', `Android: checking playlist URL: ${downloadUrl}`);
        info = await getPlaylistInfoOnAndroid(downloadUrl);
      } else {
        // Desktop: Use Rust backend
        info = await invoke<{ is_playlist: boolean; total_count: number }>('get_playlist_info', {
          url: downloadUrl,
          offset: 0,
          limit: 1,
          cookiesFromBrowser: cookiesFromBrowser || null,
          customCookies: customCookies || null,
          proxyConfig: getProxyConfig()
        });
      }
      
      if (info.is_playlist && info.total_count > 1) {
        // It's a playlist - open the modal
        playlistUrl = downloadUrl;
        playlistModalOpen = true;
        checkingPlaylist = false;
        return;
      }
    } catch (e) {
      logs.warn('download', `Failed to check playlist: ${e}`);
    }
    checkingPlaylist = false;
    
    // Not a playlist or failed - just add to queue
    queue.add(downloadUrl, {
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
    toast.info($t('downloads.active'));
    url = '';
  }
  
  // YouTube Music auto-detection: switch to audio mode when YTM URL is detected
  $effect(() => {
    if ($settings.youtubeMusicAudioOnly && url && /music\.youtube\.com/i.test(url)) {
      if (downloadMode !== 'audio') {
        downloadMode = 'audio';
        // Also switch to music preset for visual feedback
        if (selectedPreset !== 'music') {
          selectedPreset = 'music';
        }
      }
    }
  });
  
  // Check if downloads are enabled (Android ready or desktop with yt-dlp installed)
  let canDownload = $derived(
    isAndroid() ? androidReady : $deps.ytdlp?.installed
  );
  
  // Check if currently downloading (from queue)
  let isDownloading = $derived($activeDownloadsCount > 0);
  
  // Options state
  let optionsExpanded = $state(true);
  
  // Download settings - synced with settings store
  let selectedPreset = $state($settings.selectedPreset ?? 'custom');
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
  
  // Sync local state from settings store when it loads
  let settingsInitialized = false;
  $effect(() => {
    // Wait until settings are fully loaded from storage
    if ($settingsReady && $settings && !settingsInitialized) {
      selectedPreset = $settings.selectedPreset ?? 'custom';
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
  
  // Persist settings when they change
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
      customCookies
    });
  }
  
  // Modals
  let videoQualityModalOpen = $state(false);
  let downloadModeModalOpen = $state(false);
  let audioQualityModalOpen = $state(false);
  let cookiesModalOpen = $state(false);
  let customCookiesModalOpen = $state(false);
  let customCookiesInput = $state('');
  
  // Custom preset modal
  let createPresetModalOpen = $state(false);
  let newPresetName = $state('');
  
  // Browser options for cookies
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
  
  // Options
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
  
  // Built-in presets
  const builtInPresets: { id: string; label: string; icon: IconName }[] = [
    { id: 'custom', label: $t('download.options.custom'), icon: 'settings' },
    { id: 'best', label: $t('download.options.bestVideo'), icon: 'video' },
    { id: 'small', label: $t('download.options.smallVideo'), icon: 'video' },
    { id: 'music', label: $t('download.options.music'), icon: 'music' },
  ];
  
  // Combined presets list (built-in + custom)
  let allPresets = $derived([
    ...builtInPresets,
    ...($settings.customPresets ?? []).map(p => ({ id: p.id, label: p.label, icon: 'star' as IconName }))
  ]);
  
  function applyPreset(preset: string) {
    selectedPreset = preset;
    
    // Check if it's a custom preset
    const customPreset = $settings.customPresets?.find(p => p.id === preset);
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
    
    // Built-in presets
    switch (preset) {
      case 'best':
        videoQuality = 'max';
        downloadMode = 'auto';
        audioQuality = 'best';
        break;
      case 'small':
        videoQuality = '480p';
        downloadMode = 'auto';
        audioQuality = '192'; // Fixed: was 'good' which is invalid
        break;
      case 'music':
        videoQuality = 'max';
        downloadMode = 'audio';
        audioQuality = 'best';
        break;
    }
    saveSettings();
  }
  
  // Create a new custom preset from current settings
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
      cookiesFromBrowser
    };
    
    const updatedPresets = [...($settings.customPresets ?? []), newPreset];
    updateSetting('customPresets', updatedPresets);
    
    selectedPreset = id;
    newPresetName = '';
    createPresetModalOpen = false;
    toast.success($t('download.options.presetCreated'));
  }
  
  // Delete a custom preset
  function deletePreset(presetId: string) {
    const updatedPresets = ($settings.customPresets ?? []).filter(p => p.id !== presetId);
    updateSetting('customPresets', updatedPresets);
    
    if (selectedPreset === presetId) {
      selectedPreset = 'custom';
    }
    toast.info($t('download.options.presetDeleted'));
  }
  
  // Get display label for current value
  function getLabel(options: { value: string; label: string }[], value: string): string {
    return options.find(o => o.value === value)?.label ?? value;
  }
  
  // Handle checkbox change and persist
  function handleCheckboxChange(key: keyof typeof $settings, value: boolean) {
    switch (key) {
      case 'convertToMp4': convertToMp4 = value; break;
      case 'remux': remux = value; break;
      case 'useHLS': useHLS = value; break;
      case 'clearMetadata': clearMetadata = value; break;
      case 'dontShowInHistory': dontShowInHistory = value; break;
      case 'useAria2': useAria2 = value; break;
      case 'ignoreMixes': ignoreMixes = value; break;
    }
    selectedPreset = 'custom'; // Switch to custom when manually changing
    saveSettings();
  }
  
  // Handle option modal selection and persist
  function handleOptionChange(type: 'video' | 'audio' | 'mode', value: string) {
    switch (type) {
      case 'video': videoQuality = value as VideoQuality; break;
      case 'audio': audioQuality = value as AudioQuality; break;
      case 'mode': downloadMode = value as DownloadMode; break;
    }
    selectedPreset = 'custom'; // Switch to custom when manually changing
    saveSettings();
  }

  onMount(async () => {
    await deps.checkAll();
    
    // Check if we're on Android and yt-dlp is ready
    if (isAndroid()) {
      // Poll for ready state
      const checkReady = () => {
        androidReady = isAndroidYtDlpReady();
        if (!androidReady) {
          setTimeout(checkReady, 500);
        }
      };
      checkReady();
      
      // Auto-paste from clipboard on Android (if URL field is empty)
      if (!url) {
        try {
          const clipboardText = await readText();
          if (clipboardText && isValidMediaUrl(clipboardText, $settings.clipboardPatterns || [])) {
            url = cleanUrl(clipboardText);
            toast.info(`📋 ${$t('clipboard.detected')}`);
          }
        } catch (err) {
          // Clipboard access might fail on Android, ignore silently
        }
      }
    }
  });
  
  // Handle playlist download from modal
  async function handlePlaylistDownload(entries: SelectedEntry[], playlistInfo: { id: string; title: string; usePlaylistFolder: boolean }) {
    logs.info('playlist', `Downloading ${entries.length} items from playlist: ${playlistInfo.title} (usePlaylistFolder: ${playlistInfo.usePlaylistFolder})`);
    logs.debug('playlist', `Cookies being passed: cookiesFromBrowser="${cookiesFromBrowser}", customCookies="${customCookies ? 'set' : 'none'}"`);
    
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
      customCookies
    };
    
    // Transform entries to the format expected by queue.addPlaylist
    const queueEntries = entries.map(e => ({
      url: e.entry.url,
      title: e.entry.title,
      thumbnail: e.entry.thumbnail ?? undefined,
      author: e.entry.uploader ?? undefined,
      duration: e.entry.duration ?? undefined,
      downloadMode: e.settings.downloadMode,
      videoQuality: e.settings.videoQuality
    }));
    
    queue.addPlaylist(queueEntries, { 
      playlistId: playlistInfo.id, 
      playlistTitle: playlistInfo.title,
      usePlaylistFolder: playlistInfo.usePlaylistFolder
    }, globalOptions);
    url = '';
    playlistUrl = '';
    processedPlaylistUrl = ''; // Allow re-opening same playlist later
    status = '';
    toast.success($t('playlist.notification.downloadStarted').replace('{count}', entries.length.toString()));
  }

  async function download() {
    if (!url.trim()) {
      status = `⚠️ ${$t('download.placeholder')}`;
      return;
    }

    const downloadUrl = url.trim();
    logs.info('download', `User initiated download: ${downloadUrl}`);
    
    // Check if it's a direct file URL
    const fileCheck = isDirectFileUrl(downloadUrl);
    if (fileCheck.isFile) {
      logs.info('download', `Direct file URL detected: ${fileCheck.filename}`);
      queue.addFile({
        url: downloadUrl,
        filename: fileCheck.filename || 'download'
      });
      toast.info($t('downloads.active'));
      url = '';
      return;
    }

    // On Android, check if yt-dlp is ready
    if (isAndroid()) {
      if (!androidReady) {
        status = "⚠️ yt-dlp is initializing, please wait...";
        return;
      }
    } else {
      // Desktop: Check if yt-dlp is installed
      if (!$deps.ytdlp?.installed) {
        status = "⚠️ Please install yt-dlp first";
        return;
      }
    }

    // Check if this might be a playlist URL
    const isPlaylistUrl = isLikelyPlaylist(downloadUrl);
    logs.debug('download', `Is likely playlist: ${isPlaylistUrl}`);
    
    if (isPlaylistUrl) {
      // Check if it's actually a playlist (works for both Android and desktop)
      checkingPlaylist = true;
      try {
        let info: { is_playlist: boolean; total_count: number };
        
        if (isAndroid()) {
          // Android: Use native bridge
          info = await getPlaylistInfoOnAndroid(downloadUrl);
        } else {
          // Desktop: Use Rust backend
          info = await invoke<{ is_playlist: boolean; total_count: number }>('get_playlist_info', {
            url: downloadUrl,
            offset: 0,
            limit: 1,
            cookiesFromBrowser: cookiesFromBrowser || null,
            customCookies: customCookies || null,
            proxyConfig: getProxyConfig()
          });
        }
        
        if (info.is_playlist && info.total_count > 1) {
          // It's a playlist - open the modal
          playlistUrl = downloadUrl;
          playlistModalOpen = true;
          checkingPlaylist = false;
          return;
        }
      } catch (e) {
        logs.warn('download', `Failed to check playlist: ${e}`);
        // Proceed with single download on error
      }
      checkingPlaylist = false;
    }
    
    logs.debug('download', `Options: mode=${downloadMode}, quality=${videoQuality}, audioQuality=${audioQuality}, cookies=${cookiesFromBrowser || 'none'}`);
    
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
    } else {
      logs.warn('download', 'Failed to add to queue (already queued or dependencies missing)');
    }
    
    toast.info($t('downloads.active'));
    url = "";
  }
</script>

<div class="page">
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
      <input 
        bind:value={url} 
        placeholder={$t('download.placeholder')} 
        class="url-input"
        disabled={!canDownload}
      />
      <button 
        class="download-btn" 
        onclick={download} 
        disabled={!canDownload || !url.trim()}
      >
        <Icon name="download" size={20} />
      </button>
    </div>
    
    <!-- Options Section -->
    <div class="options-section">
      <button class="options-header" onclick={() => optionsExpanded = !optionsExpanded}>
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
                    onclick={(e) => { e.stopPropagation(); deletePreset(preset.id); }}
                    title={$t('common.delete')}
                  >
                    <Icon name="close" size={12} />
                  </button>
                {/if}
              </Chip>
            {/each}
            <Chip icon="add" onclick={() => createPresetModalOpen = true}>{$t('download.options.createNew')}</Chip>
          </div>
        </div>
        
        <!-- Settings Row -->
        <div class="settings-row">
          <SettingButton 
            label={$t('download.options.videoQuality')} 
            value={getLabel(videoQualityOptions, videoQuality)}
            onclick={() => videoQualityModalOpen = true}
          />
          <SettingButton 
            label={$t('download.options.downloadMode')} 
            value={getLabel(downloadModeOptions, downloadMode)}
            onclick={() => downloadModeModalOpen = true}
          />
          <SettingButton 
            label={$t('download.options.audioQuality')} 
            value={getLabel(audioQualityOptions, audioQuality)}
            onclick={() => audioQualityModalOpen = true}
          />
          <SettingButton 
            label={$t('download.options.cookies')} 
            value={cookiesFromBrowser ? getLabel(browserOptions, cookiesFromBrowser) : $t('download.options.noCookies')}
            onclick={() => cookiesModalOpen = true}
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
    <button class="modal-btn" onclick={() => customCookiesModalOpen = false}>
      {$t('common.cancel')}
    </button>
    <button class="modal-btn primary" onclick={() => {
      customCookies = customCookiesInput;
      saveSettings();
      customCookiesModalOpen = false;
    }}>
      {$t('common.save')}
    </button>
  {/snippet}
</Modal>

<!-- Create Preset Modal -->
<Modal bind:open={createPresetModalOpen} title={$t('download.options.createPreset')}>
  <p class="modal-desc">{$t('download.options.createPresetDescription')}</p>
  <Input 
    bind:value={newPresetName}
    placeholder={$t('download.options.presetNamePlaceholder')}
  />
  
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
    <button class="modal-btn" onclick={() => { createPresetModalOpen = false; newPresetName = ''; }}>
      {$t('common.cancel')}
    </button>
    <button class="modal-btn primary" onclick={createCustomPreset} disabled={!newPresetName.trim()}>
      {$t('common.create')}
    </button>
  {/snippet}
</Modal>

<!-- Playlist Modal -->
<PlaylistModal 
  bind:open={playlistModalOpen}
  url={playlistUrl}
  {cookiesFromBrowser}
  {customCookies}
  defaultDownloadMode={downloadMode}
  ondownload={handlePlaylistDownload}
  onclose={() => {
    playlistUrl = '';
    processedPlaylistUrl = ''; // Allow re-opening same playlist later
  }}
/>

<style>
  .page {
    padding: 0 8px 16px 16px;
    height: 100%;
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
    background: var(--accent, rgba(99, 102, 241, 0.85));
    border: none;
    border-radius: 10px;
    color: white;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .download-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .download-btn:hover:not(:disabled) {
    background: var(--accent-hover, rgba(99, 102, 241, 1));
    transform: scale(1.02);
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
    color: #EF4444;
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
</style>
