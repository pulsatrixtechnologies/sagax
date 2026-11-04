package com.openmausbot.companion.core

import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class ThreadFilesClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: CompanionClient

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        val connection = requireNotNull(Connection.parse(server.url("/").toString()))
        client = CompanionClient(connection, "paired-token")
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun threadFilesListsTheConversationAndPinPosts() = runBlocking<Unit> {
        server.enqueue(
            json(
                """{"files":[{"id":"f1","name":"brief.md","at":10,"pinned":false,"available":true,"source":"upload","path":"brief.md"}]}""",
            ),
        )
        server.enqueue(json("{}"))

        val files = client.threadFiles("t-1")
        assertEquals(1, files.size)
        assertEquals("f1", files[0].id)
        assertEquals("brief.md", files[0].name)
        assertEquals(ThreadFile.Source.UPLOAD, files[0].source)

        client.setThreadFilePin("t-1", "f1", pinned = true)
        assertEquals("/api/threads/t-1/files", server.takeRequest().path)
        val pin = server.takeRequest()
        assertEquals("/api/threads/t-1/files/f1/pin", pin.path)
        assertEquals("POST", pin.method)
        assertTrue(pin.body.readUtf8().contains("\"pinned\":true"))
    }

    @Test
    fun authSessionDecodesThePrincipal() = runBlocking<Unit> {
        server.enqueue(
            json(
                """{"kind":"session","principalId":"pr_wren","email":"wren@example.test","role":"owner","scopes":["client","admin"]}""",
            ),
        )
        val session = client.authSession()
        assertEquals("pr_wren", session.principalId)
        assertEquals("owner", session.role)
        assertTrue(session.isAdmin)
        assertEquals("/api/auth/session", server.takeRequest().path)
    }

    private fun json(body: String, code: Int = 200): MockResponse = MockResponse()
        .setResponseCode(code)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}
