package dev.leocode.bridge

/**
 * A failure that is safe to show to the WebView: [errorCode] and [message] go
 * over the bridge unchanged. Never put stack traces, class names or secrets in
 * the message.
 */
class BridgeException(
    val errorCode: ErrorCode,
    override val message: String
) : Exception(message)
