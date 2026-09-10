package com.arnaud.batteryhealth

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * Assistant de déblocage automatique : appairage local au débogage sans fil
 * puis auto-attribution de la permission DUMP. Aucune autre app ni PC requis.
 */
class PairingActivity : AppCompatActivity() {

    private var pairingFinder: AdbUnlocker.PortFinder? = null
    private val detectedPairingPort = AtomicInteger(-1)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pairing)

        if (Build.VERSION.SDK_INT < 30) {
            Toast.makeText(this, getString(R.string.pairing_needs_android11), Toast.LENGTH_LONG)
                .show()
            finish()
            return
        }

        findViewById<MaterialButton>(R.id.openSettingsButton).setOnClickListener {
            openDeveloperSettings()
        }
        findViewById<MaterialButton>(R.id.pairButton).setOnClickListener {
            startPairing()
        }
        findViewById<MaterialButton>(R.id.reconnectButton).setOnClickListener {
            startReconnect()
        }

        pairingFinder = AdbUnlocker.PortFinder(this, AdbUnlocker.SERVICE_PAIRING) { port ->
            detectedPairingPort.set(port)
            runOnUiThread {
                val portField = findViewById<TextInputEditText>(R.id.portField)
                if (portField.text.isNullOrBlank()) {
                    portField.setText(port.toString())
                }
                findViewById<TextView>(R.id.statusText).text =
                    getString(R.string.pairing_port_detected, port)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        pairingFinder?.start()
        updateDevOptionsHint()
    }

    override fun onPause() {
        pairingFinder?.stop()
        super.onPause()
    }

    private fun updateDevOptionsHint() {
        val enabled = Settings.Global.getInt(
            contentResolver,
            Settings.Global.DEVELOPMENT_SETTINGS_ENABLED,
            0,
        ) == 1
        findViewById<TextView>(R.id.devOptionsHint).text = getString(
            if (enabled) R.string.pairing_step1_ready else R.string.pairing_step1_enable_dev
        )
    }

    private fun openDeveloperSettings() {
        val devEnabled = Settings.Global.getInt(
            contentResolver,
            Settings.Global.DEVELOPMENT_SETTINGS_ENABLED,
            0,
        ) == 1
        val action = if (devEnabled) {
            Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS
        } else {
            Settings.ACTION_DEVICE_INFO_SETTINGS
        }
        try {
            startActivity(Intent(action))
        } catch (t: Throwable) {
            try {
                startActivity(Intent(Settings.ACTION_SETTINGS))
            } catch (_: Throwable) {
            }
        }
    }

    private fun startPairing() {
        val statusText = findViewById<TextView>(R.id.statusText)
        val code = findViewById<TextInputEditText>(R.id.codeField).text?.toString()?.trim()
        val port = findViewById<TextInputEditText>(R.id.portField).text?.toString()?.trim()
            ?.toIntOrNull() ?: detectedPairingPort.get().takeIf { it > 0 }

        if (code.isNullOrBlank() || port == null || port <= 0) {
            statusText.text = getString(R.string.pairing_missing_input)
            return
        }

        findViewById<MaterialButton>(R.id.pairButton).isEnabled = false
        statusText.text = getString(R.string.pairing_in_progress)

        thread {
            val pairError = AdbUnlocker.pair(this, port, code)
            if (pairError != null) {
                showResult(getString(R.string.pairing_failed, pairError.message ?: "?"))
                return@thread
            }
            connectAndGrant()
        }
    }

    /** Si l'appareil est déjà associé, se reconnecte et ré-accorde les permissions. */
    private fun startReconnect() {
        findViewById<MaterialButton>(R.id.pairButton).isEnabled = false
        findViewById<TextView>(R.id.statusText).text = getString(R.string.pairing_connecting)
        thread {
            connectAndGrant()
        }
    }

    private fun connectAndGrant() {
        val statusText = findViewById<TextView>(R.id.statusText)
        runOnUiThread { statusText.text = getString(R.string.pairing_connecting) }

        // Le port de connexion est différent du port d'appairage :
        // on le découvre en mDNS.
        val connectPort = waitForConnectPort()
        if (connectPort == null) {
            showResult(getString(R.string.pairing_no_connect_port))
            return
        }

        val grantError = AdbUnlocker.grantDump(this, connectPort)
        if (grantError != null) {
            showResult(getString(R.string.pairing_failed, grantError.message ?: "?"))
            return
        }

        if (BatteryReader.hasDumpPermission(this)) {
            runOnUiThread {
                Toast.makeText(this, getString(R.string.pairing_success), Toast.LENGTH_LONG)
                    .show()
                finish()
            }
        } else {
            showResult(getString(R.string.pairing_grant_not_effective))
        }
    }

    private fun waitForConnectPort(): Int? {
        val latch = CountDownLatch(1)
        val found = AtomicInteger(-1)
        val finder = AdbUnlocker.PortFinder(this, AdbUnlocker.SERVICE_CONNECT) { port ->
            found.set(port)
            latch.countDown()
        }
        runOnUiThread { finder.start() }
        latch.await(20, TimeUnit.SECONDS)
        runOnUiThread { finder.stop() }
        return found.get().takeIf { it > 0 }
    }

    private fun showResult(message: String) {
        runOnUiThread {
            findViewById<TextView>(R.id.statusText).text = message
            findViewById<MaterialButton>(R.id.pairButton).isEnabled = true
        }
    }
}
