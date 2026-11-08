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

    /* Marshal environment before fork; no JNI calls in the child. */
    char **child_env = NULL;
    if (env_pairs != NULL) {
        jsize count = (*env)->GetArrayLength(env, env_pairs);
        if (count > 0) {
            child_env = (char **) calloc((size_t) count + 1, sizeof(char *));
            if (child_env != NULL) {
                size_t out = 0;
                for (jsize i = 0; i < count; i++) {
                    jstring pair = (jstring) (*env)->GetObjectArrayElement(env, env_pairs, i);
                    if (pair == NULL) continue;
                    const char *cpair = (*env)->GetStringUTFChars(env, pair, NULL);
                    if (cpair != NULL) {
                        char *copy = strdup(cpair);
                        if (copy != NULL) child_env[out++] = copy;
                        (*env)->ReleaseStringUTFChars(env, pair, cpair);
                    }
                    (*env)->DeleteLocalRef(env, pair);
                }
            }
        }
    }

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

    const char *slave_name = ptsname(master);
    if (slave_name == NULL) {
        LOGE("ptsname failed: %s", strerror(errno));
        goto cleanup;
    }

    char slave_path[128];
    strncpy(slave_path, slave_name, sizeof(slave_path) - 1);
    slave_path[sizeof(slave_path) - 1] = '\0';

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
        /* child: plain C only */
        close(master);

        if (setsid() < 0) child_fail("setsid");
        ioctl(slave, TIOCSCTTY, 0);

        if (dup2(slave, STDIN_FILENO) < 0 ||
            dup2(slave, STDOUT_FILENO) < 0 ||
            dup2(slave, STDERR_FILENO) < 0) {
            child_fail("dup2");
        }
        if (slave > STDERR_FILENO) close(slave);

        if (chdir(workdir) != 0) child_fail("chdir");

        if (child_env != NULL) {
            for (size_t i = 0; child_env[i] != NULL; i++) {
                char *eq = strchr(child_env[i], '=');
                if (eq != NULL && eq != child_env[i]) {
                    *eq = '\0';
                    setenv(child_env[i], eq + 1, 1);
                }
            }
        }

        execl(SHELL_PATH, "sh", "-c", cmd, (char *) NULL);
        child_fail("execl");
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
