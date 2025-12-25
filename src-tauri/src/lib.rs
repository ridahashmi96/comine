mod deps;
mod proxy;

#[cfg(not(target_os = "android"))]
use std::process::Stdio;
#[cfg(not(target_os = "android"))]
use tauri::Emitter;
use tauri::AppHandle;
#[cfg(not(target_os = "android"))]
use tauri::Manager;
#[cfg(not(target_os = "android"))]
use tauri::{WebviewWindowBuilder, WebviewUrl};
#[cfg(not(target_os = "android"))]
use std::sync::Mutex;
#[cfg(not(target_os = "android"))]
use std::collections::HashMap;
#[cfg(not(target_os = "android"))]
use image::{GenericImageView, DynamicImage};
#[cfg(not(target_os = "android"))]
use lru::LruCache;
#[cfg(not(target_os = "android"))]
use std::num::NonZeroUsize;

#[cfg(not(target_os = "android"))]
static ACTIVE_DOWNLOADS: std::sync::LazyLock<Mutex<HashMap<String, u32>>> = 
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

#[cfg(not(target_os = "android"))]
static VIDEO_INFO_CACHE: std::sync::LazyLock<Mutex<LruCache<String, VideoInfo>>> = 
    std::sync::LazyLock::new(|| Mutex::new(LruCache::new(NonZeroUsize::new(50).unwrap())));

#[cfg(not(target_os = "android"))]
static PLAYLIST_INFO_CACHE: std::sync::LazyLock<Mutex<LruCache<String, PlaylistInfo>>> = 
    std::sync::LazyLock::new(|| Mutex::new(LruCache::new(NonZeroUsize::new(20).unwrap())));

#[cfg(not(target_os = "android"))]
static YTM_THUMBNAIL_CACHE: std::sync::LazyLock<Mutex<LruCache<String, String>>> = 
    std::sync::LazyLock::new(|| Mutex::new(LruCache::new(NonZeroUsize::new(50).unwrap())));

/// Extension trait to hide console window on Windows
#[cfg(target_os = "windows")]
pub trait CommandExt {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(target_os = "windows")]
impl CommandExt for tokio::process::Command {
    #[allow(unused_imports)]
    fn hide_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt as WinCommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }
}
#[cfg(not(target_os = "android"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(target_os = "android"))]
use tauri::menu::{MenuBuilder, MenuItemBuilder};
#[cfg(not(target_os = "android"))]
use tauri::image::Image;
#[cfg(not(target_os = "android"))]
use tokio::io::{AsyncBufReadExt, BufReader};
#[cfg(not(target_os = "android"))]
use log::{info, error, debug, warn};
#[cfg(target_os = "android")]
use log::info;

/// Get the command to run yt-dlp on the current platform
/// On Android, downloads are handled via the JavaScript bridge to youtubedl-android
#[cfg(not(target_os = "android"))]
fn get_ytdlp_command(app: &AppHandle, proxy_url: Option<&str>) -> Result<(String, Vec<String>, Vec<(String, String)>, Option<String>), String> {
    let ytdlp_path = deps::get_ytdlp_path(app)?;
    if !ytdlp_path.exists() {
        return Err("yt-dlp is not installed. Please install it first.".to_string());
    }
    
    let quickjs_path = deps::get_quickjs_path(app)?;
    let quickjs_option = if quickjs_path.exists() {
        Some(quickjs_path.to_string_lossy().to_string())
    } else {
        None
    };
    
    let bin_dir = ytdlp_path.parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    
    let mut env_vars = vec![];
    
    if !bin_dir.is_empty() {
        let current_path = std::env::var("PATH").unwrap_or_default();
        #[cfg(target_os = "windows")]
        let new_path = format!("{};{}", bin_dir, current_path);
        #[cfg(not(target_os = "windows"))]
        let new_path = format!("{}:{}", bin_dir, current_path);
        
        env_vars.push(("PATH".to_string(), new_path));
    }
    
    // Set proxy environment variables if proxy URL is provided
    if let Some(proxy) = proxy_url {
        if !proxy.is_empty() {
            info!("Setting proxy environment variables for yt-dlp: {}", proxy);
            env_vars.push(("HTTP_PROXY".to_string(), proxy.to_string()));
            env_vars.push(("HTTPS_PROXY".to_string(), proxy.to_string()));
            env_vars.push(("http_proxy".to_string(), proxy.to_string()));
            env_vars.push(("https_proxy".to_string(), proxy.to_string()));
            env_vars.push(("ALL_PROXY".to_string(), proxy.to_string()));
            env_vars.push(("all_proxy".to_string(), proxy.to_string()));
        }
    } else {
        // No explicit proxy provided - check system proxy environment variables
        let proxy_vars = [
            "HTTP_PROXY", "http_proxy",
            "HTTPS_PROXY", "https_proxy",
            "ALL_PROXY", "all_proxy",
            "NO_PROXY", "no_proxy",
        ];
        
        #[allow(unused_variables, unused_mut)]
        let mut found_proxy = false;
        for var in proxy_vars {
            if let Ok(value) = std::env::var(var) {
                if !value.is_empty() {
                    info!("Passing through proxy env var: {}={}", var, value);
                    env_vars.push((var.to_string(), value));
                    #[allow(unused_assignments)]
                    { found_proxy = true; }
                }
            }
        }
        
        #[cfg(target_os = "linux")]
        if !found_proxy {
            if let Some(proxy_url) = detect_linux_system_proxy() {
                info!("Detected Linux system proxy: {}", proxy_url);
                env_vars.push(("http_proxy".to_string(), proxy_url.clone()));
                env_vars.push(("https_proxy".to_string(), proxy_url.clone()));
                env_vars.push(("HTTP_PROXY".to_string(), proxy_url.clone()));
                env_vars.push(("HTTPS_PROXY".to_string(), proxy_url));
            }
        }
    }
    
    // Force UTF-8 (fixes non-ASCII on Windows)
    env_vars.push(("PYTHONIOENCODING".to_string(), "utf-8".to_string()));
    env_vars.push(("PYTHONUTF8".to_string(), "1".to_string()));
    
    Ok((
        ytdlp_path.to_string_lossy().to_string(),
        vec![],
        env_vars,
        quickjs_option,
    ))
}

/// Detect system proxy on Linux
#[cfg(target_os = "linux")]
fn detect_linux_system_proxy() -> Option<String> {
    if let Ok(output) = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.system.proxy", "mode"])
        .output()
    {
        let mode = String::from_utf8_lossy(&output.stdout).trim().trim_matches('\'').to_string();
        if mode == "manual" {
            if let (Ok(host_output), Ok(port_output)) = (
                std::process::Command::new("gsettings")
                    .args(["get", "org.gnome.system.proxy.http", "host"])
                    .output(),
                std::process::Command::new("gsettings")
                    .args(["get", "org.gnome.system.proxy.http", "port"])
                    .output()
            ) {
                let host = String::from_utf8_lossy(&host_output.stdout).trim().trim_matches('\'').to_string();
                let port = String::from_utf8_lossy(&port_output.stdout).trim().to_string();
                if !host.is_empty() && host != "''" && !port.is_empty() && port != "0" {
                    return Some(format!("http://{}:{}", host, port));
                }
            }
            
            if let (Ok(host_output), Ok(port_output)) = (
                std::process::Command::new("gsettings")
                    .args(["get", "org.gnome.system.proxy.socks", "host"])
                    .output(),
                std::process::Command::new("gsettings")
                    .args(["get", "org.gnome.system.proxy.socks", "port"])
                    .output()
            ) {
                let host = String::from_utf8_lossy(&host_output.stdout).trim().trim_matches('\'').to_string();
                let port = String::from_utf8_lossy(&port_output.stdout).trim().to_string();
                if !host.is_empty() && host != "''" && !port.is_empty() && port != "0" {
                    return Some(format!("socks5://{}:{}", host, port));
                }
            }
        }
    }
    
    let common_proxy_ports = [
        (7890, "http"),   // Clash
        (8080, "http"),   // Common HTTP proxy
        (1080, "socks5"), // Common SOCKS5
        (10809, "http"),  // V2Ray HTTP
        (10808, "socks5"), // V2Ray SOCKS
        (2080, "http"),   // Hiddify
        (2081, "socks5"), // Hiddify SOCKS
    ];
    
    for (port, scheme) in common_proxy_ports {
        if check_port_open(port) {
            info!("Found open proxy port: {} ({})", port, scheme);
            return Some(format!("{}://127.0.0.1:{}", scheme, port));
        }
    }
    
    None
}

/// Check if a port is open on localhost
#[cfg(target_os = "linux")]
fn check_port_open(port: u16) -> bool {
    use std::net::TcpStream;
    use std::time::Duration;
    
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(100)
    ).is_ok()
}

#[tauri::command]
#[allow(unused_variables)]
async fn download_video(
    app: AppHandle,
    url: String,
    video_quality: Option<String>,
    download_mode: Option<String>,
    audio_quality: Option<String>,
    convert_to_mp4: Option<bool>,
    remux: Option<bool>,
    clear_metadata: Option<bool>,
    use_aria2: Option<bool>,
    no_playlist: Option<bool>,
    cookies_from_browser: Option<String>,
    custom_cookies: Option<String>,
    download_path: Option<String>,
    embed_thumbnail: Option<bool>,
    cropped_thumbnail_data: Option<String>, // Base64 data URI for YTM cropped thumbnail
    playlist_title: Option<String>, // Playlist title for creating subfolder
    proxy_config: Option<proxy::ProxyConfig>, // Proxy configuration from settings
    window: tauri::Window
) -> Result<String, String> {
    info!("Starting download for URL: {}", url);
    info!("Cookies from browser param: {:?}", cookies_from_browser);
    info!("Custom cookies param: {:?}", custom_cookies.as_ref().map(|s| if s.is_empty() { "empty" } else { "set" }));
    
    #[cfg(target_os = "android")]
    {
        return Err("On Android, use window.AndroidYtDlp.download() from JavaScript".to_string());
    }
    
    #[cfg(not(target_os = "android"))]
    {
        // Resolve proxy URL from config
        let resolved_proxy = proxy_config.as_ref().map(|c| proxy::resolve_proxy(c));
        let proxy_url = resolved_proxy.as_ref().and_then(|r| {
            if r.url.is_empty() { None } else { Some(r.url.as_str()) }
        });
        
        if let Some(ref proxy) = resolved_proxy {
            if !proxy.url.is_empty() {
                info!("Using proxy for download: {} ({})", proxy.url, proxy.source);
            }
        }
        
        let (command, prefix_args, env_vars, quickjs_path) = get_ytdlp_command(&app, proxy_url)?;
        
        debug!("Using command: {} with prefix args: {:?}", command, prefix_args);
        
        let mut downloads_dir = if let Some(ref custom_path) = download_path {
            if !custom_path.is_empty() {
                std::path::PathBuf::from(custom_path)
            } else {
                dirs::download_dir()
                    .ok_or("Could not find Downloads folder")?
            }
        } else {
            dirs::download_dir()
                .ok_or("Could not find Downloads folder")?
        };
        
        if let Some(ref title) = playlist_title {
            if !title.is_empty() {
                let safe_folder_name: String = title
                    .chars()
                    .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
                    .collect::<String>()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(100)
                    .collect();
                if !safe_folder_name.is_empty() {
                    downloads_dir = downloads_dir.join(&safe_folder_name);
                    info!("Using playlist subfolder: {:?}", downloads_dir);
                }
            }
        }
        
        if !downloads_dir.exists() {
            std::fs::create_dir_all(&downloads_dir)
                .map_err(|e| format!("Failed to create download directory: {}", e))?;
            info!("Created download directory: {:?}", downloads_dir);
        }
        
        let download_mode = download_mode.unwrap_or_else(|| "auto".to_string());
        let ext = if download_mode == "audio" { "%(ext)s" } else { "%(ext)s" };
        
        let output_template = downloads_dir
            .join(format!("%(title)s.{}", ext))
            .to_str()
            .ok_or("Invalid path")?
            .to_string();

        info!("Output template: {}", output_template);
        info!("Download mode: {}, Video quality: {:?}, Audio quality: {:?}", 
              download_mode, video_quality, audio_quality);
        
        let download_start_time = std::time::SystemTime::now();

        let mut args: Vec<String> = prefix_args;
        args.extend([
            "--encoding".to_string(), "utf-8".to_string(),
            "-o".to_string(), output_template.clone(),
            "--newline".to_string(),
            "--progress".to_string(),
            "--progress-template".to_string(),
            "%(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s".to_string(),
            "--print".to_string(),
            "after_move:>>>FILEPATH:%(filepath)s".to_string(),
            "--verbose".to_string(),
        ]);
        
        // Add explicit --proxy argument if proxy is configured
        if let Some(proxy) = proxy_url {
            args.extend(["--proxy".to_string(), proxy.to_string()]);
            info!("Using --proxy argument: {}", proxy);
        }
        
        if let Some(ref qjs_path) = quickjs_path {
            args.extend([
                "--js-runtimes".to_string(),
                format!("quickjs:{}", qjs_path),
            ]);
            info!("Using QuickJS runtime: {}", qjs_path);
        }
        
        let video_quality = video_quality.unwrap_or_else(|| "max".to_string());
        let audio_quality = audio_quality.unwrap_or_else(|| "best".to_string());
        
        let format_string = match download_mode.as_str() {
            "audio" => {
                match audio_quality.as_str() {
                    "320" => "bestaudio[abr<=320]/bestaudio/best".to_string(),
                    "256" => "bestaudio[abr<=256]/bestaudio/best".to_string(),
                    "192" => "bestaudio[abr<=192]/bestaudio/best".to_string(),
                    "128" => "bestaudio[abr<=128]/bestaudio/best".to_string(),
                    "96" => "bestaudio[abr<=96]/bestaudio/best".to_string(),
                    _ => "bestaudio/best".to_string(), // "best"
                }
            },
            "mute" => {
                match video_quality.as_str() {
                    "4k" => "bestvideo[height<=2160]/bestvideo/best".to_string(),
                    "1440p" => "bestvideo[height<=1440]/bestvideo/best".to_string(),
                    "1080p" => "bestvideo[height<=1080]/bestvideo/best".to_string(),
                    "720p" => "bestvideo[height<=720]/bestvideo/best".to_string(),
                    "480p" => "bestvideo[height<=480]/bestvideo/best".to_string(),
                    "360p" => "bestvideo[height<=360]/bestvideo/best".to_string(),
                    "240p" => "bestvideo[height<=240]/bestvideo/best".to_string(),
                    _ => "bestvideo/best".to_string(), // "max"
                }
            },
            _ => {
                match video_quality.as_str() {
                    "4k" => "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best".to_string(),
                    "1440p" => "bestvideo[height<=1440]+bestaudio/best[height<=1440]/best".to_string(),
                    "1080p" => "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best".to_string(),
                    "720p" => "bestvideo[height<=720]+bestaudio/best[height<=720]/best".to_string(),
                    "480p" => "bestvideo[height<=480]+bestaudio/best[height<=480]/best".to_string(),
                    "360p" => "bestvideo[height<=360]+bestaudio/best[height<=360]/best".to_string(),
                    "240p" => "bestvideo[height<=240]+bestaudio/best[height<=240]/best".to_string(),
                    _ => "bestvideo+bestaudio/best".to_string(), // "max"
                }
            }
        };
        
        args.extend(["-f".to_string(), format_string.clone()]);
        info!("Using format: {}", format_string);
        
        if download_mode == "audio" {
            args.extend([
                "-x".to_string(), // Extract audio
                "--audio-format".to_string(), "m4a".to_string(),
            ]);
            
            // Cropped YTM thumbnails are embedded manually after download
            let has_cropped_thumbnail = cropped_thumbnail_data.as_ref()
                .map(|d| d.starts_with("data:image/"))
                .unwrap_or(false);
            
            if embed_thumbnail.unwrap_or(false) && !has_cropped_thumbnail {
                args.push("--embed-thumbnail".to_string());
                info!("Embedding thumbnail as cover art (via yt-dlp)");
            } else if embed_thumbnail.unwrap_or(false) && has_cropped_thumbnail {
                info!("Will embed cropped YTM thumbnail manually after download");
            }
            
            info!("Audio-only download with extraction (ffprobe available)");
        }
        
        // remux and convert_to_mp4 are mutually exclusive - convert takes precedence
        if download_mode != "audio" {
            if convert_to_mp4.unwrap_or(false) {
                // Prefer MP4-compatible codecs to minimize re-encoding
                args.extend(["--format-sort".to_string(), "vcodec:h264,acodec:aac".to_string()]);
                args.extend(["--recode-video".to_string(), "mp4".to_string()]);
                info!("Converting to MP4 (with h264/aac preference to minimize re-encoding)");
            } else if remux.unwrap_or(true) {
                args.extend(["--remux-video".to_string(), "mp4".to_string()]);
                info!("Remuxing to MP4 (copy, no re-encode)");
            }
        }
        
        if clear_metadata.unwrap_or(false) {
            args.push("--no-embed-metadata".to_string());
            info!("Clearing metadata");
        }
        
        if no_playlist.unwrap_or(true) {
            args.push("--no-playlist".to_string());
            info!("Using --no-playlist (single video only)");
        }
        
        // Custom cookies take precedence over browser cookies
        let use_custom_cookies = custom_cookies.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
        
        if use_custom_cookies {
            let cookies_text = custom_cookies.as_ref().unwrap();
            let cache_dir = app.path().app_cache_dir()
                .map_err(|e| format!("Failed to get cache dir: {}", e))?;
            let cookies_file = cache_dir.join("custom_cookies.txt");
            
            // Ensure cache dir exists
            tokio::fs::create_dir_all(&cache_dir).await
                .map_err(|e| format!("Failed to create cache dir: {}", e))?;
            
            // Write cookies to file
            tokio::fs::write(&cookies_file, cookies_text).await
                .map_err(|e| format!("Failed to write cookies file: {}", e))?;
            
            args.push("--cookies".to_string());
            args.push(cookies_file.to_string_lossy().to_string());
            info!("Using custom cookies file: {:?}", cookies_file);
        } else if let Some(ref browser) = cookies_from_browser {
            if !browser.is_empty() && browser != "custom" {
                args.push("--cookies-from-browser".to_string());
                args.push(browser.clone());
                info!("Using cookies from browser: {}", browser);
            }
        }
        
        let is_youtube = url.contains("youtube.com") || url.contains("youtu.be");
        if is_youtube {
            // Optimized client chain to avoid PO token and SABR issues
            args.extend([
                "--extractor-args".to_string(),
                "youtube:player_client=tv,mweb,android_sdkless,web".to_string(),
            ]);
            info!("Using optimized player client chain for YouTube (tv,mweb,android_sdkless,web)");
        }
        
        // aria2 doesn't work with YouTube (403 errors)
        if use_aria2.unwrap_or(false) {
            let aria2_path = deps::get_aria2_path(&app)?;
            if aria2_path.exists() {
                let is_youtube = url.contains("youtube.com") || url.contains("youtu.be");
                
                if is_youtube {
                    info!("Skipping aria2 for YouTube (causes 403 errors)");
                } else {
                    info!("Using aria2 as external downloader: {:?}", aria2_path);
                    args.extend([
                        "--downloader".to_string(), 
                        aria2_path.to_string_lossy().to_string(),
                        "--downloader-args".to_string(),
                        "aria2c:-x 8 -s 8 -k 1M --file-allocation=none".to_string(),
                    ]);
                }
            } else {
                info!("aria2 not installed, falling back to default downloader");
            }
        }
        
        args.push(url.clone());

        let mut cmd = tokio::process::Command::new(&command);
        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        
        #[cfg(target_os = "windows")]
        {
            use crate::CommandExt;
            cmd.hide_console();
        }
        
        for (key, value) in &env_vars {
            cmd.env(key, value);
        }
        
        let mut child = cmd.spawn()
            .map_err(|e| {
                error!("Failed to start yt-dlp: {}", e);
                format!("Failed to start yt-dlp: {}", e)
            })?;
        
        let pid = child.id().unwrap_or(0);
        {
            let mut downloads = ACTIVE_DOWNLOADS.lock().unwrap();
            downloads.insert(url.clone(), pid);
            info!("Registered download process {} for URL: {}", pid, url);
        }

        // yt-dlp outputs progress to stderr, --print to stdout
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let mut final_file_path: Option<String> = None;
        let mut stdout_done = false;
        let mut stderr_done = false;
        let mut error_messages: Vec<String> = Vec::new();
        
        let mut last_progress_emit = std::time::Instant::now() - std::time::Duration::from_millis(200);
        const PROGRESS_THROTTLE_MS: u64 = 100;

        while !stdout_done || !stderr_done {
            tokio::select! {
                result = stdout_reader.next_line(), if !stdout_done => {
                    match result {
                        Ok(Some(line)) => {
                            debug!("yt-dlp stdout: {}", line);
                            
                            if line.starts_with(">>>FILEPATH:") {
                                let path = line.trim_start_matches(">>>FILEPATH:");
                                let path_lower = path.to_lowercase();
                                let is_image = path_lower.ends_with(".png") || 
                                               path_lower.ends_with(".jpg") || 
                                               path_lower.ends_with(".jpeg") ||
                                               path_lower.ends_with(".webp");
                                if !is_image {
                                    final_file_path = Some(path.to_string());
                                    info!("Captured file path from --print: {:?}", final_file_path);
                                } else {
                                    debug!("Skipping image file path from --print: {}", path);
                                }
                                continue;
                            }
                            
                            let now = std::time::Instant::now();
                            if now.duration_since(last_progress_emit).as_millis() >= PROGRESS_THROTTLE_MS as u128 {
                                last_progress_emit = now;
                                let _ = window.emit("download-progress", DownloadProgress {
                                    url: url.clone(),
                                    message: line,
                                });
                            }
                        }
                        Ok(None) => stdout_done = true,
                        Err(_) => stdout_done = true,
                    }
                }
                result = stderr_reader.next_line(), if !stderr_done => {
                    match result {
                        Ok(Some(line)) => {
                            warn!("yt-dlp output: {}", line);
                            
                            if line.contains("[Merger] Merging formats into") {
                                if let Some(start) = line.find('"') {
                                    if let Some(end) = line.rfind('"') {
                                        if end > start {
                                            let path = &line[start+1..end];
                                            final_file_path = Some(path.to_string());
                                            info!("Captured file path from Merger: {:?}", final_file_path);
                                        }
                                    }
                                }
                            }
                            
                            if line.contains("[download] Destination:") {
                                if let Some(path) = line.split("Destination:").nth(1) {
                                    let path = path.trim();
                                    let path_lower = path.to_lowercase();
                                    let is_image = path_lower.ends_with(".png") || 
                                                   path_lower.ends_with(".jpg") || 
                                                   path_lower.ends_with(".jpeg") ||
                                                   path_lower.ends_with(".webp");
                                    if final_file_path.is_none() && !path.is_empty() && !is_image {
                                        final_file_path = Some(path.to_string());
                                        info!("Captured file path from Destination: {:?}", final_file_path);
                                    }
                                }
                            }
                            
                            if line.contains("ERROR:") || line.contains("Sign in to confirm") || 
                               line.contains("LOGIN_REQUIRED") || line.contains("age-restricted") ||
                               line.contains("Private video") || line.contains("Video unavailable") ||
                               line.contains("members-only") || line.contains("requires payment") ||
                               line.contains("is not a valid URL") || line.contains("Unsupported URL") {
                                error_messages.push(line.clone());
                            }
                            
                            // Always emit important status messages immediately
                            let is_important = line.contains("[Merger]") || 
                                               line.contains("[ExtractAudio]") ||
                                               line.contains("[EmbedThumbnail]") ||
                                               line.contains("[Metadata]") ||
                                               line.contains("[ffmpeg]") ||
                                               line.contains("[download] Destination:");
                            let now = std::time::Instant::now();
                            if is_important || now.duration_since(last_progress_emit).as_millis() >= PROGRESS_THROTTLE_MS as u128 {
                                last_progress_emit = now;
                                let _ = window.emit("download-progress", DownloadProgress {
                                    url: url.clone(),
                                    message: line,
                                });
                            }
                        }
                        Ok(None) => stderr_done = true,
                        Err(_) => stderr_done = true,
                    }
                }
            }
        }

        info!("Waiting for yt-dlp process to exit...");
        let status = child.wait().await.map_err(|e| {
            error!("Process error: {}", e);
            format!("Process error: {}", e)
        })?;
        
        info!("yt-dlp process exited with status: {:?}", status);

        if status.success() {
            info!("Download completed successfully for: {}", url);
            info!("Captured file path: {:?}", final_file_path);
            
            // Fallback: scan for newly created files if path wasn't captured
            if final_file_path.is_none() || !std::path::Path::new(final_file_path.as_ref().unwrap()).exists() {
                info!("Scanning downloads folder for newly created file...");
                if let Ok(entries) = std::fs::read_dir(&downloads_dir) {
                    let mut newest: Option<(std::path::PathBuf, std::time::SystemTime)> = None;
                    
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if !path.is_file() {
                            continue;
                        }
                        
                        // Skip incomplete and image files
                        if let Some(ext) = path.extension() {
                            let ext_str = ext.to_string_lossy().to_lowercase();
                            if ext_str == "part" || ext_str == "ytdl" || 
                               ext_str == "png" || ext_str == "jpg" || 
                               ext_str == "jpeg" || ext_str == "webp" {
                                continue;
                            }
                        }
                        
                        if let Ok(metadata) = entry.metadata() {
                            if let Ok(created) = metadata.created() {
                                if created >= download_start_time {
                                    if newest.is_none() || created > newest.as_ref().unwrap().1 {
                                        newest = Some((path, created));
                                    }
                                }
                            }
                        }
                    }
                    
                    if let Some((path, _)) = newest {
                        info!("Found newly created file: {:?}", path);
                        final_file_path = Some(path.to_string_lossy().to_string());
                    }
                }
            }
            
            info!("Removing from active downloads map...");
            {
                let mut downloads = ACTIVE_DOWNLOADS.lock().unwrap();
                downloads.remove(&url);
            }
            
            if let Some(ref path) = final_file_path {
                if let Some(ref thumb_data) = cropped_thumbnail_data {
                    if thumb_data.starts_with("data:image/") && embed_thumbnail.unwrap_or(false) {
                        info!("Embedding cropped YTM thumbnail into: {}", path);
                        if let Err(e) = embed_cropped_thumbnail(&app, path, thumb_data).await {
                            warn!("Failed to embed cropped thumbnail: {}", e);
                        } else {
                            info!("Successfully embedded cropped thumbnail");
                        }
                    }
                }
            }
            
            if let Some(ref path) = final_file_path {
                info!("Emitting download-file-path event: {}", path);
                let _ = window.emit("download-file-path", DownloadFilePath {
                    url: url.clone(),
                    file_path: path.clone(),
                });
            } else {
                warn!("No file path captured - download-file-path event not emitted");
            }
            
            let result = final_file_path.unwrap_or_else(|| "Download completed successfully!".to_string());
            info!("Returning download result: {}", result);
            Ok(result)
        } else {
            warn!("yt-dlp exited with non-zero status: {:?}", status);
            warn!("Captured file path before failure: {:?}", final_file_path);
            
            // Non-zero exit might be warnings; trust --print after_move: output
            if let Some(ref path) = final_file_path {
                let file_exists = std::path::Path::new(path).exists();
                info!("Checking if file exists at {:?}: {}", path, file_exists);
                if file_exists {
                    info!("Download completed (with warnings) for: {} - file exists at {:?}", url, path);
                    
                    // Remove from active downloads
                    {
                        let mut downloads = ACTIVE_DOWNLOADS.lock().unwrap();
                        downloads.remove(&url);
                    }
                    
                    // Emit file path
                    let _ = window.emit("download-file-path", DownloadFilePath {
                        url: url.clone(),
                        file_path: path.clone(),
                    });
                    
                    return Ok(path.clone());
                }
            }
            
            // No valid file path from --print, this is a real failure
            // Remove from active downloads
            {
                let mut downloads = ACTIVE_DOWNLOADS.lock().unwrap();
                downloads.remove(&url);
            }
            error!("Download failed for: {}", url);
            
            // Generate helpful error message based on captured errors
            let error_msg = if !error_messages.is_empty() {
                // Check for specific error patterns and provide helpful messages
                let combined = error_messages.join(" ");
                
                if combined.contains("LOGIN_REQUIRED") || combined.contains("Sign in to confirm") {
                    "LOGIN_REQUIRED: This video requires authentication. Please go to Settings and select a browser in the Cookies option to use your logged-in session.".to_string()
                } else if combined.contains("age-restricted") {
                    "AGE_RESTRICTED: This video is age-restricted. Please go to Settings and select a browser in the Cookies option to use your logged-in session.".to_string()
                } else if combined.contains("Private video") {
                    "PRIVATE_VIDEO: This video is private. Make sure you have access and select a browser in the Cookies option in Settings.".to_string()
                } else if combined.contains("members-only") {
                    "MEMBERS_ONLY: This video is for channel members only. Make sure you're a member and select a browser in the Cookies option in Settings.".to_string()
                } else if combined.contains("requires payment") {
                    "PAYMENT_REQUIRED: This video requires payment to watch.".to_string()
                } else if combined.contains("Video unavailable") {
                    "VIDEO_UNAVAILABLE: This video is not available. It may have been removed or restricted in your region.".to_string()
                } else if combined.contains("is not a valid URL") || combined.contains("Unsupported URL") {
                    "INVALID_URL: The URL is not valid or not supported.".to_string()
                } else {
                    // Return the first error message if we don't recognize the pattern
                    format!("Download failed: {}", error_messages.first().unwrap_or(&"Unknown error".to_string()))
                }
            } else {
                "Download failed".to_string()
            };
            
            Err(error_msg)
        }
    }
}

