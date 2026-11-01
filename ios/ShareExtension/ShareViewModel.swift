import CompanionCore
import Foundation

struct ShareDestination: Identifiable, Hashable, Sendable {
    enum Kind: String, Sendable { case bot, channel }

    let id: String
    let routeID: String
    let threadID: String
    let name: String
    let subtitle: String
    let kind: Kind
    let latestActivity: Double
    let supportsImages: Bool

    var messageDestination: MessageDestination {
        switch kind {
        case .bot: return .bot(id: routeID, threadId: threadID)
        case .channel: return .room(id: routeID, threadId: threadID)
        }
    }
}

struct ShareComputer: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let routeLabel: String
}

struct SharePreview: Equatable, Sendable {
    var textCount = 0
    var linkCount = 0
    var attachmentNames: [String] = []
    var imageCount = 0
    var ignoredCount = 0

    var isEmpty: Bool { textCount == 0 && linkCount == 0 && attachmentNames.isEmpty }
}

private struct ShareRouteSuccess<Value: Sendable>: Sendable {
    let value: Value
    let client: CompanionClient
}

@MainActor
final class ShareViewModel: ObservableObject {
    enum Phase: Equatable {
        case idle, loading, ready, sending, sent, failed
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var computers: [ShareComputer] = []
    @Published private(set) var destinations: [ShareDestination] = []
    @Published private(set) var preview = SharePreview()
    @Published private(set) var uploadProgress: Double?
    @Published private(set) var errorMessage: String?
    @Published private(set) var rememberedDestinationID: String?
    @Published private(set) var selectedComputerID: String?
    @Published var instruction = "" {
        didSet { if instruction != oldValue { discardDurableShare(); pendingDelivery = nil } }
    }
    @Published var selectedDestinationID: String? {
        didSet { if selectedDestinationID != oldValue { discardDurableShare(); pendingDelivery = nil } }
    }

    var onCancel: (() -> Void)?
    var onComplete: (() -> Void)?

    private let context: NSExtensionContext
    private var connection: Connection?
    private var token: String?
    private var client: CompanionClient?
    private var items: LoadedShareItems?
    private var pendingDelivery: PendingDelivery?
    private var loadTask: Task<Void, Never>?
    private var sendTask: Task<Void, Never>?
    private var uploadCleanup: [UUID: (CompanionClient, PendingMessageAttachment)] = [:]
    private var durableShareID: String?
    private var shareLease: AttachmentTransferLease?
    private var loadStarted = false
    private var requestedComputerID: String?

    private struct PendingDelivery {
        let text: String
        let destination: ShareDestination
        let sendID: String
    }

    private struct FleetAttempt: Sendable {
        let index: Int
        let client: CompanionClient
        let result: Result<Fleet, APIError>
    }

    init(context: NSExtensionContext) {
        self.context = context
    }

    var selectedDestination: ShareDestination? {
        guard let selectedDestinationID else { return nil }
        return destinations.first { $0.id == selectedDestinationID }
    }

    var selectedComputer: ShareComputer? {
        guard let selectedComputerID else { return nil }
        return computers.first { $0.id == selectedComputerID }
    }

    var isRememberedSelection: Bool {
        selectedDestinationID != nil && selectedDestinationID == rememberedDestinationID
    }

    var canSend: Bool {
        phase == .ready && selectedDestination != nil && !preview.isEmpty
            && imageCompatibilityMessage == nil && instructionValidationMessage == nil
    }

    var canEdit: Bool { phase == .ready && pendingDelivery == nil }

    var canCancel: Bool { phase != .sent }

    var imageCompatibilityMessage: String? {
        guard preview.imageCount > 0,
              let selectedDestination,
              !selectedDestination.supportsImages
        else { return nil }
        return selectedDestination.kind == .channel
            ? "Every bot that may answer in this channel must use a model that supports images."
            : "\(selectedDestination.name)'s current model doesn't support images. Choose another bot or share without the image."
    }

    var instructionValidationMessage: String? {
        instruction.count > 20_000
            ? "Keep the optional instruction under 20,000 characters."
            : nil
    }

