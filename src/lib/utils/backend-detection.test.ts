import { describe, it, expect } from 'vitest';
import { detectBackendForUrl, isLuxPreferred, getSiteName } from './backend-detection';

describe('detectBackendForUrl', () => {
  describe('Chinese platforms → lux', () => {
    it('returns lux for Bilibili URLs', () => {
      expect(detectBackendForUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('lux');
      expect(detectBackendForUrl('https://b23.tv/abc123')).toBe('lux');
    });

    it('returns lux for Douyin (NOT TikTok)', () => {
      expect(detectBackendForUrl('https://www.douyin.com/video/123')).toBe('lux');
      expect(detectBackendForUrl('https://v.douyin.com/abc')).toBe('lux');
    });

    it('returns lux for Chinese streaming platforms', () => {
      expect(detectBackendForUrl('https://www.iqiyi.com/v_abc.html')).toBe('lux');
      expect(detectBackendForUrl('https://v.youku.com/v_show/id_abc.html')).toBe('lux');
      expect(detectBackendForUrl('https://v.qq.com/x/cover/abc.html')).toBe('lux');
      expect(detectBackendForUrl('https://www.mgtv.com/b/abc/123.html')).toBe('lux');
    });

    it('returns lux for Chinese social platforms', () => {
      expect(detectBackendForUrl('https://weibo.com/tv/show/123')).toBe('lux');
      expect(detectBackendForUrl('https://www.kuaishou.com/short-video/abc')).toBe('lux');
      expect(detectBackendForUrl('https://www.xiaohongshu.com/explore/abc')).toBe('lux');
    });

    it('returns lux for Chinese streaming/gaming sites', () => {
      expect(detectBackendForUrl('https://www.huya.com/abc')).toBe('lux');
      expect(detectBackendForUrl('https://www.douyu.com/abc')).toBe('lux');
      expect(detectBackendForUrl('https://www.acfun.cn/v/ac123')).toBe('lux');
    });
  });

  describe('Western platforms → ytdlp', () => {
    it('returns ytdlp for YouTube URLs', () => {
      expect(detectBackendForUrl('https://www.youtube.com/watch?v=abc123')).toBe('ytdlp');
      expect(detectBackendForUrl('https://youtu.be/abc123')).toBe('ytdlp');
      expect(detectBackendForUrl('https://music.youtube.com/watch?v=abc123')).toBe('ytdlp');
    });

    it('returns ytdlp for TikTok (international, NOT Douyin)', () => {
      expect(detectBackendForUrl('https://www.tiktok.com/@user/video/123')).toBe('ytdlp');
    });

    it('returns ytdlp for social media platforms', () => {
      expect(detectBackendForUrl('https://www.instagram.com/p/abc')).toBe('ytdlp');
      expect(detectBackendForUrl('https://twitter.com/user/status/123')).toBe('ytdlp');
      expect(detectBackendForUrl('https://x.com/user/status/123')).toBe('ytdlp');
      expect(detectBackendForUrl('https://www.facebook.com/video/123')).toBe('ytdlp');
    });

    it('returns ytdlp for Twitch', () => {
      expect(detectBackendForUrl('https://www.twitch.tv/streamer')).toBe('ytdlp');
      expect(detectBackendForUrl('https://clips.twitch.tv/abc')).toBe('ytdlp');
    });

    it('returns ytdlp for other Western video sites', () => {
      expect(detectBackendForUrl('https://vimeo.com/123456')).toBe('ytdlp');
      expect(detectBackendForUrl('https://www.dailymotion.com/video/abc')).toBe('ytdlp');
      expect(detectBackendForUrl('https://www.nicovideo.jp/watch/sm123')).toBe('ytdlp');
    });
  });

  it('returns ytdlp for unknown URLs (default)', () => {
    expect(detectBackendForUrl('https://example.com/video.mp4')).toBe('ytdlp');
    expect(detectBackendForUrl('https://random-site.org/watch')).toBe('ytdlp');
  });

  it('is case insensitive', () => {
    expect(detectBackendForUrl('HTTPS://WWW.BILIBILI.COM/VIDEO/123')).toBe('lux');
    expect(detectBackendForUrl('HTTPS://WWW.YOUTUBE.COM/WATCH?V=ABC')).toBe('ytdlp');
  });
});

describe('isLuxPreferred', () => {
  it('returns true for Chinese platforms', () => {
    expect(isLuxPreferred('https://www.bilibili.com/video/123')).toBe(true);
    expect(isLuxPreferred('https://www.douyin.com/video/123')).toBe(true);
    expect(isLuxPreferred('https://www.iqiyi.com/v_abc.html')).toBe(true);
  });

  it('returns false for Western platforms', () => {
    expect(isLuxPreferred('https://www.youtube.com/watch?v=abc')).toBe(false);
    expect(isLuxPreferred('https://www.tiktok.com/@user/video/123')).toBe(false);
    expect(isLuxPreferred('https://www.instagram.com/p/abc')).toBe(false);
    expect(isLuxPreferred('https://example.com/video')).toBe(false);
  });
});

describe('getSiteName', () => {
  it('returns friendly names for known sites', () => {
    expect(getSiteName('https://www.youtube.com/watch?v=abc')).toBe('YouTube');
    expect(getSiteName('https://www.bilibili.com/video/123')).toBe('Bilibili');
    expect(getSiteName('https://www.tiktok.com/@user/video/123')).toBe('TikTok');
  });

  it('returns hostname for unknown sites', () => {
    expect(getSiteName('https://example.com/video')).toBe('example.com');
  });

  it('returns Unknown for invalid URLs', () => {
    expect(getSiteName('not-a-url')).toBe('Unknown');
  });
});
