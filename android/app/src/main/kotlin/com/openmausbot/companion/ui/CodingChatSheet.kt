package com.openmausbot.companion.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.openmausbot.companion.core.BotActivityDetail
import com.openmausbot.companion.core.BotActivityItem
import com.openmausbot.companion.core.BotActivityStatus
import com.openmausbot.companion.core.ChangedFile
import com.openmausbot.companion.core.CodingChatTarget
import com.openmausbot.companion.core.CodingMessage
import com.openmausbot.companion.core.CodingPlace
import com.openmausbot.companion.core.CodingRow
import com.openmausbot.companion.core.CodingStep
import com.openmausbot.companion.core.DiffFile
import com.openmausbot.companion.core.DiffFileStatus
import com.openmausbot.companion.core.DiffLineKind
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.TestSummary
import com.openmausbot.companion.core.activityTitle
import com.openmausbot.companion.core.changedFiles
import com.openmausbot.companion.core.codingPlace
import com.openmausbot.companion.core.codingRoot
import com.openmausbot.companion.core.codingRows
import com.openmausbot.companion.core.latestTests
import com.openmausbot.companion.core.stepMessages
import com.openmausbot.companion.core.toCodingMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Bot profile Coding list: recent coding jobs, each opening [CodingChatSheet].
 * Mirrors desktop Details > Coding (running jobs on the phone).
 */
@Composable
internal fun CodingActivitySection(botId: String) {
    val environment = LocalCompanion.current
    val session = environment.session
    var items by remember(botId) { mutableStateOf<List<BotActivityItem>>(emptyList()) }
    var loading by remember(botId) { mutableStateOf(true) }
    var openTarget by remember { mutableStateOf<CodingChatTarget?>(null) }

    LaunchedEffect(botId) {
        loading = true
        try {
            val list = session.loadBotActivity(botId, filter = "coding", quiet = true)
            items = list?.items.orEmpty().filter { it.coding == true || it.code != null }.take(20)
        } finally {
            loading = false
        }
    }

    FormSection(header = "Coding") {
        when {
            loading -> Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("Loading activity…", fontSize = 13.sp, color = secondaryTint)
            }
            items.isEmpty() -> Text(
                "No coding jobs in the last 7 days.",
                fontSize = 13.sp,
                color = secondaryTint,
            )
            else -> items.forEach { item ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .clickable {
                            openTarget = CodingChatTarget(
                                botId = botId,
                                itemId = item.id,
                                threadId = item.threadId,
                                seed = item,
                            )
                        }
                        .padding(vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        activityTitle(item),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        CodingChatRules.statusLabel(item.status),
                        fontSize = 12.sp,
                        color = secondaryTint,
                    )
                }
            }
        }
    }

    openTarget?.let { target ->
        CodingChatSheet(target = target, onDismiss = { openTarget = null })
    }
}

/**
 * Coding task opened as a chat over the conversation column: terminals,
 * diffs, Changes band, Continue / Stop / Close. Port of
 * `src/components/coding/CodingChat.tsx`.
 */
