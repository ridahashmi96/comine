package com.nichind.comine

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.NotificationCompat
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import com.yausername.ffmpeg.FFmpeg
import com.yausername.aria2c.Aria2c
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

class MainActivity : TauriActivity() {
  companion object {
    private const val TAG = "Comine"
    private const val DOWNLOAD_CHANNEL_ID = "comine_downloads"
    private const val DOWNLOAD_NOTIFICATION_ID = 1001
    // Max concurrent downloads - matches the frontend setting range (1-5)
    private const val MAX_CONCURRENT_DOWNLOADS = 5
    var ytdlInitialized = false
      private set
    var ffmpegAvailable = false
      private set
    var aria2Available = false
      private set
  }
  
  // Separate executors for parallel operations
  // Use fixed thread pool to allow concurrent downloads (controlled by frontend)
  private val downloadExecutor = Executors.newFixedThreadPool(MAX_CONCURRENT_DOWNLOADS)
  private val infoExecutor = Executors.newCachedThreadPool()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var pendingShareUrl: String? = null
  private var notificationManager: NotificationManager? = null
  
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    
    // Initialize notification channel
    createNotificationChannel()
    
    // Request notification permission for Android 13+
    requestNotificationPermission()
    
    // Initialize youtubedl-android library
    initYoutubeDL()
    
