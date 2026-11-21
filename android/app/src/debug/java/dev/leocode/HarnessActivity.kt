package dev.leocode

import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.text.method.ScrollingMovementMethod
import android.util.Log
import android.util.TypedValue
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import dev.leocode.core.DeviceReport
import dev.leocode.core.NativePty
import dev.leocode.core.ProcessSupervisor
import dev.leocode.core.PtySession
import dev.leocode.core.Workspace
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Phase 0B device harness (temporary; replaced by the WebView shell in Phase 1).
 *
 * Runs from the UI or from adb:
 *   adb shell am start -n dev.leocode/.HarnessActivity --es run all
 *   adb shell am start -n dev.leocode/.HarnessActivity --es run T2
 *
 * Every line is also written to logcat under the tag LeoCodeHarness.
 */
class HarnessActivity : Activity() {

    private companion object {
        const val TAG = "LeoCodeHarness"
    }

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    private lateinit var output: TextView
    private lateinit var workspace: Workspace
    private lateinit var supervisor: ProcessSupervisor
    private var busy = false

    /** Phase F (Tasks 19–23) tests; null when the app graph failed to start. */
    private var phaseF: PhaseFHarness? = null
    private val phaseFNet by lazy {
        val intent = intent
        PhaseFHarness.Net(
            httpsRepo = intent?.getStringExtra("httpsRepo") ?: PhaseFHarness.DEFAULT_HTTPS_REPO,
            sshHost = intent?.getStringExtra("sshHost") ?: PhaseFHarness.DEFAULT_SSH_HOST,
            sshPort = intent?.getStringExtra("sshPort")?.toIntOrNull() ?: PhaseFHarness.DEFAULT_SSH_PORT,
            sshUser = intent?.getStringExtra("sshUser") ?: PhaseFHarness.DEFAULT_SSH_USER,
            httpsHost = intent?.getStringExtra("httpsHost")
                ?: intent?.getStringExtra("sshHost")
                ?: PhaseFHarness.DEFAULT_SSH_HOST,
            httpsPort = intent?.getStringExtra("httpsPort")?.toIntOrNull()
                ?: PhaseFHarness.DEFAULT_HTTPS_PORT,
            httpsRepoName = intent?.getStringExtra("httpsRepoName") ?: "t14.git",
            httpsToken = intent?.getStringExtra("httpsToken") ?: ""
        )
    }
    private val phaseFRepos by lazy {
        val intent = intent
        PhaseFHarness.Repos(
            clone = intent?.getStringExtra("sshCloneRepo") ?: "t12.git",
            push = intent?.getStringExtra("sshPushRepo") ?: "t13.git"
        )
    }

    private data class Test(val id: String, val title: String, val body: () -> String)

    private lateinit var tests: List<Test>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        workspace = Workspace(filesDir)
        workspace.ensure()
        supervisor = ProcessSupervisor(workspace.childEnv())

        tests = listOf(
            Test("T1", "/system/bin/sh") { t1Shell() },
            Test("T2", "exec binary from app data (W^X gate)") { t2ExecFromData() },
            Test("T3", "process-group kill via setsid") { t3GroupKill() },
            Test("T4", "exit code + stderr capture") { t4ExitCode() },
            Test("T5", "output flood, bounded buffer") { t5Flood() },
            Test("T6", "native PTY smoke test") { t6Pty() },
            Test("T7", "system shell applet inventory") { t7Toybox() },
            Test("T8", "PTY child environment is allowlisted") { t8PtyEnv() },
            Test("T9", "PTY child has no fds above stderr") { t9PtyFds() },
            Test("S1", "shared storage with legacy permissions") { s1SharedStorage() },
            Test("T10", "Git HTTPS clone (JGit, reply on finish)") { phaseF { it.t10(phaseFNet) } },
            Test("T11", "Ed25519 keygen + sealed private key") { phaseF { it.t11() } },
            Test("DX", "Phase F crypto diagnostics") { phaseF { it.diagnostics() } },
            Test("D10", "raw JGit clone (unmapped errors)") {
                phaseF { it.t10Diagnostic(phaseFNet) }
            },
            Test("DN", "app network reachability") { phaseF { it.networkDiagnostic(phaseFNet) } },
            Test("T10L", "Git clone over adb-reverse HTTP (no DNS)") {
                phaseF { it.t10Loopback(phaseFNet) }
            },
            Test("D12", "raw JGit SSH clone (unmapped errors)") {
                phaseF { it.t12Diagnostic(phaseFNet, phaseFRepos) }
            },
            Test("T12", "SSH clone with host-key prompt") {
                phaseF { it.t12(phaseFNet, phaseFRepos) }
            },
            Test("T21", "local Git: status/add/commit/diff/branch/conflict") {
                phaseF { it.t21Local() }
            },
            Test("T11B", "passphrase-protected key import") { phaseF { it.t11Passphrase() } },
            Test("T13P", "pull over SSH (two working copies)") {
                phaseF { it.t13Pull(phaseFNet, phaseFRepos) }
            },
            Test("D13T", "raw HTTPS token clone (unmapped)") { phaseF { it.t13tDiagnostic(phaseFNet) } },
            Test("T13T", "push over HTTPS with a stored token") {
                phaseF { it.t13HttpsToken(phaseFNet) }
            },
            Test("T12B", "pinned host connects without a prompt") {
                phaseF { it.t12Reuse(phaseFNet, phaseFRepos) }
            },
            Test("T13", "commit + push over SSH") {
                phaseF { it.t13(phaseFNet, phaseFRepos) }
            },
            Test("T14", "Keystore envelope round-trip") { phaseF { it.t14() } }
        )