@Composable
fun CodingChatSheet(target: CodingChatTarget, onDismiss: () -> Unit) {
    val environment = LocalCompanion.current
    val session = environment.session
    val state by session.state.collectAsState()
    val scope = rememberCoroutineScope()
    val bot = state.bot(target.botId)
    val seed = target.seed ?: BotActivityItem(
        id = target.itemId,
        botId = target.botId,
        title = CodingChatRules.STARTING,
        status = BotActivityStatus.RUNNING,
        startedAt = System.currentTimeMillis().toDouble(),
        threadId = target.threadId,
    )

    var detail by remember(target.itemId) { mutableStateOf<BotActivityDetail?>(null) }
    var messages by remember(target.itemId) { mutableStateOf<List<CodingMessage>>(emptyList()) }
    var hasMore by remember(target.itemId) { mutableStateOf(false) }
    var loadingOlder by remember(target.itemId) { mutableStateOf(false) }
    var loaded by remember(target.itemId) { mutableStateOf(false) }
    var failed by remember(target.itemId) { mutableStateOf(false) }
    var stopping by remember(target.itemId) { mutableStateOf(false) }
    var composing by remember(target.itemId) { mutableStateOf(false) }
    var followUntil by remember(target.itemId) { mutableLongStateOf(0L) }
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var reveal by remember { mutableStateOf<Pair<String, String>?>(null) }

    val threadId = detail?.threadId ?: target.threadId ?: seed.threadId
    val item = detail?.asItem() ?: seed
    val live = CodingChatRules.isLive(item, detail)
    val canStop = CodingChatRules.canStop(item, detail, hasStopHandler = true)
    val canContinue = CodingChatRules.canContinue(threadId)

    suspend fun reloadDetail(keepScreen: Boolean = true) {
        val next = session.loadBotActivityItem(target.botId, target.itemId, quiet = true)
        if (next != null) {
            detail = next
            failed = false
        } else if (!keepScreen || detail == null) {
            failed = true
        }
    }

    suspend fun reloadMessages() {
        val id = detail?.threadId ?: target.threadId ?: seed.threadId
        if (id.isNullOrBlank()) {
            val steps = detail?.steps.orEmpty()
            messages = stepMessages(steps, target.botId, bot?.name ?: item.botName ?: CodingChatRules.BOT_FALLBACK)
            loaded = true
            hasMore = false
            return
        }
        val page = session.loadCodingThread(id, limit = 200)
        if (page != null) {
            messages = page.messages.map(Message::toCodingMessage)
            hasMore = page.hasMore == true
            failed = false
        } else if (messages.isEmpty()) {
            failed = true
        }
        loaded = true
    }

    LaunchedEffect(target.itemId) {
        reloadDetail(keepScreen = false)
        reloadMessages()
    }

    LaunchedEffect(target.itemId, live, followUntil) {
        while (true) {
            val follow = System.currentTimeMillis() < followUntil
            if (!live && !follow) break
            delay(CodingChatRules.POLL_MS)
            reloadDetail(keepScreen = true)
            reloadMessages()
        }
    }

    LaunchedEffect(live) {
        while (live) {
            nowMs = System.currentTimeMillis()
            delay(1_000)
        }
    }

    BackHandler(onBack = onDismiss)

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .semantics { contentDescription = CodingChatRules.aria(activityTitle(item.title, item.retry)) },
            color = MaterialTheme.colorScheme.background,
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                CodingChatHeader(
                    botName = bot?.name ?: item.botName ?: CodingChatRules.BOT_FALLBACK,
                    botColor = bot?.color,
                    title = activityTitle(item.title, item.retry),
                    place = codingPlace(detail, codingRoot(messages, detail?.code ?: item.code)),
                    status = item.status,
                    elapsed = CodingChatRules.elapsedLabel(item, detail, nowMs.toDouble()),
                    onClose = onDismiss,
                )
                HorizontalDivider()

                val root = codingRoot(messages, detail?.code ?: item.code)
                val rows = remember(messages, root) { codingRows(messages, root) }
                val files = remember(rows) { changedFiles(rows) }
                val tests = remember(rows) { latestTests(rows) }
                val place = remember(detail, item, root) { codingPlace(detail, root) }
                val listState = rememberLazyListState()

                LaunchedEffect(rows.size, live) {
                    if (rows.isNotEmpty()) listState.animateScrollToItem(rows.lastIndex)
                }

                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 16.dp),
                ) {
                    if (hasMore) {
                        item("older") {
                            TextButton(
                                onClick = {
                                    val id = threadId ?: return@TextButton
                                    scope.launch {
                                        loadingOlder = true
                                        try {
                                            val page = session.loadCodingThreadOlder(id, before = messages.firstOrNull()?.id)
                                            if (page != null) {
                                                messages = page.messages.map(Message::toCodingMessage) + messages
                                                hasMore = page.hasMore == true
                                            }
                                        } finally {
                                            loadingOlder = false
                                        }
                                    }
                                },
                                enabled = !loadingOlder,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    if (loadingOlder) CodingChatRules.LOADING_OLDER else CodingChatRules.LOAD_OLDER,
                                    fontSize = 13.sp,
                                )
                            }
                        }
                    }
                    when {
                        failed && rows.isEmpty() -> item("error") {
                            Column(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(CodingChatRules.LOAD_ERROR, color = secondaryTint, fontSize = 13.sp)
                                TextButton(onClick = {
                                    scope.launch {
                                        reloadDetail(keepScreen = false)
                                        reloadMessages()
                                    }
                                }) { Text(CodingChatRules.RETRY) }
                            }
                        }
                        !loaded && rows.isEmpty() -> item("loading") {
                            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                            }
                        }
                        rows.isEmpty() -> item("empty") {
                            Text(
                                if (live) CodingChatRules.STARTING else CodingChatRules.EMPTY,
                                color = secondaryTint,
                                fontSize = 13.sp,
                                modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                            )
                        }
                    }
                    itemsIndexed(rows, key = { _, row -> row.id }) { index, row ->
                        CodingChatRow(
                            row = row,
                            previous = rows.getOrNull(index - 1),
                            botName = bot?.name ?: item.botName ?: CodingChatRules.BOT_FALLBACK,
                            revealPath = reveal?.takeIf { it.first == row.id }?.second,
                        )
                    }
                    if (live && rows.isNotEmpty()) {
                        item("working") {
                            Text(CodingChatRules.WORKING, color = secondaryTint, fontSize = 12.sp)
                        }
                    }
                }

                if (CodingChatRules.showChangesBand(files, tests, place)) {
                    ChangesBand(
                        files = files,
                        tests = tests,
                        place = place,
                        onJump = { file -> reveal = file.rowId to file.path },
                    )
                }

                CodingChatFooter(
                    composing = composing,
                    botName = bot?.name ?: item.botName ?: CodingChatRules.BOT_FALLBACK,
                    canContinue = canContinue,
                    canStop = canStop,
                    stopping = stopping,
                    onContinue = { composing = true },
                    onCancelCompose = { composing = false },
                    onSend = { text ->
                        val id = threadId ?: return@CodingChatFooter
                        scope.launch {
                            val ok = session.sendCodingFollowUp(
                                botId = target.botId,
                                threadId = id,
                                text = text,
                                steer = live,
                            )
                            if (ok) {
                                composing = false
                                followUntil = System.currentTimeMillis() + CodingChatRules.FOLLOW_MS
                                reloadDetail(keepScreen = true)
                                reloadMessages()
                            } else {
                                throw IllegalStateException("send failed")
                            }
                        }
                    },
                    onStop = {
                        scope.launch {
                            stopping = true
                            try {
                                session.stopCodingTask(target.botId, target.itemId, detail)
                                delay(1_500)
                                reloadDetail(keepScreen = true)
                                reloadMessages()
                            } finally {
                                stopping = false
                            }
                        }
                    },
                    onClose = onDismiss,
                )
            }
        }
    }
}

