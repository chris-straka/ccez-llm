# Ccez LLM (native Android)
#
# Native Kotlin port of the Tauri 2 app in ~/SWE/ccez-llm.
# Same contract: private BYOK chat, chats stored locally, keys in
# Android Keystore, no accounts, no cloud sync.
#
# v1 scope: chat (multi-chat, branch, rerun, fold/delete/edit,
# collapsible pastes, attachments + token estimates, waypoint strip),
# providers (Muse Spark, DeepSeek, custom OpenAI-compatible, keyless
# on-device Gemma seam), language aids (annotation + pinyin/furigana/
# tashkeel seams), speech (Android TTS + SpeechRecognizer dictation),
# OCR + share-intent import, light/dark/system themes, hardware-keyboard
# shortcuts where they make sense on Android. Desktop-only stays out:
# tray, global summon, traffic lights, desktop menu, auto-updater.
