package dev.leocode.core

import java.util.Base64

/**
 * Ed25519 keys for runtime manifests (Task 25).
 *
 * The private keys live outside the repository. CI reads `RUNTIME_SIGNING_KEY`
 * from the protected `python-runtime` environment; the matching public key is
 * compiled in here so a modified manifest is rejected before any download.
 *
 * Rotating the key means: generate a new pair, add the private half to the
 * environment, replace the value below, and re-sign each `assets/runtime/<id>.json`.
 * [FINGERPRINT] is the SHA-256 of the SubjectPublicKeyInfo DER and is printed
 * by `scripts/sign-runtime-manifest.sh`.
 */
object RuntimeKeys {
    /** Raw 32-byte Ed25519 public key for the `python` runtime. */
    val PYTHON: ByteArray =
        Base64.getDecoder().decode("o081Jc/GA3GxcAQ5Blch3e/fCuNB4sxv1tMgBLnfw7s=")

    const val FINGERPRINT: String =
        "3552be7042e2dbb9a0088580db46fd2adb23139ad5b33cee11aef7209a96c95e"
}
