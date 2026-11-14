#define _GNU_SOURCE

#include <jni.h>
#include <android/log.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define TAG "LeoCodePty"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

#define SHELL_PATH "/system/bin/sh"

static int set_winsize(int fd, int rows, int cols) {
    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_row = (unsigned short) (rows > 0 ? rows : 24);
    ws.ws_col = (unsigned short) (cols > 0 ? cols : 80);
    return ioctl(fd, TIOCSWINSZ, &ws);
}

static void child_fail(const char *what) {
    char buf[256];
    int n = snprintf(buf, sizeof(buf), "leocode-pty: %s: %s\r\n", what, strerror(errno));
    if (n > 0) {
        ssize_t ignored = write(STDERR_FILENO, buf, (size_t) n);
        (void) ignored;
    }
    _exit(127);
}

static void free_env(char **pairs) {
    if (pairs == NULL) return;
    for (size_t i = 0; pairs[i] != NULL; i++) free(pairs[i]);
    free(pairs);
}

/*
 * Copies the Java String[] into a NULL-terminated envp array before fork().
 * Nothing here touches JNI after the fork, and the child never calls setenv():
 * the array is handed straight to execve().
 */
static char **copy_env_pairs(JNIEnv *env, jobjectArray env_pairs) {
    if (env_pairs == NULL) return NULL;
    jsize count = (*env)->GetArrayLength(env, env_pairs);
    if (count <= 0) return NULL;

    char **pairs = (char **) calloc((size_t) count + 1, sizeof(char *));
    if (pairs == NULL) return NULL;

    size_t out = 0;
    for (jsize i = 0; i < count; i++) {
        jstring pair = (jstring) (*env)->GetObjectArrayElement(env, env_pairs, i);
        if (pair == NULL) continue;
        const char *cpair = (*env)->GetStringUTFChars(env, pair, NULL);
        if (cpair != NULL) {
            /* Only KEY=VALUE entries are valid envp members. */
            const char *eq = strchr(cpair, '=');
            if (eq != NULL && eq != cpair) {
                char *copy = strdup(cpair);
                if (copy != NULL) pairs[out++] = copy;
            }
            (*env)->ReleaseStringUTFChars(env, pair, cpair);
        }
        (*env)->DeleteLocalRef(env, pair);
    }
    return pairs;
}

/* Restore the signal state inherited from the JVM before exec. */
static void reset_child_signals(void) {
    sigset_t empty;
    sigemptyset(&empty);
    sigprocmask(SIG_SETMASK, &empty, NULL);
    for (int sig = 1; sig < _NSIG; sig++) {
        signal(sig, SIG_DFL);
    }
}

/*
 * Close every fd above stderr that the JVM/Zygote handed to the child. The
 * kernel-level close_range is one syscall and is preferred where the kernel
 * supports it; the fallback loop is bounded so a huge RLIMIT cannot stall the
 * child. Called after the PTY is dup2()'d onto 0/1/2.
 */
static void close_inherited_fds(void) {
#if defined(SYS_close_range)
    if (syscall(SYS_close_range, 3U, ~0U, 0U) == 0) return;
#endif
    long max = sysconf(_SC_OPEN_MAX);
    if (max < 3 || max > 65536) max = 65536;
    for (int fd = 3; fd < (int) max; fd++) close(fd);
}

/*
 * int[] createSubprocess(String shellCmd, String cwd, String[] envPairs, int rows, int cols)
 * returns { pid, masterFd } or { -1, -1 }.
 *
 * All JNI work happens before fork(). The child only touches plain C memory,
 * which keeps the fork/exec window safe.
 */
