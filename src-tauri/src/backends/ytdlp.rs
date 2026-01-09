use crate::backends::{Backend, InfoRequest, PlaylistRequest};
use crate::cache;
use crate::deps;
use crate::proxy;
use crate::types::{PlaylistEntry, PlaylistInfo, VideoFormat, VideoFormats, VideoInfo};
use async_trait::async_trait;
use log::{error, info};
use std::process::Stdio;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use crate::utils::CommandHideConsole;

pub struct YtDlpBackend;

pub struct CommandConfig {
    pub ytdlp_path: String,
    pub prefix_args: Vec<String>,
    pub env_vars: Vec<(String, String)>,
    pub quickjs_path: Option<String>,
}

pub fn get_command(app: &AppHandle, proxy_url: Option<&str>) -> Result<CommandConfig, String> {
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

    let bin_dir = ytdlp_path
        .parent()
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

    Ok(CommandConfig {
        ytdlp_path: ytdlp_path.to_string_lossy().to_string(),
        prefix_args: vec![],
        env_vars,
        quickjs_path: quickjs_option,
    })
}

pub async fn setup_cookies(
    app: &AppHandle,
    args: &mut Vec<String>,
    cookies_from_browser: &Option<String>,
    custom_cookies: &Option<String>,
) -> Result<bool, String> {
    let use_custom_cookies = custom_cookies
        .as_ref()
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    if use_custom_cookies {
        if let Some(cookies_text) = custom_cookies.as_deref() {
            let cache_dir = app
                .path()
                .app_cache_dir()
                .map_err(|e| format!("Failed to get cache dir: {}", e))?;
            let cookies_file = cache_dir.join("custom_cookies.txt");

            tokio::fs::create_dir_all(&cache_dir)
                .await
                .map_err(|e| format!("Failed to create cache dir: {}", e))?;

            tokio::fs::write(&cookies_file, cookies_text)
                .await
                .map_err(|e| format!("Failed to write cookies file: {}", e))?;

            args.push("--cookies".to_string());
            args.push(cookies_file.to_string_lossy().to_string());
            info!("Using custom cookies file: {:?}", cookies_file);
        }
    } else if let Some(ref browser) = cookies_from_browser {
        if !browser.is_empty() && browser != "custom" {
            args.push("--cookies-from-browser".to_string());
            args.push(browser.clone());
            info!("Using cookies from browser: {}", browser);
        }
    }

    Ok(use_custom_cookies)
}

async fn cleanup_custom_cookies(app: &AppHandle) {
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let _ = tokio::fs::remove_file(cache_dir.join("custom_cookies.txt")).await;
    }
}

