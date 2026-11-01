// The app's one long-lived object: who we are paired with, what we know,
// and the stream that keeps it current.
//
// The parsing and folding live in CompanionCore. What lives here is the
// part that cannot be unit-tested and is the actual hard problem in a phone
// client — lifecycle. A phone loses its connection constantly: it locks, it
// backgrounds, it moves between wifi and cellular. So the stream is torn
// down deliberately when the app leaves the screen, and on the way back the
// server is asked what was missed rather than being asked for everything.
import Foundation
import OSLog
import SwiftUI
import CompanionCore
import UserNotifications
import UIKit
import Combine

/// Stream lifecycle, in Console.app and the Xcode console. A companion that
/// is silently not connected looks exactly like one with nothing to say, so
/// the transitions are worth being able to read.
private let log = Logger(subsystem: "ca.pulsatrix.sagax", category: "stream")

private final class CachedAttachmentDownload: NSObject {
    let value: DownloadedFile

    init(_ value: DownloadedFile) {
        self.value = value
    }
}

/// An immutable, ciphertext-only credential write prepared on the main
/// actor before any asynchronous work begins. HPKE uses fresh randomness for
/// every seal, so retries must reuse this exact value rather than encrypting
/// the same credential again after an ambiguous network failure.
struct PreparedPhoneCredential: Equatable, Sendable {
    fileprivate let requestIdentity: String
    fileprivate let connectionID: String
    fileprivate let botID: String
    fileprivate let messageID: String
    fileprivate let envelope: PhoneSecretEnvelope
}

@MainActor
final class Session: ObservableObject {
    enum Status: Equatable {
        case unpaired
        case connecting
        case live
        /// The token stopped working — revoked on the computer, most likely.
        case unauthorized
        case offline(String)
    }

    /// Everything the phone knows, folded from the stream. Published by
    /// hand rather than with `@Published`: a streaming token is folded
    /// quietly (`foldQuietly`) and announced at most once per display frame
    /// to `streamingStore` and `statePublisher`, never to the whole view tree.
    /// Every other write publishes at once, exactly as before.
    private(set) var state = CompanionState() {
        didSet { stateDidChange() }
    }
    /// The live text, for the few views that draw it (`ChatLiveTail`).
    let streamingStore = StreamingStore()
    /// Every state change, including streamed tokens at most once per
    /// display frame. Starts with the current state, like `@Published`.
    var statePublisher: AnyPublisher<CompanionState, Never> {
        Deferred { [weak self] in Just(self?.state ?? CompanionState()) }
            .append(stateSubject)
            .eraseToAnyPublisher()
    }
    private let stateSubject = PassthroughSubject<CompanionState, Never>()
    private var foldingQuietly = false
    private var streamPending = false
    private lazy var streamFlush = FrameCoalescer { [weak self] in self?.flushStream() }
    @Published private(set) var connection: Connection?
    @Published private(set) var connections: [Connection] = []
    let threadSelection = BotThreadSelection()
    /// Whether the live pairing may administer the workspace — see
    /// `Connection.canAdminister`. Views hide owner-only controls when this
    /// is false rather than offer buttons the server would answer 403 to.
    var canAdminister: Bool { connection?.canAdminister ?? false }
    /// What this pairing lets the app show (`SurfaceGate`): the one place
    /// views ask before drawing a feature the computer may refuse.
    var surfaceGate: SurfaceGate {
        guard let connection else { return .unpaired }
        return SurfaceGate(connection: connection, account: account, viewer: viewer)
    }
    /// Who is asking, as `/api/config` last named them (principal, role,
    /// permissions): the bot owner's rights in `surfaceGate` read it.
    @Published private(set) var viewer: ConfigViewer?
    /// `canEditBotField` for this pairing: the owner of the bot on an
    /// organization server, an admin session, or the owner's sidecar.
    func canEditBotField(_ bot: Bot, _ field: String) -> Bool {
        surfaceGate.canEditBotField(bot, field)
    }
    /// Who answers a card for the shared server (`adminApproval`) and saves
    /// a command rule: an admin session, or a person an admin gave
    /// host.shell (server `adminApprovalCheck`, `canManageCommandAllowlist`).
    var answersServerCards: Bool { canAdminister || surfaceGate.can("host.shell") }
    @Published private(set) var status: Status = .unpaired
    /// Transient, user-facing failures from an action they just took.
    @Published var actionError: String?
    /// Uploads outlive a ChatView and stay bound to the connection captured
    /// at intake. Reopening a conversation restores its pending attachments.
    @Published private(set) var attachmentUploadStates: [UUID: AttachmentUploadState] = [:]
    private var attachmentUploadTasks: [UUID: Task<Void, Never>] = [:]
    private var attachmentUploadConnections: [UUID: String] = [:]
    private var attachmentUploadClients: [UUID: CompanionClient] = [:]
    private var attachmentUploadGenerations: [UUID: UUID] = [:]
    private var attachmentDrafts: [String: [PendingMessageAttachment]] = [:]
    @Published private(set) var recoveredAttachmentSends: Set<UUID> = []
    private(set) var recoveredAttachmentDraftTexts: [String: String] = [:]
    private var attachmentDraftTextTasks: [String: Task<Void, Never>] = [:]
    private var attachmentRecoveryTask: Task<Void, Never>?
    private var attachmentUploadTransientFailures: Set<UUID> = []
    private let attachmentJournal = AttachmentTransferJournal(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("AttachmentTransfers", isDirectory: true))
    /// The server answered a routine folder action as an older server does
    /// (no such route): the folder actions say "Available after the server
    /// update." until the next connection (2026-10-28).
    @Published var routineFoldersMissing = false
    /// One exact message the next opened chat should reveal.
    @Published private(set) var focusedMessageId: String?
    /// Fresh topic drafts (Session+FreshTopic.swift): per bot, the thread a
    /// new, empty topic is drawn over until its first message creates it.
    @Published var freshTopics: [String: String] = [:]
    /// Per bot, the topic a fresh draft's first message just created: the
    /// chat on screen moves there.
    @Published var startedTopics: [String: String] = [:]
    /// Per bot, a topic made for a fresh draft whose first message has not
    /// gone through yet: a retry goes there, never into a second topic.
    var createdFreshTopics: [String: String] = [:]
    /// Per bot, a thread the chat on screen for that bot moves to in place
    /// (Go to message from the bot panel's Links): consumed by ChatView.
    /// The panel only opens over that chat today; a door to it from
    /// anywhere else needs its own way to open the chat.
    @Published var threadSwitches: [String: ThreadSwitch] = [:]
    /// One conversation (SingleStream): per bot, a thread outside its stream
    /// a notification, a link, a search hit or a row named, to open beside
    /// the conversation (a sheet) once that conversation is on screen.
    /// Consumed by ChatView.
    @Published var pendingBeside: [String: BesideThread] = [:]
    /// One conversation (SingleStream): per bot, an earlier topic a
    /// notification, a link or a search hit named, to bring on screen in
    /// the conversation's timeline. Consumed by ChatView.
    @Published var revealSegments: [String: String] = [:]
    /// Citations Continue in the conversation left for the composer (desktop
    /// `appendDraftAttachments` of kind "citation"). Keyed by the composer
    /// thread. Consumed by ChatView.
    @Published var pendingComposerCitations: [String: [CitationAttachment]] = [:]
    @Published private(set) var notificationAuthorization: UNAuthorizationStatus = .notDetermined
    /// Distinguishes a real `.notDetermined` result from the in-memory value
    /// used while notification settings are still loading at launch.
    @Published private(set) var notificationAuthorizationResolved = false
    /// A short-lived desktop handoff waiting for PairingView to present it.
    @Published private(set) var pairingInvite: PairingInvite?
    /// Pairing can be opened while another computer remains connected. The
    /// working session is only replaced after the new credential commits.
    @Published private(set) var pairingRequested = false
    /// Views with sensitive input observe this value so an explicit runtime
    /// disconnect clears the field even when the selected connection itself
    /// has not changed.
    @Published private(set) var credentialEntryResetGeneration = 0

    /// A notification response that should be pushed by the roster's
    /// NavigationStack after the exact detached task has been activated.
    @Published private(set) var notificationChat: Chat? {
        // a notification opens what it names, never a fresh topic over it
        didSet { if case let .bot(bot)? = notificationChat { freshTopics[bot.id] = nil } }
    }

    /// A routine-run push: the run's detail, not its report thread (#1700).
    /// The roster and the iPad shell present it, then call
    /// `consumeNotificationRoutineRun`.
    @Published private(set) var notificationRoutineRun: OpenedRoutineRun?

    /// A chat a deep link asked for, consumed by the roster's
    /// NavigationStack the same way a notification response is.
    @Published private(set) var pendingChat: Chat? {
        // a link opens what it names, never a fresh topic over it
        didSet { if case let .bot(bot)? = pendingChat { freshTopics[bot.id] = nil } }
    }
    @Published private(set) var pendingInbox = false
    /// Who this phone is signed in as (`GET /api/auth/session`), for the
    /// home's photo. Nil until loaded, or when the server does not say.
    @Published private(set) var account: AuthSession?
    /// The person's photo for the active connection (AccountPhotoStore):
    /// their Perspicax avatar on an organization server, read through that
    /// server. Nil draws the initial. Shown by the home, the Settings
    /// account card and Account.
    @Published private(set) var accountPhoto: UIImage?
    /// The connection `account` and `accountPhoto` belong to.
    private var accountConnectionID: String?
    /// False once the server showed it has no group pins: the home then
    /// stops offering to pin a group.
    @Published private(set) var groupPinsSupported = true
    /// The app is showing the demo (`DemoServer`): local made-up data, no
    /// network, nothing saved. Leaving it returns to the welcome screen.
    @Published private(set) var isDemo = false
    /// App Store 1.2 (Session+Moderation.swift): the people this person
    /// blocked (kept on the server, so every device agrees), and whether the
    /// terms of use still wait for this account's one acceptance.
    @Published var blockedPeople: [Moderation.BlockedPerson] = []
    @Published var termsPending = false
    private(set) var demoServer: DemoServer?
    /// Which way the connect screen opened: a computer (QR, nearby,
    /// address and code) or an organization (Sign in with Pulsatrix).
    @Published private(set) var connectMode: ConnectMode = .computer

    enum ConnectMode: Equatable {
        case computer
        case organization
    }

    private var client: CompanionClient?
    /// `GET /voice/status` per bot, kept a minute (voiceModeStatus).
    private var voiceStatusCache: [String: (status: VoiceModeStatus, at: Date)] = [:]
    /// Why the last voice status could not be read (voiceModeStatus).
    private(set) var voiceStatusError: String?
    /// The live client, for the Settings sheet's own reads and writes
    /// (SettingsModel); nil while nothing is paired.
    var settingsClient: CompanionClient? { client }
    /// Ciphertext-only operations survive navigation and transient
    /// disconnects so a retry cannot accidentally reseal the same value with
    /// a different HPKE operation id. Nothing here is persisted to disk.
    private var preparedPhoneCredentials: [String: PreparedPhoneCredential] = [:]
    /// The device token, kept in memory so the client can be rebuilt when the
    /// dial moves to another stored host. The keychain remains the only place
    /// it is persisted.
    private var token: String?
    /// Why the session ended when `status` is `.unauthorized`: the server's
    /// `code` (`session_revoked`, `idp_session_ended`...), `server_changed`,
    /// or nil when every token this phone holds kept being refused.
    @Published private(set) var sessionEndCode: String?
    /// One check after a burst of 401s, shared by every request that saw one,
    /// for the connection and token it was started for.
    private var authRecoveryTask: Task<UnauthorizedRecovery.Outcome, Never>?
    private var authRecoveryKey: (connectionID: String, token: String)?
    /// When a check last found the token in use still valid: other 401s in
    /// the next moments (a route's own refusal) start no new check.
    private var authRecoveryValidAt: Date?
    /// Tokens the server refused and the app moved away from: a stale copy
    /// left in the Keychain (a save that failed) is never taken back.
    private var refusedTokens: Set<String> = []
    /// Which of the connection's stored hosts the next attempt dials. The
    /// walk advances on address-shaped failures and the winner is promoted —
    /// and persisted — when a stream goes live.
    private var rotation = CandidateRotation(hosts: [])
    private var streamTask: Task<Void, Never>?
    /// Best-effort authenticated route refresh started by the latest live SSE
    /// hello. Kept separate so endpoint discovery never stalls event delivery.
    private var endpointRefreshTask: Task<Void, Never>?
    /// Identifies the task currently stored in `streamTask`. A cancelled task
    /// can finish after its replacement starts; its cleanup must not clear
    /// the replacement's handle.
    private var streamGeneration = 0
    private var reconnectDelay: UInt64 = 0
    /// How many computer panels are open. A count rather than a flag: the
    /// panel can be pushed twice in a navigation stack, and the last one to
    /// close is the one that should turn screens back off.
    private var screenWatchers = 0
    /// Authenticated avatar bytes shared by roster, header, group and task
    /// surfaces. Both entry count and byte cost are bounded because one valid
    /// uploaded image may be 10 MB.
    private let avatarCache: NSCache<NSString, NSData> = {
        let cache = NSCache<NSString, NSData>()
        cache.countLimit = 64
        cache.totalCostLimit = 32 * 1_024 * 1_024
        return cache
    }()
    /// Concurrent first renders share one download. The id prevents an old
    /// request finishing after sign-out from removing a newer pairing's task
    /// for the same attachment path.
    private var avatarFetches: [String: (id: UUID, task: Task<Data?, Never>)] = [:]
    private var avatarCacheGeneration = 0
    /// Each saved account's last state (its conversations, bots, cursor),
    /// kept in memory while another account is on screen. Switching back
    /// shows it at once and its stream resumes from its own cursor: no
    /// sign-in, no empty screen, no full reload. Only ever handed back to the
    /// same saved connection; forgetting or re-pairing it drops it.
    private var parkedStates: [String: CompanionState] = [:]
    private var parkedOrder: [String] = []
    private static let parkedLimit = 3
    /// Voice-note bytes for the transcript bubbles. Clips are short but a
    /// busy thread can carry several; a small cost-bounded window keeps
    /// replay from refetching without pinning the whole transcript.
    private let voiceNoteCache: NSCache<NSString, NSData> = {
        let cache = NSCache<NSString, NSData>()
        cache.countLimit = 32
        cache.totalCostLimit = 32 * 1_024 * 1_024
        return cache
    }()
    private var voiceNoteFetches: [String: (id: UUID, task: Task<Data?, Never>)] = [:]
    private var voiceNoteCacheGeneration = 0
    /// Full image bytes are already fetched to draw a thumbnail. Keep a small,
    /// cost-bounded window so tapping that thumbnail opens immediately instead
    /// of downloading the same image twice.
    private let attachmentCache: NSCache<NSString, CachedAttachmentDownload> = {
        let cache = NSCache<NSString, CachedAttachmentDownload>()
        cache.countLimit = 12
        cache.totalCostLimit = 32 * 1_024 * 1_024
        return cache
    }()
    private var attachmentCacheGeneration = 0
    /// An ambiguous network failure may happen after the server accepted a
    /// message. Reusing this id for the exact same retained draft makes Retry
    /// idempotent instead of sending the attachment twice.
    private var attachmentSendIDs: [AttachmentDraftKey: String] = [:]
    /// A saved connection exists, but its token could not be read yet. Keeps
    /// "the keychain is locked" from being mistaken for "not paired".
    private var restorePending = false
    /// A notification can cold-launch the app before protected Keychain data
    /// is available. Retain the last explicitly tapped destination until the
    /// paired client can be rebuilt after unlock.
    private var pendingNotification: NotificationTarget?

    /// The exact route the current client will use for a credential write.
    var phoneCredentialTransportIsProtected: Bool {
        client?.connection.activeEndpoint?.protectsCredentials == true
    }

    private struct AttachmentDraftKey: Hashable {
        let destination: MessageDestination
        let text: String
        let attachmentIDs: [UUID]
    }

    private var registry = CompanionConnectionRegistry()
    // MARK: - Pairing