JNIEXPORT jintArray JNICALL
Java_dev_leocode_core_NativePty_createSubprocess(
        JNIEnv *env, jobject thiz,
        jstring shell_cmd, jstring cwd,
        jobjectArray env_pairs,
        jint rows, jint cols) {

    (void) thiz;

    jintArray fail = (*env)->NewIntArray(env, 2);
    jint none[2] = {-1, -1};
    if (fail != NULL) (*env)->SetIntArrayRegion(env, fail, 0, 2, none);

    if (shell_cmd == NULL || cwd == NULL) return fail;

    const char *cmd = (*env)->GetStringUTFChars(env, shell_cmd, NULL);
    const char *workdir = (*env)->GetStringUTFChars(env, cwd, NULL);
    if (cmd == NULL || workdir == NULL) {
        if (cmd) (*env)->ReleaseStringUTFChars(env, shell_cmd, cmd);
        if (workdir) (*env)->ReleaseStringUTFChars(env, cwd, workdir);
        return fail;
    }

    /* Marshal environment and argv before fork; no JNI calls in the child. */
    char **child_env = copy_env_pairs(env, env_pairs);
    char *child_argv[4];
    child_argv[0] = (char *) "sh";
    child_argv[1] = (char *) "-c";
    child_argv[2] = (char *) cmd;
    child_argv[3] = NULL;

    int master = -1;
    int slave = -1;
    pid_t pid = -1;
    jintArray result = NULL;

    master = posix_openpt(O_RDWR | O_NOCTTY);
    if (master < 0) {
        LOGE("posix_openpt failed: %s", strerror(errno));
        goto cleanup;
    }
    if (grantpt(master) != 0 || unlockpt(master) != 0) {
        LOGE("grantpt/unlockpt failed: %s", strerror(errno));
        goto cleanup;
    }

    char slave_path[128];
    int name_error = ptsname_r(master, slave_path, sizeof(slave_path));
    if (name_error != 0) {
        LOGE("ptsname_r failed: %s", strerror(name_error));
        goto cleanup;
    }

    slave = open(slave_path, O_RDWR | O_NOCTTY);
    if (slave < 0) {
        LOGE("open(%s) failed: %s", slave_path, strerror(errno));
        goto cleanup;
    }

    set_winsize(master, rows, cols);

    pid = fork();
    if (pid < 0) {
        LOGE("fork failed: %s", strerror(errno));
        goto cleanup;
    }

    if (pid == 0) {
        /* child: plain C only, no JNI, no allocation */
        close(master);

        if (setsid() < 0) child_fail("setsid");
        if (ioctl(slave, TIOCSCTTY, 0) < 0) child_fail("TIOCSCTTY");

        if (dup2(slave, STDIN_FILENO) < 0 ||
            dup2(slave, STDOUT_FILENO) < 0 ||
            dup2(slave, STDERR_FILENO) < 0) {
            child_fail("dup2");
        }
        if (slave > STDERR_FILENO) close(slave);
        close_inherited_fds();
        reset_child_signals();

        if (chdir(workdir) != 0) child_fail("chdir");

        char *empty_env[1] = { NULL };
        execve(SHELL_PATH, child_argv, child_env != NULL ? child_env : empty_env);
        child_fail("execve");
    }

    /* parent */
    close(slave);
    slave = -1;

    jint values[2];
    values[0] = (jint) pid;
    values[1] = (jint) master;
    result = (*env)->NewIntArray(env, 2);
    if (result != NULL) {
        (*env)->SetIntArrayRegion(env, result, 0, 2, values);
    }
    master = -1; /* ownership handed to Kotlin */

cleanup:
    if (slave >= 0) close(slave);
    if (master >= 0) close(master);
    free_env(child_env);
    (*env)->ReleaseStringUTFChars(env, shell_cmd, cmd);
    (*env)->ReleaseStringUTFChars(env, cwd, workdir);
    return result != NULL ? result : fail;
}

/*
 * Harness probes (Task 9). Both fork/exec with the same envp builder and the
 * same close_inherited_fds() path as a real session, then return what the child
 * saw on stdout:
 *   mode 0: /system/bin/env output (T8)
 *   mode 1: "open_above_2=N" after fd cleanup (T9)
 */
