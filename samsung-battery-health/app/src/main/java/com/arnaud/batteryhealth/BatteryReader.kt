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
    val firstUseDate: String?,
    val capturedAt: String?,
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

    // BatteryManager.BATTERY_PROPERTY_STATE_OF_HEALTH : dispo à l'exécution
    // dès Android 14 mais absent du SDK public 34 (constante du SDK 35).
    private const val PROP_STATE_OF_HEALTH = 10

    private val SYSFS_CYCLE_PATHS = listOf(
        "/sys/class/power_supply/battery/battery_cycle",
        "/sys/class/power_supply/battery/fg_cycle",
        "/sys/class/power_supply/battery/cycle_count",
    )

    private val SYSFS_ASOC_PATHS = listOf(
        "/sys/class/power_supply/battery/batt_asoc",
        "/sys/class/power_supply/battery/asoc",
        "/sys/class/power_supply/battery/fg_asoc",
    )

    private const val SHELL_PREFS = "shell_data"

    // Variantes de nommage de l'asoc selon les versions de One UI.
    private val ASOC_KEYS = listOf("mSavedBatteryAsoc", "mBatteryAsoc", "batt_asoc", "asoc")

    fun hasBatteryStatsPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, "android.permission.BATTERY_STATS") ==
            PackageManager.PERMISSION_GRANTED

    private fun parseAsoc(dump: String?): Int? {
        if (dump.isNullOrBlank()) return null
        // One UI récent : [SS][BattInfo]AsocData efsValue:83
        Regex("""AsocData\s+efsValue\s*[:=]\s*(\d+)""")
            .find(dump)?.groupValues?.get(1)?.toIntOrNull()
            ?.takeIf { it in 1..100 }?.let { return it }
        // Anciens One UI et variantes sysfs.
        return ASOC_KEYS.firstNotNullOfOrNull { key ->
            parseInt(dump, key)?.takeIf { it in 1..100 }
        }
    }

    /** Date de première utilisation Samsung (FirstUseDateData efsValue:20230214). */
    private fun parseFirstUse(dump: String?): String? {
        if (dump.isNullOrBlank()) return null
        val digits = Regex("""FirstUseDateData\s+efsValue\s*[:=]\s*(\d{8})""")
            .find(dump)?.groupValues?.get(1) ?: return null
        return "${digits.substring(6, 8)}/${digits.substring(4, 6)}/${digits.substring(0, 4)}"
    }

    private const val UEVENT_PATH = "/sys/class/power_supply/battery/uevent"

    /** Cherche une clé POWER_SUPPLY_*needle*=valeur dans un uevent sysfs. */
    private fun parseUeventInt(text: String?, needle: String): Int? {
        if (text.isNullOrBlank()) return null
        return Regex("(?im)^POWER_SUPPLY_\\w*${needle}\\w*=(-?\\d+)\\s*$")
            .find(text)?.groupValues?.get(1)?.toIntOrNull()
    }

    private fun readFileQuiet(path: String): String? = try {
        java.io.File(path).readText()
    } catch (_: Throwable) {
        null
    }

    /**
     * Appelée pendant le déblocage, avec un shell adb sous la main : capture
     * les valeurs que seul le shell peut lire (asoc, cycles, y compris via
     * sysfs) et les met en cache local pour les affichages suivants.
     */
    fun cacheShellReadings(context: Context, runCmd: (String) -> String?) {
        try {
            val dump = runCmd("dumpsys battery")
            val uevent = runCmd("cat $UEVENT_PATH")
            val ls = runCmd("ls /sys/class/power_supply/battery/")

            val asoc = parseAsoc(dump)
                ?: parseUeventInt(uevent, "asoc")?.takeIf { it in 1..100 }
                ?: SYSFS_ASOC_PATHS.firstNotNullOfOrNull {
                    runCmd("cat $it")?.trim()?.toIntOrNull()?.takeIf { v -> v in 1..100 }
                }
            val cycle = parseCyclesFromDump(dump)
                ?: parseUeventInt(uevent, "cycle")?.takeIf { it >= 0 }
                ?: SYSFS_CYCLE_PATHS.firstNotNullOfOrNull {
                    runCmd("cat $it")?.trim()?.toIntOrNull()
                }

            val firstUse = parseFirstUse(dump)

            val editor = context.getSharedPreferences(SHELL_PREFS, Context.MODE_PRIVATE).edit()
            asoc?.let { editor.putInt("asoc", it) }
            cycle?.let { editor.putInt("cycle", it) }
            firstUse?.let { editor.putString("first_use", it) }
            // Diagnostic complet, visible dans "données brutes".
            editor.putString("shell_dump", (dump ?: "empty").take(4000))
            editor.putString("shell_uevent", (uevent ?: "empty").take(2000))
            editor.putString("shell_ls", (ls ?: "empty").take(2000))
            editor.putLong("ts", System.currentTimeMillis())
            editor.apply()
        } catch (_: Throwable) {
        }
    }

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
        // Chaque valeur est lue indépendamment : une source qui échoue ne
        // fait plus tomber les autres, et son erreur part dans `raw`.
        val errors = StringBuilder()

        fun <T> safe(label: String, block: () -> T?): T? = try {
            block()
        } catch (t: Throwable) {
            errors.append('[').append(label).append("] ")
                .append(android.util.Log.getStackTraceString(t)).append('\n')
            null
        }

        val shizukuOk = safe("shizuku") { shizukuAvailable() && shizukuGranted() } ?: false
        val dumpGranted = hasDumpPermission(context)

        // Mode précis, seulement si déjà débloqué : d'abord le dump binder
        // direct, sinon l'exécution du binaire dumpsys, sinon Shizuku.
        var dump: String? = null
        if (dumpGranted) {
            dump = safe("dumpBinder") { dumpService("battery") }
            if (dump.isNullOrBlank()) {
                dump = safe("dumpExec") { dumpViaExec() }
            }
        }
        if (dump.isNullOrBlank() && shizukuOk) {
            dump = safe("dumpShizuku") {
                // Rend l'app autonome pour les prochains lancements.
                runShizuku("pm grant ${context.packageName} android.permission.DUMP")
                runShizuku("pm grant ${context.packageName} android.permission.BATTERY_STATS")
                runShizuku("dumpsys battery")
            }
        }

        // Sources autonomes, aucune permission requise.
        val sticky: Intent? = safe("sticky") {
            context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        }
        val bm = safe("batteryManager") {
            context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        }

        val level = safe("level") {
            parseInt(dump, "level") ?: sticky?.let {
                val lvl = it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = it.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                if (lvl >= 0 && scale > 0) lvl * 100 / scale else null
            }
        }
        val temperatureC = safe("temperature") {
            (parseInt(dump, "temperature")
                ?: sticky?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
                    ?.takeIf { it != Int.MIN_VALUE })?.let { it / 10.0 }
        }
        val voltageMv = safe("voltage") {
            parseInt(dump, "voltage")
                ?: sticky?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1)?.takeIf { it > 0 }
        }

        val prefs = context.getSharedPreferences(SHELL_PREFS, Context.MODE_PRIVATE)

        // Lecture directe du uevent du contrôleur, parfois autorisée aux apps.
        val uevent = safe("uevent") { java.io.File(UEVENT_PATH).readText() }

        // Cycles : valeur officielle Android 14+, sinon dump, sinon cache du
        // déblocage, sinon sysfs via Shizuku.
        var cycleApprox = false
        val cycles = safe("cycles") {
            var c: Int? = null
            if (Build.VERSION.SDK_INT >= 34) {
                c = sticky?.getIntExtra(BatteryManager.EXTRA_CYCLE_COUNT, -1)
                    ?.takeIf { it > 0 }
            }
            if (c == null) {
                c = parseCyclesFromDump(dump)?.also { cycleApprox = true }
            }
            if (c == null) {
                c = parseUeventInt(uevent, "cycle")?.takeIf { it >= 0 }
                    ?: SYSFS_CYCLE_PATHS.firstNotNullOfOrNull {
                        readFileQuiet(it)?.trim()?.toIntOrNull()
                    }
            }
            if (c == null) {
                c = prefs.getInt("cycle", -1).takeIf { it >= 0 }
            }
            if (c == null && shizukuOk) {
                c = SYSFS_CYCLE_PATHS.firstNotNullOfOrNull { path ->
                    runShizuku("cat $path")?.trim()?.toIntOrNull()
                }
            }
            c
        }

        // Capacité mesurée vs capacité d'origine. Sur Samsung le compteur de
        // charge est dérivé du niveau affiché (valeur circulaire, toujours
        // ~100 % de la capacité design) : dans ce cas on la masque plutôt que
        // d'afficher un chiffre qui ne mesure rien.
        val chargeCounterUah = safe("chargeCounter") {
            bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)?.takeIf { it > 0 }
        }
        val designMah = safe("designCapacity") { readDesignCapacityMah(context) }
        var estimatedFullMah = if (chargeCounterUah != null && level != null && level >= 10) {
            (chargeCounterUah / 1000.0 * 100.0 / level).roundToInt()
        } else {
            null
        }
        if (estimatedFullMah != null && designMah != null &&
            kotlin.math.abs(estimatedFullMah - designMah) * 100 <= designMah * 3
        ) {
            estimatedFullMah = null
        }

        // Santé : uniquement des valeurs mesurées par le matériel, jamais
        // d'estimation circulaire. ASOC en direct > ASOC capturé au
        // déblocage > API Android officielle.
        var health: Int? = safe("asoc") { parseAsoc(dump) }
        if (health == null) {
            health = safe("asocSysfs") {
                parseUeventInt(uevent, "asoc")?.takeIf { it in 1..100 }
                    ?: SYSFS_ASOC_PATHS.firstNotNullOfOrNull {
                        readFileQuiet(it)?.trim()?.toIntOrNull()?.takeIf { v -> v in 1..100 }
                    }
            }
        }
        // Dump capturé pendant le déblocage (seul canal autorisé sur One UI).
        val cachedDump = prefs.getString("shell_dump", null)
        if (health == null) {
            health = prefs.getInt("asoc", -1).takeIf { it in 1..100 }
                ?: safe("asocCachedDump") { parseAsoc(cachedDump) }
        }
        var source: HealthSource? = if (health != null) HealthSource.ASOC else null
        if (health == null) {
            health = safe("stateOfHealth") {
                if (Build.VERSION.SDK_INT >= 34) {
                    bm?.getIntProperty(PROP_STATE_OF_HEALTH)?.takeIf { it in 1..100 }
                } else {
                    null
                }
            }
            if (health != null) source = HealthSource.ANDROID_API
        }

        val firstUseDate = prefs.getString("first_use", null)
            ?: safe("firstUse") { parseFirstUse(cachedDump) }

        // Date de la dernière capture shell, seulement si la santé en provient.
        val capturedAt = if (source == HealthSource.ASOC && dump.isNullOrBlank()) {
            prefs.getLong("ts", 0L).takeIf { it > 0 }?.let {
                java.text.SimpleDateFormat("dd/MM/yyyy HH:mm", java.util.Locale.getDefault())
                    .format(java.util.Date(it))
            }
        } else {
            null
        }

        val raw = buildString {
            append("== permissions ==\n")
            append("DUMP=").append(dumpGranted)
            append(" BATTERY_STATS=").append(hasBatteryStatsPermission(context))
            append(" asoc_cache=").append(prefs.getInt("asoc", -1))
            append(" cycle_cache=").append(prefs.getInt("cycle", -1))
            append("\n\n")
            if (errors.isNotEmpty()) {
                append("== errors ==\n").append(errors).append('\n')
            }
            append("== battery broadcast ==\n")
            append(safe("stickyDump") { sticky?.extras?.apply { size() }?.toString() } ?: "unavailable")
            append("\n\n== dumpsys battery ==\n")
            append(if (dump.isNullOrBlank()) "unavailable (precise mode not unlocked)" else dump.trim())
            append("\n\n== uevent (direct read) ==\n")
            append(uevent?.trim()?.take(1500) ?: "unreadable")
            append("\n\n== unlock-time capture ==\n")
            val shellLs = prefs.getString("shell_ls", null)
            val shellUevent = prefs.getString("shell_uevent", null)
            val shellDump = prefs.getString("shell_dump", null)
            if (shellLs == null && shellUevent == null && shellDump == null) {
                append("none (run the unlock or a reconnect)")
            } else {
                append("-- ls sysfs --\n").append(shellLs ?: "empty")
                append("\n-- uevent --\n").append(shellUevent ?: "empty")
                append("\n-- dumpsys --\n").append(shellDump ?: "empty")
            }
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
            firstUseDate = firstUseDate,
            capturedAt = capturedAt,
            raw = raw,
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

    /**
     * Dump du service système via IBinder.dump(), nécessite
     * android.permission.DUMP. Les échecs remontent à l'appelant pour être
     * visibles dans le diagnostic.
     */
    @SuppressLint("PrivateApi")
    private fun dumpService(name: String): String? {
        val serviceManager = Class.forName("android.os.ServiceManager")
        val binder = serviceManager
            .getMethod("getService", String::class.java)
            .invoke(null, name) as? IBinder ?: return null
        val pipe = ParcelFileDescriptor.createPipe()
        val readSide = pipe[0]
        val writeSide = pipe[1]
        var dumpError: Throwable? = null
        val writer = Thread {
            try {
                binder.dump(writeSide.fileDescriptor, arrayOf())
            } catch (t: Throwable) {
                dumpError = t
            } finally {
                try {
                    writeSide.close()
                } catch (_: Throwable) {
                }
            }
        }
        writer.start()
        val text = ParcelFileDescriptor.AutoCloseInputStream(readSide)
            .bufferedReader()
            .readText()
        writer.join(5_000)
        dumpError?.let { throw it }
        return text
    }

    /**
     * Variante : exécute le binaire dumpsys. Le contrôle d'accès se fait sur
     * l'uid appelant, qui détient DUMP une fois le déblocage effectué.
     */
    private fun dumpViaExec(): String? {
        val process = Runtime.getRuntime().exec(arrayOf("dumpsys", "battery"))
        val output = process.inputStream.bufferedReader().readText()
        val error = process.errorStream.bufferedReader().readText()
        process.waitFor()
        if (output.isBlank() && error.isNotBlank()) {
            throw IllegalStateException(error.take(500))
        }
        return output.ifBlank { null }
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
