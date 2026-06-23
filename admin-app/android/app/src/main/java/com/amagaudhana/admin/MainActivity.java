package com.gonidhi.admin;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the native TFLite ML plugin
        registerPlugin(com.gonidhi.admin.TFLiteDetectorPlugin.class);
        super.onCreate(savedInstanceState);

        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));

        if (getBridge() != null) {
            WebView webView = getBridge().getWebView();
            webView.setBackgroundColor(Color.TRANSPARENT);
            webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        }
    }
}
