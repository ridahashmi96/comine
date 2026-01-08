mod lux;
mod ytdlp;

use crate::proxy::ProxyConfig;
use crate::types::{PlaylistInfo, VideoFormats, VideoInfo};
use async_trait::async_trait;
use tauri::AppHandle;

pub use lux::{LuxBackend, LuxDownloadRequest};
pub use ytdlp::{get_command, YtDlpBackend};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum BackendKind {
    #[default]
    YtDlp,
    Lux,
}

impl BackendKind {
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "lux" => BackendKind::Lux,
            _ => BackendKind::YtDlp,
        }
    }
}

#[derive(Debug, Clone)]
pub struct InfoRequest {
    pub url: String,
    pub cookies_from_browser: Option<String>,
    pub custom_cookies: Option<String>,
    pub proxy_config: Option<ProxyConfig>,
    pub youtube_player_client: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlaylistRequest {
    pub url: String,
    pub offset: usize,
    pub limit: usize,
    pub cookies_from_browser: Option<String>,
    pub custom_cookies: Option<String>,
    pub proxy_config: Option<ProxyConfig>,
    pub youtube_player_client: Option<String>,
}

#[async_trait]
pub trait Backend: Send + Sync {
    async fn get_video_info(
        &self,
        app: &AppHandle,
        request: InfoRequest,
    ) -> Result<VideoInfo, String>;

    async fn get_playlist_info(
        &self,
        app: &AppHandle,
        request: PlaylistRequest,
    ) -> Result<PlaylistInfo, String>;

    async fn get_video_formats(
        &self,
        app: &AppHandle,
        request: InfoRequest,
    ) -> Result<VideoFormats, String>;
}
