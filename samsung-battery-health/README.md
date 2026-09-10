# Battery Health (Samsung)

A small, fully self-contained Android app that automates the
[r/GalaxyS23 guide](https://www.reddit.com/r/GalaxyS23/comments/1k8ue99/extensive_guidecheck_your_battery_health_and/):
it shows the real health of a Samsung battery with no PC, no Shizuku and no root.

The UI is in English by default and in French on phones set to French
(per-app language can be changed in Android 13+ app settings).

## What it shows

- **Remaining capacity**: the exact value from the Samsung charge controller
  (`AsocData` on recent One UI, `mSavedBatteryAsoc` on older ones), with the
  capture date.
- **First use date** of the battery.
- Current level, temperature, voltage, and charge cycles when the phone exposes them.

Only hardware-measured values are ever shown as health. The usual
"charge counter / level" estimate was removed on purpose: on Samsung the
charge counter is derived from the displayed level, so it always reads ~100 %.

## How it gets the exact value

One UI's SELinux policy hides the battery service from app processes, even
with the `DUMP` permission. The only channel that can read it is the phone's
own adb shell, so the app embeds an adb client ([Kadb](https://github.com/flyfishxu/Kadb)):

1. Tap **Unlock (2 min, no PC)**.
2. The app guides you to *Wireless debugging* in developer options and to
   *Pair device with pairing code*. The 6-digit code Android shows is your
   authorization; the pairing port is auto-detected over mDNS.
3. The app pairs, grants itself `DUMP` and `BATTERY_STATS`, and while the
   shell is open captures `dumpsys battery`, the controller's `uevent` and the
   battery sysfs listing. The exact value is parsed from that capture.

The pairing key and the captured data are stored in the app's private
storage, so the value is shown on every launch and updates install over the
top without redoing anything. Wireless debugging can be turned off afterwards.
To refresh the exact value later, tap **Refresh the exact value**, turn
wireless debugging back on and use *Already paired? Reconnect* (no code needed).

Advanced alternatives: the copied adb command
(`pm grant … DUMP` and `BATTERY_STATS` from a PC) or [Shizuku](https://shizuku.rikka.app/).

## Install

### From GitHub Actions

Every push runs the `build-battery-app` workflow. Open the latest run in the
**Actions** tab, download the `BatteryHealth-debug-apk` artifact and install
`app-debug.apk` (unknown sources must be allowed). The debug signing key is
committed, so the signature is stable and updates install over the previous
version.

### From Android Studio

Open `samsung-battery-health/` and run the app, or `./gradlew assembleDebug`.

## Reading the result

| Remaining capacity | Status |
|---|---|
| ≥ 90 % | Excellent |
| 80 to 89 % | Good |
| 70 to 79 % | Average, keep an eye on it |
| < 70 % | Weak, consider a replacement |

**Show raw data** lists the permission state, any per-source errors, the
battery broadcast and the full unlock-time capture; **Copy** puts it all on
the clipboard.
