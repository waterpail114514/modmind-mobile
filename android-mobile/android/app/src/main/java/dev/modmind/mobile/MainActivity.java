package dev.modmind.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.ClipData;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.webkit.WebViewAssetLoader;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private String notificationRequest;
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 57 && notificationRequest != null) { String id = notificationRequest; notificationRequest = null; try { reply(id, new JSONObject().put("allowed", results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED), null); } catch (Exception ignored) { } }
    }
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private final ExecutorService workers = Executors.newFixedThreadPool(3);
    private WebView web;
    private FrameLayout root;
    private String token;
    private String importRequest;
    private String importProject;
    private String importKind;
    private String permissionRequest;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        token = getPreferences(MODE_PRIVATE).getString("runtimeToken", null);
        if (token == null) {
            byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
            StringBuilder value = new StringBuilder(); for (byte b : bytes) value.append(String.format("%02x", b));
            token = value.toString(); getPreferences(MODE_PRIVATE).edit().putString("runtimeToken", token).apply();
        }
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarContrastEnforced(false);
        if (android.os.Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        root = new FrameLayout(this);
        web = new WebView(this); root.addView(web, new FrameLayout.LayoutParams(-1, -1)); setContentView(root);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder().addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return loader.shouldInterceptRequest(request.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl(); return !"https".equals(uri.getScheme()) || !"appassets.androidplatform.net".equals(uri.getHost());
            }
        });
        web.setWebChromeClient(new WebChromeClient()); web.addJavascriptInterface(new Bridge(), "ModMindNative");
        web.loadUrl(ORIGIN + "/assets/web/index.html");
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("Boolean(window.__modmindBack && window.__modmindBack())", handled -> { if (!"true".equals(handled)) moveTaskToBack(true); });
    }
    private void reply(String id, Object value, Throwable error) {
        try {
            JSONObject packet = new JSONObject(); packet.put("ok", error == null);
            if (error == null) packet.put("value", value == null ? JSONObject.NULL : value);
            else { JSONObject failure = new JSONObject(); failure.put("message", error instanceof java.net.SocketTimeoutException ? "本地环境没有响应，请重新连接" : error.getMessage() == null ? "本地操作未完成" : error.getMessage()); packet.put("error", failure); }
            runOnUiThread(() -> web.evaluateJavascript("window.__modmindReply && window.__modmindReply(" + JSONObject.quote(id) + "," + packet + ")", null));
        } catch (Exception ignored) { }
    }
    private HttpURLConnection connection(String endpoint, String method) throws Exception {
        HttpURLConnection request = (HttpURLConnection) new URL("http://127.0.0.1:19086" + endpoint).openConnection();
        request.setRequestMethod(method); request.setConnectTimeout(1500); request.setReadTimeout(15000); request.setRequestProperty("x-modmind-token", token); return request;
    }
    private String responseText(HttpURLConnection request) throws Exception {
        InputStream input = request.getResponseCode() < 400 ? request.getInputStream() : request.getErrorStream();
        if (input == null) throw new IOException("本地服务未返回结果");
        try (input; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            copy(input, bytes); String value = bytes.toString("UTF-8");
            if (request.getResponseCode() >= 400) {
                JSONObject body = new JSONObject(value); throw new IOException(body.optJSONObject("error") != null ? body.getJSONObject("error").optString("message", value) : value);
            }
            return value;
        } finally { request.disconnect(); }
    }
    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[65536]; int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
    }
    private JSONObject environment() throws Exception {
        JSONObject state = new JSONObject(); state.put("bundled", true);
        try {
            HttpURLConnection request = connection("/health", "GET"); request.setReadTimeout(2000);
            JSONObject value = new JSONObject(responseText(request));
            state.put("connected", true); state.put("version", value.optString("version")); state.put("node", value.optString("node")); state.put("java", value.optBoolean("java"));
        } catch (Exception failure) { state.put("connected", false); state.put("message", RuntimeService.error == null ? "本地环境尚未启动" : RuntimeService.error); }
        return state;
    }
    private void prepareEnvironment() {
        startForegroundService(new Intent(this, RuntimeService.class).putExtra("token", token));
    }
    final class Bridge {
        @JavascriptInterface public void invoke(String id, String method, String json) {
            if (id.length() > 80 || json.length() > 1048576) { reply(id, null, new IOException("请求超过容量限制")); return; }
            workers.execute(() -> {
                try {
                    JSONObject input = new JSONObject(json);
                    switch (method) {
                        case "environment": reply(id, environment(), null); break;
                        case "appearance": { int scale = Math.max(80, Math.min(125, input.optInt("fontScale", 100))); runOnUiThread(() -> web.getSettings().setTextZoom(scale)); reply(id, new JSONObject(), null); break; }
                        case "notificationPermission": {
                            if (android.os.Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) reply(id, new JSONObject().put("allowed", true), null);
                            else { notificationRequest = id; runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 57)); } break;
                        }
                        case "notify": {
                            if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) { reply(id, new JSONObject(), null); break; }
                            android.app.NotificationManager manager = getSystemService(android.app.NotificationManager.class);
                            manager.createNotificationChannel(new android.app.NotificationChannel("work-results", "创作任务结果", android.app.NotificationManager.IMPORTANCE_DEFAULT));
                            manager.notify(21, new android.app.Notification.Builder(MainActivity.this, "work-results").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle(input.optString("title", "ModMind")).setContentText(input.optString("message").substring(0, Math.min(200, input.optString("message").length()))).setAutoCancel(true).build()); reply(id, new JSONObject(), null); break;
                        }
                        case "connect": if (!environment().optBoolean("connected")) prepareEnvironment(); reply(id, environment(), null); break;
                        case "rpc": {
                            HttpURLConnection request = connection("/rpc", "POST"); request.setDoOutput(true); request.setRequestProperty("Content-Type", "application/json");
                            if ("account".equals(input.optString("action")) || "write".equals(input.optString("action")) && "export".equals(input.optJSONObject("input") == null ? "" : input.getJSONObject("input").optString("operation"))) request.setReadTimeout(120000);
                            try (OutputStream output = request.getOutputStream()) { output.write(input.toString().getBytes(StandardCharsets.UTF_8)); }
                            reply(id, new JSONObject(responseText(request)), null); break;
                        }
                        case "export": reply(id, exportArtifact(input.getString("artifactId")), null); break;
                        case "share": shareArtifact(id, input.getString("artifactId")); break;
                        case "pickMod": {
                            if (importRequest != null) throw new IOException("已有文件选择正在进行");
                            importRequest = id; importProject = input.getString("projectId"); importKind = "mod";
                            runOnUiThread(() -> { Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT); picker.addCategory(Intent.CATEGORY_OPENABLE); picker.setType("*/*"); startActivityForResult(picker, 42); }); break;
                        }
                        case "pickProject": {
                            if (importRequest != null) throw new IOException("已有文件选择正在进行");
                            importRequest = id; importProject = null; importKind = "project";
                            runOnUiThread(() -> { Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT); picker.addCategory(Intent.CATEGORY_OPENABLE); picker.setType("*/*"); startActivityForResult(picker, 42); }); break;
                        }
                        case "openUrl": {
                            Uri uri = Uri.parse(input.getString("url"));
                            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) throw new IOException("链接无效");
                            runOnUiThread(() -> startActivity(new Intent(Intent.ACTION_VIEW, uri))); reply(id, new JSONObject(), null); break;
                        }
                        case "theme": runOnUiThread(() -> setBarTheme(input.optBoolean("dark"), input.optString("canvas"))); reply(id, new JSONObject(), null); break;
                        default: throw new IOException("未开放的安卓操作");
                    }
                } catch (Throwable error) { reply(id, null, error); }
            });
        }
    }
    private void setBarTheme(boolean dark, String canvas) {
        if (android.os.Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        int surface = canvas.matches("#[a-fA-F0-9]{6}") ? Color.parseColor(canvas) : dark ? Color.rgb(35,39,43) : Color.rgb(245,246,247);
        root.setBackgroundColor(surface); web.setBackgroundColor(surface);
    }
    private void shareArtifact(String requestId, String artifactId) throws Exception {
        if (!artifactId.matches("[a-f0-9-]{36}")) throw new IOException("产物标识无效");
        // Reuse the authenticated artifact service and its project/path checks. Share the immutable
        // snapshot directly, avoiding another full copy of a potentially large modpack.
        JSONObject artifact = new JSONObject(responseText(connection("/artifact/" + artifactId + "?metadata=1", "GET")));
        String name = artifact.getString("name");
        if (!artifactId.equals(artifact.getString("id")) || !name.matches("[A-Za-z0-9_.-]{1,180}")) throw new IOException("分享文件无效");
        File directory = new File(getFilesDir(), "home/.modmind-mobile/artifacts/" + artifactId).getCanonicalFile();
        File file = new File(directory, name).getCanonicalFile();
        if (!file.getParentFile().equals(directory) || !file.isFile() || file.length() != artifact.getLong("size")) throw new IOException("成品已移除，请重新构建或导出");
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
        String mime = name.endsWith(".zip") ? "application/zip" : name.endsWith(".json") ? "application/json" : "application/octet-stream";
        Intent send = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).putExtra(Intent.EXTRA_TITLE, name);
        send.setClipData(ClipData.newRawUri(name, uri)); send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        runOnUiThread(() -> {
            try { startActivity(Intent.createChooser(send, "分享成品")); reply(requestId, new JSONObject().put("opened", true).put("name", name), null); }
            catch (Exception failure) { reply(requestId, null, new IOException("无法打开系统分享，请先导出文件后重试", failure)); }
        });
    }
    private JSONObject exportArtifact(String artifactId) throws Exception {
        if (!artifactId.matches("[a-f0-9-]{36}")) throw new IOException("产物标识无效");
        HttpURLConnection request = connection("/artifact/" + artifactId, "GET");
        if (request.getResponseCode() >= 400) { responseText(request); throw new IOException("读取产物失败"); }
        String name = request.getHeaderField("X-Artifact-Name");
        if (name == null || !name.matches("[A-Za-z0-9_.-]{1,180}")) throw new IOException("导出文件名无效");
        ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.DISPLAY_NAME, name); values.put(MediaStore.Downloads.RELATIVE_PATH, "Download/ModMind"); values.put(MediaStore.Downloads.MIME_TYPE, request.getContentType()); values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri destination = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (destination == null) throw new IOException("无法创建下载文件");
        try (InputStream input = request.getInputStream(); OutputStream output = getContentResolver().openOutputStream(destination)) {
            if (output == null) throw new IOException("无法保存下载文件"); copy(input, output);
        } catch (Exception failure) { getContentResolver().delete(destination, null, null); throw failure; }
        finally { request.disconnect(); }
        values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0); getContentResolver().update(destination, values, null, null);
        JSONObject result = new JSONObject(); result.put("name", name); result.put("uri", destination.toString()); result.put("location", "下载/ModMind"); return result;
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != 42 || importRequest == null) return;
        String id = importRequest, projectId = importProject; boolean projectArchive = "project".equals(importKind); importRequest = null; importProject = null; importKind = null;
        if (result != RESULT_OK || data == null || data.getData() == null) { reply(id, new JSONObject(), null); return; }
        Uri uri = data.getData();
        workers.execute(() -> { try {
            String name = "import.jar"; long size = -1;
            try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) { if (cursor != null && cursor.moveToFirst()) { name = cursor.getString(0); size = cursor.getLong(1); } }
            long limit = projectArchive ? 1024L * 1024 * 1024 : 64L * 1024 * 1024;
            if (projectArchive ? !(name.toLowerCase().endsWith(".zip") || name.toLowerCase().endsWith(".mrpack")) || size > limit : !name.toLowerCase().endsWith(".jar") || size > limit) throw new IOException(projectArchive ? "请选择不超过 1 GiB 的 ZIP 项目或 mrpack" : "请选择不超过 64 MiB 的 JAR 文件");
            HttpURLConnection request = connection(projectArchive ? "/import-project?name=" + Uri.encode(name) : "/upload?projectId=" + Uri.encode(projectId) + "&name=" + Uri.encode(name), "POST"); request.setReadTimeout(120000); request.setDoOutput(true); request.setChunkedStreamingMode(64 * 1024); request.setRequestProperty("Content-Type", "application/octet-stream");
            try (InputStream input = getContentResolver().openInputStream(uri); OutputStream output = request.getOutputStream()) {
                if (input == null) throw new IOException("无法读取选择的文件"); byte[] buffer = new byte[65536]; long total = 0; int count;
                while ((count = input.read(buffer)) != -1) { total += count; if (total > limit) throw new IOException("文件超过导入容量限制"); output.write(buffer, 0, count); }
            }
            reply(id, new JSONObject(responseText(request)), null);
        } catch (Throwable failure) { reply(id, null, failure); } });
    }
}
