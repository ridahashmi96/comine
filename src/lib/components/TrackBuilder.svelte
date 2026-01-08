<script lang="ts">
  import { untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { t } from '$lib/i18n';
  import { getProxyConfig, settings } from '$lib/stores/settings';
  import { logs } from '$lib/stores/logs';
  import { deps } from '$lib/stores/deps';
  import { portal } from '$lib/actions/portal';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';
  import Select from './Select.svelte';
  import Checkbox from './Checkbox.svelte';
  import Chip from './Chip.svelte';
  import { formatSize, formatDuration } from '$lib/utils/format';
  import { detectBackendForUrl } from '$lib/utils/backend-detection';
  import { isAndroid, getVideoInfoOnAndroid, waitForAndroidYtDlp } from '$lib/utils/android';
  import {
    viewStateCache,
    androidDataCache,
    type VideoViewState,
    type CachedVideoInfo,
  } from '$lib/stores/viewState';
  import {
    mediaCache,
    convertBackendFormats,
    type VideoInfo as UnifiedVideoInfo,
    type VideoFormat as UnifiedVideoFormat,
  } from '$lib/stores/mediaCache';

  interface VideoFormat {
    format_id: string;
    ext: string;
    resolution: string | null;
    fps: number | null;
    vcodec: string | null;
    acodec: string | null;
    filesize: number | null;
    filesize_approx: number | null;
    tbr: number | null;
    vbr: number | null;
    abr: number | null;
    asr: number | null;
    format_note: string | null;
    has_video: boolean;
    has_audio: boolean;
  }

  interface VideoInfo {
    title: string;
    author: string | null;
    thumbnail: string | null;
    duration: number | null;
    formats: VideoFormat[];
    view_count?: number | null;
    like_count?: number | null;
    description?: string | null;
    upload_date?: string | null;
    channel_url?: string | null;
    channel_id?: string | null;
  }

  export interface TrackSelection {
    formatString: string;
    downloadMode: 'auto' | 'audio' | 'mute';
    title?: string;
    author?: string;
    thumbnail?: string;
    duration?: number;
    embedSubs?: boolean;
    subLangs?: string;
    embedChapters?: boolean;
    sponsorblock?: string[];
    embedThumbnail?: boolean;
    embedMetadata?: boolean;
  }

  export interface PrefetchedInfo {
    title?: string;
    thumbnail?: string;
    author?: string;
    duration?: number;
  }

  export interface DefaultSettings {
    sponsorBlock?: boolean;
    chapters?: boolean;
    embedSubtitles?: boolean;
    subtitleLanguages?: string;
    embedThumbnail?: boolean;
    clearMetadata?: boolean;
  }

  interface Props {
    url: string;
    cookiesFromBrowser?: string;
    customCookies?: string;
    defaults?: DefaultSettings;
    ondownload?: (selection: TrackSelection) => void;
    onback?: () => void;
    onopenchannel?: (
      channelUrl: string,
      previewData?: { name?: string; thumbnail?: string }
    ) => void;
    showHeader?: boolean;
    backLabel?: string;
    prefetchedInfo?: PrefetchedInfo;
  }

  let {
    url,
    cookiesFromBrowser = '',
    customCookies = '',
    defaults,
    ondownload,
    onback,
    onopenchannel,
    showHeader = false,
    backLabel,
    prefetchedInfo,
  }: Props = $props();

  const CACHE_TTL = 10 * 60 * 1000;

  function getInitialState() {
    const uiState = mediaCache.getUIState(url);
    const cachedFormats = mediaCache.getFormats(url);
    const cachedVideoInfo = mediaCache.getVideoInfo(url);
    const cachedPreview = mediaCache.getBestPreview(url);

    const legacyCached = viewStateCache.get<VideoViewState>('video', url);
    const androidCachedData = isAndroid() ? androidDataCache.getVideo(url) : null;

    let info: VideoInfo | null = null;
    if (cachedVideoInfo && cachedFormats) {
      info = {
        title: cachedVideoInfo.title,
        author: cachedVideoInfo.author,
        thumbnail: cachedVideoInfo.thumbnail,
        duration: cachedVideoInfo.duration,
        view_count: cachedVideoInfo.viewCount,
        like_count: cachedVideoInfo.likeCount,
        description: cachedVideoInfo.description,
        upload_date: cachedVideoInfo.uploadDate,
        channel_url: cachedVideoInfo.channelUrl,
        channel_id: cachedVideoInfo.channelId,
        formats: cachedFormats.map((f) => ({
          format_id: f.formatId,
          ext: f.ext,
          resolution: f.resolution,
          fps: f.fps,
          vcodec: f.vcodec,
          acodec: f.acodec,
          filesize: f.filesize,
          filesize_approx: f.filesizeApprox,
          tbr: f.tbr,
          vbr: f.vbr,
          abr: f.abr,
          asr: f.asr,
          format_note: f.formatNote,
          has_video: f.hasVideo,
          has_audio: f.hasAudio,
        })),
      };
    } else if (androidCachedData) {
      info = androidCachedData as VideoInfo;
    }

    const hasFullData = !!info;

    return {
      info,
      selectedVideo: uiState?.selectedVideo ?? legacyCached?.selectedVideo ?? 'best',
      selectedAudio: uiState?.selectedAudio ?? legacyCached?.selectedAudio ?? 'best',
      loading: !hasFullData,
      lastLoadedUrl: hasFullData ? url : '',
      fromCache: hasFullData,
    };
  }

  function formatCount(num: number | null | undefined): string {
    if (!num) return '';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num.toString();
  }

  function formatUploadDate(dateStr: string | null | undefined): string {
    if (!dateStr || dateStr.length !== 8) return '';
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const date = new Date(`${year}-${month}-${day}`);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function cleanDescription(desc: string | null | undefined): string {
    if (!desc) return '';
    return desc.trim().replace(/\n{3,}/g, '\n\n');
  }

  function getCodec(codec: string | null): string {
    if (!codec || codec === 'none') return '';
    if (codec.startsWith('avc1')) return 'H.264';
    if (codec.startsWith('av01')) return 'AV1';
    if (codec.startsWith('vp9') || codec.startsWith('vp09')) return 'VP9';
    if (codec.startsWith('hev1') || codec.startsWith('hvc1')) return 'H.265';
    if (codec.startsWith('mp4a')) return 'AAC';
    if (codec.startsWith('opus')) return 'Opus';
    return codec.split('.')[0];
  }

  function getFmtSize(f: VideoFormat): string {
    const size = f.filesize ?? f.filesize_approx;
    if (size) return formatSize(size);
    return '';
  }

  function makeVideoLabel(f: VideoFormat): string {
    const parts: string[] = [];

    if (f.resolution) {
      const resParts = f.resolution.split('x');
      if (resParts.length >= 2 && resParts[1]) {
        const height = parseInt(resParts[1]);
        if (!isNaN(height) && height > 0) {
          parts.push(height + 'p');
        } else {
          parts.push(f.resolution); // Use as-is if can't parse
        }
      } else if (resParts.length === 1 && resParts[0]) {
        const clean = resParts[0].replace('p', '');
        const height = parseInt(clean);
        if (!isNaN(height) && height > 0) {
          parts.push(height + 'p');
        } else {
          parts.push(f.resolution);
        }
      } else {
        parts.push('?');
      }
    } else if (f.format_note) {
      parts.push(f.format_note);
    } else {
      parts.push('?');
    }

    if (f.fps && f.fps > 30) parts.push(`${Math.round(f.fps)}fps`);
    const codec = getCodec(f.vcodec);
    if (codec) parts.push(codec);
    const size = getFmtSize(f);
    if (size) parts.push(size);
    return parts.join(' · ');
  }

  function makeAudioLabel(f: VideoFormat): string {
    const parts: string[] = [];
    if (f.abr) parts.push(`${Math.round(f.abr)} kbps`);
    const codec = getCodec(f.acodec);
    if (codec) parts.push(codec);
    const size = getFmtSize(f);
    if (size) parts.push(size);
    return parts.join(' · ') || 'audio';
  }

  const initialState = getInitialState();
  let loading = $state(initialState.loading);
  let error = $state<string | null>(null);
  let info = $state<VideoInfo | null>(initialState.info);
  let processedThumbnail = $state<string | null>(initialState.info?.thumbnail ?? null);
  let lastLoadedUrl = $state(initialState.lastLoadedUrl);

  let destroyed = false;
  let thumbnailError = $state(false);

  let selectedVideo = $state<string>(initialState.selectedVideo);
  let selectedAudio = $state<string>(initialState.selectedAudio);

  let showDescription = $state(false);

  const initialDefaults = untrack(() => ({
    embedSubtitles: defaults?.embedSubtitles ?? false,
    subtitleLanguages: defaults?.subtitleLanguages ?? 'en,ru',
    sponsorBlock: defaults?.sponsorBlock ?? false,
    chapters: defaults?.chapters ?? true,
    embedThumbnail: defaults?.embedThumbnail ?? true,
    clearMetadata: defaults?.clearMetadata ?? false,
  }));

  let embedSubs = $state(initialDefaults.embedSubtitles);
  let subLangs = $state(initialDefaults.subtitleLanguages);

  let skipSponsors = $state(initialDefaults.sponsorBlock);
  let skipIntros = $state(false);
  let skipSelfPromo = $state(false);
  let skipInteraction = $state(false);

  let embedChapters = $state(initialDefaults.chapters);
  let embedThumbnail = $state(initialDefaults.embedThumbnail);
  let embedMetadata = $state(!initialDefaults.clearMetadata);

  let showMoreOptions = $state(false);

  type PresetId = 'best' | 'music' | 'custom' | string;
  let selectedPreset = $state<PresetId>('best');
  let isYouTubeMusic = $derived(url.includes('music.youtube.com'));
  let didInitialPreset = $state(false);

  let backend = $derived(detectBackendForUrl(url));
  let platformName = $derived.by(() => {
    if (url.includes('bilibili.com') || url.includes('b23.tv')) return 'Bilibili';
    if (url.includes('douyin.com')) return 'Douyin';
    if (url.includes('iqiyi.com')) return 'iQIYI';
    if (url.includes('youku.com')) return 'Youku';
    if (url.includes('qq.com')) return 'Tencent';
    if (url.includes('mgtv.com')) return 'MGTV';
    if (url.includes('weibo.com')) return 'Weibo';
    if (url.includes('kuaishou.com')) return 'Kuaishou';
    if (backend === 'lux') return 'Video';
    return 'YouTube';
  });
  let isYtdlp = $derived(backend === 'ytdlp');

  const presets = $derived.by(() => {
    const available: { id: PresetId; label: string; icon: IconName }[] = [];

    available.push({ id: 'best', label: $t('download.tracks.presetBest'), icon: 'video' });

    const resolutionCounts = new Map<number, number>();
    if (videoFormats.length > 0) {
      videoFormats.forEach((f) => {
        let height = 0;

        if (f.resolution) {
          const parts = f.resolution.split('x');
          if (parts.length >= 2) {
            height = parseInt(parts[1]);
          } else if (parts.length === 1) {
            height = parseInt(f.resolution.replace('p', ''));
          }
        }

        if (height === 0 && f.format_note) {
          const match = f.format_note.match(/(\d+)p/);
          if (match) {
            height = parseInt(match[1]);
          }
        }

        if (height > 0) {
          resolutionCounts.set(height, (resolutionCounts.get(height) || 0) + 1);
        }
      });
    }

    const sortedResolutions = Array.from(resolutionCounts.keys())
      .sort((a, b) => b - a)
      .slice(0, 3);

    sortedResolutions.forEach((height) => {
      available.push({
        id: `${height}p`,
        label: `${height}p`,
        icon: 'video' as IconName,
      });
    });

    if (audioFormats.length > 0 || videoFormats.some((f) => f.has_audio)) {
      available.push({ id: 'music', label: $t('download.tracks.presetMusic'), icon: 'music' });
    }

    return available;
  });

  function applyPreset(preset: PresetId) {
    selectedPreset = preset;

    if (preset === 'best') {
      selectedVideo = 'best';
      selectedAudio = 'best';
    } else if (preset === 'music') {
      selectedVideo = 'none';
      selectedAudio = 'best';
    } else if (preset.endsWith('p')) {
      const height = parseInt(preset.slice(0, -1));
      selectedVideo = findVideoByHeight(height) || 'best';
      selectedAudio = 'best';
    }
  }

  function findVideoByHeight(targetHeight: number): string | null {
    if (!videoFormats.length) return null;
    const match = videoFormats.find((f) => {
      const h = parseInt(f.resolution?.split('x')[1] || '0') || 0;
      return h === targetHeight;
    });
    return match?.format_id || null;
  }

  $effect(() => {
    if (!loading && info && isYouTubeMusic && !didInitialPreset) {
      didInitialPreset = true;
      applyPreset('music');
    }
  });

  function markCustomPreset() {
    selectedPreset = 'custom';
  }
  $effect(() => {
    if (selectedVideo === 'none' && selectedAudio === 'none') {
      selectedAudio = 'best';
    }
  });

  let hasSeparateStreams = $derived(
    info?.formats?.some((f) => (f.has_video && !f.has_audio) || (f.has_audio && !f.has_video)) ??
      false
  );

  let hasMuxedFormats = $derived(info?.formats?.some((f) => f.has_video && f.has_audio) ?? false);

  let useDualSelectors = $derived(hasSeparateStreams);

  let videoFormats = $derived(
    info?.formats
      .filter((f) => f.has_video)
      .sort((a, b) => {
        const aH = parseInt(a.resolution?.split('x')[1] || '0') || 0;
        const bH = parseInt(b.resolution?.split('x')[1] || '0') || 0;
        return bH - aH;
      }) ?? []
  );

  let audioFormats = $derived(
    info?.formats
      .filter((f) => f.has_audio && !f.has_video)
      .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0)) ?? []
  );

  let muxedFormats = $derived(
    info?.formats
      .filter((f) => f.has_video && f.has_audio)
      .sort((a, b) => {
        const aH = parseInt(a.resolution?.split('x')[1] || '0') || 0;
        const bH = parseInt(b.resolution?.split('x')[1] || '0') || 0;
        return bH - aH;
      }) ?? []
  );

  let selectedVideoIsMuxed = $derived(
    selectedVideo !== 'best' && selectedVideo !== 'none'
      ? (info?.formats.find((f) => f.format_id === selectedVideo)?.has_audio ?? false)
      : false
  );

  let muxedOptions = $derived([
    { value: 'best', label: $t('download.tracks.best') },
    ...muxedFormats.map((f) => ({ value: f.format_id, label: makeVideoLabel(f) })),
  ]);

  let selectedMuxed = $state('best');

  function getBestAudioFormat(options?: { preferM4a?: boolean }) {
    if (audioFormats.length === 0) return null;

    if (options?.preferM4a) {
      const bestM4a = audioFormats.find((f) => f.ext === 'm4a');
      return bestM4a ?? audioFormats[0];
    }

    return audioFormats[0];
  }

  let bestVideoDetails = $derived(() => {
    if (videoFormats.length === 0) return '';
    const best = videoFormats[0];
    return makeVideoLabel(best);
  });

  let bestAudioDetails = $derived(() => {
    if (audioFormats.length === 0) return '';
    const best = getBestAudioFormat({ preferM4a: selectedVideo === 'none' });
    if (!best) return '';
    return makeAudioLabel(best);
  });

  let videoOptions = $derived(
    loading
      ? [{ value: 'best', label: $t('download.tracks.loading') }]
      : [
          {
            value: 'best',
            label: bestVideoDetails()
              ? `${$t('download.tracks.bestQuality')} (${bestVideoDetails()})`
              : $t('download.tracks.bestQuality'),
          },
          { value: 'none', label: $t('download.tracks.noVideo') },
          ...videoFormats.map((f) => ({ value: f.format_id, label: makeVideoLabel(f) })),
        ]
  );

  let audioOptions = $derived(
    loading
      ? [{ value: 'best', label: $t('download.tracks.loading') }]
      : [
          {
            value: 'best',
            label: bestAudioDetails()
              ? `${$t('download.tracks.bestQuality')} (${bestAudioDetails()})`
              : $t('download.tracks.bestQuality'),
            disabled: selectedVideoIsMuxed,
          },
          ...(selectedVideo !== 'none'
            ? [
                {
                  value: 'none',
                  label: $t('download.tracks.noAudio'),
                  disabled: selectedVideoIsMuxed,
                },
              ]
            : []),
          ...audioFormats.map((f) => ({
            value: f.format_id,
            label: makeAudioLabel(f),
            disabled: selectedVideoIsMuxed,
          })),
        ]
  );

  let videoOptionsWithValidation = $derived(
    loading
      ? [{ value: 'best', label: $t('download.tracks.loading') }]
      : [
          {
            value: 'best',
            label: bestVideoDetails()
              ? `${$t('download.tracks.bestQuality')} (${bestVideoDetails()})`
              : $t('download.tracks.bestQuality'),
          },
          ...(selectedAudio !== 'none'
            ? [{ value: 'none', label: $t('download.tracks.noVideo') }]
            : []),
          ...videoFormats.map((f) => ({ value: f.format_id, label: makeVideoLabel(f) })),
        ]
  );

  let displayTitle = $derived(info?.title ?? prefetchedInfo?.title ?? '');
  let displayAuthor = $derived(info?.author ?? prefetchedInfo?.author ?? '');
  let displayDuration = $derived(info?.duration ?? prefetchedInfo?.duration ?? null);
  let displayThumbnail = $derived(
    processedThumbnail || info?.thumbnail || prefetchedInfo?.thumbnail
  );

  let estimatedSize = $derived(() => {
    let total = 0;
    let hasEstimate = false;

    if (selectedVideo !== 'none') {
      if (selectedVideo === 'best' && videoFormats.length > 0) {
        const size = videoFormats[0].filesize ?? videoFormats[0].filesize_approx;
        if (size) {
          total += size;
          hasEstimate = true;
        }
      } else {
        const fmt = videoFormats.find((f) => f.format_id === selectedVideo);
        if (fmt) {
          const size = fmt.filesize ?? fmt.filesize_approx;
          if (size) {
            total += size;
            hasEstimate = true;
          }
        }
      }
    }

    if (selectedAudio !== 'none') {
      if (selectedAudio === 'best' && audioFormats.length > 0) {
        const best = getBestAudioFormat({ preferM4a: selectedVideo === 'none' });
        const size = best?.filesize ?? best?.filesize_approx;
        if (size) {
          total += size;
          hasEstimate = true;
        }
      } else {
        const fmt = audioFormats.find((f) => f.format_id === selectedAudio);
        if (fmt) {
          const size = fmt.filesize ?? fmt.filesize_approx;
          if (size) {
            total += size;
            hasEstimate = true;
          }
        }
      }
    }

    return hasEstimate ? formatSize(total) : null;
  });

  function buildSelection(): TrackSelection {
    let formatString: string;
    let downloadMode: 'auto' | 'audio' | 'mute' = 'auto';

    if (!isYtdlp) {
      if (!useDualSelectors) {
        formatString = selectedMuxed === 'best' ? '' : selectedMuxed;
      } else {
        if (selectedVideo === 'none') {
          downloadMode = 'audio';
          formatString = selectedAudio === 'best' ? '' : selectedAudio;
        } else if (selectedVideo === 'best') {
          formatString = ''; // Let lux pick best
        } else {
          formatString = selectedVideo; // Use specific stream ID
        }
      }
    } else if (!useDualSelectors) {
      formatString = selectedMuxed === 'best' ? 'best' : selectedMuxed;
    } else if (selectedVideo === 'none' && selectedAudio === 'none') {
      formatString = 'bestvideo+bestaudio/best';
    } else if (selectedVideo === 'best') {
      if (selectedAudio === 'best') {
        formatString = 'bestvideo+bestaudio/best';
      } else if (selectedAudio === 'none') {
        formatString = 'bestvideo';
        downloadMode = 'mute';
      } else {
        formatString = `bestvideo+${selectedAudio}`;
      }
    } else if (selectedVideo === 'none') {
      if (selectedAudio === 'best') {
        const best = getBestAudioFormat({ preferM4a: true });
        formatString = best?.format_id ?? 'bestaudio';
        downloadMode = 'audio';
      } else {
        formatString = selectedAudio;
        downloadMode = 'audio';
      }
    } else {
      if (selectedVideoIsMuxed) {
        formatString = selectedVideo;
      } else if (selectedAudio === 'best') {
        formatString = `${selectedVideo}+bestaudio`;
      } else if (selectedAudio === 'none') {
        formatString = selectedVideo;
        downloadMode = 'mute';
      } else {
        formatString = `${selectedVideo}+${selectedAudio}`;
      }
    }

    const sponsorblockCategories: string[] = [];
    if (isYtdlp) {
      if (skipSponsors) sponsorblockCategories.push('sponsor');
      if (skipIntros) sponsorblockCategories.push('intro', 'outro');
      if (skipSelfPromo) sponsorblockCategories.push('selfpromo');
      if (skipInteraction) sponsorblockCategories.push('interaction');
    }

    return {
      formatString,
      downloadMode,
      title: displayTitle || undefined,
      author: displayAuthor || undefined,
      thumbnail: displayThumbnail ?? undefined,
      duration: displayDuration ?? undefined,
      embedSubs,
      subLangs: embedSubs ? subLangs : undefined,
      embedChapters,
      sponsorblock: sponsorblockCategories.length > 0 ? sponsorblockCategories : undefined,
      embedThumbnail,
      embedMetadata,
    };
  }

  function handleDownload() {
    if (loading || error) return;
    ondownload?.(buildSelection());
  }

  function handleOpenChannel() {
    const channelUrl = info?.channel_url;
    if (!channelUrl || !onopenchannel) return;

    onopenchannel(channelUrl, {
      name: info?.author ?? undefined,
      thumbnail: undefined, // Video thumbnail is not the channel thumbnail
    });
  }

  let canOpenChannel = $derived(!!info?.channel_url && !!onopenchannel);

  $effect(() => {
    if (url && url !== lastLoadedUrl && !info) {
      loadInfo();
    }
  });

  function saveToCache() {
    if (url) {
      mediaCache.setUIState(url, {
        selectedVideo,
        selectedAudio,
        scrollTop: 0,
      });

      if (info) {
        mediaCache.setVideoInfo(url, {
          title: info.title,
          author: info.author,
          thumbnail: info.thumbnail,
          duration: info.duration,
          viewCount: info.view_count ?? null,
          likeCount: info.like_count ?? null,
          uploadDate: info.upload_date ?? null,
          description: info.description ?? null,
          channelUrl: info.channel_url ?? null,
          channelId: info.channel_id ?? null,
        });

        mediaCache.setFormats(
          url,
          info.formats.map((f) => ({
            formatId: f.format_id,
            ext: f.ext,
            resolution: f.resolution,
            fps: f.fps,
            vcodec: f.vcodec,
            acodec: f.acodec,
            filesize: f.filesize,
            filesizeApprox: f.filesize_approx,
            tbr: f.tbr,
            vbr: f.vbr,
            abr: f.abr,
            asr: f.asr,
            formatNote: f.format_note,
            hasVideo: f.has_video,
            hasAudio: f.has_audio,
          }))
        );
      }

      viewStateCache.set<VideoViewState>({
        type: 'video',
        url,
        selectedVideo,
        selectedAudio,
        scrollTop: 0,
        timestamp: Date.now(),
      });

      if (isAndroid() && info) {
        androidDataCache.setVideo(url, {
          title: info.title,
          author: info.author ?? '',
          thumbnail: info.thumbnail,
          duration: info.duration,
          view_count: info.view_count ?? null,
          like_count: info.like_count ?? null,
          upload_date: info.upload_date ?? null,
          description: info.description ?? null,
          formats: info.formats.map((f) => ({
            format_id: f.format_id,
            ext: f.ext,
            resolution: f.resolution,
            fps: f.fps,
            vcodec: f.vcodec,
            acodec: f.acodec,
            abr: f.abr,
            filesize: f.filesize,
            filesize_approx: f.filesize_approx,
            has_video: f.has_video,
            has_audio: f.has_audio,
          })),
        });
      }
    }
  }

  $effect(() => {
    return () => {
      destroyed = true;
      saveToCache();
      console.log(
        `[TrackBuilder] Destroying: ${url}, formats count: ${info?.formats?.length ?? 0}`
      );
      info = null;
      processedThumbnail = null;
    };
  });

  async function processThumbnail(thumbUrl: string) {
    if (!thumbUrl || destroyed) return;
    processedThumbnail = thumbUrl;
  }

  async function loadInfo() {
    if (destroyed) return;
    loading = true;
    error = null;
    processedThumbnail = null;
    lastLoadedUrl = url;

    try {
      logs.info('tracks', `Fetching info for: ${url}`);

      let loadedInfo: VideoInfo;

      if (isAndroid()) {
        await waitForAndroidYtDlp();
        if (destroyed) return; // Check after await
        const raw = await getVideoInfoOnAndroid(url);
        if (destroyed) return; // Check after await
        if (!raw) throw new Error('Failed to get video info');

        const rawFormats = (raw.formats as Array<Record<string, unknown>>) || [];
        loadedInfo = {
          title: (raw.title as string) || url,
          author: (raw.uploader as string) || (raw.channel as string) || null,
          thumbnail: (raw.thumbnail as string) || null,
          duration: (raw.duration as number) || null,
          view_count: (raw.view_count as number) || null,
          like_count: (raw.like_count as number) || null,
          description: (raw.description as string) || null,
          upload_date: (raw.upload_date as string) || null,
          channel_url: (raw.channel_url as string) || null,
          channel_id: (raw.channel_id as string) || null,
          formats: rawFormats.map((f) => ({
            format_id: (f.format_id as string) || '',
            ext: (f.ext as string) || '',
            resolution: (f.resolution as string) || null,
            fps: (f.fps as number) || null,
            vcodec: (f.vcodec as string) || null,
            acodec: (f.acodec as string) || null,
            filesize: (f.filesize as number) || null,
            filesize_approx: (f.filesize_approx as number) || null,
            tbr: (f.tbr as number) || null,
            vbr: (f.vbr as number) || null,
            abr: (f.abr as number) || null,
            asr: (f.asr as number) || null,
            format_note: (f.format_note as string) || null,
            has_video: f.vcodec !== null && f.vcodec !== 'none',
            has_audio: f.acodec !== null && f.acodec !== 'none',
          })),
        };
      } else {
        const backend = detectBackendForUrl(url);
        const luxInstalled = backend === 'lux' && $deps.lux?.installed;
        const command = luxInstalled ? 'lux_get_video_formats' : 'get_video_formats';

        loadedInfo = await invoke<VideoInfo>(command, {
          url,
          cookiesFromBrowser: cookiesFromBrowser || null,
          customCookies: customCookies || null,
          proxyConfig: getProxyConfig(),
        });
        if (destroyed) return;
      }

      info = loadedInfo;
      saveToCache();

      if (info.thumbnail) {
        processThumbnail(info.thumbnail);
      }

      logs.info(
        'tracks',
        `Loaded: ${info.title}, ${videoFormats.length} video, ${audioFormats.length} audio`
      );
    } catch (e) {
      if (destroyed) return;
      error = String(e);
      logs.error('tracks', `Failed: ${e}`);
    } finally {
      if (!destroyed) {
        loading = false;
      }
    }
  }