    var retrySendsPreparedMessage: Bool { pendingDelivery != nil }

    func start() async {
        guard !loadStarted else { return }
        loadStarted = true
        let task = Task { [weak self] in
            guard let self else { return }
            await self.load()
        }
        loadTask = task
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
        loadTask = nil
    }

    func retry() {
        guard sendTask == nil else { return }
        sendTask = Task { [weak self] in
            guard let self else { return }
            await self.performRetry()
            self.sendTask = nil
        }
    }

    private func performRetry() async {
        errorMessage = nil
        if let pendingDelivery {
            await deliver(pendingDelivery)
        } else if items != nil {
            phase = .loading
            do {
                let registry = SagaxSharedConnectionStore.loadRegistry()
                let selected = selectedComputerID.flatMap { registry.connection(id: $0) }
                    ?? registry.activeConnection
                guard let selected else { throw ShareExtensionError.notPaired }
                try await connect(to: selected)
                try Task.checkCancellation()
                phase = .ready
            } catch {
                guard !Task.isCancelled else { return }
                fail(error, preservePreparedDelivery: false)
            }
        } else {
            await load()
        }
    }

    func cancel() {
        guard canCancel else { return }
        loadTask?.cancel()
        loadTask = nil
        let sending = sendTask
        sending?.cancel()
        sendTask = nil
        let cleanup = Array(uploadCleanup.values)
        uploadCleanup.removeAll()
        let journal = SagaxSharedTransfers.journal
        let transferID = durableShareID
        if let transferID { try? journal?.cancel(transferID) }
        durableShareID = nil
        Task.detached {
            await sending?.value
            for (client, attachment) in cleanup { try? await client.cancelAttachmentUpload(attachment) }
            if let transferID { try? journal?.remove(transferID) }
        }
        pendingDelivery = nil
        ShareItemLoader.cleanUp(items)
        items = nil
        onCancel?()
    }

    func chooseComputer(_ id: String) async {
        guard id != selectedComputerID,
              phase == .ready || phase == .failed,
              let selected = SagaxSharedConnectionStore.loadRegistry().connection(id: id)
        else { return }
        discardDurableShare()
        requestedComputerID = id
        selectedComputerID = id
        destinations = []
        selectedDestinationID = nil
        rememberedDestinationID = nil
        pendingDelivery = nil
        phase = .loading
        do {
            try await connect(to: selected)
            phase = .ready
        } catch {
            fail(error, preservePreparedDelivery: false)
        }
    }

    func send() {
        guard sendTask == nil, canSend else { return }
        sendTask = Task { [weak self] in
            guard let self else { return }
            // Extra running time while the sheet is dismissed or the phone
            // locks; the containing app resumes anything left after that.
            await SagaxTransferActivity.run("Sagax share upload") { await self.performSend() }
            self.sendTask = nil
        }
    }

