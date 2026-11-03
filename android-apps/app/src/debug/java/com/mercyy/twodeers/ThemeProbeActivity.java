package com.mercyy.twodeers;

import android.app.Activity;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

/**
 * A deliberately small WebView host for verifying Android theme propagation.
 * This activity exists only in debug builds and uses the real application
 * AppTheme, without booting the full application page or unrelated services.
 */
public final class ThemeProbeActivity extends Activity {
    private WebView probeWebView;

    private static final String PROBE_HTML =
            "<!doctype html><html><head><meta charset='utf-8'>" +
            "<meta name='color-scheme' content='light dark'></head><body>" +
            "<script>document.documentElement.dataset.probeTheme=" +
            "matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';</script>" +
            "</body></html>";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        probeWebView = new WebView(this);
        root.addView(probeWebView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings settings = probeWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
        }
        probeWebView.loadDataWithBaseURL(
                "https://theme-probe.invalid/", PROBE_HTML, "text/html", "UTF-8", null);
    }

    WebView getProbeWebView() {
        return probeWebView;
    }

    @Override
    protected void onDestroy() {
        if (probeWebView != null) {
            probeWebView.destroy();
            probeWebView = null;
        }
        super.onDestroy();
    }
}
