package com.openmausbot.companion.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Wire status from `shared/bot-activity-status.ts`. */
@Serializable
enum class BotActivityStatus {
    @SerialName("running") RUNNING,
    @SerialName("waiting") WAITING,
    @SerialName("queued") QUEUED,
    @SerialName("finished") FINISHED,
    @SerialName("failed") FAILED,
    @SerialName("stopped") STOPPED,
    @SerialName("blocked") BLOCKED,
}

/** Wire kind from `shared/bot-activity.ts`. */
@Serializable
enum class BotActivityKind {
    @SerialName("session") SESSION,
    @SerialName("routine") ROUTINE,
    @SerialName("hop") HOP,
    @SerialName("subagent") SUBAGENT,
}

@Serializable
enum class BotActivityActorKind {
    @SerialName("person") PERSON,
    @SerialName("bot") BOT,
    @SerialName("routine") ROUTINE,
}

@Serializable
data class BotActivityActor(
    val kind: BotActivityActorKind = BotActivityActorKind.PERSON,
    val name: String = "",
)

@Serializable
enum class BotCodePullAction {
    @SerialName("opened") OPENED,
    @SerialName("merged") MERGED,
    @SerialName("closed") CLOSED,
    @SerialName("updated") UPDATED,
}

@Serializable
data class BotCodePullRequest(
    val repo: String? = null,
    val number: Int? = null,
    val title: String? = null,
    val url: String? = null,
    val action: BotCodePullAction = BotCodePullAction.OPENED,
    val branch: String? = null,
    val at: Double = 0.0,
)

@Serializable
data class BotCodeBranch(
    val name: String = "",
    val repo: String? = null,
    val pushed: Boolean = false,
    val url: String? = null,
    val at: Double = 0.0,
)

@Serializable
data class BotCodeCommit(
    val sha: String = "",
    val message: String? = null,
    val branch: String? = null,
    val repo: String? = null,
    val pushed: Boolean = false,
    val url: String? = null,
    val at: Double = 0.0,
)

/** Repository work of a coding conversation (`BotCodeWork`). */
@Serializable
data class BotCodeWork(
    val folder: String? = null,
    val branch: String? = null,
    val repo: String? = null,
    val repoUrl: String? = null,
    val pullRequests: List<BotCodePullRequest> = emptyList(),
    val branches: List<BotCodeBranch> = emptyList(),
    val commits: List<BotCodeCommit> = emptyList(),
)

@Serializable
data class BotActivityEngine(
    val instanceId: String = "",
    val model: String = "",
)

/** One entry of GET /api/bots/:id/activity. */
@Serializable
data class BotActivityItem(
    val id: String,
    val kind: BotActivityKind = BotActivityKind.SESSION,
    val botId: String = "",
    val botName: String? = null,
    val title: String = "",
    val threadTitle: String? = null,
    val retry: Boolean? = null,
    val status: BotActivityStatus = BotActivityStatus.FINISHED,
    val startedAt: Double = 0.0,
    val endedAt: Double? = null,
    val updatedAt: Double = 0.0,
    val threadId: String? = null,
    val startedBy: BotActivityActor? = null,
    val childCount: Int? = null,
    val coding: Boolean? = null,
    val currentStep: String? = null,
    val canStop: Boolean? = null,
    val parentId: String? = null,
    val parallel: Boolean? = null,
    val code: BotCodeWork? = null,
    val engine: BotActivityEngine? = null,
)

@Serializable
data class BotLaunchedAgentPullRequest(
    val number: Int = 0,
    val url: String? = null,
)

@Serializable
data class BotLaunchedAgentItem(
    val id: String = "",
    val targetBotId: String = "",
    val targetBotName: String = "",
    val title: String = "",
    val status: BotActivityStatus = BotActivityStatus.FINISHED,
    val startedAt: Double = 0.0,
    val updatedAt: Double = 0.0,
    val threadId: String? = null,
    val pullRequest: BotLaunchedAgentPullRequest? = null,
)

/** GET /api/bots/:id/activity. */
@Serializable
data class BotActivityList(
    val items: List<BotActivityItem> = emptyList(),
    val subagents: List<BotActivityItem> = emptyList(),
    val launchedAgents: List<BotLaunchedAgentItem> = emptyList(),
)

@Serializable
enum class BotActivityWhere {
    @SerialName("computer") COMPUTER,
    @SerialName("server") SERVER,
}

@Serializable
data class BotActivitySubagentInfo(
    val description: String? = null,
    val prompt: String? = null,
    val type: String? = null,
    val result: String? = null,
)

