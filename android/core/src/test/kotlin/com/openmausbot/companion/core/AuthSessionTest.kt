package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

class AuthSessionTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes the signed-in session`() {
        val session = json.decodeFromString(
            AuthSession.serializer(),
            """{"kind":"session","principalId":"pr_wren","email":"wren@example.test","role":"member","scopes":["client"]}""",
        )
        assertEquals("pr_wren", session.principalId)
        assertEquals("wren@example.test", session.email)
        assertEquals("member", session.role)
        assertFalse(session.isAdmin)
    }

    @Test
    fun `admin scope is recognized`() {
        val session = AuthSession(scopes = listOf("client", "admin"), principalId = "pr_osprey")
        assertTrue(session.isAdmin)
    }

    @Test
    fun `RoomViewer from account uses principal then email`() {
        val withPrincipal = RoomViewer.from(
            AuthSession(principalId = "PR_Wren", email = "Wren@Example.test", role = "member"),
        )
        assertEquals("pr_wren", withPrincipal.actorId)
        assertEquals("member", withPrincipal.role)
        assertEquals("wren@example.test", withPrincipal.normalizedEmail)

        val emailOnly = RoomViewer.from(AuthSession(email = "Osprey@Example.test"))
        assertEquals("osprey@example.test", emailOnly.actorId)

        assertEquals("local-owner", RoomViewer.from(null).actorId)
        assertEquals("local-owner", RoomViewer.from(AuthSession()).actorId)
    }
}
