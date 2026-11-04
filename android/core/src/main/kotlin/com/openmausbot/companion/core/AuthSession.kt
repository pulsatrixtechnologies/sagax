package com.openmausbot.companion.core

import kotlinx.serialization.Serializable

/**
 * Who this phone is signed in as (`GET /api/auth/session`). A server-paired
 * phone gets `session`; loopback is the desktop itself. Organization servers
 * add the person (principal, email, role). Twin of iOS `AuthSession`.
 */
@Serializable
data class AuthSession(
    val kind: String = "session",
    val id: String? = null,
    val label: String? = null,
    val scopes: List<String> = emptyList(),
    val expiresAt: Double? = null,
    val environmentId: String? = null,
    val email: String? = null,
    val owner: String? = null,
    val name: String? = null,
    val principalId: String? = null,
    val role: String? = null,
    val avatarUrl: String? = null,
    val profileManagedBy: String? = null,
    val cloudGuest: Boolean = false,
    val openedThreads: List<String> = emptyList(),
) {
    val isAdmin: Boolean get() = scopes.contains("admin")
}
