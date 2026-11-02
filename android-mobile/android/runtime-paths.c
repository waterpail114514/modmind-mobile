/* SPDX-License-Identifier: MIT
 * Preserve the JDK's logical layout when Android extracts ELF files together.
 * Only JDK processes receive these path substitutions; Node and Bash do not.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <limits.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int is_jdk(void) {
    char path[PATH_MAX];
    ssize_t (*original)(const char*, char*, size_t) = dlsym(RTLD_NEXT, "readlink");
    ssize_t length = original("/proc/self/exe", path, sizeof(path)-1);
    if (length < 0) return 0;
    path[length] = 0;
    return strstr(path, "/libmm_java") || strstr(path, "/libmm_jar") || strstr(path, "/libmm_jspawnhelper");
}
ssize_t readlink(const char *path, char *buffer, size_t size) {
    ssize_t (*original)(const char*, char*, size_t) = dlsym(RTLD_NEXT, "readlink");
    const char *home = getenv("JAVA_HOME");
    if (home && !strcmp(path, "/proc/self/exe") && is_jdk()) {
        char physical[PATH_MAX], tool[80] = "java", logical[PATH_MAX];
        ssize_t raw = original(path, physical, sizeof(physical)-1);
        if (raw > 0) { physical[raw]=0; char *start=strstr(physical,"/libmm_"); if(start) { start+=7; char *end=strstr(start,"_exec.so"); if(end && end-start < (int)sizeof(tool)) { memcpy(tool,start,end-start); tool[end-start]=0; } } }
        snprintf(logical, sizeof(logical), "%s/bin/%s", home, tool);
        size_t length = strlen(logical); if (length > size) length = size;
        memcpy(buffer, logical, length); return length;
    }
    return original(path, buffer, size);
}
int dladdr(const void *address, Dl_info *info) {
    int (*original)(const void*, Dl_info*) = dlsym(RTLD_NEXT, "dladdr");
    int result = original(address, info);
    const char *home = getenv("JAVA_HOME");
    static char jvm[PATH_MAX], jli[PATH_MAX];
    if (result && home && is_jdk() && info->dli_fname) {
        if (strstr(info->dli_fname, "/libjvm.so")) { snprintf(jvm,sizeof(jvm),"%s/lib/server/libjvm.so",home); info->dli_fname=jvm; }
        if (strstr(info->dli_fname, "/libjli.so")) { snprintf(jli,sizeof(jli),"%s/lib/libjli.so",home); info->dli_fname=jli; }
    }
    return result;
}
char *realpath(const char *path, char *resolved) {
    char *(*original)(const char*, char*) = dlsym(RTLD_NEXT, "realpath");
    const char *home = getenv("JAVA_HOME");
    if (home && is_jdk() && !strncmp(path, home, strlen(home)) && path[strlen(home)]=='/' && !strstr(path,"/../") && !strstr(path,"/./")) {
        if (strlen(path) >= PATH_MAX) return original(path, resolved);
        if (!resolved) return strdup(path);
        strcpy(resolved, path); return resolved;
    }
    return original(path, resolved);
}
