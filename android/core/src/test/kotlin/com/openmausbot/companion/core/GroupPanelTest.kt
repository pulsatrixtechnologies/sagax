package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GroupPanelTest {
    private val members = listOf(bot("osprey"), bot("wren"))

    @Test
    fun ordersTabsAndHidesComputerInSimpleOrWhenEmpty() {
        assertEquals(
            listOf(
                GroupPanelTab.DETAILS,
                GroupPanelTab.MEMBERS,
                GroupPanelTab.INSTRUCTIONS,
                GroupPanelTab.MEMORY,
                GroupPanelTab.LIBRARY,
                GroupPanelTab.COMPUTER,
            ),
            visibleGroupPanelTabs(advanced = true, hasComputer = true),
        )
        assertFalse(visibleGroupPanelTabs(advanced = false, hasComputer = true).contains(GroupPanelTab.COMPUTER))
        assertFalse(visibleGroupPanelTabs(advanced = true, hasComputer = false).contains(GroupPanelTab.COMPUTER))
    }

    @Test
    fun keepsTeamGoalsAndRoutinesThatPostInGroupThreads() {
        val group = room(
            id = "ops",
            threadId = "t-open",
            tasks = listOf(BotTask(threadId = "t-old", title = "Older", createdAt = 1.0)),
        )
        val routines = listOf(
            routine("goal", groupId = "ops"),
            routine("posts", resultsThreadId = "t-old"),
            routine("other", groupId = "elsewhere"),
            routine("plain"),
        )
        assertEquals(listOf("goal", "posts"), groupRoutines(routines, group).map { it.id })
        assertEquals(setOf("t-old", "t-open"), groupThreadIds(group))
    }

    @Test
    fun readsLeadOrAutoFallbackAndNoneForEveryone() {
        assertEquals(
            "wren",
            groupLeadBotId(room(responder = GroupResponder(kind = "member", botId = "wren")), members),
        )
        assertEquals(
            "wren",
            groupLeadBotId(room(responder = GroupResponder(kind = "auto", fallbackBotId = "wren")), members),
        )
        assertEquals(
            "osprey",
            groupLeadBotId(room(responder = GroupResponder(kind = "auto")), members),
        )
        assertNull(groupLeadBotId(room(responder = GroupResponder(kind = "everyone")), members))
    }

    @Test
    fun keepsAutoWhenLeadChangesElseAnswersThroughNewLead() {
        assertEquals(
            GroupResponder(kind = "auto", fallbackBotId = "wren"),
            leadResponder(room(responder = GroupResponder(kind = "auto")), members, "wren"),
        )
        assertEquals(
            GroupResponder(kind = "member", botId = "wren"),
            leadResponder(room(responder = GroupResponder(kind = "member", botId = "osprey")), members, "wren"),
        )
        assertEquals(
            GroupResponder(kind = "member", botId = "wren"),
            leadResponder(room(responder = GroupResponder(kind = "mentions")), members, "wren"),
        )
    }

    @Test
    fun suggestsInstructionsSecondBotAndTeamGoal() {
        val base = groupSuggestions(
            bulletin = "",
            botCount = 1,
            routineCount = 0,
            canEdit = true,
            canAddBot = true,
            canAddRoutine = true,
        )
        assertEquals(
            listOf(
                GroupSuggestionAction.INSTRUCTIONS,
                GroupSuggestionAction.MEMBERS,
                GroupSuggestionAction.ROUTINE,
            ),
            base.map { it.action },
        )
        assertEquals(
            emptyList(),
            groupSuggestions(
                bulletin = "Be brief.",
                botCount = 2,
                routineCount = 1,
                canEdit = true,
                canAddBot = true,
                canAddRoutine = true,
            ),
        )
        assertEquals(
            emptyList(),
            groupSuggestions(
                bulletin = "",
                botCount = 1,
                routineCount = 0,
                canEdit = false,
                canAddBot = false,
                canAddRoutine = false,
            ),
        )
    }

    @Test
    fun computerBotsSkipOffComputers() {
        val own = listOf(
            bot("a", computer = "local"),
            bot("b", computer = "off"),
            bot("c", computer = null),
        )
        assertEquals(listOf("a", "c"), groupComputerBots(own).map { it.id })
        assertTrue(simpleHidesPanelTab("computer"))
        assertFalse(simpleHidesPanelTab("details"))
    }

    private fun room(
        id: String = "ops",
        threadId: String = "t-open",
        memberIds: List<String> = members.map { it.id },
        responder: GroupResponder = GroupResponder(kind = "member", botId = "osprey"),
        tasks: List<BotTask>? = null,
    ): Room = Room(
        id = id,
        threadId = threadId,
        name = "Ops",
        memberIds = memberIds,
        defaultResponder = responder,
        bulletin = "",
        unread = false,
        createdAt = 1.0,
        tasks = tasks,
    )

    private fun bot(id: String, computer: String? = null): Bot = Bot(
        id = id,
        threadId = "t-$id",
        name = id.replaceFirstChar { it.uppercase() },
        title = "",
        description = "",
        notifications = true,
        color = "green",
        unread = false,
        modelSelection = ModelSelection(instanceId = "engine", model = "default"),
        createdAt = 1.0,
        computer = computer,
    )

    private fun routine(
        id: String,
        groupId: String? = null,
        resultsThreadId: String? = null,
    ): Routine = Routine(
        id = id,
        name = id,
        prompt = "do",
        botId = "osprey",
        runOn = "maus",
        enabled = true,
        schedule = RoutineSchedule(type = RoutineSchedule.Kind.DAILY, time = "09:00"),
        durationMinutes = 30,
        createdAt = 1.0,
        updatedAt = 1.0,
        groupId = groupId,
        resultsThreadId = resultsThreadId,
    )
}
