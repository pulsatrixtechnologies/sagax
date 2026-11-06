package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RoomInfoTest {
    @Test
    fun soloServerOwnsEveryRoomAndOrganizationFollowsTheOwner() {
        val me = RoomViewer(principalId = "P-Me", email = "Me@Example.test", role = "member")
        assertTrue(RoomOwnership.owns(room(), me, organization = false))
        assertFalse(RoomOwnership.owns(room(), me, organization = true))
        assertTrue(
            RoomOwnership.owns(
                room(),
                RoomViewer(principalId = "x", role = "admin"),
                organization = true,
            ),
        )
        assertTrue(RoomOwnership.owns(room(ownerId = "p-me"), me, organization = true))
        assertTrue(RoomOwnership.owns(room(ownerId = " me@example.test "), me, organization = true))
        assertFalse(RoomOwnership.owns(room(ownerId = "someone"), me, organization = true))

        val admin = RoomViewer(principalId = "adm", role = "admin")
        assertFalse(RoomOwnership.owns(room(ownerId = "someone"), admin, organization = true))
        assertTrue(RoomOwnership.mayDelete(room(ownerId = "someone"), admin, organization = true))
        assertFalse(RoomOwnership.mayDelete(room(ownerId = "someone"), me, organization = true))
        assertEquals("local-owner", RoomViewer().actorId)
    }

    @Test
    fun leaveAndPeopleEditsKeepEveryoneElse() {
        val me = RoomViewer(principalId = "p-me", email = "me@example.test")
        val listed = room(ownerId = "boss", humanIds = listOf("boss", "ME@example.test", "user:p-other"))
        assertTrue(RoomOwnership.isListed(listed, me))
        assertEquals(listOf("boss", "user:p-other"), RoomOwnership.humanIdsLeaving(listed, me))
        assertEquals(
            listOf("boss", "me@example.test", "user:p-other", "new@example.test"),
            RoomOwnership.humanIdsAdding(" New@Example.test ", to = listed),
        )
        assertEquals(3, RoomOwnership.humanIdsAdding("boss", to = listed).size)
        assertEquals(
            listOf("boss", "ME@example.test"),
            RoomOwnership.humanIdsRemoving("USER:P-OTHER", from = listed),
        )
    }

    @Test
    fun nextMemberIdsKeepsTheLeadFirst() {
        assertEquals(
            listOf("b", "a", "c"),
            RoomOwnership.nextMemberIds(
                current = listOf("b", "a"),
                picked = setOf("a", "b", "c"),
                order = listOf("a", "b", "c"),
            ),
        )
        assertEquals(
            listOf("a"),
            RoomOwnership.nextMemberIds(
                current = listOf("b", "a"),
                picked = setOf("a"),
                order = listOf("a", "b"),
            ),
        )
    }

    @Test
    fun sidecarPairingReadsTheRoomOnly() {
        val access = RoomInfoAccess(
            room = room(),
            gate = GateFlags(allowsRoomMemory = true, sidecar = true),
            viewer = RoomViewer(),
            bots = emptyList(),
        )
        assertFalse(access.manages)
        assertFalse(access.editable)
        assertFalse(access.readOnlyNote)
        assertFalse(access.canDelete)
        assertFalse(access.canLeave)
        assertTrue(access.removableBotIds.isEmpty())
        assertTrue(access.memory)

        assertFalse(
            RoomInfoAccess(
                room = room(),
                gate = GateFlags(sidecar = true),
                viewer = RoomViewer(),
                bots = emptyList(),
            ).memory,
        )
    }

    @Test
    fun serverAdminOwnsASoloRoom() {
        val gate = GateFlags(
            allowsRoomManagement = true,
            allowsRoomMemory = true,
            allowsRoomDelete = true,
        )
        val access = RoomInfoAccess(room = room(), gate = gate, viewer = RoomViewer(), bots = emptyList())
        assertTrue(access.editable)
        assertTrue(access.canDelete)
        assertTrue(access.canMoveSection)
        assertTrue(access.canAddHuman)
        assertFalse(access.canLeave)
        assertEquals(setOf("a", "b"), access.removableBotIds)

        val client = RoomInfoAccess(
            room = room(),
            gate = GateFlags(),
            viewer = RoomViewer(),
            bots = emptyList(),
        )
        assertFalse(client.manages)
        assertFalse(client.canDelete)

        val dm = RoomInfoAccess(
            room = room(dm = true),
            gate = gate,
            viewer = RoomViewer(),
            bots = emptyList(),
        )
        assertFalse(dm.manages)
        assertFalse(dm.memory)
    }

    @Test
    fun organizationMemberLeavesAndBringsOwnBots() {
        val gate = GateFlags(
            organization = true,
            allowsRoomManagement = true,
            allowsRoomMemory = true,
            allowsRoomDelete = true,
        )
        val me = RoomViewer(principalId = "p-me", role = "member")
        val bots = listOf(bot("a"), bot("b"), bot("mine", owner = "P-ME"), bot("mine2", owner = "p-me"))
        var theirs = room(ownerId = "boss", humanIds = listOf("boss", "p-me"), memberIds = listOf("a", "mine"))
        var access = RoomInfoAccess(room = theirs, gate = gate, viewer = me, bots = bots)
        assertFalse(access.editable)
        assertTrue(access.readOnlyNote)
        assertTrue(access.canLeave)
        assertFalse(access.canDelete)
        assertFalse(access.canAddHuman)
        assertFalse(access.canMoveSection)
        assertTrue(access.canAddOwnBot)
        assertEquals(setOf("mine"), access.removableBotIds)
        assertEquals("mine2", RoomOwnership.ownBotToAdd(theirs, bots, me)?.id)

        theirs = theirs.copy(humanIds = listOf("boss"))
        access = RoomInfoAccess(room = theirs, gate = gate, viewer = me, bots = bots)
        assertFalse(access.canLeave)

        val mine = RoomInfoAccess(room = room(ownerId = "p-me"), gate = gate, viewer = me, bots = bots)
        assertTrue(mine.editable)
        assertTrue(mine.canDelete)
        assertTrue(mine.canAddHuman)
        assertTrue(mine.canManageRoster)

        val admin = RoomViewer(principalId = "p-me", role = "admin")
        assertTrue(RoomInfoAccess(room = room(ownerId = "p-me"), gate = gate, viewer = admin, bots = bots).canAddHuman)

        val unknown = RoomViewer(principalId = "p-me", role = null)
        assertFalse(RoomInfoAccess(room = room(ownerId = "p-me"), gate = gate, viewer = unknown, bots = bots).canAddHuman)
    }

    @Test
    fun theOwnerLeavesTooAndTheConfirmationSaysWhatHappens() {
        val gate = GateFlags(
            organization = true,
            allowsRoomManagement = true,
            allowsRoomDelete = true,
        )
        val me = RoomViewer(principalId = "p-me", role = "member")
        val mine = room(ownerId = "p-me", humanIds = listOf("p-me", "p-bob"))
        assertTrue(RoomInfoAccess(room = mine, gate = gate, viewer = me, bots = emptyList()).canLeave)
        assertEquals(RoomOwnership.LeaveOutcome.OWNER, RoomOwnership.leaveOutcome(mine, me))
        assertTrue(RoomOwnership.mayLeave(room(ownerId = "p-me", humanIds = listOf("p-bob")), me))
        assertEquals(
            RoomOwnership.LeaveOutcome.LAST,
            RoomOwnership.leaveOutcome(room(ownerId = "p-me", humanIds = listOf("p-me", "team:ops")), me),
        )
        // #2119: sole remaining person cannot leave (bots and teams do not count)
        assertFalse(RoomOwnership.mayLeave(room(ownerId = "p-me", humanIds = listOf("p-me", "team:ops")), me))
        assertFalse(
            RoomInfoAccess(
                room = room(ownerId = "p-me", humanIds = listOf("p-me")),
                gate = gate,
                viewer = me,
                bots = emptyList(),
            ).canLeave,
        )
        assertEquals(
            RoomOwnership.LeaveOutcome.MEMBER,
            RoomOwnership.leaveOutcome(room(ownerId = "boss", humanIds = listOf("boss", "p-me")), me),
        )
        assertFalse(
            RoomInfoAccess(
                room = mine,
                gate = GateFlags(allowsRoomManagement = true, allowsRoomDelete = true),
                viewer = me,
                bots = emptyList(),
            ).canLeave,
        )
        assertFalse(
            RoomInfoAccess(
                room = room(ownerId = "boss", humanIds = listOf("boss", "team:ops")),
                gate = gate,
                viewer = me,
                bots = emptyList(),
            ).canLeave,
        )
    }

    @Test
    fun rosterOpensOnAPickerAndOffersOnlyWhatTheViewerMayTick() {
        val gate = GateFlags(
            organization = true,
            allowsRoomManagement = true,
            allowsRoomDelete = true,
        )
        val me = RoomViewer(principalId = "p-me", role = "member")
        val archived = bot("old", owner = "p-me").copy(hidden = true)
        val bots = listOf(bot("a"), bot("mine", owner = "p-me"), bot("mine2", owner = "p-me"), archived)
        val theirs = room(ownerId = "boss", humanIds = listOf("boss", "p-me"), memberIds = listOf("a", "mine"))
        assertEquals(
            listOf("mine", "mine2"),
            RoomOwnership.rosterBotChoices(theirs, bots, me, owns = false).map { it.id },
        )
        val access = RoomInfoAccess(room = theirs, gate = gate, viewer = me, bots = bots)
        assertTrue(access.canAddBot)
        assertTrue(access.canManageRoster)

        val mine = room(ownerId = "p-me", memberIds = listOf("a", "old"))
        assertEquals(
            listOf("a", "mine", "mine2", "old"),
            RoomOwnership.rosterBotChoices(mine, bots, me, owns = true).map { it.id },
        )

        val full = room(ownerId = "boss", memberIds = listOf("a", "mine", "mine2"))
        val fullAccess = RoomInfoAccess(room = full, gate = gate, viewer = me, bots = bots)
        assertFalse(fullAccess.canAddBot)
        assertTrue(fullAccess.canManageRoster)

        val stranger = RoomViewer(principalId = "p-x", role = "member")
        assertFalse(RoomInfoAccess(room = theirs, gate = gate, viewer = stranger, bots = bots).canManageRoster)
    }

    @Test
    fun nextHumanIdsKeepsPlacesAndAppendsAdditions() {
        assertEquals(
            listOf("p-a", "b@x.test", "p-c"),
            RoomOwnership.nextHumanIds(
                current = listOf("p-a", "B@x.test"),
                picked = setOf("p-a", "b@x.test", "p-c"),
                added = listOf("p-c"),
            ),
        )
        assertEquals(
            listOf("p-b", "p-c"),
            RoomOwnership.nextHumanIds(
                current = listOf("p-a", "p-b"),
                picked = setOf("p-b", "p-c"),
                added = listOf("P-C", "p-c"),
            ),
        )
    }

    @Test
    fun defaultResponderFallsBackAndAutoKeepsTheLead() {
        assertEquals(RoomResponder.Choice.Lead("a"), RoomResponder.choice(room()))
        assertEquals(
            GroupResponder(kind = "member", botId = "a"),
            RoomResponder.effective(room(responder = GroupResponder(kind = "member", botId = "gone"))),
        )
        assertEquals(
            GroupResponder(kind = "mentions"),
            RoomResponder.effective(
                room(memberIds = emptyList(), responder = GroupResponder(kind = "everyone2")),
            ),
        )
        assertEquals(
            GroupResponder(kind = "auto", fallbackBotId = "b"),
            RoomResponder.value(
                forChoice = RoomResponder.Choice.Auto,
                inRoom = room(responder = GroupResponder(kind = "member", botId = "b")),
            ),
        )
        val auto = room(responder = GroupResponder(kind = "auto", fallbackBotId = "b"))
        assertEquals("b", RoomResponder.answeringBotId(auto))
        assertEquals(
            "a",
            RoomResponder.answeringBotId(room(responder = GroupResponder(kind = "auto", fallbackBotId = "gone"))),
        )
        assertNull(RoomResponder.answeringBotId(room(responder = GroupResponder(kind = "everyone"))))
        assertEquals(
            GroupResponder(kind = "member", botId = "b"),
            RoomResponder.value(forChoice = RoomResponder.Choice.Lead("b"), inRoom = auto),
        )
    }

    @Test
    fun memoryCapacityLevelsAndBytes() {
        val ok = MemoryCapacity(
            lines = 10,
            bytes = 900,
            maxLines = 200,
            maxBytes = 25_000,
            loadedLines = 10,
            loadedBytes = 900,
            truncated = false,
        )
        assertEquals(MemoryCapacity.Level.OK, ok.level)
        assertEquals("900 B", MemoryCapacity.formatBytes(900))
        assertEquals("24.4 KB", MemoryCapacity.formatBytes(25_000))
        assertEquals("2 KB", MemoryCapacity.formatBytes(2048))
        assertEquals(MemoryCapacity.Level.NEAR, ok.copy(lines = 170).level)
        val over = ok.copy(truncated = true, lines = 230, loadedLines = 200)
        assertEquals(MemoryCapacity.Level.OVER, over.level)
        assertEquals(30, over.missingLines)
    }

    @Test
    fun roomPatchRenameTrimsAndCaps() {
        assertNull(RoomPatch.rename("Team", "  Team "))
        assertNull(RoomPatch.rename("Team", "   "))
        assertEquals("Crew", RoomPatch.rename("Team", " Crew "))
        assertEquals(100, RoomPatch.rename("Team", "x".repeat(120))?.length)
    }

    private fun room(
        ownerId: String? = null,
        humanIds: List<String>? = null,
        memberIds: List<String> = listOf("a", "b"),
        responder: GroupResponder = GroupResponder(kind = "member", botId = "a"),
        dm: Boolean? = null,
        peopleDm: Boolean? = null,
    ): Room = Room(
        id = "g-1",
        threadId = "g-t",
        name = "Team",
        memberIds = memberIds,
        defaultResponder = responder,
        bulletin = "Ship it",
        unread = false,
        createdAt = 1.0,
        dm = dm,
        ownerId = ownerId,
        humanIds = humanIds,
        peopleDm = peopleDm,
    )

    private fun bot(id: String, owner: String? = null): Bot = Bot(
        id = id,
        threadId = "t-$id",
        name = id.uppercase(),
        title = "",
        description = "",
        notifications = true,
        color = "green",
        unread = false,
        modelSelection = ModelSelection(instanceId = "engine", model = "default"),
        createdAt = 1.0,
        ownerUserId = owner,
    )
}
