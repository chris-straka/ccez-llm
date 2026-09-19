package studio.ccez.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge above opts the window out of the framework's
    // adjustResize: the keyboard would overlay the WebView with both
    // viewports never shrinking, stranding the composer underneath
    // it. Feed the IME inset back as content padding instead, so the
    // WebView reflows above the keyboard. Only the IME inset applies
    // — system bars stay the CSS safe-area's job, so closed-keyboard
    // layout never moves. Failures must stay loud (a silent catch
    // here once shipped a dead bridge and an "unfixable" overlap).
    try {
      attachImeInsetBridge()
    } catch (e: Exception) {
      android.util.Log.w("CcezMain", "IME inset bridge failed: ${e.message}")
    }
    // Voice bridge: the Rust side calls Tts without passing contexts.
    Tts.init(this)
    // Secrets bridge: same pattern for the Android Keystore backend.
    Secrets.init(this)
    // Dictation bridge: system SpeechRecognizer behind dictate_start/stop.
    Dictation.init(this)
    // On-device chat bridge: ML Kit Prompt API over AICore (see OnDevice).
    OnDevice.init(this)
    if (isAliasLaunch(intent)) {
      // An alias launch always starts a NEW activity record
      // (launchMode lives on the activity element and never applies to
      // alias launches). While running, hand the share to the real
      // singleTask instance — onNewIntent, no second init — and get out
      // of the way. On cold start there is nothing to hand to (a
      // forwarded launch would only race this instance's own Tauri
      // init), so BECOME the main instance: the share parks in Rust
      // until the frontend drains it. Either way exactly one instance
      // emits to Rust, so shares arrive once.
      if (hasLiveMainTask()) {
        forwardAliasShare(intent)
        finish()
        return
      }
    }
    handleProcessText(intent)
    handleSend(intent)
  }

  /**
   * Native half of the keyboard reflow: with edge-to-edge the
   * framework never resizes the window, so feed the IME inset back
   * as content padding and the WebView glides above the keyboard
   * instead of popping. The web-side visualViewport pin then sees
   * tracked heights and stays out of the way; it remains the
   * fallback for WebViews whose own viewport never shrinks.
   * Retries post-layout when the content view is not ready yet
   * (capped: a missing bridge must log, never spin), and every
   * failure logs — a silent catch here once shipped a dead bridge
   * with an "unfixable" overlap.
   */
  /** Last dispatched IME height; -1 until the first dispatch lands. */
  private var lastImeBottom = -1

  private fun attachImeInsetBridge(retry: Int = 0): Unit {
    val content = findViewById<android.view.View>(android.R.id.content)
    if (content == null) {
      if (retry < 10 && window?.peekDecorView() != null) {
        android.util.Log.w("CcezMain", "IME inset bridge: content view missing, retrying post-layout")
        window.peekDecorView()?.post { attachImeInsetBridge(retry + 1) }
      } else {
        android.util.Log.e("CcezMain", "IME inset bridge: no content view, keyboard will overlay")
      }
      return
    }
    // Re-query handle: rapid hide/show can deliver a stale zero
    // after the re-show started — both compensators then read
    // "closed" while the keyboard covers the composer. Debounced:
    // a no-op when truly closed, a heal when racing.
    val resync = Runnable { ViewCompat.requestApplyInsets(content) }
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      if (imeBottom != lastImeBottom) {
        android.util.Log.i("CcezMain", "IME inset $lastImeBottom -> $imeBottom")
        lastImeBottom = imeBottom
      }
      v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, imeBottom)
      v.removeCallbacks(resync)
      if (imeBottom == 0) v.postDelayed(resync, 120)
      insets
    }
    // Glide, don't jump: the dispatch above lands the FINAL height
    // instantly (black window flash, then the keyboard slides over
    // it). Track the IME animation per frame instead, so the padding
    // rides the keyboard's own top edge. CONTINUE mode: the WebView
    // still needs the inset for its own resizes-content handling.
    ViewCompat.setWindowInsetsAnimationCallback(
      content,
      object : WindowInsetsAnimationCompat.Callback(
        WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE
      ) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: List<WindowInsetsAnimationCompat>
        ): WindowInsetsCompat {
          val imeRunning = runningAnimations.any { anim ->
            anim.typeMask and WindowInsetsCompat.Type.ime() != 0
          }
          if (imeRunning) {
            val b = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            content.setPadding(content.paddingLeft, content.paddingTop, content.paddingRight, b)
          }
          return insets
        }
      }
    )
    ViewCompat.requestApplyInsets(content)
    android.util.Log.i("CcezMain", "IME inset bridge attached")
  }

  /**
   * True when another of our tasks already tops a real MainActivity.
   * The alias task itself never matches (its top is one of the
   * *Action aliases), so this is only true while the app is already
   * running.
   */
  private fun hasLiveMainTask(): Boolean {
    return try {
      val main = "${packageName}.MainActivity"
      val am = getSystemService(ACTIVITY_SERVICE) as android.app.ActivityManager
      am.appTasks.any { task -> task.taskInfo.topActivity?.className == main }
    } catch (_: Exception) {
      false
    }
  }

  /** Which native menu entry was tapped (Annotate/Speak/Inspect). */
  private fun aliasAction(intent: Intent?): String? {
    return when (intent?.component?.className) {
      "${packageName}.AnnotateAction" -> "annotate"
      "${packageName}.SpeakAction" -> "speak"
      "${packageName}.InspectAction" -> "inspect"
      else -> null
    }
  }

  private fun isAliasLaunch(intent: Intent?): Boolean {
    return aliasAction(intent) != null
  }

  private fun forwardAliasShare(intent: Intent?) {
    try {
      val forward = Intent(this, MainActivity::class.java)
      forward.action = Intent.ACTION_PROCESS_TEXT
      forward.putExtra(
        Intent.EXTRA_PROCESS_TEXT,
        intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
      )
      forward.putExtra(EXTERNAL_ACTION_EXTRA, aliasAction(intent))
      forward.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      startActivity(forward)
    } catch (_: Exception) {
    }
  }

  companion object {
    /** Extra naming the tapped native menu entry for handleProcessText. */
    const val EXTERNAL_ACTION_EXTRA = "studio.ccez.app.EXTERNAL_ACTION"
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // singleTask: shares while running arrive here.
    setIntent(intent)
    handleProcessText(intent)
    handleSend(intent)
  }

  private external fun nativeOnExternalText(text: String?, action: String?)

  /**
   * Text shared from another app (OS selection menu → this app):
   * forward to Rust, which emits `annotate-external` for the
   * frontend's action dispatch. The action names the tapped alias
   * entry (annotate/speak/inspect, null for a direct launch, which
   * behaves as annotate). Never throws: a foreign intent must not
   * crash the app.
   */
  private fun handleProcessText(intent: Intent?) {
    try {
      if (intent?.action != Intent.ACTION_PROCESS_TEXT) return
      val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
      val action = intent.getStringExtra(EXTERNAL_ACTION_EXTRA) ?: aliasAction(intent)
      nativeOnExternalText(text, action)
    } catch (_: Exception) {
    }
  }

  /**
   * System Share sheet entry (ACTION_SEND text/plain from any app):
   * forward to Rust, which emits `annotate-external` for the
   * frontend's composer prefill — the same path as PROCESS_TEXT, so
   * the same trim/cap/parking rules apply. EXTRA_TEXT carries the
   * share (Chrome sends the URL, media apps title + URL);
   * EXTRA_SUBJECT is only a fallback for apps that send a subject
   * alone. Null/blank shares reach Rust as null, which emits
   * nothing. Never throws: a foreign intent must not crash the app.
   */
  private fun handleSend(intent: Intent?) {
    try {
      if (intent?.action != Intent.ACTION_SEND) return
      if (intent.type != "text/plain") return
      val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        ?.takeIf { it.isNotBlank() }
        ?: intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString()
      nativeOnExternalText(text, null)
    } catch (_: Exception) {
    }
  }

  // OS selection toolbar: the Annotate/Speak/Inspect entries come
  // from the activity-aliases in the manifest, not from code.
  // Code-added items cannot survive here — AppCompat never consults
  // the activity for floating toolbars (no onActionModeStarted, no
  // usable onWindowStarting* hook), and the menu is rebuilt on every
  // invalidate. The system owns the alias entries (overflow menu —
  // the main pill's buttons are system-fixed), so they are always
  // present; taps forward above into the running singleTask
  // instance when there is one (cold starts become the instance),
  // and the frontend runs the tapped action on text picked in-app
  // versus prefilling outside shares.
}