#[cfg(not(target_os = "android"))]
#[derive(serde::Serialize, Clone)]
struct DownloadProgress {
    url: String,
    message: String,
}

#[cfg(not(target_os = "android"))]
#[derive(serde::Serialize, Clone)]
struct DownloadFilePath {
    url: String,
    file_path: String,
}

/// Cancel an active download by URL
#[tauri::command]
#[allow(unused_variables)]
async fn cancel_download(url: String) -> Result<(), String> {
    info!("Cancelling download for URL: {}", url);
    
    #[cfg(target_os = "android")]
    {
        return Err("Cancel not supported on Android".to_string());
    }
    
    #[cfg(not(target_os = "android"))]
    {
        let pid = {
            let downloads = ACTIVE_DOWNLOADS.lock().unwrap();
            downloads.get(&url).copied()
        };
        
        if let Some(pid) = pid {
            info!("Killing process {} for URL: {}", pid, url);
            
            // Kill the process
            #[cfg(target_os = "windows")]
            {
                // On Windows, use taskkill to kill the process tree
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .output();
            }
            
            #[cfg(not(target_os = "windows"))]
            {
                // On Unix, send SIGTERM
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
            
            // Remove from active downloads
            {
                let mut downloads = ACTIVE_DOWNLOADS.lock().unwrap();
                downloads.remove(&url);
            }
            
            Ok(())
        } else {
            Err("Download not found or already completed".to_string())
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct VideoInfo {
    title: String,
    uploader: Option<String>,
    channel: Option<String>,
    creator: Option<String>,  // Some extractors use 'creator' instead of 'uploader'
    uploader_id: Option<String>,  // @username for social media platforms
    thumbnail: Option<String>,
    duration: Option<f64>,
    filesize: Option<u64>,
    ext: Option<String>,
}

/// Single entry in a playlist
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct PlaylistEntry {
    id: String,
    url: String,
    title: String,
    duration: Option<f64>,
    thumbnail: Option<String>,
    uploader: Option<String>,
    is_music: bool, // Hint for YouTube Music tracks
}

/// Playlist information with paginated entries
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct PlaylistInfo {
    is_playlist: bool,
    id: Option<String>,
    title: String,
    uploader: Option<String>,
    thumbnail: Option<String>,
    total_count: usize,
    entries: Vec<PlaylistEntry>,
    has_more: bool,
}

/// Get playlist information with paginated entries
#[tauri::command]
#[allow(unused_variables)]
async fn get_playlist_info(
    app: AppHandle, 
    url: String, 
    offset: Option<usize>,
    limit: Option<usize>,
    cookies_from_browser: Option<String>, 
    custom_cookies: Option<String>,
    proxy_config: Option<proxy::ProxyConfig>
) -> Result<PlaylistInfo, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(50);
    
    info!("Getting playlist info for URL: {} (offset={}, limit={})", url, offset, limit);
    
    #[cfg(target_os = "android")]
    {
        return Err("On Android, use window.AndroidYtDlp.getPlaylistInfo() from JavaScript".to_string());
    }
    
    #[cfg(not(target_os = "android"))]
    {
        // Check cache first for instant response on repeated URLs
        // The cache stores ALL entries, so we can serve any offset/limit from it
        {
            let mut cache = PLAYLIST_INFO_CACHE.lock().unwrap();
            if let Some(cached) = cache.get(&url) {
                info!("Playlist info cache hit for URL: {} (offset={}, limit={})", url, offset, limit);
                info!("Cache contains {} entries, total_count={}", cached.entries.len(), cached.total_count);
                // Apply pagination to cached result
                let paginated_entries: Vec<PlaylistEntry> = cached.entries
                    .iter()
                    .skip(offset)
                    .take(limit)
                    .cloned()
                    .collect();
                let has_more = offset + paginated_entries.len() < cached.total_count;
                info!("Returning {} entries from cache, has_more={}", paginated_entries.len(), has_more);
                
                // Build response without cloning the full cached entries again
                return Ok(PlaylistInfo {
                    is_playlist: cached.is_playlist,
                    id: cached.id.clone(),
                    title: cached.title.clone(),
                    uploader: cached.uploader.clone(),
                    thumbnail: cached.thumbnail.clone(),
                    total_count: cached.total_count,
                    entries: paginated_entries,
                    has_more,
                });
            }
        }
        
        // Resolve proxy configuration
        let resolved_proxy = proxy_config.as_ref().map(|c| proxy::resolve_proxy(c));
        let proxy_url = resolved_proxy.as_ref().and_then(|p| {
            if p.url.is_empty() { None } else { Some(p.url.as_str()) }
        });
        
        let (command, prefix_args, env_vars, quickjs_path) = get_ytdlp_command(&app, proxy_url)?;
        
        let mut args: Vec<String> = prefix_args;
        args.extend([
            // Force UTF-8 encoding for output (fixes Cyrillic/Unicode on Windows)
            "--encoding".to_string(), "utf-8".to_string(),
            "--dump-json".to_string(),
            "--flat-playlist".to_string(),
            "--no-download".to_string(),
        ]);
        
        // Add explicit --proxy argument if proxy is configured
        if let Some(proxy) = proxy_url {
            args.extend(["--proxy".to_string(), proxy.to_string()]);
            info!("Using --proxy argument for playlist info: {}", proxy);
        }
        
        // Add QuickJS runtime path if available
        if let Some(ref qjs_path) = quickjs_path {
            args.extend([
                "--js-runtimes".to_string(),
                format!("quickjs:{}", qjs_path),
            ]);
        }
        
        // Add cookies - prefer custom cookies over browser cookies
        let use_custom_cookies = custom_cookies.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
        
        if use_custom_cookies {
            let cookies_text = custom_cookies.as_ref().unwrap();
            let cache_dir = app.path().app_cache_dir()
                .map_err(|e| format!("Failed to get cache dir: {}", e))?;
            let cookies_file = cache_dir.join("custom_cookies.txt");
            
            tokio::fs::create_dir_all(&cache_dir).await
                .map_err(|e| format!("Failed to create cache dir: {}", e))?;
            
            tokio::fs::write(&cookies_file, cookies_text).await
                .map_err(|e| format!("Failed to write cookies file: {}", e))?;
            
            args.push("--cookies".to_string());
            args.push(cookies_file.to_string_lossy().to_string());
        } else if let Some(ref browser) = cookies_from_browser {
            if !browser.is_empty() && browser != "custom" {
                args.push("--cookies-from-browser".to_string());
                args.push(browser.clone());
            }
        }
        
        // For YouTube URLs, use optimized client chain to bypass SABR/PO Token issues
        let is_youtube = url.contains("youtube.com") || url.contains("youtu.be");
        if is_youtube {
            args.extend([
                "--extractor-args".to_string(),
                "youtube:player_client=tv,mweb,android_sdkless,web".to_string(),
            ]);
        }
        
        args.push(url.clone());

        let mut cmd = tokio::process::Command::new(&command);
        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        
        #[cfg(target_os = "windows")]
        {
            use crate::CommandExt;
            cmd.hide_console();
        }
        
        for (key, value) in &env_vars {
            cmd.env(key, value);
        }
        
        let output = cmd.output().await.map_err(|e| {
            error!("Failed to get playlist info: {}", e);
            format!("Failed to get playlist info: {}", e)
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("yt-dlp error: {}", stderr);
            return Err(format!("Failed to get playlist info: {}", stderr));
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        
        // yt-dlp --flat-playlist --dump-json can output either:
        // 1. A single JSON object with nested entries (for some playlists)
        // 2. Multiple JSON objects, one per line (for other playlists)
        
        // First, try to parse as a single JSON object
        let parse_result: Result<serde_json::Value, _> = serde_json::from_str(&json_str);
        
        let (json, entries_from_lines): (Option<serde_json::Value>, Vec<serde_json::Value>) = match parse_result {
            Ok(single_json) => (Some(single_json), vec![]),
            Err(_) => {
                // Try parsing line by line (NDJSON format)
                let entries: Vec<serde_json::Value> = json_str
                    .lines()
                    .filter(|line| !line.trim().is_empty())
                    .filter_map(|line| serde_json::from_str(line).ok())
                    .collect();
                
                if entries.is_empty() {
                    return Err(format!("Failed to parse playlist info: no valid JSON found"));
                }
                
                (None, entries)
            }
        };
        
        // Determine if it's a playlist and extract entries
        // Track whether we have a true playlist object vs NDJSON format (first entry as metadata)
        let (is_playlist, playlist_json, is_ndjson_format, all_entries) = if let Some(ref single) = json {
            // Single JSON object
            let is_pl = single.get("_type").and_then(|v| v.as_str()) == Some("playlist");
            if is_pl {
                // Playlist with nested entries - this is a TRUE playlist object
                let entries = single["entries"].as_array().cloned().unwrap_or_default();
                (true, Some(single.clone()), false, entries)
            } else {
                // Single video
                (false, Some(single.clone()), false, vec![single.clone()])
            }
        } else {
            // Multiple JSON lines - it's a playlist (NDJSON format)
            // First entry contains playlist metadata embedded in the entry fields
            let first = entries_from_lines.first();
            let is_pl = entries_from_lines.len() > 1 || 
                first.and_then(|f| f.get("_type")).and_then(|v| v.as_str()) == Some("playlist");
            (is_pl, first.cloned(), true, entries_from_lines)
        };
        
        if !is_playlist && all_entries.len() == 1 {
            // Single video - return as a "playlist" with one entry
            let video = &all_entries[0];
            let is_ytm = url.contains("music.youtube.com");
            return Ok(PlaylistInfo {
                is_playlist: false,
                id: video["id"].as_str().map(|s| s.to_string()),
                title: video["title"].as_str().unwrap_or("Unknown").to_string(),
                uploader: video["uploader"].as_str().or(video["channel"].as_str()).map(|s| s.to_string()),
                thumbnail: video["thumbnail"].as_str().map(|s| s.to_string()),
                total_count: 1,
                entries: vec![PlaylistEntry {
                    id: video["id"].as_str().unwrap_or("").to_string(),
                    url: url.clone(),
                    title: video["title"].as_str().unwrap_or("Unknown").to_string(),
                    duration: video["duration"].as_f64(),
                    thumbnail: video["thumbnail"].as_str().map(|s| s.to_string()),
                    uploader: video["uploader"].as_str().map(|s| s.to_string()),
                    is_music: is_ytm,
                }],
                has_more: false,
            });
        }
        
        // It's a playlist - process entries
        let total_count = all_entries.len();
        let is_ytm_playlist = url.contains("music.youtube.com");
        
        // Process ALL entries first (for caching), then paginate for response
        let all_processed_entries: Vec<PlaylistEntry> = all_entries
            .iter()
            .filter_map(|entry| {
                let id = entry["id"].as_str()?.to_string();
                let title = entry["title"].as_str().unwrap_or("Unknown").to_string();
                
                // Detect if entry is likely music (short duration, from YTM, or has music-related tags)
                let duration = entry["duration"].as_f64();
                let is_music = is_ytm_playlist || 
                    duration.map(|d| d < 600.0).unwrap_or(false); // < 10 minutes suggests music
                
                // Construct video URL from ID for YouTube
                let entry_url = if url.contains("youtube.com") || url.contains("youtu.be") {
                    if is_ytm_playlist {
                        format!("https://music.youtube.com/watch?v={}", id)
                    } else {
                        format!("https://www.youtube.com/watch?v={}", id)
                    }
                } else {
                    entry["url"].as_str().unwrap_or("").to_string()
                };
                
                Some(PlaylistEntry {
                    id,
                    url: entry_url,
                    title,
                    duration,
                    thumbnail: entry["thumbnail"].as_str()
                        .or(entry["thumbnails"].as_array().and_then(|t| t.first()).and_then(|t| t["url"].as_str()))
                        .map(|s| s.to_string()),
                    uploader: entry["uploader"].as_str().or(entry["channel"].as_str()).map(|s| s.to_string()),
                    is_music,
                })
            })
            .collect();
        
        // Apply pagination for response
        let paginated_entries: Vec<PlaylistEntry> = all_processed_entries
            .iter()
            .skip(offset)
            .take(limit)
            .cloned()
            .collect();
        
        let has_more = offset + paginated_entries.len() < total_count;
        
        // Get playlist metadata
        // For NDJSON format: each entry has playlist_title, playlist_id fields embedded
        // For single JSON format: the playlist object has the metadata directly (title, id, etc.)
        let playlist_title = if is_ndjson_format {
            // NDJSON format - get playlist_title from first entry (NOT the title field!)
            let first_entry = all_entries.first();
            info!("Using NDJSON format, first entry playlist_title: {:?}, title: {:?}", 
                first_entry.and_then(|e| e["playlist_title"].as_str()),
                first_entry.and_then(|e| e["title"].as_str()));
            first_entry
                .and_then(|e| e["playlist_title"].as_str())
                .map(|s| s.to_string())
        } else if let Some(ref pj) = playlist_json {
            // Single JSON playlist object - get title directly
            info!("Using single JSON format, playlist_json title: {:?}", pj["title"].as_str());
            pj["title"].as_str()
                .map(|s| s.to_string())
        } else {
            None
        };
        
        info!("Final playlist_title: {:?}", playlist_title);
        
        let playlist_id = if is_ndjson_format {
            all_entries.first()
                .and_then(|e| e["playlist_id"].as_str())
                .map(|s| s.to_string())
        } else if let Some(ref pj) = playlist_json {
            pj["id"].as_str().map(|s| s.to_string())
        } else {
            None
        };
        
        let playlist_uploader = if is_ndjson_format {
            all_entries.first()
                .and_then(|e| e["playlist_uploader"].as_str().or(e["channel"].as_str()))
                .map(|s| s.to_string())
        } else if let Some(ref pj) = playlist_json {
            pj["uploader"].as_str().or(pj["channel"].as_str()).map(|s| s.to_string())
        } else {
            None
        };
        
        info!("Returning PlaylistInfo: is_playlist=true, title={:?}, total_count={}", 
            playlist_title.as_ref().unwrap_or(&"Playlist".to_string()), total_count);
        
        let result = PlaylistInfo {
            is_playlist: true,
            id: playlist_id,
            title: playlist_title.unwrap_or_else(|| "Playlist".to_string()),
            uploader: playlist_uploader,
            thumbnail: playlist_json.as_ref()
                .and_then(|m| m["thumbnail"].as_str()
                    .or(m["thumbnails"].as_array().and_then(|t| t.first()).and_then(|t| t["url"].as_str())))
                .map(|s| s.to_string()),
            total_count,
            entries: paginated_entries,
            has_more,
        };
        
        // Cache the full result with ALL entries (not paginated) for subsequent offset requests
        {
            let mut cache = PLAYLIST_INFO_CACHE.lock().unwrap();
            // Store with all entries for cache, pagination is applied when reading from cache
            info!("Caching {} entries (total_count={})", all_processed_entries.len(), total_count);
            let cache_entry = PlaylistInfo {
                entries: all_processed_entries,
                has_more: false, // Cache has all entries
                ..result.clone()
            };
            cache.put(url.clone(), cache_entry);
        }
        
        Ok(result)
    }
}

#[tauri::command]
#[allow(unused_variables)]
async fn get_video_info(
    app: AppHandle, 
    url: String, 
    cookies_from_browser: Option<String>, 
    custom_cookies: Option<String>,
    proxy_config: Option<proxy::ProxyConfig>
) -> Result<VideoInfo, String> {
    info!("Getting video info for URL: {}", url);
    
    #[cfg(target_os = "android")]
    {
        return Err("On Android, use window.AndroidYtDlp.getVideoInfo() from JavaScript".to_string());
    }
    
    #[cfg(not(target_os = "android"))]
    {
        // Check cache first for instant response on repeated URLs
        {
            let mut cache = VIDEO_INFO_CACHE.lock().unwrap();
            if let Some(cached) = cache.get(&url) {
                info!("Video info cache hit for URL: {}", url);
                return Ok(cached.clone());
            }
        }
        
        // Resolve proxy configuration
        let resolved_proxy = proxy_config.as_ref().map(|c| proxy::resolve_proxy(c));
        let proxy_url = resolved_proxy.as_ref().and_then(|p| {
            if p.url.is_empty() { None } else { Some(p.url.as_str()) }
        });
        
        let (command, prefix_args, env_vars, quickjs_path) = get_ytdlp_command(&app, proxy_url)?;
        
        let mut args: Vec<String> = prefix_args;
        // Use separate --print calls for faster metadata extraction (skips format parsing)
        // Each --print outputs on its own line
        args.extend([
            // Force UTF-8 encoding for output (fixes Cyrillic/Unicode on Windows)
            "--encoding".to_string(), "utf-8".to_string(),
            "--print".to_string(), "%(title)s".to_string(),
            "--print".to_string(), "%(uploader)s".to_string(),
            "--print".to_string(), "%(channel)s".to_string(),
            "--print".to_string(), "%(creator)s".to_string(),
            "--print".to_string(), "%(uploader_id)s".to_string(),
            "--print".to_string(), "%(thumbnail)s".to_string(),
            "--print".to_string(), "%(duration)s".to_string(),
            "--no-download".to_string(),
            "--no-playlist".to_string(),
        ]);
        
        // Add explicit --proxy argument if proxy is configured
        if let Some(proxy) = proxy_url {
            args.extend(["--proxy".to_string(), proxy.to_string()]);
            info!("Using --proxy argument for video info: {}", proxy);
        }
        
        // Add QuickJS runtime path if available
        if let Some(ref qjs_path) = quickjs_path {
            args.extend([
                "--js-runtimes".to_string(),
                format!("quickjs:{}", qjs_path),
            ]);
        }
        
        // Add cookies - prefer custom cookies over browser cookies
        let use_custom_cookies = custom_cookies.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
        
        if use_custom_cookies {
            let cookies_text = custom_cookies.as_ref().unwrap();
            let cache_dir = app.path().app_cache_dir()
                .map_err(|e| format!("Failed to get cache dir: {}", e))?;
            let cookies_file = cache_dir.join("custom_cookies.txt");
            
            // Ensure cache dir exists
            tokio::fs::create_dir_all(&cache_dir).await
                .map_err(|e| format!("Failed to create cache dir: {}", e))?;
            
            // Write cookies to file
            tokio::fs::write(&cookies_file, cookies_text).await
                .map_err(|e| format!("Failed to write cookies file: {}", e))?;
            
            args.push("--cookies".to_string());
            args.push(cookies_file.to_string_lossy().to_string());
        } else if let Some(ref browser) = cookies_from_browser {
            if !browser.is_empty() && browser != "custom" {
                args.push("--cookies-from-browser".to_string());
                args.push(browser.clone());
            }
        }
        
        // For YouTube URLs, use optimized client chain to bypass SABR/PO Token issues
        let is_youtube = url.contains("youtube.com") || url.contains("youtu.be");
        if is_youtube {
            args.extend([
                "--extractor-args".to_string(),
                "youtube:player_client=tv,mweb,android_sdkless,web".to_string(),
            ]);
        }
        
        args.push(url.clone());

        let mut cmd = tokio::process::Command::new(&command);
        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        
        #[cfg(target_os = "windows")]
        {
            use crate::CommandExt;
            cmd.hide_console();
        }
        
        for (key, value) in &env_vars {
            cmd.env(key, value);
        }
        
        let output = cmd.output().await.map_err(|e| {
            error!("Failed to get video info: {}", e);
            format!("Failed to get video info: {}", e)
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("yt-dlp error: {}", stderr);
            return Err(format!("Failed to get video info: {}", stderr));
        }

        // Parse the --print output (newline separated: title, uploader, channel, creator, uploader_id, thumbnail, duration)
        let output_str = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = output_str.lines().collect();
        
        let title = lines.get(0).map(|s| s.to_string()).unwrap_or_else(|| "Unknown".to_string());
        let uploader = lines.get(1).and_then(|s| if s.is_empty() || *s == "NA" { None } else { Some(s.to_string()) });
        let channel = lines.get(2).and_then(|s| if s.is_empty() || *s == "NA" { None } else { Some(s.to_string()) });
        let creator = lines.get(3).and_then(|s| if s.is_empty() || *s == "NA" { None } else { Some(s.to_string()) });
        let uploader_id = lines.get(4).and_then(|s| if s.is_empty() || *s == "NA" { None } else { Some(s.to_string()) });
        let thumbnail = lines.get(5).and_then(|s| if s.is_empty() || *s == "NA" { None } else { Some(s.to_string()) });
        let duration = lines.get(6).and_then(|s| s.parse::<f64>().ok());

        let info = VideoInfo {
            title,
            uploader,
            channel,
            creator,
            uploader_id,
            thumbnail,
            duration,
            filesize: None, // Not available with --print (will be fetched during download)
            ext: None,      // Not available with --print (will be determined during download)
        };
        
        // Cache the result
        {
            let mut cache = VIDEO_INFO_CACHE.lock().unwrap();
            cache.put(url.clone(), info.clone());
        }
        
        Ok(info)
    }
}

/// Get media file duration using ffprobe (for already downloaded files)
#[tauri::command]
#[allow(unused_variables)]
async fn get_media_duration(app: AppHandle, file_path: String) -> Result<f64, String> {
    #[cfg(target_os = "android")]
    {
        return Err("get_media_duration not supported on Android".to_string());
    }
    
    #[cfg(not(target_os = "android"))]
    {
        use std::process::Stdio;
        
        // Check if file exists
        if !std::path::Path::new(&file_path).exists() {
            return Err(format!("File not found: {}", file_path));
        }
        
        // Get ffprobe path (bundled with yt-dlp)
        let deps_dir = app.path().app_data_dir()
            .map_err(|e| e.to_string())?
            .join("deps");
        
        let ffprobe_path = if cfg!(target_os = "windows") {
            deps_dir.join("ffprobe.exe")
        } else {
            deps_dir.join("ffprobe")
        };
        
        let ffprobe_cmd = if ffprobe_path.exists() {
            ffprobe_path.to_string_lossy().to_string()
        } else {
            // Fallback to system ffprobe
            "ffprobe".to_string()
        };
        
        // Run ffprobe to get duration
        let mut cmd = tokio::process::Command::new(&ffprobe_cmd);
        cmd.args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &file_path
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        
        #[cfg(target_os = "windows")]
        {
            use crate::CommandExt;
            cmd.hide_console();
        }
        
        let output = cmd.output().await.map_err(|e| {
            format!("Failed to run ffprobe: {}", e)
        })?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ffprobe failed: {}", stderr));
        }
        
        let duration_str = String::from_utf8_lossy(&output.stdout);
        duration_str.trim().parse::<f64>()
            .map_err(|_| format!("Failed to parse duration: {}", duration_str))
    }
}

// ==================== Logs Management ====================

/// Get the logs directory path
#[cfg(not(target_os = "android"))]
fn get_logs_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    
    let logs_dir = app_data_dir.join("logs");
    
    // Create if doesn't exist
    if !logs_dir.exists() {
        std::fs::create_dir_all(&logs_dir)
            .map_err(|e| format!("Failed to create logs dir: {}", e))?;
    }
    
    Ok(logs_dir)
}

/// Get the path for the current session's log file
#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn get_log_file_path(app: AppHandle) -> Result<String, String> {
    let logs_dir = get_logs_dir(&app)?;
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let log_file = logs_dir.join(format!("comine_{}.log", timestamp));
    Ok(log_file.to_string_lossy().to_string())
}

/// Append a log entry to the current session's log file
#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn append_log(_app: AppHandle, session_file: String, entry: String) -> Result<(), String> {
    use std::io::Write;
    
    let path = std::path::Path::new(&session_file);
    
    // Open file in append mode, create if doesn't exist
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;
    
    writeln!(file, "{}", entry)
        .map_err(|e| format!("Failed to write to log file: {}", e))?;
    
    Ok(())
}

/// Clean up old log files, keeping only the last N sessions
#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn cleanup_old_logs(app: AppHandle, keep_sessions: usize) -> Result<usize, String> {
    let logs_dir = get_logs_dir(&app)?;
    
    // Get all log files sorted by modification time (newest first)
    let mut log_files: Vec<_> = std::fs::read_dir(&logs_dir)
        .map_err(|e| format!("Failed to read logs dir: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension()
                .map(|ext| ext == "log")
                .unwrap_or(false)
        })
        .collect();
    
    // Sort by modification time, newest first
    log_files.sort_by(|a, b| {
        let time_a = a.metadata().and_then(|m| m.modified()).ok();
        let time_b = b.metadata().and_then(|m| m.modified()).ok();
        time_b.cmp(&time_a)
    });
    
    // Delete files beyond the keep limit
    let mut deleted = 0;
    for entry in log_files.into_iter().skip(keep_sessions) {
        if std::fs::remove_file(entry.path()).is_ok() {
            deleted += 1;
            info!("Deleted old log file: {:?}", entry.path());
        }
    }
    
    Ok(deleted)
}

/// Open the logs folder in the system file explorer
#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let logs_dir = get_logs_dir(&app)?;
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&logs_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&logs_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&logs_dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    
    Ok(())
}

