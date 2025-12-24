# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ================= Size Optimization =================
-optimizationpasses 5
-allowaccessmodification
-repackageclasses ''

# Remove logging in release for smaller size
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}

# ================= Keep Rules =================

# Keep youtubedl-android classes
-keep class com.yausername.youtubedl_android.** { *; }
-keep class com.yausername.ffmpeg.** { *; }
-keep class com.yausername.aria2c.** { *; }

# Keep our MainActivity and all inner classes
-keep class com.nichind.comine.** { *; }
-keep class com.nichind.comine.MainActivity$* { *; }

# Keep Tauri classes
-keep class app.tauri.** { *; }
-keep class app.tauri.plugin.** { *; }

# Keep WebView and JavaScript interfaces
-keep class android.webkit.** { *; }
-keep class androidx.webkit.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep JSON classes
-keep class org.json.** { *; }

# Keep reflection
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Don't warn about missing classes
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.naming.**

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Preserve line numbers for debugging crashes
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile