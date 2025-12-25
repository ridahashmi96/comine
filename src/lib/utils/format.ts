import { get } from 'svelte/store';
import { settings } from '$lib/stores/settings';

/**
 * Format bytes to human readable string
 * Uses settings to determine binary (KiB/MiB) or decimal (kB/MB) units
 */
export function formatSize(bytes: number): string {
  const { sizeUnit } = get(settings);
  const base = sizeUnit === 'binary' ? 1024 : 1000;
  const units = sizeUnit === 'binary' 
    ? ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    : ['B', 'kB', 'MB', 'GB', 'TB'];
  
  if (bytes === 0) return '0 B';
  
  const i = Math.floor(Math.log(bytes) / Math.log(base));
  const size = bytes / Math.pow(base, i);
  
  // Show more precision for smaller values
  const decimals = i === 0 ? 0 : (size < 10 ? 2 : 1);
  
  return `${size.toFixed(decimals)} ${units[i]}`;
}

/**
 * Format speed (bytes per second) to human readable string
 */
export function formatSpeed(bytesPerSecond: number): string {
  const { sizeUnit } = get(settings);
  const base = sizeUnit === 'binary' ? 1024 : 1000;
  const units = sizeUnit === 'binary'
    ? ['B/s', 'KiB/s', 'MiB/s', 'GiB/s']
    : ['B/s', 'kB/s', 'MB/s', 'GB/s'];
  
  if (bytesPerSecond === 0) return '0 B/s';
  
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(base));
  const speed = bytesPerSecond / Math.pow(base, i);
  
  const decimals = speed < 10 ? 2 : 1;
  
  return `${speed.toFixed(decimals)} ${units[Math.min(i, units.length - 1)]}`;
}

/**
 * Format duration in seconds to human readable string
 * Returns '--:--' for null/undefined, 'Live' for 0 or negative (live streams)
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '--:--';
  if (seconds <= 0) return 'Live';
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Truncate a title to a maximum length, adding ellipsis if needed
 * Useful for social media captions (Twitter, TikTok, Instagram) that can be very long
 */
export function truncateTitle(title: string, maxLength: number = 150): string {
  if (!title) return '';
  if (title.length <= maxLength) return title;
  
  // Try to break at a word boundary
  const truncated = title.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > maxLength * 0.7) {
    // Break at word boundary if it's not too far back
    return truncated.slice(0, lastSpace) + '…';
  }
  
  return truncated + '…';
}

/**
 * Calculate ETA based on downloaded bytes, total bytes, and speed
 */
export function calculateETA(downloaded: number, total: number, speed: number): string {
  if (speed <= 0 || downloaded >= total) return '--:--';
  
  const remaining = total - downloaded;
  const seconds = remaining / speed;
  
  return formatDuration(seconds);
}

/**
 * Check if a URL is likely a playlist or multi-video collection
 * Works across all major platforms supported by yt-dlp
 */
