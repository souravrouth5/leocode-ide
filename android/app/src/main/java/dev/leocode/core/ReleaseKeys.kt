package dev.leocode.core

import java.util.Base64

/**
 * Ed25519 key for signed release manifests (Task 28).
 *
 * The private half lives outside the repository (`~/.config/leocode/release-signing.pem`
 * locally, `RELEASE_SIGNING_KEY` in the protected `release` environment in CI).
 * The public half is compiled in so a manifest fetched over the network cannot
 * be swapped without the key, even if the download host is compromised.
 *
 * Rotating the key means: generate a new pair, update the protected environment
 * secret, replace [RELEASE], and re-sign `release.json` for every published
 * release. [FINGERPRINT] is the SHA-256 of the SubjectPublicKeyInfo DER and is
 * printed by `scripts/sign-manifest.sh`.
 */
object ReleaseKeys {
    /** Raw 32-byte Ed25519 public key for release manifests. */
    val RELEASE: ByteArray =
        Base64.getDecoder().decode("ADXNhDgqluTWa5lOPsmww5Rc+Fgg3Zolg9JnZ9KJW3A=")

    const val FINGERPRINT: String =
        "87e1a3b8f4f5ebb9045ae06d617b42104b02211a01964b03a232c0c46b204142"
}