/// Get the logs directory path as a string
#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn get_logs_folder_path(app: AppHandle) -> Result<String, String> {
    let logs_dir = get_logs_dir(&app)?;
    Ok(logs_dir.to_string_lossy().to_string())
}

// Android stubs for log functions (logging handled differently on mobile)
#[cfg(target_os = "android")]
#[tauri::command]
async fn get_log_file_path(_app: AppHandle) -> Result<String, String> {
    Err("Log files not supported on Android".to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn append_log(_app: AppHandle, _session_file: String, _entry: String) -> Result<(), String> {
    Ok(()) // No-op on Android
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn cleanup_old_logs(_app: AppHandle, _keep_sessions: usize) -> Result<usize, String> {
    Ok(0)
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn open_logs_folder(_app: AppHandle) -> Result<(), String> {
    Err("Not supported on Android".to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn get_logs_folder_path(_app: AppHandle) -> Result<String, String> {
    Err("Not supported on Android".to_string())
}

// ==================== YouTube Music Thumbnail Cropping ====================

/// Check if the left and right bars of an image are solid color (letterboxed)
/// Returns true if the image appears to be a 1:1 thumbnail with solid color bars on sides
#[cfg(not(target_os = "android"))]
fn is_letterboxed_thumbnail(img: &DynamicImage) -> bool {
    let (width, height) = img.dimensions();
    
    // Check if image is wider than tall (16:9 or similar letterboxed format)
    if width <= height {
        return false;
    }
    
    // Calculate expected bar width for a centered square image
    let square_size = height;
    let bar_width = (width - square_size) / 2;
    
    // If bars are too small (< 5% of width), not worth cropping
    if bar_width < (width / 20) {
        return false;
    }
    
    // Use higher tolerance to account for compression artifacts and gradients
    let tolerance: i16 = 45; // Color difference tolerance (increased from 20)
    
    // Sample reference color from center of left bar
    let ref_color = img.get_pixel(bar_width / 2, height / 2);
    
    // Sample fewer points, focusing on areas most likely to be solid
    // (avoid edges where gradients are common)
    let sample_points = [
        // Left bar samples (center region only)
        (bar_width / 3, height / 3),
        (bar_width / 3, height / 2),
        (bar_width / 3, height * 2 / 3),
        (bar_width / 2, height / 3),
        (bar_width / 2, height * 2 / 3),
        // Right bar samples (center region only)
        (width - bar_width / 3, height / 3),
        (width - bar_width / 3, height / 2),
        (width - bar_width / 3, height * 2 / 3),
        (width - bar_width / 2, height / 3),
        (width - bar_width / 2, height * 2 / 3),
    ];
    
    // Count how many samples match - allow some mismatches for gradients
    let mut matches = 0;
    let required_matches = (sample_points.len() * 7) / 10; // Require 70% match
    
    for (x, y) in sample_points {
        let pixel = img.get_pixel(x, y);
        
        // Check if this pixel is similar to reference color
        let diff_r = (pixel[0] as i16 - ref_color[0] as i16).abs();
        let diff_g = (pixel[1] as i16 - ref_color[1] as i16).abs();
        let diff_b = (pixel[2] as i16 - ref_color[2] as i16).abs();
        
        if diff_r <= tolerance && diff_g <= tolerance && diff_b <= tolerance {
            matches += 1;
        }
    }
    
    matches >= required_matches
}

/// Crop a letterboxed thumbnail to its center square
#[cfg(not(target_os = "android"))]
fn crop_to_center_square(img: DynamicImage) -> DynamicImage {
    let (width, height) = img.dimensions();
    let square_size = height;
    let x_offset = (width - square_size) / 2;
    
    img.crop_imm(x_offset, 0, square_size, square_size)
}

/// Process a YouTube Music thumbnail - download, detect letterboxing, crop if needed, return base64
/// Returns a data URI (data:image/jpeg;base64,...) if cropped, or the original URL if not letterboxed
#[tauri::command]
#[allow(unused_variables)]
async fn process_ytm_thumbnail(thumbnail_url: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        // On Android, thumbnail processing is handled via JavaScript bridge
        return Err("Use Android bridge for thumbnail processing".to_string());
    }
    
    #[cfg(not(target_os = "android"))]
    {
        use std::io::Cursor;
        use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
        
        info!("Processing YTM thumbnail: {}", thumbnail_url);
        
        // Check cache first for instant response on repeated URLs
        {
            let mut cache = YTM_THUMBNAIL_CACHE.lock().unwrap();
            if let Some(cached) = cache.get(&thumbnail_url) {
                info!("YTM thumbnail cache hit for URL: {}", thumbnail_url);
                return Ok(cached.clone());
            }
        }
        
        // Download the thumbnail
        let response = reqwest::get(&thumbnail_url).await
            .map_err(|e| format!("Failed to download thumbnail: {}", e))?;
        
        let bytes = response.bytes().await
            .map_err(|e| format!("Failed to read thumbnail bytes: {}", e))?;
        
        debug!("Downloaded thumbnail: {} bytes", bytes.len());
        
        // Load image
        let img = image::load_from_memory(&bytes)
            .map_err(|e| format!("Failed to decode image: {}", e))?;
        
        let (width, height) = img.dimensions();
        debug!("Thumbnail dimensions: {}x{}", width, height);
        
        // Check if it's letterboxed
        if !is_letterboxed_thumbnail(&img) {
            info!("Thumbnail is not letterboxed, returning original URL");
            // Cache that this URL doesn't need cropping
            {
                let mut cache = YTM_THUMBNAIL_CACHE.lock().unwrap();
                cache.put(thumbnail_url.clone(), thumbnail_url.clone());
            }
            return Ok(thumbnail_url);
        }
        
        info!("Detected letterboxed thumbnail, cropping to center square");
        
        // Crop to center square
        let cropped = crop_to_center_square(img);
        let (new_w, new_h) = cropped.dimensions();
        debug!("Cropped thumbnail dimensions: {}x{}", new_w, new_h);
        
        // Encode as JPEG
        let mut jpeg_bytes: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut jpeg_bytes);
        cropped.write_to(&mut cursor, image::ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to encode cropped image: {}", e))?;
        
        // Convert to base64 data URI
        let base64_data = BASE64.encode(&jpeg_bytes);
        let data_uri = format!("data:image/jpeg;base64,{}", base64_data);
        
        info!("Cropped thumbnail: {} bytes -> {} bytes base64", bytes.len(), data_uri.len());
        
        // Cache the result
        {
            let mut cache = YTM_THUMBNAIL_CACHE.lock().unwrap();
            cache.put(thumbnail_url.clone(), data_uri.clone());
        }
        
        Ok(data_uri)
    }
}

/// Embed a cropped thumbnail into an audio file using ffmpeg
/// The thumbnail_data should be a base64 data URI (data:image/jpeg;base64,...)
#[cfg(not(target_os = "android"))]
async fn embed_cropped_thumbnail(app: &AppHandle, audio_path: &str, thumbnail_data: &str) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
    use std::process::Stdio;
    
    // Parse the base64 data URI
    let base64_part = thumbnail_data
        .strip_prefix("data:image/jpeg;base64,")
        .or_else(|| thumbnail_data.strip_prefix("data:image/png;base64,"))
        .ok_or("Invalid thumbnail data URI format")?;
    
    // Decode base64 to bytes
    let image_bytes = BASE64.decode(base64_part)
        .map_err(|e| format!("Failed to decode base64 thumbnail: {}", e))?;
    
    // Save to temp file
    let cache_dir = app.path().app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?;
    tokio::fs::create_dir_all(&cache_dir).await
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    
    let thumb_path = cache_dir.join("cropped_cover.jpg");
    tokio::fs::write(&thumb_path, &image_bytes).await
        .map_err(|e| format!("Failed to write thumbnail file: {}", e))?;
    
    debug!("Saved cropped thumbnail to: {:?}", thumb_path);
    
    // Get ffmpeg path
    let ffmpeg_path = deps::get_ffmpeg_path(app)?;
    if !ffmpeg_path.exists() {
        return Err("FFmpeg not found".to_string());
    }
    
    // Create temp output path
    let audio_path_buf = std::path::PathBuf::from(audio_path);
    let audio_ext = audio_path_buf.extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "mp3".to_string());
    let temp_output = audio_path_buf.with_extension(format!("temp.{}", audio_ext));
    
    // Run ffmpeg to embed thumbnail
    // For mp3: use ID3v2 cover art
    // For m4a/mp4: use MP4 cover art
    let mut cmd = tokio::process::Command::new(&ffmpeg_path);
    cmd.args([
        "-y", // Overwrite output
        "-i", audio_path,
        "-i", thumb_path.to_str().unwrap(),
        "-map", "0:a",
        "-map", "1:v",
        "-c:a", "copy",
        "-c:v", "mjpeg", // Ensure cover is JPEG
    ]);
    
    // Add format-specific options
    if audio_ext == "mp3" {
        cmd.args([
            "-id3v2_version", "3",
            "-metadata:s:v", "title=Album cover",
            "-metadata:s:v", "comment=Cover (front)",
        ]);
    } else {
        cmd.args([
            "-disposition:v:0", "attached_pic",
        ]);
    }
    
    cmd.arg(temp_output.to_str().unwrap());
    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped());
    
    #[cfg(target_os = "windows")]
    {
        use crate::CommandExt;
        cmd.hide_console();
    }
    
    debug!("Running ffmpeg to embed thumbnail...");
    let output = cmd.output().await
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!("FFmpeg stderr: {}", stderr);
        // Clean up temp file
        let _ = tokio::fs::remove_file(&thumb_path).await;
        return Err(format!("FFmpeg failed to embed thumbnail: {}", stderr));
    }
    
    // Replace original with new file
    tokio::fs::rename(&temp_output, audio_path).await
        .map_err(|e| format!("Failed to replace original file: {}", e))?;
    
    // Clean up thumbnail temp file
    let _ = tokio::fs::remove_file(&thumb_path).await;
    
    info!("Successfully embedded cropped thumbnail into: {}", audio_path);
    Ok(())
}

/// Set acrylic/blur effect on the main window
/// On Windows: Uses acrylic effect
/// On Linux/macOS: No-op (acrylic not supported, transparency handled by config)
#[tauri::command]
#[allow(unused_variables)]
async fn set_acrylic(app: AppHandle, enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::utils::config::{WindowEffectsConfig, Color};
        use tauri_utils::WindowEffect;
        
        if let Some(window) = app.get_webview_window("main") {
            if enable {
                let effects_config = WindowEffectsConfig {
                    effects: vec![WindowEffect::Acrylic],
                    state: None,
                    radius: None,
                    color: Some(Color(19, 19, 19, 163)), // #131313a3
                };
                let _ = window.set_effects(Some(effects_config));
            } else {
                let _ = window.set_effects(None::<WindowEffectsConfig>);
            }
        }
    }
    
    // On Linux/macOS, acrylic is not supported - we just silently succeed
    // The window transparency is handled by tauri.conf.json
    
    Ok(())
}

