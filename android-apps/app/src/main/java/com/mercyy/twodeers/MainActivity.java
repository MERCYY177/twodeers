package com.mercyy.twodeers;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String HOME = ORIGIN + "/assets/site/index.html";
    private static final int FILE_CHOOSER_REQUEST = 4107;
    private static final int BACKUP_SAVE_REQUEST = 4108;
    private static final int MAX_CHUNK_BYTES = 24 * 1024;
    private static final long MAX_BACKUP_BYTES = 1024L * 1024L * 1024L;
    private static final Pattern TASK_ID = Pattern.compile("^[a-zA-Z0-9_-]{8,100}$");
    private static final Pattern SHA256 = Pattern.compile("^[a-fA-F0-9]{64}$");

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private WebViewAssetLoader assetLoader;
    private JavaScriptReplyProxy saveReplyProxy;
    private final Object saveLock = new Object();
    private OutputStream saveStream;
    private long expectedBytes;
    private long writtenBytes;
    private int nextChunkIndex;
    private String activeTaskId;
    private String expectedSha256;
    private MessageDigest writeDigest;
    private Uri currentSaveUri;

    private static final String INSTALL_NATIVE_DOWNLOAD = """
        (function(){
          if(window.__duoNativeDownloadInstalled)return;
          function install(){
            var original=window.triggerDownloadBlob;
            if(typeof original!=='function'){setTimeout(install,100);return;}
            if(original.__duoNativeWrapper){window.__duoNativeDownloadInstalled=true;return;}
            var bridge=window.DuoBackupBridge;
            if(!bridge||typeof bridge.postMessage!=='function'){
              window.__duoNativeDownloadInstalled=true;
              return;
            }
            var wrapped=function(name,blob){
              if(!blob||Object.prototype.toString.call(blob)!=='[object Blob]'||
                 typeof blob.slice!=='function'||typeof blob.arrayBuffer!=='function'){
                return original.apply(this,arguments);
              }
              var link=document.getElementById('duo-native-save-link');
              if(!link){
                link=document.createElement('button');
                link.id='duo-native-save-link';
                link.type='button';
                link.style.cssText='position:fixed;z-index:2147483647;left:50%;bottom:calc(env(safe-area-inset-bottom) + 18px);transform:translateX(-50%);padding:13px 20px;border:0;border-radius:24px;background:#526d3e;color:#fff;font:600 14px sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
                document.body.appendChild(link);
              }
              var taskId=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():('backup_'+Date.now()+'_'+Math.random().toString(36).slice(2));
              var pending=new Map();
              bridge.onmessage=function(event){
                var message;
                try{message=JSON.parse(event.data);}catch(_){return;}
                var key=message.type+':'+(message.index===undefined?'':message.index);
                var waiter=pending.get(key);
                if(waiter){pending.delete(key);waiter(message);}
              };
              function send(type,fields){
                return new Promise(function(resolve,reject){
                  var key=type==='request'?'request-result':(type==='chunk'?'chunk-result:'+fields.index:'finish-result');
                  var timeout=setTimeout(function(){pending.delete(key);reject(new Error('Android 文件桥接响应超时'));},30000);
                  pending.set(key,function(message){clearTimeout(timeout);resolve(message);});
                  try{bridge.postMessage(JSON.stringify(Object.assign({type:type,taskId:taskId},fields||{})));}
                  catch(error){clearTimeout(timeout);pending.delete(key);reject(error);}
                });
              }
              link.textContent='保存备份到手机…';
              link.onclick=async function(){
                if(link.dataset.saving==='1')return;
                link.dataset.saving='1';link.textContent='正在校验并打开系统保存窗口…';
                try{
                  if(!window.__duoBackupV4||typeof window.__duoBackupV4.inspect!=='function')throw new Error('缺少备份 SHA-256 校验器');
                  var integrity=await window.__duoBackupV4.inspect(blob);
                  var picked=await send('request',{name:String(name||'双人空间备份.zip'),mimeType:String(blob.type||'application/zip'),size:Number(blob.size),sha256:integrity.sha256});
                  if(!picked.ok)throw new Error(picked.message||'用户取消或无法创建保存文件');
                  var offset=0,index=0,chunkSize=24576;
                  while(offset<blob.size){
                    var bytes=new Uint8Array(await blob.slice(offset,Math.min(blob.size,offset+chunkSize)).arrayBuffer());
                    var binary='';for(var i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
                    var result=await send('chunk',{index:index,data:btoa(binary)});
                    if(!result.ok)throw new Error(result.message||('第 '+index+' 个文件分块写入失败'));
                    offset+=bytes.length;index++;
                  }
                  var finished=await send('finish',{chunks:index});
                  if(!finished.ok)throw new Error(finished.message||'保存文件完整性验证失败');
                  delete link.dataset.saving;
                  link.textContent=finished.verified?'已保存并回读校验':'已保存（目标位置不支持完整回读校验）';
                  if(typeof window.showToast==='function')window.showToast(finished.message||'备份文件保存完成');
                }catch(error){
                  try{bridge.postMessage(JSON.stringify({type:'cancel',taskId:taskId}));}catch(_){}
                  pending.clear();delete link.dataset.saving;link.textContent='重新保存文件';
                  alert('备份保存失败：'+(error.message||error));
                }
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

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                    webView,
                    "DuoBackupBridge",
                    Collections.singleton(ORIGIN),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (!isMainFrame || !isTrustedOrigin(sourceOrigin)) return;
                        handleBackupMessage(message, replyProxy);
                    });
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (isTrustedUrl(url) && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
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
                if (isTrustedOrigin(uri)) return false;
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
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

    private boolean isTrustedUrl(String value) {
        if (value == null) return false;
        Uri uri = Uri.parse(value);
        return isTrustedOrigin(uri) && "/assets/site/index.html".equals(uri.getPath());
    }

    private boolean isTrustedOrigin(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
                && HOST.equalsIgnoreCase(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void handleBackupMessage(WebMessageCompat message, JavaScriptReplyProxy replyProxy) {
        if (message == null || message.getData() == null || message.getData().length() > 64 * 1024) return;
        try {
            JSONObject data = new JSONObject(message.getData());
            String type = data.optString("type", "");
            String taskId = data.optString("taskId", "");
            saveReplyProxy = replyProxy;
            switch (type) {
                case "request": beginSave(data, taskId); break;
                case "chunk": writeChunk(data, taskId); break;
                case "finish": finishSave(data, taskId); break;
                case "cancel": cancelTask(taskId); break;
                default: reply(type + "-result", taskId, false, false, "未知的文件保存操作");
            }
        } catch (Exception error) {
            reply("error", "", false, false, "文件保存消息格式无效：" + error.getMessage());
        }
    }

    private void beginSave(JSONObject data, String taskId) {
        String name = data.optString("name", "two-deers-backup.zip");
        String mime = data.optString("mimeType", "application/zip");
        long size = data.optLong("size", -1);
        String sha = data.optString("sha256", "");
        if (!TASK_ID.matcher(taskId).matches() || size <= 0 || size > MAX_BACKUP_BYTES || !SHA256.matcher(sha).matches()) {
            reply("request-result", taskId, false, false, "备份任务参数无效或超过 1 GB 上限");
            return;
        }
        synchronized (saveLock) {
            cancelSaveLocked();
            activeTaskId = taskId;
            expectedBytes = size;
            writtenBytes = 0;
            nextChunkIndex = 0;
            expectedSha256 = sha.toLowerCase(Locale.ROOT);
            try { writeDigest = MessageDigest.getInstance("SHA-256"); }
            catch (Exception error) {
                cancelSaveLocked();
                reply("request-result", taskId, false, false, "当前 Android 环境不支持 SHA-256");
                return;
            }
            currentSaveUri = null;
        }
        runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(safeMime(mime));
                intent.putExtra(Intent.EXTRA_TITLE, safeName(name));
                startActivityForResult(intent, BACKUP_SAVE_REQUEST);
            } catch (Exception error) {
                cancelTask(taskId);
                reply("request-result", taskId, false, false, "无法打开 Android 系统文件保存窗口");
            }
        });
    }

    private void writeChunk(JSONObject data, String taskId) {
        int index = data.optInt("index", -1);
        String encoded = data.optString("data", "");
        synchronized (saveLock) {
            if (saveStream == null || !taskMatches(taskId)) {
                reply("chunk-result", taskId, false, false, "保存任务不存在或已取消", index);
                return;
            }
            if (index != nextChunkIndex || encoded.length() > 4 * ((MAX_CHUNK_BYTES + 2) / 3) + 8) {
                reply("chunk-result", taskId, false, false, "文件分块顺序或长度无效", index);
                return;
            }
            try {
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length == 0 || bytes.length > MAX_CHUNK_BYTES || writtenBytes + bytes.length > expectedBytes) {
                    reply("chunk-result", taskId, false, false, "文件分块大小超出允许范围", index);
                    return;
                }
                saveStream.write(bytes);
                writeDigest.update(bytes);
                writtenBytes += bytes.length;
                nextChunkIndex++;
                reply("chunk-result", taskId, true, false, "", index);
            } catch (Exception error) {
                reply("chunk-result", taskId, false, false, "文件分块写入失败：" + error.getMessage(), index);
            }
        }
    }

    private void finishSave(JSONObject data, String taskId) {
        final long expected;
        final String expectedHash;
        final Uri uri;
        synchronized (saveLock) {
            if (saveStream == null || !taskMatches(taskId)) {
                reply("finish-result", taskId, false, false, "保存任务不存在或已取消");
                return;
            }
            if (writtenBytes != expectedBytes || data.optInt("chunks", -1) != nextChunkIndex) {
                reply("finish-result", taskId, false, false, "文件总长度或分块数量不匹配");
                return;
            }
            try {
                String streamedHash = toHex(writeDigest.digest());
                if (!streamedHash.equals(expectedSha256)) {
                    cancelSaveLocked();
                    reply("finish-result", taskId, false, false, "写入过程 SHA-256 校验失败");
                    return;
                }
                expected = expectedBytes;
                expectedHash = expectedSha256;
                uri = currentSaveUri;
                saveStream.flush();
                saveStream.close();
                saveStream = null;
            } catch (Exception error) {
                cancelSaveLocked();
                reply("finish-result", taskId, false, false, "关闭备份文件失败：" + error.getMessage());
                return;
            }
        }

        ReadbackResult readback = verifySavedFile(uri, expected, expectedHash);
        if (readback.readable && !readback.valid) {
            synchronized (saveLock) { cancelSaveLocked(); }
            reply("finish-result", taskId, false, false, "保存文件回读后长度或 SHA-256 不匹配");
            return;
        }
        synchronized (saveLock) { cancelSaveLocked(); }
        reply("finish-result", taskId, true, readback.readable,
                readback.readable ? "文件已写入并完成长度及 SHA-256 回读校验"
                        : "文件已写入并完成流式 SHA-256 校验；当前文档提供器不支持回读，无法再次验证目标文件");
    }

    private ReadbackResult verifySavedFile(Uri uri, long expectedSize, String expectedHash) {
        if (uri == null) return new ReadbackResult(false, false);
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) return new ReadbackResult(false, false);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[32 * 1024];
            long count = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                count += read;
                if (count > expectedSize) return new ReadbackResult(true, false);
                digest.update(buffer, 0, read);
            }
            long providerSize = querySavedSize(uri);
            boolean sizeMatches = count == expectedSize && (providerSize < 0 || providerSize == expectedSize);
            return new ReadbackResult(true, sizeMatches && toHex(digest.digest()).equals(expectedHash));
        } catch (Exception error) {
            return new ReadbackResult(false, false);
        }
    }

    private static final class ReadbackResult {
        final boolean readable;
        final boolean valid;
        ReadbackResult(boolean readable, boolean valid) { this.readable = readable; this.valid = valid; }
    }

    private boolean taskMatches(String taskId) {
        return activeTaskId != null && activeTaskId.equals(taskId);
    }

    private void cancelTask(String taskId) {
        synchronized (saveLock) {
            if (!taskMatches(taskId)) return;
            cancelSaveLocked();
        }
    }

    private void cancelSaveLocked() {
        closeSaveStreamLocked();
        expectedBytes = 0;
        writtenBytes = 0;
        nextChunkIndex = 0;
        activeTaskId = null;
        expectedSha256 = null;
        writeDigest = null;
        currentSaveUri = null;
    }

    private void closeSaveStreamLocked() {
        if (saveStream != null) {
            try { saveStream.close(); } catch (IOException ignored) {}
            saveStream = null;
        }
    }

    private long querySavedSize(Uri uri) {
        if (uri == null) return -1;
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (column >= 0 && !cursor.isNull(column)) return cursor.getLong(column);
            }
        } catch (Exception ignored) {}
        return -1;
    }

    private void reply(String type, String taskId, boolean ok, boolean verified, String message) {
        reply(type, taskId, ok, verified, message, -1);
    }

    private void reply(String type, String taskId, boolean ok, boolean verified, String message, int index) {
        JavaScriptReplyProxy proxy = saveReplyProxy;
        if (proxy == null) return;
        try {
            JSONObject result = new JSONObject();
            result.put("type", type);
            result.put("taskId", taskId == null ? "" : taskId);
            result.put("ok", ok);
            result.put("verified", verified);
            result.put("message", message == null ? "" : message);
            if (index >= 0) result.put("index", index);
            proxy.postMessage(result.toString());
        } catch (Exception ignored) {}
    }

    private String toHex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }

    private String safeMime(String mime) {
        if (mime != null && mime.toLowerCase(Locale.ROOT).contains("zip")) return "application/zip";
        if (mime != null && mime.toLowerCase(Locale.ROOT).contains("json")) return "application/json";
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
            String taskId;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                synchronized (saveLock) { taskId = activeTaskId; cancelSaveLocked(); }
                reply("request-result", taskId, false, false, "用户取消保存位置选择");
                return;
            }
            try {
                OutputStream output = getContentResolver().openOutputStream(data.getData(), "w");
                if (output == null) throw new IOException("无法打开目标文件");
                synchronized (saveLock) {
                    closeSaveStreamLocked();
                    saveStream = output;
                    currentSaveUri = data.getData();
                    taskId = activeTaskId;
                }
                reply("request-result", taskId, true, false, "");
            } catch (Exception error) {
                synchronized (saveLock) { taskId = activeTaskId; cancelSaveLocked(); }
                reply("request-result", taskId, false, false, "无法创建备份文件：" + error.getMessage());
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
        synchronized (saveLock) { cancelSaveLocked(); }
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
