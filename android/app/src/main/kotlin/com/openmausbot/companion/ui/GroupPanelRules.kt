package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.GateFlags
import com.openmausbot.companion.core.GroupPanelTab
import com.openmausbot.companion.core.GroupSuggestion
import com.openmausbot.companion.core.GroupSuggestionAction
import com.openmausbot.companion.core.Room
import com.openmausbot.companion.core.RoomInfoAccess
import com.openmausbot.companion.core.RoomViewer
import com.openmausbot.companion.core.groupComputerBots
import com.openmausbot.companion.core.groupLeadBotId
import com.openmausbot.companion.core.groupSuggestions
import com.openmausbot.companion.core.visibleGroupPanelTabs

/**
 * Group side panel decisions: tabs, copy, suggestions. Presentation-free
 * twin of `src/components/GroupPanel.tsx` / `src/lib/group-panel.ts`.
 */
object GroupPanelRules {
    const val TITLE: String = "Group"
    const val OWNER_ONLY: String = "Only the group's owner can change these settings."
    const val PEOPLE: String = "People"
    const val BOTS: String = "Bots"
    const val LEAVE: String = "Leave group"
    const val MAKE_LEAD: String = "Make lead"
    const val LEAD_BADGE: String = "Lead"
    const val LIBRARY_PINNED: String = "Pinned"
    const val LIBRARY_TODAY: String = "Today"
    const val LIBRARY_THIS_WEEK: String = "This week"
    const val LIBRARY_OLDER: String = "Older"
    const val LIBRARY_SHOW_MORE: String = "Show more"
    const val LIBRARY_LOADING: String = "Loading the library…"
    const val PEOPLE_EMPTY: String = "No people in this group yet."
    const val INSTRUCTIONS: String = "Group instructions"
    const val INSTRUCTIONS_EMPTY: String = "No group instructions yet."
    const val INSTRUCTIONS_PLACEHOLDER: String = "Goals, tone, ownership, constraints…"
    const val INSTRUCTIONS_DETAIL: String =
        "A shared brief every member sees on each turn. You can edit it later."
    const val MEMORY: String = "Memory"
    const val MEMORY_EMPTY: String = "No shared memory yet."
    const val LIBRARY: String = "Library"
    const val LIBRARY_EMPTY: String = "No shared files in this group's conversations yet."
    const val COMPUTER: String = "Computer"
    const val ADVANCED: String = "Advanced"
    const val ROUTINES_HINT: String =
        "No routine for this group yet. Team goals and routines that post here show up in this list."
    const val ROUTINES_CREATE: String = "New team goal"
    const val FOLDER_ADMIN_ONLY: String =
        "Only an organization admin can change the working folder."
    const val SAVE: String = "Save"
    const val NAME_LIMIT: Int = 100

    fun botCountLabel(count: Int): String = when (count) {
        1 -> "1 bot"
        else -> "$count bots"
    }

    fun tabLabel(tab: GroupPanelTab): String = when (tab) {
        GroupPanelTab.DETAILS -> "Details"
        GroupPanelTab.MEMBERS -> "Members"
        GroupPanelTab.INSTRUCTIONS -> "Instructions"
        GroupPanelTab.MEMORY -> "Memory"
        GroupPanelTab.LIBRARY -> "Library"
        GroupPanelTab.COMPUTER -> "Computer"
    }

    fun suggestionTitle(suggestion: GroupSuggestion): String = when (suggestion.action) {
        GroupSuggestionAction.INSTRUCTIONS -> "Write the group instructions"
        GroupSuggestionAction.MEMBERS -> "Add a second bot"
        GroupSuggestionAction.ROUTINE -> "Give the team a goal"
    }

    fun suggestionSubtitle(suggestion: GroupSuggestion): String = when (suggestion.action) {
        GroupSuggestionAction.INSTRUCTIONS ->
            "A shared brief every bot here reads on each turn."
        GroupSuggestionAction.MEMBERS ->
            "A group works best with bots that split the work."
        GroupSuggestionAction.ROUTINE ->
            "A routine the bots of this group work on together, on a schedule."
    }

    fun leadBadgeTitle(name: String): String =
        "$name answers plain messages in this group"

    fun makeLeadAria(name: String): String = "Make $name the lead"

    fun computerOf(name: String): String = "Computer of $name"

    /**
     * A person's row label when the org directory is not on the phone yet:
     * email as written, else the principal id.
     */
    fun personLabel(humanId: String): String {
        val trimmed = humanId.trim()
        if (trimmed.isEmpty()) return "Person"
        return trimmed
    }

    /** People listed on the room, newest-stable order kept. */
    fun peopleIds(room: Room): List<String> =
        (room.humanIds ?: emptyList()).map { it.trim() }.filter { it.isNotEmpty() }

    /**
     * Solo pairings manage rooms fully. An organization server still lets
     * the owner edit; memory stays available when the gate allows it.
     */
    fun gateForPairing(organization: Boolean, sidecar: Boolean = false): GateFlags =
        GateFlags(
            organization = organization,
            allowsRoomManagement = !sidecar,
            allowsRoomMemory = true,
            allowsRoomDelete = !sidecar,
            sidecar = sidecar,
        )

    fun access(
        room: Room,
        bots: List<Bot>,
        viewer: RoomViewer,
        organization: Boolean,
        sidecar: Boolean = false,
    ): RoomInfoAccess = RoomInfoAccess(
        room = room,
        gate = gateForPairing(organization, sidecar),
        viewer = viewer,
        bots = bots,
    )

    fun tabs(
        access: RoomInfoAccess,
        members: List<Bot>,
        ownBots: List<Bot>,
        advancedMode: Boolean,
    ): List<GroupPanelTab> {
        val hasComputer = groupComputerBots(ownBots).isNotEmpty()
        return visibleGroupPanelTabs(advanced = advancedMode, hasComputer = hasComputer)
            .filter { tab ->
                when (tab) {
                    GroupPanelTab.MEMORY -> access.memory
                    GroupPanelTab.COMPUTER -> hasComputer
                    else -> true
                }
            }
    }

    /**
     * Bots whose activity and computer this panel may read. On a solo server
     * bots carry no ownerUserId, so every member in the fleet counts; on an
     * organization server only the viewer's own bots do.
     */
    fun ownBotsInRoom(room: Room, bots: List<Bot>, viewer: RoomViewer): List<Bot> {
        val members = memberBots(room, bots)
        val own = com.openmausbot.companion.core.RoomOwnership.ownBotIds(bots, viewer)
        return if (own.isEmpty()) members else members.filter { it.id in own }
    }

    fun memberBots(room: Room, bots: List<Bot>): List<Bot> =
        room.memberIds.mapNotNull { id -> bots.firstOrNull { it.id == id } }

    fun leadId(room: Room, members: List<Bot>): String? = groupLeadBotId(room, members)

    fun suggestions(
        room: Room,
        access: RoomInfoAccess,
        botCount: Int,
        routineCount: Int,
    ): List<GroupSuggestion> = groupSuggestions(
        bulletin = room.bulletin,
        botCount = botCount,
        routineCount = routineCount,
        canEdit = access.editable,
        canAddBot = access.canAddBot,
        canAddRoutine = access.editable,
    )
}
