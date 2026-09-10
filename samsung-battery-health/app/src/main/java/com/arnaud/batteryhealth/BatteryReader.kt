package com.arnaud.batteryhealth

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import androidx.core.content.ContextCompat
import rikka.shizuku.Shizuku
import kotlin.math.roundToInt

enum class HealthSource { ASOC, ANDROID_API, ESTIMATE }

data class BatteryInfo(
    val healthPercent: Int?,
    val healthSource: HealthSource?,
    val cycleCount: Int?,
    val cycleApprox: Boolean,
    val level: Int?,
    val temperatureC: Double?,
    val voltageMv: Int?,
    val estimatedFullMah: Int?,
    val designMah: Int?,
    val raw: String,
)

/**
 * Lit la santé batterie des Samsung, en full autonome, en combinant :
 *
 *  1. Android 14+ expose officiellement aux apps normales le nombre de
 *     cycles (EXTRA_CYCLE_COUNT) et un indicateur de santé
 *     (BATTERY_PROPERTY_STATE_OF_HEALTH), sans aucune permission.
 *  2. Estimation par mesure : charge restante (BATTERY_PROPERTY_CHARGE_COUNTER)
 *     rapportée au niveau affiché donne la capacité réelle, comparée à la
 *     capacité d'origine (PowerProfile).
 *  3. Mode précis optionnel : `dumpsys battery` expose `mSavedBatteryAsoc`
 *     (la valeur exacte du contrôleur Samsung, méthode du guide r/GalaxyS23)
 *     si la permission DUMP a été accordée (une commande adb, une fois)
 *     ou via Shizuku, qui en profite pour auto-accorder DUMP.
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

    fun read(context: Context): BatteryInfo {
        val shizukuOk = shizukuAvailable() && shizukuGranted()

        // Mode précis, seulement si déjà débloqué.
        val dump: String? = when {
            hasDumpPermission(context) -> dumpService("battery")
            shizukuOk -> {
                // Rend l'app autonome pour les prochains lancements.
                runShizuku("pm grant ${context.packageName} android.permission.DUMP")
                runShizuku("dumpsys battery")
            }
            else -> null
        }

        // Sources autonomes, aucune permission requise.
        val sticky: Intent? = context.registerReceiver(
            null,
            IntentFilter(Intent.ACTION_BATTERY_CHANGED),
        )
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager

        val level = parseInt(dump, "level") ?: sticky?.let {
            val lvl = it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = it.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            if (lvl >= 0 && scale > 0) lvl * 100 / scale else null
        }
        val temperatureC = (parseInt(dump, "temperature")
            ?: sticky?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
                ?.takeIf { it != Int.MIN_VALUE })?.let { it / 10.0 }
        val voltageMv = parseInt(dump, "voltage")
            ?: sticky?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1)?.takeIf { it > 0 }

        // Cycles : valeur officielle Android 14+, sinon dump, sinon sysfs.
        var cycles: Int? = null
        var cycleApprox = false
        if (Build.VERSION.SDK_INT >= 34) {
            cycles = sticky?.getIntExtra(BatteryManager.EXTRA_CYCLE_COUNT, -1)
                ?.takeIf { it > 0 }
        }
        if (cycles == null) {
            cycles = parseCyclesFromDump(dump)?.also { cycleApprox = true }
        }
        if (cycles == null && shizukuOk) {
            cycles = SYSFS_CYCLE_PATHS.firstNotNullOfOrNull { path ->
                runShizuku("cat $path")?.trim()?.toIntOrNull()
            }
        }

        // Capacité mesurée vs capacité d'origine.
        val chargeCounterUah = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)
            .takeIf { it > 0 }
        val designMah = readDesignCapacityMah(context)
        val estimatedFullMah = if (chargeCounterUah != null && level != null && level >= 10) {
            (chargeCounterUah / 1000.0 * 100.0 / level).roundToInt()
        } else {
            null
        }

        // Santé : ASOC exact > API Android > estimation par mesure.
        var health: Int? = parseInt(dump, "mSavedBatteryAsoc")?.takeIf { it in 1..100 }
        var source: HealthSource? = if (health != null) HealthSource.ASOC else null
        if (health == null && Build.VERSION.SDK_INT >= 34) {
            health = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATE_OF_HEALTH)
                .takeIf { it in 1..100 }
            if (health != null) source = HealthSource.ANDROID_API
        }
        if (health == null && estimatedFullMah != null && designMah != null && designMah > 0) {
            health = (estimatedFullMah * 100.0 / designMah).roundToInt().coerceAtMost(100)
                .takeIf { it in 1..100 }
            if (health != null) source = HealthSource.ESTIMATE
        }

        return BatteryInfo(
            healthPercent = health,
            healthSource = source,
            cycleCount = cycles,
            cycleApprox = cycleApprox,
            level = level,
            temperatureC = temperatureC,
            voltageMv = voltageMv,
            estimatedFullMah = estimatedFullMah,
            designMah = designMah,
            raw = dump?.trim() ?: "",
        )
    }

    private fun parseInt(dump: String?, key: String): Int? {
        if (dump.isNullOrBlank()) return null
        return Regex("""\b$key[=:]\s*(-?\d+)""")
            .find(dump)?.groupValues?.get(1)?.toIntOrNull()
    }

    private fun parseCyclesFromDump(dump: String?): Int? {
        parseInt(dump, "mSavedBatteryCycle")?.let { return it }
        // mSavedBatteryUsage : les premiers chiffres (valeur / 100) = cycles.
        parseInt(dump, "mSavedBatteryUsage")?.let { return it / 100 }
        return null
    }

    /** Capacité d'origine (mAh) déclarée par le constructeur dans PowerProfile. */
    @SuppressLint("PrivateApi")
    private fun readDesignCapacityMah(context: Context): Int? = try {
        val profile = Class.forName("com.android.internal.os.PowerProfile")
            .getConstructor(Context::class.java)
            .newInstance(context)
        val capacity = profile.javaClass
            .getMethod("getBatteryCapacity")
            .invoke(profile) as Double
        capacity.roundToInt().takeIf { it > 100 }
    } catch (t: Throwable) {
        null
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
