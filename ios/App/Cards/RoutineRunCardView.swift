import CompanionCore
import SwiftUI

/// One routine run, in the conversation that set the routine up: the
/// desktop's `src/components/RoutineRunCard.tsx`, for a phone and the iPad.
///
/// #3581 (the owner, 2026-11-10: "why is it not a card"): a result is the
/// chat's compact card: the routine's glyph and name, the time, the report's
/// closing line in at most two lines (`briefText`), one state line only when
/// there is something to say, the items for the person, the teammates it
/// asked, and "Details" opening the run with the whole report as a normal
/// bot message. The report never unfolds inside the card (the big card
/// refused on 2026-11-05). A run in progress, queued, waiting, failed,
/// cancelled or with nothing to report, and a result a newer result follows
/// (RoutineResultStack), is the one quiet row: icon, name, what it says, the
/// time, Details and Stop while live.
///
/// The computer patches the same message as the run moves, so the row
/// redraws in place; nothing here keeps state about the run.
struct RoutineRunCardView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.desktopChatText) private var desktop
    @EnvironmentObject private var session: Session
    let card: RoutineRunCard
    /// When the message landed: the card's time (the trigger's in the hint).
    let at: Date
    let tint: Color
    /// What the run left for the person (its items, inside the card).
    var attention: PersonAttentionCard? = nil
    /// #3581: a newer result follows this one: the row.
    var folded = false
    /// The bot that ran the routine (kept for callers).
    var bot: Bot? = nil
    /// Opens the run's detail (#2098); nil when this device cannot reach it.
    var openRun: (() -> Void)? = nil
    /// #2096: stops the run while it is live. Nil: no Stop.
    var stop: (() -> Void)? = nil
    /// 2026-10-26: the failure paused its routine (RoutineAutoPause): turn
    /// it back on in one click. Nil: no button.
    var resume: (() -> Void)? = nil
    /// Threads shown only: opens the thread a teammate works in.
    var openThread: ((ThreadRef) -> Void)? = nil

    private var routineName: String {
        card.routineName.isEmpty ? String(localized: "Routine") : card.routineName
    }

    /// Desktop `live`: queued, running or waiting, no goal outcome yet.
    private var live: Bool {
        guard card.goalStatus?.isEmpty ?? true else { return false }
        return card.knownStatus == .running || card.knownStatus == .queued || card.knownStatus == .waiting
    }

    private var running: Bool {
        card.knownStatus == .running && (card.goalStatus?.isEmpty ?? true)
    }

    private var form: RoutineResultStack.Form {
        RoutineResultStack.form(card, attention: attention, folded: folded)
    }

    /// The brief, for a result or a team goal's outcome only.
    private var brief: String {
        RoutineResultStack.isResult(card) || card.goalStatus != nil ? card.briefText : ""
    }

    private var withProblems: Bool { card.hasProblems && card.status == "completed" }

    private var warns: Bool {
        withProblems || card.status == "blocked" || (card.goalStatus.map { $0 != "completed" } ?? false)
            || (attention.map { !$0.items.isEmpty && $0.handledAt == nil } ?? false)
    }

    var body: some View {
        let ink = ApprovalInk.of(desktop, accent: Theme.readable(tint))
        VStack(alignment: .leading, spacing: 4) {
            if form == .card {
                cardForm(ink)
            } else {
                rowForm(ink)
                asked(ink)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: "\(routineName), \(card.stateLabel)"))
        .accessibilityIdentifier("routine-run-message")
    }

    // MARK: The card

    /// The desktop's AskCard measures (result): 16 / 12 around, title
    /// 13.5 semibold in the accent ink, time 11.5, brief 13 four points
    /// under it, the rest 10 under, the footer 12 under; a radius of 24.
    private func cardForm(_ ink: ApprovalInk) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                cardIcon(ink)
                Text(verbatim: routineName)
                    .font(ink.font(13.5, .semibold))
                    .foregroundStyle(ink.accent)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help(Text(verbatim: routineName))
                    .accessibilityIdentifier("routine-run-name")
                Spacer(minLength: 6)
                Text(verbatim: posted)
                    .font(ink.font(11.5, .regular).monospacedDigit())
                    .foregroundStyle(ink.tertiary)
                    .lineLimit(1)
                    .fixedSize()
                    .help(Text(verbatim: triggerHint ?? ""))
            }
            if !brief.isEmpty {
                Text(verbatim: brief)
                    .font(ink.font(13, .regular))
                    .foregroundStyle(ink.secondary)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                    .help(Text(verbatim: brief))
                    .accessibilityIdentifier("routine-run-brief")
                    .padding(.top, 4)
            }
            let hasState = stateLine != nil
            let hasItems = attention.map { !$0.items.isEmpty } ?? false
            if hasState || hasItems || !card.handedTo.isEmpty || card.autoPausedAfter != nil {
                VStack(alignment: .leading, spacing: 8) {
                    if let state = stateLine {
                        Text(verbatim: state.text)
                            .font(ink.font(12, .regular))
                            .foregroundStyle(state.success ? ink.success : Theme.warning)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("routine-run-status")
                    }
                    if let attention, !attention.items.isEmpty {
                        AttentionItemsView(items: attention.items)
                    }
                    asked(ink)
                    if let failures = card.autoPausedAfter {
                        autoPausedLine(failures, ink: ink)
                    }
                }
                .padding(.top, 10)
            }
            if openRun != nil || (live && stop != nil) {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    if live, let stop { quietButton(String(localized: "Stop"), id: "routine-run-stop", ink: ink, label: Text("Stop the run of \(routineName)"), action: stop) }
                    if let openRun { quietButton(String(localized: "Details"), chevron: true, id: "routine-run-open", ink: ink, label: detailsLabel, action: openRun) }
                }
                .padding(.top, 12)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        // a result is as wide as the approval card: the message column
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(desktop?.composer ?? Theme.card)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(desktop?.composerRing ?? Theme.hairline.opacity(0.6), lineWidth: 1)
        }
        .accessibilityIdentifier("routine-run-card")
    }

    @ViewBuilder
    private func cardIcon(_ ink: ApprovalInk) -> some View {
        Group {
            if live {
                ProgressView().controlSize(.mini)
            } else if warns {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.warning)
            } else {
                Image(systemName: "repeat").foregroundStyle(ink.accent)
            }
        }
        .font(.system(size: 15, weight: .medium))
        .frame(width: 16, height: 16)
        .accessibilityHidden(true)
    }

    /// One state line, only when there is something to say: a finished
    /// result without problems has no state word.
    private var stateLine: (text: String, success: Bool)? {
        if card.status == "blocked", card.goalStatus == nil {
            return (blockedLine, false)
        }
        if withProblems || (card.goalStatus.map { $0 != "completed" } ?? false) {
            var text = card.stateLabel
            if withProblems, let lasting = card.`repeat`, lasting.count > 1 {
                text += " · " + String(localized: "Same problem since \(Self.dateTime(lasting.since)), \(lasting.count) runs in a row")
            }
            return (text, false)
        }
        if let recovered = card.recovered {
            return (String(localized: "Works again (problems since \(Self.dateTime(recovered.since)))"), true)
        }
        return nil
    }

    private var blockedLine: String {
        let why = (card.problems ?? card.error ?? card.summary).map { ReportBrief.of($0, from: .start) } ?? ""
        return why.isEmpty ? card.stateLabel : "\(card.stateLabel): \(why)"
    }

    /// The desktop's card time: the hour today, else the day and the hour
    /// ("Yesterday 9:12 AM", "Mon, Sep 28 11:31 AM").
    private var posted: String {
        Calendar.current.isDateInToday(at)
            ? at.formatted(date: .omitted, time: .shortened)
            : DesktopChatMetrics.dayLabel(at)
    }

    private var triggerHint: String? {
        guard let scheduled = card.scheduledFor, abs(scheduled - at.timeIntervalSince1970 * 1000) >= 60_000 else { return nil }
        return Self.dateTime(scheduled)
    }

    static func dateTime(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    // MARK: The row

    /// What the run is doing, or what it said, in one quiet line.
    private var said: String {
        if running || (live && card.knownStatus != .queued && card.knownStatus != .waiting) { return String(localized: "Running") }
        if card.status == "blocked", card.goalStatus == nil { return blockedLine }
        if card.knownStatus == .failed || card.knownStatus == .missed {
            let why = ReportBrief.of(card.error ?? card.summary, from: .start)
            return why.isEmpty ? card.stateLabel : "\(card.stateLabel): \(why)"
        }
        if card.knownStatus == .queued || card.knownStatus == .waiting {
            let why = ReportBrief.of(card.attention ?? card.summary ?? card.error, from: .start)
            return why.isEmpty ? card.stateLabel : "\(card.stateLabel): \(why)"
        }
        if withProblems { return brief.isEmpty ? card.stateLabel : "\(card.stateLabel): \(brief)" }
        if let recovered = card.recovered, brief.isEmpty {
            return String(localized: "Works again (problems since \(Self.dateTime(recovered.since)))")
        }
        return brief.isEmpty ? card.stateLabel : brief
    }

    private func rowForm(_ ink: ApprovalInk) -> some View {
        HStack(spacing: 6) {
            rowIcon(ink)
            (Text(verbatim: routineName).font(ink.font(12.5, .medium)).foregroundColor(ink.secondary)
                + Text(verbatim: " · \(said)")
                + Text(verbatim: card.autoPausedAfter.map { " · " + RoutineWording.autoPaused($0) } ?? "")
                + Text(verbatim: live ? "" : " · ")
                + (live ? Text(verbatim: "") : Text(at, format: .dateTime.hour().minute())))
                .font(ink.font(12.5, .regular))
                .foregroundStyle(ink.tertiary)
                .lineLimit(1)
                .truncationMode(.tail)
                .modifier(RunningPulse(active: running))
                .help(Text(verbatim: "\(routineName) · \(said)"))
                .accessibilityIdentifier("routine-run-status")
            Spacer(minLength: 4)
            if let failures = card.autoPausedAfter, let resume, failures > 0 {
                quietButton(String(localized: "Resume (routine paused after failures)"), id: "routine-run-resume", ink: ink, action: resume)
            }
            if live, let stop { quietButton(String(localized: "Stop"), id: "routine-run-stop", ink: ink, label: Text("Stop the run of \(routineName)"), action: stop) }
            if let openRun { quietButton(String(localized: "Details"), id: "routine-run-open", ink: ink, label: detailsLabel, action: openRun) }
        }
        .padding(.leading, 2)
        .accessibilityIdentifier("routine-run-row")
    }

    @ViewBuilder
    private func rowIcon(_ ink: ApprovalInk) -> some View {
        Group {
            if card.knownStatus == .waiting {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.warning)
            } else if live {
                ProgressView().controlSize(.mini)
            } else if card.knownStatus == .cancelled {
                Image(systemName: "nosign").foregroundStyle(ink.tertiary)
            } else if card.knownStatus == .failed || card.knownStatus == .missed || card.status == "blocked" || warns {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.warning)
            } else {
                Image(systemName: "checkmark").foregroundStyle(ink.success.opacity(0.8))
            }
        }
        .font(.system(size: 11, weight: .semibold))
        .frame(width: 13, height: 13)
        .accessibilityHidden(true)
    }

    private func quietButton(_ title: String, chevron: Bool = false, id: String, ink: ApprovalInk, label: Text? = nil, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 2) {
                Text(verbatim: title)
                if chevron { Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)) }
            }
            // the desktop's ASK_QUIET_BUTTON: 28 tall, 12 aside, 13 medium, tertiary
            .font(ink.font(13, .medium))
            .foregroundStyle(ink.tertiary)
            .padding(.horizontal, 12)
            .frame(minHeight: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label ?? Text(verbatim: title))
        .accessibilityIdentifier(id)
    }

    private var detailsLabel: Text {
        card.goalStatus == "needs-input" ? Text("Review for \(routineName)") : Text("View run for \(routineName)")
    }

    // MARK: Teammates and pause

    /// The teammates the run asked: the one names line ("Asked [faces]").
    @ViewBuilder
    private func asked(_ ink: ApprovalInk) -> some View {
        if !card.handedTo.isEmpty {
            NamesLineView(
                verb: String(localized: "chat.askLine.asked", defaultValue: "Asked"),
                parties: card.handedTo.map { entry in
                    let name = entry.name?.isEmpty == false ? entry.name! : (session.state.bot(entry.botId)?.name ?? String(localized: "a teammate"))
                    return NamesLineParty(
                        id: entry.threadId, botId: entry.botId, name: name,
                        open: openThread.map { open in { open(ThreadRef(botId: entry.botId, threadId: entry.threadId, title: name)) } }
                    )
                },
                testId: "routine-run-handoff"
            )
        }
    }

    /// The failure paused its routine: one muted line and the way back on.
    private func autoPausedLine(_ failures: Int, ink: ApprovalInk) -> some View {
        HStack(spacing: 6) {
            Label {
                Text(verbatim: RoutineWording.autoPaused(failures))
            } icon: {
                Image(systemName: "pause.circle")
            }
            .labelStyle(TightLabel())
            .accessibilityIdentifier("routine-run-auto-paused")
            if let resume {
                Text(verbatim: "·").accessibilityHidden(true)
                Button {
                    Haptics.selection()
                    resume()
                } label: {
                    Label(String(localized: "Resume (routine paused after failures)"), systemImage: "play.fill")
                        .labelStyle(TightLabel())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Resume \(card.routineName)"))
                .accessibilityIdentifier("routine-run-resume")
            }
        }
        .font(ink.font(12, .regular))
        .foregroundStyle(ink.tertiary)
    }
}

/// Icon and words 4 pt apart, as the desktop's inline-flex gap-1.
private struct TightLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
            configuration.title
        }
    }
}

/// Desktop `thinking-shimmer`: the Running word breathes while the run runs;
/// still with Reduce Motion.
private struct RunningPulse: ViewModifier {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    func body(content: Content) -> some View {
        if active && !reduceMotion {
            content
                .opacity(dim ? 0.45 : 1)
                .onAppear {
                    withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
                }
        } else {
            content
        }
    }
}

/// #3581: the routine card's "Details": the run's whole report, drawn as the
/// chat draws a bot's long text, in the sheet a chat row's detail opens in
/// (DigestSheet, IncomingExchangeSheet). The card's own report shows at
/// once; a finished run whose card may hold only a clip is read by its id
/// and its longer report replaces it (RoutineResults.wholeReport).
struct RoutineReportTarget: Identifiable {
    let card: RoutineRunCard
    let at: Date
    /// Threads shown: the run's own thread, when this phone can reach it.
    var thread: ThreadRef? = nil
    var id: String { card.runId }
}

struct RoutineReportSheet: View {
    @Environment(\.themePalette) var themePalette
    let target: RoutineReportTarget
    var openThread: ((ThreadRef) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var run: RoutineRun?

    private var report: String { RoutineResults.wholeReport(card: target.card, run: run) }

    private var title: String {
        target.card.routineName.isEmpty ? String(localized: "Routine") : target.card.routineName
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(target.at, format: .dateTime.month(.abbreviated).day().hour().minute())
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.textTertiary)
                    MarkdownText(source: report, inert: true)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("routine-run-report")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Copy", systemImage: "doc.on.doc") {
                        PlatformBridge.copyToPasteboard(report)
                        Haptics.selection()
                    }
                }
                if let thread = target.thread, let openThread {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(String(localized: "Open")) {
                            dismiss()
                            openThread(thread)
                        }
                        .accessibilityIdentifier("routine-run-report-thread")
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task(id: target.card.runId) {
            guard RoutineResults.wantsWholeReport(target.card) else { return }
            run = await SessionHub.session.routineRunRead(id: target.card.runId)
        }
    }
}