@Composable
private fun CodingChatHeader(
    botName: String,
    botColor: String?,
    title: String,
    place: CodingPlace,
    status: BotActivityStatus,
    elapsed: String,
    onClose: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onClose) {
                Icon(Icons.Filled.Close, contentDescription = CodingChatRules.CLOSE)
            }
        }
        Row(
            modifier = Modifier
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                Modifier
                    .size(18.dp)
                    .clip(CircleShape)
                    .background(Color(MausPalette.argb(botColor ?: "blue"))),
            )
            Text(botName, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        }
        Text(
            title,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 420.dp),
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CodingChatRules.folderLine(place)?.let {
                Text(it, fontSize = 12.sp, color = secondaryTint, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            place.branch?.let {
                Text(it, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = secondaryTint, maxLines = 1)
            }
            Text(
                "${CodingChatRules.statusLabel(status)} · $elapsed",
                fontSize = 12.sp,
                color = secondaryTint,
            )
        }
    }
}

@Composable
private fun CodingChatRow(
    row: CodingRow,
    previous: CodingRow?,
    botName: String,
    revealPath: String?,
) {
    when (row) {
        is CodingRow.Line -> {
            val mine = row.message.role == "user"
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
            ) {
                Surface(
                    shape = RoundedCornerShape(18.dp),
                    color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
                    modifier = Modifier.widthIn(max = 520.dp),
                ) {
                    Text(
                        row.message.text.orEmpty(),
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }
        }
        is CodingRow.Reads -> {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            ) {
                if (row.running) {
                    CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
                }
                Text(CodingChatRules.READ, fontSize = 12.sp, color = secondaryTint)
                row.paths.forEach { path ->
                    Text(
                        path.substringAfterLast('/'),
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = secondaryTint,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
        }
        is CodingRow.Step -> when (val step = row.step) {
            is CodingStep.Command -> CodingTerminalView(step)
            is CodingStep.Edit -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                step.files.forEach { file ->
                    CodingDiffView(file, forceOpen = revealPath == file.path)
                }
                if (step.ok == false) {
                    Text(
                        step.error?.let(CodingChatRules::editFailedWhy) ?: CodingChatRules.EDIT_FAILED,
                        color = MaterialTheme.colorScheme.error,
                        fontSize = 12.sp,
                    )
                }
            }
            is CodingStep.Read -> { /* folded into Reads */ }
            is CodingStep.Tool -> Text(
                step.tool.summary ?: step.tool.name,
                fontSize = 12.sp,
                color = if (step.tool.ok == false) MaterialTheme.colorScheme.error else secondaryTint,
            )
        }
    }
}

@Composable
private fun CodingTerminalView(step: CodingStep.Command) {
    val running = step.ok == null
    val failed = step.ok == false
    var open by remember(step.id) { mutableStateOf(running || failed) }
    LaunchedEffect(failed) { if (failed) open = true }
    val output = step.output?.trimEnd()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, secondaryTint.copy(alpha = 0.18f), RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { open = !open }
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                if (open) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = secondaryTint,
                modifier = Modifier.size(16.dp),
            )
            Text(
                "$ ${step.command}",
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            step.tests?.let { TestCountsChip(it) }
            when {
                running -> CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 1.5.dp)
                failed -> Text(
                    step.exitCode?.let { "Exit $it" } ?: "Failed",
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 11.sp,
                )
                else -> Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Color(0xFF2E7D32), modifier = Modifier.size(14.dp))
            }
        }
        if (open) {
            HorizontalDivider(color = secondaryTint.copy(alpha = 0.12f))
            SelectionContainer {
                Text(
                    output ?: if (running) "Waiting for output" else "No output.",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    color = secondaryTint,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 280.dp)
                        .padding(12.dp),
                )
            }
            step.diff.orEmpty().forEach { CodingDiffView(it) }
        }
    }
}

