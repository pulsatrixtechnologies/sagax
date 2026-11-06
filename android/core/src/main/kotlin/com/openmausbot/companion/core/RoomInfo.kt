package com.openmausbot.companion.core

import kotlin.math.max
import kotlin.math.round
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// MARK: - Who is looking

/** The person the room logic judges, from the signed-in session. */
data class RoomViewer(
    val principalId: String? = null,
    val email: String? = null,
    /** Organization role: "owner", "admin" or "member"; null when unknown. */
    val role: String? = null,
) {
    /** The id the viewer's bots and room seats carry: the principal, else
     * the sign-in email, else "local-owner". */
    val actorId: String
        get() {
            norm(principalId)?.takeIf { it.isNotEmpty() }?.let { return it }
            norm(email)?.takeIf { it.isNotEmpty() }?.let { return it }
            return "local-owner"
        }

    val normalizedEmail: String?
        get() = norm(email)?.takeIf { it.isNotEmpty() }

    /** Organization admin, or the server's owner. */
    val isOrgAdmin: Boolean
        get() = role == "admin" || role == "owner"

    companion object {
        fun norm(value: String?): String? =
            value?.trim()?.lowercase()

        /** iOS `RoomViewer(account:)`: the signed-in session names the person. */
        fun from(account: AuthSession?): RoomViewer = RoomViewer(
            principalId = account?.principalId,
            email = account?.email,
            role = account?.role,
        )
    }
}

// MARK: - Pairing flags (Android has no SurfaceGate)

/** What this pairing lets the room sheet offer. Callers fill the allows*
 * flags from their pairing scope; [sidecar] defaults false. */
data class GateFlags(
    val organization: Boolean = false,
    val allowsRoomManagement: Boolean = false,
    val allowsRoomMemory: Boolean = false,
    val allowsRoomDelete: Boolean = false,
    val sidecar: Boolean = false,
)

// MARK: - Ownership

object RoomOwnership {
    /** Whether the viewer may change this room's settings. A solo server
     * sends no owner (everyone who may manage rooms owns them); on an
     * organization server a room without an owner is its admins'. */
    fun owns(room: Room, viewer: RoomViewer, organization: Boolean): Boolean {
        val raw = room.ownerId ?: return if (organization) viewer.isOrgAdmin else true
        val owner = RoomViewer.norm(raw).orEmpty()
        return owner == viewer.actorId || viewer.normalizedEmail == owner
    }

    /** The owner deletes a room; an organization admin may too. */
    fun mayDelete(room: Room, viewer: RoomViewer, organization: Boolean): Boolean =
        owns(room, viewer, organization) || (organization && viewer.isOrgAdmin)

    /** Whether the viewer is one of the room's people (and so may leave it). */
    fun isListed(room: Room, viewer: RoomViewer): Boolean =
        (room.humanIds ?: emptyList()).any { isViewer(it, viewer) }

    /** Listed in their own name, or the recorded owner. #2119: the sole
     * remaining person cannot leave (bots and teams do not count); Delete
     * is offered instead. */
    fun mayLeave(room: Room, viewer: RoomViewer): Boolean {
        val listed = when {
            isListed(room, viewer) -> true
            else -> {
                val owner = RoomViewer.norm(room.ownerId)?.takeIf { it.isNotEmpty() } ?: return false
                owner == viewer.actorId || viewer.normalizedEmail == owner
            }
        }
        if (!listed) return false
        return leaveOutcome(room, viewer) != LeaveOutcome.LAST
    }

    /** LAST means leave is refused (#2119). */
    enum class LeaveOutcome { MEMBER, OWNER, LAST }

    fun leaveOutcome(room: Room, viewer: RoomViewer): LeaveOutcome {
        val others = humanIdsLeaving(room, viewer).filter { id ->
            val normalized = RoomViewer.norm(id).orEmpty()
            normalized.isNotEmpty() && !normalized.startsWith("team:")
        }
        if (others.isEmpty()) return LeaveOutcome.LAST
        val owner = RoomViewer.norm(room.ownerId) ?: return LeaveOutcome.MEMBER
        return if (owner == viewer.actorId || viewer.normalizedEmail == owner) {
            LeaveOutcome.OWNER
        } else {
            LeaveOutcome.MEMBER
        }
    }

    fun humanIdsLeaving(room: Room, viewer: RoomViewer): List<String> =
        (room.humanIds ?: emptyList()).filter { !isViewer(it, viewer) }