/// Data for creating an OS-level notification window
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct NotificationData {
    pub title: String,
    pub body: String,
    pub thumbnail: Option<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub compact: bool,
    #[serde(default)]
    pub is_playlist: bool,
    // Button labels for i18n
    #[serde(default = "default_download_label")]
    pub download_label: String,
    #[serde(default = "default_dismiss_label")]
    pub dismiss_label: String,
}

fn default_download_label() -> String { "Download".to_string() }
fn default_dismiss_label() -> String { "Dismiss".to_string() }

/// Notification position options
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationPosition {
    TopLeft,
    TopCenter,
    TopRight,
    BottomLeft,
    BottomCenter,
    #[default]
    BottomRight,
}

/// Which monitor to show notification on
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum NotificationMonitor {
    #[default]
    Primary,
    Cursor, // Monitor where cursor is
}

/// Info stored for each notification window
#[cfg(not(target_os = "android"))]
#[derive(Clone, Debug)]
struct NotificationInfo {
    slot: usize,
    position: NotificationPosition,
    width: u32,
    height: u32,
    offset: i32,
    monitor_width: i32,
    monitor_height: i32,
    monitor_x: i32,
    monitor_y: i32,
}

/// Notification position tracking for stacking
#[cfg(not(target_os = "android"))]
struct NotificationManager {
    /// Map of window_id -> notification info
    notifications: HashMap<String, NotificationInfo>,
    /// Track which slots are occupied
    occupied: Vec<bool>,
    /// Debounce: track last creation time to prevent rapid creation issues
    last_creation: std::time::Instant,
}