@Serializable
data class BotActivityStep(
    val id: String = "",
    val name: String = "",
    val summary: String? = null,
    val ok: Boolean? = null,
    val at: Double = 0.0,
    val where: BotActivityWhere? = null,
    val files: List<String>? = null,
    val input: String? = null,
    val error: String? = null,
    val parentId: String? = null,
    val subagent: BotActivitySubagentInfo? = null,
)

@Serializable
enum class BotActivityVia {
    @SerialName("subscription") SUBSCRIPTION,
    @SerialName("owner-key") OWNER_KEY,
    @SerialName("speaker-key") SPEAKER_KEY,
    @SerialName("server") SERVER,
    @SerialName("org-key") ORG_KEY,
}

/**
 * GET /api/bots/:id/activity/item body: flat item fields plus detail fields
 * (`shared/bot-activity.ts` `BotActivityDetail`).
 */
@Serializable
data class BotActivityDetail(
    val id: String = "",
    val kind: BotActivityKind = BotActivityKind.SESSION,
    val botId: String = "",
    val botName: String? = null,
    val title: String = "",
    val threadTitle: String? = null,
    val retry: Boolean? = null,
    val status: BotActivityStatus = BotActivityStatus.FINISHED,
    val startedAt: Double = 0.0,
    val endedAt: Double? = null,
    val updatedAt: Double = 0.0,
    val threadId: String? = null,
    val startedBy: BotActivityActor? = null,
    val childCount: Int? = null,
    val coding: Boolean? = null,
    val currentStep: String? = null,
    val parentId: String? = null,
    val parallel: Boolean? = null,
    val code: BotCodeWork? = null,
    val engine: BotActivityEngine? = null,
    val via: BotActivityVia? = null,
    val payer: String? = null,
    val steps: List<BotActivityStep> = emptyList(),
    val stepsTruncated: Boolean = false,
    val files: List<String> = emptyList(),
    val children: List<BotActivityItem> = emptyList(),
    val note: String? = null,
    val canStop: Boolean = false,
) {
    fun asItem(): BotActivityItem = BotActivityItem(
        id = id,
        kind = kind,
        botId = botId,
        botName = botName,
        title = title,
        threadTitle = threadTitle,
        retry = retry,
        status = status,
        startedAt = startedAt,
        endedAt = endedAt,
        updatedAt = updatedAt,
        threadId = threadId,
        startedBy = startedBy,
        childCount = childCount,
        coding = coding,
        currentStep = currentStep,
        canStop = canStop,
        parentId = parentId,
        parallel = parallel,
        code = code,
        engine = engine,
    )
}

@Serializable
internal data class BotActivityDetailResponse(
    val item: BotActivityDetail,
)

/** running, waiting and queued are live (`activityStatusActive`). */
fun activityStatusActive(status: BotActivityStatus): Boolean =
    status == BotActivityStatus.RUNNING ||
        status == BotActivityStatus.WAITING ||
        status == BotActivityStatus.QUEUED

/**
 * "45s", "12m", "1h 05m" (`formatActivityDuration`).
 * [milliseconds] may be NaN or huge; those clamp to 0.
 */
fun formatActivityDuration(milliseconds: Double): String {
    val seconds = if (milliseconds.isFinite()) {
        minOf(maxOf(0.0, kotlin.math.round(milliseconds / 1000.0)), 1e9).toInt()
    } else {
        0
    }
    if (seconds < 60) return "${seconds}s"
    val minutes = seconds / 60
    if (minutes < 60) return "${minutes}m"
    return "${minutes / 60}h ${"%02d".format(minutes % 60)}m"
}

/**
 * Title as shown: a retried request says so ("Retry · ...").
 * [retryWord] is the localized "Retry"; English default matches desktop.
 */
fun activityTitle(title: String, retry: Boolean? = null, retryWord: String = "Retry"): String =
    if (retry == true) "$retryWord · $title" else title

fun activityTitle(item: BotActivityItem, retryWord: String = "Retry"): String =
    activityTitle(item.title, item.retry, retryWord)

fun activityTitle(detail: BotActivityDetail, retryWord: String = "Retry"): String =
    activityTitle(detail.title, detail.retry, retryWord)

/** Query ids from a coding-chat / activity list id (`thread:X`, `run:X`, `cloud:X`). */
data class CodingChatItemIds(
    val threadId: String? = null,
    val runId: String? = null,
    val cloudId: String? = null,
)

fun codingChatItemIds(itemId: String): CodingChatItemIds {
    val idx = itemId.indexOf(':')
    val kind = if (idx >= 0) itemId.substring(0, idx) else ""
    val id = if (idx >= 0) itemId.substring(idx + 1) else itemId
    return when (kind) {
        "run" -> CodingChatItemIds(runId = id)
        "cloud" -> CodingChatItemIds(cloudId = id)
        else -> CodingChatItemIds(threadId = id)
    }
}