    fun humanIdsAdding(id: String, to: Room): List<String> {
        val seen = mutableSetOf<String>()
        return ((to.humanIds ?: emptyList()) + id)
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() && seen.add(it) }
    }

    fun humanIdsRemoving(id: String, from: Room): List<String> {
        val target = RoomViewer.norm(id)
        return (from.humanIds ?: emptyList()).filter { RoomViewer.norm(it) != target }
    }

    /** Existing members keep their order; additions land at the end. */
    fun nextMemberIds(current: List<String>, picked: Set<String>, order: List<String>): List<String> =
        current.filter { it in picked } + order.filter { it in picked && it !in current }

    /** Bots the viewer owns. */
    fun ownBotIds(bots: List<Bot>, viewer: RoomViewer): Set<String> {
        val actor = viewer.actorId
        if (actor.isEmpty()) return emptySet()
        return bots
            .filter { RoomViewer.norm(it.ownerUserId).orEmpty() == actor }
            .map { it.id }
            .toSet()
    }

    fun nextHumanIds(current: List<String>, picked: Set<String>, added: List<String>): List<String> {
        val seen = mutableSetOf<String>()
        return (current + added)
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() && it in picked && seen.add(it) }
    }

    /** Bots the viewer may tick in the roster. The owner picks among every
     * bot; anyone else only their own. An archived bot stays while a member. */
    fun rosterBotChoices(room: Room, bots: List<Bot>, viewer: RoomViewer, owns: Boolean): List<Bot> {
        val own = ownBotIds(bots, viewer)
        return bots.filter { bot ->
            if (bot.hidden == true && bot.id !in room.memberIds) return@filter false
            owns || bot.id in own
        }
    }

    /** The first of the viewer's bots not yet in the room. */
    fun ownBotToAdd(room: Room, bots: List<Bot>, viewer: RoomViewer): Bot? {
        val own = ownBotIds(bots, viewer)
        return bots.firstOrNull { it.id in own && it.id !in room.memberIds }
    }

    private fun isViewer(id: String, viewer: RoomViewer): Boolean {
        val entry = RoomViewer.norm(id).orEmpty()
        return entry == viewer.actorId || viewer.normalizedEmail == entry
    }
}

// MARK: - What the Room info sheet offers

/** The desktop panel's decisions for one room and one pairing. */
data class RoomInfoAccess(
    val manages: Boolean,
    val owns: Boolean,
    val memory: Boolean,
    val canLeave: Boolean,
    val canDelete: Boolean,
    val canMoveSection: Boolean,
    val canAddHuman: Boolean,
    val canAddOwnBot: Boolean,
    val canAddBot: Boolean,
    val canManageRoster: Boolean,
    val removableBotIds: Set<String>,
    val organization: Boolean,
) {
    val editable: Boolean get() = manages && owns
    val readOnlyNote: Boolean get() = manages && !owns
    val canRemoveHumans: Boolean get() = editable

    companion object {
        operator fun invoke(
            room: Room,
            gate: GateFlags,
            viewer: RoomViewer,
            bots: List<Bot>,
        ): RoomInfoAccess {
            val organization = gate.organization
            val teamRoom = room.dm != true && room.peopleDm != true
            val manages = gate.allowsRoomManagement && teamRoom
            val owns = RoomOwnership.owns(room, viewer, organization)
            val own = RoomOwnership.ownBotIds(bots, viewer)
            val canAddHuman = manages && owns && (if (organization) viewer.role != null else true)
            val canAddOwnBot = manages && RoomOwnership.ownBotToAdd(room, bots, viewer) != null
            val canAddBot = manages && RoomOwnership.rosterBotChoices(room, bots, viewer, owns)
                .any { it.id !in room.memberIds }
            return RoomInfoAccess(
                manages = manages,
                owns = owns,
                memory = gate.allowsRoomMemory && teamRoom,
                canLeave = manages && organization && RoomOwnership.mayLeave(room, viewer),
                canDelete = gate.allowsRoomDelete && room.peopleDm != true &&
                    RoomOwnership.mayDelete(room, viewer, organization),
                canMoveSection = manages && !organization,
                canAddHuman = canAddHuman,
                canAddOwnBot = canAddOwnBot,
                canAddBot = canAddBot,
                canManageRoster = manages && (owns || canAddHuman || own.isNotEmpty()),
                removableBotIds = if (manages) {
                    room.memberIds.filter { owns || it in own }.toSet()
                } else {
                    emptySet()
                },
                organization = organization,
            )
        }
    }
}

// MARK: - Who answers

object RoomResponder {
    /** A lead that left falls back to the first member; an Auto room keeps
     * its fallback while that bot is still in. */
    fun effective(room: Room): GroupResponder =
        effectiveDefaultResponder(room.defaultResponder, room.memberIds)

