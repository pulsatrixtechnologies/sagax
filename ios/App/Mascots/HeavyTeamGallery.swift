// DEBUG only: `-mascotGallery heavy` (and `heavy-thoughts`). A Heavy run's row (#5091, the
// desktop's scripts/capture/heavy-team.mjs; #5487 / M-20261127-178): every
// expert is the conversation's bot duplicated (same character, shape, skin,
// colours or picture as the header), never a colour per expert or an owl of
// its own. The orbit while the experts propose (one pulsing, Auto's one line
// above), while they critique (the lines), on agreement (merged into the bot
// while it writes), then the row after ("Thought for 26s", the leader
// decided). The real HeavyTeamRowView, in the skin of `-paritySkin` (black
// for dark, pulsatrix-light for light). Synthetic words only.
import SwiftUI
#if DEBUG
import CompanionCore

struct HeavyTeamGallery: View {
    @Environment(\.themePalette) var themePalette
    /// `-mascotGallery heavy-thoughts`: the Thoughts sheet of the decided run.
    var thoughts = false
    private let now = Date().timeIntervalSince1970 * 1000
    private let chat = Chat.bot(Self.bot(busy: false))

    var body: some View {
        if thoughts {
            HeavyThoughtsSheet(line: cases[3].line, chat: chat)
                .preferredColorScheme(themePalette.isDark ? .dark : .light)
        } else {
            rows
        }
    }

    private var rows: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ForEach(Array(cases.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: item.title).font(.caption).foregroundStyle(Theme.textTertiary)
                        HeavyTeamRowView(line: item.line, chat: .bot(Self.bot(busy: item.busy)))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 64)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.bg.ignoresSafeArea())
        .preferredColorScheme(themePalette.isDark ? .dark : .light)
        .accessibilityIdentifier("heavy-gallery")
    }

    private var cases: [(title: String, line: HeavyTeamLine, busy: Bool)] {
        let start = now - 14_000
        let leader = HeavyTeamLine.Leader(engineLabel: "OpenAI", modelLabel: "GPT-6 Astra", steps: [
            .init(kind: "planned", at: start + 2_000), .init(kind: "sent", at: start + 2_000), .init(kind: "processing", at: start + 2_000),
        ])
        func expert(_ n: Int, _ persona: String, status: String = "working", messages: [String] = [], live: String? = nil, speaking: Bool = false, agrees: Bool? = nil) -> HeavyTeamLine.Expert {
            .init(n: n, persona: persona, engineLabel: n % 2 == 0 ? "OpenAI" : "Claude", modelLabel: n % 2 == 0 ? "GPT-6 Astra" : "Claude Opus 5.5",
                  status: status, messages: messages, live: live, speaking: speaking ? true : nil, agrees: agrees)
        }
        let propose = HeavyTeamLine(
            phase: "agents", startedAt: start, updatedAt: now,
            agents: [
                expert(1, "Skeptic", messages: ["Migrate in two waves, the office first, the data centre a week later."]),
                expert(2, "Security", live: "Export the rule base and the NAT table before anything", speaking: true),
                expert(3, "Cost"),
                expert(4, "User's advocate"),
            ],
            rounds: [.init(n: 1, kind: "propose", startedAt: start)], auto: "risky", leader: leader
        )
        let critique = HeavyTeamLine(
            phase: "agents", startedAt: start, updatedAt: now,
            agents: [
                expert(1, "Skeptic", messages: ["Two waves.", "Agreed, with a rollback."], live: "Round 3: with the export first,", speaking: true),
                expert(2, "Security", messages: ["Export first.", "The export is still not in the plan's first step."]),
                expert(3, "Cost", messages: ["One wave.", "Two waves, fine."], live: "Round 3: with the export first,"),
                expert(4, "User's advocate", messages: ["Keep the VPN names.", "Fine, if the VPN names stay the same."]),
            ],
            rounds: [
                .init(n: 1, kind: "propose", startedAt: start, endedAt: start + 4_000),
                .init(n: 2, kind: "critique", startedAt: start + 4_000, endedAt: start + 9_000),
                .init(n: 3, kind: "critique", startedAt: start + 9_000),
            ],
            leader: leader
        )
        var merged = HeavyTeamLine(
            phase: "leader", startedAt: start, thoughtEndedAt: now, updatedAt: now,
            agents: critique.agents.map(Self.settled),
            rounds: [
                .init(n: 1, kind: "propose", startedAt: start, endedAt: start + 6_000),
                .init(n: 2, kind: "critique", startedAt: start + 6_000, endedAt: now, agreed: true),
            ],
            outcome: "agreed", leader: leader
        )
        merged.auto = nil
        let begin: Double = now - 26_000
        var rounds: [HeavyTeamLine.Round] = []
        for n in 1...5 {
            let from: Double = begin + Double(n - 1) * 5_000
            rounds.append(HeavyTeamLine.Round(n: n, kind: n == 1 ? "propose" : "critique", startedAt: from, endedAt: from + 5_000))
        }
        var experts: [HeavyTeamLine.Expert] = merged.agents
        experts[1].agrees = false
        let decidedLeader = HeavyTeamLine.Leader(engineLabel: "OpenAI", modelLabel: "GPT-6 Astra", steps: [
            .init(kind: "planned", at: begin + 2_000), .init(kind: "sent", at: begin + 2_000), .init(kind: "processing", at: begin + 2_000),
            .init(kind: "decided", at: now, round: 5), .init(kind: "writing", at: now),
        ])
        let decided = HeavyTeamLine(
            phase: "done", startedAt: begin, thoughtEndedAt: now, updatedAt: now, agents: experts, rounds: rounds,
            outcome: "decided", disagreements: ["who owns the data centre cutover", "export the rule base first"], leader: decidedLeader
        )
        return [
            ("Propose · Auto chose Heavy", propose, true),
            ("Critique · lines", critique, true),
            ("Agreement · merged into the bot", merged, true),
            ("After · the leader decided", decided, false),
        ]
    }

    /// An expert once its rounds are over: done, quiet, agreeing.
    private static func settled(_ agent: HeavyTeamLine.Expert) -> HeavyTeamLine.Expert {
        var next = agent
        next.status = "done"
        next.speaking = nil
        next.live = nil
        next.agrees = true
        return next
    }

    /// A brown cat shape with its own colour and a skin: captures show every
    /// expert is that bot, not an owl in blue/green/orange (M-20261127-178).
    private static func bot(busy: Bool) -> Bot {
        let json = """
        {"id":"wren","threadId":"wren","name":"Wren","title":"","description":"","notifications":true,
         "color":"brown","unread":false,"busy":\(busy),"modelSelection":{"instanceId":"e","model":"m"},"createdAt":0,
         "mascotLook":{"character":"shape","shape":"cat","bodyColor":"#7a4a2a","skins":{"shape":"glossy"}}}
        """
        return try! JSONDecoder().decode(Bot.self, from: Data(json.utf8))
    }
}
#endif
