package com.mercyy.twodeers;

import android.content.res.Configuration;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class AndroidSystemThemeTest {
    @Test
    public void webViewAndPageFollowTheCurrentAndroidNightMode() throws Exception {
        int night = InstrumentationRegistry.getInstrumentation().getTargetContext()
                .getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        assertTrue(night == Configuration.UI_MODE_NIGHT_NO || night == Configuration.UI_MODE_NIGHT_YES);
        String expected = night == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<String> observed = new AtomicReference<>("not-ready");
            AtomicReference<Boolean> nativeLight = new AtomicReference<>(null);
            scenario.onActivity(activity -> {
                TypedValue v = new TypedValue();
                boolean resolved = activity.getTheme().resolveAttribute(android.R.attr.isLightTheme, v, true);
                nativeLight.set(resolved && v.data != 0);
            });
            assertNotNull(nativeLight.get());
            assertEquals(Boolean.valueOf(expected.equals("light")), nativeLight.get());
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(35);
            while (System.nanoTime() < deadline) {
                CountDownLatch latch = new CountDownLatch(1);
                scenario.onActivity(activity -> {
                    WebView web = findWebView(activity.getWindow().getDecorView());
                    if (web == null) { observed.set("no-webview"); latch.countDown(); return; }
                    web.evaluateJavascript(
                        "(function(){return (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')+'|'+(document.documentElement.dataset.duoThemeResolved||'not-ready');})()",
                        value -> { observed.set(unquote(value)); latch.countDown(); });
                });
                latch.await(1, TimeUnit.SECONDS);
                if ((expected + "|" + expected).equals(observed.get())) break;
                Thread.sleep(250);
            }
            assertEquals(expected + "|" + expected, observed.get());
            scenario.onActivity(activity -> {
                WebView web = findWebView(activity.getWindow().getDecorView());
                WebSettings settings = web.getSettings();
                if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                    assertFalse(WebSettingsCompat.isAlgorithmicDarkeningAllowed(settings));
                }
            });
        }
    }
    private static String unquote(String value) {
        if (value != null && value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }
    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (!(view instanceof ViewGroup)) return null;
        ViewGroup group = (ViewGroup) view;
        for (int i=0; i<group.getChildCount(); i++) {
            WebView found=findWebView(group.getChildAt(i));
            if (found != null) return found;
        }
        return null;
    }
}
