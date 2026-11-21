package dev.leocode.bridge

import kotlinx.serialization.json.Json

/**
 * One JSON configuration for every bridge DTO (B-19).
 *
 * `encodeDefaults = true` keeps fields such as `TermOk.ok` and `TermInfo.root`
 * on the wire; with the default `false` kotlinx serialization silently dropped
 * them and replies did not match the contract.
 */
object BridgeJson {
    val value: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
}