    private func performSend() async {
        guard phase == .ready,
              let items,
              let destination = selectedDestination
        else { return }
        if let imageCompatibilityMessage {
            errorMessage = imageCompatibilityMessage
            return
        }
        if let instructionValidationMessage {
            errorMessage = instructionValidationMessage
            return
        }
        phase = .sending
        errorMessage = nil
        do {
            guard let journal = SagaxSharedTransfers.journal, let connection else { throw ShareItemLoadingError.appGroupUnavailable }
            let sendID = durableShareID ?? UUID().uuidString
            let durableAttachments = items.attachments.map {
                PendingMessageAttachment(id: $0.id, fileURL: $0.url, bytes: $0.bytes, name: $0.name,
                                         mime: $0.mime, kind: $0.kind == .image ? .image : .file)
            }
            let prefix = SharedMessageComposer.compose(instruction: instruction, text: items.text, urls: items.urls, attachments: [])
            durableShareID = try journal.prepareDelivery(durableAttachments, connectionID: connection.id,
                destination: destination.messageDestination, prefix: prefix, sendID: sendID)
            shareLease = try journal.lease(sendID)
            guard shareLease != nil else { throw ShareExtensionError.alreadySending }
            defer { shareLease = nil }
            var uploaded: [SharedAttachmentReference] = []
            let totalBytes = items.attachments.reduce(0) { $0 + $1.bytes }
            var completedBytes = 0
            for attachment in items.attachments {
                try Task.checkCancellation()
                let pending = PendingMessageAttachment(
                    id: attachment.id, fileURL: attachment.url, bytes: attachment.bytes, name: attachment.name,
                    mime: attachment.mime, kind: attachment.kind == .image ? .image : .file
                )
                let alreadyUploaded = completedBytes
                let uploadedFile = try await withFailover(
                    requestTimeout: 20, deadline: nil
                ) { [weak self] client in
                    await self?.rememberUpload(client: client, attachment: pending)
                    // The server remains authoritative for shared/solo image
                    // ceilings. The extension has no organization snapshot.
                    return try await client.uploadAttachment(pending, sharedHost: false) { [weak self] sent, _ in
                        try? journal.updateProgress(sent, attachmentID: pending.id, id: sendID)
                        await self?.updateUploadProgress(alreadyUploaded + sent, total: totalBytes)
                    }
                }
                try journal.updateProgress(pending.bytes, attachmentID: pending.id, receipt: uploadedFile, id: sendID)
                uploaded.append(uploadedFile.reference(for: pending))
                completedBytes += attachment.bytes
            }
            uploadProgress = nil

            let message = SharedMessageComposer.compose(
                instruction: instruction,
                text: items.text,
                urls: items.urls,
                attachments: uploaded
            )
            guard !message.isEmpty else { throw ShareItemLoadingError.nothingSupported }
            let delivery = PendingDelivery(
                text: message,
                destination: destination,
                sendID: sendID
            )
            var manifest = try journal.load(sendID)
            manifest.preparedText = message
            try journal.save(manifest, id: sendID)
            pendingDelivery = delivery
            await deliver(delivery)
        } catch {
            guard !Task.isCancelled else { return }
            fail(error, preservePreparedDelivery: pendingDelivery != nil)
        }
    }

    private func rememberUpload(client: CompanionClient, attachment: PendingMessageAttachment) {
        uploadCleanup[attachment.id] = (client, attachment)
    }

    private func updateUploadProgress(_ uploaded: Int, total: Int) {
        uploadProgress = Double(uploaded) / Double(max(1, total))
    }

    private func load() async {
        phase = .loading
        errorMessage = nil
        destinations = []
        selectedDestinationID = nil
        pendingDelivery = nil
        ShareItemLoader.cleanUp(items)
        items = nil

        var loadedItems: LoadedShareItems?
        do {
            let loaded = try await ShareItemLoader.load(from: context)
            loadedItems = loaded
            // NSItemProvider callbacks are not cancellation-aware. If the
            // person dismissed us while a provider was copying, remove the
            // finished App Group copy before doing any network work.
            try Task.checkCancellation()
            items = loaded
            preview = SharePreview(
                textCount: loaded.text.count,
                linkCount: loaded.urls.count,
                attachmentNames: loaded.attachments.map(\.name),
                imageCount: loaded.attachments.filter { $0.kind == .image }.count,
                ignoredCount: loaded.ignoredCount
            )

            let registry = SagaxSharedConnectionStore.loadRegistry()
            computers = registry.connections.map {
                ShareComputer(id: $0.id, name: $0.name, routeLabel: "Automatic")
            }
            let selectedConnection = requestedComputerID.flatMap { registry.connection(id: $0) }
                ?? registry.activeConnection
            guard let selectedConnection else {
                throw ShareExtensionError.notPaired
            }
            selectedComputerID = selectedConnection.id
            try await connect(to: selectedConnection)
            try Task.checkCancellation()
            phase = .ready
        } catch {
            if Task.isCancelled {
                ShareItemLoader.cleanUp(loadedItems)
                ShareItemLoader.cleanUp(items)
                items = nil
                return
            }
            fail(error, preservePreparedDelivery: false)
        }
    }