#[cfg(not(target_os = "android"))]
impl NotificationManager {
    fn new() -> Self {
        Self {
            notifications: HashMap::new(),
            occupied: vec![false; 10], // Support up to 10 stacked notifications
            last_creation: std::time::Instant::now(),
        }
    }
    
    /// Get the next available slot (returns slot index)
    fn allocate_slot(&mut self, window_id: &str, info: NotificationInfo) -> usize {
        // Find first free slot
        let slot = self.occupied.iter().position(|&x| !x).unwrap_or(0);
        self.occupied[slot] = true;
        let mut info = info;
        info.slot = slot;
        self.notifications.insert(window_id.to_string(), info);
        self.last_creation = std::time::Instant::now();
        slot
    }
    
    /// Check if we should debounce (returns true if we need to wait)
    fn should_debounce(&self) -> bool {
        self.last_creation.elapsed() < std::time::Duration::from_millis(100)
    }
    
    /// Free a slot and return windows that need repositioning with their info
    fn free_slot(&mut self, window_id: &str) -> Vec<(String, NotificationInfo)> {
        if let Some(freed_info) = self.notifications.remove(window_id) {
            let freed_slot = freed_info.slot;
            self.occupied[freed_slot] = false;
            
            // Find windows above the freed slot that need to move down
            let mut to_reposition: Vec<(String, NotificationInfo)> = Vec::new();
            
            for (id, info) in &self.notifications {
                if info.slot > freed_slot {
                    let mut new_info = info.clone();
                    new_info.slot = info.slot - 1;
                    to_reposition.push((id.clone(), new_info));
                }
            }
            
            // Update slots for repositioned windows
            for (id, new_info) in &to_reposition {
                if let Some(info) = self.notifications.get_mut(id) {
                    self.occupied[info.slot] = false;
                    info.slot = new_info.slot;
                    self.occupied[new_info.slot] = true;
                }
            }
            
            to_reposition
        } else {
            Vec::new()
        }
    }
}

