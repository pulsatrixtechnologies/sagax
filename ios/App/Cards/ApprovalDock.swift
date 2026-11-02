// The approval dock (feature parity CA2-CA5, PendingApproval.tsx): an open
// permission ask does not wait in the transcript to be noticed, it sits on
// the composer. One request at a time with an "n of N" stepper, the detail
// in a monospace block that scrolls instead of truncating, "Allow all
// read-only (N)" when several reads wait, and the decisions ordered
// least-destructive-last so the primary sits under the thumb: Cancel turn,
// Deny, the one remembering choice that applies, Allow once.
//
// Layout-agnostic: it takes the conversation and its open asks, so the
// iPhone mounts it above the composer and the iPad's desktop chat can mount
// the same view in its own composer.
import SwiftUI
import CompanionCore

struct ApprovalDock: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    /// This conversation's open asks, then its parallel tasks' (oldest first).
    let approvals: [PendingApproval]
    @EnvironmentObject private var session: Session
    @State private var requestId: String?
    @State private var answering = false
    /// The ask whose whole detail is open (`ApprovalDetailSheet`).
    @State private var detail: PendingApproval?
    /// Taps on Allow and on Deny, for their haptics (`feedback`).
    @State private var allowed = 0
    @State private var refused = 0
    /// iPad desktop shell: PendingApproval.tsx's box.
    @Environment(\.desktopChatText) private var desktop

    private var tint: Color { MausPalette.color(chat.color) }

    var body: some View {
        if let desktop, !approvals.isEmpty {
            desktopBody(desktop)
        } else if !approvals.isEmpty {
            let index = ApprovalDockRules.stepperIndex(approvals, requestId: requestId)
            let pending = approvals[index]
            let readOnly = ApprovalDockRules.readOnly(approvals)
            VStack(alignment: .leading, spacing: 9) {
                if let title = pending.parallelTitle {
                    Label(String(localized: "Parallel task · \(title)"), systemImage: "arrow.triangle.branch")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.attentionSecondary)
                        .lineLimit(1)
                }
                HStack(alignment: .top, spacing: 8) {
                    Text(heading(pending))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.attentionText)
                        .fixedSize(horizontal: false, vertical: true)
                        // a permission ask opens its whole detail
                        .contentShape(Rectangle())
                        .onTapGesture {
                            guard !ApprovalDockRules.isProposal(pending.card) else { return }
                            Haptics.selection()
                            detail = pending
                        }
                        .accessibilityAddTraits(ApprovalDockRules.isProposal(pending.card) ? [] : .isButton)
                        .accessibilityHint(ApprovalDockRules.isProposal(pending.card) ? Text(verbatim: "") : Text("Shows the whole request"))
                        .accessibilityIdentifier("approval-dock-title")
                    Spacer(minLength: 4)
                    if approvals.count > 1 {
                        VStack(alignment: .trailing, spacing: 3) {
                            stepper(index: index)
                            if readOnly.count > 1 {
                                Button {
                                    Haptics.selection()
                                    run { await session.allowAll(readOnly, in: chat) }
                                } label: {
                                    Text("Allow all read-only (\(readOnly.count))")
                                        .font(.system(size: 12.5, weight: .semibold))
                                        .foregroundStyle(Theme.readable(tint))
                                }
                                .buttonStyle(.plain)
                                .disabled(answering)
                                .accessibilityHint(Text("Allows only the waiting requests that just read data"))
                                .accessibilityIdentifier("approval-allow-read-only")
                            }
                        }
                    }
                }

                if let ask = TeammateAsk.parse(pending.card) {
                    // issue #426: who it writes to, by name and face, and
                    // what it says; the arguments behind the full request
                    let ink = ApprovalInk.of(nil, accent: Theme.readable(tint))
                    if !ask.recipients.isEmpty { TeammateRecipientsView(ask: ask, ink: ink) }
                    TeammateQuoteView(ask: ask, ink: ink)
                    Button {
                        Haptics.selection()
                        detail = pending
                    } label: {
                        Text("See the full request")
                            .font(.system(size: 12.5, weight: .medium))
                            .foregroundStyle(Theme.readable(tint))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("approval-full-request")
                } else if let detail = ApprovalHeading.detail(pending.card) {
                    ScrollView(.vertical) {
                        Text(detail)
                            .font(Theme.mono(12))
                            .foregroundStyle(Theme.attentionText)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("approval-dock-detail")
                    }
                    .frame(maxHeight: 120)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                // issue #426: the held note is one quiet line; the
                // provider's own and the routine gate's are not shown
                ApprovalHeldLine(card: pending.card, ink: ApprovalInk(
                    ink: Theme.attentionText, secondary: Theme.attentionSecondary, tertiary: Theme.attentionSecondary,
                    inset: Theme.inset, hairline: Theme.hairline, accent: Theme.readable(tint),
                    success: Theme.success, danger: Theme.danger, font: { .system(size: $0, weight: $1) }
                ))

                actions(pending)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(Theme.attentionSurface)
                    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(tint.opacity(0.08)))
            )
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(tint, lineWidth: 1.5)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("approval-dock")
            .sheet(item: $detail) { pending in
                ApprovalDetailSheet(chat: chat, pending: pending)
            }
        }
    }

    // MARK: Desktop

    /// PendingApprovalBox: a card ring (accent at 40 %, radius 16): the
    /// heading (avatar, "Ara wants to run a command", the risk chip, the
    /// stepper), the command on an inset block, "See technical details",
    /// then Cancel turn as a quiet link on the left and the pills on the
    /// right: Deny, the remembering choice, Allow once.
    private func desktopBody(_ theme: DesktopTheme) -> some View {
        let index = ApprovalDockRules.stepperIndex(approvals, requestId: requestId)
        let pending = approvals[index]
        let card = pending.card
        let proposal = ApprovalDockRules.isProposal(card)
        let actions = ApprovalDockRules.actions(
            for: pending,
            ownerOrAdmin: session.answersServerCards,
            hasBot: session.askingBotId(pending, in: chat) != nil
        )
        let readOnly = ApprovalDockRules.readOnly(approvals)
        let bot = session.askingBotId(pending, in: chat).flatMap { session.state.bot($0) }
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                if let title = pending.parallelTitle {
                    Label(String(localized: "Parallel task · \(title)"), systemImage: "arrow.triangle.branch")
                        .font(theme.font(11.5))
                        .foregroundStyle(theme.inkSecondary)
                        .lineLimit(1)
                        .padding(.bottom, 6)
                }
                DesktopApprovalHeading(
                    bot: bot,
                    title: proposal ? Self.desktopLabel(pending) : heading(pending),
                    risk: proposal ? nil : ApprovalRiskClassifier.risk(of: card),
                    theme: theme,
                    aside: approvals.count > 1 ? AnyView(VStack(alignment: .trailing, spacing: 2) {
                        stepper(index: index)
                        if readOnly.count > 1 {
                            Button {
                                Haptics.selection()
                                run { await session.allowAll(readOnly, in: chat) }
                            } label: {
                                Text("Allow all read-only (\(readOnly.count))")
                                    .font(theme.font(12, .medium))
                                    .foregroundStyle(theme.accent)
                            }
                            .buttonStyle(.plain)
                            .disabled(answering)
                            .accessibilityIdentifier("approval-allow-read-only")
                        }
                    }) : nil
                )
                if let ask = TeammateAsk.parse(card) {
                    let ink = ApprovalInk.of(theme, accent: theme.accent)
                    VStack(alignment: .leading, spacing: 6) {
                        if !ask.recipients.isEmpty { TeammateRecipientsView(ask: ask, ink: ink) }
                        TeammateQuoteView(ask: ask, ink: ink)
                    }
                    .padding(.top, 8)
                } else if let detail = Self.desktopDetail(card) {
                    DesktopApprovalBlock(text: detail, size: 12, theme: theme)
                }
                if ApprovalHeldNote.shows(card) {
                    ApprovalHeldLine(card: card, ink: ApprovalInk.of(theme, accent: theme.accent))
                        .padding(.top, 8)
                }
                if !proposal, card.tool?.isEmpty == false {
                    DesktopTechnicalDetails(card: card, theme: theme)
                        .id(pending.requestId)
                        .padding(.bottom, 2)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 8) {
                if actions.cancelTurn || actions.waitingForAdmin {
                    Button { run { await session.cancelTurn(for: pending, in: chat) } } label: {
                        Text("Cancel turn")
                            .font(theme.font(12.5))
                            .foregroundStyle(theme.inkSecondary)
                            .padding(4)
                            .frame(height: 26.8)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(answering)
                    .accessibilityIdentifier("approval-cancel-turn")
                }
                Spacer(minLength: 0)
                if actions.waitingForAdmin {
                    Text("This command runs on the server: waiting for an admin to approve it.")
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.inkSecondary)
                } else {
                    desktopPill(actions.denyIsCancel ? String(localized: "Cancel") : String(localized: "Deny"), theme: theme,
                                ink: theme.danger, ring: theme.danger.opacity(0.4), id: "approval-deny") {
                        await session.decide(.deny, on: pending, in: chat)
                    }
                    if actions.alwaysAllowRule {
                        desktopPill(actions.alwaysAllowFolder ? (actions.alwaysAllowFolderWrites ? String(localized: "Always allow changes to this file") : String(localized: "Always allow this file")) : String(localized: "Always allow"), theme: theme, ink: theme.ink, ring: theme.hairline.opacity(0.5), id: "approval-always-allow") {
                            await session.decide(.alwaysAllowRule, on: pending, in: chat)
                        }
                        if actions.alwaysAllowFolder {
                            desktopPill((actions.alwaysAllowFolderWrites ? String(localized: "Always allow changes in the whole folder, deletions included") : String(localized: "Always allow the whole folder")), theme: theme, ink: theme.ink, ring: theme.hairline.opacity(0.5), id: "approval-always-allow-folder") {
                                await session.decide(.alwaysAllowFolder, on: pending, in: chat)
                            }
                        }
                    } else if actions.alwaysAllowTool {
                        desktopPill(String(localized: "Always allow"), theme: theme, ink: theme.ink, ring: theme.hairline.opacity(0.5), id: "approval-always-allow") {
                            await session.decide(.alwaysAllowTool, on: pending, in: chat)
                        }
                    } else if actions.alwaysAllowCommand {
                        desktopPill(String(localized: "Always allow"), theme: theme, ink: theme.ink, ring: theme.hairline.opacity(0.5), id: "approval-always-command") {
                            await session.decide(.alwaysAllowCommand, on: pending, in: chat)
                        }
                    } else if actions.alwaysAllowSession {
                        desktopPill(String(localized: "Always allow"), theme: theme, ink: theme.ink, ring: theme.hairline.opacity(0.5), id: "approval-always-session") {
                            await session.decide(.alwaysAllowSession, on: pending, in: chat)
                        }
                    }
                    desktopPill(primaryLabel(actions.primary, pending), theme: theme, ink: theme.accentInk, fill: theme.accent, weight: .medium, id: "approval-allow-once") {
                        await session.decide(.allowOnce, on: pending, in: chat)
                    }
                    .disabled(actions.primaryDisabled)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 12)
        }
        .background(theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(1)
        .overlay(RoundedRectangle(cornerRadius: 17, style: .continuous).strokeBorder(theme.accent.opacity(0.4), lineWidth: 1))
        // mb-2: with the composer's 6 pt stack spacing
        .padding(.bottom, 2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("approval-dock")
    }

    /// The dock's block: a proposal's text, the exact command, or the
    /// plain subtitle (PendingApproval.tsx `visibleText`).
    static func desktopDetail(_ card: OptionCard) -> String? {
        DesktopApprovalText.plain(card)
    }

    /// PendingApproval.tsx `approvalLabel`.
    static func desktopLabel(_ pending: PendingApproval) -> String {
        switch ApprovalHeading.of(pending.card) {
        case .confirmRoutine: return String(localized: "Confirm this routine")
        case .confirmPausedRoutine: return String(localized: "This routine starts paused")
        case .confirmRoutineChange: return String(localized: "Confirm this routine change")
        case .enableSkill: return String(localized: "Enable this learned skill")
        case .updateSkill: return String(localized: "Update this learned skill")
        case .confirmProfileChange: return String(localized: "Confirm this profile change")
        case .confirmRuleChange: return String(localized: "Confirm this approval rule")
        case let .teamSetup(title): return title
        case .wantsTo:
            switch pending.card.tool ?? "" {
            case "Bash", "shell": return String(localized: "Command approval requested")
            case "Read": return String(localized: "File-read approval requested")
            case "Write", "Edit", "edit": return String(localized: "File-change approval requested")
            default: return String(localized: "Approval requested")
            }
        }
    }

    private func desktopPill(
        _ title: String, theme: DesktopTheme, ink: Color, fill: Color = .clear, ring: Color = .clear,
        weight: Font.Weight = .regular, id: String, _ action: @escaping () async -> Void
    ) -> some View {
        Button { run(action) } label: {
            Text(title)
                .font(theme.font(13.5, weight))
                .foregroundStyle(ink)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .frame(height: ring == .clear ? 32.2 : 34.2)
                .background(fill, in: Capsule())
                .overlay(Capsule().strokeBorder(ring, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .disabled(answering)
        .accessibilityIdentifier(id)
    }

    // MARK: Parts

    private func heading(_ pending: PendingApproval) -> String {
        switch ApprovalHeading.of(pending.card) {
        case .wantsTo:
            // a teammate ask names who it writes to (#426); the server's
            // phrase when it is in the reader's language (#1089)
            return ApprovalWords.wantsTo(pending.card, name: pending.message.from?.name ?? chat.name, session: session)
        case .confirmRoutine: return String(localized: "Confirm this routine")
        case .confirmPausedRoutine: return String(localized: "This routine starts paused")
        case .confirmRoutineChange: return String(localized: "Confirm this routine change")
        case .enableSkill: return String(localized: "Enable this learned skill")
        case .updateSkill: return String(localized: "Update this learned skill")
        case .confirmProfileChange: return String(localized: "Confirm this profile change")
        case .confirmRuleChange: return String(localized: "Confirm this approval rule")
        case let .teamSetup(title): return title
        }
    }

    static func phrase(_ action: ApprovalToolAction) -> String {
        switch action {
        case .runCommand: String(localized: "run a command")
        case .readFile: String(localized: "read a file")
        case .writeFile: String(localized: "write a file")
        case .editFile: String(localized: "edit a file")
        case .fetchWebPage: String(localized: "fetch a web page")
        case .searchWeb: String(localized: "search the web")
        case .scheduleRoutine: String(localized: "schedule a routine")
        case .changeRoutine: String(localized: "change a routine")
        case .enableSkill: String(localized: "enable a learned skill")
        case .updateSkill: String(localized: "update a learned skill")
        case .updateProfile: String(localized: "update its profile")
        case .deleteFile: String(localized: "delete a file")
        case .think: String(localized: "think")
        case .takeAction: String(localized: "take an action")
        case .useTool: String(localized: "use a tool")
        case let .named(words): words
        }
    }

    private func stepper(index: Int) -> some View {
        HStack(spacing: 2) {
            Button {
                Haptics.selection()
                requestId = approvals[max(0, index - 1)].requestId
            } label: {
                Image(systemName: "chevron.left").frame(width: 28, height: 28)
            }
            .disabled(index == 0)
            .accessibilityLabel(Text("Previous request"))
            .accessibilityIdentifier("approval-previous")
            Text("\(index + 1) of \(approvals.count)")
                .font(.system(size: 12.5).monospacedDigit())
                .accessibilityIdentifier("approval-position")
            Button {
                Haptics.selection()
                requestId = approvals[min(approvals.count - 1, index + 1)].requestId
            } label: {
                Image(systemName: "chevron.right").frame(width: 28, height: 28)
            }
            .disabled(index >= approvals.count - 1)
            .accessibilityLabel(Text("Next request"))
            .accessibilityIdentifier("approval-next")
        }
        .buttonStyle(.plain)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(Theme.attentionSecondary)
    }

    @ViewBuilder
    private func actions(_ pending: PendingApproval) -> some View {
        let actions = ApprovalDockRules.actions(
            for: pending,
            ownerOrAdmin: session.answersServerCards,
            hasBot: session.askingBotId(pending, in: chat) != nil
        )
        VStack(alignment: .leading, spacing: 8) {
            if actions.waitingForAdmin {
                Text("This command runs on the server: waiting for an admin to approve it.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.attentionSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(spacing: 8) {
                    decisionButton(
                        actions.denyIsCancel ? String(localized: "Cancel") : String(localized: "Deny"),
                        style: .refusal, id: "approval-deny"
                    ) { await session.decide(.deny, on: pending, in: chat) }
                    decisionButton(primaryLabel(actions.primary, pending), style: .primary, id: "approval-allow-once") {
                        await session.decide(.allowOnce, on: pending, in: chat)
                    }
                    .disabled(actions.primaryDisabled)
                }
                if actions.alwaysAllowRule || actions.alwaysAllowTool || actions.alwaysAllowSession || actions.alwaysAllowCommand {
                    remember(actions, pending)
                }
            }
            if actions.cancelTurn {
                Button {
                    Haptics.selection()
                    run { await session.cancelTurn(for: pending, in: chat) }
                } label: {
                    Text("Cancel turn")
                        .font(.system(size: 12.5))
                        .underline()
                        .foregroundStyle(Theme.attentionSecondary)
                }
                .buttonStyle(.plain)
                .disabled(answering)
                .accessibilityIdentifier("approval-cancel-turn")
            }
        }
        .padding(.top, 2)
    }

    /// The remembering choice under the two main buttons: one applies.
    @ViewBuilder
    private func remember(_ actions: ApprovalDockActions, _ pending: PendingApproval) -> some View {
        if actions.alwaysAllowRule {
            quietButton(actions.alwaysAllowFolder ? (actions.alwaysAllowFolderWrites ? String(localized: "Always allow changes to this file") : String(localized: "Always allow this file")) : String(localized: "Always allow"), id: "approval-always-allow") {
                await session.decide(.alwaysAllowRule, on: pending, in: chat)
            }
            if actions.alwaysAllowFolder {
                quietButton((actions.alwaysAllowFolderWrites ? String(localized: "Always allow changes in the whole folder, deletions included") : String(localized: "Always allow the whole folder")), id: "approval-always-allow-folder") {
                    await session.decide(.alwaysAllowFolder, on: pending, in: chat)
                }
            }
        } else if actions.alwaysAllowTool {
            quietButton(String(localized: "Always allow"), id: "approval-always-allow") {
                await session.decide(.alwaysAllowTool, on: pending, in: chat)
            }
        } else if actions.alwaysAllowCommand {
            quietButton(String(localized: "Always allow"), id: "approval-always-command") {
                await session.decide(.alwaysAllowCommand, on: pending, in: chat)
            }
            .accessibilityHint(Text(
                "Remember this exact command for this bot and provider in \(pending.card.commandAllowlist?.cwd ?? ""), including other threads using that folder"
            ))
        } else if actions.alwaysAllowSession {
            quietButton(String(localized: "Always allow"), id: "approval-always-session") {
                await session.decide(.alwaysAllowSession, on: pending, in: chat)
            }
            .accessibilityHint(Text("The provider stops asking about this action until the session ends"))
        }
    }

    private func primaryLabel(_ primary: ApprovalPrimary, _ pending: PendingApproval) -> String {
        switch primary {
        case .allowOnce: String(localized: "Allow once")
        case .confirm: String(localized: "Confirm")
        case .enable: String(localized: "Enable")
        case .update: String(localized: "Update")
        case let .option(label): label
        }
    }

    private enum ButtonStyleKind { case primary, refusal }

    private func decisionButton(
        _ title: String, style: ButtonStyleKind, id: String, _ action: @escaping () async -> Void
    ) -> some View {
        Button {
            // a firm "done" for Allow, a light tap for Deny (`feedback` below)
            if style == .primary { allowed += 1 } else { refused += 1 }
            run(action)
        } label: {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(style == .refusal ? Theme.attentionText : .white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(Capsule().fill(style == .refusal ? Theme.cardRaised : Theme.readable(tint)))
        }
        .buttonStyle(.plain)
        .disabled(answering)
        .accessibilityIdentifier(id)
        .feedback(style == .primary ? .success : .impact, trigger: style == .primary ? allowed : refused)
    }

    private func quietButton(_ title: String, id: String, _ action: @escaping () async -> Void) -> some View {
        Button {
            Haptics.selection()
            run(action)
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.attentionText)
                .frame(maxWidth: .infinity)
                .frame(height: 34)
                .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(answering)
        .accessibilityIdentifier(id)
    }

    private func run(_ action: @escaping () async -> Void) {
        answering = true
        Task {
            await action()
            answering = false
        }
    }
}
