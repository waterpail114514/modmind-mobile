package dev.modmind.mobile;

import android.app.*;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.IBinder;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.zip.*;

/** Owns the development process while a user is working in the local workbench. */
public final class RuntimeService extends Service {
    private Process child;
    private boolean starting;
    static volatile String error;
    public IBinder onBind(Intent intent) { return null; }
    @Override public synchronized int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        String channel = "local-workbench";
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(channel, "本地工作台", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, RuntimeService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE);
        Notification notice = new Notification.Builder(this, channel).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("ModMind 本地工作台").setContentText("项目环境正在手机上运行").setContentIntent(open).addAction(new Notification.Action.Builder(null, "停止环境", stop).build()).setOngoing(true).build();
        if (android.os.Build.VERSION.SDK_INT >= 34) startForeground(10, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); else startForeground(10, notice);
        if (starting || child != null && child.isAlive()) return START_NOT_STICKY;
        starting = true; error = null;
        String token = intent == null ? null : intent.getStringExtra("token");
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                if (token == null || !token.matches("[a-f0-9]{64}")) throw new IOException("本地授权无效，请重新打开应用");
                JSONObject metadata = BundledRuntime.prepare(this);
                File home = new File(getFilesDir(), "home/.modmind-mobile"), runtime = new File(home, "runtime"); runtime.mkdirs();
                try (ZipInputStream zip = new ZipInputStream(getAssets().open("runtime-code.zip"))) {
                    ZipEntry entry; long total = 0;
                    while ((entry = zip.getNextEntry()) != null) {
                        if (entry.isDirectory()) continue;
                        File target = new File(runtime, entry.getName());
                        if (!target.getCanonicalPath().startsWith(runtime.getCanonicalPath() + "/")) throw new IOException("程序包路径无效");
                        target.getParentFile().mkdirs();
                        try (OutputStream out = new FileOutputStream(target)) { byte[] bytes = new byte[65536]; int count; while ((count = zip.read(bytes)) != -1) { total += count; if (total > 32L*1024*1024) throw new IOException("程序包超限"); out.write(bytes, 0, count); } }
                    }
                }
                File cache = new File(home, "gradle-cache"); cache.mkdirs();
                JSONObject config = new JSONObject().put("token", token).put("gradleHome", cache.getAbsolutePath()).put("port", 19086);
                try (OutputStream out = new FileOutputStream(new File(home, "runtime.json"))) { out.write(config.toString().getBytes(StandardCharsets.UTF_8)); }
                ProcessBuilder builder = new ProcessBuilder(metadata.getString("prefix") + "/bin/node", new File(runtime, "server.mjs").getAbsolutePath()).directory(home).redirectErrorStream(true);
                BundledRuntime.environment(this, metadata, builder.environment());
                builder.environment().put("MODMIND_MOBILE_BOOT", "1"); builder.environment().put("MODMIND_MOBILE_HOME", home.getAbsolutePath());
                builder.environment().put("MODMIND_CODEX_PATH", new File(getApplicationInfo().nativeLibraryDir, "libmm_codex_exec.so").getAbsolutePath());
                child = builder.start(); starting = false;
                File log = new File(home, "runtime.log");
                try (InputStream in = child.getInputStream()) { byte[] bytes = new byte[4096]; int count; while ((count = in.read(bytes)) != -1) { try (FileOutputStream out = new FileOutputStream(log, log.length() < 256*1024)) { out.write(bytes, 0, count); } } }
                int code = child.waitFor(); if (code != 0) error = "本地服务已停止（" + code + "），请重新连接";
            } catch (Throwable failure) { error = failure.getMessage(); }
            finally { starting = false; }
        });
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() { if (child != null) child.destroy(); super.onDestroy(); }
}
