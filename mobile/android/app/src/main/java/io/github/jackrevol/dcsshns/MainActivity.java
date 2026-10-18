package io.github.jackrevol.dcsshns;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.view.WindowCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** HTTPS APK assets let Workers, WASM, IndexedDB and CacheStorage work offline. */
public final class MainActivity extends ComponentActivity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int MAX_BACKUP_BYTES = 32 * 1024 * 1024;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingExport;
    private JavaScriptReplyProxy exportReply;

    private final ActivityResultLauncher<Intent> importLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            if (fileCallback == null) return;
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(
                result.getResultCode(), result.getData()));
            fileCallback = null;
        });

    private final ActivityResultLauncher<String> exportLauncher = registerForActivityResult(
        new ActivityResultContracts.CreateDocument("application/octet-stream"), uri -> {
            final byte[] bytes = pendingExport;
            final JavaScriptReplyProxy reply = exportReply;
            pendingExport = null;
            exportReply = null;
            if (reply == null || bytes == null) return;
            if (uri == null) {
                reply.postMessage("{\"ok\":false}");
                return;
            }
            // The document provider may be cloud-backed. Keep I/O off the UI
            // thread; acknowledge only once the stream has closed successfully.
            new Thread(() -> {
                String error = null;
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new java.io.IOException("No output stream");
                    output.write(bytes);
                } catch (Exception exception) {
                    error = "Could not write backup: " + exception.getMessage();
                }
                final String failure = error;
                runOnUiThread(() -> reply.postMessage(failure == null
                    ? "{\"ok\":true}"
                    : "{\"ok\":false,\"error\":" + JSONObject.quote(failure) + "}"));
            }, "hns-backup-export").start();
        });

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        // Android 15+ enforces edge-to-edge. Inset the WebView for system bars,
        // display cutouts and IME; the game still gets an accurately sized view.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                    android.view.WindowInsets.Type.systemBars()
                    | android.view.WindowInsets.Type.displayCutout()
                    | android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return android.view.WindowInsets.CONSUMED;
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets.consumeSystemWindowInsets();
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // System file picker for .pzsave import.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebViewAssetLoader.AssetsPathHandler assets = new WebViewAssetLoader.AssetsPathHandler(this);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/", path -> {
                WebResourceResponse response = assets.handle("www/" + (path.isEmpty() ? "index.html" : path));
                if (response == null || response.getData() == null) return notFound();
                // File extension guessing can otherwise return octet-stream for
                // ES modules and wasm; gzip stays raw for the worker's decoder.
                if (path.endsWith(".js")) response.setMimeType("text/javascript");
                if (path.endsWith(".wasm")) response.setMimeType("application/wasm");
                if (path.endsWith(".json") || path.endsWith(".webmanifest"))
                    response.setMimeType("application/json");
                response.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
                return response;
            }).build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isAppOrigin(uri)) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme())
                    || "http".equals(uri.getScheme()) || "mailto".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException ignored) { /* No handler installed. */ }
                }
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(new ServiceWorkerClientCompat() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return loader.shouldInterceptRequest(request.getUrl());
                }
            });
        }
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    // .pzsave has no registered MIME type; application/octet-stream
                    // filtering would hide valid backups on some file providers.
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                    importLauncher.launch(intent);
                } catch (ActivityNotFoundException exception) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                }
                return true;
            }
        });

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Toast.makeText(this, "Update Android System WebView to play DCSS HNS", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        WebViewCompat.addWebMessageListener(webView, "HnsAndroid", Collections.singleton(ORIGIN),
            (view, message, sourceOrigin, isMainFrame, reply) -> {
                if (!isMainFrame || !isAppOrigin(sourceOrigin)) return;
                if (pendingExport != null) {
                    reply.postMessage("{\"ok\":false,\"error\":\"A backup export is already open\"}");
                    return;
                }
                try {
                    JSONObject request = new JSONObject(message.getData());
                    if (!"export".equals(request.getString("type"))) return;
                    String encoded = request.getString("data");
                    if (encoded.length() > (MAX_BACKUP_BYTES + 2L) / 3 * 4)
                        throw new IllegalArgumentException("Backup exceeds 32 MB");
                    byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                    if (bytes.length > MAX_BACKUP_BYTES) throw new IllegalArgumentException("Backup exceeds 32 MB");
                    String name = request.optString("name", "dcss-hns.pzsave")
                        .replaceAll("[^A-Za-z0-9._-]", "_");
                    exportReply = reply;
                    pendingExport = bytes;
                    exportLauncher.launch(name);
                } catch (Exception exception) {
                    pendingExport = null;
                    exportReply = null;
                    reply.postMessage("{\"ok\":false,\"error\":"
                        + JSONObject.quote(exception.getMessage()) + "}");
                }
            });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                webView.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',"
                    + "{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));"
                    + "document.dispatchEvent(new KeyboardEvent('keyup',"
                    + "{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));", null);
            }
        });
        // Always launch the HNS lobby; public servers remain reachable via its
        // Back button, and do not gain HNS rules by using this client.
        webView.loadUrl(ORIGIN + "/?offline=1");
    }

    private static boolean isAppOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
            new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8)));
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new Event('hns-background'))", null);
        // Do not call WebView.pauseTimers(): the worker needs time to commit.
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new Event('hns-foreground'))", null);
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
