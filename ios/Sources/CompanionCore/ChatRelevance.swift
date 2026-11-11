// #3581: what enters a bot's main chat. The rule of shared/chat-relevance.ts,
// read here when the phone and the tablet draw (rows stored before the rule
// existed are still in every conversation). The same cases run on the
// server, the desktop and here (shared/chat-relevance.vectors.json).
//
// A row is for the person when it is one of four things: an answer to their
// own message, something that waits for them, a result they asked to
// receive, or a problem that needs them. Everything else is work, and work
// is never content in the main chat: it stays in its own thread, reachable
// from a surface that already exists. This is how every bot behaves: there
// is no switch.
import Foundation

public enum ChatRelevance {
    /// Who the turn was for.
    public enum Origin: String, CaseIterable, Sendable {
        /// The person's own conversation, a background task of it, and the
        /// hand-offs its turn started.
        case person
        /// A routine run or a wake.
        case routine
        /// A thread another bot or the bot itself opened.
        case bot
        /// An AI client's conversation.
        case agent
    }

    /// What the row is, first match wins.
    public enum Signal: String, CaseIterable, Sendable {
        case wait, problem, answer, result, work
    }

    /// Where the row goes in the main chat.
    public enum Place: String, Sendable {
        case card, whole, folded, trace, out
    }

    public struct Facts: Hashable, Sendable {
        /// `person` with `result`: the background task answers a message of the person.
        public var answersPerson: Bool
        /// `routine` with `result`: the routine posts its results in the conversation.
        public var postsResults: Bool
        /// `routine` with `result`: a person started this run.
        public var startedByPerson: Bool

        public init(answersPerson: Bool = false, postsResults: Bool = false, startedByPerson: Bool = false) {
            self.answersPerson = answersPerson
            self.postsResults = postsResults
            self.startedByPerson = startedByPerson
        }
    }

    /// The facts of a routine run the rule reads.
    public struct RunFacts: Hashable, Sendable {
        public var status: String
        public var goalStatus: String?
        public var quiet: Bool
        public var needsPerson: Bool
        public var problems: Bool
        public var attention: Bool
        public var recovered: Bool
        public var startedBy: String?

        public init(status: String, goalStatus: String? = nil, quiet: Bool = false, needsPerson: Bool = false,
                    problems: Bool = false, attention: Bool = false, recovered: Bool = false, startedBy: String? = nil) {
            self.status = status
            self.goalStatus = goalStatus
            self.quiet = quiet
            self.needsPerson = needsPerson
            self.problems = problems
            self.attention = attention
            self.recovered = recovered
            self.startedBy = startedBy
        }
    }

    /// The rule.
    public static func place(_ origin: Origin, _ signal: Signal, _ facts: Facts = Facts()) -> Place {
        if signal == .wait || signal == .problem { return .card }
        switch origin {
        case .person:
            if signal == .answer { return .whole }
            if signal == .result { return facts.answersPerson ? .whole : .folded }
            return .folded
        case .routine:
            if signal == .result { return facts.postsResults || facts.startedByPerson ? .card : .out }
            return .out
        case .bot, .agent:
            return .trace
        }
    }

    /// Who a thread's turn was for, from the one reading of a thread's
    /// origin (shared/background-threads.ts, `BotTask.isBackground`). A
    /// thread that is none of the background kinds is the person's own.
    public static func origin(_ task: BotTask?) -> Origin {
        guard let task else { return .person }
        if task.routineRunId != nil || task.routineResults == true { return .routine }
        if task.hidden == true { return .agent }
        guard let opener = task.openedBy else { return .person }
        if opener.kind == "agent" { return .agent }
        if task.personWrote == true { return .person }
        return .bot
    }

    private static let liveRun: Set<String> = ["queued", "running", "waiting"]

    /// What a routine run's row is. A run a person started is a result from
    /// its start; another live run is work until it ends.
    public static func signal(_ run: RunFacts) -> Signal {
        if run.goalStatus == "needs-input" { return .wait }
        if run.status == "waiting" && run.needsPerson { return .wait }
        if run.status == "failed" || run.status == "blocked" { return .problem }
        if run.status == "completed" {
            if run.problems || run.attention || run.recovered { return .problem }
            return run.quiet ? .work : .result
        }
        if run.startedBy == "person" && liveRun.contains(run.status) { return .result }
        return .work
    }
}
