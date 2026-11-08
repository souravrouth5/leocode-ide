package dev.leocode

object DevServerConfig {
    const val DEV_PORT = 5173
    const val DEV_URL_DEFAULT = "http://localhost:5173"
    const val DEV_URL_LOOPBACK = "http://127.0.0.1:5173"

    fun buildPageUrl(baseUrl: String, themeMode: String, effectiveTheme: String): String {
        val query = "mode=$themeMode&theme=$effectiveTheme"
        val delimiter = if (baseUrl.contains("?")) "&" else "?"
        return "$baseUrl$delimiter$query"
    }

    fun resolveDevUrl(
        devUrlExtra: String?,
        isReachable: (String) -> Boolean
    ): String? {
        if (!devUrlExtra.isNullOrBlank()) {
            if (isReachable(devUrlExtra)) {
                return devUrlExtra
            }
        }
        if (isReachable(DEV_URL_DEFAULT)) {
            return DEV_URL_DEFAULT
        }
        if (isReachable(DEV_URL_LOOPBACK)) {
            return DEV_URL_LOOPBACK
        }
        return null
    }
}
