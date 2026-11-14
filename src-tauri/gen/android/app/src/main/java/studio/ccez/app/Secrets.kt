package studio.ccez.app

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * API-key storage for the Rust bridge (`secrets_android.rs`).
 *
 * The `keyring` crate has no Android backend (it falls back to an
 * in-memory mock), so secrets live here instead: one AES/GCM key in
 * the AndroidKeyStore envelopes every value, ciphertext lands in a
 * private SharedPreferences file. No new dependency — raw
 * `javax.crypto` only (minSdk 24 covers KeyGenParameterSpec).
 *
 * [init] runs from `MainActivity.onCreate`, so the Rust side never
 * passes contexts through JNI. Every entry returns null/false on
 * failure instead of throwing: a broken store must read as "no key",
 * never as a crash. Writes use `commit()` (synchronous) so a
 * force-stop right after saving can't lose the key.
 */
object Secrets {
    private lateinit var appContext: Context

    private external fun nativeInit(activity: Activity)

    /** Called once from `MainActivity.onCreate` (UI thread). */
    @JvmStatic
    fun init(activity: Activity) {
        appContext = activity.applicationContext
        // Hand the JVM to Rust: VM + this class for later commands.
        nativeInit(activity)
    }

    private const val PREFS = "ccez_secrets"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "ccez-secrets-v1"
    private const val GCM_TAG_BITS = 128
    private const val IV_BYTES = 12

    private fun prefs() =
        appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey? = try {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
            ?: run {
                val gen = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES,
                    ANDROID_KEYSTORE
                )
                gen.init(
                    KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
                gen.generateKey()
            }
    } catch (_: Exception) {
        null
    }

    /**
     * Stored secret, or null when missing or unreadable. The provider-key
     * bundle gets Muse's key from ccez-keys (Keyring) when it answers;
     * then the copy stored here is removed (ccez-keys holds the one key).
     */
    @JvmStatic
    fun get(service: String, account: String): String? {
        if (!::appContext.isInitialized) return null
        val stored = stored(service, account)
        if (account != BUNDLE) return stored
        val muse = (Keyring.key(appContext) as? Keyring.Answer.Key)?.key ?: return stored
        val keys = bundle(stored)
        if (keys.containsKey(MUSE)) {
            keys.remove(MUSE)
            store(service, account, encode(keys))
        }
        keys[MUSE] = muse
        return encode(keys)
    }

    /** Writes [secret]; Muse's key isn't kept in the bundle while ccez-keys holds it. */
    @JvmStatic
    fun set(service: String, account: String, secret: String): Boolean {
        if (account != BUNDLE || !::appContext.isInitialized) return store(service, account, secret)
        if (Keyring.key(appContext) !is Keyring.Answer.Key) return store(service, account, secret)
        return store(service, account, encode(bundle(secret).apply { remove(MUSE) }))
    }

    /** ccez-llm's `SECRET_BUNDLE_ACCOUNT` and Muse's provider id (src/lib/secrets.ts, registry.ts). */
    private const val BUNDLE = "providers"
    private const val MUSE = "muse"

    private fun bundle(raw: String?): java.util.TreeMap<String, String> {
        val out = java.util.TreeMap<String, String>()
        runCatching {
            val o = org.json.JSONObject(raw ?: return out)
            o.keys().forEach { k -> o.optString(k).takeIf { it.isNotEmpty() }?.let { out[k] = it } }
        }
        return out
    }

    /** As the frontend's encodeSecretBundle: sorted keys, non-empty values. */
    private fun encode(keys: Map<String, String>): String = org.json.JSONObject(keys as Map<*, *>).toString()

    private fun stored(service: String, account: String): String? {
        if (!::appContext.isInitialized) return null
        return try {
            val raw = prefs().getString("$service/$account", null) ?: return null
            val blob = Base64.decode(raw, Base64.NO_WRAP)
            if (blob.size <= IV_BYTES) return null
            val secret = key() ?: return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                secret,
                GCMParameterSpec(GCM_TAG_BITS, blob, 0, IV_BYTES)
            )
            String(
                cipher.doFinal(blob, IV_BYTES, blob.size - IV_BYTES),
                Charsets.UTF_8
            )
        } catch (_: Exception) {
            null
        }
    }

    /** True when the secret is durably stored. */
    private fun store(service: String, account: String, secret: String): Boolean {
        if (!::appContext.isInitialized) return false
        return try {
            val k = key() ?: return false
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, k)
            val iv = cipher.iv
            val cipherText = cipher.doFinal(secret.toByteArray(Charsets.UTF_8))
            val blob = iv + cipherText
            prefs().edit()
                .putString("$service/$account", Base64.encodeToString(blob, Base64.NO_WRAP))
                .commit()
        } catch (_: Exception) {
            false
        }
    }

    /** True always: a missing entry is not an error. */
    @JvmStatic
    fun delete(service: String, account: String): Boolean {
        if (!::appContext.isInitialized) return false
        return try {
            prefs().edit().remove("$service/$account").commit()
        } catch (_: Exception) {
            false
        }
    }
}
