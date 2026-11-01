package com.harrakyy.setorpantau;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SetorPlugin.class); // plugin lokal harus didaftarkan sebelum super.onCreate
        super.onCreate(savedInstanceState);
    }
}
