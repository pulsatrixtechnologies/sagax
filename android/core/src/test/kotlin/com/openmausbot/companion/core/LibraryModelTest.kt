package com.openmausbot.companion.core

import java.util.Calendar
import java.util.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LibraryModelTest {
    private val utc = TimeZone.getTimeZone("UTC")

    private fun file(
        id: String,
        at: Double,
        pinned: Boolean = false,
        name: String = id,
    ) = ThreadFile(id = id, name = name, at = at, pinned = pinned, available = true)

    private fun utcDay(year: Int, month1to12: Int, day: Int, hour: Int = 12): Double {
        val calendar = Calendar.getInstance(utc)
        calendar.clear()
        calendar.set(year, month1to12 - 1, day, hour, 0, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        return calendar.timeInMillis.toDouble()
    }

    @Test
    fun `groups pin first then today this week and older`() {
        val now = utcDay(2026, 11, 4, 12)
        val today = utcDay(2026, 11, 4, 9)
        val yesterday = utcDay(2026, 11, 3, 12)
        val old = utcDay(2026, 10, 20, 12)
        val groups = LibraryRules.groups(
            files = listOf(
                file("old", old),
                file("pin", yesterday, pinned = true),
                file("today", today),
                file("week", yesterday),
            ),
            nowMs = now,
            timeZone = utc,
        )
        assertEquals(listOf("file:pin"), groups.pinned.map { it.id })
        assertEquals(listOf("file:today"), groups.today.map { it.id })
        assertEquals(listOf("file:week"), groups.thisWeek.map { it.id })
        assertEquals(listOf("file:old"), groups.older.map { it.id })
        assertEquals(4, groups.all.size)
    }

    @Test
    fun `groupFiles merges every conversation newest first`() {
        val merged = LibraryRules.groupFiles(
            roomsThreads = setOf("t1", "t2"),
            byThread = mapOf(
                "t1" to listOf(file("a", 2.0), file("b", 1.0)),
                "t2" to listOf(file("c", 3.0)),
                "other" to listOf(file("x", 9.0)),
            ),
        )
        assertEquals(listOf("c", "a", "b"), merged.map { it.id })
    }

    @Test
    fun `empty groups report empty`() {
        assertTrue(LibraryRules.groups(emptyList(), nowMs = 1.0, timeZone = utc).isEmpty)
    }
}
