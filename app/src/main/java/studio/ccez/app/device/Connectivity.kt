package studio.ccez.app.device

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Network presence as a flow (offline.ts event wiring). True when a
 * validated internet path exists; emits immediately on collect.
 */
fun Context.connectivityFlow(): Flow<Boolean> = callbackFlow {
    val manager = getSystemService(ConnectivityManager::class.java) ?: run {
        trySend(false)
        close()
        return@callbackFlow
    }
    fun current(): Boolean {
        val net = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(net) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
    trySend(current())
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { trySend(current()) }
        override fun onLost(network: Network) { trySend(current()) }
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            trySend(current())
        }
    }
    manager.registerDefaultNetworkCallback(callback)
    awaitClose { runCatching { manager.unregisterNetworkCallback(callback) } }
}.distinctUntilChanged()
