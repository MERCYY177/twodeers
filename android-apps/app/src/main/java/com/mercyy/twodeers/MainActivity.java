package com.mercyy.twodeers;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

import java.io.IOException;
import java.io.OutputStream;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/assets/site/index.html";
    private static final int FILE_CHOOSER_REQUEST = 4107;
    private static final int BACKUP_SAVE_REQUEST = 4108;
    private static final long MAX_BACKUP_BYTES = 1024L * 1024L * 1024L;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private WebViewAssetLoader assetLoader;
    private final Object saveLock = new Object();
    private OutputStream saveStream;
    private long expectedBytes;
    private long writtenBytes;

    private static final String INSTALL_NATIVE_DOWNLOAD = """
        (function(){
          if(window.__duoNativeDownloadInstalled)return;
          function install(){
            var original=window.triggerDownloadBlob;
            if(typeof original!=='function'){setTimeout(install,100);return;}
            if(original.__duoNativeWrapper){window.__duoNativeDownloadInstalled=true;return;}
            var wrapped=function(name,blob){
              var bridge=window.DuoBackupBridge;
              if(!bridge||!(blob instanceof Blob))return original.apply(this,arguments);
              var link=document.getElementById('duo-native-save-link');
              if(!link){
                link=document.createElement('button');
                link.id='duo-native-save-link';
                link.type='button';
                link.style.cssText='position:fixed;z-index:2147483647;left:50%;bottom:calc(env(safe-area-inset-bottom) + 18px);transform:translateX(-50%);padding:13px 20px;border:0;border-radius:24px;background:#526d3e;color:#fff;font:600 14px sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
                document.body.appendChild(link);
              }
              link.textContent='保存备份到手机…';
              link.onclick=function(){
                if(link.dataset.saving==='1')return;
                link.dataset.saving='1';link.textContent='正在打开系统保存窗口…';
                window.__duoNativeSavePickerResult=function(ok,message){
                  if(!ok){delete link.dataset.saving;link.textContent='重新选择保存位置';if(message)alert(message);return;}
                  (async function(){
                    var offset=0,chunkSize=24*1024;
                    while(offset<blob.size){
                      var bytes=new Uint8Array(await blob.slice(offset,Math.min(blob.size,offset+chunkSize)).arrayBuffer());
                      var binary='';for(var i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
                      if(!bridge.writeChunk(btoa(binary)))throw new Error('写入手机文件失败');
                      offset+=bytes.length;
                    }
                    if(!bridge.finishSave())throw new Error('保存失败：写入字节数量不匹配');
                    delete link.dataset.saving;link.textContent='已保存到手机文件';
                    if(typeof window.showToast==='function')window.showToast('备份已保存到所选位置');
                  })().catch(function(error){try{bridge.cancelSave();}catch(_){}delete link.dataset.saving;link.textContent='重新保存文件';alert('备份保存失败：'+(error.message||error));});
                };
                try{bridge.requestSave(String(name||'双人空间备份.zip'),String(blob.type||'application/zip'),Number(blob.size));}
                catch(error){delete link.dataset.saving;link.textContent='重新保存文件';alert('无法打开系统保存窗口：'+(error.message||error));}
              };
              return true;
            };
            wrapped.__duoNativeWrapper=true;
            window.triggerDownloadBlob=wrapped;
            window.__duoNativeDownloadInstalled=true;
          }
          install();
        })();
        """;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        webView.addJavascriptInterface(new BackupBridge(), "DuoBackupBridge");
        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDefaultTextEncodingName("UTF-8");
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && url.startsWith("https://" + HOST + "/")) {
                    view.evaluateJavascript(INSTALL_NATIVE_DOWNLOAD, null);
                }
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost())) return false;
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                if ("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) webView.loadUrl(HOME);
    }

    private final class BackupBridge {
        @JavascriptInterface
        public void requestSave(String name, String mimeType, long size) {
            if (size <= 0 || size > MAX_BACKUP_BYTES) {
                notifyPicker(false, "备份文件为空或超过 1 GB 单文件保存上限");
                return;
            }
            synchronized (saveLock) {
                closeSaveStreamLocked();
                expectedBytes = size;
                writtenBytes = 0;
            }
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(safeMime(mimeType));
                    intent.putExtra(Intent.EXTRA_TITLE, safeName(name));
                    startActivityForResult(intent, BACKUP_SAVE_REQUEST);
                } catch (Exception e) {
                    cancelSave();
                    notifyPicker(false, "无法打开 Android 系统文件保存窗口");
                }
            });
        }

        @JavascriptInterface
        public boolean writeChunk(String base64) {
            if (base64 == null || base64.length() > 64 * 1024) return false;
            synchronized (saveLock) {
                if (saveStream == null) return false;
                try {
                    byte[] data = Base64.decode(base64, Base64.DEFAULT);
                    if (writtenBytes + data.length > expectedBytes) return false;
                    saveStream.write(data);
                    writtenBytes += data.length;
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }
        }

        @JavascriptInterface
        public boolean finishSave() {
            synchronized (saveLock) {
                if (saveStream == null || writtenBytes != expectedBytes) return false;
                try {
                    saveStream.flush();
                    saveStream.close();
                    saveStream = null;
                    expectedBytes = 0;
                    writtenBytes = 0;
                    return true;
                } catch (IOException e) {
                    closeSaveStreamLocked();
                    return false;
                }
            }
        }

        @JavascriptInterface
        public void cancelSave() { cancelSaveInternal(); }
    }

    private void cancelSave() { cancelSaveInternal(); }

    private void cancelSaveInternal() {
        synchronized (saveLock) {
            closeSaveStreamLocked();
            expectedBytes = 0;
            writtenBytes = 0;
        }
    }

    private void closeSaveStreamLocked() {
        if (saveStream != null) {
            try { saveStream.close(); } catch (IOException ignored) {}
            saveStream = null;
        }
    }

    private void notifyPicker(boolean ok, String message) {
        if (webView == null) return;
        String safe = org.json.JSONObject.quote(message == null ? "" : message);
        String js = "if(window.__duoNativeSavePickerResult)window.__duoNativeSavePickerResult(" + ok + "," + safe + ");";
        runOnUiThread(() -> { if (webView != null) webView.evaluateJavascript(js, null); });
    }

    private String safeMime(String mime) {
        if (mime != null && mime.toLowerCase().contains("zip")) return "application/zip";
        if (mime != null && mime.toLowerCase().contains("json")) return "application/json";
        return "application/octet-stream";
    }

    private String safeName(String name) {
        String source = name == null ? "two-deers-backup.zip" : name.trim();
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < source.length() && out.length() < 120; i++) {
            char c = source.charAt(i);
            out.append(c < 32 || "\\/:*?\"<>|".indexOf(c) >= 0 ? '_' : c);
        }
        return out.length() == 0 ? "two-deers-backup.zip" : out.toString();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            Uri[] result = resultCode == RESULT_OK && data != null && data.getData() != null
                    ? new Uri[]{data.getData()} : null;
            fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
            return;
        }
        if (requestCode == BACKUP_SAVE_REQUEST) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                cancelSaveInternal();
                notifyPicker(false, "已取消保存位置选择");
                return;
            }
            try {
                OutputStream output = getContentResolver().openOutputStream(data.getData(), "w");
                if (output == null) throw new IOException("无法打开目标文件");
                synchronized (saveLock) { closeSaveStreamLocked(); saveStream = output; }
                notifyPicker(true, "");
            } catch (Exception e) {
                cancelSaveInternal();
                notifyPicker(false, "无法创建备份文件：" + e.getMessage());
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        cancelSaveInternal();
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
