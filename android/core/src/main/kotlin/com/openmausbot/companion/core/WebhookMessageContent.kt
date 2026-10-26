package com.openmausbot.companion.core

/** Display projection only. Stored prompts keep their model-facing trust boundaries. */
data class WebhookMessageContent(val task: String, val payload: String?) {
    companion object {
        private val taskMarkers = listOf(
            "AUTHENTICATED WEBHOOK TASK", "USER-CONFIGURED WEBHOOK INSTRUCTIONS", "DEFAULT WEBHOOK INSTRUCTIONS",
        )
        private val eventOpening = Regex("""\[UNTRUSTED WEBHOOK EVENT DATA(?: ([0-9a-f]{12,64}))?]\n""")

        /** Matches the desktop webhook-message parser. Incomplete envelopes remain ordinary text. */
        fun parse(text: String): WebhookMessageContent? {
            // Newer prompts carry a random boundary on both event markers; older ones none.
            val open = eventOpening.find(text) ?: return null
            val eventStart = open.range.first
            val boundary = open.groupValues[1].takeIf(String::isNotEmpty)?.let { " $it" } ?: ""
            val trustedPrefix = text.substring(0, eventStart)
            fun block(marker: String, source: String): String? {
                val opening = "[$marker]\n"
                val start = source.indexOf(opening).takeIf { it >= 0 } ?: return null
                val contentStart = start + opening.length
                val end = source.indexOf("\n[/$marker]", contentStart).takeIf { it >= 0 } ?: return null
                return source.substring(contentStart, end)
            }
            val task = taskMarkers.firstNotNullOfOrNull { block(it, trustedPrefix)?.trim()?.takeIf(String::isNotEmpty) } ?: return null
            val bodyStart = open.range.last + 1
            val bodyEnd = text.indexOf("\n[/UNTRUSTED WEBHOOK EVENT DATA$boundary]", bodyStart).takeIf { it >= 0 } ?: return null
            val event = text.substring(bodyStart, bodyEnd).takeIf(String::isNotEmpty) ?: return null
            val splitAt = event.indexOf("\n\n")
            val payload = if (splitAt >= 0) event.substring(splitAt + 2).trim().takeIf(String::isNotEmpty) else null
            return WebhookMessageContent(task, payload)
        }
    }
}

val Message.webhookContent: WebhookMessageContent?
    get() = if (role == Message.Role.USER && kind == Message.Kind.TEXT) text?.let(WebhookMessageContent::parse) else null
