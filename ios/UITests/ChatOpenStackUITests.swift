import XCTest

/// Opening a chat must leave the main thread's stack far from its limit.
///
/// TestFlight 0.8.71, 0.8.153 and 0.8.167 crashed the instant a chat opened:
/// "Thread stack size exceeded due to excessive recursion" on the main
/// thread, whose stack is 1 MB on an iPhone. The app measures how deep the
/// stack went while the chat opened (MainStackProbe, `-stack-probe`) and
/// this test holds it under half of that 1 MB, so the next regression fails
/// here, on the simulator, before a build leaves.
final class ChatOpenStackUITests: XCTestCase {
    /// An iPhone's main thread stack (the crash reports: 1008 KB plus the guard).
    static let deviceStack = 1024 * 1024
    /// The budget for a chat open: nine tenths of it. Opening a chat measured
    /// 867 KB of it for 2000 plain rows and 844 KB for 600 rich rows on
    /// 2026-11-21, with the modifier chain made unary for #5159; the crashes of
    /// 0.8.71, 0.8.153 and 0.8.167 were past the whole 1008 KB. The goal is half
    /// of the stack, so this number only comes down: raising it needs the new
    /// measure and the reason in `ios/TESTING.md`.
    static let budget = deviceStack / 10 * 9

    @MainActor
    func testRichLongChatOpensWithinTheStackBudget() throws {
        let report = try openChat(rich: 600)
        XCTAssertGreaterThan(report.rowKinds.count, 1, "the rich conversation is drawn: \(report.rowKinds)")
        XCTAssertLessThan(report.chatOpenPeak, Self.budget, report.summary)
    }

    @MainActor
    func testPlainLongChatOpensWithinTheStackBudget() throws {
        let report = try openChat(long: 2000)
        XCTAssertLessThan(report.chatOpenPeak, Self.budget, report.summary)
    }

    struct Report: Decodable {
        let stackSize: Int
        let peakBytes: Int
        let rowBodyDepthBytes: Int
        let rowBodySymbols: [String]
        let ticks: [[Double]]
        let rowKinds: [String]
        var openedAt = 0.0
        /// The deepest the stack went from the tap on the chat on.
        var chatOpenPeak: Int { Int(ticks.filter { $0[0] >= openedAt }.map { $0[1] }.max() ?? 0) }
        var summary: String {
            "chat open \(chatOpenPeak) bytes of the main stack (budget \(ChatOpenStackUITests.budget)), "
                + "whole run \(peakBytes), a row's body at \(rowBodyDepthBytes), simulator stack \(stackSize), kinds \(rowKinds)"
        }
        private enum CodingKeys: String, CodingKey { case stackSize, peakBytes, rowBodyDepthBytes, rowBodySymbols, ticks, rowKinds }
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
        report.openedAt = openedAt
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "stack-probe"
        attachment.lifetime = .keepAlways
        add(attachment)
        print("STACK-PROBE \(report.summary)")
        return report
    }
}
