package com.openmausbot.companion.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BotActivityClientTest {
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
    fun fetchesBotActivityList() = runBlocking {
        server.enqueue(json(fixtureText("bot-activity")))

        val list = client.botActivity("wren", filter = "coding")

        assertEquals(2, list.items.size)
        assertEquals("thread:th-coding-1", list.items[0].id)
        assertEquals(BotActivityStatus.RUNNING, list.items[0].status)
        assertEquals(true, list.items[0].coding)
        assertEquals("/workspace/bots/wren/dispatch-board", list.items[0].code?.folder)
        assertEquals(1, list.subagents.size)
        assertEquals("Osprey", list.subagents[0].botName)
        assertTrue(activityStatusActive(list.items[0].status))

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/bots/wren/activity?filter=coding", request.path)
        assertEquals("Bearer paired-token", request.getHeader("Authorization"))
    }

    @Test
    fun fetchesBotActivityItemByThreadId() = runBlocking {
        server.enqueue(json(fixtureText("bot-activity-item")))

        val detail = client.botActivityItem(botId = "wren", threadId = "th-coding-1")

        assertEquals("thread:th-coding-1", detail.id)
        assertEquals(true, detail.retry)
        assertEquals("Retry · Keep the board column order", activityTitle(detail))
        assertEquals(1, detail.steps.size)
        assertEquals("pnpm test", detail.steps[0].summary)
        assertEquals(12, detail.code?.pullRequests?.firstOrNull()?.number)
        assertEquals("abcdef1234", detail.code?.commits?.firstOrNull()?.sha)
        assertEquals("1h 05m", formatActivityDuration(65 * 60_000.0))

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/bots/wren/activity/item?threadId=th-coding-1", request.path)
    }

    @Test
    fun parsesItemIdAndFetchesCloudOrRun() = runBlocking {
        assertEquals(CodingChatItemIds(threadId = "th-1"), codingChatItemIds("thread:th-1"))
        assertEquals(CodingChatItemIds(runId = "run-9"), codingChatItemIds("run:run-9"))
        assertEquals(CodingChatItemIds(cloudId = "c-1"), codingChatItemIds("cloud:c-1"))

        server.enqueue(json(fixtureText("bot-activity-item")))
        client.botActivityItem("wren", "cloud:c-1")
        assertEquals("/api/bots/wren/activity/item?cloudId=c-1", server.takeRequest().path)
    }

    @Test
    fun stopsParallelAndCancelsCloud() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        client.stopParallelTask("wren", "th-parallel")
        val parallel = server.takeRequest()
        assertEquals("POST", parallel.method)
        assertEquals("/api/bots/wren/parallel/th-parallel/stop", parallel.path)

        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        client.cancelCloudAgent("wren", "cloud-9")
        val cloud = server.takeRequest()
        assertEquals("POST", cloud.method)
        assertEquals("/api/bots/wren/cloud-agents/cloud-9/cancel", cloud.path)
    }

    private fun json(body: String, code: Int = 200): MockResponse = MockResponse()
        .setResponseCode(code)
        .setHeader("Content-Type", "application/json")
        .setBody(body)
}