#[cfg(not(target_os = "android"))]
lazy_static::lazy_static! {
    static ref NOTIFICATION_MANAGER: Mutex<NotificationManager> = Mutex::new(NotificationManager::new());
}

/// Calculate position for notification based on settings
#[cfg(not(target_os = "android"))]
fn calculate_notification_position(
    monitor_width: i32,
    monitor_height: i32,
    monitor_x: i32,
    monitor_y: i32,
    width: u32,
    height: u32,
    margin: i32,
    slot: usize,
    position: &NotificationPosition,
    offset: i32, // User-configurable offset (taskbar height)
) -> (i32, i32) {
    let slot_height = (height as i32) + 8; // notification height + gap between notifications
    
    let x = match position {
        NotificationPosition::TopLeft | NotificationPosition::BottomLeft => {
            monitor_x + margin
        }
        NotificationPosition::TopCenter | NotificationPosition::BottomCenter => {
            monitor_x + (monitor_width / 2) - (width as i32 / 2)
        }
        NotificationPosition::TopRight | NotificationPosition::BottomRight => {
            monitor_x + monitor_width - (width as i32) - margin
        }
    };
    
    let y = match position {
        NotificationPosition::TopLeft | NotificationPosition::TopCenter | NotificationPosition::TopRight => {
            // Stack downward from top
            monitor_y + margin + offset + (slot as i32 * slot_height)
        }
        NotificationPosition::BottomLeft | NotificationPosition::BottomCenter | NotificationPosition::BottomRight => {
            // Stack upward from bottom
            monitor_y + monitor_height - (height as i32) - margin - offset - (slot as i32 * slot_height)
        }
    };
    
    (x, y)
}

/// Show an OS-level notification window (desktop only)
#[tauri::command]
#[allow(unused_variables)]
async fn show_notification_window(
    app: AppHandle, 
    data: NotificationData,
    position: Option<NotificationPosition>,
    monitor: Option<NotificationMonitor>,
    offset: Option<i32>, // User-configurable offset (taskbar height)
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return Err("Notification windows not supported on Android".to_string());
    }
    
    #[cfg(not(target_os = "android"))]
    {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NOTIFICATION_COUNTER: AtomicU32 = AtomicU32::new(0);
        
        // Debounce check - wait if notifications are being created too rapidly
        let should_wait = {
            let manager = NOTIFICATION_MANAGER.lock().unwrap();
            manager.should_debounce()
        };
        
        if should_wait {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        
        let notification_id = NOTIFICATION_COUNTER.fetch_add(1, Ordering::Relaxed);
        let window_label = format!("notification-{}", notification_id);
        
        info!("show_notification_window called with position: {:?}, monitor: {:?}, offset: {:?}", position, monitor, offset);
        
        let position = position.unwrap_or_default();
        let monitor_setting = monitor.unwrap_or_default();
        let offset = offset.unwrap_or(48); // Default 48px taskbar offset
        
        info!("Using position: {:?}, monitor: {:?}, offset: {}", position, monitor_setting, offset);
        
        // Get the appropriate monitor
        let monitors = app.available_monitors().map_err(|e| e.to_string())?;
        
        let target_monitor = match monitor_setting {
            NotificationMonitor::Primary => {
                monitors.into_iter().next()
            }
            NotificationMonitor::Cursor => {
                // Try to get cursor position and find monitor containing it
                // Fallback to primary if we can't determine
                if let Some(main_window) = app.get_webview_window("main") {
                    if let Ok(cursor_pos) = main_window.cursor_position() {
                        monitors.into_iter().find(|m: &tauri::Monitor| {
                            let pos = m.position();
                            let size = m.size();
                            let cx = cursor_pos.x as i32;
                            let cy = cursor_pos.y as i32;
                            cx >= pos.x && cx < pos.x + size.width as i32 &&
                            cy >= pos.y && cy < pos.y + size.height as i32
                        }).or_else(|| app.available_monitors().ok()?.into_iter().next())
                    } else {
                        monitors.into_iter().next()
                    }
                } else {
                    monitors.into_iter().next()
                }
            }
        }.ok_or("No monitor found")?;
        
        let monitor_size = target_monitor.size();
        let monitor_position = target_monitor.position();
        
        // Notification window dimensions - adjust for compact mode
        let width: u32 = if data.compact { 280 } else { 320 };
        let height: u32 = if data.compact { 48 } else { 100 };
        let margin: i32 = 16;
        
        // Create notification info for storage
        let notif_info = NotificationInfo {
            slot: 0, // Will be set by allocate_slot
            position: position.clone(),
            width,
            height,
            offset,
            monitor_width: monitor_size.width as i32,
            monitor_height: monitor_size.height as i32,
            monitor_x: monitor_position.x,
            monitor_y: monitor_position.y,
        };
        
        // Allocate a slot for this notification
        let slot = {
            let mut manager = NOTIFICATION_MANAGER.lock().unwrap();
            manager.allocate_slot(&window_label, notif_info)
        };
        
        // Calculate position based on settings
        let (x, y) = calculate_notification_position(
            monitor_size.width as i32,
            monitor_size.height as i32,
            monitor_position.x,
            monitor_position.y,
            width,
            height,
            margin,
            slot,
            &position,
            offset,
        );
        
        // Encode notification data as query params
        let title_encoded = urlencoding::encode(&data.title);
        let body_encoded = urlencoding::encode(&data.body);
        let thumbnail_encoded = data.thumbnail.as_ref().map(|t| urlencoding::encode(t).to_string()).unwrap_or_default();
        let url_encoded = data.url.as_ref().map(|u| urlencoding::encode(u).to_string()).unwrap_or_default();
        let compact = if data.compact { "1" } else { "0" };
        let is_playlist = if data.is_playlist { "1" } else { "0" };
        let download_label = urlencoding::encode(&data.download_label);
        let dismiss_label = urlencoding::encode(&data.dismiss_label);
        
        let notification_url = format!(
            "/notification?title={}&body={}&thumbnail={}&url={}&window_id={}&compact={}&dl={}&dm={}&is_playlist={}",
            title_encoded, body_encoded, thumbnail_encoded, url_encoded, window_label, compact, download_label, dismiss_label, is_playlist
        );
        
        info!("Creating notification window at ({}, {}) slot {} position {:?}", x, y, slot, position);
        
        // Create the notification window - starts hidden until frontend is ready
        // Using various flags to prevent window managers from resizing/tiling
        let notification_window = WebviewWindowBuilder::new(
            &app,
            &window_label,
            WebviewUrl::App(notification_url.into())
        )
        .title("Comine Notification")
        .inner_size(width as f64, height as f64)
        .min_inner_size(width as f64, height as f64)
        .max_inner_size(width as f64, height as f64)
        .position(x as f64, y as f64)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false)
        .transparent(true)
        .build()
        .map_err(|e| format!("Failed to create notification window: {}", e))?;
        
        // Note on tiling window managers:
        // The combination of skip_taskbar, always_on_top, non-resizable, no-decorations,
        // and fixed min/max sizes should make most tiling WMs treat this as a floating window.
        // Additionally, the window is not focused on creation which further helps.
        // For more aggressive WMs, users may need to configure their WM rules.
        
        info!("Notification window created: {}", window_label);
        
        Ok(())
    }
}

/// Show a notification window (called when frontend is ready)
#[tauri::command]
#[allow(unused_variables)]
async fn reveal_notification_window(app: AppHandle, window_id: String) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        info!("Revealing notification window: {}", window_id);
        if let Some(window) = app.get_webview_window(&window_id) {
            let _ = window.show();
            info!("Notification window revealed");
        } else {
            info!("Window not found for reveal: {}", window_id);
        }
    }
    Ok(())
}

/// Close a notification window
#[tauri::command]
#[allow(unused_variables)]
async fn close_notification_window(app: AppHandle, window_id: String) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        info!("Closing notification: {}", window_id);
        
        // Close the window
        if let Some(window) = app.get_webview_window(&window_id) {
            window.close().map_err(|e| e.to_string())?;
        }
        
        // Free the slot and get windows that need repositioning (with their stored info)
        let to_reposition = {
            let mut manager = NOTIFICATION_MANAGER.lock().unwrap();
            manager.free_slot(&window_id)
        };
        
        // Reposition remaining notifications using their stored info
        let margin: i32 = 16;
        for (id, info) in to_reposition {
            if let Some(window) = app.get_webview_window(&id) {
                let (new_x, new_y) = calculate_notification_position(
                    info.monitor_width,
                    info.monitor_height,
                    info.monitor_x,
                    info.monitor_y,
                    info.width,
                    info.height,
                    margin,
                    info.slot,
                    &info.position,
                    info.offset,
                );
                info!("Repositioning {} to slot {} (y={})", id, info.slot, new_y);
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition { x: new_x, y: new_y }
                ));
            }
        }
    }
    Ok(())
}

/// Close all notification windows
#[tauri::command]
#[allow(unused_variables)]
async fn close_all_notifications(app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        info!("Closing all notification windows");
        
        // Get all notification window IDs
        let window_ids: Vec<String> = {
            let manager = NOTIFICATION_MANAGER.lock().unwrap();
            manager.notifications.keys().cloned().collect()
        };
        
        // Close each notification window
        for window_id in window_ids {
            if let Some(window) = app.get_webview_window(&window_id) {
                let _ = window.close();
            }
            // Free the slot
            let mut manager = NOTIFICATION_MANAGER.lock().unwrap();
            manager.free_slot(&window_id);
        }
    }
    Ok(())
}

/// Handle notification action - start download immediately
#[tauri::command]
#[allow(unused_variables)]
async fn notification_action(
    app: AppHandle, 
    window_id: String, 
    url: Option<String>,
    metadata: Option<serde_json::Value>
) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        info!("Notification action triggered: window_id={}, url={:?}, has_metadata={}", 
              window_id, url, metadata.is_some());
        
        // Emit event to trigger immediate download with the URL and metadata
        if let Some(video_url) = &url {
            // Create payload with both URL and pre-fetched metadata
            let payload = serde_json::json!({
                "url": video_url,
                "metadata": metadata
            });
            
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.emit("notification-start-download", payload);
                info!("Emitted notification-start-download to main window");
            } else {
                // Fallback to global emit
                let _ = app.emit("notification-start-download", payload);
                info!("Emitted notification-start-download globally (main window not found)");
            }
        }
        
        // Close the notification using our close function (handles slot cleanup)
        close_notification_window(app, window_id).await?;
    }
    Ok(())
}

// ==================== Proxy Commands ====================

/// Resolve proxy based on configuration from frontend
/// Returns the effective proxy URL, source, and description
#[tauri::command]
async fn resolve_proxy_config(config: proxy::ProxyConfig) -> Result<proxy::ResolvedProxy, String> {
    info!("Resolving proxy config: mode={}, custom_url={}, fallback={}", 
          config.mode, config.custom_url, config.fallback);
    Ok(proxy::resolve_proxy(&config))
}

/// Validate a proxy URL syntax
#[tauri::command]
async fn validate_proxy_url(url: String) -> Result<(), String> {
    proxy::validate_proxy_url(&url)
}

/// Detect system proxy (for displaying to user)
#[tauri::command]
async fn detect_system_proxy() -> Result<proxy::ResolvedProxy, String> {
    Ok(proxy::detect_system_proxy())
}

