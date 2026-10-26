// The SSE frames the harness broadcasts, as one enum.
//
// Every frame is `{ "kind": …, "seq": n, … }` with a payload keyed by kind
// (see `broadcast` in server/index.ts). Decoding switches on `kind`, and —
// this is the important part — an unrecognised kind decodes to `.unknown`
// rather than throwing. The harness gains frame kinds over time, and a
// phone from last month must keep folding the ones it does understand
// instead of tearing down its stream over one it does not.
import Foundation

public struct NotificationFrame: Codable, Hashable, Sendable {
    /// approval · question · done · routine-failed
    public var kind: String
    public var botId: String
    public var botName: String
    public var threadId: String
    public var title: String
    public var body: String
    /// A person's message or a tag in a room: the conversation (#262, #274).
    public var groupId: String? = nil
    /// The approval this banner can answer. Absent on older servers.
    public var requestId: String? = nil
    /// Allow from the banner must open Sagax for the person's security key.
    public var needsKey: Bool? = nil
    /// A finished routine, so the banner can name it.
    public var routineRunId: String? = nil
    public var routineName: String? = nil

    /// A bot blocked on you, as opposed to one reporting in.
    public var isBlocking: Bool { kind == "approval" || kind == "question" }
}

/// A canonical runtime event. The server has already folded these into
/// messages, so a client only needs them for token-by-token streaming.
public struct RuntimeEvent: Codable, Hashable, Sendable {
    public var type: String
    public var threadId: String
    /// content.delta only
    public var delta: String?
    public var streamKind: String?
}

public enum Frame: Sendable {
    /// First frame on every connection. `resumed` is the server saying
    /// whether it could replay the gap; false means hydrate.
    case hello(cursor: String, resumed: Bool)
    case message(threadId: String, message: Message)
    case messagePatch(threadId: String, message: Message)
    /// A branch switch: which leaf of the conversation is now visible.
    case thread(threadId: String, activeLeafId: String?)
    case bot(Bot)
    case botDeleted(botId: String)
    /// Held sends for the whole fleet, keyed by thread. The server owns
    /// this queue; the frame replaces the phone's copy wholesale.
    case botQueued(queues: [String: [QueuedSend]])
    case room(Room)
    case roomDeleted(groupId: String)
    /// Something worth interrupting for.
    case notify(NotificationFrame)
    /// A live frame of a bot's computer (base64). Only sent to clients that
    /// did not pass `screens=off`.
    case screen(botId: String, png: String, mime: String)
    /// The bot's cloud computer is being provisioned.
    case computer(botId: String, state: String)
    case config
    case runtime(RuntimeEvent)
    /// The desktop shakes. The phone only needs a light haptic.
    /// A nudge addressed to this person (#164, #222): who, when, and the
    /// conversation its line went to.
    case nudge(NudgeFrame)
    /// `person.label` (#172): a person's label changed; nil cleared it.
    case personLabel(principalId: String, label: String?)
    /// `presence.changed` (#167); `audience` marks the viewer's own row.
    case presenceChanged(audience: String?, people: [PresenceRow])
    /// `org.approvals` (#213): the count of commands waiting for an admin,
    /// and the ones that just arrived. Reaches organization admins only.
    case orgApprovals(OrgApprovalsFrame)
    /// `preferences`: the person's whole record after a save on any of
    /// their devices (organization server; their own streams only), so a
    /// section deleted on the desktop leaves the phone within seconds.
    case preferences(UserPreferences)
    /// `thread.read` (#270): a participant's read position moved, or reset.
    case threadRead(ThreadReadFrame)
    /// `voice.call.ended`: the person or the bot hung up this call.
    /// The phone leaves the call after a goodbye finishes.
    case voiceCallEnded(threadId: String, callId: String, by: String)
    case unknown(kind: String)
}

extension Notification.Name {
    /// The server ended a live voice call (`voice.call.ended`).
    public static let sagaxVoiceCallEnded = Notification.Name("ca.pulsatrix.sagax.voiceCallEnded")
}