    init() {
        // Writes in an initializer skip `didSet`: hand the live text of a
        // preview fixture (`-chat-reasoning-preview`) to its store here.
        defer { publishStream() }
        Self.removeStaleFilePreviews()
        _ = NotificationCoordinator.shared
        NotificationCoordinator.shared.responseHandler = { [weak self] target in
            Task { @MainActor in await self?.openNotification(target) }
        }
        NotificationCoordinator.shared.botLookup = { [weak self] id in
            self?.state.bots.first { $0.id == id }
        }
        NotificationCoordinator.shared.approvalHandler = { decision in
            await NotificationApprovalRunner.run(decision)
        }
        // APNs (PushRegistrar.swift): the server this phone is signed in to
        // gets its token; a push that wakes the app recounts the badge.
        PushRegistrar.shared.activeClient = { [weak self] in
            guard let self, !self.isDemo, let client = self.client, let id = self.connection?.id else { return nil }
            return (client, id)
        }
        PushRegistrar.shared.backgroundRefresh = { [weak self] in
            await self?.refreshAfterPush() ?? false
        }
        PushRegistrar.shared.onDeviceToken = { [weak self] in
            self?.restartStream()
        }
#if DEBUG
        // Parity harness: a fixture server, held in memory only (ParityLaunch.swift).
        if let parity = ParityLaunch.current {
            let fixture = parity.connection
            connections = [fixture]
            // Each launch proves the photo comes from the fixture server.
            AccountPhotoStore.shared.forget(fixture.id)
            configureActiveConnection(fixture, token: parity.token)
            Task { await refreshNotificationAuthorization() }
            return
        }
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-reset-pairings") {
            // UI tests start each case from a fresh install's state.
            for saved in SagaxSharedConnectionStore.loadRegistry().connections { Keychain.remove(saved.id) }
            SagaxSharedConnectionStore.saveRegistry(CompanionConnectionRegistry())
            UserDefaults.standard.removeObject(forKey: OrgServerMemory.key)
        }
        if (arguments.contains("-store-preview") || arguments.contains("-computer-switcher-preview")),
           let url = Bundle.main.url(
               forResource: arguments.contains("-outbound-preview") ? "OutboundPreview" : arguments.contains("-cards-preview") ? "CardsPreview" : arguments.contains("-images-preview") ? "ImagePreview" : arguments.contains("-chat-update-preview") ? "ChatUpdatePreview" : arguments.contains("-chat-presentation-preview") ? "ChatPresentationPreview" : arguments.contains("-roster-preview") ? "RosterPreview" : arguments.contains("-threads-preview") ? "ThreadPreview" : arguments.contains("-open-thread-preview") ? "OpenThreadPreview" : arguments.contains("-bot-conversation-preview") ? "BotConversationPreview" : "StorePreview",
               withExtension: "json"
           ),
           let data = try? Data(contentsOf: url),
           let fleet = try? JSONDecoder().decode(Fleet.self, from: data) {
            // The tailnet host is the one this fixture pairing consented to
            // (d4b073b3a: a tailnet route without it builds no request, and
            // the image and voice previews said "That address doesn't look
            // right" instead of loading).
            let preview = Connection(
                id: "preview-current",
                name: "Milind’s MacBook Pro",
                host: "preview.tailnet.ts.net",
                port: 8810,
                allowedTailnetHost: "preview.tailnet.ts.net"
            )
            connection = preview
            if arguments.contains("-computer-switcher-preview") {
                let other = Connection(
                    id: "preview-other",
                    name: "MacBook Air",
                    host: "air.tailnet.ts.net",
                    port: 8810,
                    allowedTailnetHost: "air.tailnet.ts.net"
                )
                registry = CompanionConnectionRegistry(
                    connections: [preview, other],
                    activeConnectionID: preview.id
                )
                connections = registry.connections
            } else {
                connections = [preview]
            }
            if arguments.contains("-images-preview") {
                let config = URLSessionConfiguration.ephemeral
                config.protocolClasses = [ImagePreviewProtocol.self]
                client = CompanionClient(connection: preview, token: "image-fixture-token", session: URLSession(configuration: config))
            }
            if arguments.contains("-bot-conversation-preview") {
                let config = URLSessionConfiguration.ephemeral
                config.protocolClasses = [BotConversationPreviewProtocol.self]
                client = CompanionClient(connection: preview, token: "conversation-fixture-token", session: URLSession(configuration: config))
            }
            if arguments.contains("-voice-preview") {
                let config = URLSessionConfiguration.ephemeral
                config.protocolClasses = [VoicePreviewProtocol.self]
                client = CompanionClient(connection: preview, token: "voice-fixture-token", session: URLSession(configuration: config))
            }
            state.hydrate(fleet)
            if arguments.contains("-outbound-preview"),
               let flag = arguments.firstIndex(of: "-outbound-set"), arguments.indices.contains(flag + 1) {
                // One set of the outbound call cards per screenshot (OutboundPreview.json).
                let keep = "preview-outbound-\(arguments[flag + 1])"
                state.bots.removeAll { $0.id != keep }
            }
            if arguments.contains("-chat-focus-preview") {
                // Put the requested reply several screens inside the fold.
                var messages = state.messages["preview-gmail"] ?? []
                if let index = messages.firstIndex(where: { $0.id == "progress2" }) {
                    var parent = "progress"
                    let narration = (1...12).map { number -> Message in
                        var step = messages[index]
                        step.id = "preview-long-\(number)"
                        step.at = 1789088401000 + Double(number)
                        step.text = String(repeating: "Inspecting the dependency graph for step \(number). ", count: 8)
                        step.turnId = "preview-turn"
                        step.parentId = parent
                        parent = step.id
                        return step
                    }
                    messages[index].parentId = parent
                    messages.insert(contentsOf: narration, at: index)
                    state.messages["preview-gmail"] = messages
                }
                focusedMessageId = "progress2"
            }
            if arguments.contains("-chat-steps-preview"),
               let url = Bundle.main.url(forResource: "ChatStepsPreview", withExtension: "json"),
               let data = try? Data(contentsOf: url),
               let steps = try? JSONDecoder().decode([Message].self, from: data) {
                // A turn's tool steps among its narration (the step line),
                // each row chained to the one before as the server stores them.
                var chained = ((state.messages["preview-gmail"] ?? []) + steps).sorted { $0.at < $1.at }
                for index in chained.indices.dropFirst() { chained[index].parentId = chained[index - 1].id }
                state.messages["preview-gmail"] = chained
                // The turn is over: the bot is idle, so its model can change.
                if let index = state.bots.firstIndex(where: { $0.threadId == "preview-gmail" }) {
                    state.bots[index].busy = false
                    state.bots[index].tasks = state.bots[index].tasks?.map { task in
                        var idle = task
                        idle.busy = false
                        return idle
                    }
                }
            }
            if arguments.contains("-cards-top") {
                // The cards chat from its first cards (the theme captures).
                focusedMessageId = "c-tool"
            }
            if arguments.contains("-chat-compaction-preview"),
               var receipt = state.messages["preview-gmail"]?.last {
                receipt.id = "preview-compaction"
                receipt.kind = .compaction
                receipt.at = 1789088405000
                receipt.turnId = nil
                receipt.turnTerminal = nil
                receipt.parentId = "answer"
                receipt.compaction = Compaction(summary: "Earlier context preserved for the next turn.", tokensBefore: 12345)
                state.apply(.message(threadId: "preview-gmail", message: receipt))
                var digest = receipt
                digest.id = "preview-digest"
                digest.kind = .digest
                digest.compaction = nil
                digest.at = 1789088406000
                digest.parentId = receipt.id
                // The raw receipt never reaches the screen: it becomes a chip,
                // and the reply part — this sentence — is dropped from its sheet.
                digest.text = "[digest] · tools: shell ×2 · reply: Digest must stay hidden"
                state.apply(.message(threadId: "preview-gmail", message: digest))
            }
            if arguments.contains("-chat-reasoning-preview"),
               let frameURL = Bundle.main.url(forResource: "ChatReasoningPreview", withExtension: "json"),
               let frameData = try? Data(contentsOf: frameURL),
               let frame = try? JSONDecoder().decode(Frame.self, from: frameData) {
                state.apply(frame)
            }
            if let longCount = LongTranscript.previewCount(in: arguments) {
                // DEBUG / demo measure: one synthetic thread of ~2000 lines so
                // the chat transcript can be timed before and after LazyVStack.
                applyLongTranscriptPreview(count: longCount)
            }
            if arguments.contains("-threads-preview"),
               let pagesURL = Bundle.main.url(forResource: "ThreadPreviewPages", withExtension: "json"),
               let pagesData = try? Data(contentsOf: pagesURL),
               let pages = try? JSONDecoder().decode([String: ThreadPage].self, from: pagesData) {
                for (threadID, page) in pages { state.merge(page, intoThread: threadID) }
            }
            if arguments.contains("-reset-list-density") {
                // The fresh-install default is checked in UI tests; an
                // earlier run on the same simulator may have saved a choice.
                UserDefaults.standard.removeObject(forKey: PrefKey.rosterDensity)
            }
            if let index = arguments.firstIndex(of: "-set-list-density"), index + 1 < arguments.count {
                // Saved like a choice made in Settings, so Settings can still
                // change it (a `-companion.prefs.rosterDensity` argument would
                // pin the value for the whole launch).
                UserDefaults.standard.set(arguments[index + 1], forKey: PrefKey.rosterDensity)
            }
            status = .live
            return
        }
#endif
        restore()
        Task { await refreshNotificationAuthorization() }
    }

    /// Rebuild the selected connection at launch, migrating the previous
    /// single-computer record the first time a multi-computer build runs.
    ///
    /// Three outcomes, and keeping them apart is the whole point. No saved
    /// connection: stay unpaired. A saved connection whose token reads back:
    /// connect. A saved connection whose token cannot be read *yet* — the
    /// locked keychain before a phone's first unlock after reboot, which is
    /// when iOS is most likely to have launched us in the background — hold
    /// on to it and try again. Only the middle case is a real pairing, and
    /// only the first should ever send someone back to the pairing screen.
    private func restore() {
        restorePending = false
        registry = SagaxSharedConnectionStore.loadRegistry()
        connections = registry.connections
        // The Share extension can target any saved computer, not only the
        // one active at launch. Move every inactive pre-extension token into
        // the shared Keychain group now; the active token is read below so
        // its locked/error state can still drive the visible connection UI.
        for saved in registry.connections where saved.id != registry.activeConnectionID {
            _ = try? Keychain.token(for: saved.id)
        }
        restoreSelectedConnection()
    }

    /// Find the first selected pairing whose Keychain token still exists.
    /// A missing token is a genuinely unusable saved record; a locked
    /// Keychain is temporary and must leave the record untouched.
    private func restoreSelectedConnection() {
        guard let saved = registry.activeConnection else {
            clearActiveConnection()
            return
        }

        let stored: String?
        do {
            stored = try Keychain.token(for: saved.id)
        } catch {
            // Keep the connection and say why. `.offline` rather than
            // `.unpaired` matters: the latter is what puts PairingView on
            // screen, and asking for a new code is the one recovery that
            // costs a walk to the computer.
            connection = saved
            restorePending = true
            status = .offline(
                (error as? KeychainError)?.isLocked == true
                    ? "Unlock this device to reach your computer."
                    : error.localizedDescription
            )
            return
        }
        guard let stored else {
            // No token under this record: another record of the same server
            // may hold one (a sign-in saved before records were merged).
            // Adopt it rather than dropping to sign-in.
            if let adopted = Keychain.candidates(for: registry.credentialSiblings(of: saved).map(\.id), excluding: nil).first,
               (try? Keychain.save(adopted.token, for: saved.id, removingDuplicates: [adopted.connectionID])) != nil {
                registry.remove(id: adopted.connectionID)
                persistRegistry()
                connections = registry.connections
                configureActiveConnection(saved, token: adopted.token)
                return
            }
            registry.remove(id: saved.id)
            persistRegistry()
            connections = registry.connections
            restoreSelectedConnection()
            return
        }

        configureActiveConnection(saved, token: stored)
    }

    /// The saved record a new sign-in or pairing replaces: the active one
    /// when it is the same server, else any record of the same server.
    private func existingRecord(for stored: Connection) -> Connection? {
        let sameServer = registry.duplicates(of: stored)
        if let active = registry.activeConnection, sameServer.contains(where: { $0.id == active.id }) {
            return active
        }
        return sameServer.first ?? registry.matchingConnection(for: stored)
    }

    // MARK: - Staying signed in

    /// A request was answered 401. Never a sign-out by itself: the session is
    /// checked again in the background (`recoverAuthorization`).
    func handleUnauthorized() {
        guard !isDemo, client != nil, status != .unauthorized else { return }
        if let validAt = authRecoveryValidAt, Date().timeIntervalSince(validAt) < 30 { return }
        Task { [weak self] in _ = await self?.recoverAuthorization() }
    }

    private func cancelAuthRecovery() {
        authRecoveryTask?.cancel()
        authRecoveryTask = nil
        authRecoveryKey = nil
        authRecoveryValidAt = nil
    }

    /// Check the session after a 401, once for a whole burst. Probes the
    /// token in use, then every other copy this phone holds for the same
    /// server (both Keychain groups, duplicate records); adopts one that
    /// works; signs out only on a definitive server code or after repeated
    /// refusals with no working copy. Nothing is deleted on the server or in
    /// the Keychain here.
    @discardableResult
    private func recoverAuthorization() async -> UnauthorizedRecovery.Outcome {
        guard let connection, let token, let client else { return .undecided }
        let connectionID = connection.id
        if let running = authRecoveryTask {
            // Join only a check about this very connection and token.
            guard authRecoveryKey?.connectionID == connectionID, authRecoveryKey?.token == token else {
                return .undecided
            }
            return await running.value
        }
        // Another record's copy only travels over a route that protects
        // credentials (https, tailnet), and only for the same server.
        let siblings = client.connection.activeEndpoint?.protectsCredentials == true
            ? registry.credentialSiblings(of: connection).map(\.id) : []
        let ids = [connectionID] + siblings
        let refused = refusedTokens
        let task = Task { @MainActor () -> UnauthorizedRecovery.Outcome in
            await UnauthorizedRecovery.run(
                current: token,
                candidates: { Keychain.candidates(for: ids, excluding: token).filter { !refused.contains($0.token) } },
                probe: { candidate in await client.replacingToken(candidate).probeAuthorization() },
                sleep: { seconds in try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
            )
        }
        authRecoveryTask = task
        authRecoveryKey = (connectionID, token)
        let outcome = await task.value
        if authRecoveryTask == task {
            authRecoveryTask = nil
            authRecoveryKey = nil
        }
        // A new sign-in, a switch or a sign-out happened meanwhile: this
        // answer is about a token no longer in use.
        guard self.connection?.id == connectionID, self.token == token else { return .undecided }
        switch outcome {
        case .recovered(nil):
            authRecoveryValidAt = Date()
        case .undecided:
            break
        case let .recovered(candidate?):
            refusedTokens.insert(token)
            adoptToken(candidate, for: connectionID)
        case let .signedOut(code):
            log.error("session ended: \(code ?? "refused", privacy: .public)")
            sessionEndCode = code
            status = .unauthorized
            // The stream holds the same ended session: stop it (run() also
            // returns on its own when it was the one asking).
            streamGeneration += 1
            streamTask?.cancel()
            streamTask = nil
        }
        return outcome
    }

    /// A fresher copy of the token works: it becomes the one copy for this
    /// record, the record it came from (a duplicate) is dropped, and the
    /// live client switches to it.
    private func adoptToken(_ candidate: CredentialCandidate, for connectionID: String) {
        log.notice("session recovered with a fresher token")
        let duplicate = candidate.connectionID == connectionID ? [] : [candidate.connectionID]
        do {
            try Keychain.save(candidate.token, for: connectionID, removingDuplicates: duplicate)
            for id in duplicate { registry.remove(id: id) }
            if !duplicate.isEmpty {
                persistRegistry()
                connections = registry.connections
            }
        } catch {
            // Locked Keychain: use it now, write it on the next recovery.
            log.error("could not save the recovered token: \(error.localizedDescription, privacy: .public)")
        }
        token = candidate.token
        client = client?.replacingToken(candidate.token)
        PushRegistrar.shared.forgetRegistration(connectionID: connectionID)
    }

    /// Coming to the front: the Keychain is the one source of truth. If it
    /// holds another token for this record than the one in memory (a sign-in
    /// that finished elsewhere), use it before any request goes out.
    private func adoptStoredTokenIfNewer() {
        guard !isDemo, let connection, let current = token,
              let stored = (try? Keychain.token(for: connection.id)) ?? nil,
              !stored.isEmpty, stored != current, !refusedTokens.contains(stored)
        else { return }
        log.notice("using the token saved in the Keychain")
        token = stored
        client = client?.replacingToken(stored)
        PushRegistrar.shared.forgetRegistration(connectionID: connection.id)
        restartStream()
    }

    /// "Sign in again" on the ended-session screen: open sign-in for the same
    /// server, keeping the saved record. A successful sign-in replaces the
    /// token of this record; nothing is forgotten or unregistered before.
    func signInAgain() {
        if isDemo { exitDemo(); return }
        beginPairing(connection?.pairedWithServer == true ? .organization : .computer)
    }

    /// Redeem a one-time pairing credential. On success the device token goes
    /// to the keychain and the connection to defaults — deliberately apart,
    /// so the thing that gets backed up is never the credential.
    func pair(
        with connection: Connection,
        credential: String,
        deviceName: String,
        pairRequestId: String
    ) async throws {
        var invited = connection
        // QR invites already carry this policy. Manual entry reaches the
        // session as a parsed Connection, so establish the same consent
        // boundary here before any health probe or credential redemption.
        if invited.allowedRouteKinds == nil {
            invited.establishRoutePolicyFromInvite()
        }
        // A 12-character code pairs with a server directly (its own sessions,
        // a bearer with the code's scopes); anything else is the companion's.
        if let code = PairingInvite.normalizedServerCode(credential) {
            // Reachability first, on the public descriptor: a wrong address
            // then fails as an address problem rather than a code problem,
            // and no attempt is spent against the server's lockout.
            try await Self.confirmServer(at: invited)
            let paired = try await CompanionClient.pairWithServer(
                connection: invited,
                code: code,
                label: deviceName,
                attemptId: pairRequestId
            )
            var stored = invited
            if !paired.environment.label.isEmpty { stored.name = paired.environment.label }
            stored.serverEnvironmentId = paired.environment.environmentId
            stored.serverScopes = paired.session.scopes
            stored.companionDeviceId = nil
            if let existing = existingRecord(for: stored) {
                stored.id = existing.id
            }
            try commitPairing(stored, token: paired.token)
            return
        }
        let outcome = try await CompanionClient.pairFirstReachable(
            connection: invited,
            credential: credential,
            deviceName: deviceName,
            pairRequestId: pairRequestId
        )
        let paired = outcome.response
        // prefer the name the computer calls itself over the Bonjour label
        var stored = outcome.connection
        if !paired.serverName.isEmpty { stored.name = paired.serverName }
        stored.companionDeviceId = paired.device.id
        // The computer knows every address it answers on, but redemption may
        // not widen the explicit route consent carried by the invite.
        stored.applyPairingAdvertisement(hosts: paired.hosts, endpoints: paired.endpoints)
        let winner = outcome.connection.activeEndpoint ?? CompanionEndpoint.direct(
            host: outcome.connection.host,
            port: outcome.connection.port,
            priority: 10_000
        )
        if let winner { stored.promote(winner) }
        if stored.endpoints?.isEmpty != false {
            stored.hosts = Array(stored.orderedHosts.prefix(8))
        }
        if let existing = existingRecord(for: stored) {
            stored.id = existing.id
        }
        try commitPairing(stored, token: paired.token, winner: winner)
    }

    /// The device token goes to the keychain and the connection to defaults —
    /// deliberately apart, so the thing that gets backed up is never the
    /// credential. Shared by companion and server pairing; `winner` is the
    /// route that answered, which a server pairing (one route) has no use for.
    private func commitPairing(_ stored: Connection, token: String, winner: CompanionEndpoint? = nil) throws {
        // One copy of the token, in the shared group the extensions read:
        // the legacy copy and any other record of the same server (an older
        // sign-in with a dead token) go, so nothing stale is picked later.
        let duplicates = registry.duplicates(of: stored).map(\.id)
        try Keychain.save(token, for: stored.id, removingDuplicates: duplicates)
        let firstPairing = registry.connections.isEmpty
        var updatedRegistry = registry
        for duplicate in duplicates { updatedRegistry.remove(id: duplicate) }
        updatedRegistry.upsert(stored)
        // Write the first-pair education marker before making the connection
        // restorable. If the process stops between these writes, an orphan
        // marker is harmless while unpaired; the reverse order could restore
        // a pairing which permanently skipped this step.
        // RootView may not have received iOS's notification status yet, and
        // the app may be relaunched before that asynchronous lookup finishes.
        CompanionPairingCommitSequence.persist {
            if firstPairing {
                UserDefaults.standard.set(
                    true,
                    forKey: CompanionOnboardingPreferences.pendingNotificationOnboardingKey
                )
            }
        } saveConnection: {
            SagaxSharedConnectionStore.saveRegistry(updatedRegistry)
        }

        // The account on screen is kept for a switch back; a re-paired one
        // starts afresh, never from a state of its earlier pairing.
        if let previous = connection?.id, previous != stored.id, status != .unauthorized { parkState(of: previous) }
        forgetParkedState(stored.id)
        for duplicate in duplicates { forgetParkedState(duplicate) }
        stopActiveRuntime(keepingAvatars: true)
        pairingInvite = CompanionPairingInvitePolicy.nextInvite(
            current: pairingInvite,
            after: .pairingSucceeded
        )
        pairingRequested = false
        registry = updatedRegistry
        connections = registry.connections
        self.connection = stored
        self.token = token
        let liveRoutes = winner.map { route in
            [route] + stored.orderedEndpoints.filter { $0.url != route.url }
        } ?? stored.orderedEndpoints
        self.rotation = CandidateRotation(endpoints: liveRoutes)
        self.client = CompanionClient(
            connection: winner.map(stored.dialing) ?? stored,
            token: token
        )
        self.state = CompanionState()
        // A fresh pairing settles any restore that was still waiting on the
        // keychain — the token is in hand, so there is nothing left to retry.
        restorePending = false
        cancelAuthRecovery()
        sessionEndCode = nil
        PushRegistrar.shared.forgetRegistration(connectionID: stored.id)
        connect()
    }

    /// `GET /.well-known/openmausbot/environment` on a server about to be
    /// paired. Nothing there means this address is not a server; the message
    /// names the address, since that is what the person can fix. Any other
    /// answer — unreachable, a gateway error — is passed through as it is.
    private static func confirmServer(at connection: Connection) async throws {
        let probe = CompanionClient(connection: connection, token: nil, requestTimeout: 8)
        do {
            _ = try await probe.environment()
        } catch APIError.status(404, _) {
            throw APIError.transport(
                "\(connection.displayAddress) isn't a Sagax server. Check the address and try again."
            )
        }
    }

    func receiveURL(_ url: URL) {
        // A plugin sign-in's return (sagax://oauth-done) belongs to the
        // sign-in sheet that started it, not to pairing.
        if url.scheme?.lowercased() == PluginSignIn.callbackScheme { return }
        guard let link = CompanionDeepLink.parse(url) else {
            actionError = "That pairing invitation is not valid. Start pairing again on your computer."
            return
        }
        switch link {
        case let .pairing(invite):
            pairingInvite = CompanionPairingInvitePolicy.nextInvite(
                current: pairingInvite,
                after: .received(invite)
            )
            pairingRequested = true
        case let .chat(threadId):
            openChat(threadId: threadId)
        case let .bot(id):
            openBot(id: id)
        case .inbox:
            pendingInbox = true
        }
    }

    func consumePendingInbox() {
        pendingInbox = false
    }

    /// A deep link that names a chat. An id this phone does not know — a
    /// stale widget row, a thread deleted since — lands on the roster
    /// silently: it is not the person's mistake, so it is not worth a banner.
    func openChat(threadId: String) {
        guard let chat = state.chat(forThread: threadId) else { return }
        // One conversation (SingleStream.landing): a bot's thread opens as
        // the conversation, brought to that topic or with it beside
        if case let .bot(bot) = chat, !SidebarPrefsModel.shared.showThreads, let stored = state.bot(bot.id) {
            let landing = SingleStream.landing(of: stored, threadId: threadId)
            switch landing {
            case let .earlier(home): revealSegments[bot.id] = threadId; pendingChat = stored.projected(forThread: home).map(Chat.bot) ?? chat
            case let .beside(home): pendingBeside[bot.id] = BesideThread(botId: bot.id, threadId: threadId); pendingChat = stored.projected(forThread: home).map(Chat.bot) ?? chat
            case let .conversation(thread): pendingChat = stored.projected(forThread: thread).map(Chat.bot) ?? chat
            }
            return
        }
        pendingChat = chat
    }

    /// One conversation (SingleStream.landing), for a way into `threadId`
    /// of `bot` with threads hidden: the thread the screen shows, with the
    /// topic to reveal or the thread to open beside it noted for ChatView.
    /// The server's selection follows the conversation (every device opens
    /// it), never the thread beside. Nil when the bot has no conversation
    /// and the thread is not its own (the caller's older route applies).
    func land(bot: Bot, threadId: String, using client: CompanionClient) async -> Bot? {
        let stored = state.bot(bot.id) ?? bot
        let landing = SingleStream.landing(of: stored, threadId: threadId)
        switch landing {
        case let .earlier(home): revealSegments[bot.id] = threadId; return await shown(stored, home, client)
        case let .beside(home): pendingBeside[bot.id] = BesideThread(botId: bot.id, threadId: threadId); return await shown(stored, home, client)
        case let .conversation(thread): return thread == threadId && SingleStream.home(of: stored) == nil ? nil : await shown(stored, thread, client)
        }
    }

    private func shown(_ bot: Bot, _ threadId: String, _ client: CompanionClient) async -> Bot? {
        if bot.threadId != threadId {
            do {
                let selected = try await client.switchTask(botId: bot.id, threadId: threadId)
                state.apply(.bot(selected))
                return selected.projected(forThread: threadId) ?? selected
            } catch {
                // the server could not switch (an older server, a thread of
                // someone else's): this phone still shows the conversation
            }
        }
        return (state.bot(bot.id) ?? bot).projected(forThread: threadId) ?? bot
    }

    /// `sagax://bot/<id>`: that bot's (or room's) current conversation. An
    /// id this phone does not know lands on the roster silently, like a
    /// stale chat link.
    func openBot(id: String) {
        if let bot = state.bot(id) {
            // where its row would open it: its one conversation (threads hidden)
            pendingChat = conversationOrRestored(.bot(bot))
        } else if let room = state.rooms.first(where: { $0.id == id }) {
            pendingChat = .room(room)
        }
    }

    func consumePendingChat() {
        pendingChat = nil
    }

    /// Open the connect screen; `mode` picks its first page (nil keeps the
    /// current one).
    func beginPairing(_ mode: ConnectMode? = nil) {
        if let mode { connectMode = mode }
        pairingRequested = true
    }

    // MARK: - Demo

    /// Open the demo: the full app on `DemoServer`'s made-up workspace.
    /// Nothing reaches the Keychain, the saved connections or the network.
    func enterDemo() {
        stopActiveRuntime()
        let language = DemoLaunch.language
        let server = DemoServer(now: DemoLaunch.clock ?? Date(), language: language)
        server.onFrame = { [weak self] frame in
            // One serial queue keeps the server's order.
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.applyDemoFrame(frame) }
            }
        }
        demoServer = server
        isDemo = true
        pairingRequested = false
        connection = server.connection
        connections = [server.connection]
        client = server.makeClient()
        var demoState = CompanionState()
        demoState.hydrate(server.fleet)
        if let png = DemoScreen.pngBase64(language: language) {
            demoState.apply(.screen(botId: "demo-forge", png: png, mime: "image/png"))
        }
        state = demoState