    sealed class Choice {
        data class Lead(val botId: String) : Choice()
        data object Auto : Choice()
        data object Everyone : Choice()
        data object Mentions : Choice()
    }

    fun choice(room: Room): Choice {
        val value = effective(room)
        return when (value.kind) {
            "everyone" -> Choice.Everyone
            "mentions" -> Choice.Mentions
            "auto" -> Choice.Auto
            else -> Choice.Lead(value.botId.orEmpty())
        }
    }

    /** The value sent for a choice. The lead a room had stays on as Auto's
     * fallback. */
    fun value(forChoice: Choice, inRoom: Room): GroupResponder = when (forChoice) {
        Choice.Everyone -> GroupResponder(kind = "everyone")
        Choice.Mentions -> GroupResponder(kind = "mentions")
        is Choice.Lead -> GroupResponder(kind = "member", botId = forChoice.botId)
        Choice.Auto -> {
            val current = effective(inRoom)
            if (current.kind == "member" && current.botId != null) {
                GroupResponder(kind = "auto", fallbackBotId = current.botId)
            } else {
                GroupResponder(kind = "auto")
            }
        }
    }

    /** The bot that answers a plain message: the lead, or an Auto room's
     * fallback (else the first member). */
    fun answeringBotId(room: Room): String? {
        val value = effective(room)
        if (value.kind == "auto") return value.fallbackBotId ?: room.memberIds.firstOrNull()
        return if (value.kind == "member") value.botId else null
    }
}

// MARK: - Group memory

/** How much of a memory file loads each turn. */
@Serializable
data class MemoryCapacity(
    val lines: Int,
    val bytes: Int,
    val maxLines: Int,
    val maxBytes: Int,
    val loadedLines: Int,
    val loadedBytes: Int,
    val truncated: Boolean,
) {
    enum class Level { OK, NEAR, OVER }

    @Transient
    val lineShare: Double = if (maxLines > 0) lines.toDouble() / maxLines else 0.0

    @Transient
    val byteShare: Double = if (maxBytes > 0) bytes.toDouble() / maxBytes else 0.0

    /** Over when the file is cut, near from 80 %. */
    val level: Level
        get() {
            if (truncated) return Level.OVER
            return if (max(lineShare, byteShare) >= 0.8) Level.NEAR else Level.OK
        }

    /** Lines the turn does not load (positive only when cut by lines). */
    val missingLines: Int
        get() = if (truncated) lines - loadedLines else 0

    companion object {
        /** "512 B", "3.4 KB". */
        fun formatBytes(bytes: Int): String {
            if (bytes < 1024) return "$bytes B"
            val tenths = round(bytes / 102.4) / 10.0
            return if (tenths == tenths.toInt().toDouble()) {
                "${tenths.toInt()} KB"
            } else {
                "$tenths KB"
            }
        }
    }
}

/** What GET /api/groups/:id/memory answers. */
@Serializable
data class GroupMemoryView(
    val enabled: Boolean,
    val canEdit: Boolean,
    val text: String,
    val hash: String,
    val capacity: MemoryCapacity,
)

/** A bot changed the memory while the person edited it: nothing was saved. */
class GroupMemoryConflict : Exception("Group memory changed on the computer")

// MARK: - Room patch

/** One room write. Only the fields set are sent. */
data class RoomPatch(
    val name: String? = null,
    val bulletin: String? = null,
    val section: String? = null,
    val memberIds: List<String>? = null,
    val humanIds: List<String>? = null,
    val defaultResponder: GroupResponder? = null,
) {
    fun toJsonObject(): JsonObject = buildJsonObject {
        name?.let { put("name", it) }
        bulletin?.let { put("bulletin", it) }
        section?.let { put("section", it) }
        memberIds?.let { ids -> put("memberIds", JsonArray(ids.map(::JsonPrimitive))) }
        humanIds?.let { ids -> put("humanIds", JsonArray(ids.map(::JsonPrimitive))) }
        defaultResponder?.let { responder ->
            put(
                "defaultResponder",
                buildJsonObject {
                    put("kind", responder.kind)
                    responder.botId?.let { put("botId", it) }
                    responder.fallbackBotId?.let { put("fallbackBotId", it) }
                },
            )
        }
    }

    companion object {
        /** A trimmed, non-empty name of at most 100 characters that differs
         * from the current one; null when there is nothing to save. */
        fun rename(current: String, to: String): String? {
            val name = to.trim().take(100)
            return if (name.isEmpty() || name == current) null else name
        }
    }
}