#[async_trait]
impl Backend for YtDlpBackend {
    async fn get_video_info(
        &self,
        app: &AppHandle,
        request: InfoRequest,
    ) -> Result<VideoInfo, String> {
        if let Some(cached) = cache::get_cached_video_info(&request.url) {
            info!("Video info cache hit for URL: {}", request.url);
            return Ok(cached);
        }

        let resolved_proxy = request.proxy_config.as_ref().map(proxy::resolve_proxy);
        let proxy_url = resolved_proxy.as_ref().and_then(|p| {
            if p.url.is_empty() {
                None
            } else {
                Some(p.url.as_str())
            }
        });

        let config = get_command(app, proxy_url)?;

        let mut args: Vec<String> = config.prefix_args;
        args.extend([
            "--encoding".to_string(),
            "utf-8".to_string(),
            "--print".to_string(),
            "%(title)s".to_string(),
            "--print".to_string(),
            "%(uploader)s".to_string(),
            "--print".to_string(),
            "%(channel)s".to_string(),
            "--print".to_string(),
            "%(creator)s".to_string(),
            "--print".to_string(),
            "%(uploader_id)s".to_string(),
            "--print".to_string(),
            "%(thumbnail)s".to_string(),
            "--print".to_string(),
            "%(duration)s".to_string(),
            "--no-download".to_string(),
            "--no-playlist".to_string(),
        ]);

        if let Some(p) = proxy_url {
            args.extend(["--proxy".to_string(), p.to_string()]);
            info!("Using --proxy argument for video info: {}", p);
        }

        if let Some(ref qjs_path) = config.quickjs_path {
            args.extend(["--js-runtimes".to_string(), format!("quickjs:{}", qjs_path)]);
        }

        let use_custom_cookies = setup_cookies(
            app,
            &mut args,
            &request.cookies_from_browser,
            &request.custom_cookies,
        )
        .await?;

        let is_youtube = request.url.contains("youtube.com") || request.url.contains("youtu.be");
        if is_youtube {
            let player_client = request
                .youtube_player_client
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("android_sdkless");
            args.extend([
                "--extractor-args".to_string(),
                format!("youtube:player_client={}", player_client),
            ]);
        }

        args.push(request.url.clone());

        let mut cmd = tokio::process::Command::new(&config.ytdlp_path);
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        cmd.hide_console();

        for (key, value) in &config.env_vars {
            cmd.env(key, value);
        }

        let output = cmd.output().await.map_err(|e| {
            error!("Failed to get video info: {}", e);
            format!("Failed to get video info: {}", e)
        })?;

        if use_custom_cookies {
            cleanup_custom_cookies(app).await;
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("yt-dlp error: {}", stderr);
            return Err(format!("Failed to get video info: {}", stderr));
        }

        let output_str = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = output_str.lines().collect();

        let parse_field = |idx: usize| -> Option<String> {
            lines.get(idx).and_then(|s| {
                if s.is_empty() || *s == "NA" {
                    None
                } else {
                    Some(s.to_string())
                }
            })
        };

        let info = VideoInfo {
            title: lines
                .first()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown".to_string()),
            uploader: parse_field(1),
            channel: parse_field(2),
            creator: parse_field(3),
            uploader_id: parse_field(4),
            thumbnail: parse_field(5),
            duration: lines.get(6).and_then(|s| s.parse::<f64>().ok()),
            filesize: None,
            ext: None,
        };

        cache::put_video_info(request.url, info.clone());
        Ok(info)
    }

