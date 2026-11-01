package com.harrakyy.setorpantau;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Jembatan JS → native: notifikasi khusus Setor dan cek kesehatan HP (izin & baterai). */
@CapacitorPlugin(name = "Setor", permissions = {@Permission(alias = "notify", strings = {Manifest.permission.POST_NOTIFICATIONS})})
public class SetorPlugin extends Plugin {

    @PluginMethod
    public void notify(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("key wajib diisi");
            return;
        }
        SetorNotifier.show(getContext(), key, call.getString("title", ""), call.getString("text", ""));
        call.resolve();
    }

    @PluginMethod
    public void health(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        JSObject ret = new JSObject();
        ret.put("notify", SetorNotifier.canNotify(getContext()));
        ret.put("battery", Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        ret.put("brand", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotify(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notify") == PermissionState.GRANTED) {
            call.resolve(new JSObject().put("notify", true));
            return;
        }
        requestPermissionForAlias("notify", call, "notifyResult");
    }

    @PermissionCallback
    private void notifyResult(PluginCall call) {
        call.resolve(new JSObject().put("notify", getPermissionState("notify") == PermissionState.GRANTED));
    }

    /** Daftar pengecualian baterai sistem (tanpa izin khusus yang dibatasi Play Store). */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            getContext().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.parse("package:" + getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }
}
