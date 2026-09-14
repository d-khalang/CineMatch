package com.cinematch.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CredentialVaultPlugin.class);
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        int darkColor = Color.parseColor("#121c17");
        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(darkColor));
        window.setStatusBarColor(darkColor);
        window.setNavigationBarColor(darkColor);

        View decorView = window.getDecorView();
        decorView.setBackgroundColor(darkColor);

        // Ensure the WebView root container matches the dark canvas
        View webview = findViewById(com.getcapacitor.android.R.id.webview);
        if (webview != null && webview.getParent() instanceof View) {
            ((View) webview.getParent()).setBackgroundColor(darkColor);
        }

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
        if (controller != null) {
            // false ensures light icons on dark status/navigation bars
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }
    }
}