        setContentView(buildUi())
        append(DeviceReport.collect(this, workspace))

        // Phase F tests need the production graph (Keystore, SSH stores, Git
        // engine). It is built once by LeoApp.onCreate; a startup failure is
        // reported instead of crashing the harness.
        val graph = (application as? LeoApp)?.graph
        phaseF = graph?.let { PhaseFHarness(this, it) }
        if (graph == null) {
            append("Phase F tests unavailable: the app graph did not start " +
                "(${((application as? LeoApp)?.startupError) ?: "unknown error"})")
        } else {
            dev.leocode.ssh.Crypto.ensureProviders()
        }

        when (val run = intent?.getStringExtra("run")) {
            null -> Unit
            "all" -> main.postDelayed({ runAll() }, 400)
            else -> {
                val test = tests.firstOrNull { it.id.equals(run, ignoreCase = true) }
                if (test == null) append("unknown test: $run")
                else main.postDelayed({ runSingle(test) }, 400)
            }
        }
    }

    override fun onDestroy() {
        supervisor.close()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- UI

    private fun buildUi(): LinearLayout {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        bar.addView(button("Run all") { runAll() })
        for (test in tests) {
            bar.addView(button(test.id) { runSingle(test) })
        }

        root.addView(HorizontalScrollView(this).apply { addView(bar) })

        output = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTextIsSelectable(true)
            movementMethod = ScrollingMovementMethod()
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }

        root.addView(
            ScrollView(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    0,
                    1f
                )
                addView(output)
            }
        )
        return root
    }

    private fun button(label: String, action: () -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            setOnClickListener { action() }
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun append(text: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            output.append(text + "\n")
            Log.i(TAG, text)
        } else {
            main.post {
                output.append(text + "\n")
                Log.i(TAG, text)
            }
        }
    }

    // ------------------------------------------------------------ running

    private fun runSingle(test: Test) {
        if (busy) {
            append("… busy, wait for the current test")
            return
        }
        busy = true
        append("\n▶ ${test.id} — ${test.title}")
        io.execute {
            append(safe(test))
            main.post { busy = false }
        }
    }

    private fun runAll() {
        if (busy) {
            append("… busy, wait for the current test")
            return
        }
        busy = true
        io.execute {
            append("\n════ RUN ALL ════")
            for (test in tests) {
                append("\n▶ ${test.id} — ${test.title}")
                append(safe(test))
            }
            append("\n════ RUN ALL COMPLETE ════")
            main.post { busy = false }
        }
    }

    private fun safe(test: Test): String = try {
        test.body()
    } catch (t: Throwable) {
        "  FAIL ${t.javaClass.simpleName}: ${t.message}"
    }

    /** Runs a Phase F body, or explains why the production graph is unavailable. */
    private fun phaseF(body: (PhaseFHarness) -> String): String {
        val harness = phaseF ?: return "  SKIP — app graph unavailable"
        return body(harness)
    }

    private fun runSpec(spec: ProcessSupervisor.Spec): HarnessProcess.Result =
        HarnessProcess.run(supervisor, spec)

    private fun format(result: HarnessProcess.Result): String = buildString {
        appendLine(
            "  pid=${result.pid} exit=${result.exitCode} time=${result.durationMs}ms " +
                "timedOut=${result.timedOut} truncated=${result.stdoutTruncated}"
        )
        if (result.stdout.isNotBlank()) {
            appendLine("  stdout: " + result.stdout.trim().take(1500).replace("\n", "\n          "))
        }
        if (result.stderr.isNotBlank()) {
            appendLine("  stderr: " + result.stderr.trim().take(1000).replace("\n", "\n          "))
        }
    }

    // -------------------------------------------------------------- tests

    private fun t1Shell(): String {
        val r = runSpec(
            ProcessSupervisor.Spec(
                argv = listOf("/system/bin/sh", "-c", "echo hello-from-android; id; pwd; echo PATH=\$PATH"),
                cwd = workspace.defaultWorkspace,
                timeoutMs = 10_000
            )
        )
        return format(r) + if (r.exitCode == 0) "  PASS" else "  FAIL"
    }

    private fun t2ExecFromData(): String {
        val dir = File(workspace.defaultWorkspace, "t2").apply { mkdirs() }
        val probe = File(dir, "probe-sh")
        File("/system/bin/sh").copyTo(probe, overwrite = true)
        probe.setExecutable(true, false)

        val r = runSpec(
            ProcessSupervisor.Spec(
                argv = listOf(probe.absolutePath, "-c", "echo exec-from-data-ok; echo arg0=\$0"),
                cwd = workspace.defaultWorkspace,
                timeoutMs = 10_000
            )
        )
        return format(r) +
            "  canExecute=${probe.canExecute()}\n" +
            if (r.stdout.contains("exec-from-data-ok")) "  PASS"
            else "  FAIL — execve() blocked or binary unusable (expected at targetSdk >= 29)"
    }

    /**
     * Group kill through the production path: ProcessSupervisor starts the child under
     * setsid, cancel() sends SIGTERM to the group, waits 2 s, then SIGKILL.
     */
    private fun t3GroupKill(): String {
        if (!File("/system/bin/setsid").exists()) return "  SKIP — /system/bin/setsid not present"

        val exitCode = java.util.concurrent.atomic.AtomicInteger(-2)
        val done = java.util.concurrent.CountDownLatch(1)
        val handle = supervisor.start(
            ProcessSupervisor.Spec(
                argv = listOf("/system/bin/sh", "-c", "sleep 30; echo should-not-print"),
                cwd = workspace.defaultWorkspace,
                timeoutMs = 60_000
            ),
            onStdout = {},
            onStderr = {},
            onExit = { code ->
                exitCode.set(code)
                done.countDown()
            }
        )

        Thread.sleep(500)
        val cancelled = supervisor.cancel(handle.jobId)
        val exited = done.await(5, TimeUnit.SECONDS)

        val groupGone = ProcessBuilder("/system/bin/sh", "-c", "kill -0 -${handle.pid} 2>/dev/null")
            .start()
            .waitFor() != 0

        return "  pid=${handle.pid} cancelled=$cancelled exited=${if (exited) "yes" else "no"} " +
            "exit=${exitCode.get()} groupGone=$groupGone\n" +
            if (exited && groupGone) "  PASS" else "  FAIL — process group survived cancel"
    }

    private fun t4ExitCode(): String {
        val r = runSpec(
            ProcessSupervisor.Spec(
                argv = listOf("/system/bin/sh", "-c", "echo to-stdout; echo to-stderr >&2; exit 42"),
                cwd = workspace.defaultWorkspace,
                timeoutMs = 10_000
            )
        )
        return format(r) + if (r.exitCode == 42 && r.stderr.contains("to-stderr")) "  PASS" else "  FAIL"
    }

    private fun t5Flood(): String {
        // 25 MB, not 50: measured on the Redmi Note 7S, a `yes | head -c` pipeline moves
        // ~0.7 MB/s through the shell (69 s for 50 MB). 25 MB finishes inside the timeout,
        // which lets us assert both "process completed" and "buffer stayed bounded".
        val r = runSpec(
            ProcessSupervisor.Spec(
                argv = listOf("/system/bin/sh", "-c", "yes 0123456789 | head -c 25000000"),
                cwd = workspace.defaultWorkspace,
                timeoutMs = 120_000,
                maxOutputBytes = 256 * 1024
            )
        )
        val throughput = if (r.durationMs > 0) 25_000_000L / r.durationMs else 0L
        return "  exit=${r.exitCode} time=${r.durationMs}ms captured=${r.stdout.length}B " +
            "truncated=${r.stdoutTruncated} timedOut=${r.timedOut} rate=${throughput}KB/s\n" +
            if (r.stdoutTruncated && !r.timedOut && r.exitCode == 0) "  PASS — bounded and completed"
            else if (r.stdoutTruncated) "  PARTIAL — bounded, but the pipeline did not finish cleanly"
            else "  FAIL — cap not enforced"
    }

    private fun t6Pty(): String {
        if (!NativePty.available()) return "  SKIP — native library not loaded"

        val session = PtySession.open(
            cmd = "echo pty-ok; echo cols=\$(stty size | cut -d' ' -f2); exit 7",
            cwd = workspace.defaultWorkspace.absolutePath,
            env = workspace.childEnv(),
            rows = 24,
            cols = 80
        ) ?: return "  FAIL — createSubprocess returned null"

        val text = session.read(timeoutMs = 4_000)
        val exit = session.waitFor()
        session.destroy()

        return "  pageSize=${NativePty.pageSize()}\n" +
            "  output=${text.trim().replace("\n", " | ")}\n" +
            "  exit=$exit (expected 7)\n" +
            if (text.contains("pty-ok") && exit == 7) "  PASS" else "  FAIL"
    }

    /**
     * T8: the child must see exactly the ChildEnv allowlist. The native probe
     * execs /system/bin/env with the same envp array a PTY session uses, so a
     * leaked parent variable (for example ANDROID_DATA) fails the test.
     */
    private fun t8PtyEnv(): String {
        if (!NativePty.available()) return "  SKIP — native library not loaded"
        val env = workspace.childEnv()
        val pairs = env.map { (key, value) -> "$key=$value" }.toTypedArray()
        val out = runCatching { NativePty.probeEnvironment(pairs) }
            .getOrElse { return "  FAIL — probe threw ${it.message}" }

        val keys = out.lineSequence()
            .filter { it.contains('=') }
            .map { it.substringBefore('=') }
            .filter { it.isNotBlank() }
            .toSet()
        val allowed = env.keys
        val unexpected = keys - allowed
        val missing = allowed - keys
        val pwd = out.lineSequence()
            .firstOrNull { it.startsWith("PWD=") }
            ?.substringAfter("PWD=")

        return buildString {
            appendLine("  allowed=${allowed.sorted().joinToString(",")}")
            appendLine("  child=${keys.sorted().joinToString(",")}")
            appendLine("  unexpected=${unexpected.sorted()} missing=${missing.sorted()}")
            appendLine("  PWD=${pwd ?: "<absent>"}")
            append(if (unexpected.isEmpty() && missing.isEmpty()) "  PASS" else "  FAIL")
        }
    }

    /** T9: after dup2 and close_inherited_fds only 0/1/2 may remain open. */
    private fun t9PtyFds(): String {
        if (!NativePty.available()) return "  SKIP — native library not loaded"
        val pairs = workspace.childEnv()
            .map { (key, value) -> "$key=$value" }
            .toTypedArray()
        val out = runCatching { NativePty.probeFds(pairs) }
            .getOrElse { return "  FAIL — probe threw ${it.message}" }
        val line = out.lineSequence().firstOrNull { it.startsWith("open_above_2=") }
            ?: return "  FAIL — no result: ${out.trim()}"
        val count = line.substringAfter('=').trim().toIntOrNull() ?: -1
        return "  $line\n" + if (count == 0) "  PASS" else "  FAIL — $count inherited fd(s)"
    }

    private fun t7Toybox(): String {        val r = runSpec(
            ProcessSupervisor.Spec(
                argv = listOf(
                    "/system/bin/sh",
                    "-c",
                    "echo '--- tools ---'; for t in setsid tar gzip unzip sed awk grep find xxd curl git python; do " +
                        "command -v \$t >/dev/null 2>&1 && echo \"yes \$t\" || echo \"no  \$t\"; done"
                ),
                cwd = workspace.defaultWorkspace,
                timeoutMs = 15_000,
                maxOutputBytes = 64 * 1024
            )
        )
        return format(r)
    }

    /**
     * S1: does legacy shared storage still work at targetSdk 28 on this Android version?
     * Granted with `adb shell pm grant dev.leocode android.permission.READ_EXTERNAL_STORAGE`
     * (and WRITE_...); the UI grants the same pair through MainActivity.
     */
    private fun s1SharedStorage(): String {
        val readGranted = checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED
        val writeGranted = checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED
        if (!readGranted) {
            return "  READ_EXTERNAL_STORAGE not granted\n  SKIP — grant it first (pm grant / UI)"
        }

        val root = Environment.getExternalStorageDirectory()
        val entries = runCatching { root.listFiles()?.size ?: 0 }.getOrElse { -1 }
        val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val probe = File(downloads, "leocode-s1-${System.currentTimeMillis()}.txt")
        val wrote = runCatching {
            probe.writeText("leocode-shared-storage-ok")
            true
        }.getOrElse { false }
        val roundTrip = if (wrote) {
            runCatching { probe.readText() }.getOrNull()
        } else {
            null
        }
        runCatching { probe.delete() }

        val canList = entries >= 0
        val canWrite = wrote && roundTrip == "leocode-shared-storage-ok"
        return "  root=${root.absolutePath} entries=$entries\n" +
            "  read=$readGranted write=$writeGranted writeTest=$wrote\n" +
            "  probe=${probe.absolutePath}\n" +
            if (canList && canWrite) "  PASS — legacy shared storage usable"
            else "  FAIL — list=$canList write=$canWrite (scoped storage enforced?)"
    }
}
