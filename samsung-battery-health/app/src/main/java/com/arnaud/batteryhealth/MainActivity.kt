package com.arnaud.batteryhealth

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import rikka.shizuku.Shizuku
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private companion object {
        const val SHIZUKU_REQUEST_CODE = 42
    }

    private var fatalMode = false

    private val shizukuListener =
        Shizuku.OnRequestPermissionResultListener { _, _ -> refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            setContentView(R.layout.activity_main)

            findViewById<MaterialButton>(R.id.refreshButton).setOnClickListener { refresh() }
            findViewById<MaterialButton>(R.id.unlockButton).setOnClickListener {
                startActivity(Intent(this, PairingActivity::class.java))
            }
            findViewById<MaterialButton>(R.id.copyAdbButton).setOnClickListener { copyAdbCommand() }
            findViewById<MaterialButton>(R.id.shizukuButton).setOnClickListener { askShizuku() }
            findViewById<TextView>(R.id.rawToggle).setOnClickListener { toggleRaw() }
            findViewById<MaterialButton>(R.id.copyRawButton).setOnClickListener { copyRaw() }
            findViewById<MaterialButton>(R.id.recaptureButton).setOnClickListener {
                startActivity(Intent(this, PairingActivity::class.java))
            }

            try {
                Shizuku.addRequestPermissionResultListener(shizukuListener)
            } catch (_: Throwable) {
            }

            showLastCrashIfAny()
        } catch (t: Throwable) {
            showFatal(t)
        }
    }

    /**
     * Mode de secours : si l'écran normal ne peut même pas se construire,
     * on affiche l'erreur en texte brut (et on la copie dans le presse-papier)
     * au lieu de planter en boucle.
     */
    private fun showFatal(t: Throwable) {
        fatalMode = true
        val trace = android.util.Log.getStackTraceString(t)
        try {
            val text = TextView(this)
            text.text = trace
            text.setTextIsSelectable(true)
            text.setPadding(48, 48, 48, 48)
            val scroll = android.widget.ScrollView(this)
            scroll.addView(text)
            setContentView(scroll)
        } catch (_: Throwable) {
        }
        try {
            val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("crash", trace))
        } catch (_: Throwable) {
        }
    }

    private fun showLastCrashIfAny() {
        try {
            val crashFile = java.io.File(filesDir, App.CRASH_FILE)
            if (!crashFile.exists()) return
            val trace = crashFile.readText()
            com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.crash_title))
                .setMessage(trace.take(3000))
                .setPositiveButton(getString(R.string.crash_copy)) { _, _ ->
                    val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("crash", trace))
                    Toast.makeText(this, getString(R.string.copied), Toast.LENGTH_SHORT).show()
                    crashFile.delete()
                }
                .setNegativeButton(getString(R.string.crash_close)) { _, _ ->
                    crashFile.delete()
                }
                .show()
        } catch (_: Throwable) {
        }
    }

    override fun onDestroy() {
        try {
            Shizuku.removeRequestPermissionResultListener(shizukuListener)
        } catch (_: Throwable) {
        }
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        if (!fatalMode) refresh()
    }

    private fun refresh() {
        thread {
            val info = try {
                BatteryReader.read(this)
            } catch (t: Throwable) {
                BatteryInfo(
                    healthPercent = null, healthSource = null, cycleCount = null,
                    cycleApprox = false, level = null, temperatureC = null,
                    voltageMv = null, estimatedFullMah = null, designMah = null,
                    firstUseDate = null, firstUseMillis = null, capturedAt = null,
                    batteryModel = null, technology = null, statusCode = null,
                    pluggedCode = null, healthCode = null, currentNowMa = null,
                    remainingMah = null, history = emptyList(),
                    raw = android.util.Log.getStackTraceString(t),
                )
            }
            runOnUiThread {
                try {
                    bind(info)
                } catch (_: Throwable) {
                }
            }
        }
    }

    private fun bind(info: BatteryInfo) {
        val setupCard = findViewById<MaterialCardView>(R.id.setupCard)
        val healthValue = findViewById<TextView>(R.id.healthValue)
        val healthLabel = findViewById<TextView>(R.id.healthLabel)
        val healthSource = findViewById<TextView>(R.id.healthSource)
        val cyclesValue = findViewById<TextView>(R.id.cyclesValue)
        val capacityValue = findViewById<TextView>(R.id.capacityValue)
        val levelValue = findViewById<TextView>(R.id.levelValue)
        val tempValue = findViewById<TextView>(R.id.tempValue)
        val voltValue = findViewById<TextView>(R.id.voltValue)
        val rawText = findViewById<TextView>(R.id.rawText)
        val shizukuButton = findViewById<MaterialButton>(R.id.shizukuButton)

        val health = info.healthPercent
        if (health != null) {
            healthValue.text = getString(R.string.percent_format, health)
            healthLabel.text = getString(
                when {
                    health >= 90 -> R.string.health_excellent
                    health >= 80 -> R.string.health_good
                    health >= 70 -> R.string.health_average
                    else -> R.string.health_weak
                }
            )
            healthSource.text = when {
                info.healthSource == HealthSource.ASOC && info.capturedAt != null ->
                    getString(R.string.source_asoc_captured, info.capturedAt)
                info.healthSource == HealthSource.ASOC -> getString(R.string.source_asoc)
                info.healthSource == HealthSource.ANDROID_API -> getString(R.string.source_android)
                else -> getString(R.string.source_estimate)
            }
            healthSource.visibility = View.VISIBLE
        } else {
            healthValue.text = getString(R.string.value_unknown)
            healthLabel.text = getString(R.string.health_not_available)
            healthSource.visibility = View.GONE
        }

        cyclesValue.text = when {
            info.cycleCount == null -> getString(R.string.value_unknown)
            info.cycleApprox -> getString(R.string.cycles_approx_format, info.cycleCount)
            else -> info.cycleCount.toString()
        }
        capacityValue.text = when {
            info.estimatedFullMah != null && info.designMah != null ->
                getString(R.string.capacity_format, info.estimatedFullMah, info.designMah)
            info.estimatedFullMah != null ->
                getString(R.string.capacity_short_format, info.estimatedFullMah)
            else -> getString(R.string.value_unknown)
        }
        levelValue.text = info.level?.let { getString(R.string.percent_format, it) }
            ?: getString(R.string.value_unknown)
        tempValue.text = info.temperatureC?.let { getString(R.string.temp_format, it) }
            ?: getString(R.string.value_unknown)
        voltValue.text = info.voltageMv?.let { getString(R.string.volt_format, it / 1000.0) }
            ?: getString(R.string.value_unknown)

        val firstUseRow = findViewById<View>(R.id.firstUseRow)
        val firstUseValue = findViewById<TextView>(R.id.firstUseValue)
        if (info.firstUseDate != null) {
            firstUseRow.visibility = View.VISIBLE
            firstUseValue.text = info.firstUseDate
        } else {
            firstUseRow.visibility = View.GONE
        }

        findViewById<View>(R.id.cyclesHint).visibility =
            if (info.cycleCount != null && info.cycleApprox) View.VISIBLE else View.GONE

        bindDetails(info)
        bindWear(info)

        rawText.text = info.raw

        // Le mode précis n'est proposé que si la valeur exacte du contrôleur
        // Samsung n'est pas encore accessible.
        val precise = info.healthSource == HealthSource.ASOC
        setupCard.visibility = if (precise) View.GONE else View.VISIBLE
        // Une fois la valeur exacte obtenue, elle vient d'une capture figée :
        // on laisse un accès discret pour la rafraîchir.
        findViewById<MaterialButton>(R.id.recaptureButton).visibility =
            if (precise && info.capturedAt != null) View.VISIBLE else View.GONE
        shizukuButton.visibility =
            if (!precise && BatteryReader.shizukuAvailable()) View.VISIBLE else View.GONE
    }

    private fun bindDetails(info: BatteryInfo) {
        val unknown = getString(R.string.value_unknown)
        findViewById<TextView>(R.id.modelValue).text = info.batteryModel ?: unknown
        findViewById<TextView>(R.id.technologyValue).text = info.technology ?: unknown
        findViewById<TextView>(R.id.statusValue).text = when (info.statusCode) {
            android.os.BatteryManager.BATTERY_STATUS_CHARGING -> getString(R.string.status_charging)
            android.os.BatteryManager.BATTERY_STATUS_DISCHARGING -> getString(R.string.status_discharging)
            android.os.BatteryManager.BATTERY_STATUS_FULL -> getString(R.string.status_full)
            android.os.BatteryManager.BATTERY_STATUS_NOT_CHARGING -> getString(R.string.status_not_charging)
            else -> unknown
        }
        findViewById<TextView>(R.id.pluggedValue).text = when (info.pluggedCode) {
            null -> unknown
            0 -> getString(R.string.plugged_none)
            android.os.BatteryManager.BATTERY_PLUGGED_AC -> getString(R.string.plugged_ac)
            android.os.BatteryManager.BATTERY_PLUGGED_USB -> getString(R.string.plugged_usb)
            android.os.BatteryManager.BATTERY_PLUGGED_WIRELESS -> getString(R.string.plugged_wireless)
            else -> getString(R.string.plugged_other)
        }
        findViewById<TextView>(R.id.currentValue).text =
            info.currentNowMa?.let { getString(R.string.current_format, it) } ?: unknown
        findViewById<TextView>(R.id.remainingValue).text =
            info.remainingMah?.let { getString(R.string.remaining_format, it) } ?: unknown
        findViewById<TextView>(R.id.sysHealthValue).text = when (info.healthCode) {
            android.os.BatteryManager.BATTERY_HEALTH_GOOD -> getString(R.string.sys_health_good)
            android.os.BatteryManager.BATTERY_HEALTH_OVERHEAT -> getString(R.string.sys_health_overheat)
            android.os.BatteryManager.BATTERY_HEALTH_DEAD -> getString(R.string.sys_health_dead)
            android.os.BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> getString(R.string.sys_health_over_voltage)
            android.os.BatteryManager.BATTERY_HEALTH_COLD -> getString(R.string.sys_health_cold)
            android.os.BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> getString(R.string.sys_health_failure)
            null -> unknown
            else -> getString(R.string.sys_health_unknown)
        }
    }

    private fun bindWear(info: BatteryInfo) {
        val chart = findViewById<WearChartView>(R.id.wearChart)
        val summary = findViewById<TextView>(R.id.wearSummary)
        val exact = if (info.healthSource == HealthSource.ASOC) info.healthPercent else null
        val projection = WearModel.build(info.firstUseMillis, info.history, exact)
        chart.setProjection(projection)
        if (projection == null) {
            summary.text = getString(R.string.wear_no_data)
            return
        }
        if (projection.slopePerDay >= 0) {
            summary.text = getString(R.string.wear_flat)
            return
        }
        val fmt = java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale.ENGLISH)
        val text = StringBuilder(
            getString(R.string.wear_summary, projection.yearlyLoss, projection.monthlyLoss)
        )
        val d80 = projection.dateAt80?.let { fmt.format(java.util.Date(it)) }
        val d70 = projection.dateAt70?.let { fmt.format(java.util.Date(it)) }
        when {
            d80 != null && d70 != null -> text.append(' ').append(getString(R.string.wear_dates, d80, d70))
            d80 != null -> text.append(' ').append(getString(R.string.wear_date_80_only, d80))
            d70 != null -> text.append(' ').append(getString(R.string.wear_dates, getString(R.string.never), d70))
        }
        summary.text = text
    }

    private fun copyAdbCommand() {
        val cmd = "adb shell \"pm grant $packageName android.permission.DUMP; " +
            "pm grant $packageName android.permission.BATTERY_STATS\""
        val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("adb", cmd))
        Toast.makeText(this, getString(R.string.copied), Toast.LENGTH_SHORT).show()
    }

    private fun askShizuku() {
        try {
            if (Shizuku.isPreV11()) {
                Toast.makeText(this, getString(R.string.shizuku_too_old), Toast.LENGTH_LONG).show()
                return
            }
            if (BatteryReader.shizukuGranted()) {
                refresh()
            } else {
                Shizuku.requestPermission(SHIZUKU_REQUEST_CODE)
            }
        } catch (t: Throwable) {
            Toast.makeText(this, getString(R.string.shizuku_unavailable), Toast.LENGTH_LONG).show()
        }
    }

    private fun toggleRaw() {
        val rawText = findViewById<TextView>(R.id.rawText)
        rawText.visibility = if (rawText.visibility == View.VISIBLE) View.GONE else View.VISIBLE
    }

    private fun copyRaw() {
        val raw = findViewById<TextView>(R.id.rawText).text?.toString().orEmpty()
        val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("battery-raw", raw))
        Toast.makeText(this, getString(R.string.copied), Toast.LENGTH_SHORT).show()
    }
}