#if DEBUG
        if let longCount = LongTranscript.previewCount(in: ProcessInfo.processInfo.arguments) {
            applyLongTranscriptPreview(count: longCount)
        }
#endif
        status = .live
        // the demo asks for the terms too, and answers Report and Block
        Task { await loadModeration() }
    }

#if DEBUG
    /// Replaces the first bot's thread with a synthetic long transcript for
    /// LazyVStack measurement (StorePreview Scout, or demo Atlas). One thread
    /// keeps the home roster cheap while the open chat carries ~2000 rows.
    func applyLongTranscriptPreview(count: Int) {
        guard let bot = state.bots.first else { return }
        let threadId = bot.threadId
        let generated = LongTranscript.messages(count: count, idPrefix: "long-\(threadId)")
        state.messages[threadId] = generated
        state.hasMore[threadId] = false
        state.activeLeafIds[threadId] = generated.last?.id
        if let index = state.bots.firstIndex(where: { $0.id == bot.id }) {
            state.bots[index].messages = generated
            state.bots[index].hasMore = false
            state.bots[index].activeLeafId = generated.last?.id
            state.bots[index].unread = false
        }
    }
#endif

    private func applyDemoFrame(_ frame: Frame) {
        guard isDemo else { return }
        if frame.isStreamedText { foldQuietly { state.apply(frame) } } else { state.apply(frame) }
    }

    // MARK: - Publishing the state

    private func stateDidChange() {
        if foldingQuietly {
            if !streamPending {
                streamPending = true
                streamFlush.request()
            }
            return
        }
        objectWillChange.send()
        // Anything else that lands also carries the latest tokens: a settled
        // reply clears the live bubble in the same render that draws it.
        streamPending = false
        publishStream()
    }

    /// Fold a streamed token without telling the view tree. The change
    /// still reaches the state at once; `flushStream` announces it.
    private func foldQuietly(_ write: () -> Void) {
        foldingQuietly = true
        defer { foldingQuietly = false }
        write()
    }

    private func flushStream() {
        guard streamPending else { return }
        streamPending = false
        publishStream()
        // With no conversation on screen the home is what shows, and its
        // Updates pill reads a working bot's line from the live text: keep
        // it current, once per frame, as it was per token before. With a
        // chat open the home is hidden under it and only the chat's live
        // tail redraws.
        if AttentionCenter.shared.viewingThreadId == nil { objectWillChange.send() }
    }

    private func publishStream() {
        streamingStore.sync(text: state.streaming, reasoning: state.reasoning)
        stateSubject.send(state)
    }

    /// Leave the demo for the welcome screen (or the saved pairing, if one
    /// exists): everything the demo held is dropped.
    func exitDemo() {
        guard isDemo else { return }
        demoServer?.stop()
        demoServer = nil
        isDemo = false
        connections = []
        clearActiveConnection()
        restore()
        if connection != nil { connect() }
    }

    func endPairing() {
        pairingRequested = false
        consumePairingInvite()
    }

    func consumePairingInvite() {
        pairingInvite = CompanionPairingInvitePolicy.nextInvite(
            current: pairingInvite,
            after: .consumed
        )
    }

    func switchComputer(to id: String) {
        guard let saved = registry.connection(id: id) else { return }
        if connection?.id == id {
            restartStream()
            connect()
            return
        }

        let stored: String?
        do {
            stored = try Keychain.token(for: id)
        } catch {
            actionError = (error as? KeychainError)?.isLocked == true
                ? "Unlock this device, then try switching computers again."
                : error.localizedDescription
            return
        }
        guard let stored else {
            actionError = "This saved connection is no longer available on this device. Remove it and pair again."
            return
        }

        // The account on screen is kept as it is; the one shown comes back as
        // it was left, its stream resuming from its own cursor.
        let started = Date()
        if let previous = connection?.id, status != .unauthorized { parkState(of: previous) }
        stopActiveRuntime(keepingAvatars: true)
        registry.select(id: id)
        persistRegistry()
        connections = registry.connections
        configureActiveConnection(saved, token: stored)
        let parked = takeParkedState(for: id)
        if let parked {
            state = parked
            NotificationCoordinator.shared.setBadge(state.unreadCount)
        }
        connect()
        log.info("switched accounts in \(Int(Date().timeIntervalSince(started) * 1000), privacy: .public) ms (\(parked == nil ? "first visit" : "its last state shown", privacy: .public))")
    }

    // MARK: - Each account's last state

    private func parkState(of id: String) {
        guard !isDemo, state.cursor != nil || !state.bots.isEmpty else { return }
        parkedStates[id] = state
        parkedOrder.removeAll { $0 == id }
        parkedOrder.append(id)
        while parkedOrder.count > Self.parkedLimit {
            parkedStates.removeValue(forKey: parkedOrder.removeFirst())
        }
    }

    private func takeParkedState(for id: String) -> CompanionState? {
        parkedOrder.removeAll { $0 == id }
        return parkedStates.removeValue(forKey: id)
    }

    private func forgetParkedState(_ id: String) {
        parkedOrder.removeAll { $0 == id }
        parkedStates.removeValue(forKey: id)
    }

    private func forgetParkedStates() {
        parkedOrder.removeAll()
        parkedStates.removeAll()
    }

    func forgetConnection(id: String) {
        if isDemo { exitDemo(); return }
        guard let forgotten = registry.connection(id: id) else { return }
        let wasActive = registry.activeConnectionID == id
        // A server session is ended on the server too, best effort: the
        // bearer is discarded locally either way.
        // A session the server already ended has nothing left to end there:
        // its bearer is refused, so no DELETE /api/push/devices with it.
        let sessionEnded = wasActive && status == .unauthorized
        if !sessionEnded, let token = try? Keychain.token(for: id) {
            let client = CompanionClient(connection: forgotten, token: token)
            let endsSession = forgotten.pairedWithServer
            // that server stops pushing to this phone, then the session ends
            Task {
                await PushRegistrar.shared.unregister(client: client, connectionID: id)
                if endsSession { try? await client.logout() }
            }
        }
        if wasActive { stopActiveRuntime() }
        // Nothing of that account stays in memory: its last state and pictures.
        forgetParkedState(id)
        if !wasActive { resetAvatarCache() }
        preparedPhoneCredentials = preparedPhoneCredentials.filter { $0.value.connectionID != id }
        Keychain.remove(id)
        BrandMascotCache.forget(id)
        AccountPhotoStore.shared.forget(id)
        AccountNameStore.shared.forget(id)
        registry.remove(id: id)
        persistRegistry()
        connections = registry.connections
        guard wasActive else { return }

        connection = nil
        client = nil
        token = nil
        rotation = CandidateRotation(hosts: [])
        state = CompanionState()
        resetAvatarCache()
        NotificationCoordinator.shared.setBadge(0)
        restoreSelectedConnection()
        if connection != nil { connect() }
        if connections.isEmpty {
            UserDefaults.standard.removeObject(
                forKey: CompanionOnboardingPreferences.pendingNotificationOnboardingKey
            )
        }
    }

    /// Compatibility for the existing revoked-pairing and detail actions:
    /// sign out now means remove only the selected computer.
    func signOut() {
        if isDemo { exitDemo(); return }
#if DEBUG
        // Parity harness: the fixture connection lives in memory only, so
        // there is no saved pairing to forget; end the session in memory.
        if ParityLaunch.current != nil {
            connections = []
            clearActiveConnection()
            return
        }
#endif
        guard let id = connection?.id ?? registry.activeConnectionID else {
            clearActiveConnection()
            return
        }
        forgetConnection(id: id)
    }

    private func clearActiveConnection() {
        resetCredentialEntry()
        streamTask?.cancel()
        streamTask = nil
        endpointRefreshTask?.cancel()
        endpointRefreshTask = nil
        restorePending = false
        pendingNotification = nil
        notificationRoutineRun = nil
        pairingInvite = CompanionPairingInvitePolicy.nextInvite(
            current: pairingInvite,
            after: .signedOut
        )
        pairingRequested = false
        connection = nil
        client = nil
        token = nil
        rotation = CandidateRotation(hosts: [])
        state = CompanionState()
        forgetParkedStates()
        showAccount(of: nil)
        resetAvatarCache()
        resetAttachmentCache()
        attachmentSendIDs.removeAll()
        NotificationCoordinator.shared.setBadge(0)
        cancelAuthRecovery()
        sessionEndCode = nil
        status = .unpaired
    }

    private func configureActiveConnection(_ saved: Connection, token stored: String) {
        connection = saved
        token = stored
        showAccount(of: saved.id)
        // New connections honor the desktop's transport policy. Automatic
        // walking is credential-safe: protected routes stay protected, while
        // a legacy/local route is only tried when it was the exact saved route.
        rotation = CandidateRotation(endpoints: saved.orderedEndpoints)
        let first = rotation.currentEndpoint.map(saved.dialing) ?? saved
        client = CompanionClient(connection: first, token: stored)
        cancelAuthRecovery()
        sessionEndCode = nil
        status = .connecting
    }

    /// `keepingAvatars`: a switch between accounts keeps each account's
    /// pictures (the cache is keyed by account), only in-flight downloads stop.
    private func stopActiveRuntime(keepingAvatars: Bool = false) {
        resetCredentialEntry()
        streamGeneration += 1
        streamTask?.cancel()
        streamTask = nil
        endpointRefreshTask?.cancel()
        endpointRefreshTask = nil
        cancelAuthRecovery()
        restorePending = false
        endLinger()
        pendingNotification = nil
        notificationRoutineRun = nil
        screenWatchers = 0
        client = nil
        token = nil
        state = CompanionState()
        if keepingAvatars { cancelAvatarFetches() } else { resetAvatarCache() }
        resetAttachmentCache()
        attachmentSendIDs.removeAll()
        NotificationCoordinator.shared.setBadge(0)
    }

    private func persistRegistry() {
#if DEBUG
        // The parity harness's fixture server is held in memory only: an
        // endpoint update during a parity run saved it as this device's
        // pairing (without its token), and every later launch, the demo's
        // included, opened that dead pairing instead.
        if ParityLaunch.current != nil { return }
#endif
        SagaxSharedConnectionStore.saveRegistry(registry)
    }

    private func persistActiveConnection(_ updated: Connection) {
        registry.upsert(updated, makeActive: false)
        connection = updated
        connections = registry.connections
        persistRegistry()
    }

    // MARK: - Lifecycle

    /// Called when the app comes to the front, and once at launch.
    func connect() {
        // The demo has no stream: its server hands frames over directly.
        if isDemo { return }
        // A restore that found the keychain locked left `client` nil on
        // purpose. Coming to the front is the moment worth retrying on: the
        // app is on screen, so the phone is in someone's hand and unlocked.
        if client == nil, restorePending { restore() }
        adoptStoredTokenIfNewer()
        if client != nil, let pendingNotification {
            self.pendingNotification = nil
            Task { [weak self] in await self?.openNotification(pendingNotification) }
        }
        // back before the grace period ran out: keep the stream, drop the task
        endLinger()
        guard client != nil, streamTask == nil else { return }
        reconnectDelay = 0
        streamGeneration += 1
        let generation = streamGeneration
        streamTask = Task { [weak self] in
            guard let self else { return }
            await self.run()
            guard self.streamGeneration == generation else { return }
            self.streamTask = nil
        }
    }

    /// Pull-to-refresh: reopen the stream, and hold the control open until
    /// the connection has actually settled one way or the other.
    ///
    /// `connect()` returns the moment the task is spawned, so a `refreshable`
    /// that only calls it snaps the spinner shut before a single byte has
    /// arrived — the gesture reads as "nothing happened", on precisely the
    /// occasion it exists for. Waiting for `status` to leave `.connecting`
    /// makes the spinner mean what it appears to mean; the deadline is there
    /// so a network that never answers still gives the control back.
    func refresh() async {
        restartStream()
        connect()
        let deadline = Date().addingTimeInterval(10)
        while status == .connecting, !Task.isCancelled, Date() < deadline {
            try? await Task.sleep(nanoseconds: 120_000_000)
        }
    }

    /// Ask the harness to include this bot's computer in the stream, for as
    /// long as something is showing it.
    ///
    /// This costs a reconnect, which is the right trade: the alternative is
    /// a base64 desktop capture arriving every few seconds for the whole
    /// session, including on cellular, whether or not anyone is looking.
    /// The reconnect resumes from the cursor, so nothing is missed.
    func watchScreen(of botId: String) {
        screenWatchers += 1
        if screenWatchers == 1 { restartStream() }
    }

    func stopWatchingScreen(of botId: String) {
        screenWatchers = max(0, screenWatchers - 1)
        if screenWatchers == 0 {
            state.clearScreen(botId)
            restartStream()
        }
    }

    /// Reopen the stream so its query string matches what we now want. The
    /// cursor survives, so this is a gap, not a reset.
    private func restartStream() {
        guard streamTask != nil else { return }
        streamTask?.cancel()
        streamTask = nil
        connect()
    }

    /// Called when the app leaves the screen. iOS will kill the connection
    /// anyway; dropping it deliberately means the cursor is written down at
    /// a known point instead of wherever the socket happened to die.
    func disconnect() {
        resetCredentialEntry()
        streamTask?.cancel()
        streamTask = nil
        // Nothing follows the bots any more: say so (the Live Activities
        // mark their cards stale on it), and the return reads "Connecting…"
        // rather than a live status that is not true.
        if status == .live { status = .connecting }
        endpointRefreshTask?.cancel()
        endpointRefreshTask = nil
        endLinger()
    }

    private func resetCredentialEntry() {
        credentialEntryResetGeneration &+= 1
    }

    private var lingerTask: UIBackgroundTaskIdentifier = .invalid
    private var lingerSleep: Task<Void, Never>?

    /// Leaving the screen: keep the stream alive for the grace period iOS
    /// allows (~30 s) rather than cutting it at once, so an approval that
    /// lands right after you swipe home still reaches the Live Activity and
    /// the island. After that, iOS suspends us anyway; disconnect cleanly so
    /// the cursor is written down at a known point.
    func linger() {
        if isDemo { return }
        guard streamTask != nil, lingerTask == .invalid else { disconnect(); return }
        // A previous request can leave a sleeper behind when iOS refuses the
        // background assertion. Never let it outlive the assertion it belongs
        // to or disconnect a later linger window.
        lingerSleep?.cancel()
        lingerSleep = nil
        let task = UIApplication.shared.beginBackgroundTask(withName: "companion.linger") { [weak self] in
            // time is up before our own timer — the system wants us gone now
            self?.disconnect()
        }
        guard task != .invalid else { disconnect(); return }
        lingerTask = task
        lingerSleep = Task { [weak self] in
            try? await Task.sleep(for: .seconds(25))
            guard !Task.isCancelled, let self, self.lingerTask != .invalid else { return }
            self.disconnect()
        }
    }

    private func endLinger() {
        lingerSleep?.cancel()
        lingerSleep = nil
        guard lingerTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(lingerTask)
        lingerTask = .invalid
    }

    private func run() async {
        let generation = streamGeneration
        while !Task.isCancelled {
            guard let client else { return }
            status = .connecting
            // A server connection first checks it is still the same server.
            // The descriptor is public, so this spends no credential; a
            // changed environment id (the address now belongs to another
            // server, or its data directory was recreated) means "pair
            // again", exactly like a revoked token — the bearer would be
            // refused anyway, and a fresh install must not be shown the old
            // one. Unreachable is not "different": the stream attempt below
            // reports that the usual way.
            if let expected = client.connection.serverEnvironmentId {
                let live = try? await client.environment()
                if Task.isCancelled { return }
                if let live, live.environmentId != expected {
                    log.error("server identity changed: \(expected, privacy: .public) is now \(live.environmentId, privacy: .public)")
                    sessionEndCode = SessionEndReason.serverChanged
                    status = .unauthorized
                    return
                }
            }
            log.info("opening stream, cursor=\(self.state.cursor ?? "none", privacy: .public)")
            do {
                // The query is fixed when the connection opens, so changing
                // it means a new connection — `restartStream()` cancels this
                // task and starts another. Cancellation is the only exit;
                // breaking out here instead would fall through to the "the
                // harness went away" path and flash a lost-connection banner
                // on what is actually a deliberate reconnect.
                for try await frame in try client.events(since: state.cursor, screens: screenWatchers > 0, pushToken: PushRegistrar.shared.deviceToken) {
                    if Task.isCancelled { return }
                    reconnectDelay = 0

                    if case let .hello(cursor, resumed) = frame.frame {
                        log.info("stream live, resumed=\(resumed, privacy: .public)")
                        // false means the server could not replay the gap —
                        // the one case that costs a full hydrate. Commit the
                        // hello cursor only after that hydrate succeeds: if
                        // the request dies halfway through replay/hydration,
                        // reconnecting must still ask for the missing gap.
                        if !resumed {
                            try await hydrate(using: client)
                            state.resetCursor(cursor)
                        }
                        status = .live
                        resumeNativeAttachmentTransfers(using: client)
                        // this server pushes to the phone while the app is closed
                        Task { await PushRegistrar.shared.sync() }
                        // phone tools: what this phone offers, and any request waiting
                        PhoneToolCenter.shared.streamOpened(self)
                        // blocked people and the terms (App Store 1.2)
                        Task { await self.loadModeration() }
                        // Remember what actually carried the stream for
                        // display and legacy ordering. Typed routes retain
                        // their explicit security priority next launch.
                        rememberWorkingRoute()
                        refreshConnectionMetadata(using: client)
                        continue
                    }
                    let streamed = frame.frame.isStreamedText
                    if streamed { foldQuietly { state.apply(frame) } } else { state.apply(frame) }
                    // people: presence and labels (#167, #172)
                    PeopleDirectory.shared.apply(frame.frame)
                    // a bot asks this phone for a tool (Features/PhoneTools)
                    if case let .unknown(kind) = frame.frame, kind == "phone-tools" {
                        Task { await PhoneToolCenter.shared.refresh() }
                    }
                    // a bot reads or changes a setting this phone keeps (#1545)
                    if case let .unknown(kind) = frame.frame, kind == "device-settings" {
                        Task { await self.answerDeviceSettings() }
                    }
                    // a routine changed or ran: the account's routines badge
                    if case let .unknown(kind) = frame.frame, kind.hasPrefix("routine") {
                        Task { await AccountRowModel.shared.refresh(self) }
                    }
                    // a bot's task list changed: its Tasks card reads it again
                    if case let .botTasks(botId) = frame.frame {
                        NotificationCenter.default.post(name: .sagaxBotTasksChanged, object: botId)
                    }
                    // a nudge addressed to this person: wizz, buzz and a
                    // notification that opens its conversation (#222)
                    if case let .nudge(nudge) = frame.frame {
                        AttentionCenter.shared.receive(nudge)
                    }
                    // admins: commands waiting for an admin (#213)
                    if case let .orgApprovals(approvals) = frame.frame {
                        OrgApprovalsCenter.shared.apply(approvals)
                    }
                    // Seen by (#270): a participant's read position moved
                    if case let .threadRead(read) = frame.frame {
                        ReadReceiptsCenter.shared.apply(read, session: self)
                    }
                    // the person's sidebar, saved on any of their devices
                    if case let .preferences(record) = frame.frame {
                        SidebarPrefsModel.shared.receive(self, record)
                        // the skin, its colour variant and font, saved on the desktop
                        ThemeStore.shared.receive(record)
                    }
                    // a server setting changed (Tool calls among them)
                    if case .config = frame.frame {
                        Task { await ToolCallsSetting.shared.load(self) }
                    }
                    if case let .notify(notification) = frame.frame {
                        NotificationCoordinator.shared.deliver(notification, sequence: frame.seq,
                                                               confidential: state.isConfidentialThread(notification.threadId))
                    }
                    // answered elsewhere: the ask's banner goes, here and on the watch
                    if case let .notifyWithdraw(threadId, requestId) = frame.frame {
                        Task { await NotificationCoordinator.shared.withdraw(threadId: threadId.isEmpty ? nil : threadId, requestId: requestId) }
                    }
                    NotificationCoordinator.shared.setBadge(state.unreadCount)
                    withdrawSettledIfFewerUnread()
                    if streamed { foldQuietly { state.advance(to: frame.seq) } } else { state.advance(to: frame.seq) }
                }
                // Cancelled by us (leaving the screen, a restart for the
                // screen view, pull to refresh): the sequence ends without
                // an error then. A newer stream owns `status`; never write
                // "Lost the connection" over it.
                if Task.isCancelled || streamGeneration != generation {
                    log.info("stream closed by us")
                    return
                }
                // the stream ended without an error — the harness went away
                log.notice("stream ended without an error")
                status = .offline("Lost the connection.")
            } catch let error as APIError where error.isUnauthorized {
                // A 401 is not a sign-out by itself (a server restart, a
                // stale copy of the token): check again, try every copy of
                // the token this phone holds, and sign out only when the
                // server says the session is over.
                log.error("stream refused: unauthorized, checking the session")
                switch await recoverAuthorization() {
                case .recovered(.some):
                    // A fresher token: reconnect with it now.
                    reconnectDelay = 0
                    continue
                case .recovered(nil):
                    // The token works, the stream did not: the usual
                    // backoff below, never a tight loop.
                    if Task.isCancelled { return }
                    status = .offline(String(localized: "Reconnecting to Sagax..."))
                case .signedOut:
                    return
                case .undecided:
                    if Task.isCancelled { return }
                    status = .offline(String(localized: "Reconnecting to Sagax..."))
                }
            } catch {
                // backgrounding cancels the stream on purpose; that is not a
                // failure to report, and it must not be retried
                if Task.isCancelled || error is CancellationError {
                    log.info("stream closed by us")
                    return
                }
                log.error("stream failed: \(error.localizedDescription, privacy: .public)")
                status = .offline(failureMessage(for: error))
            }

            if Task.isCancelled { return }
            // 1s, 2s, 4s… to 15s. A phone that woke on a network which is
            // not the laptop's should not hammer it.
            reconnectDelay = reconnectDelay == 0 ? 1 : min(reconnectDelay * 2, 15)
            try? await Task.sleep(nanoseconds: reconnectDelay * 1_000_000_000)
        }
    }

    private func hydrate(using client: CompanionClient) async throws {
        let generation = streamGeneration
        // Notification navigation can refresh while run() continues folding
        // live events. Retry once if that makes the fetched snapshot stale.
        for _ in 0..<2 {
            let expectedCursor = state.cursor
            let snapshot = try await client.fleetForHydration(messages: 50)
            try Task.checkCancellation()
            guard streamGeneration == generation, self.client?.connection.id == client.connection.id else {
                throw CancellationError()
            }
            guard state.hydrate(snapshot.fleet, waitingThreads: snapshot.waitingThreads,
                                ifCursorMatches: expectedCursor) else { continue }
            log.info("hydrated \(snapshot.fleet.bots.count, privacy: .public) bots, \(snapshot.fleet.groups.count, privacy: .public) rooms")
            NotificationCoordinator.shared.setBadge(state.unreadCount)
            badgedUnread = state.unreadCount
            let bots = state.bots
            let open = state.openRequestIds
            Task { await NotificationCoordinator.shared.withdrawSettled(bots: bots, openRequestIds: open) }
            return
        }
        throw APIError.status(code: 409, message: "Conversations changed while loading. Please try opening this notification again.")
    }

    // MARK: - Which address to dial

    /// Turn a stream failure into advice a person can act on — and, when the
    /// failure is about the address rather than the pairing, move the dial to
    /// the next stored host so the retry that follows tries somewhere new.
    /// A 401 never reaches here: the unauthorized path returns above, which
    /// is what keeps a token problem from masquerading as an address walk.
    private func failureMessage(for error: Error) -> String {
        guard let connection else { return error.localizedDescription }
        let failed = rotation.currentEndpoint ?? connection.activeEndpoint ??
            CompanionEndpoint.direct(host: connection.host, port: connection.port, priority: 10_000)
        var next: String?
        if let candidate = rotation.advanceEndpoint(after: error), let token {
            client = CompanionClient(connection: connection.dialing(candidate), token: token)
            next = candidate.displayAddress
            log.info("advancing to companion route \(candidate.url, privacy: .public)")
        }
        if let urlError = error as? URLError {
            return ConnectionAdvice.message(
                for: urlError.code,
                host: failed?.displayAddress ?? connection.host,
                port: failed?.port ?? connection.port,
                tryingNext: next
            )
        }
        if let apiError = error as? APIError,
           case let .status(code, _) = apiError,
           ConnectionAdvice.shouldTryAnotherRoute(after: error) {
            return ConnectionAdvice.message(
                forGatewayStatus: code,
                host: failed?.displayAddress ?? connection.host,
                tryingNext: next
            )
        }
        return error.localizedDescription
    }

    /// Persist the route that carried a live stream. Legacy host lists promote
    /// it for the next launch; typed lists keep their explicit policy order.
    private func rememberWorkingRoute() {
        guard let winner = rotation.currentEndpoint, var updated = connection,
              updated.activeEndpoint?.url != winner.url else { return }
        updated.promote(winner)
        persistActiveConnection(updated)
    }

    /// Learn routes enabled after this phone originally paired. The endpoint
    /// response is authenticated with the existing device token and is a
    /// replacement snapshot, but failure is deliberately non-fatal: older
    /// sidecars return 404 and a transient refresh error must not tear down a
    /// perfectly healthy event stream.
    private func refreshConnectionMetadata(using sourceClient: CompanionClient) {
        // A server has no companion routes to advertise (`/api/companion/*`
        // is the sidecar's); its one address is the one that was paired.
        guard connection?.pairedWithServer != true, let connectionID = connection?.id else { return }
        let workingEndpoint = rotation.currentEndpoint ?? sourceClient.connection.activeEndpoint
        endpointRefreshTask?.cancel()
        endpointRefreshTask = Task { [weak self] in
            do {
                let metadata = try await sourceClient.connectionMetadata()
                try Task.checkCancellation()
                guard let self,
                      self.connection?.id == connectionID,
                      self.client?.connection.baseURL == sourceClient.connection.baseURL,
                      var updated = self.connection
                else { return }

                updated.reconcile(metadata)
                self.persistActiveConnection(updated)

                // Keep the currently live route first until this stream ends.
                // CandidateRotation applies the same no-downgrade policy used
                // by pairing, while the saved connection uses advertised
                // security priorities on the next launch.
                let liveRoutes = workingEndpoint.map { route in
                    [route] + updated.orderedEndpoints.filter { $0.url != route.url }
                } ?? updated.orderedEndpoints
                self.rotation = CandidateRotation(endpoints: liveRoutes)
                log.info("refreshed \(metadata.endpoints.count, privacy: .public) companion routes")
            } catch is CancellationError {
                return
            } catch {
                log.debug("endpoint refresh unavailable: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// Replace the stored address by hand, keeping the pairing and its token.
    /// False when the text does not parse as a host or host:port.
    @discardableResult
    func updateAddress(_ text: String) -> Bool {
        guard var updated = connection, let parsed = Connection.parse(text) else { return false }
        guard let endpoint = parsed.activeEndpoint ?? CompanionEndpoint.direct(
            host: parsed.host,
            port: parsed.port,
            priority: 0
        ) else { return false }
        updated.resetRoutePolicy(selecting: endpoint)
        persistActiveConnection(updated)
        rotation = CandidateRotation(endpoints: updated.orderedEndpoints)
        if let token {
            client = CompanionClient(connection: updated.dialing(endpoint), token: token)
        }
        // Dial the new address now rather than on the next backoff tick —
        // someone who just typed an address is watching the banner.
        restartStream()
        connect()
        return true
    }

    // MARK: - Actions
    //
    // Each of these does the thing and lets the event stream deliver the
    // result. Nothing here writes to `state` optimistically: the harness is
    // the source of truth, and a phone that draws its own version of events
    // is a phone that disagrees with the laptop.

    /// The widget's change, as an approval card in this conversation.
    func requestCwAction(_ action: CwActionBody, threadId: String, botId: String?) async {
        await perform { client in
            try await client.requestCwAction(threadId: threadId, action: action, botId: botId)
        }
    }

    /// A press on a chat widget (ChatWidgetCard.swift): the person's next
    /// message, written by the server from the widget. The card shows the
    /// server's own sentence when it says no, so this does not set
    /// `actionError`.
    func sendWidgetAction(
        botId: String, threadId: String?, messageId: String, ref: String, rev: Int,
        values: ChatWidgetValues?, sendId: String
    ) async -> ChatWidgetSendResult {
        guard let client else { return .failed(refused: false, message: nil) }
        do {
            try await client.sendWidgetAction(
                botId: botId, threadId: threadId, messageId: messageId, ref: ref, rev: rev, values: values, sendId: sendId
            )
            return .sent
        } catch let error as APIError {
            if error.isUnauthorized { handleUnauthorized() }
            if case let .status(_, message) = error { return .failed(refused: true, message: message ?? error.errorDescription) }
            return .failed(refused: false, message: nil)
        } catch {
            return .failed(refused: false, message: nil)
        }
    }

    func send(_ text: String, to chat: Chat) async {
        let connectionID = client?.connection.id
        var receipt: SendReceipt?
        await perform {
            switch chat {
            case let .bot(bot): receipt = try await $0.send(text: text, toBot: bot.id, threadId: bot.threadId)
            case let .room(room):
                // a person's conversation sends to the thread open here (#262)
                receipt = try await $0.send(text: text, toRoom: room.id, threadId: room.peopleDm == true ? room.threadId : nil)
            }
        }
        // The receipt describes a queue on the computer this request went
        // to. A machine switched mid-flight has already reset state for the
        // computer now on screen, and that row must not land in it.
        guard client?.connection.id == connectionID else { return }
        rememberQueuedSend(from: receipt, text: text)
    }

    /// Send a composer draft with app-owned attachments. The destination
    /// includes the exact active thread at tap time, so neither a desktop task
    /// switch nor an upload delay can move the message elsewhere. Callers only
    /// clear their draft when this returns true.
    func send(
        text: String,
        attachments: [PendingMessageAttachment],
        to chat: Chat,
        options: SendOptions = SendOptions()
    ) async -> Bool {
        guard let client else {
            actionError = "This computer is offline."
            return false
        }
        let connectionID = client.connection.id
        actionError = nil
        var journaledDelivery: String?
        do {
            try AttachmentPolicy.validate(attachments, sharedHost: surfaceGate.organization)
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty || !attachments.isEmpty else {
                actionError = "Write a message or attach a file first."
                return false
            }

            if attachments.contains(where: { $0.kind == .image }) {
                let capable: Set<String>
                do {
                    capable = try await client.imageCapableInstanceIDs()
                } catch APIError.status(code: 404, message: _) {
                    actionError = "Update Sagax on this computer before sending images."
                    return false
                }
                guard imageSupported(by: chat, capableInstances: capable) else {
                    actionError = imageCompatibilityMessage(for: chat)
                    return false
                }
            }

            var destination = chat.destination
            // The first message of a fresh topic: the server makes the topic
            // now, then the message goes there (no empty topics before it).
            var startedTopic: (botId: String, threadId: String)?
            if case let .bot(bot) = chat, freshTopics[bot.id] == bot.threadId {
                let threadId: String
                if let made = createdFreshTopics[bot.id] {
                    threadId = made
                } else {
                    let created = try await client.createTopic(botId: bot.id)
                    guard self.client?.connection.id == connectionID else { return false }
                    applyProfileBot(created.bot)
                    createdFreshTopics[bot.id] = created.threadId
                    threadId = created.threadId
                }
                startedTopic = (bot.id, threadId)
                destination = .bot(id: bot.id, threadId: threadId)
            }
            let draftKey = AttachmentDraftKey(
                destination: destination,
                text: text,
                attachmentIDs: attachments.map(\.id)
            )
            if attachmentSendIDs.count >= 20, attachmentSendIDs[draftKey] == nil {
                attachmentSendIDs.removeAll(keepingCapacity: true)
            }
            let recovered = attachmentJournal.ids().compactMap { try? attachmentJournal.load($0) }.first {
                !$0.cancelled && $0.connectionID == connectionID && $0.destination == destination && $0.prefix == text
                    && $0.entries.map(\.id) == attachments.map(\.id)
            }?.sendID
            let sendID = attachmentSendIDs[draftKey] ?? recovered ?? UUID().uuidString
            attachmentSendIDs[draftKey] = sendID

            var uploaded: [SharedAttachmentReference] = []
            uploaded.reserveCapacity(attachments.count)
            for attachment in attachments {
                try Task.checkCancellation()
                // Imported attachments upload before Send. A pending or
                // failed chip never falls through to a second transfer.
                if let state = attachmentUploadState(attachment.id) {
                    guard case let .ready(receipt) = state else {
                        actionError = String(localized: "Finish or retry the attachment uploads before sending.")
                        return false
                    }
                    uploaded.append(receipt.reference(for: attachment))
                } else {
                    // Bounded native producers and retained failed sends may
                    // enter here without a composer. They use the same UUID
                    // and resumable transport as picked files.
                    let receipt = try await client.uploadAttachment(attachment, sharedHost: surfaceGate.organization)
                    attachmentUploadConnections[attachment.id] = connectionID
                    attachmentUploadClients[attachment.id] = client
                    attachmentUploadStates[attachment.id] = .ready(receipt)
                    uploaded.append(receipt.reference(for: attachment))
                }
            }

            let message = SharedMessageComposer.compose(
                instruction: text,
                text: [],
                urls: [],
                attachments: uploaded
            )
            var streamOptions = options
            if case .bot = destination { streamOptions.singleStream = !SidebarPrefsModel.shared.showThreads }
            // Persist the exact accepted delivery before the network call.
            // Relaunch retries the same body, options and sendId after an
            // ambiguous reply, rather than charging for another message.
            if !attachments.isEmpty {
                journaledDelivery = try attachmentJournal.prepareDelivery(attachments, connectionID: connectionID, destination: destination,
                    prefix: text, sendID: sendID, preparedText: message, options: streamOptions,
                    sourceDraftID: AttachmentTransferJournal.draftID(connectionID: connectionID, threadID: chat.threadId))
            }
            let deliveryLease = !attachments.isEmpty ? try attachmentJournal.lease(sendID) : nil
            defer { withExtendedLifetime(deliveryLease) {} }
            let receipt = try await client.send(text: message, to: destination, sendId: sendID, options: streamOptions)
            if !attachments.isEmpty, let manifest = try? attachmentJournal.load(sendID) {
                try attachmentJournal.finish(manifest, id: sendID)
            }
            // The fresh topic's first message went through: the chat moves there.
            if let startedTopic {
                createdFreshTopics[startedTopic.botId] = nil
                freshTopics[startedTopic.botId] = nil
                startedTopics[startedTopic.botId] = startedTopic.threadId
                // the bot picked again from now on opens the new topic, not
                // the one under the draft
                if let topic = state.bot(startedTopic.botId)?.projected(forThread: startedTopic.threadId) {
                    threadSelection.rememberThread(.bot(topic), connectionID: connectionID)
                }
            }
            // The send succeeded on the computer it was addressed to, so the
            // draft clears either way. Its queue row belongs to that computer,
            // and must not be drawn on one selected mid-upload.
            if self.client?.connection.id == connectionID {
                rememberQueuedSend(from: receipt, text: text)
            }
            attachmentSendIDs.removeValue(forKey: draftKey)
            consumeAttachmentUploads(attachments, threadId: chat.threadId, connectionID: connectionID)
            actionError = nil
            return true
        } catch is CancellationError {
            return false
        } catch let error as APIError where error.isUnauthorized {
            // Never a sign-out by itself: the session is checked again
            // quietly; the draft stays for a retry.
            handleUnauthorized()
            actionError = String(localized: "Sagax is reconnecting. Your message was not sent; try again in a moment.")
            return false
        } catch {
            // A definitive refusal (policy, type, size) must not be replayed
            // later from the outbox. The draft and its chips stay for editing.
            if let journaledDelivery, AttachmentTransferDelivery.definitive(error) {
                try? attachmentJournal.remove(journaledDelivery)
                attachmentSendIDs = attachmentSendIDs.filter { $0.value != journaledDelivery }
            }
            actionError = error.localizedDescription
            return false
        }
    }

    /// The harness's answer to a send, when it held the message instead of
    /// delivering it. This is wire state, not optimism: the row exists
    /// because the computer said it does, identified by its queueId.
    private func rememberQueuedSend(from receipt: SendReceipt?, text: String) {
        guard let receipt, receipt.queued == true,
              let queueId = receipt.queueId, let threadId = receipt.threadId
        else { return }
        state.rememberQueued(
            QueuedSend(
                queueId: queueId,
                text: text,
                reason: receipt.reason == "capacity" ? "capacity" : nil
            ),
            threadId: threadId
        )
    }

    /// Take back a held message. The row only goes when the computer agrees;
    /// an entry that already drained counts as agreement.
    /// True only when the computer confirmed cancellation, so an
    /// edit never hands back words that already joined a turn.
    @discardableResult
    func cancelQueued(_ send: QueuedSend, threadId: String, in chat: Chat) async -> Bool {
        let connectionID = client?.connection.id
        let destination: MessageDestination
        switch chat {
        case let .bot(bot): destination = .bot(id: bot.id, threadId: threadId)
        case let .room(room): destination = .room(id: room.id, threadId: threadId)
        }
        var agreed = false
        var cancelled = false
        await perform {
            cancelled = try await $0.cancelQueued(queueId: send.queueId, to: destination)
            agreed = true
        }
        // The cancel landed on the computer that owned the row. One selected
        // mid-request has already reset state; its rows are not this cancel's
        // to retire.
        guard agreed, client?.connection.id == connectionID else { return false }
        state.cancelQueued(queueId: send.queueId, threadId: threadId)
        return cancelled
    }

    /// Held sends the computer folded into the running turn (Steer): their
    /// rows go, exactly as when their messages arrive on the stream.
    func retireQueued(_ queueIds: [String], threadId: String) {
        for queueId in queueIds { state.consumeQueued(queueId: queueId, threadId: threadId) }
    }

    /// Run Claude Code's updater for one engine instance on the computer.
    /// Returns the version it now reports. Throws with the harness's own
    /// message (already written for people) so the card can show it; an
    /// unpaired device is flagged the same way `perform` does.
    func updateClaude(instanceId: String) async throws -> String {
        guard let client else { throw APIError.transport("Not connected to a computer.") }
        do {
            return try await client.updateClaude(instanceId: instanceId)
        } catch let error as APIError where error.isUnauthorized {
            handleUnauthorized()
            throw error
        }
    }

    private func imageSupported(by chat: Chat, capableInstances: Set<String>) -> Bool {
        switch chat {
        case let .bot(bot):
            return capableInstances.contains(bot.currentTaskModelSelection.instanceId)
        case let .room(room):
            return !room.memberIds.isEmpty && room.memberIds.allSatisfy { id in
                guard let bot = state.bot(id) else { return false }
                return capableInstances.contains(bot.modelSelection.instanceId)
            }
        }
    }

    private func imageCompatibilityMessage(for chat: Chat) -> String {
        switch chat {
        case let .bot(bot):
            return "\(bot.name)'s current model doesn't support images. Choose another model or remove the image."
        case .room:
            return "Every bot that may answer in this channel must use a model that supports images."
        }
    }

    /// Fetch one app-owned attachment through the message that introduced it.
    /// The caller owns presentation errors so a failed thumbnail or preview can
    /// explain itself beside the attachment that was tapped.
    func fetchAttachment(
        threadId: String,
        messageId: String,
        path: String,
        cacheResult: Bool = false
    ) async throws -> DownloadedFile {
        guard let client else {
            throw APIError.transport("This computer is offline.")
        }
        let cacheKey = "\(threadId)\u{1F}\(messageId)\u{1F}\(path)"
        if cacheResult,
           let cached = attachmentCache.object(forKey: cacheKey as NSString) {
            return cached.value
        }
        let generation = attachmentCacheGeneration
        do {
            // Keep this structured. When the row scrolls away SwiftUI cancels
            // its task, which now propagates directly into URLSession instead
            // of leaving a shared unstructured download running.
            let download = try await client.downloadFile(
                threadId: threadId,
                messageId: messageId,
                path: path
            )
            try Task.checkCancellation()
            guard generation == attachmentCacheGeneration else { throw CancellationError() }
            if cacheResult {
                attachmentCache.setObject(
                    CachedAttachmentDownload(download),
                    forKey: cacheKey as NSString,
                    cost: download.data.count
                )
            }
            return download
        } catch let error as APIError where error.isUnauthorized {
            // A cancelled request from the previous computer may finish after
            // a switch. Its 401 belongs to that old token and must not evict
            // the current live session.
            guard generation == attachmentCacheGeneration, !Task.isCancelled else {
                throw CancellationError()
            }
            handleUnauthorized()
            throw error
        } catch {
            if Task.isCancelled || generation != attachmentCacheGeneration {
                throw CancellationError()
            }
            throw error
        }
    }

    /// Fetch and materialize an attachment in a protected temporary directory
    /// for Quick Look, markdown/text preview, and the system share sheet.
    func prepareAttachmentPreview(
        threadId: String,
        messageId: String,
        path: String,
        cacheResult: Bool = false
    ) async throws -> DownloadedFile {
        let download: DownloadedFile
        if cacheResult {
            download = try await fetchAttachment(threadId: threadId, messageId: messageId, path: path, cacheResult: true)
        } else {
            guard let client else { throw APIError.transport("This computer is offline.") }
            let generation = attachmentCacheGeneration
            download = try await client.downloadFileToDisk(threadId: threadId, messageId: messageId, path: path)
            guard generation == attachmentCacheGeneration, !Task.isCancelled else {
                if let url = download.localURL { try? FileManager.default.removeItem(at: url) }
                throw CancellationError()
            }
        }
        let preparation = Task.detached(priority: .userInitiated) {
            // Content-Disposition is the server's canonical, sanitised name.
            // The transport tag's `name` is presentation-only and must never
            // choose the on-disk preview/share filename.
            try Self.materializePreview(download: download, filename: download.filename)
        }
        let prepared = try await withTaskCancellationHandler {
            try await preparation.value
        } onCancel: {
            preparation.cancel()
        }
        do {
            try Task.checkCancellation()
            return prepared
        } catch {
            Self.removePreview(at: prepared.localURL)
            throw error
        }
    }

    /// Compatibility for file links in assistant markdown. User attachment
    /// cards use the throwing API above so their feedback remains local.
    func downloadFile(
        threadId: String,
        messageId: String,
        path: String
    ) async -> DownloadedFile? {
        actionError = nil
        do {
            let download = try await prepareAttachmentPreview(
                threadId: threadId,
                messageId: messageId,
                path: path
            )
            actionError = nil
            return download
        } catch is CancellationError {
            return nil
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    private func resetAttachmentCache() {
        attachmentCacheGeneration += 1
        attachmentCache.removeAllObjects()
    }

    nonisolated private static func materializePreview(
        download: DownloadedFile,
        filename: String
    ) throws -> DownloadedFile {
        let manager = FileManager.default
        defer {
            if let url = download.localURL { try? manager.removeItem(at: url) }
        }
        let root = manager.temporaryDirectory
            .appendingPathComponent("SagaxFilePreviews", isDirectory: true)
        let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try Task.checkCancellation()
        try manager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        let fileURL = directory.appendingPathComponent(filename, isDirectory: false)
        do {
            if let downloadedURL = download.localURL {
                try manager.moveItem(at: downloadedURL, to: fileURL)
                try manager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: fileURL.path)
            } else {
                try download.data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
            try Task.checkCancellation()
            return DownloadedFile(
                data: download.data,
                filename: filename,
                contentType: download.contentType,
                localURL: fileURL
            )
        } catch {
            try? manager.removeItem(at: directory)
            if let url = download.localURL { try? manager.removeItem(at: url) }
            throw error
        }
    }

    nonisolated private static func removePreview(at fileURL: URL?) {
        guard let fileURL else { return }
        try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
    }

    private static func removeStaleFilePreviews() {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("SagaxFilePreviews", isDirectory: true)
        try? FileManager.default.removeItem(at: root)
    }

    func answer(chat: Chat, card: OptionCard, choice: String, rememberingPermission: Bool = true) async {
        // 2026-10-30: a proactive proposal answers on its own route
        if let proposal = card.proactiveProposal {
            guard case let .bot(bot) = chat else { return }
            let accept = ProactiveProposalRules.accepts(card, answer: choice)
            await perform { try await $0.answerProactiveProposal(botId: bot.id, proposalId: proposal.id, accept: accept) }
            return
        }
        guard let requestId = card.requestId else { return }
        if rememberingPermission, card.shouldRememberPermission(for: choice), case let .bot(bot) = chat {
            await alwaysAllow(bot: bot, card: card)
        }
        await answer(
            threadId: chat.threadId,
            requestId: requestId,
            choice: choice,
            isPermission: card.isPermission,
            reviewedSha256: card.skillRequest?.reviewedSha256
        )
    }

    /// Synchronously seal a credential before the caller starts an async
    /// request. The caller can then erase its input immediately and retain
    /// only this ciphertext value for an exact, idempotent retry.
    func prepareCredential(
        _ value: String,
        chat: Chat,
        message: Message,
        secret: SecretRequestCardData
    ) throws -> PreparedPhoneCredential {
        guard let client, let connection else {
            throw APIError.transport("This computer is offline.")
        }
        guard let publicKey = connection.secretPublicKey,
              let deviceId = connection.companionDeviceId,
              let target = secret.target,
              let requestKey = secret.requestKey
        else { throw PhoneSecretError.unavailable }
        guard client.connection.activeEndpoint?.protectsCredentials == true else {
            throw PhoneSecretError.insecureTransport
        }

        let botId = try credentialBotID(chat: chat, message: message)
        let context = PhoneSecretRequestContext(
            deviceId: deviceId,
            botId: botId,
            threadId: chat.threadId,
            messageId: message.id,
            target: target,
            requestKey: requestKey
        )
        let keyId = try PhoneSecretCrypto.publicKeyId(publicKey)
        let requestIdentity = phoneCredentialRequestIdentity(
            connectionID: connection.id,
            botID: botId,
            context: context,
            keyID: keyId
        )
        if let prepared = preparedPhoneCredentials[requestIdentity] {
            return prepared
        }
        guard #available(iOS 17.0, *) else {
            // HPKE, which seals the credential end to end, is iOS 17 and up.
            // There is no weaker path worth offering for a secret.
            throw PhoneSecretError.requiresNewerOS
        }
        let envelope = try PhoneSecretCrypto.encrypt(
            value,
            publicKey: publicKey,
            context: context
        )

        let prepared = PreparedPhoneCredential(
            requestIdentity: requestIdentity,
            connectionID: connection.id,
            botID: botId,
            messageID: message.id,
            envelope: envelope
        )
        preparedPhoneCredentials[requestIdentity] = prepared
        return prepared
    }

    /// Recover an ambiguous ciphertext-only operation when a card view is
    /// recreated. This is deliberately in-memory: a force-quit forgets it,
    /// while ordinary navigation, AutoFill, and reconnects do not.
    func preparedCredential(
        chat: Chat,
        message: Message,
        secret: SecretRequestCardData
    ) -> PreparedPhoneCredential? {
        guard let connection,
              let publicKey = connection.secretPublicKey,
              let deviceId = connection.companionDeviceId,
              let target = secret.target,
              let requestKey = secret.requestKey,
              let botId = try? credentialBotID(chat: chat, message: message),
              let keyId = try? PhoneSecretCrypto.publicKeyId(publicKey)
        else { return nil }
        let context = PhoneSecretRequestContext(
            deviceId: deviceId,
            botId: botId,
            threadId: chat.threadId,
            messageId: message.id,
            target: target,
            requestKey: requestKey
        )
        return preparedPhoneCredentials[phoneCredentialRequestIdentity(
            connectionID: connection.id,
            botID: botId,
            context: context,
            keyID: keyId
        )]
    }

    func discardPreparedCredential(_ prepared: PreparedPhoneCredential) {
        if preparedPhoneCredentials[prepared.requestIdentity] == prepared {
            preparedPhoneCredentials.removeValue(forKey: prepared.requestIdentity)
        }
    }

    private func credentialBotID(chat: Chat, message: Message) throws -> String {
        switch chat {
        case let .bot(bot): return bot.id
        case .room:
            guard let sender = message.from?.botId else {
                throw PhoneSecretError.invalidRequest
            }
            return sender
        }
    }

    private func phoneCredentialRequestIdentity(
        connectionID: String,
        botID: String,
        context: PhoneSecretRequestContext,
        keyID: String
    ) -> String {
        [
            connectionID,
            keyID,
            botID,
            context.threadId,
            context.messageId,
            context.target,
            context.requestKey,
        ].joined(separator: "\u{0}")
    }

    /// Send one already-sealed operation. A retry deliberately reuses the
    /// same HPKE envelope; the desktop derives its idempotency key from these
    /// bytes, so a lost response cannot cause a second provider save.
    func provideCredential(_ prepared: PreparedPhoneCredential) async throws {
        guard let client, let connection else {
            throw APIError.transport("This computer is offline.")
        }
        guard connection.id == prepared.connectionID,
              connection.companionDeviceId == prepared.envelope.deviceId,
              let publicKey = connection.secretPublicKey,
              (try? PhoneSecretCrypto.publicKeyId(publicKey)) == prepared.envelope.keyId
        else { throw PhoneSecretError.unavailable }
        guard client.connection.activeEndpoint?.protectsCredentials == true else {
            throw PhoneSecretError.insecureTransport
        }

        do {
            try await client.provideCredential(
                botId: prepared.botID,
                messageId: prepared.messageID,
                envelope: prepared.envelope
            )
        } catch let error as APIError where error.isUnauthorized {
            handleUnauthorized()
            throw error
        }
    }

    /// The same answer, from something that only has the ids — the Live
    /// Activity's buttons. True once the harness took it, so the island can
    /// drop its buttons at once and a refused answer keeps them.
    @discardableResult
    func answer(
        threadId: String,
        requestId: String,
        choice: String,
        isPermission: Bool,
        reviewedSha256: String? = nil
    ) async -> Bool {
        // A Live Activity button can wake the app before the saved pairing
        // is restored: restore it rather than drop the answer silently.
        if client == nil, restorePending { restore() }
        guard client != nil else {
            actionError = "Unlock iPhone, then answer again."
            return false
        }
        var accepted = false
        await perform {
            // Permission cards answer allow/deny; a question answers with
            // the chosen text. The harness tells them apart by `behavior`.
            let behavior = OptionCard.responseBehavior(for: choice, isPermission: isPermission)
            if behavior != "answer" {
                try await $0.respond(
                    threadId: threadId,
                    requestId: requestId,
                    behavior: behavior,
                    reviewedSha256: behavior == "allow" ? reviewedSha256 : nil
                )
            } else {
                try await $0.respond(threadId: threadId, requestId: requestId, behavior: "answer", message: choice)
            }
            accepted = true
        }
        return accepted
    }

    /// "Always allow" — the grant key comes from the card, never from
    /// anything derived here, so the phone and the harness cannot disagree
    /// about what was just permitted.
    func alwaysAllow(bot: Bot, card: OptionCard) async {
        guard let key = card.allowKey else { return }
        await perform { try await $0.alwaysAllow(botId: bot.id, key: key, threadId: bot.threadId) }
    }

    /// Make a new bot. The harness chooses its name, colour and greeting, so
    /// one made here is indistinguishable from one made on the desktop.
    ///
    /// Creating a bot does not broadcast — the desktop adds it optimistically
    /// too — so the new bot is folded in here rather than waited for. Return
    /// it so the caller can open it, which is the only reason anyone taps the
    /// button.
    @discardableResult
    func createBot() async -> Bot? {
        guard let client else { return nil }
        do {
            let bot = try await client.createBot()
            state.apply(.bot(bot))
            return bot
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    /// Make a room from the phone. Same shape as `createBot`: fold it in
    /// rather than wait for a broadcast, and hand it back so it can be opened.
    @discardableResult
    func createRoom(name: String?, memberIds: [String], humanIds: [String] = []) async -> Room? {
        guard let client else { return nil }
        do {
            let room = try await client.createRoom(name: name, memberIds: memberIds, humanIds: humanIds)
            state.apply(.room(room))
            return room
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    /// Make a bot with the create sheet's name and look, fold it in, and
    /// hand it back so it can be opened.
    @discardableResult
    func createBot(_ draft: NewBotDraft) async -> Bot? {
        guard let client else { return nil }
        do {
            let bot = try await client.createBot(draft)
            state.apply(.bot(bot))
            return bot
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    /// Pin or unpin a bot on the home row. The row moves at once and moves
    /// back if the server refuses.
    func setPinned(_ bot: Bot, pinned: Bool) async {
        guard let client else { return }
        var moved = bot
        moved.pinned = pinned
        state.apply(.bot(moved))
        do {
            let updated = try await client.setPinned(botId: bot.id, pinned: pinned)
            state.apply(.bot(updated))
        } catch {
            if let current = state.bot(bot.id) {
                var back = current
                back.pinned = bot.pinned
                state.apply(.bot(back))
            }
            actionError = error.localizedDescription
        }
    }

    /// Pin or unpin a group. A server without group pins turns the option
    /// off for the rest of the session instead of showing an error.
    func setPinned(_ room: Room, pinned: Bool) async {
        guard let client, groupPinsSupported else { return }
        do {
            let updated = try await client.setGroupPinned(groupId: room.id, pinned: pinned)
            state.apply(.room(updated))
        } catch let error as APIError where error.isUnauthorized {
            handleUnauthorized()
        } catch {
            groupPinsSupported = false
        }
    }

    /// Load who this phone is signed in as, quietly: the home falls back to
    /// an initial or the computer's mascot when it cannot. Runs when the
    /// connection changes, when the app comes to the foreground and when
    /// Settings opens, so a new photo in Perspicax (a new version) shows
    /// without signing in again.
    func loadAccount() async {
        guard let client, let connectionID = connection?.id else { return }
        guard let session = try? await client.authSession(), connection?.id == connectionID else { return }
        account = session
        if let config = try? await client.config(), connection?.id == connectionID { viewer = config.viewer }
        await refreshAccountPhoto(session.avatar, connectionID: connectionID)
    }

    /// Show what this phone keeps for a connection at once (an offline
    /// launch keeps the last photo); the server's answer follows.
    private func showAccount(of connectionID: String?) {
        guard connectionID != accountConnectionID || connectionID == nil else { return }
        accountConnectionID = connectionID
        account = nil
        viewer = nil
        accountPhoto = AccountPhotoStore.shared.image(for: connectionID)
    }

    /// Bring the photo in line with what the session named: none clears it,
    /// a version already kept is used as is, a new one is read from this
    /// connection's own server with its bearer. A failed read keeps the last
    /// photo rather than flashing the initial; a refusal (404) drops it.
    func refreshAccountPhoto(_ avatar: AccountAvatar?, connectionID: String) async {
        let store = AccountPhotoStore.shared
        guard let avatar else {
            store.forget(connectionID)
            if connection?.id == connectionID { accountPhoto = nil }
            return
        }
        if let kept = store.image(for: connectionID, avatar: avatar) {
            if connection?.id == connectionID { accountPhoto = kept }
            return
        }
        guard let client, connection?.id == connectionID else { return }
        do {
            let data = try await client.accountAvatar(avatar)
            let image = store.store(data, avatar: avatar, connectionID: connectionID)
            if connection?.id == connectionID, let image { accountPhoto = image }
        } catch let APIError.status(code, _) where code == 404 {
            store.forget(connectionID)
            if connection?.id == connectionID { accountPhoto = nil }
        } catch {
            // offline or refused for now: keep what is shown
        }
    }

    /// The signed-in person's own photo on an organization server
    /// (2026-10-16): the cropped 256 px square goes to PUT /api/me/avatar,
    /// which writes it to Perspicax as them. On success the photo is kept
    /// under its new version at once (no download), and the session names
    /// it. Nil on success, else the sentence to show.
    func setOwnPhoto(_ data: Data, mime: String) async -> String? {
        guard let client, let connectionID = connection?.id else { return String(localized: "Perspicax could not be reached. Try again.") }
        do {
            let answer = try await client.setOwnAvatar(data, mime: mime)
            applyOwnPhoto(answer, data: data, connectionID: connectionID)
            return nil
        } catch {
            return Self.ownPhotoMessage(error)
        }
    }

    /// Remove the signed-in person's own photo: the initial again, here and
    /// in Perspicax. Nil on success, else the sentence to show.
    func removeOwnPhoto() async -> String? {
        guard let client, let connectionID = connection?.id else { return String(localized: "Perspicax could not be reached. Try again.") }
        do {
            let answer = try await client.removeOwnAvatar()
            applyOwnPhoto(answer, data: nil, connectionID: connectionID)
            return nil
        } catch {
            return Self.ownPhotoMessage(error)
        }
    }

    private func applyOwnPhoto(_ answer: OwnAvatarAnswer, data: Data?, connectionID: String) {
        account?.avatarUrl = answer.avatarUrl
        let store = AccountPhotoStore.shared
        if let avatar = answer.avatar, let data {
            let image = store.store(data, avatar: avatar, connectionID: connectionID)
            if connection?.id == connectionID { accountPhoto = image }
        } else {
            store.forget(connectionID)
            if connection?.id == connectionID { accountPhoto = nil }
        }
    }

    static func ownPhotoMessage(_ error: Error) -> String {
        switch (error as? OwnAvatarError)?.refusal {
        case .sessionOnly: return String(localized: "Only a person signed in with Pulsatrix can change this photo.")
        case .signInAgain: return String(localized: "Your Pulsatrix sign-in has expired. Sign in again, then retry.")
        case .type: return String(localized: "Choose a PNG, JPEG or WebP image.")
        case .unreadable: return String(localized: "This image could not be read.")
        case .tooLarge: return String(localized: "This image is too large.")
        case .rejected: return String(localized: "Perspicax refused this image. Try another one.")
        case .outdated: return String(localized: "Your organization's Perspicax must be updated before the photo can be changed from Sagax.")
        case .unreachable, .none: return String(localized: "Perspicax could not be reached. Try again.")
        }
    }

    /// Switch Account shows each saved connection's own photo. The ones not
    /// in use are asked once, each through its own server and bearer, with a
    /// short timeout; one that does not answer keeps its last photo.
    func refreshSavedAccountPhotos() async {
        guard !isDemo else { return }
#if DEBUG
        if ParityLaunch.current != nil { return }
#endif
        let others = connections.filter { $0.id != connection?.id }
        for saved in others {
            guard let stored = try? Keychain.token(for: saved.id) else { continue }
            let client = CompanionClient(connection: saved, token: stored, requestTimeout: 8)
            guard let session = try? await client.authSession() else { continue }
            let store = AccountPhotoStore.shared
            guard let avatar = session.avatar else { store.forget(saved.id); continue }
            if store.image(for: saved.id, avatar: avatar) != nil { continue }
            if let data = try? await client.accountAvatar(avatar) { store.store(data, avatar: avatar, connectionID: saved.id) }
        }
    }

    /// Create a sidebar section by assigning its complete starting set in one
    /// request. The server commits the batch before returning, then these
    /// folds make the roster move immediately instead of waiting for SSE.
    @discardableResult
    func assignSection(name: String, botIds: [String]) async -> [Bot]? {
        guard let client else { return nil }
        do {
            let bots = try await client.assignSection(name: name, botIds: botIds)
            for bot in bots { state.apply(.bot(bot)) }
            return bots
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    func interrupt(bot: Bot) async {
        await perform { try await $0.interrupt(botId: bot.id, threadId: bot.threadId) }
    }

    // MARK: - Live calls (App/Call/)

    /// The live client for a call's voice routes. Nil offline.
    var callClient: CompanionClient? { client }

    /// A turn said on a live call: the ordinary send to the bot's thread,
    /// marked as a call turn (`voiceCall`) like the desktop's. False when
    /// the computer refused it (the reason is in `actionError`).
    func sendCallTurn(_ text: String, to bot: Bot, threadId: String, voiceCall: VoiceCallMeta) async -> Bool {
        let connectionID = client?.connection.id
        var receipt: SendReceipt?
        var sent = false
        await perform {
            receipt = try await $0.send(text: text, toBot: bot.id, threadId: threadId, voiceCall: voiceCall, singleStream: !SidebarPrefsModel.shared.showThreads)
            sent = true
        }
        if sent, client?.connection.id == connectionID { rememberQueuedSend(from: receipt, text: text) }
        return sent
    }

    /// Stop a room's running turn (a barge-in on a group call).
    func interrupt(room: Room) async {
        await perform(quietly: true) { try await $0.interrupt(roomId: room.id) }
    }

    /// Interrupt quietly: a call's barge-in on a turn that may have just ended.
    func interruptQuietly(botId: String, threadId: String) async {
        await perform(quietly: true) { try await $0.interrupt(botId: botId, threadId: threadId) }
    }

    /// The live client for the computer viewer's input, clipboard and control
    /// calls (ComputerView), which handle their own refusals. Nil offline.
    var computerClient: CompanionClient? { client }

    /// Ask for one fresh cloud viewer URL. Unlike ordinary actions this
    /// returns the value to a browser sheet and never writes it to app state.
    func cloudDesktop(for bot: Bot) async throws -> URL {
        guard let client else { throw APIError.transport("This computer is offline.") }
        do {
            return try await client.cloudDesktop(botId: bot.id).url
        } catch let error as APIError where error.isUnauthorized {
            handleUnauthorized()
            throw error
        }
    }

    func markRead(_ chat: Chat) async {
        await perform(quietly: true) {
            switch chat {
            case let .bot(bot): try await $0.markRead(botId: bot.id, threadId: bot.threadId)
            case let .room(room):
                // a person's conversation reads its open thread only (#262)
                if let threadId = PersonThreads.readTarget(room) {
                    try await $0.markRead(roomId: room.id, threadId: threadId)
                } else {
                    try await $0.markRead(roomId: room.id)
                }
            }
        }
    }

    func loadOlder(threadId: String) async {
        guard let client, let oldest = state.transcript(forThread: threadId).first else { return }
        do {
            let page = try await client.messages(threadId: threadId, before: oldest.id, limit: 50)
            state.prepend(page, toThread: threadId)
        } catch {
            actionError = error.localizedDescription
        }
    }

    /// Reload the bots and rooms from the server (`GET /api/bots`), for a
    /// chat the phone cannot show from what it holds. On an organization
    /// server this list also starts the person's own thread with a bot they
    /// have none with yet. False when there is no server or it failed; the
    /// caller then explains instead of guessing.
    @discardableResult
    func reloadConversations() async -> Bool {
        guard let client else { return false }
        do {
            try await hydrate(using: client)
            return true
        } catch {
            log.info("reload for an open failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    /// A pinned background thread may not be in a fresh fleet snapshot.
    func loadThreadIfNeeded(_ threadId: String) async {
        // A bot with no thread of the person's yet has nothing to load.
        guard let client, !threadId.isEmpty, !state.hasLoadedPage(forThread: threadId) else { return }
        do {
            let page = try await client.messages(threadId: threadId)
            state.merge(page, intoThread: threadId)
        } catch { if !Task.isCancelled { actionError = error.localizedDescription } }
    }

    func image(threadId: String, messageId: String) async -> Data? {
        try? await client?.image(threadId: threadId, messageId: messageId)
    }

    func absoluteAPIURL(path: String) -> URL? {
        guard let base = client?.connection.baseURL else { return nil }
        let normalized = path.hasPrefix("/") ? path : "/\(path)"
        return URL(string: normalized, relativeTo: base)?.absoluteURL
    }

    func youtubeTranscript(videoId: String) async throws -> YouTubeTranscriptResponse {
        guard let client else { throw APIError.transport("This computer is offline.") }
        return try await client.youtubeTranscript(videoId: videoId)
    }

    /// The search sheet's messages: nil when the server could not answer,
    /// so the sheet says so instead of "No results".
    func searchMessages(_ query: String) async -> [SearchHit]? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2, let client else { return [] }
        do { return try await client.search(trimmed) } catch { return nil }
    }

    func search(_ query: String) async -> [SearchHit] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2, let client else { return [] }
        do { return try await client.search(trimmed) }
        catch {
            actionError = error.localizedDescription
            return []
        }
    }

    /// Resolve a SQLite search hit into the live task/branch, load a page
    /// around it, and hand navigation the current chat record.
    func open(_ hit: SearchHit) async -> Chat? {
        guard let client else { return nil }
        do {
            if let botId = hit.botId, var bot = state.bot(botId) {
                // One conversation (SingleStream.landing): the conversation
                // stays; an earlier topic is brought on screen, a thread
                // outside the stream opens beside it, the hit revealed there
                if !SidebarPrefsModel.shared.showThreads, let landed = await land(bot: bot, threadId: hit.threadId, using: client) {
                    if !hit.onActivePath {
                        let leaf = try await client.setActiveBranch(botId: bot.id, messageId: hit.messageId, threadId: hit.threadId)
                        state.apply(.thread(threadId: hit.threadId, activeLeafId: leaf))
                    }
                    let page = try await client.messages(threadId: hit.threadId, around: hit.messageId)
                    state.merge(page, intoThread: hit.threadId)
                    focusedMessageId = hit.messageId
                    return .bot(landed)
                }
                if bot.threadId != hit.threadId {
                    bot = try await client.switchTask(botId: bot.id, threadId: hit.threadId)
                    state.apply(.bot(bot))
                }
                if !hit.onActivePath {
                    let leaf = try await client.setActiveBranch(botId: bot.id, messageId: hit.messageId, threadId: hit.threadId)
                    state.apply(.thread(threadId: hit.threadId, activeLeafId: leaf))
                }
                let page = try await client.messages(threadId: hit.threadId, around: hit.messageId)
                state.merge(page, intoThread: hit.threadId)
                focusedMessageId = hit.messageId
                return state.bot(forThread: hit.threadId).map(Chat.bot)
            }
            if let groupId = hit.groupId,
               var room = state.rooms.first(where: { $0.id == groupId }) {
                if room.threadId != hit.threadId {
                    room = try await client.switchTask(groupId: room.id, threadId: hit.threadId)
                    state.apply(.room(room))
                }
                let page = try await client.messages(threadId: hit.threadId, around: hit.messageId)
                state.merge(page, intoThread: hit.threadId)
                focusedMessageId = hit.messageId
                return state.rooms.first(where: { $0.id == groupId }).map(Chat.room)
            }
        } catch { actionError = error.localizedDescription }
        return nil
    }

    func consumeFocus(_ messageId: String) {
        if focusedMessageId == messageId { focusedMessageId = nil }
    }

    @discardableResult
    func createTask(for bot: Bot, title: String?, confidential: Bool? = nil) async -> Bot? {
        guard let client else { return nil }
        do {
            let updated = try await client.createTask(botId: bot.id, title: title, confidential: confidential)
            state.apply(.bot(updated))
            return updated
        } catch { actionError = error.localizedDescription; return nil }
    }

    @discardableResult
    func switchTask(_ task: BotTask, for bot: Bot) async -> Bot? {
        guard let client else { return nil }
        do {
            let updated = try await client.switchTask(botId: bot.id, threadId: task.threadId)
            state.apply(.bot(updated))
            return updated
        } catch { actionError = error.localizedDescription; return nil }
    }

    @discardableResult
    func renameTask(_ task: BotTask, for bot: Bot, title: String) async -> Bool {
        guard let client else { return false }
        do {
            try await client.renameTask(botId: bot.id, threadId: task.threadId, title: title)
            await refresh()
            return true
        } catch { actionError = error.localizedDescription; return false }
    }

    /// Snooze or wake a bot thread. Desktop parity: bots only — group
    /// threads have no snooze on the wire either.
    func snoozeTask(_ task: BotTask, for bot: Bot, snoozedUntil: Double?) async -> Bool {
        guard let client else { return false }
        do {
            try await client.snoozeTask(botId: bot.id, threadId: task.threadId, snoozedUntil: snoozedUntil)
            await refresh()
            return true
        } catch { actionError = error.localizedDescription; return false }
    }

    @discardableResult
    func setTaskPinned(_ task: BotTask, pinned: Bool, in chat: Chat) async -> Bool {
        guard let client else { return false }
        setPinnedLocally(task, pinned: pinned, in: chat)
        do {
            switch chat {
            case let .bot(bot):
                try await client.setTaskPinned(botId: bot.id, threadId: task.threadId, pinned: pinned)
            case let .room(room):
                try await client.setRoomTaskPinned(groupId: room.id, threadId: task.threadId, pinned: pinned, title: task.title)
            }
            await refresh()
            return true
        } catch {
            setPinnedLocally(task, pinned: task.pinned == true, in: chat)
            actionError = error.localizedDescription
            return false
        }
    }

    /// Move the row before the server answers, and put it back if the write fails.
    private func setPinnedLocally(_ task: BotTask, pinned: Bool, in chat: Chat) {
        let value: Bool? = pinned ? true : nil
        switch chat {
        case let .bot(bot):
            guard let botIndex = state.bots.firstIndex(where: { $0.id == bot.id }),
                  var tasks = state.bots[botIndex].tasks,
                  let taskIndex = tasks.firstIndex(where: { $0.threadId == task.threadId }) else { return }
            tasks[taskIndex].pinned = value
            state.bots[botIndex].tasks = tasks
        case let .room(room):
            guard let roomIndex = state.rooms.firstIndex(where: { $0.id == room.id }),
                  var tasks = state.rooms[roomIndex].tasks,
                  let taskIndex = tasks.firstIndex(where: { $0.threadId == task.threadId }) else { return }
            tasks[taskIndex].pinned = value
            state.rooms[roomIndex].tasks = tasks
        }
    }

    @discardableResult
    func setTaskArchived(_ task: BotTask, for bot: Bot, archivedAt: Double?) async -> Bool {
        guard let client else { return false }
        do {
            try await client.archiveTask(botId: bot.id, threadId: task.threadId, archivedAt: archivedAt)
            await refresh()
            return true
        } catch { actionError = error.localizedDescription; return false }
    }

    @discardableResult
    func deleteTask(_ task: BotTask, for bot: Bot) async -> Bot? {
#if DEBUG
        // The native UI fixture has no paired client. This explicit launch
        // mode exercises list updates and a partial batch failure entirely
        // offline, without touching a person's conversations.
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-threads-preview-deletion"),
           var updated = state.bot(bot.id),
           task.threadId != bot.threadId,
           updated.visibleTasks.contains(where: { $0.threadId == task.threadId && !$0.isWorking }) {
            if arguments.contains("-threads-preview-deletion-fails-weekend")
                && task.threadId == "preview-weekend" {
                actionError = "Synthetic deletion failure"
                return nil
            }
            updated.tasks?.removeAll { $0.threadId == task.threadId }
            state.apply(.bot(updated))
            return updated
        }
#endif
        guard let client else { return nil }
        do {
            let updated = try await client.deleteTask(botId: bot.id, threadId: task.threadId)
            state.apply(.bot(updated))
            return updated
        } catch { actionError = error.localizedDescription; return nil }
    }

    @discardableResult
    func createTask(for room: Room, title: String?) async -> Bool {
        guard let client else { return false }
        do { state.apply(.room(try await client.createTask(groupId: room.id, title: title))); return true }
        catch { actionError = error.localizedDescription; return false }
    }

    @discardableResult
    func switchTask(_ task: BotTask, for room: Room) async -> Bool {
        guard task.threadId != room.threadId else { return true }
        guard let client else { return false }
        do { state.apply(.room(try await client.switchTask(groupId: room.id, threadId: task.threadId))); return true }
        catch { actionError = error.localizedDescription; return false }
    }

    @discardableResult
    func renameTask(_ task: BotTask, for room: Room, title: String) async -> Bool {
        guard let client else { return false }
        do {
            try await client.renameTask(groupId: room.id, threadId: task.threadId, title: title)
            await refresh()
            return true
        } catch { actionError = error.localizedDescription; return false }
    }

    @discardableResult
    func deleteTask(_ task: BotTask, for room: Room) async -> Bool {
        guard let client else { return false }
        do { state.apply(.room(try await client.deleteTask(groupId: room.id, threadId: task.threadId))); return true }
        catch { actionError = error.localizedDescription; return false }
    }

    // MARK: - Agent profile

    /// The model catalog lives on the paired computer because availability
    /// depends on which engines are installed and signed in there.
    func modelInstances() async -> [Instance] {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-model-menu-preview"),
           let url = Bundle.main.url(forResource: "ModelMenuPreview", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let list = try? JSONDecoder().decode(InstanceList.self, from: data) {
            return list.instances
        }
        #endif
        guard let client else { return [] }
        do {
            return try await client.instances()
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
            return []
        }
    }

    /// UI model choices update every thread silently; explicit false remains
    /// available to low-level callers that need a thread-local override.
    func updateModel(_ selection: ModelSelection, for bot: Bot, updateBotDefault: Bool? = nil) async -> Bot? {
        guard let client else { return nil }
        do {
            let updated = try await client.updateModel(botId: bot.id, selection: selection, threadId: bot.threadId, updateBotDefault: updateBotDefault ?? true)
            guard !Task.isCancelled else { return nil }
            state.apply(.bot(updated))
            return updated
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
            return nil
        }
    }

    /// More > Permissions' Sending on your behalf (an admin session's field,
    /// and the owner's on their own bot on an organization server).
    func updateOutbound(_ outbound: OutboundPolicy, for bot: Bot) async -> Bot? {
        guard let client else { return nil }
        do {
            let updated = try await client.setBotOutbound(botId: bot.id, outbound: outbound)
            guard !Task.isCancelled else { return nil }
            state.apply(.bot(updated))
            return updated
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
            return nil
        }
    }

    /// More > Model's Backup models (an admin session's field).
    func updateFallback(_ fallback: [ModelSelection], for bot: Bot) async -> Bot? {
        guard let client else { return nil }
        do {
            let updated = try await client.setBotFallback(botId: bot.id, fallback: fallback)
            guard !Task.isCancelled else { return nil }
            state.apply(.bot(updated))
            return updated
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
            return nil
        }
    }

    func updateProfile(_ patch: BotProfilePatch, for bot: Bot) async -> Bot? {
        guard let client else { return nil }
        do {
            let updated = try await client.updateProfile(botId: bot.id, patch: patch)
            guard !Task.isCancelled else { return nil }
            state.apply(.bot(updated))
            return updated
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
            return nil
        }
    }

    func uploadAvatar(_ data: Data, mime: String, for bot: Bot, crop: AvatarCrop) async -> Bot? {
        guard let client else { return nil }
        do {
            let avatarUrl = try await client.uploadAvatar(data: data, mime: mime)
            guard !Task.isCancelled else { return nil }
            let current = state.bot(bot.id) ?? bot
            return await updateProfile(
                BotProfilePatch(avatarUrl: .set(avatarUrl), avatarCrop: crop),
                for: current
            )
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
            return nil
        }
    }

    func generateAvatar(prompt: String, for bot: Bot) async -> Bot? {
        guard let client else { return nil }
        do {
            let updated = try await client.generateAvatar(botId: bot.id, prompt: prompt)
            guard !Task.isCancelled else { return nil }
            state.apply(.bot(updated))
            return updated
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
            return nil
        }
    }

    func avatarData(for bot: Bot) async -> Data? {
        guard let path = bot.avatarUrl, let client else { return nil }
        // Each account's pictures under its own key: one server's never shows on another's.
        let account = "\(connection?.id ?? "-")|\(path)"
        let key = account as NSString
        if let cached = avatarCache.object(forKey: key) { return cached as Data }
        let generation = avatarCacheGeneration
        let fetch: (id: UUID, task: Task<Data?, Never>)
        if let pending = avatarFetches[account] {
            fetch = pending
        } else {
            let pending = (
                id: UUID(),
                task: Task<Data?, Never> { try? await client.avatar(path: path) }
            )
            avatarFetches[account] = pending
            fetch = pending
        }
        let data = await fetch.task.value
        if avatarFetches[account]?.id == fetch.id { avatarFetches.removeValue(forKey: account) }
        guard !Task.isCancelled, generation == avatarCacheGeneration, let data else { return nil }
        avatarCache.setObject(data as NSData, forKey: key, cost: data.count)
        return data
    }

    /// Stop the downloads in flight; what is cached stays (keyed by account).
    private func cancelAvatarFetches() {
        avatarCacheGeneration += 1
        for fetch in avatarFetches.values { fetch.task.cancel() }
        avatarFetches.removeAll()
        voiceNoteCacheGeneration += 1
        for fetch in voiceNoteFetches.values { fetch.task.cancel() }
        voiceNoteFetches.removeAll()
        voiceNoteCache.removeAllObjects()
    }

    private func resetAvatarCache() {
        avatarCacheGeneration += 1
        for fetch in avatarFetches.values { fetch.task.cancel() }
        avatarFetches.removeAll()
        avatarCache.removeAllObjects()
        voiceNoteCacheGeneration += 1
        for fetch in voiceNoteFetches.values { fetch.task.cancel() }
        voiceNoteFetches.removeAll()
        voiceNoteCache.removeAllObjects()
    }

    func voiceOptions() async -> [Voice] {
        guard let client else { return [] }
        do { return try await client.voices() }
        catch { actionError = error.localizedDescription; return [] }
    }

    /// Cached voice-note bytes for the transcript bubble, shaped like
    /// avatarData so replay and scroll-back never refetch the same clip.
    func voiceNoteData(for note: MessageVoiceNote) async -> Data? {
        guard let client else { return nil }
        let key = note.path as NSString
        if let cached = voiceNoteCache.object(forKey: key) { return cached as Data }
        let generation = voiceNoteCacheGeneration
        let fetch: (id: UUID, task: Task<Data?, Never>)
        if let pending = voiceNoteFetches[note.path] {
            fetch = pending
        } else {
            let pending = (
                id: UUID(),
                task: Task<Data?, Never> { try? await client.voiceNote(path: note.path) }
            )
            voiceNoteFetches[note.path] = pending
            fetch = pending
        }
        let data = await fetch.task.value
        if voiceNoteFetches[note.path]?.id == fetch.id { voiceNoteFetches.removeValue(forKey: note.path) }
        guard !Task.isCancelled, generation == voiceNoteCacheGeneration, let data else { return nil }
        voiceNoteCache.setObject(data as NSData, forKey: key, cost: data.count)
        return data
    }

    /// A voice note the person sent (`voice-note-*.wav`, an attached file):
    /// fetched through the message's authenticated file route, then cached
    /// beside the bots' clips so replay never refetches.
    func recordedVoiceNoteData(threadId: String, messageId: String, path: String) async -> Data? {
        guard let client else { return nil }
        let key = "file:\(messageId):\(path)" as NSString
        if let cached = voiceNoteCache.object(forKey: key) { return cached as Data }
        let generation = voiceNoteCacheGeneration
        guard let file = try? await client.downloadFile(threadId: threadId, messageId: messageId, path: path),
              !Task.isCancelled, generation == voiceNoteCacheGeneration
        else { return nil }
        voiceNoteCache.setObject(file.data as NSData, forKey: key, cost: file.data.count)
        return file.data
    }

    /// The server's answer about voice mode for one bot, kept a minute
    /// (the desktop's `useVoiceModeCheck`): dictation, voice notes and a
    /// reply read aloud ask it before choosing xAI's ears or voice. Nil
    /// when the server could not be asked (`voiceStatusError` says why).
    func voiceModeStatus(botId: String) async -> VoiceModeStatus? {
        guard let client, !isDemo else { return nil }
        if let cached = voiceStatusCache[botId], Date().timeIntervalSince(cached.at) < 60 { return cached.status }
        do {
            let status = try await client.voiceModeStatus(botId: botId)
            voiceStatusCache[botId] = (status, Date())
            voiceStatusError = nil
            return status
        } catch {
            voiceStatusError = error.localizedDescription
            return nil
        }
    }

    /// The status is asked again at the next need (a key just added works at once).
    func forgetVoiceModeStatus() { voiceStatusCache = [:] }

    /// Who hears the composer's dictation for this bot (SpeechDictation):
    /// xAI on the server whenever a key serves the person (listen socket
    /// while speaking, whole-clip upload only if the socket cannot open),
    /// else Apple on this iPhone with the reason (nil when Apple is the
    /// plain choice: a demo, a room, no computer paired).
    func dictationEars(for chat: Chat) async -> SpeechDictation.Ears {
        guard let client, !isDemo, case let .bot(bot) = chat else { return .apple(reason: nil) }
        guard let status = await voiceModeStatus(botId: bot.id) else {
            return .apple(reason: String(localized: "The server could not say whether xAI voice is available\(voiceStatusError.map { " (\($0))" } ?? "")."))
        }
        guard status.available else {
            return .apple(reason: VoiceWords.refusalLines(cause: status.refusal?.cause ?? "no_credentials", admin: status.refusal?.admin == true).joined(separator: " "))
        }
        let threadId = chat.threadId
        let language = VoiceModeSettings.decode(UserDefaults.standard.string(forKey: VoiceModeSettings.storageKey)).language
        let botId = bot.id
        return .xai(SpeechDictation.ServerEars(key: status.key) {
            LiveDictation(
                openListen: {
                    guard let request = try? client.voiceModeListenRequest(botId: botId, language: language, threadId: threadId) else { return nil }
                    let socket = URLSessionDictationSocket(request: request)
                    return (socket, socket.events)
                },
                upload: { samples in
                    try await client.voiceModeTranscription(botId: botId, wav: CallWav.encode(samples), language: language, threadId: threadId)
                }
            )
        })
    }

    /// Voice mode's xAI voice for a reply read aloud (MessageSpeaker): the
    /// person's Voice, Speed and Language and the same key order as the
    /// call, whenever a key serves them.
    func readAloudVoice(botId: String?) async -> MessageSpeaker.VoiceModeVoice? {
        guard let client, !isDemo, let botId, let status = await voiceModeStatus(botId: botId), status.available else { return nil }
        return MessageSpeaker.VoiceModeVoice(client: client, botId: botId, settings: VoiceModeSettings.decode(UserDefaults.standard.string(forKey: VoiceModeSettings.storageKey)))
    }

    /// The words of a recorded voice note, through the same speech to text
    /// as the desktop's voice notes (`/voice/transcribe`, in clips under the
    /// route's limit). Nil when this bot has no speech to text (no xAI
    /// voice); "" when it has but the words could not be read.
    func transcribeVoiceNote(pcm: Data, sampleRate: Int, botId: String, threadId: String?) async -> String? {
        guard let client else { return nil }
        guard let status = await voiceModeStatus(botId: botId), status.available else { return nil }
        var parts: [String] = []
        for clip in VoiceNoteRecording.transcriptionClips(pcm: pcm, sampleRate: sampleRate) {
            guard !Task.isCancelled else { return "" }
            guard let heard = try? await client.voiceModeTranscribe(botId: botId, wav: clip, language: "auto", threadId: threadId) else {
                return ""
            }
            let trimmed = heard.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { parts.append(trimmed) }
        }
        return parts.joined(separator: " ")
    }

    /// Switch the workspace's voice engine. The fresh status comes back so
    /// the caller can re-derive every provider-dependent row in place.
    func setVoiceProvider(_ provider: VoiceProvider) async -> ConfigStatus? {
        guard let client else { return nil }
        do { return try await client.setVoiceProvider(provider) }
        catch { actionError = error.localizedDescription; return nil }
    }

    func saveChatterboxServer(baseURL: String, model: String) async -> ConfigStatus? {
        guard let client else { return nil }
        do { return try await client.saveChatterboxServer(baseURL: baseURL, model: model) }
        catch { actionError = error.localizedDescription; return nil }
    }

    /// The host's platform, which decides whether its built-in voices are a
    /// real engine choice there or a row that must stay disabled.
    func serverEnvironment() async -> ServerEnvironment? {
        guard let client else { return nil }
        return try? await client.environment()
    }

    func previewVoice(_ voiceId: String, for bot: Bot) async -> Data? {
        guard let client else { return nil }
        do { return try await client.previewVoice(text: "Hello, I'm \(bot.name).", voiceId: voiceId) }
        catch { actionError = error.localizedDescription; return nil }
    }

    func configStatus() async -> ConfigStatus? {
        guard let client else { return nil }
        let connectionID = connection?.id
        let config = try? await client.config()
        // keep the viewer the gate reads in step with each read
        if let config, connection?.id == connectionID, config.viewer != viewer { viewer = config.viewer }
        return config
    }

    /// New bot's presets (NB2). Nothing when the pairing may not read them or
    /// the computer refuses: the built-in roles stay, as on the desktop.
    func botPresets() async -> [BotPreset] {
        guard let client, surfaceGate.allows(.createBotPresets) else { return [] }
        return (try? await client.botPresets()) ?? []
    }

    func botOverview(for bot: Bot) async -> BotOverview? {
        guard let client else { return nil }
        let connectionID = connection?.id
        do {
            let overview = try await client.overview(botId: bot.id)
            guard !Task.isCancelled, connection?.id == connectionID else { return nil }
            return overview
        } catch {
            guard !Task.isCancelled, connection?.id == connectionID else { return nil }
            guard !(error is CancellationError), (error as? URLError)?.code != .cancelled else { return nil }
            actionError = error.localizedDescription
            return nil
        }
    }

    // MARK: - Routines

    /// The bot profile's own calls (`App/Profile/`, `ClientProfile.swift`).
    var profileClient: CompanionClient? { client }

    /// Fold a bot the profile just saved, or drop one it deleted.
    func applyProfileBot(_ bot: Bot) { state.apply(.bot(bot)) }
    #if DEBUG
    /// The iPad parity harness injects transcript rows that exist only on
    /// this screen, as the desktop reference injects them into its store.
    func parityApply(_ frame: Frame) { state.apply(frame) }
    #endif
    func applyBotDeleted(_ botId: String) { state.apply(.botDeleted(botId: botId)) }
    func applyRoom(_ room: Room) { state.apply(.room(room)) }
    func applyRoomDeleted(_ groupId: String) { state.apply(.roomDeleted(groupId: groupId)) }

    func loadRoutines() async -> (routines: [Routine], runs: [RoutineRun]) {
        guard let client else { return ([], []) }
        do { return try await client.routines() }
        catch { actionError = error.localizedDescription; return ([], []) }
    }

    /// The listing with each bot's folder order (2026-10-28, RoutineFolders).
    /// An older server sends no folders: every routine is in no folder.
    func loadRoutineListing() async -> RoutineListing {
        guard let client else { return RoutineListing(routines: [], runs: []) }
        do {
            let listing = try await client.routineListing()
            if listing.foldersSupported { routineFoldersMissing = false }
            return listing
        }
        catch { actionError = error.localizedDescription; return RoutineListing(routines: [], runs: []) }
    }

    /// One action on a bot's routine folders: create, rename, delete (its
    /// routines go back to no folder), reorder, move, Sort by prefix and its
    /// Undo. Whoever may change the bot's routines; no admin right.
    @discardableResult
    func routineFolderAction(_ action: RoutineFolderAction) async -> RoutineFolderResult? {
        guard let client else { return nil }
        do { return try await client.routineFolders(action) }
        catch let error as APIError where error.isRouteMissing { routineFoldersMissing = true; return nil }
        catch { actionError = error.localizedDescription; return nil }
    }

    /// Pause or resume every routine of a folder the person may change,
    /// one PATCH each (`setRoutineEnabled`).
    func setRoutinesEnabled(_ routines: [Routine], enabled: Bool) async {
        let targets = enabled ? RoutinePauseAll.resumable(routines) : RoutinePauseAll.pausable(routines)
        for routine in targets { _ = await setRoutineEnabled(routine, enabled: enabled) }
    }

    /// AU20: the Automations listing in a scope. A scope the server refuses
    /// (a permission taken back since) falls back to Mine.
    func loadScopedRoutines(_ query: RoutineScopeQuery) async -> ScopedRoutines {
        guard let client else { return ScopedRoutines(routines: [], runs: []) }
        do {
            let scoped = try await client.routines(in: query)
            if scoped.foldersSupported { routineFoldersMissing = false }
            return scoped
        }
        catch {
            if query.scope != .mine, let mine = try? await client.routines(in: query.choosing(.mine)) { return mine }
            actionError = error.localizedDescription
            return ScopedRoutines(routines: [], runs: [])
        }
    }

    func loadRoutineRunAvailability() async -> RoutineRunAvailability? {
        guard let client else { return nil }
        do {
            async let config = client.config()
            async let instances = client.instances()
            return try await RoutineRunAvailability(config: config, instances: instances)
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    /// Create a routine, or save an edit of `original`. An edit sends only
    /// the fields that changed (`RoutinePatch`): the phone's editor shows a
    /// subset of a routine and must never clear what it does not show.
    func saveRoutine(_ input: RoutineInput, original: Routine?) async -> Routine? {
        guard let client else { return nil }
        do {
            if let original { return try await client.updateRoutine(original, input: input) }
            // routines act in their owner's name, no consent (#149)
            return try await client.createRoutine(input)
        } catch { actionError = error.localizedDescription; return nil }
    }

    /// 2026-10-26: Resume on the notice of a routine that paused itself
    /// (RoutineAutoPause): back on, the failure count from zero.
    func resumeRoutine(id: String) async -> Routine? {
        guard let client else { return nil }
        do { return try await client.setRoutineEnabled(id: id, enabled: true) }
        catch { actionError = error.localizedDescription; return nil }
    }

    func renameRoutine(_ routine: Routine, name: String) async -> Routine? {
        guard let client, let clean = RoutineName.clean(name) else { return nil }
        do { return try await client.renameRoutine(id: routine.id, name: clean) }
        catch { actionError = error.localizedDescription; return nil }
    }

    func setRoutineEnabled(_ routine: Routine, enabled: Bool) async -> Routine? {
        guard let client else { return nil }
        do { return try await client.setRoutineEnabled(id: routine.id, enabled: enabled) }
        catch { actionError = error.localizedDescription; return nil }
    }

    /// `present`, `away` or `unknown`. Nil when the computer did not answer.
    func loadRoutineAwayState() async -> String? {
        guard let client else { return nil }
        return try? await client.routineAwayState()
    }

    func markRoutineAwaySeen(_ routine: Routine) async -> Routine? {
        guard let client else { return nil }
        do { return try await client.markRoutineAwaySeen(id: routine.id) }
        catch { actionError = error.localizedDescription; return nil }
    }

    func loadTriggers() async -> (hooks: [WebhookListing], baseURL: String?) {
        guard let client else { return ([], nil) }
        guard let list = try? await client.webhooks() else { return ([], nil) }
        return (list.webhooks, list.ingress?.baseUrl)
    }

    func setWebhookEnabled(id: String, enabled: Bool) async -> WebhookListing? {
        guard let client else { return nil }
        do { return try await client.setWebhookEnabled(id: id, enabled: enabled) }
        catch { actionError = error.localizedDescription; return nil }
    }

    /// The webhooks and where deliveries land (a routine's webhook block).
    func loadWebhooks() async -> WebhooksResponse? {
        guard let client else { return nil }
        return try? await client.webhooks()
    }

    /// Show a webhook's key: the one waiting since creation, or a new one.
    /// The key is returned to the screen, never kept here.
    func webhookKey(id: String, action: RoutineWebhook.KeyAction) async throws -> WebhookKeyResponse {
        guard let client else { throw APIError.transport(String(localized: "Not connected")) }
        return try await client.webhookKey(id: id, action: action)
    }

    /// "Create its webhook" for a webhook routine saved without one.
    func createRoutineWebhook(_ routine: Routine) async throws -> Routine {
        guard let client else { throw APIError.transport(String(localized: "Not connected")) }
        return try await client.createRoutineWebhook(routineId: routine.id)
    }

    func runRoutine(_ routine: Routine) async -> RoutineRun? {
        guard let client else { return nil }
        do { return try await client.runRoutine(id: routine.id) }
        catch { actionError = error.localizedDescription; return nil }
    }

    func deleteRoutine(_ routine: Routine) async -> Bool {
        guard let client else { return false }
        do { try await client.deleteRoutine(id: routine.id); return true }
        catch { actionError = error.localizedDescription; return false }
    }

    /// Cancel run (AU8): the run as the computer now has it.
    func cancelRoutineRun(_ run: RoutineRun) async -> RoutineRun? {
        guard let client else { return nil }
        do { return try await client.cancelRoutineRun(id: run.id) }
        catch { actionError = error.localizedDescription; return nil }
    }

    /// Opening a failed or missed run acknowledges it (AU9).
    func markRoutineRunSeen(_ run: RoutineRun) async -> RoutineRun? {
        guard let client else { return nil }
        do { return try await client.markRoutineRunSeen(id: run.id) }
        catch { actionError = error.localizedDescription; return nil }
    }

    /// "Mark all as read" (AU9): the ids of the runs it changed.
    func markAllRoutineRunsSeen() async -> RoutineRunsSeen {
        guard let client else { return RoutineRunsSeen() }
        do { return try await client.markAllRoutineRunsSeen() }
        catch { actionError = error.localizedDescription; return RoutineRunsSeen() }
    }

    /// A routine attachment (AU14): the file goes to the computer, the
    /// routine keeps its path there.
    func uploadRoutineAttachment(data: Data, name: String, mime: String, image: Bool) async -> RoutineAttachment? {
        guard let client else { return nil }
        do {
            if image {
                let path = try await client.uploadImage(data: data, mime: mime)
                return RoutineAttachment(id: UUID().uuidString, kind: "image", name: name, path: path, size: data.count)
            }
            let file = try await client.uploadFile(data: data, name: name, mime: mime)
            return RoutineAttachment(id: UUID().uuidString, kind: "file", name: file.name, path: file.path, size: data.count)
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    // MARK: - Notification navigation

    /// A push woke the app (`content-available`): fetch the conversations
    /// again so the icon badge counts what arrived while it was closed.
    /// The unread count the banners were last checked against.
    private var badgedUnread: Int?

    /// Something was read (here or on another device): the banners for
    /// conversations that no longer need the person leave Notification Center.
    private func withdrawSettledIfFewerUnread() {
        let count = state.unreadCount
        defer { badgedUnread = count }
        guard let before = badgedUnread, count < before else { return }
        let bots = state.bots
        let open = state.openRequestIds
        Task { await NotificationCoordinator.shared.withdrawSettled(bots: bots, openRequestIds: open) }
    }

    /// A stream is open (or kept lingering) right now.
    var hasLiveStream: Bool { streamTask != nil }

    private var lastForegroundResync: Date?

    /// Back in front with a stream that stayed open: read the server's state
    /// again (what needs the person, what is read), at most every few
    /// seconds; the badge and the banners follow it.
    func resyncOnForeground() async {
        guard !isDemo, client != nil else { return }
        if let last = lastForegroundResync, Date().timeIntervalSince(last) < 5 { return }
        lastForegroundResync = Date()
        // the hydration sets the badge and withdraws settled banners itself
        guard let client else { return }
        do {
            try await hydrate(using: client)
        } catch is CancellationError {
            // a newer stream took over: it hydrates by itself
        } catch APIError.status(code: 409, _) {
            // The live stream moved the cursor while the snapshot loaded:
            // it is working and already current. Reopening it here dropped
            // a healthy stream (and flashed "Connecting…") every time the
            // app came back during a reply.
        } catch let error as APIError where !Self.meansTheSocketDied(error) {
            log.info("foreground resync refused, keeping the stream: \(error.localizedDescription, privacy: .public)")
        } catch {
            // The stream survived the background on paper only (a socket
            // that died while the phone was locked keeps `streamTask` set
            // until the 90 s idle timeout): open a fresh one now rather than
            // show a frozen transcript for a minute and a half.
            log.notice("foreground resync failed, reopening the stream: \(error.localizedDescription, privacy: .public)")
            restartStream()
        }
    }

    /// A transport failure (the socket a locked phone let die) as opposed
    /// to an answer from a server that is evidently reachable.
    private static func meansTheSocketDied(_ error: APIError) -> Bool {
        if case .transport = error { return true }
        return false
    }

    func refreshAfterPush() async -> Bool {
        guard !isDemo, let client else { return false }
        do {
            try await hydrate(using: client)
            // The app may be suspended right after this returns: the Live
            // Activities follow the fresh state now, not after a debounce.
            await afterPushHydrate?(state)
            return true
        } catch {
            return false
        }
    }

    /// Set by the Live Activity coordinator: runs once a push has hydrated
    /// the state in the background, before the app may be suspended again.
    var afterPushHydrate: ((CompanionState) async -> Void)?

/// 2026-10-29 / #1699: Continue in the conversation opens the bot's one
    /// conversation and quotes the run's report in the composer (desktop
    /// `continueRoutineRunInConversation`).
    func continueRoutineRunInConversation(_ run: RoutineRun) async {
        let threadsShown = SidebarPrefsModel.shared.showThreads
        let target = RoutineResults.conversationTarget(for: run, bots: state.bots)
        let loaded = target.map { state.messages[$0.threadId] ?? [] } ?? []
        guard let plan = RoutineResults.continuePlan(
            for: run, bots: state.bots, messages: loaded, threadsShown: threadsShown
        ) else { return }
        if let citation = plan.citation {
            pendingComposerCitations[plan.composerThreadId, default: []].append(citation)
        }
        // Continue stays on the conversation, never the run detail (#1700).
        await openNotification(plan.target, runDetail: false)
        if let messageId = plan.focusMessageId {
            await jump(to: messageId, inThread: plan.target.threadId)
        }
    }

    /// Opens what a notification named. A routine run's push (or a link to
    /// its execution thread) opens the run's detail when this phone knows
    /// the run (#1700, desktop `openNotificationTarget`); otherwise the
    /// conversation. `runDetail: false` keeps "Open thread" / Continue on
    /// the conversation itself.
    func openNotification(_ target: NotificationTarget, runDetail: Bool = true) async {
        guard let client else {
            // Do not carry a stale destination into a future, unrelated
            // pairing. Only a saved connection waiting for Keychain access is
            // eligible for replay.
            if restorePending {
                pendingNotification = target
                connect()
            } else {
                actionError = "Pair this device with your computer to open that task."
            }
            return
        }
        pendingNotification = nil
        do {
            var bot = state.bot(target.botId)
            if bot == nil {
                try await hydrate(using: client)
                bot = state.bot(target.botId)
            }
            if runDetail {
                let listing = await loadRoutines()
                let known = Set(listing.runs.map(\.id))
                if let runId = RoutineResults.runId(
                    for: target, bots: state.bots, rooms: state.rooms, knownRunIds: known
                ), let run = listing.runs.first(where: { $0.id == runId }) {
                    notificationChat = nil
                    notificationRoutineRun = OpenedRoutineRun(
                        run: run,
                        routine: listing.routines.first { $0.id == run.routineId }
                    )
                    return
                }
            }
            // Run-only access banner and no known run: the bot, when we have
            // it (desktop opens that bot's Coding activity for the run).
            if target.threadId.isEmpty {
                if let selected = bot {
                    notificationRoutineRun = nil
                    notificationChat = .bot(selected)
                }
                return
            }
            // A room's approval/question notification carries the asker bot
            // with the ROOM's thread id — open the room rather than asking
            // the bot to switch to a thread it does not own (a 404).
            if var room = state.rooms.first(where: {
                $0.threadId == target.threadId || ($0.tasks ?? []).contains(where: { $0.threadId == target.threadId })
            }) {
                if room.threadId != target.threadId {
                    do {
                        room = try await client.switchTask(groupId: room.id, threadId: target.threadId)
                        state.apply(.room(room))
                    } catch {
                        // A stale notification should still open the channel's
                        // current task instead of leaving the person nowhere.
                    }
                }
                notificationRoutineRun = nil
                notificationChat = .room(room)
                return
            }
            guard var selected = bot else { throw APIError.status(code: 404, message: "That agent no longer exists.") }
            // One conversation (SingleStream.landing, THE gate every way
            // into a thread passes, as the desktop's openBotThread): an
            // earlier topic brings the conversation to it, a thread outside
            // the stream opens beside it; the conversation never gives way.
            if !SidebarPrefsModel.shared.showThreads,
               let landed = await land(bot: selected, threadId: target.threadId, using: client) {
                notificationRoutineRun = nil
                notificationChat = .bot(landed)
                return
            }
            if target.requiresTaskSwitch(activeThreadId: selected.threadId) {
                do {
                    selected = try await client.switchTask(botId: selected.id, threadId: target.threadId)
                    state.apply(.bot(selected))
                } catch {
                    // The thread may be gone (task deleted, stale payload).
                    // Landing in the bot's current chat still beats an error
                    // banner and no navigation at all.
                }
            }
            notificationRoutineRun = nil
            notificationChat = .bot(selected)
        } catch is CancellationError {
            // A refresh from the previous computer must not alert on the
            // newly selected connection after its generation guard rejects it.
        } catch { actionError = error.localizedDescription }
    }

    func consumeNotificationChat() { notificationChat = nil }
    func consumeNotificationRoutineRun() { notificationRoutineRun = nil }

    // MARK: - Thread chips

    /// A tapped "Opened thread #Title on Scout" chip. Lands on that thread by
    /// the route a thread row uses, which only changes what this phone is
    /// looking at — a bot mid-turn keeps working where it was. A thread the
    /// computer no longer has still lands on the bot, with a notice, rather
    /// than nowhere.
    ///
    /// Returns the thread to select in place when the chip's bot is the one
    /// already on screen. Any other bot is pushed the way a notification is,
    /// and nil comes back.
    func openThread(_ ref: ThreadRef, shownBotId: String?) async -> String? {
        guard !Task.isCancelled else { return nil }
        guard let client else {
            actionError = "Pair this device with your computer to open that thread."
            return nil
        }
        let generation = streamGeneration
        let connectionID = client.connection.id
        let requestIsCurrent = {
            !Task.isCancelled && self.streamGeneration == generation && self.client?.connection.id == connectionID
        }
        actionError = nil
        do {
            var bot = state.bot(ref.botId)
            if bot == nil {
                try await hydrate(using: client)
                guard requestIsCurrent() else { return nil }
                bot = state.bot(ref.botId)
            }
            guard var selected = bot else { throw APIError.status(code: 404, message: "That agent no longer exists.") }
            // One conversation (SingleStream.landing): the conversation,
            // brought to an earlier topic or with the thread beside it
            if !SidebarPrefsModel.shared.showThreads, let landed = await land(bot: selected, threadId: ref.threadId, using: client) {
                guard requestIsCurrent() else { return nil }
                if landed.id == shownBotId { return landed.threadId }
                notificationChat = .bot(landed)
                return nil
            }
            if selected.threadId != ref.threadId {
                do {
                    selected = try await client.switchTask(botId: selected.id, threadId: ref.threadId)
                    guard requestIsCurrent() else { return nil }
                    state.apply(.bot(selected))
                } catch APIError.status(code: 404, message: _) {
                    guard requestIsCurrent() else { return nil }
                    // The thread may be gone (deleted since the chip was
                    // written). The bot's current thread, and a word about
                    // it, beats a dead tap.
                    actionError = "That thread is no longer on your computer."
                }
            }
            guard requestIsCurrent() else { return nil }
            if selected.id == shownBotId { return selected.threadId }
            notificationChat = .bot(selected)
        } catch is CancellationError {
        } catch {
            guard requestIsCurrent() else { return nil }
            actionError = error.localizedDescription
        }
        return nil
    }

    func react(to message: Message, in threadId: String, emoji: String) async {
        guard let client else { return }
        do {
            let patched = try await client.toggleReaction(threadId: threadId, messageId: message.id, emoji: emoji)
            state.apply(.messagePatch(threadId: threadId, message: patched))
        } catch { actionError = error.localizedDescription }
    }

    /// Edit and retry. The edited text replaces the old message on screen
    /// the moment it is sent, hiding the old answer, and the computer's fork
    /// takes over as soon as either its response or its stream frames land.
    /// A failed edit simply drops the stand-in, so the old branch returns.
    func edit(_ message: Message, for bot: Bot, text: String) async {
        guard client != nil else { return }
        let threadId = bot.threadId
        let connectionId = connection?.id
        let pending = PendingEdit(sourceId: message.id, text: text, baseLeafId: state.bot(forThread: threadId)?.activeLeafId)
        state.pendingEdits[threadId] = pending
        defer {
            if state.pendingEdits[threadId] == pending { state.pendingEdits[threadId] = nil }
        }
        await perform {
            let fork = try await $0.edit(
                botId: bot.id,
                messageId: message.id,
                text: text,
                threadId: threadId,
                sendId: pending.requestId
            )
            if let fork, self.connection?.id == connectionId {
                self.state.adoptEdit(fork, inThread: threadId, expectedPending: pending)
            }
        }
    }

    // MARK: - Message actions (WP1)

    /// Regenerate: fork the newest user line with the same words, as the
    /// desktop does (ChatView.tsx `regenerate`). The old answer stays
    /// reachable through the version switcher.
    func regenerate(for bot: Bot) async {
        let messages = state.visibleTranscript(forThread: bot.threadId)
        guard bot.busy != true,
              let source = MessageActionRules.regenerateSource(
                in: messages, pendingId: state.pendingEdits[bot.threadId]?.placeholderId
              ),
              let text = source.text
        else { return }
        await edit(source, for: bot, text: text)
    }

    /// Pin a message to the top of this conversation, or clear the pin with
    /// nil. Bots pin per thread, rooms per room (the desktop's `updateTask`
    /// and `patchGroup`). The row moves at once and comes back if the
    /// computer refuses.
    func setPinnedMessage(_ messageId: String?, in chat: Chat) async {
        guard let client else { return }
        switch chat {
        case let .bot(bot):
            let previous = state.bot(bot.id)?.tasks?.first { $0.threadId == bot.threadId }?.pinnedMessageId
            setPinnedMessageLocally(messageId, botId: bot.id, threadId: bot.threadId)
            do {
                try await client.setPinnedMessage(botId: bot.id, threadId: bot.threadId, messageId: messageId)
                await refresh()
            } catch {
                setPinnedMessageLocally(previous, botId: bot.id, threadId: bot.threadId)
                actionError = error.localizedDescription
            }
        case let .room(room):
            do {
                let updated = try await client.setPinnedMessage(groupId: room.id, messageId: messageId)
                if let index = state.rooms.firstIndex(where: { $0.id == room.id }) {
                    state.rooms[index].pinnedMessageId = updated.pinnedMessageId
                }
            } catch { actionError = error.localizedDescription }
        }
    }

    private func setPinnedMessageLocally(_ messageId: String?, botId: String, threadId: String) {
        guard let botIndex = state.bots.firstIndex(where: { $0.id == botId }) else { return }
        if var tasks = state.bots[botIndex].tasks, let taskIndex = tasks.firstIndex(where: { $0.threadId == threadId }) {
            tasks[taskIndex].pinnedMessageId = messageId
            state.bots[botIndex].tasks = tasks
        }
        if state.bots[botIndex].threadId == threadId { state.bots[botIndex].pinnedMessageId = messageId }
    }

    /// Go to message on a link of one bot (its panel's Links tab): the
    /// link's conversation becomes the bot's selection and the chat on
    /// screen for that bot switches to it in place, as a thread chip does,
    /// never a second chat screen over it; then the message.
    func showLinkMessage(_ messageId: String, botId: String, threadId: String) async {
        if state.bot(botId)?.threadId != threadId {
            let opened = await openThread(ThreadRef(botId: botId, threadId: threadId, title: ""), shownBotId: botId)
            guard opened == threadId else { return }
        }
        threadSwitches[botId] = ThreadSwitch(threadId: threadId)
        await jump(to: messageId, inThread: threadId)
    }

    /// Scroll a conversation to one of its messages (a reply quote, the
    /// pinned banner). A message outside the loaded page is fetched around
    /// first, the way a search hit is.
    func jump(to messageId: String, inThread threadId: String) async {
        if !state.visibleTranscript(forThread: threadId).contains(where: { $0.id == messageId }), let client {
            do {
                let page = try await client.messages(threadId: threadId, around: messageId)
                state.merge(page, intoThread: threadId)
            } catch { actionError = error.localizedDescription; return }
        }
        focusedMessageId = messageId
    }

    /// The computer's voice for one message (`POST /api/tts/prepare`); nil
    /// when the computer cannot be asked.
    func prepareSpeech(text: String, voiceId: String?) async -> SpeechPreparation? {
        guard let client else { return nil }
        return try? await client.prepareSpeech(text: text, voiceId: voiceId)
    }

    func speechAudio(text: String, voiceId: String?) async throws -> Data {
        guard let client else { throw APIError.transport("This computer is offline.") }
        return try await client.speech(text: text, voiceId: voiceId)
    }

    func switchVersion(to message: Message, for bot: Bot) async {
        guard let client else { return }
        do {
            let leaf = try await client.setActiveBranch(botId: bot.id, messageId: message.id, threadId: bot.threadId)
            state.apply(.thread(threadId: bot.threadId, activeLeafId: leaf))
        } catch { actionError = error.localizedDescription }
    }

    func export(threadId: String, format: String) async -> URL? {
        guard let client else { return nil }
        do {
            let exported = try await client.export(threadId: threadId, format: format)
            let name = URL(fileURLWithPath: exported.filename).lastPathComponent
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try exported.data.write(to: url, options: .atomic)
            return url
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    func refreshNotificationAuthorization() async {
        notificationAuthorization = await NotificationCoordinator.shared.authorizationStatus()
        notificationAuthorizationResolved = true
    }

    func enableNotifications() async {
        if notificationAuthorization == .denied {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                await UIApplication.shared.open(url)
            }
            return
        }
        _ = await NotificationCoordinator.shared.requestAuthorization()
        await refreshNotificationAuthorization()
        NotificationCoordinator.shared.setBadge(state.unreadCount)
    }

    var notificationStatusText: String {
        switch notificationAuthorization {
        case .authorized: return "On"
        case .provisional: return "Quietly on"
        case .ephemeral: return "Temporarily on"
        case .denied: return "Off in Settings"
        case .notDetermined: return "Not enabled"
        @unknown default: return "Unknown"
        }
    }

    func perform(quietly: Bool = false, _ body: (CompanionClient) async throws -> Void) async {
        guard let client else { return }
        do {
            try await body(client)
        } catch let error as APIError where error.isUnauthorized {
            handleUnauthorized()
        } catch {
            if !quietly { actionError = error.localizedDescription }
        }
    }
}

/// A thread the chat on screen for one bot moves to (Session.threadSwitches);
/// the token makes the same thread asked twice a change.
struct ThreadSwitch: Equatable {
    let threadId: String
    let token = UUID()
}

/// A chat plus the two things a roster row shows that the record itself does
/// not carry: the preview line, and when the thread last moved. Both come out
/// of the same message — the last one in the transcript.
struct ChatSummary: Identifiable, Hashable {
    let chat: Chat
    let preview: String
    let lastActivity: Double
    let pinned: Bool

    var id: String { chat.id }
}

extension CompanionState {
    /// Everything worth showing in the chat list: pinned first, then unread,
    /// then most recently active. Hidden bots stay hidden.
    ///
    /// The derived fields are computed once here rather than asked for as the
    /// list is sorted and filtered. Each one walks a thread's messages to
    /// reach the last of them, and a comparator is called O(n log n) times
    /// while the search predicate runs over every chat on every keystroke —
    /// so the same transcript was being traversed dozens of times per frame
    /// to produce an answer that had not changed. One pass, then sort the
    /// results.
    /// - Parameter activity: how much of a bot's working-out the reader has
    ///   asked to see. The preview honours it the same way the transcript
    ///   does; `lastActivity` deliberately does not, because a thread that
    ///   just ran a tool has still moved and should still rise in the list.
    func chatSummaries(activity: ActivityDetail = .full) -> [ChatSummary] {
        let bots = self.bots.filter { $0.hidden != true }.map(Chat.bot)
        let rooms = self.rooms.map(Chat.room)
        return (bots + rooms)
            .map { chat in
                let messages = visibleTranscript(forThread: chat.threadId)
                return ChatSummary(
                    chat: chat,
                    preview: rosterPreview(messages, detail: activity),
                    lastActivity: messages.last?.at ?? 0,
                    pinned: Self.pinned(chat)
                )
            }
            .sorted { left, right in
                if left.pinned != right.pinned { return left.pinned }
                if left.chat.unread != right.chat.unread { return left.chat.unread }
                return left.lastActivity > right.lastActivity
            }
    }

    private static func pinned(_ chat: Chat) -> Bool {
        if case let .bot(bot) = chat { return bot.pinned ?? false }
        return false
    }

}


extension Session {
    func attachmentUploadState(_ id: UUID) -> AttachmentUploadState? {
        guard attachmentUploadConnections[id] == client?.connection.id else { return nil }
        return attachmentUploadStates[id]
    }

    func attachmentUploadsReady(_ attachments: [PendingMessageAttachment]) -> Bool {
        attachments.allSatisfy { attachmentUploadState($0.id)?.ready == true }
    }

    func finishAttachmentUploads(_ attachments: [PendingMessageAttachment]) async -> Bool {
        let running = attachments.compactMap { attachmentUploadTasks[$0.id] }
        for task in running { await task.value }
        return attachmentUploadsReady(attachments)
    }

    private func attachmentDraftKey(_ threadId: String, connectionID: String) -> String {
        connectionID + ":" + threadId
    }

    func pendingAttachmentDraft(threadId: String) -> [PendingMessageAttachment] {
        guard let connectionID = client?.connection.id else { return [] }
        let key = attachmentDraftKey(threadId, connectionID: connectionID)
        if let kept = attachmentDrafts[key] { return kept }
        let id = AttachmentTransferJournal.draftID(connectionID: connectionID, threadID: threadId)
        guard let manifest = try? attachmentJournal.load(id),
              let restored = try? attachmentJournal.attachments(manifest, id: id) else { return [] }
        attachmentDrafts[key] = restored
        return restored
    }

    func pendingAttachmentDraftText(threadId: String) -> String? {
        guard let connectionID = client?.connection.id else { return nil }
        let id = AttachmentTransferJournal.draftID(connectionID: connectionID, threadID: threadId)
        return (try? attachmentJournal.load(id))?.prefix
    }

    func rememberAttachmentDraftText(_ text: String, threadId: String) {
        guard let connectionID = client?.connection.id else { return }
        let key = attachmentDraftKey(threadId, connectionID: connectionID)
        attachmentDraftTextTasks[key]?.cancel()
        attachmentDraftTextTasks[key] = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 300_000_000) } catch { return }
            guard let self else { return }
            let id = AttachmentTransferJournal.draftID(connectionID: connectionID, threadID: threadId)
            guard var manifest = try? self.attachmentJournal.load(id), manifest.destination == nil else { return }
            manifest.prefix = text
            try? self.attachmentJournal.save(manifest, id: id)
            self.attachmentDraftTextTasks[key] = nil
        }
    }

    func keepAttachmentDraft(_ attachments: [PendingMessageAttachment], threadId: String, connectionID requestedConnectionID: String? = nil, text: String? = nil) {
        guard let connectionID = requestedConnectionID ?? client?.connection.id else { return }
        let key = attachmentDraftKey(threadId, connectionID: connectionID)
        attachmentDrafts[key] = attachments.isEmpty ? nil : attachments
        do {
            try attachmentJournal.saveDraft(attachments, connectionID: connectionID, threadID: threadId)
            if let text, !attachments.isEmpty {
                let id = AttachmentTransferJournal.draftID(connectionID: connectionID, threadID: threadId)
                var manifest = try attachmentJournal.load(id)
                manifest.prefix = text
                try attachmentJournal.save(manifest, id: id)
            }
        }
        catch {
            for attachment in attachments { attachmentUploadStates[attachment.id] = .failed(error.localizedDescription) }
            actionError = error.localizedDescription
            return
        }
        guard client?.connection.id == connectionID else { return }
        for attachment in attachments where attachmentUploadState(attachment.id) == nil {
            startAttachmentUpload(attachment)
        }
    }

    func startAttachmentUpload(_ attachment: PendingMessageAttachment, retry: Bool = false) {
        guard let client else { return }
        if attachmentUploadState(attachment.id) != nil && !retry { return }
        guard attachmentUploadTasks[attachment.id] == nil else { return }
        let sharedHost = surfaceGate.organization
        if retry, let draft = attachmentDrafts.first(where: { $0.value.contains(where: { $0.id == attachment.id }) }),
           draft.key.hasPrefix(client.connection.id + ":") {
            let threadID = String(draft.key.dropFirst(client.connection.id.count + 1))
            do { try attachmentJournal.saveDraft(draft.value, connectionID: client.connection.id, threadID: threadID) }
            catch { attachmentUploadStates[attachment.id] = .failed(error.localizedDescription); return }
        }
        let generation = UUID()
        attachmentUploadConnections[attachment.id] = client.connection.id
        attachmentUploadClients[attachment.id] = client
        attachmentUploadGenerations[attachment.id] = generation
        attachmentUploadStates[attachment.id] = .uploading(uploaded: 0, total: attachment.bytes)
        attachmentUploadTransientFailures.remove(attachment.id)
        attachmentUploadTasks[attachment.id] = Task { [weak self] in
            do {
                // Leaving the app keeps the usual extra running time; past
                // that, the journal resumes from the acknowledged offset.
                let saved = try await SagaxTransferActivity.run("Sagax attachment upload") {
                    try await client.uploadAttachment(attachment, sharedHost: sharedHost) { [weak self] sent, total in
                        await self?.attachmentUploadProgress(attachment.id, generation: generation, sent: sent, total: total)
                    }
                }
                guard let self, self.attachmentUploadGenerations[attachment.id] == generation else { return }
                self.attachmentUploadStates[attachment.id] = .ready(saved)
                self.attachmentUploadTasks[attachment.id] = nil
            } catch {
                guard let self, self.attachmentUploadGenerations[attachment.id] == generation else { return }
                self.attachmentUploadStates[attachment.id] = .failed(error.localizedDescription)
                self.attachmentUploadTasks[attachment.id] = nil
                // A suspended or lost network transfer resumes by itself on
                // the next foreground/connection; a refusal waits for Retry.
                if !(error is CancellationError), !AttachmentTransferDelivery.definitive(error) {
                    self.attachmentUploadTransientFailures.insert(attachment.id)
                }
            }
        }
    }

    private func attachmentUploadProgress(_ id: UUID, generation: UUID, sent: Int, total: Int) {
        guard attachmentUploadGenerations[id] == generation else { return }
        attachmentUploadStates[id] = .uploading(uploaded: sent, total: total)
        if let connectionID = attachmentUploadConnections[id],
           let draft = attachmentDrafts.first(where: { $0.key.hasPrefix(connectionID + ":") && $0.value.contains(where: { $0.id == id }) }) {
            let threadID = String(draft.key.dropFirst(connectionID.count + 1))
            try? attachmentJournal.updateProgress(sent, attachmentID: id,
                id: AttachmentTransferJournal.draftID(connectionID: connectionID, threadID: threadID))
        }
    }

    func removeAttachmentUpload(_ attachment: PendingMessageAttachment) {
        let running = attachmentUploadTasks.removeValue(forKey: attachment.id)
        running?.cancel()
        let uploadClient = attachmentUploadClients.removeValue(forKey: attachment.id)
        attachmentUploadGenerations[attachment.id] = nil
        attachmentUploadConnections[attachment.id] = nil
        attachmentUploadStates[attachment.id] = nil
        attachmentUploadTransientFailures.remove(attachment.id)
        for key in Array(attachmentDrafts.keys) {
            attachmentDrafts[key]?.removeAll { $0.id == attachment.id }
            if let connectionID = uploadClient?.connection.id, key.hasPrefix(connectionID + ":") {
                let threadID = String(key.dropFirst(connectionID.count + 1))
                try? attachmentJournal.saveDraft(attachmentDrafts[key] ?? [], connectionID: connectionID, threadID: threadID)
            }
            if attachmentDrafts[key]?.isEmpty == true { attachmentDrafts[key] = nil }
        }
        for id in attachmentJournal.ids() {
            guard let manifest = try? attachmentJournal.load(id), manifest.destination != nil,
                  manifest.entries.contains(where: { $0.id == attachment.id }) else { continue }
            try? attachmentJournal.cancel(id)
        }
        // A fresh Task has its own cancellation state. Wait for the data
        // request to settle, then clean partial or unused committed content.
        // The captured client keeps cleanup on its original computer.
        if let uploadClient {
            Task.detached {
                await running?.value
                try? await uploadClient.cancelAttachmentUpload(attachment)
            }
        }
    }

    private func consumeAttachmentUploads(_ attachments: [PendingMessageAttachment], threadId: String, connectionID: String) {
        let ids = Set(attachments.map(\.id))
        let key = attachmentDraftKey(threadId, connectionID: connectionID)
        attachmentDrafts[key]?.removeAll { ids.contains($0.id) }
        if attachmentDrafts[key]?.isEmpty == true { attachmentDrafts[key] = nil }
        for id in ids {
            attachmentUploadTasks[id] = nil
            attachmentUploadGenerations[id] = nil
            attachmentUploadClients[id] = nil
            attachmentUploadConnections[id] = nil
            attachmentUploadStates[id] = nil
            attachmentUploadTransientFailures.remove(id)
        }
    }
}


extension Session {
    func resumeNativeAttachmentTransfers() {
        guard let client else { return }
        resumeNativeAttachmentTransfers(using: client)
    }

    private func resumeNativeAttachmentTransfers(using client: CompanionClient) {
        guard attachmentRecoveryTask == nil else { return }
        attachmentRecoveryTask = Task { [weak self] in
            guard let self else { return }
            defer { self.attachmentRecoveryTask = nil }
            for id in self.attachmentJournal.ids() {
                if Task.isCancelled { return }
                guard let manifest = try? self.attachmentJournal.load(id), manifest.connectionID == client.connection.id else { continue }
                do {
                    if manifest.destination != nil {
                        let draftText = manifest.sourceDraftID.flatMap { try? self.attachmentJournal.load($0).prefix } ?? manifest.prefix
                        let delivered = try await SagaxTransferActivity.run("Sagax attachment delivery") {
                            try await AttachmentTransferDelivery(journal: self.attachmentJournal, id: id).run(using: client)
                        }
                        if delivered {
                            if let draftText { self.recoveredAttachmentDraftTexts[manifest.threadID] = draftText }
                            self.recoveredAttachmentSends.formUnion(manifest.entries.map(\.id))
                            let ids = Set(manifest.entries.map(\.id))
                            for key in Array(self.attachmentDrafts.keys) where key.hasPrefix(manifest.connectionID + ":") {
                                self.attachmentDrafts[key]?.removeAll { ids.contains($0.id) }
                                if self.attachmentDrafts[key]?.isEmpty == true { self.attachmentDrafts[key] = nil }
                            }
                        }
                    } else {
                        guard self.client?.connection.id == client.connection.id else { continue }
                        let restored = try self.attachmentJournal.attachments(manifest, id: id)
                        let key = self.attachmentDraftKey(manifest.threadID, connectionID: manifest.connectionID)
                        if self.attachmentDrafts[key] == nil { self.attachmentDrafts[key] = restored }
                        for attachment in self.attachmentDrafts[key] ?? restored {
                            if self.attachmentUploadState(attachment.id) == nil {
                                self.startAttachmentUpload(attachment)
                            } else if self.attachmentUploadTransientFailures.contains(attachment.id) {
                                self.startAttachmentUpload(attachment, retry: true)
                            }
                        }
                    }
                } catch let rejected as AttachmentTransferRejected {
                    self.actionError = rejected.message
                } catch {
                    self.actionError = String(localized: "An attachment is waiting to resume. Open its conversation to retry.")
                }
            }
        }
    }
}