export function isLikelyPlaylist(urlStr: string): boolean {
  try {
    const urlObj = new URL(urlStr);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();
    
    // YouTube playlists
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return urlObj.searchParams.has('list');
    }
    
    // TikTok user profiles (all videos from a user)
    if (hostname.includes('tiktok.com')) {
      // User profiles: /@username (not individual videos which have /video/)
      if (pathname.match(/^\/@[\w.-]+\/?$/) && !pathname.includes('/video/')) {
        return true;
      }
    }
    
    // Instagram user profiles, highlights, or saved collections
    if (hostname.includes('instagram.com')) {
      // User profiles: /username/ (no /p/, /reel/, /stories/ suffix)
      if (pathname.match(/^\/[\w.-]+\/?$/) && !pathname.match(/^\/(p|reel|stories|tv)\//)) {
        return true;
      }
      // Highlights
      if (pathname.includes('/highlights/')) return true;
    }
    
    // Twitter/X user media tabs
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      // User media: /username/media
      if (pathname.includes('/media')) return true;
      // Likes: /username/likes
      if (pathname.includes('/likes')) return true;
    }
    
    // SoundCloud
    if (hostname.includes('soundcloud.com')) {
      // Sets/playlists
      if (pathname.includes('/sets/')) return true;
      // User likes: /username/likes
      if (pathname.includes('/likes')) return true;
      // User reposts: /username/reposts
      if (pathname.includes('/reposts')) return true;
      // User tracks (all tracks from user): just /username without /track-name
      if (pathname.match(/^\/[\w-]+\/?$/) && !pathname.includes('/tracks/')) {
        return true;
      }
    }
    
    // Vimeo showcases/albums/channels
    if (hostname.includes('vimeo.com')) {
      if (pathname.includes('/album/')) return true;
      if (pathname.includes('/showcase/')) return true;
      if (pathname.includes('/channels/')) return true;
    }
    
    // Twitch collections/videos
    if (hostname.includes('twitch.tv')) {
      if (pathname.includes('/videos')) return true;
      if (pathname.includes('/collections/')) return true;
    }
    
    // Bandcamp albums
    if (hostname.includes('bandcamp.com')) {
      if (pathname.includes('/album/')) return true;
    }
    
    // Common generic patterns (used by many sites)
    if (/\/playlist\b/i.test(pathname)) return true;
    if (/\/album\b/i.test(pathname)) return true;
    if (/\/sets?\b/i.test(pathname)) return true;
    if (/\/collection\b/i.test(pathname)) return true;
    if (/\/channel\b/i.test(pathname)) return true;
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a URL matches configured media URL patterns
 */
export function isValidMediaUrl(text: string, patterns: string[]): boolean {
  try {
    const urlObj = new URL(text);
    if (!['http:', 'https:'].includes(urlObj.protocol)) return false;
    
    return patterns.some(pattern => urlObj.hostname.includes(pattern));
  } catch {
    return false;
  }
}

/**
 * Extract a quick thumbnail URL from a video URL (YouTube only)
 * Returns null for non-YouTube URLs - caller should wait for yt-dlp metadata
 * This allows showing YouTube thumbnails immediately without waiting for yt-dlp
 */
export function getQuickThumbnail(urlStr: string): string | null {
  try {
    const urlObj = new URL(urlStr);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Only generate quick thumbnails for YouTube - other platforms need yt-dlp
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be') || hostname.includes('music.youtube.com')) {
      // Match youtube.com/watch?v=ID or youtu.be/ID patterns
      const ytMatch = urlStr.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (ytMatch) {
        const videoId = ytMatch[1];
        return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
      }
      // YouTube Music
      const ytmMatch = urlStr.match(/music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
      if (ytmMatch) {
        const videoId = ytmMatch[1];
        return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
      }
    }
    
    // For all other platforms (Twitter, TikTok, Instagram, Vimeo, etc.)
    // return null - the thumbnail will be fetched via yt-dlp metadata
    return null;
  } catch {
    return null;
  }
}

/**
 * @deprecated Use getQuickThumbnail instead - renamed for clarity
 */
export function getQuickYouTubeThumbnail(urlStr: string): string | null {
  return getQuickThumbnail(urlStr);
}

/**
 * Clean a URL by removing tracking parameters and normalizing
 * Supports multiple platforms: YouTube, Twitter/X, Instagram, TikTok, etc.
 */
export function cleanUrl(url: string, options?: { ignoreMixes?: boolean }): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    // YouTube-specific cleaning
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be') || hostname.includes('music.youtube.com')) {
      // Remove tracking params
      parsed.searchParams.delete('si');  // Share identifier (tracking)
      parsed.searchParams.delete('feature');  // Feature tracking
      parsed.searchParams.delete('pp');  // Recommendation tracking
      
      // Remove mixes (auto-generated playlists) if option enabled
      // Mixes start with RD (Radio), real playlists start with PL, OL, etc.
      if (options?.ignoreMixes) {
        const list = parsed.searchParams.get('list');
        if (list && (list.startsWith('RD') || list.startsWith('RDMM') || list.startsWith('RDAMVM') || list.startsWith('RDGMEM'))) {
          parsed.searchParams.delete('list');
          parsed.searchParams.delete('index');
          parsed.searchParams.delete('start_radio');
        }
      }
    }
    
    // Twitter/X-specific cleaning
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      parsed.searchParams.delete('s');  // Share source
      parsed.searchParams.delete('t');  // Share token
      parsed.searchParams.delete('ref_src');  // Referral source
      parsed.searchParams.delete('ref_url');  // Referral URL
      parsed.searchParams.delete('src');  // Source
    }
    
    // Instagram-specific cleaning
    if (hostname.includes('instagram.com')) {
      parsed.searchParams.delete('igshid');  // Instagram share ID
      parsed.searchParams.delete('igsh');    // Short share ID
      parsed.searchParams.delete('img_index');
    }
    
    // TikTok-specific cleaning
    if (hostname.includes('tiktok.com')) {
      parsed.searchParams.delete('is_copy_url');
      parsed.searchParams.delete('is_from_webapp');
      parsed.searchParams.delete('sender_device');
      parsed.searchParams.delete('sender_web_id');
      parsed.searchParams.delete('_r');
      parsed.searchParams.delete('_t');
      parsed.searchParams.delete('checksum');
      parsed.searchParams.delete('tt_from');
      parsed.searchParams.delete('share_item_id');
      parsed.searchParams.delete('share_app_id');
    }
    
    // SoundCloud-specific cleaning
    if (hostname.includes('soundcloud.com')) {
      parsed.searchParams.delete('si');
      parsed.searchParams.delete('ref');
    }
    
    // Reddit-specific cleaning
    if (hostname.includes('reddit.com')) {
      parsed.searchParams.delete('share_id');
      parsed.searchParams.delete('utm_name');
    }
    
    // General tracking params to remove (works across all sites)
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'dclid', 'msclkid', 'twclid',
      '_ga', '_gl', 'mc_eid', 'mc_cid',
      'oly_enc_id', 'oly_anon_id',
      '__twitter_impression', '__cft__', '__tn__'
    ];
    trackingParams.forEach(param => parsed.searchParams.delete(param));
    
    return parsed.toString();
  } catch {
    return url; // Return original if parsing fails
  }
}

