#![allow(dead_code)]

use crate::types::{PlaylistInfo, VideoFormats, VideoInfo};
use crate::utils::lock_or_recover;
use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::{LazyLock, Mutex};

const VIDEO_INFO_CACHE_SIZE: NonZeroUsize = NonZeroUsize::new(5).unwrap();
const PLAYLIST_INFO_CACHE_SIZE: NonZeroUsize = NonZeroUsize::new(3).unwrap();
const VIDEO_FORMATS_CACHE_SIZE: NonZeroUsize = NonZeroUsize::new(5).unwrap();

pub static VIDEO_INFO_CACHE: LazyLock<Mutex<LruCache<String, VideoInfo>>> =
    LazyLock::new(|| Mutex::new(LruCache::new(VIDEO_INFO_CACHE_SIZE)));

pub static PLAYLIST_INFO_CACHE: LazyLock<Mutex<LruCache<String, PlaylistInfo>>> =
    LazyLock::new(|| Mutex::new(LruCache::new(PLAYLIST_INFO_CACHE_SIZE)));

pub static VIDEO_FORMATS_CACHE: LazyLock<Mutex<LruCache<String, VideoFormats>>> =
    LazyLock::new(|| Mutex::new(LruCache::new(VIDEO_FORMATS_CACHE_SIZE)));

pub fn get_cached_video_info(url: &str) -> Option<VideoInfo> {
    let mut cache = lock_or_recover(&VIDEO_INFO_CACHE);
    cache.get(url).cloned()
}

pub fn put_video_info(url: String, info: VideoInfo) {
    let mut cache = lock_or_recover(&VIDEO_INFO_CACHE);
    cache.put(url, info);
}

pub fn get_cached_playlist_info(url: &str) -> Option<PlaylistInfo> {
    let mut cache = lock_or_recover(&PLAYLIST_INFO_CACHE);
    cache.get(url).cloned()
}

pub fn put_playlist_info(url: String, info: PlaylistInfo) {
    let mut cache = lock_or_recover(&PLAYLIST_INFO_CACHE);
    cache.put(url, info);
}

pub fn get_cached_video_formats(url: &str) -> Option<VideoFormats> {
    let mut cache = lock_or_recover(&VIDEO_FORMATS_CACHE);
    cache.get(url).cloned()
}

pub fn put_video_formats(url: String, formats: VideoFormats) {
    let mut cache = lock_or_recover(&VIDEO_FORMATS_CACHE);
    cache.put(url, formats);
}

#[derive(serde::Serialize)]
pub struct MemoryCacheStats {
    pub video_info_count: usize,
    pub video_info_capacity: usize,
    pub playlist_info_count: usize,
    pub playlist_info_capacity: usize,
    pub video_formats_count: usize,
    pub video_formats_capacity: usize,
}

pub fn get_stats() -> MemoryCacheStats {
    let video_info = lock_or_recover(&VIDEO_INFO_CACHE);
    let playlist_info = lock_or_recover(&PLAYLIST_INFO_CACHE);
    let video_formats = lock_or_recover(&VIDEO_FORMATS_CACHE);

    MemoryCacheStats {
        video_info_count: video_info.len(),
        video_info_capacity: video_info.cap().get(),
        playlist_info_count: playlist_info.len(),
        playlist_info_capacity: playlist_info.cap().get(),
        video_formats_count: video_formats.len(),
        video_formats_capacity: video_formats.cap().get(),
    }
}

pub fn clear_all() {
    let mut video_info = lock_or_recover(&VIDEO_INFO_CACHE);
    let mut playlist_info = lock_or_recover(&PLAYLIST_INFO_CACHE);
    let mut video_formats = lock_or_recover(&VIDEO_FORMATS_CACHE);

    video_info.clear();
    playlist_info.clear();
    video_formats.clear();
}
