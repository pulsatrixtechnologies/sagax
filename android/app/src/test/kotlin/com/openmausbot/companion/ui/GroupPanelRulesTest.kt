package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.GroupPanelTab
import com.openmausbot.companion.core.GroupResponder
import com.openmausbot.companion.core.GroupSuggestionAction
import com.openmausbot.companion.core.ModelSelection
import com.openmausbot.companion.core.Room
import com.openmausbot.companion.core.RoomViewer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class GroupPanelRulesTest {
    private fun bot(id: String, computer: String? = "on", owner: String? = "local-owner") = Bot(
        id = id,
        threadId = "t-$id",
        name = id.replaceFirstChar { it.uppercase() },
        title = "",
        description = "",
        notifications = true,
        color = "blue",
        unread = false,
        modelSelection = ModelSelection(instanceId = "i", model = "m"),
        createdAt = 1.0,
        computer = computer,
        ownerUserId = owner,
    )

    private fun room(
        members: List<String> = listOf("wren"),
        bulletin: String = "",
        ownerId: String? = "local-owner",
    ) = Room(
        id = "g1",
        threadId = "gt1",
        name = "Dispatch",
        memberIds = members,
        defaultResponder = GroupResponder(kind = "member", botId = members.firstOrNull()),
        bulletin = bulletin,
        unread = false,
        createdAt = 1.0,
        ownerId = ownerId,
        humanIds = listOf("local-owner"),
    )

    @Test
    fun `bot count copy`() {
        assertEquals("1 bot", GroupPanelRules.botCountLabel(1))
        assertEquals("3 bots", GroupPanelRules.botCountLabel(3))
    }

    @Test
    fun `tab labels match the desktop strip`() {
        assertEquals("Details", GroupPanelRules.tabLabel(GroupPanelTab.DETAILS))
        assertEquals("Members", GroupPanelRules.tabLabel(GroupPanelTab.MEMBERS))
        assertEquals("Instructions", GroupPanelRules.tabLabel(GroupPanelTab.INSTRUCTIONS))
        assertEquals("Memory", GroupPanelRules.tabLabel(GroupPanelTab.MEMORY))
        assertEquals("Library", GroupPanelRules.tabLabel(GroupPanelTab.LIBRARY))
        assertEquals("Computer", GroupPanelRules.tabLabel(GroupPanelTab.COMPUTER))
    }

    @Test
    fun `owner on a solo pairing may edit and sees computer when a member works somewhere`() {
        val bots = listOf(bot("wren"), bot("osprey"))
        val room = room(members = listOf("wren", "osprey"))
        val access = GroupPanelRules.access(
            room = room,
            bots = bots,
            viewer = RoomViewer(),
            organization = false,
        )
        assertTrue(access.editable)
        assertFalse(access.readOnlyNote)
        val tabs = GroupPanelRules.tabs(
            access = access,
            members = bots,
            ownBots = bots,
            advancedMode = true,
        )
        assertTrue(GroupPanelTab.DETAILS in tabs)
        assertTrue(GroupPanelTab.MEMBERS in tabs)
        assertTrue(GroupPanelTab.INSTRUCTIONS in tabs)
        assertTrue(GroupPanelTab.COMPUTER in tabs)
    }

    @Test
    fun `simple mode hides computer`() {
        val bots = listOf(bot("wren"))
        val room = room()
        val access = GroupPanelRules.access(room, bots, RoomViewer(), organization = false)
        val tabs = GroupPanelRules.tabs(access, bots, bots, advancedMode = false)
        assertFalse(GroupPanelTab.COMPUTER in tabs)
    }

    @Test
    fun `suggestions appear for an empty editable group`() {
        // A second bot outside the room makes canAddBot true (Members suggestion).
        val bots = listOf(bot("wren"), bot("osprey"))
        val room = room(members = listOf("wren"), bulletin = "")
        val access = GroupPanelRules.access(room, bots, RoomViewer(), false)
        assertTrue(access.canAddBot)
        val suggestions = GroupPanelRules.suggestions(room, access, botCount = 1, routineCount = 0)
        assertEquals(
            listOf(
                GroupSuggestionAction.INSTRUCTIONS,
                GroupSuggestionAction.MEMBERS,
                GroupSuggestionAction.ROUTINE,
            ),
            suggestions.map { it.action },
        )
        assertEquals(
            "Write the group instructions",
            GroupPanelRules.suggestionTitle(suggestions.first()),
        )
    }

    @Test
    fun `non-owner on an organization server sees the read-only note`() {
        val room = room(ownerId = "someone-else")
        val access = GroupPanelRules.access(
            room = room,
            bots = listOf(bot("wren", owner = "local-owner")),
            viewer = RoomViewer(principalId = "local-owner", role = "member"),
            organization = true,
        )
        assertTrue(access.readOnlyNote)
        assertFalse(access.editable)
        assertTrue(access.canLeave)
    }

    @Test
    fun `solo fleet treats every member as own when bots carry no owner`() {
        val bots = listOf(bot("wren", owner = null), bot("osprey", owner = null))
        val room = room(members = listOf("wren", "osprey"))
        assertEquals(
            listOf("wren", "osprey"),
            GroupPanelRules.ownBotsInRoom(room, bots, RoomViewer()).map { it.id },
        )
    }

    @Test
    fun `organization filters own bots by ownerUserId`() {
        val bots = listOf(
            bot("wren", owner = "local-owner"),
            bot("osprey", owner = "someone-else"),
        )
        val room = room(members = listOf("wren", "osprey"))
        assertEquals(
            listOf("wren"),
            GroupPanelRules.ownBotsInRoom(
                room,
                bots,
                RoomViewer(principalId = "local-owner"),
            ).map { it.id },
        )
    }

    @Test
    fun `signed-in principal owns their organization room`() {
        val bots = listOf(bot("wren", owner = "pr_wren"))
        val room = room(members = listOf("wren"), ownerId = "pr_wren")
        val viewer = RoomViewer.from(
            com.openmausbot.companion.core.AuthSession(
                principalId = "pr_wren",
                email = "wren@example.test",
                role = "member",
            ),
        )
        val access = GroupPanelRules.access(room, bots, viewer, organization = true)
        assertTrue(access.editable)
        assertFalse(access.readOnlyNote)
        assertEquals("pr_wren", viewer.actorId)
    }

    @Test
    fun `people ids keep listed humans and personLabel keeps the id`() {
        val room = room().copy(humanIds = listOf(" pr_wren ", "", "pr_osprey"))
        assertEquals(listOf("pr_wren", "pr_osprey"), GroupPanelRules.peopleIds(room))
        assertEquals("pr_wren", GroupPanelRules.personLabel("pr_wren"))
        assertEquals("Lead", GroupPanelRules.LEAD_BADGE)
        assertEquals("Make lead", GroupPanelRules.MAKE_LEAD)
        assertEquals("Advanced", GroupPanelRules.ADVANCED)
    }
}