extension Frame: Decodable {
    private enum CodingKeys: String, CodingKey {
        case kind, cursor, resumed, threadId, message, activeLeafId
        case bot, botId, group, groupId, notification, png, mime, state, event, queues
        case audience, fromId, fromName, at, open, principalId, label, people, count, added
        case preferences, updatedAt
        case participantId, read, reset
        case callId, by
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)

        switch kind {
        case "hello":
            self = .hello(
                cursor: try container.decode(String.self, forKey: .cursor),
                resumed: try container.decodeIfPresent(Bool.self, forKey: .resumed) ?? false
            )
        case "message":
            self = .message(
                threadId: try container.decode(String.self, forKey: .threadId),
                message: try container.decode(Message.self, forKey: .message)
            )
        case "message.patch":
            self = .messagePatch(
                threadId: try container.decode(String.self, forKey: .threadId),
                message: try container.decode(Message.self, forKey: .message)
            )
        case "thread":
            self = .thread(
                threadId: try container.decode(String.self, forKey: .threadId),
                activeLeafId: try container.decodeIfPresent(String.self, forKey: .activeLeafId)
            )
        case "bot":
            self = .bot(try container.decode(Bot.self, forKey: .bot))
        case "bot.deleted":
            self = .botDeleted(botId: try container.decode(String.self, forKey: .botId))
        case "bot.queued":
            // Defensive by design: a queues dictionary this build cannot
            // read is a broken frame, not the server saying the queue is
            // empty — reading it as one would retire every held-send row on
            // a glitch. Ignore it; the next frame or fleet snapshot restates
            // the truth. Bad entries inside a readable list still drop out
            // one by one.
            if let decoded = try? container.decode([String: [Lossy<QueuedSend>]].self, forKey: .queues) {
                self = .botQueued(queues: decoded.mapValues { list in
                    list.compactMap(\.value)
                })
            } else {
                self = .unknown(kind: kind)
            }
        case "group":
            self = .room(try container.decode(Room.self, forKey: .group))
        case "group.deleted":
            self = .roomDeleted(groupId: try container.decode(String.self, forKey: .groupId))
        case "notify":
            self = .notify(try container.decode(NotificationFrame.self, forKey: .notification))
        case "screen":
            self = .screen(
                botId: try container.decode(String.self, forKey: .botId),
                png: try container.decode(String.self, forKey: .png),
                mime: try container.decodeIfPresent(String.self, forKey: .mime) ?? "image/png"
            )
        case "computer":
            self = .computer(
                botId: try container.decode(String.self, forKey: .botId),
                state: try container.decodeIfPresent(String.self, forKey: .state) ?? ""
            )
        case "config":
            self = .config
        case "nudge":
            let open = try? container.decodeIfPresent(NudgeFrame.Conversation.self, forKey: .open)
            self = .nudge(NudgeFrame(
                fromId: (try? container.decodeIfPresent(String.self, forKey: .fromId)) ?? "",
                fromName: (try? container.decodeIfPresent(String.self, forKey: .fromName)) ?? "",
                at: try? container.decodeIfPresent(Double.self, forKey: .at),
                open: open
            ))
        case "person.label":
            guard let id = try? container.decode(String.self, forKey: .principalId) else {
                self = .unknown(kind: kind)
                return
            }
            self = .personLabel(principalId: id, label: try? container.decodeIfPresent(String.self, forKey: .label))
        case "presence.changed":
            let rows = (try? container.decodeIfPresent([Lossy<PresenceRow>].self, forKey: .people))?.compactMap(\.value) ?? []
            self = .presenceChanged(audience: try? container.decodeIfPresent(String.self, forKey: .audience), people: rows)
        case "org.approvals":
            self = .orgApprovals(OrgApprovalsFrame(
                count: (try? container.decodeIfPresent(Int.self, forKey: .count)) ?? 0,
                added: (try? container.decodeIfPresent([Lossy<OrgApprovalsFrame.Arrival>].self, forKey: .added))?.compactMap(\.value) ?? []
            ))
        case "preferences":
            guard let values = try? container.decode([String: String].self, forKey: .preferences) else {
                self = .unknown(kind: kind)
                return
            }
            self = .preferences(UserPreferences(stored: true, preferences: values, updatedAt: try? container.decodeIfPresent(Double.self, forKey: .updatedAt)))
        case "thread.read":
            guard let threadId = try? container.decode(String.self, forKey: .threadId) else {
                self = .unknown(kind: kind)
                return
            }
            self = .threadRead(ThreadReadFrame(
                threadId: threadId,
                participantId: try? container.decodeIfPresent(String.self, forKey: .participantId),
                read: try? container.decodeIfPresent(ThreadReadPosition.self, forKey: .read),
                reset: (try? container.decodeIfPresent(Bool.self, forKey: .reset)) ?? false
            ))
        case "runtime":
            self = .runtime(try container.decode(RuntimeEvent.self, forKey: .event))
        case "voice.call.ended":
            guard let threadId = try? container.decode(String.self, forKey: .threadId),
                  let callId = try? container.decode(String.self, forKey: .callId),
                  let by = try? container.decode(String.self, forKey: .by),
                  by == "person" || by == "bot" else {
                self = .unknown(kind: kind)
                return
            }
            self = .voiceCallEnded(threadId: threadId, callId: callId, by: by)
        default:
            // routines, and whatever the harness adds next
            self = .unknown(kind: kind)
        }
    }
}

