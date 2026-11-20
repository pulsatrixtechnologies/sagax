// A Heavy run's row (#5091, the desktop's #5089 and #5090), as the server
// writes it in `tool.team` (shared/heavy-team.ts): the experts, their
// personas and seats, every round, who speaks, each verdict, the outcome.
// The phone draws the same orbit as the desktop (HeavyTeamRowView.swift):
// the experts turn around the bot, the one speaking pulses, lines link them
// while they critique, they merge into the bot on agreement. The engine is
// the server's alone.
import Foundation

public struct HeavyTeamLine: Codable, Hashable, Sendable {
    public struct Expert: Codable, Hashable, Sendable {
        public var n: Int
        public var persona: String?
        public var engineLabel: String
        public var modelLabel: String
        /// working, done, failed, stopped
        public var status: String
        public var messages: [String]
        public var live: String?
        public var speaking: Bool?
        public var agrees: Bool?
        public var error: String?

        public init(n: Int, persona: String? = nil, engineLabel: String, modelLabel: String, status: String, messages: [String] = [], live: String? = nil, speaking: Bool? = nil, agrees: Bool? = nil, error: String? = nil) {
            self.n = n
            self.persona = persona
            self.engineLabel = engineLabel
            self.modelLabel = modelLabel
            self.status = status
            self.messages = messages
            self.live = live
            self.speaking = speaking
            self.agrees = agrees
            self.error = error
        }
    }

    public struct Round: Codable, Hashable, Sendable {
        public var n: Int
        /// propose, critique
        public var kind: String
        public var startedAt: Double
        public var endedAt: Double?
        public var agreed: Bool?

        public init(n: Int, kind: String, startedAt: Double, endedAt: Double? = nil, agreed: Bool? = nil) {
            self.n = n
            self.kind = kind
            self.startedAt = startedAt
            self.endedAt = endedAt
            self.agreed = agreed
        }
    }

    /// One step of the leader (shared/heavy-team.ts HeavyLeaderStep): planned,
    /// sent, processing, agreed, decided, writing.
    public struct LeaderStep: Codable, Hashable, Sendable {
        public var kind: String
        public var at: Double
        /// The round it happened in (agreed, decided).
        public var round: Int?

        public init(kind: String, at: Double, round: Int? = nil) {
            self.kind = kind
            self.at = at
            self.round = round
        }
    }

    public struct Leader: Codable, Hashable, Sendable {
        public var engineLabel: String
        public var modelLabel: String
        /// What the leader did, in order (the live line, the Thoughts sheet).
        public var steps: [LeaderStep]

        public init(engineLabel: String, modelLabel: String, steps: [LeaderStep] = []) {
            self.engineLabel = engineLabel
            self.modelLabel = modelLabel
            self.steps = steps
        }

        enum CodingKeys: String, CodingKey { case engineLabel, modelLabel, steps }

        public init(from decoder: Decoder) throws {
            let box = try decoder.container(keyedBy: CodingKeys.self)
            engineLabel = try box.decode(String.self, forKey: .engineLabel)
            modelLabel = try box.decode(String.self, forKey: .modelLabel)
            // steps that do not read are left out, never the row (a row from before them has none)
            steps = (try? box.decodeIfPresent([LeaderStep].self, forKey: .steps)) ?? []
        }
    }

    /// The step the leader is on: the last one (the desktop's leaderNow).
    public var leaderNow: LeaderStep {
        leader.steps.last ?? LeaderStep(kind: "processing", at: startedAt)
    }

    /// planning, agents, leader, done, stopped
    public var phase: String
    public var startedAt: Double
    public var thoughtEndedAt: Double?
    public var updatedAt: Double
    public var agents: [Expert]
    public var rounds: [Round]
    public var maxRounds: Int
    /// agreed, decided
    public var outcome: String?
    public var disagreements: [String]?
    /// Auto chose Heavy on its own: big, risky.
    public var auto: String?
    public var leader: Leader

    enum CodingKeys: String, CodingKey {
        case phase, startedAt, thoughtEndedAt, updatedAt, agents, rounds, maxRounds, outcome, disagreements, auto, leader
    }

    public init(phase: String, startedAt: Double, thoughtEndedAt: Double? = nil, updatedAt: Double, agents: [Expert], rounds: [Round] = [], maxRounds: Int = 5, outcome: String? = nil, disagreements: [String]? = nil, auto: String? = nil, leader: Leader) {
        self.phase = phase
        self.startedAt = startedAt
        self.thoughtEndedAt = thoughtEndedAt
        self.updatedAt = updatedAt
        self.agents = agents
        self.rounds = rounds
        self.maxRounds = maxRounds
        self.outcome = outcome
        self.disagreements = disagreements
        self.auto = auto
        self.leader = leader
    }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        phase = try box.decode(String.self, forKey: .phase)
        startedAt = try box.decode(Double.self, forKey: .startedAt)
        thoughtEndedAt = try box.decodeIfPresent(Double.self, forKey: .thoughtEndedAt)
        updatedAt = (try? box.decodeIfPresent(Double.self, forKey: .updatedAt)) ?? startedAt
        agents = (try? box.decodeIfPresent([Expert].self, forKey: .agents)) ?? []
        // a row from before the rounds (#4924) has none
        rounds = (try? box.decodeIfPresent([Round].self, forKey: .rounds)) ?? []
        maxRounds = (try? box.decodeIfPresent(Int.self, forKey: .maxRounds)) ?? 5
        outcome = try? box.decodeIfPresent(String.self, forKey: .outcome)
        disagreements = try? box.decodeIfPresent([String].self, forKey: .disagreements)
        auto = try? box.decodeIfPresent(String.self, forKey: .auto)
        leader = (try? box.decode(Leader.self, forKey: .leader)) ?? Leader(engineLabel: "", modelLabel: "")
    }

    /// The row shows a live run: the server patched it and the chat's turn still works.
    public func isRunning(busy: Bool) -> Bool {
        busy && (phase == "planning" || phase == "agents" || phase == "leader")
    }

    /// The round running now, if any.
    public var currentRound: Round? {
        guard let last = rounds.last, last.endedAt == nil else { return nil }
        return last
    }

    /// How long the team thought, in seconds.
    public func thoughtSeconds(now: Double, running: Bool) -> Int {
        let end = thoughtEndedAt ?? (running ? now : updatedAt)
        return Swift.max(0, Int(((end - startedAt) / 1000).rounded()))
    }

    /// While a critique round runs, every two experts still in it are linked.
    public var critiqueLinks: [[Int]] {
        guard phase == "agents", currentRound?.kind == "critique" else { return [] }
        let live = agents.filter { $0.status == "working" }.map(\.n)
        var out: [[Int]] = []
        for a in 0..<live.count { for b in (a + 1)..<live.count { out.append([live[a], live[b]]) } }
        return out
    }

    /// On agreement the experts merge into the bot, once the rounds are over.
    public var merged: Bool { outcome == "agreed" && (phase == "leader" || phase == "done") }

    /// Where expert `index` of `count` sits around the bot: evenly, the first at the top.
    public static func place(_ index: Int, of count: Int, radius: Double) -> (x: Double, y: Double) {
        let angle = -Double.pi / 2 + Double(index) * 2 * Double.pi / Double(Swift.max(1, count))
        return (radius * cos(angle), radius * sin(angle))
    }
}