    private func deliver(
        _ delivery: PendingDelivery,
        deadline: Duration = .seconds(18)
    ) async {
        phase = .sending
        do {
            try await withFailover(deadline: deadline) { client in
                try await client.send(
                    text: delivery.text,
                    to: delivery.destination.messageDestination,
                    sendId: delivery.sendID
                )
            }
            try Task.checkCancellation()
            if let connection {
                SagaxSharedConfiguration.sharedDefaults?.set(
                    delivery.destination.id,
                    forKey: destinationKey(for: connection.id)
                )
            }
            if let id = durableShareID { try SagaxSharedTransfers.journal?.remove(id) }
            durableShareID = nil
            uploadCleanup.removeAll()
            ShareItemLoader.cleanUp(items)
            items = nil
            pendingDelivery = nil
            phase = .sent
            try? await Task.sleep(for: .milliseconds(450))
            onComplete?()
        } catch {
            guard !Task.isCancelled else { return }
            let preserve = shouldPreservePreparedDelivery(error)
            if preserve {
                // The exact prepared body is sufficient for an ambiguous
                // retry; release its no-longer-needed local source copies.
                ShareItemLoader.cleanUp(items)
                items = nil
            }
            fail(error, preservePreparedDelivery: preserve)
        }
    }

    /// Closing after an explicit handoff preserves the accepted job. iOS
    /// may stop this process; the containing app owns the durable continuation.
    func finishInSagax() {
        guard durableShareID != nil else { return }
        let sending = sendTask
        sending?.cancel()
        sendTask = nil
        Task { [weak self] in
            await sending?.value
            guard let self else { return }
            self.shareLease = nil
            ShareItemLoader.cleanUp(self.items)
            self.items = nil
            self.onComplete?()
        }
    }

    private func discardDurableShare() {
        guard let id = durableShareID else { return }
        durableShareID = nil
        try? SagaxSharedTransfers.journal?.remove(id)
    }

    private func connect(to selectedConnection: Connection) async throws {
        guard let pairedToken = try SagaxSharedKeychain.token(for: selectedConnection.id) else {
            throw ShareExtensionError.notPaired
        }
        connection = selectedConnection
        token = pairedToken
        client = nil
        let fleet = try await firstReachableFleet(
            connection: selectedConnection,
            token: pairedToken
        )
        let imageCapableInstances: Set<String>
        if preview.imageCount > 0 {
            do {
                imageCapableInstances = try await withFailover { client in
                    try await client.imageCapableInstanceIDs()
                }
            } catch APIError.status(let code, _) where code == 404 || code == 403 {
                // 404: a harness from before the capability existed. 403: a
                // server session without the admin scope, which may not read
                // the instance list at all. Neither can say where images go.
                throw ShareExtensionError.imageSupportUnavailable
            }
        } else {
            imageCapableInstances = []
        }
        destinations = Self.destinations(
            from: fleet,
            imageCapableInstances: imageCapableInstances
        )
        guard !destinations.isEmpty else { throw ShareExtensionError.noDestinations }

        let remembered = SagaxSharedConfiguration.sharedDefaults?
            .string(forKey: destinationKey(for: selectedConnection.id))
        rememberedDestinationID = remembered
        selectedDestinationID = destinations.contains(where: { $0.id == remembered })
            ? remembered
            : destinations.first?.id
    }

    private func fail(_ error: Error, preservePreparedDelivery: Bool) {
        if !preservePreparedDelivery { pendingDelivery = nil }
        errorMessage = friendlyMessage(for: error)
        phase = .failed
    }

