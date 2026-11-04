package com.openmausbot.companion.core

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class GroupMemoryClientTest {
    private lateinit var server: MockWebServer
    private lateinit var connection: Connection
    private lateinit var client: CompanionClient

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        connection = requireNotNull(Connection.parse(server.url("/").toString()))
        client = CompanionClient(connection, "paired-token")
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun memoryReadSaveAndConflict() = runBlocking {
        server.enqueue(json(fixtureText("group-memory")))

        val read = client.groupMemory("g-1")
        val get = server.takeRequest()
        assertEquals("GET", get.method)
        assertEquals("/api/groups/g-1/memory", get.path)
        assertEquals("Bearer paired-token", get.getHeader("Authorization"))
        assertEquals("- fact", read.text)
        assertTrue(read.canEdit)
        assertEquals(64, read.hash.length)

        server.enqueue(json(fixtureText("group-memory")))
        client.putGroupMemory("g-1", text = "- two", expectedHash = read.hash)
        val put = server.takeRequest()
        assertEquals("PUT", put.method)
        assertEquals("/api/groups/g-1/memory", put.path)
        val putBody = Json.parseToJsonElement(put.body.readUtf8()).jsonObject
        assertEquals("- two", putBody["text"]?.jsonPrimitive?.content)
        assertEquals(read.hash, putBody["expectedHash"]?.jsonPrimitive?.content)

        server.enqueue(json(fixtureText("group-memory")))
        client.putGroupMemory("g-1", enabled = false)
        val switch = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("false", switch["enabled"]?.jsonPrimitive?.content)

        server.enqueue(json("""{"error":"changed","code":"conflict"}""", code = 409))
        assertFailsWith<GroupMemoryConflict> {
            client.putGroupMemory("g-1", text = "x", expectedHash = read.hash)
        }
    }

    @Test
    fun patchSendsOnlyTheFieldsSet() = runBlocking {
        server.enqueue(json(fixtureText("group-patched")))
        val updated = client.patchRoom("g-1", RoomPatch(name = "Renamed"))
        val request = server.takeRequest()
        assertEquals("PATCH", request.method)
        assertEquals("/api/groups/g-1", request.path)
        assertEquals(
            """{"name":"Renamed"}""",
            request.body.readUtf8(),
        )
        assertEquals("a", updated.defaultResponder.fallbackBotId)
        assertEquals("p-me", updated.ownerId)
        assertEquals(listOf("p-me", "p-bob"), updated.humanIds)
        assertEquals(true, updated.mentionAll)
        assertEquals("/workspace/ops", updated.cwd)
        assertEquals(false, updated.peopleDm)

        server.enqueue(json(fixtureText("group-patched")))
        client.patchRoom(
            "g-1",
            RoomPatch(defaultResponder = GroupResponder(kind = "auto", fallbackBotId = "a")),
        )
        assertEquals(
            """{"defaultResponder":{"kind":"auto","fallbackBotId":"a"}}""",
            server.takeRequest().body.readUtf8(),
        )

        server.enqueue(json(fixtureText("group-patched")))
        client.patchRoom("g-1", RoomPatch(section = "", humanIds = emptyList()))
        val cleared = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("", cleared["section"]?.jsonPrimitive?.content)
        assertEquals(0, cleared["humanIds"]?.jsonArray?.size)

        assertFailsWith<APIError.BadUrl> {
            client.patchRoom("../x", RoomPatch(name = "n"))
        }
    }

    @Test
    fun deleteAndLeave() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        client.deleteRoom("g-1")
        val delete = server.takeRequest()
        assertEquals("DELETE", delete.method)
        assertEquals("/api/groups/g-1", delete.path)

        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        client.leaveRoom("g-1")
        val leave = server.takeRequest()
        assertEquals("POST", leave.method)
        assertEquals("/api/groups/g-1/leave", leave.path)

        assertFailsWith<APIError.BadUrl> {
            client.deleteRoom("../x")
        }
    }

    private fun json(body: String, code: Int = 200): MockResponse = MockResponse()
        .setResponseCode(code)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}