@Composable
private fun CodingDiffView(file: DiffFile, forceOpen: Boolean = false) {
    val total = file.hunks.sumOf { it.lines.size }
    var open by remember(file.path) { mutableStateOf(total <= 400) }
    LaunchedEffect(forceOpen) { if (forceOpen) open = true }
    val name = file.path.substringAfterLast('/')
    val dir = file.path.removeSuffix(name)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, secondaryTint.copy(alpha = 0.18f), RoundedCornerShape(12.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { open = !open }
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                if (open) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = secondaryTint,
                modifier = Modifier.size(16.dp),
            )
            Text(
                buildString {
                    if (dir.isNotEmpty()) append(dir)
                    append(name)
                },
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (file.status != DiffFileStatus.MODIFIED) {
                Text(file.status.name.lowercase(), fontSize = 11.sp, color = secondaryTint)
            }
            Text(
                "+${file.added} -${file.removed}",
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
            )
        }
        if (open) {
            HorizontalDivider(color = secondaryTint.copy(alpha = 0.12f))
            Column(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(vertical = 4.dp),
            ) {
                file.hunks.flatMap { it.lines }.forEach { line ->
                    val tone = when (line.kind) {
                        DiffLineKind.ADD -> Color(0xFF2E7D32).copy(alpha = 0.12f)
                        DiffLineKind.DEL -> MaterialTheme.colorScheme.error.copy(alpha = 0.12f)
                        DiffLineKind.CTX -> Color.Transparent
                    }
                    val sign = when (line.kind) {
                        DiffLineKind.ADD -> "+"
                        DiffLineKind.DEL -> "-"
                        DiffLineKind.CTX -> " "
                    }
                    Text(
                        "$sign${line.text}",
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        modifier = Modifier
                            .background(tone)
                            .padding(horizontal = 12.dp, vertical = 1.dp),
                    )
                }
                if (file.hunks.all { it.lines.isEmpty() }) {
                    Text(
                        "No line changes to show for this file.",
                        fontSize = 12.sp,
                        color = secondaryTint,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun TestCountsChip(tests: TestSummary) {
    val failed = tests.failed > 0
    Text(
        buildString {
            append(if (tests.passed == 1) "1 passed" else "${tests.passed} passed")
            if (tests.failed > 0) append(" · ${tests.failed} failed")
            if (tests.skipped > 0) append(" · ${tests.skipped} skipped")
        },
        fontSize = 11.sp,
        color = if (failed) MaterialTheme.colorScheme.error else Color(0xFF2E7D32),
        modifier = Modifier
            .clip(CircleShape)
            .background(
                if (failed) MaterialTheme.colorScheme.error.copy(alpha = 0.12f)
                else Color(0xFF2E7D32).copy(alpha = 0.12f),
            )
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

@Composable
private fun ChangesBand(
    files: List<ChangedFile>,
    tests: TestSummary?,
    place: CodingPlace,
    onJump: (ChangedFile) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val added = files.sumOf { it.added }
    val removed = files.sumOf { it.removed }
    val uriHandler = LocalUriHandler.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(width = 1.dp, color = secondaryTint.copy(alpha = 0.12f))
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (files.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { open = !open }
                        .padding(horizontal = 4.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(
                        if (open) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowUp,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                    )
                    Text(CodingChatRules.changesFilesLabel(files.size), fontSize = 12.sp)
                    Text(
                        "+$added -$removed",
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                    )
                }
            } else {
                Text(CodingChatRules.CHANGES_NONE, fontSize = 12.sp, color = secondaryTint)
            }
            tests?.let { TestCountsChip(it) }
            Spacer(Modifier.weight(1f))
            place.branch?.let {
                Text(it, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = secondaryTint, maxLines = 1)
            }
            place.commit?.let { commit ->
                val label = CodingChatRules.shortSha(commit.sha)
                if (commit.url != null) {
                    Text(
                        label,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clickable { uriHandler.openUri(commit.url!!) },
                    )
                } else {
                    Text(label, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = secondaryTint)
                }
            }
            place.pull?.let { pull ->
                val label = CodingChatRules.pullLabel(pull.number)
                if (pull.url != null) {
                    Text(
                        label,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clickable { uriHandler.openUri(pull.url!!) },
                    )
                } else {
                    Text(label, fontSize = 11.sp, color = secondaryTint)
                }
            }
        }
        if (open && files.isNotEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .border(1.dp, secondaryTint.copy(alpha = 0.18f), RoundedCornerShape(12.dp))
                    .heightIn(max = 176.dp),
            ) {
                files.forEach { file ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onJump(file) }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            file.path,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "+${file.added} -${file.removed}",
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CodingChatFooter(
    composing: Boolean,
    botName: String,
    canContinue: Boolean,
    canStop: Boolean,
    stopping: Boolean,
    onContinue: () -> Unit,
    onCancelCompose: () -> Unit,
    onSend: suspend (String) -> Unit,
    onStop: () -> Unit,
    onClose: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (composing && canContinue) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(22.dp))
                    .border(1.dp, secondaryTint.copy(alpha = 0.25f), RoundedCornerShape(22.dp))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BasicTextField(
                    value = text,
                    onValueChange = { text = it; error = false },
                    modifier = Modifier.weight(1f),
                    textStyle = TextStyle(fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(
                        onSend = {
                            val words = text.trim()
                            if (words.isEmpty() || sending) return@KeyboardActions
                            scope.launch {
                                sending = true
                                try {
                                    onSend(words)
                                    text = ""
                                } catch (_: Throwable) {
                                    error = true
                                } finally {
                                    sending = false
                                }
                            }
                        },
                    ),
                    decorationBox = { inner ->
                        Box {
                            if (text.isEmpty()) {
                                Text(
                                    CodingChatRules.followUpPlaceholder(botName),
                                    color = secondaryTint,
                                    fontSize = 13.sp,
                                )
                            }
                            inner()
                        }
                    },
                )
                TextButton(
                    onClick = {
                        val words = text.trim()
                        if (words.isEmpty() || sending) return@TextButton
                        scope.launch {
                            sending = true
                            try {
                                onSend(words)
                                text = ""
                            } catch (_: Throwable) {
                                error = true
                            } finally {
                                sending = false
                            }
                        }
                    },
                    enabled = text.isNotBlank() && !sending,
                ) {
                    if (sending) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 1.5.dp)
                    else Text(CodingChatRules.SEND)
                }
            }
            if (error) {
                Text(CodingChatRules.FOLLOW_UP_ERROR, color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
            }
            TextButton(onClick = onCancelCompose) { Text("Cancel") }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (canContinue) {
                    TextButton(onClick = onContinue) { Text(CodingChatRules.CONTINUE) }
                }
                if (canStop) {
                    TextButton(onClick = onStop, enabled = !stopping) {
                        if (stopping) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 1.5.dp)
                        else Text(CodingChatRules.STOP, color = MaterialTheme.colorScheme.error)
                    }
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onClose) { Text(CodingChatRules.CLOSE) }
            }
        }
    }
}
