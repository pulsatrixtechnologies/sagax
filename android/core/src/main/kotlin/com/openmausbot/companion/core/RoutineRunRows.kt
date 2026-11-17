package com.openmausbot.companion.core

import kotlinx.serialization.json.JsonObject

/**
 * The routine run rows the chat leaves out, the desktop's rule
 * (shared/routine-repeat.ts `routineRunRowOutOfChat`, #3990).
 *
 * Left out: a row that only says how a run went, a wake's row with nothing
 * for the person, and a completed row whose summary is only a nothing
 * phrase (shared/routine-result.ts `routineSaysNothing`). Drawn as before:
 * a live or waiting run, a result, items for the person, a run the person
 * started, the streak's one summary, a team goal's card, a routine that
 * paused itself, and a failure. Every run stays in its routine's run log.
 */
object RoutineRunRows {
    fun outOfChat(message: Message, counted: Set<String> = emptySet()): Boolean {
        if (message.kind != Message.Kind.ROUTINE_RUN) return false
        val run = message.routineRun ?: return false
        if (run.status.isEmpty() || alwaysDrawn(message, run, counted)) return false
        return when (run.status) {
            "queued", "running", "waiting", "failed", "missed" -> false
            "completed" -> !run.problems.isNullOrEmpty() || run.recovered != null
                || (!run.wakeTopic.isNullOrEmpty() && !run.forPerson)
                || saysNothing(run.summary)
            else -> true
        }
    }

    /** The first runs a stored count that is not the streak's summary names. */
    fun counted(messages: List<Message>): Set<String> {
        val firstRuns = mutableSetOf<String>()
        for (message in messages) {
            if (message.kind != Message.Kind.ROUTINE_RUN) continue
            val run = message.routineRun ?: continue
            val count = run.`repeat` ?: continue
            if (run.startedBy == "person" && !count.streak) {
                val first = count.firstRunId?.takeIf { it.isNotEmpty() } ?: continue
                firstRuns += first
            }
        }
        return firstRuns
    }

    private fun alwaysDrawn(message: Message, run: RoutineRunCard, counted: Set<String>): Boolean =
        message.attention is JsonObject || !run.goalStatus.isNullOrEmpty() || startedByPerson(run, counted)
            || run.`repeat`?.streak == true || run.recovered?.streak == true
            || (run.autoPausedAfter ?: 0) > 0

    private fun startedByPerson(run: RoutineRunCard, counted: Set<String>): Boolean {
        if (run.startedBy != "person") return false
        val count = run.`repeat` ?: return run.runId.isEmpty() || run.runId !in counted
        return count.streak
    }

    /** Same phrases as `routineSaysNothing` in shared/routine-result.ts. */
    private fun saysNothing(text: String?): Boolean {
        val plain = text?.trim()?.trim('*', '_')?.trim() ?: return false
        if (plain.isEmpty() || plain.contains('?')) return false
        return nothingPhrase.matches(plain)
    }

    private val phrases = listOf(
        "nothing (?:new |else |more )?to (?:report|do(?: on your side)?|flag|signal|bring up)",
        "no (?:action|follow[- ]up|change)s? (?:is |are )?(?:needed|required)",
        "nothing (?:found|changed|happened|new)",
        "nothing (?:for you|needs you)",
        "you have nothing to do",
        "nothing[\\s_-]to[\\s_-]report",
        "rien (?:de nouveau |d[\u2019']autre |de plus )?\u00e0 (?:signaler|faire(?: de (?:ton|votre) c(?:\u00f4|o)t[e\u00e9])?|rapporter|remonter)",
        "rien de (?:nouveau|neuf)",
        "aucune? (?:action|suivi|changement)s? (?:n[\u2019']est )?(?:requis|requise|n\u00e9cessaire)",
        "rien (?:pour toi|pour vous)",
        "tu n[\u2019']as rien \u00e0 faire",
        "vous n[\u2019']avez rien \u00e0 faire",
        "rien n[\u2019']est bloqu\u00e9",
    ).joinToString("|")

    private val nothingPhrase = Regex(
        "^(?:(?:ok(?:ay)?|done|all (?:good|clear|set|quiet))[\\s,.;:\u2014\u2013-]+)?(?:$phrases)(?:[\\s,;]+(?:et |and )?(?:$phrases))?[\\s.!\u2026]*$",
        RegexOption.IGNORE_CASE,
    )
}