static jstring run_probe(JNIEnv *env, jobjectArray env_pairs, int mode) {
    int pipefd[2];
    if (pipe(pipefd) != 0) return NULL;

    char **child_env = copy_env_pairs(env, env_pairs);
    pid_t pid = fork();
    if (pid < 0) {
        close(pipefd[0]);
        close(pipefd[1]);
        free_env(child_env);
        return NULL;
    }

    if (pid == 0) {
        close(pipefd[0]);
        if (setsid() < 0) _exit(127);
        if (dup2(pipefd[1], STDOUT_FILENO) < 0 ||
            dup2(pipefd[1], STDERR_FILENO) < 0) {
            _exit(127);
        }
        if (pipefd[1] > STDERR_FILENO) close(pipefd[1]);
        close_inherited_fds();
        reset_child_signals();

        if (mode == 0) {
            char *argv[2];
            argv[0] = (char *) "env";
            argv[1] = NULL;
            char *empty_env[1] = { NULL };
            execve("/system/bin/env", argv, child_env != NULL ? child_env : empty_env);
            _exit(127);
        }

        int open_high = 0;
        for (int fd = 3; fd < 256; fd++) {
            if (fcntl(fd, F_GETFD) != -1) open_high++;
        }
        char buf[32];
        int n = snprintf(buf, sizeof(buf), "open_above_2=%d\n", open_high);
        if (n > 0) {
            ssize_t ignored = write(STDOUT_FILENO, buf, (size_t) n);
            (void) ignored;
        }
        _exit(open_high == 0 ? 0 : 2);
    }

    close(pipefd[1]);
    char out[65536];
    size_t used = 0;
    while (used < sizeof(out) - 1) {
        ssize_t r = read(pipefd[0], out + used, sizeof(out) - 1 - used);
        if (r > 0) {
            used += (size_t) r;
        } else if (r < 0 && errno == EINTR) {
            continue;
        } else {
            break;
        }
    }
    close(pipefd[0]);

    int status = 0;
    while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {
        /* retry */
    }
    out[used] = '\0';
    free_env(child_env);
    return (*env)->NewStringUTF(env, out);
}

JNIEXPORT jstring JNICALL
Java_dev_leocode_core_NativePty_probeEnvironment(
        JNIEnv *env, jobject thiz, jobjectArray env_pairs) {
    (void) thiz;
    return run_probe(env, env_pairs, 0);
}

JNIEXPORT jstring JNICALL
Java_dev_leocode_core_NativePty_probeFds(
        JNIEnv *env, jobject thiz, jobjectArray env_pairs) {
    (void) thiz;
    return run_probe(env, env_pairs, 1);
}

JNIEXPORT jint JNICALL
Java_dev_leocode_core_NativePty_setWindowSize(JNIEnv *env, jobject thiz, jint fd, jint rows, jint cols) {
    (void) env;
    (void) thiz;
    return set_winsize(fd, rows, cols);
}

JNIEXPORT jint JNICALL
Java_dev_leocode_core_NativePty_waitFor(JNIEnv *env, jobject thiz, jint pid) {
    (void) env;
    (void) thiz;
    int status = 0;
    pid_t r;
    do {
        r = waitpid((pid_t) pid, &status, 0);
    } while (r < 0 && errno == EINTR);

    if (r < 0) return -1;
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return -1;
}

/* Negative pid targets the process group created by setsid(). */
JNIEXPORT jint JNICALL
Java_dev_leocode_core_NativePty_killGroup(JNIEnv *env, jobject thiz, jint pid, jint signal_number) {
    (void) env;
    (void) thiz;
    if (pid <= 0) return -1;
    if (kill((pid_t) -pid, signal_number) == 0) return 0;
    return kill((pid_t) pid, signal_number);
}

JNIEXPORT jint JNICALL
Java_dev_leocode_core_NativePty_pageSize(JNIEnv *env, jobject thiz) {
    (void) env;
    (void) thiz;
    long page = sysconf(_SC_PAGESIZE);
    return page > 0 ? (jint) page : 4096;
}
