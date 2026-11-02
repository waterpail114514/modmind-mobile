package dev.modmind.mobile;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Installs APK-owned data and links executable files to Android's installed native directory. */
final class BundledRuntime {
    private static File inside(File root, String relative) throws IOException {
        Path target = root.toPath().resolve(relative).normalize();
        if (relative.startsWith("/") || !target.startsWith(root.toPath()) || relative.contains("\\")) throw new IOException("运行包路径无效");
        return target.toFile();
    }
    static String text(InputStream input) throws IOException {
        try (input; ByteArrayOutputStream out = new ByteArrayOutputStream()) { byte[] bytes = new byte[65536]; int count; while ((count = input.read(bytes)) != -1) out.write(bytes, 0, count); return out.toString("UTF-8"); }
    }
    static synchronized JSONObject prepare(Context context) throws Exception {
        File files = context.getFilesDir(), prefix = new File(files, "u");
        JSONObject version = new JSONObject(text(context.getAssets().open("local-runtime-version.json")));
        File installed = new File(prefix, ".installed-version");
        String old = installed.isFile() ? text(new FileInputStream(installed)) : "";
        if (!version.getString("sha256").equals(old)) {
            File stage = new File(files, ".runtime-install-" + UUID.randomUUID());
            if (!stage.mkdir()) throw new IOException("无法准备本地环境目录");
            long total = 0; int entries = 0;
            try (ZipInputStream zip = new ZipInputStream(context.getAssets().open("local-runtime.zip"))) {
                ZipEntry entry; byte[] bytes = new byte[65536];
                while ((entry = zip.getNextEntry()) != null) {
                    if (++entries > 30000) throw new IOException("运行包文件数超过限制");
                    File target = inside(stage, entry.getName());
                    if (entry.isDirectory()) { target.mkdirs(); continue; }
                    target.getParentFile().mkdirs();
                    try (OutputStream output = new FileOutputStream(target)) { int count; while ((count = zip.read(bytes)) != -1) { total += count; if (total > 1024L * 1024 * 1024) throw new IOException("运行包超过容量限制"); output.write(bytes, 0, count); } }
                }
            }
            File previous = new File(files, ".runtime-previous");
            if (previous.exists()) removeOwned(files, previous);
            if (prefix.exists() && !prefix.renameTo(previous)) throw new IOException("无法替换旧本地环境");
            if (!stage.renameTo(prefix)) { if (previous.exists()) previous.renameTo(prefix); throw new IOException("无法安装本地环境"); }
            if (previous.exists()) removeOwned(files, previous);
            try (OutputStream output = new FileOutputStream(installed)) { output.write(version.getString("sha256").getBytes(StandardCharsets.UTF_8)); }
        }
        JSONObject metadata = new JSONObject(text(new FileInputStream(new File(prefix, ".native-links.json"))));
        if (!prefix.getCanonicalPath().equals(new File(metadata.getString("prefix")).getCanonicalPath())) throw new IOException("运行环境与应用标识不匹配");
        JSONObject natives = metadata.getJSONObject("nativeLinks");
        for (Iterator<String> keys = natives.keys(); keys.hasNext();) {
            String relative = keys.next();
            File target = inside(prefix, relative), library = new File(context.getApplicationInfo().nativeLibraryDir, natives.getString(relative));
            if (!library.isFile()) throw new IOException("缺少内置程序：" + library.getName());
            replaceLink(target, library.toPath());
        }
        JSONObject links = metadata.getJSONObject("dataLinks");
        for (Iterator<String> keys = links.keys(); keys.hasNext();) {
            String relative = keys.next(), destination = links.getString(relative);
            // Path.of requires Android 14; bootstrap runs on system ART, before the bundled JDK.
            replaceLink(inside(prefix, relative), destination.equals("/system/bin/sh") ? new File(destination).toPath() : inside(prefix, destination).toPath());
        }
        new File(prefix, "tmp").mkdirs(); new File(files, "home").mkdirs();
        File openssl = new File(prefix, "openssl.cnf");
        if (!openssl.exists()) try (OutputStream out = new FileOutputStream(openssl)) { out.write("openssl_conf = openssl_init\n[openssl_init]\nproviders = providers\n[providers]\ndefault = default\n[default]\nactivate = 1\n".getBytes(StandardCharsets.UTF_8)); }
        return metadata;
    }
    private static void replaceLink(File target, Path destination) throws IOException {
        target.getParentFile().mkdirs();
        if (Files.isSymbolicLink(target.toPath()) && Files.readSymbolicLink(target.toPath()).equals(destination)) return;
        Files.deleteIfExists(target.toPath()); Files.createSymbolicLink(target.toPath(), destination);
    }
    private static void removeOwned(File owner, File file) throws IOException {
        if (!file.toPath().normalize().startsWith(owner.toPath()) || file.equals(owner)) throw new IOException("不能清理此目录");
        if (!Files.isSymbolicLink(file.toPath()) && file.isDirectory()) { File[] children = file.listFiles(); if (children != null) for (File child : children) removeOwned(owner, child); }
        Files.deleteIfExists(file.toPath());
    }
    static void environment(Context context, JSONObject metadata, Map<String,String> env) throws Exception {
        String prefix = metadata.getString("prefix"), java = prefix + "/" + metadata.getString("javaHome");
        env.remove("LD_PRELOAD");
        File pathAdapter = new File(context.getApplicationInfo().nativeLibraryDir, "libmm_runtime_paths.so");
        if (pathAdapter.isFile()) env.put("LD_PRELOAD", pathAdapter.getAbsolutePath());
        env.put("HOME", new File(context.getFilesDir(), "home").getAbsolutePath()); env.put("PREFIX", prefix);
        env.put("PATH", prefix + "/bin:/system/bin"); env.put("SHELL", prefix + "/bin/bash"); env.put("JAVA_HOME", java);
        env.put("LD_LIBRARY_PATH", context.getApplicationInfo().nativeLibraryDir + ":" + prefix + "/lib:" + java + "/lib:" + java + "/lib/server");
        env.put("TMPDIR", prefix + "/tmp"); env.put("SSL_CERT_FILE", prefix + "/etc/tls/cert.pem"); env.put("NODE_EXTRA_CA_CERTS", prefix + "/etc/tls/cert.pem"); env.put("OPENSSL_CONF", prefix + "/openssl.cnf");
        env.put("JAVA_TOOL_OPTIONS", "-Djava.awt.headless=true -Djava.io.tmpdir=" + prefix + "/tmp");
    }
}
