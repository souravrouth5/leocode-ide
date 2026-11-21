package dev.leocode.bridge

/**
 * Bridge error codes, `docs/bridge-contract.md`.
 *
 * This enum is the single source of truth: the TS union is generated from it
 * (Task 7) and every code has a UI catalog entry (Task 12). The string values
 * are part of the wire contract and must not be renamed.
 */
enum class ErrorCode(val code: String) {
    E_BAD_ENVELOPE("E_BAD_ENVELOPE"),
    E_UNKNOWN_METHOD("E_UNKNOWN_METHOD"),
    E_UNSUPPORTED("E_UNSUPPORTED"),
    E_TIMEOUT("E_TIMEOUT"),
    E_CANCELLED("E_CANCELLED"),
    E_BRIDGE_DISCONNECTED("E_BRIDGE_DISCONNECTED"),
    E_PATH_OUTSIDE_ROOT("E_PATH_OUTSIDE_ROOT"),
    E_NOT_FOUND("E_NOT_FOUND"),
    E_NOT_DIR("E_NOT_DIR"),
    E_EXISTS("E_EXISTS"),
    E_BINARY("E_BINARY"),
    E_IO("E_IO"),
    E_DISK_FULL("E_DISK_FULL"),
    E_CONFLICT("E_CONFLICT"),
    E_PERMISSION("E_PERMISSION"),
    E_LIMIT("E_LIMIT"),
    E_BUSY("E_BUSY"),
    E_NO_RUNTIME("E_NO_RUNTIME"),
    E_OFFLINE("E_OFFLINE"),
    E_AUTH("E_AUTH"),
    E_HOSTKEY_CHANGED("E_HOSTKEY_CHANGED"),
    E_ROOT_UNAVAILABLE("E_ROOT_UNAVAILABLE"),
    E_ROOT_DENIED("E_ROOT_DENIED"),
    E_INTERNAL("E_INTERNAL");

    companion object {
        /** Maps a wire code back to the enum; unknown codes become [E_INTERNAL]. */
        fun fromCode(code: String): ErrorCode =
            entries.firstOrNull { it.code == code } ?: E_INTERNAL
    }
}
