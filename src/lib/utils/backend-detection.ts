export type BackendId = 'ytdlp' | 'lux';

const LUX_PREFERRED_SITES: RegExp[] = [
  /bilibili\.com/i,
  /b23\.tv/i,
  /douyin\.com/i,
  /iesdouyin\.com/i,
  /iqiyi\.com/i,
  /youku\.com/i,
  /tudou\.com/i,
  /v\.qq\.com/i,
  /mgtv\.com/i,
  /(?:^|[./])le\.com/i,
  /weibo\.com/i,
  /kuaishou\.com/i,
  /xiaohongshu\.com/i,
  /xhslink\.com/i,
  /huya\.com/i,
  /douyu\.com/i,
  /acfun\.cn/i,
  /yinyuetai\.com/i,
  /tangdou\.com/i,
  /missevan\.com/i,
  /pearvideo\.com/i,
  /ixigua\.com/i,
];

export function detectBackendForUrl(url: string): BackendId {
  const normalizedUrl = url.toLowerCase().trim();

  for (const pattern of LUX_PREFERRED_SITES) {
    if (pattern.test(normalizedUrl)) {
      return 'lux';
    }
  }

  return 'ytdlp';
}

export function isLuxPreferred(url: string): boolean {
  const normalizedUrl = url.toLowerCase().trim();
  return LUX_PREFERRED_SITES.some((pattern) => pattern.test(normalizedUrl));
}

export function getSiteName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');

    const siteNames: Record<string, string> = {
      'bilibili.com': 'Bilibili',
      'b23.tv': 'Bilibili',
      'douyin.com': 'Douyin',
      'tiktok.com': 'TikTok',
      'youtube.com': 'YouTube',
      'youtu.be': 'YouTube',
      'music.youtube.com': 'YouTube Music',
      'twitter.com': 'Twitter',
      'x.com': 'X',
      'instagram.com': 'Instagram',
      'facebook.com': 'Facebook',
      'weibo.com': 'Weibo',
      'iqiyi.com': 'iQIYI',
      'youku.com': 'Youku',
      'qq.com': 'Tencent Video',
      'v.qq.com': 'Tencent Video',
      'xiaohongshu.com': 'Xiaohongshu',
      'kuaishou.com': 'Kuaishou',
      'nicovideo.jp': 'Niconico',
      'twitch.tv': 'Twitch',
      'vimeo.com': 'Vimeo',
    };

    return siteNames[hostname] || hostname;
  } catch {
    return 'Unknown';
  }
}
