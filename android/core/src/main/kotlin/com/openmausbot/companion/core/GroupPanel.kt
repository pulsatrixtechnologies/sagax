package com.openmausbot.companion.core

/** Details, Members, Instructions, Memory, Library, Computer. No Advanced
 * tab: its settings sit under Members, folded by default. */
enum class GroupPanelTab(val id: String) {
    DETAILS("details"),
    MEMBERS("members"),
    INSTRUCTIONS("instructions"),
    MEMORY("memory"),
    LIBRARY("library"),
    COMPUTER("computer"),
}

val GROUP_PANEL_TABS: List<GroupPanelTab> = GroupPanelTab.entries

/** Simple mode hides Computer, as on a bot. */
fun simpleHidesPanelTab(id: String): Boolean = id == "computer"

/** The tabs a group shows. Simple hides Computer; a group with no bot of
 * the viewer's that works somewhere has no computer to show. */
fun visibleGroupPanelTabs(advanced: Boolean, hasComputer: Boolean): List<GroupPanelTab> =
    GROUP_PANEL_TABS.filter { tab ->
        (advanced || !simpleHidesPanelTab(tab.id)) && (tab != GroupPanelTab.COMPUTER || hasComputer)
    }

/** Every conversation of the group: its open one and each of its tasks. */
fun groupThreadIds(group: Room): Set<String> = buildSet {
    if (group.threadId.isNotEmpty()) add(group.threadId)
    group.tasks?.forEach { task ->
        if (task.threadId.isNotEmpty()) add(task.threadId)
    }
}

/** The group's routines: its team goals (groupId) and the routines that
 * post their results in one of its conversations. */
fun groupRoutines(routines: List<Routine>?, group: Room): List<Routine> {
    val threads = groupThreadIds(group)
    return (routines ?: emptyList()).filter { routine ->
        routine.groupId == group.id ||
            (routine.resultsThreadId != null && routine.resultsThreadId in threads)
    }
}

/** The bot that answers a plain message: the lead, or an Auto room's
 * fallback. None while the room answers everyone or mentions only. */
fun groupLeadBotId(group: Room, members: List<Bot>): String? {
    val ids = members.map { it.id }.ifEmpty { group.memberIds }
    val effective = effectiveDefaultResponder(group.defaultResponder, ids)
    return when (effective.kind) {
        "member" -> effective.botId
        "auto" -> effective.fallbackBotId ?: ids.firstOrNull()
        else -> null
    }
}

/** Making a bot the lead from its row: an Auto room keeps Auto with that
 * bot as its fallback; any other room answers through that bot. */
fun leadResponder(group: Room, members: List<Bot>, botId: String): GroupResponder {
    val ids = members.map { it.id }.ifEmpty { group.memberIds }
    val value = effectiveDefaultResponder(group.defaultResponder, ids)
    return if (value.kind == "auto") {
        GroupResponder(kind = "auto", fallbackBotId = botId)
    } else {
        GroupResponder(kind = "member", botId = botId)
    }
}

enum class GroupSuggestionAction { INSTRUCTIONS, MEMBERS, ROUTINE }

data class GroupSuggestion(
    val id: String,
    val titleKey: String,
    val subtitleKey: String,
    val action: GroupSuggestionAction,
)

/** Next steps for a group: write its instructions, bring a second bot,
 * give the team a goal. What the viewer cannot change is not suggested. */
fun groupSuggestions(
    bulletin: String,
    botCount: Int,
    routineCount: Int,
    canEdit: Boolean,
    canAddBot: Boolean,
    canAddRoutine: Boolean,
): List<GroupSuggestion> = buildList {
    if (canEdit && bulletin.trim().isEmpty()) {
        add(
            GroupSuggestion(
                id = "instructions",
                titleKey = "groupPanel.suggestions.instructions.title",
                subtitleKey = "groupPanel.suggestions.instructions.subtitle",
                action = GroupSuggestionAction.INSTRUCTIONS,
            ),
        )
    }
    if (canAddBot && botCount < 2) {
        add(
            GroupSuggestion(
                id = "bots",
                titleKey = "groupPanel.suggestions.bots.title",
                subtitleKey = "groupPanel.suggestions.bots.subtitle",
                action = GroupSuggestionAction.MEMBERS,
            ),
        )
    }
    if (canAddRoutine && routineCount == 0) {
        add(
            GroupSuggestion(
                id = "goal",
                titleKey = "groupPanel.suggestions.goal.title",
                subtitleKey = "groupPanel.suggestions.goal.subtitle",
                action = GroupSuggestionAction.ROUTINE,
            ),
        )
    }
}

/** The viewer's bots in the group that work somewhere: computer is not off. */
fun groupComputerBots(ownBots: List<Bot>): List<Bot> =
    ownBots.filter { it.computer != "off" }

/** Be defensive around a lead removed before the group patch arrives. */
internal fun effectiveDefaultResponder(
    value: GroupResponder,
    memberIds: List<String>,
): GroupResponder = when (value.kind) {
    "everyone", "mentions" -> value
    "member" -> if (value.botId != null && value.botId in memberIds) value else fallbackLead(memberIds)
    "auto" -> if (value.fallbackBotId != null && value.fallbackBotId in memberIds) {
        value
    } else {
        GroupResponder(kind = "auto")
    }
    else -> fallbackLead(memberIds)
}

private fun fallbackLead(memberIds: List<String>): GroupResponder =
    memberIds.firstOrNull()?.let { GroupResponder(kind = "member", botId = it) }
        ?: GroupResponder(kind = "mentions")
