package dev.leocode.core.secrets

import java.io.IOException

/**
 * The device-bound encryption key is no longer usable (Task 20, D-009).
 *
 * This happens after a lock-screen change invalidates the Keystore key, or on a
 * device whose Keystore cannot create the key at all. Stored tokens and private
 * keys cannot be recovered; the bridge maps this to `E_UNSUPPORTED` with a
 * message asking the user to re-enter them. Never include key material or the
 * underlying exception in the message.
 */
class SecretUnavailableException(
    message: String = "Stored tokens and keys are unavailable on this device; re-enter them"
) : IOException(message)
