package com.openmausbot.companion.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The FCM data messages of server/push/fcm.ts, read as local notifications (2026-10-26). */
class FcmMessageTest {
    @Test
    fun approvalAndQuestionKeepTheirKind() {
        val approval = SagaxMessagingService.frameOf(
            mapOf("kind" to "approval", "prompt" to "approval", "title" to "Nimbus", "body" to "Run a command?", "botId" to "b1", "threadId" to "t1", "senderName" to "Nimbus"),
        )!!
        assertEquals("approval", approval.kind)
        assertEquals("t1", approval.threadId)
        assertEquals("b1", approval.botId)
        val question = SagaxMessagingService.frameOf(mapOf("kind" to "approval", "prompt" to "question", "title" to "Nimbus", "body" to "Which day?"))!!
        assertEquals("question", question.kind)
    }

    @Test
    fun aReadOrAnEmptyMessagePostsNothing() {
        assertNull(SagaxMessagingService.frameOf(mapOf("kind" to "read", "threadId" to "t1")))
        assertNull(SagaxMessagingService.frameOf(mapOf("kind" to "message")))
        assertNull(SagaxMessagingService.frameOf(emptyMap()))
    }
}