    private func withFailover<T: Sendable>(
        requestTimeout: TimeInterval = 5,
        deadline: Duration? = .seconds(18),
        _ operation: @escaping @Sendable (CompanionClient) async throws -> T
    ) async throws -> T {
        guard let connection, let token else { throw ShareExtensionError.notPaired }
        var endpoints = connection.automaticEndpoints
        if let working = client?.connection.activeEndpoint,
           let index = endpoints.firstIndex(where: { $0.url == working.url }) {
            endpoints.insert(endpoints.remove(at: index), at: 0)
        }
        guard !endpoints.isEmpty else { throw ShareExtensionError.offline(connection.name) }

        let outcome = try await withThrowingTaskGroup(
            of: ShareRouteSuccess<T>.self,
            returning: ShareRouteSuccess<T>.self
        ) { group in
            group.addTask {
                var lastError: Error?
                for endpoint in endpoints {
                    try Task.checkCancellation()
                    let candidate = CompanionClient(
                        connection: connection.dialing(endpoint),
                        token: token,
                        requestTimeout: requestTimeout
                    )
                    do {
                        return ShareRouteSuccess(
                            value: try await operation(candidate),
                            client: candidate
                        )
                    } catch {
                        if Task.isCancelled { throw CancellationError() }
                        lastError = error
                        guard Self.canTryNextRoute(after: error) else { throw error }
                    }
                }
                throw lastError ?? ShareExtensionError.offline(connection.name)
            }
            if let deadline {
                group.addTask {
                    try await Task.sleep(for: deadline)
                    throw ShareExtensionError.offline(connection.name)
                }
            }
            defer { group.cancelAll() }
            guard let first = try await group.next() else {
                throw ShareExtensionError.offline(connection.name)
            }
            return first
        }
        setWorkingClient(outcome.client)
        return outcome.value
    }

    /// Read-only hydration can safely race every credential-approved route.
    /// This bounds initial share-sheet loading to one seven-second window,
    /// rather than serially spending the extension's lifetime on dead routes.
    private func firstReachableFleet(
        connection: Connection,
        token: String
    ) async throws -> Fleet {
        let endpoints = connection.automaticEndpoints
        guard !endpoints.isEmpty else { throw ShareExtensionError.offline(connection.name) }
        return try await withThrowingTaskGroup(of: FleetAttempt.self) { group in
            for (index, endpoint) in endpoints.enumerated() {
                let candidate = CompanionClient(
                    connection: connection.dialing(endpoint),
                    token: token,
                    requestTimeout: 7
                )
                group.addTask {
                    do {
                        return FleetAttempt(
                            index: index,
                            client: candidate,
                            result: .success(try await candidate.fleet(messages: 1))
                        )
                    } catch let error as APIError {
                        return FleetAttempt(index: index, client: candidate, result: .failure(error))
                    } catch {
                        return FleetAttempt(
                            index: index,
                            client: candidate,
                            result: .failure(.transport(error.localizedDescription))
                        )
                    }
                }
            }

            var results = [FleetAttempt?](repeating: nil, count: endpoints.count)
            for try await attempt in group {
                results[attempt.index] = attempt
                // A lower-priority route may win only after every route
                // before it has conclusively failed in a way failover repairs.
                for index in results.indices {
                    guard let resolved = results[index] else { break }
                    switch resolved.result {
                    case let .success(fleet):
                        group.cancelAll()
                        setWorkingClient(resolved.client)
                        return fleet
                    case let .failure(error):
                        if !Self.canTryNextRoute(after: error) {
                            group.cancelAll()
                            throw error
                        }
                    }
                }
            }
            if let first = results.compactMap({ $0 }).sorted(by: { $0.index < $1.index }).first,
               case let .failure(error) = first.result {
                throw error
            }
            throw ShareExtensionError.offline(connection.name)
        }
    }

    private func setWorkingClient(_ client: CompanionClient) {
        self.client = client
        guard let index = computers.firstIndex(where: { $0.id == client.connection.id }) else { return }
        computers[index] = ShareComputer(
            id: computers[index].id,
            name: computers[index].name,
            routeLabel: Self.routeLabel(for: client.connection)
        )
    }

    nonisolated private static func canTryNextRoute(after error: Error) -> Bool {
        guard let apiError = error as? APIError else { return false }
        switch apiError {
        case .transport: return true
        case let .status(code, _):
            return (502...504).contains(code) || (520...530).contains(code)
        case .badURL: return false
        }
    }

    private func isAmbiguousTransport(_ error: Error) -> Bool {
        guard let apiError = error as? APIError else { return false }
        switch apiError {
        case .transport:
            return true
        case let .status(code, _):
            return (502...504).contains(code) || (520...530).contains(code)
        case .badURL:
            return false
        }
    }

