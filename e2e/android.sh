#!/usr/bin/env bash
# E2E di emulator: pasang APK, beri izin Akses Notifikasi, lalu jalankan skenario lewat DevTools WebView
set -euo pipefail
APK=android/app/build/outputs/apk/debug/app-debug.apk
adb wait-for-device
adb install -r "$APK"
adb shell cmd notification allow_listener com.harrakyy.setorpantau/com.capacitor.notifications.listener.NotificationService
adb shell am start -W -n com.harrakyy.setorpantau/.MainActivity
sleep 10
node e2e/android.mjs
