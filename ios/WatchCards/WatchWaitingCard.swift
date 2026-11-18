import CompanionCore
import SwiftUI
import WidgetKit

struct WatchWaitingCard: View {
    let entry: PinnedWaitingEntry
    @ObservedObject var session: WatchSession
    var rememberOnly = false
    let onAnswered: () async -> Void
    @State private var showPreview = false
    @State private var working = false
    @State private var sent = false
    @State private var failure: String?
    @State private var words = ""
    @State private var viewer: ConfigViewer?

    private var item: WaitingItem { entry.item }
    private var card: OptionCard? { entry.message.card }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !rememberOnly, !item.title.isEmpty, item.title != card?.questions.first?.question { Text(item.title).font(.headline) }
            if !rememberOnly, !item.text.isEmpty, item.text != item.title, item.text != card?.questions.first?.question { Text(item.text).font(.footnote) }
            if let preview = card?.skillRequest?.preview {
                if rememberOnly && !showPreview {
                    Button("Review") { showPreview = true }
                } else { Text(preview).font(.caption.monospaced()) }
            }
            if sent || card?.answered != nil || card?.dismissed == true || card?.expired == true {
                Text(card?.answeredText ?? String(localized: "Closed")).foregroundStyle(.secondary)
            } else if let card, !card.questions.isEmpty {
                WatchQuestionChoices(card: card) { answer($0) }
            } else if let pending = entry.approval, card?.phoneCallConsent == nil {
                approvalButtons(pending)
            } else {
                ForEach(item.options, id: \.self) { choice in
                    Button { answer(choice) } label: { Text(choice) }
                }
                if item.freeText || (item.kind == "question" && card?.proactiveProposal == nil && card?.phoneCallConsent == nil) {
                    TextField("Type your answer", text: $words)
                    Button("Send") { answer(words) }.disabled(words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
        }
        .buttonStyle(.bordered)
        .disabled(working)
        .task(id: session.identity) {
            guard let card, card.adminApproval == true || card.commandAllowlist != nil else { return }
            viewer = try? await session.client?.config().viewer
        }
    }

    private func approvalButtons(_ pending: PendingApproval) -> some View {
        let connection = session.client?.connection
        let allowed = connection.map { $0.canAdminister || SurfaceGate(connection: $0, viewer: viewer).can("host.shell") } ?? false
        let actions = ApprovalDockRules.actions(for: pending, ownerOrAdmin: allowed, hasBot: !item.botId.isEmpty)
        return VStack(alignment: .leading, spacing: 4) {
            if actions.waitingForAdmin { Text("Waiting for an administrator").font(.caption) }
            let choices = ApprovalDockRules.answers(actions).filter {
                !rememberOnly || ($0 != .deny && $0 != .allowOnce)
            }
            ForEach(choices, id: \.self) { choice in
                Button(label(choice, actions)) {
                    submit { client in
                        let decision = ApprovalDockRules.decision(choice, for: pending)
                        if let key = decision.alwaysAllowKey {
                            try await client.alwaysAllow(botId: item.botId, key: key, threadId: item.threadId)
                        }
                        return AnswerFeedback.respondLanded(try await client.respond(threadId: item.threadId, decision: decision))
                    }
                }.disabled(choice != .deny && (actions.primaryDisabled || (rememberOnly && pending.card.skillRequest != nil && !showPreview)))
            }
        }
    }

    private func label(_ choice: ApprovalDockRules.Choice, _ actions: ApprovalDockActions) -> String {
        switch choice {
        case .allowOnce:
            switch actions.primary {
            case .allowOnce: return String(localized: "Allow once")
            case .enable: return String(localized: "Enable")
            case .update: return String(localized: "Update")
            case .confirm: return String(localized: "Confirm")
            case let .option(option): return option
            }
        case .deny: return actions.denyIsCancel ? String(localized: "Cancel") : String(localized: "Deny")
        case .alwaysAllowFolder:
            return actions.alwaysAllowFolderWrites ? String(localized: "Always allow changes in the whole folder, deletions included") : String(localized: "Always allow the whole folder")
        case .alwaysAllowRule where actions.alwaysAllowFolder:
            return actions.alwaysAllowFolderWrites ? String(localized: "Always allow changes to this file") : String(localized: "Always allow this file")
        default: return String(localized: "Always allow")
        }
    }

    private func answer(_ value: String) {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        submit { client in
            if let proposal = card?.proactiveProposal, let card {
                try await client.answerProactiveProposal(botId: item.botId, proposalId: proposal.id, accept: ProactiveProposalRules.accepts(card, answer: text))
            } else if let card, let request = card.requestId {
                let behavior: String
                if card.phoneCallConsent != nil { behavior = PhoneCallConsentRules.behavior(for: text) }
                else if card.questions.isEmpty { behavior = card.responseBehavior(for: text) }
                else { behavior = "answer" }
                return AnswerFeedback.respondLanded(try await client.respond(threadId: item.threadId, decision:
                    ApprovalDecision(requestId: request, behavior: behavior, message: behavior == "answer" ? text : nil)))
            } else if card != nil {
                try await client.answerChatCard(botId: item.botId, messageId: entry.message.id, threadId: item.threadId, answer: text)
                _ = try await client.send(text: text, toBot: item.botId, threadId: item.threadId)
            } else {
                _ = try await client.send(text: text, toBot: item.workBotId ?? item.botId, threadId: item.workThreadId ?? item.threadId)
                if let place = entry.formPlace {
                    try? await client.markFormAnswered(botId: place.botId, threadId: place.threadId, messageId: place.messageId, answer: text)
                } else if entry.message.attention != nil {
                    try? await client.markAttentionHandled(botId: item.botId, threadId: item.threadId, messageId: entry.message.id)
                }
            }
            return true
        }
    }

    private func submit(_ operation: @escaping (CompanionClient) async throws -> Bool) {
        guard !working, !sent, let client = session.client else { return }
        working = true
        Task { @MainActor in
            defer { working = false }
            do {
                let landed = try await operation(client)
                sent = true
                failure = landed ? nil : String(localized: "This request is no longer available.")
                WidgetCenter.shared.reloadTimelines(ofKind: WatchWaitingLink.widgetKind)
                await onAnswered()
            } catch is StepUpRequired {
                if let request = card?.requestId {
                    WatchNotificationHandler.shared.continueOnPhone(bot: item.botId, thread: item.threadId, request: request, connectionID: client.connection.id)
                }
                failure = String(localized: "Use your security key on iPhone to approve.")
            } catch {
                failure = String(localized: "Your answer did not go through. Open Sagax to answer.")
                await session.recover(after: error, using: client)
            }
        }
    }
}
