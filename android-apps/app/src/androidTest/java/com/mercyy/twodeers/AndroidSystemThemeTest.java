package com.mercyy.twodeers;

import android.content.res.Configuration;
import android.util.TypedValue;
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
    public void sharedAppThemePropagatesSystemNightModeToWebView() throws Exception {
        int night = InstrumentationRegistry.getInstrumentation().getTargetContext()
                .getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        assertTrue("Emulator must be explicitly light or dark",
                night == Configuration.UI_MODE_NIGHT_NO || night == Configuration.UI_MODE_NIGHT_YES);

        String expected = night == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";

        try (ActivityScenario<ThemeProbeActivity> scenario =
                     ActivityScenario.launch(ThemeProbeActivity.class)) {
            AtomicReference<Boolean> nativeLight = new AtomicReference<>(null);
            AtomicReference<WebView> webViewRef = new AtomicReference<>(null);

            scenario.onActivity(activity -> {
                TypedValue value = new TypedValue();
                boolean resolved = activity.getTheme().resolveAttribute(
                        android.R.attr.isLightTheme, value, true);
                nativeLight.set(resolved && value.data != 0);
                webViewRef.set(activity.getProbeWebView());
            });

            assertNotNull("AppTheme must resolve android:isLightTheme", nativeLight.get());
            assertEquals("Shared AppTheme must match the emulator night mode",
                    Boolean.valueOf(expected.equals("light")), nativeLight.get());
            assertNotNull("Theme probe must create a WebView", webViewRef.get());

            AtomicReference<String> observed = new AtomicReference<>("no-callback");
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);

            while (System.nanoTime() < deadline) {
                CountDownLatch latch = new CountDownLatch(1);
                WebView web = webViewRef.get();
                web.post(() -> web.evaluateJavascript(
                        "(function(){return (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')+'|'+" +
                        "(document.documentElement.dataset.probeTheme||'not-ready')+'|'+document.readyState;})()",
                        value -> {
                            observed.set(unquote(value));
                            latch.countDown();
                        }));

                if (latch.await(3, TimeUnit.SECONDS)) {
                    String result = observed.get();
                    if (result.startsWith(expected + "|" + expected + "|")) break;
                }
                Thread.sleep(200);
            }

            assertTrue("WebView did not follow the shared AppTheme. Last JS result: " + observed.get(),
                    observed.get().startsWith(expected + "|" + expected + "|"));

            scenario.onActivity(activity -> {
                WebSettings settings = webViewRef.get().getSettings();
                if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                    assertFalse("WebView must not apply a second algorithmic darkening pass",
                            WebSettingsCompat.isAlgorithmicDarkeningAllowed(settings));
                }
            });
        }
    }

    private static String unquote(String value) {
        if (value != null && value.length() >= 2 &&
                value.startsWith("\"") && value.endsWith("\"")) {
            return value.substring(1, value.length() - 1);
        }
        return value == null ? "null" : value;
    }
}
