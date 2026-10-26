// The transcript's interactive cards and per-message fields the renderer
// draws and older phone builds decoded as `unknown` or dropped.
//
// Each type mirrors one TypeScript shape, named in its comment, and keeps
// every enum-like field as its raw string with a computed Swift value beside
// it: the computer gains states on its own schedule, and a card with a state
// this build has never heard of must still decode and still read as itself.
import Foundation

// MARK: - Access card (`kind: "access"`)

/// `WireAccessCard` in `shared/wire.ts`: a turn that could not run for lack
/// of engine access on an organization server. Never provider text, except
/// `detail` on `key_refused`.
public struct AccessCard: Codable, Hashable, Sendable {
    public enum Reason: String, Sendable {
        case engineMissing = "engine_missing"
        case noAccess = "no_access"
        case keyRefused = "key_refused"
        case routineDelegation = "routine_delegation"
    }

    public var reason: String
    /// The engine's display name, e.g. Claude ("" for routine_delegation).
    public var engine: String
    public var botId: String
    public var ownerPrincipalId: String
    public var detail: String?
    public var keysUrl: String?
    public var payer: String?
    public var payerPrincipalId: String?
    public var cause: String?
    public var routine: Bool?
    public var subscriptionSignIn: Bool?
    public var runAsPrincipalId: String?
    public var runAsName: String?
    public var routineId: String?
    public var routineName: String?
    public var suspendReason: String?

    public init(reason: String, engine: String, botId: String, ownerPrincipalId: String, detail: String? = nil) {
        self.reason = reason
        self.engine = engine
        self.botId = botId
        self.ownerPrincipalId = ownerPrincipalId
        self.detail = detail
    }

    public var kind: Reason? { Reason(rawValue: reason) }
}

// MARK: - Goal run card (`kind: "goal.run"`)

/// `GroupGoalRunCardData` in `shared/group-goal-run.ts`: the receipt of a
/// bounded multi-bot room goal.
public struct GoalRunCard: Codable, Hashable, Sendable {
    public enum Status: String, Sendable {
        case working, completed, paused, stopped, failed, blocked
        case needsInput = "needs-input"
        case limitReached = "limit-reached"
    }

    public var runId: String
    public var goal: String
    public var status: String
    public var coordinatorBotId: String
    public var coordinatorName: String
    public var turnCount: Int
    public var maxTurns: Int
    public var detail: String?
    public var startedAt: Double
    public var finishedAt: Double?

    public init(
        runId: String, goal: String, status: String, coordinatorBotId: String, coordinatorName: String,
        turnCount: Int, maxTurns: Int, detail: String? = nil, startedAt: Double, finishedAt: Double? = nil
    ) {
        self.runId = runId
        self.goal = goal
        self.status = status
        self.coordinatorBotId = coordinatorBotId
        self.coordinatorName = coordinatorName
        self.turnCount = turnCount
        self.maxTurns = maxTurns
        self.detail = detail
        self.startedAt = startedAt
        self.finishedAt = finishedAt
    }

    public var state: Status? { Status(rawValue: status) }
    public var isRunning: Bool { state == .working }
}

// MARK: - Parallel tasks

/// `ParallelTaskRef` in `shared/parallel-tasks.ts`: on a conversation's
/// messages, the request line, the live task card and the result reply all
/// name the task they belong to.
public struct ParallelTaskRef: Codable, Hashable, Sendable {
    public enum Role: String, Sendable { case request, card, result }
    public enum State: String, Sendable { case queued, running, done, failed, stopped }

    /// The task's own thread (same bot).
    public var threadId: String
    public var title: String
    public var requestMessageId: String
    /// Raw; see `part`.
    public var role: String
    /// On the card only: the last state the server recorded. While the task
    /// runs, the live state is the task's own busy/activity.
    public var state: String?
    public var startedAt: Double?
    public var endedAt: Double?

    public init(
        threadId: String, title: String, requestMessageId: String, role: String,
        state: String? = nil, startedAt: Double? = nil, endedAt: Double? = nil
    ) {
        self.threadId = threadId
        self.title = title
        self.requestMessageId = requestMessageId
        self.role = role
        self.state = state
        self.startedAt = startedAt
        self.endedAt = endedAt
    }

    public var part: Role? { Role(rawValue: role) }
    public var recordedState: State? { state.flatMap(State.init(rawValue:)) }
    public var isCard: Bool { part == .card }
}

/// `TaskParallelOf` in `shared/parallel-tasks.ts`: on a task opened as a
/// parallel task, the conversation it answers.
public struct TaskParallelOf: Codable, Hashable, Sendable {
    public var threadId: String
    public var messageId: String
    public var cardMessageId: String?
    public var at: Double
    public var principalId: String?
    public var reportedAt: Double?
    public var outcome: String?
    public var byBot: Bool?
}

/// What a send does while the bot is already working (`BusySendMode`).
public enum BusySendMode: String, Codable, CaseIterable, Hashable, Sendable {
    /// Join the running turn (the default; queued when the engine cannot).
    case steer
    /// Run as its own task, in parallel.
    case parallel
    /// Wait for the running turn, then run.
    case after
    /// The bot decides (JC 2026-10-18, server/busy-routing.ts): joins the
    /// running turn, runs as a parallel task or waits for it. Sent as
    /// `routeWhileBusy: true`, which an older server ignores (steer).
    case auto
}

// MARK: - Per-message attribution

/// `ResolvedSender` in `shared/wire.ts`: which signed-in person sent a user
/// line on a shared workspace. Attribution only.
public struct MessageAuthor: Codable, Hashable, Sendable {
    public var name: String
    public var id: String?
}

/// `WireMessage.peerAsk`: a user-role line another bot delivered here.
public struct PeerAsk: Codable, Hashable, Sendable {
    public var botId: String
    public var name: String
    public var unattended: Bool?
}

/// `WireMessage.peerPost`: a room line a bot pushed in with post_to_room.
public struct PeerPost: Codable, Hashable, Sendable {
    public var unattended: Bool?
}

/// `WireMessage.routedBy`: an Auto room's decision model picked this speaker.
public struct RoutedBy: Codable, Hashable, Sendable {
    public var provider: String
    public var probability: Double
}

/// The renderer's `Message.state`: a card projected for someone who is not
/// its approval audience (`OwnerWait.tsx`).
public enum OwnerWaitState: String, Sendable {
    case waitingOnOwner = "waiting-on-owner"
    case ownerSettled = "owner-settled"
}

// MARK: - Usage

/// `TaskUsage` in `shared/wire.ts`: what a thread has spent.
public struct TaskUsage: Codable, Hashable, Sendable {
    public struct Turn: Codable, Hashable, Sendable {
        public var input: Int
        public var output: Int
        public var cachedInput: Int?
        public var costUsd: Double?
    }

    public struct Context: Codable, Hashable, Sendable {
        public var tokens: Int
        public var window: Int?
    }

    public var input: Int
    public var output: Int
    public var cachedInput: Int?
    public var costUsd: Double?
    public var turns: Int
    public var lastTurn: Turn?
    public var context: Context?
}
