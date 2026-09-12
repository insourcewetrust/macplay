package com.arnaud.batteryhealth

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * Deux parcours dans le même écran :
 *  - déblocage complet (appairage par code, puis attribution des permissions
 *    et capture) ;
 *  - rafraîchissement (EXTRA_RECONNECT) : l'appareil est déjà associé, on se
 *    reconnecte au débogage sans fil dès qu'il est actif et on recapture,
 *    sans repasser par le code. L'assistant complet reste accessible si la
 *    clé a été perdue.
 */
class PairingActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_RECONNECT = "reconnect"
    }

    private var reconnectMode = false
    private val busy = AtomicBoolean(false)
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

        reconnectMode = intent.getBooleanExtra(EXTRA_RECONNECT, false)

        findViewById<MaterialButton>(R.id.openSettingsButton).setOnClickListener {
            openDeveloperSettings()
        }
        findViewById<MaterialButton>(R.id.pairButton).setOnClickListener { startPairing() }
        findViewById<MaterialButton>(R.id.reconnectButton).setOnClickListener { startReconnect() }

        findViewById<MaterialButton>(R.id.reconnectSettingsButton).setOnClickListener {
            openDeveloperSettings()
        }
        findViewById<MaterialButton>(R.id.reconnectRetryButton).setOnClickListener {
            startReconnect()
        }
        findViewById<MaterialButton>(R.id.pairAgainButton).setOnClickListener {
            showFullAssistant()
        }

        if (reconnectMode) {
            findViewById<View>(R.id.reconnectCard).visibility = View.VISIBLE
            findViewById<View>(R.id.introText).visibility = View.GONE
            findViewById<View>(R.id.step1Card).visibility = View.GONE
            findViewById<View>(R.id.step2Card).visibility = View.GONE
            findViewById<TextView>(R.id.titleText).text = getString(R.string.recapture)
        }

        pairingFinder = AdbUnlocker.PortFinder(this, AdbUnlocker.SERVICE_PAIRING) { port ->
            detectedPairingPort.set(port)
            runOnUiThread {
                val portField = findViewById<TextInputEditText>(R.id.portField)
                if (portField.text.isNullOrBlank()) {
                    portField.setText(port.toString())
                }
                if (!reconnectMode) {
                    findViewById<TextView>(R.id.statusText).text =
                        getString(R.string.pairing_port_detected, port)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        pairingFinder?.start()
        updateDevOptionsHint()
        if (reconnectMode && !busy.get()) {
            if (isWirelessDebuggingOn()) {
                // Le débogage sans fil est actif : on repart tout seul.
                startReconnect()
            } else {
                setStatus(getString(R.string.reconnect_wifi_off))
            }
        }
    }

    override fun onPause() {
        pairingFinder?.stop()
        super.onPause()
    }

    private fun showFullAssistant() {
        reconnectMode = false
        findViewById<View>(R.id.reconnectCard).visibility = View.GONE
        findViewById<View>(R.id.introText).visibility = View.VISIBLE
        findViewById<View>(R.id.step1Card).visibility = View.VISIBLE
        findViewById<View>(R.id.step2Card).visibility = View.VISIBLE
        findViewById<TextView>(R.id.titleText).text = getString(R.string.pairing_title)
        setStatus("")
    }

    private fun isWirelessDebuggingOn(): Boolean = try {
        Settings.Global.getInt(contentResolver, "adb_wifi_enabled", 0) == 1
    } catch (_: Throwable) {
        false
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
        val code = findViewById<TextInputEditText>(R.id.codeField).text?.toString()?.trim()
        val port = findViewById<TextInputEditText>(R.id.portField).text?.toString()?.trim()
            ?.toIntOrNull() ?: detectedPairingPort.get().takeIf { it > 0 }

        if (code.isNullOrBlank() || port == null || port <= 0) {
            setStatus(getString(R.string.pairing_missing_input))
            return
        }
        if (!busy.compareAndSet(false, true)) return

        setButtonsEnabled(false)
        setStatus(getString(R.string.pairing_in_progress))

        thread {
            val pairError = AdbUnlocker.pair(this, port, code)
            if (pairError != null) {
                showResult(getString(R.string.pairing_failed, pairError.message ?: "?"))
                return@thread
            }
            runOnUiThread { setStatus(getString(R.string.pairing_paired_connecting)) }
            connectAndGrant()
        }
    }

    /** Si l'appareil est déjà associé, se reconnecte et ré-accorde les permissions. */
    private fun startReconnect() {
        if (!busy.compareAndSet(false, true)) return
        setButtonsEnabled(false)
        setStatus(getString(R.string.reconnect_connecting))
        thread { connectAndGrant() }
    }

    private fun connectAndGrant() {
        // Le port de connexion est différent du port d'appairage : soit saisi
        // à la main (affiché sous "Adresse IP et port"), soit découvert en mDNS.
        val manualPort = findViewById<TextInputEditText>(R.id.connectPortField)
            .text?.toString()?.trim()?.toIntOrNull()?.takeIf { it > 0 }
        val connectPort = manualPort ?: waitForConnectPort()
        if (connectPort == null) {
            showResult(
                getString(
                    if (isWirelessDebuggingOn()) R.string.pairing_no_connect_port
                    else R.string.reconnect_wifi_off
                )
            )
            return
        }

        val grantError = AdbUnlocker.grantDump(this, connectPort)
        if (grantError != null) {
            showResult(getString(R.string.pairing_failed, grantError.message ?: "?"))
            return
        }

        if (BatteryReader.hasDumpPermission(this)) {
            runOnUiThread {
                Toast.makeText(
                    this,
                    getString(if (reconnectMode) R.string.reconnect_success else R.string.pairing_success),
                    Toast.LENGTH_LONG,
                ).show()
                busy.set(false)
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

    private fun setStatus(message: String) {
        findViewById<TextView>(R.id.statusText).text = message
        findViewById<TextView>(R.id.reconnectStatus).text = message
    }

    private fun setButtonsEnabled(enabled: Boolean) {
        findViewById<MaterialButton>(R.id.pairButton).isEnabled = enabled
        findViewById<MaterialButton>(R.id.reconnectButton).isEnabled = enabled
        findViewById<MaterialButton>(R.id.reconnectRetryButton).isEnabled = enabled
    }

    private fun showResult(message: String) {
        runOnUiThread {
            setStatus(message)
            setButtonsEnabled(true)
            busy.set(false)
        }
    }
}
