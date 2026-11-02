package dev.modmind.mobile;
import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.*;
import java.util.concurrent.Executors;

/** Debug-only entry used to validate the bundled toolchain before connecting the workbench. */
public final class RuntimeProbeActivity extends Activity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); TextView view = new TextView(this); view.setPadding(30,80,30,30); view.setText("正在验证内置环境…"); setContentView(view);
        Executors.newSingleThreadExecutor().execute(() -> {
            JSONObject result = new JSONObject(); StringBuilder report = new StringBuilder();
            try {
                JSONObject metadata = BundledRuntime.prepare(this);
                result.put("uid", android.os.Process.myUid()); result.put("targetSdk", getApplicationInfo().targetSdkVersion); result.put("package", getPackageName());
                for (String tool : new String[]{"node", "java", "javac", "bash", "codex"}) {
                    String path = tool.equals("codex") ? new File(getApplicationInfo().nativeLibraryDir, "libmm_codex_exec.so").getAbsolutePath() : metadata.getString("prefix") + "/bin/" + tool;
                    ProcessBuilder builder = new ProcessBuilder(path, tool.equals("java") || tool.equals("javac") ? "-version" : "--version").redirectErrorStream(true);
                    BundledRuntime.environment(this, metadata, builder.environment());
                    Process process = builder.start(); String output = BundledRuntime.text(process.getInputStream()); int code = process.waitFor();
                    result.put(tool, new JSONObject().put("exitCode", code).put("output", output)); report.append(tool).append(": ").append(code).append("\n").append(output).append("\n");
                    runOnUiThread(() -> view.setText(report.toString()));
                }
            } catch (Throwable failure) { try { result.put("error", failure.toString()); } catch (Exception ignored) {} report.append(failure); }
            try (OutputStream output = new FileOutputStream(new File(getFilesDir(), "runtime-probe.json"))) { output.write(result.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8)); } catch (Exception ignored) {}
            runOnUiThread(() -> view.setText(report.toString()));
        });
    }
}
