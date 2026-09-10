package com.arnaud.batteryhealth

import android.app.Application
import android.util.Log
import java.io.File

class App : Application() {

    companion object {
        const val CRASH_FILE = "last_crash.txt"
    }

    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                File(filesDir, CRASH_FILE).writeText(
                    "Thread: ${thread.name}\n" + Log.getStackTraceString(throwable)
                )
            } catch (_: Throwable) {
            }
            previous?.uncaughtException(thread, throwable)
        }
    }
}
