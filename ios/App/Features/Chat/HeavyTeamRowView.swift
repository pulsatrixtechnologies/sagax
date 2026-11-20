// A Heavy run in the chat (#5091, the desktop's HeavyTeamRow.tsx and
// HeavyOrbit.tsx, #5089, #5090): while the team works, the experts' owls
// orbit the bot's avatar, the one speaking pulses, lines link them while
// they critique, they merge into the bot on agreement; beside it "Experts
// thinking · round 2 of 5 · 6s" and a live line per expert. After: "Thought
// for 8s · agreed in round 2" (or the leader decided), which opens the
// Thoughts sheet with every expert's messages. Auto's choice of Heavy reads
// in one line above. The state is the server's (CompanionCore HeavyTeamLine).
import SwiftUI
import CompanionCore

/// The owls that stand for the experts, one plumage each (the desktop's AGENT_COLORS).
private let expertColors = ["blue", "green", "orange", "purple", "pink"]

/// A leader's step in the person's words (the desktop's leaderStepText).
private func leaderStepText(_ step: HeavyTeamLine.LeaderStep) -> String {
    switch step.kind {
    case "planned": return String(localized: "Picked the team")
    case "sent": return String(localized: "Sent to the experts")
    case "agreed": return String(localized: "Experts agreed in round \(step.round ?? 0)")
    case "decided": return String(localized: "No agreement after round \(step.round ?? 0): deciding")
    case "writing": return String(localized: "Writing the plan and acting")
    default: return String(localized: "Experts working…")
    }
}