/// Check current public IP (to verify proxy is working)
#[tauri::command]
async fn check_ip(proxy_config: Option<proxy::ProxyConfig>) -> Result<IpCheckResult, String> {
    let config = proxy_config.unwrap_or_default();
    let resolved = proxy::resolve_proxy(&config);
    
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(5));
    
    if !resolved.url.is_empty() {
        let proxy = reqwest::Proxy::all(&resolved.url)
            .map_err(|e| format!("Invalid proxy: {}", e))?;
        builder = builder.proxy(proxy);
    } else {
        builder = builder.no_proxy();
    }
    
    let client = builder.build()
        .map_err(|e| format!("Failed to create client: {}", e))?;
    
    // Use ipify API (simple, returns just IP)
    let response = client.get("https://api.ipify.org?format=json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let ip = data["ip"].as_str()
        .ok_or("No IP in response")?
        .to_string();
    
    Ok(IpCheckResult {
        ip,
        proxy_used: !resolved.url.is_empty(),
        proxy_source: resolved.source,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IpCheckResult {
    ip: String,
    proxy_used: bool,
    proxy_source: String,
}

// ==================== File Download Commands ====================

/// Download a file directly (for download manager functionality)
/// Returns the file path on success
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn download_file(
    app: AppHandle,
    window: tauri::Window,
    url: String,
    filename: String,
    download_path: String,
    proxy_config: Option<proxy::ProxyConfig>,
    connections: Option<u32>,
    speed_limit: Option<u64>,
) -> Result<String, String> {
    info!("Starting file download: {} -> {}", url, filename);
    
    // Determine download path
    let base_path = if download_path.is_empty() {
        dirs::download_dir()
            .or_else(dirs::home_dir)
            .ok_or("Could not determine download directory")?
    } else {
        std::path::PathBuf::from(&download_path)
    };
    
    // Sanitize filename
    let safe_filename = filename
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect::<String>();
    
    let dest_path = base_path.join(&safe_filename);
    
    // Ensure parent directory exists
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // Check if aria2c is available
    let aria2_path = deps::get_aria2_path(&app)?;
    let use_aria2 = aria2_path.exists();
    
    if use_aria2 {
        // Use aria2c for multi-connection download
        let connections = connections.unwrap_or(16).min(16).max(1);
        
        let mut cmd = tokio::process::Command::new(&aria2_path);
        
        #[cfg(target_os = "windows")]
        cmd.hide_console();
        
        cmd.arg(&url)
           .arg("-d").arg(base_path.to_string_lossy().to_string())
           .arg("-o").arg(&safe_filename)
           .arg("-x").arg(connections.to_string()) // max connections
           .arg("-s").arg(connections.to_string()) // splits
           .arg("-k").arg("1M") // min split size
           .arg("--continue=true") // resume support
           .arg("--auto-file-renaming=false")
           .arg("--allow-overwrite=true")
           .arg("--console-log-level=warn");
        
        // Add speed limit if specified
        if let Some(limit) = speed_limit {
            if limit > 0 {
                cmd.arg("--max-download-limit").arg(format!("{}K", limit / 1024));
            }
        }
        
        // Add proxy if configured
        if let Some(ref config) = proxy_config {
            let resolved = proxy::resolve_proxy(config);
            if !resolved.url.is_empty() {
                cmd.arg("--all-proxy").arg(&resolved.url);
            }
        }
        
        info!("Running aria2c with {} connections", connections);
        
        let output = cmd.stdout(Stdio::piped())
                       .stderr(Stdio::piped())
                       .output()
                       .await
                       .map_err(|e| format!("Failed to run aria2c: {}", e))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("aria2c failed: {}", stderr);
            return Err(format!("Download failed: {}", stderr));
        }
        
        info!("aria2c download complete: {:?}", dest_path);
    } else {
        // Fallback to simple download with reqwest
        info!("aria2c not available, using reqwest fallback");
        
        let config = proxy_config.unwrap_or_default();
        let resolved = proxy::resolve_proxy(&config);
        
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3600)); // 1 hour timeout
        
        if !resolved.url.is_empty() {
            let proxy = reqwest::Proxy::all(&resolved.url)
                .map_err(|e| format!("Invalid proxy: {}", e))?;
            builder = builder.proxy(proxy);
        }
        
        let client = builder.build()
            .map_err(|e| format!("Failed to create client: {}", e))?;
        
        let response = client.get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;
        
        if !response.status().is_success() {
            return Err(format!("HTTP error: {}", response.status()));
        }
        
        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        
        let mut file = tokio::fs::File::create(&dest_path)
            .await
            .map_err(|e| format!("Failed to create file: {}", e))?;
        
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;
        
        let mut stream = response.bytes_stream();
        let start_time = std::time::Instant::now();
        let mut last_emit = std::time::Instant::now();
        
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Write error: {}", e))?;
            
            downloaded += chunk.len() as u64;
            
            // Emit progress every 100ms
            if last_emit.elapsed().as_millis() >= 100 {
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 { downloaded as f64 / elapsed } else { 0.0 };
                
                let progress = if total_size > 0 {
                    (downloaded as f64 / total_size as f64) * 100.0
                } else {
                    0.0
                };
                
                let _ = window.emit("file-download-progress", serde_json::json!({
                    "url": url,
                    "progress": progress,
                    "downloaded": downloaded,
                    "total": total_size,
                    "speed": speed,
                }));
                
                last_emit = std::time::Instant::now();
            }
        }
        
        file.flush().await.map_err(|e| format!("Flush error: {}", e))?;
        info!("reqwest download complete: {:?}", dest_path);
    }
    
    // Verify file exists
    if !dest_path.exists() {
        return Err("Download failed: file not created".to_string());
    }
    
    Ok(dest_path.to_string_lossy().to_string())
}

/// Check if a URL is a direct file download (HEAD request)
/// Returns file info if it's a downloadable file
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn check_file_url(
    url: String,
    proxy_config: Option<proxy::ProxyConfig>,
) -> Result<FileUrlInfo, String> {
    let config = proxy_config.unwrap_or_default();
    let resolved = proxy::resolve_proxy(&config);
    
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(5));
    
    if !resolved.url.is_empty() {
        let proxy = reqwest::Proxy::all(&resolved.url)
            .map_err(|e| format!("Invalid proxy: {}", e))?;
        builder = builder.proxy(proxy);
    }
    
    let client = builder.build()
        .map_err(|e| format!("Failed to create client: {}", e))?;
    
    let response = client.head(&url)
        .send()
        .await
        .map_err(|e| format!("HEAD request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }
    
    let content_type = response.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    
    let content_length = response.headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    
    let content_disposition = response.headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    
    // Extract filename from Content-Disposition or URL
    let filename = extract_filename_from_headers(&content_disposition, &url);
    
    // Determine if this is a downloadable file (not HTML/text page)
    let is_file = !content_type.starts_with("text/html") 
        && !content_type.starts_with("application/xhtml")
        && (content_length > 0 || !content_type.starts_with("text/"));
    
    Ok(FileUrlInfo {
        is_file,
        filename,
        size: content_length,
        mime_type: content_type,
        supports_resume: response.headers().contains_key("accept-ranges"),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileUrlInfo {
    is_file: bool,
    filename: String,
    size: u64,
    mime_type: String,
    supports_resume: bool,
}

/// Extract filename from Content-Disposition header or URL
#[cfg(not(target_os = "android"))]
fn extract_filename_from_headers(content_disposition: &str, url: &str) -> String {
    // Try Content-Disposition first
    if !content_disposition.is_empty() {
        // filename="example.zip" or filename*=UTF-8''example.zip
        if let Some(start) = content_disposition.find("filename=") {
            let rest = &content_disposition[start + 9..];
            let filename = if rest.starts_with('"') {
                rest[1..].split('"').next().unwrap_or("")
            } else {
                rest.split(';').next().unwrap_or("").trim()
            };
            if !filename.is_empty() {
                return filename.to_string();
            }
        }
    }
    
    // Fall back to URL path
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(segments) = parsed.path_segments() {
            if let Some(last) = segments.last() {
                if !last.is_empty() && last.contains('.') {
                    return urlencoding::decode(last)
                        .unwrap_or_else(|_| std::borrow::Cow::Borrowed(last))
                        .into_owned();
                }
            }
        }
    }
    
    // Default filename
    "download".to_string()
}

// Android stubs for file download commands
#[cfg(target_os = "android")]
#[tauri::command]
async fn download_file(
    _app: AppHandle,
    _window: tauri::Window,
    _url: String,
    _filename: String,
    _download_path: String,
    _proxy_config: Option<proxy::ProxyConfig>,
    _connections: Option<u32>,
    _speed_limit: Option<u64>,
) -> Result<String, String> {
    Err("File downloads are not supported on Android yet".to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn check_file_url(
    _url: String,
    _proxy_config: Option<proxy::ProxyConfig>,
) -> Result<FileUrlInfo, String> {
    Err("File URL checking is not supported on Android yet".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .targets([
                // Send logs to webview (frontend) 
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                // Also log to stdout for dev debugging
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            ])
            .level(log::LevelFilter::Debug)
            .build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            download_video,
            cancel_download,
            get_video_info,
            get_playlist_info,
            get_media_duration,
            process_ytm_thumbnail,
            set_acrylic,
            show_notification_window,
            reveal_notification_window,
            close_notification_window,
            close_all_notifications,
            notification_action,
            get_log_file_path,
            append_log,
            cleanup_old_logs,
            open_logs_folder,
            get_logs_folder_path,
            resolve_proxy_config,
            validate_proxy_url,
            detect_system_proxy,
            check_ip,
            download_file,
            check_file_url,
            deps::check_ytdlp,
            deps::install_ytdlp,
            deps::uninstall_ytdlp,
            deps::get_ytdlp_releases,
            deps::check_ffmpeg,
            deps::install_ffmpeg,
            deps::uninstall_ffmpeg,
            deps::check_aria2,
            deps::install_aria2,
            deps::uninstall_aria2,
            deps::check_deno,
            deps::install_deno,
            deps::uninstall_deno,
            deps::check_quickjs,
            deps::install_quickjs,
            deps::uninstall_quickjs
        ]);

    // Desktop-only: setup tray and close-to-tray behavior
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Handle close button - only for main window, not notifications
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                // Only intercept close for main window
                if label == "main" {
                    // Emit event to frontend to check settings
                    let _ = window.emit("close-requested", ());
                    // Prevent the window from closing - frontend will handle it
                    api.prevent_close();
                }
                // Notification windows can close normally
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(target_os = "android"))]
fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Build tray menu
    let show = MenuItemBuilder::with_id("show", "Show Comine").build(app)?;
    let download = MenuItemBuilder::with_id("download", "Download from clipboard").build(app)?;
    let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    
    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&download)
        .item(&separator)
        .item(&quit)
        .build()?;

    // Load tray icon - prefer PNG on Linux, ICO on Windows
    #[cfg(target_os = "windows")]
    let icon = Image::from_path("icons/icon.ico")
        .or_else(|_| Image::from_path("icons/32x32.png"))
        .unwrap_or_else(|_| Image::from_bytes(include_bytes!("../icons/icon.ico")).expect("Failed to load embedded icon"));
    
    #[cfg(not(target_os = "windows"))]
    let icon = Image::from_path("icons/icon.png")
        .or_else(|_| Image::from_path("icons/32x32.png"))
        .unwrap_or_else(|_| Image::from_bytes(include_bytes!("../icons/32x32.png")).expect("Failed to load embedded icon"));
    
    // Create tray icon
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Comine")
        .menu(&menu)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "download" => {
                    // Emit event to frontend to trigger clipboard download
                    let _ = app.emit("tray-download-clipboard", ());
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Show window on left click
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    
    info!("System tray initialized");
    Ok(())
}
