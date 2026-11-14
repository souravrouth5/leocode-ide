/**
 * Transport limits shared with the host (`BridgeHost.MAX_MESSAGE_BYTES`).
 *
 * The 256 KB cap made the documented 4 MB write unreachable: a 300 KB save
 * waited 20 s and failed as a timeout. The cap now covers a 4 MB payload plus
 * JSON escaping and terminal base64 overhead (B-04).
 */
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024
