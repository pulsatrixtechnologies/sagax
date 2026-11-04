package com.openmausbot.companion.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.GroupMemoryConflict
import com.openmausbot.companion.core.GroupMemoryView
import com.openmausbot.companion.core.GroupPanelTab
import com.openmausbot.companion.core.GroupSuggestionAction
import com.openmausbot.companion.core.LibraryEntry
import com.openmausbot.companion.core.LibraryGroups
import com.openmausbot.companion.core.LibraryRules
import com.openmausbot.companion.core.MemoryCapacity
import com.openmausbot.companion.core.Room
import com.openmausbot.companion.core.RoomPatch
import com.openmausbot.companion.core.RoomResponder
import com.openmausbot.companion.core.Routine
import com.openmausbot.companion.core.groupComputerBots
import com.openmausbot.companion.core.groupRoutines
import com.openmausbot.companion.core.leadResponder
import kotlinx.coroutines.launch

/**
 * Group side panel: Details / Members / Instructions / Memory / Library /
 * Computer. Port of `src/components/GroupPanel.tsx` for the phone sheet
 * (same tabs and lead control; Advanced folded under Members).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun GroupPanelSheet(
    roomId: String,
    onDismiss: () -> Unit,
    onOpenComputer: (String) -> Unit = {},
    onOpenRoutines: () -> Unit = {},
    onOpenThreads: () -> Unit = {},
    onDeleted: () -> Unit = {},
) {
    val environment = LocalCompanion.current
    val session = environment.session
    val state by session.state.collectAsState()
    val connection by session.connection.collectAsState()
    val account by session.account.collectAsState()
    val scope = rememberCoroutineScope()

    val current = state.rooms.firstOrNull { it.id == roomId }
    if (current == null) {
        LaunchedEffect(roomId) { onDismiss() }
        return
    }
    val bots = state.bots
    val members = remember(current, bots) { GroupPanelRules.memberBots(current, bots) }
    // Solo Mac pairings have no serverEnvironmentId; org servers do.
    val organization = connection?.pairedWithServer == true
    val viewer = remember(account) { session.roomViewer }
    val access = remember(current, bots, organization, viewer) {
        GroupPanelRules.access(current, bots, viewer, organization = organization)
    }
    val ownBots = remember(current, bots, viewer) {
        GroupPanelRules.ownBotsInRoom(current, bots, viewer)
    }
    val computerBots = remember(ownBots) { groupComputerBots(ownBots) }
    val leadId = remember(current, members) { GroupPanelRules.leadId(current, members) }
    // Phone has no simple/advanced preference yet: show the full strip.
    val tabs = remember(access, members, ownBots) {
        GroupPanelRules.tabs(access, members, ownBots, advancedMode = true)
    }
    var picked by rememberSaveable(current.id) { mutableStateOf(GroupPanelTab.DETAILS.id) }
    val tab = tabs.firstOrNull { it.id == picked } ?: GroupPanelTab.DETAILS

    var nameDraft by rememberSaveable(current.id) { mutableStateOf(current.name) }
    var bulletinDraft by rememberSaveable(current.id) { mutableStateOf(current.bulletin) }
    var advancedOpen by rememberSaveable(current.id) { mutableStateOf(false) }
    var routines by remember(current.id) { mutableStateOf<List<Routine>>(emptyList()) }
    var leaveConfirm by remember { mutableStateOf(false) }
    var deleteConfirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var routineEditor by remember { mutableStateOf<RoutineEditorTarget?>(null) }

    LaunchedEffect(current.id) {
        nameDraft = current.name
        bulletinDraft = current.bulletin
        routines = groupRoutines(session.loadRoutines().routines, current)
    }
    LaunchedEffect(current.name) {
        if (!busy) nameDraft = current.name
    }
    LaunchedEffect(current.bulletin) {
        if (!busy) bulletinDraft = current.bulletin
    }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.align(Alignment.CenterStart),
                ) {
                    Text("Done")
                }
                Text(
                    text = GroupPanelRules.TITLE,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.align(Alignment.Center),
                )
            }

            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                GroupAvatarStack(members = members, size = 96.dp)
                if (access.editable) {
                    OutlinedTextField(
                        value = nameDraft,
                        onValueChange = { nameDraft = it.take(GroupPanelRules.NAME_LIMIT) },
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Medium),
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Name") },
                    )
                    val rename = RoomPatch.rename(current.name, nameDraft)
                    if (rename != null) {
                        TextButton(
                            onClick = {
                                scope.launch {
                                    busy = true
                                    try {
                                        session.patchRoom(current, RoomPatch(name = rename))
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                            enabled = !busy,
                        ) { Text(GroupPanelRules.SAVE) }
                    }
                } else {
                    Text(
                        current.name,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    GroupPanelRules.botCountLabel(members.size),
                    fontSize = 12.sp,
                    color = secondaryTint,
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                tabs.forEach { candidate ->
                    val selected = candidate == tab
                    Surface(
                        shape = MaterialTheme.shapes.small,
                        color = if (selected) {
                            MaterialTheme.colorScheme.surfaceVariant
                        } else {
                            MaterialTheme.colorScheme.surface
                        },
                        modifier = Modifier
                            .clipClickable {
                                picked = candidate.id
                            }
                            .semantics {
                                contentDescription = GroupPanelRules.tabLabel(candidate)
                            },
                    ) {
                        Text(
                            GroupPanelRules.tabLabel(candidate),
                            fontSize = 13.sp,
                            color = if (selected) {
                                MaterialTheme.colorScheme.onSurface
                            } else {
                                secondaryTint
                            },
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                        )
                    }
                }
            }

            if (access.readOnlyNote) {
                Text(
                    GroupPanelRules.OWNER_ONLY,
                    fontSize = 12.sp,
                    color = secondaryTint,
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }

            when (tab) {
                GroupPanelTab.DETAILS -> GroupDetailsTab(
                    room = current,
                    access = access,
                    members = members,
                    ownBots = ownBots,
                    routines = routines,
                    onOpenTab = { picked = it.id },
                    onOpenThreads = onOpenThreads,
                    onOpenRoutines = onOpenRoutines,
                    onOpenRoutine = { routine ->
                        routineEditor = RoutineEditorTarget.edit(routine)
                    },
                    onNewRoutine = {
                        routineEditor = RoutineEditorTarget.new(
                            groupId = current.id,
                            preferredBotId = leadId ?: ownBots.firstOrNull()?.id,
                        )
                    },
                )
                GroupPanelTab.MEMBERS -> GroupMembersTab(
                    room = current,
                    members = members,
                    access = access,
                    leadId = leadId,
                    advancedOpen = advancedOpen,
                    onToggleAdvanced = { advancedOpen = !advancedOpen },
                    onMakeLead = { botId ->
                        scope.launch {
                            busy = true
                            try {
                                session.patchRoom(
                                    current,
                                    RoomPatch(defaultResponder = leadResponder(current, members, botId)),
                                )
                            } finally {
                                busy = false
                            }
                        }
                    },
                    onResponder = { choice ->
                        scope.launch {
                            busy = true
                            try {
                                session.patchRoom(
                                    current,
                                    RoomPatch(defaultResponder = RoomResponder.value(choice, current)),
                                )
                            } finally {
                                busy = false
                            }
                        }
                    },
                    onLeave = { leaveConfirm = true },
                    onDelete = { deleteConfirm = true },
                    busy = busy,
                )
                GroupPanelTab.INSTRUCTIONS -> GroupInstructionsTab(
                    draft = bulletinDraft,
                    editable = access.editable,
                    busy = busy,
                    onDraft = { bulletinDraft = it },
                    onSave = {
                        scope.launch {
                            busy = true
                            try {
                                if (bulletinDraft != current.bulletin) {
                                    session.patchRoom(current, RoomPatch(bulletin = bulletinDraft))
                                }
                            } finally {
                                busy = false
                            }
                        }
                    },
                )
                GroupPanelTab.MEMORY -> GroupMemoryTab(room = current)
                GroupPanelTab.LIBRARY -> GroupLibraryTab(room = current)
                GroupPanelTab.COMPUTER -> GroupComputerTab(
                    bots = computerBots,
                    leadId = leadId,
                    onOpen = { botId ->
                        onDismiss()
                        onOpenComputer(botId)
                    },
                )
            }
        }
    }

    routineEditor?.let { target ->
        RoutineEditorSheet(
            target = target,
            onSaved = {
                scope.launch {
                    routines = groupRoutines(session.loadRoutines().routines, current)
                }
            },
            onDismiss = { routineEditor = null },
        )
    }

    if (leaveConfirm) {
        AlertDialog(
            onDismissRequest = { leaveConfirm = false },
            title = { Text(GroupPanelRules.LEAVE) },
            text = { Text("Leave this group on this device?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        leaveConfirm = false
                        scope.launch {
                            if (session.leaveRoom(current)) {
                                onDeleted()
                                onDismiss()
                            }
                        }
                    },
                ) { Text(GroupPanelRules.LEAVE) }
            },
            dismissButton = {
                TextButton(onClick = { leaveConfirm = false }) { Text("Cancel") }
            },
        )
    }
    if (deleteConfirm) {
        AlertDialog(
            onDismissRequest = { deleteConfirm = false },
            title = { Text("Delete group") },
            text = { Text("Delete this group, its messages and threads? Its bots stay.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteConfirm = false
                        scope.launch {
                            if (session.deleteRoom(current)) {
                                onDeleted()
                                onDismiss()
                            }
                        }
                    },
                ) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { deleteConfirm = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun GroupAvatarStack(members: List<Bot>, size: androidx.compose.ui.unit.Dp) {
    val shown = members.take(3)
    if (shown.isEmpty()) {
        Box(Modifier.size(size))
        return
    }
    if (shown.size == 1) {
        BotAvatar(bot = shown[0], size = size, state = MausState.HAPPY)
        return
    }
    Box(Modifier.size(size)) {
        val face = if (shown.size == 2) size * 0.62f else size * 0.56f
        shown.forEachIndexed { index, bot ->
            val align = when {
                shown.size == 2 && index == 0 -> Alignment.TopStart
                shown.size == 2 -> Alignment.BottomEnd
                index == 0 -> Alignment.TopStart
                index == 1 -> Alignment.TopEnd
                else -> Alignment.BottomStart
            }
            Box(Modifier.align(align)) {
                BotAvatar(bot = bot, size = face, state = MausState.HAPPY)
            }
        }
    }
}

@Composable
private fun GroupDetailsTab(
    room: Room,
    access: com.openmausbot.companion.core.RoomInfoAccess,
    members: List<Bot>,
    ownBots: List<Bot>,
    routines: List<Routine>,
    onOpenTab: (GroupPanelTab) -> Unit,
    onOpenThreads: () -> Unit,
    onOpenRoutines: () -> Unit,
    onOpenRoutine: (Routine) -> Unit,
    onNewRoutine: () -> Unit,
) {
    val suggestions = GroupPanelRules.suggestions(
        room = room,
        access = access,
        botCount = room.memberIds.size,
        routineCount = routines.size,
    )
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        if (suggestions.isNotEmpty()) {
            FormSection(header = "Suggestions") {
                suggestions.forEach { item ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clipClickable {
                                when (item.action) {
                                    GroupSuggestionAction.INSTRUCTIONS -> onOpenTab(GroupPanelTab.INSTRUCTIONS)
                                    GroupSuggestionAction.MEMBERS -> onOpenTab(GroupPanelTab.MEMBERS)
                                    GroupSuggestionAction.ROUTINE -> onNewRoutine()
                                }
                            }
                            .padding(vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            GroupPanelRules.suggestionTitle(item),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            GroupPanelRules.suggestionSubtitle(item),
                            fontSize = 12.sp,
                            color = secondaryTint,
                        )
                    }
                }
            }
        }

        if (room.tasks != null) {
            FormSection(header = "Threads") {
                ActionRow(
                    text = "Threads",
                    onClick = onOpenThreads,
                )
                Text(
                    "${room.tasks?.size ?: 1} conversation(s)",
                    fontSize = 12.sp,
                    color = secondaryTint,
                )
            }
        }

        ownBots.forEach { bot ->
            CodingActivitySection(botId = bot.id)
        }

        FormSection(header = "Routines", footer = GroupPanelRules.ROUTINES_HINT) {
            if (routines.isEmpty()) {
                Text(GroupPanelRules.ROUTINES_HINT, fontSize = 13.sp, color = secondaryTint)
                if (access.editable && ownBots.isNotEmpty() && room.dm != true) {
                    ActionRow(
                        text = GroupPanelRules.ROUTINES_CREATE,
                        onClick = onNewRoutine,
                    )
                }
            } else {
                routines.forEach { routine ->
                    val botName = members.firstOrNull { it.id == routine.botId }?.name
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clipClickable { onOpenRoutine(routine) }
                            .padding(vertical = 8.dp)
                            .semantics {
                                contentDescription = "Open routine ${routine.name}"
                            },
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(routine.name, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        if (botName != null) {
                            Text(botName, fontSize = 12.sp, color = secondaryTint)
                        }
                    }
                }
                if (access.editable && ownBots.isNotEmpty() && room.dm != true) {
                    ActionRow(
                        text = GroupPanelRules.ROUTINES_CREATE,
                        onClick = onNewRoutine,
                    )
                }
            }
            TextButton(onClick = onOpenRoutines) {
                Text("All routines", fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun GroupMembersTab(
    room: Room,
    members: List<Bot>,
    access: com.openmausbot.companion.core.RoomInfoAccess,
    leadId: String?,
    advancedOpen: Boolean,
    onToggleAdvanced: () -> Unit,
    onMakeLead: (String) -> Unit,
    onResponder: (RoomResponder.Choice) -> Unit,
    onLeave: () -> Unit,
    onDelete: () -> Unit,
    busy: Boolean,
) {
    val people = remember(room) { GroupPanelRules.peopleIds(room) }
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        FormSection(header = GroupPanelRules.PEOPLE) {
            if (people.isEmpty()) {
                Text(GroupPanelRules.PEOPLE_EMPTY, fontSize = 13.sp, color = secondaryTint)
            } else {
                people.forEach { humanId ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = MIN_TOUCH_TARGET),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            modifier = Modifier.size(36.dp),
                        ) {}
                        Text(
                            GroupPanelRules.personLabel(humanId),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        FormSection(header = GroupPanelRules.BOTS) {
            members.forEach { bot ->
                val isLead = bot.id == leadId
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = MIN_TOUCH_TARGET),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    BotAvatar(bot = bot, size = 36.dp, state = MausState.HAPPY)
                    Column(Modifier.weight(1f)) {
                        Text(bot.name, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        if (bot.title.isNotBlank()) {
                            Text(bot.title, fontSize = 12.sp, color = secondaryTint, maxLines = 1)
                        }
                    }
                    if (isLead) {
                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.15f),
                            modifier = Modifier.semantics {
                                contentDescription = GroupPanelRules.leadBadgeTitle(bot.name)
                            },
                        ) {
                            Text(
                                GroupPanelRules.LEAD_BADGE,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            )
                        }
                    } else if (access.editable) {
                        TextButton(
                            onClick = { onMakeLead(bot.id) },
                            enabled = !busy,
                            modifier = Modifier.semantics {
                                contentDescription = GroupPanelRules.makeLeadAria(bot.name)
                            },
                        ) {
                            Text(GroupPanelRules.MAKE_LEAD, fontSize = 13.sp)
                        }
                    }
                }
            }
            if (members.isEmpty()) {
                Text("No bots in this group yet.", fontSize = 13.sp, color = secondaryTint)
            }
        }

        if (access.canLeave) {
            FormSection(header = null) {
                ActionRow(
                    text = GroupPanelRules.LEAVE,
                    destructive = true,
                    onClick = onLeave,
                )
            }
        }

        FormSection(header = null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = MIN_TOUCH_TARGET)
                    .clickable(role = Role.Button, onClick = onToggleAdvanced),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(GroupPanelRules.ADVANCED, fontSize = 13.sp, color = secondaryTint)
                Icon(
                    imageVector = if (advancedOpen) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                    contentDescription = null,
                    tint = secondaryTint,
                    modifier = Modifier.size(18.dp),
                )
            }
            if (advancedOpen) {
                Text("Who answers", fontSize = 12.sp, color = secondaryTint)
                listOf(
                    RoomResponder.Choice.Auto to "Auto",
                    RoomResponder.Choice.Everyone to "Everyone",
                    RoomResponder.Choice.Mentions to "Mentions only",
                ).forEach { (choice, label) ->
                    val selected = when (val current = RoomResponder.choice(room)) {
                        is RoomResponder.Choice.Auto -> choice is RoomResponder.Choice.Auto
                        is RoomResponder.Choice.Everyone -> choice is RoomResponder.Choice.Everyone
                        is RoomResponder.Choice.Mentions -> choice is RoomResponder.Choice.Mentions
                        is RoomResponder.Choice.Lead -> false
                    }
                    Text(
                        if (selected) "• $label" else label,
                        fontSize = 15.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = access.editable && !busy) { onResponder(choice) }
                            .padding(vertical = 8.dp),
                        color = if (access.editable) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            secondaryTint
                        },
                    )
                }
                room.cwd?.takeIf { it.isNotBlank() }?.let { folder ->
                    Text("Working folder", fontSize = 12.sp, color = secondaryTint)
                    Text(folder, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
                    if (!access.editable) {
                        Text(GroupPanelRules.FOLDER_ADMIN_ONLY, fontSize = 12.sp, color = secondaryTint)
                    }
                }
                if (access.canDelete) {
                    ActionRow(
                        text = "Delete group",
                        destructive = true,
                        onClick = onDelete,
                    )
                }
            }
        }
    }
}

@Composable
private fun GroupInstructionsTab(
    draft: String,
    editable: Boolean,
    busy: Boolean,
    onDraft: (String) -> Unit,
    onSave: () -> Unit,
) {
    FormSection(header = GroupPanelRules.INSTRUCTIONS, footer = GroupPanelRules.INSTRUCTIONS_DETAIL) {
        if (editable) {
            OutlinedTextField(
                value = draft,
                onValueChange = onDraft,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 180.dp),
                placeholder = { Text(GroupPanelRules.INSTRUCTIONS_PLACEHOLDER) },
                textStyle = TextStyle(fontSize = 14.sp),
            )
            TextButton(onClick = onSave, enabled = !busy) { Text(GroupPanelRules.SAVE) }
        } else if (draft.isBlank()) {
            Text(GroupPanelRules.INSTRUCTIONS_EMPTY, fontSize = 13.sp, color = secondaryTint)
        } else {
            Text(draft, fontSize = 14.sp)
        }
    }
}

@Composable
private fun GroupMemoryTab(room: Room) {
    val session = LocalCompanion.current.session
    val scope = rememberCoroutineScope()
    var view by remember(room.id) { mutableStateOf<GroupMemoryView?>(null) }
    var draft by remember(room.id) { mutableStateOf("") }
    var conflict by remember(room.id) { mutableStateOf(false) }
    var error by remember(room.id) { mutableStateOf<String?>(null) }
    var saving by remember(room.id) { mutableStateOf(false) }
    var loading by remember(room.id) { mutableStateOf(true) }

    suspend fun reload() {
        loading = true
        error = null
        try {
            val next = session.loadGroupMemory(room)
            view = next
            if (next != null) draft = next.text
        } finally {
            loading = false
        }
    }

    LaunchedEffect(room.id) { reload() }

    FormSection(header = GroupPanelRules.MEMORY) {
        when {
            loading && view == null -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("Loading the group memory…", fontSize = 13.sp, color = secondaryTint)
            }
            view == null -> Text(
                error ?: "Couldn't load group memory.",
                fontSize = 13.sp,
                color = secondaryTint,
            )
            else -> {
                val memory = view!!
                SwitchRow(
                    label = "Group memory",
                    checked = memory.enabled,
                    enabled = memory.canEdit && !saving,
                    onCheckedChange = {
                        scope.launch {
                            saving = true
                            try {
                                val next = session.saveGroupMemory(room, enabled = !memory.enabled)
                                if (next != null) {
                                    view = next
                                    draft = next.text
                                }
                            } catch (_: GroupMemoryConflict) {
                                conflict = true
                            } finally {
                                saving = false
                            }
                        }
                    },
                )
                if (!memory.canEdit) {
                    Text(
                        "Only the owner of this group can change its memory.",
                        fontSize = 12.sp,
                        color = secondaryTint,
                    )
                }
                Text(
                    "${memory.capacity.lines} lines · ${MemoryCapacity.formatBytes(memory.capacity.bytes)}",
                    fontSize = 12.sp,
                    color = secondaryTint,
                )
                if (memory.canEdit) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it; conflict = false },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 180.dp),
                        placeholder = { Text(GroupPanelRules.MEMORY_EMPTY) },
                        textStyle = TextStyle(fontSize = 13.sp, fontFamily = FontFamily.Monospace),
                    )
                    if (conflict) {
                        Text(
                            "A bot changed the group memory while you were editing. Nothing was saved.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.error,
                        )
                        TextButton(onClick = {
                            conflict = false
                            scope.launch { reload() }
                        }) { Text("Reload") }
                    }
                    val dirty = draft != memory.text
                    TextButton(
                        onClick = {
                            scope.launch {
                                saving = true
                                try {
                                    val next = session.saveGroupMemory(
                                        room,
                                        text = draft,
                                        expectedHash = memory.hash,
                                    )
                                    if (next != null) {
                                        view = next
                                        draft = next.text
                                        conflict = false
                                    }
                                } catch (_: GroupMemoryConflict) {
                                    conflict = true
                                } finally {
                                    saving = false
                                }
                            }
                        },
                        enabled = dirty && !saving,
                    ) { Text(GroupPanelRules.SAVE) }
                } else {
                    Text(
                        memory.text.ifBlank { GroupPanelRules.MEMORY_EMPTY },
                        fontSize = 13.sp,
                        fontFamily = FontFamily.Monospace,
                        color = if (memory.text.isBlank()) secondaryTint else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}

@Composable
private fun GroupLibraryTab(room: Room) {
    val session = LocalCompanion.current.session
    var groups by remember(room.id) { mutableStateOf<LibraryGroups?>(null) }
    var loading by remember(room.id) { mutableStateOf(true) }
    var olderExpanded by rememberSaveable(room.id) { mutableStateOf(false) }

    LaunchedEffect(room.id, room.threadId, room.tasks) {
        loading = true
        val files = session.loadGroupLibraryFiles(room)
        groups = LibraryRules.groups(files)
        loading = false
    }

    FormSection(header = GroupPanelRules.LIBRARY) {
        when {
            loading && groups == null -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text(GroupPanelRules.LIBRARY_LOADING, fontSize = 13.sp, color = secondaryTint)
            }
            groups == null || groups!!.isEmpty -> Text(
                GroupPanelRules.LIBRARY_EMPTY,
                fontSize = 13.sp,
                color = secondaryTint,
            )
            else -> {
                val list = groups!!
                LibraryGroupBlock(GroupPanelRules.LIBRARY_PINNED, list.pinned)
                LibraryGroupBlock(GroupPanelRules.LIBRARY_TODAY, list.today)
                LibraryGroupBlock(GroupPanelRules.LIBRARY_THIS_WEEK, list.thisWeek)
                val older = list.older
                if (older.isNotEmpty()) {
                    val shown = if (olderExpanded) older else older.take(LibraryRules.OLDER_PREVIEW)
                    LibraryGroupBlock(GroupPanelRules.LIBRARY_OLDER, shown)
                    if (!olderExpanded && older.size > LibraryRules.OLDER_PREVIEW) {
                        TextButton(onClick = { olderExpanded = true }) {
                            Text(GroupPanelRules.LIBRARY_SHOW_MORE, fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LibraryGroupBlock(title: String, entries: List<LibraryEntry>) {
    if (entries.isEmpty()) return
    Text(title, fontSize = 12.sp, color = secondaryTint, fontWeight = FontWeight.Medium)
    entries.forEach { entry ->
        Text(
            entry.title,
            fontSize = 15.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
        )
    }
}

@Composable
private fun GroupComputerTab(
    bots: List<Bot>,
    leadId: String?,
    onOpen: (String) -> Unit,
) {
    var picked by rememberSaveable { mutableStateOf(leadId ?: bots.firstOrNull()?.id) }
    val bot = bots.firstOrNull { it.id == picked } ?: bots.firstOrNull()
    FormSection(header = GroupPanelRules.COMPUTER) {
        if (bot == null) {
            Text("No computer to show for this group.", fontSize = 13.sp, color = secondaryTint)
            return@FormSection
        }
        if (bots.size > 1) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                bots.forEach { candidate ->
                    val selected = candidate.id == bot.id
                    Text(
                        candidate.name,
                        fontSize = 13.sp,
                        color = if (selected) MaterialTheme.colorScheme.primary else secondaryTint,
                        modifier = Modifier
                            .clickable { picked = candidate.id }
                            .padding(vertical = 8.dp, horizontal = 4.dp),
                    )
                }
            }
        }
        ActionRow(
            text = GroupPanelRules.computerOf(bot.name),
            onClick = { onOpen(bot.id) },
        )
    }
}

/** Clickable without importing foundation.clip everywhere. */
@Composable
private fun Modifier.clipClickable(onClick: () -> Unit): Modifier =
    this.clickable(role = Role.Button, onClick = onClick)
