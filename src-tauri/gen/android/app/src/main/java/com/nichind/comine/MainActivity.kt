package com.nichind.comine

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
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
    private const val UPDATE_NOTIFICATION_ID = 2001
    private const val MAX_CONCURRENT_DOWNLOADS = 5
    var ytdlInitialized = false
      private set
    var ffmpegAvailable = false
      private set
    var aria2Available = false
      private set
  }
  
  private val downloadExecutor = Executors.newFixedThreadPool(MAX_CONCURRENT_DOWNLOADS)
  private val infoExecutor = Executors.newCachedThreadPool()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var pendingShareUrl: String? = null
  private var notificationManager: NotificationManager? = null
  private var pendingUpdateApk: File? = null
  private var pendingUpdateCallback: String? = null
  
  private var folderPickerCallback: String? = null
  private lateinit var folderPickerLauncher: ActivityResultLauncher<Uri?>
  
  override fun onCreate(savedInstanceState: Bundle?) {
    folderPickerLauncher = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
      handleFolderPickerResult(uri)
    }
    
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    createNotificationChannel()
    requestNotificationPermission()
    initYoutubeDL()
    handleIntent(intent)
  }
  
  override fun onDestroy() {
    super.onDestroy()
    downloadExecutor.shutdownNow()
    infoExecutor.shutdownNow()
  }
  
  override fun onResume() {
    super.onResume()
    tryInstallPendingUpdate()
  }
  
  private fun handleFolderPickerResult(uri: Uri?) {
    val callbackName = folderPickerCallback ?: return
    folderPickerCallback = null
    
    val resultJson = if (uri != null) {
      try {
        contentResolver.takePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        
        val path = getPathFromUri(uri)
        Log.d(TAG, "Folder picker selected: uri=$uri, path=$path")
        
        JSONObject().apply {
          put("success", true)
          put("uri", uri.toString())
          put("path", path ?: uri.toString())
        }.toString()
      } catch (e: Exception) {
        Log.e(TAG, "Failed to process folder picker result", e)
        JSONObject().apply {
          put("success", false)
          put("error", e.message ?: "Unknown error")
        }.toString()
      }
    } else {
      JSONObject().apply {
        put("success", false)
        put("cancelled", true)
      }.toString()
    }
    
    sendCallback(callbackName, resultJson)
  }
  
  private fun getPathFromUri(uri: Uri): String? {
    return try {
      val docId = DocumentsContract.getTreeDocumentId(uri)
      val parts = docId.split(":")
      if (parts.size >= 2) {
        val type = parts[0]
        val relativePath = parts[1]
        when (type) {
          "primary" -> "/storage/emulated/0/$relativePath"
          else -> "/storage/$type/$relativePath"
        }
      } else {
        null
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not extract path from URI", e)
      null
    }
  }

  private fun tryInstallPendingUpdate() {
    val apkFile = pendingUpdateApk ?: return
    val callbackName = pendingUpdateCallback ?: return
    
    if (!apkFile.exists()) {
      Log.w(TAG, "Pending update APK no longer exists")
      pendingUpdateApk = null
      pendingUpdateCallback = null
      return
    }
    
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      if (!packageManager.canRequestPackageInstalls()) {
        return
      }
    }
    
    Log.i(TAG, "Attempting to install pending update APK")
    pendingUpdateApk = null
    pendingUpdateCallback = null
    
    try {
      val uri = androidx.core.content.FileProvider.getUriForFile(
        this,
        "${packageName}.fileprovider",
        apkFile
      )
      
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      
      startActivity(intent)
      
      mainHandler.post {
        val resultJson = JSONObject().apply {
          put("type", "complete")
          put("success", true)
        }.toString()
        
        val base64Json = android.util.Base64.encodeToString(resultJson.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
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
              }
            } catch(e) {
              console.error('Callback error:', e);
            }
          })();
        """.trimIndent()
        evaluateJavascript(script)
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed to install pending update", e)
    }
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
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Shows download progress"
        setShowBadge(false)
      }
      notificationManager?.createNotificationChannel(channel)
    }
  }
  
  private val activeNotifications = mutableMapOf<Int, String>()
  private var notificationIdCounter = DOWNLOAD_NOTIFICATION_ID
  
  private fun getNotificationIdForUrl(url: String): Int {
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
      builder.setProgress(0, 0, true)
    }
    
    notificationManager?.notify(notificationId, builder.build())
  }
  
  private fun hideDownloadNotification(notificationId: Int) {
    notificationManager?.cancel(notificationId)
    activeNotifications.remove(notificationId)
  }
  
  private fun showCompletedNotification(notificationId: Int, title: String, filePath: String) {
    val file = File(filePath)
    
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
    val urlPattern = Regex("https?://[^\\s]+")
    val match = urlPattern.find(text)
    return match?.value ?: text
  }
  
  private fun handleSharedUrl(url: String) {
    if (url.isEmpty()) return
    
    Log.i(TAG, "Handling shared URL: $url")
    
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
        YoutubeDL.getInstance().init(this)
        Log.i(TAG, "YoutubeDL initialized successfully")
        
        try {
          FFmpeg.getInstance().init(this)
          ffmpegAvailable = true
          Log.i(TAG, "FFmpeg initialized successfully")
        } catch (e: Exception) {
          ffmpegAvailable = false
          Log.w(TAG, "FFmpeg initialization failed: ${e.message}")
        }
        
        try {
          Aria2c.getInstance().init(this)
          aria2Available = true
          Log.i(TAG, "Aria2 initialized successfully")
        } catch (e: Exception) {
          aria2Available = false
          Log.w(TAG, "Aria2 initialization failed: ${e.message}")
        }
        
        ytdlInitialized = true
        
        mainHandler.post {
          evaluateJavascript("window.__YTDLP_READY__ = true; window.dispatchEvent(new Event('ytdlp-ready'));")
          
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
  
  private fun sendCallback(callbackName: String, json: String) {
    mainHandler.post {
      try {
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
  
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    
    webView.settings.apply {
      loadsImagesAutomatically = true
      blockNetworkImage = false
      mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
    }
    
    webView.addJavascriptInterface(YtDlpJsInterface(this), "AndroidYtDlp")
    webView.addJavascriptInterface(AndroidColorsInterface(this), "AndroidColors")
  }
  
  inner class AndroidColorsInterface(private val context: Context) {
    
    @JavascriptInterface
    fun getMaterialColors(): String {
      return try {
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
  
  inner class YtDlpJsInterface(private val context: MainActivity) {
    
    @JavascriptInterface
    fun isReady(): Boolean {
      return ytdlInitialized
    }
    
    @JavascriptInterface
    fun getAppVersion(): String {
      return try {
        val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        pInfo.versionName ?: "unknown"
      } catch (e: Exception) {
        "unknown"
      }
    }
    
    @JavascriptInterface
    fun pickFolder(callbackName: String) {
      mainHandler.post {
        try {
          folderPickerCallback = callbackName
          val initialUri = android.net.Uri.parse("content://com.android.externalstorage.documents/document/primary:Download")
          folderPickerLauncher.launch(initialUri)
        } catch (e: Exception) {
          Log.e(TAG, "Failed to launch folder picker", e)
          val errorResult = JSONObject().apply {
            put("success", false)
            put("error", e.message ?: "Failed to launch folder picker")
          }.toString()
          sendCallback(callbackName, errorResult)
        }
      }
    }
    
    @JavascriptInterface
    fun downloadAndInstallUpdate(apkUrl: String, callbackName: String) {
      infoExecutor.execute {
        val notificationId = UPDATE_NOTIFICATION_ID
        try {
          sendLog("info", "Downloading update from: $apkUrl")
          sendUpdateProgress(callbackName, 0, 0, "connecting")
          
          val url = java.net.URL(apkUrl)
          val connection = url.openConnection() as java.net.HttpURLConnection
          connection.connectTimeout = 30000
          connection.readTimeout = 60000
          connection.requestMethod = "GET"
          connection.setRequestProperty("Accept", "application/vnd.android.package-archive")
          connection.setRequestProperty("User-Agent", "Comine-Android-Update")
          
          val contentLength = connection.contentLength.toLong()
          sendLog("info", "Update size: $contentLength bytes")
          
          val cacheDir = context.externalCacheDir ?: context.cacheDir
          val apkFile = File(cacheDir, "comine-update.apk")
          
          // Delete old file if exists
          if (apkFile.exists()) {
            apkFile.delete()
          }
          
          mainHandler.post { showDownloadNotification(notificationId, "Downloading update...", 0) }
          sendUpdateProgress(callbackName, 0, contentLength, "downloading")
          
          var downloaded: Long = 0
          var lastProgress = 0
          val buffer = ByteArray(8192)
          
          connection.inputStream.use { input ->
            apkFile.outputStream().use { output ->
              var bytesRead: Int
              while (input.read(buffer).also { bytesRead = it } != -1) {
                output.write(buffer, 0, bytesRead)
                downloaded += bytesRead
                
                val progress = if (contentLength > 0) {
                  ((downloaded * 100) / contentLength).toInt()
                } else {
                  -1
                }
                
                // Update progress every 2%
                if (progress != lastProgress && progress % 2 == 0) {
                  lastProgress = progress
                  mainHandler.post { showDownloadNotification(notificationId, "Downloading update...", progress) }
                  sendUpdateProgress(callbackName, downloaded, contentLength, "downloading")
                }
              }
            }
          }
          connection.disconnect()
          
          mainHandler.post { hideDownloadNotification(notificationId) }
          sendLog("info", "Update downloaded: ${apkFile.length()} bytes")
          sendUpdateProgress(callbackName, contentLength, contentLength, "installing")
          
          mainHandler.post {
            try {
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!context.packageManager.canRequestPackageInstalls()) {
                  sendLog("info", "Requesting install permission from user")
                  pendingUpdateApk = apkFile
                  pendingUpdateCallback = callbackName
                  val settingsIntent = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = android.net.Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                  }
                  context.startActivity(settingsIntent)
                  sendLog("info", "APK saved, will auto-install when user returns with permission granted")
                  return@post
                }
              }
              
              val uri = androidx.core.content.FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                apkFile
              )
              
              sendLog("info", "Starting APK install with URI: $uri")
              
              val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              }
              
              context.startActivity(intent)
              sendUpdateComplete(callbackName, true, null)
            } catch (e: Exception) {
              Log.e(TAG, "Failed to install update", e)
              sendLog("error", "Failed to install update: ${e.message}")
              sendUpdateComplete(callbackName, false, e.message)
            }
          }
        } catch (e: Exception) {
          Log.e(TAG, "Failed to download update", e)
          sendLog("error", "Failed to download update: ${e.message}")
          mainHandler.post { hideDownloadNotification(notificationId) }
          sendUpdateComplete(callbackName, false, e.message)
        }
      }
    }
    
    private fun sendUpdateProgress(callbackName: String, downloaded: Long, total: Long, stage: String) {
      val progress = if (total > 0) ((downloaded * 100) / total).toInt() else 0
      val progressJson = JSONObject().apply {
        put("type", "progress")
        put("downloaded", downloaded)
        put("total", total)
        put("progress", progress)
        put("stage", stage)
      }.toString()
      sendCallback("${callbackName}_progress", progressJson)
    }
    
    private fun sendUpdateComplete(callbackName: String, success: Boolean, error: String?) {
      val resultJson = JSONObject().apply {
        put("type", "complete")
        put("success", success)
        if (error != null) put("error", error)
      }.toString()
      sendCallback(callbackName, resultJson)
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
    
    private fun findMatchingFile(targetFile: File): File? {
      val parentDir = targetFile.parentFile ?: return null
      if (!parentDir.exists()) return null
      
      val targetName = normalizeFileName(targetFile.name)
      val targetNameWithoutExt = normalizeFileName(targetFile.nameWithoutExtension)
      
      val files = parentDir.listFiles() ?: return null
      
      for (file in files) {
        if (normalizeFileName(file.name) == targetName) {
          return file
        }
      }
      
      for (file in files) {
        if (normalizeFileName(file.nameWithoutExtension) == targetNameWithoutExt) {
          return file
        }
      }
      
      val targetWords = targetNameWithoutExt.split(Regex("[^a-zA-Z0-9]+")).filter { it.length > 2 }
      if (targetWords.size >= 2) {
        for (file in files) {
          val fileWords = normalizeFileName(file.nameWithoutExtension).split(Regex("[^a-zA-Z0-9]+"))
          val matchCount = targetWords.count { word -> fileWords.any { it.contains(word, ignoreCase = true) } }
          if (matchCount >= targetWords.size * 0.7) {
            sendLog("debug", "Fuzzy match: ${file.name} matches $targetWords with $matchCount/${targetWords.size}")
            return file
          }
        }
      }
      
      return null
    }
    
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
        
        val intent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(android.net.Uri.parse("content://com.android.externalstorage.documents/document/primary:Download%2FComine"), "vnd.android.document/directory")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        
        try {
          context.startActivity(intent)
        } catch (e: Exception) {
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
      infoExecutor.execute {
        try {
          if (!ytdlInitialized) {
            sendLog("warn", "yt-dlp not initialized yet")
            sendCallback(callbackName, "{\"error\": \"not_initialized\"}")
            return@execute
          }
          
          sendLog("info", "Fetching video info with formats for: $url")
          
          val request = YoutubeDLRequest(url)
          request.addOption("--dump-json")
          request.addOption("--no-download")
          request.addOption("--no-playlist")
          
          if (url.contains("youtube.com") || url.contains("youtu.be")) {
            request.addOption("--extractor-args", "youtube:player_client=tv,android_sdkless")
          }
          
          val response = YoutubeDL.getInstance().execute(request, null)
          
          if (response.exitCode != 0) {
            sendLog("error", "Failed to get video info: ${response.err}")
            sendCallback(callbackName, JSONObject().apply {
              put("error", response.err ?: "Unknown error")
            }.toString())
            return@execute
          }
          
          val output = response.out ?: ""
          if (output.isBlank()) {
            sendLog("error", "Empty response from yt-dlp")
            sendCallback(callbackName, JSONObject().apply {
              put("error", "Empty response from yt-dlp")
            }.toString())
            return@execute
          }
          
          val json = JSONObject(output)
          sendLog("info", "Video info fetched: ${json.optString("title")}, formats: ${json.optJSONArray("formats")?.length() ?: 0}")
          sendCallback(callbackName, output)
          
        } catch (e: Exception) {
          Log.e(TAG, "Failed to get video info", e)
          sendLog("error", "Failed to get video info: ${e.message}")
          val errorJson = JSONObject().apply {
            put("error", e.message ?: "Unknown error")
          }.toString()
          sendCallback(callbackName, errorJson)
        }
      }
    }
    
    @JavascriptInterface
    fun getVideoInfoWithClient(url: String, playerClient: String, callbackName: String) {
      infoExecutor.execute {
        try {
          if (!ytdlInitialized) {
            sendLog("warn", "yt-dlp not initialized yet")
            sendCallback(callbackName, "{\"error\": \"not_initialized\"}")
            return@execute
          }
          
          sendLog("info", "Fetching video info with formats for: $url (playerClient: $playerClient)")
          
          val request = YoutubeDLRequest(url)
          request.addOption("--dump-json")
          request.addOption("--no-download")
          request.addOption("--no-playlist")
          
          if ((url.contains("youtube.com") || url.contains("youtu.be")) && playerClient.isNotBlank()) {
            request.addOption("--extractor-args", "youtube:player_client=$playerClient")
          }
          
          val response = YoutubeDL.getInstance().execute(request, null)
          
          if (response.exitCode != 0) {
            sendLog("error", "Failed to get video info: ${response.err}")
            sendCallback(callbackName, JSONObject().apply {
              put("error", response.err ?: "Unknown error")
            }.toString())
            return@execute
          }
          
          val output = response.out ?: ""
          if (output.isBlank()) {
            sendLog("error", "Empty response from yt-dlp")
            sendCallback(callbackName, JSONObject().apply {
              put("error", "Empty response from yt-dlp")
            }.toString())
            return@execute
          }
          
          val json = JSONObject(output)
          sendLog("info", "Video info fetched: ${json.optString("title")}, formats: ${json.optJSONArray("formats")?.length() ?: 0}")
          sendCallback(callbackName, output)
          
        } catch (e: Exception) {
          Log.e(TAG, "Failed to get video info", e)
          sendLog("error", "Failed to get video info: ${e.message}")
          val errorJson = JSONObject().apply {
            put("error", e.message ?: "Unknown error")
          }.toString()
          sendCallback(callbackName, errorJson)
        }
      }
    }
    
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
          val isYouTube = url.contains("youtube.com") || url.contains("youtu.be")
          
          val request = YoutubeDLRequest(url)
          request.addOption("--dump-json")
          request.addOption("--flat-playlist")
          request.addOption("--no-download")
          
          if (isYouTube) {
            request.addOption("--extractor-args", "youtube:player_client=tv,android_sdkless")
          }
          
          val response = YoutubeDL.getInstance().execute(request, null)
          
          if (response.exitCode != 0) {
            sendLog("error", "Failed to get playlist info: ${response.err}")
            sendCallback(callbackName, JSONObject().apply {
              put("error", response.err ?: "Unknown error")
            }.toString())
            return@execute
          }
          
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
              
              if (index == 0) {
                sendLog("debug", "First entry JSON keys: ${json.keys().asSequence().toList()}")
                
                playlistTitle = json.optString("playlist_title", "")
                if (playlistTitle.isEmpty() || playlistTitle == "null") {
                  playlistTitle = json.optString("playlist", "")
                }
                playlistId = json.optString("playlist_id", null)
                uploader = json.optString("playlist_uploader", json.optString("playlist_channel", null))
                if (uploader == null || uploader == "null") {
                  uploader = json.optString("uploader", json.optString("channel", null))
                }
              }
              
              var entryUrl = json.optString("url", "")
              val entryId = json.optString("id", "")
              val entryTitle = json.optString("title", "")
              val entryUploader = json.optString("uploader", json.optString("channel", null))
              
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
              
              var entryThumbnail = json.optString("thumbnail", null)
              if (entryThumbnail == null || entryThumbnail == "null" || entryThumbnail.isEmpty()) {
                entryThumbnail = json.optJSONArray("thumbnails")?.optJSONObject(0)?.optString("url", null)
              }
              if (entryThumbnail == "null") {
                entryThumbnail = null
              }
              
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
          
          if (playlistTitle.isEmpty() || playlistTitle == "null") {
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
    
    @JavascriptInterface
    fun getPlaylistInfoWithClient(url: String, playerClient: String, callbackName: String) {
      infoExecutor.execute {
        try {
          if (!ytdlInitialized) {
            sendLog("warn", "yt-dlp not initialized yet")
            sendCallback(callbackName, "{\"error\": \"not_initialized\"}")
            return@execute
          }
          
          sendLog("info", "Fetching playlist info for: $url (playerClient: $playerClient)")
          
          val isMusic = url.contains("music.youtube.com")
          val isYouTube = url.contains("youtube.com") || url.contains("youtu.be")
          
          val request = YoutubeDLRequest(url)
          request.addOption("--dump-json")
          request.addOption("--flat-playlist")
          request.addOption("--no-download")
          
          if (isYouTube && playerClient.isNotBlank()) {
            request.addOption("--extractor-args", "youtube:player_client=$playerClient")
          }
          
          val response = YoutubeDL.getInstance().execute(request, null)
          
          if (response.exitCode != 0) {
            sendLog("error", "Failed to get playlist info: ${response.err}")
            sendCallback(callbackName, JSONObject().apply {
              put("error", response.err ?: "Unknown error")
            }.toString())
            return@execute
          }
          
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
              
              if (index == 0) {
                playlistTitle = json.optString("playlist_title", "")
                if (playlistTitle.isEmpty() || playlistTitle == "null") {
                  playlistTitle = json.optString("playlist", "")
                }
                playlistId = json.optString("playlist_id", null)
                uploader = json.optString("playlist_uploader", json.optString("playlist_channel", null))
                if (uploader == null || uploader == "null") {
                  uploader = json.optString("uploader", json.optString("channel", null))
                }
              }
              
              var entryUrl = json.optString("url", "")
              val entryId = json.optString("id", "")
              val entryTitle = json.optString("title", "")
              val entryUploader = json.optString("uploader", json.optString("channel", null))
              
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
              
              var entryThumbnail = json.optString("thumbnail", null)
              if (entryThumbnail == null || entryThumbnail == "null" || entryThumbnail.isEmpty()) {
                entryThumbnail = json.optJSONArray("thumbnails")?.optJSONObject(0)?.optString("url", null)
              }
              if (entryThumbnail == "null") {
                entryThumbnail = null
              }
              
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
          
          if (playlistTitle.isEmpty() || playlistTitle == "null") {
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
    
    @JavascriptInterface
    fun processYtmThumbnail(thumbnailUrl: String, callbackName: String) {
      sendCallback(callbackName, JSONObject().apply { put("url", thumbnailUrl) }.toString())
    }
    
    private fun isLetterboxed(bitmap: android.graphics.Bitmap, barWidth: Int): Boolean {
      val width = bitmap.width
      val height = bitmap.height
      val darkThreshold = 30
      
      val samplePoints = listOf(
        // Left bar
        Pair(barWidth / 4, height / 4),
        Pair(barWidth / 4, height / 2),
        Pair(barWidth / 4, height * 3 / 4),
        Pair(barWidth / 2, height / 4),
        Pair(barWidth / 2, height / 2),
        Pair(barWidth / 2, height * 3 / 4),
        Pair(barWidth * 3 / 4, height / 4),
        Pair(barWidth * 3 / 4, height / 2),
        Pair(barWidth * 3 / 4, height * 3 / 4),
        // Right bar
        Pair(width - barWidth / 4, height / 4),
        Pair(width - barWidth / 4, height / 2),
        Pair(width - barWidth / 4, height * 3 / 4),
        Pair(width - barWidth / 2, height / 4),
        Pair(width - barWidth / 2, height / 2),
        Pair(width - barWidth / 2, height * 3 / 4),
        Pair(width - barWidth * 3 / 4, height / 4),
        Pair(width - barWidth * 3 / 4, height / 2),
        Pair(width - barWidth * 3 / 4, height * 3 / 4)
      )
      
      // First check: are the bars dark (black letterboxing)?
      var darkCount = 0
      for ((x, y) in samplePoints) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue
        val pixel = bitmap.getPixel(x, y)
        val r = android.graphics.Color.red(pixel)
        val g = android.graphics.Color.green(pixel)
        val b = android.graphics.Color.blue(pixel)
        
        if (r <= darkThreshold && g <= darkThreshold && b <= darkThreshold) {
          darkCount++
        }
      }
      
      val requiredDark = (samplePoints.size * 7) / 10
      if (darkCount >= requiredDark) {
        return true
      }
      
      val tolerance = 60
      val refColor = bitmap.getPixel(barWidth / 2, height / 2)
      val refR = android.graphics.Color.red(refColor)
      val refG = android.graphics.Color.green(refColor)
      val refB = android.graphics.Color.blue(refColor)
      
      var uniformCount = 0
      for ((x, y) in samplePoints) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue
        val pixel = bitmap.getPixel(x, y)
        val r = android.graphics.Color.red(pixel)
        val g = android.graphics.Color.green(pixel)
        val b = android.graphics.Color.blue(pixel)
        
        if (kotlin.math.abs(r - refR) <= tolerance &&
            kotlin.math.abs(g - refG) <= tolerance &&
            kotlin.math.abs(b - refB) <= tolerance) {
          uniformCount++
        }
      }
      
      val requiredUniform = (samplePoints.size * 7) / 10
      return uniformCount >= requiredUniform
    }
    
    @JavascriptInterface
    fun download(url: String, format: String?, playlistFolder: String?, isAudioOnly: Boolean, callbackName: String) {
      downloadWithSettings(url, format, playlistFolder, isAudioOnly, 16, 16, null, 0, null, callbackName)
    }
    
    @JavascriptInterface
    fun downloadWithPath(url: String, format: String?, playlistFolder: String?, isAudioOnly: Boolean, downloadPath: String?, callbackName: String) {
      downloadWithSettings(url, format, playlistFolder, isAudioOnly, 16, 16, null, 0, downloadPath, callbackName)
    }
    
    @JavascriptInterface
    fun downloadWithSettings(url: String, format: String?, playlistFolder: String?, isAudioOnly: Boolean, aria2Connections: Int, aria2Splits: Int, aria2MinSplitSize: String?, speedLimit: Int, downloadPath: String?, callbackName: String) {
      downloadExecutor.execute {
        val notificationId = getNotificationIdForUrl(url)
        
        var currentTitle = "Downloading..."
        
        try {
          if (!ytdlInitialized) {
            sendLog("error", "Cannot download: yt-dlp not initialized")
            sendCallback(callbackName, "{\"error\": \"not_initialized\"}")
            return@execute
          }
          
          sendLog("info", "Starting download: $url")
          sendLog("debug", "Format: ${format ?: "best"}, PlaylistFolder: ${playlistFolder ?: "none"}, isAudioOnly: $isAudioOnly, downloadPath: ${downloadPath ?: "default"}")
          
          val baseDir = if (!downloadPath.isNullOrBlank()) {
            val customDir = File(downloadPath)
            if (customDir.exists() || customDir.mkdirs()) {
              sendLog("info", "Using custom download path: $downloadPath")
              customDir
            } else {
              sendLog("warn", "Custom path not accessible, using default")
              File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Comine")
            }
          } else {
            File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Comine")
          }
          
          val downloadDir = if (!playlistFolder.isNullOrBlank()) {
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
          
          if (ffmpegAvailable && !isAudioOnly) {
            request.addOption("--merge-output-format", "mp4")
            request.addOption("--remux-video", "mp4")
          } else if (isAudioOnly) {
            request.addOption("-x")
            request.addOption("--audio-format", "m4a")
            if (ffmpegAvailable) {
              request.addOption("--embed-thumbnail")
              request.addOption("--convert-thumbnails", "jpg")
              sendLog("info", "Embedding thumbnail as cover art (yt-dlp)")
            } else {
              sendLog("warn", "FFmpeg not available, cannot embed thumbnail")
            }
            sendLog("info", "Audio-only download, extracting to m4a")
          } else if (!ffmpegAvailable) {
            sendLog("warn", "FFmpeg not available, using single-stream format")
          }
          
          if (aria2Available) {
            request.addOption("--downloader", "libaria2c.so")
            val connections = aria2Connections.coerceIn(1, 16)
            val splits = aria2Splits.coerceIn(1, 16)
            val minSplit = if (aria2MinSplitSize.isNullOrBlank()) "1M" else aria2MinSplitSize
            request.addOption("--external-downloader-args", "aria2c:'-x $connections -s $splits -k $minSplit'")
            sendLog("info", "Using aria2 for accelerated download (connections: $connections, splits: $splits, min-split: $minSplit)")
          }
          
          if (speedLimit > 0) {
            request.addOption("--limit-rate", "${speedLimit}M")
            sendLog("info", "Speed limit set to ${speedLimit}M")
          }
          
          if (!format.isNullOrEmpty() && format != "best") {
            request.addOption("-f", format)
          }
          
          activeNotifications[notificationId] = url
          mainHandler.post { showDownloadNotification(notificationId, currentTitle, -1) }
          
          sendLog("debug", "Executing yt-dlp request...")
          
          val response = YoutubeDL.getInstance().execute(request) { progress, etaInSeconds, line ->
            val progressInt = if (progress >= 0) progress.toInt() else -1
            mainHandler.post { showDownloadNotification(notificationId, currentTitle, progressInt) }
            
            if (!line.isNullOrBlank()) {
              sendLog("debug", line)
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
          
          mainHandler.post { hideDownloadNotification(notificationId) }
          
          var filePath: String? = null
          var fileSize: Long = 0
          
          val output = response.out ?: ""
          sendLog("debug", "yt-dlp output length: ${output.length}")
          
          val outputLines = output.lines().takeLast(20)
          sendLog("debug", "Last 20 output lines:")
          outputLines.forEach { sendLog("debug", "  $it") }
          
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
          
          var parsedPath = videoRemuxMatch?.groupValues?.get(1)?.trim()
            ?: ffmpegDestMatch?.groupValues?.get(1)?.trim()
            ?: mergerMatch?.groupValues?.get(1)?.trim()
            ?: extractAudioMatch?.groupValues?.get(1)?.trim()
            ?: destMatch?.groupValues?.get(1)?.trim()
            ?: alreadyMatch?.groupValues?.get(1)?.trim()
          
          sendLog("info", "Parsed file path from output: $parsedPath")
          
          if (parsedPath != null) {
            val parsedFile = File(parsedPath)
            if (parsedFile.exists()) {
              filePath = parsedPath
              sendLog("info", "Verified parsed file exists: $filePath")
            } else {
              sendLog("warn", "Parsed file path doesn't exist: $parsedPath")
              parsedPath = null
            }
          }
          
          if (parsedPath == null) {
            sendLog("debug", "Scanning download directory for newest file: ${downloadDir.absolutePath}")
            val files = downloadDir.listFiles()?.filter { it.isFile }
            if (!files.isNullOrEmpty()) {
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
          
          if (filePath != null) {
            val file = File(filePath)
            if (file.exists()) {
              fileSize = file.length()
              sendLog("info", "Downloaded file: $filePath (${fileSize} bytes)")
            } else {
              sendLog("warn", "File doesn't exist: $filePath")
              filePath = null
            }
          } else {
            sendLog("warn", "No file path found for completed download")
          }
          
          if (response.exitCode == 0) {
            sendLog("info", "Download completed successfully")
            if (filePath != null) {
              val fileName = File(filePath).nameWithoutExtension
              mainHandler.post { showCompletedNotification(notificationId, fileName, filePath) }
            }
          } else {
            sendLog("error", "Download failed with exit code: ${response.exitCode}")
            sendLog("error", "Output: ${response.out}")
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
          mainHandler.post { 
            hideDownloadNotification(notificationId)
            showFailedNotification(notificationId, currentTitle, e.message ?: "Unknown error")
          }
          val errorJson = JSONObject().apply {
            put("error", e.message ?: "Unknown error")
          }.toString()
          sendCallback(callbackName, errorJson)
        }
      }
    }
    
    @JavascriptInterface
    fun downloadWithSettingsV2(url: String, format: String?, playlistFolder: String?, isAudioOnly: Boolean, aria2Connections: Int, aria2Splits: Int, aria2MinSplitSize: String?, speedLimit: Int, downloadPath: String?, youtubePlayerClient: String?, callbackName: String) {
      downloadExecutor.execute {
        val notificationId = getNotificationIdForUrl(url)
        
        var currentTitle = "Downloading..."
        
        try {
          if (!ytdlInitialized) {
            sendLog("error", "Cannot download: yt-dlp not initialized")
            sendCallback(callbackName, "{\"error\": \"not_initialized\"}")
            return@execute
          }
          
          sendLog("info", "Starting download: $url")
          sendLog("debug", "Format: ${format ?: "best"}, PlaylistFolder: ${playlistFolder ?: "none"}, isAudioOnly: $isAudioOnly, downloadPath: ${downloadPath ?: "default"}, playerClient: ${youtubePlayerClient ?: "default"}")
          
          val baseDir = if (!downloadPath.isNullOrBlank()) {
            val customDir = File(downloadPath)
            if (customDir.exists() || customDir.mkdirs()) {
              sendLog("info", "Using custom download path: $downloadPath")
              customDir
            } else {
              sendLog("warn", "Custom path not accessible, using default")
              File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Comine")
            }
          } else {
            File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Comine")
          }
          
          val downloadDir = if (!playlistFolder.isNullOrBlank()) {
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
          
          val isYouTube = url.contains("youtube.com") || url.contains("youtu.be")
          if (isYouTube && !youtubePlayerClient.isNullOrBlank()) {
            request.addOption("--extractor-args", "youtube:player_client=$youtubePlayerClient")
            sendLog("info", "Using YouTube player client: $youtubePlayerClient")
          }
          
          if (ffmpegAvailable && !isAudioOnly) {
            request.addOption("--merge-output-format", "mp4")
            request.addOption("--remux-video", "mp4")
          } else if (isAudioOnly) {
            request.addOption("-x")
            request.addOption("--audio-format", "m4a")
            if (ffmpegAvailable) {
              request.addOption("--embed-thumbnail")
              request.addOption("--convert-thumbnails", "jpg")
              sendLog("info", "Embedding thumbnail as cover art (yt-dlp)")
            } else {
              sendLog("warn", "FFmpeg not available, cannot embed thumbnail")
            }
            sendLog("info", "Audio-only download, extracting to m4a")
          } else if (!ffmpegAvailable) {
            sendLog("warn", "FFmpeg not available, using single-stream format")
          }
          
          if (aria2Available) {
            request.addOption("--downloader", "libaria2c.so")
            val connections = aria2Connections.coerceIn(1, 16)
            val splits = aria2Splits.coerceIn(1, 16)
            val minSplit = if (aria2MinSplitSize.isNullOrBlank()) "1M" else aria2MinSplitSize
            request.addOption("--external-downloader-args", "aria2c:'-x $connections -s $splits -k $minSplit'")
            sendLog("info", "Using aria2 for accelerated download (connections: $connections, splits: $splits, min-split: $minSplit)")
          }
          
          if (speedLimit > 0) {
            request.addOption("--limit-rate", "${speedLimit}M")
            sendLog("info", "Speed limit set to ${speedLimit}M")
          }
          
          if (!format.isNullOrEmpty() && format != "best") {
            request.addOption("-f", format)
          }
          
          activeNotifications[notificationId] = url
          mainHandler.post { showDownloadNotification(notificationId, currentTitle, -1) }
          
          sendLog("debug", "Executing yt-dlp request...")
          
          val response = YoutubeDL.getInstance().execute(request) { progress, etaInSeconds, line ->
            val progressInt = if (progress >= 0) progress.toInt() else -1
            mainHandler.post { showDownloadNotification(notificationId, currentTitle, progressInt) }
            
            if (!line.isNullOrBlank()) {
              sendLog("debug", line)
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
          
          mainHandler.post { hideDownloadNotification(notificationId) }
          
          var filePath: String? = null
          var fileSize: Long = 0
          
          val output = response.out ?: ""
          sendLog("debug", "yt-dlp output length: ${output.length}")
          
          val outputLines = output.lines().takeLast(20)
          sendLog("debug", "Last 20 output lines:")
          outputLines.forEach { sendLog("debug", "  $it") }
          
          val videoRemuxMatch = Regex("""\[VideoRemuxer\].*Destination:\s*(.+)""").findAll(output).lastOrNull()
          val mergerMatch = Regex("""\[Merger\] Merging formats into "(.+?)"""").find(output)
          val ffmpegDestMatch = Regex("""\[ffmpeg\] Destination: (.+)""").findAll(output).lastOrNull()
          val extractAudioMatch = Regex("""\[ExtractAudio\] Destination: (.+)""").findAll(output).lastOrNull()
          val destMatch = Regex("""\[download\] Destination: (.+)""").findAll(output).lastOrNull()
          val alreadyMatch = Regex("""\[download\] (.+?) has already been downloaded""").find(output)
          
          var parsedPath = videoRemuxMatch?.groupValues?.get(1)?.trim()
            ?: ffmpegDestMatch?.groupValues?.get(1)?.trim()
            ?: mergerMatch?.groupValues?.get(1)?.trim()
            ?: extractAudioMatch?.groupValues?.get(1)?.trim()
            ?: destMatch?.groupValues?.get(1)?.trim()
            ?: alreadyMatch?.groupValues?.get(1)?.trim()
          
          sendLog("info", "Parsed file path from output: $parsedPath")
          
          if (parsedPath != null) {
            val parsedFile = File(parsedPath)
            if (parsedFile.exists()) {
              filePath = parsedPath
              sendLog("info", "Verified parsed file exists: $filePath")
            } else {
              sendLog("warn", "Parsed file path doesn't exist: $parsedPath")
              parsedPath = null
            }
          }
          
          if (parsedPath == null) {
            sendLog("debug", "Scanning download directory for newest file: ${downloadDir.absolutePath}")
            val files = downloadDir.listFiles()?.filter { it.isFile }
            if (!files.isNullOrEmpty()) {
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
          
          if (filePath != null) {
            val file = File(filePath)
            if (file.exists()) {
              fileSize = file.length()
              sendLog("info", "Downloaded file: $filePath (${fileSize} bytes)")
            } else {
              sendLog("warn", "File doesn't exist: $filePath")
              filePath = null
            }
          } else {
            sendLog("warn", "No file path found for completed download")
          }
          
          if (response.exitCode == 0) {
            sendLog("info", "Download completed successfully")
            if (filePath != null) {
              val fileName = File(filePath).nameWithoutExtension
              mainHandler.post { showCompletedNotification(notificationId, fileName, filePath) }
            }
          } else {
            sendLog("error", "Download failed with exit code: ${response.exitCode}")
            sendLog("error", "Output: ${response.out}")
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
          mainHandler.post { 
            hideDownloadNotification(notificationId)
            showFailedNotification(notificationId, currentTitle, e.message ?: "Unknown error")
          }
          val errorJson = JSONObject().apply {
            put("error", e.message ?: "Unknown error")
          }.toString()
          sendCallback(callbackName, errorJson)
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
