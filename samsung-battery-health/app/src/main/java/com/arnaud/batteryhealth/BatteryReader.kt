package com.arnaud.batteryhealth

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.IBinder
import android.os.ParcelFileDescriptor
import androidx.core.content.ContextCompat
import rikka.shizuku.Shizuku

data class BatteryInfo(
    val healthPercent: Int?,
    val cycleCount: Int?,
    val level: Int?,
    val temperatureC: Double?,
    val voltageMv: Int?,
    val raw: String,
)

/**
 * Lit la santé batterie des Samsung en automatisant la méthode du guide
 * r/GalaxyS23 : `dumpsys battery` expose `mSavedBatteryAsoc` (capacité
 * restante en %) et `mSavedBatteryUsage` (valeur / 100 = cycles de charge).
 *
 * Deux sources possibles, dans cet ordre :
 *  1. Dump direct du service "battery" si la permission DUMP est accordée
 *     (une seule commande adb, persiste après redémarrage).
 *  2. Shell Shizuku si l'app Shizuku tourne et a donné son accord. Dans ce
 *     cas on en profite pour s'auto-accorder DUMP : l'app devient autonome.
 */
object BatteryReader {

    private val SYSFS_CYCLE_PATHS = listOf(
        "/sys/class/power_supply/battery/battery_cycle",
        "/sys/class/power_supply/battery/fg_cycle",
        "/sys/class/power_supply/battery/cycle_count",
    )

    fun hasDumpPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, "android.permission.DUMP") ==
            PackageManager.PERMISSION_GRANTED

    fun shizukuAvailable(): Boolean = try {
        Shizuku.pingBinder()
    } catch (t: Throwable) {
        false
    }

    fun shizukuGranted(): Boolean = try {
        Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
    } catch (t: Throwable) {
        false
    }

    fun read(context: Context): BatteryInfo? {
        val shizukuOk = shizukuAvailable() && shizukuGranted()

        val dump: String? = when {
            hasDumpPermission(context) -> dumpService("battery")
            shizukuOk -> {
                // Rend l'app autonome pour les prochains lancements.
                runShizuku("pm grant ${context.packageName} android.permission.DUMP")
                runShizuku("dumpsys battery")
            }
            else -> null
        }
        if (dump.isNullOrBlank()) return null

        var cycles = parseCycles(dump)
        if (cycles == null && shizukuOk) {
            cycles = SYSFS_CYCLE_PATHS.firstNotNullOfOrNull { path ->
                runShizuku("cat $path")?.trim()?.toIntOrNull()
            }
        }

        return BatteryInfo(
            healthPercent = parseInt(dump, "mSavedBatteryAsoc"),
            cycleCount = cycles,
            level = parseInt(dump, "level"),
            temperatureC = parseInt(dump, "temperature")?.let { it / 10.0 },
            voltageMv = parseInt(dump, "voltage"),
            raw = dump.trim(),
        )
    }

    private fun parseInt(dump: String, key: String): Int? =
        Regex("""\b$key[=:]\s*(-?\d+)""").find(dump)?.groupValues?.get(1)?.toIntOrNull()

    private fun parseCycles(dump: String): Int? {
        parseInt(dump, "mSavedBatteryCycle")?.let { return it }
        // mSavedBatteryUsage : les premiers chiffres (valeur / 100) = cycles.
        parseInt(dump, "mSavedBatteryUsage")?.let { return it / 100 }
        return null
    }

    /** Dump du service système via IBinder.dump(), nécessite android.permission.DUMP. */
    @SuppressLint("PrivateApi")
    private fun dumpService(name: String): String? = try {
        val serviceManager = Class.forName("android.os.ServiceManager")
        val binder = serviceManager
            .getMethod("getService", String::class.java)
            .invoke(null, name) as? IBinder
        if (binder == null) {
            null
        } else {
            val pipe = ParcelFileDescriptor.createPipe()
            val readSide = pipe[0]
            val writeSide = pipe[1]
            Thread {
                try {
                    binder.dump(writeSide.fileDescriptor, arrayOf())
                } catch (_: Throwable) {
                } finally {
                    try {
                        writeSide.close()
                    } catch (_: Throwable) {
                    }
                }
            }.start()
            ParcelFileDescriptor.AutoCloseInputStream(readSide)
                .bufferedReader()
                .readText()
        }
    } catch (t: Throwable) {
        null
    }

    /** Exécute une commande shell avec les droits shell de Shizuku. */
    private fun runShizuku(cmd: String): String? = try {
        val method = Shizuku::class.java.getDeclaredMethod(
            "newProcess",
            Array<String>::class.java,
            Array<String>::class.java,
            String::class.java,
        )
        method.isAccessible = true
        val process = method.invoke(null, arrayOf("sh", "-c", cmd), null, null) as Process
        val output = process.inputStream.bufferedReader().readText()
        process.waitFor()
        output.ifBlank { null }
    } catch (t: Throwable) {
        null
    }
}
