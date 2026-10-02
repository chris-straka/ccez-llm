package studio.ccez.app.data

/**
 * Fail-closed secret store. Android impl wraps Keystore AES/GCM
 * (EncryptedSharedPreferences); the in-memory fallback NEVER persists,
 * mirroring secrets_android.rs (keyring v3 = in-memory mock on Android).
 */
interface SecretStore {
    fun get(key: String): String?
    fun set(key: String, value: String)
    fun clear(key: String)
}

class InMemorySecretStore : SecretStore {
    private val map = mutableMapOf<String, String>()
    override fun get(key: String): String? = map[key]
    override fun set(key: String, value: String) { map[key] = value }
    override fun clear(key: String) { map.remove(key) }
}

/** Prefs key helper: secrets live under "key:<providerId>", never in plain prefs. */
fun secretKeyFor(providerId: String): String = "key:$providerId"