extension Frame {
    /// The thread this frame concerns, when it concerns one.
    public var threadId: String? {
        switch self {
        case let .message(threadId, _):
            return threadId
        case let .messagePatch(threadId, _):
            return threadId
        case let .thread(threadId, _):
            return threadId
        case let .notify(notification):
            return notification.threadId
        case let .runtime(event):
            return event.threadId
        case let .voiceCallEnded(threadId, _, _):
            return threadId
        default:
            return nil
        }
    }
}

extension Frame {
    /// A token of a reply or of its reasoning. Folding one changes only
    /// `CompanionState.streaming` / `reasoning`, so the app may announce it
    /// once per display frame instead of once per token. The frame that ends
    /// the stream (a settled message, `turn.completed`) is not one of these.
    public var isStreamedText: Bool {
        guard case let .runtime(event) = self else { return false }
        return event.type == "content.delta"
    }
}

/// A frame plus its position in the stream.
///
/// `seq` lives out here rather than inside the enum because an enum cannot
/// carry a stored property, and because the two answer different questions:
/// the frame says what happened, the sequence says where we are — which is
/// the only thing a reconnect needs.
public struct StreamFrame: Decodable, Sendable {
    public var frame: Frame
    public var seq: Int?

    private enum CodingKeys: String, CodingKey {
        case seq
    }

    public init(from decoder: Decoder) throws {
        self.frame = try Frame(from: decoder)
        self.seq = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent(Int.self, forKey: .seq)
    }

    public init(frame: Frame, seq: Int?) {
        self.frame = frame
        self.seq = seq
    }
}

/// The `nudge` frame's body.
public struct NudgeFrame: Hashable, Sendable {
    public struct Conversation: Decodable, Hashable, Sendable {
        public var groupId: String
        public var threadId: String
        public init(groupId: String, threadId: String) {
            self.groupId = groupId
            self.threadId = threadId
        }
    }

    public var fromId: String
    public var fromName: String
    /// Milliseconds since 1970; nil from an older server.
    public var at: Double?
    public var open: Conversation?

    public init(fromId: String = "", fromName: String = "", at: Double? = nil, open: Conversation? = nil) {
        self.fromId = fromId
        self.fromName = fromName
        self.at = at
        self.open = open
    }

    /// `NUDGE_FRESH_MS`: a replay older than this does nothing (its line is
    /// already in the chat).
    public static let freshMs: Double = 2 * 60_000

    public func isFresh(now: Double) -> Bool {
        guard let at else { return true }
        return now - at <= Self.freshMs
    }
}

/// The `org.approvals` frame's body.
public struct OrgApprovalsFrame: Hashable, Sendable {
    public struct Arrival: Decodable, Hashable, Sendable {
        public var requestId: String
        public var botName: String?
        public var ownerName: String?
        public var requestedBy: String?
        public var tool: String?
        public var summary: String?
    }

    public var count: Int
    public var added: [Arrival]

    public init(count: Int, added: [Arrival] = []) {
        self.count = count
        self.added = added
    }
}