    // Handle share intent if app was launched via share
    handleIntent(intent)
  }
  
  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001)
      }
    }
  }
  
  private fun createNotificationChannel() {
    notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        DOWNLOAD_CHANNEL_ID,
        "Downloads",
        NotificationManager.IMPORTANCE_LOW // Silent notification
      ).apply {
        description = "Shows download progress"
        setShowBadge(false)
      }
      notificationManager?.createNotificationChannel(channel)
    }
  }
  
  // Track active download notifications by URL hash
  private val activeNotifications = mutableMapOf<Int, String>()
  private var notificationIdCounter = DOWNLOAD_NOTIFICATION_ID
  
  private fun getNotificationIdForUrl(url: String): Int {
    // Use URL hash as notification ID for consistency
    return DOWNLOAD_NOTIFICATION_ID + (url.hashCode() and 0x7FFFFFFF) % 1000
  }
  
  private fun showDownloadNotification(notificationId: Int, title: String, progress: Int) {
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this, 0, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    
    // Show count if multiple downloads active
    val downloadCount = activeNotifications.size
    val contentTitle = if (downloadCount > 1) "Downloading ($downloadCount)" else "Downloading"
    
    val builder = NotificationCompat.Builder(this, DOWNLOAD_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(contentTitle)
      .setContentText(title)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
    
    if (progress >= 0) {
      builder.setProgress(100, progress, false)
    } else {
      builder.setProgress(0, 0, true) // Indeterminate
    }
    
    notificationManager?.notify(notificationId, builder.build())
  }
  
  private fun hideDownloadNotification(notificationId: Int) {
    notificationManager?.cancel(notificationId)
    activeNotifications.remove(notificationId)
  }
  
  private fun showCompletedNotification(notificationId: Int, title: String, filePath: String) {
    val file = File(filePath)
    
    // Create intent to open file when notification is clicked
    val openIntent = try {
      val uri = androidx.core.content.FileProvider.getUriForFile(
        this,
        "${packageName}.fileprovider",
        file
      )
      
      val mimeType = when (file.extension.lowercase()) {
        "mp4", "mkv", "webm", "avi", "mov" -> "video/*"
        "mp3", "m4a", "ogg", "flac", "wav", "opus" -> "audio/*"
        "jpg", "jpeg", "png", "gif", "webp" -> "image/*"
        else -> "*/*"
      }
      
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    } catch (e: Exception) {
      // Fallback to opening app
      Intent(this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
    }
    
    val pendingIntent = PendingIntent.getActivity(
      this, notificationId, openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    
    val builder = NotificationCompat.Builder(this, DOWNLOAD_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentTitle("Download complete")
      .setContentText(title)
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
    
    notificationManager?.notify(notificationId + 5000, builder.build())
  }
  
  private fun showFailedNotification(notificationId: Int, title: String, error: String) {
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this, notificationId, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    
    val builder = NotificationCompat.Builder(this, DOWNLOAD_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_notify_error)
      .setContentTitle("Download failed")
      .setContentText(title)
      .setStyle(NotificationCompat.BigTextStyle().bigText("$title\n$error"))
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
    
    notificationManager?.notify(notificationId + 5000, builder.build())
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // Handle share intent when app is already running
    handleIntent(intent)
  }
  
  private fun handleIntent(intent: Intent?) {
    if (intent == null) return
    
    val action = intent.action
    val type = intent.type
    
    Log.d(TAG, "handleIntent: action=$action, type=$type")
    
    when (action) {
      Intent.ACTION_SEND -> {
        if (type == "text/plain") {
          val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
          Log.d(TAG, "Received shared text: $sharedText")
          if (!sharedText.isNullOrEmpty()) {
            handleSharedUrl(extractUrl(sharedText))
          }
        }
      }
      Intent.ACTION_VIEW -> {
        val uri = intent.data
        Log.d(TAG, "Received view intent: $uri")
        if (uri != null) {
          handleSharedUrl(uri.toString())
        }
      }
    }
  }
  
  private fun extractUrl(text: String): String {
    // Try to extract URL from text (apps sometimes include extra text)
    val urlPattern = Regex("https?://[^\\s]+")
    val match = urlPattern.find(text)
    return match?.value ?: text
  }
  
  private fun handleSharedUrl(url: String) {
    if (url.isEmpty()) return
    
    Log.i(TAG, "Handling shared URL: $url")
    
    // If ytdlp is ready and webview is available, send to frontend immediately
    // Otherwise, store it and send when ready
    if (ytdlInitialized) {
      sendUrlToFrontend(url)
    } else {
      pendingShareUrl = url
      Log.d(TAG, "YoutubeDL not ready, storing URL for later")
    }
  }
  
  private fun sendUrlToFrontend(url: String) {
    mainHandler.post {
      val escapedUrl = url.replace("'", "\\'").replace("\"", "\\\"")
      // Dispatch a custom event that the frontend can listen to
      evaluateJavascript("""
        window.dispatchEvent(new CustomEvent('share-intent', { 
          detail: { url: '$escapedUrl' } 
        }));
      """.trimIndent())
      Log.i(TAG, "Sent URL to frontend via share-intent event")
    }
  }
  
  private fun initYoutubeDL() {
    Thread {
      try {
        // Initialize YoutubeDL first
        YoutubeDL.getInstance().init(this)
        Log.i(TAG, "YoutubeDL initialized successfully")
        
        // Initialize FFmpeg for merging video+audio
        try {
          FFmpeg.getInstance().init(this)
          ffmpegAvailable = true
          Log.i(TAG, "FFmpeg initialized successfully")
        } catch (e: Exception) {
          ffmpegAvailable = false
          Log.w(TAG, "FFmpeg initialization failed (merging may not work): ${e.message}")
        }
        
        // Initialize Aria2 for faster parallel downloads
        try {
          Aria2c.getInstance().init(this)
          aria2Available = true
          Log.i(TAG, "Aria2 initialized successfully")
        } catch (e: Exception) {
          aria2Available = false
          Log.w(TAG, "Aria2 initialization failed: ${e.message}")
        }
        
        ytdlInitialized = true
        
        // Notify the WebView that yt-dlp is ready
        mainHandler.post {
          evaluateJavascript("window.__YTDLP_READY__ = true; window.dispatchEvent(new Event('ytdlp-ready'));")
          
          // Send pending share URL if any
          pendingShareUrl?.let { url ->
            Log.d(TAG, "Sending pending share URL: $url")
            sendUrlToFrontend(url)
            pendingShareUrl = null
          }
        }
      } catch (e: Exception) {
        Log.e(TAG, "Failed to initialize youtubedl-android", e)
      }
    }.start()
  }
  
  private fun evaluateJavascript(script: String) {
    try {
      // Find the WebView and evaluate JavaScript
      val webView = findWebView(window.decorView)
      webView?.evaluateJavascript(script, null)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to evaluate JavaScript", e)
    }
  }
  
  private fun findWebView(view: android.view.View): WebView? {
    if (view is WebView) return view
    if (view is android.view.ViewGroup) {
      for (i in 0 until view.childCount) {
        val result = findWebView(view.getChildAt(i))
        if (result != null) return result
      }
    }
    return null
  }
  
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    
    // Configure WebView settings for proper image loading
    webView.settings.apply {
      // Allow loading images from remote URLs
      loadsImagesAutomatically = true
      blockNetworkImage = false
      // Allow mixed content (HTTPS page loading HTTP images if needed)
      mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
    }
    Log.i(TAG, "Configured WebView settings for image loading")
    
    // Add JavaScript interface for yt-dlp operations
    webView.addJavascriptInterface(YtDlpJsInterface(this), "AndroidYtDlp")
    Log.i(TAG, "Added AndroidYtDlp JavaScript interface")
    
    // Add JavaScript interface for Material You colors
    webView.addJavascriptInterface(AndroidColorsInterface(this), "AndroidColors")
    Log.i(TAG, "Added AndroidColors JavaScript interface")
  }
  
  /**
   * JavaScript interface for getting Material You / system colors
   * Call from JS: window.AndroidColors.getMaterialColors()
   */
  inner class AndroidColorsInterface(private val context: Context) {
    
    @JavascriptInterface
    fun getMaterialColors(): String {
      return try {
        // Get Material You dynamic colors (Android 12+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          val primary = android.R.color.system_accent1_500
          val secondary = android.R.color.system_accent2_500
          val tertiary = android.R.color.system_accent3_500
          
          val primaryColor = context.getColor(primary)
          val secondaryColor = context.getColor(secondary)
          val tertiaryColor = context.getColor(tertiary)
          
          val result = JSONObject().apply {
            put("primary", String.format("#%06X", 0xFFFFFF and primaryColor))
            put("secondary", String.format("#%06X", 0xFFFFFF and secondaryColor))
            put("tertiary", String.format("#%06X", 0xFFFFFF and tertiaryColor))
          }
          
          Log.d(TAG, "Material You colors: $result")
          result.toString()
        } else {
          // Fallback for older Android versions - use default accent
          JSONObject().apply {
            put("primary", "#6366F1")
          }.toString()
        }
      } catch (e: Exception) {
        Log.e(TAG, "Failed to get Material colors", e)
        "{}"
      }
    }
    
    @JavascriptInterface
    fun getWallpaperColors(): String {
      return try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          val wallpaperManager = android.app.WallpaperManager.getInstance(context)
          val colors = wallpaperManager.getWallpaperColors(android.app.WallpaperManager.FLAG_SYSTEM)
          
          if (colors != null) {
            val result = JSONObject()
            colors.primaryColor?.let { 
              result.put("primary", String.format("#%06X", 0xFFFFFF and it.toArgb()))
            }
            colors.secondaryColor?.let { 
              result.put("secondary", String.format("#%06X", 0xFFFFFF and it.toArgb()))
            }
            colors.tertiaryColor?.let { 
              result.put("tertiary", String.format("#%06X", 0xFFFFFF and it.toArgb()))
            }
            Log.d(TAG, "Wallpaper colors: $result")
            return result.toString()
          }
        }
        "{}"
      } catch (e: Exception) {
        Log.e(TAG, "Failed to get wallpaper colors", e)
        "{}"
      }
    }
  }
  
  /**
   * JavaScript interface for yt-dlp operations
   * Call from JS: window.AndroidYtDlp.getVersion()
   */
  inner class YtDlpJsInterface(private val context: MainActivity) {
    
    @JavascriptInterface
    fun isReady(): Boolean {
      return ytdlInitialized
    }
    
    @JavascriptInterface
    fun getVersion(): String {
      return try {
        if (!ytdlInitialized) return "not_initialized"
        YoutubeDL.getInstance().version(null) ?: "unknown"
      } catch (e: Exception) {
        Log.e(TAG, "Failed to get version", e)
        "error: ${e.message}"
      }
    }
    
    @JavascriptInterface
    fun openFile(filePath: String): Boolean {
      return try {
        var file = File(filePath)
        
        // If file doesn't exist, try fuzzy matching in the same directory
        // This handles Unicode encoding mismatches between stored paths and actual files
        if (!file.exists()) {
          sendLog("debug", "Exact path not found, trying fuzzy match: $filePath")
          val actualFile = findMatchingFile(file)
          if (actualFile != null) {
            file = actualFile
            sendLog("info", "Found matching file: ${file.absolutePath}")
          } else {
            sendLog("error", "File not found: $filePath")
            return false
          }
        }
        
        val uri = androidx.core.content.FileProvider.getUriForFile(
          context,
          "${context.packageName}.fileprovider",
          file
        )
        
        val mimeType = when (file.extension.lowercase()) {
          "mp4", "mkv", "webm", "avi", "mov" -> "video/*"
          "mp3", "m4a", "ogg", "flac", "wav", "opus" -> "audio/*"
          "jpg", "jpeg", "png", "gif", "webp" -> "image/*"
          else -> "*/*"
        }
        
        val intent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, mimeType)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        
        context.startActivity(Intent.createChooser(intent, "Open with"))
        sendLog("info", "Opened file: ${file.absolutePath}")
        true
      } catch (e: Exception) {
        Log.e(TAG, "Failed to open file: $filePath", e)
        sendLog("error", "Failed to open file: ${e.message}")
        false
      }
    }
    
    /**
     * Find a file that matches the given file by comparing normalized names.
     * This handles Unicode encoding mismatches (e.g., ｜ vs |, ⧸ vs /)
     */
    private fun findMatchingFile(targetFile: File): File? {
      val parentDir = targetFile.parentFile ?: return null
      if (!parentDir.exists()) return null
      
      val targetName = normalizeFileName(targetFile.name)
      val targetNameWithoutExt = normalizeFileName(targetFile.nameWithoutExtension)
      
      val files = parentDir.listFiles() ?: return null
      
      // First try exact normalized match
      for (file in files) {
        if (normalizeFileName(file.name) == targetName) {
          return file
        }
      }
      
      // Then try matching without extension (in case extension differs)
      for (file in files) {
        if (normalizeFileName(file.nameWithoutExtension) == targetNameWithoutExt) {
          return file
        }
      }
      
      // Finally try fuzzy matching (contains most of the words)
      val targetWords = targetNameWithoutExt.split(Regex("[^a-zA-Z0-9]+")).filter { it.length > 2 }
      if (targetWords.size >= 2) {
        for (file in files) {
          val fileWords = normalizeFileName(file.nameWithoutExtension).split(Regex("[^a-zA-Z0-9]+"))
          val matchCount = targetWords.count { word -> fileWords.any { it.contains(word, ignoreCase = true) } }
          // If most words match, consider it a match
          if (matchCount >= targetWords.size * 0.7) {
            sendLog("debug", "Fuzzy match: ${file.name} matches $targetWords with $matchCount/${targetWords.size}")
            return file
          }
        }
      }
      
      return null
    }
    
    /**
     * Normalize a file name by replacing special Unicode characters with ASCII equivalents
     */
    private fun normalizeFileName(name: String): String {
      return name
        .replace("｜", "|")
        .replace("⧸", "/")
        .replace("／", "/")
        .replace("＼", "\\")
        .replace("：", ":")
        .replace("＊", "*")
        .replace("？", "?")
        .replace("＂", "\"")
        .replace("＜", "<")
        .replace("＞", ">")
        .replace("　", " ")
        .replace("–", "-")
        .replace("—", "-")
        .replace("'", "'")
        .replace("'", "'")
        .replace(""", "\"")
        .replace(""", "\"")
        .replace("…", "...")
        .replace("↔", "-")
        .replace("→", "-")
        .replace("←", "-")
        .lowercase()
        .trim()
    }
    
    @JavascriptInterface
    fun openFolder(filePath: String): Boolean {
      return try {
        var file = File(filePath)
        
        // If file doesn't exist, try fuzzy matching
        if (!file.exists() && !file.isDirectory) {
          val actualFile = findMatchingFile(file)
          if (actualFile != null) {
            file = actualFile
          }
        }
        
        val folder = if (file.isDirectory) file else file.parentFile
        
        if (folder == null || !folder.exists()) {
          sendLog("error", "Folder not found for: $filePath")
          return false
        }
        
        // Try to open the Downloads folder in the file manager
        val intent = Intent(Intent.ACTION_VIEW).apply {
          // Use document UI to show the folder
          setDataAndType(android.net.Uri.parse("content://com.android.externalstorage.documents/document/primary:Download%2FComine"), "vnd.android.document/directory")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        
        try {
          context.startActivity(intent)
        } catch (e: Exception) {
          // Fallback: just open file manager
          val fallbackIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "*/*"
            addCategory(Intent.CATEGORY_OPENABLE)
          }
          context.startActivity(Intent.createChooser(fallbackIntent, "Open folder"))
        }
        
        sendLog("info", "Opened folder for: $filePath")
        true
      } catch (e: Exception) {
        Log.e(TAG, "Failed to open folder: $filePath", e)
        sendLog("error", "Failed to open folder: ${e.message}")
        false
      }
    }
    
    @JavascriptInterface
    fun getVideoInfo(url: String, callbackName: String) {
      // Run on separate thread pool to not block downloads
      infoExecutor.execute {
        try {
          if (!ytdlInitialized) {
            sendLog("warn", "yt-dlp not initialized yet")
            sendCallback(callbackName, "{\"error\": \"not_initialized\"}")
            return@execute
          }
          
          sendLog("info", "Fetching video info for: $url")
          val info = YoutubeDL.getInstance().getInfo(url)
          
          // Use thumbnail from yt-dlp directly - works for all platforms (YouTube, Twitter, TikTok, etc.)
          val thumbnailUrl = info.thumbnail ?: ""
          
          val result = JSONObject().apply {
            put("title", info.title ?: "")
            put("id", info.id ?: "")
            put("duration", info.duration)
            put("uploader", info.uploader ?: "")
            put("uploader_id", info.uploaderId ?: "")  // @username for social media
            put("channel", info.uploader ?: "")  // VideoInfo doesn't have channel, use uploader as fallback
            put("thumbnail", thumbnailUrl)
            put("ext", info.ext ?: "")
          }.toString()
          
          sendLog("info", "Video info fetched: ${info.title}, uploader_id: ${info.uploaderId ?: "none"}, thumbnail: ${if (thumbnailUrl.isNotEmpty()) "yes" else "no"}")
          sendCallback(callbackName, result)
          
        } catch (e: Exception) {
          Log.e(TAG, "Failed to get video info", e)
          sendLog("error", "Failed to get video info: ${e.message}")
          // Use JSONObject to properly escape the error message
          val errorJson = JSONObject().apply {
            put("error", e.message ?: "Unknown error")
          }.toString()
          sendCallback(callbackName, errorJson)
        }
      }
    }
    
    /**
     * Get playlist information with all entries
     * Returns JSON with is_playlist, title, entries array, etc.
     */
    @JavascriptInterface
    fun getPlaylistInfo(url: String, callbackName: String) {
      infoExecutor.execute {
        try {
          if (!ytdlInitialized) {
            sendLog("warn", "yt-dlp not initialized yet")
            sendCallback(callbackName, "{\"error\": \"not_initialized\"}")
            return@execute
          }
          
          sendLog("info", "Fetching playlist info for: $url")
          
          val isMusic = url.contains("music.youtube.com")
          
          // Get all entries with flat-playlist (each line has playlist metadata)
          val request = YoutubeDLRequest(url)
          request.addOption("--dump-json")
          request.addOption("--flat-playlist")
          request.addOption("--no-download")
          
          val response = YoutubeDL.getInstance().execute(request, null)
          
          if (response.exitCode != 0) {
            sendLog("error", "Failed to get playlist info: ${response.err}")
            sendCallback(callbackName, JSONObject().apply {
              put("error", response.err ?: "Unknown error")
            }.toString())
            return@execute
          }
          
          // Parse the JSON lines output (each entry is a separate JSON line)
          val output = response.out ?: ""
          val lines = output.trim().split("\n").filter { it.isNotBlank() }
          
          sendLog("debug", "Got ${lines.size} lines from flat-playlist")
          
          val entries = org.json.JSONArray()
          var playlistTitle = ""
          var playlistId: String? = null
          var uploader: String? = null
          var thumbnail: String? = null
          
          for ((index, line) in lines.withIndex()) {
            try {
              val json = JSONObject(line)
              
              // First entry contains playlist metadata
              if (index == 0) {
                sendLog("debug", "First entry JSON keys: ${json.keys().asSequence().toList()}")
                
                // Extract playlist metadata from first entry
                playlistTitle = json.optString("playlist_title", "")
                if (playlistTitle.isEmpty() || playlistTitle == "null") {
                  playlistTitle = json.optString("playlist", "")  // Alternative field
                }
                playlistId = json.optString("playlist_id", null)
                uploader = json.optString("playlist_uploader", json.optString("playlist_channel", null))
                if (uploader == null || uploader == "null") {
                  uploader = json.optString("uploader", json.optString("channel", null))
                }
              }
              
              // Each line is an entry with flat-playlist
              var entryUrl = json.optString("url", "")
              val entryId = json.optString("id", "")
              val entryTitle = json.optString("title", "")
              val entryUploader = json.optString("uploader", json.optString("channel", null))
              
              // If URL is relative or just an ID, construct the full URL
              if (entryUrl.isEmpty() || !entryUrl.startsWith("http")) {
                if (entryId.isNotEmpty()) {
                  entryUrl = if (isMusic) {
                    "https://music.youtube.com/watch?v=$entryId"
                  } else {
                    "https://www.youtube.com/watch?v=$entryId"
                  }
                } else {
                  entryUrl = json.optString("webpage_url", "")
                }
              }
              
              // Get thumbnail - try different fields from yt-dlp (works for all platforms)
              var entryThumbnail = json.optString("thumbnail", null)
              if (entryThumbnail == null || entryThumbnail == "null" || entryThumbnail.isEmpty()) {
                entryThumbnail = json.optJSONArray("thumbnails")?.optJSONObject(0)?.optString("url", null)
              }
              // If still no thumbnail, leave it empty - UI will show a placeholder
              if (entryThumbnail == "null") {
                entryThumbnail = null
              }
              
              // Use first entry's thumbnail as playlist thumbnail if not set
              if (thumbnail == null && entryThumbnail != null && entryThumbnail.isNotEmpty()) {
                thumbnail = entryThumbnail
              }
              
              val entry = JSONObject().apply {
                put("id", entryId)
                put("url", entryUrl)
                put("title", entryTitle)
                put("duration", json.optDouble("duration", 0.0))
                put("thumbnail", entryThumbnail)
                put("uploader", entryUploader)
                put("is_music", isMusic)
              }
              entries.put(entry)
            } catch (e: Exception) {
              sendLog("debug", "Skipping invalid JSON line: ${e.message}")
            }
          }
          
          // Use fallbacks if metadata fetch failed
          if (playlistTitle.isEmpty() || playlistTitle == "null") {
            // Try to extract from URL
            val listParam = url.substringAfter("list=").substringBefore("&")
            playlistTitle = "Playlist ($listParam)"
          }
          
          sendLog("debug", "Extracted playlist: title=$playlistTitle, id=$playlistId, uploader=$uploader, entries=${entries.length()}")
          
          val result = JSONObject().apply {
            put("is_playlist", entries.length() > 0)
            put("id", playlistId)
            put("title", playlistTitle)
            put("uploader", uploader)
            put("thumbnail", thumbnail)
            put("total_count", entries.length())
            put("entries", entries)
            put("has_more", false)
          }.toString()
          
          sendLog("info", "Playlist info fetched: $playlistTitle with ${entries.length()} entries")
          sendCallback(callbackName, result)
          
        } catch (e: Exception) {
          Log.e(TAG, "Failed to get playlist info", e)
          sendLog("error", "Failed to get playlist info: ${e.message}")
          val errorJson = JSONObject().apply {
            put("error", e.message ?: "Unknown error")
          }.toString()
          sendCallback(callbackName, errorJson)
        }
      }
    }
    
    /**
     * Process a YouTube Music thumbnail - download, detect letterboxing, crop if needed
     * Returns base64 data URI if cropped, or original URL if not letterboxed
     */
    @JavascriptInterface
    fun processYtmThumbnail(thumbnailUrl: String, callbackName: String) {
      infoExecutor.execute {
        try {
          sendLog("info", "Processing YTM thumbnail: $thumbnailUrl")
          
          // Download thumbnail
          val url = java.net.URL(thumbnailUrl)
          val connection = url.openConnection() as java.net.HttpURLConnection
          connection.connectTimeout = 10000
          connection.readTimeout = 10000
          connection.requestMethod = "GET"
          
          val inputStream = connection.inputStream
          val imageBytes = inputStream.readBytes()
          inputStream.close()
          connection.disconnect()
          
          sendLog("debug", "Downloaded thumbnail: ${imageBytes.size} bytes")
          
          // Decode bitmap
          val options = android.graphics.BitmapFactory.Options().apply {
            inMutable = false
          }
          val bitmap = android.graphics.BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size, options)
          
          if (bitmap == null) {
            sendLog("error", "Failed to decode thumbnail bitmap")
            sendCallback(callbackName, JSONObject().apply { put("url", thumbnailUrl) }.toString())
            return@execute
          }
          
          val width = bitmap.width
          val height = bitmap.height
          sendLog("debug", "Thumbnail dimensions: ${width}x${height}")
          
          // Check if image is wider than tall (letterboxed)
          if (width <= height) {
            sendLog("info", "Thumbnail is not letterboxed (width <= height)")
            bitmap.recycle()
            sendCallback(callbackName, JSONObject().apply { put("url", thumbnailUrl) }.toString())
            return@execute
          }
          
          // Calculate bar width
          val squareSize = height
          val barWidth = (width - squareSize) / 2
          
          // If bars are too small, not worth cropping
          if (barWidth < width / 20) {
            sendLog("info", "Bars too small to crop")
            bitmap.recycle()
            sendCallback(callbackName, JSONObject().apply { put("url", thumbnailUrl) }.toString())
            return@execute
          }
          
          // Check if bars are solid color
          if (!isLetterboxed(bitmap, barWidth)) {
            sendLog("info", "Thumbnail bars are not solid color, not letterboxed")
            bitmap.recycle()
            sendCallback(callbackName, JSONObject().apply { put("url", thumbnailUrl) }.toString())
            return@execute
          }
          
          sendLog("info", "Detected letterboxed thumbnail, cropping to center square")
          
          // Crop to center square
          val cropped = android.graphics.Bitmap.createBitmap(bitmap, barWidth, 0, squareSize, squareSize)
          bitmap.recycle()
          
          // Encode as JPEG base64
          val outputStream = java.io.ByteArrayOutputStream()
          cropped.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, outputStream)
          cropped.recycle()
          
          val base64Data = android.util.Base64.encodeToString(outputStream.toByteArray(), android.util.Base64.NO_WRAP)
          val dataUri = "data:image/jpeg;base64,$base64Data"
          
          sendLog("info", "Cropped thumbnail: ${imageBytes.size} bytes -> ${dataUri.length} chars")
          
          sendCallback(callbackName, JSONObject().apply { put("url", dataUri) }.toString())
          
        } catch (e: Exception) {
          Log.e(TAG, "Failed to process thumbnail", e)
          sendLog("error", "Failed to process thumbnail: ${e.message}")
          // Return original URL on error
          sendCallback(callbackName, JSONObject().apply { put("url", thumbnailUrl) }.toString())
        }
      }
    }
    
    /**
     * Check if the left and right bars of a bitmap are solid color
     */
    private fun isLetterboxed(bitmap: android.graphics.Bitmap, barWidth: Int): Boolean {
      val width = bitmap.width
      val height = bitmap.height
      val tolerance = 20
      
      // Get reference color from center of left bar
      val refColor = bitmap.getPixel(barWidth / 2, height / 2)
      val refR = android.graphics.Color.red(refColor)
      val refG = android.graphics.Color.green(refColor)
      val refB = android.graphics.Color.blue(refColor)
      
      // Sample points from left and right bars
      val samplePoints = listOf(
        // Left bar
        Pair(barWidth / 4, height / 4),
        Pair(barWidth / 4, height / 2),
        Pair(barWidth / 4, height * 3 / 4),
        Pair(barWidth / 2, height / 4),
        Pair(barWidth / 2, height * 3 / 4),
        Pair(barWidth * 3 / 4, height / 3),
        Pair(barWidth * 3 / 4, height * 2 / 3),
        // Right bar
        Pair(width - barWidth / 4, height / 4),
        Pair(width - barWidth / 4, height / 2),
        Pair(width - barWidth / 4, height * 3 / 4),
        Pair(width - barWidth / 2, height / 4),
        Pair(width - barWidth / 2, height * 3 / 4),
        Pair(width - barWidth * 3 / 4, height / 3),
        Pair(width - barWidth * 3 / 4, height * 2 / 3)
      )
      
      for ((x, y) in samplePoints) {
        val pixel = bitmap.getPixel(x, y)
        val r = android.graphics.Color.red(pixel)
        val g = android.graphics.Color.green(pixel)
        val b = android.graphics.Color.blue(pixel)
        
        if (kotlin.math.abs(r - refR) > tolerance ||
            kotlin.math.abs(g - refG) > tolerance ||
            kotlin.math.abs(b - refB) > tolerance) {
          return false
        }
      }
      
      return true
    }
    
    @JavascriptInterface
    fun download(url: String, format: String?, playlistFolder: String?, callbackName: String) {
      downloadExecutor.execute {
        // Get unique notification ID for this download
        val notificationId = getNotificationIdForUrl(url)
        
        var currentTitle = "Downloading..."
        
        try {
          if (!ytdlInitialized) {
            sendLog("error", "Cannot download: yt-dlp not initialized")
            sendCallback(callbackName, "{\"error\": \"not_initialized\"}")
            return@execute
          }
          
          sendLog("info", "Starting download: $url")
          sendLog("debug", "Format: ${format ?: "best"}, PlaylistFolder: ${playlistFolder ?: "none"}")
          
          // Base download directory
          val baseDir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "Comine"
          )
          
          // Create playlist subfolder if specified
          val downloadDir = if (!playlistFolder.isNullOrBlank()) {
            // Sanitize folder name for filesystem
            val safeFolderName = playlistFolder
              .replace(Regex("[<>:\"/\\\\|?*]"), "_")
              .replace(Regex("\\s+"), " ")
              .trim()
              .take(100)
            File(baseDir, safeFolderName)
          } else {
            baseDir
          }
          
          if (!downloadDir.exists()) {
            downloadDir.mkdirs()
            sendLog("debug", "Created download directory: ${downloadDir.absolutePath}")
          }
          
          val request = YoutubeDLRequest(url)
          request.addOption("-o", downloadDir.absolutePath + "/%(title)s.%(ext)s")
          
          // Check if this is an audio-only download
          val isAudioOnly = format == "bestaudio"
          
          // Only use merge/remux options if FFmpeg is available AND not audio-only
          if (ffmpegAvailable && !isAudioOnly) {
            // Merge video and audio into a single mp4 file
            request.addOption("--merge-output-format", "mp4")
            // Force remux/merge to avoid separate .f399.mp4 and .f251.webm files
            request.addOption("--remux-video", "mp4")
          } else if (isAudioOnly) {
            // Download native audio format directly (no extraction/conversion needed)
            // YouTube provides m4a/opus natively, so no FFmpeg postprocessing required
            sendLog("info", "Audio-only download, using native format (no extraction)")
          } else if (!ffmpegAvailable) {
            // Without FFmpeg, prefer formats that don't require merging
            sendLog("warn", "FFmpeg not available, using single-stream format")
          }
          
          // Use aria2 for faster parallel downloads if available
          if (aria2Available) {
            request.addOption("--downloader", "libaria2c.so")
            request.addOption("--external-downloader-args", "aria2c:'-x 16 -s 16 -k 1M'")
            sendLog("info", "Using aria2 for accelerated download")
          }
          
          if (!format.isNullOrEmpty() && format != "best") {
            request.addOption("-f", format)
          }
          
          // Show initial notification for this download
          activeNotifications[notificationId] = url
          mainHandler.post { showDownloadNotification(notificationId, currentTitle, -1) }
          
          sendLog("debug", "Executing yt-dlp request...")
          
          val response = YoutubeDL.getInstance().execute(request) { progress, etaInSeconds, line ->
            // Update notification with progress
            val progressInt = if (progress >= 0) progress.toInt() else -1
            mainHandler.post { showDownloadNotification(notificationId, currentTitle, progressInt) }
            
            // Forward log lines to frontend
            if (!line.isNullOrBlank()) {
              sendLog("debug", line)
              // Try to extract title from the line
              if (line.contains("Destination:")) {
                val destMatch = line.substringAfter("Destination:").trim()
                if (destMatch.isNotEmpty()) {
                  currentTitle = File(destMatch).nameWithoutExtension
                }
              }
            }
            
            val progressJson = JSONObject().apply {
              put("progress", progress)
              put("eta", etaInSeconds)
              put("line", line ?: "")
            }.toString()
            sendCallback("${callbackName}_progress", progressJson)
          }
          
          // Hide notification on completion
          mainHandler.post { hideDownloadNotification(notificationId) }
          
          // Try to find the downloaded file path from output
          var filePath: String? = null
          var fileSize: Long = 0
          
          val output = response.out ?: ""
          sendLog("debug", "yt-dlp output length: ${output.length}")
          
          // Log last few lines for debugging
          val outputLines = output.lines().takeLast(20)
          sendLog("debug", "Last 20 output lines:")
          outputLines.forEach { sendLog("debug", "  $it") }
          
          // yt-dlp prints various output formats depending on the operation:
          // 1. [Merger] Merging formats into "/path/to/file.mp4"
          // 2. [download] Destination: /path/to/file.mp4
          // 3. [download] /path/to/file.mp4 has already been downloaded
          // 4. [ExtractAudio] Destination: /path/to/file.mp3
          // 5. [ffmpeg] Destination: /path/to/file.mp4 (for remux)
          // 6. [VideoRemuxer] Remuxing video from m4a to mp4; Destination: /path/to/file.mp4
          
          // Look for the final merged/downloaded file - order matters, prefer remux result
          val videoRemuxMatch = Regex("""\[VideoRemuxer\].*Destination:\s*(.+)""").findAll(output).lastOrNull()
          if (videoRemuxMatch != null) {
            sendLog("debug", "Found VideoRemuxer match: ${videoRemuxMatch.groupValues[1]}")
          }
          
          val mergerMatch = Regex("""\[Merger\] Merging formats into "(.+?)"""").find(output)
          if (mergerMatch != null) {
            sendLog("debug", "Found merger match: ${mergerMatch.groupValues[1]}")
          }
          
          val ffmpegDestMatch = Regex("""\[ffmpeg\] Destination: (.+)""").findAll(output).lastOrNull()
          if (ffmpegDestMatch != null) {
            sendLog("debug", "Found ffmpeg dest match: ${ffmpegDestMatch.groupValues[1]}")
          }
          
          val extractAudioMatch = Regex("""\[ExtractAudio\] Destination: (.+)""").findAll(output).lastOrNull()
          if (extractAudioMatch != null) {
            sendLog("debug", "Found extract audio match: ${extractAudioMatch.groupValues[1]}")
          }
          
          val destMatch = Regex("""\[download\] Destination: (.+)""").findAll(output).lastOrNull()
          if (destMatch != null) {
            sendLog("debug", "Found download dest match: ${destMatch.groupValues[1]}")
          }
          
          val alreadyMatch = Regex("""\[download\] (.+?) has already been downloaded""").find(output)
          if (alreadyMatch != null) {
            sendLog("debug", "Found already downloaded match: ${alreadyMatch.groupValues[1]}")
          }
          
          // Priority order: VideoRemuxer > ffmpeg result > merger > extractAudio > last download dest > already downloaded
          var parsedPath = videoRemuxMatch?.groupValues?.get(1)?.trim()
            ?: ffmpegDestMatch?.groupValues?.get(1)?.trim()
            ?: mergerMatch?.groupValues?.get(1)?.trim()
            ?: extractAudioMatch?.groupValues?.get(1)?.trim()
            ?: destMatch?.groupValues?.get(1)?.trim()
            ?: alreadyMatch?.groupValues?.get(1)?.trim()
          
          sendLog("info", "Parsed file path from output: $parsedPath")
          
          // Verify the parsed path actually exists (encoding issues can cause mismatches)
          if (parsedPath != null) {
            val parsedFile = File(parsedPath)
            if (parsedFile.exists()) {
              filePath = parsedPath
              sendLog("info", "Verified parsed file exists: $filePath")
            } else {
              sendLog("warn", "Parsed file path doesn't exist (encoding issue?): $parsedPath")
              parsedPath = null // Fall through to directory scan
            }
          }
          
          // If we didn't find a valid path, scan the download directory for the newest file
          if (parsedPath == null) {
            sendLog("debug", "Scanning download directory for newest file: ${downloadDir.absolutePath}")
            val files = downloadDir.listFiles()?.filter { it.isFile }
            if (!files.isNullOrEmpty()) {
              // Find the file modified in the last 60 seconds (to avoid picking old files)
              val recentFiles = files.filter { 
                System.currentTimeMillis() - it.lastModified() < 60000 
              }
              val newestFile = (recentFiles.ifEmpty { files }).maxByOrNull { it.lastModified() }
              filePath = newestFile?.absolutePath
              sendLog("info", "Found newest file in download dir: $filePath")
            } else {
              sendLog("warn", "No files found in download directory")
            }
          }
          
          // Get file size
          if (filePath != null) {
            val file = File(filePath)
            if (file.exists()) {
              fileSize = file.length()
              sendLog("info", "Downloaded file: $filePath (${fileSize} bytes)")
            } else {
              sendLog("warn", "File doesn't exist: $filePath")
              filePath = null // Clear invalid path
            }
          } else {
            sendLog("warn", "No file path found for completed download")
          }
          
          if (response.exitCode == 0) {
            sendLog("info", "Download completed successfully")
            // Show completion notification
            if (filePath != null) {
              val fileName = File(filePath).nameWithoutExtension
              mainHandler.post { showCompletedNotification(notificationId, fileName, filePath) }
            }
          } else {
            sendLog("error", "Download failed with exit code: ${response.exitCode}")
            sendLog("error", "Output: ${response.out}")
            // Show failed notification
            mainHandler.post { showFailedNotification(notificationId, currentTitle, "Exit code: ${response.exitCode}") }
          }
          
          val resultJson = JSONObject().apply {
            put("success", response.exitCode == 0)
            put("output", response.out ?: "")
            put("exitCode", response.exitCode)
            put("filePath", filePath ?: "")
            put("fileSize", fileSize)
          }.toString()
          sendCallback(callbackName, resultJson)
          
        } catch (e: Exception) {
          Log.e(TAG, "Download failed", e)
          sendLog("error", "Download exception: ${e.message}")
          // Hide notification on error and show failed notification
          mainHandler.post { 
            hideDownloadNotification(notificationId)
            showFailedNotification(notificationId, currentTitle, e.message ?: "Unknown error")
          }
          // Use JSONObject to properly escape the error message
          val errorJson = JSONObject().apply {
            put("error", e.message ?: "Unknown error")
          }.toString()
          sendCallback(callbackName, errorJson)
        }
      }
    }
    
    private fun sendCallback(callbackName: String, json: String) {
      mainHandler.post {
        try {
          // Use Base64 encoding to avoid JSON escaping issues
          val base64Json = android.util.Base64.encodeToString(json.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
          Log.d(TAG, "Sending callback $callbackName with ${json.length} bytes")
          
          val script = """
            (function() {
              try {
                if (window.$callbackName) {
                  var binaryStr = atob('$base64Json');
                  var bytes = new Uint8Array(binaryStr.length);
                  for (var i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                  }
                  var decoded = new TextDecoder('utf-8').decode(bytes);
                  window.$callbackName(decoded);
                } else {
                  console.warn('Callback not found: $callbackName');
                }
              } catch(e) {
                console.error('Callback error for $callbackName:', e);
              }
            })();
          """.trimIndent()
          
          evaluateJavascript(script)
        } catch (e: Exception) {
          Log.e(TAG, "Failed to send callback $callbackName", e)
        }
      }
    }
    
    private fun sendLog(level: String, message: String) {
      Log.d(TAG, "[$level] $message")
      mainHandler.post {
        try {
          val escapedMessage = message
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "")
          
          val script = """
            (function() {
              if (window.__androidLog) {
                window.__androidLog('$level', 'Android', '$escapedMessage');
              }
            })();
          """.trimIndent()
          
          evaluateJavascript(script)
        } catch (e: Exception) {
          Log.e(TAG, "Failed to send log", e)
        }
      }
    }
  }
}