struct HeavyTeamRowView: View {
    let line: HeavyTeamLine
    let chat: Chat
    @State private var thoughtsOpen = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let busy = chat.busy
            let running = line.isRunning(busy: busy)
            let working = (line.phase == "planning" || line.phase == "agents") && busy
            let orbit = working || (line.merged && line.phase == "leader" && busy)
            VStack(alignment: .leading, spacing: 4) {
                if let auto = autoText { Text(auto).font(.footnote).foregroundStyle(Theme.textSecondary).accessibilityIdentifier("heavy-auto") }
                HStack(alignment: .top, spacing: 10) {
                    if orbit { HeavyOrbitView(line: line, chat: chat, running: running) }
                    VStack(alignment: .leading, spacing: 4) {
                        Button { thoughtsOpen = true } label: {
                            HStack(spacing: 6) {
                                if !orbit, !line.agents.isEmpty { owlStack }
                                Text(header(now: context.date.timeIntervalSince1970 * 1000, busy: busy, running: running))
                                    .foregroundStyle(Theme.textSecondary)
                                    .accessibilityIdentifier("heavy-header")
                                if !working, let outcome = outcomeText {
                                    Text("· \(outcome)").foregroundStyle(Theme.textTertiary).lineLimit(1)
                                }
                                Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(Theme.textTertiary)
                            }
                            .font(.subheadline)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint(Text("Open the Thoughts panel"))
                        .accessibilityIdentifier("heavy-open")
                        if working {
                            ForEach(line.agents, id: \.n) { expert in
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Text(name(expert)).foregroundStyle(expert.speaking == true ? Theme.textPrimary : Theme.textSecondary).lineLimit(1).frame(width: 128, alignment: .leading)
                                    Text(preview(expert)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                                }
                                .font(.footnote)
                            }
                            // the leader's step, under the experts (the desktop's data-heavy-leader)
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("Leader").foregroundStyle(Theme.textSecondary).lineLimit(1).frame(width: 128, alignment: .leading)
                                Text(leaderStepText(line.leaderNow)).foregroundStyle(Theme.textTertiary).lineLimit(1)
                            }
                            .font(.footnote)
                            .accessibilityIdentifier("heavy-leader")
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $thoughtsOpen) { HeavyThoughtsSheet(line: line) }
        .accessibilityIdentifier("heavy-team")
    }

    private var owlStack: some View {
        HStack(spacing: -6) {
            ForEach(Array(line.agents.enumerated()), id: \.offset) { index, _ in
                OwlMascotView(color: expertColors[index % expertColors.count], size: 18)
            }
        }
        .accessibilityLabel(Text("\(line.agents.count) experts"))
    }

    private func header(now: Double, busy: Bool, running: Bool) -> String {
        let seconds = line.thoughtSeconds(now: now, running: running)
        let elapsed = String(localized: "\(seconds)s")
        let working = line.phase == "planning" || line.phase == "agents"
        if line.phase == "stopped" || (working && !busy) { return String(localized: "Stopped after \(elapsed)") }
        if line.phase == "planning" { return String(localized: "Leader picking the team · \(elapsed)") }
        if line.phase == "agents", let round = line.currentRound ?? line.rounds.last {
            return String(localized: "Experts thinking · round \(round.n) of \(line.maxRounds) · \(elapsed)")
        }
        if line.phase == "agents" { return String(localized: "Experts thinking · \(elapsed)") }
        return String(localized: "Thought for \(elapsed)")
    }

    private var outcomeText: String? {
        let last = line.rounds.last?.n ?? 0
        if line.outcome == "agreed" { return String(localized: "agreed in round \(line.rounds.first { $0.agreed == true }?.n ?? last)") }
        if line.outcome == "decided" { return String(localized: "no agreement after \(last) rounds, the leader decided") }
        return nil
    }

    private var autoText: String? {
        switch line.auto {
        case "risky": return String(localized: "Auto chose Heavy: a risky task.")
        case "big": return String(localized: "Auto chose Heavy: a big task.")
        default: return nil
        }
    }

    private func name(_ expert: HeavyTeamLine.Expert) -> String {
        if let persona = expert.persona { return String(localized: "Expert \(expert.n) · \(persona)") }
        return String(localized: "Expert \(expert.n)")
    }

    private func preview(_ expert: HeavyTeamLine.Expert) -> String {
        let text = (expert.live ?? expert.messages.last ?? "").replacingOccurrences(of: "\n", with: " ")
        if !text.isEmpty { return text }
        return expert.status == "working" ? String(localized: "Thinking…") : expert.error ?? ""
    }
}

/// The experts around the bot (the desktop's HeavyOrbit.tsx): a slow turn,
/// the speaker pulsing, the critique lines, the merge on agreement. Still
/// under Reduce Motion.
private struct HeavyOrbitView: View {
    let line: HeavyTeamLine
    let chat: Chat
    let running: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let size: CGFloat = 92
    private let expert: CGFloat = 22
    private let leader: CGFloat = 34

    var body: some View {
        TimelineView(.animation(paused: reduceMotion || !running || line.merged)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            let turn = reduceMotion ? 0 : (t.truncatingRemainder(dividingBy: 14) / 14) * 2 * Double.pi
            let radius = Double(size / 2 - expert / 2 - 1)
            let count = line.agents.count
            let point = { (index: Int) -> CGPoint in
                let place = HeavyTeamLine.place(index, of: count, radius: radius)
                let x = place.x * cos(turn) - place.y * sin(turn)
                let y = place.x * sin(turn) + place.y * cos(turn)
                return CGPoint(x: size / 2 + x, y: size / 2 + y)
            }
            ZStack {
                Canvas { context, _ in
                    guard running, !line.merged else { return }
                    for pair in line.critiqueLinks {
                        guard let a = line.agents.firstIndex(where: { $0.n == pair[0] }), let b = line.agents.firstIndex(where: { $0.n == pair[1] }) else { continue }
                        var path = Path()
                        path.move(to: point(a))
                        path.addLine(to: point(b))
                        let hot = line.agents[a].speaking == true || line.agents[b].speaking == true
                        context.stroke(path, with: .color(hot ? Theme.accent : Theme.textTertiary),
                                       style: StrokeStyle(lineWidth: hot ? 1.4 : 1, lineCap: .round, dash: [3, 3], dashPhase: reduceMotion ? 0 : CGFloat(t * 13).truncatingRemainder(dividingBy: 12)))
                    }
                }
                ForEach(Array(line.agents.enumerated()), id: \.element.n) { index, member in
                    let speaking = running && member.speaking == true
                    let pulse = speaking && !reduceMotion ? 1 + 0.14 * (0.5 + 0.5 * sin(t * 2 * Double.pi / 1.1)) : 1
                    OwlMascotView(color: expertColors[index % expertColors.count], size: expert, state: speaking ? .thinking : .idle, animated: speaking)
                        .scaleEffect(line.merged ? 0.3 : pulse)
                        .opacity(line.merged ? 0 : member.status == "failed" ? 0.45 : 1)
                        .position(line.merged ? CGPoint(x: size / 2, y: size / 2) : point(index))
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.7), value: line.merged)
                        .accessibilityIdentifier("heavy-orbit-expert-\(member.n)")
                }
                ChatAvatarView(chat: chat, size: leader, state: running ? .thinking : .idle, animated: running)
                    .frame(width: leader, height: leader)
                    .position(x: size / 2, y: size / 2)
            }
            .frame(width: size, height: size)
        }
        .accessibilityHidden(true)
        .accessibilityIdentifier(line.merged ? "heavy-orbit-merged" : "heavy-orbit")
    }
}

