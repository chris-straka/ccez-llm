# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# JNI surface invoked from Rust by exact name (tts_android.rs calls
# Tts.init/speak/stop, secrets_android.rs calls Secrets.init/get/set/
# delete, dictation.rs calls Dictation.init/start/stop,
# turn_service.rs calls TurnSvc.keeperStart/keeperStop,
# ondevice.rs calls OnDevice.status/generate/openAicorePage,
# update_android.rs calls Update.*; MainActivity declares
# nativeOnExternalText). Release minification must not rename or strip
# these, or the bridges break only in release builds (debug has
# minification off). Methods called solely from Rust are invisible to
# R8's reference graph, so every bridge object needs its own keep:
# a missing static reads as a silent no-op on native threads and an
# uncaught NoSuchMethodError (app kill) where the call rides a Java
# thread — exactly the missing "Reply coming…" notice plus the
# turn-settle crash, and the fail-soft on-device probe that kept
# listing ML Kit on unsupported hardware.
-keep class studio.ccez.app.Tts {
  public *;
}
-keep class studio.ccez.app.Secrets {
  public *;
}
-keep class studio.ccez.app.Dictation {
  public *;
}
-keep class studio.ccez.app.TurnSvc {
  public *;
}
-keep class studio.ccez.app.OnDevice {
  public *;
}
-keep class studio.ccez.app.Update {
  public *;
}
-keepclasseswithmembernames class studio.ccez.app.MainActivity {
  native <methods>;
}

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile