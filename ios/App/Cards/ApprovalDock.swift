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
            let proposal = ApprovalDockRules.isProposal(pending.card)
            let accent = Theme.readable(tint)
            // #3415 (PR #3441 on the desktop): one compact card. An icon,
            // the ask in one line naming the bot once, one line with the
            // read or write mark and what it does, the raw detail behind a
            // folded Details, then Deny, Always allow and Allow once.
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "checkmark.shield")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(accent)
                        .frame(height: 20)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(heading(pending))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.attentionText)
                            .fixedSize(horizontal: false, vertical: true)
                            // a permission ask opens its whole detail
                            .contentShape(Rectangle())
                            .onTapGesture {
                                guard !proposal else { return }
                                Haptics.selection()
                                detail = pending
                            }
                            .accessibilityAddTraits(proposal ? [] : .isButton)
                            .accessibilityHint(proposal ? Text(verbatim: "") : Text("Shows the whole request"))
                            .accessibilityIdentifier("approval-dock-title")
                        if !proposal {
                            summaryLine(pending.card)
                        }
                        if let title = pending.parallelTitle {
                            Label(String(localized: "Parallel task · \(title)"), systemImage: "arrow.triangle.branch")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.attentionSecondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 0) {
                        if approvals.count > 1 { stepper(index: index) }
                        // #3471: the one quiet skip at the end of the top row
                        CardSkipButton(ink: Theme.attentionSecondary, disabled: answering, id: "approval-dock") {
                            run { await session.skipApproval(pending, in: chat) }
                        }
                    }
                    .padding(.top, -4)
                    .padding(.trailing, -6)
                }

                if approvals.count > 1, readOnly.count > 1 {
                    Button {
                        Haptics.selection()
                        run { await session.allowAll(readOnly, in: chat) }
                    } label: {
                        Text("Allow all read-only (\(readOnly.count))")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(accent)
                    }
                    .buttonStyle(.plain)
                    .disabled(answering)
                    .accessibilityHint(Text("Allows only the waiting requests that just read data"))
                    .accessibilityIdentifier("approval-allow-read-only")
                }

                if let ask = TeammateAsk.parse(pending.card) {
                    // issue #426: who it writes to, by name and face, and
                    // what it says; the arguments behind the full request
                    let ink = ApprovalInk.of(nil, accent: accent)
                    if !ask.recipients.isEmpty { TeammateRecipientsView(ask: ask, ink: ink) }
                    TeammateQuoteView(ask: ask, ink: ink)
                    fullRequestButton(pending)
                } else if proposal, let text = ApprovalHeading.detail(pending.card) {
                    // what a proposal proposes is what is decided: in view
                    detailBlock(text)
                } else if !proposal {
                    // the raw detail (command, arguments) behind Details
                    PhoneApprovalFold(
                        text: ApprovalHeading.detail(pending.card), accent: accent,
                        fullRequest: { Haptics.selection(); detail = pending }
                    )
                    .id(pending.requestId)
                }

                // issue #426: the held note is one quiet line; the
                // provider's own and the routine gate's are not shown
                ApprovalHeldLine(card: pending.card, ink: ApprovalInk(
                    ink: Theme.attentionText, secondary: Theme.attentionSecondary, tertiary: Theme.attentionSecondary,
                    inset: Theme.inset, hairline: Theme.hairline, accent: accent,
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

    /// The line under the title: the read or write mark as a quiet word
    /// with its icon (never a filled pill), then what it does in plain words.
    private func summaryLine(_ card: OptionCard) -> some View {
        let risk = ApprovalRiskClassifier.risk(of: card)
        return HStack(spacing: 5) {
            if let risk {
                PhoneRiskMark(risk: risk)
                Text(verbatim: "·").foregroundStyle(Theme.attentionSecondary).accessibilityHidden(true)
            }
            Text(verbatim: Self.plainLine(card, risk: risk))
                .foregroundStyle(Theme.attentionSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .font(.system(size: 13))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("approval-dock-summary")
    }

    /// What it does in plain words: the server's line when it is in the
    /// reader's language (#1089), else the line for its kind of risk.
    static func plainLine(_ card: OptionCard, risk: ApprovalRisk?) -> String {
        if ApprovalReceiptRules.plainAction(card, language: Locale.preferredLanguages.first) != nil,
           let line = card.plain?.line.trimmingCharacters(in: .whitespacesAndNewlines), !line.isEmpty {
            return line
        }
        return DesktopApprovalLine.fallback(risk)
    }

    private func detailBlock(_ text: String) -> some View {
        ScrollView(.vertical) {
            Text(text)
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

    private func fullRequestButton(_ pending: PendingApproval) -> some View {
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
    }

    // MARK: Desktop

    /// PendingApprovalBox: a card ring (accent at 40 %, radius 16): the
    /// heading (avatar, "Ara wants to run a command", the risk chip, the
    /// stepper), the command folded on one inset line (Details open: the
    /// command and the technical details),
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
                    aside: AnyView(VStack(alignment: .trailing, spacing: 2) {
                        HStack(spacing: 0) {
                            if approvals.count > 1 { stepper(index: index) }
                            // #3471: the one quiet skip at the end of the top row
                            CardSkipButton(ink: theme.inkTertiary, disabled: answering, id: "approval-dock") {
                                run { await session.skipApproval(pending, in: chat) }
                            }
                        }
                        .padding(.top, -4)
                        if approvals.count > 1, readOnly.count > 1 {
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
                    }),
                    // #3415: the read or write mark, then what it does in
                    // plain words; the command stays on the fold under it
                    summary: proposal || TeammateAsk.parse(card) != nil
                        ? nil : Self.plainLine(card, risk: ApprovalRiskClassifier.risk(of: card))
                )
                if let ask = TeammateAsk.parse(card) {
                    let ink = ApprovalInk.of(theme, accent: theme.accent)
                    VStack(alignment: .leading, spacing: 6) {
                        if !ask.recipients.isEmpty { TeammateRecipientsView(ask: ask, ink: ink) }
                        TeammateQuoteView(ask: ask, ink: ink)
                    }
                    .padding(.top, 8)
                } else if proposal {
                    if let detail = Self.desktopDetail(card) {
                        DesktopApprovalBlock(text: detail, size: 12, theme: theme)
                    }
                } else if Self.desktopDetail(card) != nil || card.tool?.isEmpty == false {
                    // a tool request: one line of what runs, the rest folded
                    // under it (PendingApproval.tsx, 2026-10-20)
                    DesktopApprovalFold(text: Self.desktopDetail(card), card: card, theme: theme)
                        .id(pending.requestId)
                }
                if ApprovalHeldNote.shows(card) {
                    ApprovalHeldLine(card: card, ink: ApprovalInk.of(theme, accent: theme.accent))
                        .padding(.top, 8)
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
                // #3415: the three answers on one row, Always allow on
                // every card that can keep one; a folder's second Always
                // allow goes on its own row under them
                let row = ApprovalDockRules.answers(actions).filter { $0 != .alwaysAllowFolder }
                // one row when the words fit whole; else Deny and Allow once
                // on the row, Always allow under them, never cut
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        ForEach(row, id: \.self) { choice in
                            answerButton(choice, actions: actions, pending: pending, whole: true)
                        }
                    }
                    VStack(spacing: 8) {
                        HStack(spacing: 8) {
                            ForEach(row.filter { $0 == .deny || $0 == .allowOnce }, id: \.self) { choice in
                                answerButton(choice, actions: actions, pending: pending)
                            }
                        }
                        ForEach(row.filter { $0 != .deny && $0 != .allowOnce }, id: \.self) { choice in
                            answerButton(choice, actions: actions, pending: pending)
                        }
                    }
                }
                if actions.alwaysAllowFolder {
                    quietButton((actions.alwaysAllowFolderWrites ? String(localized: "Always allow changes in the whole folder, deletions included") : String(localized: "Always allow the whole folder")), id: "approval-always-allow-folder") {
                        await session.decide(.alwaysAllowFolder, on: pending, in: chat)
                    }
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

    /// One answer of the row: Deny (or Cancel), the Always allow this card
    /// keeps (its exact scope in the hint), Allow once (or the proposal's
    /// own verb) at the accent.
    @ViewBuilder
    private func answerButton(_ choice: ApprovalDockRules.Choice, actions: ApprovalDockActions, pending: PendingApproval, whole: Bool = false) -> some View {
        switch choice {
        case .deny:
            decisionButton(actions.denyIsCancel ? String(localized: "Cancel") : String(localized: "Deny"), style: .refusal, id: "approval-deny", whole: whole) {
                await session.decide(.deny, on: pending, in: chat)
            }
        case .allowOnce:
            decisionButton(primaryLabel(actions.primary, pending), style: .primary, id: "approval-allow-once", whole: whole) {
                await session.decide(.allowOnce, on: pending, in: chat)
            }
            .disabled(actions.primaryDisabled)
        case .alwaysAllowRule:
            decisionButton(actions.alwaysAllowFolder ? (actions.alwaysAllowFolderWrites ? String(localized: "Always allow changes to this file") : String(localized: "Always allow this file")) : String(localized: "Always allow"), style: .remember, id: "approval-always-allow", whole: whole) {
                await session.decide(.alwaysAllowRule, on: pending, in: chat)
            }
        case .alwaysAllowTool:
            decisionButton(String(localized: "Always allow"), style: .remember, id: "approval-always-allow", whole: whole) {
                await session.decide(.alwaysAllowTool, on: pending, in: chat)
            }
        case .alwaysAllowCommand:
            decisionButton(String(localized: "Always allow"), style: .remember, id: "approval-always-command", whole: whole) {
                await session.decide(.alwaysAllowCommand, on: pending, in: chat)
            }
            .accessibilityHint(Text(
                "Remember this exact command for this bot and provider in \(pending.card.commandAllowlist?.cwd ?? ""), including other threads using that folder"
            ))
        case .alwaysAllowSession:
            decisionButton(String(localized: "Always allow"), style: .remember, id: "approval-always-session", whole: whole) {
                await session.decide(.alwaysAllowSession, on: pending, in: chat)
            }
            .accessibilityHint(Text("The provider stops asking about this action until the session ends"))
        case .alwaysAllowFolder:
            EmptyView()
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

    private enum ButtonStyleKind { case primary, refusal, remember }

    private func decisionButton(
        _ title: String, style: ButtonStyleKind, id: String, whole: Bool = false, _ action: @escaping () async -> Void
    ) -> some View {
        Button {
            // a firm "done" for Allow, a light tap for Deny (`feedback` below)
            if style == .primary { allowed += 1 } else { refused += 1 }
            run(action)
        } label: {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(style == .primary ? .white : Theme.attentionText)
                .lineLimit(1)
                // `whole`: the one-row layout asks for the whole words, so
                // it gives way to two rows instead of cutting them
                .fixedSize(horizontal: whole, vertical: false)
                .minimumScaleFactor(whole ? 1 : 0.8)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(Capsule().fill(style == .primary ? Theme.readable(tint) : (style == .refusal ? Theme.cardRaised : Color.clear)))
                .overlay(Capsule().strokeBorder(style == .remember ? Theme.hairline : Color.clear, lineWidth: 1))
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
