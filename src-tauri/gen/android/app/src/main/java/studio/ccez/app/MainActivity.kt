package studio.ccez.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
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
    // In-app update bridge: system installer for downloaded APKs (see Update).
    Update.init(this)
    // Native turns bridge: foreground-service claim while a reply
    // finishes in the background (see TurnSvc).
    TurnSvc.init(this)
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

  /** Last dispatched IME height; -1 until the first dispatch lands. */
  private var lastImeBottom = -1

  /**
   * Native half of the keyboard reflow: with edge-to-edge the
   * framework never resizes the window, so feed the IME inset back
   * as content padding and the WebView reflows above the keyboard.
   * The web-side visualViewport pin then sees tracked heights and
   * stays out of the way; it remains the fallback for WebViews
   * whose own viewport never shrinks. Retries post-layout when the
   * content view is not ready yet (capped: a missing bridge must
   * log, never spin), and every failure logs — a silent catch here
   * once shipped a dead bridge with an "unfixable" overlap.
   */
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
    // One writer only: the dispatch lands end-state heights (open,
    // closed, toolbar toggles). No animation tracking, no re-query —
    // those extra writers fought the dispatch and shook the prompt.
    // Inset changes still log so logcat shows what the system sent.
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      if (imeBottom != lastImeBottom) {
        android.util.Log.i("CcezMain", "IME inset $lastImeBottom -> $imeBottom")
        lastImeBottom = imeBottom
      }
      v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, imeBottom)
      insets
    }
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

  // Composer-only native menu: synchronous Rust read of the
  // frontend's composer-selection flag (see promptmenu.rs). True only
  // while a live selection sits inside the main prompt.
  private external fun nativePromptMenuAllowed(): Boolean

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

  // In-app text selection: the OS floating toolbar (Copy /
  // Translate / Read Aloud / Maps, plus our own manifest aliases)
  // never shows — the WebView shows its own Annotate / Copy menu
  // and Speak dock instead. The hook hands the framework OUR OWN
  // empty mode rather than clearing or refusing: returning null
  // does NOT suppress (the framework creates the default mode
  // anyway — verified on-device with the pill visible beside
  // refusal logs), and clearing loses to items appended after
  // prepare returns (aliases, handle-drag respawns through paths
  // that never re-enter onWindowStarting). With our mode the
  // WebView's own populate callback never runs, so no items — and
  // no aliases — ever reach a menu. Selection and handles live in
  // the WebView itself and survive an empty menu; external apps
  // keep resolving our aliases through the package manager, which
  // this hook never touches. Owner demand: no OS text menu anywhere
  // in the app except the main prompt and settings fields, which keep
  // their real OS menu while a live selection sits in either
  // (see nativePromptMenuAllowed).
  private var emptySelectionMenu: android.view.Menu? = null

  private fun emptyMenu(): android.view.Menu {
    val cached = emptySelectionMenu
    if (cached != null) return cached
    val created = android.widget.PopupMenu(this, null).menu
    emptySelectionMenu = created
    return created
  }

  override fun onWindowStartingActionMode(
    callback: android.view.ActionMode.Callback,
    type: Int
  ): android.view.ActionMode? {
    if (type == android.view.ActionMode.TYPE_FLOATING) {
      // The main prompt and settings fields keep their real OS menu
      // (Copy / Cut / Paste / Select All): the frontend reports live
      // selections inside either to Rust, and only those pass through
      // to the framework menu. Static text keeps the empty dummy and
      // the WebView menu.
      if (nativePromptMenuAllowed()) {
        android.util.Log.i("CcezMain", "prompt/field selection: real OS menu")
        return super.onWindowStartingActionMode(callback, type)
      }
      android.util.Log.i("CcezMain", "swapping in empty selection mode")
      return object : android.view.ActionMode() {
        override fun setTitle(title: CharSequence?) {}
        override fun setTitle(resId: Int) {}
        override fun setSubtitle(subtitle: CharSequence?) {}
        override fun setSubtitle(resId: Int) {}
        override fun setCustomView(view: android.view.View?) {}
        override fun invalidate() {}
        // Swallowed: finishing would tear down the WebView
        // selection with it, and the handles must survive. The mode
        // shows nothing, so there is nothing to dismiss; the next
        // selection simply swaps in a fresh one.
        override fun finish() {}
        override fun getMenu(): android.view.Menu = emptyMenu()
        override fun getTitle(): CharSequence? = null
        override fun getSubtitle(): CharSequence? = null
        override fun getCustomView(): android.view.View? = null
        override fun getMenuInflater(): android.view.MenuInflater = menuInflater
        override fun getType(): Int = android.view.ActionMode.TYPE_FLOATING
      }
    }
    return super.onWindowStartingActionMode(callback, type)
  }

  // Manifest aliases (Annotate/Speak/Inspect in OTHER apps'
  // selection menus): resolved by the package manager outside this
  // window, so the refusal above never touches them. Taps forward
  // into the running singleTask instance when there is one (cold
  // starts become the instance), and the frontend runs the tapped
  // action on text picked in-app versus prefilling outside shares.
}
