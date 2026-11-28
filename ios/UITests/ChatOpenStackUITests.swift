import XCTest

/// Opening a chat must leave the main thread's stack far from its limit.
///
/// TestFlight 0.8.71, 0.8.153 and 0.8.167 crashed the instant a chat opened:
/// "Thread stack size exceeded due to excessive recursion" on the main
/// thread, whose stack is 1 MB on an iPhone. The app measures how deep the
/// stack went while the chat opened (MainStackProbe, `-stack-probe`) and
/// this test holds it under nine tenths of that 1 MB, so the next regression
/// fails here, on the simulator, before a build leaves.
///
/// Half of the stack is not a target this code can reach, and the measure of
/// 2026-11-27 says why: at the deepest point a row's body sat under 697 frames,
/// and 2 of them are ours (`MainStackProbe.noteRow` and `MessageRow.body`). The
/// other 695 are AttributeGraph and SwiftUICore walking the layout down from the
/// window, through 85 nested attribute updates of about 7 800 bytes each; 63 of
/// those frames are the preference machinery every background, overlay and
/// presentation above a row feeds. A row's body of the 2000 plain rows costs
/// 664 089 bytes of a phone's 1 MB before its content is drawn, which is more
/// than the 524 288 bytes half of the stack would leave. What we hold is the
/// margin: nine tenths of the stack for a chat open, two thirds for a row body.
final class ChatOpenStackUITests: XCTestCase {
    /// An iPhone's main thread stack (the crash reports: 1008 KB plus the guard).
    static let deviceStack = 1024 * 1024
    /// The budget for a chat open: nine tenths of it. Opening a chat measured
    /// 886 408 bytes of it for 2000 plain rows and 852 152 for 600 rich rows on
    /// 2026-11-27, which leaves 57 305 bytes under this budget and about
    /// 162 168 of the 1 MB; the crashes of 0.8.71, 0.8.153 and 0.8.167 were past
    /// the whole 1008 KB. The same build carrying the Debug-only probes of the
    /// transcript read 883 320 and 853 288, and two runs of one tree differ by a
    /// few thousand bytes either way, so those probes are not where the margin
    /// went. This number only comes down: raising it needs the new measure and
    /// its reason in `ios/TESTING.md`.
    static let budget = deviceStack / 10 * 9
    /// How deep one transcript row's body may be: two thirds of the stack a
    /// phone gives its main thread. It gets its own number because it decides
    /// the margin, since everything a message draws stacks on top of it: a row
    /// of the 2000 plain rows measured 664 089 bytes and a rich one 629 833 on
    /// 2026-11-27, so the hold has 34 961 bytes of room. Half of the stack, the
    /// goal of `ios/TESTING.md`, is 524 288 bytes, less than one row body costs
    /// on its own, and 695 of its 697 frames are Apple's rather than ours
    /// (#5169). It comes down the same way `budget` does.
    static let rowBodyBudget = deviceStack / 3 * 2

    @MainActor
    func testRichLongChatOpensWithinTheStackBudget() throws {
        let report = try openChat(rich: 600)
        XCTAssertGreaterThan(report.rowKinds.count, 1, "the rich conversation is drawn: \(report.rowKinds)")
        XCTAssertLessThan(report.chatOpenPeak, Self.budget, report.summary)
        XCTAssertLessThan(report.rowBodyDepthBytes, Self.rowBodyBudget, report.summary)
    }

    @MainActor
    func testPlainLongChatOpensWithinTheStackBudget() throws {
        let report = try openChat(long: 2000)
        XCTAssertLessThan(report.chatOpenPeak, Self.budget, report.summary)
        XCTAssertLessThan(report.rowBodyDepthBytes, Self.rowBodyBudget, report.summary)
    }

    struct Report: Decodable {
        let stackSize: Int
        let peakBytes: Int
        let rowBodyDepthBytes: Int
        let rowBodySymbols: [String]
        let ticks: [[Double]]
        let rowKinds: [String]
        /// Optional so a build of the app that predates these fields reads, and
        /// the assertion below says what is missing instead of a decode error.
        /// How many frames a row's body sat under, and how many were ours.
        let rowBodyFrames: Int?
        let rowBodyOwnFrames: Int?
        /// Whether the build compiled out the `#if DEBUG` layout probes of the
        /// transcript. A phone runs Release without them, so a number that came
        /// from a tree carrying them measures a stack no phone lays out.
        let debugProbesCompiledOut: Bool?
        var openedAt = 0.0
        /// The deepest the stack went from the tap on the chat on.
        var chatOpenPeak: Int { Int(ticks.filter { $0[0] >= openedAt }.map { $0[1] }.max() ?? 0) }
        var summary: String {
            "chat open \(chatOpenPeak) bytes of the main stack (budget \(ChatOpenStackUITests.budget)), "
                + "whole run \(peakBytes), a row's body at \(rowBodyDepthBytes) "
                + "(budget \(ChatOpenStackUITests.rowBodyBudget), \(rowBodyOwnFrames.map(String.init) ?? "?") of its "
                + "\(rowBodyFrames.map(String.init) ?? "?") frames ours), "
                + "Debug probes compiled out \(debugProbesCompiledOut.map(String.init) ?? "no"), "
                + "simulator stack \(stackSize), kinds \(rowKinds)"
        }
        private enum CodingKeys: String, CodingKey {
            case stackSize, peakBytes, rowBodyDepthBytes, rowBodySymbols, ticks, rowKinds
            case rowBodyFrames, rowBodyOwnFrames, debugProbesCompiledOut
        }
    }

    @MainActor
    private func openChat(rich: Int? = nil, long: Int? = nil) throws -> Report {
        continueAfterFailure = false
        let out = "/tmp/sagax-stack-\(UUID().uuidString).json"
        let app = XCUIApplication()
        app.terminate()
        var args = [
            "-store-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES",
            "-stack-probe", out,
        ]
        if let rich { args += ["-rich-transcript-preview", String(rich)] }
        if let long { args += ["-long-transcript-preview", String(long)] }
        app.launchArguments = args
        app.launch()
        var row = app.buttons["chat-row.preview-scout"]
        if !row.waitForExistence(timeout: 20) {
            app.terminate()
            app.launch()
            row = app.buttons["chat-row.preview-scout"]
        }
        XCTAssertTrue(row.waitForExistence(timeout: 30), "Scout on the home roster")
        let openedAt = Date().timeIntervalSince1970
        row.tap()
        XCTAssertTrue(app.buttons["chat-name"].waitForExistence(timeout: 60), "chat opened")
        // the probe reads the stack every 0.25 s
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        XCTAssertEqual(app.state, .runningForeground, "the app is still running")
        let data = try Data(contentsOf: URL(fileURLWithPath: out))
        var report = try JSONDecoder().decode(Report.self, from: data)
        XCTAssertEqual(
            report.debugProbesCompiledOut, true,
            "the measure must read the tree a phone lays out: build it with STACK_MEASURE, "
                + "which scripts/check-ios-chat-stack.sh passes (#5169). \(report.summary)"
        )
        report.openedAt = openedAt
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "stack-probe"
        attachment.lifetime = .keepAlways
        add(attachment)
        print("STACK-PROBE \(report.summary)")
        return report
    }
}
