package com.arnaud.batteryhealth

import android.content.ClipData
import android.content.ClipboardManager
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

    private val shizukuListener =
        Shizuku.OnRequestPermissionResultListener { _, _ -> refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<MaterialButton>(R.id.refreshButton).setOnClickListener { refresh() }
        findViewById<MaterialButton>(R.id.copyAdbButton).setOnClickListener { copyAdbCommand() }
        findViewById<MaterialButton>(R.id.shizukuButton).setOnClickListener { askShizuku() }
        findViewById<TextView>(R.id.rawToggle).setOnClickListener { toggleRaw() }

        try {
            Shizuku.addRequestPermissionResultListener(shizukuListener)
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
        refresh()
    }

    private fun refresh() {
        thread {
            val info = BatteryReader.read(this)
            runOnUiThread { bind(info) }
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
            healthSource.text = getString(
                when (info.healthSource) {
                    HealthSource.ASOC -> R.string.source_asoc
                    HealthSource.ANDROID_API -> R.string.source_android
                    else -> R.string.source_estimate
                }
            )
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
        rawText.text = info.raw

        // Le mode précis n'est proposé que si la valeur exacte du contrôleur
        // Samsung n'est pas encore accessible.
        val precise = info.healthSource == HealthSource.ASOC
        setupCard.visibility = if (precise) View.GONE else View.VISIBLE
        shizukuButton.visibility =
            if (!precise && BatteryReader.shizukuAvailable()) View.VISIBLE else View.GONE
    }

    private fun copyAdbCommand() {
        val cmd = "adb shell pm grant $packageName android.permission.DUMP"
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
}