/// The Thoughts sheet (the desktop's ThoughtsPanel.tsx): how it ended, the
/// points still in dispute, then each expert with its persona, seat and one
/// message per round.
struct HeavyThoughtsSheet: View {
    let line: HeavyTeamLine
    @Environment(\.dismiss) private var dismiss

    private var outcomeLine: String? {
        let last = line.rounds.last?.n ?? 0
        if line.outcome == "agreed" { return String(localized: "agreed in round \(line.rounds.first { $0.agreed == true }?.n ?? last)") }
        if line.outcome == "decided" { return String(localized: "no agreement after \(last) rounds, the leader decided") }
        return nil
    }

    var body: some View {
        NavigationStack {
            List {
                Section(header: Text("Leader")) {
                    Text(verbatim: line.leader.modelLabel).foregroundStyle(Theme.textSecondary)
                    // its steps, each at its second of the run (ThoughtsPanel.tsx)
                    ForEach(Array(line.leader.steps.enumerated()), id: \.offset) { _, step in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(String(localized: "\(Swift.max(0, Int(((step.at - line.startedAt) / 1000).rounded())))s"))
                                .font(.footnote.monospacedDigit())
                                .foregroundStyle(Theme.textTertiary)
                                .frame(width: 36, alignment: .leading)
                            Text(leaderStepText(step)).foregroundStyle(Theme.textSecondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    // how it ended, as the row says it (ThoughtsPanel.tsx)
                    if let outcome = outcomeLine {
                        Text(verbatim: outcome)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("heavy-thoughts-outcome")
                    }
                    if line.outcome == "decided", let points = line.disagreements, !points.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Still in dispute").font(.footnote).foregroundStyle(Theme.textSecondary)
                            ForEach(points, id: \.self) { Text(verbatim: "• \($0)") }
                        }
                    }
                }
                ForEach(Array(line.agents.enumerated()), id: \.element.n) { index, expert in
                    Section(header: HStack(spacing: 6) {
                        OwlMascotView(color: expertColors[index % expertColors.count], size: 18)
                        Text(expert.persona.map { String(localized: "Expert \(expert.n) · \($0)") } ?? String(localized: "Expert \(expert.n)"))
                            .lineLimit(1)
                            .layoutPriority(1)
                        Text(verbatim: expert.modelLabel).foregroundStyle(Theme.textSecondary).lineLimit(1)
                        Spacer(minLength: 4)
                        // its last verdict (the desktop's Agrees / Disagrees)
                        if let agrees = expert.agrees {
                            (agrees ? Text("Agrees") : Text("Disagrees")).foregroundStyle(Theme.textTertiary).lineLimit(1).fixedSize()
                        }
                    }) {
                        ForEach(Array(expert.messages.enumerated()), id: \.offset) { round, text in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Round \(round + 1)").font(.caption).foregroundStyle(Theme.textTertiary)
                                Text(verbatim: text)
                            }
                        }
                        if let live = expert.live { Text(verbatim: live) }
                        if let error = expert.error { Text(verbatim: error).foregroundStyle(Theme.warning) }
                    }
                }
            }
            .navigationTitle(Text("Thoughts"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button { dismiss() } label: { Text("Done") } }
            }
        }
    }
}
