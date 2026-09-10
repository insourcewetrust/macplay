package com.arnaud.batteryhealth

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.flyfishxu.kadb.Kadb
import com.flyfishxu.kadb.cert.KadbCert
import com.flyfishxu.kadb.cert.OkioFilePrivateKeyStore
import kotlinx.coroutines.runBlocking
import okio.Path.Companion.toPath
import java.io.File
import java.net.InetAddress
import java.net.NetworkInterface

/**
 * Débloque la permission DUMP sans PC ni Shizuku : l'app s'appaire elle-même
 * au débogage sans fil du téléphone (le code d'association affiché par le
 * système est la demande d'accès à l'utilisateur), puis s'accorde la
 * permission via un shell adb local. À faire une seule fois : la permission
 * survit aux redémarrages.
 */
object AdbUnlocker {

    const val SERVICE_PAIRING = "_adb-tls-pairing._tcp"
    const val SERVICE_CONNECT = "_adb-tls-connect._tcp"

    @Volatile
    private var initialized = false

    /** Persiste la clé adb dans les fichiers privés de l'app (survit aux relances). */
    fun init(context: Context) {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            try {
                val keyFile = File(context.filesDir, "adbkey.pem")
                KadbCert.configure(store = OkioFilePrivateKeyStore(keyFile.absolutePath.toPath()))
                initialized = true
            } catch (_: Throwable) {
            }
        }
    }

    fun pair(context: Context, port: Int, code: String): Throwable? = try {
        init(context)
        runBlocking { Kadb.pair("127.0.0.1", port, code) }
        null
    } catch (t: Throwable) {
        t
    }

    fun grantDump(context: Context, port: Int): Throwable? = try {
        init(context)
        Kadb.create("127.0.0.1", port, connectTimeout = 10_000, socketTimeout = 10_000)
            .use { kadb ->
                fun sh(cmd: String): String? = try {
                    kadb.shell(cmd).allOutput.trim().ifBlank { null }
                } catch (t: Throwable) {
                    null
                }

                sh("pm grant ${context.packageName} android.permission.DUMP")
                sh("pm grant ${context.packageName} android.permission.BATTERY_STATS")

                // Tant que le shell est ouvert, on capture les valeurs que
                // seul lui peut lire (asoc et cycles via sysfs notamment).
                BatteryReader.cacheShellReadings(context, ::sh)
            }
        null
    } catch (t: Throwable) {
        t
    }

    /**
     * Découvre en mDNS le port du débogage sans fil de CE téléphone
     * (les services d'autres appareils du réseau sont ignorés).
     */
    class PortFinder(
        context: Context,
        private val serviceType: String,
        private val onPort: (Int) -> Unit,
    ) {
        private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        private var listener: NsdManager.DiscoveryListener? = null

        fun start() {
            if (listener != null) return
            val l = object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(serviceType: String) {}
                override fun onDiscoveryStopped(serviceType: String) {}
                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
                override fun onServiceLost(serviceInfo: NsdServiceInfo) {}

                override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                    @Suppress("DEPRECATION")
                    nsd.resolveService(
                        serviceInfo,
                        object : NsdManager.ResolveListener {
                            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
                            override fun onServiceResolved(info: NsdServiceInfo) {
                                @Suppress("DEPRECATION")
                                val host = info.host
                                if (info.port > 0 && isLocalAddress(host)) {
                                    onPort(info.port)
                                }
                            }
                        },
                    )
                }
            }
            listener = l
            try {
                nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, l)
            } catch (_: Throwable) {
                listener = null
            }
        }

        fun stop() {
            listener?.let {
                try {
                    nsd.stopServiceDiscovery(it)
                } catch (_: Throwable) {
                }
            }
            listener = null
        }
    }

    private fun isLocalAddress(host: InetAddress?): Boolean {
        if (host == null) return false
        if (host.isLoopbackAddress) return true
        return try {
            NetworkInterface.getNetworkInterfaces().asSequence()
                .flatMap { it.inetAddresses.asSequence() }
                .any { it.hostAddress == host.hostAddress }
        } catch (t: Throwable) {
            false
        }
    }
}