    async fn get_playlist_info(
        &self,
        app: &AppHandle,
        request: PlaylistRequest,
    ) -> Result<PlaylistInfo, String> {
        if let Some(cached) = cache::get_cached_playlist_info(&request.url) {
            info!(
                "Playlist info cache hit for URL: {} (offset={}, limit={})",
                request.url, request.offset, request.limit
            );
            let paginated_entries: Vec<PlaylistEntry> = cached
                .entries
                .iter()
                .skip(request.offset)
                .take(request.limit)
                .cloned()
                .collect();
            let has_more = request.offset + paginated_entries.len() < cached.total_count;

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

        let resolved_proxy = request.proxy_config.as_ref().map(proxy::resolve_proxy);
        let proxy_url = resolved_proxy.as_ref().and_then(|p| {
            if p.url.is_empty() {
                None
            } else {
                Some(p.url.as_str())
            }
        });

        let config = get_command(app, proxy_url)?;

        let mut args: Vec<String> = config.prefix_args;
        args.extend([
            "--encoding".to_string(),
            "utf-8".to_string(),
            "--dump-json".to_string(),
            "--flat-playlist".to_string(),
            "--no-download".to_string(),
        ]);

        if let Some(p) = proxy_url {
            args.extend(["--proxy".to_string(), p.to_string()]);
            info!("Using --proxy argument for playlist info: {}", p);
        }

        if let Some(ref qjs_path) = config.quickjs_path {
            args.extend(["--js-runtimes".to_string(), format!("quickjs:{}", qjs_path)]);
        }

        let use_custom_cookies = setup_cookies(
            app,
            &mut args,
            &request.cookies_from_browser,
            &request.custom_cookies,
        )
        .await?;

        let is_youtube = request.url.contains("youtube.com") || request.url.contains("youtu.be");
        if is_youtube {
            let player_client = request
                .youtube_player_client
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("android_sdkless");
            args.extend([
                "--extractor-args".to_string(),
                format!("youtube:player_client={}", player_client),
            ]);
        }

        args.push(request.url.clone());

        let mut cmd = tokio::process::Command::new(&config.ytdlp_path);
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        cmd.hide_console();

        for (key, value) in &config.env_vars {
            cmd.env(key, value);
        }

        let output = cmd.output().await.map_err(|e| {
            error!("Failed to get playlist info: {}", e);
            format!("Failed to get playlist info: {}", e)
        })?;

        if use_custom_cookies {
            cleanup_custom_cookies(app).await;
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("yt-dlp error: {}", stderr);
            return Err(format!("Failed to get playlist info: {}", stderr));
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        let parse_result: Result<serde_json::Value, _> = serde_json::from_str(&json_str);

        let (json, entries_from_lines): (Option<serde_json::Value>, Vec<serde_json::Value>) =
            match parse_result {
                Ok(single_json) => (Some(single_json), vec![]),
                Err(_) => {
                    let entries: Vec<serde_json::Value> = json_str
                        .lines()
                        .filter(|line| !line.trim().is_empty())
                        .filter_map(|line| serde_json::from_str(line).ok())
                        .collect();

                    if entries.is_empty() {
                        return Err(
                            "Failed to parse playlist info: no valid JSON found".to_string()
                        );
                    }

                    (None, entries)
                }
            };

        let (is_playlist, playlist_json, is_ndjson_format, all_entries) = if let Some(ref single) =
            json
        {
            let is_pl = single.get("_type").and_then(|v| v.as_str()) == Some("playlist");
            if is_pl {
                let entries = single["entries"].as_array().cloned().unwrap_or_default();
                (true, Some(single.clone()), false, entries)
            } else {
                (false, Some(single.clone()), false, vec![single.clone()])
            }
        } else {
            let first = entries_from_lines.first();
            let is_pl = entries_from_lines.len() > 1
                || first.and_then(|f| f.get("_type")).and_then(|v| v.as_str()) == Some("playlist");
            (is_pl, first.cloned(), true, entries_from_lines)
        };

        if !is_playlist && all_entries.len() == 1 {
            let video = &all_entries[0];
            let is_ytm = request.url.contains("music.youtube.com");
            return Ok(PlaylistInfo {
                is_playlist: false,
                id: video["id"].as_str().map(|s| s.to_string()),
                title: video["title"].as_str().unwrap_or("Unknown").to_string(),
                uploader: video["uploader"]
                    .as_str()
                    .or(video["channel"].as_str())
                    .map(|s| s.to_string()),
                thumbnail: video["thumbnail"].as_str().map(|s| s.to_string()),
                total_count: 1,
                entries: vec![PlaylistEntry {
                    id: video["id"].as_str().unwrap_or("").to_string(),
                    url: request.url.clone(),
                    title: video["title"].as_str().unwrap_or("Unknown").to_string(),
                    duration: video["duration"].as_f64(),
                    thumbnail: video["thumbnail"].as_str().map(|s| s.to_string()),
                    uploader: video["uploader"].as_str().map(|s| s.to_string()),
                    is_music: is_ytm,
                }],
                has_more: false,
            });
        }

        let total_count = all_entries.len();
        let is_ytm_playlist = request.url.contains("music.youtube.com");

        let all_processed_entries: Vec<PlaylistEntry> = all_entries
            .iter()
            .filter_map(|entry| {
                let id = entry["id"].as_str()?.to_string();
                let title = entry["title"].as_str().unwrap_or("Unknown").to_string();
                let duration = entry["duration"].as_f64();
                let is_music = is_ytm_playlist || duration.map(|d| d < 600.0).unwrap_or(false);

                let entry_url =
                    if request.url.contains("youtube.com") || request.url.contains("youtu.be") {
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
                    thumbnail: entry["thumbnail"]
                        .as_str()
                        .or(entry["thumbnails"]
                            .as_array()
                            .and_then(|t| t.first())
                            .and_then(|t| t["url"].as_str()))
                        .map(|s| s.to_string()),
                    uploader: entry["uploader"]
                        .as_str()
                        .or(entry["channel"].as_str())
                        .map(|s| s.to_string()),
                    is_music,
                })
            })
            .collect();

        let paginated_entries: Vec<PlaylistEntry> = all_processed_entries
            .iter()
            .skip(request.offset)
            .take(request.limit)
            .cloned()
            .collect();

        let has_more = request.offset + paginated_entries.len() < total_count;

        let playlist_title = if is_ndjson_format {
            all_entries
                .first()
                .and_then(|e| e["playlist_title"].as_str())
                .map(|s| s.to_string())
        } else {
            playlist_json
                .as_ref()
                .and_then(|pj| pj["title"].as_str().map(|s| s.to_string()))
        };

        let playlist_id = if is_ndjson_format {
            all_entries
                .first()
                .and_then(|e| e["playlist_id"].as_str())
                .map(|s| s.to_string())
        } else {
            playlist_json
                .as_ref()
                .and_then(|pj| pj["id"].as_str().map(|s| s.to_string()))
        };

        let playlist_uploader = if is_ndjson_format {
            all_entries
                .first()
                .and_then(|e| e["playlist_uploader"].as_str().or(e["channel"].as_str()))
                .map(|s| s.to_string())
        } else {
            playlist_json.as_ref().and_then(|pj| {
                pj["uploader"]
                    .as_str()
                    .or(pj["channel"].as_str())
                    .map(|s| s.to_string())
            })
        };

        let result = PlaylistInfo {
            is_playlist: true,
            id: playlist_id,
            title: playlist_title.unwrap_or_else(|| "Playlist".to_string()),
            uploader: playlist_uploader,
            thumbnail: playlist_json.as_ref().and_then(|m| {
                m["thumbnail"]
                    .as_str()
                    .or(m["thumbnails"]
                        .as_array()
                        .and_then(|t| t.first())
                        .and_then(|t| t["url"].as_str()))
                    .map(|s| s.to_string())
            }),
            total_count,
            entries: paginated_entries,
            has_more,
        };

        let cache_entry = PlaylistInfo {
            entries: all_processed_entries,
            has_more: false,
            ..result.clone()
        };
        cache::put_playlist_info(request.url, cache_entry);

        Ok(result)
    }

    async fn get_video_formats(
        &self,
        app: &AppHandle,
        request: InfoRequest,
    ) -> Result<VideoFormats, String> {
        if let Some(cached) = cache::get_cached_video_formats(&request.url) {
            info!("Video formats cache hit for URL: {}", request.url);
            return Ok(cached);
        }

        let resolved_proxy = request.proxy_config.as_ref().map(proxy::resolve_proxy);
        let proxy_url = resolved_proxy.as_ref().and_then(|p| {
            if p.url.is_empty() {
                None
            } else {
                Some(p.url.as_str())
            }
        });

        let config = get_command(app, proxy_url)?;

        let mut args: Vec<String> = config.prefix_args;
        args.extend([
            "--encoding".to_string(),
            "utf-8".to_string(),
            "--dump-json".to_string(),
            "--no-download".to_string(),
            "--no-playlist".to_string(),
        ]);

        if let Some(p) = proxy_url {
            args.extend(["--proxy".to_string(), p.to_string()]);
        }

        if let Some(ref qjs_path) = config.quickjs_path {
            args.extend(["--js-runtimes".to_string(), format!("quickjs:{}", qjs_path)]);
        }

        let use_custom_cookies = setup_cookies(
            app,
            &mut args,
            &request.cookies_from_browser,
            &request.custom_cookies,
        )
        .await?;

        let is_youtube = request.url.contains("youtube.com") || request.url.contains("youtu.be");
        if is_youtube {
            let player_client = request
                .youtube_player_client
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("android_sdkless");
            info!("Using YouTube player client for formats: {}", player_client);
            args.extend([
                "--extractor-args".to_string(),
                format!("youtube:player_client={}", player_client),
            ]);
        }

        args.push(request.url.clone());

        info!("Running yt-dlp with args: {:?}", args);

        let mut cmd = tokio::process::Command::new(&config.ytdlp_path);
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        cmd.hide_console();

        for (key, value) in &config.env_vars {
            cmd.env(key, value);
        }

        let output = cmd.output().await.map_err(|e| {
            error!("Failed to get video formats: {}", e);
            format!("Failed to get video formats: {}", e)
        })?;

        if use_custom_cookies {
            cleanup_custom_cookies(app).await;
        }

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("yt-dlp error: {}", stderr);
            return Err(format!("Failed to get video formats: {}", stderr));
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        let json: serde_json::Value =
            serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse JSON: {}", e))?;

        let title = json["title"].as_str().unwrap_or("Unknown").to_string();
        let author = json["uploader"]
            .as_str()
            .or_else(|| json["channel"].as_str())
            .or_else(|| json["artist"].as_str())
            .map(|s| s.strip_suffix(" - Topic").unwrap_or(s).to_string());
        let thumbnail = json["thumbnail"].as_str().map(|s| s.to_string());
        let duration = json["duration"].as_f64();

        let formats_json = json["formats"].as_array().ok_or("No formats found")?;

        let formats: Vec<VideoFormat> = formats_json
            .iter()
            .filter_map(|f| {
                let format_id = f["format_id"].as_str()?.to_string();
                let ext = f["ext"].as_str().unwrap_or("unknown").to_string();

                if ext == "mhtml" || format_id.contains("storyboard") {
                    return None;
                }

                let vcodec = f["vcodec"].as_str().map(|s| s.to_string());
                let acodec = f["acodec"].as_str().map(|s| s.to_string());

                let has_video = vcodec.as_ref().map(|v| v != "none").unwrap_or(false);
                let has_audio = acodec.as_ref().map(|a| a != "none").unwrap_or(false);

                if !has_video && !has_audio {
                    return None;
                }

                let resolution = if has_video {
                    let width = f["width"].as_u64();
                    let height = f["height"].as_u64();
                    match (width, height) {
                        (Some(w), Some(h)) => Some(format!("{}x{}", w, h)),
                        _ => f["resolution"].as_str().map(|s| s.to_string()),
                    }
                } else {
                    Some("audio only".to_string())
                };

                Some(VideoFormat {
                    format_id,
                    ext,
                    resolution,
                    fps: f["fps"].as_f64(),
                    vcodec: if has_video { vcodec } else { None },
                    acodec: if has_audio { acodec } else { None },
                    filesize: f["filesize"].as_u64(),
                    filesize_approx: f["filesize_approx"].as_u64(),
                    tbr: f["tbr"].as_f64(),
                    vbr: f["vbr"].as_f64(),
                    abr: f["abr"].as_f64(),
                    asr: f["asr"].as_u64().map(|v| v as u32),
                    format_note: f["format_note"].as_str().map(|s| s.to_string()),
                    has_video,
                    has_audio,
                    quality: f["quality"].as_f64(),
                })
            })
            .collect();

        info!("Found {} formats for {}", formats.len(), request.url);

        let result = VideoFormats {
            title,
            author,
            thumbnail,
            duration,
            formats,
            view_count: json["view_count"].as_u64(),
            like_count: json["like_count"].as_u64(),
            description: json["description"].as_str().map(|s| s.to_string()),
            upload_date: json["upload_date"].as_str().map(|s| s.to_string()),
            channel_url: json["channel_url"].as_str().map(|s| s.to_string()),
            channel_id: json["channel_id"].as_str().map(|s| s.to_string()),
        };

        cache::put_video_formats(request.url, result.clone());
        Ok(result)
    }
}
