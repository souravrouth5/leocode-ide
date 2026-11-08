package dev.leocode.core

import java.io.File

/**
 * App-private storage layout. Nothing here is exposed to the WebView directly;
 * every access goes through the bridge with path-jail checks.
 *
 * root/
 *   workspaces/default/   project files (one workspace for phase 0)
 *   home/                 $HOME for shells and tooling
 *   usr/                  runtime prefix (D-006, Track C2)
 *   tmp/                  $TMPDIR (Android has no writable /tmp)
 */
class Workspace(rootDir: File) {

    val root: File = rootDir
    val workspacesRoot = File(rootDir, "workspaces")
    val defaultWorkspace = File(workspacesRoot, "default")
    val home = File(rootDir, "home")
    val usr = File(rootDir, "usr")
    val tmp = File(rootDir, "tmp")

    fun ensure() {
        listOf(root, workspacesRoot, defaultWorkspace, home, usr, tmp).forEach {
            if (!it.exists() && !it.mkdirs()) {
                throw IllegalStateException("cannot create ${it.absolutePath}")
            }
        }
    }

    /** Resolve [path] inside [base] or throw. Canonicalises to defeat `..` and symlinks. */
    fun jail(base: File, path: String): File {
        val baseCanonical = base.canonicalFile
        val candidate = if (File(path).isAbsolute) File(path) else File(base, path)
        val resolved = candidate.canonicalFile
        val basePath = baseCanonical.path + File.separator
        if (resolved != baseCanonical && !resolved.path.startsWith(basePath)) {
            throw SecurityException("path outside root: $path")
        }
        return resolved
    }

    /** Environment for child processes: no app secrets, no bridge handles. */
    fun childEnv(): Map<String, String> = mapOf(
        "HOME" to home.absolutePath,
        "TMPDIR" to tmp.absolutePath,
        "TMP" to tmp.absolutePath,
        "PATH" to "/system/bin:/system/xbin",
        "TERM" to "xterm-256color",
        "LANG" to "en_US.UTF-8",
        "PWD" to defaultWorkspace.absolutePath
    )
}
