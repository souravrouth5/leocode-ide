package dev.leocode.core.language

import java.io.File

/**
 * Registry holding all available [LanguageProvider] implementations (Task 30).
 *
 * Provides lookups by language id or file extension.
 */
class LanguageRegistry(initialProviders: List<LanguageProvider> = emptyList()) {

    private val providersById = mutableMapOf<String, LanguageProvider>()
    private val providersByExt = mutableMapOf<String, LanguageProvider>()

    init {
        for (provider in initialProviders) {
            register(provider)
        }
    }

    @Synchronized
    fun register(provider: LanguageProvider) {
        providersById[provider.id] = provider
        for (ext in provider.extensions) {
            providersByExt[ext.lowercase()] = provider
        }
    }

    @Synchronized
    fun unregister(id: String): LanguageProvider? {
        val provider = providersById.remove(id) ?: return null
        for (ext in provider.extensions) {
            if (providersByExt[ext.lowercase()] == provider) {
                providersByExt.remove(ext.lowercase())
            }
        }
        return provider
    }

    @Synchronized
    fun all(): List<LanguageProvider> = providersById.values.toList()

    @Synchronized
    fun get(id: String): LanguageProvider? = providersById[id]

    @Synchronized
    fun findForFile(fileRelPath: String): LanguageProvider? {
        val ext = fileRelPath.substringAfterLast('.', "").lowercase()
        if (ext.isEmpty()) return null
        return providersByExt[ext]
    }

    @Synchronized
    fun clear() {
        providersById.clear()
        providersByExt.clear()
    }
}
