package com.harrakyy.setorpantau;

import android.os.Bundle;

import com.capacitor.notifications.listener.NotificationService;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SetorPlugin.class); // plugin lokal harus didaftarkan sebelum super.onCreate
        super.onCreate(savedInstanceState);
    }

    // Plugin pembaca notifikasi baru menganggap WebView aktif setelah ada pause→resume, jadi notif pertama
    // setelah app dibuka masuk cache, bukan langsung ke layar. Tandai aktif sendiri selama activity tampil.
    @Override
    public void onResume() {
        super.onResume();
        NotificationService.webViewActive = true;
    }

    @Override
    public void onPause() {
        NotificationService.webViewActive = false;
        super.onPause();
    }
}