    private func shouldPreservePreparedDelivery(_ error: Error) -> Bool {
        guard let apiError = error as? APIError else { return true }
        switch apiError {
        case .transport: return true
        case let .status(code, _): return code == 408 || code == 429 || code >= 500
        case .badURL: return false
        }
    }

    private func friendlyMessage(for error: Error) -> String {
        if let apiError = error as? APIError {
            if apiError.isUnauthorized {
                return "This phone's pairing has expired. Open Sagax and pair it again."
            }
            if isAmbiguousTransport(error) {
                return "Couldn't reach your computer. Keep Sagax open and Phone access on, then try again."
            }
        }
        return (error as? LocalizedError)?.errorDescription
            ?? "Sagax couldn't send this. Please try again."
    }

    private func destinationKey(for connectionID: String) -> String {
        "share.last-destination.\(connectionID)"
    }

    private static func destinations(
        from fleet: Fleet,
        imageCapableInstances: Set<String>
    ) -> [ShareDestination] {
        let botByID = Dictionary(uniqueKeysWithValues: fleet.bots.map { ($0.id, $0) })
        let bots = fleet.bots
            .filter { $0.hidden != true }
            .map { bot in
                return ShareDestination(
                    // the bot's one conversation (SingleStream, the rule every
                    // device reads), never a job or a run the bot was left on
                    id: "bot:\(bot.id)", routeID: bot.id, threadID: SingleStream.home(of: bot) ?? bot.threadId,
                    name: bot.name,
                    // never a confidential thread's title (taken from its first message)
                    subtitle: ConfidentialRedaction.shareSubtitle(for: bot),
                    kind: .bot,
                    latestActivity: bot.messages?.map(\.at).max() ?? bot.createdAt,
                    supportsImages: imageCapableInstances.contains(bot.modelSelection.instanceId)
                )
            }
        let channels = fleet.groups.map { room in
            let task = room.tasks?.first(where: { $0.threadId == room.threadId })?.title
            return ShareDestination(
                id: "channel:\(room.id)", routeID: room.id, threadID: room.threadId,
                name: room.name,
                subtitle: task.map { "Channel · \($0)" } ?? "Channel",
                kind: .channel,
                latestActivity: room.messages?.map(\.at).max() ?? room.createdAt,
                // The share extension has no mention editor. Requiring every
                // possible member avoids sending an image to a text-only bot
                // when channel routing changes based on shared text.
                supportsImages: !room.memberIds.isEmpty && room.memberIds.allSatisfy { id in
                    guard let bot = botByID[id] else { return false }
                    return imageCapableInstances.contains(bot.modelSelection.instanceId)
                }
            )
        }
        return (bots + channels).sorted {
            $0.latestActivity == $1.latestActivity
                ? $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                : $0.latestActivity > $1.latestActivity
        }
    }

    private static func routeLabel(for connection: Connection) -> String {
        let kind = connection.activeEndpoint?.kind
            ?? connection.automaticEndpoints.first?.kind
            ?? CompanionEndpoint.inferredDirectKind(connection.host)
        switch kind {
        case .hosted: return "Secure HTTPS"
        case .tailnet: return "Tailscale"
        case .lan, .bonjour: return "Local network"
        }
    }
}

private enum ShareExtensionError: LocalizedError {
    case notPaired
    case noDestinations
    case imageSupportUnavailable
    case offline(String)
    case sendTimedOut
    case alreadySending

    var errorDescription: String? {
        switch self {
        case .notPaired:
            return "Open the Sagax app once after updating. If this phone still isn't connected, pair it before sharing."
        case .noDestinations:
            return "There aren't any bots or channels to send this to yet. Create one on your computer first."
        case .imageSupportUnavailable:
            return "Update Sagax on this computer before sharing images."
        case let .offline(name):
            return "Couldn't reach \(name). Keep Sagax open and Phone access on, then try again."
        case .sendTimedOut:
            return "Sending took too long. Check your connection and try again."
        case .alreadySending:
            return String(localized: "Sagax is already sending this share. You can close this sheet.")
        }
    }
}
