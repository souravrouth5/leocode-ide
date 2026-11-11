/*
 * Minimal Python launcher for the runtime installed under files/usr.
 *
 * The official python.org Android package contains libpython and the standard
 * library but no executable (PEP 738). This launcher is copied to
 * <prefix>/bin/python3 and loads libpython from <prefix>/lib at runtime, so it
 * does not need the Python headers or libraries at APK build time.
 *
 * Build: scripts/build-python-launcher.sh
 */
#include <dirent.h>
#include <dlfcn.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef int (*py_bytes_main_fn)(int, char **);

/* <prefix>/bin/python3 -> <prefix> */
static int prefix_from_exe(char *out, size_t out_size) {
    char exe[PATH_MAX];
    ssize_t n = readlink("/proc/self/exe", exe, sizeof(exe) - 1);
    if (n <= 0) return -1;
    exe[n] = '\0';

    char *slash = strrchr(exe, '/'); /* bin/python3 -> bin */
    if (!slash) return -1;
    *slash = '\0';
    slash = strrchr(exe, '/');       /* bin -> prefix */
    if (!slash) return -1;
    *slash = '\0';

    if (strlen(exe) + 1 > out_size) return -1;
    strcpy(out, exe);
    return 0;
}

/* Find libpython3.<minor>.so in <prefix>/lib without knowing the version. */
static int find_libpython(const char *prefix, char *out, size_t out_size) {
    char libdir[PATH_MAX];
    if (snprintf(libdir, sizeof(libdir), "%s/lib", prefix) >= (int)sizeof(libdir)) return -1;

    DIR *dir = opendir(libdir);
    if (!dir) return -1;

    struct dirent *entry;
    int found = 0;
    while ((entry = readdir(dir)) != NULL) {
        const char *name = entry->d_name;
        const size_t len = strlen(name);
        if (strncmp(name, "libpython3.", 11) != 0) continue;
        if (len <= 14 || strcmp(name + len - 3, ".so") != 0) continue;

        int digits = 0;
        for (const char *p = name + 11; p < name + len - 3; p++) {
            if (*p < '0' || *p > '9') { digits = 0; break; }
            digits++;
        }
        if (digits == 0) continue;

        if (snprintf(out, out_size, "%s/%s", libdir, name) >= (int)out_size) break;
        found = 1;
        break;
    }
    closedir(dir);
    return found ? 0 : -1;
}

int main(int argc, char **argv) {
    char prefix[PATH_MAX];
    if (prefix_from_exe(prefix, sizeof(prefix)) != 0) {
        fprintf(stderr, "LeoCode: cannot determine the Python prefix\n");
        return 127;
    }
    setenv("PYTHONHOME", prefix, 1);

    char libpython[PATH_MAX];
    if (find_libpython(prefix, libpython, sizeof(libpython)) != 0) {
        fprintf(stderr, "LeoCode: no libpython found in %s/lib\n", prefix);
        return 127;
    }

    void *handle = dlopen(libpython, RTLD_NOW | RTLD_GLOBAL);
    if (!handle) {
        fprintf(stderr, "LeoCode: cannot load %s: %s\n", libpython, dlerror());
        return 127;
    }

    py_bytes_main_fn run = (py_bytes_main_fn)dlsym(handle, "Py_BytesMain");
    if (!run) {
        fprintf(stderr, "LeoCode: %s does not export Py_BytesMain\n", libpython);
        return 127;
    }
    return run(argc, argv);
}