// Common file extensions to detect for direct downloads
const FILE_EXTENSIONS = [
  // Archives
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2',
  // Applications
  'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'jar', 'apk', 'ipa',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'psd',
  // Media
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'm4v',
  // Other
  'iso', 'img', 'bin', 'torrent', 'rom', 'nsp', 'xci'
];

/**
 * Check if a URL points to a direct file download (not a media platform)
 * Returns the detected filename if it's a file URL, null otherwise
 */
export function isDirectFileUrl(text: string): { isFile: boolean; filename: string | null } {
  try {
    const url = new URL(text);
    // Must be http/https
    if (!url.protocol.startsWith('http')) return { isFile: false, filename: null };
    
    // Helper to check if a string ends with a file extension
    const getFileExtension = (str: string): string | null => {
      const ext = str.split('.').pop()?.toLowerCase();
      return ext && FILE_EXTENSIONS.includes(ext) ? ext : null;
    };
    
    // 1. Check pathname's last segment
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      const pathFilename = decodeURIComponent(pathParts[pathParts.length - 1]);
      if (getFileExtension(pathFilename)) {
        return { isFile: true, filename: pathFilename };
      }
    }
    
    // 2. Check query parameters for filename hints (GitHub releases, CDNs, etc.)
    // Check 'filename' parameter
    const filenameParam = url.searchParams.get('filename');
    if (filenameParam && getFileExtension(filenameParam)) {
      return { isFile: true, filename: filenameParam };
    }
    
    // Check 'response-content-disposition' parameter (S3-style URLs)
    const rcdParam = url.searchParams.get('response-content-disposition');
    if (rcdParam) {
      const filenameMatch = rcdParam.match(/filename[*]?=["']?([^"';\s]+)/i);
      if (filenameMatch) {
        const fn = decodeURIComponent(filenameMatch[1]);
        if (getFileExtension(fn)) {
          return { isFile: true, filename: fn };
        }
      }
    }
    
    // Check 'rscd' parameter (Azure CDN style, used by GitHub releases)
    const rscdParam = url.searchParams.get('rscd');
    if (rscdParam) {
      const filenameMatch = rscdParam.match(/filename[*]?=["']?([^"';\s]+)/i);
      if (filenameMatch) {
        const fn = decodeURIComponent(filenameMatch[1]);
        if (getFileExtension(fn)) {
          return { isFile: true, filename: fn };
        }
      }
    }
    
    return { isFile: false, filename: null };
  } catch {
    return { isFile: false, filename: null };
  }
}