</script>

<div class="track-builder" class:full-bleed={showHeader}>
  {#if showHeader}
    <div class="view-header">
      <button class="back-btn" onclick={onback}>
        <Icon name="alt_arrow_rigth" size={16} class="rotate-180" />
        <span>{backLabel || $t('common.back')}</span>
      </button>
      <div class="header-badge">
        <Icon name="play" size={12} />
        <span>{platformName}</span>
      </div>
      <div class="header-spacer"></div>
      {#if estimatedSize()}
        <span class="size-estimate">~{estimatedSize()}</span>
      {/if}
      <button class="header-download-btn" onclick={handleDownload} disabled={loading || !!error}>
        <Icon name="download" size={16} />
        <span>{$t('common.download')}</span>
      </button>
    </div>
  {:else}
    <div class="yt-badge">
      <Icon name="play" size={14} />
      <span>{platformName}</span>
    </div>
  {/if}

  <div class="card">
    {#if error}
      <div class="error-state">
        <Icon name="warning" size={18} />
        <span>{$t('download.tracks.error')}</span>
        <button class="retry-btn" onclick={loadInfo}>
          <Icon name="restart" size={14} />
        </button>
      </div>
    {:else if showHeader}
      <div class="content-scroll">
        <div class="video-header">
          <div class="video-thumb-container">
            {#if loading}
              <div class="video-thumb skeleton"></div>
            {:else if displayThumbnail && !thumbnailError}
              <img
                src={displayThumbnail}
                alt=""
                class="video-thumb"
                onerror={() => (thumbnailError = true)}
              />
              {#if info?.duration}
                <span class="thumb-duration">{formatDuration(info.duration)}</span>
              {/if}
            {:else}
              <div class="video-thumb empty"><Icon name="video" size={32} /></div>
            {/if}
          </div>
          <div class="video-info">
            {#if loading && !displayTitle}
              <div class="title-skel skeleton"></div>
              <div class="meta-skel skeleton"></div>
              <div class="stats-skel">
                <span class="stat-skel skeleton"></span>
                <span class="stat-skel skeleton"></span>
                <span class="stat-skel skeleton"></span>
              </div>
            {:else if displayTitle || info}
              <h1 class="video-title">{displayTitle}</h1>
              <div class="video-meta">
                {#if displayAuthor}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span
                    class="channel"
                    class:clickable={canOpenChannel}
                    onclick={canOpenChannel ? handleOpenChannel : undefined}
                  >
                    <span class="channel-avatar-placeholder"><Icon name="user" size={12} /></span>
                    {displayAuthor}
                    {#if canOpenChannel}
                      <Icon name="alt_arrow_rigth" size={12} class="channel-arrow" />
                    {/if}
                  </span>
                {/if}
                {#if displayDuration && !info?.view_count}
                  <span class="meta-item"
                    ><Icon name="clock" size={14} />{formatDuration(displayDuration)}</span
                  >
                {/if}
                {#if loading && !info}
                  <!-- Show skeleton stats while loading full info -->
                  <span class="meta-item skeleton-inline"></span>
                  <span class="meta-item skeleton-inline"></span>
                  <span class="meta-item skeleton-inline"></span>
                {:else}
                  {#if info?.view_count}<span class="meta-item"
                      ><Icon name="eye_line_duotone" size={14} />{formatCount(
                        info.view_count
                      )}</span
                    >{/if}
                  {#if info?.like_count}<span class="meta-item"
                      ><Icon name="heart" size={14} />{formatCount(info.like_count)}</span
                    >{/if}
                  {#if info?.upload_date}<span class="meta-item"
                      ><Icon name="date" size={14} />{formatUploadDate(info.upload_date)}</span
                    >{/if}
                {/if}
              </div>

              {#if loading && !info?.description}
                <div class="desc-skel skeleton"></div>
              {:else if cleanDescription(info?.description)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="desc-preview" onclick={() => (showDescription = true)}>
                  <p class="desc-text">{cleanDescription(info?.description)}</p>
                  <span class="desc-more">...more</span>
                </div>
              {/if}
            {:else}
              <div class="title-skel skeleton"></div>
              <div class="meta-skel skeleton"></div>
            {/if}
          </div>
        </div>
        <div class="quality-section">
          <span class="section-label">{$t('download.tracks.quality')}</span>
          <div class="presets-row">
            {#if loading && presets.length <= 1}
              <!-- Show skeleton chips while loading -->
              <div class="preset-skel skeleton"></div>
              <div class="preset-skel skeleton"></div>
              <div class="preset-skel skeleton"></div>
              <div class="preset-skel skeleton"></div>
            {:else}
              {#each presets as preset}
                <Chip
                  icon={preset.icon}
                  selected={selectedPreset === preset.id}
                  onclick={() => applyPreset(preset.id)}
                >
                  {preset.label}
                </Chip>
              {/each}
            {/if}
          </div>
          {#if useDualSelectors}
            <div class="quality-row">
              <div class="quality-select">
                <span class="select-label">{$t('download.tracks.video')}</span>
                <Select
                  bind:value={selectedVideo}
                  options={videoOptionsWithValidation}
                  disabled={loading}
                  onchange={markCustomPreset}
                />
              </div>
              <div class="quality-select" class:disabled={selectedVideoIsMuxed}>
                <span class="select-label">
                  {$t('download.tracks.audio')}
                  {#if selectedVideoIsMuxed}<span class="dimmed"> (included)</span>{/if}
                </span>
                <Select
                  bind:value={selectedAudio}
                  options={audioOptions}
                  disabled={loading || selectedVideoIsMuxed}
                  onchange={markCustomPreset}
                />
              </div>
            </div>
          {:else}
            <div class="quality-row">
              <div class="quality-select single">
                <span class="select-label">{$t('download.tracks.quality')}</span>
                <Select
                  bind:value={selectedMuxed}
                  options={muxedOptions}
                  disabled={loading}
                  onchange={markCustomPreset}
                />
              </div>
            </div>
          {/if}
        </div>
        <div class="options-row">
          {#if isYtdlp}
            <div class="option-group">
              <span class="group-header">SponsorBlock <span class="tag">yt-dlp</span></span>
              <div class="checks">
                <Checkbox bind:checked={skipSponsors} label={$t('download.tracks.skipSponsors')} />
                <Checkbox bind:checked={skipIntros} label={$t('download.tracks.skipIntros')} />
                <Checkbox
                  bind:checked={skipSelfPromo}
                  label={$t('download.tracks.skipSelfPromo')}
                />
                <Checkbox
                  bind:checked={skipInteraction}
                  label={$t('download.tracks.skipInteraction')}
                />
              </div>
            </div>
          {/if}

          <div class="option-group">
            <span class="group-header">{$t('download.tracks.embedOptions')}</span>
            <div class="checks">
              <Checkbox bind:checked={embedChapters} label={$t('download.tracks.embedChapters')} />
              <Checkbox
                bind:checked={embedThumbnail}
                label={$t('download.tracks.embedThumbnail')}
              />
              <Checkbox bind:checked={embedMetadata} label={$t('download.tracks.embedMetadata')} />
            </div>
          </div>

          <div class="option-group">
            <span class="group-header">{$t('download.tracks.subtitles')}</span>
            <div class="checks">
              <Checkbox bind:checked={embedSubs} label={$t('download.tracks.embedSubs')} />
              {#if embedSubs}
                <input type="text" class="lang-input" bind:value={subLangs} placeholder="en" />
              {/if}
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="main-row">
        <div class="left">
          {#if loading}
            <div class="thumb skeleton"></div>
          {:else if displayThumbnail && !thumbnailError}
            <img
              src={displayThumbnail}
              alt=""
              class="thumb"
              onerror={() => (thumbnailError = true)}
            />
          {:else}
            <div class="thumb empty"><Icon name="video" size={20} /></div>
          {/if}
          <div class="info">
            {#if loading && !displayTitle}
              <div class="title-skel skeleton"></div>
              <div class="meta-skel skeleton"></div>
            {:else if displayTitle || info}
              <span class="title-row">
                <span class="title">{displayTitle}</span>
                <button
                  class="copy-link-btn"
                  onclick={() => {
                    navigator.clipboard.writeText(url);
                    import('$lib/components/Toast.svelte').then((m) =>
                      m.toast.success($t('common.copied'))
                    );
                  }}
                  title={$t('common.copyLink')}
                >
                  <Icon name="link" size={12} />
                </button>
              </span>
              <span class="meta">
                {#if displayAuthor}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span
                    class="channel-link"
                    class:clickable={canOpenChannel}
                    onclick={canOpenChannel ? handleOpenChannel : undefined}
                  >
                    {displayAuthor}
                    {#if canOpenChannel}
                      <Icon name="alt_arrow_rigth" size={10} class="link-arrow" />
                    {/if}
                  </span>
                {/if}
                {#if displayDuration}
                  {#if displayAuthor}
                    ·
                  {/if}
                  {formatDuration(displayDuration)}
                {/if}
              </span>
              {#if info?.view_count || info?.like_count}
                <div class="stats-row">
                  {#if info?.view_count}
                    <span class="stat">
                      <Icon name="eye_line_duotone" size={12} />
                      {formatCount(info.view_count)}
                    </span>
                  {/if}
                  {#if info?.like_count}
                    <span class="stat">
                      <Icon name="heart" size={12} />
                      {formatCount(info.like_count)}
                    </span>
                  {/if}
                </div>
              {/if}
            {:else}
              <div class="title-skel skeleton"></div>
              <div class="meta-skel skeleton"></div>
            {/if}
          </div>
        </div>

        <div class="right">
          <div class="select-group">
            <span class="select-label">{$t('download.tracks.video')}</span>
            <Select
              bind:value={selectedVideo}
              options={videoOptionsWithValidation}
              disabled={loading}
            />
          </div>
          <div class="select-group">
            <span class="select-label">{$t('download.tracks.audio')}</span>
            <Select bind:value={selectedAudio} options={audioOptions} disabled={loading} />
          </div>
        </div>
      </div>

      <div class="extras-row">
        <button class="more-btn" onclick={() => (showMoreOptions = !showMoreOptions)}>
          <Icon name={showMoreOptions ? 'chevron_up' : 'chevron_down'} size={14} />
          <span>{$t('download.tracks.moreOptions')}</span>
        </button>
      </div>

      {#if showMoreOptions}
        <div class="more-options">
          {#if isYtdlp}
            <div class="option-group">
              <span class="group-label">
                <span>SponsorBlock</span>
                <span class="sponsor-tag">yt-dlp</span>
              </span>
              <div class="option-grid">
                <Checkbox bind:checked={skipSponsors} label={$t('download.tracks.skipSponsors')} />
                <Checkbox bind:checked={skipIntros} label={$t('download.tracks.skipIntros')} />
                <Checkbox
                  bind:checked={skipSelfPromo}
                  label={$t('download.tracks.skipSelfPromo')}
                />
                <Checkbox
                  bind:checked={skipInteraction}
                  label={$t('download.tracks.skipInteraction')}
                />
              </div>
            </div>
          {/if}

          <div class="option-group">
            <span class="group-label">{$t('download.tracks.subtitles')}</span>
            <div class="subs-row">
              <Checkbox bind:checked={embedSubs} label={$t('download.tracks.embedSubs')} />
              {#if embedSubs}
                <input
                  type="text"
                  class="lang-input"
                  bind:value={subLangs}
                  placeholder="en"
                  title={$t('download.tracks.subLangsHint')}
                />
              {/if}
            </div>
          </div>

          <div class="option-group">
            <span class="group-label">{$t('download.tracks.embedOptions')}</span>
            <div class="option-grid">
              <Checkbox bind:checked={embedChapters} label={$t('download.tracks.embedChapters')} />
              <Checkbox
                bind:checked={embedThumbnail}
                label={$t('download.tracks.embedThumbnail')}
              />
              <Checkbox bind:checked={embedMetadata} label={$t('download.tracks.embedMetadata')} />
            </div>
          </div>
        </div>
      {/if}

      {#if !showHeader && ondownload}
        <div class="footer-actions">
          {#if estimatedSize()}
            <span class="size-estimate">~{estimatedSize()}</span>
          {/if}
          <button
            class="download-btn footer-download"
            onclick={handleDownload}
            disabled={loading || !!error}
          >
            <Icon name="download" size={18} />
            <span>{$t('common.download')}</span>
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Description Modal -->
{#if showDescription && info?.description}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="desc-modal-overlay" use:portal onclick={() => (showDescription = false)}>
    <div class="desc-modal" onclick={(e) => e.stopPropagation()}>
      <div class="desc-modal-header">
        <span class="desc-modal-title">{$t('download.tracks.description')}</span>
        <button class="desc-modal-close" onclick={() => (showDescription = false)}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div class="desc-modal-content">
        {cleanDescription(info.description)}
      </div>
    </div>
  </div>
{/if}

<style>
  .track-builder {
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: fadeIn 0.2s ease-out;
  }

  .track-builder.full-bleed {
    /* margin: 0 -8px 0 -16px; */
    padding: 0 8px 0 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 480px) {
    .track-builder.full-bleed {
      height: auto;
      min-height: 100%;
    }
  }

  .track-builder.full-bleed .view-header {
    position: sticky;
    top: 0;
    z-index: 10;
    margin: 0;
    /* padding: 10px 16px 10px 16px; */
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .track-builder.full-bleed .card {
    background: transparent;
    border: none;
    border-radius: 0;
    /* padding: 0 16px 0 16px; */
    flex: 1;
    overflow-y: auto;
  }

  .track-builder.full-bleed .yt-badge {
    display: none;
  }

  /* View header with back and download buttons */
  .view-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    flex-wrap: wrap;
    min-width: 0;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    min-width: 0;
    flex-shrink: 1;
  }

  .back-btn span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }

  .back-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
  }

  .header-badge {
    display: none; /* Hide on mobile, show via media query */
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    background: rgba(255, 0, 0, 0.12);
    border-radius: 6px;
    color: #ff6b6b;
    font-size: 11px;
    font-weight: 600;
  }

  @media (min-width: 400px) {
    .header-badge {
      display: inline-flex;
    }
  }

  .header-spacer {
    flex: 1;
    min-width: 8px;
  }

  .size-estimate {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    font-weight: 500;
    flex-shrink: 0;
  }

  .header-download-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    color: white;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .header-download-btn span {
    display: none;
  }

  @media (min-width: 360px) {
    .header-download-btn span {
      display: inline;
    }
  }

  .header-download-btn:hover:not(:disabled) {
    background: var(--accent, #6366f1);
    border-color: var(--accent, #6366f1);
  }

  .header-download-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ==================== FULL PAGE LAYOUT - YouTube Style ==================== */

  .content-scroll {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-top: 8px;
  }

  /* Video Header - side by side on wide screens */
  .video-header {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  /* Video Thumbnail */
  .video-thumb-container {
    position: relative;
    flex-shrink: 0;
    width: 280px;
    border-radius: 12px;
    overflow: hidden;
  }

  .video-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 12px;
  }

  .video-thumb.empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.2);
  }

  .thumb-duration {
    position: absolute;
    bottom: 8px;
    right: 8px;
    padding: 3px 6px;
    background: rgba(0, 0, 0, 0.8);
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    color: white;
  }

  /* Video Info */
  .video-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .video-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: white;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .video-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
  }

  .video-meta .channel,
  .video-meta .meta-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .video-meta .channel {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 500;
    gap: 6px;
    transition: color 0.15s ease;
  }

  .video-meta .channel.clickable {
    cursor: pointer;
  }

  .video-meta .channel.clickable:hover {
    color: var(--accent);
  }

  .video-meta .channel :global(.channel-arrow) {
    opacity: 0;
    width: 0;
    overflow: hidden;
    transition:
      opacity 0.15s ease,
      width 0.15s ease,
      transform 0.15s ease;
    color: rgba(255, 255, 255, 0.5);
  }

  .video-meta .channel.clickable:hover :global(.channel-arrow) {
    opacity: 1;
    width: 12px;
    transform: translateX(2px);
    color: var(--accent);
  }

  .channel-avatar-placeholder {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.5);
  }

  .video-meta .channel::after {
    content: '•';
    margin-left: 4px;
    color: rgba(255, 255, 255, 0.4);
  }

  .video-meta .meta-item::after {
    content: '•';
    margin-left: 4px;
    color: rgba(255, 255, 255, 0.4);
  }

  .video-meta .meta-item:last-child::after {
    display: none;
  }

  /* Description Preview (YouTube style clickable box) */
  .desc-preview {
    padding: 12px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .desc-preview:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .desc-text {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.7);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .desc-more {
    display: inline-block;
    margin-top: 4px;
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
  }

  .presets-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* Quality Section */
  .quality-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-label {
    font-size: 14px;
    font-weight: 600;
    color: white;
  }

  .quality-row {
    display: flex;
    gap: 12px;
  }

  .quality-select {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .quality-select.single {
    max-width: 400px;
  }

  .quality-select.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .quality-select .select-label {
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .quality-select .select-label .dimmed {
    font-size: 10px;
    opacity: 0.6;
    font-weight: 400;
    text-transform: none;
  }

  /* Options Row */
  .options-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    padding: 14px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .group-header {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .group-header .tag {
    padding: 2px 5px;
    background: rgba(255, 165, 0, 0.15);
    border-radius: 3px;
    font-size: 9px;
    color: #fbbf24;
  }

  .checks {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Description Modal */
  .desc-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
  }

  .desc-modal {
    width: 90%;
    max-width: 500px;
    max-height: 70vh;
    background: #1a1a24;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .desc-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .desc-modal-title {
    font-size: 14px;
    font-weight: 600;
    color: white;
  }

  .desc-modal-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.15s;
  }

  .desc-modal-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .desc-modal-content {
    padding: 16px;
    font-size: 13px;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.75);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-y: auto;
  }

  /* ==================== COMPACT LAYOUT ==================== */

  .download-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--accent, #6366f1);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .download-btn:hover:not(:disabled) {
    background: var(--accent-hover, #5558e3);
    transform: translateY(-1px);
  }

  .download-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Footer actions */
  .footer-actions {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    justify-content: flex-end;
  }

  .footer-download {
    padding: 12px 24px;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .yt-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: rgba(255, 0, 0, 0.15);
    border-radius: 6px;
    color: #ff6b6b;
    font-size: 12px;
    font-weight: 600;
    width: fit-content;
  }

  .card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 0;
  }

  .error-state {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    color: rgba(239, 68, 68, 0.9);
  }

  .retry-btn {
    margin-left: auto;
    padding: 6px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }

  .retry-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .main-row {
    display: flex;
    gap: 14px;
  }

  /* Left side: thumbnail + info */
  .left {
    display: flex;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .thumb {
    width: 72px;
    height: 72px;
    border-radius: 8px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.04);
  }

  .thumb.empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.2);
  }

  .info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.3;
  }

  .copy-link-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: rgba(255, 255, 255, 0.08);
    border: none;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .copy-link-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.9);
  }

  .meta {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.45);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta .channel-link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    transition: color 0.15s ease;
  }

  .meta .channel-link.clickable {
    cursor: pointer;
  }

  .meta .channel-link.clickable:hover {
    color: var(--accent);
  }

  .meta .channel-link :global(.link-arrow) {
    opacity: 0;
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  .meta .channel-link.clickable:hover :global(.link-arrow) {
    opacity: 1;
    transform: translateX(2px);
  }

  .stats-row {
    display: flex;
    gap: 10px;
    margin-top: 2px;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Right side: selectors */
  .right {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .select-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 160px;
  }

  .select-label {
    font-size: 10px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.4);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Extras */
  .extras-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .subs-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .lang-input {
    width: 80px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: white;
    font-size: 12px;
    font-family: inherit;
  }

  .lang-input:focus {
    outline: none;
    border-color: var(--accent, #6366f1);
  }

  .more-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .more-btn:hover {
    color: white;
    background: rgba(255, 255, 255, 0.06);
  }

  .sponsor-tag {
    padding: 2px 6px;
    background: rgba(0, 212, 170, 0.12);
    border-radius: 4px;
    font-size: 9px;
    font-weight: 600;
    color: rgba(0, 212, 170, 0.8);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* More options panel */
  .more-options {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    animation: slideDown 0.15s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .group-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.4);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .option-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px 16px;
  }

  /* Skeleton */
  .skeleton {
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.08) 50%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 4px;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .title-skel {
    height: 14px;
    width: 90%;
  }

  .meta-skel {
    height: 10px;
    width: 50%;
  }

  .stats-skel {
    display: flex;
    gap: 12px;
    margin-top: 8px;
  }

  .stat-skel {
    height: 12px;
    width: 60px;
    border-radius: 4px;
  }

  .skeleton-inline {
    display: inline-block;
    width: 50px;
    height: 14px;
    border-radius: 4px;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.06) 25%,
      rgba(255, 255, 255, 0.12) 50%,
      rgba(255, 255, 255, 0.06) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  .desc-skel {
    height: 32px;
    width: 100%;
    border-radius: 6px;
    margin-top: 8px;
  }

  .preset-skel {
    height: 32px;
    width: 80px;
    border-radius: 16px;
  }

  /* Mobile / Android layout */
  @media (max-width: 560px) {
    /* Compact layout mobile styles */
    .main-row {
      flex-direction: column;
      gap: 12px;
    }

    .left {
      flex-direction: row;
      gap: 10px;
    }

    .thumb {
      width: 64px;
      height: 64px;
    }

    .right {
      flex-direction: row;
      width: 100%;
    }

    .select-group {
      flex: 1;
      width: auto;
      min-width: 0;
    }

    .extras-row {
      flex-wrap: wrap;
      gap: 6px;
    }

    .more-btn {
      order: 0;
      margin-left: auto;
    }

    .option-grid {
      grid-template-columns: 1fr;
      gap: 6px;
    }

    .subs-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }

    .lang-input {
      width: 100%;
      max-width: 120px;
    }

    /* Full page layout mobile styles - stack vertically */
    .video-header {
      flex-direction: column;
    }

    .video-thumb-container {
      width: 100%;
      max-width: 320px;
    }

    .video-title {
      font-size: 15px;
    }

    .quality-row {
      flex-direction: column;
      gap: 8px;
    }

    .options-row {
      grid-template-columns: 1fr;
    }
  }

  /* Utility classes */
  :global(.rotate-180) {
    transform: rotate(180deg);
  }
</style>
